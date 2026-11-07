import { assertArtifactReadActive } from "./ArtifactFileOperation.js";
import type { FileHandle } from "node:fs/promises";
import { Duplex, PassThrough, type Readable } from "node:stream";
import { once } from "node:events";
import { constants, createZstdDecompress } from "node:zlib";

import {
  ERR_AMBIGUOUS_ARCHIVE,
  ERR_BAD_FORMAT,
  ERR_CENTRAL_DIRECTORY_NOT_FOUND,
  ERR_ENCRYPTED_CENTRAL_DIRECTORY,
  ERR_ENTRY_DATA_OUT_OF_BOUNDS,
  ERR_EOCDR_LOCATOR_ZIP64_NOT_FOUND,
  ERR_EOCDR_NOT_FOUND,
  ERR_EXTRAFIELD_ZIP64_NOT_FOUND,
  ERR_INVALID_COMPRESSED_DATA,
  ERR_INVALID_CRC32,
  ERR_INVALID_UNCOMPRESSED_SIZE,
  ERR_LOCAL_FILE_HEADER_NOT_FOUND,
  ERR_OVERLAPPING_ENTRY,
  ERR_SPLIT_ZIP_FILE,
  ERR_UNSUPPORTED_COMPRESSION,
  ERR_UNSUPPORTED_ENCRYPTION,
  ERR_UNSUPPORTED_UINT64,
  Reader,
  registerCodec,
  ZipReader,
  type DecompressionStreamOptions,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js";

import {
  ArtifactReaderFailure,
  copyArtifactEntry,
  sameArtifactEntry,
  type ArtifactEntry,
  type ArtifactReader,
} from "./ArtifactReader.js";
import type { ZipPackageFormat } from "../domain/zipPackageFormat.js";
import {
  ARTIFACT_EXPANSION_RATIO,
  artifactExpansionBudgetBytes,
  MINIMUM_ARTIFACT_EXPANDED_BYTES,
} from "../domain/artifactExpansionBudget.js";
import type { StableRegularFileDescriptor } from "../filesystem/RegularFile.js";
import { ArtifactFileSource } from "./ArtifactFileSource.js";
import { readFileHandleRange } from "../filesystem/readFileHandleRange.js";

const ZIP_UTF8_DECODER = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

/** Keep zip.js's framing, CRC, size checks and backpressure for method 93. */
class ZipZstandardDecompressionStream {
  readonly readable;
  readonly writable;

  constructor(_format: string, options?: DecompressionStreamOptions) {
    const stream = Duplex.toWeb(
      createZstdDecompress({
        chunkSize: options?.chunkSize,
        // Match the existing ELF/GPU Zstandard decoder's 128 MiB window cap.
        params: { [constants.ZSTD_d_windowLogMax]: 27 },
      }),
    );
    this.readable = stream.readable;
    this.writable = stream.writable;
  }
}

// zip.js owns a process-local codec registry. Module initialization registers
// this decoder once; no codecURI means the native Node stream stays in-process.
registerCodec({
  compressionMethod: 93,
  format: "rea-zip-zstd",
  DecompressionStream: ZipZstandardDecompressionStream,
});

class NodeFileReader extends Reader<string> {
  #handle: FileHandle | undefined;
  readonly #source: ArtifactFileSource;
  #initPromise: Promise<void> | undefined;

  constructor(
    private readonly path: string,
    private readonly maximumReadBytes?: number,
    admitted?: StableRegularFileDescriptor,
  ) {
    super(path);
    this.#source = new ArtifactFileSource(path, "ZIP", admitted);
  }

  override init(): Promise<void> {
    this.#initPromise ??= this.#initialize();
    return this.#initPromise;
  }

  async #initialize(): Promise<void> {
    const source = await this.#source.read();
    this.#handle = source.handle;
    this.size = source.initial.size;
  }

  async verify(): Promise<void> {
    await this.#source.read();
  }

  override async readUint8Array(
    index: number,
    length: number,
  ): Promise<Uint8Array> {
    await this.verify();
    const handle = this.#handle;
    if (handle === undefined) throw new Error("ZIP reader is not initialized");
    const readBytes = Math.min(length, this.size - index);
    // A central-directory offset can point past EOF. Type that malformed ZIP
    // read before a negative size reaches Buffer.alloc and becomes an I/O error.
    if (readBytes < 0)
      throw new ArtifactReaderFailure(
        "format",
        `ZIP archive is malformed: read at ${index} extends beyond the ${this.size}-byte archive`,
      );
    if (
      this.maximumReadBytes !== undefined &&
      readBytes > this.maximumReadBytes
    )
      throw new ArtifactReaderFailure(
        "limit",
        `ZIP metadata read requires ${readBytes} bytes, exceeding the ${this.maximumReadBytes}-byte read budget`,
      );
    const bytes = await readFileHandleRange(handle, index, readBytes);
    if (bytes.length !== readBytes)
      throw new ArtifactReaderFailure(
        "integrity",
        `ZIP source ended before its admitted extent: ${this.path}`,
      );
    await this.verify();
    return bytes;
  }

  async closeHandle(): Promise<void> {
    await this.#initPromise?.catch(() => undefined);
    await this.#source.close();
    this.#handle = undefined;
  }
}

