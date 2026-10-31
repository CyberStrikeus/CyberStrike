import * as t from "@babel/types";

import type {
  JavaScriptSemanticArgumentFlow,
  JavaScriptSemanticCallable,
  JavaScriptSemanticCallResultFlow,
  JavaScriptSemanticCallReturnFlow,
  JavaScriptSemanticCallSite,
  JavaScriptSemanticClosureCapture,
  JavaScriptSemanticFrontier,
} from "./javascriptSemanticIr.js";
import { semanticIdentifierRole } from "./javascriptSemanticProjection.js";
import { createSemanticCallableStack } from "./javascriptSemanticCallableStack.js";
import {
  javaScriptExpressionWrapperTarget,
  readExactJavaScriptLiteral,
  semanticStaticPropertyKey,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import {
  resolveSemanticBindingState,
  type JavaScriptSemanticAnalysisState,
  type JavaScriptSemanticBindingState,
} from "./javascriptSemanticState.js";
import {
  type LocalCallableResolution,
  parameterBindings,
  resolveLocalCallables,
} from "./javascriptSemanticCallResolution.js";
import { traverseJavaScriptValueAst } from "./javascriptSemanticTraversal.js";
import { range } from "./javascriptStaticAnalysisHelpers.js";
import { semanticCallableResultKind } from "./javascriptSemanticCallableResults.js";
import { assignedSemanticResultBindings } from "./javascriptSemanticDataEffectHelpers.js";
import { semanticPrimitiveSet } from "./javascriptSemanticPrimitives.js";

/** Local call, flow, capture, and unsupported-frontier facts. */
export interface JavaScriptSemanticCallAnalysis {
  readonly callSites: readonly JavaScriptSemanticCallSite[];
  readonly argumentFlows: readonly JavaScriptSemanticArgumentFlow[];
  readonly callReturnFlows: readonly JavaScriptSemanticCallReturnFlow[];
  readonly callResultFlows: readonly JavaScriptSemanticCallResultFlow[];
  readonly closureCaptures: readonly JavaScriptSemanticClosureCapture[];
  readonly frontiers: readonly JavaScriptSemanticFrontier[];
}

interface MutableCallAnalysis {
  readonly callSites: JavaScriptSemanticCallSite[];
  readonly argumentFlows: JavaScriptSemanticArgumentFlow[];
  readonly callReturnFlows: JavaScriptSemanticCallReturnFlow[];
  readonly callResultFlows: JavaScriptSemanticCallResultFlow[];
  readonly closureCaptures: JavaScriptSemanticClosureCapture[];
  readonly frontiers: JavaScriptSemanticFrontier[];
}

interface CallCollectionContext {
  readonly state: JavaScriptSemanticAnalysisState;
  readonly callableById: ReadonlyMap<string, JavaScriptSemanticCallable>;
  readonly output: MutableCallAnalysis;
  readonly bindingResolutionCache: WeakMap<
    t.Identifier,
    LocalCallableResolution
  >;
  readonly parameterBindingCache: Map<
    string,
    readonly JavaScriptSemanticBindingState[]
  >;
  readonly ancestors: t.Node[];
}

/** Recover direct-call and lexical-capture candidates from inert syntax. */
export const collectJavaScriptSemanticCalls = (
  program: t.Program,
  state: JavaScriptSemanticAnalysisState,
  callables: readonly JavaScriptSemanticCallable[],
): JavaScriptSemanticCallAnalysis => {
  const output: MutableCallAnalysis = {
    callSites: [],
    argumentFlows: [],
    callReturnFlows: [],
    callResultFlows: [],
    closureCaptures: [],
    frontiers: [],
  };
  const callableById = new Map(
    callables.map((callable) => [callable.callableId, callable]),
  );
  const context: CallCollectionContext = {
    state,
    callableById,
    output,
    bindingResolutionCache: new WeakMap(),
    parameterBindingCache: new Map(),
    ancestors: [],
  };
  const callableStack = createSemanticCallableStack((callableId) =>
    callableById.get(callableId),
  );
  traverseJavaScriptValueAst(program, state.erasedSyntaxNodes, {
    enter: (node, parent) => {
      callableStack.enter(node, parent);
      const owner = enclosingFunction(callableStack.callables);
      collectCapture(node, parent, owner, context);
      collectDynamicProperty(node, owner, state, output);
      collectDynamicScope(node, owner, state, output);
      if (
        t.isCallExpression(node) ||
        t.isOptionalCallExpression(node) ||
        t.isNewExpression(node)
      )
        collectCallSite(node, parent, owner, context);
      context.ancestors.push(node);
    },
    exit: (node) => {
      context.ancestors.pop();
      callableStack.exit(node);
    },
  });
  return {
    callSites: output.callSites,
    argumentFlows: output.argumentFlows,
    callReturnFlows: output.callReturnFlows,
    callResultFlows: output.callResultFlows,
    closureCaptures: output.closureCaptures,
    frontiers: output.frontiers,
  };
};

/** TypeScript and grouping wrappers do not consume a call result. */
const callResultIsUsed = (
  call: t.Node,
  parent: t.Node | null,
  ancestors: readonly t.Node[],
): boolean => {
  let current = parent;
  let child = call;
  let index = ancestors.length - 1;
  while (
    current !== null &&
    javaScriptExpressionWrapperTarget(current) !== undefined
  ) {
    child = current;
    index -= 1;
    current = index >= 0 ? (ancestors[index] ?? null) : null;
  }
  if (t.isExpressionStatement(current)) return false;
  // for/of and for/in heads use their expressions. A C-style for initializer
  // or update discards the value.
  return !(
    t.isForStatement(current) &&
    (current.init === child || current.update === child)
  );
};

const collectCallSite = (
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  parent: t.Node | null,
  owner: JavaScriptSemanticCallable | undefined,
  context: CallCollectionContext,
): void => {
  const { state, callableById, output } = context;
  const resolution = resolveLocalCallables({
    node: node.callee,
    state,
    callableById,
    seenInitializers: new Set(),
    bindingCache: context.bindingResolutionCache,
  });
  const callSiteId = semanticCallSiteId(node);
  const argumentsValue = retainedArguments(node.arguments, state);
  const site: JavaScriptSemanticCallSite = {
    callSiteId,
    kind: t.isNewExpression(node) ? "construct" : "call",
    callerCallableId: owner?.callableId ?? null,
    location: range(node),
    calleeLocation: range(node.callee),
    resultUsed: callResultIsUsed(node, parent, context.ancestors),
    resolution:
      resolution.callableIds.length === 1 && resolution.complete
        ? "exact"
        : resolution.callableIds.length > 0
          ? "ambiguous"
          : "unresolved",
    calleeCallableIds: resolution.callableIds,
    arguments: argumentsValue,
  };
  output.callSites.push(site);
  collectCallResultFlow(site, node, context);
  if (site.resolution !== "exact")
    addFrontier(
      {
        kind: "dynamic-call",
        callableId: owner?.callableId ?? null,
        location: range(node.callee),
        reason: resolution.reason,
      },
      state,
      output,
    );
  collectArgumentFlows(site, node, context);
  if (site.kind === "call")
    collectReturnFlows(site, callableById, state, output);
};

const collectCallResultFlow = (
  site: JavaScriptSemanticCallSite,
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  context: CallCollectionContext,
): void => {
  for (const assigned of assignedSemanticResultBindings(
    node,
    context.ancestors,
    context.state,
  ).filter(({ projectionPath }) => projectionPath.length === 0)) {
    const binding = context.state.bindingsById.get(assigned.bindingId);
    if (binding === undefined) continue;
    const identifierRange = range(assigned.identifier);
    const definition = binding.definitions.find(
      ({ location }) =>
        location.start.line === identifierRange.start.line &&
        location.start.column === identifierRange.start.column &&
        location.end.line === identifierRange.end.line &&
        location.end.column === identifierRange.end.column,
    );
    if (definition === undefined) continue;
    context.output.callResultFlows.push({
      callSiteId: site.callSiteId,
      bindingId: binding.bindingId,
      definitionLocation: definition.location,
    });
  }
};

const retainedArguments = (
  nodes: readonly (
    | t.Expression
    | t.SpreadElement
    | t.JSXNamespacedName
    | t.ArgumentPlaceholder
    | null
  )[],
  state: JavaScriptSemanticAnalysisState,
): JavaScriptSemanticCallSite["arguments"] => {
  const retained: JavaScriptSemanticCallSite["arguments"][number][] = [];
  for (const [index, node] of nodes.entries()) {
    // Babel recovery can leave null slots; retain the other argument positions.
    if (node === null) continue;
    const valueNode =
      t.isExpression(node) && !t.isSpreadElement(node)
        ? unwrapJavaScriptExpression(node).node
        : null;
    retained.push({
      index,
      location: range(node),
      valueExpressionLocation: valueNode === null ? null : range(valueNode),
      spread: t.isSpreadElement(node),
      ...(valueNode === null ? {} : directLiteral(valueNode, state)),
    });
  }
  return retained;
};

/** Retain direct scalar syntax only; do not infer values through bindings. */
const directLiteral = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
): {
  readonly literal?: string | number | boolean | null;
  readonly literalResourceLimit?: "primitive-bytes";
} => {
  const literal = readExactJavaScriptLiteral(node);
  if (!literal.found) return {};
  const parsed = semanticPrimitiveSet([literal.value]);
  if (parsed.status === "literal") return { literal: parsed.value };
  if (
    parsed.status === "unknown" &&
    parsed.resourceLimit === "primitive-bytes"
  ) {
    state.valueResourceLimits.add(parsed.resourceLimit);
    return { literalResourceLimit: parsed.resourceLimit };
  }
  return {};
};

