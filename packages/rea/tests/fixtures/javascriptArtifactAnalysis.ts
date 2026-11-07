import { analyzeAndAdoptJavaScriptArtifactFiles } from "../../src/application/javascript/JavaScriptArtifactAnalysis.js";
import type { JavaScriptArtifactAnalysis } from "../../src/application/javascript/JavaScriptArtifactAnalysisTypes.js";
import {
  createJavaScriptSemanticGraphProjection,
  type JavaScriptSemanticGraphProjection,
} from "../../src/application/javascript/JavaScriptSemanticGraphBuilder.js";
import { createJavaScriptSourceAnalysis } from "../../src/artifacts/javascript/JavaScriptSourceAnalysis.js";
import type { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import type { JavaScriptArtifactFileSet } from "../../src/domain/javascript/javascriptArtifactFiles.js";
import { withArtifactResourceScope } from "./artifactInventory.js";

/** Analyze inert fixture sources through the real worker and join its owning scope. */
const analyzeArtifactFilesInScope = async (
  fileSet: JavaScriptArtifactFileSet,
  scope: ArtifactResourceScope,
): Promise<{
  readonly analysis: JavaScriptArtifactAnalysis;
  readonly projection: JavaScriptSemanticGraphProjection;
}> => {
  const worker = await createJavaScriptSourceAnalysis(
    { heapMb: 512, timeoutMs: 30_000 },
    fileSet.files.filter(
      (file) => file.kind === "javascript" && file.text.included,
    ).length,
    { scope },
  );
  const owner = {
    kind: "javascript-source-analysis",
    resource: "fixture JavaScript source analyzer",
    analysis: worker,
  } as const;
  scope.retain(owner);
  const projection = createJavaScriptSemanticGraphProjection();
  const outcome = await analyzeAndAdoptJavaScriptArtifactFiles(
    fileSet,
    worker,
    projection,
    async () => {},
  );
  if (outcome.interruption !== null) throw outcome.interruption;
  const released = await scope.release(owner);
  if (released.kind === "failed")
    throw scope.cleanupFailure({ kind: "completed" }, [released]);
  return { analysis: outcome.analysis, projection };
};

/** Reuse a healthy worker across analyses owned by the same test. */
export const withArtifactFileAnalyzer = <T>(
  operation: (
    analyze: (
      fileSet: JavaScriptArtifactFileSet,
    ) => ReturnType<typeof analyzeArtifactFilesInScope>,
  ) => Promise<T>,
): Promise<T> =>
  withArtifactResourceScope((scope) =>
    operation((fileSet) => analyzeArtifactFilesInScope(fileSet, scope)),
  );

export const analyzeArtifactFiles = (fileSet: JavaScriptArtifactFileSet) =>
  withArtifactFileAnalyzer((analyze) => analyze(fileSet));
