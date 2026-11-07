import * as t from "@babel/types";
import { semanticKnownSymbolKey } from "./javascriptSemanticPropertyKeys.js";
import {
  createAmbientPathResolver,
  retainSemanticAmbientEffect,
} from "./javascriptSemanticAmbientWrites.js";
import { isIntrinsicMapLookup } from "./javascriptSemanticMapOperations.js";
import {
  isIntrinsicTypedArrayConstruction,
  isTypedArrayNumericIndex,
} from "./javascriptSemanticTypedArrays.js";

import {
  semanticGlobalProcessOrigin,
  semanticGlobalProcessPathOrigin,
  semanticOriginalGlobalProcessAt,
  semanticMutableBuiltinOrigin,
  semanticRequireExportsIdentity,
  semanticRequireOrigin,
  semanticRequireLoaderAt,
  hasSemanticCreateRequireFactoryOrigin,
} from "./javascriptSemanticRequireOrigin.js";

import {
  resolveSemanticBindingState,
  semanticBindingLookupAt,
  type JavaScriptBindingIndex,
  type JavaScriptSemanticBindingState,
  type JavaScriptSemanticAnalysisState,
  type JavaScriptSemanticMemberEffect,
} from "./javascriptSemanticState.js";
import {
  clearSemanticValueCaches,
  evaluateSemanticBinding,
  evaluateSemanticExpression,
} from "./javascriptSemanticValues.js";
import { semanticContainer } from "./javascriptSemanticSlots.js";
import {
  semanticProjectedSourceFactsAtRead,
  semanticShiftCapturedSelections,
  semanticNormalizeCapturedSelections,
  type SemanticCapturedSelection,
} from "./javascriptSemanticProjectedSources.js";

import {
  semanticArrayPropertyReferences,
  semanticClassCandidates,
  semanticClassPropertyReferences,
  semanticClassAccessorReferences,
  semanticObjectPropertyReferences,
  semanticObjectAccessorReferences,
  type JavaScriptSemanticObjectReference,
} from "./javascriptSemanticObjectReferences.js";
import {
  semanticIterationSources,
  semanticPropertyReadSources,
  type SemanticIterationSource,
  type SemanticPropertyReadSource,
} from "./javascriptSemanticIterationSources.js";
import { semanticGetterReceiverReferences } from "./javascriptSemanticGetterResults.js";
import { semanticCallableResultExpressions } from "./javascriptSemanticCallableResults.js";
import { createSemanticReturnedReferences } from "./javascriptSemanticReturnedReferences.js";
import {
  semanticMutationInitializers,
  semanticBindingAtRead,
  semanticCaptureOrderingIdentity,
  semanticScopeExitEffect,
} from "./javascriptSemanticMutationInitializers.js";
import { semanticCoercionOperands } from "./javascriptSemanticLanguageInvocations.js";
import { SEMANTIC_ALIAS_SELECTION_LIMIT } from "./javascriptSemanticResourceLimits.js";
import {
  semanticCopiedReferencePath,
  semanticKnownArrayIteration,
  semanticReferenceSourcesInactive,
  semanticSelectedReferenceSlot,
} from "./javascriptSemanticReferenceSources.js";
import {
  semanticArrayIndex,
  joinSemanticPropertyPaths,
  SemanticPropertyPathCoverage,
  semanticPropertyPathKeyMatches,
  type JavaScriptSemanticPropertyPath,
} from "./javascriptSemanticPropertyPaths.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import {
  traverseJavaScriptValueAstSteps,
  childNodes,
} from "./javascriptSemanticTraversal.js";
import {
  semanticStaticPropertyKey,
  semanticWriteSiteTarget,
  semanticWriteSiteReadsFirst,
  semanticWriteTargets,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";

type PropertyPath = JavaScriptSemanticPropertyPath;
interface MutationSelectionContext {
  readonly memberReadAt?: t.Node | undefined;
  readonly capturedSelections?:
    | readonly SemanticCapturedSelection[]
    | undefined;
}

type ValueEffect = "write" | "escape";

/** Only replacing or possibly selecting an iterator-bearing prototype slot changes iteration. */
const arrayPrototypeIterationMayChange = (path: PropertyPath): boolean => {
  // Array.prototype and Object.prototype are on native arrays' prototype
  // chain. Their default constructor.prototype pairs return to the same owner.
  let offset = 0;
  while (path[offset] === "constructor" && path[offset + 1] === "prototype")
    offset += 2;
  const key = path[offset];
  return (
    key === undefined ||
    key === null ||
    typeof key === "object" ||
    semanticArrayIndex(key) !== null ||
    key === "__proto__"
  );
};

/** Preserve uncertainty from property writes and references exposed to calls, yielding during traversal and fixpoint iteration. */

/** Accessor selection uses the same slots, prototype shadowing and array indices as aliases. */
const localAccessorMethods = (
  root: t.Node,
  path: PropertyPath,
  accessor: "get" | "set",
  state: JavaScriptSemanticAnalysisState,
  keyMayExist: (
    key: PropertyPath[number] | undefined,
    kind: "get" | "set",
  ) => boolean,
  lookup: "prototype" | "own" = "prototype",
): readonly (t.ObjectMethod | t.ClassMethod)[] | undefined => {
  if (!keyMayExist(path.at(-1), accessor)) return [];
  const methods = new Set<t.ObjectMethod | t.ClassMethod>();
  const pending = [{ node: root, path }];
  const examined = new WeakMap<t.Node, Set<string>>();
  let selections = 0;
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const current = pending[cursor]!;
    const node = unwrapJavaScriptExpression(current.node).node;
    const key = JSON.stringify(current.path);
    const paths = examined.get(node) ?? new Set<string>();
    if (paths.has(key)) continue;
    paths.add(key);
    examined.set(node, paths);
    if (++selections > SEMANTIC_ALIAS_SELECTION_LIMIT) {
      state.valueResourceLimits.add("alias-selections");
      return undefined;
    }
    if (
      (t.isObjectMethod(node) || t.isClassMethod(node)) &&
      current.path.length === 0
    ) {
      methods.add(node);
      continue;
    }
    if (t.isIdentifier(node)) {
      const binding = resolveSemanticBindingState(state, node, node.name);
      if (binding === undefined) continue;
      const selected = semanticBindingAtRead(
        binding,
        node,
        state.parentsByNode,
      ).binding;
      for (const source of [
        ...selected.initializers,
        ...selected.referenceInitializers,
      ])
        pending.push({
          node: source.node,
          path: [...source.projection, ...current.path],
        });
    } else if (
      t.isMemberExpression(node) ||
      t.isOptionalMemberExpression(node)
    ) {
      pending.push({
        node: node.object,
        path: [
          semanticStaticPropertyKey(node.property, node.computed),
          ...current.path,
        ],
      });
    } else if (
      current.path.length > 0 &&
      (t.isObjectExpression(node) || t.isArrayExpression(node))
    ) {
      const [selected, ...remaining] = current.path;
      const references = t.isArrayExpression(node)
        ? semanticArrayPropertyReferences(node, [selected!])
        : remaining.length === 0
          ? semanticObjectAccessorReferences(
              node,
              selected!,
              state,
              accessor,
              lookup,
            )
          : semanticObjectPropertyReferences(node, [selected!], state);
      for (const source of references)
        pending.push({
          node: source.node,
          path: [...source.path, ...remaining],
        });
    } else if (
      (t.isClass(node) || t.isNewExpression(node)) &&
      current.path.length > 0
    ) {
      const [selected, ...remaining] = current.path;
      const owners = t.isClass(node)
        ? [node]
        : semanticClassCandidates(node.callee, state);
      for (const owner of owners) {
        const selection = {
          owner,
          kind: t.isClass(node) ? ("static" as const) : ("instance" as const),
        };
        const references =
          remaining.length > 0
            ? semanticClassPropertyReferences(selection, [selected!], state)
            : lookup === "own"
              ? []
              : semanticClassAccessorReferences(
                  selection,
                  selected!,
                  state,
                  accessor,
                );
        for (const source of references)
          pending.push({
            node: source.node,
            path: [...source.path, ...remaining],
          });
      }
    } else {
      for (const source of branchReferenceValues(node, current.path))
        pending.push(source);
    }
  }
  return [...methods];
};

type AccessorEffectOperand =
  | { readonly kind: "escape"; readonly node: t.Node }
  | {
      readonly kind: "read";
      readonly node: t.Node;
      readonly path: PropertyPath;
      readonly lookup: "prototype" | "own";
      readonly guards?: SemanticPropertyReadSource;
    }
  | {
      readonly kind: "invoke";
      readonly node: t.Node;
      readonly invocation?: t.CallExpression | t.OptionalCallExpression;
    };

const accessorOperands = new WeakMap<
  t.Function,
  readonly AccessorEffectOperand[]
>();

