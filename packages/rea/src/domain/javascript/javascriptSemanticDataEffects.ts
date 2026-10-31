import * as t from "@babel/types";

import type {
  JavaScriptSemanticBoundaryOperation,
  JavaScriptSemanticCallable,
  JavaScriptSemanticConfigurationOperation,
  JavaScriptSemanticRequestOperation,
} from "./javascriptSemanticIr.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import {
  readExactJavaScriptLiteral,
  semanticStaticPropertyKey,
  semanticStaticPropertyName,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import {
  recordSemanticValueLimit,
  resolveSemanticBindingState,
  semanticResolutionBlocked,
  semanticStableInitializer,
  type JavaScriptSemanticAnalysisState,
  type JavaScriptSemanticBindingState,
} from "./javascriptSemanticState.js";
import {
  semanticBindingAtRead,
  semanticEffectTiming,
} from "./javascriptSemanticMutationInitializers.js";
import {
  builtinDataEffectMethod as builtinMethod,
  dataEffectArgumentBindingId as argumentBindingId,
  dataEffectLiteralString as literalString,
  dataEffectMemberCallee as memberCallee,
  isSemanticProcessObject as isProcessObject,
  outerDataEffectBinding as outerAssignedBinding,
  assignedSemanticResultBindings,
  semanticProjectedBindingFacts,
  traverseDataEffects as traverseWithContext,
  type DataEffectTraversalContext as TraversalContext,
} from "./javascriptSemanticDataEffectHelpers.js";
import { isUnmodifiedGlobalReference } from "./javascriptSemanticAmbientWrites.js";
import { range } from "./javascriptStaticAnalysisHelpers.js";
import { semanticPrimitiveSet } from "./javascriptSemanticPrimitives.js";
import type { JavaScriptSemanticValue } from "./javascriptSemanticValueTypes.js";

interface DataEffectAnalysis {
  readonly configurationOperations: readonly JavaScriptSemanticConfigurationOperation[];
  readonly requestOperations: readonly JavaScriptSemanticRequestOperation[];
  readonly boundaryOperations: readonly JavaScriptSemanticBoundaryOperation[];
}

interface ConfigurationCandidate {
  readonly node: t.Node;
  readonly operation: JavaScriptSemanticConfigurationOperation;
}

interface RequestCandidate {
  readonly node: t.CallExpression | t.OptionalCallExpression | t.NewExpression;
  readonly operation: JavaScriptSemanticRequestOperation;
}

/** Recover configuration, request, and boundary candidates from inert syntax. */
export const collectJavaScriptSemanticDataEffects = (
  program: t.Program,
  state: JavaScriptSemanticAnalysisState,
  callables: readonly JavaScriptSemanticCallable[],
): DataEffectAnalysis => {
  const context: TraversalContext = {
    state,
    callableIds: new Set(callables.map(({ callableId }) => callableId)),
    callableStack: [],
    ancestors: [],
  };
  const configuration = collectConfigurations(program, context);
  const requests = collectRequests(program, context);
  return {
    configurationOperations: [
      ...configuration.map(({ operation }) => operation),
      ...collectDefaults(program, context, configuration),
    ],
    requestOperations: [
      ...requests.map(({ operation }) => operation),
      ...collectResponseConsumers(program, context, requests),
    ],
    boundaryOperations: collectBoundaries(program, context),
  };
};

const collectConfigurations = (
  program: t.Program,
  context: TraversalContext,
): ConfigurationCandidate[] => {
  const output: ConfigurationCandidate[] = [];
  traverseWithContext(program, context, (node) => {
    const details = configurationDetails(node, context);
    if (details === null) return;
    const operation: JavaScriptSemanticConfigurationOperation = {
      configId: `config:${details.kind}:${String(node.start ?? -1)}:${String(node.end ?? -1)}`,
      kind: details.kind,
      location: range(node),
      ownerCallableId: context.callableStack.at(-1) ?? null,
      resultBindingId: outerAssignedBinding(node, context),
      key: details.key,
      sourceConfigId: null,
      value: null,
      resolution: details.resolution,
    };
    output.push({ node, operation });
  });
  return output;
};

