import { describe, expect, it } from "vitest";
import {
  computeJavaScriptApplicationGraphSha256,
  createJavaScriptApplicationEdge,
  createJavaScriptApplicationGraph,
  createJavaScriptApplicationNode,
  mergeJavaScriptApplicationNodes,
  javascriptApplicationGraphSchema,
  parseJavaScriptApplicationGraph,
  serializeJavaScriptApplicationGraph,
  type JavaScriptApplicationGraph,
} from "./javascriptApplicationGraph.js";
import {
  APPLICATION_GRAPH_DIGESTS,
  artifactEvidence,
  buildSyntheticJavaScriptApplicationGraph,
  completeCoverage,
  contentNode,
  firstOf,
  graphForNode,
  inferredArtifactEvidence,
  nodeByLabel,
  runtimeEvidence,
  sourceMapReference,
  unknownEvidence,
} from "./javascriptApplicationGraph.fixture.js";

it("merges observations by entity identity without changing source nodes", () => {
  const evidence = artifactEvidence(APPLICATION_GRAPH_DIGESTS.asar, "main.js");
  const first = contentNode(evidence, { selected: "first" });
  const second = contentNode(evidence, { selected: "second" });
  const reversedIdentity = {
    sha256: APPLICATION_GRAPH_DIGESTS.asar,
    stability: "global-exact" as const,
    strategy: "content-digest" as const,
  };
  const merged = mergeJavaScriptApplicationNodes([
    first,
    { ...second, identity: reversedIdentity },
    first,
  ]);
  expect(merged).toHaveLength(1);
  const node = firstOf(merged, "merged node");
  expect(node.node_id).toBe(first.node_id);
  expect(node.observations.map(({ properties }) => properties)).toEqual(
    expect.arrayContaining([{ selected: "first" }, { selected: "second" }]),
  );
  expect(node.observations).toHaveLength(2);
  expect(first.observations).toHaveLength(1);
  expect(second.observations).toHaveLength(1);
  const graph = graphForNode(node);
  expect(parseJavaScriptApplicationGraph(graph)).toEqual(graph);
});

it.each(["kind", "identity"] as const)(
  "rejects colliding entity IDs with a different %s before merging observations",
  (field) => {
    const node = contentNode(
      artifactEvidence(APPLICATION_GRAPH_DIGESTS.asar, "main.js"),
    );
    const conflicting =
      field === "kind"
        ? { ...node, kind: "javascript-asset" as const }
        : {
            ...node,
            identity: {
              strategy: "content-digest" as const,
              stability: "global-exact" as const,
              sha256: "f".repeat(64),
            },
          };
    expect(() => mergeJavaScriptApplicationNodes([node, conflicting])).toThrow(
      "Colliding JAG node identifiers disagree",
    );
    expect(node.observations).toHaveLength(1);
  },
);

const createLargeNativeExportGraph = (): JavaScriptApplicationGraph => {
  const properties = Object.fromEntries(
    Array.from({ length: 1_001 }, (_, index) => [
      `${"export-property-"}${"k".repeat(120)}-${index}`,
      "v".repeat(4_097),
    ]),
  );
  const nodes = Array.from({ length: 1_001 }, (_, index) => {
    const path = `native/exports/${index}.symbol`;
    return createJavaScriptApplicationNode({
      kind: "native-export",
      identity: {
        strategy: "canonical-path",
        stability: "artifact-version",
        artifact_sha256: APPLICATION_GRAPH_DIGESTS.nativeAddon,
        path,
      },
      observations: [
        {
          label: index === 0 ? "large export graph label ".repeat(300) : path,
          properties: index === 0 ? properties : {},
          evidence: artifactEvidence(
            APPLICATION_GRAPH_DIGESTS.nativeAddon,
            path,
            "native-analysis-provider",
          ),
        },
      ],
    });
  });
  const first = nodes[0];
  if (first === undefined) throw new TypeError("Missing native export");

  return createJavaScriptApplicationGraph({
    schema: "JavaScriptApplicationGraph",
    root_node_ids: [first.node_id],
    nodes,
    edges: [],
    coverage: {
      status: "complete",
      truncated: false,
      omitted_count: 0,
      limits: [],
    },
    limitations: [],
  });
};