const collectArgumentFlows = (
  site: JavaScriptSemanticCallSite,
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  context: CallCollectionContext,
): void => {
  const { callableById, output } = context;
  const retainedIndexes = new Set(site.arguments.map(({ index }) => index));
  let positionIsExact = true;
  for (const [index, argument] of node.arguments.entries()) {
    if (t.isSpreadElement(argument)) {
      positionIsExact = false;
      continue;
    }
    if (
      !positionIsExact ||
      !retainedIndexes.has(index) ||
      !t.isExpression(argument)
    )
      continue;
    for (const callableId of site.calleeCallableIds) {
      const callable = callableById.get(callableId);
      if (callable === undefined) continue;
      for (const parameter of cachedParameterBindings(
        callable,
        index,
        context,
      )) {
        const definition = parameter.definitions.find(
          ({ kind }) => kind === "parameter",
        );
        if (definition === undefined) continue;
        output.argumentFlows.push({
          callSiteId: site.callSiteId,
          argumentIndex: index,
          argumentLocation: range(argument),
          callableId,
          parameterBindingId: parameter.bindingId,
          parameterLocation: definition.location,
        });
      }
    }
  }
};

const cachedParameterBindings = (
  callable: JavaScriptSemanticCallable,
  index: number,
  context: CallCollectionContext,
): readonly JavaScriptSemanticBindingState[] => {
  const key = `${callable.callableId}:${String(index)}`;
  const cached = context.parameterBindingCache.get(key);
  if (cached !== undefined) return cached;
  const bindings = parameterBindings(callable, index, context.state);
  context.parameterBindingCache.set(key, bindings);
  return bindings;
};

