import { fixedAllowanceOptions } from "../domain/fixedAllowanceRemediation.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  artifactFilePrimaryFacts,
  type ArtifactFilePrimaryFacts,
  artifactFileCancellationCause,
  bindArtifactFileCleanup,
} from "../artifacts/ArtifactFileOperation.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { completedStableArtifactObservation } from "../artifacts/StableArtifactObservation.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import type { ApkSchemeError } from "../domain/apkSignature/apkSignatureSchemes.js";
import type { ApkSigningBlockError } from "../domain/apkSignature/apkSigningBlock.js";
import type { ApkCentralDirectoryError } from "../domain/apkSignature/apkV1Signature.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import {
  APK_SIGNATURE_LIMITS,
  APK_SIGNATURE_PROVIDER_IDENTITY,
} from "./ApkSignatureRelease.js";

const OPERATION = "inspect_apk_signature";

const inputError = (message: string): AnalysisInputError =>
  new AnalysisInputError(OPERATION, undefined, [
    { path: ["path"], reason: "invalid_value", message },
  ]);

/** Map a tagged signing-block framing failure to the shared analysis error algebra. */
export const mapApkBlockError = (
  error: ApkSigningBlockError,
  path: string,
): AnalysisError => {
  switch (error.kind) {
    case "not-a-zip":
      return new AnalysisUnsupportedTargetError(
        OPERATION,
        path,
        `The selected file is not a ZIP/APK (${error.detail}).`,
        { remediationAction: "Select a local .apk/.zip/.aab archive." },
      );
    case "zip64-unsupported":
      return new AnalysisUnsupportedTargetError(
        OPERATION,
        path,
        `This archive uses a Zip64 structure this reader does not decode (${error.detail}).`,
      );
    case "malformed-zip":
      return inputError(
        `Damaged ZIP/APK at byte ${String(error.offset)}: ${error.detail}.`,
      );
    case "malformed-block":
      return inputError(
        `Malformed APK Signing Block at byte ${String(error.offset)}: ${error.detail}.`,
      );
    case "budget-exceeded":
      return new AnalysisResourceConstraintError(
        OPERATION,
        "capacity",
        `APK Signing Block holds more ${error.resource} than the ${String(error.limit)} limit.`,
        { max_signing_block_pairs: error.limit },
        fixedAllowanceOptions(
          `The APK Signing Block allowance of ${String(error.limit)} pairs (this release has no runtime override)`,
          "count",
        ),
      );
  }
};

/** Map a tagged signer/lineage decoding failure, naming the scheme it came from. */
export const mapApkSchemeError = (
  error: ApkSchemeError,
  scheme: string,
): AnalysisError =>
  error.kind === "malformed-signer"
    ? inputError(
        `Malformed APK Signature Scheme ${scheme} block: ${error.detail}.`,
      )
    : new AnalysisResourceConstraintError(
        OPERATION,
        "capacity",
        `APK Signature Scheme ${scheme} holds more ${error.resource} than the ${String(error.limit)} limit.`,
        { [`max_${error.resource.replace(/-/g, "_")}`]: error.limit },
        fixedAllowanceOptions(
          `The APK Signature Scheme ${scheme} allowance of ${String(error.limit)} ${error.resource} (this release has no runtime override)`,
          "count",
        ),
      );

/** A central directory that cannot be walked leaves v1 presence unknown: refuse. */
export const mapCentralDirectoryError = (
  error: ApkCentralDirectoryError,
): AnalysisError =>
  error.kind === "budget-exceeded"
    ? new AnalysisResourceConstraintError(
        OPERATION,
        "capacity",
        `The central directory holds more than ${String(error.limit)} META-INF v1 signing entries.`,
        { max_v1_signature_entries: error.limit },
        fixedAllowanceOptions(
          `The APK v1 allowance of ${String(error.limit)} META-INF signing entries (this release has no runtime override)`,
          "count",
        ),
      )
    : inputError(
        `Malformed ZIP central directory at byte ${String(error.offset)}: ${error.detail}.`,
      );

/** More v1 signers than a signed APK carries: refused rather than decoded. */
export const v1SignerCapacityError = (limit: number): AnalysisError =>
  new AnalysisResourceConstraintError(
    OPERATION,
    "capacity",
    `The archive pairs more than ${String(limit)} v1 signature blocks with .SF files.`,
    { max_v1_signers: limit },
    fixedAllowanceOptions(
      `The APK v1 allowance of ${String(limit)} signers (this release has no runtime override)`,
      "count",
    ),
  );