it("accepts deeply nested canonical application properties", () => {
  let nested: unknown = "leaf";
  for (let index = 0; index < 12; index += 1)
    nested = { [`level-${String(index)}`]: nested };
  const node = createJavaScriptApplicationNode({
    kind: "native-export",
    identity: {
      strategy: "canonical-path",
      stability: "artifact-version",
      artifact_sha256: APPLICATION_GRAPH_DIGESTS.nativeAddon,
      path: "native/deep-export",
    },
    observations: [
      {
        label: "deep export",
        properties: { nested },
        evidence: artifactEvidence(
          APPLICATION_GRAPH_DIGESTS.nativeAddon,
          "native/deep-export",
          "native-analysis-provider",
        ),
      },
    ],
  });

  const graph = createJavaScriptApplicationGraph({
    schema: "JavaScriptApplicationGraph",
    root_node_ids: [node.node_id],
    nodes: [node],
    edges: [],
    coverage: {
      status: "complete",
      truncated: false,
      omitted_count: 0,
      limits: [],
    },
    limitations: [],
  });

  expect(graph.nodes[0]?.observations[0]?.properties).toEqual({ nested });
  expect(
    parseJavaScriptApplicationGraph(
      JSON.parse(serializeJavaScriptApplicationGraph(graph)),
    ),
  ).toEqual(graph);
});

describe("JavaScript Application Graph: vocabulary", () => {
  it("round-trips one canonical, byte-stable graph", () => {
    const graph = buildSyntheticJavaScriptApplicationGraph();
    const serialized = serializeJavaScriptApplicationGraph(graph);
    const decoded: unknown = JSON.parse(serialized);

    expect(parseJavaScriptApplicationGraph(decoded)).toEqual(graph);
    expect(javascriptApplicationGraphSchema.parse(decoded)).toEqual(graph);
    expect(serializeJavaScriptApplicationGraph(decoded)).toBe(serialized);
    expect(computeJavaScriptApplicationGraphSha256(decoded)).toMatch(
      /^[a-f0-9]{64}$/u,
    );

    const { graph_id: _graphId, ...semantic } = graph;
    expect(
      createJavaScriptApplicationGraph({
        ...semantic,
        nodes: semantic.nodes.toReversed(),
        edges: semantic.edges.toReversed(),
      }),
    ).toEqual(graph);
  });

  it("keeps large native-export graphs and their complete properties", () => {
    const graph = createLargeNativeExportGraph();
    const largeExport = graph.nodes.find(({ observations }) =>
      observations.some(({ label }) =>
        label?.startsWith("large export graph label "),
      ),
    );

    expect(graph.nodes).toHaveLength(1_001);
    expect(
      Object.keys(largeExport?.observations[0]?.properties ?? {}),
    ).toHaveLength(1_001);
  });

  it("represents the synthetic ASAR to preload to IPC to native chain", () => {
    const graph = buildSyntheticJavaScriptApplicationGraph();
    const labels = [
      "resources/app.asar",
      "desktop preload",
      "desktopApi",
      "project:open",
      "project open handler",
      "synthetic.node",
      "openProject",
    ];
    const chain = labels.map((label) => nodeByLabel(graph, label));
    const expectedRelations = [
      "contains",
      "exposes",
      "invokes",
      "handles",
      "loads",
      "contains",
    ];

    for (let index = 0; index < expectedRelations.length; index += 1)
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          source_node_id: chain[index]?.node_id,
          target_node_id: chain[index + 1]?.node_id,
          relation: expectedRelations[index],
        }),
      );
    expect(chain.at(-2)?.kind).toBe("native-addon");
    expect(chain.at(-1)?.kind).toBe("native-export");
  });
});

