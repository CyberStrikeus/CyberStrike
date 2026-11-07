import { realpath, stat } from "node:fs/promises";
import { ArtifactReaderFailure } from "./ArtifactReader.js";
import { artifactSelectedPathErrno } from "./ArtifactFileOperation.js";

/** Canonicalize only a path that native filesystem lookup actually accepts. */
export const resolveArtifactSourcePath = async (
  path: string,
): Promise<string> => {
  // Darwin realpath can collapse file/.. although opening that spelling fails
  // with ENOTDIR. Keep both file and directory selections valid here; the
  // inventory/reader owns format and regular-file admission.
  await stat(path);
  return realpath(path);
};

/** Verify selection spelling independently of canonical descriptor ownership. */
export const assertArtifactSelectedSource = async (
  canonicalPath: string,
  selectedPath: string | undefined,
): Promise<void> => {
  if (selectedPath === undefined) return;
  const changed = (cause?: unknown) =>
    new ArtifactReaderFailure(
      "integrity",
      `Selected artifact no longer resolves to its admitted source: ${selectedPath}`,
      {
        userMessage:
          "The selected artifact path no longer names the opened file. Reopen the selected artifact, then retry.",
        ...(cause === undefined ? {} : { cause }),
      },
    );
  let current: string;
  try {
    current = await resolveArtifactSourcePath(selectedPath);
  } catch (cause: unknown) {
    if (artifactSelectedPathErrno(cause) !== undefined) throw changed(cause);
    throw cause;
  }
  if (current !== canonicalPath) throw changed();
};
