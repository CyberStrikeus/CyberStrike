import { describe, expect, it } from "vitest";

import {
  createJavaScriptApplicationGraph,
  createJavaScriptApplicationNode,
} from "./javascriptApplicationGraph.js";
import type { ApplicationNode } from "./javascriptApplicationGraphSchemas.js";
import {
  artifactEvidence,
  completeCoverage,
} from "./javascriptApplicationGraph.fixture.js";
import { findApplicationFeatureSeeds } from "./javascriptFeatureSeed.js";
import { traceApplicationFeature } from "./javascriptFeatureTrace.js";
import {
  applicationFeatureSeedSchema,
  type ApplicationFeatureSeed,
} from "./javascriptFeatureTraceSchemas.js";
import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import type { JsonValue } from "../jsonValue.js";

const memberFields = [
  { kind: "api", nodeKind: "context-bridge-api", field: "members" },
  { kind: "api", nodeKind: "context-bridge-api", field: "methods" },
  { kind: "module", nodeKind: "javascript-asset", field: "exports" },
  { kind: "module", nodeKind: "javascript-module", field: "exports" },
  { kind: "module", nodeKind: "source-module", field: "exports" },
  {
    kind: "native-export",
    nodeKind: "native-export",
    field: "requested_members",
  },
  { kind: "native-export", nodeKind: "native-export", field: "members" },
] as const;

const matchingModes = [
  { value: "openProject", match: null, case_sensitive: true },
  { value: "openProject", match: "exact", case_sensitive: true },
  { value: "openProj", match: "contains", case_sensitive: true },
  { value: "OPENPROJECT", match: "exact", case_sensitive: false },
  { value: "OPENPROJ", match: "contains", case_sensitive: false },
] as const;

describe.each(memberFields)(
  "$kind seeds for $nodeKind / $field",
  ({ kind, nodeKind, field }) => {
    it("retains scalar and array member locations", () => {
      const values: readonly [JsonValue, string][] = [
        ["openProject", ""],
        [["closeProject", "openProject"], "[1]"],
      ];
      for (const [value, suffix] of values) {
        const node = memberNode(nodeKind, { [field]: value });
        expect(findApplicationFeatureSeeds([node], seed(kind))).toEqual([
          propertyMatch(node, `${field}${suffix}`),
        ]);
      }
    });
  },
);

describe("shared array-member matching semantics", () => {
  const kind = "api";
  const nodeKind = "context-bridge-api";
  const field = "members";

  it.each(matchingModes)(
    "matches $match / $value / case-sensitive $case_sensitive",
    (mode) => {
      const node = memberNode(nodeKind, {
        members: ["closeProject", "openProject"],
      });
      expect(findApplicationFeatureSeeds([node], { kind, ...mode })).toEqual([
        propertyMatch(node, "members[1]"),
      ]);
    },
  );

  it("keeps exact, case-sensitive, and non-string exclusions", () => {
    const node = memberNode(nodeKind, {
      [field]: [null, 42, true, "openProject"],
    });
    for (const value of ["Project", "OPENPROJECT", "42", "true", "null"])
      expect(findApplicationFeatureSeeds([node], seed(kind, value))).toEqual(
        [],
      );
    expect(
      findApplicationFeatureSeeds([node], {
        ...seed(kind, "Project"),
        match: null,
      }),
    ).toEqual([]);
  });

  it("retains actual indexes through nested arrays and object properties", () => {
    const properties = {
      nested: [{ [field]: [null, 42, false, [["openProject"]]] }],
    };
    const node = memberNode(nodeKind, properties);
    const before = structuredClone(node);

    expect(findApplicationFeatureSeeds([node], seed(kind))).toEqual([
      propertyMatch(node, `nested[0].${field}[3][0][0]`),
    ]);
    expect(node).toEqual(before);
    expect(properties.nested[0]?.[field]).toEqual([
      null,
      42,
      false,
      [["openProject"]],
    ]);
  });

  it("preserves literal dotted-field suffixes for scalars and arrays", () => {
    const values: readonly [JsonValue, string][] = [
      ["openProject", ""],
      [["openProject"], "[0]"],
    ];
    for (const [value, suffix] of values) {
      const node = memberNode(nodeKind, { [`nested.${field}`]: value });
      expect(findApplicationFeatureSeeds([node], seed(kind))).toEqual([
        propertyMatch(node, `nested.${field}${suffix}`),
      ]);
    }
  });

  it("does not select near-fields, literal bracket keys, or object descendants", () => {
    const cases = [
      {
        properties: { [`other_${field}`]: "openProject" },
        path: `other_${field}`,
      },
      { properties: { [`${field}[0]`]: "openProject" }, path: `${field}[0]` },
      {
        properties: { [`nested.${field}[0]`]: ["openProject"] },
        path: `nested.${field}[0][0]`,
      },
      {
        properties: { [field]: { name: "openProject" } },
        path: `${field}.name`,
      },
      {
        properties: { [field]: [{ name: "openProject" }] },
        path: `${field}[0].name`,
      },
    ];
    for (const { properties, path } of cases) {
      const node = memberNode(nodeKind, properties);
      expect(findApplicationFeatureSeeds([node], seed(kind))).toEqual([]);
      expect(findApplicationFeatureSeeds([node], seed("string"))).toEqual([
        propertyMatch(node, path),
      ]);
    }
  });
});

