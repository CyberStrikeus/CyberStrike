import {
  NonRegularFileReadError,
  RegularFileAdmissionFailure,
  RegularFileChangedError,
  RegularFileOperationCancelled,
} from "../filesystem/RegularFile.js";
import { ArtifactReaderFailure } from "./ArtifactReader.js";

/** Project physical admission failures without taking the caller's descriptor ownership. */
export const artifactFileAdmissionFailure = (
  path: string,
  diagnosticLabel: string,
  cause: unknown,
): ArtifactReaderFailure => {
  if (cause instanceof ArtifactReaderFailure) return cause;
  if (cause instanceof RegularFileOperationCancelled)
    return new ArtifactReaderFailure(
      "cancelled",
      `${diagnosticLabel} admission cancelled`,
      { cause: cause.reason },
    );
  if (cause instanceof RegularFileAdmissionFailure)
    return ArtifactReaderFailure.withCleanup(
      artifactFileAdmissionFailure(path, diagnosticLabel, cause.cause),
      ArtifactReaderFailure.cleanupObservation(cause.cleanupCause, path),
    );
  if (cause instanceof RegularFileChangedError)
    return new ArtifactReaderFailure(
      "integrity",
      `${diagnosticLabel} source changed during admission: ${path}`,
      { cause },
    );
  if (cause instanceof NonRegularFileReadError)
    return new ArtifactReaderFailure(
      "format",
      `${diagnosticLabel} source is not a regular file: ${path}`,
      { cause },
    );
  return new ArtifactReaderFailure(
    "io",
    cause instanceof Error
      ? cause.message
      : `Cannot admit ${diagnosticLabel} source: ${path}`,
    { cause },
  );
};
