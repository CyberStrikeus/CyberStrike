import { assertArtifactReadActive } from "./ArtifactFileOperation.js";
import type { FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";

import type { ArtifactCommand } from "../domain/artifactGraph.js";
import {
  XcrunCommandRunner,
  type NativeCommandRunner,
} from "../native/CommandRunner.js";
import {
  parseLipoOutputResult,
  LipoFieldRetentionError,
  type LipoArchitecture,
} from "../native/parsers/lipo.js";
import type { MachoSlice } from "../domain/apple/dylibResolution.js";
import {
  machoArchitectureFamily,
  machoCpuSubtypeBase,
} from "../domain/apple/machoCpuIdentity.js";
import { readMachoImage, type ReadAt } from "./apple/MachoLoadCommandReader.js";
import {
  ArtifactReaderFailure,
  copyArtifactEntry,
  sameArtifactEntry,
  type ArtifactEntry,
  type ArtifactReader,
} from "./ArtifactReader.js";
import { streamChunkToBuffer } from "./StreamBytes.js";
import type { StableRegularFileDescriptor } from "../filesystem/RegularFile.js";
import { readArtifactFileChunks } from "./readArtifactFileChunks.js";
import { ArtifactFileSource } from "./ArtifactFileSource.js";
import { readFileHandleRange } from "../filesystem/readFileHandleRange.js";

/** Read-only universal Mach-O slice reader backed by native lipo metadata. */
export class MachOSliceArtifactReader implements ArtifactReader {
  readonly format = "file" as const;
  #command: ArtifactCommand | undefined;
  readonly #source: ArtifactFileSource;
  readonly #entries = new Map<string, ArtifactEntry>();
  readonly #enumerations = new Set<AsyncGenerator<ArtifactEntry, void>>();
  readonly #pendingOpens = new Set<Promise<Readable>>();
  readonly #streams = new Map<
    Readable,
    { readonly source: Readable; readonly completion: Promise<unknown> }
  >();
  #closed = false;
  #closePromise: Promise<void> | undefined;

  constructor(
    private readonly path: string,
    environment: Readonly<NodeJS.ProcessEnv>,
    private readonly runner: NativeCommandRunner = new XcrunCommandRunner(
      environment,
    ),
    source?: StableRegularFileDescriptor,
  ) {
    this.#source = new ArtifactFileSource(path, "Universal Mach-O", source);
  }

  async *entries(signal?: AbortSignal): AsyncIterable<ArtifactEntry> {
    const enumeration = this.#readEntries(signal);
    this.#enumerations.add(enumeration);
    try {
      yield* enumeration;
    } finally {
      this.#enumerations.delete(enumeration);
    }
  }

  async *#readEntries(
    signal?: AbortSignal,
  ): AsyncGenerator<ArtifactEntry, void> {
    this.#entries.clear();
    const source = await this.#ensureSource();
    await this.#source.readSelectedPath();
    if (this.#closed)
      throw new ArtifactReaderFailure(
        "unavailable",
        "Universal Mach-O reader is closed",
      );
    const command = this.runner.run(
      "lipo",
      ["-detailed_info", this.path],
      signal === undefined ? {} : { signal },
    );
    const captured = await command;
    if (!captured.ok)
      throw new ArtifactReaderFailure(
        captured.error.reason === "cancelled" ? "cancelled" : "unavailable",
        captured.error.detail === null
          ? "lipo could not enumerate universal Mach-O slices"
          : `lipo could not enumerate universal Mach-O slices: ${captured.error.detail}`,
        {
          cause: captured.error,
          ...(captured.error.cleanupFailure === null &&
          captured.error.cleanupResources.length === 0
            ? {}
            : {
                cleanup: {
                  reason:
                    captured.error.cleanupFailure ??
                    "Native command cleanup remains unverified",
                  resources: [...captured.error.cleanupResources],
                },
              }),
        },
      );
    if (this.#closed)
      throw new ArtifactReaderFailure(
        "unavailable",
        "Universal Mach-O reader closed during slice discovery",
      );
    this.#command = {
      tool: captured.value.tool,
      arguments: ["-detailed_info", "$ARTIFACT"],
      tool_version: captured.value.toolVersion,
      executable_sha256: captured.value.executableSha256,
      exit_code: captured.value.exitCode,
      effects: ["read"],
    };
    await this.#source.readSelectedPath();
    const fileSize = source.initial.size;
    const parsed = parseLipoOutputResult(captured.value.stdout, this.path);
    if (!parsed.ok)
      throw new ArtifactReaderFailure(
        parsed.error instanceof LipoFieldRetentionError ? "limit" : "format",
        `lipo did not produce readable architecture records: ${parsed.error.message}`,
        {
          cause: parsed.error,
          ...(parsed.error instanceof LipoFieldRetentionError
            ? { boundary: "memory" as const }
            : {}),
        },
      );
    const lipo = parsed.value;
    const { architectures } = lipo;
    const structural = await readStructuralSlices(
      source.handle,
      fileSize,
      signal,
    );
    await this.#source.readSelectedPath();
    if (this.#closed)
      throw new ArtifactReaderFailure(
        "unavailable",
        "Universal Mach-O reader is closed",
      );
    if (structural.status === "malformed")
      throw new ArtifactReaderFailure(
        "integrity",
        `Mach-O structural slice index is malformed: ${structural.reason}`,
      );
    // A valid universal binary can hold slices REA cannot index, such as
    // big-endian PowerPC. lipo's own ranges still inventory every slice.
    if (
      structural.status === "unsupported" &&
      architectures.some(
        ({ file_offset, size }) => file_offset === null || size === null,
      )
    )
      throw new ArtifactReaderFailure(
        "unavailable",
        `Mach-O structural slice index is unsupported: ${structural.reason}`,
      );
    const hiddenArchitectures = architectures.filter(({ hidden }) => hidden);
    const visibleArchitectures = architectures.filter(({ hidden }) => !hidden);
    if (
      lipo.hiddenArchitectureCount !== null &&
      lipo.hiddenArchitectureCount !== hiddenArchitectures.length
    )
      throw new ArtifactReaderFailure(
        "integrity",
        "lipo hidden architecture count disagrees with its architecture rows",
      );
    if (
      lipo.declaredArchitectureCount !== null &&
      lipo.declaredArchitectureCount !== visibleArchitectures.length
    )
      throw new ArtifactReaderFailure(
        "integrity",
        "lipo declared architecture count disagrees with its visible rows",
      );
    if (
      (hiddenArchitectures.length > 0 ||
        (lipo.hiddenArchitectureCount ?? 0) > 0) &&
      structural.status !== "parsed"
    )
      throw new ArtifactReaderFailure(
        "unavailable",
        "Apple hidden ARM64 slice could not be verified against the FAT table",
      );
    const slices = structural.status === "parsed" ? structural.slices : null;
    const hiddenSlices =
      structural.status === "parsed" ? (structural.hiddenSlices ?? []) : [];
    const matchingSlices = new Map<LipoArchitecture, MachoSlice>();
    if (slices !== null) {
      if (
        slices.length !== visibleArchitectures.length ||
        hiddenSlices.length !== hiddenArchitectures.length ||
        (hiddenArchitectures.length > 0 &&
          (lipo.declaredArchitectureCount === null ||
            lipo.hiddenArchitectureCount === null)) ||
        (lipo.declaredArchitectureCount !== null &&
          lipo.declaredArchitectureCount !== slices.length) ||
        (lipo.hiddenArchitectureCount !== null &&
          lipo.hiddenArchitectureCount !== hiddenSlices.length)
      )
        throw new ArtifactReaderFailure(
          "integrity",
          "lipo declared and hidden architecture counts disagree with the Mach-O FAT table",
        );
      for (const [reportedRows, observedRows] of [
        [visibleArchitectures, slices],
        [hiddenArchitectures, hiddenSlices],
      ] as const) {
        const unmatched = [...observedRows];
        for (const reported of reportedRows) {
          const match = unmatched.findIndex((observed) =>
            lipoMatchesSlice(reported, observed, observedRows.length === 1),
          );
          if (match < 0)
            throw new ArtifactReaderFailure(
              "integrity",
              `lipo slice metadata disagrees with the Mach-O FAT table: ${reported.name} (cputype=${reported.cpu_type ?? "unknown"}, cpusubtype=${reported.cpu_subtype ?? "unknown"}, offset=${reported.file_offset ?? "unknown"}, size=${reported.size ?? "unknown"}, alignment=${reported.alignment ?? "unknown"})`,
            );
          const [observed] = unmatched.splice(match, 1);
          if (observed !== undefined) matchingSlices.set(reported, observed);
        }
      }
    }
    for (const architecture of architectures) {
      const structuralSlice = matchingSlices.get(architecture);
      const offset = architecture.file_offset ?? structuralSlice?.slice_offset;
      const sliceSize = architecture.size ?? structuralSlice?.slice_size;
      if (offset === undefined || sliceSize === undefined)
        throw new ArtifactReaderFailure(
          "integrity",
          "lipo omitted a universal slice byte range",
        );
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(sliceSize) ||
        offset < 0 ||
        sliceSize <= 0 ||
        !Number.isSafeInteger(offset + sliceSize) ||
        offset + sliceSize > fileSize
      )
        throw new ArtifactReaderFailure(
          "integrity",
          `lipo reported an out-of-bounds Mach-O slice: ${architecture.name}`,
        );
      const entry: ArtifactEntry = {
        path: `slices/${architecture.name}`,
        kind: "slice",
        declaredSize: sliceSize,
        compressedSize: null,
        executable: true,
        encrypted: false,
        byteOffset: offset,
        declaredIntegrity: null,
        unpacked: false,
        limitations: [
          ...architecture.limitations,
          ...(structural.status === "not-mach-o"
            ? [
                "Structural Mach-O facts were unavailable; slice range is based on lipo output.",
              ]
            : structural.status === "unsupported"
              ? [
                  `Structural Mach-O facts were unsupported (${structural.reason}); slice range is based on lipo output.`,
                ]
              : []),
          ...(architecture.file_offset === null || architecture.size === null
            ? [
                architecture.fields.offset.kind === "uninterpretable" ||
                architecture.fields.size.kind === "uninterpretable"
                  ? "Slice range was derived from structural Mach-O facts because lipo's range declarations could not all be interpreted."
                  : "Slice range was derived from structural Mach-O facts because lipo omitted it.",
              ]
            : []),
          ...(architecture.cpu_type !== null &&
          architecture.cpu_type_code === null
            ? [
                `lipo CPU type is retained as unnormalized source text: ${architecture.cpu_type}`,
              ]
            : []),
          ...(architecture.cpu_subtype !== null &&
          architecture.cpu_subtype_code === null
            ? [
                `lipo CPU subtype is retained as unnormalized source text: ${architecture.cpu_subtype}${architecture.capabilities === null ? "" : `; capabilities ${architecture.capabilities}`}`,
              ]
            : []),
        ],
        adapterKey: `${String(offset)}:${String(sliceSize)}`,
      };
      this.#entries.set(entry.adapterKey, copyArtifactEntry(entry));
      yield entry;
    }
  }

  open(entry: ArtifactEntry, signal?: AbortSignal): Promise<Readable> {
    const operation = this.#open(entry, signal);
    this.#pendingOpens.add(operation);
    const release = () => this.#pendingOpens.delete(operation);
    void operation.then(release, release);
    return operation;
  }

  async #open(entry: ArtifactEntry, signal?: AbortSignal): Promise<Readable> {
    if (signal?.aborted === true)
      return Promise.reject(
        new ArtifactReaderFailure("cancelled", "Mach-O slice read cancelled", {
          cause: signal.reason,
        }),
      );
    const produced = this.#entries.get(entry.adapterKey);
    if (produced === undefined || !sameArtifactEntry(entry, produced))
      throw new ArtifactReaderFailure(
        "integrity",
        "Mach-O slice entry metadata does not match this reader's inventory",
      );
    const offset = produced.byteOffset;
    const size = produced.declaredSize;
    if (
      offset === null ||
      size === null ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(size) ||
      offset < 0 ||
      size <= 0
    )
      throw new ArtifactReaderFailure(
        "integrity",
        "Invalid Mach-O slice byte range",
      );
    const source = await this.#ensureSource();
    await this.#source.readSelectedPath();
    if (this.#closed)
      throw new ArtifactReaderFailure(
        "unavailable",
        "Universal Mach-O reader is closed",
      );
    if (
      !Number.isSafeInteger(offset + size) ||
      offset + size > source.initial.size
    )
      throw new ArtifactReaderFailure(
        "integrity",
        `Mach-O slice range is outside the artifact: ${entry.path}`,
      );
    const sourceStream = readArtifactFileChunks(source.handle, {
      start: offset,
      end: offset + size - 1,
      ...(signal === undefined ? {} : { signal }),
    });
    const verifySource = () => this.#source.readSelectedPath();
    let validatingSource = false;
    const completionFailure = (): ArtifactReaderFailure | undefined => {
      const coverage = sourceStream.readCoverage();
      if (coverage.kind !== "complete")
        return new ArtifactReaderFailure(
          "integrity",
          `Mach-O slice read coverage is incomplete: ${entry.path}`,
        );
      if (coverage.bytes !== BigInt(size))
        return new ArtifactReaderFailure(
          "integrity",
          `Mach-O slice size disagrees with lipo metadata: ${entry.path}`,
        );
      if (signal?.aborted)
        return new ArtifactReaderFailure(
          "cancelled",
          "Mach-O slice read cancelled",
          { cause: signal.reason },
        );
      return undefined;
    };
    const output = Readable.from(
      (async function* () {
        try {
          for await (const raw of sourceStream) {
            const chunk = streamChunkToBuffer(raw);
            if (
              sourceStream.readCoverage().kind === "complete" &&
              signal?.aborted
            ) {
              const failure = completionFailure();
              if (failure !== undefined) throw failure;
            }
            yield chunk;
          }
        } catch (cause: unknown) {
          if (cause instanceof ArtifactReaderFailure) throw cause;
          throw new ArtifactReaderFailure(
            "integrity",
            `Could not read Mach-O slice range: ${entry.path}`,
            { cause },
          );
        }
        validatingSource = true;
        const failure = completionFailure();
        if (failure !== undefined) throw failure;
        try {
          await verifySource();
          assertArtifactReadActive(signal);
        } finally {
          validatingSource = false;
        }
      })(),
    );
    output.on("error", () => undefined);
    const completion = Promise.all(
      [sourceStream, output].map(
        (stream) =>
          new Promise<void>((resolve) => stream.once("close", resolve)),
      ),
    );
    this.#streams.set(output, { source: sourceStream, completion });
    void completion.then(() => this.#streams.delete(output));
    const onSourceError = (cause: unknown): void => {
      const completedCancellation =
        cause instanceof ArtifactReaderFailure &&
        cause.reason === "cancelled" &&
        sourceStream.readCoverage().kind === "complete" &&
        !validatingSource
          ? completionFailure()
          : undefined;
      output.destroy(
        completedCancellation ??
          (cause instanceof ArtifactReaderFailure
            ? cause
            : new ArtifactReaderFailure(
                "integrity",
                `Could not read Mach-O slice range: ${entry.path}`,
                { cause },
              )),
      );
    };
    sourceStream.on("error", onSourceError);
    sourceStream.once("close", () =>
      sourceStream.removeListener("error", onSourceError),
    );
    const onAbort = (): void => {
      if (
        sourceStream.readCoverage().kind === "complete" &&
        (sourceStream.errored === null ||
          (sourceStream.errored instanceof ArtifactReaderFailure &&
            sourceStream.errored.reason === "cancelled")) &&
        !validatingSource &&
        !output.destroyed
      ) {
        const failure = completionFailure();
        if (failure !== undefined) output.destroy(failure);
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    output.once("close", () => {
      signal?.removeEventListener("abort", onAbort);
      if (!sourceStream.destroyed) sourceStream.destroy();
    });
    if (signal?.aborted) onAbort();
    return output;
  }

  provenance(): readonly ArtifactCommand[] {
    return this.#command === undefined ? [] : [structuredClone(this.#command)];
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#closePromise ??= this.#releaseResources().catch((cause: unknown) => {
      this.#closePromise = undefined;
      throw cause;
    });
    return this.#closePromise;
  }

  async #releaseResources(): Promise<void> {
    for (const [output, { source }] of this.#streams) {
      output.destroy(
        new ArtifactReaderFailure(
          "unavailable",
          "Universal Mach-O reader closed",
        ),
      );
      source.destroy();
    }
    const outcomes = await Promise.allSettled([
      // Failed opens remain their caller's primary result, not a cleanup error.
      Promise.allSettled(this.#pendingOpens),
      ...Array.from(this.#enumerations, (enumeration) => enumeration.return()),
      ...Array.from(this.#streams.values(), ({ completion }) => completion),
    ]);
    this.#enumerations.clear();
    const failures = outcomes.flatMap((outcome) =>
      outcome.status === "rejected" ? [outcome.reason as unknown] : [],
    );
    let cleanup: ArtifactReaderFailure["cleanup"];
    try {
      const failures = (await this.runner.retryCleanup?.()) ?? [];
      if (failures.length > 0)
        cleanup = {
          reason: failures
            .map(
              ({ reason, resources }) => `${resources.join(", ")}: ${reason}`,
            )
            .join("; "),
          resources: [
            ...new Set(failures.flatMap(({ resources }) => resources)),
          ],
        };
    } catch (cause: unknown) {
      cleanup = ArtifactReaderFailure.cleanupObservation(
        cause,
        "native-command-process-cleanup",
      );
    }
    for (const cause of failures)
      cleanup = {
        reason: [
          cleanup?.reason,
          ArtifactReaderFailure.cleanupObservation(cause, this.path).reason,
        ]
          .filter((reason) => reason !== undefined)
          .join("; "),
        resources: [...new Set([...(cleanup?.resources ?? []), this.path])],
      };
    try {
      await this.#source.close();
    } catch (cause: unknown) {
      if (cleanup === undefined) throw cause;
      throw ArtifactReaderFailure.withCleanup(cause, cleanup);
    }
    if (cleanup !== undefined)
      throw new ArtifactReaderFailure(
        "unavailable",
        "Universal Mach-O reader cleanup remains incomplete",
        { cleanup },
      );
  }

  async #ensureSource(): Promise<StableRegularFileDescriptor> {
    if (this.#closed)
      throw new ArtifactReaderFailure(
        "unavailable",
        "Universal Mach-O reader is closed",
      );
    const source = await this.#source.read();
    if (this.#closed)
      throw new ArtifactReaderFailure(
        "unavailable",
        "Universal Mach-O reader closed during source acquisition",
      );
    return source;
  }
}

/** Compare lipo's independent ranges with structurally parsed slice identity. */
const readStructuralSlices = async (
  file: FileHandle,
  size: number,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<typeof readMachoImage>>> => {
  const readAt: ReadAt = (offset, length) =>
    readFileHandleRange(file, offset, length, () =>
      assertArtifactReadActive(signal),
    );
  return readMachoImage(readAt, size);
};

const lipoMatchesSlice = (
  reported: LipoArchitecture,
  observed: MachoSlice,
  structurallyUnique: boolean,
): boolean => {
  const observedCpuType = observed.fat_cpu_type ?? observed.cpu_type;
  const observedCpuSubtype = observed.fat_cpu_subtype ?? observed.cpu_subtype;
  const hasPhysicalIdentity =
    reported.file_offset !== null ||
    reported.size !== null ||
    reported.cpu_type_code !== null ||
    reported.cpu_subtype_code !== null;
  return (
    (hasPhysicalIdentity || structurallyUnique) &&
    lipoNameMatches(reported.name, observed) &&
    (reported.file_offset === null ||
      reported.file_offset === observed.slice_offset) &&
    (reported.size === null || reported.size === observed.slice_size) &&
    (reported.cpu_type_code === null ||
      reported.cpu_type_code === observedCpuType) &&
    lipoSubtypeMatches(reported, observedCpuSubtype) &&
    (reported.alignment === null ||
      observed.fat_alignment_exponent === null ||
      reported.alignment === 2 ** observed.fat_alignment_exponent)
  );
};

/**
 * Compare the complete subtype when lipo printed its capability byte, and
 * otherwise only the subtype bits its record names.
 */
const lipoSubtypeMatches = (
  reported: LipoArchitecture,
  observedCpuSubtype: number,
): boolean => {
  if (reported.cpu_subtype_code !== null)
    return reported.cpu_subtype_code === observedCpuSubtype;
  return (
    reported.cpu_subtype_base === null ||
    reported.cpu_subtype_base === machoCpuSubtypeBase(observedCpuSubtype)
  );
};

/** ARM implementation names from cctools libstuff/arch.c, keyed by lipo spelling. */
const ARM_SUBTYPES: Readonly<Record<string, number>> = {
  armv4t: 5,
  armv5: 7,
  xscale: 8,
  armv6: 6,
  armv7: 9,
  armv7f: 10,
  armv7s: 11,
  armv7k: 12,
  armv6m: 14,
  armv7m: 15,
  armv7em: 16,
  "armv8m.main": 17,
  "armv8m.base": 18,
  "armv8.1m.main": 19,
};

/** Reconcile lipo's specific name with the structural reader's CPU family. */
const lipoNameMatches = (reported: string, observed: MachoSlice): boolean => {
  if (reported === observed.architecture) return true;
  if (observed.cpu_type === 12 && observed.architecture === "arm")
    return (
      ARM_SUBTYPES[reported] ===
      machoCpuSubtypeBase(observed.fat_cpu_subtype ?? observed.cpu_subtype)
    );
  if (reported === machoArchitectureFamily(observed.architecture)) return true;
  // Retain lipo's capability-variant spelling; physical identity is checked separately.
  return (
    machoArchitectureFamily(observed.architecture) === "arm64e" &&
    /^arm64e\.[A-Za-z0-9_]+$/u.test(reported)
  );
};
