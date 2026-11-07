import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";

import { MANAGED_STATIC_PROVIDER } from "../domain/investigationProviders.js";
import { classifyBinaryTargetFilesystemFailure } from "../application/BinaryTargetResolver.js";
import {
  RegularFileCleanupFailure,
  regularFileCancellation,
} from "../filesystem/OwnedRegularFile.js";
import {
  bindRegularFileCleanup,
  withRegularFileCompletion,
  type RegularFileReadOptions,
} from "../application/RegularFileRead.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../domain/result.js";
import { fixedAllowanceOptions } from "../domain/fixedAllowanceRemediation.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { RegularFileChangedError } from "../filesystem/RegularFile.js";
import { readBoundedFileBytes } from "../process/BoundedFileBytes.js";

// Managed static inspection retains the complete PE snapshot in memory.
export const MAX_MANAGED_SNAPSHOT_BYTES = 128 * 1024 * 1024;

interface ManagedSourceObservation {
  readonly byteLength: number;
  readonly sha256: string;
  readonly bytes?: Buffer;
}

interface ManagedSnapshot extends ManagedSourceObservation {
  readonly bytes: Buffer;
}

interface ManagedSnapshotReadOptions extends RegularFileReadOptions {
  readonly expectedSha256?: string;
}

/** Admit one observed source digest before any parser or cache consumes its bytes. */
export const verifyManagedSourceIdentity = (
  target: { readonly path: string; readonly sha256: string },
  observed: Pick<ManagedSourceObservation, "sha256" | "byteLength">,
  operation: string,
): Result<null, AnalysisArtifactChangedError> =>
  observed.sha256 === target.sha256
    ? ok(null)
    : err(
        new AnalysisArtifactChangedError(
          operation,
          target.path,
          `Managed artifact digest changed after open: expected ${target.sha256}, observed ${observed.sha256} at ${target.path}`,
          {
            diagnostics: {
              expected_sha256: target.sha256,
              observed_sha256: observed.sha256,
              observed_bytes: observed.byteLength,
            },
          },
        ),
      );

const managedSnapshotCapacityError = (
  operation: string,
): AnalysisResourceConstraintError =>
  new AnalysisResourceConstraintError(
    operation,
    "memory",
    "Managed static inspection requires an eagerly retained PE snapshot within its input byte budget.",
    { max_snapshot_bytes: MAX_MANAGED_SNAPSHOT_BYTES },
    fixedAllowanceOptions("The managed PE snapshot allowance", "parser"),
  );

export const readManagedSnapshot = async (
  path: string,
  operation: string,
  options: ManagedSnapshotReadOptions = {},
): Promise<ManagedSnapshot> => {
  return readManagedFile(
    path,
    operation,
    async (handle, metadata) => {
      const signal = options.signal;
      if (metadata.size > MAX_MANAGED_SNAPSHOT_BYTES)
        throw managedSnapshotCapacityError(operation);
      const bytes = await readBoundedFileBytes(
        handle,
        MAX_MANAGED_SNAPSHOT_BYTES,
        { signal },
      );
      if (bytes === undefined) throw managedSnapshotCapacityError(operation);
      signal?.throwIfAborted();
      return {
        byteLength: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes,
      };
    },
    options,
  );
};

export const hashManagedSource = async (
  path: string,
  operation: string,
  options: ManagedSnapshotReadOptions = {},
): Promise<ManagedSourceObservation> =>
  readManagedFile(
    path,
    operation,
    async (handle, metadata) => {
      const signal = options.signal;
      if (metadata.size > MAX_MANAGED_SNAPSHOT_BYTES)
        throw managedSnapshotCapacityError(operation);
      const digest = createHash("sha256");
      let byteLength = 0;
      const chunk = Buffer.allocUnsafe(64 * 1024);
      for (;;) {
        signal?.throwIfAborted();
        const { bytesRead } = await handle.read(
          chunk,
          0,
          Math.min(chunk.length, MAX_MANAGED_SNAPSHOT_BYTES - byteLength + 1),
          null,
        );
        signal?.throwIfAborted();
        if (bytesRead === 0) break;
        if (bytesRead > MAX_MANAGED_SNAPSHOT_BYTES - byteLength)
          throw managedSnapshotCapacityError(operation);
        byteLength += bytesRead;
        digest.update(chunk.subarray(0, bytesRead));
      }
      return { byteLength, sha256: digest.digest("hex") };
    },
    options,
  );

