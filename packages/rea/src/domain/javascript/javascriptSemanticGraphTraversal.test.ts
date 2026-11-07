import {
  semanticFixtureGraph,
  semanticGraphTestEvidence,
  unknownSemanticGraphTestEvidence,
} from "../../../tests/support/javascriptSemanticGraphFixture.js";
import { expect, it } from "vitest";
import { z } from "zod";

import {
  JAVASCRIPT_SEMANTIC_NODE_KINDS,
  JAVASCRIPT_SEMANTIC_RELATION_FAMILIES,
  JAVASCRIPT_SEMANTIC_RELATION_FAMILY,
  type JavaScriptSemanticGraphInput,
  type JavaScriptSemanticGraphNode,
  type JavaScriptSemanticGraphRelation,
} from "./javascriptSemanticGraphSchemas.js";
import {
  createJavaScriptSemanticGraph,
  createJavaScriptSemanticGraphNode,
  createJavaScriptSemanticGraphRelation,
  createJavaScriptSemanticGraphUnknown,
  JavaScriptSemanticEvidenceContextRegistry,
  resolveJavaScriptSemanticEvidence,
  type JavaScriptSemanticGraph,
} from "./javascriptSemanticGraph.js";
import { queryJavaScriptSemanticGraph } from "./javascriptSemanticQuery.js";
import { javaScriptSemanticQueryInputSchema } from "./javascriptSemanticQuerySchemas.js";
import type { JsonValue } from "../jsonValue.js";

const SHA = "a".repeat(64);
const JAG_ID = `jag_${"b".repeat(64)}`;
const node = (
  kind: (typeof JAVASCRIPT_SEMANTIC_NODE_KINDS)[number],
  role: string,
  evidenceContexts: JavaScriptSemanticEvidenceContextRegistry,
  properties: Record<string, JsonValue> = {},
  functionNodeId: string | null = null,
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
      function_node_id: functionNodeId,
      application_node_ids: [],
      label: role,
      properties,
      evidence: semanticGraphTestEvidence(),
    },
    evidenceContexts,
  );

const graphWithCandidateEdge = (): JavaScriptSemanticGraph => {
  const graph = semanticFixtureGraph();
  const input = constructionInput(graph);
  const evidenceContexts = registryForGraph(graph);
  const literal = graph.nodes.find(({ kind }) => kind === "literal");
  const request = graph.nodes.find(({ kind }) => kind === "request");
  if (literal === undefined || request === undefined)
    throw new TypeError("Semantic fixture nodes are missing");
  const candidate = createJavaScriptSemanticGraphRelation(
    {
      source_node_id: literal.node_id,
      target_node_id: request.node_id,
      relation: "supplies-request-field",
      resolution: "candidate",
      properties: { field: "authorization" },
      evidence: semanticGraphTestEvidence("inferred"),
    },
    evidenceContexts,
  );
  return createJavaScriptSemanticGraph({
    ...input,
    evidence_contexts: evidenceContexts.contexts,
    relations: [...input.relations, candidate],
    coverage: {
      ...graph.coverage,
      families: graph.coverage.families.map((family) =>
        family.family === "request"
          ? {
              ...family,
              retained_relations: family.retained_relations + 1,
            }
          : family,
      ),
    },
  });
};

const constructionInput = (
  graph: JavaScriptSemanticGraph,
): JavaScriptSemanticGraphInput => {
  const { graph_id: _graphId, ...input } = graph;
  return input;
};

const registryForGraph = (
  graph: JavaScriptSemanticGraph,
): JavaScriptSemanticEvidenceContextRegistry => {
  const registry = new JavaScriptSemanticEvidenceContextRegistry();
  for (const { evidence: reference } of [
    ...graph.nodes,
    ...graph.relations,
    ...graph.unknowns,
    ...graph.fingerprints,
  ])
    registry.intern(resolveJavaScriptSemanticEvidence(graph, reference));
  return registry;
};

it("returns every relevant unknown inline", () => {
  const graph = semanticFixtureGraph(true);
  const callable = graph.nodes.find(({ kind }) => kind === "function");
  if (callable === undefined) throw new Error("Expected callable node");
  const result = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "semantic-node", node_id: callable.node_id },
      direction: "forward-influence",
    }),
  );
  expect(result).toMatchObject({
    summary: { relevant_unknowns: 1 },
  });
  expect(result.unknowns).toHaveLength(1);
});

it("does not admit a semantic-node seed absent from the graph", () => {
  const result = queryJavaScriptSemanticGraph(
    semanticFixtureGraph(),
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "semantic-node", node_id: `jsrg_node_${"f".repeat(64)}` },
      direction: "forward-influence",
    }),
  );

  expect(result).toMatchObject({
    status: "no-match",
    seed_node_ids: [],
    nodes: [],
    summary: { total_seed_matches: 0, traversed_nodes: 0 },
  });
});

