import { readArtifactFileBytes } from "./ArtifactFileRange.js";
import { readGodotPckHeaderFacts } from "../domain/godotPckFormat.js";
import { artifactExpansionBudgetBytes } from "../domain/artifactExpansionBudget.js";
import type { FileHandle } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { Readable, Transform, pipeline } from "node:stream";
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
  locateGodotPck,
  type GodotPckAdmission,
  type GodotPckLocation,
} from "./GodotPckLocation.js";
import type { GodotPckMetadata } from "../domain/artifactFormatMetadata.js";
import { jsonValueByteLength } from "../domain/jsonValueByteLength.js";
import { readFileHandleChunks } from "../filesystem/readFileHandleChunks.js";
import type { StableRegularFileDescriptor } from "../filesystem/RegularFile.js";
import { ArtifactFileSource } from "./ArtifactFileSource.js";

const PACK_DIR_ENCRYPTED = 1;
const PACK_REL_FILEBASE = 2;
const PACK_SPARSE_BUNDLE = 4;
const PACK_FILE_ENCRYPTED = 1;
const DIRECTORY_CHUNK_BYTES = 64 * 1024;
/** Encoded retained entry metadata, including escaped paths and source facts. */
const MAX_DIRECTORY_METADATA_BYTES = 64 * 1024 * 1024;
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** One descriptor, one validated directory, and bounded positional member reads. */
export class GodotPckArtifactReader implements ArtifactReader {
  readonly format = "godot-pck" as const;
  readonly #scope = new ArtifactResourceScope();
  readonly #entries = new Map<string, ArtifactEntry>();
  readonly #streams = new Set<Readable>();
  readonly #source: ArtifactFileSource;
  readonly #location: GodotPckLocation | undefined;
  #prepared: Promise<void> | undefined;
  #header: GodotPckMetadata | undefined;
  #closing = false;