/** Collect invocation operands once; receiver interpretation belongs to the getter owner. */
const accessorEffectOperands = (
  method: t.Function,
): readonly AccessorEffectOperand[] => {
  const cached = accessorOperands.get(method);
  if (cached !== undefined) return cached;
  const operands: AccessorEffectOperand[] = [];
  const pending: { node: t.Node; parent: t.Node | null }[] = [
    { node: method.body, parent: method },
  ];
  const writeOnly = new WeakSet<t.Node>();
  while (pending.length > 0) {
    const { node, parent } = pending.pop()!;
    // Defining a nested callable does not invoke it.
    if (t.isFunction(node) || t.isClass(node)) continue;
    const write = semanticWriteSiteTarget(node);
    if (write !== null) {
      for (const target of semanticWriteTargets(write)) {
        if (!semanticWriteSiteReadsFirst(node)) writeOnly.add(target);
        if (!t.isIdentifier(target))
          operands.push({ kind: "escape", node: target.object });
      }
    }
    if (
      (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) &&
      !writeOnly.has(node)
    )
      operands.push({
        kind: "read",
        node: node.object,
        path: [semanticStaticPropertyKey(node.property, node.computed)],
        lookup: "prototype",
      });
    if (
      t.isCallExpression(node) ||
      t.isOptionalCallExpression(node) ||
      t.isNewExpression(node)
    ) {
      const callee = unwrapJavaScriptExpression(node.callee).node;
      operands.push({
        kind: "invoke",
        node: node.callee,
        ...(t.isNewExpression(node) ? {} : { invocation: node }),
      });
      if (
        !t.isNewExpression(node) &&
        (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee))
      )
        operands.push({ kind: "escape", node: callee.object });
      for (const argument of node.arguments)
        operands.push({
          kind: "escape",
          node: t.isSpreadElement(argument) ? argument.argument : argument,
        });
    } else if (t.isTaggedTemplateExpression(node)) {
      operands.push({ kind: "invoke", node: node.tag });
      const tag = unwrapJavaScriptExpression(node.tag).node;
      if (t.isMemberExpression(tag) || t.isOptionalMemberExpression(tag))
        operands.push({ kind: "escape", node: tag.object });
      for (const expression of node.quasi.expressions)
        operands.push({ kind: "escape", node: expression });
    }
    for (const operand of semanticCoercionOperands(node))
      operands.push({ kind: "escape", node: operand });
    if (t.isTemplateLiteral(node) && !t.isTaggedTemplateExpression(parent))
      for (const expression of node.expressions)
        operands.push({ kind: "escape", node: expression });
    for (const source of semanticPropertyReadSources(node, parent))
      operands.push({
        kind: "read",
        node: source.node,
        path: source.projection,
        lookup: source.lookup,
        guards: source,
      });
    if (
      t.isVariableDeclarator(node) &&
      t.isVariableDeclaration(parent) &&
      (parent.kind === "using" || parent.kind === "await using")
    )
      operands.push({ kind: "escape", node: node.init ?? node.id });
    for (const child of childNodes(node).reverse())
      pending.push({ node: child, parent: node });
  }
  accessorOperands.set(method, operands);
  return operands;
};

