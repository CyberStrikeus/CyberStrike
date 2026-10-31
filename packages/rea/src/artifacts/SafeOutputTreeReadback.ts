import { createHash } from "node:crypto";
import type { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import { readArtifactFileChunks } from "./readArtifactFileChunks.js";
import { assertArtifactReadActive } from "./ArtifactFileOperation.js";
import { streamChunkToBuffer } from "./StreamBytes.js";

import { ArtifactReaderFailure } from "./ArtifactReader.js";
import {
  assertFilePathIdentity,
  readFileIdentity,
  type FileIdentity,
} from "./SafeOutputTreeIdentity.js";

/** Hash one retained readback descriptor and confirm it still names the output file. */
export const hashOutputFile = async (
  owner: OwnedFileHandle,
  path: string,
  identity: FileIdentity,
  options: {
    readonly maximum: number;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<{ readonly sha256: string; readonly bytes: number }> => {
  assertArtifactReadActive(options.signal);
  const admittedIdentity = await readFileIdentity(owner.handle, path);
  await assertFilePathIdentity(path, identity);
  if (
    admittedIdentity.dev !== identity.dev ||
    admittedIdentity.ino !== identity.ino
  )
    throw new ArtifactReaderFailure(
      "path",
      `Extraction file identity changed: ${path}`,
    );
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const raw of readArtifactFileChunks(owner.handle, options)) {
    const chunk = streamChunkToBuffer(raw);
    bytes += chunk.length;
    if (bytes > options.maximum)
      throw new ArtifactReaderFailure(
        "integrity",
        "Readback exceeded the bytes written",
      );
    hash.update(chunk);
  }
  await assertFilePathIdentity(path, identity);
  assertArtifactReadActive(options.signal);
  return { sha256: hash.digest("hex"), bytes };
};
