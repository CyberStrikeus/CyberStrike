import {
  createSemanticOpaqueGlobalObserver,
  indexSemanticOpaqueEffects,
  semanticOpaqueBindingEffects,
  semanticBindingCanBeRebound,
  semanticOpaqueBindingReadMayHaveChanged,
} from "./javascriptSemanticOpaqueEffects.js";
import type { JavaScriptOpenReceiverFact } from "./javascriptSemanticReceiverFacts.js";
import * as t from "@babel/types";

import {
  semanticComputedMethodKey,
  semanticBranchMayBeSkipped,
  semanticPriorStatementMayExit,
  semanticIterationCardinality,
} from "./javascriptSemanticEvaluationOrder.js";

import {
  failedJavaScriptSemanticIr,
  type JavaScriptModuleOrigin,
  type JavaScriptSemanticDefinition,
  type JavaScriptSemanticIr,
  type JavaScriptSemanticReference,
} from "./javascriptSemanticIr.js";
import {
  collectSemanticModuleLink,
  collectSemanticCallable,
  collectSemanticReferences,
  collectSemanticReferencesSteps,
  immutableSemanticBindings,
  immutableSemanticScopes,
  semanticReferenceRole,
} from "./javascriptSemanticProjection.js";
import {
  semanticObjectPatternKeys,
  runtimeFunctionParameters,
  semanticStaticPropertyKey,
  semanticWriteTargets,
  semanticWriteSiteTarget,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import type {
  JavaScriptSemanticAnalysisState,
  JavaScriptSemanticBindingState,
  JavaScriptSemanticScopeState,
  JavaScriptBindingIndex,
  JavaScriptSemanticReferenceEffectsAtSite,
} from "./javascriptSemanticState.js";
import {
  currentSemanticScope,
  resolveSemanticBindingState,
  semanticResolutionBlocked,
  resolveSemanticBindingFromScope,
  semanticBindingLookupFromScope,
  semanticBindingLookupAt,
  semanticBindingId,
  semanticScopeId,
  semanticStableInitializer,
  semanticVariableScope,
} from "./javascriptSemanticState.js";
import {
  completeSemanticSteps,
  isErasedJavaScriptValueChild,
  traverseJavaScriptAstSteps,
  traverseJavaScriptValueAstSteps,
} from "./javascriptSemanticTraversal.js";
import {
  semanticRequireOrigin,
  observePossibleCommonJsDelegateWrite,
  invalidateSemanticRequireDelegateWrites,
} from "./javascriptSemanticRequireOrigin.js";
import { semanticBundledRequireOrigin } from "./javascriptBundledRequireOrigin.js";
import { collectSemanticMemberMutationsSteps } from "./javascriptSemanticMemberMutations.js";
import {
  semanticEffectTiming,
  semanticEffectTimingWithinActivation,
} from "./javascriptSemanticMutationInitializers.js";
import {
  createAmbientPathResolver,
  indexJavaScriptAmbientWritesSteps,
  isUnmodifiedGlobalReference,
} from "./javascriptSemanticAmbientWrites.js";
import {
  hasUncertainTypeOnlyModuleSideEffect,
  isTypeOnlyImportDeclaration,
  isTypeOnlyImportSpecifier,
  semanticImportEqualsSpecifier,
} from "./javascriptModuleDeclaration.js";
import {
  collectSemanticReturns,
  resolveSemanticModuleCallables,
} from "./javascriptSemanticReturns.js";
import { collectJavaScriptDerivedSemanticsSteps } from "./javascriptSemanticDerivedAnalysis.js";
import {
  evaluateSemanticProvenance,
  clearSemanticValueCaches,
} from "./javascriptSemanticValues.js";
import {
  collectJavaScriptIdentityWritesSteps,
  electronExportPath,
  electronMemberPath,
  ELECTRON_MODULE,
} from "./javascriptElectronMemberWrites.js";
import { range } from "./javascriptStaticAnalysisHelpers.js";
import {
  semanticCoverage,
  RETURNED_REFERENCE_WIDENING_LIMITATION,
} from "./javascriptSemanticCoverage.js";
import { semanticResourceLimitReason } from "./javascriptSemanticResourceLimits.js";
import {
  javaScriptRuntimeContext,
  javaScriptProgramStrictness,
  parseJavaScriptSource,
  type ParsedJavaScriptSource,
} from "./javascriptSourceParser.js";

import { isJavaScriptRpcClientFactory } from "./javascriptRpcEndpoints.js";
import { createSemanticModuleInterop } from "./javascriptModuleInterop.js";
import {
  SemanticPropertyPathCoverage,
  semanticPropertyPathKeyMatches,
  type JavaScriptSemanticPropertyPath,
} from "./javascriptSemanticPropertyPaths.js";
import { indexCommonJsExportReceiversSteps } from "./javascriptCommonJsExportReceivers.js";
import { createSemanticElectronAppPathChangeQuery } from "./javascriptElectronAppPathChanges.js";
import type { JavaScriptModuleResolutionMode } from "./javascriptModuleResolutionMode.js";

interface BindPatternInput {
  readonly iterationSources?: JavaScriptSemanticBindingState["initializers"][number]["iterationSources"];
  readonly pattern: t.Node;
  readonly entryBody?: t.BlockStatement;
  readonly initializer: t.Node | null;
  readonly scope: JavaScriptSemanticScopeState;
  readonly state: JavaScriptSemanticAnalysisState;
  readonly mutable: boolean;
  readonly declarationKind?: "var" | "let" | "const" | "using" | "await using";
  readonly kind?: JavaScriptSemanticDefinition["kind"];
  readonly projection?: readonly (string | number | null)[];
  readonly referenceOnly?: boolean;
  readonly assignmentReference?: true;
  readonly copyKind?: "object-rest" | "array-rest";
  readonly copyProjectionOffset?: number;
  readonly copyExcludedKeys?: readonly string[];
  readonly copyStartIndex?: number;
  readonly fallbackSources?: readonly {
    readonly node: t.Node;
    readonly projection: readonly (string | number | null)[];
    readonly iterationSources?: NonNullable<
      JavaScriptSemanticBindingState["initializers"][number]["iterationSources"]
    >;
  }[];
  readonly requiredSources?: readonly {
    readonly node: t.Node;
    readonly projection: readonly (string | number | null)[];
    readonly iterationSources?: NonNullable<
      JavaScriptSemanticBindingState["initializers"][number]["iterationSources"]
    >;
  }[];
}

interface AddBindingInput {
  readonly iterationSources?: JavaScriptSemanticBindingState["initializers"][number]["iterationSources"];
  readonly state: JavaScriptSemanticAnalysisState;
  readonly scope: JavaScriptSemanticScopeState;
  readonly name: string;
  readonly kind: JavaScriptSemanticDefinition["kind"];
  readonly mutable: boolean;
  readonly declarationKind?: "var" | "let" | "const" | "using" | "await using";
  readonly definitionNode: t.Node;
  readonly initializer: t.Node | null;
  readonly directOrigin?: JavaScriptModuleOrigin;
  readonly runtimeImport?: boolean;
  readonly projection?: readonly (string | number | null)[];
}

/** Recover lexical bindings, aliases, constants, and module links. */
export const analyzeJavaScriptSemantics = (
  source: string,
): JavaScriptSemanticIr => {
  const file = parseJavaScriptSource(source);
  return file === null
    ? failedJavaScriptSemanticIr()
    : analyzeParsedJavaScriptSemantics(file);
};

/** Recover lexical references, optionally for one name, without evaluating values or provenance. */
export const analyzeParsedJavaScriptReferences = (
  file: Pick<ParsedJavaScriptSource, "program">,
  name?: string,
): readonly JavaScriptSemanticReference[] => {
  const state = createState(file.program);
  completeSemanticSteps(collectDefinitionsSteps(file.program, state));
  return collectSemanticReferences(file.program, state, name);
};

const indexedAmbientWriteStates =
  new WeakSet<JavaScriptSemanticAnalysisState>();
const indexedMemberMutationStates =
  new WeakSet<JavaScriptSemanticAnalysisState>();

function* indexSemanticAmbientWritesSteps(
  state: JavaScriptSemanticAnalysisState,
): Generator<void, void> {
  if (indexedAmbientWriteStates.has(state)) return;
  yield* indexJavaScriptAmbientWritesSteps(
    state.program,
    state,
    createSemanticOpaqueGlobalObserver(state, {
      createAmbientPathResolver,
      createSemanticModuleInterop,
    }),
    (node) => observePossibleCommonJsDelegateWrite(node, state),
  );
  if (state.opaqueEffects.globalSites.length > 0)
    clearSemanticValueCaches(state);
  indexedAmbientWriteStates.add(state);
}

/** Index alias-aware mutation facts only for consumers that request them. */
function* indexSemanticMemberMutationFactsSteps(
  state: JavaScriptSemanticAnalysisState,
): Generator<void, void> {
  if (indexedMemberMutationStates.has(state)) return;
  yield* indexSemanticAmbientWritesSteps(state);
  yield* collectSemanticMemberMutationsSteps(
    state.program,
    state,
    (site, reference, path) =>
      referenceEffectsMayHaveChanged(state, site, reference, path),
  );
  indexedMemberMutationStates.add(state);
  invalidateSemanticRequireDelegateWrites(state);
}

/** One owner projects source-site effects for complete reports or early exit. */
const visitSemanticReferenceEffectsAtSite = (
  state: JavaScriptSemanticAnalysisState,
  site: t.Node,
  referenceNode: t.Node,
  visit: (
    effect: JavaScriptSemanticReferenceEffectsAtSite["effects"][number],
  ) => boolean,
  requestedPath?: JavaScriptSemanticPropertyPath,
  effectTiming: typeof semanticEffectTiming = semanticEffectTiming,
): Omit<JavaScriptSemanticReferenceEffectsAtSite, "effects"> => {
  const { root, path: inferredPath } = semanticReferenceRoot(referenceNode);
  const memberEffectsIndexed = indexedMemberMutationStates.has(state);
  if (!t.isIdentifier(root))
    return {
      bindingId: null,
      resolution: "unknown",
      memberEffectsIndexed,
    };
  const lookup = semanticBindingLookupAt(state, root, root.name);
  const binding = "binding" in lookup ? lookup.binding : undefined;
  const blocked = lookup.kind !== "binding" && lookup.kind !== "ambient";
  const resolution =
    lookup.kind === "binding" ? "resolved" : blocked ? "unknown" : "unbound";
  const path = requestedPath ?? inferredPath;
  const metadata: Omit<JavaScriptSemanticReferenceEffectsAtSite, "effects"> = {
    bindingId: binding?.bindingId ?? null,
    resolution,
    memberEffectsIndexed,
  };
  const retain = (
    kind: JavaScriptSemanticReferenceEffectsAtSite["effects"][number]["kind"],
    node: t.Node | undefined,
    effectPath?: JavaScriptSemanticPropertyPath,
  ): boolean => {
    if (effectPath !== undefined && !semanticPathsOverlap(path, effectPath))
      return true;
    return visit({
      kind,
      ...(effectPath === undefined ? {} : { path: effectPath }),
      timing: effectTiming(site, node, state),
    });
  };
  if (binding !== undefined) {
    if (semanticBindingCanBeRebound(binding))
      for (const node of semanticOpaqueBindingEffects(binding, state))
        if (!retain("binding-write", node)) return metadata;
    for (const node of semanticOpaqueBindingEffects(
      binding,
      state,
      "reference",
    ))
      if (!retain("escape", node, [])) return metadata;
    for (const node of state.bindingWrites.get(binding.bindingId) ?? [])
      if (!retain("binding-write", node)) return metadata;
    // The mutation producer also queries its growing facts during convergence.
    // Completion stays explicit in metadata; callers cannot infer readiness.
    for (const effect of binding.memberWrites)
      if (!retain("member-write", effect.node, effect.path)) return metadata;
    for (const effect of binding.escapedPaths)
      if (!retain("escape", effect.node, effect.path)) return metadata;
  } else if (lookup.kind === "ambient" || lookup.kind === "uncertain-ambient") {
    for (const node of state.ambientBindingWrites.get(root.name) ?? [])
      if (!retain("ambient-write", node)) return metadata;
    const ambientRoots = createAmbientPathResolver(state, false)(root).paths;
    for (const ambientRoot of ambientRoots) {
      const selectedPath = [...ambientRoot, ...path];
      for (const [kind, effects] of [
        ["member-write", state.ambientWriteEffects],
        ["escape", state.ambientEscapeEffects],
      ] as const)
        for (const effect of effects)
          if (
            semanticPathsOverlap(selectedPath, effect.path) &&
            !retain(kind, effect.node, effect.path.slice(ambientRoot.length))
          )
            return metadata;
    }
  }
  return metadata;
};

/** Query current producer facts; public consumers additionally require completion. */
const referenceEffectsMayHaveChanged = (
  state: JavaScriptSemanticAnalysisState,
  site: t.Node,
  referenceNode: t.Node,
  propertyPath?: JavaScriptSemanticPropertyPath,
): boolean => {
  let changed = false;
  const metadata = visitSemanticReferenceEffectsAtSite(
    state,
    site,
    referenceNode,
    (effect) => {
      changed = effect.timing !== "after";
      return !changed;
    },
    propertyPath,
  );
  return metadata.resolution !== "resolved" || changed;
};

/** Preserve the complete diagnostic contract for consumers needing every effect. */
const semanticReferenceEffectsAtSite = (
  state: JavaScriptSemanticAnalysisState,
  site: t.Node,
  referenceNode: t.Node,
  requestedPath?: JavaScriptSemanticPropertyPath,
  effectTiming: typeof semanticEffectTiming = semanticEffectTiming,
): JavaScriptSemanticReferenceEffectsAtSite => {
  const effects: JavaScriptSemanticReferenceEffectsAtSite["effects"][number][] =
    [];
  const metadata = visitSemanticReferenceEffectsAtSite(
    state,
    site,
    referenceNode,
    (effect) => {
      effects.push(effect);
      return true;
    },
    requestedPath,
    effectTiming,
  );
  return { ...metadata, effects };
};

const semanticReferenceRoot = (
  node: t.Node,
): { readonly root: t.Node; readonly path: JavaScriptSemanticPropertyPath } => {
  const path: (string | number | null)[] = [];
  let current = unwrapJavaScriptExpression(node).node;
  while (
    t.isMemberExpression(current) ||
    t.isOptionalMemberExpression(current)
  ) {
    const key = semanticStaticPropertyKey(current.property, current.computed);
    path.unshift(key ?? null);
    current = unwrapJavaScriptExpression(current.object).node;
  }
  return { root: current, path };
};

const semanticPathsOverlap = (
  left: JavaScriptSemanticPropertyPath,
  right: JavaScriptSemanticPropertyPath,
): boolean => {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const leftKey = left[index];
    const rightKey = right[index];
    if (leftKey === undefined || rightKey === undefined) return true;
    const leftMatchesRight =
      typeof rightKey === "string" || typeof rightKey === "number"
        ? semanticPropertyPathKeyMatches(leftKey, String(rightKey))
        : true;
    const rightMatchesLeft =
      typeof leftKey === "string" || typeof leftKey === "number"
        ? semanticPropertyPathKeyMatches(rightKey, String(leftKey))
        : true;
    if (!leftMatchesRight && !rightMatchesLeft) return false;
  }
  return true;
};