  constructor(
    path: string,
    admitted?: StableRegularFileDescriptor | GodotPckAdmission,
  ) {
    const admission =
      admitted !== undefined && "kind" in admitted ? admitted : undefined;
    this.#source = new ArtifactFileSource(
      path,
      "Godot PCK",
      admitted !== undefined && "kind" in admitted ? admitted.source : admitted,
    );
    this.#location = admission?.location;
  }

  formatMetadata(): GodotPckMetadata | undefined {
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
    if (this.#header?.directory_status !== "available") {
      options?.onCoverage?.({
        status: "unknown",
        limitations: [
          this.#header?.directory_status === "encrypted"
            ? "Godot PCK directory is encrypted; member identities and contents remain unknown."
            : "Godot PCK sparse-bundle member bytes are external and were not traversed.",
        ],
      });
      return;
    }
    let index = 0;
    for (const entry of this.#entries.values()) {
      if (index++ % 256 === 0) await setImmediate();
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
          "Godot PCK entry does not match its owning inventory",
        );
      if (stored.encrypted)
        throw new ArtifactReaderFailure(
          "unavailable",
          `Encrypted Godot PCK member is unsupported: ${stored.path}`,
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
                  "Godot PCK read cancelled",
                  { cause: reason },
                ),
            });
      const output = this.#memberStream(stored, signal);
      // The returned stream still reports failures to its consumer. Also handle
      // retirement before a caller has attached its own error listener.
      output.on("error", () => undefined);
      this.#streams.add(output);
      // Writable completion can leave an unread member buffered on the readable
      // side. The returned stream stays owned until that side closes too.
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
              : new Error("Godot PCK stream ownership failed", { cause }),
          ),
        );
      return output;
    });
  }

  async close(): Promise<void> {
    this.#closing = true;
    for (const stream of this.#streams)
      stream.destroy(
        new ArtifactReaderFailure("unavailable", "Godot PCK reader closed"),
      );
    await this.#scope.close();
    await this.#source.close();
    this.#entries.clear();
  }

  provenance(): readonly [] {
    return [];
  }

  #assertOpen(signal?: AbortSignal): void {
    assertArtifactReadActive(signal);
    if (this.#closing)
      throw new ArtifactReaderFailure(
        "unavailable",
        "Godot PCK reader is closed",
      );
  }

  async #prepare(signal?: AbortSignal): Promise<void> {
    const { handle, initial } = await this.#source.read(signal);
    const header = await readGodotPckHeader(
      handle,
      initial.size,
      signal,
      this.#location,
    );
    this.#header = header;
    if (header.directory_status !== "available") return;
    const cursor = new PckCursor(
      handle,
      header.directory_start + 4,
      header.pack_end,
      signal,
    );
    let retainedBytes = 0;
    let declaredPlaintextBytes = 0n;
    const expansionBudget = BigInt(
      artifactExpansionBudgetBytes(header.pack_end - header.pack_start),
    );
    for (let index = 0; index < header.declared_file_count; index++) {
      if (index % 256 === 0) await setImmediate();
      assertArtifactReadActive(signal);
      const pathBytes = await cursor.uint32();
      // Check worst-case JSON escaping before decoding or allocating the path.
      // The logical path, raw source path, and metadata source path can each
      // need six JSON bytes per input byte before retained facts are charged.
      if (pathBytes * 18 > MAX_DIRECTORY_METADATA_BYTES - retainedBytes)
        throw metadataLimit();
      const rawPath = await cursor.bytes(pathBytes);
      const offset = await cursor.uint64();
      const size = await cursor.uint64();
      const md5 = (await cursor.bytes(16)).toString("hex");
      // Godot 3's format 1 has neither per-file flags nor a file-base field.
      const flags = header.format_version === 1 ? 0 : await cursor.uint32();
      if ((flags & ~PACK_FILE_ENCRYPTED) !== 0)
        throw new ArtifactReaderFailure(
          "unavailable",
          `Godot patch or unknown member flags are unsupported: 0x${flags.toString(16)}`,
        );
      const sourcePath = pckMemberPath(rawPath);
      if (header.format_version === 1 && offset === 0n)
        throw new ArtifactReaderFailure(
          "unavailable",
          `Godot PCK patch removal entry is unsupported: ${sourcePath}`,
        );
      const start = toSafeOffset(
        offset,
        header.file_base,
        header.pack_end,
        sourcePath,
      );
      if (size > BigInt(header.pack_end - start))
        throw formatFailure(`member exceeds the pack: ${sourcePath}`);
      // Aliases are valid, but each path causes another hash/copy. Admit the
      // complete directory before yielding anything, including all-zero claims.
      if ((flags & PACK_FILE_ENCRYPTED) === 0) {
        declaredPlaintextBytes += size;
        if (declaredPlaintextBytes > expansionBudget)
          throw new ArtifactReaderFailure(
            "limit",
            `Godot PCK readable entries declare ${String(declaredPlaintextBytes)} plaintext bytes, exceeding this pack's ${String(expansionBudget)}-byte expansion budget`,
          );
      }
      const metadata = {
        path: sourcePath.startsWith("res://")
          ? sourcePath.slice(6)
          : sourcePath,
        sourcePath,
        kind: "file" as const,
        declaredSize: Number(size),
        compressedSize: null,
        executable: false,
        encrypted: (flags & PACK_FILE_ENCRYPTED) !== 0,
        byteOffset: start,
        declaredIntegrity: /^0{32}$/u.test(md5)
          ? null
          : { algorithm: "md5" as const, digest: md5 },
        unpacked: false,
        limitations: /^0{32}$/u.test(md5)
          ? ["Godot PCK declares an all-zero MD5; source integrity is unknown."]
          : [],
        adapterKey: `godot-pck-entry:${String(index)}`,
        formatMetadata: {
          kind: "godot-pck-entry" as const,
          index,
          source_path: sourcePath,
          declared_offset: Number(offset),
          flags,
          md5_status: /^0{32}$/u.test(md5)
            ? ("all-zero" as const)
            : ("declared" as const),
        },
      } satisfies ArtifactEntry;
      retainedBytes += jsonValueByteLength(
        metadata,
        MAX_DIRECTORY_METADATA_BYTES - retainedBytes,
      );
      if (retainedBytes > MAX_DIRECTORY_METADATA_BYTES) throw metadataLimit();
      this.#entries.set(metadata.adapterKey, metadata);
    }
    await this.#source.read(signal);
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
                : new Error("Godot PCK read failed", { cause }),
            ),
        );
      },
    });
  }
}

