import { z } from "zod";

import {
  objcImplementationClassName,
  nativeMetadataEvidenceSchema,
  nativeMetadataLocationSchema,
  type ObjcSwiftMetadata,
} from "./objcSwiftMetadata.js";
import { jsonObjectSchema } from "../jsonValue.js";

/** Entity kinds shared by decoded Interface Builder archives and native code. */
export const nativeInvestigationNodeKindSchema = z.enum([
  "storyboard",
  "scene",
  "view_controller",
  "view",
  "control",
  "constraint",
  "layout_guide",
  "resource",
  "placeholder",
  "external_object",
  "outlet",
  "action",
  "segue",
  "objc_class",
  "objc_selector",
  "swift_declaration",
  "swift_requirement",
  "dispatch_table",
  "dispatch_slot",
  "thunk",
  "function",
  "state_value",
  "global_value",
  "field",
  "branch_condition",
  "sink",
  "unknown",
]);

/** One UI, dispatch, or value entity with optional decoded source location. */
export const nativeInvestigationNodeSchema = z.strictObject({
  id: z.string().min(1),
  kind: nativeInvestigationNodeKindSchema,
  name: z.string().min(1),
  location: nativeMetadataLocationSchema.nullable(),
  attributes: jsonObjectSchema,
  evidence: z.array(nativeMetadataEvidenceSchema),
});

/** Relationship types preserve UI wiring, native dispatch, and value flow. */
export const nativeInvestigationRelationSchema = z.enum([
  "contains",
  "outlet_to",
  "target_action",
  "segue_to",
  "objc_dispatch",
  "swift_witness_dispatch",
  "swift_vtable_dispatch",
  "thunk_to",
  "direct_call",
  "indirect_call",
  "provider_call",
  "reads",
  "writes",
  "flows_to",
  "controls",
]);

/** An observed, inferred, or unresolved relationship between entities. */
export const nativeInvestigationEdgeSchema = z.discriminatedUnion(
  "resolution",
  [
    z.strictObject({
      id: z.string().min(1),
      from: z.string().min(1),
      to: z.string().min(1),
      relation: nativeInvestigationRelationSchema,
      resolution: z.enum(["observed", "inferred", "resolved", "ambiguous"]),
      evidence: z.array(nativeMetadataEvidenceSchema).min(1),
      limitations: z.array(z.string()),
    }),
    z.strictObject({
      id: z.string().min(1),
      from: z.string().min(1),
      to: z.null(),
      relation: nativeInvestigationRelationSchema,
      resolution: z.literal("unresolved"),
      reason: z.string().min(1),
      evidence: z.array(nativeMetadataEvidenceSchema),
      limitations: z.array(z.string()),
    }),
  ],
);

export type NativeInvestigationEdge = z.infer<
  typeof nativeInvestigationEdgeSchema
>;

/** Explicit inventory coverage so missing graph parts are not read as absent. */
export const nativeInvestigationCoverageSchema = z.strictObject({
  facet: z.string().min(1),
  status: z.enum(["complete", "partial", "unsupported", "not_requested"]),
  reason: z.string().nullable(),
  examined: z.int().nonnegative(),
  omitted: z.int().nonnegative(),
});

export const nativeInvestigationProviderSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().nullable(),
  tool_version: z.string().min(1),
});

/** Complete provider-neutral graph bound to one immutable target identity. */
export const nativeInvestigationGraphSchema = z.strictObject({
  target_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  provider: nativeInvestigationProviderSchema,
  nodes: z.array(nativeInvestigationNodeSchema),
  edges: z.array(nativeInvestigationEdgeSchema),
  coverage: z.array(nativeInvestigationCoverageSchema),
  truncated: z.boolean(),
});

export type NativeInvestigationGraph = z.infer<
  typeof nativeInvestigationGraphSchema
>;

/** Caller-controlled hard limits for a bounded relationship trace. */
export const nativeInvestigationTraceLimitsSchema = z.strictObject({
  max_depth: z.int().min(0).max(32).default(8),
  max_nodes: z.int().min(1).max(2000).default(250),
  max_edges: z.int().min(1).max(5000).default(500),
});

export type NativeInvestigationTraceLimits = z.infer<
  typeof nativeInvestigationTraceLimitsSchema
>;

/** Exact graph route and any unresolved edges encountered along the route. */
export const nativeInvestigationTraceSchema = z.strictObject({
  target_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  provider: nativeInvestigationProviderSchema,
  start: z.string().min(1),
  direction: z.enum(["forward", "backward"]),
  nodes: z.array(nativeInvestigationNodeSchema),
  edges: z.array(nativeInvestigationEdgeSchema),
  unresolved: z.array(nativeInvestigationEdgeSchema),
  reached_depth: z.int().nonnegative(),
  truncated: z.boolean(),
  reason: z.string().nullable(),
  coverage: z.array(nativeInvestigationCoverageSchema),
  limitations: z.array(z.string().min(1)),
});