/** Share the lexical index with bounded, demand-driven boundary analyses. */
export function* indexJavaScriptBindingsSteps(
  program: t.Program,
): Generator<void, JavaScriptSemanticAnalysisState> {
  const state = createState(program);
  yield* collectDefinitionsSteps(program, state);
  yield* indexSemanticAmbientWritesSteps(state);
  return state;
}

/** Recover semantics from an already parsed JavaScript artifact. */
export const analyzeParsedJavaScriptSemantics = (
  file: ParsedJavaScriptSource,
  staticImportResolutionMode: JavaScriptModuleResolutionMode = "import",
): JavaScriptSemanticIr =>
  completeSemanticSteps(
    analyzeParsedJavaScriptSemanticsSteps(file, staticImportResolutionMode),
  );

/**
 * Recover semantics from a parsed artifact with a yield between analysis
 * phases, so a caller can serve control messages within one large file.
 * Each phase completes before the next starts; results equal the synchronous
 * form.
 */
export function* analyzeParsedJavaScriptSemanticsSteps(
  file: ParsedJavaScriptSource,
  staticImportResolutionMode: JavaScriptModuleResolutionMode = "import",
  expressionNodeBudget?: number,
): Generator<void, JavaScriptSemanticIr> {
  const state = createState(file.program, staticImportResolutionMode);
  yield* collectDefinitionsSteps(file.program, state);
  yield* indexSemanticAmbientWritesSteps(state);
  yield* indexSemanticMemberMutationFactsSteps(state);
  const commonJsReceivers = yield* indexCommonJsExportReceiversSteps(state);
  yield* traverseJavaScriptAstSteps(file.program, {
    enter: (node) => collectSemanticModuleLink(node, state, commonJsReceivers),
  });
  yield;
  const references = yield* collectSemanticReferencesSteps(file.program, state);
  const parserPartial = file.errors.length > 0;
  const bindings = immutableSemanticBindings(state);
  yield;
  const callables = collectSemanticReturns(state, parserPartial);
  yield;
  const moduleLinks = resolveSemanticModuleCallables(
    state,
    callables,
    bindings,
  );
  const derived = yield* collectJavaScriptDerivedSemanticsSteps(
    file.program,
    state,
    callables,
    references,
    parserPartial,
    expressionNodeBudget,
  );
  const coverage = semanticCoverage(
    parserPartial,
    [
      ...new Set([...state.valueResourceLimits, ...state.getterResourceLimits]),
    ].sort(),
    [...state.returnedReferenceWidenings].map(range),
  );
  return {
    schema: "JavaScriptSemanticIR",
    scopes: immutableSemanticScopes(state),
    bindings,
    callables,
    references,
    moduleLinks,
    ...derived,
    coverage: derived.expressionFlowsTruncated
      ? { ...coverage, status: "partial", omittedCount: null }
      : coverage,
    limitations: [
      ...(derived.expressionFlowsTruncated
        ? [
            "The offered semantic node capacity bounded expression dependencies; omitted influence remains unknown.",
          ]
        : []),
      ...(state.valueResourceLimits.has("alias-selections")
        ? [semanticResourceLimitReason("alias-selections")]
        : []),
      ...(state.returnedReferenceWidenings.size > 0
        ? [RETURNED_REFERENCE_WIDENING_LIMITATION]
        : []),
      ...[...state.getterResourceLimits]
        .sort()
        .map(semanticResourceLimitReason),
      ...(parserPartial
        ? [
            "The parser recovered from syntax errors; affected bindings are partial.",
          ]
        : []),
      ...(hasUncertainTypeOnlyModuleSideEffect(file.program)
        ? [
            "Compiler options are unavailable; inline type-only imports or re-exports may preserve a module side-effect dependency.",
          ]
        : []),
      "Values and aliases were recovered from inert syntax only; no JavaScript was executed.",
      "Return sites include only direct callable returns; nested callable returns remain separate.",
      "Local call, argument, return, and closure relations are static candidates and do not prove runtime invocation.",
      "Promise ownership covers explicit unshadowed Promise construction, static factories, aggregation, chaining, and await syntax only.",
      "Cross-function mutation and dynamic property resolution remain unknown.",
    ],
  };
}

/**
 * Receiver identity facts for the overloaded `.open` syntax, plus
 * `configuration` for `.get` reads of a `getConfiguration(...)` result.
 */
