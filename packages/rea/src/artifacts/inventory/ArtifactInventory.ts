import { absoluteCallerPath } from "../../filesystem/callerPath.js";
import { resolveArtifactSourcePath } from "../ArtifactSelectedSource.js";

import {
  artifactInventoryResultSchema,
  type ArtifactInventoryResult,
} from "../../domain/artifactGraph.js";
import { abortIfNeeded } from "../ArtifactHash.js";
import {
  scanCanonicalArtifactInventoryInScope,
  scanCanonicalArtifactInventoryForExtractionInScope,
  type TransferredArtifactInventorySource,
} from "./scanCanonical.js";
import type { ArtifactInventoryOptions } from "./types.js";
import type { ArtifactInventorySnapshot } from "../../domain/artifactInventorySnapshot.js";
import type { ArtifactEmbeddedFormatProbeFacts } from "../ArtifactEmbeddedFormatProbes.js";

/** Inventory one local artifact and return every graph collection inline. */
export const inventoryArtifact = async (
  inputPath: string,
  options: ArtifactInventoryOptions,
): Promise<ArtifactInventoryResult> => {
  const snapshot = await options.resourceScope.run(() =>
    scanArtifactInventoryInScope(inputPath, options),
  );
  return artifactInventoryResultSchema.parse(snapshot);
};

export const scanArtifactInventoryInScope = async (
  inputPath: string,
  options: ArtifactInventoryOptions,
): Promise<ArtifactInventorySnapshot> => {
  abortIfNeeded(options.signal);
  const path = await resolveArtifactSourcePath(inputPath);
  return scanCanonicalArtifactInventoryInScope(
    path,
    options,
    undefined,
    absoluteCallerPath(options.selectedPath ?? inputPath),
  );
};

export const scanArtifactInventoryForExtractionInScope = async (
  inputPath: string,
  options: ArtifactInventoryOptions,
  probeFacts?: ArtifactEmbeddedFormatProbeFacts,
): Promise<{
  readonly snapshot: ArtifactInventorySnapshot;
  readonly transferredSource: TransferredArtifactInventorySource | undefined;
}> => {
  abortIfNeeded(options.signal);
  const path = await resolveArtifactSourcePath(inputPath);
  return scanCanonicalArtifactInventoryForExtractionInScope(
    path,
    options,
    probeFacts,
    absoluteCallerPath(options.selectedPath ?? inputPath),
  );
};
