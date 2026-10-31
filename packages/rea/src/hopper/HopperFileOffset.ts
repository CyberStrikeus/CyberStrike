import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { z } from "zod";

import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { BinaryTargetError } from "../domain/configurationErrors.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import { RegularFileOperationCancelled } from "../filesystem/RegularFile.js";
import { readFileHandleChunks } from "../filesystem/readFileHandleChunks.js";
import {
  RegularFileCancelled,
  RegularFileCleanupFailure,
  withOwnedFileHandle,
} from "../filesystem/OwnedRegularFile.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { FileOffsetPartialObservation } from "../domain/native/fileOffsetPartialObservation.js";
import {
  findOverlappingFatSlices,
  readFatSliceDeclarations,
  readFatHeaderPrefix,
  readMachoHeaderPrefixFacts,
  type FatSliceDeclaration,
  validateFatSlice,
  validateFatSliceIdentity,
} from "../domain/apple/machoContainer.js";
import { err, ok, type Result } from "../domain/result.js";

const OPERATION = "address_to_file_offset";
const MAX_FAT_ARCHITECTURES = 128;
const PREFIX_BYTES = 8 + MAX_FAT_ARCHITECTURES * 32;
const observationSchema = z.strictObject({
  address: z.string().regex(/^0x[0-9a-f]+$/u),
  provider_file_offset: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  provider_source_path: z.string().nullable(),
  provider_image_header_hex: z
    .string()
    .regex(/^[a-f0-9]{24}$/u)
    .nullable(),
});
type Observation = z.infer<typeof observationSchema>;

/** Exact descriptor owner the caller retries after a rejected source close. */
export interface HopperFileOffsetOwnership {
  readonly signal?: AbortSignal;
  /** Adopt the handle whose close rejected; the caller owns later retries. */
  readonly retainFailedClose?: (owner: OwnedFileHandle) => void;
  /** Bind the typed cleanup marker to that same owner before it is returned. */
  readonly onCleanupMarker?: (marker: ProviderCleanupError) => void;
}

/** Bind native image-relative offsets to coordinates in the admitted source bytes. */
export async function mapHopperFileOffset(
  target: BinaryTarget,
  value: JsonValue,
  ownership?: HopperFileOffsetOwnership,
): Promise<Result<JsonValue, AnalysisError>> {
  const parsed = observationSchema.safeParse(value);
  if (!parsed.success)
    return err(
      new AnalysisOutputError(
        OPERATION,
        "Hopper's native file mapping observation is malformed",
      ),
    );
  const observation = parsed.data;
  const partial = (reason: string): FileOffsetPartialObservation => ({
    operation: OPERATION,
    ...observation,
    original_file_offset: { available: false, reason },
  });
  const unavailable = (reason: string) =>
    err(
      new AnalysisCapabilityUnavailableError("hopper", OPERATION, reason, {
        partialObservation: partial(reason),
      }),
    );
  if (target.kind !== "executable")
    return unavailable(
      "The selected database digest does not identify its original executable bytes. Open that executable to verify original-file coordinates; read_bytes still exposes the database's native bytes.",
    );
  const signal = ownership?.signal;
  if (signal?.aborted) return err(cancelled(partial, signal.reason));
  const publish = (marker: ProviderCleanupError): ProviderCleanupError => {
    ownership?.onCleanupMarker?.(marker);
    return marker;
  };
  const verification: OffsetVerification = {
    target,
    observation,
    partial,
    unavailable,
    publish,
    withCleanup: (primary, marker) =>
      analysisErrorWithCleanupFailure(
        primary,
        publish(marker),
        OPERATION,
      ).bindCleanupDependencies([marker]),
  };
  try {
    const captured = await snapshotFromPath(
      target.path,
      signal,
      ownership?.retainFailedClose,
    );
    return coordinatesForSnapshot(verification, captured).result;
  } catch (cause: unknown) {
    if (cause instanceof RegularFileCleanupFailure)
      return cleanupAfterSnapshot(verification, cause);
    if (cause instanceof RegularFileCancelled) {
      const captured = cause.outcome.value;
      if (!isSourceRead(captured)) throw cause;
      if (!captured.ok)
        return err(
          artifactChanged(target.path, captured.error, partial(captured.error)),
        );
      const verified = coordinatesForSnapshot(verification, captured);
      if (!verified.result.ok)
        return err(
          retainSnapshot(
            verified.result.error,
            captured.value,
            verification.observation,
          ),
        );
      return err(
        retainSnapshot(
          cancelled(partial, cause.reason),
          captured.value,
          verification.observation,
          verified.fileOffset,
        ),
      );
    }
    return err(sourceAccessFailure(target.path, cause, partial));
  }
}