export type { JavaScriptOpenReceiverFact } from "./javascriptSemanticReceiverFacts.js";

/** Lexical receiver identities that select static endpoint interpretations. */
export interface JavaScriptReceiverFacts {
  readonly openReceivers: ReadonlyMap<number, JavaScriptOpenReceiverFact>;
  readonly rpcClientRoots: ReadonlySet<t.Node>;
}

export interface JavaScriptReceiverIndex extends JavaScriptBindingIndex {
  readonly receivers: JavaScriptReceiverFacts;
}

/**
 * Index bindings and classify receivers from one definitions pass. Receiver
 * facts read the definitions-only phase. Consumers request ambient writes and
 * lexical references only when needed; each optional index is built once.
 */
export function* indexJavaScriptBindingsWithReceiversSteps(
  program: t.Program,
  hostContext?: "commonjs-wrapper",
): Generator<void, JavaScriptReceiverIndex> {
  const state = createState(program);
  if (hostContext === "commonjs-wrapper") {
    const scope = currentSemanticScope(state.scopes);
    const binding: JavaScriptSemanticBindingState = {
      ...createBinding(scope, "require", "parameter", false),
      hostOrigin: "commonjs-wrapper",
    };
    scope.bindings.set(binding.name, binding);
    state.bindingsById.set(binding.bindingId, binding);
  }
  yield* collectDefinitionsSteps(program, state);
  const receivers = yield* classifyDefinitionReceiversSteps(program, state);
  let references: readonly JavaScriptSemanticReference[] | undefined;
  return {
    sourceType: program.sourceType,
    bindings: state,
    receivers,
    *indexAmbientWritesSteps() {
      yield* indexSemanticAmbientWritesSteps(state);
    },
    *indexMemberMutationFactsSteps() {
      yield* indexSemanticMemberMutationFactsSteps(state);
    },
    bindingForReferenceAt(referenceNode) {
      const { root } = semanticReferenceRoot(referenceNode);
      return t.isIdentifier(root)
        ? resolveSemanticBindingState(state, root, root.name)
        : undefined;
    },
    effectsForReferenceAt(site, referenceNode, propertyPath) {
      return semanticReferenceEffectsAtSite(
        state,
        site,
        referenceNode,
        propertyPath,
      );
    },
    effectsForReferenceWithinActivationAt(site, referenceNode, propertyPath) {
      return semanticReferenceEffectsAtSite(
        state,
        site,
        referenceNode,
        propertyPath,
        semanticEffectTimingWithinActivation,
      );
    },
    referenceMayHaveChangedAt(site, referenceNode, propertyPath) {
      if (!indexedMemberMutationStates.has(state)) return true;
      return referenceEffectsMayHaveChanged(
        state,
        site,
        referenceNode,
        propertyPath,
      );
    },
    *referencesSteps() {
      references ??= yield* collectSemanticReferencesSteps(program, state);
      return references;
    },
  };
}

function* classifyDefinitionReceiversSteps(
  program: t.Program,
  state: JavaScriptSemanticAnalysisState,
): Generator<void, JavaScriptReceiverFacts> {
  const facts = new Map<number, JavaScriptOpenReceiverFact>();
  const extensionStateReads: number[] = [];
  const roots = new Set<t.Node>();
  const clients = new Map<string, boolean>();
  const classifyRpcRoot = (node: t.Node): void => {
    if (!t.isMemberExpression(node) && !t.isOptionalMemberExpression(node))
      return;
    const root = node.object;
    if (!t.isIdentifier(root)) return;
    const binding = resolveSemanticBindingState(state, root, root.name);
    if (binding === undefined) return;
    let client = clients.get(binding.bindingId);
    if (client === undefined) {
      const initializer = semanticStableInitializer(binding, state);
      client =
        initializer !== undefined &&
        initializer.projection.length === 0 &&
        isJavaScriptRpcClientFactory(initializer.node);
      clients.set(binding.bindingId, client);
    }
    if (client) roots.add(root);
  };
  const classifyOpenReceiver = (node: t.Node): void => {
    if (!t.isCallExpression(node) && !t.isOptionalCallExpression(node)) return;
    const callee = unwrapJavaScriptExpression(node.callee).node;
    if (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee))
      return;
    const object = unwrapJavaScriptExpression(callee.object).node;
    const method = semanticStaticPropertyKey(callee.property, callee.computed);
    if (method === "get") {
      if (isConfigurationReceiver(state, object))
        facts.set(node.start ?? -1, "configuration");
      else if (isExtensionStateMember(object))
        extensionStateReads.push(node.start ?? -1);
      return;
    }
    if (method !== "open" || !t.isIdentifier(object)) return;
    const receiver = object.name;
    const binding = resolveSemanticBindingState(state, node, receiver);
    if (binding === undefined) {
      if (semanticResolutionBlocked(state, node, receiver)) return;
      const fact = openGlobalFact(receiver);
      if (fact !== undefined) facts.set(node.start ?? -1, fact);
      return;
    }
    // A lexically bound receiver overrides ambient browser globals. Mark an
    // otherwise unresolved local as local so name-based window.open
    // heuristics do not hide its XHR-like overloads.
    facts.set(node.start ?? -1, "local");
    if (receiver === "indexedDB" || receiver === "caches") {
      facts.set(
        node.start ?? -1,
        receiver === "indexedDB" ? "local-indexed-db" : "local-cache-storage",
      );
      return;
    }
    if (binding.mutable || binding.initializers.length !== 1) return;
    const initializerSource = binding.initializers[0]?.node;
    if (initializerSource === undefined) return;
    const initializer = unwrapJavaScriptExpression(initializerSource).node;
    if (!t.isIdentifier(initializer)) return;
    const initializerBinding = resolveSemanticBindingState(
      state,
      initializer,
      initializer.name,
    );
    if (initializerBinding !== undefined) {
      if (initializer.name === "indexedDB" || initializer.name === "caches") {
        const localFact =
          initializer.name === "indexedDB"
            ? "local-indexed-db"
            : "local-cache-storage";
        facts.set(node.start ?? -1, localFact);
        if (
          initializerBinding.mutable ||
          initializerBinding.initializers.length !== 1
        )
          return;
        const nestedSource = initializerBinding.initializers[0]?.node;
        if (nestedSource === undefined) return;
        const nested = unwrapJavaScriptExpression(nestedSource).node;
        if (t.isIdentifier(nested)) {
          const nestedFact = resolveGlobalAliasFact(
            state,
            initializer,
            nested.name,
          );
          if (nestedFact !== undefined) facts.set(node.start ?? -1, nestedFact);
        }
      } else if (initializer.name === "window") {
        facts.set(node.start ?? -1, "local");
      }
      return;
    }
    const aliasFact = resolveGlobalAliasFact(
      state,
      initializer,
      initializer.name,
    );
    if (aliasFact !== undefined) facts.set(node.start ?? -1, aliasFact);
  };
  yield* traverseJavaScriptValueAstSteps(program, state.erasedSyntaxNodes, {
    enter: (node) => {
      classifyRpcRoot(node);
      classifyOpenReceiver(node);
    },
  });
  if (extensionStateReads.length > 0 && importsVsCodeModule(state))
    for (const start of extensionStateReads)
      facts.set(start, "extension-state");
  return { openReceivers: facts, rpcClientRoots: roots };
}

/** VS Code passes extension state through ExtensionContext, not an import. */
const isExtensionStateMember = (receiver: t.Node): boolean =>
  (t.isMemberExpression(receiver) || t.isOptionalMemberExpression(receiver)) &&
  (() => {
    const key = semanticStaticPropertyKey(receiver.property, receiver.computed);
    return key === "globalState" || key === "workspaceState";
  })();

/** Require module evidence before treating a familiar member as VS Code state. */
const importsVsCodeModule = (state: JavaScriptSemanticAnalysisState): boolean =>
  [...state.bindingsById.values()].some(
    (binding) =>
      binding.directOrigins.some(({ specifier }) => specifier === "vscode") ||
      semanticRequireOrigin(
        semanticStableInitializer(binding, state)?.node,
        state,
      )?.origin.specifier === "vscode",
  );

/**
 * Whether a call spells VS Code's `workspace.getConfiguration(section)`, whose
 * result `.get` reads setting keys rather than request paths. The `workspace`
 * member is required: a bare or differently scoped `getConfiguration` may be
 * an application's own HTTP client factory. Minifiers keep property names, so
 * bundled `x.workspace.getConfiguration` still matches.
 */
const isConfigurationAccessorCall = (
  state: JavaScriptSemanticAnalysisState,
  node: t.Node,
): boolean => {
  node = unwrapJavaScriptExpression(node).node;
  if (!t.isCallExpression(node) && !t.isOptionalCallExpression(node))
    return false;
  const callee = unwrapJavaScriptExpression(node.callee).node;
  if (
    (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee)) ||
    semanticStaticPropertyKey(callee.property, callee.computed) !==
      "getConfiguration"
  )
    return false;
  const host = unwrapJavaScriptExpression(callee.object).node;
  const matchesSpelling = t.isIdentifier(host)
    ? host.name === "workspace"
    : (t.isMemberExpression(host) || t.isOptionalMemberExpression(host)) &&
      semanticStaticPropertyKey(host.property, host.computed) === "workspace";
  if (!matchesSpelling) return false;
  const root = t.isIdentifier(host)
    ? host
    : t.isMemberExpression(host) || t.isOptionalMemberExpression(host)
      ? unwrapJavaScriptExpression(host.object).node
      : undefined;
  if (!t.isIdentifier(root)) return false;
  const binding = resolveSemanticBindingState(state, root, root.name);
  if (binding === undefined)
    return !semanticResolutionBlocked(state, root, root.name);
  const initializer = semanticStableInitializer(binding, state);
  const origins = [
    ...binding.directOrigins,
    ...(initializer === undefined
      ? []
      : [semanticRequireOrigin(initializer.node, state)?.origin]),
  ];
  return origins.some(
    (origin) =>
      origin?.specifier === "vscode" &&
      (t.isIdentifier(host)
        ? origin.importedPath.at(-1) === "workspace" ||
          initializer?.projection.at(-1) === "workspace"
        : origin.importedPath.length === 0 ||
          (origin.importedPath.length === 1 &&
            (origin.importedPath[0] === "*" ||
              origin.importedPath[0] === "default"))),
  );
};

