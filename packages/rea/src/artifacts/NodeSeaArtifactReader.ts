import type { NodeSeaAdmission } from "./nodeSea/NodeSeaAdmission.js";
import { Readable, Transform, pipeline } from "node:stream";
import { setImmediate } from "node:timers/promises";

import { artifactExpansionBudgetBytes } from "../domain/artifactExpansionBudget.js";
import type { NodeSeaMetadata } from "../domain/artifactFormatMetadata.js";
import {
  ArtifactPathRegistry,
  normalizeArtifactPath,
} from "./ArtifactPaths.js";
import {
  ArtifactReaderFailure,
  copyArtifactEntry,
  sameArtifactEntry,
  type ArtifactEntry,
  type ArtifactReader,
  type ArtifactTraversalOptions,
} from "./ArtifactReader.js";
import { ArtifactResourceScope } from "./ArtifactResourceScope.js";
import { assertArtifactReadActive } from "./ArtifactFileOperation.js";
import {
  NODE_SEA_BLOB_TOO_LARGE,
  NODE_SEA_MAX_BLOB_BYTES,
  decodeNodeSeaBlob,
  type DecodedNodeSeaBlob,
  type NodeSeaByteRange,
} from "./nodeSea/NodeSeaBlob.js";
import {
  locateNodeSea,
  readNodeSeaBlob,
  scanNodeSeaFuse,
  type NodeSeaLocation,
} from "./nodeSea/NodeSeaLocation.js";
import { readFileHandleChunks } from "../filesystem/readFileHandleChunks.js";
import type { StableRegularFileDescriptor } from "../filesystem/RegularFile.js";
import { ArtifactFileSource } from "./ArtifactFileSource.js";

const SNAPSHOT_PATH = "__node_sea__/snapshot";
const CODE_CACHE_PATH = "__node_sea__/code-cache";
const MAIN_FALLBACK_PATH = "__node_sea__/main.cjs";
const ASSET_FALLBACK_PREFIX = "__node_sea__/assets/";

type NodeSeaRole = "main-script" | "snapshot" | "code-cache" | "asset";

/** Read a Node.js SEA blob out of a Mach-O, ELF, or PE carrier without running it. */
export class NodeSeaArtifactReader implements ArtifactReader {
  readonly format = "node-sea" as const;
  readonly #scope = new ArtifactResourceScope();
  readonly #entries = new Map<string, ArtifactEntry>();
  readonly #streams = new Set<Readable>();
  readonly #source: ArtifactFileSource;
  #prepared: Promise<void> | undefined;
  #header: NodeSeaMetadata | undefined;
  #admission: NodeSeaAdmission | undefined;
  #closing = false;

  constructor(
    path: string,
    admitted?: StableRegularFileDescriptor | NodeSeaAdmission,
  ) {
    if (admitted !== undefined && "kind" in admitted) {
      this.#admission = admitted;
      this.#source = new ArtifactFileSource(path, "Node SEA", admitted.source);
    } else {
      this.#source = new ArtifactFileSource(path, "Node SEA", admitted);
    }
  }

