import { Readable, Transform, pipeline } from "node:stream";
import { crc32 } from "node:zlib";
import { readArtifactFileBytes } from "./ArtifactFileRange.js";
import { setImmediate } from "node:timers/promises";

import type {
  UImageEntryMetadata,
  UImageMetadata,
} from "../domain/artifactFormatMetadata.js";
import { ArtifactFileSource } from "./ArtifactFileSource.js";
import { assertArtifactReadActive } from "./ArtifactFileOperation.js";
import {
  ArtifactReaderFailure,
  copyArtifactEntry,
  sameArtifactEntry,
  type ArtifactEntry,
  type ArtifactReader,
  type ArtifactTraversalOptions,
} from "./ArtifactReader.js";
import { ArtifactResourceScope } from "./ArtifactResourceScope.js";
import { readFileHandleChunks } from "../filesystem/readFileHandleChunks.js";
import type { StableRegularFileDescriptor } from "../filesystem/RegularFile.js";
import {
  hasUImageSizeTable,
  parseMultiImageTable,
  parseUImageHeaderFields,
  UIMAGE_HEADER_SIZE,
  UIMAGE_MAGIC,
  UIMAGE_MULTI_TABLE_WINDOW,
  type UImageHeaderFields,
  type UImageParseError,
  type UImageSubImage,
} from "../domain/uimageFormat.js";

const PAYLOAD_PATH = "payload.bin";
const READ_CHUNK_BYTES = 64 * 1024;
type UImageEntry = ArtifactEntry & {
  readonly byteOffset: number;
  readonly declaredSize: number;
  readonly formatMetadata: UImageEntryMetadata;
};

/** Read a U-Boot legacy uImage without running, decompressing, or altering it. */
export class UImageArtifactReader implements ArtifactReader {
  readonly format = "uimage" as const;
  readonly #scope = new ArtifactResourceScope();
  readonly #entries = new Map<string, UImageEntry>();
  readonly #streams = new Set<Readable>();
  readonly #source: ArtifactFileSource;
  #prepared: Promise<void> | undefined;
  #header: UImageMetadata | undefined;
  #closing = false;

  constructor(path: string, admitted?: StableRegularFileDescriptor) {
    this.#source = new ArtifactFileSource(path, "U-Boot uImage", admitted);
  }

  formatMetadata(): UImageMetadata | undefined {
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
    options?.onCoverage?.({
      status: "complete",
      limitations:
        this.#header !== undefined && hasUImageSizeTable(this.#header.type)
          ? [
              "Multi-image sub-images are split from the stored size table; the payload entry retains the full stored bytes.",
            ]
          : [],
    });
    let index = 0;
    for (const entry of this.#entries.values()) {
      if (index % 256 === 0) await setImmediate();
      index += 1;
      this.#assertOpen(signal);
      yield copyArtifactEntry(entry);
    }
    this.#assertOpen(signal);
  }