describe("JavaScript Application Graph: evidence authority", () => {
  it("keeps static observations, static inferences, runtime facts, and native facts distinct", () => {
    const graph = buildSyntheticJavaScriptApplicationGraph();
    const preload = nodeByLabel(graph, "desktop preload");
    const runtime = nodeByLabel(graph, "preload runtime script");
    const nativeExport = nodeByLabel(graph, "openProject");
    const invoke = graph.edges.find(({ relation }) => relation === "invokes");
    const observedAs = graph.edges.find(
      ({ relation }) => relation === "observed_as",
    );

    expect(preload.observations[0]?.evidence).toMatchObject({
      authority: "ast-static-analysis",
      state: "observed",
    });
    expect(invoke?.evidence).toMatchObject({
      authority: "static-relationship-inference",
      state: "inferred",
    });
    expect(runtime.observations[0]?.evidence).toMatchObject({
      authority: "passive-cdp-runtime",
      state: "observed",
    });
    expect(observedAs?.evidence.authority).toBe("passive-cdp-runtime");
    expect(observedAs?.identifier_strategy).toEqual({
      strategy: "semantic-content-sha256",
      stability: "relationship-exact",
    });
    expect(runtime.observations[0]?.identifier_strategy).toEqual({
      strategy: "semantic-content-sha256",
      stability: "observation-exact",
    });
    expect(nativeExport.observations[0]?.evidence.authority).toBe(
      "native-analysis-provider",
    );
    expect(preload.node_id).not.toBe(runtime.node_id);
  });

  it("retains explicit unknown observations without using them as identity proof", () => {
    const node = createJavaScriptApplicationNode({
      kind: "javascript-module",
      identity: {
        strategy: "content-digest",
        stability: "global-exact",
        sha256: APPLICATION_GRAPH_DIGESTS.asar,
      },
      observations: [
        {
          label: "observed module",
          properties: {},
          evidence: artifactEvidence(
            APPLICATION_GRAPH_DIGESTS.asar,
            "dist/module.js",
          ),
        },
        {
          label: null,
          properties: { question: "runtime correspondence" },
          evidence: unknownEvidence(),
        },
      ],
    });

    const graph = graphForNode(node);
    expect(
      graph.nodes[0]?.observations.find(
        ({ evidence }) => evidence.state === "unknown",
      )?.evidence,
    ).toMatchObject({ authority: "unknown", confidence: "unknown" });
  });

  it("separates stable entity identity from changing observations", () => {
    const identity = {
      strategy: "canonical-path" as const,
      stability: "artifact-version" as const,
      artifact_sha256: APPLICATION_GRAPH_DIGESTS.asar,
      path: "dist/chunk.js",
    };
    const first = createJavaScriptApplicationNode({
      kind: "javascript-chunk",
      identity,
      observations: [
        {
          label: "first label",
          properties: { modules: 10 },
          evidence: artifactEvidence(
            APPLICATION_GRAPH_DIGESTS.asar,
            "dist/chunk.js",
            "ast-static-analysis",
          ),
        },
      ],
    });
    const second = createJavaScriptApplicationNode({
      kind: "javascript-chunk",
      identity,
      observations: [
        {
          label: "renamed chunk",
          properties: { modules: 11 },
          evidence: artifactEvidence(
            APPLICATION_GRAPH_DIGESTS.asar,
            "dist/chunk.js",
            "ast-static-analysis",
          ),
        },
      ],
    });

    expect(first.node_id).toBe(second.node_id);
    expect(first.observations[0]?.observation_id).not.toBe(
      second.observations[0]?.observation_id,
    );
  });
});