/** Lazy Zip64-capable reader with CRC and overlap verification on every read. */
export class ZipArtifactReader implements ArtifactReader {
  readonly format: ZipPackageFormat;
  readonly #source: NodeFileReader;
  readonly #reader: ZipReader<string>;
  readonly #streams = new Map<Readable, Promise<void>>();
  readonly #enumerations = new Set<AsyncGenerator<Entry, void>>();
  #closing = false;
  #closePromise: Promise<void> | undefined;
  readonly #entries = new Map<
    string,
    { readonly source: Entry; readonly metadata: ArtifactEntry }
  >();
  /** Optionally bound each metadata read before allocating its backing buffer. */
  constructor(
    path: string,
    format: ZipPackageFormat,
    maximumMetadataReadBytes?: number,
    admitted?: StableRegularFileDescriptor,
  ) {
    this.format = format;
    this.#source = new NodeFileReader(path, maximumMetadataReadBytes, admitted);
    this.#reader = new ZipReader(this.#source, {
      checkSignature: true,
      checkOverlappingEntry: true,
      // Unflagged names use the ZIP legacy encoding (CP437); the UTF-8 flag
      // and validated Unicode Path extra fields remain authoritative.
      filenameEncoding: "cp437",
      // REA applies its own provider-neutral path validation in scanReader and
      // must preserve that typed failure instead of zip.js rejecting first.
      filenameValidation: "tolerant",
    });
  }

  async *entries(signal?: AbortSignal): AsyncIterable<ArtifactEntry> {
    this.#assertOpen(signal);
    let index = 0;
    // A traversal owns its accounting, including overlapping or repeated passes.
    let declaredFileBytes = 0;
    const enumeration = typedZipFailures(
      this.#reader.getEntriesGenerator({ decodeText: decodeZipEntryText }),
    );
    this.#enumerations.add(enumeration);
    try {
      for await (const entry of enumeration) {
        await this.#source.verify();
        this.#assertOpen(signal);
        // ZIP member identity is its directory occurrence, not its filename.
        // Logical path uniqueness belongs to the artifact inventory boundary.
        const metadata = projectZipEntry(entry, index++);
        if (metadata === undefined) continue;
        // zip.js enforces each member's declared output size, so this sum bounds streamed work.
        if (
          metadata.kind === "file" &&
          !metadata.encrypted &&
          metadata.declaredSize !== null &&
          Number.isSafeInteger(metadata.declaredSize) &&
          metadata.declaredSize >= 0
        ) {
          declaredFileBytes += metadata.declaredSize;
          const budget = artifactExpansionBudgetBytes(this.#source.size);
          if (declaredFileBytes > budget)
            throw new ArtifactReaderFailure(
              "limit",
              `ZIP entries declare ${String(declaredFileBytes)} uncompressed bytes, exceeding this archive's ${String(budget)}-byte decompression budget (${String(MINIMUM_ARTIFACT_EXPANDED_BYTES)}-byte minimum, ${String(ARTIFACT_EXPANSION_RATIO)}x archive size); a small archive cannot expand this far`,
            );
        }
        const stored = this.#entries.get(metadata.adapterKey);
        if (
          stored !== undefined &&
          !sameArtifactEntry(metadata, stored.metadata)
        )
          throw new ArtifactReaderFailure(
            "integrity",
            `ZIP member identity changed during enumeration: ${entry.filename}`,
          );
        if (stored === undefined)
          this.#entries.set(metadata.adapterKey, {
            source: entry,
            metadata: copyArtifactEntry(metadata),
          });
        yield metadata;
      }
      await this.#source.verify();
    } finally {
      this.#enumerations.delete(enumeration);
    }
  }

  open(entry: ArtifactEntry, signal?: AbortSignal): Promise<Readable> {
    this.#assertOpen(signal);
    const stored = this.#entries.get(entry.adapterKey);
    if (stored === undefined || !sameArtifactEntry(entry, stored.metadata))
      return Promise.reject(
        new ArtifactReaderFailure(
          "integrity",
          "ZIP entry metadata does not match this reader's inventory",
        ),
      );
    const source = stored.source;
    if (source.directory || source.symlink)
      return Promise.reject(
        new ArtifactReaderFailure("format", "ZIP entry is not a regular file"),
      );
    if (source.encrypted)
      return Promise.reject(
        new ArtifactReaderFailure(
          "unavailable",
          "Encrypted ZIP entry is unsupported",
        ),
      );
    const { output, completion } = extractStream(
      source,
      () => this.#source.verify(),
      signal,
    );
    this.#streams.set(output, completion);
    // Producer completion can precede consumption of a small buffered member.
    // Retain the output until both it and its producer have finished.
    output.once("close", () => {
      void completion.then(() => this.#streams.delete(output));
    });
    return Promise.resolve(output);
  }

  close(): Promise<void> {
    this.#closing = true;
    this.#closePromise ??= this.#close().finally(() => {
      // A failed descriptor close retains its owner for a later retry.
      this.#closePromise = undefined;
    });
    return this.#closePromise;
  }

  async #close(): Promise<void> {
    for (const output of this.#streams.keys())
      output.destroy(
        new ArtifactReaderFailure("unavailable", "ZIP reader closed"),
      );
    const outcomes = await Promise.allSettled([
      ...this.#streams.values(),
      ...Array.from(this.#enumerations, (enumeration) => enumeration.return()),
    ]);
    this.#enumerations.clear();
    // best-effort cleanup: zip-reader close must not mask prior extraction state.
    await this.#reader.close().catch(() => undefined);
    const failures = outcomes.flatMap((outcome) =>
      outcome.status === "rejected" ? [outcome.reason as unknown] : [],
    );
    try {
      await this.#source.closeHandle();
      this.#entries.clear();
    } catch (cause: unknown) {
      failures.push(cause);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "ZIP reader cleanup failed");
  }

  #assertOpen(signal?: AbortSignal): void {
    assertArtifactReadActive(signal);
    if (this.#closing)
      throw new ArtifactReaderFailure("unavailable", "ZIP reader is closed");
  }

  provenance(): readonly [] {
    return [];
  }
}

