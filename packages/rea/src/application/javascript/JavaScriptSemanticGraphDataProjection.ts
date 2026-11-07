import type { JavaScriptSemanticGraphNode } from "../../domain/javascript/javascriptSemanticGraphSchemas.js";
import type {
  JavaScriptSemanticBoundaryOperation,
  JavaScriptSemanticConfigurationOperation,
  JavaScriptSemanticRequestOperation,
} from "../../domain/javascript/javascriptSemanticIr.js";
import {
  retainSemanticGraphNode,
  addSemanticGraphRelation,
  addSemanticGraphUnknown,
} from "./JavaScriptSemanticGraphConstruction.js";
import { unknownSemanticEvidence } from "./JavaScriptSemanticGraphEvidence.js";
import {
  projectSemanticResultBindings,
  type SemanticFlowProjectionContext,
} from "./JavaScriptSemanticGraphFlowProjection.js";
import { semanticResourceLimitReason } from "../../domain/javascript/javascriptSemanticResourceLimits.js";

/** Project environment, argv, file, default, and precedence candidates. */
export const projectSemanticConfiguration = (
  context: SemanticFlowProjectionContext,
): void => {
  const configNodes = new Map(
    context.ir.configurationOperations.flatMap((operation) => {
      const node = addConfigurationNode(context, operation);
      return node === null ? [] : [[operation.configId, node] as const];
    }),
  );
  for (const operation of context.ir.configurationOperations) {
    const config = configNodes.get(operation.configId);
    if (config === undefined) continue;
    const target = bindingOrOwner(
      context,
      operation.resultBindingId,
      operation.ownerCallableId,
    );
    addSemanticGraphRelation(context.state, {
      source: config,
      target,
      relation: configurationRelation(operation),
      resolution:
        operation.resolution === "complete" ? "resolved" : "candidate",
    });
    if (operation.kind === "default" && operation.sourceConfigId !== null)
      addSemanticGraphRelation(context.state, {
        source: configNodes.get(operation.sourceConfigId),
        target: config,
        relation: "overrides",
        resolution:
          operation.resolution === "complete" ? "resolved" : "candidate",
      });
    if (operation.resolution !== "complete")
      addDataUnknown({
        context,
        node: config,
        family: "configuration",
        relationKinds: [
          configurationRelation(operation),
          ...(operation.kind === "default" ? (["overrides"] as const) : []),
        ],
        location: operation.location,
        ...(operation.valueResourceLimit === undefined
          ? {
              detail:
                operation.kind === "default"
                  ? "Static default configuration value is partial."
                  : `Static ${operation.kind} configuration identity is partial.`,
            }
          : {
              reason: "resource-limit",
              detail: semanticResourceLimitReason(operation.valueResourceLimit),
            }),
        candidateNodeIds: [],
      });
  }
};

const addConfigurationNode = (
  context: SemanticFlowProjectionContext,
  operation: JavaScriptSemanticConfigurationOperation,
): JavaScriptSemanticGraphNode | null =>
  retainSemanticGraphNode(context.state, context.file, {
    kind: "config-source",
    roleKey: operation.configId,
    location: operation.location,
    label: operation.key ?? operation.kind,
    functionNodeId:
      operation.ownerCallableId === null
        ? null
        : (context.callableNodes.get(operation.ownerCallableId)?.node_id ??
          null),
    properties: {
      key: operation.key,
      source_kind: operation.kind,
      value: operation.value,
      ...(operation.valueResourceLimit === undefined
        ? {}
        : { value_resource_limit: operation.valueResourceLimit }),
    },
  });

const configurationRelation = (
  operation: JavaScriptSemanticConfigurationOperation,
): "reads-environment" | "reads-argv" | "reads-config" | "defaults" =>
  operation.kind === "environment"
    ? "reads-environment"
    : operation.kind === "argv"
      ? "reads-argv"
      : operation.kind === "file"
        ? "reads-config"
        : "defaults";

/** Project request construction, field provenance, and response consumers. */
export const projectSemanticRequests = (
  context: SemanticFlowProjectionContext,
): void => {
  const requestNodes = new Map(
    context.ir.requestOperations.flatMap((operation) => {
      const node = addRequestNode(context, operation);
      return node === null ? [] : [[operation.requestId, node] as const];
    }),
  );
  for (const operation of context.ir.requestOperations) {
    const request = requestNodes.get(operation.requestId);
    if (request === undefined) continue;
    if (operation.kind === "request")
      projectRequestConstruction(context, operation, request);
    else projectResponseConsumer(context, operation, request);
    if (operation.resolution !== "complete")
      addDataUnknown({
        context,
        node: request,
        family: "request",
        relationKinds:
          operation.kind === "request"
            ? ["constructs-request", "supplies-request-field"]
            : ["consumed-by"],
        location: operation.location,
        detail: `Static ${operation.method} request resolution was ${operation.resolution}.`,
        candidateNodeIds: operation.linkedRequestIds.flatMap((identifier) => {
          const candidate = requestNodes.get(identifier);
          return candidate === undefined ? [] : [candidate.node_id];
        }),
      });
  }
};

const addRequestNode = (
  context: SemanticFlowProjectionContext,
  operation: JavaScriptSemanticRequestOperation,
): JavaScriptSemanticGraphNode | null =>
  retainSemanticGraphNode(context.state, context.file, {
    kind: operation.kind === "request" ? "request" : "response",
    roleKey: operation.requestId,
    location: operation.location,
    label:
      operation.endpoint !== null &&
      operation.endpoint.length <= operation.method.length
        ? operation.endpoint
        : operation.method,
    functionNodeId:
      operation.ownerCallableId === null
        ? null
        : (context.callableNodes.get(operation.ownerCallableId)?.node_id ??
          null),
    properties: {
      endpoint: operation.endpoint,
      method: operation.method,
      operation_kind: operation.kind,
    },
  });

