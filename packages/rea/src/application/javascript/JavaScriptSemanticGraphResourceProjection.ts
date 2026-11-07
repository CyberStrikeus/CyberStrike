import type { JavaScriptSemanticGraphNode } from "../../domain/javascript/javascriptSemanticGraphSchemas.js";
import type { JavaScriptSemanticResourceOperation } from "../../domain/javascript/javascriptSemanticIr.js";
import {
  retainSemanticGraphNode,
  addSemanticGraphRelation,
  addSemanticGraphUnknown,
} from "./JavaScriptSemanticGraphConstruction.js";
import { unknownSemanticEvidence } from "./JavaScriptSemanticGraphEvidence.js";
import type { SemanticFlowProjectionContext } from "./JavaScriptSemanticGraphFlowProjection.js";

/** Project built-in resource acquisition and exact local release handles. */
export const projectSemanticResources = (
  context: SemanticFlowProjectionContext,
): void => {
  const resourceNodes = new Map(
    context.ir.resourceOperations.flatMap((operation) => {
      if (operation.kind !== "acquire") return [];
      const node = addResourceNode(context, operation);
      return node === null ? [] : [[operation.resourceId, node] as const];
    }),
  );
  for (const operation of context.ir.resourceOperations)
    if (operation.kind === "acquire")
      addSemanticGraphRelation(context.state, {
        source: context.callSiteAt(operation.location),
        target: resourceNodes.get(operation.resourceId),
        relation: "acquires",
        resolution: "resolved",
      });
    else projectRelease(context, operation, resourceNodes);
};

const addResourceNode = (
  context: SemanticFlowProjectionContext,
  operation: JavaScriptSemanticResourceOperation,
): JavaScriptSemanticGraphNode | null =>
  retainSemanticGraphNode(context.state, context.file, {
    kind: "resource",
    roleKey: operation.resourceId,
    location: operation.location,
    label: operation.method,
    functionNodeId:
      operation.ownerCallableId === null
        ? null
        : (context.callableNodes.get(operation.ownerCallableId)?.node_id ??
          null),
    properties: { method: operation.method },
  });

const projectRelease = (
  context: SemanticFlowProjectionContext,
  operation: JavaScriptSemanticResourceOperation,
  resourceNodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>,
): void => {
  const callSite = context.callSiteAt(operation.location);
  const resources = operation.linkedResourceIds.flatMap((identifier) => {
    const resource = resourceNodes.get(identifier);
    return resource === undefined ? [] : [resource];
  });
  for (const resource of resources)
    addSemanticGraphRelation(context.state, {
      source: callSite,
      target: resource,
      relation: "releases",
      resolution:
        operation.resolution === "complete" ? "resolved" : "candidate",
    });
  if (operation.resolution === "complete") return;
  addSemanticGraphUnknown(context.state, {
    node_id: callSite?.node_id ?? null,
    family: "resource-lifecycle",
    relation_kinds: ["releases"],
    reason: "ambiguous-target",
    detail: `Static ${operation.method} resource ownership is ambiguous.`,
    candidate_node_ids: resources.map(({ node_id: identifier }) => identifier),
    evidence: unknownSemanticEvidence(context.file, operation.location),
  });
};
