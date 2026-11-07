import type { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import type { RetainedResourceScope } from "../../src/application/AnalysisProvider.js";

/** Complete a prerequisite operation, including retained cleanup on failure. */
export function withVerifierResourceOwner<T>(
  operation: (owner: RetainedResourceScope) => Promise<T>,
): Promise<T>;

/** Hash one verifier input and transfer failed-close ownership to its scope. */
export function hashVerifierFile(
  path: string,
  resources: Pick<ArtifactResourceScope, "retain">,
): Promise<{ readonly bytes: number; readonly sha256: string }>;
