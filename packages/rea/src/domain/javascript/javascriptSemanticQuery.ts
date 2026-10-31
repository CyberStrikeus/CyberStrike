import type { JavaScriptSemanticGraph } from "./javascriptSemanticGraph.js";
import type {
  JavaScriptSemanticGraphNode,
  JavaScriptSemanticGraphRelation,
  JavaScriptSemanticGraphUnknown,
} from "./javascriptSemanticGraphSchemas.js";
import { isJavaScriptSemanticOwnershipRelation as ownershipRelation } from "./javascriptSemanticQueryRelations.js";
import {
  javaScriptSemanticQueryResultSchema,
  type JavaScriptSemanticQueryInput,
  type JavaScriptSemanticQueryResult,
} from "./javascriptSemanticQuerySchemas.js";
import { assessJavaScriptSemanticQuery } from "./javascriptSemanticQueryAssessment.js";
import {
  javaScriptSemanticQueryIdentifier as queryIdentifier,
  resolveJavaScriptSemanticQuerySeeds as resolveSeeds,
} from "./javascriptSemanticQueryIdentity.js";

interface TraversalEntry {
  readonly relation: JavaScriptSemanticGraphRelation;
  readonly nextNodeId: string;
}

interface Traversal {
  readonly nodeIds: Set<string>;
  readonly relationIds: Set<string>;
  readonly functionIds: Set<string>;
  readonly modules: Set<string>;
}

interface QueryResult {
  readonly retainedNodes: JavaScriptSemanticGraphNode[];
  readonly retainedRelations: JavaScriptSemanticGraphRelation[];
}

/** Run a query already parsed by its owning request boundary. */
export const queryJavaScriptSemanticGraph = (
  graph: JavaScriptSemanticGraph,
  input: JavaScriptSemanticQueryInput,
): JavaScriptSemanticQueryResult => {
  const queryId = queryIdentifier(graph, input);
  const seeds = resolveSeeds(graph, input);
  const nodes = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const adjacency = buildAdjacency(graph.relations, input);
  const traversal = traverse(nodes, seeds, adjacency);
  const result = createQueryResult(graph, traversal);
  const relevantUnknowns = relevantUnknownFrontiers(
    graph,
    traversal.nodeIds,
    input,
  );
  const candidateRelations = relevantCandidateRelationCount(
    graph,
    traversal.nodeIds,
    input,
  );
  const expectedMatches = expectedMatchesFor(
    result.retainedNodes,
    result.retainedRelations,
    input,
  );
  const retainedContextIds = new Set([
    ...result.retainedNodes.map(({ evidence }) => evidence.context_id),
    ...result.retainedRelations.map(({ evidence }) => evidence.context_id),
    ...relevantUnknowns.map(({ evidence }) => evidence.context_id),
  ]);
  const assessment = assessJavaScriptSemanticQuery({
    graph,
    totalSeeds: seeds.length,
    expectedMatches: expectedMatches.length,
    hasExpectation: input.expected !== null,
    unknowns: relevantUnknowns,
    candidateRelations,
  });
  return javaScriptSemanticQueryResultSchema.parse({
    query_id: queryId,
    source_graph_id: graph.graph_id,
    seed: input.seed,
    direction: input.direction,
    status: assessment.status,
    seed_node_ids: seeds,
    evidence_contexts: graph.evidence_contexts.filter(({ context_id }) =>
      retainedContextIds.has(context_id),
    ),
    nodes: result.retainedNodes,
    relations: result.retainedRelations,
    unknowns: relevantUnknowns,
    expected_match_node_ids: expectedMatches.map(({ node_id }) => node_id),
    summary: {
      total_seed_matches: seeds.length,
      traversed_nodes: traversal.nodeIds.size,
      traversed_relations: traversal.relationIds.size,
      traversed_functions: traversal.functionIds.size,
      traversed_modules: traversal.modules.size,
      relevant_unknowns: relevantUnknowns.length,
    },
    coverage: assessment.coverage,
    limitations: assessment.limitations,
  });
};

const createQueryResult = (
  graph: JavaScriptSemanticGraph,
  traversal: Traversal,
): QueryResult => {
  const retainedNodes = graph.nodes.filter(({ node_id }) =>
    traversal.nodeIds.has(node_id),
  );
  const retainedRelations = graph.relations.filter(({ relation_id }) =>
    traversal.relationIds.has(relation_id),
  );
  return { retainedNodes, retainedRelations };
};

const buildAdjacency = (
  relations: readonly JavaScriptSemanticGraphRelation[],
  input: JavaScriptSemanticQueryInput,
): ReadonlyMap<string, TraversalEntry[]> => {
  const adjacency = new Map<string, TraversalEntry[]>();
  const allowed =
    input.allowed_relations === undefined
      ? null
      : new Set(input.allowed_relations);
  for (const relation of relations) {
    if (allowed !== null && !allowed.has(relation.relation)) continue;
    if (
      relation.resolution === "candidate" &&
      !input.include_ambiguous_dynamic_edges
    )
      continue;
    addDirectedEntries(adjacency, relation, input.direction);
  }
  return adjacency;
};