/**
 * Whether a `.get` receiver is a configuration accessor result, either inline
 * or through a binding whose only visible write is one unconditional
 * initializer. Minifiers emit `let` for such bindings, so declaration kind
 * alone does not decide.
 */
const isConfigurationReceiver = (
  state: JavaScriptSemanticAnalysisState,
  receiver: t.Node,
): boolean => {
  if (isConfigurationAccessorCall(state, receiver)) return true;
  if (!t.isIdentifier(receiver)) return false;
  const binding = resolveSemanticBindingState(state, receiver, receiver.name);
  const initializer = semanticStableInitializer(binding, state);
  return (
    initializer !== undefined &&
    initializer.projection.length === 0 &&
    isConfigurationAccessorCall(state, initializer.node)
  );
};

const openGlobalFact = (
  name: string,
): JavaScriptOpenReceiverFact | undefined => {
  if (
    name === "window" ||
    name === "self" ||
    name === "globalThis" ||
    name === "top" ||
    name === "parent" ||
    name === "opener" ||
    name === "frames" ||
    name === "document"
  )
    return "window";
  if (name === "indexedDB") return "indexed-db";
  if (name === "caches") return "cache-storage";
  return undefined;
};

const resolveGlobalAliasFact = (
  state: JavaScriptSemanticAnalysisState,
  node: t.Node,
  name: string,
): JavaScriptOpenReceiverFact | undefined => {
  if (
    resolveSemanticBindingState(state, node, name) !== undefined ||
    semanticResolutionBlocked(state, node, name)
  )
    return undefined;
  return openGlobalFact(name);
};

/** Shared lexical identity and visible-write proof for direct and wrapped calls. */
export interface JavaScriptElectronIdentity {
  /** Proven export paths keyed by call/construction root offset; absence is unknown. */
  readonly bindings: ReadonlyMap<number, readonly string[]>;
  readonly intactExport: (path: readonly (string | null)[]) => boolean;
  readonly exportPath: (root: t.Node) => readonly string[] | undefined;
  readonly invocationPath: (
    node: t.CallExpression | t.OptionalCallExpression,
  ) => readonly string[] | undefined;
  readonly mayChangeAppPath: (node: t.Node) => boolean;
}

export function* indexJavaScriptElectronIdentitySteps(
  program: t.Program,
  state: JavaScriptSemanticAnalysisState,
): Generator<void, JavaScriptElectronIdentity> {
  const facts = new Map<number, readonly string[]>();
  const interop = createSemanticModuleInterop(state);
  const writes = new SemanticPropertyPathCoverage();
  let collectedWrites = false;
  const exportsByBinding = new Map<string, readonly string[] | null>();
  const rootOrigin = (root: t.Node): readonly string[] | undefined => {
    if (t.isIdentifier(root)) {
      if (semanticResolutionBlocked(state, root, root.name)) return undefined;
      const binding = resolveSemanticBindingState(state, root, root.name);
      if (binding === undefined) return undefined;
      let exported = exportsByBinding.get(binding.bindingId);
      if (exported === undefined) {
        exported = electronExport(binding, state, interop);
        exportsByBinding.set(binding.bindingId, exported);
      }
      return collectedWrites && interop.invalidated(binding)
        ? undefined
        : (exported ?? undefined);
    }
    const wrapped = interop.callOrigin(root);
    const origin =
      wrapped === undefined
        ? electronRequireOrigin(root, state)?.origin
        : collectedWrites && interop.invalidatedCall(root)
          ? undefined
          : wrapped.origin;
    return origin !== undefined && ELECTRON_MODULE.test(origin.specifier)
      ? electronExportPath(origin.importedPath)
      : undefined;
  };
  const rootExport = (root: t.Node): readonly string[] | undefined => {
    // Possible origins must still cover writes through uncertain aliases.
    // Admit positive reads separately, without caching their temporal validity.
    if (state.opaqueEffects.byScope.size > 0 && t.isIdentifier(root)) {
      const binding = resolveSemanticBindingState(state, root, root.name);
      if (
        binding !== undefined &&
        semanticOpaqueBindingReadMayHaveChanged(binding, root, state)
      )
        return undefined;
    }
    return rootOrigin(root);
  };
  yield* collectJavaScriptIdentityWritesSteps(
    program,
    state.erasedSyntaxNodes,
    (node, kind) => {
      if (kind === "opaque-call") return [interop.opaqueMutationPath(node)];
      const { root, members } = electronMemberPath(node);
      const exported = kind === "binding" ? undefined : rootOrigin(root);
      const path =
        exported === undefined
          ? (interop.intrinsicPath(root) ??
            (kind === "member"
              ? interop.boundIntrinsic(root)?.path
              : undefined))
          : ["electron", ...exported];
      return path === undefined ? [] : [[...path, ...members]];
    },
    interop.intrinsicInvocation,
    interop.staticString,
    interop.isFreshObject,
    (node, path) => {
      if (path[0] === "electron") writes.retain(path);
      else interop.retainWrite(node, path);
    },
  );
  collectedWrites = true;
  const intactExport = (path: readonly (string | null)[]): boolean =>
    ELECTRON_MODULE.test(path[0] ?? "") &&
    !writes.covers(["electron", ...path.slice(1)]);
  yield* traverseJavaScriptValueAstSteps(program, state.erasedSyntaxNodes, {
    enter: (node) => {
      if (
        !t.isCallExpression(node) &&
        !t.isOptionalCallExpression(node) &&
        !t.isNewExpression(node)
      )
        return;
      const { root, members } = electronMemberPath(node.callee);
      const exported = rootExport(root);
      if (
        exported !== undefined &&
        intactExport(["electron", ...exported, ...members])
      )
        facts.set(root.start ?? -1, exported);
    },
  });
  const invocationPath = (
    node: t.CallExpression | t.OptionalCallExpression,
  ): readonly string[] | undefined => {
    const invocation = interop.intrinsicInvocation(node, (callee) => {
      const { root, members } = electronMemberPath(callee);
      const exported = rootExport(root);
      if (
        exported !== undefined &&
        members.every((member): member is string => member !== null) &&
        intactExport(["electron", ...exported, ...members])
      )
        return ["electron", ...exported, ...members];
      return interop.intrinsicPath(callee);
    });
    return invocation?.path[0] === "electron"
      ? invocation.path.slice(1)
      : undefined;
  };
  return {
    bindings: facts,
    intactExport,
    exportPath: rootExport,
    invocationPath,
    mayChangeAppPath: createSemanticElectronAppPathChangeQuery(
      state,
      rootOrigin,
      interop,
    ),
  };
}

// Read import and require origins directly; general value evaluation is
// unnecessary here and costly across large vendor bundles.
const electronExport = (
  binding: JavaScriptSemanticBindingState,
  state: JavaScriptSemanticAnalysisState,
  interop: ReturnType<typeof createSemanticModuleInterop>,
): readonly string[] | null => {
  const reassigned = binding.definitions.some(
    ({ kind }) => kind === "assignment",
  );
  const converted = interop.origin(binding);
  if (reassigned && converted === undefined) return null;
  const directOrigin = converted?.origin ?? bindingOrigin(binding, state);
  const initializer = semanticStableInitializer(binding, state);
  if (directOrigin === undefined && initializer === undefined) return null;
  const provenance =
    directOrigin === undefined
      ? evaluateSemanticProvenance(binding, state)
      : undefined;
  const origin =
    directOrigin ??
    (provenance?.status === "module" && provenance.origins.length === 1
      ? provenance.origins[0]
      : undefined);
  return origin !== undefined && ELECTRON_MODULE.test(origin.specifier)
    ? electronExportPath(origin.importedPath)
    : null;
};

const electronRequireOrigin = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
) =>
  semanticRequireOrigin(node, state) ??
  semanticBundledRequireOrigin(node, state);