describe("JavaScript Application Graph: identity and evidence", () => {
  it("normalizes structural identity and evidence set ordering", () => {
    const evidence = inferredArtifactEvidence(
      APPLICATION_GRAPH_DIGESTS.asar,
      "dist/module.js",
    );
    evidence.limitations = ["z limitation", "a limitation", "a limitation"];
    evidence.evidence_ids = [
      `ev_${"b".repeat(64)}`,
      `ev_${"a".repeat(64)}`,
      `ev_${"a".repeat(64)}`,
    ];
    evidence.coverage.limits = [
      { name: "modules", value: 100, unit: "items" },
      { name: "modules", value: 100, unit: "items" },
    ];
    const node = createJavaScriptApplicationNode({
      kind: "javascript-module",
      identity: {
        strategy: "structural-fingerprint",
        stability: "cross-version-inference",
        algorithm: "synthetic-v1",
        fingerprint_sha256: "5".repeat(64),
        basis: ["syntax-tree", "imports", "syntax-tree"],
      },
      observations: [{ label: "module", properties: {}, evidence }],
    });

    expect(node.identity).toMatchObject({ basis: ["imports", "syntax-tree"] });
    expect(node.observations[0]?.evidence.limitations).toEqual([
      "a limitation",
      "z limitation",
    ]);
    expect(node.observations[0]?.evidence.evidence_ids).toEqual([
      `ev_${"a".repeat(64)}`,
      `ev_${"b".repeat(64)}`,
    ]);
    expect(node.observations[0]?.evidence.coverage.limits).toEqual([
      { name: "modules", value: 100, unit: "items" },
    ]);
    expect(graphForNode(node).nodes).toEqual([node]);
  });

  it("scopes runtime identities to a capture and artifact paths to a version", () => {
    const runtime = nodeByLabel(
      buildSyntheticJavaScriptApplicationGraph(),
      "preload runtime script",
    );
    const differentCapture = createJavaScriptApplicationNode({
      kind: "runtime-script-instance",
      identity: {
        strategy: "runtime-instance",
        stability: "capture-only",
        capture_sha256: "6".repeat(64),
        runtime_key: "script-preload",
      },
      observations: [
        {
          label: "other capture",
          properties: {},
          evidence: {
            ...runtimeEvidence("script-preload"),
            location: {
              available: true,
              value: {
                kind: "runtime",
                capture_sha256: "6".repeat(64),
                target_key: "target-main",
                frame_key: "frame-main",
                script_key: "script-preload",
              },
            },
          },
        },
      ],
    });
    expect(differentCapture.node_id).not.toBe(runtime.node_id);

    const firstArtifact = createJavaScriptApplicationNode({
      kind: "javascript-asset",
      identity: {
        strategy: "canonical-path",
        stability: "artifact-version",
        artifact_sha256: APPLICATION_GRAPH_DIGESTS.asar,
        path: "dist/app.js",
      },
      observations: [
        {
          label: null,
          properties: {},
          evidence: artifactEvidence(
            APPLICATION_GRAPH_DIGESTS.asar,
            "dist/app.js",
          ),
        },
      ],
    });
    const secondArtifact = createJavaScriptApplicationNode({
      kind: "javascript-asset",
      identity: {
        strategy: "canonical-path",
        stability: "artifact-version",
        artifact_sha256: "7".repeat(64),
        path: "dist/app.js",
      },
      observations: [
        {
          label: null,
          properties: {},
          evidence: artifactEvidence("7".repeat(64), "dist/app.js"),
        },
      ],
    });
    expect(firstArtifact.node_id).not.toBe(secondArtifact.node_id);
  });
});

describe("JavaScript Application Graph: source maps and observations", () => {
  it("admits source-map and observation-scoped identities only with supporting observations", () => {
    const sourceModule = createJavaScriptApplicationNode({
      kind: "source-module",
      identity: {
        strategy: "source-map-original",
        source_root: null,
        stability: "source-map-exact",
        source_map_sha256: APPLICATION_GRAPH_DIGESTS.asar,
        original_source: "webpack:///src/editor.ts",
        source_sha256: null,
      },
      observations: [
        {
          label: "src/editor.ts",
          source_map_reference: sourceMapReference(
            "webpack:///src/editor.ts",
            null,
            "dist/app.js.map",
          ),
          properties: { recovered_from: "source-map" },
          evidence: artifactEvidence(
            APPLICATION_GRAPH_DIGESTS.asar,
            "dist/app.js.map",
            "ast-static-analysis",
          ),
        },
      ],
    });
    const observationScoped = createJavaScriptApplicationNode({
      kind: "unknown",
      identity: {
        strategy: "observation-fingerprint",
        stability: "observation-only",
        observation_sha256: "8".repeat(64),
        scope: "synthetic static inventory",
      },
      observations: [
        {
          label: "unclassified entity",
          properties: {},
          evidence: artifactEvidence(
            APPLICATION_GRAPH_DIGESTS.asar,
            "dist/app.js",
          ),
        },
      ],
    });

    expect(graphForNode(sourceModule).nodes).toEqual([sourceModule]);
    expect(graphForNode(observationScoped).nodes).toEqual([observationScoped]);
    const sourceObservation = firstOf(
      sourceModule.observations,
      "source observation",
    );
    const {
      source_map_reference,
      observation_id,
      identifier_strategy,
      ...withoutReference
    } = sourceObservation;
    void observation_id;
    void identifier_strategy;
    expect(() =>
      graphForNode(
        createJavaScriptApplicationNode({
          kind: sourceModule.kind,
          identity: sourceModule.identity,
          observations: [withoutReference],
        }),
      ),
    ).toThrow(/Source-map observation/u);
    expect(() =>
      graphForNode(
        createJavaScriptApplicationNode({
          kind: sourceModule.kind,
          identity: sourceModule.identity,
          observations: [
            {
              ...withoutReference,
              source_map_reference: {
                ...source_map_reference,
                map_path: "different/map.js.map",
              },
            },
          ],
        }),
      ),
    ).toThrow(/Source-map observation/u);
  });
});

