import {
  semanticCapturedSelectionsAfterPropertyRead,
  semanticProjectedSourceFactsAtRead,
  semanticProjectedSourceEligibilityAtRead,
  semanticNormalizeCapturedSelections,
  semanticShiftCapturedSelections,
  type SemanticCapturedSelection,
} from "./javascriptSemanticProjectedSources.js";
import * as t from "@babel/types";
import { traverseJavaScriptValueAst } from "./javascriptSemanticTraversal.js";

import { BUILTIN_RESOURCE_METHODS } from "./javascriptBuiltinResourceMethods.js";
import { javaScriptRuntimeContext } from "./javascriptSourceParser.js";
import type { JavaScriptModuleOrigin } from "./javascriptSemanticIr.js";
import {
  resolveSemanticBindingState,
  semanticResolutionBlocked,
  semanticStableInitializer,
  type JavaScriptSemanticAnalysisState,
} from "./javascriptSemanticState.js";
import {
  commonJsWrapperBindingDeclaration,
  isUnmodifiedCommonJsWrapperBinding,
  semanticBindingAtRead,
  semanticBindingHasPriorValueWrite,
  semanticEffectTiming,
  semanticTopLevelEffectFollowsCapture,
} from "./javascriptSemanticMutationInitializers.js";
import {
  semanticStaticPropertyKey,
  semanticMemberChain,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import { semanticPropertyPathKeyMatches } from "./javascriptSemanticPropertyPaths.js";
import {
  staticSourceRelativeUrlPath,
  stringValue,
} from "./javascriptStaticAnalysisHelpers.js";
import { createSemanticModuleInterop } from "./javascriptModuleInterop.js";
import { createSemanticReturnedReferences } from "./javascriptSemanticReturnedReferences.js";
import { semanticIterationSources } from "./javascriptSemanticIterationSources.js";
import {
  semanticCommonJsRequireOwnEnumerableAt,
  semanticReferenceSourcesInactive,
} from "./javascriptSemanticReferenceSources.js";
import {
  semanticArrayPropertyReferences,
  semanticObjectPropertyReferences,
} from "./javascriptSemanticObjectReferences.js";
import {
  SemanticAliasSelections,
  semanticAliasSelectionChoices,
  type SemanticAliasSelectionPath,
} from "./javascriptSemanticAliasSelections.js";
import { SEMANTIC_ALIAS_SELECTION_LIMIT } from "./javascriptSemanticResourceLimits.js";
import {
  semanticRequireOriginReaders,
  type JavaScriptRequireLoaderFact,
  type JavaScriptRequireOrigin,
} from "./javascriptSemanticRequireOriginSlot.js";
import {
  isUnmodifiedGlobalReference,
  isUnmodifiedImportMetaUrl,
} from "./javascriptSemanticAmbientWrites.js";

export type {
  JavaScriptRequireLoaderFact,
  JavaScriptRequireOrigin,
} from "./javascriptSemanticRequireOriginSlot.js";

const possibleCommonJsDelegateWriteStates =
  new WeakSet<JavaScriptSemanticAnalysisState>();

/** Source eligibility only; the shared write owner still proves receiver identity. */
export const observePossibleCommonJsDelegateWrite = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
): void => {
  if (possibleCommonJsDelegateWriteStates.has(state)) return;
  const target = t.isAssignmentExpression(node)
    ? node.left
    : t.isUpdateExpression(node) ||
        t.isUnaryExpression(node, { operator: "delete" })
      ? node.argument
      : undefined;
  if (
    semanticIterationSources(node, state.parentsByNode.get(node) ?? null).some(
      (source) => source.kind === "reference-store",
    )
  )
    possibleCommonJsDelegateWriteStates.add(state);
  if (
    (t.isMemberExpression(target) || t.isOptionalMemberExpression(target)) &&
    ["require", null].includes(
      semanticStaticPropertyKey(target.property, target.computed),
    )
  )
    possibleCommonJsDelegateWriteStates.add(state);
  else if (t.isCallExpression(node) || t.isOptionalCallExpression(node))
    possibleCommonJsDelegateWriteStates.add(state);
};

export const hasPossibleCommonJsDelegateWrite = (
  state: JavaScriptSemanticAnalysisState,
): boolean => possibleCommonJsDelegateWriteStates.has(state);

/** Member effects settle at the shared indexing boundary, invalidating derived delegates. */
export const invalidateSemanticRequireDelegateWrites = (
  state: JavaScriptSemanticAnalysisState,
): void => {
  moduleRequireWrites.delete(state);
  moduleReturnedReferences.delete(state);
};

const commonJsDelegateChangedAt = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
): boolean =>
  writesModuleRequire(state).some(
    (write) => semanticEffectTiming(node, write, state) !== "after",
  );

const commonJsLoaderAt = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptRequireLoaderFact =>
  commonJsDelegateChangedAt(node, state) ? "unknown" : "commonjs-loader";