export function* collectSemanticMemberMutationsSteps(
  program: t.Program,
  state: JavaScriptSemanticAnalysisState,
  referenceMayHaveChangedAt: JavaScriptBindingIndex["referenceMayHaveChangedAt"],
): Generator<void, void> {
  const deferredMapReceivers = new Set<
    t.CallExpression | t.OptionalCallExpression
  >();
  // The binding pass already retained callable nodes. Ordinary data-only code
  // must not pay an alias walk for every member read or assignment.
  const accessorKeys = {
    get: new Set<string | null>(),
    set: new Set<string | null>(),
  };
  for (const node of state.callableNodesById.values())
    if (
      (t.isObjectMethod(node) || t.isClassMethod(node)) &&
      (node.kind === "get" || node.kind === "set")
    )
      accessorKeys[node.kind].add(
        semanticStaticPropertyKey(node.key, node.computed),
      );
  const accessorKeyMayExist = (
    key: PropertyPath[number] | undefined,
    kind: "get" | "set",
  ): boolean => {
    const keys = accessorKeys[kind];
    return (
      keys.has(null) ||
      (key === null || typeof key === "object"
        ? keys.size > 0
        : keys.has(String(key)))
    );
  };
  const returnedReferences = createSemanticReturnedReferences(state);
  const getterEffects = (
    root: t.Node,
    path: PropertyPath,
    lookup: "prototype" | "own" = "prototype",
  ): readonly JavaScriptSemanticObjectReference[] => {
    if (!accessorKeyMayExist(path.at(-1), "get")) return [];
    const pending = [{ node: root, path, lookup }];
    const examined = new Set<string>();
    const effects: JavaScriptSemanticObjectReference[] = [];
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const {
        node: selectedRoot,
        path: selected,
        lookup: selectedLookup,
      } = pending[cursor]!;
      const identity = JSON.stringify([
        selectedRoot.start,
        selectedRoot.end,
        selected,
        selectedLookup,
      ]);
      if (examined.has(identity)) continue;
      examined.add(identity);
      if (examined.size > SEMANTIC_ALIAS_SELECTION_LIMIT) {
        state.valueResourceLimits.add("alias-selections");
        return [{ node: root, path: [] }];
      }
      const methods = localAccessorMethods(
        selectedRoot,
        selected,
        "get",
        state,
        accessorKeyMayExist,
        selectedLookup,
      );
      const receiver = selected.slice(0, -1);
      if (methods === undefined) {
        effects.push({ node: selectedRoot, path: receiver });
        continue;
      }
      for (const method of methods) {
        const callables: t.Function[] = [method];
        const visitedCallables = new Set<t.Function>();
        for (let index = 0; index < callables.length; index++) {
          const callable = callables[index]!;
          if (visitedCallables.has(callable)) continue;
          visitedCallables.add(callable);
          for (const operand of accessorEffectOperands(callable)) {
            if (operand.kind === "invoke") {
              for (const target of returnedReferences(
                operand.node,
                operand.invocation,
              ).callables)
                if (!target.generator) callables.push(target);
              continue;
            }
            if (
              operand.kind === "read" &&
              (!accessorKeyMayExist(operand.path.at(-1), "get") ||
                (operand.guards !== undefined &&
                  semanticReferenceSourcesInactive(operand.guards, state)))
            )
              continue;
            for (const reference of semanticGetterReceiverReferences(
              method,
              operand.node,
              state,
            )) {
              const receiverReference = reference.node === method;
              const targetRoot = receiverReference
                ? selectedRoot
                : reference.node;
              const target = receiverReference
                ? [...receiver, ...reference.path]
                : reference.path;
              if (operand.kind === "escape" || t.isSuper(operand.node))
                effects.push({ node: targetRoot, path: target });
              else
                pending.push({
                  node: targetRoot,
                  path: [...target, ...operand.path],
                  lookup: operand.lookup,
                });
            }
          }
        }
      }
    }
    return effects;
  };
  const parents = state.parentsByNode;
  const observablePaths = observableMutationPaths(state);
  const recordedRequiredEffects = new Set<string>();
  let recordedEffectCount = 0;
  const recordRequiredEffect = (
    specifier: string,
    path: PropertyPath,
    effect: ValueEffect,
    node: t.Node | undefined,
  ): void => {
    const identity = semanticRequireExportsIdentity(specifier, path);
    let effectPath = identity.path;
    // Only known value slots are primitive. Unknown or inherited selections
    // can expose the container prototype and affect any subsequently read slot.
    if (
      effect === "escape" &&
      identity.specifier === "process" &&
      effectPath.length === 2 &&
      (effectPath[0] === "env" || effectPath[0] === "argv")
    ) {
      const selected = effectPath[1];
      if (
        (typeof selected === "string" || typeof selected === "number") &&
        (effectPath[0] === "env"
          ? !Object.hasOwn(Object.prototype, selected)
          : selected === "length" || semanticArrayIndex(selected) !== null)
      )
        return;
      effectPath = [effectPath[0], null];
    }
    const key = JSON.stringify([
      "required",
      identity.specifier,
      effect,
      effectPath,
      node?.start,
      node?.end,
    ]);
    if (recordedRequiredEffects.has(key)) return;
    recordedRequiredEffects.add(key);
    recordedEffectCount += 1;
    const effects = state.requiredModuleEffects.get(identity.specifier) ?? [];
    effects.push({ path: effectPath, node, kind: effect });
    state.requiredModuleEffects.set(identity.specifier, effects);
  };
  // Traversal states that differ only in coverage fields a record never
  // stores, such as the origin, owner initializer or getter widening, reach the
  // same binding fact. Each later receiver query scans every record, so retain
  // one record per fact. Nodes and initializers compare by identity.
  const objectIdentities = new WeakMap<object, number>();
  let objectIdentityCount = 0;
  const objectIdentity = (value: object | undefined): number | undefined => {
    if (value === undefined) return undefined;
    let identity = objectIdentities.get(value);
    if (identity === undefined) {
      identity = objectIdentityCount++;
      objectIdentities.set(value, identity);
    }
    return identity;
  };
  const recordedBindingEffects = new WeakMap<
    JavaScriptSemanticMemberEffect[],
    Set<string>
  >();
  const recordBindingEffect = (
    records: JavaScriptSemanticMemberEffect[],
    effect: JavaScriptSemanticMemberEffect,
  ): void => {
    const fields: {
      readonly [Field in keyof JavaScriptSemanticMemberEffect]-?: unknown;
    } = {
      path: effect.path,
      node: objectIdentity(effect.node),
      assignedSources: effect.assignedSources?.map((source) =>
        objectIdentity(source),
      ),
      receiverInitializers: effect.receiverInitializers?.map((initializer) =>
        objectIdentity(initializer),
      ),
      receiverIdentity: effect.receiverIdentity,
      receiverAt: objectIdentity(effect.receiverAt),
    };
    const key = JSON.stringify(fields);
    let recorded = recordedBindingEffects.get(records);
    if (recorded === undefined) {
      recorded = new Set();
      recordedBindingEffects.set(records, recorded);
    }
    if (recorded.has(key)) return;
    recorded.add(key);
    records.push(effect);
  };
  // Ambient indexing owns aliases of global objects. Consume its canonical
  // writes instead of reparsing qualified or aliased process assignments.
  for (const { path, node } of state.ambientWriteEffects)
    if (
      path[0] === "global" &&
      path[1] === "process" &&
      path.length > 2 &&
      node !== undefined &&
      semanticOriginalGlobalProcessAt(node, state)
    )
      recordRequiredEffect("node:process", path.slice(2), "write", node);
  const selections = new Map<string, readonly string[]>();
  const coveringPaths = new Map<string, SemanticPropertyPathCoverage>();
  state.arrayIterationUnknown = false;
  // Definition collection finishes before this phase, so a scope's bindings no
  // longer change and one node resolves to one binding. Repeated visits of the
  // same node otherwise repeat the same scope walk.
  const resolvedBindings = new WeakMap<
    t.Node,
    JavaScriptSemanticBindingState | null
  >();
  const resolveBinding = (
    node: t.Node,
    name: string,
  ): JavaScriptSemanticBindingState | undefined => {
    const cached = resolvedBindings.get(node);
    if (cached !== undefined) return cached ?? undefined;
    const resolved = resolveSemanticBindingState(state, node, name);
    resolvedBindings.set(node, resolved ?? null);
    return resolved;
  };
  const nodeIdentities = new WeakMap<t.Node, number>();
  let nextNodeIdentity = 0;
  const nodeIdentity = (node: t.Node | undefined): number | null => {
    if (node === undefined) return null;
    const prior = nodeIdentities.get(node);
    if (prior !== undefined) return prior;
    const identity = nextNodeIdentity++;
    nodeIdentities.set(node, identity);
    return identity;
  };
  const captureIdentity = ({ at, ownEnumerable }: SemanticCapturedSelection) =>
    ownEnumerable ? at : semanticCaptureOrderingIdentity(at, parents);
  const capturedSelectionKey = (
    captures: readonly SemanticCapturedSelection[] | undefined,
  ) =>
    captures?.map((capture) => [
      nodeIdentity(captureIdentity(capture)),
      capture.depth,
      capture.ownEnumerable === true,
    ]);
  // One capture tuple recurs across every alias it reaches. Re-encoding it
  // would rebuild the same long key and force a fresh string hash per lookup.
  const captureKeys = new WeakMap<
    JavaScriptSemanticBindingState,
    Map<string, string>
  >();
  const captureKeyOf = (
    binding: JavaScriptSemanticBindingState,
    originAt: t.Node | undefined,
    ownerInitializer: t.Node | undefined,
  ): string => {
    let byPosition = captureKeys.get(binding);
    if (byPosition === undefined) {
      byPosition = new Map();
      captureKeys.set(binding, byPosition);
    }
    const positionKey = `${originAt?.start ?? "u"}:${originAt?.end ?? "u"}:${
      ownerInitializer?.start ?? "u"
    }:${ownerInitializer?.end ?? "u"}`;
    const cached = byPosition.get(positionKey);
    if (cached !== undefined) return cached;
    const created = JSON.stringify([
      binding.bindingId,
      originAt?.start,
      originAt?.end,
      ownerInitializer?.start,
      ownerInitializer?.end,
    ]);
    byPosition.set(positionKey, created);
    return created;
  };
  // A capture key already ends the array; a path stays one nested element.
  const lifetimeKey = (captureKey: string, path: PropertyPath): string =>
    `${captureKey.slice(0, -1)},${JSON.stringify(path)}]`;
  const pendingReferences: (MutationSelectionContext & {
    readonly initializer: JavaScriptSemanticBindingState["referenceInitializers"][number];
    readonly path: PropertyPath;
    readonly bindings: ReadonlySet<string>;
    readonly effect: ValueEffect;
    readonly mutation?: t.Node;
    readonly originAt: t.Node | undefined;
    readonly widenedGetterResult?: true;
    readonly definiteReceiver: boolean;
    readonly assignedSources?: readonly SemanticIterationSource[];
  })[] = [];
  const iterableReferences: IterableReference[] = [];
  const iterableReferenceKeys = new WeakMap<t.Node, Set<string>>();
  const deferIterable = (reference: IterableReference): void => {
    const keys = iterableReferenceKeys.get(reference.node) ?? new Set<string>();
    const key = JSON.stringify([
      reference.projection,
      reference.path,
      reference.fallbackPath,
      reference.effect,
      reference.mutation?.start,
      reference.mutation?.end,
      reference.originAt?.start,
      reference.originAt?.end,
      reference.memberReadAt?.start,
      reference.memberReadAt?.end,
      capturedSelectionKey(reference.capturedSelections),
      reference.iterationOnly,
      reference.widenedGetterResult === true,
      reference.definiteReceiver === true,
      reference.assignedSources?.[0]?.target?.start,
      reference.requiredSources?.map((source) => [
        source.node.start,
        source.node.end,
        source.projection,
        source.iterationSources?.map((iterable) => [
          iterable.node.start,
          iterable.node.end,
          iterable.projection,
        ]),
      ]),
      reference.fallbackSources?.map((source) => [
        source.node.start,
        source.node.end,
        source.projection,
        source.iterationSources?.map((iterable) => [
          iterable.node.start,
          iterable.node.end,
          iterable.projection,
        ]),
      ]),
      [...reference.bindings].sort(compareUnicodeCodePoints),
    ]);
    if (keys.has(key)) return;
    keys.add(key);
    iterableReferenceKeys.set(reference.node, keys);
    iterableReferences.push(reference);
  };
  const ambientPaths = createAmbientPathResolver(state, true);
  const markValue = (
    node: t.Node,
    path: PropertyPath,
    bindings: ReadonlySet<string>,
    effect: ValueEffect = "write",
    mutation?: t.Node,
    originAt: t.Node | undefined = mutation,
    ownerInitializer?: t.Node,
    widenedGetterResult = false,
    assignedSources?: readonly SemanticIterationSource[],
    definiteReceiver = true,
    selection?: MutationSelectionContext,
  ): void => {
    type JoinedProjection = {
      readonly path: PropertyPath;
      readonly definiteReceiver: boolean;
      scheduled: boolean;
    };
    type PendingValue = ReferencedValue &
      MutationSelectionContext & {
        readonly bindings: ReadonlySet<string>;
        readonly originAt: t.Node | undefined;
        readonly definiteReceiver: boolean;
        readonly exactKey?: string;
        readonly joined?: {
          readonly key: string;
          readonly value: JoinedProjection;
        };
      };
    const pending: PendingValue[] = [];
    // The effect, mutation and assigned sources belong to this invocation.
    // Alias histories do not select a value: the binding/capture/projection do.
    // Keep small alternatives exact. Bound additional states across this whole
    // query before scheduling/projecting or copying capture-history sets, then
    // visit the complete same-depth may-projection closure with monotone joins.
    const joinedProjections = new Map<string, JoinedProjection>();
    const exactProjections = new Map<string, Set<string>>();
    let additionalAlternatives = 0;
    let projectionsWidened = false;
    const enqueue = (candidate: PendingValue): void => {
      // A capture deeper than this projection is no longer applicable. Keep
      // the canonical context before indexing or scheduling alias histories.
      const value = candidate.capturedSelections?.length
        ? {
            ...candidate,
            capturedSelections: semanticNormalizeCapturedSelections(
              candidate.capturedSelections,
              candidate.path.length,
            ),
          }
        : candidate;
      const expression = unwrapJavaScriptExpression(value.node).node;
      const binding = t.isIdentifier(expression)
        ? resolveBinding(expression, expression.name)
        : undefined;
      if (binding === undefined) {
        pending.push(value);
        return;
      }
      const observablePath = observablePaths.normalize(
        binding.bindingId,
        value.path,
        effect,
      );
      // Join unobserved suffixes within their exact prefix. Joining distinct
      // prefixes first could invent a wildcard reaching unrelated siblings.
      // Keep the raw path for capture, cycle and stored-source selection.
      const unobservedPrefix =
        observablePath === null
          ? value.path
          : observablePath !== value.path
            ? observablePath.slice(0, -1)
            : undefined;
      const context = JSON.stringify([
        binding.bindingId,
        nodeIdentity(value.originAt),
        nodeIdentity(value.ownerInitializer),
        nodeIdentity(value.memberReadAt),
        value.definiteReceiver,
        value.path.length,
        value.widenedGetterResult === true,
        unobservedPrefix,
      ]);
      const captures = capturedSelectionKey(value.capturedSelections);
      // Distinct selection times remain distinct; syntactic histories with
      // the same unknown ordering in one repeating loop share a context.
      const key = JSON.stringify([context, captures]);
      if (!projectionsWidened) {
        const exact = exactProjections.get(context) ?? new Set<string>();
        const selection = JSON.stringify([captures, value.path]);
        if (exact.has(selection)) return;
        if (
          exact.size > 0 &&
          ++additionalAlternatives > SEMANTIC_ALIAS_SELECTION_LIMIT
        ) {
          projectionsWidened = true;
          state.valueResourceLimits.add("alias-selections");
          exactProjections.clear();
        } else {
          exact.add(selection);
          exactProjections.set(context, exact);
        }
      }
      const prior = joinedProjections.get(key);
      const path =
        prior === undefined
          ? value.path
          : joinSemanticPropertyPaths(prior.path, value.path);
      if (path === undefined) throw new Error("Projection depth key mismatch");
      const definiteReceiver =
        value.definiteReceiver &&
        (prior?.definiteReceiver ?? true) &&
        path.every((key) => key !== null && typeof key !== "object");
      const joined =
        prior !== undefined &&
        path === prior.path &&
        definiteReceiver === prior.definiteReceiver
          ? prior
          : { path, definiteReceiver, scheduled: false };
      joinedProjections.set(key, joined);
      if (!projectionsWidened) {
        pending.push({ ...value, exactKey: key });
        return;
      }
      if (joined.scheduled) return;
      joined.scheduled = true;
      pending.push({
        ...value,
        path,
        definiteReceiver,
        joined: { key, value: joined },
      });
    };
    enqueue({
      node,
      path,
      bindings,
      originAt,
      definiteReceiver,
      memberReadAt: selection?.memberReadAt ?? mutation ?? originAt,
      capturedSelections: selection?.capturedSelections,
      ...(ownerInitializer === undefined ? {} : { ownerInitializer }),
    });
    // Visit shallower alias traversals first so their exact prefixes suppress
    // longer loop paths before those paths enumerate every assignment order.
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const current = pending[cursor];
      if (current === undefined) break;
      if (
        (current.exactKey !== undefined &&
          joinedProjections.get(current.exactKey)?.scheduled === true) ||
        (current.joined !== undefined &&
          joinedProjections.get(current.joined.key) !== current.joined.value)
      )
        continue;
      const expression = unwrapJavaScriptExpression(current.node).node;
      const required = semanticRequireOrigin(expression, state);
      if (required !== undefined) {
        recordRequiredEffect(
          required.origin.specifier,
          [...required.origin.importedPath, ...current.path],
          effect,
          mutation,
        );
        continue;
      }
      const globalProcess = semanticGlobalProcessPathOrigin(expression, state);
      if (globalProcess !== undefined) {
        recordRequiredEffect(
          globalProcess.specifier,
          [...globalProcess.importedPath, ...current.path],
          effect,
          mutation,
        );
        continue;
      }
      if (t.isIdentifier(expression)) {
        let binding = resolveBinding(expression, expression.name);
        const lookup =
          binding === undefined
            ? semanticBindingLookupAt(state, expression, expression.name)
            : undefined;
        if (binding === undefined) {
          for (const path of ambientPaths(
            expression,
            current.originAt,
            effect === "escape",
            current.path.map((key) =>
              key === null || typeof key === "object" ? null : String(key),
            ),
          ).paths)
            if (retainSemanticAmbientEffect(state, effect, path, mutation)) {
              recordedEffectCount += 1;
              clearSemanticValueCaches(state);
            }
          const processOrigin = semanticGlobalProcessOrigin(expression, state);
          if (processOrigin !== undefined)
            recordRequiredEffect(
              processOrigin.specifier,
              current.path,
              effect,
              mutation,
            );
          if (
            (["Array", "Object"].includes(expression.name) &&
              (current.path[0] === "prototype" || current.path[0] === null) &&
              arrayPrototypeIterationMayChange(current.path.slice(1))) ||
            (["globalThis", "global", "window", "self"].includes(
              expression.name,
            ) &&
              (["Array", "Object"].includes(String(current.path[0])) ||
                current.path[0] === null) &&
              (current.path[1] === "prototype" || current.path[1] === null) &&
              arrayPrototypeIterationMayChange(current.path.slice(2)))
          )
            state.arrayIterationUnknown = true;
          if (lookup?.kind !== "uncertain-binding") continue;
          binding = lookup.binding;
        }
        const definiteReceiver =
          current.definiteReceiver && lookup?.kind !== "uncertain-binding";
        // An alias restored from a saved reference can revisit the same binding
        // at an earlier capture or a shorter getter-receiver path. Only a
        // repeated capture and path closes a cycle.
        const captureSelectionIdentity = JSON.stringify([
          current.memberReadAt?.start,
          current.memberReadAt?.end,
          capturedSelectionKey(current.capturedSelections),
        ]);
        // Ancestry closes repeated source identities before recursively selected
        // copy vectors grow; independent contexts remain distinct in coverage.
        const captureKey = JSON.stringify([
          captureKeyOf(binding, current.originAt, current.ownerInitializer),
          current.memberReadAt?.start,
          current.memberReadAt?.end,
        ]);
        const lifetime = lifetimeKey(captureKey, current.path);
        if (current.bindings.has(lifetime)) continue;
        // Union compatible copied-slot selections at each binding. Carrying every
        // combination of exclusions through branch diamonds is exponential.
        // Preserve paths that can change observed slots or Array prototype
        // effects; canonicalize suffixes that cannot distinguish lattice facts.
        let path = observablePaths.normalize(
          binding.bindingId,
          current.path,
          effect,
        );
        if (path === null) continue;
        const selectorIndex = path.findIndex(
          (key) => key !== null && typeof key === "object",
        );
        const selector = path[selectorIndex];
        if (selector !== null && typeof selector === "object") {
          const selectionIdentity = JSON.stringify([
            binding.bindingId,
            effect,
            path.map((key, index) =>
              index === selectorIndex
                ? { startIndex: selector.startIndex }
                : key,
            ),
            mutation?.start,
            mutation?.end,
            current.originAt?.start,
            current.originAt?.end,
            current.ownerInitializer?.start,
            current.ownerInitializer?.end,
            captureSelectionIdentity,
          ]);
          const previous = selections.get(selectionIdentity);
          const excludedKeys =
            previous === undefined
              ? selector.excludedKeys
              : previous.filter((key) => selector.excludedKeys.includes(key));
          if (previous !== undefined && excludedKeys.length === previous.length)
            continue;
          selections.set(selectionIdentity, excludedKeys);
          path = path.map((key, index) =>
            index === selectorIndex ? { ...selector, excludedKeys } : key,
          );
        }
        const origins =
          current.ownerInitializer !== undefined
            ? {
                initializers: binding.initializers.filter(
                  ({ node }) => node === current.ownerInitializer,
                ),
                referenceInitializers: [],
                directOrigins: [],
              }
            : current.originAt === undefined
              ? binding
              : semanticMutationInitializers(
                  binding,
                  current.originAt,
                  parents,
                );
        // Keep an antichain of exact paths. Widening distinct member keys would
        // also invalidate unrelated siblings that never reach this effect.
        // This map is local to the file scan. Escaping the binding id keeps a
        // field separator injective while avoiding a fresh JSON array encode.
        const pathState = `${JSON.stringify(binding.bindingId)}\u0001${
          effect
        }\u0001${
          // Short writes stop at owned literal slots, whereas longer writes
          // reach shared children. Only equal-depth writes cover one another.
          effect === "write" ? path.length : -1
        }\u0001${mutation?.start ?? -1}\u0001${mutation?.end ?? -1}\u0001${
          current.originAt?.start ?? -1
        }\u0001${current.originAt?.end ?? -1}\u0001${
          current.ownerInitializer?.start ?? -1
        }\u0001${current.ownerInitializer?.end ?? -1}\u0001${widenedGetterResult}\u0001${definiteReceiver}\u0001${assignedSources?.[0]?.target?.start ?? -1}\u0001${current.memberReadAt?.start ?? -1}\u0001${current.memberReadAt?.end ?? -1}`;
        let covering = coveringPaths.get(pathState);
        if (covering === undefined) {
          covering = new SemanticPropertyPathCoverage();
          coveringPaths.set(pathState, covering);
        }
        // Captures belong to their projected slots. A shorter escape prefix
        // covers a longer path only when the receiver captures along that
        // prefix agree; deeper capture history cannot split the same fact.
        const captures = semanticNormalizeCapturedSelections(
          current.capturedSelections,
          path.length,
        );
        let captureIndex = 0;
        const captureContexts = captures?.length
          ? path.map((_, index) => {
              while ((captures[captureIndex]?.depth ?? Infinity) < index + 1)
                captureIndex++;
              const capture = captures[captureIndex];
              if (capture === undefined) return undefined;
              return JSON.stringify([
                nodeIdentity(captureIdentity(capture)),
                capture.depth === index + 1 && capture.ownEnumerable === true,
              ]);
            })
          : undefined;
        // An active normalized prefix owns its closure before nested traversals.
        if (!covering.retain(path, captureContexts)) continue;
        // A self alias such as `node = node[key]` revisits its capture with the
        // same prefix added on every cycle, so exact paths never repeat. A self
        // store such as `s.c = s.c.p` adds its segment after the stored key
        // instead. When that segment can never be pruned, escaping through it
        // once covers every longer effect, including writes below shared
        // children. Only a capture already on this alias chain can repeat.
        const revisited = current.bindings.has(captureKey);
        let repeatedPrefix: PropertyPath | undefined;
        let repeatedBase = 0;
        repeat: for (
          let base = 0;
          revisited && base < current.path.length;
          base++
        )
          for (let end = base + 1; end <= current.path.length; end++) {
            const shorter =
              base === 0
                ? current.path.slice(end)
                : [...current.path.slice(0, base), ...current.path.slice(end)];
            if (!current.bindings.has(lifetimeKey(captureKey, shorter)))
              continue;
            repeatedPrefix = current.path.slice(0, end);
            repeatedBase = base;
            break repeat;
          }
        if (
          repeatedPrefix !== undefined &&
          observablePaths.repeatsUnpruned(
            binding.bindingId,
            repeatedPrefix.slice(0, repeatedBase),
            repeatedPrefix.slice(repeatedBase),
          )
        ) {
          markValue(
            current.node,
            repeatedPrefix,
            new Set(),
            "escape",
            mutation,
            current.originAt,
            current.ownerInitializer,
            widenedGetterResult,
            undefined,
            undefined,
            current,
          );
          continue;
        }
        // Invoking a setter exposes the receiver, including shared children.
        // Preserve the explicit target write separately; deleting never invokes it.
        if (
          effect === "write" &&
          !t.isUnaryExpression(mutation, { operator: "delete" })
        ) {
          const selectedPath = path;
          if (
            origins.initializers.some(
              (source) =>
                (localAccessorMethods(
                  source.node,
                  [...source.projection, ...selectedPath],
                  "set",
                  state,
                  accessorKeyMayExist,
                )?.length ?? 1) > 0,
            )
          )
            markValue(
              current.node,
              selectedPath.slice(0, -1),
              new Set(),
              "escape",
              mutation,
              current.originAt,
              current.ownerInitializer,
              false,
              undefined,
              undefined,
              current,
            );
        }
        // A recorded write invalidates the binding to a non-primitive value, so
        // only its first write can target a primitive. Re-evaluating it would
        // replay every earlier write and make repeated writes superlinear.
        const value =
          effect === "write" && binding.memberWrites.length === 0
            ? evaluateSemanticBinding(binding, state)
            : undefined;
        const primitiveWrite =
          value?.status === "literal" || value?.status === "union";
        // The coverage index already owns binding-effect deduplication.
        recordedEffectCount += 1;
        const nested = new Set(current.bindings);
        nested.add(lifetime);
        nested.add(captureKey);
        // Returning a literal's receiver reaches that allocation, not the
        // binding's older values read while evaluating its initializer.
        let retainsInitializers = true;
        if (!primitiveWrite) {
          for (const origin of origins.directOrigins) {
            const shared = semanticMutableBuiltinOrigin(origin, path);
            if (shared !== undefined)
              recordRequiredEffect(
                shared.specifier,
                shared.path,
                effect,
                mutation,
              );
          }
          const receiverInitializers = [
            ...origins.initializers,
            ...origins.referenceInitializers,
          ];
          const receiver =
            effect === "write" &&
            current.path.length > 1 &&
            binding.memberWrites.some(
              (write) =>
                write.assignedSources !== undefined &&
                write.path.length < current.path.length,
            )
              ? semanticProjectedSourceFactsAtRead(
                  binding,
                  current.node,
                  current.path.slice(0, -1),
                  state,
                  false,
                  current.memberReadAt ?? current.originAt ?? current.node,
                  current.capturedSelections,
                )
              : undefined;
          // Stored receiver projections preserve their raw capture authority.
          // Initializer origins retain the normalized mutation traversal below.
          retainsInitializers = receiver?.retainsOrigin !== false;
          if (effect === "escape")
            recordBindingEffect(binding.escapedPaths, {
              path,
              node: mutation,
              receiverInitializers,
              ...(current.originAt === undefined
                ? {}
                : { receiverAt: current.memberReadAt ?? current.originAt }),
            });
          else
            recordBindingEffect(binding.memberWrites, {
              receiverIdentity: definiteReceiver ? "definite" : "possible",
              path,
              node: mutation,
              receiverInitializers,
              ...(current.originAt === undefined
                ? {}
                : { receiverAt: current.memberReadAt ?? current.originAt }),
              ...(assignedSources === undefined ? {} : { assignedSources }),
            });
          clearSemanticValueCaches(state);
          // Resolve a stored child at the receiver capture, before selecting
          // the final written slot. The source owner preserves replacements
          // and captures; a local container does not isolate its children.
          if (receiver !== undefined) {
            for (const source of receiver.storedSources)
              enqueue({
                node: source.node,
                path: [...source.path, current.path.at(-1)!],
                bindings: nested,
                definiteReceiver: false,
                originAt: source.node,
                memberReadAt: current.memberReadAt,
                capturedSelections: semanticNormalizeCapturedSelections([
                  ...(semanticShiftCapturedSelections(
                    current.capturedSelections,
                    source.path.length - (current.path.length - 1),
                  ) ?? []),
                  ...(source.capturedSelections ?? []),
                ]),
              });
          }
          for (const initializer of retainsInitializers
            ? origins.initializers
            : [])
            enqueue({
              node: initializer.node,
              path: [...initializer.projection, ...path],
              bindings: nested,
              definiteReceiver:
                definiteReceiver &&
                origins.initializers.length +
                  origins.referenceInitializers.length ===
                  1,
              originAt: initializer.node,
              memberReadAt: current.memberReadAt,
              capturedSelections: semanticShiftCapturedSelections(
                current.capturedSelections,
                initializer.projection.length,
              ),
            });
        }
        for (const initializer of retainsInitializers
          ? origins.referenceInitializers
          : []) {
          const copiedPath = semanticCopiedReferencePath(
            initializer,
            path,
            effect,
          );
          if (copiedPath === null) continue;
          pendingReferences.push({
            initializer,
            path: copiedPath,
            bindings: nested,
            definiteReceiver:
              definiteReceiver &&
              origins.initializers.length +
                origins.referenceInitializers.length ===
                1 &&
              copiedPath.every(
                (key) => key !== null && typeof key !== "object",
              ),
            ...(assignedSources === undefined ? {} : { assignedSources }),
            effect,
            ...(widenedGetterResult ? { widenedGetterResult: true } : {}),
            originAt: initializer.node,
            memberReadAt: current.memberReadAt,
            capturedSelections: semanticShiftCapturedSelections(
              current.capturedSelections,
              copiedPath.length - path.length,
            ),
            ...(mutation === undefined ? {} : { mutation }),
          });
        }
      } else if (
        t.isMemberExpression(expression) ||
        t.isOptionalMemberExpression(expression)
      ) {
        const key = semanticStaticPropertyKey(
          expression.property,
          expression.computed,
        );
        enqueue({
          node: expression.object,
          path: [key, ...current.path],
          bindings: current.bindings,
          definiteReceiver: current.definiteReceiver && key !== null,
          originAt: current.originAt,
          memberReadAt: current.memberReadAt,
          capturedSelections: semanticNormalizeCapturedSelections([
            ...(semanticShiftCapturedSelections(
              current.capturedSelections,
              1,
            ) ?? []),
            ...(current.originAt !== undefined &&
            unwrapJavaScriptExpression(current.originAt).node === expression
              ? [{ at: current.originAt, depth: 1 }]
              : []),
          ]),
        });
      } else {
        const references =
          effect === "escape"
            ? escapedReferenceLeaves(
                expression,
                current.path,
                widenedGetterResult,
              )
            : expandedValues(expression, current.path, effect);
        for (const value of references) {
          if (
            value.inherited &&
            current.capturedSelections?.some(
              (capture) => capture.depth === 1 && capture.ownEnumerable,
            )
          )
            continue;
          if (
            value.escapes &&
            (effect !== "escape" ||
              (value.widenedGetterResult && !widenedGetterResult))
          )
            markValue(
              value.node,
              value.path,
              new Set(),
              "escape",
              mutation,
              current.originAt,
              value.ownerInitializer,
              widenedGetterResult || value.widenedGetterResult === true,
              undefined,
              undefined,
              current,
            );
          else if (value.iterableFallbackPath !== undefined)
            deferIterable({
              node: value.node,
              projection: [],
              path: value.path,
              fallbackPath: value.iterableFallbackPath,
              bindings: current.bindings,
              definiteReceiver: false,
              ...(assignedSources === undefined ? {} : { assignedSources }),
              effect,
              originAt: current.originAt,
              memberReadAt: current.memberReadAt,
              capturedSelections: semanticShiftCapturedSelections(
                current.capturedSelections,
                value.path.length - current.path.length,
              ),
              ...(widenedGetterResult ? { widenedGetterResult: true } : {}),
              ...(mutation === undefined ? {} : { mutation }),
            });
          else
            enqueue({
              ...value,
              bindings: current.bindings,
              definiteReceiver:
                current.definiteReceiver &&
                references.length === 1 &&
                value.inherited !== true &&
                value.escapes !== true &&
                value.widenedGetterResult !== true &&
                value.iterableFallbackPath === undefined &&
                value.ownerInitializer === undefined &&
                !t.isAwaitExpression(expression) &&
                current.path.every(
                  (key) => key !== null && typeof key !== "object",
                ) &&
                value.path.every(
                  (key) => key !== null && typeof key !== "object",
                ),
              originAt: current.originAt,
              memberReadAt: current.memberReadAt,
              capturedSelections: semanticNormalizeCapturedSelections([
                ...(semanticShiftCapturedSelections(
                  current.capturedSelections,
                  value.path.length - current.path.length,
                ) ?? []),
                ...(value.capturedSelectionAt === undefined
                  ? []
                  : [
                      {
                        at: value.capturedSelectionAt,
                        depth: value.path.length - current.path.length + 1,
                        ...(value.ownEnumerable
                          ? { ownEnumerable: true as const }
                          : {}),
                      },
                    ]),
              ]),
            });
        }
      }
    }
  };
  const markEscaped = (
    node: t.Node,
    mutation: t.Node,
    path: PropertyPath = [],
  ): void => markValue(node, path, new Set(), "escape", mutation);
  function expandedValues(
    expression: t.Node,
    path: PropertyPath,
    effect: ValueEffect,
    widenedGetterResult = false,
  ): readonly ReferencedValue[] {
    if (
      t.isArrayExpression(expression) &&
      ((path[0] === "__proto__" &&
        (effect === "escape" || path.length > 1) &&
        arrayPrototypeIterationMayChange(path.slice(1))) ||
        (path[0] === "constructor" &&
          path[1] === "prototype" &&
          arrayPrototypeIterationMayChange(path.slice(2))))
    )
      state.arrayIterationUnknown = true;
    const references = referencedValues(
      expression,
      path,
      effect,
      state,
      widenedGetterResult,
    );
    return widenedGetterResult
      ? references.map((reference) => ({
          ...reference,
          escapes: true,
          widenedGetterResult: true,
        }))
      : references;
  }
  // Expanding a value below its references depends only on syntax, not on the
  // escape site. Escaping an object reaches every method's results, so
  // re-expanding it at each call through that object made N calls over N
  // methods quadratic. Identifiers that resolve to the same binding and path
  // are processed identically, so one stands for all of them.
  const escapedLeaves = new WeakMap<
    t.Node,
    Map<string, readonly ReferencedValue[]>
  >();
  function escapedReferenceLeaves(
    root: t.Node,
    rootPath: PropertyPath,
    widenedGetterResult: boolean,
  ): readonly ReferencedValue[] {
    // Parser recovery can leave an argument hole, which expands to nothing.
    if (!t.isNode(root)) return [];
    const rootKey = JSON.stringify([rootPath, widenedGetterResult]);
    const cached = escapedLeaves.get(root)?.get(rootKey);
    if (cached !== undefined) return cached;
    const leaves = collectEscapedLeaves([
      ...expandedValues(root, rootPath, "escape", widenedGetterResult),
    ]);
    const byPath = escapedLeaves.get(root) ?? new Map();
    byPath.set(rootKey, leaves);
    escapedLeaves.set(root, byPath);
    return leaves;
  }
  function retainEscapedLeaf(
    value: ReferencedValue,
    node: t.Node,
    leaves: ReferencedValue[],
    identities: Set<string>,
  ): boolean {
    if (
      value.iterableFallbackPath !== undefined ||
      t.isMemberExpression(node) ||
      t.isOptionalMemberExpression(node)
    ) {
      leaves.push(value);
      return true;
    }
    if (!t.isIdentifier(node)) return false;
    const binding = resolveBinding(node, node.name);
    const identity = JSON.stringify([
      binding === undefined ? null : binding.bindingId,
      binding === undefined ? node.name : null,
      value.path,
      value.widenedGetterResult === true,
      value.ownerInitializer?.start,
      value.ownerInitializer?.end,
    ]);
    if (!identities.has(identity)) {
      identities.add(identity);
      leaves.push(value);
    }
    return true;
  }
  function collectEscapedLeaves(
    pending: ReferencedValue[],
  ): readonly ReferencedValue[] {
    const leaves: ReferencedValue[] = [];
    const identities = new Set<string>();
    const expanded = new WeakMap<t.Node, Set<string>>();
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const value = pending[cursor];
      if (value === undefined) break;
      const node = unwrapJavaScriptExpression(value.node).node;
      if (!t.isNode(node) || retainEscapedLeaf(value, node, leaves, identities))
        continue;
      const key = JSON.stringify([
        value.path,
        value.widenedGetterResult === true,
      ]);
      const paths = expanded.get(node) ?? new Set<string>();
      if (paths.has(key)) continue;
      paths.add(key);
      expanded.set(node, paths);
      for (const reference of expandedValues(
        node,
        value.path,
        "escape",
        value.widenedGetterResult === true,
      ))
        pending.push(reference);
    }
    return leaves;
  }
  const markReceiver = (callee: t.Node, mutation: t.Node): void => {
    const expression = unwrapJavaScriptExpression(callee).node;
    if (
      (t.isCallExpression(mutation) || t.isOptionalCallExpression(mutation)) &&
      (t.isMemberExpression(expression) ||
        t.isOptionalMemberExpression(expression)) &&
      semanticStaticPropertyKey(expression.property, expression.computed) ===
        "resolve" &&
      ["commonjs-loader", "create-require"].includes(
        semanticRequireLoaderAt(mutation, state, new Set()),
      )
    )
      return;
    if (
      (t.isMemberExpression(expression) ||
        t.isOptionalMemberExpression(expression)) &&
      !state.retainedGlobalCallReceivers.has(expression.object)
    )
      markEscaped(expression.object, mutation);
  };
  const markTarget = (node: t.Node, mutation: t.Node): void => {
    const sources = semanticIterationSources(
      mutation,
      state.parentsByNode.get(mutation) ?? null,
    );
    const sourcesByTarget = new Map<
      t.MemberExpression | t.OptionalMemberExpression,
      SemanticIterationSource[]
    >();
    for (const source of sources) {
      if (source.kind !== "reference-store" || source.target === undefined)
        continue;
      const selected = sourcesByTarget.get(source.target) ?? [];
      selected.push(source);
      sourcesByTarget.set(source.target, selected);
    }
    for (const target of semanticWriteTargets(node))
      if (!t.isIdentifier(target))
        markValue(
          target.object,
          [semanticStaticPropertyKey(target.property, target.computed)],
          new Set(),
          "write",
          mutation,
          mutation,
          undefined,
          false,
          sourcesByTarget.get(target) ?? [],
        );
  };
  const writeOnlyMembers = new WeakSet<t.Node>();
  yield* traverseJavaScriptValueAstSteps(program, state.erasedSyntaxNodes, {
    enter: (node, parent, readAncestors) => {
      const writeTarget = semanticWriteSiteTarget(node);
      if (writeTarget !== null && !semanticWriteSiteReadsFirst(node))
        for (const target of semanticWriteTargets(writeTarget))
          writeOnlyMembers.add(target);
      for (const source of semanticIterationSources(node, parent)) {
        // Local stores retain their sources on member writes. Only the ambient
        // identity owner can establish that storing itself exposes a reference.
        if (
          source.kind === "reference-store" &&
          source.target !== undefined &&
          !state.escapingReferenceStores.has(source.target) &&
          (localAccessorMethods(
            source.target.object,
            [
              semanticStaticPropertyKey(
                source.target.property,
                source.target.computed,
              ),
            ],
            "set",
            state,
            accessorKeyMayExist,
          )?.length ?? 1) === 0
        )
          continue;
        deferIterable({
          ...source,
          path: source.projection,
          fallbackPath: source.projection,
          bindings: new Set(),
          effect: "escape",
          originAt: source.mutation,
          iterationOnly: source.kind === "iteration",
        });
      }
      for (const operand of semanticCoercionOperands(node, (operand) => {
        const value = evaluateSemanticExpression(operand, state, node);
        return value.status === "object" || value.status === "array";
      }))
        if (!semanticKnownSymbolKey(operand, state)) markEscaped(operand, node);
      if (t.isTemplateLiteral(node) && !t.isTaggedTemplateExpression(parent))
        for (const expression of node.expressions)
          markEscaped(expression, node);
      if (
        t.isVariableDeclarator(node) &&
        t.isVariableDeclaration(parent) &&
        (parent.kind === "using" || parent.kind === "await using")
      ) {
        const scope = readAncestors().findLast(
          (ancestor) =>
            t.isBlockStatement(ancestor) ||
            t.isProgram(ancestor) ||
            t.isStaticBlock(ancestor) ||
            t.isSwitchStatement(ancestor) ||
            t.isLoop(ancestor),
        );
        if (scope !== undefined) {
          const exit = semanticScopeExitEffect(scope);
          if (t.isIdentifier(node.id))
            markValue(
              node.id,
              [],
              new Set(),
              "escape",
              exit,
              node.id,
              node.init ?? undefined,
            );
          else if (node.init != null) markEscaped(node.init, exit);
        }
      }
      for (const source of semanticPropertyReadSources(node, parent)) {
        if (semanticReferenceSourcesInactive(source, state)) continue;
        for (const effect of getterEffects(
          source.node,
          source.projection,
          source.lookup,
        ))
          markEscaped(effect.node, source.mutation, effect.path);
      }
      if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
        // The write owner classifies direct and destructuring stores once.
        if (!writeOnlyMembers.has(node))
          for (const effect of getterEffects(node.object, [
            semanticStaticPropertyKey(node.property, node.computed),
          ]))
            markEscaped(effect.node, node, effect.path);
      }
      if (writeTarget !== null) markTarget(writeTarget, node);
      else if (
        t.isCallExpression(node) ||
        t.isOptionalCallExpression(node) ||
        t.isNewExpression(node)
      ) {
        for (const source of returnedReferences(node.callee).references)
          markEscaped(source.node, node, source.projection);
        for (const argument of node.arguments)
          if (t.isSpreadElement(argument))
            deferIterable({
              node: argument.argument,
              projection: [],
              path: [null],
              fallbackPath: [],
              bindings: new Set(),
              effect: "escape",
              mutation: node,
              originAt: node,
            });
          else markEscaped(argument, node);
        // Constructing a member does not pass its container as `this`.
        if (!t.isNewExpression(node)) {
          const mapLookup = isIntrinsicMapLookup(node, state);
          if (mapLookup === undefined) deferredMapReceivers.add(node);
          else if (!mapLookup) markReceiver(node.callee, node);
        }
      } else if (t.isTaggedTemplateExpression(node)) {
        for (const source of returnedReferences(node.tag).references)
          markEscaped(source.node, node, source.projection);
        markReceiver(node.tag, node);
        for (const expression of node.quasi.expressions)
          markEscaped(expression, node);
      }
    },
  });
  // A later effect can make a previously defined destructuring source uncertain.
  // Reconsider defaults and iterable origins until their effects are stable.
  while (
    pendingReferences.length > 0 ||
    iterableReferences.length > 0 ||
    deferredMapReceivers.size > 0
  ) {
    const effectsBefore = recordedEffectCount;
    const iterablesBefore = iterableReferences.length;
    const iterationBefore: boolean = state.arrayIterationUnknown;
    for (const [index, reference] of pendingReferences.splice(0).entries()) {
      if (index % 64 === 0) yield;
      const { initializer } = reference;
      if (semanticReferenceSourcesInactive(initializer, state))
        pendingReferences.push(reference);
      else if (t.isForOfStatement(initializer.node))
        deferIterable({
          node: initializer.node.right,
          projection: [],
          path: [null, ...reference.path],
          fallbackPath: [],
          bindings: reference.bindings,
          definiteReceiver: false,
          ...(reference.assignedSources === undefined
            ? {}
            : { assignedSources: reference.assignedSources }),
          effect: reference.effect,
          ...(reference.widenedGetterResult
            ? { widenedGetterResult: true }
            : {}),
          originAt: initializer.node,
          memberReadAt: reference.memberReadAt,
          capturedSelections: reference.capturedSelections,
          ...(reference.mutation === undefined
            ? {}
            : { mutation: reference.mutation }),
        });
      else if (
        initializer.copyKind === "array-rest" &&
        initializer.copyProjectionOffset !== undefined
      ) {
        const offset = initializer.copyProjectionOffset;
        const projection = initializer.projection.slice(0, offset);
        deferIterable({
          node: initializer.node,
          projection,
          path: reference.path,
          fallbackPath: projection,
          bindings: reference.bindings,
          definiteReceiver: false,
          ...(reference.assignedSources === undefined
            ? {}
            : { assignedSources: reference.assignedSources }),
          effect: reference.effect,
          ...(reference.widenedGetterResult
            ? { widenedGetterResult: true }
            : {}),
          originAt: reference.originAt,
          memberReadAt: reference.memberReadAt,
          capturedSelections: reference.capturedSelections,
          ...(reference.mutation === undefined
            ? {}
            : { mutation: reference.mutation }),
        });
      } else
        markValue(
          initializer.node,
          reference.path,
          reference.bindings,
          reference.effect,
          reference.mutation,
          reference.originAt,
          undefined,
          reference.widenedGetterResult === true,
          reference.assignedSources,
          reference.definiteReceiver,
          reference,
        );
    }
    for (const [index, reference] of [...iterableReferences].entries()) {
      if (index % 64 === 0) yield;
      if (semanticReferenceSourcesInactive(reference, state)) continue;
      if (reference.iterationOnly) {
        const expanded = expandedIterationReferences(reference, state);
        if (expanded !== null) {
          for (const selected of expanded) deferIterable(selected);
          continue;
        }
      }
      const slot = semanticSelectedReferenceSlot(reference, state);
      // Custom iteration can yield the iterable itself as well as any child.
      // Treat its root as escaped, including writes through yielded references.
      const knownArray = semanticKnownArrayIteration(slot?.value, state);
      if (knownArray && reference.iterationOnly) continue;
      markValue(
        reference.node,
        knownArray ? reference.path : reference.fallbackPath,
        reference.bindings,
        knownArray ? reference.effect : "escape",
        reference.mutation,
        reference.originAt,
        undefined,
        reference.widenedGetterResult === true,
        reference.assignedSources,
        reference.definiteReceiver === true,
        reference,
      );
    }
    // Native Map lookup methods do not expose their receiver to user code.
    // Settle genuine effects first, then replay every unproven receiver escape.
    // Keep proven sites until convergence: later propagated effects can revoke them.
    let receiverIndex = 0;
    for (const node of deferredMapReceivers) {
      if (receiverIndex++ % 64 === 0) yield;
      if (
        isIntrinsicMapLookup(node, state, { referenceMayHaveChangedAt }) ===
        true
      )
        continue;
      deferredMapReceivers.delete(node);
      markReceiver(node.callee, node);
    }
    if (
      recordedEffectCount === effectsBefore &&
      iterableReferences.length === iterablesBefore &&
      state.arrayIterationUnknown === iterationBefore
    )
      break;
  }
  // Gathering effects can evaluate a primitive projection before its object
  // escapes. Final values must use the completed mutation state.
  clearSemanticValueCaches(state);
}

