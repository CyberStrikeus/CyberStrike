import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { compareJavaScriptApplicationVersions } from "../../../src/domain/javascript/javascriptApplicationVersionComparison.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";

it("compares a fully analyzed package manifest as unchanged", async () => {
  const root = await createTestTempDirectory("rea-package-version-comparison-");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0" }),
  );
  const otherRoot = await createTestTempDirectory("rea-package-version-other-");
  await writeFile(
    join(otherRoot, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0" }),
  );
  const other = await analyzeJavaScriptApplication({ input_path: otherRoot });
  if (!other.ok) throw other.error;
  const otherResult = javascriptApplicationAnalysisResultSchema.parse(
    other.value.normalized_result,
  );
  const analyzed = await analyzeJavaScriptApplication({ input_path: root });
  if (!analyzed.ok) throw analyzed.error;
  const result = javascriptApplicationAnalysisResultSchema.parse(
    analyzed.value.normalized_result,
  );
  const packageFile = result.graph.nodes.find((node) =>
    node.observations.some(
      ({ properties }) => properties.file_kind === "package-json",
    ),
  );
  if (packageFile === undefined)
    throw new Error("Missing package file observation");
  const side = {
    evidenceId: analyzed.value.evidence_id,
    rootArtifactSha256: result.root_artifact_sha256,
    graph: result.graph,
  };
  const comparison = compareJavaScriptApplicationVersions({
    left: side,
    right: {
      evidenceId: other.value.evidence_id,
      rootArtifactSha256: otherResult.root_artifact_sha256,
      graph: otherResult.graph,
    },
    leftNativeEvidence: [],
    rightNativeEvidence: [],
  });
  expect(
    comparison.items.find(
      ({ left_node_id }) => left_node_id === packageFile.node_id,
    ),
  ).toMatchObject({ status: "unchanged", dimensions: [] });
});
