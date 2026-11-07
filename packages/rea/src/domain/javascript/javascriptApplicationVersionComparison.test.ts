import { describe, expect, it } from "vitest";

import { createEvidence } from "../evidence.js";
import type { JsonValue } from "../jsonValue.js";
import {
  createJavaScriptApplicationEdge,
  createJavaScriptApplicationGraph,
  createJavaScriptApplicationNode,
  isValidatedImmutableJavaScriptApplicationGraph,
  parseJavaScriptApplicationGraph,
  type JavaScriptApplicationGraph,
} from "./javascriptApplicationGraph.js";
import {
  artifactEvidence,
  completeCoverage,
} from "./javascriptApplicationGraph.fixture.js";
import { compareJavaScriptApplicationVersions } from "./javascriptApplicationVersionComparison.js";
import {
  applicationVersionComparisonResultSchema,
  ownedApplicationVersionComparisonResultSchema,
} from "./javascriptApplicationVersionComparisonSchemas.js";

const LEFT_SHA = "a".repeat(64);
const RIGHT_SHA = "b".repeat(64);

const buildGraph = (
  artifactSha: string,
  version: number,
): JavaScriptApplicationGraph => {
  const nodes = ["a", "b", "c"].map((name) =>
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
          properties: {
            structural_fingerprint_sha256: name
              .charCodeAt(0)
              .toString(16)
              .padStart(64, "0"),
            structural_fingerprint_algorithm: "fixture",
            source_sha256: (name === "b" ? version : 0)
              .toString(16)
              .padStart(64, "0"),
          },
          evidence: artifactEvidence(artifactSha, `${name}.js`),
        },
      ],
    }),
  );
  const [a, b, c] = nodes;
  if (a === undefined || b === undefined || c === undefined)
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
      createJavaScriptApplicationEdge({
        source_node_id: b.node_id,
        target_node_id: c.node_id,
        relation: "imports",
        properties: {},
        evidence: artifactEvidence(artifactSha, "b.js"),
      }),
    ],
    coverage: completeCoverage,
    limitations: [],
  });
};

const compare = () =>
  compareJavaScriptApplicationVersions({
    left: {
      evidenceId: `ev_${"1".repeat(64)}`,
      rootArtifactSha256: LEFT_SHA,
      graph: buildGraph(LEFT_SHA, 1),
    },
    right: {
      evidenceId: `ev_${"2".repeat(64)}`,
      rootArtifactSha256: RIGHT_SHA,
      graph: buildGraph(RIGHT_SHA, 2),
    },
    leftNativeEvidence: [],
    rightNativeEvidence: [],
  });

const unrelatedGraph = (artifactSha: string): JavaScriptApplicationGraph => {
  const node = createJavaScriptApplicationNode({
    kind: "javascript-chunk",
    identity: {
      strategy: "canonical-path",
      stability: "artifact-version",
      artifact_sha256: artifactSha,
      path: "unrelated.js",
    },
    observations: [
      {
        label: "unrelated.js",
        properties: {},
        evidence: artifactEvidence(artifactSha, "unrelated.js"),
      },
    ],
  });
  return createJavaScriptApplicationGraph({
    schema: "JavaScriptApplicationGraph",
    root_node_ids: [node.node_id],
    nodes: [node],
    edges: [],
    coverage: completeCoverage,
    limitations: [],
  });
};

const nativeEvidence = (sha256: string | undefined, ordinal: number) =>
  createEvidence(
    sha256 === undefined
      ? undefined
      : {
          path: `/fixture/native-${ordinal}.js`,
          sha256,
          format: "javascript",
        },
    { id: "fixture", name: "Fixture", version: "1" },
    {
      operation: "analyze_javascript_module",
      parameters: { ordinal },
      confidence: "observed",
      authority: "shipped-artifact",
      result: { ordinal },
    },
  );

const occurrenceGraph = (
  rootSha256: string,
  occurrence: JsonValue,
): JavaScriptApplicationGraph => {
  const sourceSha256 = "c".repeat(64);
  const module = createJavaScriptApplicationNode({
    kind: "javascript-module",
    identity: {
      strategy: "artifact-local-key",
      stability: "artifact-version",
      artifact_sha256: sourceSha256,
      namespace: "source-module",
      key: `${rootSha256}:main.js`,
    },
    observations: [
      {
        label: "main.js",
        properties: {
          semantic_role: "source-module",
          source_sha256: sourceSha256,
          file_occurrence: occurrence,
        },
        evidence: artifactEvidence(sourceSha256, "main.js"),
      },
    ],
  });
  return createJavaScriptApplicationGraph({
    schema: "JavaScriptApplicationGraph",
    root_node_ids: [module.node_id],
    nodes: [module],
    edges: [],
    coverage: completeCoverage,
    limitations: [],
  });
};

