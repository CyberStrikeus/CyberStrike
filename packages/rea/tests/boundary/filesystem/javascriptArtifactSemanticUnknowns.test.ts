import { expect, it } from "vitest";

import { analyzeArtifactFiles } from "../../fixtures/javascriptArtifactAnalysis.js";
import { completeJavaScriptAnalysisSteps } from "../../../src/application/javascript/JavaScriptAnalysisControl.js";
import { JAVASCRIPT_SEMANTIC_RELATION_FAMILIES } from "../../../src/domain/javascript/javascriptSemanticGraphSchemas.js";

const SHA256 = "a".repeat(64);
const GRAPH_ID = `jag_${"b".repeat(64)}`;

it("preserves an unparseable source identity and unknown semantic extents", async () => {
  const source = "export const broken = ;";
  const { analysis, projection } = await analyzeArtifactFiles({
    files: [
      {
        path: "broken.mjs",
        container_sha256: SHA256,
        sha256: SHA256,
        bytes: Buffer.byteLength(source),
        inventory_artifact_id: `art_${SHA256}`,
        kind: "javascript",
        unpacked: false,
        text: { included: true, value: source },
      },
    ],
    unavailable_relevant_files: [],
    containers: [],
    text_bytes_read: Buffer.byteLength(source),
    invalid_utf8_files: 0,
  });
  expect(analysis.files[0]?.javascript?.parse_status).toBe("failed");
  const graph = await completeJavaScriptAnalysisSteps(
    projection.finishImmutableSteps(SHA256, { graph_id: GRAPH_ID, nodes: [] }),
  );
  const module = graph.nodes.find(
    ({ kind, identity }) =>
      kind === "module" && identity.module_path === "broken.mjs",
  );
  expect(module).toBeDefined();
  expect(graph.unknowns).toHaveLength(
    JAVASCRIPT_SEMANTIC_RELATION_FAMILIES.length,
  );
  for (const unknown of graph.unknowns) {
    expect(unknown).toMatchObject({
      node_id: module?.node_id,
      reason: "incomplete-module",
    });
    expect(unknown.detail).toContain("syntax could not be parsed");
  }
  expect(graph.coverage).toMatchObject({
    status: "partial",
    truncated: false,
    omitted_nodes: null,
    omitted_relations: null,
    limits: [],
  });
});
