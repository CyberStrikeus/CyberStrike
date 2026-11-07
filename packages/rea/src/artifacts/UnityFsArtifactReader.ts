import { artifactExpansionBudgetBytes } from "../domain/artifactExpansionBudget.js";
import type { FileHandle } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { Readable } from "node:stream";
import {
  ArtifactEntryContentUnavailable,
  ArtifactReaderFailure,
  copyArtifactEntry,
  sameArtifactEntry,
  type ArtifactEntry,
  type ArtifactReader,
  type ArtifactTraversalOptions,
} from "./ArtifactReader.js";
import { ArtifactResourceScope } from "./ArtifactResourceScope.js";
import { assertArtifactReadActive } from "./ArtifactFileOperation.js";
import { readArtifactFileBytes } from "./ArtifactFileRange.js";
import type {
  ArtifactFormatMetadata,
  UnityFsMetadata,
} from "../domain/artifactFormatMetadata.js";
import type { StableRegularFileDescriptor } from "../filesystem/RegularFile.js";
import { ArtifactFileSource } from "./ArtifactFileSource.js";
import { UNITYFS_COMPRESSION_NONE } from "../domain/unityfsFormat.js";
import {
  decodeUnityFsLz4,
  readUnityFsBlocksInfo,
  readUnityFsHeader,
  unityFsFormatFailure,
  type UnityFsBlock,
  type UnityFsNode,
} from "./UnityFsStructures.js";

const CHUNK_BYTES = 64 * 1024;
// A decode can retain both encoded and 64 MiB decoded buffers. Bound active
// decodes/paused block owners as well as the single completed cache entry.
const MAX_MEMBER_STREAMS = 4;
type UnityFsEntry = ArtifactEntry & {
  readonly declaredSize: number;
  readonly formatMetadata: Extract<
    ArtifactFormatMetadata,
    { kind: "unityfs-entry" }
  >;
};
interface UnityFsEntryState {
  readonly entry: UnityFsEntry;
  readonly firstBlock: number;
  readonly lastBlock: number;
  readonly unavailableCompression: number | undefined;
}

/** One descriptor, one admitted directory and one completed decoded-block cache. */
export class UnityFsArtifactReader implements ArtifactReader {
  readonly format = "unityfs" as const;
  readonly #scope = new ArtifactResourceScope();
  readonly #entries = new Map<string, UnityFsEntryState>();
  readonly #streams = new Map<Readable, AbortController>();
  readonly #source: ArtifactFileSource;
  #prepared: Promise<void> | undefined;
  #header: UnityFsMetadata | undefined;
  #blocks: readonly UnityFsBlock[] = [];
  #dataStart = 0;
  #remainingDecodeBytes = 0;
  #remainingReadOperations = 0;
  #cachedBlock: { readonly index: number; readonly bytes: Buffer } | undefined;
  #closing = false;

  constructor(path: string, admitted?: StableRegularFileDescriptor) {
    this.#source = new ArtifactFileSource(path, "UnityFS bundle", admitted);
  }

  formatMetadata(): UnityFsMetadata | undefined {
    return this.#header === undefined ? undefined : { ...this.#header };
  }