export type NativeInvestigationTrace = z.infer<
  typeof nativeInvestigationTraceSchema
>;

/** Trace known relationships while retaining unknown indirect dispatch edges. */
export const traceNativeInvestigationGraph = (
  graph: NativeInvestigationGraph,
  input: {
    readonly start: string;
    readonly direction?: "forward" | "backward";
    readonly limits?: Partial<NativeInvestigationTraceLimits>;
  },
): NativeInvestigationTrace => {
  const start = graph.nodes.find(({ id }) => id === input.start);
  if (start === undefined)
    return {
      target_sha256: graph.target_sha256,
      provider: graph.provider,
      start: input.start,
      direction: input.direction ?? "forward",
      nodes: [],
      edges: [],
      unresolved: [],
      reached_depth: 0,
      truncated: false,
      reason: "start_node_missing",
      coverage: graph.coverage,
      limitations: [
        "The requested start node is absent from the supplied graph.",
      ],
    };

  const limits = nativeInvestigationTraceLimitsSchema.parse(input.limits ?? {});
  const direction = input.direction ?? "forward";
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const visited = new Set([start.id]);
  const selectedEdges = new Map<string, NativeInvestigationEdge>();
  const unresolved = new Map<string, NativeInvestigationEdge>();
  const queue: Array<{ id: string; depth: number }> = [
    { id: start.id, depth: 0 },
  ];
  let reachedDepth = 0;
  let truncated = false;
  let reason: string | null = null;
  const adjacency = new Map<string, NativeInvestigationEdge[]>();
  for (const edge of graph.edges) {
    const nodeId = direction === "forward" ? edge.from : edge.to;
    if (nodeId === null) continue;
    const entries = adjacency.get(nodeId);
    if (entries === undefined) adjacency.set(nodeId, [edge]);
    else entries.push(edge);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const adjacent = adjacency.get(current.id) ?? [];

    for (const edge of adjacent) {
      if (selectedEdges.size + unresolved.size >= limits.max_edges) {
        truncated = true;
        reason = "max_edges_reached";
        break;
      }
      if (edge.resolution === "unresolved") {
        unresolved.set(edge.id, edge);
        continue;
      }
      const nextId = direction === "forward" ? edge.to : edge.from;
      const alreadyVisited = visited.has(nextId);
      if (!alreadyVisited && current.depth >= limits.max_depth) {
        truncated = true;
        reason ??= "max_depth_reached";
        continue;
      }
      // Check destination capacity before retaining its edge. Otherwise the node
      // bound leaves a resolved edge pointing outside the returned trace.
      if (!alreadyVisited && visited.size >= limits.max_nodes) {
        truncated = true;
        reason = "max_nodes_reached";
        break;
      }
      selectedEdges.set(edge.id, edge);
      if (alreadyVisited) continue;
      if (!nodeById.has(nextId)) {
        truncated = true;
        reason ??= "edge_target_missing_from_graph";
        continue;
      }
      visited.add(nextId);
      // A retained node has already been reached even if a later sibling
      // exhausts a budget before this node is dequeued for expansion.
      reachedDepth = Math.max(reachedDepth, current.depth + 1);
      queue.push({ id: nextId, depth: current.depth + 1 });
    }
    if (reason === "max_edges_reached" || reason === "max_nodes_reached") break;
  }

  return {
    target_sha256: graph.target_sha256,
    provider: graph.provider,
    start: start.id,
    direction,
    nodes: [...visited].flatMap((id) => {
      const node = nodeById.get(id);
      return node === undefined ? [] : [node];
    }),
    edges: [...selectedEdges.values()],
    unresolved: [...unresolved.values()],
    reached_depth: reachedDepth,
    truncated,
    reason,
    coverage: graph.coverage,
    limitations: [
      "Static analysis does not prove that an authored UI action is reachable or executed at runtime.",
      "Provider call graphs may omit unresolved indirect dispatch.",
    ],
  };
};