/** Associate wrapper lookups with their loader; this does not claim execution. */
export const semanticRequireLoaderAt = (
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  state: JavaScriptSemanticAnalysisState,
  factoryBindingIds: ReadonlySet<string>,
): JavaScriptRequireLoaderFact => {
  const callee = unwrapJavaScriptExpression(node.callee).node;
  const loader =
    (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
    ["resolve", "main"].includes(
      semanticStaticPropertyKey(callee.property, callee.computed) ?? "",
    )
      ? callee.object
      : callee;
  const selected = selectedRequireSourcesAt(
    loader,
    node,
    state,
    factoryBindingIds,
  )?.loader;
  return selected !== undefined && selected !== "unknown"
    ? selected
    : requireLoaderValueAt(loader, node, state, factoryBindingIds);
};

/** Classify Node's wrapper and exact factory bindings by their lexical owner. */
const requireLoaderValueAt = (
  value: t.Node,
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
  factoryBindingIds: ReadonlySet<string>,
): JavaScriptRequireLoaderFact => {
  const callee = unwrapJavaScriptExpression(value).node;
  // Only the selected require function is callable as the host loader.
  // Its resolve/main members remain association facts in the wrapper above.
  if (!t.isIdentifier(callee)) return "local";
  const loader = callee;
  const binding = resolveSemanticBindingState(state, loader, loader.name);
  if (binding !== undefined && factoryBindingIds.has(binding.bindingId))
    return semanticBindingHasPriorValueWrite(node, binding, state)
      ? "unknown"
      : "factory-loader";
  if (binding !== undefined && isSemanticCreateRequireBinding(binding, state))
    return "create-require";
  if (loader.name !== "require") return "local";
  if (binding === undefined) {
    if (
      javaScriptRuntimeContext(state.program) === "module" ||
      semanticResolutionBlocked(state, loader, "require")
    )
      return "unknown";
    return (state.ambientBindingWrites.get("require") ?? []).some(
      (write) => semanticEffectTiming(node, write, state) !== "after",
    )
      ? "unknown"
      : commonJsLoaderAt(node, state);
  }
  if (
    binding.hostOrigin === "commonjs-wrapper" &&
    [...binding.declarationKinds].every((kind) => kind === "var")
  ) {
    if (binding.definitions.some(({ kind }) => kind === "function"))
      return "local";
    return semanticBindingHasPriorValueWrite(node, binding, state)
      ? "unknown"
      : commonJsLoaderAt(node, state);
  }
  if (
    (t.isCallExpression(node) ||
      t.isOptionalCallExpression(node) ||
      t.isNewExpression(node)) &&
    isWrapperRequireInitializerCall(binding, node, state)
  )
    return commonJsLoaderAt(node, state);
  const wrapperBinding = commonJsWrapperBindingDeclaration(
    loader,
    "require",
    state,
  );
  if (
    wrapperBinding !== undefined &&
    !semanticBindingHasPriorValueWrite(node, wrapperBinding, state)
  )
    return commonJsLoaderAt(node, state);
  const initializer = semanticStableInitializer(binding, state)?.node;
  if (
    (binding.kind === "function" || binding.kind === "class") &&
    initializer !== undefined
  )
    return "local";
  if (
    binding.declarationKinds.size === 1 &&
    binding.declarationKinds.has("const") &&
    (t.isFunctionExpression(initializer) ||
      t.isArrowFunctionExpression(initializer))
  )
    return "local";
  return "unknown";
};

/** Classify a call through an exact recovered factory-loader binding. */
export const semanticFactoryRequireLoaderAt = (
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  state: JavaScriptSemanticAnalysisState,
  bindingIds: ReadonlySet<string>,
): JavaScriptRequireLoaderFact | undefined => {
  const callee = unwrapJavaScriptExpression(node.callee).node;
  if (t.isIdentifier(callee))
    return semanticFactoryLoaderMemberAt(node, state, bindingIds, null);
  if (
    (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
    semanticStaticPropertyKey(callee.property, callee.computed) === "bind"
  )
    return semanticFactoryLoaderMemberAt(node, state, bindingIds, "bind");
  return undefined;
};

/** Classify an exact loader call by binding identity and expected member. */
export const semanticFactoryLoaderMemberAt = (
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  state: JavaScriptSemanticAnalysisState,
  bindingIds: ReadonlySet<string>,
  member: string | null,
): JavaScriptRequireLoaderFact | undefined => {
  const callee = unwrapJavaScriptExpression(node.callee).node;
  let loader: t.Identifier | undefined;
  if (member === null) {
    if (t.isIdentifier(callee)) loader = callee;
  } else if (
    (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
    semanticStaticPropertyKey(callee.property, callee.computed) === member
  ) {
    const root = unwrapJavaScriptExpression(callee.object).node;
    if (t.isIdentifier(root)) loader = root;
  }
  if (loader === undefined) return undefined;
  const binding = resolveSemanticBindingState(state, loader, loader.name);
  if (binding === undefined || !bindingIds.has(binding.bindingId))
    return undefined;
  return semanticBindingHasPriorValueWrite(node, binding, state)
    ? "unknown"
    : "factory-loader";
};

const isSemanticCreateRequireBinding = (
  binding: NonNullable<ReturnType<typeof resolveSemanticBindingState>>,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  if (binding.initializers.length !== 1) return false;
  const initializer = semanticStableInitializer(binding, state)?.node;
  return (
    createRequireFactoryCallAt(initializer, state)?.loader === "create-require"
  );
};

/** Retain the factory's actual certainty for both proof and eligibility consumers. */
const createRequireFactoryCallAt = (
  initializer: t.Node | undefined,
  state: JavaScriptSemanticAnalysisState,
  factoryBindingIds: ReadonlySet<string> = new Set(),
):
  | Pick<
      JavaScriptRequireCallFact,
      "loader" | "sourceRelative" | "sourceRelativePath"
    >
  | undefined =>
  !t.isCallExpression(initializer)
    ? undefined
    : selectedRequireSourcesAt(
        initializer.callee,
        initializer,
        state,
        factoryBindingIds,
        "factory",
      );

type SourceRelativeCreateRequireBase =
  | { readonly kind: "source-file" }
  | { readonly kind: "source-relative-file"; readonly path: string };

const sourceRelativeCreateRequireBaseAt = (
  value: t.Node | undefined,
  state: JavaScriptSemanticAnalysisState,
): SourceRelativeCreateRequireBase | undefined => {
  if (value === undefined) return undefined;
  if (isUnmodifiedImportMetaUrl(value, state)) return { kind: "source-file" };
  if (!t.isNewExpression(value) || value.arguments.length !== 2)
    return undefined;
  const callee = unwrapJavaScriptExpression(value.callee).node;
  if (
    !t.isIdentifier(callee, { name: "URL" }) ||
    !isUnmodifiedGlobalReference(callee, state, "URL") ||
    !isUnmodifiedImportMetaUrl(
      t.isNode(value.arguments[1]) ? value.arguments[1] : undefined,
      state,
    )
  )
    return undefined;
  const urlPath = staticSourceRelativeUrlPath(value);
  return urlPath === undefined ||
    urlPath.directory ||
    urlPath.path.startsWith("/")
    ? undefined
    : { kind: "source-relative-file", path: urlPath.path };
};

/** Eligibility for observable loader slots; an unknown factory is not invocation proof. */
export const hasSemanticCreateRequireFactoryOrigin = (
  initializer: t.Node | undefined,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  const factory = createRequireFactoryCallAt(initializer, state);
  return factory !== undefined && factory.loader !== "local";
};

const isCreateRequireOrigin = (
  origin: JavaScriptModuleOrigin,
  selected: SemanticAliasSelectionPath,
): boolean => {
  if (!["module", "node:module"].includes(origin.specifier)) return false;
  const path = [...origin.importedPath, ...selected];
  return (
    (path.length === 1 && path[0] === "createRequire") ||
    ((origin.resolutionMode ?? "import") === "import" &&
      path.length === 2 &&
      path[0] === "default" &&
      path[1] === "createRequire")
  );
};

/** Assignment expressions expose their RHS; short-circuit stores may keep the old value. */
export const assignmentValueSources = (
  node: t.AssignmentExpression,
): readonly t.Node[] =>
  node.operator === "="
    ? [node.right]
    : ["||=", "&&=", "??="].includes(node.operator)
      ? [node.left, node.right]
      : [];

/** Follow selected values to Node's captured loader or its creating factory. */
const selectedRequireSourcesAt = (
  root: t.Node,
  site: t.Node,
  state: JavaScriptSemanticAnalysisState,
  factoryBindingIds: ReadonlySet<string>,
  target: "loader" | "factory" = "loader",
):
  | Pick<
      JavaScriptRequireCallFact,
      "loader" | "sourceRelative" | "sourceRelativePath"
    >
  | undefined => {
  const pending: ModuleObjectSource[] = [{ node: root, path: [] }];
  const seen = new WeakMap<t.Node, Set<string>>();
  let count = 0;
  let found = false;
  let loaderBinding = false;
  let selectedLoader: JavaScriptRequireLoaderFact | undefined;
  let unknown = false;
  let local = false;
  let nativeMemberAlternative = false;
  let sourceRelative = true;
  let sourceRelativeBase: SourceRelativeCreateRequireBase | undefined;
  while (pending.length > 0) {
    const current = pending.pop()!;
    const node = unwrapJavaScriptExpression(current.node).node;
    const genericMember =
      current.path.length === 1 &&
      semanticAliasSelectionChoices(current.path[0]!).every(
        (key) => key === "call" || key === "apply",
      );
    const nativeGenericMember =
      target === "loader" &&
      genericMember &&
      t.isIdentifier(node) &&
      requireLoaderValueAt(node, node, state, factoryBindingIds) !== "local";
    const key = JSON.stringify([current.path, loaderSourceContextKey(current)]);
    const paths = seen.get(node) ?? new Set<string>();
    if (paths.has(key)) continue;
    paths.add(key);
    seen.set(node, paths);
    if (++count > SEMANTIC_ALIAS_SELECTION_LIMIT) {
      state.valueResourceLimits.add("alias-selections");
      return { loader: "unknown", sourceRelative: false };
    }
    if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
      pending.push(
        ...inheritLoaderSourceContext(current, [
          loaderMemberSource(current, node),
        ]),
      );
    } else if (t.isIdentifier(node)) {
      if (target === "loader" && current.path.length === 0) {
        const captured = requireLoaderValueAt(
          node,
          node,
          state,
          factoryBindingIds,
        );
        if (captured !== "local" && captured !== "create-require") {
          const invoked =
            captured === "commonjs-loader"
              ? commonJsLoaderAt(site, state)
              : captured;
          found = true;
          unknown ||=
            invoked === "unknown" ||
            (selectedLoader !== undefined && selectedLoader !== invoked);
          selectedLoader ??= invoked;
          continue;
        }
      }
      const binding = resolveSemanticBindingState(state, node, node.name);
      if (binding === undefined) {
        unknown = true;
        continue;
      }
      // Eligibility is separate from the selected value: replacing a known
      // loader with an opaque value keeps a gap, while a proven local function
      // no longer claims the previous factory's base or identity.
      loaderBinding ||=
        target === "loader" &&
        binding.initializers.some(
          (source) =>
            hasSemanticCreateRequireFactoryOrigin(source.node, state) ||
            (t.isIdentifier(source.node) &&
              requireLoaderValueAt(
                source.node,
                source.node,
                state,
                factoryBindingIds,
              ) !== "local"),
        );
      const facts = semanticProjectedSourceFactsAtRead(
        binding,
        node,
        current.path,
        state,
        true,
        current.readAt ?? node,
        current.capturedSelections,
      );
      if (nativeGenericMember)
        nativeMemberAlternative ||=
          facts === undefined ||
          facts.sources.length === 0 ||
          !facts.sources.every(({ node: source }) => {
            const value = unwrapJavaScriptExpression(source).node;
            return (
              t.isFunctionExpression(value) ||
              t.isArrowFunctionExpression(value)
            );
          });
      if (target === "factory" && binding.directOrigins.length > 0) {
        const native = binding.directOrigins.some((origin) =>
          isCreateRequireOrigin(origin, current.path),
        );
        loaderBinding ||= native;
        if (facts?.retainsOrigin) {
          found ||= native;
          local ||= !native;
          if (native) selectedLoader = "create-require";
        }
      }
      if (facts === undefined) {
        unknown = true;
        const retained = semanticBindingAtRead(
          binding,
          node,
          state.parentsByNode,
        ).binding;
        pending.push(
          ...inheritLoaderSourceContext(
            current,
            projectedLoaderSources(
              current,
              [...retained.initializers, ...retained.referenceInitializers]
                .filter(
                  (source) => !semanticReferenceSourcesInactive(source, state),
                )
                .map((source) => ({
                  node: source.node,
                  path: [...source.projection, ...current.path],
                })),
            ),
          ),
        );
      } else {
        unknown ||=
          facts.sources.length === 0 &&
          !(
            target === "factory" &&
            facts.retainsOrigin &&
            binding.directOrigins.length > 0
          );
        pending.push(
          ...inheritLoaderSourceContext(
            current,
            projectedLoaderSources(current, facts.sources),
          ),
        );
      }
    } else if (t.isObjectExpression(node) || t.isArrayExpression(node)) {
      if (current.path.length === 0) {
        local = true;
        continue;
      }
      const sources = loaderObjectPropertySources(current, node, state);
      unknown ||= sources.length === 0;
      pending.push(...inheritLoaderSourceContext(current, sources));
    } else if (t.isSequenceExpression(node)) {
      const last = node.expressions.at(-1);
      if (last !== undefined) pending.push({ ...current, node: last });
    } else if (t.isAssignmentExpression(node)) {
      for (const source of assignmentValueSources(node))
        pending.push({ ...current, node: source });
    } else if (t.isConditionalExpression(node) || t.isLogicalExpression(node)) {
      pending.push(
        {
          ...current,
          node: t.isConditionalExpression(node) ? node.consequent : node.left,
        },
        {
          ...current,
          node: t.isConditionalExpression(node) ? node.alternate : node.right,
        },
      );
    } else if (t.isCallExpression(node)) {
      const callee = unwrapJavaScriptExpression(node.callee).node;
      if (
        target === "loader" &&
        current.path.length === 0 &&
        t.isFunction(callee)
      ) {
        if (callee.async || callee.generator) {
          // A direct async/generator invocation returns a wrapper, not its contents.
          local = true;
          continue;
        }
        const returned = returnedLoaderReferences(state, "direct-call")(
          node.callee,
          node,
        );
        // The shared result owner is a may-reference graph. A block may also
        // fall through or throw; only an expression arrow supplies its whole result.
        unknown ||=
          returned.unresolvedInvocation === true ||
          !t.isArrowFunctionExpression(callee) ||
          t.isBlockStatement(callee.body);
        pending.push(
          ...inheritLoaderSourceContext(
            current,
            returned.references.map((reference) => ({
              node: reference.node,
              path: reference.projection,
            })),
          ),
        );
        continue;
      }
      if (target === "factory") {
        const origin = semanticRequireOrigin(node, state)?.origin;
        if (
          origin !== undefined &&
          isCreateRequireOrigin(origin, current.path)
        ) {
          found = true;
          selectedLoader = "create-require";
        } else unknown = true;
      } else if (current.path.length === 0 || genericMember) {
        const factory = createRequireFactoryCallAt(
          node,
          state,
          factoryBindingIds,
        );
        if (factory !== undefined && factory.loader !== "local") {
          if (genericMember) {
            // A conditional own write retains this inherited native method.
            // Alone it still belongs to the invocation owner's fallback.
            nativeMemberAlternative = true;
            if (factory.loader === "unknown") {
              loaderBinding = true;
              unknown = true;
            }
          } else {
            found = true;
            unknown ||=
              factory.loader === "unknown" ||
              (selectedLoader !== undefined &&
                selectedLoader !== "create-require");
            selectedLoader ??= "create-require";
            unknown ||= state.conditionallySkippedExpressions.has(node);
            const factoryBase = sourceRelativeCreateRequireBaseAt(
              node.arguments[0],
              state,
            );
            if (factoryBase === undefined) sourceRelative = false;
            else if (sourceRelativeBase === undefined)
              sourceRelativeBase = factoryBase;
            else if (
              sourceRelativeBase.kind !== factoryBase.kind ||
              (sourceRelativeBase.kind === "source-relative-file" &&
                factoryBase.kind === "source-relative-file" &&
                sourceRelativeBase.path !== factoryBase.path)
            ) {
              sourceRelative = false;
            }
          }
        } else if (factory?.loader === "local") local = true;
        else unknown = true;
      } else unknown = true;
    } else if (
      current.path.length === 0 &&
      (t.isFunction(node) || t.isClassExpression(node) || t.isLiteral(node))
    ) {
      local = true;
    } else {
      // Every selected expression contributes a possible value. An opaque
      // alternative cannot leave another factory as the sole proven origin.
      unknown = true;
    }
  }
  return found || local || (loaderBinding && unknown)
    ? {
        loader:
          (unknown && (found || loaderBinding)) ||
          (local && (found || nativeMemberAlternative))
            ? "unknown"
            : found
              ? (selectedLoader ?? "unknown")
              : "local",
        sourceRelative: found && sourceRelative && !unknown,
        ...(found &&
        !unknown &&
        sourceRelative &&
        sourceRelativeBase?.kind === "source-relative-file"
          ? { sourceRelativePath: sourceRelativeBase.path }
          : {}),
      }
    : undefined;
};

const loaderInvocationInterops = new WeakMap<
  JavaScriptSemanticAnalysisState,
  {
    readonly writes: number;
    readonly interop: ReturnType<typeof createSemanticModuleInterop>;
  }
>();

const loaderInvocationInterop = (state: JavaScriptSemanticAnalysisState) => {
  const prior = loaderInvocationInterops.get(state);
  if (prior?.writes === state.ambientWriteEffects.length) return prior.interop;
  const interop = createSemanticModuleInterop(state);
  for (const effect of state.ambientWriteEffects)
    if (effect.path[0] === "global")
      interop.retainWrite(effect.node ?? state.program, [
        "intrinsic",
        ...effect.path
          .slice(1)
          .map((key) =>
            key === null || typeof key === "object" ? null : String(key),
          ),
      ]);
  loaderInvocationInterops.set(state, {
    writes: state.ambientWriteEffects.length,
    interop,
  });
  return interop;
};

export interface JavaScriptRequireCallFact {
  readonly operation: "load" | "resolve";
  readonly loader: JavaScriptRequireLoaderFact;
  readonly arguments:
    | readonly t.CallExpression["arguments"][number][]
    | undefined;
  readonly sourceRelative: boolean;
  /** A createRequire filename relative to the current source directory, when proven. */
  readonly sourceRelativePath?: string;
}

/** Classify the selected loader and normalize invocation arguments once. */
export const semanticRequireCallAt = (
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  state: JavaScriptSemanticAnalysisState,
  factoryBindingIds: ReadonlySet<string>,
): JavaScriptRequireCallFact | undefined => {
  if (semanticModuleRequireCallAt(node, state))
    return {
      operation: "load",
      loader: "unknown",
      arguments: undefined,
      sourceRelative: false,
    };
  const callee = unwrapJavaScriptExpression(node.callee).node;
  if (
    (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
    ["call", "apply"].includes(
      semanticStaticPropertyKey(callee.property, callee.computed) ?? "",
    ) &&
    selectedRequireSourcesAt(callee, node, state, factoryBindingIds)?.loader ===
      "local"
  )
    return {
      operation: "load",
      loader: "local",
      arguments: undefined,
      sourceRelative: false,
    };
  if (
    (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
    semanticStaticPropertyKey(callee.property, callee.computed) === "resolve"
  ) {
    const loader = requireLoaderValueAt(
      callee.object,
      node,
      state,
      factoryBindingIds,
    );
    if (loader === "unknown")
      return {
        operation: "load",
        loader,
        arguments: undefined,
        sourceRelative: false,
      };
    // Bundler factory loaders can share the `require` shape, but their
    // `.resolve` member is not Node's module resolver.
    if (loader === "commonjs-loader" || loader === "create-require") {
      const selected = selectedRequireSourcesAt(
        callee.object,
        node,
        state,
        factoryBindingIds,
      );
      return {
        operation: "resolve",
        loader: selected?.loader ?? loader,
        arguments: node.arguments,
        sourceRelative:
          selected?.sourceRelative ?? loader === "commonjs-loader",
        ...(selected?.sourceRelativePath === undefined
          ? {}
          : { sourceRelativePath: selected.sourceRelativePath }),
      };
    }
  }
  if (t.isNewExpression(node)) {
    const loader = requireLoaderValueAt(
      node.callee,
      node,
      state,
      factoryBindingIds,
    );
    const selected = selectedRequireSourcesAt(
      node.callee,
      node,
      state,
      factoryBindingIds,
    );
    if (selected !== undefined || loader !== "local")
      return {
        operation: "load",
        loader: selected?.loader ?? loader,
        arguments: node.arguments,
        sourceRelative: selected?.sourceRelative ?? loader !== "create-require",
        ...(selected?.sourceRelativePath === undefined
          ? {}
          : { sourceRelativePath: selected.sourceRelativePath }),
      };
  }
  const interop = loaderInvocationInterop(state);
  if (!t.isNewExpression(node)) {
    const invocation = interop.intrinsicInvocation(node, (callee) => {
      const loader = requireLoaderValueAt(
        callee,
        node,
        state,
        factoryBindingIds,
      );
      if (loader !== "local" && loader !== "create-require")
        return ["require-loader", loader, "relative"];
      const selected = selectedRequireSourcesAt(
        callee,
        node,
        state,
        factoryBindingIds,
      );
      if (selected !== undefined)
        return [
          "require-loader",
          selected.loader,
          selected.sourceRelative ? "relative" : "unknown",
        ];
      return interop.intrinsicPath(callee);
    });
    if (invocation?.path[0] === "require-loader") {
      const selected = selectedRequireSourcesAt(
        node.callee,
        node,
        state,
        factoryBindingIds,
      );
      return {
        operation: "load",
        loader:
          invocation.path[1] === "local"
            ? "local"
            : invocation.kind === "opaque"
              ? "unknown"
              : (invocation.path[1] as JavaScriptRequireLoaderFact),
        arguments: invocation.arguments,
        sourceRelative:
          invocation.kind === "known" && invocation.path[2] === "relative",
        ...(selected?.sourceRelativePath === undefined
          ? {}
          : { sourceRelativePath: selected.sourceRelativePath }),
      };
    }
  }
  const factory = semanticFactoryRequireLoaderAt(
    node,
    state,
    factoryBindingIds,
  );
  return factory === undefined
    ? undefined
    : {
        operation: "load",
        loader: factory,
        arguments: node.arguments.slice(t.isIdentifier(node.callee) ? 0 : 1),
        sourceRelative: true,
      };
};

/** The RHS call runs before its assignment replaces Node's wrapper loader. */
const isWrapperRequireInitializerCall = (
  binding: NonNullable<ReturnType<typeof resolveSemanticBindingState>>,
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  const scope = state.scopesById.get(binding.scopeId);
  if (
    scope?.kind !== "program" ||
    binding.kind !== "variable" ||
    binding.declarationKinds.size !== 1 ||
    !binding.declarationKinds.has("var") ||
    binding.initializers.length !== 1 ||
    binding.initializers[0]?.node !== node
  )
    return false;
  const assignment = state.parentsByNode.get(node);
  if (
    !t.isAssignmentExpression(assignment) ||
    assignment.right !== node ||
    state.conditionallySkippedExpressions.has(node)
  )
    return false;
  const statement = state.parentsByNode.get(assignment);
  if (!t.isExpressionStatement(statement)) return false;
  if (state.parentsByNode.get(statement) !== state.program) return false;
  const target = unwrapJavaScriptExpression(assignment.left).node;
  return (
    t.isIdentifier(target, { name: "require" }) &&
    resolveSemanticBindingState(state, target, target.name) === binding
  );
};

// Ambient indexing finishes before these derived facts are consumed. Keep only
// replacement sites, rather than rescanning unrelated global member writes.
const globalProcessReplacements = new WeakMap<
  JavaScriptSemanticAnalysisState,
  readonly (t.Node | undefined)[]
>();
const moduleRequireWrites = new WeakMap<
  JavaScriptSemanticAnalysisState,
  readonly t.Node[]
>();
const moduleReturnedReferences = new WeakMap<
  JavaScriptSemanticAnalysisState,
  Map<
    "direct-call" | "awaited-call",
    ReturnType<typeof createSemanticReturnedReferences>
  >
>();

/** Reuse one result-reference owner for loader values and module receivers. */
const returnedLoaderReferences = (
  state: JavaScriptSemanticAnalysisState,
  mode: "direct-call" | "awaited-call",
): ReturnType<typeof createSemanticReturnedReferences> => {
  let factories = moduleReturnedReferences.get(state);
  if (factories === undefined) {
    factories = new Map();
    moduleReturnedReferences.set(state, factories);
  }
  let returned = factories.get(mode);
  if (returned === undefined) {
    returned = createSemanticReturnedReferences(state, mode);
    factories.set(mode, returned);
  }
  return returned;
};

type ModuleObjectSource = {
  readonly node: t.Node;
  readonly path: SemanticAliasSelectionPath;
  readonly eligibility?: true;
  readonly readAt?: t.Node | undefined;
  readonly capturedSelections?:
    | readonly SemanticCapturedSelection[]
    | undefined;
};

/** Both loader queries retain the same read and shallow-copy selection owner. */
const loaderSourceContextKey = (source: ModuleObjectSource): string =>
  JSON.stringify([
    source.eligibility,
    source.readAt?.start,
    source.readAt?.end,
    source.capturedSelections?.map(({ at, depth, ownEnumerable }) => [
      at.start,
      at.end,
      depth,
      ownEnumerable,
    ]),
  ]);

const inheritLoaderSourceContext = (
  current: ModuleObjectSource,
  sources: readonly ModuleObjectSource[],
): ModuleObjectSource[] =>
  sources.map((source) => ({
    ...(current.eligibility ? { eligibility: true as const } : {}),
    ...(current.readAt === undefined ? {} : { readAt: current.readAt }),
    ...source,
    capturedSelections: semanticNormalizeCapturedSelections(
      source.capturedSelections ?? current.capturedSelections,
      source.path.length,
    ),
  }));

// A later read site selects only the remaining path. This member selects its
// own key when it is evaluated, so `o.k = o.k || d` reads o.k before the write.
const loaderMemberSource = (
  current: ModuleObjectSource,
  member: t.MemberExpression | t.OptionalMemberExpression,
): ModuleObjectSource => ({
  node: member.object,
  readAt: current.readAt ?? member,
  capturedSelections:
    current.readAt === undefined
      ? semanticShiftCapturedSelections(current.capturedSelections, 1)
      : semanticNormalizeCapturedSelections([
          { at: member, depth: 1 },
          ...(semanticShiftCapturedSelections(current.capturedSelections, 1) ??
            []),
        ]),
  path: [
    semanticStaticPropertyKey(member.property, member.computed),
    ...current.path,
  ],
});

const projectedLoaderSources = (
  current: ModuleObjectSource,
  sources: readonly ModuleObjectSource[],
): ModuleObjectSource[] =>
  sources.map((source) => ({
    ...source,
    readAt:
      current.path.length === 0 ? undefined : (current.readAt ?? current.node),
    capturedSelections: [
      ...(semanticShiftCapturedSelections(
        current.capturedSelections,
        source.path.length - current.path.length,
      ) ?? []),
      ...(source.capturedSelections ?? []),
    ],
  }));

const loaderObjectPropertySources = (
  current: ModuleObjectSource,
  object: t.ObjectExpression | t.ArrayExpression,
  state: JavaScriptSemanticAnalysisState,
): ModuleObjectSource[] => {
  const [key, ...remaining] = current.path;
  if (key === undefined) return [];
  return semanticAliasSelectionChoices(key).flatMap((choice) =>
    (t.isObjectExpression(object)
      ? semanticObjectPropertyReferences(object, [choice], state)
      : semanticArrayPropertyReferences(object, [choice])
    )
      .filter(
        (source) =>
          !source.inherited ||
          !current.capturedSelections?.some(
            (capture) => capture.depth === 1 && capture.ownEnumerable,
          ),
      )
      .map((source) => ({
        node: source.node,
        path: [...source.path, ...remaining],
        capturedSelections: semanticCapturedSelectionsAfterPropertyRead(
          current.capturedSelections,
          source,
        ),
      })),
  );
};

const isCommonJsModuleObject = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
  includeUnknown = true,
): boolean => hasCommonJsModuleSource(node, state, includeUnknown, "module");

/** A captured delegate uses the same receiver and assignment ownership facts. */
export const isCommonJsRequireDelegate = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
  includeUnknown = false,
  readAt?: t.Node,
): boolean =>
  hasCommonJsModuleSource(node, state, includeUnknown, "delegate", readAt);

const hasCommonJsModuleSource = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
  includeUnknown: boolean,
  target: "module" | "delegate",
  readAt?: t.Node,
): boolean => {
  type Work = ModuleObjectSource & {
    /** Await occurs after this many requested outer property selections. */
    readonly awaitDepths: readonly number[];
  };
  const pending: Work[] = [{ node, path: [], readAt, awaitDepths: [] }];
  // Keep depths separate and join finite key alternatives at each source read.
  const selections = new SemanticAliasSelections(() => {
    state.valueResourceLimits.add("alias-selections");
  });
  const contexts = new WeakMap<
    t.Node,
    Map<
      string,
      {
        readonly identities: Map<string, object>;
      }
    >
  >();
  const examined = new WeakSet<object>();
  let additionalStates = 0;
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const value = unwrapJavaScriptExpression(next.node).node;
    const { awaitDepths } = next;
    const byMode =
      contexts.get(value) ??
      new Map<string, { readonly identities: Map<string, object> }>();
    const modeKey = JSON.stringify([awaitDepths, loaderSourceContextKey(next)]);
    let context = byMode.get(modeKey);
    if (context === undefined) {
      context = { identities: new Map() };
      byMode.set(modeKey, context);
      contexts.set(value, byMode);
    }
    const path = selections.normalize(context, next.path);
    if (selections.limited) return true;
    const pathKey = JSON.stringify(path);
    let identity = context.identities.get(pathKey);
    if (identity === undefined) {
      // Consumption contexts must not provide an unbounded second path to
      // expansion beyond the shared selector budget.
      if (
        (byMode.size > 1 || context.identities.size > 0) &&
        ++additionalStates > SEMANTIC_ALIAS_SELECTION_LIMIT
      ) {
        state.valueResourceLimits.add("alias-selections");
        return true;
      }
      identity = {};
      context.identities.set(pathKey, identity);
    }
    // A revisited state adds no source. A cycle's other entries are expanded
    // once each, so a cycle is not an unknown loader.
    if (examined.has(identity)) continue;
    examined.add(identity);
    const enqueueAt = (
      depths: readonly number[],
      ...sources: ModuleObjectSource[]
    ) => {
      pending.push(
        ...inheritLoaderSourceContext(next, sources).map((source) => ({
          ...source,
          awaitDepths: depths,
        })),
      );
    };
    const enqueue = (...sources: ModuleObjectSource[]) => {
      enqueueAt(awaitDepths, ...sources);
    };
    if (t.isAwaitExpression(value)) {
      enqueueAt(
        [...new Set([...awaitDepths, path.length])].sort(
          (left, right) => left - right,
        ),
        { node: value.argument, path },
      );
      continue;
    }
    if (t.isMemberExpression(value) || t.isOptionalMemberExpression(value)) {
      enqueue(loaderMemberSource({ ...next, path }, value));
      continue;
    }
    if (
      path.length > 0 &&
      (t.isObjectExpression(value) || t.isArrayExpression(value))
    ) {
      enqueueAt(
        // Awaiting a fresh container does not await one of its children.
        awaitDepths.filter((depth) => depth !== path.length),
        ...loaderObjectPropertySources({ ...next, path }, value, state),
      );
      continue;
    }
    if (t.isConditionalExpression(value) || t.isLogicalExpression(value)) {
      enqueue(
        {
          node: t.isConditionalExpression(value)
            ? value.consequent
            : value.left,
          path,
        },
        {
          node: t.isConditionalExpression(value)
            ? value.alternate
            : value.right,
          path,
        },
      );
      continue;
    }
    if (t.isSequenceExpression(value)) {
      const last = value.expressions.at(-1);
      if (last !== undefined) enqueue({ node: last, path });
      continue;
    }
    if (t.isAssignmentExpression(value)) {
      enqueue(...assignmentValueSources(value).map((node) => ({ node, path })));
      continue;
    }
    if (
      t.isCallExpression(value) ||
      t.isOptionalCallExpression(value) ||
      t.isNewExpression(value)
    ) {
      const mode = awaitDepths.includes(path.length)
        ? "awaited-call"
        : "direct-call";
      const returnedResult = returnedLoaderReferences(state, mode)(
        value.callee,
        t.isNewExpression(value) ? undefined : value,
      );
      if (returnedResult.unresolvedInvocation) return true;
      enqueue(
        ...returnedResult.references.map((source) => ({
          node: source.node,
          path: [...source.projection, ...path],
          capturedSelections: semanticShiftCapturedSelections(
            next.capturedSelections,
            source.projection.length,
          ),
        })),
      );
      continue;
    }
    if (!t.isIdentifier(value)) continue;
    const binding = resolveSemanticBindingState(state, value, value.name);
    const processMainModulePath =
      semanticGlobalProcessOrigin(value, state) !== undefined &&
      path.length === (target === "module" ? 1 : 2) &&
      semanticAliasSelectionChoices(path[0]!).some(
        (key) =>
          key === null || semanticPropertyPathKeyMatches(key, "mainModule"),
      ) &&
      (target === "module" ||
        semanticAliasSelectionChoices(path[1]!).some(
          (key) =>
            key === null || semanticPropertyPathKeyMatches(key, "require"),
        ));
    if (processMainModulePath) return true;
    const mainModulePath =
      value.name === "require" &&
      state.program.sourceType === "script" &&
      path.length === (target === "module" ? 1 : 2) &&
      semanticAliasSelectionChoices(path[0]!).some(
        (key) => key === null || semanticPropertyPathKeyMatches(key, "main"),
      ) &&
      (target === "module" ||
        semanticAliasSelectionChoices(path[1]!).some(
          (key) =>
            key === null || semanticPropertyPathKeyMatches(key, "require"),
        ));
    // Native wrapper require.main is a Module, with a process-relative loader.
    // Its selected binding writes below can replace that source with local data.
    if (
      mainModulePath &&
      binding === undefined &&
      !semanticResolutionBlocked(state, value, "require")
    )
      return true;
    const copyAdmitsModuleDelegate =
      value.name !== "module" ||
      target !== "delegate" ||
      path.length !== 1 ||
      !next.capturedSelections?.some(
        (capture) =>
          capture.depth === 1 &&
          capture.ownEnumerable &&
          !semanticCommonJsRequireOwnEnumerableAt(capture.at, state),
      );
    if (value.name === "module" && binding === undefined) {
      if (
        copyAdmitsModuleDelegate &&
        (target === "module"
          ? path.length === 0
          : path.length === 1 &&
            semanticAliasSelectionChoices(path[0]!).some(
              (key) =>
                key === null || semanticPropertyPathKeyMatches(key, "require"),
            )) &&
        !semanticResolutionBlocked(state, value, "module")
      )
        return true;
      continue;
    }
    if (binding === undefined) continue;
    const read = semanticBindingAtRead(binding, value, state.parentsByNode);
    const retainsMainModule =
      mainModulePath &&
      commonJsWrapperBindingDeclaration(value, "require", state) !==
        undefined &&
      !read.hasDefiniteInitializer;
    if (
      value.name === "module" &&
      copyAdmitsModuleDelegate &&
      (target === "module"
        ? path.length === 0
        : path.length === 1 &&
          semanticAliasSelectionChoices(path[0]!).some(
            (key) =>
              key === null || semanticPropertyPathKeyMatches(key, "require"),
          )) &&
      commonJsWrapperBindingDeclaration(value, "module", state) !== undefined &&
      !read.hasDefiniteInitializer
    )
      return true;
    let eligibility = next.eligibility;
    const facts = eligibility
      ? undefined
      : semanticProjectedSourceFactsAtRead(
          binding,
          value,
          path,
          state,
          includeUnknown,
          next.readAt ?? value,
          next.capturedSelections,
        );
    if (retainsMainModule && (eligibility || facts?.retainsOrigin)) return true;
    let sources = eligibility
      ? semanticProjectedSourceEligibilityAtRead(
          binding,
          value,
          path,
          state,
          next.readAt ?? value,
          next.capturedSelections,
        )
      : facts?.sources;
    if (sources === undefined) {
      if (target !== "delegate") return true;
      // An opaque member effect can obscure a selected native delegate, but
      // cannot make every escaped callable a possible Node loader. Keep its
      // receiver's retained sources as the eligibility boundary for that gap.
      sources = semanticProjectedSourceEligibilityAtRead(
        binding,
        value,
        path,
        state,
        next.readAt ?? value,
        next.capturedSelections,
      );
      if (sources === undefined) return true;
      eligibility = true;
    }
    enqueue(
      ...projectedLoaderSources({ ...next, node: value, path }, sources).map(
        (source) => (eligibility ? { ...source, eligibility } : source),
      ),
    );
  }
  return false;
};