it("returns the complete deterministic forward influence result inline", () => {
  const graph = semanticFixtureGraph();
  const input = {
    seed: { kind: "literal" as const, value: "TOKEN" },
    direction: "forward-influence" as const,
    expected: { role: "sink" as const, classes: ["request" as const] },
  };
  const first = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse(input),
  );
  expect(first).toMatchObject({
    status: "found",
    summary: { traversed_nodes: 4, traversed_relations: 3 },
    relations: expect.any(Array),
  });
  expect(first.expected_match_node_ids).toHaveLength(1);
  expect(first.relations).toHaveLength(3);
});

it("returns only the referenced evidence contexts with resolvable trace facts", () => {
  const graph = semanticFixtureGraph();
  const result = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "literal", value: "TOKEN" },
      direction: "forward-influence",
    }),
  );
  const expectedContextIds = [
    ...new Set([
      ...result.nodes.map(({ evidence }) => evidence.context_id),
      ...result.relations.map(({ evidence }) => evidence.context_id),
      ...result.unknowns.map(({ evidence }) => evidence.context_id),
    ]),
  ].sort();
  expect(result.evidence_contexts.map(({ context_id }) => context_id)).toEqual(
    expectedContextIds,
  );
  for (const node of result.nodes)
    expect(resolveJavaScriptSemanticEvidence(result, node.evidence)).toEqual(
      resolveJavaScriptSemanticEvidence(graph, node.evidence),
    );
});

it("traverses paths beyond the former fixed depth ceiling", () => {
  const original = semanticFixtureGraph();
  const input = constructionInput(original);
  const evidenceContexts = registryForGraph(original);
  const request = original.nodes.find(({ kind }) => kind === "request");
  if (request === undefined) throw new TypeError("Missing request node");
  const chain = Array.from({ length: 70 }, (_, index) =>
    node("binding", `long-chain-${index}`, evidenceContexts),
  );
  const chainRelations = chain.map((target, index) =>
    createJavaScriptSemanticGraphRelation(
      {
        source_node_id: chain[index - 1]?.node_id ?? request.node_id,
        target_node_id: target.node_id,
        relation: "reads",
        resolution: "resolved",
        properties: {},
        evidence: semanticGraphTestEvidence("inferred"),
      },
      evidenceContexts,
    ),
  );
  const graph = createJavaScriptSemanticGraph({
    ...input,
    evidence_contexts: evidenceContexts.contexts,
    nodes: [...input.nodes, ...chain],
    relations: [...input.relations, ...chainRelations],
    coverage: {
      ...original.coverage,
      families: original.coverage.families.map((family) =>
        family.family === "data-flow"
          ? {
              ...family,
              retained_relations:
                family.retained_relations + chainRelations.length,
            }
          : family,
      ),
    },
  });

  const result = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "literal", value: "TOKEN" },
      direction: "forward-influence",
    }),
  );

  expect(result.summary.traversed_nodes).toBe(74);
  expect(result.nodes).toHaveLength(74);
});

it("accepts deeply nested semantic properties", () => {
  let nested: JsonValue = "leaf";
  for (let index = 0; index < 12; index += 1)
    nested = { [`level-${String(index)}`]: nested };

  const result = node(
    "binding",
    "deep-properties",
    new JavaScriptSemanticEvidenceContextRegistry(),
    { nested },
  );

  expect(result.properties).toEqual({ nested });
});

it("keeps relevant dynamic frontiers unknown", () => {
  const result = queryJavaScriptSemanticGraph(
    semanticFixtureGraph(true),
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "literal", value: "TOKEN" },
      direction: "forward-influence",
    }),
  );
  expect(result.status).toBe("partial");
  expect(result.coverage.status).toBe("partial");
  expect(result.unknowns).toMatchObject([
    { reason: "dynamic-call", relation_kinds: ["calls"] },
  ]);
});

it("reports partial status when retained graph facts were truncated", () => {
  const graph = semanticFixtureGraph();
  const partial = createJavaScriptSemanticGraph({
    ...constructionInput(graph),
    coverage: {
      ...graph.coverage,
      status: "partial",
      truncated: true,
      omitted_nodes: null,
      omitted_relations: null,
      limits: [{ name: "nodes", value: 1, unit: "items" }],
    },
    limitations: ["The node ceiling left omission extents unknown."],
  });
  const result = queryJavaScriptSemanticGraph(
    partial,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "literal", value: "TOKEN" },
      direction: "forward-influence",
    }),
  );
  expect(result.status).toBe("partial");
});

