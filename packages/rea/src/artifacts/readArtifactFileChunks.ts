import type { FileHandle } from "node:fs/promises";
import {
  readFileHandleChunks,
  type FileHandleChunkOptions,
} from "../filesystem/readFileHandleChunks.js";
import { ArtifactReaderFailure } from "./ArtifactReader.js";

/** Produce artifact cancellation facts at the actual descriptor read boundary. */
export const readArtifactFileChunks = (
  handle: Pick<FileHandle, "read">,
  options: Pick<FileHandleChunkOptions, "start" | "end" | "signal"> = {},
) =>
  readFileHandleChunks(handle, {
    ...options,
    cancellationFailure: (reason) =>
      new ArtifactReaderFailure("cancelled", "Artifact file read cancelled", {
        cause: reason,
      }),
  });
