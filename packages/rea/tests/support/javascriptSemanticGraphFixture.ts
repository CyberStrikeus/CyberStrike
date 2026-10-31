import type { JsonValue } from "../../src/domain/jsonValue.js";
import type { ApplicationGraphEvidence } from "../../src/domain/javascript/javascriptApplicationEvidenceSchemas.js";
import {
  JAVASCRIPT_SEMANTIC_NODE_KINDS,
  JAVASCRIPT_SEMANTIC_RELATION_FAMILIES,
  type JavaScriptSemanticGraphInput,
  type JavaScriptSemanticGraphNode,
} from "../../src/domain/javascript/javascriptSemanticGraphSchemas.js";
import {
  createJavaScriptSemanticFingerprint,
  createJavaScriptSemanticGraph,
  createJavaScriptSemanticGraphNode,
  createJavaScriptSemanticGraphRelation,
  createJavaScriptSemanticGraphUnknown,
  JavaScriptSemanticEvidenceContextRegistry,
  type JavaScriptSemanticGraph,
} from "../../src/domain/javascript/javascriptSemanticGraph.js";

const SHA = "a".repeat(64);
const JAG_ID = `jag_${"b".repeat(64)}`;
const completeCoverage = {
  status: "complete",
  truncated: false,
  omitted_count: 0,
  limits: [],
} satisfies ApplicationGraphEvidence["coverage"];

export const semanticGraphTestEvidence = (
  state: "observed" | "inferred" = "observed",
): ApplicationGraphEvidence => ({
  authority:
    state === "observed"
      ? "ast-static-analysis"
      : "static-relationship-inference",
  state,
  confidence: state === "observed" ? "exact" : "high",
  artifact: { available: true, artifact_id: `art_${SHA}`, sha256: SHA },
  location: {
    available: true,
    value: {
      kind: "source-range",
      source: "bundle.js",
      start: { line: 1, column: 0 },
      end: { line: 1, column: 10 },
    },
  },
  extractor: {
    name: "test",
    version: "1",
    operation: "recover-semantic-relation",
    executable_sha256: null,
  },
  coverage: completeCoverage,
  limitations:
    state === "observed"
      ? []
      : ["Static reachability does not prove runtime execution."],
  evidence_ids: [],
});

export const unknownSemanticGraphTestEvidence =
  (): ApplicationGraphEvidence => ({
    authority: "unknown",
    state: "unknown",
    confidence: "unknown",
    artifact: {
      available: false,
      reason: "unknown",
      detail: "Unknown artifact.",
    },
    location: {
      available: false,
      reason: "unresolved",
      detail: "Dynamic call target.",
    },
    extractor: {
      name: "test",
      version: "1",
      operation: "retain-dynamic-call",
      executable_sha256: null,
    },
    coverage: {
      status: "unknown",
      truncated: false,
      omitted_count: null,
      limits: [],
    },
    limitations: ["Dynamic call target remains unknown."],
    evidence_ids: [],
  });

const fixtureNode = (
  kind: (typeof JAVASCRIPT_SEMANTIC_NODE_KINDS)[number],
  role: string,
  properties: Record<string, JsonValue> = {},
  evidenceContexts: JavaScriptSemanticEvidenceContextRegistry,
): JavaScriptSemanticGraphNode =>
  createJavaScriptSemanticGraphNode(
    {
      kind,
      identity: {
        artifact_sha256: SHA,
        module_path: "bundle.js",
        source_range: {
          start: { line: 1, column: role.length },
          end: { line: 1, column: role.length + 1 },
        },
        role_key: role,
      },
      function_node_id: null,
      application_node_ids: [],
      label: role,
      properties,
      evidence: semanticGraphTestEvidence(),
    },
    evidenceContexts,
  );