/** Select an unchecked member-loader receiver before its identity is examined. */
export const semanticModuleRequireReceiver = (
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
): t.Node | undefined => {
  let callee = unwrapJavaScriptExpression(node.callee).node;
  while (
    (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
    ["bind", "call", "apply"].includes(
      semanticStaticPropertyKey(callee.property, callee.computed) ?? "",
    )
  )
    // Capturing a bound delegate can load outside the visible module graph.
    // Keep that possibility without asserting bind/call/apply is unmodified.
    callee = unwrapJavaScriptExpression(callee.object).node;
  return (t.isMemberExpression(callee) ||
    t.isOptionalMemberExpression(callee)) &&
    semanticStaticPropertyKey(callee.property, callee.computed) === "require"
    ? callee.object
    : undefined;
};

/** Recognize an unchecked module loader without asserting its current delegate. */
export const semanticModuleRequireCallAt = (
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  state: JavaScriptSemanticAnalysisState,
  includeUnknown = true,
): boolean => {
  const receiver = semanticModuleRequireReceiver(node);
  if (
    receiver !== undefined &&
    isCommonJsModuleObject(receiver, state, includeUnknown)
  )
    return true;
  let target = unwrapJavaScriptExpression(node.callee).node;
  while (
    (t.isMemberExpression(target) || t.isOptionalMemberExpression(target)) &&
    ["bind", "call", "apply"].includes(
      semanticStaticPropertyKey(target.property, target.computed) ?? "",
    )
  )
    target = unwrapJavaScriptExpression(target.object).node;
  // The callee is selected before the current invocation can escape or mutate
  // its receiver. Earlier captured member reads retain their own source site.
  if (isCommonJsRequireDelegate(target, state, includeUnknown, node))
    return true;
  if (t.isNewExpression(node)) return false;
  const interop = loaderInvocationInterop(state);
  return (
    interop.intrinsicInvocation(node, (callee) =>
      isCommonJsRequireDelegate(callee, state, false, node)
        ? ["commonjs-require-delegate"]
        : interop.intrinsicPath(callee),
    )?.path[0] === "commonjs-require-delegate"
  );
};

const writesModuleRequire = (
  state: JavaScriptSemanticAnalysisState,
): readonly t.Node[] => {
  const cached = moduleRequireWrites.get(state);
  if (cached !== undefined) return cached;
  // Interop invocation resolution may ask for require provenance while this
  // index is being built. Publish a temporary empty result to break that cycle.
  moduleRequireWrites.set(state, []);
  const writes: t.Node[] = [];
  const interop = createSemanticModuleInterop(state);
  const isModuleObject = (node: t.Node): boolean =>
    // Only a retained module identity can revoke the host delegate. Escaping
    // an unrelated local table is not evidence that it became the host module.
    isCommonJsModuleObject(node, state, false);
  traverseJavaScriptValueAst(state.program, state.erasedSyntaxNodes, {
    enter: (node) => {
      const target = t.isAssignmentExpression(node)
        ? node.left
        : t.isUpdateExpression(node) ||
            t.isUnaryExpression(node, { operator: "delete" })
          ? node.argument
          : undefined;
      if (
        t.isMemberExpression(target) ||
        t.isOptionalMemberExpression(target)
      ) {
        const key = semanticStaticPropertyKey(target.property, target.computed);
        if (
          (key === "require" || (key === null && target.computed)) &&
          isModuleObject(target.object)
        )
          writes.push(node);
      }
      if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) {
        const invocation = interop.intrinsicInvocation(node);
        const owner =
          invocation?.path?.length === 3 ? invocation.path[1] : undefined;
        const method = invocation?.path?.at(-1);
        const args = invocation?.arguments;
        if (
          (owner === "Object" || owner === "Reflect") &&
          method === "defineProperty" &&
          isModuleObject(args?.[0] ?? t.nullLiteral())
        ) {
          const key = interop.staticString(args?.[1]);
          if (key === "require" || key === undefined) writes.push(node);
        } else if (
          owner === "Object" &&
          method === "defineProperties" &&
          isModuleObject(args?.[0] ?? t.nullLiteral())
        ) {
          const descriptors = args?.[1];
          if (
            !t.isObjectExpression(descriptors) ||
            descriptors.properties.some(
              (property) =>
                t.isSpreadElement(property) ||
                (t.isObjectProperty(property) &&
                  semanticStaticPropertyKey(property.key, property.computed) ===
                    "require"),
            )
          )
            writes.push(node);
        } else if (
          owner === "Object" &&
          method === "assign" &&
          args?.some((arg) => isModuleObject(arg))
        ) {
          const target = args?.[0];
          if (target !== undefined && isModuleObject(target)) {
            const sourceHasRequire = args
              ?.slice(1)
              .some(
                (arg) =>
                  t.isObjectExpression(arg) &&
                  arg.properties.some(
                    (property) =>
                      t.isObjectProperty(property) &&
                      semanticStaticPropertyKey(
                        property.key,
                        property.computed,
                      ) === "require",
                  ),
              );
            if (
              sourceHasRequire ||
              args?.slice(1).some((arg) => !t.isObjectExpression(arg))
            )
              writes.push(node);
          }
        }
      }
    },
  });
  moduleRequireWrites.set(state, writes);
  return writes;
};

