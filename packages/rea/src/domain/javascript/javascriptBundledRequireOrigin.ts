import * as t from "@babel/types";

import { javascriptBootstrapAt } from "./javascriptBootstrap.js";
import { javascriptBundlerFactoryRoles } from "./javascriptBundlerFactoryRoles.js";
import { proveJavaScriptBootstrapIntegrity } from "./javascriptBootstrapIntegrity.js";
import {
  semanticMemberChain,
  semanticStaticPropertyKey,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import { collectJavaScriptIdentityWritesSteps } from "./javascriptElectronMemberWrites.js";
import { semanticBindingAtRead } from "./javascriptSemanticMutationInitializers.js";
import { SEMANTIC_ALIAS_SELECTION_LIMIT } from "./javascriptSemanticResourceLimits.js";
import { createSemanticModuleInterop } from "./javascriptModuleInterop.js";
import {
  semanticRequireOrigin,
  type JavaScriptRequireOrigin,
} from "./javascriptSemanticRequireOrigin.js";
import {
  resolveSemanticBindingState,
  semanticResolutionBlocked,
  type JavaScriptSemanticAnalysisState,
} from "./javascriptSemanticState.js";
import {
  argumentValue,
  moduleFactory,
  modulePropertyName,
} from "./javascriptStaticAnalysisHelpers.js";
import {
  completeSemanticSteps,
  traverseJavaScriptValueAst,
} from "./javascriptSemanticTraversal.js";

/** A standalone Webpack bootstrap uses the module, exports, loader convention. */
const BOOTSTRAP_RUNTIME = "webpack-bootstrap";

/** Loader bindings and literal externals proven for one standalone bootstrap. */
interface BootstrapExternals {
  /** The runtime loader and every factory parameter it is passed as. */
  readonly loaderBindingIds: ReadonlySet<string>;
  /** Loader bindings with the canonical n.n getter installed before dispatch. */
  readonly interopGetterBindingIds: ReadonlySet<string>;
  /** Table keys whose factory only re-exports one unshadowed literal require; null when a key repeats. */
  readonly externals: ReadonlyMap<string, string | null>;
}

const proofs = new WeakMap<
  JavaScriptSemanticAnalysisState,
  WeakMap<t.CallExpression, BootstrapExternals | null>
>();

/**
 * Recover a literal require reached through a proven Webpack bootstrap.
 *
 * Webpack emits externals as `{45840: e => { e.exports = require("electron") }}`
 * and consumers call the runtime loader, `n(45840)`, instead of `require`. The
 * origin is accepted only when the loader binding is the bootstrap's own loader
 * or a factory parameter that the bootstrap proves it passes the loader as, and
 * the keyed factory consists solely of that re-export.
 */
export const semanticBundledRequireOrigin = (
  node: t.Node | null | undefined,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptRequireOrigin | undefined => {
  const chain = semanticMemberChain(node);
  const current = chain?.root;
  if (
    chain?.members.length === 0 &&
    t.isCallExpression(current) &&
    t.isMemberExpression(current.callee) &&
    semanticStaticPropertyKey(
      current.callee.property,
      current.callee.computed,
    ) === "n" &&
    t.isIdentifier(current.callee.object) &&
    current.arguments.length === 1
  ) {
    // Webpack's `n.n(module)` returns its default-export getter. For a
    // CommonJS external, invoking that getter yields the exact exports object;
    // bind its identity to the proven registry result while retaining the
    // nested loader call as the source of provenance.
    const nested = semanticBundledRequireOrigin(current.arguments[0], state);
    const loaderBinding = resolveSemanticBindingState(
      state,
      current.callee.object,
      current.callee.object.name,
    );
    const proof =
      nested === undefined || loaderBinding === undefined
        ? undefined
        : bootstrapProofForLoaderCall(
            nested.call,
            loaderBinding.bindingId,
            state,
          );
    const nestedCallee = nested?.call.callee;
    const loaderBindingId = loaderBinding?.bindingId;
    if (
      nested !== undefined &&
      nested.origin.importedPath.length === 0 &&
      t.isIdentifier(nestedCallee) &&
      loaderBindingId !== undefined &&
      loaderBindingId ===
        resolveSemanticBindingState(state, nestedCallee, nestedCallee.name)
          ?.bindingId &&
      proof?.loaderBindingIds.has(loaderBindingId) === true &&
      proof.interopGetterBindingIds.has(loaderBindingId)
    )
      return nested;
  }
  if (
    chain === undefined ||
    !t.isCallExpression(current) ||
    !t.isIdentifier(current.callee) ||
    current.arguments.length !== 1
  )
    return undefined;
  const key = argumentValue(current.arguments[0]);
  if (key === undefined) return undefined;
  const loader = current.callee;
  if (semanticResolutionBlocked(state, loader, loader.name)) return undefined;
  const binding = resolveSemanticBindingState(state, loader, loader.name);
  if (
    binding === undefined ||
    binding.definitions.length !== 1 ||
    binding.definitions[0]?.kind === "assignment"
  )
    return undefined;
  for (
    let ancestor = state.parentsByNode.get(current);
    ancestor !== undefined;
    ancestor = state.parentsByNode.get(ancestor)
  ) {
    if (!t.isCallExpression(ancestor)) continue;
    const proof = bootstrapExternals(ancestor, state);
    if (proof === null || !proof.loaderBindingIds.has(binding.bindingId))
      continue;
    const specifier = proof.externals.get(key);
    return typeof specifier === "string"
      ? {
          origin: {
            specifier,
            importedPath: chain.members,
            resolutionMode: "require",
          },
          call: current,
        }
      : undefined;
  }
  return undefined;
};

/** Prove the source-local n.n getter and reject visible replacements. */
const canonicalWebpackInteropBindings = (
  loaderBindingIds: ReadonlySet<string>,
  bootstrapBody: t.BlockStatement,
  state: JavaScriptSemanticAnalysisState,
): ReadonlySet<string> => {
  // The shared identity-write owner covers assignment, delete, destructuring,
  // and Object/Reflect mutators; any write that may select `n` counts.
  const writes = new Set<t.Node>();
  const loaderMayOwnReference = (root: t.Node): boolean => {
    const pending = [root];
    const seen = new Set<t.Node>();
    while (pending.length > 0) {
      const reference = pending.pop();
      if (reference === undefined || seen.has(reference)) continue;
      seen.add(reference);
      if (seen.size > SEMANTIC_ALIAS_SELECTION_LIMIT) {
        state.valueResourceLimits.add("alias-selections");
        return true;
      }
      const node = unwrapJavaScriptExpression(reference).node;
      if (!t.isIdentifier(node)) continue;
      const binding = resolveSemanticBindingState(state, node, node.name);
      if (binding === undefined) continue;
      if (loaderBindingIds.has(binding.bindingId)) return true;
      const selected = semanticBindingAtRead(
        binding,
        node,
        state.parentsByNode,
      ).binding;
      for (const source of [
        ...selected.initializers,
        ...selected.referenceInitializers,
      ])
        if (source.projection.length === 0) pending.push(source.node);
    }
    return false;
  };
  const interop = createSemanticModuleInterop(state);
  completeSemanticSteps(
    collectJavaScriptIdentityWritesSteps(
      state.program,
      state.erasedSyntaxNodes,
      (root, kind) => {
        return kind === "member" && loaderMayOwnReference(root)
          ? [["loader"]]
          : [];
      },
      interop.intrinsicInvocation,
      interop.staticString,
      interop.isFreshObject,
      (node, path) => {
        if (path.length < 2 || path[1] === "n" || path[1] === null)
          writes.add(node);
      },
    ),
  );
  const proven = new Set<string>();
  const [write] = writes;
  if (
    writes.size === 1 &&
    t.isAssignmentExpression(write) &&
    isInstalledBeforeEntryDispatch(
      write,
      bootstrapBody,
      loaderBindingIds,
      state,
    ) &&
    isCanonicalGetter(write, state)
  )
    for (const bindingId of loaderBindingIds) proven.add(bindingId);
  return proven;
};

const isCanonicalGetter = (
  write: t.AssignmentExpression,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  if (
    !t.isArrowFunctionExpression(write.right) ||
    write.right.params.length !== 1 ||
    !t.isIdentifier(write.right.params[0])
  )
    return false;
  const parameter = write.right.params[0];
  const parameterBinding = resolveSemanticBindingState(
    state,
    parameter,
    parameter.name,
  );
  const body = write.right.body;
  return (
    parameterBinding !== undefined &&
    t.isConditionalExpression(body) &&
    t.isLogicalExpression(body.test, { operator: "&&" }) &&
    sameBinding(body.test.left, parameterBinding.bindingId, state) &&
    t.isMemberExpression(body.test.right) &&
    semanticStaticPropertyKey(
      body.test.right.property,
      body.test.right.computed,
    ) === "__esModule" &&
    sameBinding(body.test.right.object, parameterBinding.bindingId, state) &&
    getterReturnsDefault(body.consequent, parameterBinding.bindingId, state) &&
    getterReturnsModule(body.alternate, parameterBinding.bindingId, state)
  );
};

const isInstalledBeforeEntryDispatch = (
  write: t.AssignmentExpression,
  body: t.BlockStatement,
  loaderBindingIds: ReadonlySet<string>,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  const statement = state.parentsByNode.get(write);
  if (!t.isExpressionStatement(statement)) return false;
  const writeIndex = body.body.indexOf(statement);
  if (writeIndex < 0) return false;
  let entryIndex = -1;
  for (let index = 0; index < body.body.length; index += 1) {
    const topLevel = body.body[index];
    if (topLevel === undefined) continue;
    traverseJavaScriptValueAst(topLevel, state.erasedSyntaxNodes, {
      enter: (node, _parent, ancestors) => {
        if (
          entryIndex < 0 &&
          t.isCallExpression(node) &&
          t.isIdentifier(node.callee) &&
          ancestors().every((ancestor) => !t.isFunction(ancestor)) &&
          loaderBindingIds.has(
            resolveSemanticBindingState(state, node.callee, node.callee.name)
              ?.bindingId ?? "",
          )
        )
          entryIndex = index;
      },
    });
    if (entryIndex >= 0) break;
  }
  return entryIndex > writeIndex;
};

const bootstrapProofForLoaderCall = (
  call: t.CallExpression,
  loaderBindingId: string,
  state: JavaScriptSemanticAnalysisState,
): BootstrapExternals | undefined => {
  for (
    let ancestor = state.parentsByNode.get(call);
    ancestor !== undefined;
    ancestor = state.parentsByNode.get(ancestor)
  ) {
    if (!t.isCallExpression(ancestor)) continue;
    const proof = bootstrapExternals(ancestor, state);
    if (proof?.loaderBindingIds.has(loaderBindingId)) return proof;
  }
  return undefined;
};

const sameBinding = (
  node: t.Node,
  bindingId: string,
  state: JavaScriptSemanticAnalysisState,
): boolean =>
  t.isIdentifier(node) &&
  resolveSemanticBindingState(state, node, node.name)?.bindingId === bindingId;

const getterReturnsDefault = (
  node: t.Node,
  bindingId: string,
  state: JavaScriptSemanticAnalysisState,
): boolean =>
  t.isArrowFunctionExpression(node) &&
  node.params.length === 0 &&
  t.isMemberExpression(node.body) &&
  semanticStaticPropertyKey(node.body.property, node.body.computed) ===
    "default" &&
  sameBinding(node.body.object, bindingId, state);

const getterReturnsModule = (
  node: t.Node,
  bindingId: string,
  state: JavaScriptSemanticAnalysisState,
): boolean =>
  t.isArrowFunctionExpression(node) &&
  node.params.length === 0 &&
  sameBinding(node.body, bindingId, state);

const bootstrapExternals = (
  call: t.CallExpression,
  state: JavaScriptSemanticAnalysisState,
): BootstrapExternals | null => {
  let byCall = proofs.get(state);
  if (byCall === undefined) {
    byCall = new WeakMap();
    proofs.set(state, byCall);
  }
  const cached = byCall.get(call);
  if (cached !== undefined) return cached;
  const proof = proveBootstrapExternals(call, state);
  byCall.set(call, proof);
  return proof;
};

const proveBootstrapExternals = (
  call: t.CallExpression,
  state: JavaScriptSemanticAnalysisState,
): BootstrapExternals | null => {
  const bootstrap = javascriptBootstrapAt(call, state);
  // A replaced loader no longer dispatches the declared table.
  if (
    bootstrap === undefined ||
    !singleDefinition(state, bootstrap.loaderBindingId, "function")
  )
    return null;
  const loaderBindingIds = new Set([bootstrap.loaderBindingId]);
  const factories = bootstrap.table.properties.flatMap((property) => {
    const factory = moduleFactory(property);
    return factory === undefined ? [] : [{ property, factory }];
  });
  for (const { factory } of factories) {
    // The bootstrap proves `table[key](module, module.exports, loader)`.
    const loaderParameter = javascriptBundlerFactoryRoles(
      factory,
      BOOTSTRAP_RUNTIME,
    ).loader;
    const bindingId =
      loaderParameter === undefined
        ? undefined
        : resolveSemanticBindingState(
            state,
            loaderParameter,
            loaderParameter.name,
          )?.bindingId;
    if (
      bindingId !== undefined &&
      singleDefinition(state, bindingId, "parameter")
    )
      loaderBindingIds.add(bindingId);
  }
  const integrity = proveJavaScriptBootstrapIntegrity(
    call,
    bootstrap,
    loaderBindingIds,
    state,
  );
  if (integrity === undefined) return null;
  const externals = new Map<string, string | null>();
  for (const { property, factory } of factories) {
    const key = modulePropertyName(property);
    const specifier = integrity.replacedKeys.has(key)
      ? undefined
      : externalSpecifier(factory, state);
    if (externals.has(key)) externals.set(key, null);
    else externals.set(key, specifier ?? null);
  }
  return {
    loaderBindingIds,
    interopGetterBindingIds: canonicalWebpackInteropBindings(
      loaderBindingIds,
      bootstrap.body,
      state,
    ),
    externals,
  };
};

/**
 * Accept only `module.exports = require("specifier")` as the whole body of an
 * ordinary factory; generator, async and accessor factories do not run it.
 */
const externalSpecifier = (
  factory: t.FunctionExpression | t.ArrowFunctionExpression | t.ObjectMethod,
  state: JavaScriptSemanticAnalysisState,
): string | undefined => {
  const moduleParameter = javascriptBundlerFactoryRoles(
    factory,
    BOOTSTRAP_RUNTIME,
  ).module;
  if (
    moduleParameter === undefined ||
    factory.generator ||
    factory.async ||
    (t.isObjectMethod(factory) && factory.kind !== "method")
  )
    return undefined;
  let expression: t.Node | undefined;
  if (t.isBlockStatement(factory.body)) {
    const [statement] = factory.body.body;
    if (factory.body.body.length !== 1 || !t.isExpressionStatement(statement))
      return undefined;
    expression = statement.expression;
  } else expression = factory.body;
  if (
    !t.isAssignmentExpression(expression, { operator: "=" }) ||
    !t.isMemberExpression(expression.left) ||
    !t.isIdentifier(expression.left.object) ||
    semanticStaticPropertyKey(
      expression.left.property,
      expression.left.computed,
    ) !== "exports"
  )
    return undefined;
  const moduleBinding = resolveSemanticBindingState(
    state,
    moduleParameter,
    moduleParameter.name,
  );
  const target = resolveSemanticBindingState(
    state,
    expression.left.object,
    expression.left.object.name,
  );
  if (
    moduleBinding === undefined ||
    target?.bindingId !== moduleBinding.bindingId
  )
    return undefined;
  const required = semanticRequireOrigin(expression.right, state)?.origin;
  return required !== undefined && required.importedPath.length === 0
    ? required.specifier
    : undefined;
};

const singleDefinition = (
  state: JavaScriptSemanticAnalysisState,
  bindingId: string,
  kind: "function" | "parameter",
): boolean => {
  const definitions = state.bindingsById.get(bindingId)?.definitions;
  return definitions?.length === 1 && definitions[0]?.kind === kind;
};
