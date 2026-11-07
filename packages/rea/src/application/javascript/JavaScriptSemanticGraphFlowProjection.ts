import { javascriptSourceRangeKey } from "../../domain/javascript/javascriptSourceCoordinates.js";
import type { JavaScriptSemanticGraphNode } from "../../domain/javascript/javascriptSemanticGraphSchemas.js";
import { javaScriptSemanticNodeId } from "../../domain/javascript/javascriptSemanticGraph.js";
import type {
  JavaScriptSemanticIr,
  JavaScriptSemanticProjectedResultBinding,
} from "../../domain/javascript/javascriptSemanticIr.js";
import { sourceRangesEqual } from "../../domain/javascript/javascriptStaticAnalysisHelpers.js";
import type { JavaScriptSourceRange } from "../../domain/javascript/javascriptStaticAnalysisTypes.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import {
  retainSemanticGraphNode,
  addSemanticGraphRelation,
  addSemanticGraphUnknown,
  type SemanticGraphProjectionState,
} from "./JavaScriptSemanticGraphConstruction.js";
import {
  inferredSemanticEvidenceAt,
  unknownSemanticEvidence,
} from "./JavaScriptSemanticGraphEvidence.js";

/** File-local graph state needed by return, capture, and frontier projection. */
export interface SemanticFlowProjectionContext {
  readonly file: JavaScriptArtifactFile;
  readonly ir: JavaScriptSemanticIr;
  readonly state: SemanticGraphProjectionState;
  readonly moduleNode: JavaScriptSemanticGraphNode;
  readonly bindingNodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>;
  readonly callableNodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>;
  readonly callSiteNodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>;
  readonly returnSiteNodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>;
  readonly readNodes: JavaScriptSemanticGraphNode[];
  readonly writeNodes: JavaScriptSemanticGraphNode[];
  readonly referenceNodes: readonly JavaScriptSemanticGraphNode[];
  readonly referenceNodesWithin: (
    range: JavaScriptSourceRange,
  ) => JavaScriptSemanticGraphNode[];
  readonly callSiteAt: (
    range: JavaScriptSourceRange,
  ) => JavaScriptSemanticGraphNode | undefined;
}

/** Project result destructuring consistently for timers, child processes, and requests. */
export const projectSemanticResultBindings = (
  context: Pick<SemanticFlowProjectionContext, "state" | "bindingNodes">,
  source: JavaScriptSemanticGraphNode | undefined,
  bindings: readonly JavaScriptSemanticProjectedResultBinding[],
): void => {
  for (const projected of bindings)
    addSemanticGraphRelation(context.state, {
      source,
      target: context.bindingNodes.get(projected.bindingId),
      relation: "destructures",
      resolution:
        projected.resolution === "complete" ? "resolved" : "candidate",
      properties: {
        projection_path: [...projected.projectionPath],
        projection_resolution: projected.resolution,
      },
    });
};

/** Project explicit static Promise/task ownership without runtime claims. */
export const projectSemanticPromises = (
  context: SemanticFlowProjectionContext,
): void => {
  const promiseNodes = new Map(
    context.ir.promiseOperations.flatMap((operation) => {
      const owner =
        operation.ownerCallableId === null
          ? undefined
          : context.callableNodes.get(operation.ownerCallableId);
      const node = retainSemanticGraphNode(context.state, context.file, {
        kind: operation.kind === "awaited-expression" ? "task" : "promise",
        roleKey: operation.promiseId,
        location: operation.location,
        label: promiseLabel(operation),
        functionNodeId: owner?.node_id ?? null,
        properties: {
          method: operation.method,
          operation_kind: operation.kind,
          ownership: operation.ownership,
          source_resolution: operation.sourceResolution,
        },
      });
      return node === null ? [] : [[operation.promiseId, node] as const];
    }),
  );
  for (const operation of context.ir.promiseOperations) {
    const promise = promiseNodes.get(operation.promiseId);
    if (promise === undefined) continue;
    projectPromiseCreation(context, operation, promise);
    projectPromiseSources(context, operation, promise, promiseNodes);
    projectPromiseOwnership(context, operation, promise);
    if (
      operation.sourceResolution !== "complete" &&
      ["chain", "aggregate", "awaited-expression"].includes(operation.kind)
    )
      addPromiseUnknown(context, operation, promise, promiseNodes);
  }
};