  formatMetadata(): NodeSeaMetadata | undefined {
    if (this.#header === undefined) return undefined;
    return { ...this.#header, exec_argv: [...this.#header.exec_argv] };
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
    const contradiction = this.#header?.fuse_contradiction;
    if (contradiction !== null && contradiction !== undefined)
      options?.onCoverage?.({
        status: "complete",
        limitations: [contradiction],
      });
    let index = 0;
    for (const entry of this.#entries.values()) {
      if (index % 256 === 0) await setImmediate();
      index += 1;
      this.#assertOpen(signal);
      yield copyArtifactEntry(entry);
    }
  }

  async open(entry: ArtifactEntry, signal?: AbortSignal): Promise<Readable> {
    return this.#scope.run(async () => {
      this.#assertOpen(signal);
      const stored = this.#entries.get(entry.adapterKey);
      if (stored === undefined || !sameArtifactEntry(entry, stored))
        throw new ArtifactReaderFailure(
          "integrity",
          "Node SEA entry does not match its owning inventory",
        );
      const { handle } = await this.#source.read(signal);
      this.#assertOpen(signal);
      if (stored.byteOffset === null || stored.declaredSize === null)
        throw formatFailure("member has no physical byte range");
      const source =
        stored.declaredSize === 0
          ? Readable.from([])
          : readFileHandleChunks(handle, {
              start: stored.byteOffset,
              end: stored.byteOffset + stored.declaredSize - 1,
              signal,
              cancellationFailure: (reason) =>
                new ArtifactReaderFailure(
                  "cancelled",
                  "Node SEA read cancelled",
                  {
                    cause: reason,
                  },
                ),
            });
      const output = this.#memberStream(stored, signal);
      output.on("error", () => undefined);
      this.#streams.add(output);
      // A finished producer can leave source bytes buffered for its consumer.
      // Keep the readable side owned until it closes as well.
      output.once("close", () => this.#streams.delete(output));
      void this.#scope
        .run(
          () =>
            new Promise<void>((resolve) => {
              pipeline(source, output, () => {
                resolve();
              });
            }),
        )
        .catch((cause: unknown) =>
          output.destroy(
            cause instanceof Error
              ? cause
              : new Error("Node SEA stream ownership failed", { cause }),
          ),
        );
      return output;
    });
  }

  async close(): Promise<void> {
    this.#closing = true;
    for (const stream of this.#streams)
      stream.destroy(
        new ArtifactReaderFailure("unavailable", "Node SEA reader closed"),
      );
    await this.#scope.close();
    await this.#source.close();
    this.#entries.clear();
    this.#admission = undefined;
  }

  provenance(): readonly [] {
    return [];
  }

  #assertOpen(signal?: AbortSignal): void {
    assertArtifactReadActive(signal);
    if (this.#closing)
      throw new ArtifactReaderFailure(
        "unavailable",
        "Node SEA reader is closed",
      );
  }

  async #prepare(signal?: AbortSignal): Promise<void> {
    const { handle, initial } = await this.#source.read(signal);
    // Freshness remains owned by ArtifactFileSource even when classification
    // already decoded this exact borrowed descriptor's blob.
    let location: NodeSeaLocation;
    let decoded: DecodedNodeSeaBlob;
    if (this.#admission !== undefined) {
      ({ location, decoded } = this.#admission);
    } else {
      const found = await locateNodeSea(handle, initial.size, signal);
      if (found === undefined) throw formatFailure("blob was not found");
      location = found;
      if (location.blobLength > NODE_SEA_MAX_BLOB_BYTES)
        throw new ArtifactReaderFailure("limit", NODE_SEA_BLOB_TOO_LARGE, {
          boundary: "memory",
        });
      decoded = await decodeNodeSeaBlob(
        await readNodeSeaBlob(handle, location, initial.size, signal),
        signal,
      );
    }
    const fuse = await scanNodeSeaFuse(handle, initial.size, signal);
    let declaredBytes = 0n;
    const expansionBudget = BigInt(
      artifactExpansionBudgetBytes(location.blobLength),
    );
    let index = 0;
    for (const member of seaMembers(decoded)) {
      if (index % 256 === 0) await setImmediate();
      this.#assertOpen(signal);
      declaredBytes += BigInt(member.range.length);
      if (declaredBytes > expansionBudget)
        throw new ArtifactReaderFailure(
          "limit",
          `Node SEA readable entries declare ${String(declaredBytes)} bytes, exceeding this blob's ${String(expansionBudget)}-byte expansion budget`,
          { boundary: "memory" },
        );
      const start = location.blobOffset + member.range.offset;
      if (start > initial.size || member.range.length > initial.size - start)
        throw formatFailure(`member exceeds the carrier: ${member.path}`);
      const entry = {
        path: member.path,
        kind: "file" as const,
        declaredSize: member.range.length,
        compressedSize: null,
        executable: false,
        encrypted: false,
        byteOffset: start,
        declaredIntegrity: null,
        unpacked: false,
        limitations: [],
        adapterKey: `node-sea:${String(index)}`,
        formatMetadata: {
          kind: "node-sea-entry" as const,
          role: member.role,
          source_path: member.sourcePath,
          index,
        },
        sourcePath: member.sourcePath,
      } satisfies ArtifactEntry;
      this.#entries.set(entry.adapterKey, entry);
      index += 1;
    }
    this.#header = {
      kind: "node-sea",
      magic: decoded.magic,
      flags: decoded.flags,
      disable_experimental_sea_warning: decoded.disableExperimentalSeaWarning,
      use_snapshot: decoded.useSnapshot,
      use_code_cache: decoded.useCodeCache,
      include_assets: decoded.includeAssets,
      include_exec_argv: decoded.includeExecArgv,
      exec_argv_extension: decoded.execArgvExtension,
      exec_argv: [...decoded.execArgv],
      code_path: decoded.codePath,
      carrier: location.carrier,
      blob_offset: location.blobOffset,
      blob_length: location.blobLength,
      fuse_state: fuse.fuseState,
      fuse_sentinel: fuse.fuseSentinel,
      fuse_contradiction: fuse.fuseContradiction,
    };
    await this.#source.read(signal);
    this.#admission = undefined;
  }

  #memberStream(entry: ArtifactEntry, signal?: AbortSignal): Transform {
    let bytes = 0;
    const check = async (): Promise<void> => {
      if (bytes !== entry.declaredSize)
        throw formatFailure(`member ended early: ${entry.path}`);
      await this.#source.read(signal);
    };
    return new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        callback(null, chunk);
      },
      flush(callback) {
        void check().then(
          () => callback(),
          (cause: unknown) =>
            callback(
              cause instanceof Error
                ? cause
                : new Error("Node SEA read failed", { cause }),
            ),
        );
      },
    });
  }
}

