import { Readable, Transform, pipeline } from "node:stream";

import type {
  EspImageMetadata,
  EspImageSegmentMetadata,
  EspImageSignatureBlockMetadata,
} from "../domain/artifactFormatMetadata.js";
import { espChipForId } from "../domain/firmware/espChips.js";
import {
  espFlashDumpOrigin,
  type EspFlashDumpOrigin,
} from "../domain/firmware/espFlashLocation.js";
import {
  createEspImageDecoder,
  type EspImageFailure,
} from "../domain/firmware/espImage.js";
import {
  ESP_IMAGE_LIMITATIONS,
  type EspImage,
} from "../domain/firmware/espImageFacts.js";
import {
  ESP_SIGNATURE_BLOCK_BYTES,
  offsetText,
} from "../domain/firmware/espImageStructures.js";
import { readEspFlashRange } from "./EspFlashRegionReads.js";
import {
  ArtifactReaderFailure,
  copyArtifactEntry,
  sameArtifactEntry,
  type ArtifactEntry,
  type ArtifactReader,
  type ArtifactReaderTraversal,
  type ArtifactTraversalOptions,
} from "./ArtifactReader.js";
import { ArtifactResourceScope } from "./ArtifactResourceScope.js";
import { assertArtifactReadActive } from "./ArtifactFileOperation.js";
import { ArtifactFileSource } from "./ArtifactFileSource.js";
import { readFileHandleChunks } from "../filesystem/readFileHandleChunks.js";
import type { StableRegularFileDescriptor } from "../filesystem/RegularFile.js";

const LABEL = "ESP image";
type EspImageEntry = ArtifactEntry & {
  readonly byteOffset: number;
  readonly declaredSize: number;
  readonly formatMetadata:
    | EspImageSegmentMetadata
    | EspImageSignatureBlockMetadata;
};

/**
 * Inventory one ESP32-family image as its header-declared segments and
 * Secure Boot v2 signature blocks. Decoding reads the file once; each entry
 * is a positional read of the carrier, rechecked against its identity.
 */
export class EspImageArtifactReader implements ArtifactReader {
  readonly format = "esp-image" as const;
  readonly #scope = new ArtifactResourceScope();
  readonly #entries = new Map<string, EspImageEntry>();
  readonly #streams = new Set<Readable>();
  readonly #source: ArtifactFileSource;
  #prepared: Promise<void> | undefined;
  #metadata: EspImageMetadata | undefined;
  #coverage: ArtifactReaderTraversal | undefined;
  #closing = false;

  constructor(path: string, admitted?: StableRegularFileDescriptor) {
    this.#source = new ArtifactFileSource(path, LABEL, admitted);
  }

  formatMetadata(): EspImageMetadata | undefined {
    return this.#metadata === undefined
      ? undefined
      : structuredClone(this.#metadata);
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
    if (this.#coverage !== undefined)
      options?.onCoverage?.({
        ...this.#coverage,
        limitations: [...this.#coverage.limitations],
      });
    for (const entry of this.#entries.values()) {
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
          `${LABEL} entry does not match its owning inventory`,
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
                  `${LABEL} read cancelled`,
                  { cause: reason },
                ),
            });
      const output = this.#entryStream(stored, signal);
      // Retirement can destroy the stream before its consumer listens.
      output.on("error", () => undefined);
      this.#streams.add(output);
      let producerComplete = false;
      const onAbort = (): void => {
        // Preserve active read/validation errors; after production, the caller
        // still owns buffered bytes and cancellation must retire that result.
        if (!producerComplete || output.destroyed) return;
        output.destroy(
          new ArtifactReaderFailure("cancelled", `${LABEL} read cancelled`, {
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
          await Promise.all([
            new Promise<void>((resolve) => {
              pipeline(source, output, () => {
                producerComplete = true;
                if (signal?.aborted) onAbort();
                resolve();
              });
            }),
            retired,
          ]);
        })
        .catch((cause: unknown) =>
          output.destroy(
            cause instanceof Error
              ? cause
              : new Error(`${LABEL} stream ownership failed`, { cause }),
          ),
        );
      return output;
    });
  }

  async close(): Promise<void> {
    this.#closing = true;
    for (const stream of this.#streams)
      stream.destroy(
        new ArtifactReaderFailure("unavailable", `${LABEL} reader closed`),
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
        `${LABEL} reader is closed`,
      );
  }

  async #prepare(signal?: AbortSignal): Promise<void> {
    const image = await this.#decode(signal);
    for (const segment of image.segments) {
      const { index, data_len } = segment.metadata;
      const entry = {
        path: `segment-${String(index).padStart(2, "0")}.bin`,
        kind: "file" as const,
        declaredSize: segment.availableLength,
        compressedSize: null,
        executable: false,
        encrypted: false,
        byteOffset: segment.dataOffset,
        declaredIntegrity: null,
        unpacked: false,
        limitations:
          segment.availableLength < data_len
            ? [
                ESP_IMAGE_LIMITATIONS.segmentEntryTruncated(
                  index,
                  data_len,
                  segment.availableLength,
                ),
              ]
            : [],
        adapterKey: `esp-image:segment:${String(index)}`,
        formatMetadata: { ...segment.metadata },
      } satisfies EspImageEntry;
      this.#entries.set(entry.adapterKey, entry);
    }
    for (const block of image.signatureBlocks) {
      const entry = {
        path: `signature-block-${String(block.metadata.index)}.bin`,
        kind: "file" as const,
        declaredSize: ESP_SIGNATURE_BLOCK_BYTES,
        compressedSize: null,
        executable: false,
        encrypted: false,
        byteOffset: block.offset,
        declaredIntegrity: null,
        unpacked: false,
        limitations: [],
        adapterKey: `esp-image:signature-block:${String(block.metadata.index)}`,
        formatMetadata: { ...block.metadata },
      } satisfies EspImageEntry;
      this.#entries.set(entry.adapterKey, entry);
    }
    const dump = await this.#flashDump(image, signal);
    this.#metadata = {
      ...image.metadata,
      flash_dump:
        dump === undefined
          ? null
          : {
              flash_offset: dump.flashOffset,
              table_file_offset: dump.tableFileOffset,
            },
    };
    const limitations = [
      ...image.limitations,
      ...(dump === undefined ? [] : [flashDumpLimitation(image, dump)]),
    ];
    if (image.coverage === "unknown" || limitations.length > 0)
      this.#coverage = { status: image.coverage, limitations };
  }