async function snapshotFromPath(
  path: string,
  signal: AbortSignal | undefined,
  retainFailedClose: HopperFileOffsetOwnership["retainFailedClose"],
): Promise<Result<SourceSnapshot, string>> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  return withOwnedFileHandle(
    path,
    new OwnedFileHandle(handle),
    {
      ...(signal === undefined ? {} : { signal }),
      ...(retainFailedClose === undefined ? {} : { retainFailedClose }),
    },
    async (file) => {
      if (!(await file.stat()).isFile())
        return err(
          `Source ${path} is no longer a regular file. Restore the admitted executable or reopen a regular source.`,
        );
      return ok(await readSourceSnapshot(file, signal));
    },
  );
}

const isSourceRead = (
  value: unknown,
): value is Result<SourceSnapshot, string> =>
  typeof value === "object" &&
  value !== null &&
  "ok" in value &&
  (value.ok === true || value.ok === false);

const cancelled = (
  partial: (reason: string) => FileOffsetPartialObservation,
  cause?: unknown,
): AnalysisCancelledError =>
  new AnalysisCancelledError(OPERATION, {
    ...(cause === undefined ? {} : { cause }),
    partialObservation: partial("Source verification was cancelled"),
  });

const artifactChanged = (
  path: string,
  reason: string,
  partialObservation: FileOffsetPartialObservation,
): AnalysisArtifactChangedError =>
  new AnalysisArtifactChangedError(OPERATION, path, reason, {
    partialObservation,
  });

/** Classify a failed read. A rejected close never reaches this helper. */
const sourceAccessFailure = (
  path: string,
  cause: unknown,
  partial: (reason: string) => FileOffsetPartialObservation,
): AnalysisError => {
  if (cause instanceof RegularFileOperationCancelled)
    return cancelled(partial, cause.reason);
  const reason = `Cannot verify original source bytes: ${cause instanceof Error ? cause.message : String(cause)}`;
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? cause.code
      : undefined;
  if (code === "EACCES" || code === "EPERM")
    return new AnalysisAccessDeniedError(OPERATION, path, code, {
      cause,
      partialObservation: partial(reason),
    });
  return new BinaryTargetError(path, reason, {
    cause,
    partialObservation: partial(reason),
  });
};

const descriptorCleanup = (
  failure: RegularFileCleanupFailure<unknown>,
): ProviderCleanupError => {
  const reason =
    failure.cleanupCause instanceof Error
      ? failure.cleanupCause.message
      : String(failure.cleanupCause);
  return new ProviderCleanupError(
    "hopper",
    [failure.path],
    { reason },
    { operation: OPERATION, cause: failure },
  );
};

interface OffsetVerification {
  readonly target: BinaryTarget;
  readonly observation: Observation;
  readonly partial: (reason: string) => FileOffsetPartialObservation;
  readonly unavailable: (reason: string) => Result<JsonValue, AnalysisError>;
  readonly withCleanup: (
    primary: AnalysisError,
    marker: ProviderCleanupError,
  ) => AnalysisError;
  readonly publish: (marker: ProviderCleanupError) => ProviderCleanupError;
}