function* seaMembers(decoded: DecodedNodeSeaBlob): Generator<{
  readonly path: string;
  readonly sourcePath: string;
  readonly role: NodeSeaRole;
  readonly range: NodeSeaByteRange;
}> {
  const registry = new ArtifactPathRegistry();
  const claimed = new Set<string>();
  const reserve = (path: string): string => {
    if (claimed.has(path))
      throw new ArtifactReaderFailure(
        "path",
        `Node SEA entry path collides: ${path}`,
      );
    registry.add(path, "file");
    claimed.add(path);
    return path;
  };
  const mappedPath = (raw: string, fallback: string): string => {
    try {
      const normalized = normalizeArtifactPath(raw);
      if (
        normalized !== "__node_sea__" &&
        !normalized.startsWith("__node_sea__/")
      )
        return reserve(normalized);
    } catch (cause) {
      if (!(cause instanceof ArtifactReaderFailure) || cause.reason !== "path")
        throw cause;
    }
    return reserve(fallback);
  };
  if (decoded.mainScript !== null)
    yield {
      path: mappedPath(decoded.codePath, MAIN_FALLBACK_PATH),
      sourcePath: decoded.codePath,
      role: "main-script",
      range: decoded.mainScript,
    };
  if (decoded.snapshot !== null)
    yield {
      path: reserve(SNAPSHOT_PATH),
      sourcePath: SNAPSHOT_PATH,
      role: "snapshot",
      range: decoded.snapshot,
    };
  if (decoded.codeCache !== null)
    yield {
      path: reserve(CODE_CACHE_PATH),
      sourcePath: CODE_CACHE_PATH,
      role: "code-cache",
      range: decoded.codeCache,
    };
  for (const [ordinal, asset] of decoded.assets.entries())
    yield {
      path: mappedPath(
        asset.name,
        `${ASSET_FALLBACK_PREFIX}${String(ordinal)}`,
      ),
      sourcePath: asset.name,
      role: "asset",
      range: asset.range,
    };
}

const formatFailure = (detail: string): ArtifactReaderFailure =>
  new ArtifactReaderFailure("format", `Node SEA blob is malformed: ${detail}`);
