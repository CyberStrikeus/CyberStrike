import { NATIVE_MACOS_PROVIDER_IDENTITY as IDENTITY } from "./NativeMacOSProviderMetadata.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { EvidenceIntegrityError } from "../domain/evidenceErrors.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  hashStableFile,
  stableFileHashCause,
} from "../filesystem/StableFileHash.js";
import {
  RegularFileOperationCancelled,
  RegularFileChangedError,
} from "../filesystem/RegularFile.js";
import {
  RegularFileCancelled,
  RegularFileCleanupFailure,
  regularFileCancellation,
} from "../filesystem/OwnedRegularFile.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import {
  ArtifactResourceRetryFailure,
  type ArtifactResourceScope,
} from "../artifacts/ArtifactResourceScope.js";
import {
  ArtifactFileCleanupFailure,
  bindArtifactFileCleanup,
} from "../artifacts/ArtifactFileOperation.js";

const OPERATION = "observe_native_calls";

/** Translate this file owner's outcome without inferring cancellation from signal state. */
export const nativeCallTargetFailure = (
  cause: unknown,
  path: string,
): AnalysisError => {
  if (
    cause instanceof ArtifactResourceRetryFailure &&
    cause.cleanup !== undefined
  ) {
    const failure = new ProviderCleanupError(
      IDENTITY.id,
      cause.cleanup.resources,
      { reason: cause.cleanup.reason, phase: "target-digest-retry" },
      { operation: OPERATION, cause },
    );
    bindArtifactFileCleanup(cause, failure);
    return failure;
  }
  if (
    cause instanceof RegularFileOperationCancelled ||
    cause instanceof RegularFileCancelled
  )
    return new AnalysisCancelledError(OPERATION, {
      cause: cause.reason,
      ...(cause instanceof RegularFileCancelled
        ? {
            diagnostics: {
              completed_hash: jsonValueSchema.parse(cause.outcome.value),
            },
          }
        : {}),
    });
  const physical = stableFileHashCause(cause);
  if (physical instanceof RegularFileChangedError)
    return new EvidenceIntegrityError(
      "Native call observation target changed during digest verification",
      { cause: physical },
    );
  return new ProviderAdapterError(IDENTITY.id, OPERATION, {
    cause: physical,
    diagnostics: {
      path,
      phase: "target-digest",
      reason: "Unable to verify the selected target digest",
      detail: physical instanceof Error ? physical.message : String(physical),
    },
  });
};

/** Verify one stable regular descriptor, retaining its exact owner if close fails. */
export const verifyNativeCallTarget = async (
  target: BinaryTarget,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
): Promise<Result<void, AnalysisError>> => {
  let cleanupLease: AnalysisCleanupLease | undefined;
  try {
    const digest = await hashStableFile(target.path, {
      ...(signal === undefined ? {} : { signal }),
      retainFailedClose: (owner) => {
        cleanupLease = new AnalysisCleanupLease(
          () => owner.close(),
          [target.path],
        );
        resources.retain({
          kind: "lease",
          resource: target.path,
          lease: cleanupLease,
        });
      },
    });
    return digest.sha256 === target.sha256
      ? ok(undefined)
      : err(
          new EvidenceIntegrityError(
            "Native call observation target digest changed after session binding",
          ),
        );
  } catch (cause: unknown) {
    if (
      cause instanceof RegularFileCleanupFailure &&
      cleanupLease !== undefined
    ) {
      const cancellation = regularFileCancellation(cause);
      const completed =
        cause.outcome.kind === "completed"
          ? { completed_hash: jsonValueSchema.parse(cause.outcome.value) }
          : undefined;
      const primary =
        cause.outcome.kind === "failed"
          ? nativeCallTargetFailure(cause.outcome.cause, target.path)
          : cancellation === undefined
            ? undefined
            : new AnalysisCancelledError(OPERATION, {
                cause: cancellation.reason,
                diagnostics: completed,
              });
      const framed = new ArtifactFileCleanupFailure(cause, cleanupLease);
      const failure = new ProviderCleanupError(
        IDENTITY.id,
        [target.path],
        {
          phase: "target-digest-close",
          reason:
            cause.cleanupCause instanceof Error
              ? cause.cleanupCause.message
              : String(cause.cleanupCause),
          ...completed,
        },
        { operation: OPERATION, cause: framed, cleanupPrimary: primary },
      );
      bindArtifactFileCleanup(framed, failure);
      return err(failure);
    }
    return err(nativeCallTargetFailure(cause, target.path));
  }
};