const configurationDetails = (
  node: t.Node,
  context: TraversalContext,
): {
  readonly kind: "environment" | "argv" | "file";
  readonly key: string | null;
  readonly resolution: "complete" | "partial";
} | null => {
  if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
    const processMember = processConfigurationMember(node, context.state);
    if (processMember !== null) return processMember;
  }
  if (!t.isCallExpression(node) && !t.isOptionalCallExpression(node))
    return null;
  const fileMethod = builtinMethod(node.callee, context.state, [
    "fs",
    "node:fs",
  ]);
  return fileMethod === "readFile" || fileMethod === "readFileSync"
    ? {
        kind: "file",
        key: literalString(node.arguments[0]),
        resolution:
          literalString(node.arguments[0]) === null ? "partial" : "complete",
      }
    : null;
};

const processConfigurationMember = (
  node: t.MemberExpression | t.OptionalMemberExpression,
  state: JavaScriptSemanticAnalysisState,
): {
  readonly kind: "environment" | "argv";
  readonly key: string | null;
  readonly resolution: "complete" | "partial";
} | null => {
  const object = node.object;
  if (!t.isMemberExpression(object) && !t.isOptionalMemberExpression(object))
    return null;
  const family = semanticStaticPropertyName(object.property, object.computed);
  if (family !== "env" && family !== "argv") return null;
  // `process.env[""]` names an exact (empty) key; only a dynamic key is unknown.
  const key = semanticStaticPropertyKey(node.property, node.computed);
  if (family === "argv" && key !== null && !isArrayIndexKey(key)) return null;
  if (!isProcessObject(object.object, state, family, key)) return null;
  return {
    kind: family === "env" ? "environment" : "argv",
    key,
    resolution: key === null ? "partial" : "complete",
  };
};

const isArrayIndexKey = (key: string): boolean => {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index < 2 ** 32 - 1;
};

const collectDefaults = (
  program: t.Program,
  context: TraversalContext,
  configurations: readonly ConfigurationCandidate[],
): JavaScriptSemanticConfigurationOperation[] => {
  const output: JavaScriptSemanticConfigurationOperation[] = [];
  const configurationsByNode = new Map(
    configurations.map((candidate) => [candidate.node, candidate]),
  );
  traverseWithContext(program, context, (node) => {
    if (
      !t.isLogicalExpression(node) ||
      (node.operator !== "??" && node.operator !== "||")
    )
      return;
    const source = unwrapJavaScriptExpression(node.left).node;
    const candidate = configurationsByNode.get(source);
    if (candidate === undefined) return;
    const literal = readExactJavaScriptLiteral(node.right);
    const value: JavaScriptSemanticValue = literal.found
      ? semanticPrimitiveSet([literal.value])
      : { status: "unknown", reason: "Default is not an exact primitive." };
    recordSemanticValueLimit(context.state, value);
    output.push({
      configId: `config:default:${String(node.start ?? -1)}:${String(node.end ?? -1)}`,
      kind: "default",
      location: range(node.right),
      ownerCallableId: context.callableStack.at(-1) ?? null,
      resultBindingId: outerAssignedBinding(node, context),
      key: candidate.operation.key,
      sourceConfigId: candidate.operation.configId,
      value: value.status === "literal" ? value.value : null,
      ...(value.status === "unknown" && value.resourceLimit !== undefined
        ? { valueResourceLimit: value.resourceLimit }
        : {}),
      resolution: value.status === "literal" ? "complete" : "partial",
    });
  });
  return output;
};

const collectRequests = (
  program: t.Program,
  context: TraversalContext,
): RequestCandidate[] => {
  const output: RequestCandidate[] = [];
  traverseWithContext(program, context, (node) => {
    if (
      !t.isCallExpression(node) &&
      !t.isOptionalCallExpression(node) &&
      !t.isNewExpression(node)
    )
      return;
    const method = requestMethod(node, context.state);
    if (method === null) return;
    const endpoint = requestEndpoint(node);
    // `http.get`/`http.request` parse a string target with `new URL` before the
    // request exists, so a literal that is not an absolute URL throws
    // `ERR_INVALID_URL` synchronously — an options object cannot rescue it.
    // `fetch` and `WebSocket` are host globals a browser resolves against the
    // document URL, so their spellings stay as reported.
    if (
      endpoint !== null &&
      (method === "get" || method === "request") &&
      !URL.canParse(endpoint)
    )
      return;
    output.push({
      node,
      operation: {
        requestId: `request:${String(node.start ?? -1)}:${String(node.end ?? -1)}`,
        kind: "request",
        method,
        location: range(node),
        ownerCallableId: context.callableStack.at(-1) ?? null,
        resultBindingId: outerAssignedBinding(node, context),
        projectedResultBindings: semanticProjectedBindingFacts(
          assignedSemanticResultBindings(
            node,
            context.ancestors,
            context.state,
          ).filter(({ projectionPath }) => projectionPath.length > 0),
        ),
        linkedRequestIds: [],
        endpoint,
        fields: requestFields(node, method, context.state),
        resolution: endpoint === null ? "partial" : "complete",
      },
    });
  });
  return output;
};