describe("JavaScript Application Graph: source-map digest consistency", () => {
  it("rejects source-map observations that contradict a known original digest", () => {
    const sourceMapNode = (
      identityDigest: string | null,
      observedDigest: unknown,
      contentAvailable?: boolean,
    ) =>
      createJavaScriptApplicationNode({
        kind: "source-module",
        identity: {
          strategy: "source-map-original",
          source_root: null,
          stability: "source-map-exact",
          source_map_sha256: APPLICATION_GRAPH_DIGESTS.asar,
          original_source: "src/editor.ts",
          source_sha256: identityDigest,
        },
        observations: [
          {
            label: null,
            source_map_reference: sourceMapReference(
              "src/editor.ts",
              null,
              "dist/app.js.map",
            ),
            properties: {
              ...(contentAvailable === undefined
                ? {}
                : { content_available: contentAvailable }),
              ...(observedDigest === undefined
                ? {}
                : { content_sha256: observedDigest }),
            },
            evidence: artifactEvidence(
              APPLICATION_GRAPH_DIGESTS.asar,
              "dist/app.js.map",
              "ast-static-analysis",
            ),
          },
        ],
      });

    expect(() =>
      graphForNode(sourceMapNode("2".repeat(64), "3".repeat(64))),
    ).toThrow(/Source-map observation/u);
    expect(() => graphForNode(sourceMapNode(null, "3".repeat(64)))).toThrow(
      /Source-map observation/u,
    );
    expect(() => graphForNode(sourceMapNode(null, 7))).toThrow(
      /Source-map observation/u,
    );
    expect(() =>
      graphForNode(sourceMapNode("3".repeat(64), "3".repeat(64))),
    ).not.toThrow();
    expect(() =>
      graphForNode(sourceMapNode("3".repeat(64), "3".repeat(64), false)),
    ).toThrow(/Source-map observation/u);
    expect(() =>
      graphForNode(sourceMapNode("3".repeat(64), null, false)),
    ).toThrow(/Source-map observation/u);
    expect(() =>
      graphForNode(sourceMapNode("3".repeat(64), null, true)),
    ).toThrow(/Source-map observation/u);
    expect(() =>
      graphForNode(sourceMapNode("3".repeat(64), undefined)),
    ).toThrow(/Source-map observation/u);
    expect(() => graphForNode(sourceMapNode(null, null, true))).toThrow(
      /Source-map observation/u,
    );
    expect(() =>
      graphForNode(sourceMapNode("3".repeat(64), "3".repeat(64), undefined)),
    ).not.toThrow();
  });
});

