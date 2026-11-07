import { Readable, Transform, pipeline } from "node:stream";
import { setImmediate } from "node:timers/promises";

import type { FitMetadata } from "../domain/artifactFormatMetadata.js";
import { MAX_DEVICETREE_FILE_BYTES } from "../domain/firmware/devicetree.js";
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
import {
  createFitDigest,
  readFitStructure,
  type FitImageDeclaration,
} from "./fit/FitStructure.js";
import { readFileHandleChunks } from "../filesystem/readFileHandleChunks.js";
import { readFileHandleRange } from "../filesystem/readFileHandleRange.js";
import type { StableRegularFileDescriptor } from "../filesystem/RegularFile.js";

const FDT_HEADER_BYTES = 40;

/** Inventory U-Boot FIT /images nodes as stored byte ranges without loading them. */
export class FitArtifactReader implements ArtifactReader {
  readonly format = "fit" as const;
  readonly #scope = new ArtifactResourceScope();
  readonly #entries = new Map<string, ArtifactEntry>();
  readonly #streams = new Set<Readable>();
  readonly #path: string;
  readonly #source: ArtifactFileSource;
  #prepared: Promise<void> | undefined;
  #metadata: FitMetadata | undefined;
  #coverage: ArtifactReaderTraversal | undefined;
  #closing = false;

  constructor(path: string, admitted?: StableRegularFileDescriptor) {
    this.#path = path;
    this.#source = new ArtifactFileSource(path, "FIT", admitted);
  }

  formatMetadata(): FitMetadata | undefined {
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
    if (this.#coverage !== undefined)
      options?.onCoverage?.({
        ...this.#coverage,
        limitations: [...this.#coverage.limitations],
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
          "FIT entry does not match its owning inventory",
        );
      const { handle } = await this.#source.read(signal);
      this.#assertOpen(signal);
      if (stored.byteOffset === null || stored.declaredSize === null)
        throw new ArtifactReaderFailure(
          "format",
          `FIT image has no byte range: ${stored.path}`,
        );
      const source =
        stored.declaredSize === 0
          ? Readable.from([])
          : readFileHandleChunks(handle, {
              start: stored.byteOffset,
              end: stored.byteOffset + stored.declaredSize - 1,
              signal,
              cancellationFailure,
            });
      const output = this.#imageStream(stored, signal);
      output.on("error", () => undefined);
      this.#streams.add(output);
      let producerComplete = false;
      const onAbort = (): void => {
        // Active I/O and final validation own failure precedence. Buffered
        // readable bytes still belong to the caller after they finish.
        if (!producerComplete || output.destroyed) return;
        output.destroy(cancellationFailure(signal?.reason));
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
          // Retain both producer work and the unconsumed readable stream.
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
              : new Error("FIT stream ownership failed", { cause }),
          ),
        );
      return output;
    });
  }

  async close(): Promise<void> {
    this.#closing = true;
    for (const stream of this.#streams)
      stream.destroy(
        new ArtifactReaderFailure("unavailable", "FIT reader closed"),
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
      throw new ArtifactReaderFailure("unavailable", "FIT reader is closed");
  }

  async #prepare(signal?: AbortSignal): Promise<void> {
    const { handle, initial } = await this.#source.read(signal);
    const assertActive = (): void => this.#assertOpen(signal);
    const header = await readFileHandleRange(
      handle,
      0,
      FDT_HEADER_BYTES,
      assertActive,
    );
    if (header.length < FDT_HEADER_BYTES)
      throw new ArtifactReaderFailure(
        "format",
        "FIT devicetree header is truncated",
      );
    const totalsize = header.readUInt32BE(4);
    if (totalsize > initial.size)
      throw new ArtifactReaderFailure(
        "format",
        `FIT devicetree is truncated: totalsize ${String(totalsize)} exceeds the ${String(initial.size)}-byte file`,
      );
    if (totalsize > MAX_DEVICETREE_FILE_BYTES)
      throw new ArtifactReaderFailure(
        "limit",
        `FIT devicetree is ${String(totalsize)} bytes, above the fixed 16 MiB devicetree allowance; embedded image data this large is not supported (mkimage -E stores data externally). No runtime override.`,
        { boundary: "memory" },
      );
    // Only the devicetree is read; external image data stays on disk.
    const structure = readFitStructure(
      await readFileHandleRange(handle, 0, totalsize, assertActive),
      this.#path,
      initial.size,
    );
    let index = 0;
    for (const image of structure.images) {
      if (index % 256 === 0) await setImmediate();
      index += 1;
      this.#assertOpen(signal);
      await this.#verifyHashes(image, signal);
      const entry = {
        path: `images/${image.name}.bin`,
        sourcePath: `/images/${image.name}`,
        kind: "file" as const,
        declaredSize: image.size,
        compressedSize: null,
        executable: false,
        encrypted: false,
        byteOffset: image.start,
        declaredIntegrity: null,
        unpacked: false,
        limitations: image.limitations,
        adapterKey: `fit:${String(image.index)}`,
        formatMetadata: image.metadata,
      } satisfies ArtifactEntry;
      this.#entries.set(entry.adapterKey, entry);
    }
    this.#metadata = structure.metadata;
    if (structure.limitations.length > 0)
      this.#coverage = {
        status: "complete",
        limitations: structure.limitations,
      };
    await this.#source.read(signal);
  }

  /** One streamed pass per image feeds every supported digest. */
  async #verifyHashes(
    image: FitImageDeclaration,
    signal?: AbortSignal,
  ): Promise<void> {
    const digests = image.hashes.flatMap((hash) => {
      const digest = createFitDigest(hash.algo);
      return digest === undefined ? [] : [{ hash, digest }];
    });
    if (digests.length === 0) return;
    const { handle } = await this.#source.read(signal);
    if (image.size > 0)
      for await (const chunk of readFileHandleChunks(handle, {
        start: image.start,
        end: image.start + image.size - 1,
        signal,
        cancellationFailure,
      }) as AsyncIterable<Buffer>) {
        this.#assertOpen(signal);
        for (const { digest } of digests) digest.update(chunk);
      }
    for (const { hash, digest } of digests) {
      const computed = digest.digest();
      if (!computed.equals(hash.value))
        throw new ArtifactReaderFailure(
          "integrity",
          `FIT image ${image.name} ${hash.node} ${hash.algo} does not match: declared ${hash.value.toString("hex")}, computed ${computed.toString("hex")}`,
        );
    }
  }

  #imageStream(entry: ArtifactEntry, signal?: AbortSignal): Transform {
    let bytes = 0;
    const check = async (): Promise<void> => {
      if (bytes !== entry.declaredSize)
        throw new ArtifactReaderFailure(
          "format",
          `FIT image ended early: ${entry.path}`,
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
                : new Error("FIT read failed", { cause }),
            ),
        );
      },
    });
  }
}

const cancellationFailure = (reason: unknown): ArtifactReaderFailure =>
  new ArtifactReaderFailure("cancelled", "FIT read cancelled", {
    cause: reason,
  });