describe("feature seed selection controls", () => {
  it.each([
    { kind: "api", nodeKind: "context-bridge-api", field: "label" },
    { kind: "api", nodeKind: "context-bridge-api", field: "api_name" },
    { kind: "api", nodeKind: "context-bridge-api", field: "key" },
    { kind: "module", nodeKind: "javascript-module", field: "label" },
    { kind: "module", nodeKind: "javascript-module", field: "module_key" },
    { kind: "module", nodeKind: "javascript-module", field: "path" },
    { kind: "module", nodeKind: "javascript-module", field: "source" },
    { kind: "module", nodeKind: "javascript-module", field: "original_source" },
    { kind: "native-export", nodeKind: "native-export", field: "label" },
    { kind: "native-export", nodeKind: "native-export", field: "key" },
    { kind: "route", nodeKind: "endpoint", field: "value" },
    { kind: "route", nodeKind: "endpoint", field: "path" },
    { kind: "channel", nodeKind: "ipc-channel", field: "label" },
    { kind: "channel", nodeKind: "ipc-channel", field: "channel" },
    { kind: "channel", nodeKind: "ipc-channel", field: "key" },
  ] as const)(
    "keeps $kind / $field scalar-only selection unchanged",
    ({ kind, nodeKind, field }) => {
      const scalar = memberNode(nodeKind, {
        endpoint_kind: "route",
        [field]: "openProject",
      });
      const array = memberNode(nodeKind, {
        endpoint_kind: "route",
        [field]: ["openProject"],
      });
      expect(findApplicationFeatureSeeds([scalar], seed(kind))).toEqual([
        propertyMatch(scalar, field),
      ]);
      expect(findApplicationFeatureSeeds([array], seed(kind))).toEqual([]);
      expect(findApplicationFeatureSeeds([array], seed("string"))).toEqual([
        propertyMatch(array, `${field}[0]`),
      ]);
    },
  );

  it("excludes route labels while preserving generic scalar and array matching", () => {
    const scalar = memberNode("endpoint", {
      endpoint_kind: "route",
      label: "route endpoint",
    });
    const array = memberNode("endpoint", {
      endpoint_kind: "route",
      label: ["route endpoint"],
    });

    expect(
      findApplicationFeatureSeeds([scalar], seed("route", "route endpoint")),
    ).toEqual([]);
    expect(
      findApplicationFeatureSeeds([array], seed("route", "route endpoint")),
    ).toEqual([]);
    expect(
      findApplicationFeatureSeeds([scalar], seed("string", "route endpoint")),
    ).toEqual([propertyMatch(scalar, "label")]);
    expect(
      findApplicationFeatureSeeds([array], seed("string", "route endpoint")),
    ).toEqual([propertyMatch(array, "label[0]")]);
  });

  it("keeps generic matching and scalar label and identity selection", () => {
    const node = memberNode("context-bridge-api", { members: ["openProject"] });
    expect(findApplicationFeatureSeeds([node], seed("string"))).toEqual([
      propertyMatch(node, "members[0]"),
    ]);
    expect(
      findApplicationFeatureSeeds([node], seed("api", "desktopApi")),
    ).toEqual([
      {
        node_id: node.node_id,
        kind: node.kind,
        basis: "label",
        field: "observations[0].label",
      },
    ]);
    expect(
      findApplicationFeatureSeeds([node], seed("node-id", node.node_id)),
    ).toEqual([
      {
        node_id: node.node_id,
        kind: node.kind,
        basis: "node-id",
        field: "node_id",
      },
    ]);
    const module = memberNode("javascript-module", {});
    expect(
      findApplicationFeatureSeeds([module], seed("module", "preload.js")),
    ).toEqual([
      {
        node_id: module.node_id,
        kind: module.kind,
        basis: "identity",
        field: "identity.path",
      },
    ]);
  });

  it.each([
    {
      kind: "route",
      nodeKind: "endpoint",
      properties: { endpoint_kind: "route", path: "/projects" },
      value: "/projects",
      field: "path",
    },
    {
      kind: "channel",
      nodeKind: "ipc-channel",
      properties: { channel: "project:open" },
      value: "project:open",
      field: "channel",
    },
  ] as const)(
    "preserves $kind scalar matching and node-kind restrictions",
    ({ kind, nodeKind, properties, value, field }) => {
      const node = memberNode(nodeKind, properties);
      expect(findApplicationFeatureSeeds([node], seed(kind, value))).toEqual([
        propertyMatch(node, field),
      ]);
      expect(
        findApplicationFeatureSeeds(
          [memberNode("context-bridge-api", properties)],
          seed(kind, value),
        ),
      ).toEqual([]);
    },
  );

  it.each(memberFields)(
    "rejects $kind members on an unrelated node kind",
    ({ kind, field }) => {
      const node = memberNode("unknown", { [field]: ["openProject"] });
      expect(findApplicationFeatureSeeds([node], seed(kind))).toEqual([]);
    },
  );
});