const occurrenceDifferences: readonly {
  readonly name: string;
  readonly leftOccurrence: JsonValue;
  readonly rightOccurrence: JsonValue;
}[] = [
  {
    name: "path",
    leftOccurrence: {
      container_sha256: LEFT_SHA,
      path: "main.js",
      sha256: "c".repeat(64),
    },
    rightOccurrence: {
      container_sha256: RIGHT_SHA,
      path: "moved.js",
      sha256: "c".repeat(64),
    },
  },
  {
    name: "content digest",
    leftOccurrence: {
      container_sha256: LEFT_SHA,
      path: "main.js",
      sha256: "c".repeat(64),
    },
    rightOccurrence: {
      container_sha256: RIGHT_SHA,
      path: "main.js",
      sha256: "d".repeat(64),
    },
  },
  {
    name: "noncanonical data",
    leftOccurrence: { container_sha256: LEFT_SHA },
    rightOccurrence: { container_sha256: RIGHT_SHA },
  },
];

it.each(occurrenceDifferences)(
  "keeps occurrence $name differences visible without altering source evidence",
  ({ leftOccurrence, rightOccurrence }) => {
    const left = occurrenceGraph(LEFT_SHA, leftOccurrence);
    const right = occurrenceGraph(RIGHT_SHA, rightOccurrence);
    const original = JSON.stringify([left, right]);
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

    expect(result.items).toMatchObject([
      {
        status: "changed",
        match: { basis: "exact-module-source-digest", confidence: "exact" },
        dimensions: ["properties"],
      },
    ]);
    expect(JSON.stringify([left, right])).toBe(original);
    expect(left.nodes[0]?.observations[0]?.properties.file_occurrence).toEqual(
      leftOccurrence,
    );
    expect(right.nodes[0]?.observations[0]?.properties.file_occurrence).toEqual(
      rightOccurrence,
    );
    expect(left.nodes[0]?.observations[0]?.evidence).toEqual(
      right.nodes[0]?.observations[0]?.evidence,
    );
  },
);

describe("application version comparison Evidence links", () => {
  it("links every exact digest observation only to its paired or unmatched item", () => {
    const left = buildGraph(LEFT_SHA, 1);
    const right = buildGraph(RIGHT_SHA, 2);
    const leftEvidenceId = `ev_${"1".repeat(64)}`;
    const rightEvidenceId = `ev_${"2".repeat(64)}`;
    const leftBDigest = `${"0".repeat(63)}1`;
    const leftNative = [
      nativeEvidence(leftBDigest, 1),
      nativeEvidence(leftBDigest, 2),
      nativeEvidence("9".repeat(64), 3),
    ];
    const rightNative = [
      nativeEvidence("0".repeat(64), 4),
      nativeEvidence(undefined, 6),
    ];
    const unrelatedRight = unrelatedGraph(RIGHT_SHA);
    const unmatched = compareJavaScriptApplicationVersions({
      left: {
        evidenceId: leftEvidenceId,
        rootArtifactSha256: LEFT_SHA,
        graph: left,
      },
      right: {
        evidenceId: rightEvidenceId,
        rootArtifactSha256: RIGHT_SHA,
        graph: unrelatedRight,
      },
      leftNativeEvidence: leftNative,
      rightNativeEvidence: rightNative,
    });
    const leftB = left.nodes.find(({ observations }) =>
      observations.some(({ label }) => label === "b.js"),
    );
    if (leftB === undefined) throw new Error("Missing left b.js node");
    const unmatchedB = unmatched.items.find(
      ({ left_node_id: id }) => id === leftB.node_id,
    );
    expect(unmatchedB?.evidence_links).toEqual(
      [
        leftEvidenceId,
        rightEvidenceId,
        leftNative[0]!.evidence_id,
        leftNative[1]!.evidence_id,
      ].sort(),
    );
    const unrelatedItem = unmatched.items.find(
      ({ right_node_id: id }) => id === unrelatedRight.nodes[0]?.node_id,
    );
    expect(unrelatedItem?.evidence_links).toEqual(
      [leftEvidenceId, rightEvidenceId].sort(),
    );

    const paired = compareJavaScriptApplicationVersions({
      left: {
        evidenceId: leftEvidenceId,
        rootArtifactSha256: LEFT_SHA,
        graph: left,
      },
      right: {
        evidenceId: rightEvidenceId,
        rootArtifactSha256: RIGHT_SHA,
        graph: right,
      },
      leftNativeEvidence: [nativeEvidence("0".repeat(64), 5)],
      rightNativeEvidence: rightNative,
    });
    const leftA = left.nodes.find(({ observations }) =>
      observations.some(({ label }) => label === "a.js"),
    );
    if (leftA === undefined) throw new Error("Missing left a.js node");
    const pairedA = paired.items.find(
      ({ left_node_id: id }) => id === leftA.node_id,
    );
    expect(pairedA?.match.status).toBe("matched");
    expect(pairedA?.evidence_links).toEqual(
      [
        leftEvidenceId,
        rightEvidenceId,
        nativeEvidence("0".repeat(64), 5).evidence_id,
        rightNative[0]!.evidence_id,
      ].sort(),
    );
  });
});