const cleanupAfterSnapshot = (
  verification: OffsetVerification,
  failure: RegularFileCleanupFailure<unknown>,
): Result<JsonValue, AnalysisError> => {
  const { target, partial, withCleanup, publish } = verification;
  const marker = descriptorCleanup(failure);
  if (failure.outcome.kind === "failed")
    return err(
      withCleanup(
        sourceAccessFailure(target.path, failure.outcome.cause, partial),
        marker,
      ),
    );
  if (!isSourceRead(failure.outcome.value)) throw failure;
  const captured = failure.outcome.value;
  if (!captured.ok)
    return err(
      withCleanup(
        artifactChanged(target.path, captured.error, partial(captured.error)),
        marker,
      ),
    );
  const verified = coordinatesForSnapshot(verification, captured);
  if (!verified.result.ok)
    return err(
      withCleanup(
        retainSnapshot(
          verified.result.error,
          captured.value,
          verification.observation,
        ),
        marker,
      ),
    );
  if (failure.completionCancellation !== undefined)
    return err(
      withCleanup(
        retainSnapshot(
          cancelled(partial, failure.completionCancellation.reason),
          captured.value,
          verification.observation,
          verified.fileOffset,
        ),
        marker,
      ),
    );
  const published = retainSnapshot(
    publish(marker),
    captured.value,
    verification.observation,
    verified.fileOffset,
  );
  return err(published);
};

const retainSnapshot = <Failure extends AnalysisError>(
  failure: Failure,
  snapshot: SourceSnapshot,
  observation: Observation,
  fileOffset?: number,
): Failure => {
  if (fileOffset !== undefined)
    failure.partialObservation = {
      operation: OPERATION,
      ...observation,
      original_file_offset: {
        available: true,
        file_offset: fileOffset,
        source_sha256: snapshot.sha256,
      },
    };
  return failure.retainDiagnostics({
    source_sha256: snapshot.sha256,
    ...(fileOffset === undefined
      ? {}
      : { file_offset: fileOffset, source_identity: "verified" }),
  });
};

const coordinatesForSnapshot = (
  verification: OffsetVerification,
  captured: Result<SourceSnapshot, string>,
): {
  readonly result: Result<JsonValue, AnalysisError>;
  readonly fileOffset?: number;
} => {
  const { target, observation, partial, unavailable } = verification;
  if (!captured.ok)
    return {
      result: err(
        artifactChanged(target.path, captured.error, partial(captured.error)),
      ),
    };
  const snapshot = captured.value;
  if (snapshot.sha256 !== target.sha256) {
    const reason = `Source ${target.path} differs from the admitted artifact: expected SHA-256 ${target.sha256}, observed ${snapshot.sha256}. Reopen the changed source for a new analysis identity.`;
    return {
      result: err(artifactChanged(target.path, reason, partial(reason))),
    };
  }
  const mapped = originalOffset(snapshot, observation);
  if (!mapped.ok) return { result: unavailable(mapped.error) };
  const fileOffset = mapped.value + observation.provider_file_offset;
  return {
    fileOffset,
    result: ok({
      address: observation.address,
      file_offset: fileOffset,
      provider_file_offset: observation.provider_file_offset,
      image_base_file_offset: mapped.value,
      source_path: target.path,
    }),
  };
};

interface FatLayout {
  readonly slices: readonly FatSliceDeclaration[];
  readonly tableEnd: number;
}

function fatLayout(prefix: Buffer): Result<FatLayout | null, string> {
  const header = readFatHeaderPrefix(prefix);
  if (header.state === "unknown" || header.state === "not-fat") return ok(null);
  if (header.state === "incomplete")
    return err("The original FAT header is truncated");
  const { littleEndian, wide, count, tableEnd } = header;
  if (count === 0 || count > MAX_FAT_ARCHITECTURES)
    return err("FAT architecture count is outside the supported 1..128 range");
  const table = prefix.subarray(8, tableEnd);
  const parsed = readFatSliceDeclarations(table, { count, wide, littleEndian });
  if (parsed.status !== "parsed") return err(parsed.reason);
  for (const slice of parsed.slices)
    if (slice.reserved !== null && slice.reserved !== 0)
      return err(
        `FAT64 architecture ${slice.index} has a nonzero reserved field`,
      );
  return ok({ slices: parsed.slices, tableEnd });
}

