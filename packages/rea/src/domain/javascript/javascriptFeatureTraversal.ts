import type {
  ApplicationEdge,
  ApplicationNode,
} from "./javascriptApplicationGraphSchemas.js";
import type { JavaScriptApplicationGraph } from "./javascriptApplicationGraph.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";

interface AdjacencyEntry {
  readonly edge: ApplicationEdge;
  readonly nextNodeId: string;
  /** In "both", the step goes from a contained node up to its container. */
  readonly ascends: boolean;
}

interface Predecessor {
  readonly previousNodeId: string;
  readonly edgeId: string;
}

/** Complete reachable graph projection plus the first deterministic path to each node. */
export interface ApplicationFeatureTraversal {
  readonly nodes: ApplicationNode[];
  readonly edges: ApplicationEdge[];
  readonly predecessors: ReadonlyMap<string, Predecessor>;
}

/** Traverse a JAG without treating edge inference as observed reachability. */
export const traverseApplicationFeature = (
  graph: JavaScriptApplicationGraph,
  seedNodeIds: readonly string[],
  direction: "outgoing" | "incoming" | "both",
): ApplicationFeatureTraversal => {
  const nodeById = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const adjacency = buildAdjacency(graph.edges, direction);
  const visited = new Set(seedNodeIds);
  const retainedEdges = new Map<string, ApplicationEdge>();
  const predecessors = new Map<string, Predecessor>();
  // A feature crosses relationships in both directions: a renderer invokes a
  // channel that its handler also points at. A container reached from one of
  // its children only leads further up; expanding it would return every
  // sibling in a shared asset or artifact root.
  const ascendedOnly = new Set<string>();
  const queue = [...seedNodeIds];
  for (let offset = 0; offset < queue.length; offset += 1) {
    const current = queue[offset];
    if (current === undefined) continue;
    const confined = ascendedOnly.has(current);
    for (const entry of adjacency.get(current) ?? []) {
      if (confined && !entry.ascends) continue;
      retainedEdges.set(entry.edge.edge_id, entry.edge);
      const next = entry.nextNodeId;
      if (!nodeById.has(next)) continue;
      const nextConfined = confined || entry.ascends;
      // A node reached only from below is expanded again once it is reached
      // another way.
      if (visited.has(next) && (nextConfined || !ascendedOnly.has(next)))
        continue;
      if (!visited.has(next)) {
        visited.add(next);
        predecessors.set(next, {
          previousNodeId: current,
          edgeId: entry.edge.edge_id,
        });
      }
      if (nextConfined) ascendedOnly.add(next);
      else ascendedOnly.delete(next);
      queue.push(next);
    }
  }
  return {
    nodes: [...visited]
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is ApplicationNode => node !== undefined)
      .sort((left, right) =>
        compareUnicodeCodePoints(left.node_id, right.node_id),
      ),
    edges: [...retainedEdges.values()].sort((left, right) =>
      compareUnicodeCodePoints(left.edge_id, right.edge_id),
    ),
    predecessors,
  };
};

const buildAdjacency = (
  edges: readonly ApplicationEdge[],
  direction: "outgoing" | "incoming" | "both",
): ReadonlyMap<string, AdjacencyEntry[]> => {
  const adjacency = new Map<string, AdjacencyEntry[]>();
  for (const edge of edges) {
    if (direction !== "incoming")
      addAdjacency(adjacency, edge.source_node_id, {
        edge,
        nextNodeId: edge.target_node_id,
        ascends: false,
      });
    if (direction !== "outgoing")
      addAdjacency(adjacency, edge.target_node_id, {
        edge,
        nextNodeId: edge.source_node_id,
        ascends: direction === "both" && edge.relation === "contains",
      });
  }
  for (const entries of adjacency.values())
    entries.sort((left, right) =>
      compareUnicodeCodePoints(
        `${left.edge.edge_id}\0${left.nextNodeId}`,
        `${right.edge.edge_id}\0${right.nextNodeId}`,
      ),
    );
  return adjacency;
};

const addAdjacency = (
  adjacency: Map<string, AdjacencyEntry[]>,
  nodeId: string,
  entry: AdjacencyEntry,
): void => {
  const entries = adjacency.get(nodeId);
  if (entries === undefined) adjacency.set(nodeId, [entry]);
  else entries.push(entry);
};