interface ReferencedValue extends JavaScriptSemanticObjectReference {
  readonly iterableFallbackPath?: PropertyPath;
}

interface IterableReference extends ReferencedValue, MutationSelectionContext {
  readonly projection: PropertyPath;
  readonly fallbackPath: PropertyPath;
  readonly bindings: ReadonlySet<string>;
  readonly effect: ValueEffect;
  readonly mutation?: t.Node;
  readonly originAt: t.Node | undefined;
  readonly iterationOnly?: boolean;
  readonly definiteReceiver?: boolean;
  readonly assignedSources?: readonly SemanticIterationSource[];
  readonly requiredSources?: NonNullable<
    SemanticIterationSource["requiredSources"]
  >;
  readonly fallbackSources?: NonNullable<
    SemanticIterationSource["fallbackSources"]
  >;
}

const expandedIterationReferences = (
  reference: IterableReference,
  state: JavaScriptSemanticAnalysisState,
): readonly IterableReference[] | null => {
  if (!t.isForOfStatement(reference.mutation)) return null;
  const iterable = reference.mutation.right;
  // Expand only the loop's yielded-item selector. Enumerating dynamic property
  // selections would multiply paths through shared object aliases.
  const source = [
    reference,
    ...(reference.requiredSources ?? []),
    ...(reference.fallbackSources ?? []),
  ].find((source) => source.node === iterable && source.projection[0] === null);
  if (source === undefined) return null;
  const slot = semanticSelectedReferenceSlot(
    { node: iterable, projection: [] },
    state,
  );
  const container = slot === undefined ? null : semanticContainer(slot.value);
  if (container?.coverage.status !== "complete") return null;
  const select = (
    candidate: { readonly node: t.Node; readonly projection: PropertyPath },
    name: string,
  ) => ({
    ...candidate,
    projection:
      candidate.node === iterable && candidate.projection[0] === null
        ? [name, ...candidate.projection.slice(1)]
        : candidate.projection,
  });
  return container.slots.map((slot) => {
    const { projection } = select(reference, slot.name);
    return {
      ...reference,
      projection,
      path: projection,
      fallbackPath: projection,
      ...(reference.requiredSources === undefined
        ? {}
        : {
            requiredSources: reference.requiredSources.map((source) =>
              select(source, slot.name),
            ),
          }),
      ...(reference.fallbackSources === undefined
        ? {}
        : {
            fallbackSources: reference.fallbackSources.map((source) =>
              select(source, slot.name),
            ),
          }),
    };
  });
};

