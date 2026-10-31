import { Readable } from "node:stream";
import { setImmediate } from "node:timers/promises";

import type { ArtifactFormatMetadata } from "../domain/artifactFormatMetadata.js";
import type { ArtifactContainerIntegrityPair } from "../domain/artifactIntegrity.js";
import type { Result } from "../domain/result.js";
import type {
  RegionDecodeFailure,
  RegionDecoder,
} from "../domain/firmware/regionDecoder.js";
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

/** One extractable region: its inventory facts and the decoded bytes behind them. */
export interface DecodedRegion {
  readonly path: string;
  /** The file offset of the bytes when they are one contiguous file range. */
  readonly byteOffset: number | null;
  readonly formatMetadata: ArtifactFormatMetadata;
  readonly bytes: Uint8Array;
}

/** What one format's decoder established about the whole file. */
export interface DecodedRegions {
  readonly metadata: ArtifactFormatMetadata;
  readonly regions: readonly DecodedRegion[];
  /** Omitted when every byte was examined and no limitation applies. */
  readonly coverage?: ArtifactReaderTraversal;
  readonly containerIntegrity?: ArtifactContainerIntegrityPair;
}

/** How one firmware format turns admitted file bytes into regions. */
export interface RegionDecoding<Image> {
  readonly label: string;
  readonly keyPrefix: string;
  createDecoder(
    fileBytes: number,
  ): Result<RegionDecoder<Image>, RegionDecodeFailure>;
  describe(image: Image): DecodedRegions;
}

const addressText = (address: number): string =>
  `0x${address.toString(16).padStart(8, "0")}`;

/** The shared region file name: inclusive start and end as eight hex digits. */
export const regionFileName = (start: number, end: number): string =>
  `${addressText(start)}-${addressText(end)}.bin`;

/**
 * Decode a whole firmware file once, retain its region bytes for the reader's
 * lifetime, and serve each region as an inventory entry.
 */
export class DecodedRegionArtifactReader<Image> implements ArtifactReader {
  readonly #scope = new ArtifactResourceScope();
  readonly #entries = new Map<string, ArtifactEntry>();
  readonly #regions = new Map<string, Uint8Array>();
  readonly #streams = new Set<Readable>();
  readonly #source: ArtifactFileSource;
  readonly #decoding: RegionDecoding<Image>;
  #prepared: Promise<void> | undefined;
  /** Whole-file facts only; the region map is the sole owner of region bytes. */
  #described: Omit<DecodedRegions, "regions"> | undefined;
  #closing = false;

  constructor(
    path: string,
    readonly format: "intel-hex" | "srec" | "uf2" | "dfuse",
    decoding: RegionDecoding<Image>,
    admitted?: StableRegularFileDescriptor,
  ) {
    this.#decoding = decoding;
    this.#source = new ArtifactFileSource(path, decoding.label, admitted);
  }

  formatMetadata(): ArtifactFormatMetadata | undefined {
    const metadata = this.#described?.metadata;
    return metadata === undefined ? undefined : { ...metadata };
  }

