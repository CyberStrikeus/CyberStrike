import { describe, expect, it } from "vitest";

import {
  createJavaScriptApplicationEdge,
  createJavaScriptApplicationGraph,
  createJavaScriptApplicationNode,
  type JavaScriptApplicationGraph,
} from "./javascriptApplicationGraph.js";
import {
  artifactEvidence,
  completeCoverage,
} from "./javascriptApplicationGraph.fixture.js";
import { compareJavaScriptApplicationVersions } from "./javascriptApplicationVersionComparison.js";

const LEFT_SHA = "a".repeat(64);
const RIGHT_SHA = "b".repeat(64);
const NAMES = ["a", "b", "c", "d"] as const;
type ModuleName = (typeof NAMES)[number];
type Relation = "imports" | "contains";
type EdgeSpec = readonly [ModuleName, ModuleName, Relation];

const sourceDigest = (name: string): string =>
  name.charCodeAt(0).toString(16).padStart(64, "0");

const buildGraph = (
  artifactSha: string,
  edges: readonly EdgeSpec[],
  order: "forward" | "reverse" = "forward",
): JavaScriptApplicationGraph => {
  const names = order === "forward" ? [...NAMES] : [...NAMES].reverse();
  const nodes = names.map((name) =>
    createJavaScriptApplicationNode({
      kind: "javascript-module",
      identity: {
        strategy: "canonical-path",
        stability: "artifact-version",
        artifact_sha256: artifactSha,
        path: `${name}.js`,
      },
      observations: [
        {
          label: `${name}.js`,
          properties: { source_sha256: sourceDigest(name) },
          evidence: artifactEvidence(artifactSha, `${name}.js`),
        },
      ],
    }),
  );
  const idOf = (name: ModuleName): string => {
    const node = nodes.find(({ identity }) =>
      identity.strategy === "canonical-path"
        ? identity.path === `${name}.js`
        : false,
    );
    if (node === undefined) throw new Error(`Missing fixture node ${name}`);
    return node.node_id;
  };
  const ordered = order === "forward" ? [...edges] : [...edges].reverse();
  return createJavaScriptApplicationGraph({
    schema: "JavaScriptApplicationGraph",
    root_node_ids: [idOf("a")],
    nodes,
    edges: ordered.map(([source, target, relation]) =>
      createJavaScriptApplicationEdge({
        source_node_id: idOf(source),
        target_node_id: idOf(target),
        relation,
        properties: {},
        evidence: artifactEvidence(artifactSha, `${source}.js`),
      }),
    ),
    coverage: completeCoverage,
    limitations: [],
  });
};

const relationshipChanges = (
  left: JavaScriptApplicationGraph,
  right: JavaScriptApplicationGraph,
): string[] => {
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
  expect(result.summary.added + result.summary.removed).toBe(0);
  return result.items
    .filter(({ dimensions }) => dimensions.includes("relationships"))
    .map(({ left_node_id: id }) => {
      const node = left.nodes.find(({ node_id: nodeId }) => nodeId === id);
      const label = node?.observations[0]?.label;
      if (label === undefined || label === null)
        throw new Error("Changed item has no node");
      return label;
    })
    .sort();
};

const BASE_EDGES: readonly EdgeSpec[] = [
  ["a", "b", "imports"],
  ["b", "c", "imports"],
  ["a", "c", "contains"],
  ["c", "b", "imports"],
];

describe("application version relationship comparison", () => {
  it("reports no relationship change for identical topology in any node or edge order", () => {
    expect(
      relationshipChanges(
        buildGraph(LEFT_SHA, BASE_EDGES),
        buildGraph(RIGHT_SHA, BASE_EDGES, "reverse"),
      ),
    ).toEqual([]);
  });

  it("flags both endpoints when an edge relation changes", () => {
    const changed: readonly EdgeSpec[] = [
      ["a", "b", "imports"],
      ["b", "c", "contains"],
      ["a", "c", "contains"],
      ["c", "b", "imports"],
    ];
    expect(
      relationshipChanges(
        buildGraph(LEFT_SHA, BASE_EDGES),
        buildGraph(RIGHT_SHA, changed),
      ),
    ).toEqual(["b.js", "c.js"]);
  });

  it("flags a node whose only change is an incoming edge", () => {
    const left: readonly EdgeSpec[] = [["a", "b", "imports"]];
    const right: readonly EdgeSpec[] = [
      ["a", "b", "imports"],
      ["c", "b", "imports"],
    ];
    expect(
      relationshipChanges(
        buildGraph(LEFT_SHA, left),
        buildGraph(RIGHT_SHA, right),
      ),
    ).toEqual(["b.js", "c.js"]);
  });

  it("flags a node when an edge is re-pointed at a different matched neighbour", () => {
    const left: readonly EdgeSpec[] = [["a", "b", "imports"]];
    const right: readonly EdgeSpec[] = [["a", "c", "imports"]];
    expect(
      relationshipChanges(
        buildGraph(LEFT_SHA, left),
        buildGraph(RIGHT_SHA, right),
      ),
    ).toEqual(["a.js", "b.js", "c.js"]);
  });

  it("distinguishes edge direction between the same pair", () => {
    const left: readonly EdgeSpec[] = [["a", "b", "imports"]];
    const right: readonly EdgeSpec[] = [["b", "a", "imports"]];
    expect(
      relationshipChanges(
        buildGraph(LEFT_SHA, left),
        buildGraph(RIGHT_SHA, right),
      ),
    ).toEqual(["a.js", "b.js"]);
  });
});