  async open(entry: ArtifactEntry, signal?: AbortSignal): Promise<Readable> {
    return this.#scope.run(async () => {
      this.#assertOpen(signal);
      const stored = this.#entries.get(entry.adapterKey);
      if (stored === undefined || !sameArtifactEntry(entry, stored))
        throw new ArtifactReaderFailure(
          "integrity",
          "uImage entry does not match its owning inventory",
        );
      const { handle } = await this.#source.read(signal);
      this.#assertOpen(signal);
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
                  "uImage read cancelled",
                  {
                    cause: reason,
                  },
                ),
            });
      const output = this.#memberStream(stored, signal);
      output.on("error", () => undefined);
      this.#streams.add(output);
      let producerComplete = false;
      const onAbort = (): void => {
        // Active reads/validation own failure precedence. After they complete,
        // cancellation must still retire any unconsumed readable bytes.
        if (!producerComplete || output.destroyed) return;
        output.destroy(
          new ArtifactReaderFailure("cancelled", "uImage read cancelled", {
            cause: signal?.reason,
          }),
        );
      };
      const retired = new Promise<void>((resolve) => {
        output.once("close", () => {
          this.#streams.delete(output);
          signal?.removeEventListener("abort", onAbort);
          resolve();
        });
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      void this.#scope
        .run(async () => {
          // Writable completion can leave readable bytes buffered. Retain both
          // producer I/O and the caller's stream until consumption or closure.
          await Promise.all([
            new Promise<void>((resolve) =>
              pipeline(source, output, () => {
                producerComplete = true;
                if (signal?.aborted) onAbort();
                resolve();
              }),
            ),
            retired,
          ]);
        })
        .catch((cause: unknown) =>
          output.destroy(
            cause instanceof Error
              ? cause
              : new Error("uImage stream ownership failed", { cause }),
          ),
        );
      return output;
    });
  }

  async close(): Promise<void> {
    this.#closing = true;
    for (const stream of this.#streams)
      stream.destroy(
        new ArtifactReaderFailure("unavailable", "uImage reader closed"),
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
      throw new ArtifactReaderFailure("unavailable", "uImage reader closed");
  }

  async #prepare(signal?: AbortSignal): Promise<void> {
    const { handle, initial } = await this.#source.read(signal);
    const headerBytes = await readArtifactFileBytes(
      handle,
      0,
      Math.min(initial.size, UIMAGE_HEADER_SIZE),
      initial.size,
      signal,
    );
    const fields = parseUImageHeaderFields(headerBytes);
    if (!fields.ok) throw parseFailure(fields.error);
    const header = fields.value;
    if (initial.size < UIMAGE_HEADER_SIZE + header.payloadSize)
      throw formatFailure(
        `uImage payload is truncated: header declares ${header.payloadSize} payload bytes but only ${initial.size - UIMAGE_HEADER_SIZE} follow the header`,
      );
    // Admit the bounded size table first, then include those same bytes in the
    // native CRC stream. No payload byte needs to be read twice for verification.
    let dataCrc32 = 0;
    let read = 0;
    let subImages: readonly UImageSubImage[] = [];
    if (hasUImageSizeTable(header.type)) {
      const tablePrefix = await readArtifactFileBytes(
        handle,
        UIMAGE_HEADER_SIZE,
        Math.min(header.payloadSize, UIMAGE_MULTI_TABLE_WINDOW),
        initial.size,
        signal,
      );
      const parsed = parseMultiImageTable(tablePrefix, header.payloadSize);
      if (!parsed.ok) throw parseFailure(parsed.error);
      subImages = parsed.value;
      dataCrc32 = crc32(tablePrefix);
      read = tablePrefix.length;
    }
    while (read < header.payloadSize) {
      this.#assertOpen(signal);
      const chunk = await readArtifactFileBytes(
        handle,
        UIMAGE_HEADER_SIZE + read,
        Math.min(READ_CHUNK_BYTES, header.payloadSize - read),
        initial.size,
        signal,
      );
      dataCrc32 = crc32(chunk, dataCrc32);
      read += chunk.length;
    }
    if (dataCrc32 !== header.dataCrc32)
      throw formatFailure(
        `uImage data CRC32 mismatch: declared 0x${header.dataCrc32.toString(16)}, computed 0x${dataCrc32.toString(16)}`,
      );
    this.#header = toMetadata(header, subImages.length);
    const payload = entryFor("payload", 0, {
      byteOffset: UIMAGE_HEADER_SIZE,
      declaredSize: header.payloadSize,
    });
    this.#entries.set(payload.adapterKey, payload);
    for (const sub of subImages) {
      const entry = entryFor("sub-image", sub.index, sub);
      this.#entries.set(entry.adapterKey, entry);
    }
  }

  #memberStream(entry: UImageEntry, signal?: AbortSignal): Transform {
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
                : new Error("uImage read failed", { cause }),
            ),
        );
      },
    });
  }
}

const formatFailure = (
  detail: string,
  options?: ErrorOptions,
): ArtifactReaderFailure =>
  new ArtifactReaderFailure(
    "format",
    `uImage is malformed: ${detail}`,
    options,
  );

const parseFailure = (failure: UImageParseError): ArtifactReaderFailure =>
  failure._tag === "UImageCapacityFailure"
    ? new ArtifactReaderFailure("limit", failure.message, {
        boundary: "capacity",
        cause: failure,
      })
    : formatFailure(failure.message, { cause: failure });

const entryFor = (
  role: "payload" | "sub-image",
  index: number,
  range: Pick<UImageSubImage, "byteOffset" | "declaredSize">,
): UImageEntry => {
  const payload = role === "payload";
  const path = payload ? PAYLOAD_PATH : `image-${String(index)}.bin`;
  const adapterKey = payload
    ? "uimage:payload"
    : `uimage:image-${String(index)}`;
  return {
    path,
    kind: "file",
    declaredSize: range.declaredSize,
    compressedSize: null,
    executable: false,
    encrypted: false,
    byteOffset: range.byteOffset,
    declaredIntegrity: null,
    unpacked: false,
    limitations: [],
    adapterKey,
    formatMetadata: { kind: "uimage-entry", role, index },
    sourcePath: path,
  };
};

const toMetadata = (
  facts: UImageHeaderFields,
  subImageCount: number,
): UImageMetadata => ({
  kind: "uimage",
  magic: UIMAGE_MAGIC,
  timestamp: facts.timestamp,
  timestamp_iso: facts.timestampIso,
  payload_size: facts.payloadSize,
  load_address: facts.loadAddress,
  entry_point: facts.entryPoint,
  header_crc32: facts.headerCrc32,
  data_crc32: facts.dataCrc32,
  crc_verified: true,
  os: facts.os,
  os_name: facts.osName,
  arch: facts.arch,
  arch_name: facts.archName,
  type: facts.type,
  type_name: facts.typeName,
  compression: facts.compression,
  compression_name: facts.compressionName,
  name: facts.name,
  name_bytes_hex: facts.nameBytesHex,
  sub_image_count: subImageCount,
});
