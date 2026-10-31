import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { ArtifactReaderFailure } from "./ArtifactReader.js";
import type { ArtifactResourceScope } from "./ArtifactResourceScope.js";
import { hashStableRootArtifact } from "./inventory/hashStableRootArtifact.js";

/** Bind live resource reads to the target identity established by the session. */
export const withArtifactTargetIdentity = async <T>(
  target: BinaryTarget,
  resources: ArtifactResourceScope,
  read: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  const verify = async () => {
    const digest = await hashStableRootArtifact(target.path, resources, signal);
    if (digest.sha256 !== target.sha256)
      throw new ArtifactReaderFailure(
        "integrity",
        `Active target digest changed: expected ${target.sha256}, observed ${digest.sha256}`,
      );
  };
  await verify();
  const result = await read();
  await verify();
  return result;
};
