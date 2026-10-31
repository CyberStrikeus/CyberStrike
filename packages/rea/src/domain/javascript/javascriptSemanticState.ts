import * as t from "@babel/types";
import {
  semanticStaticPropertyKey,
  staticJavaScriptTruthiness,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import type { SemanticIterationSource } from "./javascriptSemanticIterationFacts.js";

import type {
  JavaScriptSemanticPropertyPath,
  SemanticPropertyPathCoverage,
} from "./javascriptSemanticPropertyPaths.js";

import type {
  JavaScriptModuleOrigin,
  JavaScriptSemanticDefinition,
  JavaScriptSemanticModuleLink,
  JavaScriptSemanticCallable,
  JavaScriptSemanticScope,
  JavaScriptSemanticReference,
} from "./javascriptSemanticIr.js";
import type { JavaScriptModuleResolutionMode } from "./javascriptModuleResolutionMode.js";
import type {
  JavaScriptSemanticResourceLimit,
  JavaScriptSemanticValue,
} from "./javascriptSemanticValueTypes.js";

/** Internal initializer plus a destructuring/member projection. */
export interface JavaScriptSemanticInitializer {
  readonly node: t.Node;
  readonly projection: readonly (string | number | null)[];
  readonly entryBody?: t.BlockStatement;
  readonly iterationSources?: readonly {
    readonly node: t.Node;
    readonly projection: JavaScriptSemanticPropertyPath;
  }[];
}

/** Additional references from destructuring copies and possible defaults. */
interface JavaScriptSemanticReferenceInitializer extends JavaScriptSemanticInitializer {
  /** This source is a value replacement, rather than a declaration fallback. */
  readonly assignment?: true;
  readonly copyKind?: "object-rest" | "array-rest";
  readonly copyProjectionOffset?: number;
  readonly copyExcludedKeys?: readonly string[];
  readonly copyStartIndex?: number;
  readonly fallbackSources?: readonly JavaScriptSemanticInitializer[];
  readonly requiredSources?: readonly JavaScriptSemanticInitializer[];
}

/** Mutable binding state used only while constructing the immutable IR. */
export interface JavaScriptSemanticMemberEffect {
  readonly path: JavaScriptSemanticPropertyPath;
  readonly node: t.Node | undefined;
  /** Selected RHS values retained by the shared pattern-store owner. */
  readonly assignedSources?: readonly SemanticIterationSource[];
  /** Binding values whose receiver identities were selected for this effect. */
  readonly receiverInitializers?: readonly JavaScriptSemanticInitializer[];
  /** Proof that the write selects this captured receiver, not just a possible alias. */
  readonly receiverIdentity?: "definite" | "possible";
  /** Capture of this binding used while following an aliased effect receiver. */
  readonly receiverAt?: t.Node;
}

export type JavaScriptSemanticEffectTiming = "before" | "after" | "unknown";

export interface JavaScriptSemanticReferenceEffect {
  readonly kind: "binding-write" | "member-write" | "escape" | "ambient-write";
  readonly path?: JavaScriptSemanticPropertyPath;
  readonly timing: JavaScriptSemanticEffectTiming;
}

/** Source-ordered effects relevant to one binding or projected member use. */
export interface JavaScriptSemanticReferenceEffectsAtSite {
  readonly bindingId: string | null;
  readonly resolution: JavaScriptSemanticReference["resolution"];
  /** Whether alias-aware member and escape effects were collected for this source. */
  readonly memberEffectsIndexed: boolean;
  readonly effects: readonly JavaScriptSemanticReferenceEffect[];
}

export interface JavaScriptSemanticRequiredModuleEffect extends JavaScriptSemanticMemberEffect {
  readonly kind: "write" | "escape";
}

export interface JavaScriptSemanticBindingState {
  readonly hostOrigin?: "commonjs-wrapper";
  readonly bindingId: string;
  readonly scopeId: string;
  readonly name: string;
  kind: JavaScriptSemanticDefinition["kind"];
  /** Source declaration form retained internally for CommonJS wrapper bindings. */
  declarationKinds: Set<"var" | "let" | "const" | "using" | "await using">;
  mutable: boolean;
  readonly memberWrites: JavaScriptSemanticMemberEffect[];
  readonly escapedPaths: JavaScriptSemanticMemberEffect[];
  readonly definitions: JavaScriptSemanticDefinition[];
  readonly initializers: JavaScriptSemanticInitializer[];
  readonly referenceInitializers: JavaScriptSemanticReferenceInitializer[];
  readonly directOrigins: JavaScriptModuleOrigin[];
  /** An ECMAScript import that exists at runtime, excluding type-only and import-equals syntax. */
  runtimeImport: boolean;
}

/** Mutable lexical-scope state used only during AST recovery. */
export interface JavaScriptSemanticScopeState {
  readonly scopeId: string;
  readonly parentScopeId: string | null;
  readonly kind: JavaScriptSemanticScope["kind"];
  readonly location: JavaScriptSemanticScope["location"];
  bindingsComplete: boolean;
  readonly bindings: Map<string, JavaScriptSemanticBindingState>;
  /** Object environment introduced by `with`, active only for its body. */
  readonly dynamicWithStatement?: t.WithStatement;
  /** Ordinary functions own `arguments`; arrow functions inherit it. */
  readonly implicitArguments?: true;
}

/** One source owns sites and the minimal scope tree reaching them; O(AST) storage. */
export interface JavaScriptOpaqueScopeEffects {
  /** Cheap source evidence collected with declarations, before alias queries. */
  mayReferenceGlobalEval: boolean;
  readonly sites: WeakSet<t.Node>;
  readonly sloppySites: WeakSet<t.Node>;
  readonly byScope: Map<string, t.CallExpression[]>;
  readonly children: Map<string, Set<string>>;
  readonly globalSites: (t.CallExpression | t.OptionalCallExpression)[];
}

/** Shared state for semantic collection and evaluation. */
export interface JavaScriptSemanticAnalysisState {
  arrayIterationUnknown: boolean;
  readonly program: t.Program;
  readonly opaqueEffects: JavaScriptOpaqueScopeEffects;
  /** Effective loader for static imports in this source artifact. */
  readonly staticImportResolutionMode: JavaScriptModuleResolutionMode;
  /** Bounds encountered during this analysis, independent of later projections. */
  readonly valueResourceLimits: Set<JavaScriptSemanticResourceLimit>;
  /** Getter query bounds encountered while resolving object and class properties. */
  readonly getterResourceLimits: Set<JavaScriptSemanticResourceLimit>;
  /** Callee sites whose possible local returns needed a broader projection. */
  readonly returnedReferenceWidenings: Set<t.Node>;
  readonly parentsByNode: WeakMap<t.Node, t.Node>;
  /** TypeScript syntax omitted from JavaScript value evaluation. */
  readonly erasedSyntaxNodes: WeakSet<t.Node>;
  readonly scopes: JavaScriptSemanticScopeState[];
  readonly scopesById: Map<string, JavaScriptSemanticScopeState>;
  /** Scope boundaries and descendant scopes resolved on demand. */
  readonly scopeByNode: WeakMap<t.Node, JavaScriptSemanticScopeState>;
  readonly bindingsById: Map<string, JavaScriptSemanticBindingState>;
  /** Resolved identifier writes retained at their exact source sites. */
  readonly bindingWrites: Map<string, t.Node[]>;
  /** Source evidence that Object.prototype may supply a `require` property. */
  prototypeRequireMutationObserved: boolean | undefined;
  /** Source evidence that Object.prototype may add inherited enumerable keys. */
  prototypeEnumerationMayAffect: boolean | undefined;
  /** Effects on a cached require exports object, independent of local projections. */
  readonly requiredModuleEffects: Map<
    string,
    JavaScriptSemanticRequiredModuleEffect[]
  >;
  readonly callables: JavaScriptSemanticCallable[];
  readonly callableNodesById: Map<string, t.Node>;
  readonly moduleLinks: JavaScriptSemanticModuleLink[];
  /** Exact calls already represented by binding or dependency links. */
  readonly linkedRequireCalls: WeakSet<t.CallExpression>;
  readonly moduleLinkBindings: WeakMap<
    JavaScriptSemanticModuleLink,
    JavaScriptSemanticBindingState
  >;
  /** Default expressions capture their value at the export statement. */
  readonly defaultExportExpressions: WeakMap<
    JavaScriptSemanticModuleLink,
    t.Node
  >;
  /** Initializer expressions whose write can be skipped by enclosing control flow. */
  readonly conditionallySkippedExpressions: WeakSet<t.Node>;
  /** Unbound identifier writes retain their source sites for capture ordering. */
  readonly ambientBindingWrites: Map<string, t.Node[]>;
  /** Source-local writes, tagged by global, import.meta or CJS module identity. */
  readonly ambientWrites: SemanticPropertyPathCoverage;
  /** Browser receivers proven to be only the ambient global identity. */
  readonly retainedGlobalCallReceivers: WeakSet<t.Node>;
  /** Store targets whose ownership is unknown or ambient, as classified by ambient indexing. */
  readonly escapingReferenceStores: WeakSet<t.MemberExpression>;
  /** Ambient object identities passed to calls whose effects are not evaluated. */
  readonly ambientEscapes: SemanticPropertyPathCoverage;
  /** Capture sites keep later opaque effects from changing earlier copies. */
  readonly ambientEscapeEffects: JavaScriptSemanticMemberEffect[];
  /** Source sites distinguish replacement before an ambient identity capture from later writes. */
  readonly ambientWriteEffects: JavaScriptSemanticMemberEffect[];
}

/** Record one producer outcome without traversing or retaining its value graph. */
export const recordSemanticValueLimit = (
  state: JavaScriptSemanticAnalysisState,
  value: JavaScriptSemanticValue,
): void => {
  if (value.status === "unknown" && value.resourceLimit !== undefined)
    state.valueResourceLimits.add(value.resourceLimit);
};

/** One parsed source owns its optional indexes and their per-source lifetime. */
export interface JavaScriptBindingIndex {
  readonly sourceType: t.Program["sourceType"];
  readonly bindings: JavaScriptSemanticAnalysisState;
  indexAmbientWritesSteps(): Generator<void, void>;
  indexMemberMutationFactsSteps(): Generator<void, void>;
  /** Resolve certain lexical ownership without collecting mutation reports. */
  bindingForReferenceAt(
    referenceNode: t.Node,
  ): JavaScriptSemanticBindingState | undefined;
  effectsForReferenceAt(
    site: t.Node,
    referenceNode: t.Node,
    propertyPath?: JavaScriptSemanticPropertyPath,
  ): JavaScriptSemanticReferenceEffectsAtSite;
  /** Order declarations within one activation; deferred and repeating effects stay unknown. */
  effectsForReferenceWithinActivationAt(
    site: t.Node,
    referenceNode: t.Node,
    propertyPath?: JavaScriptSemanticPropertyPath,
  ): JavaScriptSemanticReferenceEffectsAtSite;
  /** Stop at the first relevant prior/uncertain effect without retaining a report. */
  referenceMayHaveChangedAt(
    site: t.Node,
    referenceNode: t.Node,
    propertyPath?: JavaScriptSemanticPropertyPath,
  ): boolean;
  referencesSteps(): Generator<void, readonly JavaScriptSemanticReference[]>;
}

/**
 * Return one unconditional source initializer for a declared lexical binding.
 * Repeated variable declarations without another initializer do not write it.
 * This establishes a stable source fact only; it does not prove immutability or
 * that the declaration has executed at a particular program point.
 */
export const semanticStableInitializer = (
  binding: JavaScriptSemanticBindingState | undefined,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptSemanticBindingState["initializers"][number] | undefined => {
  const [initializer] = binding?.initializers ?? [];
  const [definition] = binding?.definitions ?? [];
  return binding !== undefined &&
    ((definition?.kind === "variable" &&
      binding.definitions.every(({ kind }) => kind === "variable")) ||
      (binding.definitions.length === 1 &&
        (definition?.kind === "function" || definition?.kind === "class"))) &&
    binding.initializers.length === 1 &&
    initializer !== undefined &&
    !state.conditionallySkippedExpressions.has(initializer.node)
    ? initializer
    : undefined;
};

/** Return the active scope from a non-empty construction stack. */
export const currentSemanticScope = (
  stack: readonly JavaScriptSemanticScopeState[],
): JavaScriptSemanticScopeState => {
  const scope = stack.at(-1);
  if (scope === undefined) throw new TypeError("Missing semantic scope");
  return scope;
};

/** Create a stable source-position identity for one lexical scope. */
export const semanticScopeId = (
  kind: JavaScriptSemanticScope["kind"],
  node: t.Node,
): string =>
  `scope:${kind}:${String(node.start ?? -1)}:${String(node.end ?? -1)}`;

/** Create the canonical identity used by one binding in a lexical scope. */
export const semanticBindingId = (scopeId: string, name: string): string =>
  `${scopeId}:binding:${encodeURIComponent(name)}`;

/** Resolve one lexical name from the scope containing a node. */
export const resolveSemanticBindingState = (
  state: JavaScriptSemanticAnalysisState,
  node: t.Node,
  name: string,
): JavaScriptSemanticBindingState | undefined => {
  const lookup = semanticBindingLookupAt(state, node, name);
  return lookup.kind === "binding" ? lookup.binding : undefined;
};

/** Report whether an omitted or dynamic binding blocks a trustworthy miss. */
export const semanticResolutionBlocked = (
  state: JavaScriptSemanticAnalysisState,
  node: t.Node,
  name: string,
): boolean => {
  const lookup = semanticBindingLookupAt(state, node, name);
  return lookup.kind !== "binding" && lookup.kind !== "ambient";
};

const semanticScopeForNode = (
  state: JavaScriptSemanticAnalysisState,
  node: t.Node,
): JavaScriptSemanticScopeState | undefined => {
  let candidate: t.Node | undefined = node;
  while (candidate !== undefined) {
    const scope = state.scopeByNode.get(candidate);
    if (scope !== undefined) {
      // Repeated references in a deep expression share this ancestry. Cache
      // the traversed path without eagerly indexing nodes never resolved.
      let descendant: t.Node | undefined = node;
      while (descendant !== undefined && descendant !== candidate) {
        state.scopeByNode.set(descendant, scope);
        descendant = state.parentsByNode.get(descendant);
      }
      return scope;
    }
    candidate = state.parentsByNode.get(candidate);
  }
  return undefined;
};

type SemanticBindingLookup =
  | {
      readonly kind: "binding" | "uncertain-binding";
      readonly binding: JavaScriptSemanticBindingState;
    }
  | {
      readonly kind:
        | "ambient"
        | "uncertain-ambient"
        | "captured"
        | "unknown"
        | "implicit-arguments";
    };

/** Retain both a dynamic lookup's uncertainty and its possible outer write owner. */
export const semanticBindingLookupFromScope = (
  scope: JavaScriptSemanticScopeState | undefined,
  name: string,
  state: JavaScriptSemanticAnalysisState,
): SemanticBindingLookup => {
  let uncertain = false;
  while (scope !== undefined) {
    const binding = scope.bindings.get(name);
    if (binding !== undefined)
      return { kind: uncertain ? "uncertain-binding" : "binding", binding };
    if (name === "arguments" && scope.implicitArguments === true)
      return { kind: "implicit-arguments" };
    if (!scope.bindingsComplete) {
      if (scope.dynamicWithStatement === undefined) return { kind: "unknown" };
      const lookup = semanticWithRequireLookup(
        state,
        scope.dynamicWithStatement,
        name,
      );
      if (lookup === "captures") return { kind: "captured" };
      if (lookup === "unknown") uncertain = true;
    }
    scope =
      scope.parentScopeId === null
        ? undefined
        : state.scopesById.get(scope.parentScopeId);
  }
  return { kind: uncertain ? "uncertain-ambient" : "ambient" };
};

/** Return certain and possible binding ownership without discarding uncertainty. */
export const semanticBindingLookupAt = (
  state: JavaScriptSemanticAnalysisState,
  node: t.Node,
  name: string,
): SemanticBindingLookup =>
  semanticBindingLookupFromScope(
    semanticScopeForNode(state, node),
    name,
    state,
  );

/** Resolve a certain lexical binding from an explicitly selected scope. */
export const resolveSemanticBindingFromScope = (
  scope: JavaScriptSemanticScopeState,
  name: string,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptSemanticBindingState | undefined => {
  const lookup = semanticBindingLookupFromScope(scope, name, state);
  return lookup.kind === "binding" ? lookup.binding : undefined;
};

type SemanticWithRequireLookup = "captures" | "skips" | "unknown";
const semanticUnscopablesKey = Symbol("semantic-unscopables-key");

/** Classify only source-visible own `require` entries in a literal with object. */
const semanticWithRequireLookup = (
  state: JavaScriptSemanticAnalysisState,
  statement: t.WithStatement,
  name: string,
): SemanticWithRequireLookup => {
  if (name !== "require") return "unknown";
  const object = unwrapJavaScriptExpression(statement.object).node;
  if (!t.isObjectExpression(object)) return "unknown";
  let ownRequire = false;
  let hasUnknownOwnProperties = false;
  let prototypeIsNull = false;
  let unknownPrototype = false;
  for (const property of object.properties) {
    if (t.isSpreadElement(property)) {
      hasUnknownOwnProperties = true;
      continue;
    }
    const key = semanticWithPropertyName(
      property.key,
      property.computed,
      state,
    );
    if (key === "require") ownRequire = true;
    else if (
      key === "__proto__" &&
      t.isObjectProperty(property) &&
      !property.computed &&
      !property.shorthand
    ) {
      const prototype = unwrapJavaScriptExpression(property.value).node;
      if (t.isNullLiteral(prototype)) prototypeIsNull = true;
      else unknownPrototype = true;
    } else if (key === null && property.computed) {
      hasUnknownOwnProperties = true;
    }
  }
  if (ownRequire) {
    const unscopablesValue = finalSemanticWithSymbolProperty(object, state);
    if (unscopablesValue === "unknown") return "unknown";
    if (unscopablesValue === undefined)
      return prototypeIsNull ||
        (!unknownPrototype && state.prototypeRequireMutationObserved === false)
        ? "captures"
        : "unknown";
    const unscopables = unwrapJavaScriptExpression(unscopablesValue).node;
    if (!t.isObjectExpression(unscopables))
      return isSemanticWithPrimitive(unscopables) ? "captures" : "unknown";
    const entry = finalSemanticWithStringProperty(unscopables, "require");
    if (entry === "unknown") return "unknown";
    if (entry === undefined) {
      const prototype = semanticWithPrototypeKind(unscopables);
      return prototype === "null" ||
        (prototype === "ordinary" &&
          state.prototypeRequireMutationObserved === false)
        ? "captures"
        : "unknown";
    }
    const truthiness = staticJavaScriptTruthiness(entry);
    return truthiness === true
      ? "skips"
      : truthiness === false
        ? "captures"
        : "unknown";
  }
  if (hasUnknownOwnProperties || unknownPrototype) return "unknown";
  if (prototypeIsNull) return "skips";
  return state.prototypeRequireMutationObserved === false ? "skips" : "unknown";
};

const semanticWithPropertyName = (
  key: t.Node,
  computed: boolean,
  state: JavaScriptSemanticAnalysisState,
): string | typeof semanticUnscopablesKey | null => {
  if (
    computed &&
    t.isMemberExpression(key) &&
    !key.computed &&
    t.isIdentifier(key.object, { name: "Symbol" }) &&
    semanticStaticPropertyKey(key.property, false) === "unscopables" &&
    resolveSemanticBindingState(state, key.object, "Symbol") === undefined &&
    !semanticResolutionBlocked(state, key.object, "Symbol")
  )
    return semanticUnscopablesKey;
  return semanticStaticPropertyKey(key, computed);
};

const finalSemanticWithSymbolProperty = (
  object: t.ObjectExpression,
  state: JavaScriptSemanticAnalysisState,
): t.Node | undefined | "unknown" => {
  for (let index = object.properties.length - 1; index >= 0; index -= 1) {
    const property = object.properties[index];
    if (property === undefined || t.isSpreadElement(property)) return "unknown";
    const name = semanticWithPropertyName(
      property.key,
      property.computed,
      state,
    );
    if (name === semanticUnscopablesKey)
      return t.isObjectProperty(property) ? property.value : "unknown";
    if (name === null && property.computed) return "unknown";
  }
  return undefined;
};

const semanticWithPrototypeKind = (
  object: t.ObjectExpression,
): "null" | "ordinary" | "other" => {
  for (const property of object.properties) {
    if (
      t.isObjectProperty(property) &&
      !property.computed &&
      !property.shorthand &&
      t.isIdentifier(property.key, { name: "__proto__" })
    )
      return t.isNullLiteral(unwrapJavaScriptExpression(property.value).node)
        ? "null"
        : "other";
  }
  return "ordinary";
};

const finalSemanticWithStringProperty = (
  object: t.ObjectExpression,
  sought: string,
): t.Node | undefined | "unknown" => {
  for (let index = object.properties.length - 1; index >= 0; index -= 1) {
    const property = object.properties[index];
    if (property === undefined || t.isSpreadElement(property)) return "unknown";
    const name = semanticStaticPropertyKey(property.key, property.computed);
    if (name === sought)
      return t.isObjectProperty(property) ? property.value : "unknown";
    if (name === null && property.computed) return "unknown";
  }
  return undefined;
};

const isSemanticWithPrimitive = (node: t.Node): boolean =>
  t.isNullLiteral(node) ||
  t.isBooleanLiteral(node) ||
  t.isStringLiteral(node) ||
  t.isNumericLiteral(node) ||
  t.isBigIntLiteral(node) ||
  (t.isUnaryExpression(node, { operator: "-" }) &&
    (t.isNumericLiteral(node.argument) || t.isBigIntLiteral(node.argument)));

/** Select the function/program owner for a var declaration. */
export const semanticVariableScope = (
  scope: JavaScriptSemanticScopeState,
  parent: t.Node | null,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptSemanticScopeState => {
  if (!(parent !== null && t.isVariableDeclaration(parent, { kind: "var" })))
    return scope;
  let candidate = scope;
  while (candidate.kind === "block" || candidate.kind === "catch") {
    const outer =
      candidate.parentScopeId === null
        ? undefined
        : state.scopesById.get(candidate.parentScopeId);
    if (outer === undefined) break;
    candidate = outer;
  }
  return candidate;
};