const referencedValues = (
  node: t.Node,
  path: PropertyPath,
  effect: ValueEffect,
  state: JavaScriptSemanticAnalysisState,
  widenedGetterResult = false,
): readonly ReferencedValue[] => {
  if (effect === "escape" && t.isFunction(node))
    return semanticCallableResultExpressions(node).flatMap(
      ({ node, delegated }) =>
        node === null ? [] : [{ node, path: delegated ? [null] : [] }],
    );
  // An initializer owns its slots; only deeper writes can affect shared children.
  if (t.isObjectExpression(node) || t.isArrayExpression(node)) {
    if (effect === "write" && path.length < 2) return [];
    return t.isObjectExpression(node)
      ? semanticObjectPropertyReferences(node, path, state)
      : semanticArrayPropertyReferences(node, path);
  }
  if (t.isClass(node) || t.isNewExpression(node))
    return constructedReferenceValues(
      node,
      path,
      effect,
      state,
      widenedGetterResult,
    );
  return branchReferenceValues(node, path);
};

const constructedReferenceValues = (
  node: t.ClassDeclaration | t.ClassExpression | t.NewExpression,
  path: PropertyPath,
  effect: ValueEffect,
  state: JavaScriptSemanticAnalysisState,
  widenedGetterResult: boolean,
): readonly ReferencedValue[] => {
  // Exposing a constructed receiver also exposes its retained field references,
  // just as exposing an object literal exposes its children. Widened results
  // retain that reachability after a suffix was lost.
  const [
    key = effect === "escape" || widenedGetterResult ? null : undefined,
    ...remaining
  ] = path;
  // Replacing a receiver property does not mutate the object it previously held.
  if (key === undefined || (effect === "write" && remaining.length === 0))
    return [];
  const classes = t.isClass(node)
    ? [node]
    : semanticClassCandidates(node.callee, state);
  return classes.flatMap((owner) =>
    semanticClassPropertyReferences(
      { owner, kind: t.isClass(node) ? "static" : "instance" },
      [key, ...remaining],
      state,
    ),
  );
};