/**
 * Any other write (assignment, update, loop or destructuring target) can
 * replace the response before this read. A sole write that can be skipped or
 * runs after the read leaves an incoming value possible.
 */
const soleWriteReachesRead = (
  binding: JavaScriptSemanticBindingState | undefined,
  read: t.Node,
  context: TraversalContext,
  request: t.Node | undefined,
): boolean => {
  if (binding === undefined || request === undefined) return false;
  const snapshot = semanticBindingAtRead(
    binding,
    read,
    context.state.parentsByNode,
  );
  const initializers = snapshot.binding.initializers.filter(
    ({ node }) => semanticEffectTiming(read, node, context.state) !== "after",
  );
  const [initializer] = initializers;
  if (initializers.length !== 1 || initializer === undefined) return false;
  // The result itself must be this request. Containing a request in a branch
  // or child allocation does not prove the entire initializer is its response.
  let source = unwrapJavaScriptExpression(initializer.node).node;
  while (t.isAwaitExpression(source))
    source = unwrapJavaScriptExpression(source.argument).node;
  return (
    source === request &&
    !snapshot.binding.referenceInitializers.some(
      ({ assignment, node }) =>
        assignment &&
        semanticEffectTiming(read, node, context.state) !== "after",
    ) &&
    (semanticStableInitializer(binding, context.state) !== undefined ||
      snapshot.hasDefiniteInitializer)
  );
};

const collectResponseConsumers = (
  program: t.Program,
  context: TraversalContext,
  requests: readonly RequestCandidate[],
): JavaScriptSemanticRequestOperation[] => {
  const requestsByBinding = new Map<string, RequestCandidate[]>();
  for (const request of requests) {
    const bindingIds = [
      ...(request.operation.resultBindingId === null
        ? []
        : [request.operation.resultBindingId]),
      ...request.operation.projectedResultBindings.map(
        ({ bindingId }) => bindingId,
      ),
    ];
    for (const bindingId of bindingIds) {
      const existing = requestsByBinding.get(bindingId) ?? [];
      existing.push(request);
      requestsByBinding.set(bindingId, existing);
    }
  }
  const output: JavaScriptSemanticRequestOperation[] = [];
  traverseWithContext(program, context, (node) => {
    if (!t.isCallExpression(node) && !t.isOptionalCallExpression(node)) return;
    const member = memberCallee(node);
    if (member === null || !t.isIdentifier(member.object)) return;
    const method = semanticStaticPropertyName(member.property, member.computed);
    if (method !== "json" && method !== "text" && method !== "arrayBuffer")
      return;
    const binding = resolveSemanticBindingState(
      context.state,
      member.object,
      member.object.name,
    );
    const linked =
      binding === undefined
        ? []
        : (requestsByBinding.get(binding.bindingId) ?? []);
    if (linked.length === 0) return;
    // A consumer of exactly one request through its own result binding
    // reads that request's response, so it keeps the request's endpoint.
    const uniqueRequest =
      linked.length === 1 &&
      !linked[0]?.operation.projectedResultBindings.some(
        ({ bindingId }) => bindingId === binding?.bindingId,
      )
        ? linked[0]
        : undefined;
    const soleWrite = soleWriteReachesRead(
      binding,
      member.object,
      context,
      uniqueRequest?.node,
    );
    output.push({
      requestId: `response:${String(node.start ?? -1)}:${String(node.end ?? -1)}`,
      kind: "response-consumer",
      method,
      location: range(node),
      ownerCallableId: context.callableStack.at(-1) ?? null,
      resultBindingId: outerAssignedBinding(node, context),
      projectedResultBindings: semanticProjectedBindingFacts(
        assignedSemanticResultBindings(
          node,
          context.ancestors,
          context.state,
        ).filter(({ projectionPath }) => projectionPath.length > 0),
      ),
      linkedRequestIds: linked
        .map(({ operation }) => operation.requestId)
        .sort(compareUnicodeCodePoints),
      endpoint: soleWrite ? (uniqueRequest?.operation.endpoint ?? null) : null,
      fields: [],
      resolution: uniqueRequest === undefined ? "partial" : "complete",
    });
  });
  return output;
};