const bindingOrigin = (
  binding: JavaScriptSemanticBindingState,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptModuleOrigin | undefined => {
  if (binding.directOrigins.length > 0)
    return binding.directOrigins.length === 1
      ? binding.directOrigins[0]
      : undefined;
  const initializer = semanticStableInitializer(binding, state);
  if (initializer === undefined) return undefined;
  const origin = electronRequireOrigin(initializer.node, state)?.origin;
  const projection = initializer.projection;
  return origin === undefined ||
    !projection.every((key): key is string => typeof key === "string")
    ? undefined
    : { ...origin, importedPath: [...origin.importedPath, ...projection] };
};

const createState = (
  program: t.Program,
  staticImportResolutionMode: JavaScriptModuleResolutionMode = "import",
): JavaScriptSemanticAnalysisState => {
  const root: JavaScriptSemanticScopeState = {
    scopeId: semanticScopeId("program", program),
    parentScopeId: null,
    kind: "program",
    location: range(program),
    bindingsComplete: true,
    bindings: new Map(),
  };
  return {
    arrayIterationUnknown: false,
    program,
    opaqueEffects: {
      mayReferenceGlobalEval: false,
      sites: new WeakSet(),
      sloppySites: new WeakSet(),
      byScope: new Map(),
      children: new Map(),
      globalSites: [],
    },
    staticImportResolutionMode,
    valueResourceLimits: new Set(),
    getterResourceLimits: new Set(),
    returnedReferenceWidenings: new Set(),
    parentsByNode: new WeakMap(),
    erasedSyntaxNodes: new WeakSet(),
    scopes: [root],
    scopesById: new Map([[root.scopeId, root]]),
    scopeByNode: new WeakMap([[program, root]]),
    bindingsById: new Map(),
    bindingWrites: new Map(),
    prototypeRequireMutationObserved: false,
    prototypeEnumerationMayAffect: false,
    callables: [],
    callableNodesById: new Map(),
    moduleLinks: [],
    linkedRequireCalls: new WeakSet(),
    moduleLinkBindings: new WeakMap(),
    defaultExportExpressions: new WeakMap(),
    conditionallySkippedExpressions: new WeakSet(),
    requiredModuleEffects: new Map(),
    ambientBindingWrites: new Map(),
    ambientWrites: new SemanticPropertyPathCoverage(),
    escapingReferenceStores: new WeakSet(),
    retainedGlobalCallReceivers: new WeakSet(),
    ambientEscapes: new SemanticPropertyPathCoverage(),
    ambientEscapeEffects: [],
    ambientWriteEffects: [],
  };
};

const globalEvalRoots = new Set([
  "eval",
  "globalThis",
  "global",
  "window",
  "self",
]);

function* collectDefinitionsSteps(
  program: t.Program,
  state: JavaScriptSemanticAnalysisState,
): Generator<void, void> {
  const stack: JavaScriptSemanticScopeState[] = [
    currentSemanticScope(state.scopes),
  ];
  const openedScopes = new WeakMap<t.Node, number>();
  const assignments: {
    readonly node: t.Node;
    readonly scope: JavaScriptSemanticScopeState;
    readonly conditionallySkipped: boolean;
  }[] = [];
  const opaqueCandidates: {
    node: t.CallExpression;
    scopeId: string;
  }[] = [];
  const displacedVarInitializers: {
    node: t.VariableDeclarator;
    scope: JavaScriptSemanticScopeState;
    owner: JavaScriptSemanticScopeState;
  }[] = [];
  const thrownValues: {
    node: t.ThrowStatement;
    ancestors: readonly t.Node[];
  }[] = [];
  const legacyBlockFunctions: {
    node: t.FunctionDeclaration;
    scope: JavaScriptSemanticScopeState;
  }[] = [];
  let needsPrototypeFacts = false;
  const functionBodies: {
    readonly body: t.BlockStatement;
    readonly scope: JavaScriptSemanticScopeState;
    readonly parameters: t.Function["params"];
  }[] = [];
  yield* traverseJavaScriptAstSteps(program, {
    enter: (node, parent, readAncestors) => {
      if (parent !== null) state.parentsByNode.set(node, parent);
      if (
        (parent !== null && state.erasedSyntaxNodes.has(parent)) ||
        isErasedJavaScriptValueChild(node, parent)
      ) {
        state.erasedSyntaxNodes.add(node);
        return;
      }
      if (
        t.isWithStatement(node) ||
        t.isForInStatement(node) ||
        t.isForOfStatement(node)
      )
        needsPrototypeFacts = true;
      let parentScope = currentSemanticScope(stack);
      if (
        semanticComputedMethodKey(parent ?? undefined, node) &&
        parentScope.parentScopeId !== null
      ) {
        // A computed method key is evaluated before entering the method's
        // parameter and body environments.
        const keyScope = state.scopesById.get(parentScope.parentScopeId);
        if (keyScope !== undefined) {
          stack.push(keyScope);
          openedScopes.set(node, 1);
          parentScope = keyScope;
        }
      }
      if (
        parent !== null &&
        t.isWithStatement(parent) &&
        parent.body === node
      ) {
        const dynamicScope: JavaScriptSemanticScopeState = {
          scopeId: `${semanticScopeId("block", parent)}:with`,
          parentScopeId: parentScope.scopeId,
          kind: "block",
          location: range(parent),
          bindingsComplete: false,
          bindings: new Map(),
          dynamicWithStatement: parent,
        };
        state.scopes.push(dynamicScope);
        state.scopesById.set(dynamicScope.scopeId, dynamicScope);
        stack.push(dynamicScope);
        openedScopes.set(node, 1);
        parentScope = dynamicScope;
      }
      bindOuterDeclaration(node, parentScope, state);
      if (
        t.isFunctionDeclaration(node) &&
        node.id != null &&
        parentScope.kind === "block"
      )
        legacyBlockFunctions.push({ node, scope: parentScope });
      if (t.isVariableDeclarator(node) && node.init != null) {
        const owner = semanticVariableScope(parentScope, parent, state);
        if (owner !== parentScope)
          displacedVarInitializers.push({ node, scope: parentScope, owner });
      }
      const nested = nestedScope(node, parent, parentScope, state);
      if (nested !== undefined) {
        stack.push(nested);
        openedScopes.set(node, (openedScopes.get(node) ?? 0) + 1);
        if (t.isBlockStatement(node) && t.isFunction(parent))
          functionBodies.push({
            body: node,
            scope: nested,
            parameters: runtimeFunctionParameters(parent),
          });
      }
      const scope = currentSemanticScope(stack);
      // Other nodes inherit the nearest boundary through their AST parents.
      // Avoid a second full-tree index for the same lexical relationship.
      if (parent === null || openedScopes.has(node))
        state.scopeByNode.set(node, scope);
      collectSemanticCallable({
        node,
        parent,
        containerScope: parentScope,
        bodyScope: nested,
        state,
      });
      bindInnerDeclaration(node, parent, scope, state);
      if (t.isThrowStatement(node))
        thrownValues.push({ node, ancestors: readAncestors() });
      // Every supported global eval origin starts with one of these decoded
      // identifiers, including computed properties and destructured aliases.
      if (t.isIdentifier(node) && globalEvalRoots.has(node.name))
        state.opaqueEffects.mayReferenceGlobalEval = true;
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(unwrapJavaScriptExpression(node.callee).node, {
          name: "eval",
        })
      )
        opaqueCandidates.push({ node, scopeId: scope.scopeId });
      if (
        t.isVariableDeclarator(node) &&
        node.init != null &&
        parent !== null &&
        t.isVariableDeclaration(parent, { kind: "var" }) &&
        writeMayBeSkipped(node, readAncestors())
      )
        state.conditionallySkippedExpressions.add(node.init);
      if (
        t.isAssignmentExpression(node) ||
        t.isUpdateExpression(node) ||
        t.isForOfStatement(node) ||
        t.isForInStatement(node)
      )
        assignments.push({
          node,
          scope,
          conditionallySkipped:
            t.isForOfStatement(node) ||
            t.isForInStatement(node) ||
            writeMayBeSkipped(node, readAncestors()),
        });
    },
    exit: (node) => {
      for (let count = openedScopes.get(node) ?? 0; count > 0; count--)
        stack.pop();
    },
  });
  // A var declaration is instantiated in its variable environment, while its
  // initializer assigns through the lexical environment at the source site.
  for (const { node, scope, owner } of displacedVarInitializers) {
    for (const identifier of semanticWriteTargets(node.id)) {
      if (!t.isIdentifier(identifier)) continue;
      const selected = resolveSemanticBindingFromScope(
        scope,
        identifier.name,
        state,
      );
      const declared = owner.bindings.get(identifier.name);
      if (
        selected === undefined ||
        selected === declared ||
        declared === undefined
      )
        continue;
      // Move the facts already parsed for this slot, including destructuring
      // projections, defaults and rest copies, without reinterpreting its RHS.
      const belongsToDeclaration = (value: t.Node): boolean => {
        let candidate: t.Node | undefined = value;
        while (candidate !== undefined && candidate !== node)
          candidate = state.parentsByNode.get(candidate);
        return candidate === node;
      };
      for (let index = 0; index < declared.initializers.length; index++) {
        const initializer = declared.initializers[index];
        if (
          initializer !== undefined &&
          belongsToDeclaration(initializer.node)
        ) {
          declared.initializers.splice(index, 1);
          index--;
          selected.initializers.push(initializer);
        }
      }
      for (
        let index = 0;
        index < declared.referenceInitializers.length;
        index++
      ) {
        const initializer = declared.referenceInitializers[index];
        if (
          initializer !== undefined &&
          belongsToDeclaration(initializer.node)
        ) {
          declared.referenceInitializers.splice(index, 1);
          index--;
          selected.referenceInitializers.push({
            ...initializer,
            assignment: true,
          });
        }
      }
      addAssignment(
        identifier,
        null,
        scope,
        state,
        node.init !== null &&
          node.init !== undefined &&
          state.conditionallySkippedExpressions.has(node.init),
        node,
      );
    }
  }
  for (const { node, ancestors } of thrownValues) {
    let child: t.Node = node;
    for (let index = ancestors.length - 1; index >= 0; index--) {
      const parent = ancestors[index]!;
      if (t.isFunction(parent) || t.isClass(parent)) break;
      if (
        t.isTryStatement(parent) &&
        parent.handler != null &&
        child === parent.block
      ) {
        const scope = state.scopeByNode.get(parent.handler);
        if (scope !== undefined && parent.handler.param != null)
          bindPattern({
            pattern: parent.handler.param,
            initializer: node.argument,
            scope,
            state,
            mutable: true,
            referenceOnly: true,
            entryBody: parent.handler.body,
          });
        break;
      }
      child = parent;
    }
  }
  for (const { node, scope } of legacyBlockFunctions) {
    if (
      node.id == null ||
      semanticStrictnessAt(state.parentsByNode.get(node) ?? node, state) ===
        "strict"
    )
      continue;
    let outer =
      scope.parentScopeId === null
        ? undefined
        : state.scopesById.get(scope.parentScopeId);
    while (outer !== undefined) {
      const binding = outer.bindings.get(node.id.name);
      if (
        binding !== undefined &&
        !binding.declarationKinds.has("var") &&
        binding.kind !== "parameter"
      )
        break;
      if (
        outer.kind === "function" ||
        outer.kind === "program" ||
        outer.kind === "static-block"
      ) {
        if (binding !== undefined)
          addAssignment(node.id, node, outer, state, false, node);
        break;
      }
      outer =
        outer.parentScopeId === null
          ? undefined
          : state.scopesById.get(outer.parentScopeId);
    }
  }
  if (needsPrototypeFacts)
    yield* indexPrototypeUncertaintySteps(program, state);
  // All declarations must exist before resolving writes, including hoisted
  // functions and local declarations that shadow an outer binding.
  for (const [
    index,
    { node, scope, conditionallySkipped },
  ] of assignments.entries()) {
    if (index % 64 === 0) yield;
    bindAssignment(node, scope, state, conditionallySkipped);
  }
  for (const [index, { body, scope, parameters }] of functionBodies.entries()) {
    if (index % 64 === 0) yield;
    for (const parameter of parameters)
      for (const identifier of semanticWriteTargets(
        t.isTSParameterProperty(parameter) ? parameter.parameter : parameter,
      ))
        if (t.isIdentifier(identifier))
          copyParameterToBody({ identifier, body, scope, state });
  }
  indexSemanticOpaqueEffects(opaqueCandidates, state);
  if (state.opaqueEffects.byScope.size > 0) clearSemanticValueCaches(state);
}