describe("JavaScript Application Graph: commitments and schemas", () => {
  it("rejects unknown fields and stale commitments", () => {
    const graph = buildSyntheticJavaScriptApplicationGraph();
    expect(() =>
      parseJavaScriptApplicationGraph({ ...graph, surprise: true }),
    ).toThrow();

    const staleGraph = structuredClone(graph);
    staleGraph.graph_id = `jag_${"f".repeat(64)}`;
    expect(() => parseJavaScriptApplicationGraph(staleGraph)).toThrow(
      /Graph identifier/u,
    );

    const staleNode = structuredClone(graph);
    firstOf(staleNode.nodes, "node").node_id = `jag_node_${"f".repeat(64)}`;
    expect(() => parseJavaScriptApplicationGraph(staleNode)).toThrow(
      /Node identifier/u,
    );

    const staleObservation = structuredClone(graph);
    firstOf(
      firstOf(staleObservation.nodes, "node").observations,
      "observation",
    ).observation_id = `jag_observation_${"f".repeat(64)}`;
    expect(() => parseJavaScriptApplicationGraph(staleObservation)).toThrow(
      /Observation identifier/u,
    );

    const staleEdge = structuredClone(graph);
    firstOf(staleEdge.edges, "edge").edge_id = `jag_edge_${"f".repeat(64)}`;
    expect(() => parseJavaScriptApplicationGraph(staleEdge)).toThrow(
      /Edge identifier/u,
    );
  });

  it("creates exactly the graph the public schema accepts", () => {
    const graph = buildSyntheticJavaScriptApplicationGraph();
    expect(JSON.stringify(graph)).toBe(
      JSON.stringify(
        javascriptApplicationGraphSchema.parse(structuredClone(graph)),
      ),
    );

    const { graph_id: _graphId, ...semantic } = structuredClone(graph);
    firstOf(semantic.edges, "edge").edge_id = `jag_edge_${"f".repeat(64)}`;
    expect(() => createJavaScriptApplicationGraph(semantic)).toThrow(
      /Edge identifier/u,
    );
  });
});

describe("JavaScript Application Graph: duplicate and orphan rejection", () => {
  it("rejects duplicate nodes, missing roots, dangling edges, and self edges", () => {
    const graph = buildSyntheticJavaScriptApplicationGraph();
    const { graph_id: _graphId, ...semantic } = graph;
    const source = firstOf(semantic.nodes, "node");
    expect(() =>
      createJavaScriptApplicationGraph({
        ...semantic,
        nodes: [...semantic.nodes, source],
      }),
    ).toThrow(/Nodes must be sorted and unique/u);
    expect(() =>
      createJavaScriptApplicationGraph({
        ...semantic,
        root_node_ids: [`jag_node_${"9".repeat(64)}`],
      }),
    ).toThrow(/Root identifier/u);

    const missingId = `jag_node_${"9".repeat(64)}`;
    const dangling = createJavaScriptApplicationEdge({
      source_node_id: source.node_id,
      target_node_id: missingId,
      relation: "loads",
      properties: {},
      evidence: inferredArtifactEvidence(
        APPLICATION_GRAPH_DIGESTS.asar,
        "dist/main.js",
      ),
    });
    expect(() =>
      createJavaScriptApplicationGraph({
        ...semantic,
        edges: [...semantic.edges, dangling],
      }),
    ).toThrow(/endpoints must name graph nodes/u);

    const selfEdge = createJavaScriptApplicationEdge({
      source_node_id: source.node_id,
      target_node_id: source.node_id,
      relation: "imports",
      properties: {},
      evidence: inferredArtifactEvidence(
        APPLICATION_GRAPH_DIGESTS.asar,
        "dist/main.js",
      ),
    });
    expect(() =>
      createJavaScriptApplicationGraph({
        ...semantic,
        edges: [...semantic.edges, selfEdge],
      }),
    ).toThrow(/self-referential/u);
  });

  it("allows changed_from only between entities of the same kind", () => {
    const graph = buildSyntheticJavaScriptApplicationGraph();
    const preload = nodeByLabel(graph, "desktop preload");
    const runtime = nodeByLabel(graph, "preload runtime script");
    const earlierPreload = createJavaScriptApplicationNode({
      kind: "electron-preload",
      identity: {
        strategy: "canonical-path",
        stability: "artifact-version",
        artifact_sha256: "7".repeat(64),
        path: "dist/preload.js",
      },
      observations: [
        {
          label: "earlier preload",
          properties: {},
          evidence: artifactEvidence("7".repeat(64), "dist/preload.js"),
        },
      ],
    });
    const changedFrom = createJavaScriptApplicationEdge({
      source_node_id: preload.node_id,
      target_node_id: earlierPreload.node_id,
      relation: "changed_from",
      properties: {},
      evidence: inferredArtifactEvidence(
        APPLICATION_GRAPH_DIGESTS.asar,
        "dist/preload.js",
      ),
    });
    expect(
      createJavaScriptApplicationGraph({
        schema: "JavaScriptApplicationGraph",
        root_node_ids: [preload.node_id],
        nodes: [preload, earlierPreload],
        edges: [changedFrom],
        coverage: completeCoverage,
        limitations: [],
      }).edges,
    ).toEqual([changedFrom]);

    const invalid = createJavaScriptApplicationEdge({
      source_node_id: preload.node_id,
      target_node_id: runtime.node_id,
      relation: "changed_from",
      properties: {},
      evidence: inferredArtifactEvidence(
        APPLICATION_GRAPH_DIGESTS.asar,
        "dist/preload.js",
      ),
    });
    expect(() =>
      createJavaScriptApplicationGraph({
        schema: "JavaScriptApplicationGraph",
        root_node_ids: [preload.node_id],
        nodes: [preload, runtime],
        edges: [invalid],
        coverage: completeCoverage,
        limitations: [],
      }),
    ).toThrow(/changed_from endpoints must have the same node kind/u);
  });
});