/** Whether the original global process object can still own effects at this source site. */
export const semanticOriginalGlobalProcessAt = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  let replacements = globalProcessReplacements.get(state);
  if (replacements === undefined) {
    replacements = [
      ...state.ambientWriteEffects
        .filter(
          ({ path }) =>
            path.length <= 2 &&
            path.every((key, index) =>
              semanticPropertyPathKeyMatches(
                key,
                ["global", "process"][index]!,
              ),
            ),
        )
        .map(({ node: write }) => write),
      ...(state.ambientBindingWrites.get("process") ?? []),
    ];
    globalProcessReplacements.set(state, replacements);
  }
  return !replacements.some(
    (write) =>
      !semanticTopLevelEffectFollowsCapture(node, write, state.parentsByNode),
  );
};

/** Node's unbound process reference shares the cached process exports object. */
export const semanticGlobalProcessOrigin = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptModuleOrigin | undefined =>
  t.isIdentifier(node, { name: "process" }) &&
  resolveSemanticBindingState(state, node, "process") === undefined &&
  !semanticResolutionBlocked(state, node, "process") &&
  semanticOriginalGlobalProcessAt(node, state)
    ? { specifier: "node:process", importedPath: [], resolutionMode: "require" }
    : undefined;

/** Resolve qualified global-object process references, preserving their selected path. */
export const semanticGlobalProcessPathOrigin = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptModuleOrigin | undefined => {
  const chain = semanticMemberChain(node);
  if (chain === undefined) return undefined;
  const { root: current, members } = chain;
  if (
    !t.isIdentifier(current) ||
    !["globalThis", "global", "window", "self"].includes(current.name) ||
    resolveSemanticBindingState(state, current, current.name) !== undefined ||
    semanticResolutionBlocked(state, current, current.name) ||
    members[0] !== "process" ||
    !semanticOriginalGlobalProcessAt(node, state)
  )
    return undefined;
  return {
    specifier: "node:process",
    importedPath: members.slice(1),
    resolutionMode: "require",
  };
};

