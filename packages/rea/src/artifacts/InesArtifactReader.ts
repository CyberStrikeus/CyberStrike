import { readFileHandlePrefix } from "../filesystem/readFileHandlePrefix.js";
import { Readable } from "node:stream";
import {
  parseInesLayout,
  type InesInventory,
  type InesLayout,
} from "../domain/inesContainer.js";
import type { ArtifactCommand } from "../domain/artifactGraph.js";
import {
  RegularFileChangedError,
  assertStableRegularFileIdentity,
  type StableRegularFileDescriptor,
} from "../filesystem/RegularFile.js";
import { readFileHandleChunks } from "../filesystem/readFileHandleChunks.js";
import type { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import {
  ArtifactReaderFailure,
  copyArtifactEntry,
  sameArtifactEntry,
  type ArtifactEntry,
  type ArtifactReader,
} from "./ArtifactReader.js";
import { abortIfNeeded } from "./ArtifactHash.js";
import { streamChunkToBuffer } from "./StreamBytes.js";

export const INES_LIMITATION =
  "Classic iNES file regions are observed; mapper execution, CPU bank mappings, CHR-RAM contents, 6502 analysis and emulator behavior are not observed. Trailing bytes are retained without interpretation. NES 2.0 and UNIF are unsupported.";

/** Actual concatenated bytes observed by the inventory's ordered region scan. */
export type InesRegionScan = Omit<InesInventory["reconstruction"], "verified">;

/** Read positional regions from a descriptor retained by the artifact resource scope. */
export class InesArtifactReader implements ArtifactReader {
  readonly format = "ines" as const;
  readonly #entries = new Map<string, ArtifactEntry>();
  #layout: InesLayout | undefined;
  #closed = false;

  constructor(
    private readonly path: string,
    private readonly source: StableRegularFileDescriptor,
    private readonly ownedSource?: OwnedFileHandle,
  ) {}

  async *entries(signal?: AbortSignal): AsyncIterable<ArtifactEntry> {
    abortIfNeeded(signal);
    await this.#verifySource(signal);
    const prefix = await readFileHandlePrefix(this.source.handle, 16, () =>
      abortIfNeeded(signal),
    );
    abortIfNeeded(signal);
    // Concurrent source changes take precedence over malformed header diagnostics.
    await this.#verifySource(signal);
    const parsed = parseInesLayout(prefix, this.source.initial.size);
    if (!parsed.ok) throw new ArtifactReaderFailure("format", parsed.error);
    this.#layout = parsed.value;
    this.#entries.clear();
    for (const region of parsed.value.regions) {
      abortIfNeeded(signal);
      const entry: ArtifactEntry = {
        path: region.path,
        kind: "file",
        declaredSize: region.length,
        compressedSize: null,
        executable: false,
        encrypted: false,
        byteOffset: region.offset,
        declaredIntegrity: null,
        unpacked: false,
        limitations: [],
        adapterKey: region.path,
      };
      this.#entries.set(entry.adapterKey, copyArtifactEntry(entry));
      yield entry;
    }
  }

  async open(entry: ArtifactEntry, signal?: AbortSignal): Promise<Readable> {
    abortIfNeeded(signal);
    const produced = this.#entries.get(entry.adapterKey);
    if (produced === undefined || !sameArtifactEntry(entry, produced))
      throw new ArtifactReaderFailure(
        "integrity",
        "iNES region does not match this reader's inventory",
      );
    await this.#verifySource(signal);
    const offset = produced.byteOffset;
    const size = produced.declaredSize;
    if (offset === null || size === null || size <= 0)
      throw new ArtifactReaderFailure("integrity", "Invalid iNES region range");
    const stream = readFileHandleChunks(this.source.handle, {
      start: offset,
      end: offset + size - 1,
      signal,
    });
    const verify = () => this.#verifySource(signal);
    return Readable.from(
      (async function* () {
        let bytes = 0;
        try {
          for await (const raw of stream) {
            abortIfNeeded(signal);
            const chunk = streamChunkToBuffer(raw);
            bytes += chunk.length;
            yield chunk;
          }
          if (bytes !== size)
            throw new ArtifactReaderFailure(
              "integrity",
              "Truncated iNES region",
            );
          await verify();
        } catch (cause: unknown) {
          abortIfNeeded(signal);
          if (cause instanceof ArtifactReaderFailure) throw cause;
          throw new ArtifactReaderFailure("io", "Could not read iNES region", {
            cause,
          });
        }
      })(),
      { objectMode: false },
    );
  }

  /** Validate the completed region scan without rereading its payload. */
  async verifyReconstruction(
    expectedSha256: string,
    observed: InesRegionScan,
    signal?: AbortSignal,
  ): Promise<InesInventory> {
    abortIfNeeded(signal);
    const layout = this.#layout;
    if (layout === undefined || this.#entries.size !== layout.regions.length)
      throw new ArtifactReaderFailure("integrity", "Incomplete iNES inventory");
    await this.#verifySource(signal);
    if (
      observed.region_order.length !== layout.regions.length ||
      layout.regions.some(
        (region, index) => observed.region_order[index] !== region.path,
      ) ||
      observed.bytes !== this.source.initial.size ||
      observed.sha256 !== expectedSha256
    )
      throw new ArtifactReaderFailure(
        "integrity",
        "iNES reconstruction differs from the source",
      );
    return {
      header: layout.header,
      reconstruction: {
        ...observed,
        verified: true,
      },
    };
  }

  provenance(): readonly ArtifactCommand[] {
    return [];
  }

  close(): Promise<void> {
    // Inventory borrows its admitting scope's descriptor. Extraction owns its
    // separately opened descriptor and retains this reader if close fails.
    this.#closed = true;
    return this.ownedSource?.close() ?? Promise.resolve();
  }

  async #verifySource(signal?: AbortSignal): Promise<void> {
    abortIfNeeded(signal);
    if (this.#closed)
      throw new ArtifactReaderFailure("unavailable", "iNES reader is closed");
    try {
      await assertStableRegularFileIdentity(
        this.source.handle,
        this.path,
        this.source.initial,
        { symlinks: "reject", ...(signal === undefined ? {} : { signal }) },
      );
    } catch (cause: unknown) {
      abortIfNeeded(signal);
      if (cause instanceof RegularFileChangedError)
        throw new ArtifactReaderFailure(
          "integrity",
          "iNES source changed during reading",
          { cause: cause.cause ?? cause },
        );
      throw cause;
    }
    // State validation is asynchronous even after the final byte was consumed.
    abortIfNeeded(signal);
  }
}
