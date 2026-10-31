import * as t from "@babel/types";
import { javaScriptProgramStrictness } from "./javascriptSourceParser.js";
import { unwrapJavaScriptExpression } from "./javascriptAstValues.js";
import {
  isUnshadowedGlobal,
  semanticEffectTiming,
  semanticBindingEffectFollowsCapture,
  semanticBindingEffectFollowsRead,
  semanticReadPrecedesEffectWithinActivation,
} from "./javascriptSemanticMutationInitializers.js";
import {
  resolveSemanticBindingState,
  type JavaScriptSemanticAnalysisState,
  type JavaScriptSemanticBindingState,
} from "./javascriptSemanticState.js";

export const indexSemanticOpaqueEffects = (
  candidates: readonly {
    node: t.CallExpression;
    scopeId: string;
  }[],
  state: JavaScriptSemanticAnalysisState,
): void => {
  for (const { node, scopeId } of candidates) {
    const callee = unwrapJavaScriptExpression(node.callee).node;
    if (!isUnshadowedGlobal(callee, state, "eval")) continue;
    state.opaqueEffects.sites.add(node);
    if (!strictEval(node, state)) state.opaqueEffects.sloppySites.add(node);
    const sites = state.opaqueEffects.byScope.get(scopeId) ?? [];
    sites.push(node);
    state.opaqueEffects.byScope.set(scopeId, sites);
    let scope = state.scopesById.get(scopeId);
    while (scope?.parentScopeId != null) {
      const children =
        state.opaqueEffects.children.get(scope.parentScopeId) ??
        new Set<string>();
      if (children.has(scope.scopeId)) break;
      children.add(scope.scopeId);
      state.opaqueEffects.children.set(scope.parentScopeId, children);
      scope = state.scopesById.get(scope.parentScopeId);
    }
  }
};

/** The existing ambient invocation walk owns global effects; ordinary sources
 * neither retain a second call list nor create another alias resolver. */
export const createSemanticOpaqueGlobalObserver = (
  state: JavaScriptSemanticAnalysisState,
  dependencies: {
    createAmbientPathResolver: (
      state: JavaScriptSemanticAnalysisState,
      observeGlobals: boolean,
    ) => (
      node: t.Node,
      site: t.Node | undefined,
    ) => { paths: readonly (readonly (string | null)[])[] };
    createSemanticModuleInterop: (
      state: JavaScriptSemanticAnalysisState,
      options?: {
        intrinsicPath: (node: t.Node) => readonly string[] | undefined;
      },
    ) => {
      intrinsicInvocation: (
        node: t.CallExpression | t.OptionalCallExpression,
      ) => { readonly path: readonly string[] } | undefined;
    };
  },
): ((node: t.Node) => void) | undefined => {
  if (!state.opaqueEffects.mayReferenceGlobalEval) return undefined;
  const ambientPaths = dependencies.createAmbientPathResolver(state, true);
  let invocationSite: t.Node | undefined;
  const interop = dependencies.createSemanticModuleInterop(state, {
    intrinsicPath: (node) => {
      const paths = ambientPaths(node, invocationSite).paths;
      const path = paths.find((path) => path[1] === "eval") ?? paths[0];
      if (path?.[0] !== "global" || path.some((key) => key === null))
        return undefined;
      // Keep the global callable owner for generic call/apply/bind resolution.
      return path[1] === "eval"
        ? ["intrinsic", ...(path as readonly string[])]
        : ["intrinsic", ...(path.slice(1) as readonly string[])];
    },
  });
  return (node) => {
    if (!t.isCallExpression(node) && !t.isOptionalCallExpression(node)) return;
    invocationSite = node;
    const invocation = interop.intrinsicInvocation(node);
    if (invocation?.path.join(".") === "intrinsic.global.eval")
      state.opaqueEffects.globalSites.push(node);
  };
};

/** Indirect eval can change globals, but cannot rebind its caller's locals. */
export const semanticOpaqueGlobalMayHaveChanged = (
  read: t.Node,
  state: JavaScriptSemanticAnalysisState,
): boolean =>
  state.opaqueEffects.globalSites.some(
    (effect) => semanticEffectTiming(read, effect, state) !== "after",
  );

/** Rebinding requires lexical visibility. Object references can remain reachable
 * through aliases even where the original name is shadowed or out of block scope.
 * Without a disjointness proof, consider their enclosing activation and closures.
 * Queries retain no binding-by-eval table. */
export function* semanticOpaqueBindingEffects(
  binding: JavaScriptSemanticBindingState,
  state: JavaScriptSemanticAnalysisState,
  kind: "binding" | "reference" = "binding",
): Generator<t.CallExpression> {
  if (state.opaqueEffects.byScope.size === 0) return;
  const pending = [
    kind === "reference" ? activation(binding.scopeId, state) : binding.scopeId,
  ];
  while (pending.length > 0) {
    const scope = pending.pop()!;
    for (const node of state.opaqueEffects.byScope.get(scope) ?? [])
      if (
        kind === "reference" ||
        resolveSemanticBindingState(state, node, binding.name)?.bindingId ===
          binding.bindingId
      )
        yield node;
    for (const child of state.opaqueEffects.children.get(scope) ?? [])
      pending.push(child);
  }
}