/** Recover an unshadowed literal require origin and its exact member path. */
export const semanticRequireOrigin = (
  node: t.Node | null | undefined,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptRequireOrigin | undefined => {
  const chain = semanticMemberChain(node);
  const current = chain?.root;
  if (
    chain === undefined ||
    !t.isCallExpression(current) ||
    !t.isIdentifier(current.callee, { name: "require" })
  )
    return undefined;
  if (commonJsDelegateChangedAt(current, state)) return undefined;
  const requireBinding = resolveSemanticBindingState(
    state,
    current.callee,
    "require",
  );
  if (
    (requireBinding !== undefined &&
      !isUnmodifiedCommonJsWrapperBinding(current.callee, "require", state) &&
      !isWrapperRequireInitializerCall(requireBinding, current, state)) ||
    (requireBinding === undefined &&
      (javaScriptRuntimeContext(state.program) === "module" ||
        semanticResolutionBlocked(state, current.callee, "require"))) ||
    (state.ambientBindingWrites.get("require") ?? []).some(
      (write) =>
        !semanticTopLevelEffectFollowsCapture(
          current,
          write,
          state.parentsByNode,
        ),
    )
  )
    return undefined;
  const specifier = stringValue(current.arguments[0]);
  return specifier === undefined
    ? undefined
    : {
        origin: {
          specifier,
          importedPath: chain.members,
          resolutionMode: "require",
        },
        call: current,
      };
};

/** Node's exported child objects retain their direct builtin-module identity. */
export const semanticRequireExportsIdentity = <Key>(
  specifier: string,
  path: readonly Key[],
): { readonly specifier: string; readonly path: readonly (Key | string)[] } => {
  const name = specifier.replace(/^node:/u, "");
  if (name === "fs/promises") return { specifier: name, path };
  if (["path", "path/posix", "path/win32"].includes(name)) {
    let selected = name;
    let remaining = path;
    while (
      remaining.length > 1 &&
      (remaining[0] === "posix" || remaining[0] === "win32")
    ) {
      selected = `path/${remaining[0]}`;
      remaining = remaining.slice(1);
    }
    return { specifier: selected, path: remaining };
  }
  return name === "fs" && path[0] === "promises" && path.length > 1
    ? { specifier: "fs/promises", path: path.slice(1) }
    : { specifier: name, path };
};

const MUTABLE_BUILTIN_DEFAULTS = new Set([
  ...Object.keys(BUILTIN_RESOURCE_METHODS),
  "http",
  "https",
  "child_process",
  "timers",
  "process",
  "path",
  "path/posix",
  "path/win32",
  "url",
]);

/** Mutable default/object selections share CommonJS identity; namespace slots do not. */
export const semanticMutableBuiltinOrigin = <Key = never>(
  origin: JavaScriptModuleOrigin,
  selected: readonly Key[] = [],
):
  | { readonly specifier: string; readonly path: readonly (Key | string)[] }
  | undefined => {
  const path = [...origin.importedPath, ...selected];
  if (origin.resolutionMode === "require")
    return { specifier: origin.specifier, path };
  const specifier = origin.specifier.replace(/^node:/u, "");
  if (!MUTABLE_BUILTIN_DEFAULTS.has(specifier)) return undefined;
  if (path[0] === "default") return { specifier, path: path.slice(1) };
  if (specifier === "process" && (path[0] === "env" || path[0] === "argv"))
    return { specifier, path };
  return specifier === "fs" && path[0] === "promises"
    ? { specifier, path }
    : undefined;
};

semanticRequireOriginReaders.origin = semanticRequireOrigin;
semanticRequireOriginReaders.loader = semanticRequireLoaderAt;