/** Join authored UI actions to exact Objective-C method symbols when known. */
export const joinInterfaceBuilderDispatch = (
  graph: NativeInvestigationGraph,
  metadata: ObjcSwiftMetadata,
): NativeInvestigationGraph => {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = [...graph.edges];
  const existingEdgeIds = new Set(edges.map(({ id }) => id));
  const selectorNodesByAction = new Map<string, string>();
  for (const edge of edges) {
    if (
      edge.resolution === "observed" &&
      edge.relation === "target_action" &&
      nodes.get(edge.to)?.kind === "objc_selector"
    )
      selectorNodesByAction.set(edge.from, edge.to);
  }

  let examined = 0;
  let resolved = 0;
  let inferredWithoutOwnerClass = 0;
  for (const action of nodes.values()) {
    if (action.kind !== "action") continue;
    const selector = action.attributes.selector;
    if (typeof selector !== "string" || selector.length === 0) continue;
    const selectorNodeId = selectorNodesByAction.get(action.id);
    if (selectorNodeId === undefined) continue;
    examined += 1;
    const destinationEdge = edges.find(
      (edge) =>
        edge.resolution === "observed" &&
        edge.relation === "target_action" &&
        edge.from === action.id &&
        edge.to !== selectorNodeId &&
        nodes.has(edge.to),
    );
    if (
      destinationEdge === undefined ||
      destinationEdge.resolution !== "observed"
    ) {
      const edgeId = `dispatch:${selectorNodeId}:${action.id}:receiver`;
      if (!existingEdgeIds.has(edgeId)) {
        existingEdgeIds.add(edgeId);
        edges.push({
          id: edgeId,
          from: selectorNodeId,
          to: null,
          relation: "objc_dispatch",
          resolution: "unresolved",
          reason: "authored_action_receiver_unresolved",
          evidence: action.evidence,
          limitations: [
            "The authored action has no resolved receiver; a selector match alone cannot establish its implementation.",
          ],
        });
      }
      continue;
    }
    const owner = nodes.get(destinationEdge.to);
    const declaredClass = owner?.attributes.class_name;
    const className =
      typeof declaredClass === "string" &&
      declaredClass.length > 0 &&
      owner?.kind !== "placeholder" &&
      owner?.kind !== "external_object"
        ? declaredClass
        : null;
    const candidates = metadata.objc_dispatch_implementations.filter(
      (candidate) =>
        candidate.method_type === "instance" &&
        candidate.selector === selector &&
        (className === null ||
          objcImplementationClassName(candidate) === className),
    );
    const implementation = candidates.length === 1 ? candidates[0] : undefined;
    const edgeId = `dispatch:${selectorNodeId}:${className ?? owner?.id ?? "unknown"}:${selector}`;
    if (existingEdgeIds.has(edgeId)) continue;
    existingEdgeIds.add(edgeId);
    if (
      implementation === undefined ||
      implementation.implementation_address === null
    ) {
      edges.push({
        id: edgeId,
        from: selectorNodeId,
        to: null,
        relation: "objc_dispatch",
        resolution: "unresolved",
        reason:
          candidates.length > 1
            ? "selector_has_multiple_candidate_implementations"
            : "implementation_not_resolved_from_binary_metadata_or_provider_symbols",
        evidence: [
          ...action.evidence,
          ...candidates.flatMap(({ evidence }) => evidence),
        ],
        limitations: [
          "A missing or ambiguous symbol match does not prove that the runtime implementation is absent.",
        ],
      });
      continue;
    }

    const functionId = `native:function:${implementation.implementation_address}`;
    if (!nodes.has(functionId))
      nodes.set(functionId, {
        id: functionId,
        kind: "function",
        name: `${implementation.class_name} ${selector}`,
        location: {
          address: implementation.implementation_address,
          file_offset: implementation.location.file_offset,
        },
        attributes: {
          class_name: implementation.class_name,
          selector,
          method_type: implementation.method_type,
        },
        evidence: implementation.evidence,
      });
    edges.push({
      id: edgeId,
      from: selectorNodeId,
      to: functionId,
      relation: "objc_dispatch",
      resolution:
        className !== null && implementation.decode.status === "decoded"
          ? "resolved"
          : "inferred",
      evidence: [...action.evidence, ...implementation.evidence],
      limitations:
        className === null
          ? [
              "The selector uniquely matches a encoded or symbolized method, but the Interface Builder receiver is an unresolved placeholder; runtime dispatch was not observed.",
            ]
          : [
              "The Interface Builder target and encoded or symbolized method agree on class and selector; runtime dispatch and dynamically supplied targets were not observed.",
            ],
    });
    resolved += 1;
    if (className === null) inferredWithoutOwnerClass += 1;
  }

  return nativeInvestigationGraphSchema.parse({
    ...graph,
    provider: {
      id: "rea-native-investigation",
      version: null,
      tool_version: "rea-native-investigation/1",
    },
    nodes: [...nodes.values()],
    edges,
    coverage: [
      ...graph.coverage,
      {
        facet: "ui_to_objc_dispatch",
        status:
          examined === resolved && inferredWithoutOwnerClass === 0
            ? "complete"
            : "partial",
        reason:
          examined === resolved && inferredWithoutOwnerClass === 0
            ? null
            : inferredWithoutOwnerClass > 0
              ? "some_action_receivers_remain_placeholders"
              : "some_action_implementations_not_resolved",
        examined,
        omitted: examined - resolved + inferredWithoutOwnerClass,
      },
    ],
  });
};
