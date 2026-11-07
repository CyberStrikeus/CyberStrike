import { ArtifactReaderFailure } from "./ArtifactReader.js";

/** Preserve cancellation at the ASAR boundary with its original abort reason. */
export const asarCancellationFailure = (
  reason: unknown,
): ArtifactReaderFailure =>
  new ArtifactReaderFailure("cancelled", "ASAR operation cancelled", {
    cause: reason,
  });

export const assertAsarReadActive = (signal?: AbortSignal): void => {
  if (signal?.aborted === true) throw asarCancellationFailure(signal.reason);
};

/** Classify ASAR boundary failures without replacing ownership-bearing errors. */
export const asarFailure = (
  path: string,
  operation: string,
  cause: unknown,
): ArtifactReaderFailure => {
  if (cause instanceof ArtifactReaderFailure) return cause;
  if (isFilesystemFailure(cause))
    return new ArtifactReaderFailure(
      "io",
      `Could not ${operation} ASAR at ${path}: ${cause.message}`,
      { cause },
    );
  return new ArtifactReaderFailure(
    "format",
    `Malformed ASAR during ${operation}: ${path}`,
    { cause },
  );
};

const isFilesystemFailure = (
  cause: unknown,
): cause is NodeJS.ErrnoException & Error =>
  cause instanceof Error &&
  "errno" in cause &&
  typeof cause.errno === "number" &&
  "syscall" in cause &&
  typeof cause.syscall === "string";