const projectZipEntry = (
  entry: Entry,
  index: number,
): ArtifactEntry | undefined => {
  const kind = entry.symlink
    ? "symlink"
    : entry.directory
      ? "directory"
      : "file";
  const sourcePath = zipEntryPath(entry);
  const path = sourcePath.replace(/^(?:\.\/)+/u, "");
  // Root directory markers carry no inventory occurrence. A file with this
  // spelling is still passed to the shared path validator and rejected there.
  if (kind === "directory" && (path === "" || path === ".")) return undefined;
  return {
    path,
    ...(path === sourcePath ? {} : { sourcePath }),
    kind,
    declaredSize: kind === "directory" ? null : entry.uncompressedSize,
    compressedSize: kind === "directory" ? null : entry.compressedSize,
    executable: entry.executable,
    encrypted: entry.encrypted,
    byteOffset: null,
    declaredIntegrity: null,
    unpacked: false,
    limitations: [
      ...(kind === "symlink" ? ["Archive symlink target was not read."] : []),
      ...(path === sourcePath
        ? []
        : [
            `ZIP member name ${JSON.stringify(sourcePath)} has a leading current-directory prefix omitted from its logical path.`,
          ]),
      ...legacyNameLimitations(entry),
    ],
    adapterKey: `zip-entry:${index}`,
  };
};