  containerIntegrity(): ArtifactContainerIntegrityPair | undefined {
    const integrity = this.#described?.containerIntegrity;
    return integrity === undefined ? undefined : { ...integrity };
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
    const coverage = this.#described?.coverage;
    if (coverage !== undefined)
      options?.onCoverage?.({
        ...coverage,
        limitations: [...coverage.limitations],
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
      const bytes = this.#regions.get(entry.adapterKey);
      if (
        stored === undefined ||
        bytes === undefined ||
        !sameArtifactEntry(entry, stored)
      )
        throw new ArtifactReaderFailure(
          "integrity",
          `${this.#decoding.label} entry does not match its owning inventory`,
        );
      // Decoded bytes are retained, so only the carrier identity is rechecked.
      await this.#source.read(signal);
      this.#assertOpen(signal);
      const output = Readable.from(this.#regionChunks(bytes, signal), {
        objectMode: false,
      });
      const onAbort = (): void => {
        output.destroy(
          new ArtifactReaderFailure(
            "cancelled",
            `${this.#decoding.label} region read cancelled`,
            { cause: signal?.reason },
          ),
        );
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      output.once("close", () => signal?.removeEventListener("abort", onAbort));
      output.on("error", () => undefined);
      this.#streams.add(output);
      output.once("close", () => this.#streams.delete(output));
      // Draining the scope must wait for the readable side, including an
      // abandoned consumer and an in-flight asynchronous chunk producer.
      void this.#scope
        .run(
          () =>
            new Promise<void>((resolve) => {
              output.once("close", () => resolve());
            }),
        )
        .catch((cause: unknown) =>
          output.destroy(
            cause instanceof Error
              ? cause
              : new ArtifactReaderFailure(
                  "unavailable",
                  `${this.#decoding.label} stream ownership failed`,
                  { cause },
                ),
          ),
        );
      return output;
    });
  }

  async *#regionChunks(
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): AsyncIterable<Buffer> {
    // Keep cached bytes isolated from consumers without copying a whole
    // region for every open. Match descriptor reads' 64 KiB chunk size.
    for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
      await setImmediate();
      this.#assertOpen(signal);
      yield Buffer.from(bytes.subarray(offset, offset + 64 * 1024));
    }
  }

  async close(): Promise<void> {
    this.#closing = true;
    for (const stream of this.#streams)
      stream.destroy(
        new ArtifactReaderFailure(
          "unavailable",
          `${this.#decoding.label} reader closed`,
        ),
      );
    await this.#scope.close();
    await this.#source.close();
    this.#entries.clear();
    this.#regions.clear();
  }

  provenance(): readonly [] {
    return [];
  }

  #assertOpen(signal?: AbortSignal): void {
    assertArtifactReadActive(signal);
    if (this.#closing)
      throw new ArtifactReaderFailure(
        "unavailable",
        `${this.#decoding.label} reader is closed`,
      );
  }

  async #prepare(signal?: AbortSignal): Promise<void> {
    const described = this.#decoding.describe(await this.#decode(signal));
    let index = 0;
    for (const region of described.regions) {
      if (index % 256 === 0) await setImmediate();
      this.#assertOpen(signal);
      const entry = {
        path: region.path,
        kind: "file" as const,
        declaredSize: region.bytes.length,
        compressedSize: null,
        executable: false,
        encrypted: false,
        byteOffset: region.byteOffset,
        declaredIntegrity: null,
        unpacked: false,
        limitations: [],
        adapterKey: `${this.#decoding.keyPrefix}:${String(index)}`,
        formatMetadata: region.formatMetadata,
      } satisfies ArtifactEntry;
      this.#entries.set(entry.adapterKey, entry);
      this.#regions.set(entry.adapterKey, region.bytes);
      index += 1;
    }
    const { regions: _regions, ...facts } = described;
    this.#described = facts;
    await this.#source.read(signal);
  }

  async #decode(signal?: AbortSignal): Promise<Image> {
    const { handle, initial } = await this.#source.read(signal);
    const decoder = this.#decoding.createDecoder(initial.size);
    if (!decoder.ok) throw this.#failure(decoder.error);
    // Reading only the admitted extent keeps decoded bytes within the arena.
    if (initial.size > 0)
      for await (const chunk of readFileHandleChunks(handle, {
        end: initial.size - 1,
        signal,
        cancellationFailure: (reason) =>
          new ArtifactReaderFailure(
            "cancelled",
            `${this.#decoding.label} read cancelled`,
            { cause: reason },
          ),
      }) as AsyncIterable<Buffer>) {
        this.#assertOpen(signal);
        const written = decoder.value.write(chunk);
        if (!written.ok) throw this.#failure(written.error);
      }
    const image = decoder.value.finish();
    if (!image.ok) throw this.#failure(image.error);
    return image.value;
  }

  #failure(failure: RegionDecodeFailure): ArtifactReaderFailure {
    return failure.kind === "format"
      ? new ArtifactReaderFailure(
          "format",
          `${this.#decoding.label} is malformed: ${failure.message}`,
        )
      : new ArtifactReaderFailure(
          "limit",
          `${this.#decoding.label} exceeds a fixed limit: ${failure.message}`,
          failure.boundary === undefined ? {} : { boundary: failure.boundary },
        );
  }
}