describe("JavaScript Application Graph: identity strategy requirements", () => {
  it("requires every identity strategy to have compatible supporting evidence", () => {
    const mismatchedPath = createJavaScriptApplicationNode({
      kind: "javascript-asset",
      identity: {
        strategy: "canonical-path",
        stability: "artifact-version",
        artifact_sha256: APPLICATION_GRAPH_DIGESTS.asar,
        path: "dist/expected.js",
      },
      observations: [
        {
          label: null,
          properties: {},
          evidence: artifactEvidence(
            APPLICATION_GRAPH_DIGESTS.asar,
            "dist/other.js",
          ),
        },
      ],
    });
    expect(() => graphForNode(mismatchedPath)).toThrow(
      /identity is not supported/u,
    );

    const runtimeWithStaticEvidence = createJavaScriptApplicationNode({
      kind: "runtime-script-instance",
      identity: {
        strategy: "runtime-instance",
        stability: "capture-only",
        capture_sha256: APPLICATION_GRAPH_DIGESTS.capture,
        runtime_key: "script-preload",
      },
      observations: [
        {
          label: null,
          properties: {},
          evidence: artifactEvidence(
            APPLICATION_GRAPH_DIGESTS.asar,
            "dist/preload.js",
            "ast-static-analysis",
          ),
        },
      ],
    });
    expect(() => graphForNode(runtimeWithStaticEvidence)).toThrow(
      /identity is not supported/u,
    );

    const mismatchedDigest = contentNode(
      artifactEvidence("7".repeat(64), "dist/module.js"),
    );
    expect(() => graphForNode(mismatchedDigest)).toThrow(
      /identity is not supported/u,
    );
  });

  it.each([
    { start: { line: 2, column: 0 }, end: { line: 1, column: 9 } },
    { start: { line: 1, column: 9 }, end: { line: 1, column: 0 } },
  ])("rejects reversed source locations on graph facts: %j", (range) => {
    const evidence = artifactEvidence(
      APPLICATION_GRAPH_DIGESTS.asar,
      "dist/module.js",
      "ast-static-analysis",
    );
    evidence.location = {
      available: true,
      value: { kind: "source-range", source: "dist/module.js", ...range },
    };
    expect(() => graphForNode(contentNode(evidence))).toThrow(
      /Source range end must not precede its start/u,
    );
  });

  it.each(["ast-static-analysis", "managed-static-analysis"] as const)(
    "prevents %s from claiming runtime locations",
    (authority) => {
      const evidence = artifactEvidence(
        APPLICATION_GRAPH_DIGESTS.asar,
        "dist/module.js",
        authority,
      );
      evidence.location = runtimeEvidence("script-module").location;
      expect(() => graphForNode(contentNode(evidence))).toThrow(
        /cannot claim a runtime location/u,
      );
    },
  );

  it("enforces epistemic truthfulness and content-addressed artifacts", () => {
    const inferredAsObserved = inferredArtifactEvidence(
      APPLICATION_GRAPH_DIGESTS.asar,
      "dist/module.js",
    );
    inferredAsObserved.state = "observed";
    inferredAsObserved.confidence = "exact";
    expect(() => contentNode(inferredAsObserved)).toThrow(
      /must remain inferred/u,
    );

    const inferenceWithoutLimit = inferredArtifactEvidence(
      APPLICATION_GRAPH_DIGESTS.asar,
      "dist/module.js",
    );
    inferenceWithoutLimit.limitations = [];
    expect(() => contentNode(inferenceWithoutLimit)).toThrow(
      /Inferred facts require an explicit limitation/u,
    );

    const unknownWithoutLimit = unknownEvidence([]);
    expect(() => contentNode(unknownWithoutLimit)).toThrow(
      /require unknown confidence and an explicit limitation/u,
    );

    const missingArtifact = artifactEvidence(
      APPLICATION_GRAPH_DIGESTS.asar,
      "dist/module.js",
    );
    missingArtifact.artifact = {
      available: false,
      reason: "not-observed",
      detail: "Bytes were not observed.",
    };
    expect(() => contentNode(missingArtifact)).toThrow(
      /require a content digest/u,
    );

    const mismatchedArtifact = artifactEvidence(
      APPLICATION_GRAPH_DIGESTS.asar,
      "dist/module.js",
    );
    if (mismatchedArtifact.artifact.available)
      mismatchedArtifact.artifact.artifact_id = `art_${"8".repeat(64)}`;
    expect(() => contentNode(mismatchedArtifact)).toThrow(
      /same SHA-256 digest/u,
    );

    const unlocatedObservation = artifactEvidence(
      APPLICATION_GRAPH_DIGESTS.asar,
      "dist/module.js",
    );
    unlocatedObservation.location = {
      available: false,
      reason: "not-observed",
      detail: "The exact location was not recorded.",
    };
    expect(() => contentNode(unlocatedObservation)).toThrow(
      /Observed facts require an actionable location/u,
    );
  });
});