const promiseLabel = (
  operation: JavaScriptSemanticIr["promiseOperations"][number],
): string =>
  operation.kind === "awaited-expression"
    ? "awaited expression"
    : `Promise.${operation.method}`;

const projectPromiseCreation = (
  context: SemanticFlowProjectionContext,
  operation: JavaScriptSemanticIr["promiseOperations"][number],
  promise: JavaScriptSemanticGraphNode,
): void => {
  if (operation.kind === "awaited-expression") return;
  addSemanticGraphRelation(context.state, {
    source: context.callSiteAt(operation.location),
    target: promise,
    relation: "creates-promise",
    resolution:
      operation.kind === "chain" || operation.sourceResolution !== "complete"
        ? "candidate"
        : "resolved",
  });
};

const projectPromiseSources = (
  context: SemanticFlowProjectionContext,
  operation: JavaScriptSemanticIr["promiseOperations"][number],
  promise: JavaScriptSemanticGraphNode,
  promiseNodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>,
): void => {
  for (const sourceId of operation.sourcePromiseIds) {
    const source = promiseNodes.get(sourceId);
    if (operation.kind === "aggregate")
      addSemanticGraphRelation(context.state, {
        source: promise,
        target: source,
        relation: "aggregates",
        resolution:
          operation.sourceResolution === "complete" ? "resolved" : "candidate",
      });
    else
      addSemanticGraphRelation(context.state, {
        source,
        target: promise,
        relation: "chains",
        resolution:
          operation.sourceResolution === "complete" ? "resolved" : "candidate",
      });
  }
};

const projectPromiseOwnership = (
  context: SemanticFlowProjectionContext,
  operation: JavaScriptSemanticIr["promiseOperations"][number],
  promise: JavaScriptSemanticGraphNode,
): void => {
  const owner =
    operation.ownerCallableId === null
      ? context.moduleNode
      : context.callableNodes.get(operation.ownerCallableId);
  if (operation.ownership === "awaited")
    addSemanticGraphRelation(context.state, {
      source: owner,
      target: promise,
      relation: "awaits",
      resolution: "resolved",
    });
  else if (operation.ownership === "assigned")
    addSemanticGraphRelation(context.state, {
      source:
        operation.ownerBindingId === null
          ? undefined
          : context.bindingNodes.get(operation.ownerBindingId),
      target: promise,
      relation: "owns",
      resolution: "resolved",
    });
  else if (operation.ownership === "returned")
    addSemanticGraphRelation(context.state, {
      source:
        operation.returnSiteId === null
          ? undefined
          : context.returnSiteNodes.get(operation.returnSiteId),
      target: promise,
      relation: "returns-task",
      resolution: "resolved",
    });
  else if (operation.ownership === "detached")
    addSemanticGraphRelation(context.state, {
      source: owner,
      target: promise,
      relation: "detaches-task",
      resolution: "resolved",
    });
};

const addPromiseUnknown = (
  context: SemanticFlowProjectionContext,
  operation: JavaScriptSemanticIr["promiseOperations"][number],
  promise: JavaScriptSemanticGraphNode,
  promiseNodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>,
): void => {
  const relation = operation.kind === "aggregate" ? "aggregates" : "chains";
  addSemanticGraphUnknown(context.state, {
    node_id: promise.node_id,
    family: "promise-ownership",
    relation_kinds: [relation],
    reason: "ambiguous-target",
    detail: `Static ${operation.method} source resolution was ${operation.sourceResolution}.`,
    candidate_node_ids: operation.sourcePromiseIds.flatMap((identifier) => {
      const candidate = promiseNodes.get(identifier);
      return candidate === undefined ? [] : [candidate.node_id];
    }),
    evidence: unknownSemanticEvidence(context.file, operation.location),
  });
};

interface ObjectReadIndex {
  readonly state: SemanticGraphProjectionState;
  readonly nodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>;
}

const objectReadIndexes = new WeakMap<JavaScriptSemanticIr, ObjectReadIndex>();

/**
 * The object projection owns a member read's occurrence. Index it once per
 * file so return and argument flow can connect that expression without
 * scanning every property read again.
 */