const projectRequestConstruction = (
  context: SemanticFlowProjectionContext,
  operation: JavaScriptSemanticRequestOperation,
  request: JavaScriptSemanticGraphNode,
): void => {
  const callSite = context.callSiteAt(operation.location);
  addSemanticGraphRelation(context.state, {
    source: callSite,
    target: request,
    relation: "constructs-request",
    resolution: operation.resolution === "complete" ? "resolved" : "candidate",
  });
  projectSemanticResultBindings(
    context,
    request,
    operation.projectedResultBindings,
  );
  for (const field of operation.fields)
    addSemanticGraphRelation(context.state, {
      source:
        field.sourceBindingId === null
          ? callSite
          : context.bindingNodes.get(field.sourceBindingId),
      target: request,
      relation: "supplies-request-field",
      resolution: field.sourceBindingId === null ? "candidate" : "resolved",
      properties: { field: field.name },
    });
};

const projectResponseConsumer = (
  context: SemanticFlowProjectionContext,
  operation: JavaScriptSemanticRequestOperation,
  response: JavaScriptSemanticGraphNode,
): void => {
  addSemanticGraphRelation(context.state, {
    source: response,
    target: context.callSiteAt(operation.location),
    relation: "consumed-by",
    resolution: operation.resolution === "complete" ? "resolved" : "candidate",
    properties: { method: operation.method },
  });
};

/** Project parse, coercion, and validation consumers as static boundaries. */
export const projectSemanticBoundaries = (
  context: SemanticFlowProjectionContext,
): void => {
  for (const operation of context.ir.boundaryOperations) {
    const boundary = addBoundaryNode(context, operation);
    if (boundary === null) continue;
    addSemanticGraphRelation(context.state, {
      source: bindingOrOwner(
        context,
        operation.sourceBindingId,
        operation.ownerCallableId,
      ),
      target: boundary,
      relation:
        operation.kind === "parse"
          ? "parses"
          : operation.kind === "coerce"
            ? "coerces"
            : "validates",
      resolution:
        operation.resolution === "complete" ? "resolved" : "candidate",
    });
    // The producer only supplies a scalar result binding when this call is
    // the assigned value itself, rather than an operand of another expression.
    if (operation.resultBindingId !== null)
      addSemanticGraphRelation(context.state, {
        source: boundary,
        target: context.bindingNodes.get(operation.resultBindingId),
        relation: "defines",
        resolution:
          operation.resolution === "complete" ? "resolved" : "candidate",
      });
    if (operation.resolution !== "complete")
      addDataUnknown({
        context,
        node: boundary,
        family: "boundary",
        relationKinds: [
          operation.kind === "parse"
            ? "parses"
            : operation.kind === "coerce"
              ? "coerces"
              : "validates",
        ],
        location: operation.location,
        detail: `Static ${operation.method} boundary kind is a candidate.`,
        candidateNodeIds: [],
      });
  }
};

const addBoundaryNode = (
  context: SemanticFlowProjectionContext,
  operation: JavaScriptSemanticBoundaryOperation,
): JavaScriptSemanticGraphNode | null =>
  retainSemanticGraphNode(context.state, context.file, {
    kind: "boundary",
    roleKey: operation.boundaryId,
    location: operation.location,
    label: operation.method,
    functionNodeId:
      operation.ownerCallableId === null
        ? null
        : (context.callableNodes.get(operation.ownerCallableId)?.node_id ??
          null),
    properties: {
      boundary_kind: operation.kind,
      field: operation.method,
      method: operation.method,
    },
  });

const bindingOrOwner = (
  context: SemanticFlowProjectionContext,
  bindingId: string | null,
  callableId: string | null,
): JavaScriptSemanticGraphNode =>
  (bindingId === null ? undefined : context.bindingNodes.get(bindingId)) ??
  (callableId === null
    ? context.moduleNode
    : (context.callableNodes.get(callableId) ?? context.moduleNode));

interface DataUnknownInput {
  readonly reason?: "ambiguous-target" | "resource-limit";
  readonly context: SemanticFlowProjectionContext;
  readonly node: JavaScriptSemanticGraphNode;
  readonly family: "boundary" | "configuration" | "request";
  readonly relationKinds: readonly (
    | "coerces"
    | "constructs-request"
    | "consumed-by"
    | "defaults"
    | "overrides"
    | "parses"
    | "reads-argv"
    | "reads-config"
    | "reads-environment"
    | "supplies-request-field"
    | "validates"
  )[];
  readonly location: JavaScriptSemanticBoundaryOperation["location"];
  readonly detail: string;
  readonly candidateNodeIds: readonly string[];
}

const addDataUnknown = (input: DataUnknownInput): void => {
  const {
    context,
    node,
    family,
    relationKinds,
    location,
    detail,
    candidateNodeIds,
  } = input;
  addSemanticGraphUnknown(context.state, {
    node_id: node.node_id,
    family,
    relation_kinds: relationKinds,
    reason: input.reason ?? "ambiguous-target",
    detail,
    candidate_node_ids: candidateNodeIds,
    evidence: unknownSemanticEvidence(context.file, location),
  });
};