/** The decoded result would exceed the inline output budget. */
export const apkOutputBudgetError = (projectedBytes: number): AnalysisError =>
  new AnalysisResourceConstraintError(
    OPERATION,
    "capacity",
    `The decoded signing report (${String(projectedBytes)} bytes) exceeds the ${String(APK_SIGNATURE_LIMITS.outputBytes)}-byte output budget.`,
    { max_output_bytes: APK_SIGNATURE_LIMITS.outputBytes },
    fixedAllowanceOptions(
      `The decoded APK signing report allowance of ${String(APK_SIGNATURE_LIMITS.outputBytes)} bytes (this release has no runtime override)`,
      "report",
    ),
  );

/**
 * Map a read or analysis failure, keeping a failed descriptor close as a
 * cleanup fact bound to the error (its lease retried by the provider's
 * close()), as the other stable-read providers do.
 */
export const apkSignatureFailure = (
  cause: unknown,
  path: string,
): AnalysisError => {
  const primary = primaryFailure(artifactFilePrimaryFacts(cause), path);
  const observation = completedStableArtifactObservation(cause, path);
  if (observation !== undefined) primary.retainPartialObservation(observation);
  if (!(cause instanceof ArtifactReaderFailure) || cause.cleanup === undefined)
    return primary;
  const cleanup = new ProviderCleanupError(
    APK_SIGNATURE_PROVIDER_IDENTITY.id,
    cause.cleanup.resources,
    { reason: cause.cleanup.reason },
    { cause, operation: OPERATION },
  );
  const error = analysisErrorWithCleanupFailure(primary, cleanup, OPERATION);
  bindArtifactFileCleanup(cause, error);
  return error;
};

/** Distinguish cancellation, access, integrity and limits for the primary failure. */
const primaryFailure = (
  facts: ArtifactFilePrimaryFacts,
  path: string,
): AnalysisError => {
  const { cause, origin } = facts;
  if (origin === "owned-or-classified" && cause instanceof AnalysisError)
    return cause;
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure
  )
    return artifactReaderFailure(cause, path);
  if (cause instanceof Error && "code" in cause) {
    if (cause.code === "EACCES" || cause.code === "EPERM")
      return new AnalysisAccessDeniedError(OPERATION, path, cause.code, {
        cause,
      });
    if (
      ["ENOENT", "ENOTDIR", "ELOOP", "ENAMETOOLONG"].includes(
        String(cause.code),
      )
    )
      return new AnalysisInputError(OPERATION, { cause }, [
        {
          path: ["path"],
          reason: "invalid_value",
          message: `No regular file can be read at the selected path (${String(cause.code)}): ${path}.`,
        },
      ]);
  }
  return adapterFailure(cause, path);
};

/**
 * The reader owns the meaning of its tagged failures: only a path that is not
 * a regular file describes the caller's selection. I/O, an unavailable or
 * closed resource scope, and a non-byte stream are execution failures.
 */
const artifactReaderFailure = (
  cause: ArtifactReaderFailure,
  path: string,
): AnalysisError => {
  switch (cause.reason) {
    case "integrity":
      return new AnalysisArtifactChangedError(OPERATION, path, cause.message, {
        cause,
      });
    case "cancelled":
      return new AnalysisCancelledError(OPERATION, {
        cause: artifactFileCancellationCause(cause),
      });
    case "limit":
      return new AnalysisResourceConstraintError(
        OPERATION,
        "file-size",
        cause.message,
        { max_input_bytes: APK_SIGNATURE_LIMITS.inputBytes },
        {
          cause,
          remediationAction:
            "The size budget is fixed; select a smaller archive.",
        },
      );
    case "path":
      return new AnalysisInputError(OPERATION, { cause }, [
        { path: ["path"], reason: "invalid_format", message: cause.message },
      ]);
    default:
      return adapterFailure(cause, path);
  }
};

const adapterFailure = (cause: unknown, path: string): AnalysisError =>
  new ProviderAdapterError(APK_SIGNATURE_PROVIDER_IDENTITY.id, OPERATION, {
    cause,
    diagnostics: {
      path,
      reason: cause instanceof Error ? cause.message : String(cause),
    },
  });