const objectReadOccurrences = (
  context: SemanticFlowProjectionContext,
): ReadonlyMap<string, JavaScriptSemanticGraphNode> => {
  const cached = objectReadIndexes.get(context.ir);
  if (cached !== undefined && cached.state === context.state)
    return cached.nodes;
  const nodes = new Map<string, JavaScriptSemanticGraphNode>();
  for (const operation of context.ir.objectOperations) {
    if (operation.kind !== "read") continue;
    const node = context.state.nodes.get(
      javaScriptSemanticNodeId({
        kind: "expression",
        identity: {
          artifact_sha256: context.file.sha256,
          module_path: context.file.path,
          source_range: operation.location,
          role_key: operation.objectOperationId,
        },
      }),
    );
    if (node !== undefined)
      nodes.set(javascriptSourceRangeKey(operation.location), node);
  }
  objectReadIndexes.set(context.ir, { state: context.state, nodes });
  return nodes;
};

/** Return the retained read occurrence for one unwrapped member expression. */
export const semanticObjectReadOccurrence = (
  context: SemanticFlowProjectionContext,
  location: JavaScriptSourceRange | null,
): JavaScriptSemanticGraphNode | undefined =>
  location === null
    ? undefined
    : objectReadOccurrences(context).get(javascriptSourceRangeKey(location));

/** Link direct return expressions to their retained semantic references. */
export const projectSemanticReturnValues = (
  context: SemanticFlowProjectionContext,
): void => {
  const expressions = new Set(
    context.ir.expressionFlows.map((flow) =>
      javascriptSourceRangeKey(flow.location),
    ),
  );
  for (const callable of context.ir.callables)
    for (const site of callable.returnSites) {
      const returnNode = context.returnSiteNodes.get(site.returnSiteId);
      const references =
        site.valueExpressionLocation !== null &&
        expressions.has(javascriptSourceRangeKey(site.valueExpressionLocation))
          ? []
          : context
              .referenceNodesWithin(site.location)
              .filter(
                (reference) =>
                  reference.function_node_id === returnNode?.function_node_id,
              );
      for (const reference of references)
        addSemanticGraphRelation(context.state, {
          source: reference,
          target: returnNode,
          relation: "aliases",
          resolution:
            site.identityReferenceLocation !== null &&
            sourceRangesEqual(
              reference.identity.source_range,
              site.identityReferenceLocation,
            )
              ? "resolved"
              : "candidate",
        });
      addSemanticGraphRelation(context.state, {
        source: semanticObjectReadOccurrence(
          context,
          site.valueExpressionLocation,
        ),
        target: returnNode,
        relation: "aliases",
        resolution: "resolved",
      });
    }
};

/** Link each captured binding to the callable at the exact reference site. */
export const projectSemanticClosureCaptures = (
  context: SemanticFlowProjectionContext,
): void => {
  for (const capture of context.ir.closureCaptures)
    addSemanticGraphRelation(context.state, {
      source: context.bindingNodes.get(capture.bindingId),
      target: context.callableNodes.get(capture.callableId),
      relation: "captures",
      resolution: "resolved",
      evidence: inferredSemanticEvidenceAt(
        context.file,
        capture.referenceLocation,
      ),
    });
};

/** Retain bounded unresolved dynamic-call, dynamic-property and dynamic-scope frontiers. */
export function* projectSemanticFrontiers(
  context: SemanticFlowProjectionContext,
): Generator<void, void> {
  for (const [index, frontier] of context.ir.frontiers.entries()) {
    if (index % 64 === 0) yield;
    // Dynamic environments leave identifier reads and writes unresolved.
    const family =
      frontier.kind === "dynamic-call"
        ? "call-flow"
        : frontier.kind === "dynamic-scope"
          ? "data-flow"
          : "object-flow";
    const relationKinds =
      frontier.kind === "dynamic-call"
        ? (["calls"] as const)
        : frontier.kind === "dynamic-scope"
          ? (["reads", "writes"] as const)
          : (["reads-property", "writes-property"] as const);
    addSemanticGraphUnknown(context.state, {
      node_id:
        frontier.callableId === null
          ? context.moduleNode.node_id
          : (context.callableNodes.get(frontier.callableId)?.node_id ??
            context.moduleNode.node_id),
      family,
      relation_kinds: [...relationKinds],
      reason: frontier.kind,
      detail: frontier.reason,
      candidate_node_ids: [],
      evidence: unknownSemanticEvidence(context.file, frontier.location),
    });
  }
}