/** Preserve source bytes when an unflagged legacy name may use another code page. */
const legacyNameLimitations = (entry: Entry): readonly string[] => {
  if (entry.filenameUTF8 || entry.extraFieldUnicodePath?.valid === true)
    return [];
  const bytes = entry.rawFilename;
  if (!bytes.some((byte) => byte >= 0x80)) return [];
  const hex = Buffer.from(bytes).toString("hex");
  return [
    `ZIP name uses CP437 fallback; source encoding unverified; raw hex: ${hex}.`,
  ];
};

const decodeZipEntryText = (
  bytes: Uint8Array,
  encoding: string,
  type: "filename" | "comment",
): string | undefined => {
  if (type !== "filename") return undefined;
  if (encoding === "utf-8")
    return decodeStrictZipUtf8(bytes, "ZIP filename is not valid UTF-8");
  return encoding === "cp437" ? decodeCp437(bytes) : undefined;
};

/** CP437 characters for bytes 0x80-0xFF. */
const CP437_HIGH_HALF =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00A0";

/**
 * Decode a legacy ZIP name with the Unicode CP437 mapping, which Python's
 * zipfile also uses: bytes below 0x80 are ASCII. zip.js shows 0x01-0x1F and
 * 0x7F as IBM PC display glyphs, which turns the macOS folder icon file
 * `Icon\r` into `Icon♪`.
 */
const decodeCp437 = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) =>
    byte < 0x80
      ? String.fromCharCode(byte)
      : CP437_HIGH_HALF.charAt(byte - 0x80),
  ).join("");

const zipEntryPath = (entry: Entry): string => {
  const field = entry.extraFieldUnicodePath;
  if (field?.valid !== true) return entry.filename;
  return decodeStrictZipUtf8(
    field.data.subarray(5),
    "ZIP Unicode Path extra field is not valid UTF-8",
  );
};

const decodeStrictZipUtf8 = (bytes: Uint8Array, message: string): string => {
  try {
    // Keep the adapter's path semantics aligned with zip.js's default decoder:
    // a leading U+FEFF is part of a member name, not a transport signature.
    return ZIP_UTF8_DECODER.decode(bytes);
  } catch (cause: unknown) {
    throw new ArtifactReaderFailure("format", message, { cause });
  }
};