type PrototypeOwner = "Object" | "Array" | "String";

const prototypeOwners = ["Object", "Array", "String"] as const;

/** Preserve uncertainty when source can change or expose a built-in prototype. */
function* indexPrototypeUncertaintySteps(
  program: t.Program,
  state: JavaScriptSemanticAnalysisState,
): Generator<void, void> {
  const taint = (owner: PrototypeOwner): void => {
    if (owner === "Object") state.prototypeRequireMutationObserved = undefined;
    state.prototypeEnumerationMayAffect = undefined;
  };
  const globalOwner = (node: t.Node): PrototypeOwner | undefined => {
    const value = unwrapJavaScriptExpression(node).node;
    for (const owner of prototypeOwners) {
      if (isUnmodifiedGlobalReference(value, state, owner)) return owner;
      if (
        t.isIdentifier(value, { name: owner }) &&
        resolveSemanticBindingState(state, value, owner) === undefined
      )
        return owner;
    }
    return undefined;
  };
  const prototypeOwner = (node: t.Node): PrototypeOwner | undefined => {
    const value = unwrapJavaScriptExpression(node).node;
    return (t.isMemberExpression(value) ||
      t.isOptionalMemberExpression(value)) &&
      semanticStaticPropertyKey(value.property, value.computed) === "prototype"
      ? globalOwner(value.object)
      : undefined;
  };
  const objectMethod = (node: t.Node): string | undefined => {
    const callee = unwrapJavaScriptExpression(node).node;
    return (t.isMemberExpression(callee) ||
      t.isOptionalMemberExpression(callee)) &&
      globalOwner(callee.object) === "Object"
      ? (semanticStaticPropertyKey(callee.property, callee.computed) ??
          undefined)
      : undefined;
  };
  const mutators = new Set([
    "defineProperty",
    "defineProperties",
    "setPrototypeOf",
  ]);
  yield* traverseJavaScriptValueAstSteps(program, state.erasedSyntaxNodes, {
    enter: (node, parent) => {
      const write = semanticWriteSiteTarget(node);
      if (write !== null) {
        for (const target of semanticWriteTargets(write)) {
          const value = unwrapJavaScriptExpression(target).node;
          if (
            t.isMemberExpression(value) ||
            t.isOptionalMemberExpression(value)
          ) {
            const owner =
              prototypeOwner(value.object) ?? globalOwner(value.object);
            if (owner !== undefined) taint(owner);
          } else {
            const owner = globalOwner(value);
            if (owner !== undefined) taint(owner);
          }
        }
      }
      if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) {
        const method = objectMethod(node.callee);
        const callee = unwrapJavaScriptExpression(node.callee).node;
        if (
          t.isMemberExpression(callee) ||
          t.isOptionalMemberExpression(callee)
        ) {
          const owner = prototypeOwner(callee.object);
          if (owner !== undefined) taint(owner);
        }
        for (const [index, argument] of node.arguments.entries()) {
          const owner = prototypeOwner(argument) ?? globalOwner(argument);
          if (owner === undefined) continue;
          // These intrinsics mutate only their first argument. Linking another
          // object's prototype to this one does not mutate this prototype.
          if (method !== undefined && mutators.has(method) && index !== 0)
            continue;
          taint(owner);
        }
      }
      const owner = prototypeOwner(node) ?? globalOwner(node);
      if (owner === undefined || parent === null) return;
      if (
        (t.isMemberExpression(parent) ||
          t.isOptionalMemberExpression(parent)) &&
        parent.object === node
      )
        return;
      if (
        (t.isCallExpression(parent) || t.isOptionalCallExpression(parent)) &&
        parent.arguments.includes(node as t.Expression)
      )
        return;
      if (
        t.isIdentifier(node) &&
        semanticReferenceRole(node, parent, state.parentsByNode.get(parent)) ===
          null
      )
        return;
      taint(owner);
    },
  });
}

const copyParameterToBody = (input: {
  readonly identifier: t.Identifier;
  readonly body: t.BlockStatement;
  readonly scope: JavaScriptSemanticScopeState;
  readonly state: JavaScriptSemanticAnalysisState;
}): void => {
  const { identifier, body, scope, state } = input;
  const binding = scope.bindings.get(identifier.name);
  if (
    binding === undefined ||
    binding.kind !== "variable" ||
    binding.definitions.some(({ kind }) => kind === "function")
  )
    return;
  // A separate body var environment starts with the parameter's value. The
  // real parameter identifier retains its scope and source location; entryBody
  // records when the copy occurs without inventing an expression in the AST.
  binding.initializers.unshift({
    node: identifier,
    projection: [],
    entryBody: body,
  });
  for (let index = binding.initializers.length - 1; index >= 0; index -= 1) {
    const initializer = binding.initializers[index];
    if (
      initializer !== undefined &&
      initializer.entryBody === undefined &&
      initializer.projection.length === 0 &&
      t.isIdentifier(initializer.node) &&
      resolveSemanticBindingState(
        state,
        initializer.node,
        initializer.node.name,
      ) === binding
    )
      // Direct self-initialization preserves the prior value, including any
      // actual overwrite before it. Keep the source definition/reference facts.
      binding.initializers.splice(index, 1);
  }
};

const writeMayBeSkipped = (
  node: t.Node,
  ancestors: readonly t.Node[],
): boolean => {
  let child = node;
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const parent = ancestors[index];
    if (
      parent === undefined ||
      t.isFunction(parent) ||
      t.isProgram(parent) ||
      t.isStaticBlock(parent)
    )
      return false;
    if (
      semanticBranchMayBeSkipped(parent, child) ||
      semanticPriorStatementMayExit(parent, child)
    )
      return true;
    child = parent;
  }
  return false;
};

const bindOuterDeclaration = (
  node: t.Node,
  scope: JavaScriptSemanticScopeState,
  state: JavaScriptSemanticAnalysisState,
): void => {
  if (t.isFunctionDeclaration(node) && t.isIdentifier(node.id))
    addBinding({
      state,
      scope,
      name: node.id.name,
      kind: "function",
      mutable: false,
      definitionNode: node.id,
      initializer: node,
    });
  else if (t.isClassDeclaration(node) && t.isIdentifier(node.id))
    addBinding({
      state,
      scope,
      name: node.id.name,
      kind: "class",
      mutable: false,
      definitionNode: node.id,
      initializer: node,
    });
};

const bindInnerDeclaration = (
  node: t.Node,
  parent: t.Node | null,
  scope: JavaScriptSemanticScopeState,
  state: JavaScriptSemanticAnalysisState,
): void => {
  if (t.isImportDeclaration(node)) bindImports(node, scope, state);
  else if (t.isTSImportEqualsDeclaration(node))
    bindImportEquals(node, scope, state);
  else if (t.isVariableDeclarator(node))
    bindPattern({
      pattern: node.id,
      initializer: node.init ?? null,
      scope: semanticVariableScope(scope, parent, state),
      state,
      mutable:
        parent !== null && t.isVariableDeclaration(parent)
          ? parent.kind !== "const"
          : true,
      ...(parent !== null && t.isVariableDeclaration(parent)
        ? { declarationKind: parent.kind }
        : {}),
    });
  else if (t.isClass(node) && t.isIdentifier(node.id))
    addBinding({
      state,
      scope,
      name: node.id.name,
      kind: "class",
      mutable: false,
      definitionNode: node.id,
      initializer: node,
    });
  else if (t.isFunction(node)) bindFunctionLocals(node, scope, state);
  else if (t.isCatchClause(node) && node.param != null)
    bindPattern({
      pattern: node.param,
      initializer: null,
      scope,
      state,
      mutable: true,
      kind: "catch",
    });
};

const bindImportEquals = (
  node: t.TSImportEqualsDeclaration,
  scope: JavaScriptSemanticScopeState,
  state: JavaScriptSemanticAnalysisState,
): void => {
  const specifier = semanticImportEqualsSpecifier(node);
  if (specifier === null) return;
  addBinding({
    state,
    scope,
    name: node.id.name,
    kind: "import",
    mutable: false,
    definitionNode: node.id,
    initializer: null,
    directOrigin: { specifier, importedPath: [], resolutionMode: "require" },
  });
};

// A parameter or catch binding starts with a caller-supplied value that a
// conditional logical assignment can retain, so its RHS is not exact.
const hasIncomingValue = (
  identifier: t.Identifier,
  scope: JavaScriptSemanticScopeState,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  const kind = resolveSemanticBindingFromScope(
    scope,
    identifier.name,
    state,
  )?.kind;
  return kind === "parameter" || kind === "catch";
};