const branchReferenceValues = (
  node: t.Node,
  path: PropertyPath,
): readonly ReferencedValue[] => {
  if (t.isAssignmentExpression(node))
    return node.operator === "||=" || node.operator === "??="
      ? [
          { node: node.left, path },
          { node: node.right, path },
        ]
      : [{ node: node.right, path }];
  if (t.isAwaitExpression(node)) return [{ node: node.argument, path }];
  if (t.isSequenceExpression(node)) {
    const last = node.expressions.at(-1);
    return last === undefined ? [] : [{ node: last, path }];
  }
  if (t.isConditionalExpression(node))
    return [
      { node: node.consequent, path },
      { node: node.alternate, path },
    ];
  if (t.isLogicalExpression(node))
    return [
      { node: node.left, path },
      { node: node.right, path },
    ];
  return [];
};

type MutationObservableOrigin =
  | t.ObjectExpression
  | t.ArrayExpression
  | t.ClassDeclaration
  | t.ClassExpression
  | t.NewExpression
  | "ambient"
  | "array"
  | "array-prototype"
  | "typed-array"
  | "typed-array-element"
  | "function"
  | "opaque";

interface MutationObserverNode {
  origins?: Set<MutationObservableOrigin>;
  sources?: Set<MutationObserverNode>;
  dependents?: Set<MutationObserverNode>;
  projections?: Map<string, MutationObserverNode>;
  readonly read?: {
    readonly source: MutationObserverNode;
    readonly key: PropertyPath[number];
    readonly numericIndex: boolean;
  };
}