describe("feature trace projection from contextBridge source members", () => {
  it("traces one exact member seed while preserving projection facts", () => {
    const mode = {
      value: "openProject",
      match: "exact" as const,
      case_sensitive: true,
    };
    const graph = contextBridgeGraph();
    const before = structuredClone(graph);
    const input = {
      sourceEvidenceId,
      graph,
      nativeEvidence: [],
      direction: "both" as const,
    };
    const generic = traceApplicationFeature({
      ...input,
      seed: { kind: "string", ...mode },
    });
    const typed = traceApplicationFeature({
      ...input,
      seed: { kind: "api", ...mode },
    });

    expect(typed.coverage).toEqual({
      status: "complete-within-source",
      source_graph_status: "complete",
      total_seed_matches: 1,
    });
    expect(typed.seed_matches).toEqual(generic.seed_matches);
    expect(typed.seed_matches).toEqual([
      {
        node_id: graph.nodes[0]?.node_id,
        kind: "context-bridge-api",
        basis: "property",
        field: "observations[0].properties.members[1]",
      },
    ]);
    expect(typed.graph?.nodes).toEqual(graph.nodes);
    expect(typed.graph?.edges).toEqual([]);
    expect(typed.evidence_links).toEqual([sourceEvidenceId]);
    expect(typed.summary).toMatchObject({
      matched_seeds: 1,
      traced_nodes: 1,
      traced_edges: 0,
      observed_facts: 1,
      inferred_facts: 0,
      unknown_facts: 0,
      unavailable_facts: 0,
    });
    expect(typed.native_handoffs).toEqual([]);
    expect(graph).toEqual(before);
  });

  it("keeps a missing member explicit without changing source coverage", () => {
    const graph = contextBridgeGraph();
    const result = traceApplicationFeature({
      sourceEvidenceId,
      graph,
      nativeEvidence: [],
      direction: "both",
      seed: seed("api", "missingProject"),
    });
    expect(result.graph).toBeNull();
    expect(result.seed_matches).toEqual([]);
    expect(result.coverage).toEqual({
      status: "no-match",
      source_graph_status: "complete",
      total_seed_matches: 0,
    });
    expect(result.evidence_links).toEqual([sourceEvidenceId]);
    expect(result.limitations).toContain(
      "No application graph entity matched the literal seed; this is not evidence that the feature is absent.",
    );
  });

  it("retains incomplete source coverage when an array member matches", () => {
    const graph = contextBridgeGraph();
    const { graph_id: _graphId, ...content } = graph;
    const partialGraph = createJavaScriptApplicationGraph({
      ...content,
      limitations: ["Only one source file was analyzed."],
      coverage: {
        status: "partial",
        truncated: false,
        omitted_count: null,
        limits: [],
      },
    });
    const result = traceApplicationFeature({
      sourceEvidenceId,
      graph: partialGraph,
      nativeEvidence: [],
      direction: "both",
      seed: seed("api"),
    });
    expect(result.coverage).toEqual({
      status: "partial",
      source_graph_status: "partial",
      total_seed_matches: 1,
    });
    expect(result.graph?.coverage).toEqual(partialGraph.coverage);
    expect(result.graph?.nodes).toEqual(partialGraph.nodes);
    expect(result.limitations).toContain(
      "The source application graph is incomplete; unmatched seeds and frontiers remain unknown.",
    );
  });
});