it("excludes candidate edges unless the caller explicitly opts in", () => {
  const graph = graphWithCandidateEdge();
  const input = {
    seed: { kind: "literal" as const, value: "TOKEN" },
    direction: "forward-influence" as const,
    allowed_relations: ["supplies-request-field" as const],
  };
  const conservative = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse(input),
  );
  const optedIn = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      ...input,
      include_ambiguous_dynamic_edges: true,
    }),
  );
  expect(conservative.summary.traversed_relations).toBe(0);
  expect(optedIn.summary.traversed_relations).toBe(1);
  expect(conservative.status).toBe("ambiguous");
  expect(conservative.coverage.status).toBe("partial");
  expect(optedIn.status).toBe("ambiguous");
  expect(optedIn.relations).toMatchObject([
    { relation: "supplies-request-field", resolution: "candidate" },
  ]);
});

it("rejects an empty relation selection at the query schema boundary", () => {
  expect(() =>
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "literal", value: "TOKEN" },
      direction: "forward-influence",
      allowed_relations: [],
    }),
  ).toThrow(z.ZodError);
});

it("retains every structural application node linked to one semantic node", () => {
  const evidenceContexts = new JavaScriptSemanticEvidenceContextRegistry();
  const original = node("module", "module", evidenceContexts);
  const linked = createJavaScriptSemanticGraphNode(
    {
      kind: original.kind,
      identity: original.identity,
      function_node_id: original.function_node_id,
      application_node_ids: Array.from(
        { length: 65 },
        (_, index) => `jag_node_${index.toString(16).padStart(64, "0")}`,
      ),
      label: original.label,
      properties: original.properties,
      evidence: evidenceContexts.resolve(original.evidence),
    },
    evidenceContexts,
  );
  expect(linked.application_node_ids).toHaveLength(65);
});

it("retains all explicit unresolved candidate node identifiers", () => {
  const evidenceContexts = new JavaScriptSemanticEvidenceContextRegistry();
  const unknown = createJavaScriptSemanticGraphUnknown(
    {
      node_id: null,
      family: "call-flow",
      relation_kinds: ["calls"],
      reason: "ambiguous-target",
      detail: "All candidate targets are retained.",
      candidate_node_ids: Array.from(
        { length: 1_001 },
        (_, index) => `jsrg_node_${index.toString(16).padStart(64, "0")}`,
      ),
      evidence: unknownSemanticGraphTestEvidence(),
    },
    evidenceContexts,
  );
  expect(unknown.candidate_node_ids).toHaveLength(1_001);
});

const directionalGraph = (
  nodes: readonly JavaScriptSemanticGraphNode[],
  relations: readonly JavaScriptSemanticGraphRelation[],
  evidenceContexts: JavaScriptSemanticEvidenceContextRegistry,
  partial = false,
): JavaScriptSemanticGraph =>
  createJavaScriptSemanticGraph({
    schema: "JavaScriptSemanticRelationGraph",
    root_artifact_sha256: SHA,
    application_graph_id: JAG_ID,
    root_node_ids: nodes.slice(0, 1).map(({ node_id }) => node_id),
    evidence_contexts: evidenceContexts.contexts,
    nodes: [...nodes],
    relations: [...relations],
    fingerprints: [],
    unknowns: [],
    coverage: {
      status: partial ? "partial" : "complete",
      truncated: false,
      omitted_nodes: partial ? 1 : 0,
      omitted_relations: 0,
      limits: [],
      families: JAVASCRIPT_SEMANTIC_RELATION_FAMILIES.map((family) => ({
        family,
        status: "complete",
        retained_relations: relations.filter(
          ({ relation }) =>
            JAVASCRIPT_SEMANTIC_RELATION_FAMILY[relation] === family,
        ).length,
        omitted_relations: 0,
        unknown_ids: [],
      })),
    },
    limitations: partial ? ["One source graph node was omitted."] : [],
  });

const relationBetween = (
  source: JavaScriptSemanticGraphNode,
  target: JavaScriptSemanticGraphNode,
  relation: JavaScriptSemanticGraphRelation["relation"],
  evidenceContexts: JavaScriptSemanticEvidenceContextRegistry,
  resolution: JavaScriptSemanticGraphRelation["resolution"] = "resolved",
) =>
  createJavaScriptSemanticGraphRelation(
    {
      source_node_id: source.node_id,
      target_node_id: target.node_id,
      relation,
      resolution,
      properties: {},
      evidence: semanticGraphTestEvidence("inferred"),
    },
    evidenceContexts,
  );