/** Decode header fields once; unsupported content does not erase observed headers. */
const readGodotPckHeader = async (
  handle: FileHandle,
  size: number,
  signal?: AbortSignal,
  admittedLocation?: GodotPckLocation,
): Promise<GodotPckMetadata> => {
  const location =
    admittedLocation ?? (await locateGodotPck(handle, size, signal));
  if (location === undefined)
    throw formatFailure("no standalone header or executable trailer");
  const { start, end, embedded } = location;
  const fixed = await readArtifactFileBytes(handle, start, 40, end, signal);
  const header = readGodotPckHeaderFacts(fixed);
  const version = header.formatVersion;
  if (![1, 2, 3, 4].includes(version))
    throw new ArtifactReaderFailure(
      "unavailable",
      `Godot PCK format ${String(version)} is unsupported; plain formats 1, 2, 3 and 4 are supported`,
    );
  const flags = version === 1 ? 0 : fixed.readUInt32LE(20);
  if (
    (flags & ~(PACK_DIR_ENCRYPTED | PACK_REL_FILEBASE | PACK_SPARSE_BUNDLE)) !==
    0
  )
    throw new ArtifactReaderFailure(
      "unavailable",
      `Godot PCK declares unknown pack flags 0x${flags.toString(16)}`,
    );
  const fileBase =
    version === 1
      ? 0
      : toSafeOffset(
          fixed.readBigUInt64LE(24),
          version >= 3 || (flags & PACK_REL_FILEBASE) !== 0 ? start : 0,
          end,
          "file base",
        );
  const directory =
    version >= 3
      ? toSafeOffset(fixed.readBigUInt64LE(32), start, end, "directory")
      : start + (version === 1 ? 84 : 96);
  const count = (
    await readArtifactFileBytes(handle, directory, 4, end, signal)
  ).readUInt32LE(0);
  const status =
    (flags & PACK_DIR_ENCRYPTED) !== 0
      ? "encrypted"
      : (flags & PACK_SPARSE_BUNDLE) !== 0
        ? "sparse-bundle"
        : "available";
  if (
    status === "available" &&
    count * (version === 1 ? 36 : 40) > end - directory - 4
  )
    throw formatFailure("declared member count cannot fit in the directory");
  return {
    kind: "godot-pck",
    format_version: version,
    engine_major: header.engineMajor,
    engine_minor: header.engineMinor,
    engine_patch: header.enginePatch,
    pack_start: start,
    pack_end: end,
    embedded,
    pack_flags: flags,
    file_base: fileBase,
    directory_start: directory,
    declared_file_count: count,
    directory_status: status,
  };
};

const pckMemberPath = (raw: Buffer): string => {
  let end = raw.length;
  while (end > 0 && raw[end - 1] === 0) end--;
  let path: string;
  try {
    path = UTF8.decode(raw.subarray(0, end));
  } catch (cause: unknown) {
    throw new ArtifactReaderFailure(
      "format",
      "Godot PCK path is not valid UTF-8",
      { cause },
    );
  }
  if (path.length === 0 || path === "res://" || path.includes("\0"))
    throw formatFailure("empty or NUL-containing member path");
  return path;
};

/** One bounded read window; no whole-pack buffer or per-member source reopening. */
class PckCursor {
  #buffer: Buffer = Buffer.alloc(0);
  #bufferStart = 0;
  constructor(
    private readonly handle: FileHandle,
    private position: number,
    private readonly end: number,
    private readonly signal?: AbortSignal,
  ) {}
  async bytes(length: number): Promise<Buffer> {
    if (length > this.end - this.position)
      throw formatFailure("directory entry exceeds the pack");
    if (length > MAX_DIRECTORY_METADATA_BYTES / 18) throw metadataLimit();
    if (length > DIRECTORY_CHUNK_BYTES) {
      // A large valid virtual path is bounded by retained representation, not
      // the host filesystem's PATH_MAX. Only this path receives a larger read.
      const value = await readArtifactFileBytes(
        this.handle,
        this.position,
        length,
        this.end,
        this.signal,
      );
      this.position += length;
      return value;
    }
    const offset = this.position - this.#bufferStart;
    if (offset < 0 || offset + length > this.#buffer.length) {
      this.#buffer = await readArtifactFileBytes(
        this.handle,
        this.position,
        Math.min(DIRECTORY_CHUNK_BYTES, this.end - this.position),
        this.end,
        this.signal,
      );
      this.#bufferStart = this.position;
    }
    const start = this.position - this.#bufferStart;
    this.position += length;
    return this.#buffer.subarray(start, start + length);
  }
  async uint32(): Promise<number> {
    return (await this.bytes(4)).readUInt32LE(0);
  }
  async uint64(): Promise<bigint> {
    return (await this.bytes(8)).readBigUInt64LE(0);
  }
}

const toSafeOffset = (
  offset: bigint,
  base: number,
  end: number,
  subject: string,
): number => {
  if (base > end || offset > BigInt(end - base))
    throw formatFailure(`${subject} offset exceeds the pack`);
  return base + Number(offset);
};
const formatFailure = (detail: string): ArtifactReaderFailure =>
  new ArtifactReaderFailure("format", `Godot PCK is malformed: ${detail}`);
const metadataLimit = (): ArtifactReaderFailure =>
  new ArtifactReaderFailure(
    "limit",
    "Godot PCK directory exceeds the 64 MiB encoded metadata budget",
    { boundary: "memory" },
  );