export const semanticBindingMayHaveOpaqueEffect = (
  binding: JavaScriptSemanticBindingState,
  state: JavaScriptSemanticAnalysisState,
  read?: t.Node,
  kind: "binding" | "reference" = "binding",
): boolean => {
  if (state.opaqueEffects.byScope.size === 0) return false;
  for (const effect of semanticOpaqueBindingEffects(binding, state, kind))
    if (
      read === undefined ||
      (semanticEffectTiming(read, effect, state) !== "after" &&
        !semanticBindingEffectFollowsCapture(
          binding,
          read,
          effect,
          state.parentsByNode,
        ) &&
        // Rebinding a freshly initialized local is activation-specific;
        // mutations to the referenced object may persist across calls.
        !(
          kind === "binding" &&
          semanticBindingEffectFollowsRead(
            binding,
            read,
            effect,
            state.parentsByNode,
          )
        ))
    )
      return true;
  return false;
};

/** Opaque eval may introduce an otherwise unbound name in a visible activation. */
export const semanticOpaqueNameMayHaveChanged = (
  read: t.Node,
  state: JavaScriptSemanticAnalysisState,
  binding?: JavaScriptSemanticBindingState,
): boolean => {
  if (state.opaqueEffects.byScope.size === 0) return false;
  const visible = new Set<string>();
  let node: t.Node | undefined = read;
  while (node !== undefined) {
    const scope = state.scopeByNode.get(node);
    if (scope !== undefined) {
      let current: typeof scope | undefined = scope;
      while (current !== undefined) {
        visible.add(current.scopeId);
        current =
          current.parentScopeId === null
            ? undefined
            : state.scopesById.get(current.parentScopeId);
      }
      break;
    }
    node = state.parentsByNode.get(node);
  }
  for (const [scopeId, sites] of state.opaqueEffects.byScope) {
    let scope = state.scopesById.get(scopeId);
    while (
      scope !== undefined &&
      scope.kind !== "function" &&
      scope.kind !== "program"
    )
      scope =
        scope.parentScopeId === null
          ? undefined
          : state.scopesById.get(scope.parentScopeId);
    if (
      scope !== undefined &&
      visible.has(scope.scopeId) &&
      (binding === undefined ||
        activation(binding.scopeId, state) !== scope.scopeId) &&
      sites.some(
        (effect) =>
          state.opaqueEffects.sloppySites.has(effect) &&
          (binding === undefined ||
            resolveSemanticBindingState(state, effect, binding.name)
              ?.bindingId === binding.bindingId) &&
          semanticEffectTiming(read, effect, state) !== "after" &&
          // A sloppy-eval name belongs to this activation, not a prior call.
          !semanticReadPrecedesEffectWithinActivation(
            read,
            effect,
            state.parentsByNode,
          ),
      )
    )
      return true;
  }
  return false;
};

/** Declaration assignability is independent of observed explicit writes. */
export const semanticBindingCanBeRebound = (
  binding: JavaScriptSemanticBindingState,
): boolean =>
  binding.mutable ||
  (binding.definitions.some(
    ({ kind }) => kind === "function" || kind === "class",
  ) &&
    binding.initializers.some(
      ({ node }) => t.isFunctionDeclaration(node) || t.isClassDeclaration(node),
    ));

export const semanticOpaqueBindingReadMayHaveChanged = (
  binding: JavaScriptSemanticBindingState,
  read: t.Node,
  state: JavaScriptSemanticAnalysisState,
): boolean =>
  (semanticBindingCanBeRebound(binding) &&
    semanticBindingMayHaveOpaqueEffect(binding, state, read)) ||
  semanticOpaqueNameMayHaveChanged(read, state, binding);

const activation = (
  scopeId: string,
  state: JavaScriptSemanticAnalysisState,
): string => {
  let scope = state.scopesById.get(scopeId);
  while (
    scope !== undefined &&
    scope.kind !== "function" &&
    scope.kind !== "program" &&
    scope.parentScopeId !== null
  )
    scope = state.scopesById.get(scope.parentScopeId);
  return scope?.scopeId ?? scopeId;
};

const strictEval = (
  site: t.Node,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  for (
    let node: t.Node | undefined = site;
    node !== undefined;
    node = state.parentsByNode.get(node)
  ) {
    if (
      t.isClass(node) ||
      (t.isProgram(node) && javaScriptProgramStrictness(node) === "strict")
    )
      return true;
    const directives =
      t.isFunction(node) && t.isBlockStatement(node.body)
        ? node.body.directives
        : [];
    if (directives.some(({ value }) => value.value === "use strict"))
      return true;
  }
  return false;
};