  /**
   * Whether this image is the bootloader at the start of a flash dump read
   * from a later flash address. An app carries `esp_app_desc_t` and is not.
   */
  async #flashDump(
    image: EspImage,
    signal?: AbortSignal,
  ): Promise<EspFlashDumpOrigin | undefined> {
    const chip = espChipForId(image.metadata.header.chip_id);
    if (
      chip === undefined ||
      chip.romBootloaderOffset === 0 ||
      image.metadata.descriptor?.kind === "app"
    )
      return undefined;
    const { handle, initial } = await this.#source.read(signal);
    const context = { handle, fileSize: initial.size, signal };
    return espFlashDumpOrigin(
      (position, length) => readEspFlashRange(context, position, length),
      initial.size,
      // A truncated image has no end, so no table can follow it.
      { chip, fileOffset: 0, end: image.metadata.image_end ?? initial.size },
    );
  }

  /** Stream the carrier once, stopping when later bytes cannot matter. */
  async #decode(signal?: AbortSignal): Promise<EspImage> {
    const { handle, initial } = await this.#source.read(signal);
    const decoder = createEspImageDecoder(initial.size);
    if (initial.size > 0)
      for await (const chunk of readFileHandleChunks(handle, {
        end: initial.size - 1,
        signal,
        cancellationFailure: (reason) =>
          new ArtifactReaderFailure("cancelled", `${LABEL} read cancelled`, {
            cause: reason,
          }),
      }) as AsyncIterable<Buffer>) {
        this.#assertOpen(signal);
        decoder.write(chunk);
        if (decoder.satisfied) break;
      }
    // A changed carrier is an identity failure, not a malformed image.
    await this.#source.read(signal);
    const image = decoder.finish();
    if (!image.ok) throw decodeFailure(image.error);
    return image.value;
  }

  #entryStream(entry: EspImageEntry, signal?: AbortSignal): Transform {
    let bytes = 0;
    const check = async (): Promise<void> => {
      if (bytes !== entry.declaredSize)
        throw new ArtifactReaderFailure(
          "integrity",
          `${LABEL} entry ended early: ${entry.path}`,
        );
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
                : new Error(`${LABEL} read failed`, { cause }),
            ),
        );
      },
    });
  }
}

const flashDumpLimitation = (
  image: EspImage,
  dump: EspFlashDumpOrigin,
): string =>
  `This file looks like a flash dump read from flash ${offsetText(dump.flashOffset)}, not one ESP image: its ${image.metadata.chip?.target ?? "ESP"} image at file offset 0 is where the ROM loads the bootloader from ${offsetText(dump.flashOffset)}, and a partition table sits at file offset ${offsetText(dump.tableFileOffset)}, which is flash 0x8000 from that origin. Reopen it with format esp-flash-image and flash_offset ${offsetText(dump.flashOffset)}.`;

const decodeFailure = (failure: EspImageFailure): ArtifactReaderFailure =>
  failure.kind === "unsupported"
    ? new ArtifactReaderFailure("unavailable", failure.message)
    : new ArtifactReaderFailure(
        "format",
        `${LABEL} is malformed: ${failure.message}`,
      );
