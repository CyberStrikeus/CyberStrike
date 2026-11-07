import { analysisSettingLimit } from "../domain/analysisSettingDefinitions.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { ArtifactOperationError } from "../domain/artifactOperationError.js";
import { ArtifactReaderFailure } from "./ArtifactReader.js";
import {
  artifactFileCancellationCause,
  bindArtifactFileCleanup,
} from "./ArtifactFileOperation.js";

/** Translate one artifact boundary failure while retaining cleanup evidence. */
export const translateArtifactFailure = (
  operation: ArtifactOperationError["operation"],
  cause: unknown,
): AnalysisError => {
  if (cause instanceof ArtifactReaderFailure) {
    const error = new ArtifactOperationError(
      operation,
      cause.reason,
      cause.details,
      cause.message,
      {
        ...(cause.userMessage === undefined
          ? {}
          : { userMessage: cause.userMessage }),
        cause:
          cause.reason === "cancelled"
            ? artifactFileCancellationCause(cause)
            : cause,
        ...(cause.cleanup === undefined ? {} : { cleanup: cause.cleanup }),
        ...(cause.partialObservation === undefined
          ? {}
          : { partialObservation: cause.partialObservation }),
        ...(cause.admission === undefined
          ? {}
          : { admission: cause.admission }),
        ...(cause.boundary === undefined ? {} : { boundary: cause.boundary }),
      },
    );
    if (cause.admission !== undefined)
      error.bindLimit({
        ...analysisSettingLimit(
          "asar.max_header_bytes",
          cause.admission.maximumBytes,
          cause.admission.source,
        ),
        ...(cause.admission.requiredBytes === undefined
          ? {}
          : { required_value: cause.admission.requiredBytes }),
      });
    bindArtifactFileCleanup(cause, error);
    return error;
  }
  // Keep typed Evidence and other analysis failures instead of reducing them to I/O.
  if (cause instanceof AnalysisError) return cause;
  return new ArtifactOperationError(operation, "io", undefined, undefined, {
    cause,
  });
};