const sourceEvidenceId = `ev_${"b".repeat(64)}`;

const seed = (
  kind: ApplicationFeatureSeed["kind"],
  value = "openProject",
): ApplicationFeatureSeed =>
  applicationFeatureSeedSchema.parse({
    kind,
    value,
    match: "exact",
    case_sensitive: true,
  });

const memberNode = (
  kind: ApplicationNode["kind"],
  properties: Readonly<Record<string, JsonValue>>,
): ApplicationNode =>
  createJavaScriptApplicationNode({
    kind,
    identity: {
      strategy: "canonical-path",
      stability: "artifact-version",
      artifact_sha256: "a".repeat(64),
      path: "preload.js",
    },
    observations: [
      {
        label: "desktopApi",
        properties,
        evidence: {
          ...artifactEvidence(
            "a".repeat(64),
            "preload.js",
            "ast-static-analysis",
          ),
          evidence_ids: [sourceEvidenceId],
        },
      },
    ],
  });

const propertyMatch = (node: ApplicationNode, field: string) => ({
  node_id: node.node_id,
  kind: node.kind,
  basis: "property",
  field: `observations[0].properties.${field}`,
});

const contextBridgeGraph = () => {
  const analysis = analyzeJavaScriptStaticSource(
    "const { contextBridge } = require('electron');\ncontextBridge.exposeInMainWorld('desktopApi', { openProject() {}, closeProject() {} });",
  );
  expect(analysis.parse_status).toBe("complete");
  const finding = analysis.electron.context_bridge_apis[0];
  if (finding === undefined) throw new Error("Expected contextBridge finding");
  expect(finding.api_key).toBe("desktopApi");
  expect(finding.members).toEqual(["closeProject", "openProject"]);
  expect(finding.unknown_members).toBe(0);
  const node = memberNode("context-bridge-api", {
    api_name: finding.api_key,
    members: [...finding.members],
    unknown_members: finding.unknown_members,
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