  async prepareContainer(
    expectedSha256: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.#scope.run(async () => {
      this.#assertOpen(signal);
      await this.#source.bindSha256(expectedSha256, signal);
    });
  }

  async *entries(
    signal?: AbortSignal,
    options?: ArtifactTraversalOptions,
  ): AsyncIterable<ArtifactEntry> {
    await this.#scope.run(async () => {
      this.#assertOpen(signal);
      this.#prepared ??= this.#prepare(signal);
      await this.#prepared;
      await this.#source.read(signal);
    });
    this.#assertOpen(signal);
    if (this.#header?.directory_status !== "available") {
      options?.onCoverage?.({
        status: "unknown",
        limitations: [
          this.#header?.directory_status === "encrypted"
            ? "UnityFS bundle declares asset-bundle encryption; member identities and contents remain unknown."
            : this.#header?.directory_status === "unsupported-layout"
              ? "UnityFS producer revision does not establish alignment or flag semantics; member identities remain unknown."
              : "UnityFS blocks-and-directory table uses an unsupported compression; member identities remain unknown.",
        ],
      });
      return;
    }
    let index = 0;
    for (const { entry } of this.#entries.values()) {
      if (index++ % 256 === 0) await setImmediate();
      this.#assertOpen(signal);
      yield copyArtifactEntry(entry);
    }
    // A close while paused at yield must not turn a cleared map into completion.
    this.#assertOpen(signal);
  }

  async open(entry: ArtifactEntry, signal?: AbortSignal): Promise<Readable> {
    return this.#scope.run(async () => {
      this.#assertOpen(signal);
      const state = this.#entries.get(entry.adapterKey);
      if (state === undefined || !sameArtifactEntry(entry, state.entry))
        throw new ArtifactReaderFailure(
          "integrity",
          "UnityFS entry does not match its owning inventory",
        );
      // Validate carrier freshness even when a cached block or unavailable fact suffices.
      const { handle } = await this.#source.read(signal);
      this.#assertOpen(signal);
      if (state.entry.kind !== "file")
        throw new ArtifactReaderFailure(
          "unavailable",
          "UnityFS directory entries have no file contents",
        );
      if (state.unavailableCompression !== undefined) {
        const compression = String(state.unavailableCompression);
        const limitation = `UnityFS member compression ${compression} is unsupported; no content hash or child artifact was produced.`;
        throw new ArtifactEntryContentUnavailable(
          `UnityFS directory entry ${String(state.entry.formatMetadata.index)} requires unsupported compression ${compression}`,
          limitation,
          { traversal: { status: "unknown", limitations: [limitation] } },
        );
      }
      if (this.#streams.size >= MAX_MEMBER_STREAMS)
        throw new ArtifactReaderFailure(
          "limit",
          "UnityFS reader already owns four active member streams",
          { boundary: "capacity" },
        );
      const controller = new AbortController();
      const output = Readable.from(
        this.#memberChunks(handle, state, controller.signal),
        {
          objectMode: false,
          highWaterMark: CHUNK_BYTES,
        },
      );
      const onAbort = (): void => {
        controller.abort(signal?.reason);
        output.destroy(
          new ArtifactReaderFailure(
            "cancelled",
            "UnityFS member read cancelled",
            { cause: signal?.reason },
          ),
        );
      };
      output.on("error", () => undefined);
      this.#streams.set(output, controller);
      const completion = new Promise<void>((resolve) => {
        output.once("close", () => {
          signal?.removeEventListener("abort", onAbort);
          this.#streams.delete(output);
          resolve();
        });
      });
      // Readable.from waits for its async iterator to retire before close. Keep
      // that whole lifetime owned, including a suspended positional read/decoder.
      void this.#scope
        .run(() => completion)
        .catch((cause: unknown) => {
          controller.abort(cause);
          output.destroy(
            cause instanceof Error
              ? cause
              : new Error("UnityFS stream ownership failed", { cause }),
          );
        });
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted === true) onAbort();
      return output;
    });
  }

  async close(): Promise<void> {
    this.#closing = true;
    for (const [stream, controller] of this.#streams) {
      const cause = new ArtifactReaderFailure(
        "unavailable",
        "UnityFS reader closed",
      );
      controller.abort(cause);
      stream.destroy(cause);
    }
    await this.#scope.close();
    await this.#source.close();
    this.#entries.clear();
    this.#blocks = [];
    this.#cachedBlock = undefined;
  }

  provenance(): readonly [] {
    return [];
  }

  #assertOpen(signal?: AbortSignal): void {
    assertArtifactReadActive(signal);
    if (this.#closing)
      throw new ArtifactReaderFailure(
        "unavailable",
        "UnityFS reader is closed",
      );
  }

  async #prepare(signal?: AbortSignal): Promise<void> {
    const { handle, initial } = await this.#source.read(signal);
    const header = await readUnityFsHeader(handle, initial.size, signal);
    if (header === undefined)
      throw unityFsFormatFailure("no complete UnityFS header");
    const status = header.layout.status;
    this.#header = {
      kind: "unityfs",
      signature: "UnityFS",
      format_version: header.formatVersion,
      player_version: header.playerVersion,
      engine_version: header.engineVersion,
      declared_size: header.declaredSize,
      flags: header.flags,
      blocks_info_compressed_size: header.compressedBlocksInfoSize,
      blocks_info_uncompressed_size: header.uncompressedBlocksInfoSize,
      blocks_info_at_end: header.blocksInfoAtEnd,
      data_start: null,
      block_count: null,
      data_hash: null,
      directory_status: status,
    };
    if (status !== "available") return;
    const { dataHash, blocks, nodes, dataStart } = await readUnityFsBlocksInfo(
      handle,
      header,
      initial.size,
      signal,
    );
    const budget = artifactExpansionBudgetBytes(initial.size);
    let streamBytes = 0n;
    for (const block of blocks) {
      streamBytes += BigInt(block.uncompressedSize);
      if (streamBytes > BigInt(budget))
        throw expansionLimit("declared virtual stream", streamBytes, budget);
    }
    this.#header = {
      ...this.#header,
      data_hash: dataHash,
      block_count: blocks.length,
      data_start: dataStart,
    };
    this.#dataStart = dataStart;
    // Keep the source block count above, but do not revisit zero-output rows
    // for every member. Parsed stream/compressed offsets remain authoritative.
    this.#blocks = blocks.filter((block) => block.uncompressedSize > 0);
    this.#remainingDecodeBytes = budget;
    await this.#registerNodes(nodes, budget, signal);
    await this.#source.read(signal);
  }

  async #registerNodes(
    nodes: readonly UnityFsNode[],
    budget: number,
    signal?: AbortSignal,
  ): Promise<void> {
    let readableBytes = 0n;
    for (let index = 0; index < nodes.length; index++) {
      if (index % 256 === 0) await setImmediate();
      this.#assertOpen(signal);
      const node = nodes[index]!;
      const firstBlock =
        node.size === 0 ? -1 : blockEndingAfter(this.#blocks, node.offset);
      const lastBlock =
        node.size === 0
          ? -1
          : blockEndingAfter(this.#blocks, node.offset + node.size - 1);
      if (node.size !== 0 && (firstBlock < 0 || lastBlock < firstBlock))
        throw unityFsFormatFailure("member has no block range");
      const unavailable = firstUnavailableBlock(
        this.#blocks,
        firstBlock,
        lastBlock,
      );
      const kind =
        (node.flags & 1) !== 0 ? ("directory" as const) : ("file" as const);
      if (kind === "file" && unavailable === undefined) {
        readableBytes += BigInt(node.size);
        if (readableBytes > BigInt(budget))
          throw expansionLimit(
            "readable members including aliases",
            readableBytes,
            budget,
          );
      }
      const adapterKey = `unityfs-entry:${String(index)}`;
      const entry = {
        path: node.path,
        sourcePath: node.path,
        kind,
        declaredSize: node.size,
        compressedSize: null,
        executable: false,
        encrypted: false,
        // These offsets address a decoded virtual stream, not the carrier.
        byteOffset: null,
        declaredIntegrity: null,
        unpacked: false,
        limitations: [],
        adapterKey,
        formatMetadata: {
          kind: "unityfs-entry",
          index,
          source_path: node.path,
          declared_offset: node.offset,
          flags: node.flags,
        },
      } satisfies UnityFsEntry;
      this.#entries.set(adapterKey, {
        entry,
        firstBlock,
        lastBlock,
        unavailableCompression: unavailable?.compression,
      });
    }
    // Four ordinary passes over admitted blocks, nodes and plaintext chunks,
    // with a small-reader floor. Byte quotas alone cannot bound tiny-block I/O.
    this.#remainingReadOperations =
      4 *
      Math.max(
        1024,
        this.#blocks.length +
          nodes.length +
          Math.ceil(Number(readableBytes) / CHUNK_BYTES),
      );
  }

  async *#memberChunks(
    handle: FileHandle,
    state: UnityFsEntryState,
    signal: AbortSignal,
  ): AsyncGenerator<Buffer> {
    const start = state.entry.formatMetadata.declared_offset;
    const end = start + state.entry.declaredSize;
    let delivered = 0,
      chunks = 0;
    for (
      let index = state.firstBlock;
      state.entry.declaredSize > 0 && index <= state.lastBlock;
      index++
    ) {
      this.#assertOpen(signal);
      const block = this.#blocks[index]!;
      const first = Math.max(start - block.streamStart, 0);
      const last = Math.min(end - block.streamStart, block.uncompressedSize);
      if (last <= first) continue;
      const plain =
        block.compression === UNITYFS_COMPRESSION_NONE
          ? undefined
          : await this.#decodedBlock(handle, index, signal);
      for (let offset = first; offset < last; offset += CHUNK_BYTES) {
        if (chunks++ % 64 === 0) await setImmediate();
        this.#assertOpen(signal);
        const size = Math.min(CHUNK_BYTES, last - offset);
        if (plain === undefined) this.#reserveMemberRead();
        const chunk =
          plain === undefined
            ? await readArtifactFileBytes(
                handle,
                this.#dataStart + block.compressedStart + offset,
                size,
                this.#dataStart + block.compressedStart + block.compressedSize,
                signal,
              )
            : // Cached buffers remain reader-owned; consumers receive independent chunks.
              Buffer.from(plain.subarray(offset, offset + size));
        delivered += chunk.length;
        yield chunk;
      }
    }
    if (delivered !== state.entry.declaredSize)
      throw unityFsFormatFailure("member ended before its declared size");
    await this.#source.read(signal);
  }

  async #decodedBlock(
    handle: FileHandle,
    index: number,
    signal: AbortSignal,
  ): Promise<Buffer> {
    if (this.#cachedBlock?.index === index) return this.#cachedBlock.bytes;
    const block = this.#blocks[index]!;
    if (block.uncompressedSize > this.#remainingDecodeBytes)
      throw expansionLimit(
        "cumulative block decoding",
        BigInt(block.uncompressedSize),
        this.#remainingDecodeBytes,
      );
    // Charge attempts too, before I/O/allocation; failed/cancelled work is not free.
    this.#reserveMemberRead();
    this.#remainingDecodeBytes -= block.uncompressedSize;
    const encoded = await readArtifactFileBytes(
      handle,
      this.#dataStart + block.compressedStart,
      block.compressedSize,
      this.#dataStart + block.compressedStart + block.compressedSize,
      signal,
    );
    const bytes = await decodeUnityFsLz4(
      encoded,
      block.uncompressedSize,
      signal,
    );
    this.#assertOpen(signal);
    this.#cachedBlock = { index, bytes };
    return bytes;
  }

  #reserveMemberRead(): void {
    if (this.#remainingReadOperations <= 0)
      throw new ArtifactReaderFailure(
        "limit",
        "UnityFS exceeds its directory-and-chunk I/O work budget",
        { boundary: "capacity" },
      );
    this.#remainingReadOperations--;
  }
}

const expansionLimit = (
  stage: string,
  bytes: bigint,
  budget: number,
): ArtifactReaderFailure =>
  new ArtifactReaderFailure(
    "limit",
    `UnityFS ${stage} requires ${String(bytes)} bytes, exceeding the ${String(budget)}-byte plaintext-work budget`,
  );

/** First nonempty block containing the selected virtual byte. */
const blockEndingAfter = (
  blocks: readonly UnityFsBlock[],
  offset: number,
): number => {
  let low = 0,
    high = blocks.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2),
      block = blocks[middle]!;
    if (block.streamStart + block.uncompressedSize <= offset) low = middle + 1;
    else high = middle;
  }
  return low < blocks.length ? low : -1;
};

/** Prefix counts avoid scanning every block for every small or overlapping node. */
const firstUnavailableBlock = (
  blocks: readonly UnityFsBlock[],
  first: number,
  last: number,
): UnityFsBlock | undefined => {
  if (first < 0) return undefined;
  const before = first === 0 ? 0 : blocks[first - 1]!.unavailableCount;
  if (blocks[last]!.unavailableCount === before) return undefined;
  let low = first,
    high = last;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (blocks[middle]!.unavailableCount > before) high = middle;
    else low = middle + 1;
  }
  return blocks[low];
};