const addDirectedEntries = (
  adjacency: Map<string, TraversalEntry[]>,
  relation: JavaScriptSemanticGraphRelation,
  direction: JavaScriptSemanticQueryInput["direction"],
): void => {
  if (direction === "callers") {
    if (relation.relation === "calls")
      addEntry(
        adjacency,
        relation.target_node_id,
        relation.source_node_id,
        relation,
      );
    return;
  }
  if (direction === "ownership") {
    if (!ownershipRelation(relation.relation)) return;
    addEntry(
      adjacency,
      relation.source_node_id,
      relation.target_node_id,
      relation,
    );
    addEntry(
      adjacency,
      relation.target_node_id,
      relation.source_node_id,
      relation,
    );
    return;
  }
  if (direction === "backward-provenance")
    addEntry(
      adjacency,
      relation.target_node_id,
      relation.source_node_id,
      relation,
    );
  else
    addEntry(
      adjacency,
      relation.source_node_id,
      relation.target_node_id,
      relation,
    );
};

const addEntry = (
  adjacency: Map<string, TraversalEntry[]>,
  from: string,
  nextNodeId: string,
  relation: JavaScriptSemanticGraphRelation,
): void => {
  const entries = adjacency.get(from) ?? [];
  entries.push({ relation, nextNodeId });
  adjacency.set(from, entries);
};

const traverse = (
  nodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>,
  seeds: readonly string[],
  adjacency: ReadonlyMap<string, TraversalEntry[]>,
): Traversal => {
  const nodeIds = new Set(seeds);
  const relationIds = new Set<string>();
  const functionIds = new Set<string>();
  const modules = new Set<string>();
  const queue = [...nodeIds];
  for (const nodeId of nodeIds)
    retainOwners(nodes.get(nodeId), functionIds, modules);
  for (let offset = 0; offset < queue.length; offset += 1) {
    const current = queue[offset];
    if (current === undefined) continue;
    for (const entry of adjacency.get(current) ?? []) {
      relationIds.add(entry.relation.relation_id);
      if (nodeIds.has(entry.nextNodeId)) continue;
      const node = nodes.get(entry.nextNodeId);
      if (node === undefined) continue;
      nodeIds.add(entry.nextNodeId);
      retainOwners(node, functionIds, modules);
      queue.push(entry.nextNodeId);
    }
  }
  return {
    nodeIds,
    relationIds,
    functionIds,
    modules,
  };
};

const retainOwners = (
  node: JavaScriptSemanticGraphNode | undefined,
  functions: Set<string>,
  modules: Set<string>,
): void => {
  if (node === undefined) return;
  const functionId =
    node.kind === "function" ? node.node_id : node.function_node_id;
  if (functionId !== null) functions.add(functionId);
  modules.add(node.identity.module_path);
};

const relevantUnknownFrontiers = (
  graph: JavaScriptSemanticGraph,
  nodeIds: ReadonlySet<string>,
  input: JavaScriptSemanticQueryInput,
): JavaScriptSemanticGraphUnknown[] => {
  const allowed =
    input.allowed_relations === undefined
      ? null
      : new Set(input.allowed_relations);
  return graph.unknowns.filter(
    (unknown) =>
      (unknown.node_id === null || nodeIds.has(unknown.node_id)) &&
      unknown.relation_kinds.some(
        (relation) =>
          directionAllowsRelation(input.direction, relation) &&
          (allowed === null || allowed.has(relation)),
      ),
  );
};

const directionAllowsRelation = (
  direction: JavaScriptSemanticQueryInput["direction"],
  relation: JavaScriptSemanticGraphRelation["relation"],
): boolean =>
  direction === "callers"
    ? relation === "calls"
    : direction === "ownership"
      ? ownershipRelation(relation)
      : true;

const relevantCandidateRelationCount = (
  graph: JavaScriptSemanticGraph,
  nodeIds: ReadonlySet<string>,
  input: JavaScriptSemanticQueryInput,
): number => {
  const allowed =
    input.allowed_relations === undefined
      ? null
      : new Set(input.allowed_relations);
  let relevant = 0;
  for (const relation of graph.relations) {
    if (
      relation.resolution !== "candidate" ||
      (allowed !== null && !allowed.has(relation.relation))
    )
      continue;
    const sourceIsRelevant = nodeIds.has(relation.source_node_id);
    const targetIsRelevant = nodeIds.has(relation.target_node_id);
    if (
      (input.direction === "callers" &&
        relation.relation === "calls" &&
        targetIsRelevant) ||
      (input.direction === "ownership" &&
        ownershipRelation(relation.relation) &&
        (sourceIsRelevant || targetIsRelevant)) ||
      (input.direction === "backward-provenance" && targetIsRelevant) ||
      (input.direction === "forward-influence" && sourceIsRelevant)
    )
      relevant += 1;
  }
  return relevant;
};

const expectedMatchesFor = (
  nodes: readonly JavaScriptSemanticGraphNode[],
  relations: readonly JavaScriptSemanticGraphRelation[],
  input: JavaScriptSemanticQueryInput,
): JavaScriptSemanticGraphNode[] => {
  if (input.expected === null) return [];
  const classes = new Set(input.expected.classes);
  const connected = new Set(
    relations.map((relation) =>
      input.expected?.role === "source"
        ? relation.target_node_id
        : relation.source_node_id,
    ),
  );
  return nodes.filter(
    ({ kind, node_id }) => classes.has(kind) && !connected.has(node_id),
  );
};