describe("application version comparison graph ownership", () => {
  it("returns a sealed change graph that passes complete validation", () => {
    const result = compare();
    expect(
      result.graph.edges.some(({ relation }) => relation === "changed_from"),
    ).toBe(true);
    expect(isValidatedImmutableJavaScriptApplicationGraph(result.graph)).toBe(
      true,
    );
    expect(Object.isFrozen(result.graph.edges)).toBe(true);
    expect(parseJavaScriptApplicationGraph(result.graph)).toEqual(result.graph);
    expect(applicationVersionComparisonResultSchema.parse(result)).toEqual(
      result,
    );
  });

  it("retains deduplicated complete input limits on the change graph and inferred edge", () => {
    const leftLimits = [
      { name: "modules", value: 100, unit: "items" as const },
    ];
    const rightLimits = [
      { name: "source-bytes", value: 4096, unit: "bytes" as const },
      { name: "modules", value: 100, unit: "items" as const },
    ];
    const withLimits = (
      graph: JavaScriptApplicationGraph,
      limits: JavaScriptApplicationGraph["coverage"]["limits"],
    ): JavaScriptApplicationGraph => {
      const { graph_id: _graphId, ...input } = graph;
      return createJavaScriptApplicationGraph({
        ...input,
        coverage: { ...graph.coverage, limits },
      });
    };
    const result = compareJavaScriptApplicationVersions({
      left: {
        evidenceId: `ev_${"1".repeat(64)}`,
        rootArtifactSha256: LEFT_SHA,
        graph: withLimits(buildGraph(LEFT_SHA, 1), leftLimits),
      },
      right: {
        evidenceId: `ev_${"2".repeat(64)}`,
        rootArtifactSha256: RIGHT_SHA,
        graph: withLimits(buildGraph(RIGHT_SHA, 2), rightLimits),
      },
      leftNativeEvidence: [],
      rightNativeEvidence: [],
    });
    const expectedLimits = [leftLimits[0]!, rightLimits[0]!];
    const changed = result.graph.edges.find(
      ({ relation }) => relation === "changed_from",
    );

    expect(changed).toBeDefined();
    expect(result.graph.coverage).toMatchObject({
      status: "complete",
      truncated: false,
      omitted_count: 0,
      limits: expectedLimits,
    });
    expect(changed?.evidence.coverage).toMatchObject({
      status: "complete",
      truncated: false,
      omitted_count: 0,
      limits: expectedLimits,
    });
  });

  it("does not reuse a change graph without an owned proof", () => {
    const result = compare();
    const copy = structuredClone(result.graph);
    expect(isValidatedImmutableJavaScriptApplicationGraph(copy)).toBe(false);
    expect(() =>
      ownedApplicationVersionComparisonResultSchema.parse({
        ...result,
        graph: copy,
      }),
    ).toThrow();
    expect(
      applicationVersionComparisonResultSchema.parse({ ...result, graph: copy })
        .graph,
    ).toEqual(result.graph);
  });

  it("keeps coverage validation for owned results", () => {
    const result = compare();
    expect(() =>
      ownedApplicationVersionComparisonResultSchema.parse({
        ...result,
        coverage: { ...result.coverage, status: "partial" },
      }),
    ).toThrow("Comparison coverage must match source graph completeness");
  });
});