const readManagedFile = <Value extends ManagedSourceObservation>(
  path: string,
  operation: string,
  read: (handle: FileHandle, metadata: Stats) => Promise<Value>,
  options: ManagedSnapshotReadOptions,
): Promise<Value> =>
  withRegularFileCompletion(path, read, options)
    .then(({ value, cancellation }) => {
      if (cancellation !== undefined) {
        const identity =
          options.expectedSha256 === undefined
            ? undefined
            : verifyManagedSourceIdentity(
                { path, sha256: options.expectedSha256 },
                value,
                operation,
              );
        const failure =
          identity !== undefined && !identity.ok
            ? identity.error
            : new AnalysisCancelledError(operation, {
                cause: cancellation.reason,
              });
        throw failure.retainPartialObservation({
          kind: "file-snapshot-hash",
          path,
          bytes: value.byteLength,
          sha256: value.sha256,
        });
      }
      return value;
    })
    .catch((cause: unknown) => {
      throw normalizeManagedReadFailure(
        cause,
        path,
        operation,
        options.signal,
        options.expectedSha256,
      );
    });

/** Keep cleanup ownership and the original typed read failure at this boundary. */
const normalizeManagedReadFailure = (
  cause: unknown,
  fallbackPath: string,
  operation: string,
  signal?: AbortSignal,
  expectedSha256?: string,
): unknown => {
  // An exact caller reason is opaque, even if it resembles a cleanup record.
  if (signal?.aborted === true && cause === signal.reason)
    return normalizeReadFailure(cause, fallbackPath, operation, signal);
  const cleanupError = managedCleanupError(
    cause,
    fallbackPath,
    operation,
    signal,
    expectedSha256,
  );
  if (cleanupError !== undefined) return cleanupError;
  return normalizeReadFailure(cause, fallbackPath, operation, signal);
};

/** Project cleanup failures owned by managed file reads or their shared scope. */
export const managedCleanupError = (
  cause: unknown,
  fallbackPath: string,
  operation: string,
  signal?: AbortSignal,
  expectedSha256?: string,
): AnalysisError | undefined => {
  if (cause instanceof RegularFileCleanupFailure) {
    const cancellation = regularFileCancellation(cause);
    const cleanup = new ProviderCleanupError(
      MANAGED_STATIC_PROVIDER.id,
      [cause.path],
      { reason: "A managed input file handle could not be closed" },
      { cause, operation },
    );
    bindRegularFileCleanup(cause, cleanup);
    const identity =
      cause.outcome.kind === "completed" && expectedSha256 !== undefined
        ? verifyManagedSourceIdentity(
            { path: cause.path, sha256: expectedSha256 },
            cause.outcome.value as ManagedSourceObservation,
            operation,
          )
        : undefined;
    const failure =
      cause.outcome.kind === "failed"
        ? normalizeReadFailure(
            cause.outcome.cause,
            cause.path,
            operation,
            signal,
          )
        : identity !== undefined && !identity.ok
          ? identity.error
          : cancellation === undefined
            ? undefined
            : new AnalysisCancelledError(operation, {
                cause: cancellation.reason,
              });
    // This boundary produces only these snapshot facts. The descriptor owner
    // confirms completion independently of a failed final close.
    if (cause.outcome.kind === "completed") {
      const observed = cause.outcome.value as ManagedSourceObservation;
      const observation = {
        kind: "file-snapshot-hash" as const,
        path: cause.path,
        bytes: observed.byteLength,
        sha256: observed.sha256,
      };
      cleanup.retainPartialObservation(observation);
      if (failure instanceof AnalysisError)
        failure.retainPartialObservation(observation);
    }
    return failure instanceof AnalysisError
      ? analysisErrorWithCleanupFailure(
          failure,
          cleanup,
          operation,
        ).bindCleanupDependencies([failure, cleanup])
      : cleanup;
  }
  if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined) {
    const error = new ProviderCleanupError(
      MANAGED_STATIC_PROVIDER.id,
      cause.cleanup.resources.length > 0
        ? cause.cleanup.resources
        : [fallbackPath],
      { reason: cause.cleanup.reason },
      { cause, operation, partialObservation: cause.partialObservation },
    );
    bindRegularFileCleanup(cause, error);
    if (cause.reason === "cancelled") {
      const cancelled = new AnalysisCancelledError(operation, {
        cause:
          cause.cancellation === undefined
            ? cause.cause
            : cause.cancellation.reason,
        partialObservation: cause.partialObservation,
      });
      return analysisErrorWithCleanupFailure(
        cancelled,
        error,
        operation,
      ).bindCleanupDependencies([cancelled, error]);
    }
    return error;
  }
  return undefined;
};

const normalizeReadFailure = (
  cause: unknown,
  path: string,
  operation: string,
  signal?: AbortSignal,
): unknown => {
  if (signal?.aborted === true && cause === signal.reason)
    return new AnalysisCancelledError(operation, { cause });
  if (cause instanceof RegularFileChangedError)
    return new AnalysisArtifactChangedError(operation, path, cause.message, {
      cause,
    });
  if (cause instanceof AnalysisError) return cause;
  return (
    classifyBinaryTargetFilesystemFailure(path, cause) ??
    (signal?.aborted === true
      ? new AnalysisCancelledError(operation, { cause })
      : cause)
  );
};