const extractStream = (
  entry: FileEntry,
  verifySource: () => Promise<void>,
  signal?: AbortSignal,
): { readonly output: Readable; readonly completion: Promise<void> } => {
  const output = new PassThrough();
  // Reader retirement can precede a caller attaching its own error listener.
  output.on("error", () => undefined);
  const controller = new AbortController();
  const onAbort = (): void => {
    controller.abort(signal?.reason);
    // AbortSignal listeners dispatch synchronously, so this destroy wins the race
    // against `getData` rejecting with its own AbortError. That ordering is what
    // keeps the caller-visible failure typed as `cancelled`.
    output.destroy(
      new ArtifactReaderFailure("cancelled", "ZIP operation cancelled", {
        cause: signal?.reason,
      }),
    );
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  // A closed output cancels its producer; the reader separately awaits getData
  // settlement before releasing the source descriptor.
  output.once("close", () => {
    signal?.removeEventListener("abort", onAbort);
    controller.abort();
  });
  const writable = new WritableStream<Uint8Array>({
    write: async (chunk) => {
      assertArtifactReadActive(signal);
      if (!output.write(Buffer.from(chunk)))
        await once(output, "drain", { signal: controller.signal });
    },
    close: async () => {
      await verifySource();
      assertArtifactReadActive(signal);
      output.end();
    },
    abort: (reason) => {
      output.destroy(toError(typedZipFailure(reason, entry.compressionMethod)));
    },
  });
  const completion = verifySource()
    .then(() =>
      entry.getData(writable, {
        signal: controller.signal,
        checkSignature: true,
        checkOverlappingEntry: true,
        onprogress: () => assertArtifactReadActive(signal),
      }),
    )
    .then(
      () => undefined,
      (cause: unknown) => {
        output.destroy(
          toError(typedZipFailure(cause, entry.compressionMethod)),
        );
      },
    );
  return { output, completion };
};

/** zip.js reports archive faults as plain errors identified by message. */
const ZIP_FAILURE_REASONS: ReadonlyMap<string, "format" | "unavailable"> =
  new Map([
    ...[
      ERR_AMBIGUOUS_ARCHIVE,
      ERR_BAD_FORMAT,
      ERR_CENTRAL_DIRECTORY_NOT_FOUND,
      ERR_ENTRY_DATA_OUT_OF_BOUNDS,
      ERR_EOCDR_LOCATOR_ZIP64_NOT_FOUND,
      ERR_EOCDR_NOT_FOUND,
      ERR_EXTRAFIELD_ZIP64_NOT_FOUND,
      ERR_INVALID_COMPRESSED_DATA,
      ERR_INVALID_CRC32,
      ERR_INVALID_UNCOMPRESSED_SIZE,
      ERR_LOCAL_FILE_HEADER_NOT_FOUND,
      ERR_OVERLAPPING_ENTRY,
      ERR_UNSUPPORTED_UINT64,
    ].map((message) => [message, "format"] as const),
    ...[
      ERR_ENCRYPTED_CENTRAL_DIRECTORY,
      ERR_SPLIT_ZIP_FILE,
      ERR_UNSUPPORTED_COMPRESSION,
      ERR_UNSUPPORTED_ENCRYPTION,
    ].map((message) => [message, "unavailable"] as const),
  ]);

/** Type a zip.js archive fault so consumers do not report it as file I/O. */
const typedZipFailure = (
  cause: unknown,
  compressionMethod?: number,
): unknown => {
  if (!(cause instanceof Error) || cause instanceof ArtifactReaderFailure)
    return cause;
  // Only method 93 uses Node's native Zstandard decoder. Do not classify
  // cancellation or an unrelated codec/runtime error as malformed ZIP data.
  const code = "code" in cause ? cause.code : undefined;
  if (compressionMethod === 93 && code === "ZSTD_error_dictionary_wrong")
    return new ArtifactReaderFailure(
      "unavailable",
      "ZIP archive uses an unsupported Zstandard dictionary",
      { cause },
    );
  const invalidZstandard =
    compressionMethod === 93 &&
    (code === "ZSTD_error_prefix_unknown" ||
      code === "ZSTD_error_checksum_wrong" ||
      code === "ZSTD_error_corruption_detected" ||
      code === "ZSTD_error_dictionary_corrupted" ||
      code === "ZSTD_error_frameParameter_unsupported" ||
      code === "ZSTD_error_frameParameter_windowTooLarge" ||
      code === "Z_BUF_ERROR");
  const reason =
    ZIP_FAILURE_REASONS.get(cause.message) ??
    (invalidZstandard ? "format" : undefined);
  if (reason === undefined) return cause;
  return new ArtifactReaderFailure(
    reason,
    reason === "format"
      ? `ZIP archive is malformed: ${invalidZstandard ? ERR_INVALID_COMPRESSED_DATA : cause.message}`
      : `ZIP archive uses an unsupported feature: ${cause.message}`,
    { cause },
  );
};

async function* typedZipFailures<T>(
  source: AsyncIterable<T>,
): AsyncGenerator<T, void> {
  try {
    yield* source;
  } catch (cause: unknown) {
    throw typedZipFailure(cause);
  }
}

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error("ZIP extraction failed");