it.each([
  {
    direction: "forward-influence",
    relation: "calls",
    incoming: true,
    relevant: false,
  },
  {
    direction: "forward-influence",
    relation: "calls",
    incoming: false,
    relevant: true,
  },
  {
    direction: "backward-provenance",
    relation: "calls",
    incoming: false,
    relevant: false,
  },
  {
    direction: "backward-provenance",
    relation: "calls",
    incoming: true,
    relevant: true,
  },
  { direction: "callers", relation: "reads", incoming: true, relevant: false },
  { direction: "callers", relation: "calls", incoming: false, relevant: false },
  { direction: "callers", relation: "calls", incoming: true, relevant: true },
  {
    direction: "ownership",
    relation: "reads",
    incoming: false,
    relevant: false,
  },
  { direction: "ownership", relation: "owns", incoming: false, relevant: true },
  { direction: "ownership", relation: "owns", incoming: true, relevant: true },
] as const)(
  "limits $direction ambiguity to traversable $relation candidates (incoming=$incoming)",
  ({ direction, relation, incoming, relevant }) => {
    const evidenceContexts = new JavaScriptSemanticEvidenceContextRegistry();
    const seed = node("function", "directional-seed", evidenceContexts);
    const reached = node("function", "directional-reached", evidenceContexts);
    const other = node("function", "directional-other", evidenceContexts);
    const reverse =
      direction === "callers" || direction === "backward-provenance";
    const resolved = relationBetween(
      reverse ? reached : seed,
      reverse ? seed : reached,
      direction === "ownership" ? "owns" : "calls",
      evidenceContexts,
    );
    const candidate = relationBetween(
      incoming ? other : reached,
      incoming ? reached : other,
      relation,
      evidenceContexts,
      "candidate",
    );
    const nodes = [seed, reached, other];
    const control = queryJavaScriptSemanticGraph(
      directionalGraph(nodes, [resolved], evidenceContexts),
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "semantic-node", node_id: seed.node_id },
        direction,
      }),
    );
    expect(control).toMatchObject({
      status: "found",
      coverage: { status: "complete" },
    });
    for (const include of [false, true]) {
      const result = queryJavaScriptSemanticGraph(
        directionalGraph(nodes, [resolved, candidate], evidenceContexts),
        javaScriptSemanticQueryInputSchema.parse({
          seed: { kind: "semantic-node", node_id: seed.node_id },
          direction,
          include_ambiguous_dynamic_edges: include,
        }),
      );
      expect(result).toMatchObject({
        status: relevant ? "ambiguous" : "found",
        coverage: { status: relevant ? "partial" : "complete" },
      });
      if (!relevant || !include) {
        expect(result.nodes).toEqual(control.nodes);
        expect(result.relations).toEqual(control.relations);
      } else {
        expect(result.nodes).toHaveLength(3);
        expect(result.relations).toContainEqual(
          expect.objectContaining({
            source_node_id: candidate.source_node_id,
            target_node_id: candidate.target_node_id,
            relation: candidate.relation,
            resolution: candidate.resolution,
          }),
        );
      }
    }
  },
);

it("excludes explicitly filtered candidates without hiding partial graph coverage", () => {
  const evidenceContexts = new JavaScriptSemanticEvidenceContextRegistry();
  const seed = node("function", "filtered-seed", evidenceContexts);
  const other = node("function", "filtered-other", evidenceContexts);
  const candidate = relationBetween(
    seed,
    other,
    "reads",
    evidenceContexts,
    "candidate",
  );
  for (const partial of [false, true]) {
    const result = queryJavaScriptSemanticGraph(
      directionalGraph([seed, other], [candidate], evidenceContexts, partial),
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "semantic-node", node_id: seed.node_id },
        direction: "forward-influence",
        allowed_relations: ["calls"],
      }),
    );
    expect(result).toMatchObject({
      status: "found",
      coverage: { status: partial ? "partial" : "complete" },
      relations: [],
    });
  }
});

it("keeps candidate uncertainty at the end of a long reachable path", () => {
  const evidenceContexts = new JavaScriptSemanticEvidenceContextRegistry();
  const chain = Array.from({ length: 72 }, (_, index) =>
    node("binding", `candidate-chain-${index}`, evidenceContexts),
  );
  const relations = chain.slice(1).map((target, index) => {
    const source = chain[index];
    if (source === undefined) throw new TypeError("Missing chain source");
    return relationBetween(
      source,
      target,
      "reads",
      evidenceContexts,
      index === 70 ? "candidate" : "resolved",
    );
  });
  const seed = chain[0];
  if (seed === undefined) throw new TypeError("Missing chain seed");
  for (const include of [false, true]) {
    const result = queryJavaScriptSemanticGraph(
      directionalGraph(chain, relations, evidenceContexts),
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "semantic-node", node_id: seed.node_id },
        direction: "forward-influence",
        include_ambiguous_dynamic_edges: include,
      }),
    );
    expect(result).toMatchObject({
      status: "ambiguous",
      coverage: { status: "partial" },
    });
    expect(result.nodes).toHaveLength(include ? 72 : 71);
  }
});