const collectReturnFlows = (
  site: JavaScriptSemanticCallSite,
  callableById: ReadonlyMap<string, JavaScriptSemanticCallable>,
  state: JavaScriptSemanticAnalysisState,
  output: MutableCallAnalysis,
): void => {
  for (const callableId of site.calleeCallableIds) {
    const callable = callableById.get(callableId);
    if (callable === undefined) continue;
    const source = state.callableNodesById.get(callableId);
    const kind =
      source === undefined ? "value" : semanticCallableResultKind(source);
    if (kind !== "value") {
      addFrontier(
        {
          kind: "dynamic-call",
          callableId: site.callerCallableId,
          location: site.location,
          reason: `Direct invocation produces ${kind}; body results require separate consumption.`,
        },
        state,
        output,
      );
      continue;
    }
    for (const returnSite of callable.returnSites) {
      output.callReturnFlows.push({
        callSiteId: site.callSiteId,
        callableId,
        returnSiteId: returnSite.returnSiteId,
        returnLocation: returnSite.location,
      });
    }
  }
};

const collectCapture = (
  node: t.Node,
  parent: t.Node | null,
  owner: JavaScriptSemanticCallable | undefined,
  context: CallCollectionContext,
): void => {
  const { state, output } = context;
  if (
    !t.isIdentifier(node) ||
    parent === null ||
    owner === undefined ||
    owner.bodyScopeId === null
  )
    return;
  if (semanticIdentifierRole(node, parent, () => context.ancestors) === null)
    return;
  const binding = resolveSemanticBindingState(state, node, node.name);
  if (
    binding === undefined ||
    bindingIsWithinCallable(binding, owner.bodyScopeId, state)
  )
    return;
  output.closureCaptures.push({
    callableId: owner.callableId,
    bindingId: binding.bindingId,
    referenceLocation: range(node),
  });
};