const bindAssignment = (
  node: t.Node,
  scope: JavaScriptSemanticScopeState,
  state: JavaScriptSemanticAnalysisState,
  conditionallySkipped: boolean,
): void => {
  if (t.isAssignmentExpression(node)) {
    const left = unwrapJavaScriptExpression(node.left).node;
    bindMappedArgumentWrite(left, node, state, conditionallySkipped);
    const selectedPattern =
      node.operator === "=" &&
      (t.isObjectPattern(left) || t.isArrayPattern(left));
    if (t.isIdentifier(left))
      addAssignment(
        left,
        node.operator === "=" ||
          ((node.operator === "||=" || node.operator === "??=") &&
            !hasIncomingValue(left, scope, state))
          ? node.right
          : node,
        scope,
        state,
        conditionallySkipped,
        node,
      );
    else {
      for (const identifier of semanticWriteTargets(node.left))
        if (t.isIdentifier(identifier))
          addAssignment(
            identifier,
            selectedPattern ? null : node,
            scope,
            state,
            conditionallySkipped,
            node,
          );
      if (selectedPattern)
        bindPattern({
          pattern: left,
          initializer: node.right,
          scope,
          state,
          mutable: true,
          referenceOnly: true,
          assignmentReference: true,
        });
    }
  } else if (t.isUpdateExpression(node)) {
    const argument = unwrapJavaScriptExpression(node.argument).node;
    bindMappedArgumentWrite(argument, node, state, conditionallySkipped);
    if (t.isIdentifier(argument))
      addAssignment(argument, node, scope, state, conditionallySkipped);
  } else if (t.isForOfStatement(node) || t.isForInStatement(node)) {
    if (
      semanticIterationCardinality(
        node,
        state.prototypeEnumerationMayAffect,
      ) === "empty"
    )
      return;
    for (const pattern of t.isVariableDeclaration(node.left)
      ? node.left.declarations.map(({ id }) => id)
      : [node.left]) {
      for (const identifier of semanticWriteTargets(pattern))
        if (t.isIdentifier(identifier))
          addAssignment(
            identifier,
            node,
            scope,
            state,
            conditionallySkipped,
            node,
          );
      if (t.isForOfStatement(node))
        // Keep the loop value unknown, but preserve references yielded into
        // each bound slot so writes/escapes can reach their iterable origins.
        bindPattern({
          pattern,
          initializer: node,
          scope,
          state,
          mutable: true,
          referenceOnly: true,
        });
    }
  }
};

type MappedArgumentsOwner = {
  readonly scope: JavaScriptSemanticScopeState;
  readonly parameters: ReadonlyMap<number, t.Identifier>;
  readonly strictness: "sloppy" | "strict" | "unknown";
};

/** Find an implicit arguments object through stable local aliases. */
const mappedArgumentsOwner = (
  expression: t.Node,
  state: JavaScriptSemanticAnalysisState,
  seen: Set<string> = new Set(),
): MappedArgumentsOwner | undefined => {
  let value = unwrapJavaScriptExpression(expression).node;
  while (t.isIdentifier(value) && value.name !== "arguments") {
    const binding = resolveSemanticBindingState(state, value, value.name);
    if (binding === undefined || seen.has(binding.bindingId)) return undefined;
    seen.add(binding.bindingId);
    const initializer = semanticStableInitializer(binding, state);
    if (initializer === undefined) return undefined;
    value = unwrapJavaScriptExpression(initializer.node).node;
  }
  if (!t.isIdentifier(value)) return undefined;

  const lookup = semanticBindingLookupAt(state, value, "arguments");
  if (lookup.kind !== "implicit-arguments" && lookup.kind !== "ambient")
    return undefined;
  let owner: t.Function | undefined;
  for (
    let current: t.Node | undefined = value;
    current !== undefined;
    current = state.parentsByNode.get(current)
  ) {
    if (t.isFunction(current) && !t.isArrowFunctionExpression(current)) {
      owner = current;
      break;
    }
  }
  if (owner === undefined) return undefined;
  const scope = state.scopeByNode.get(owner);
  if (scope === undefined) return undefined;

  const parameters = runtimeFunctionParameters(owner);
  if (
    parameters.some((parameter) => {
      const node = t.isTSParameterProperty(parameter)
        ? parameter.parameter
        : parameter;
      return !t.isIdentifier(node);
    })
  )
    return undefined;

  // Duplicate formals map only their last occurrence to the shared binding.
  const mapped = new Map<number, t.Identifier>();
  const names = new Set<string>();
  for (let index = parameters.length - 1; index >= 0; index -= 1) {
    const parameter = parameters[index];
    if (parameter === undefined) continue;
    const node = t.isTSParameterProperty(parameter)
      ? parameter.parameter
      : parameter;
    if (!t.isIdentifier(node) || names.has(node.name)) continue;
    names.add(node.name);
    mapped.set(index, node);
  }
  if (mapped.size === 0) return undefined;

  return {
    scope,
    parameters: mapped,
    strictness: semanticStrictnessAt(owner, state),
  };
};

const semanticStrictnessAt = (
  owner: t.Node,
  state: JavaScriptSemanticAnalysisState,
): MappedArgumentsOwner["strictness"] => {
  for (
    let current: t.Node | undefined = owner;
    current !== undefined;
    current = state.parentsByNode.get(current)
  ) {
    if (t.isClass(current)) return "strict";
    if (
      t.isFunction(current) &&
      t.isBlockStatement(current.body) &&
      current.body.directives.some(({ value }) => value.value === "use strict")
    )
      return "strict";
    if (t.isProgram(current)) return javaScriptProgramStrictness(current);
  }
  return "unknown";
};

/** A mapped arguments property write is another write to its formal binding. */
const bindMappedArgumentWrite = (
  target: t.Node,
  writeSite: t.Node,
  state: JavaScriptSemanticAnalysisState,
  conditionallySkipped: boolean,
): void => {
  for (const writeTarget of semanticWriteTargets(target)) {
    if (
      !t.isMemberExpression(writeTarget) &&
      !t.isOptionalMemberExpression(writeTarget)
    )
      continue;
    const root = semanticReferenceRoot(writeTarget);
    if (root.path.length !== 1) continue;
    const owner = mappedArgumentsOwner(root.root, state);
    if (owner === undefined || owner.strictness === "strict") continue;
    const key = root.path[0];
    const index =
      typeof key === "number"
        ? key
        : typeof key === "string" && /^(?:0|[1-9][0-9]*)$/u.test(key)
          ? Number(key)
          : undefined;
    const parameters =
      key === null
        ? [...owner.parameters.values()]
        : index !== undefined && owner.parameters.has(index)
          ? [owner.parameters.get(index)!]
          : [];
    for (const parameter of parameters) {
      addAssignment(
        parameter,
        writeTarget,
        owner.scope,
        state,
        conditionallySkipped,
        writeSite,
      );
    }
  }
};