async function readSourceSnapshot(file: FileHandle, signal?: AbortSignal) {
  const prefix = Buffer.alloc(PREFIX_BYTES);
  const hash = createHash("sha256");
  let size = 0;
  let layout: Result<FatLayout | null, string> | undefined;
  const headers = new Map<number, Buffer>();
  const capture = (bytes: Buffer, position: number) => {
    if (layout?.ok !== true || layout.value === null) return;
    for (const slice of layout.value.slices) {
      const start = Math.max(position, slice.offset);
      const end = Math.min(position + bytes.length, slice.offset + 12);
      if (end <= start) continue;
      let header = headers.get(slice.index);
      if (header === undefined) {
        header = Buffer.alloc(12);
        headers.set(slice.index, header);
      }
      bytes.copy(
        header,
        start - slice.offset,
        start - position,
        end - position,
      );
    }
  };
  for await (const chunk of readFileHandleChunks(file, {
    signal,
    cancellationFailure: (reason) => new RegularFileOperationCancelled(reason),
  })) {
    const bytes = Buffer.from(chunk);
    hash.update(bytes);
    if (size < prefix.length)
      bytes.copy(prefix, size, 0, Math.min(bytes.length, prefix.length - size));
    if (layout === undefined && size + bytes.length >= prefix.length) {
      layout = fatLayout(prefix);
      capture(prefix, 0);
    }
    capture(bytes, size);
    size += bytes.length;
  }
  if (layout === undefined) {
    layout = fatLayout(prefix.subarray(0, size));
    capture(prefix.subarray(0, size), 0);
  }
  return { layout, headers, size, sha256: hash.digest("hex") };
}

type SourceSnapshot = Awaited<ReturnType<typeof readSourceSnapshot>>;

function originalOffset(
  snapshot: SourceSnapshot,
  observation: Observation,
): Result<number, string> {
  const { layout, size, headers } = snapshot;
  if (!layout.ok) return layout;
  if (layout.value === null)
    return observation.provider_file_offset < size
      ? ok(0)
      : err("Provider mapping lies outside the admitted executable bytes");
  const header =
    observation.provider_image_header_hex === null
      ? null
      : Buffer.from(observation.provider_image_header_hex, "hex");
  const loadedIdentity =
    header === null ? null : readMachoHeaderPrefixFacts(header).identity;
  if (header === null || loadedIdentity === null)
    return err(
      "Hopper did not expose the loaded Mach-O header needed to identify its FAT slice",
    );
  const matches = [];
  if (findOverlappingFatSlices(layout.value.slices) !== null)
    return err("Original FAT slices overlap");
  for (const slice of layout.value.slices) {
    const reason = validateFatSlice(slice, size, layout.value.tableEnd);
    if (reason !== null) return err(reason);
    const embedded = headers.get(slice.index);
    if (slice.size < 12 || embedded === undefined)
      return err(
        `FAT architecture ${slice.index} has a truncated Mach-O header`,
      );
    const embeddedIdentity = readMachoHeaderPrefixFacts(embedded).identity;
    if (embeddedIdentity === null)
      return err(
        `FAT architecture ${slice.index} does not contain a Mach-O image`,
      );
    const identityError = validateFatSliceIdentity(slice, embeddedIdentity);
    if (identityError !== null) return err(identityError);
    if (
      slice.cpuType === loadedIdentity.cpuType &&
      slice.cpuSubtype === loadedIdentity.cpuSubtype
    )
      matches.push(slice);
  }
  const selected = matches.length === 1 ? matches[0] : undefined;
  if (selected === undefined)
    return err(
      `Original FAT slice matching Hopper's loaded header is ${matches.length === 0 ? "missing" : "ambiguous"}`,
    );
  if (headers.get(selected.index)?.equals(header) !== true)
    return err(
      "Original FAT slice header disagrees with Hopper's loaded header",
    );
  if (observation.provider_file_offset >= selected.size)
    return err("Provider mapping lies outside the loaded FAT slice");
  if (!Number.isSafeInteger(selected.offset + observation.provider_file_offset))
    return err("Original file offset exceeds the exact JSON integer range");
  return ok(selected.offset);
}