export const semanticFixtureInput = (
  withUnknown = false,
): JavaScriptSemanticGraphInput => {
  const evidenceContexts = new JavaScriptSemanticEvidenceContextRegistry();
  const module = fixtureNode("module", "module", {}, evidenceContexts);
  const literal = fixtureNode(
    "literal",
    "literal",
    { value: "TOKEN" },
    evidenceContexts,
  );
  const binding = fixtureNode("binding", "binding", {}, evidenceContexts);
  const callable = fixtureNode("function", "function", {}, evidenceContexts);
  const request = fixtureNode(
    "request",
    "request",
    {
      endpoint: "https://example.invalid/v1",
    },
    evidenceContexts,
  );
  const relations = [
    createJavaScriptSemanticGraphRelation(
      {
        source_node_id: literal.node_id,
        target_node_id: binding.node_id,
        relation: "defines",
        resolution: "resolved",
        properties: {},
        evidence: semanticGraphTestEvidence("inferred"),
      },
      evidenceContexts,
    ),
    createJavaScriptSemanticGraphRelation(
      {
        source_node_id: binding.node_id,
        target_node_id: callable.node_id,
        relation: "captures",
        resolution: "resolved",
        properties: {},
        evidence: semanticGraphTestEvidence("inferred"),
      },
      evidenceContexts,
    ),
    createJavaScriptSemanticGraphRelation(
      {
        source_node_id: callable.node_id,
        target_node_id: request.node_id,
        relation: "constructs-request",
        resolution: "resolved",
        properties: {},
        evidence: semanticGraphTestEvidence("inferred"),
      },
      evidenceContexts,
    ),
  ];
  const dynamic = withUnknown
    ? createJavaScriptSemanticGraphUnknown(
        {
          node_id: callable.node_id,
          family: "call-flow",
          relation_kinds: ["calls"],
          reason: "dynamic-call",
          detail: "Computed callee is unresolved.",
          candidate_node_ids: [],
          evidence: unknownSemanticGraphTestEvidence(),
        },
        evidenceContexts,
      )
    : null;
  const unknowns = dynamic === null ? [] : [dynamic];
  const coverageFamilies = JAVASCRIPT_SEMANTIC_RELATION_FAMILIES.map(
    (family) => ({
      family,
      status:
        withUnknown && family === "call-flow"
          ? ("unknown" as const)
          : ("complete" as const),
      retained_relations: relations.filter(({ relation }) =>
        relation === "defines"
          ? family === "data-flow"
          : relation === "captures"
            ? family === "closure"
            : family === "request",
      ).length,
      omitted_relations: withUnknown && family === "call-flow" ? null : 0,
      unknown_ids:
        dynamic !== null && family === "call-flow" ? [dynamic.unknown_id] : [],
    }),
  );
  const fingerprint = createJavaScriptSemanticFingerprint(
    {
      function_node_id: callable.node_id,
      algorithm: "rea.javascript-semantic-function",
      status: "complete",
      components: {
        parameter_arity: 0,
        normalized_ast_sha256: "1".repeat(64),
        control_flow_sha256: "2".repeat(64),
        relation_shape_sha256: "3".repeat(64),
        literal_set_sha256: "4".repeat(64),
        effects: ["network"],
      },
      limitations: [],
      evidence: semanticGraphTestEvidence("inferred"),
    },
    evidenceContexts,
  );
  return {
    schema: "JavaScriptSemanticRelationGraph",
    root_artifact_sha256: SHA,
    application_graph_id: JAG_ID,
    root_node_ids: [module.node_id],
    evidence_contexts: evidenceContexts.contexts,
    nodes: [request, callable, binding, literal, module],
    relations,
    fingerprints: [fingerprint],
    unknowns,
    coverage: {
      status: withUnknown ? "partial" : "complete",
      truncated: false,
      omitted_nodes: withUnknown ? null : 0,
      omitted_relations: withUnknown ? null : 0,
      limits: [],
      families: coverageFamilies,
    },
    limitations: withUnknown ? ["Dynamic call target remains unknown."] : [],
  };
};

export const semanticFixtureGraph = (
  withUnknown = false,
): JavaScriptSemanticGraph =>
  createJavaScriptSemanticGraph(semanticFixtureInput(withUnknown));
