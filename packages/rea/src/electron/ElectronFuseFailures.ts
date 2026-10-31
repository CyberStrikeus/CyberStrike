import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  ArtifactFileCleanupFailure,
  artifactFileCompletion,
  artifactFileCancellationCause,
  bindArtifactFileCleanup,
} from "../artifacts/ArtifactFileOperation.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { regularFileCancellation } from "../filesystem/OwnedRegularFile.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import { fixedAllowanceOptions } from "../domain/fixedAllowanceRemediation.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ZodError } from "zod";
import {
  RegularFileChangedError,
  NonRegularFileReadError,
} from "../filesystem/RegularFile.js";
import { ElectronFusePathFailure } from "./ElectronFusePath.js";
import {
  ElectronFuseFormatFailure,
  ElectronFuseResourceFailure,
} from "./ElectronFuseReader.js";

/** Bundled fuse-wire reader. It does not flip fuses or launch the application. */
export const ELECTRON_FUSE_PROVIDER_IDENTITY = {
  id: "electron-fuses",
  name: "REA Electron fuse reader",
  version: "1",
} as const;

const OPERATION = "inspect_electron_fuses";

/** Translate the shared fuse reader without replacing its producing outcome or cleanup owner. */
export const electronFuseFailure = (
  cause: unknown,
  path: string,
  operation = OPERATION,
): AnalysisError => {
  if (cause instanceof AnalysisError) return cause;
  if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined) {
    const cleanup = new ProviderCleanupError(
      ELECTRON_FUSE_PROVIDER_IDENTITY.id,
      cause.cleanup.resources,
      { reason: cause.cleanup.reason },
      { operation, cause },
    );
    bindArtifactFileCleanup(cause, cleanup);
    if (cause instanceof ArtifactFileCleanupFailure) {
      const outcome = cause.fileCleanupFailure.outcome;
      const cancellation = artifactFileCompletion(cause)?.cancellation;
      const primary =
        outcome.kind === "failed"
          ? electronFuseFailure(outcome.cause, path, operation)
          : cancellation === undefined
            ? undefined
            : new AnalysisCancelledError(operation, {
                cause: cancellation.reason,
              });
      if (primary !== undefined)
        return analysisErrorWithCleanupFailure(
          primary,
          cleanup,
          operation,
        ).bindCleanupDependencies([primary, cleanup]);
    }
    return cleanup;
  }
  if (cause instanceof ArtifactReaderFailure && cause.reason === "cancelled")
    return new AnalysisCancelledError(operation, {
      cause: artifactFileCancellationCause(cause),
    });
  const cancellation = regularFileCancellation(cause);
  if (cancellation !== undefined)
    return new AnalysisCancelledError(operation, {
      cause: cancellation.reason,
    });
  if (cause instanceof ElectronFusePathFailure)
    return new AnalysisInputError(operation, { cause }, [
      { path: ["path"], reason: cause.reason, message: cause.message },
    ]);
  if (cause instanceof ElectronFuseResourceFailure)
    return new AnalysisResourceConstraintError(
      operation,
      cause.boundary === "file-size" ? "file-size" : "capacity",
      cause.message,
      cause.boundary === "file-size"
        ? { maximum_input_bytes: 1024 * 1024 * 1024 }
        : { maximum_sentinels_per_slice: 32 },
      {
        cause,
        ...fixedAllowanceOptions(
          cause.boundary === "file-size"
            ? "the 1 GiB Electron fuse input allowance"
            : "The Electron fuse sentinel inventory",
          cause.boundary === "file-size" ? "input" : "count",
        ),
      },
    );
  if (cause instanceof ElectronFuseFormatFailure)
    return cause.kind === "unsupported"
      ? new AnalysisUnsupportedTargetError(operation, path, cause.message, {
          cause,
        })
      : new AnalysisInputError(operation, { cause }, [
          {
            path: ["path"],
            reason: "invalid_format",
            message: `Selected artifact ${path}: ${cause.message}`,
          },
        ]);
  if (cause instanceof RegularFileChangedError)
    return new AnalysisArtifactChangedError(operation, path, cause.message, {
      cause,
    });
  if (cause instanceof NonRegularFileReadError)
    return new AnalysisInputError(operation, { cause }, [
      {
        path: ["path"],
        reason: "invalid_format",
        message: cause.message,
      },
    ]);
  if (cause instanceof ZodError)
    return new AnalysisOutputError(
      operation,
      "Electron fuse reader produced a report outside its schema.",
      { cause },
    );
  if (cause instanceof Error && "code" in cause) {
    if (cause.code === "EACCES" || cause.code === "EPERM")
      return new AnalysisAccessDeniedError(operation, path, cause.code, {
        cause,
      });
    if (
      ["ENOENT", "ENOTDIR", "ELOOP", "ENAMETOOLONG"].includes(
        String(cause.code),
      )
    )
      return new AnalysisInputError(operation, { cause }, [
        {
          path: ["path"],
          reason: "invalid_value",
          message: `Selected artifact could not be read (${String(cause.code)}): ${path}.`,
        },
      ]);
  }
  return new ProviderAdapterError(
    ELECTRON_FUSE_PROVIDER_IDENTITY.id,
    operation,
    {
      cause,
      diagnostics: {
        path,
        reason: cause instanceof Error ? cause.message : String(cause),
      },
    },
  );
};