const collectDynamicProperty = (
  node: t.Node,
  owner: JavaScriptSemanticCallable | undefined,
  state: JavaScriptSemanticAnalysisState,
  output: MutableCallAnalysis,
): void => {
  if (
    (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) &&
    semanticStaticPropertyKey(node.property, node.computed) === null
  )
    addFrontier(
      {
        kind: "dynamic-property",
        callableId: owner?.callableId ?? null,
        location: range(node.property),
        reason: "Computed member property is not a static string or number.",
      },
      state,
      output,
    );
  else if (
    (t.isObjectProperty(node) || t.isObjectMethod(node)) &&
    node.computed &&
    semanticStaticPropertyKey(node.key, true) === null
  )
    addFrontier(
      {
        kind: "dynamic-property",
        callableId: owner?.callableId ?? null,
        location: range(node.key),
        reason: "Computed object property is not a static string or number.",
      },
      state,
      output,
    );
};

/**
 * `with (o) { … }` and `eval("…")` decide at runtime which bindings exist, so
 * every name inside them is unresolvable statically. Recording the frontier
 * is what keeps the analyzer from presenting an empty or partial resolution as
 * an observed fact — silence here would read as "nothing to resolve".
 */
const collectDynamicScope = (
  node: t.Node,
  owner: JavaScriptSemanticCallable | undefined,
  state: JavaScriptSemanticAnalysisState,
  output: MutableCallAnalysis,
): void => {
  const reason = t.isWithStatement(node)
    ? "`with` introduces a runtime binding environment; names inside are not statically resolvable."
    : state.opaqueEffects.sites.has(node)
      ? "`eval` can change bindings and reachable objects at runtime; its effects are not statically resolvable."
      : null;
  if (reason === null) return;
  addFrontier(
    {
      kind: "dynamic-scope",
      callableId: owner?.callableId ?? null,
      location: range(node),
      reason,
    },
    state,
    output,
  );
};

const addFrontier = (
  frontier: JavaScriptSemanticFrontier,
  state: JavaScriptSemanticAnalysisState,
  output: MutableCallAnalysis,
): void => {
  output.frontiers.push(frontier);
};

const bindingIsWithinCallable = (
  binding: JavaScriptSemanticBindingState,
  bodyScopeId: string,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  let scope = state.scopesById.get(binding.scopeId);
  while (scope !== undefined) {
    if (scope.scopeId === bodyScopeId) return true;
    scope =
      scope.parentScopeId === null
        ? undefined
        : state.scopesById.get(scope.parentScopeId);
  }
  return false;
};

const enclosingFunction = (
  stack: readonly JavaScriptSemanticCallable[],
): JavaScriptSemanticCallable | undefined =>
  stack.findLast(({ kind }) => kind !== "class");

const semanticCallSiteId = (
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
): string =>
  // Join once so retained IDs do not keep a chain of intermediate strings.
  [
    "call",
    t.isNewExpression(node) ? "construct" : "call",
    String(node.start ?? -1),
    String(node.end ?? -1),
  ].join(":");