const nestedScope = (
  node: t.Node,
  parent: t.Node | null,
  parentScope: JavaScriptSemanticScopeState,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptSemanticScopeState | undefined => {
  const switchOwner =
    t.isSwitchCase(node) && parent !== null && t.isSwitchStatement(parent)
      ? parent
      : undefined;
  if (switchOwner !== undefined) {
    const existing = state.scopesById.get(
      semanticScopeId("block", switchOwner),
    );
    if (existing !== undefined) return existing;
  }
  const kind = scopeKind(node, parent);
  if (kind === undefined) return undefined;
  const scope: JavaScriptSemanticScopeState = {
    scopeId: semanticScopeId(kind, switchOwner ?? node),
    parentScopeId:
      functionNameScope(node, parentScope, state)?.scopeId ??
      parentScope.scopeId,
    kind,
    location: range(switchOwner ?? node),
    bindingsComplete: true,
    bindings: new Map(),
    ...(t.isFunction(node) && !t.isArrowFunctionExpression(node)
      ? { implicitArguments: true as const }
      : {}),
  };
  state.scopes.push(scope);
  state.scopesById.set(scope.scopeId, scope);
  return scope;
};

const functionNameScope = (
  node: t.Node,
  parentScope: JavaScriptSemanticScopeState,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptSemanticScopeState | undefined => {
  if (!t.isFunctionExpression(node) || !t.isIdentifier(node.id))
    return undefined;
  // A named expression has a private name environment outside its parameters
  // and body. Parameters and local declarations may shadow that name.
  const scope: JavaScriptSemanticScopeState = {
    scopeId: `${semanticScopeId("block", node)}:function-name`,
    parentScopeId: parentScope.scopeId,
    kind: "block",
    location: range(node),
    bindingsComplete: true,
    bindings: new Map(),
  };
  state.scopes.push(scope);
  state.scopesById.set(scope.scopeId, scope);
  addBinding({
    state,
    scope,
    name: node.id.name,
    kind: "function",
    mutable: false,
    definitionNode: node.id,
    initializer: node,
  });
  return scope;
};

const scopeKind = (
  node: t.Node,
  parent: t.Node | null,
): JavaScriptSemanticScopeState["kind"] | undefined => {
  if (t.isFunction(node)) return "function";
  if (t.isClass(node)) return "class";
  if (t.isCatchClause(node)) return "catch";
  if (
    t.isForStatement(node) ||
    t.isForOfStatement(node) ||
    t.isForInStatement(node)
  )
    return "block";
  // A switch body is one lexical scope shared by all its cases, so `let` in
  // two cases must resolve to one binding rather than collide or leak.
  if (t.isSwitchCase(node)) return "block";
  // Each `static {}` block is its own lexical scope; otherwise a `let` in two
  // static blocks would collide in the enclosing class scope.
  if (t.isStaticBlock(node)) return "static-block";
  if (
    t.isBlockStatement(node) &&
    parent !== null &&
    t.isFunction(parent) &&
    parent.body === node
  ) {
    // Parameter expressions cannot see declarations in the function body.
    // Retain the outer function scope for parameters and callable ownership;
    // body declarations belong to a separate variable environment.
    return functionParametersHaveExpressions(parent) ? "function" : undefined;
  }
  if (t.isBlockStatement(node)) return "block";
  return undefined;
};

const functionParametersHaveExpressions = (node: t.Function): boolean => {
  const pending: t.Node[] = [...runtimeFunctionParameters(node)];
  while (pending.length > 0) {
    const parameter = pending.pop();
    if (t.isAssignmentPattern(parameter)) return true;
    if (t.isTSParameterProperty(parameter)) pending.push(parameter.parameter);
    else if (t.isRestElement(parameter)) pending.push(parameter.argument);
    else if (t.isArrayPattern(parameter)) {
      for (const element of parameter.elements)
        if (element !== null) pending.push(element);
    } else if (t.isObjectPattern(parameter)) {
      for (const property of parameter.properties) {
        if (t.isRestElement(property)) pending.push(property.argument);
        else {
          if (property.computed) return true;
          pending.push(property.value);
        }
      }
    }
  }
  return false;
};

const bindImports = (
  node: t.ImportDeclaration,
  scope: JavaScriptSemanticScopeState,
  state: JavaScriptSemanticAnalysisState,
): void => {
  if (isTypeOnlyImportDeclaration(node)) return;
  for (const specifier of node.specifiers) {
    if (t.isImportSpecifier(specifier) && isTypeOnlyImportSpecifier(specifier))
      continue;
    const importedPath = t.isImportDefaultSpecifier(specifier)
      ? ["default"]
      : t.isImportNamespaceSpecifier(specifier)
        ? []
        : [semanticStaticPropertyKey(specifier.imported, false) ?? "[dynamic]"];
    addBinding({
      state,
      scope,
      name: specifier.local.name,
      kind: "import",
      mutable: false,
      definitionNode: specifier.local,
      initializer: null,
      directOrigin: { specifier: node.source.value, importedPath },
      runtimeImport: true,
    });
  }
};

const bindFunctionLocals = (
  node: t.Function,
  scope: JavaScriptSemanticScopeState,
  state: JavaScriptSemanticAnalysisState,
): void => {
  for (const parameter of runtimeFunctionParameters(node))
    bindPattern({
      pattern: t.isTSParameterProperty(parameter)
        ? parameter.parameter
        : parameter,
      initializer: null,
      scope,
      state,
      mutable: true,
      kind: "parameter",
    });
};

const bindPattern = (input: BindPatternInput): void => {
  const {
    pattern,
    initializer,
    scope,
    state,
    mutable,
    declarationKind,
    kind = "variable",
    projection = [],
    referenceOnly = false,
    assignmentReference,
    copyKind,
    copyProjectionOffset,
    copyExcludedKeys,
    copyStartIndex,
    fallbackSources,
    requiredSources,
    iterationSources,
  } = input;
  if (t.isTSParameterProperty(pattern)) {
    bindPattern({ ...input, pattern: pattern.parameter });
    return;
  }
  if (t.isIdentifier(pattern)) {
    if (referenceOnly) {
      const binding = resolveSemanticBindingFromScope(
        scope,
        pattern.name,
        state,
      );
      if (binding !== undefined && initializer !== null)
        binding.referenceInitializers.push({
          node: initializer,
          projection,
          ...(input.entryBody === undefined
            ? {}
            : { entryBody: input.entryBody }),
          ...(assignmentReference === undefined ? {} : { assignment: true }),
          ...(copyKind === undefined ? {} : { copyKind }),
          ...(copyProjectionOffset === undefined
            ? {}
            : { copyProjectionOffset }),
          ...(copyExcludedKeys === undefined ? {} : { copyExcludedKeys }),
          ...(copyStartIndex === undefined ? {} : { copyStartIndex }),
          ...(fallbackSources === undefined ? {} : { fallbackSources }),
          ...(requiredSources === undefined ? {} : { requiredSources }),
          ...(iterationSources === undefined ? {} : { iterationSources }),
        });
      return;
    }
    addBinding({
      state,
      scope,
      name: pattern.name,
      kind,
      mutable,
      ...(declarationKind === undefined ? {} : { declarationKind }),
      definitionNode: pattern,
      initializer,
      projection,
      ...(iterationSources === undefined ? {} : { iterationSources }),
    });
    return;
  }
  if (t.isAssignmentPattern(pattern)) {
    bindPattern({
      ...input,
      pattern: pattern.left,
      initializer:
        kind === "parameter" || kind === "catch"
          ? initializer
          : (initializer ?? pattern.right),
      requiredSources: [
        ...(requiredSources ?? []),
        ...(initializer === null
          ? []
          : [
              {
                node: initializer,
                projection,
                ...(iterationSources === undefined ? {} : { iterationSources }),
              },
            ]),
      ],
    });
    bindPattern({
      state,
      scope,
      mutable,
      kind,
      pattern: pattern.left,
      initializer: pattern.right,
      projection: [],
      referenceOnly: true,
      ...(assignmentReference === undefined ? {} : { assignmentReference }),
      fallbackSources: [
        ...(fallbackSources ?? []),
        ...(initializer === null
          ? []
          : [
              {
                node: initializer,
                projection,
                ...(iterationSources === undefined ? {} : { iterationSources }),
              },
            ]),
      ],
      ...(requiredSources === undefined ? {} : { requiredSources }),
    });
    return;
  }
  if (t.isRestElement(pattern)) {
    bindPattern({
      ...input,
      pattern: pattern.argument,
      initializer: null,
      mutable: true,
    });
    return;
  }
  if (t.isObjectPattern(pattern))
    for (const property of pattern.properties) {
      if (t.isRestElement(property)) {
        bindPattern({
          ...input,
          pattern: property.argument,
          initializer: null,
          mutable: true,
          projection: [],
        });
        bindPattern({
          ...input,
          pattern: property.argument,
          projection: [...projection, null],
          referenceOnly: true,
          copyKind: "object-rest",
          copyProjectionOffset: projection.length,
          copyExcludedKeys: semanticObjectPatternKeys(pattern),
        });
      } else {
        const name = semanticStaticPropertyKey(property.key, property.computed);
        bindPattern({
          ...input,
          pattern: property.value,
          projection: [...projection, name],
        });
      }
    }
  else if (t.isArrayPattern(pattern)) {
    const arrayInput = {
      ...input,
      ...(initializer === null
        ? {}
        : {
            iterationSources: [
              ...(iterationSources ?? []),
              { node: initializer, projection },
            ],
          }),
    };
    pattern.elements.forEach((element, index) => {
      if (element !== null) {
        bindPattern({
          ...arrayInput,
          pattern: element,
          projection: [...projection, index],
        });
        if (t.isRestElement(element))
          bindPattern({
            ...arrayInput,
            pattern: element.argument,
            projection: [...projection, null],
            referenceOnly: true,
            copyKind: "array-rest",
            copyProjectionOffset: projection.length,
            copyStartIndex: index,
          });
      }
    });
  }
};

const addBinding = (input: AddBindingInput): void => {
  const {
    state,
    scope,
    name,
    kind,
    mutable,
    declarationKind,
    definitionNode,
    initializer,
    directOrigin,
    runtimeImport,
    projection = [],
    iterationSources,
  } = input;
  let binding = scope.bindings.get(name);
  if (binding === undefined) {
    if (!scope.bindingsComplete) return;
    binding = createBinding(scope, name, kind, mutable);
    scope.bindings.set(name, binding);
    state.bindingsById.set(binding.bindingId, binding);
  }
  binding.mutable ||= mutable;
  if (declarationKind !== undefined)
    binding.declarationKinds.add(declarationKind);
  binding.definitions.push({ kind, location: range(definitionNode) });
  if (initializer !== null)
    binding.initializers.push({
      node: initializer,
      projection,
      ...(iterationSources === undefined ? {} : { iterationSources }),
    });
  if (directOrigin !== undefined)
    binding.directOrigins.push(
      directOrigin.resolutionMode === undefined &&
        state.staticImportResolutionMode !== "import"
        ? {
            ...directOrigin,
            resolutionMode: state.staticImportResolutionMode,
          }
        : directOrigin,
    );
  binding.runtimeImport ||= runtimeImport === true;
};

const createBinding = (
  scope: JavaScriptSemanticScopeState,
  name: string,
  kind: JavaScriptSemanticDefinition["kind"],
  mutable: boolean,
): JavaScriptSemanticBindingState => ({
  bindingId: semanticBindingId(scope.scopeId, name),
  scopeId: scope.scopeId,
  name,
  kind,
  mutable,
  declarationKinds: new Set(),
  memberWrites: [],
  escapedPaths: [],
  definitions: [],
  initializers: [],
  referenceInitializers: [],
  directOrigins: [],
  runtimeImport: false,
});

const addAssignment = (
  identifier: t.Identifier,
  initializer: t.Node | null,
  scope: JavaScriptSemanticScopeState,
  state: JavaScriptSemanticAnalysisState,
  conditionallySkipped: boolean,
  writeSite?: t.Node,
): void => {
  const mutation = writeSite ?? initializer;
  if (mutation === null) return;
  const lookup = semanticBindingLookupFromScope(scope, identifier.name, state);
  if (lookup.kind === "captured" || lookup.kind === "implicit-arguments")
    return;
  const binding = "binding" in lookup ? lookup.binding : undefined;
  conditionallySkipped ||=
    lookup.kind !== "binding" && lookup.kind !== "ambient";
  if (binding === undefined) {
    // Unbound identifiers can denote host wrapper bindings (such as require),
    // which are separate from properties written through the global object.
    const writes = state.ambientBindingWrites.get(identifier.name) ?? [];
    writes.push(mutation);
    state.ambientBindingWrites.set(identifier.name, writes);
    return;
  }
  const writes = state.bindingWrites.get(binding.bindingId) ?? [];
  writes.push(mutation);
  state.bindingWrites.set(binding.bindingId, writes);
  binding.mutable = true;
  binding.definitions.push({ kind: "assignment", location: range(identifier) });
  if (initializer !== null)
    binding.initializers.push({ node: initializer, projection: [] });
  if (conditionallySkipped)
    state.conditionallySkippedExpressions.add(initializer ?? mutation);
};