const collectBoundaries = (
  program: t.Program,
  context: TraversalContext,
): JavaScriptSemanticBoundaryOperation[] => {
  const output: JavaScriptSemanticBoundaryOperation[] = [];
  traverseWithContext(program, context, (node) => {
    if (!t.isCallExpression(node) && !t.isOptionalCallExpression(node)) return;
    const details = boundaryDetails(node, context.state);
    if (details === null) return;
    output.push({
      boundaryId: `boundary:${details.kind}:${String(node.start ?? -1)}:${String(node.end ?? -1)}`,
      kind: details.kind,
      method: details.method,
      location: range(node),
      ownerCallableId: context.callableStack.at(-1) ?? null,
      sourceBindingId: argumentBindingId(node.arguments[0], context.state),
      resultBindingId: outerAssignedBinding(node, context),
      resolution: details.resolution,
    });
  });
  return output;
};

const boundaryDetails = (
  node: t.CallExpression | t.OptionalCallExpression,
  state: JavaScriptSemanticAnalysisState,
): {
  readonly kind: JavaScriptSemanticBoundaryOperation["kind"];
  readonly method: string;
  readonly resolution: "complete" | "partial";
} | null => {
  if (t.isIdentifier(node.callee)) {
    const name = node.callee.name;
    const unbound =
      resolveSemanticBindingState(state, node.callee, name) === undefined &&
      !semanticResolutionBlocked(state, node.callee, name);
    if (
      unbound &&
      ["String", "Number", "Boolean", "parseInt", "parseFloat"].includes(
        name,
      ) &&
      isUnmodifiedGlobalReference(node.callee, state, name)
    )
      return { kind: "coerce", method: name, resolution: "complete" };
  }
  const member = memberCallee(node);
  if (member === null) return null;
  const method = semanticStaticPropertyName(member.property, member.computed);
  if (
    method === "parse" &&
    t.isIdentifier(member.object, { name: "JSON" }) &&
    resolveSemanticBindingState(state, member.object, "JSON") === undefined &&
    !semanticResolutionBlocked(state, member.object, "JSON") &&
    isUnmodifiedGlobalReference(node.callee, state, ["JSON", "parse"])
  )
    return { kind: "parse", method: "JSON.parse", resolution: "complete" };
  if (method === "parse" || method === "safeParse")
    return { kind: "parse", method, resolution: "partial" };
  if (method === "validate" || method === "assert" || method === "is")
    return { kind: "validate", method, resolution: "partial" };
  return null;
};

const requestMethod = (
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptSemanticRequestOperation["method"] | null => {
  if (t.isIdentifier(node.callee)) {
    const name = node.callee.name;
    const unbound =
      resolveSemanticBindingState(state, node.callee, name) === undefined &&
      !semanticResolutionBlocked(state, node.callee, name);
    const global = t.isNewExpression(node) ? "WebSocket" : "fetch";
    if (
      unbound &&
      name === global &&
      isUnmodifiedGlobalReference(node.callee, state, name)
    )
      return global;
  }
  const method = builtinMethod(node.callee, state, [
    "http",
    "https",
    "node:http",
    "node:https",
  ]);
  return method === "request" || method === "get" ? method : null;
};

const requestFields = (
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  method: JavaScriptSemanticRequestOperation["method"],
  state: JavaScriptSemanticAnalysisState,
): JavaScriptSemanticRequestOperation["fields"] => {
  const candidate =
    method === "fetch" || method === "WebSocket"
      ? node.arguments[1]
      : t.isObjectExpression(node.arguments[0])
        ? node.arguments[0]
        : node.arguments[1];
  if (!t.isObjectExpression(candidate)) return [];
  return candidate.properties.flatMap((property) => {
    if (!t.isObjectProperty(property)) return [];
    // `{[key]: 1}` sends no knowable field name; reporting `key` would invent
    // a request field that may not exist.
    const name = semanticStaticPropertyKey(property.key, property.computed);
    if (name === null) return [];
    return [
      {
        name,
        sourceBindingId: t.isIdentifier(property.value)
          ? (resolveSemanticBindingState(
              state,
              property.value,
              property.value.name,
            )?.bindingId ?? null)
          : null,
      },
    ];
  });
};

const requestEndpoint = (
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
): string | null =>
  t.isObjectExpression(node.arguments[0])
    ? null
    : literalString(node.arguments[0]);