describe("JavaScript Application Graph: truncation claims", () => {
  it("rejects false truncation claims and accepts large properties", () => {
    const truncated = artifactEvidence(
      APPLICATION_GRAPH_DIGESTS.asar,
      "dist/module.js",
    );
    truncated.coverage = {
      status: "partial",
      truncated: true,
      omitted_count: 0,
      limits: [],
    };
    expect(() => contentNode(truncated)).toThrow(/omitted_count[\s\S]*limits/u);

    const nonComplete = artifactEvidence(
      APPLICATION_GRAPH_DIGESTS.asar,
      "dist/module.js",
    );
    nonComplete.coverage = {
      status: "partial",
      truncated: false,
      omitted_count: null,
      limits: [],
    };
    expect(() => contentNode(nonComplete)).toThrow(
      /Non-complete coverage requires an explicit limitation/u,
    );

    const validNode = contentNode(
      artifactEvidence(APPLICATION_GRAPH_DIGESTS.asar, "dist/module.js"),
    );
    expect(() =>
      createJavaScriptApplicationGraph({
        schema: "JavaScriptApplicationGraph",
        root_node_ids: [validNode.node_id],
        nodes: [validNode],
        edges: [],
        coverage: {
          status: "partial",
          truncated: false,
          omitted_count: null,
          limits: [],
        },
        limitations: [],
      }),
    ).toThrow(/Non-complete graph coverage requires an explicit limitation/u);

    const properties = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`key-${String(index)}`, index]),
    );
    expect(
      contentNode(
        artifactEvidence(APPLICATION_GRAPH_DIGESTS.asar, "dist/module.js"),
        properties,
      ).observations[0]?.properties,
    ).toEqual(properties);
  });
});