const observableMutationPaths = (
  state: JavaScriptSemanticAnalysisState,
): {
  readonly normalize: (
    bindingId: string,
    path: PropertyPath,
    effect: ValueEffect,
  ) => PropertyPath | null;
  readonly repeatsUnpruned: (
    bindingId: string,
    base: PropertyPath,
    segment: PropertyPath,
  ) => boolean;
} => {
  const ambientPaths = createAmbientPathResolver(state, false);
  const bindingNodes = new Map<string, MutationObserverNode>();
  const expressions = new WeakMap<t.Node, MutationObserverNode>();
  const pendingExpressions: {
    readonly expression: t.Node;
    readonly observer: MutationObserverNode;
  }[] = [];
  const pending: MutationObserverNode[] = [];
  const queued = new Set<MutationObserverNode>();
  const schedule = (node: MutationObserverNode): void => {
    if (queued.has(node)) return;
    queued.add(node);
    pending.push(node);
  };
  const create = (read?: MutationObserverNode["read"]): MutationObserverNode =>
    // Most bindings have no object origin or property projection. Materialize
    // each collection only when it contains a fact or relationship.
    read === undefined ? {} : { read };
  const link = (
    source: MutationObserverNode,
    target: MutationObserverNode,
  ): void => {
    if (target.sources?.has(source) === true) return;
    (target.sources ??= new Set()).add(source);
    (source.dependents ??= new Set()).add(target);
    schedule(target);
  };
  const expressionNode = (node: t.Node): MutationObserverNode => {
    const expression = unwrapJavaScriptExpression(node).node;
    const existing = expressions.get(expression);
    if (existing !== undefined) return existing;
    const observer = create();
    expressions.set(expression, observer);
    pendingExpressions.push({ expression, observer });
    return observer;
  };
  const project = (
    source: MutationObserverNode,
    path: PropertyPath,
    numericIndex = false,
  ): MutationObserverNode => {
    let observer = source;
    for (const key of path) {
      const identity = `${numericIndex ? "numeric:" : ""}${JSON.stringify(
        key === null || typeof key === "object" ? key : String(key),
      )}`;
      let selected = observer.projections?.get(identity);
      if (selected === undefined) {
        selected = create({ source: observer, key, numericIndex });
        (observer.projections ??= new Map()).set(identity, selected);
        (observer.dependents ??= new Set()).add(selected);
        schedule(selected);
      }
      observer = selected;
    }
    return observer;
  };
  for (const binding of state.bindingsById.values())
    bindingNodes.set(binding.bindingId, create());
  for (const binding of state.bindingsById.values()) {
    const observer = bindingNodes.get(binding.bindingId);
    if (observer === undefined) continue;
    // Parameters, caught values and imports can have observable member slots
    // without a local object-allocation node (for example a
    // CommonJS namespace from `require("node:fs")`). Keep those writes at their
    // exact member paths instead of widening the first path to a wildcard.
    const hasParsedRequireOrigin = binding.initializers.some(
      ({ node }) =>
        semanticRequireOrigin(node, state) !== undefined ||
        hasSemanticCreateRequireFactoryOrigin(node, state),
    );
    if (
      binding.kind === "parameter" ||
      binding.kind === "catch" ||
      binding.directOrigins.length > 0 ||
      hasParsedRequireOrigin ||
      binding.hostOrigin !== undefined
    )
      (observer.origins ??= new Set()).add("opaque");
    for (const initializer of binding.initializers) {
      link(
        project(expressionNode(initializer.node), initializer.projection),
        observer,
      );
    }
    // Preserve exact paths where copies, defaults or iteration need their
    // reference-specific projections; an opaque origin prevents pruning.
    if (binding.referenceInitializers.length > 0)
      (observer.origins ??= new Set()).add("opaque");
    for (const initializer of binding.referenceInitializers) {
      for (const source of [
        initializer,
        ...(initializer.requiredSources ?? []),
        ...(initializer.fallbackSources ?? []),
      ])
        link(expressionNode(source.node), observer);
    }
  }
  const settle = (): void => {
    while (pendingExpressions.length > 0 || pending.length > 0) {
      while (pendingExpressions.length > 0) {
        const selected = pendingExpressions.pop();
        if (selected === undefined) break;
        const { expression, observer } = selected;
        if (t.isFunction(expression))
          // Keep own-member writes precise without replacing the existing
          // links to references handed to a function's eventual caller.
          (observer.origins ??= new Set()).add("function");
        // Keep class/getter projections distinct so cycle pruning does not
        // discard observable escapes through a shared getter result.
        if (
          t.isNewExpression(expression) &&
          isIntrinsicTypedArrayConstruction(expression, state)
        )
          (observer.origins ??= new Set()).add("typed-array");
        else if (
          t.isNewExpression(expression) &&
          semanticClassCandidates(expression.callee, state).length === 0
        )
          (observer.origins ??= new Set()).add("opaque");
        else if (
          t.isObjectExpression(expression) ||
          t.isArrayExpression(expression) ||
          t.isClass(expression) ||
          t.isNewExpression(expression)
        )
          (observer.origins ??= new Set()).add(expression);
        else if (t.isIdentifier(expression)) {
          const binding = resolveSemanticBindingState(
            state,
            expression,
            expression.name,
          );
          if (binding !== undefined) {
            const origin = bindingNodes.get(binding.bindingId);
            if (origin !== undefined) link(origin, observer);
          } else if (expression.name === "Array")
            (observer.origins ??= new Set()).add("array");
          else if (
            ["globalThis", "global", "window", "self"].includes(expression.name)
          )
            (observer.origins ??= new Set()).add("ambient");
          else if (ambientPaths(expression).paths.length > 0)
            (observer.origins ??= new Set()).add("opaque");
        } else if (
          t.isMemberExpression(expression) ||
          t.isOptionalMemberExpression(expression)
        )
          link(
            project(
              expressionNode(expression.object),
              [
                semanticStaticPropertyKey(
                  expression.property,
                  expression.computed,
                ),
              ],
              isTypedArrayNumericIndex(
                expression.property,
                expression.computed,
              ),
            ),
            observer,
          );
        else
          for (const reference of referencedValues(
            expression,
            [],
            "escape",
            state,
          ))
            link(
              project(expressionNode(reference.node), reference.path),
              observer,
            );
        schedule(observer);
      }
      const observer = pending.pop();
      if (observer === undefined) continue;
      queued.delete(observer);
      let changed = false;
      const add = (origin: MutationObservableOrigin): void => {
        if (observer.origins?.has(origin) === true) return;
        (observer.origins ??= new Set()).add(origin);
        changed = true;
      };
      for (const source of observer.sources ?? [])
        for (const origin of source.origins ?? []) add(origin);
      if (observer.read !== undefined) {
        const { source, key, numericIndex } = observer.read;
        if (key === null || typeof key === "object") {
          // Dynamic keys and copied-slot masks retain their original paths.
          // Enumerating their exclusion combinations would recreate the growth
          // that the mutation collector's selection union already prevents.
          for (const origin of source.origins ?? [])
            add(
              origin === "typed-array" && numericIndex
                ? "typed-array-element"
                : "opaque",
            );
        } else
          for (const origin of source.origins ?? []) {
            if (typeof origin === "string") {
              if (origin === "typed-array") {
                // Custom properties can hold references; only canonical numeric
                // indices have the native Number/BigInt/undefined result contract.
                add(numericIndex ? "typed-array-element" : "opaque");
              } else if (origin === "typed-array-element") {
                // Number/BigInt property reads can expose constructors, methods
                // or objects returned by prototype getters after boxing.
                add("opaque");
              } else if (origin === "array-prototype" || origin === "opaque")
                add(origin);
              else if (origin === "ambient")
                add(
                  semanticPropertyPathKeyMatches(key, "Array")
                    ? "array"
                    : "opaque",
                );
              else if (
                origin === "array" &&
                semanticPropertyPathKeyMatches(key, "prototype")
              )
                add("array-prototype");
            } else {
              for (const reference of referencedValues(
                origin,
                [key],
                "escape",
                state,
              )) {
                link(
                  project(expressionNode(reference.node), reference.path),
                  observer,
                );
                if (reference.iterableFallbackPath !== undefined)
                  link(
                    project(
                      expressionNode(reference.node),
                      reference.iterableFallbackPath,
                    ),
                    observer,
                  );
              }
            }
          }
      }
      if (changed)
        for (const dependent of observer.dependents ?? []) schedule(dependent);
    }
  };
  settle();
  const normalize = (
    bindingId: string,
    path: PropertyPath,
    effect: ValueEffect,
  ): PropertyPath | null => {
    let observer = bindingNodes.get(bindingId);
    if (observer === undefined) return path;
    if (
      effect === "escape" &&
      !path.some((key) => key !== null && typeof key === "object")
    ) {
      observer = project(observer, path);
      settle();
      const origins = observer.origins;
      return origins === undefined ||
        origins.size === 0 ||
        (origins.size === 1 && origins.has("typed-array-element"))
        ? null
        : path;
    }
    if ((observer.origins?.size ?? 0) === 0)
      return path.length === 0 ? path : [null];
    for (let offset = 0; offset < path.length; offset++) {
      const key = path[offset];
      if (key === undefined) break;
      // Copied-slot masks remain symbolic. An unobserved exact prefix before
      // the mask still ends a growing path; do not skip that prefix entirely.
      if (key !== null && typeof key === "object") break;
      observer = project(observer, [key]);
      settle();
      if ((observer.origins?.size ?? 0) === 0 && offset + 1 < path.length)
        return [...path.slice(0, offset + 1), null];
    }
    return path;
  };
  // A projection's origins depend only on its source origins and key. Once
  // repeating a segment after its base revisits an origin set, every longer
  // repetition stays observable and normalization can never prune it. The
  // answer depends only on the binding, base and segment, so every revisit of
  // a long chain shares it.
  const repeated = new Map<string, boolean>();
  const repeatsUnpruned = (
    bindingId: string,
    base: PropertyPath,
    segment: PropertyPath,
  ): boolean => {
    const key = JSON.stringify([bindingId, base, segment]);
    const cached = repeated.get(key);
    if (cached !== undefined) return cached;
    let observer = bindingNodes.get(bindingId);
    if (observer !== undefined && base.length > 0) {
      observer = project(observer, base);
      settle();
    }
    const signatures = new Set<string>();
    let result = false;
    while (observer !== undefined && segment.length > 0) {
      observer = project(observer, segment);
      settle();
      if ((observer.origins?.size ?? 0) === 0) break;
      const signature = JSON.stringify(
        [...(observer.origins ?? [])]
          .map((origin) =>
            typeof origin === "string"
              ? origin
              : `${String(origin.start)}:${String(origin.end)}`,
          )
          .sort(compareUnicodeCodePoints),
      );
      if (signatures.has(signature)) {
        result = true;
        break;
      }
      signatures.add(signature);
    }
    repeated.set(key, result);
    return result;
  };
  return { normalize, repeatsUnpruned };
};
