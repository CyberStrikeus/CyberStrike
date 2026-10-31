import { createAsarHeaderSignatureProbe } from "../../src/artifacts/AsarHeader.js";
import { classifyArtifactContent } from "../../src/artifacts/inventory/ArtifactGraphConstruction.js";

/** Observe a supplied byte prefix before assigning an inventory path role. */
export const classifyArtifactBytesAtPath = (
  path: string,
  bytes: Buffer,
  fileSize = bytes.length,
) => {
  const probe = createAsarHeaderSignatureProbe();
  probe.write(bytes);
  const { kind, format } = classifyArtifactContent(
    path,
    { prefix: bytes, asarHeader: probe.finish(fileSize) },
    fileSize,
  );
  return { kind, format };
};
