import { describe, expect, it } from "vitest";

import {
  createJavaScriptApplicationEdge,
  createJavaScriptApplicationGraph,
  type JavaScriptApplicationGraph,
} from "./javascriptApplicationGraph.js";
import {
  artifactEvidence,
  completeCoverage,
  fixtureNode,
} from "./javascriptApplicationGraph.fixture.js";
import { compareJavaScriptApplicationVersions } from "./javascriptApplicationVersionComparison.js";

const LEFT_SHA = "a".repeat(64);
const RIGHT_SHA = "b".repeat(64);

const digest = (value: number): string => value.toString(16).padStart(64, "0");

const buildGraph = (
  artifactSha: string,
  changed: number,
): JavaScriptApplicationGraph => {
  const nodes = ["a", "b", "c", "d"].map((name, index) =>
    fixtureNode(
      "javascript-module",
      {
        strategy: "canonical-path",
        stability: "artifact-version",
        artifact_sha256: artifactSha,
        path: `${name}.js`,
      },
      `${name}.js`,
      {
        structural_fingerprint_sha256: digest(index + 1),
        structural_fingerprint_algorithm: "fixture",
        source_sha256: digest(index === 1 || index === 3 ? changed : 0),
      },
      artifactEvidence(artifactSha, `${name}.js`),
    ),
  );
  const [a, b] = nodes;
  if (a === undefined || b === undefined)
    throw new Error("Missing fixture node");
  return createJavaScriptApplicationGraph({
    schema: "JavaScriptApplicationGraph",
    root_node_ids: [a.node_id],
    nodes,
    edges: [
      createJavaScriptApplicationEdge({
        source_node_id: a.node_id,
        target_node_id: b.node_id,
        relation: "imports",
        properties: {},
        evidence: artifactEvidence(artifactSha, "a.js"),
      }),
    ],
    coverage: completeCoverage,
    limitations: [],
  });
};

describe("application change graph", () => {
  it("anchors each changed_from edge to its own right-hand observation", () => {
    const left = buildGraph(LEFT_SHA, 1);
    const right = buildGraph(RIGHT_SHA, 2);
    const result = compareJavaScriptApplicationVersions({
      left: {
        evidenceId: `ev_${"1".repeat(64)}`,
        rootArtifactSha256: LEFT_SHA,
        graph: left,
      },
      right: {
        evidenceId: `ev_${"2".repeat(64)}`,
        rootArtifactSha256: RIGHT_SHA,
        graph: right,
      },
      leftNativeEvidence: [],
      rightNativeEvidence: [],
    });
    const changedFrom = result.graph.edges.filter(
      ({ relation }) => relation === "changed_from",
    );
    expect(changedFrom).toHaveLength(2);
    for (const edge of changedFrom) {
      const source = right.nodes.find(
        ({ node_id: id }) => id === edge.source_node_id,
      );
      const target = left.nodes.find(
        ({ node_id: id }) => id === edge.target_node_id,
      );
      expect(source?.observations[0]?.label).toBe(
        target?.observations[0]?.label,
      );
      expect(edge.evidence.artifact).toEqual(
        source?.observations[0]?.evidence.artifact,
      );
      expect(edge.evidence.location).toEqual(
        source?.observations[0]?.evidence.location,
      );
    }
  });
});
