import * as t from "@babel/types";

import {
  semanticStaticPropertyKey,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import {
  semanticCallableResultExpressions,
  semanticCallableResultKind,
} from "./javascriptSemanticCallableResults.js";
import {
  javaScriptSourceInvocationContext,
  javaScriptGenericInvocationMethod,
  resolveJavaScriptGenericInvocation,
  type JavaScriptSourceInvocationContext,
} from "./javascriptIntrinsicInvocation.js";
import {
  semanticBindingAtRead,
  semanticEffectTiming,
} from "./javascriptSemanticMutationInitializers.js";
import {
  semanticReferenceSourcesInactive,
  semanticKnownArrayIteration,
  semanticKnownArrayIterationAt,
  semanticSelectedReferenceSlot,
} from "./javascriptSemanticReferenceSources.js";
import { semanticArrayPropertyReferences } from "./javascriptSemanticObjectReferences.js";
import {
  semanticNormalizeCapturedSelections,
  semanticProjectedSourcesAtRead,
  semanticShiftCapturedSelections,
  type SemanticCapturedSelection,
} from "./javascriptSemanticProjectedSources.js";
import { SEMANTIC_ALIAS_SELECTION_LIMIT } from "./javascriptSemanticResourceLimits.js";
import {
  semanticPropertyPathKeyMatches,
  type JavaScriptSemanticPropertyPath,
} from "./javascriptSemanticPropertyPaths.js";
import {
  SemanticAliasSelections,
  semanticAliasSelectionChoices,
  type SemanticAliasSelectionPath,
} from "./javascriptSemanticAliasSelections.js";
import {
  resolveSemanticBindingState,
  type JavaScriptSemanticAnalysisState,
  type JavaScriptSemanticBindingState,
} from "./javascriptSemanticState.js";

/** A reference potentially handed to a caller or generator consumer. */
export interface SemanticReturnedReference {
  readonly node: t.Node;
  readonly projection: JavaScriptSemanticPropertyPath;
}

interface Candidate {
  readonly node: t.Node;
  /** `undefined` means any projection depth after different projection depths merge. */
  readonly path: SemanticAliasSelectionPath | undefined;
  /** Member selection happens at its use, while a captured function keeps its read. */
  readonly readAt?: t.Node;
  readonly capturedSelections?:
    | readonly SemanticCapturedSelection[]
    | undefined;
  readonly invocation?: JavaScriptSourceInvocationContext;
}

export interface SemanticReturnedReferenceResult {
  readonly references: readonly SemanticReturnedReference[];
  /** Source-local callable targets resolved by the same binding/projection owner. */
  readonly callables: ReadonlySet<t.Function>;
  /** A visible invocation-method mutation prevents a source-local result proof. */
  readonly unresolvedInvocation?: boolean;
  /** Both states close the supported source-local may-target graph. Widened joins projections without dropping represented targets; it does not claim runtime completeness. */
  readonly precision: "exact" | "widened";
}

interface ObjectTargetIndex {
  readonly propertyByName: ReadonlyMap<
    string,
    t.ObjectMethod | t.ObjectProperty
  >;
  readonly trailingUnknownsByProperty: ReadonlyMap<
    t.ObjectMethod | t.ObjectProperty,
    ObjectTargetUnknown
  >;
}

interface ObjectTargetUnknown {
  readonly node: t.ObjectMethod | t.ObjectProperty | t.SpreadElement;
  readonly previous: ObjectTargetUnknown | undefined;
}

/** Resolve local result references conservatively, without claiming call execution. */
export const createSemanticReturnedReferences = (
  state: JavaScriptSemanticAnalysisState,
  consumption:
    | "potential-reference"
    | "direct-call"
    | "awaited-call" = "potential-reference",
): ((
  callee: t.Node,
  invocation?: t.CallExpression | t.OptionalCallExpression,
) => SemanticReturnedReferenceResult) => {
  const results = new WeakMap<
    t.Node,
    {
      readonly result: SemanticReturnedReferenceResult;
      readonly invocation: t.Node | undefined;
      readonly iterationUnknown: boolean;
      readonly ambientWrites: number;
      readonly dependencies: readonly {
        readonly binding: JavaScriptSemanticBindingState;
        readonly writes: number;
        readonly escapes: number;
      }[];
    }
  >();
  const objectTargets = new WeakMap<t.ObjectExpression, ObjectTargetIndex>();
  return (callee, invocation) => {
    const existing = results.get(callee);
    if (
      existing !== undefined &&
      existing.invocation === invocation &&
      existing.iterationUnknown === state.arrayIterationUnknown &&
      existing.ambientWrites === state.ambientWriteEffects.length &&
      existing.dependencies.every(
        ({ binding, writes, escapes }) =>
          binding.memberWrites.length === writes &&
          binding.escapedPaths.length === escapes,
      )
    )
      return existing.result;
    const dependencies = new Map<
      JavaScriptSemanticBindingState,
      { readonly writes: number; readonly escapes: number }
    >();
    const functions = new Set<t.Function>();
    const work: Candidate[] = [];
    // A transition depends on the source read and current projection, not the
    // initializer history used to reach it. Keeping history out of the key lets
    // shared diamonds and reassignment cycles converge to the graph fixed point.
    const projectionDepths = new WeakMap<
      t.Node,
      Map<string, number | undefined>
    >();
    const expanded = new WeakMap<t.Node, Set<string>>();
    let additionalContexts = 0;
    let contextsWidened = false;
    const result: {
      references: readonly SemanticReturnedReference[];
      callables: ReadonlySet<t.Function>;
      precision: SemanticReturnedReferenceResult["precision"];
      unresolvedInvocation?: boolean;
    } = { references: [], callables: functions, precision: "exact" };
    // The invocation owner retains the actual callable receiver. A bare alias
    // of fn.call has lost that receiver and cannot execute fn by itself.
    const nativeArrayIteration = (array: t.ArrayExpression) =>
      semanticKnownArrayIterationAt(array, state);
    const sourceInvocation =
      invocation === undefined
        ? undefined
        : javaScriptSourceInvocationContext(invocation, nativeArrayIteration);
    const sourceGenericInvocation =
      invocation !== undefined &&
      javaScriptGenericInvocationMethod(invocation.callee) !== undefined;
    const inheritedInvocationChanged = (method: "call" | "apply"): boolean => {
      if (invocation === undefined) return false;
      const inheritedPath = ["global", "Function", "prototype", method];
      return state.ambientWriteEffects.some(
        (effect) =>
          effect.path.length <= inheritedPath.length &&
          effect.path.every(
            (key, index) =>
              key === null ||
              semanticPropertyPathKeyMatches(key, inheritedPath[index] ?? ""),
          ) &&
          semanticEffectTiming(invocation, effect.node, state) !== "after",
      );
    };
    // Exact finite alternatives retain unrelated keys and cross-path
    // correlations. Growing/shrinking cycles still converge at any depth;
    // selector-budget widening retains the complete may-target closure.
    const selections = new SemanticAliasSelections(() => {
      state.valueResourceLimits.add("alias-selections");
      result.precision = "widened";
    });
    const enqueue = (
      node: t.Node,
      path: Candidate["path"],
      readAt?: t.Node,
      capturedSelections?: readonly SemanticCapturedSelection[],
      invocationContext?: JavaScriptSourceInvocationContext,
    ): void => {
      const source = unwrapJavaScriptExpression(node).node;
      if (contextsWidened) {
        path = undefined;
        capturedSelections = undefined;
        invocationContext = undefined;
      }
      const invocationKey = () =>
        invocationContext === undefined
          ? null
          : [
              invocationContext.receiver?.start,
              invocationContext.receiver?.end,
              invocationContext.receiverUnknown,
              invocationContext.arguments?.map((argument) => [
                argument.start,
                argument.end,
              ]),
            ];
      let readKey = JSON.stringify([
        readAt?.start ?? -1,
        readAt?.end ?? -1,
        invocationKey(),
      ]);
      const depths = projectionDepths.get(source) ?? new Map();
      projectionDepths.set(source, depths);
      if (!depths.has(readKey)) {
        depths.set(readKey, path?.length);
      } else {
        const previous = depths.get(readKey);
        if (previous === undefined || previous !== path?.length) {
          if (previous !== undefined) result.precision = "widened";
          depths.set(readKey, undefined);
          path = undefined;
        }
      }
      if (path !== undefined) path = selections.normalize(source, path);
      capturedSelections =
        path === undefined
          ? undefined
          : semanticNormalizeCapturedSelections(
              capturedSelections,
              path.length,
            );
      const expansionKey = () =>
        JSON.stringify([
          readKey,
          path ?? null,
          capturedSelections?.map(({ at, depth, ownEnumerable }) => [
            at.start,
            at.end,
            depth,
            ownEnumerable,
          ]),
        ]);
      let key = expansionKey();
      const paths = expanded.get(source) ?? new Set<string>();
      if (paths.has(key)) return;
      // Copy/invocation contexts add selector dimensions. Bound them by the
      // same query budget, then visit the complete unknown-projection closure.
      if (
        !contextsWidened &&
        (capturedSelections !== undefined || invocationContext !== undefined) &&
        paths.size > 0 &&
        ++additionalContexts > SEMANTIC_ALIAS_SELECTION_LIMIT
      ) {
        contextsWidened = true;
        state.valueResourceLimits.add("alias-selections");
        result.precision = "widened";
        // Generic transitions select only the source receiver and authored
        // argument values. Keep that complete finite source closure when their
        // precise positional contexts merge, including later callable receivers.
        if (sourceInvocation !== undefined) {
          if (sourceInvocation.receiver !== undefined)
            enqueue(sourceInvocation.receiver, undefined);
          for (const argument of sourceInvocation.arguments ?? [])
            if (t.isExpression(argument)) enqueue(argument, undefined);
            else if (t.isSpreadElement(argument))
              enqueue(argument.argument, undefined);
        }
      }
      if (contextsWidened) {
        path = undefined;
        capturedSelections = undefined;
        invocationContext = undefined;
        readKey = JSON.stringify([
          readAt?.start ?? -1,
          readAt?.end ?? -1,
          null,
        ]);
        if (sourceGenericInvocation) result.unresolvedInvocation = true;
        depths.set(readKey, undefined);
        key = expansionKey();
        if (paths.has(key)) return;
      }
      paths.add(key);
      expanded.set(source, paths);
      work.push({
        node: source,
        path,
        ...(readAt === undefined ? {} : { readAt }),
        ...(capturedSelections === undefined ? {} : { capturedSelections }),
        ...(invocationContext === undefined
          ? {}
          : { invocation: invocationContext }),
      });
    };
    enqueue(callee, [], undefined, undefined, sourceInvocation);
    while (work.length > 0) {
      const current = work.pop();
      if (current === undefined) break;
      const { node } = current;
      // An exact empty selection with an invocation is the value being called,
      // not a container whose callable children are potential escape targets.
      // Ordinary objects and arrays cannot supply that callable receiver. An
      // unknown projection still visits the full closure after budget widening.
      if (
        current.invocation !== undefined &&
        current.path?.length === 0 &&
        (t.isObjectExpression(node) || t.isArrayExpression(node))
      )
        continue;
      const pending: Candidate[] = [];
      if (t.isIdentifier(node)) {
        const binding = resolveSemanticBindingState(state, node, node.name);
        if (binding === undefined) {
          if (sourceGenericInvocation && current.path?.length === 0)
            result.unresolvedInvocation = true;
          continue;
        }
        dependencies.set(binding, {
          writes: binding.memberWrites.length,
          escapes: binding.escapedPaths.length,
        });
        if (current.path !== undefined) {
          if (
            sourceGenericInvocation &&
            current.path.length > 0 &&
            semanticProjectedSourcesAtRead(
              binding,
              node,
              current.path,
              state,
              true,
              // The current invocation receives its callee before its own
              // opaque effects; earlier captured member reads keep their site.
              invocation !== undefined &&
                current.readAt ===
                  unwrapJavaScriptExpression(invocation.callee).node
                ? invocation
                : (current.readAt ?? node),
              current.capturedSelections,
            ) === undefined
          )
            result.unresolvedInvocation = true;
          const selectedSources = semanticProjectedSourcesAtRead(
            binding,
            node,
            current.path,
            state,
            false,
            current.readAt ?? node,
            current.capturedSelections,
          );
          if (selectedSources !== undefined) {
            for (const source of selectedSources) {
              const capturedSelections = [
                ...(semanticShiftCapturedSelections(
                  current.capturedSelections,
                  source.path.length - current.path.length,
                ) ?? []),
                ...(source.capturedSelections ?? []),
              ];
              pending.push({
                ...source,
                ...(current.path.length === 0
                  ? {}
                  : { readAt: current.readAt ?? node }),
                ...(capturedSelections.length === 0
                  ? {}
                  : { capturedSelections }),
              });
            }
            for (let index = pending.length - 1; index >= 0; index--) {
              const child = pending[index];
              if (child !== undefined)
                enqueue(
                  child.node,
                  child.path,
                  child.readAt,
                  child.capturedSelections,
                  child.invocation ?? current.invocation,
                );
            }
            continue;
          }
          result.precision = "widened";
          if (sourceGenericInvocation) result.unresolvedInvocation = true;
        }
        const selected = semanticBindingAtRead(
          binding,
          node,
          state.parentsByNode,
        ).binding;
        for (const initializer of [
          ...selected.initializers,
          ...selected.referenceInitializers,
        ]) {
          if (semanticReferenceSourcesInactive(initializer, state)) continue;
          pending.push({
            node: initializer.node,
            path:
              current.path === undefined
                ? undefined
                : [...initializer.projection, ...current.path],
            ...(current.path?.length === 0
              ? {}
              : { readAt: current.readAt ?? node }),
            ...(current.capturedSelections === undefined
              ? {}
              : {
                  capturedSelections: semanticShiftCapturedSelections(
                    current.capturedSelections,
                    initializer.projection.length,
                  ),
                }),
          });
        }
        if (current.path === undefined)
          for (const effect of binding.memberWrites)
            for (const source of effect.assignedSources ?? [])
              if (!semanticReferenceSourcesInactive(source, state))
                pending.push({ node: source.node, path: undefined });
      } else if (
        t.isMemberExpression(node) ||
        t.isOptionalMemberExpression(node)
      ) {
        const path: (string | number | null)[] = [];
        let receiver: t.Node = node;
        while (
          t.isMemberExpression(receiver) ||
          t.isOptionalMemberExpression(receiver)
        ) {
          path.push(
            semanticStaticPropertyKey(receiver.property, receiver.computed),
          );
          receiver = unwrapJavaScriptExpression(receiver.object).node;
        }
        pending.push({
          ...current,
          node: receiver,
          readAt: current.readAt ?? node,
          ...(current.capturedSelections === undefined
            ? {}
            : {
                capturedSelections: semanticShiftCapturedSelections(
                  current.capturedSelections,
                  path.length,
                ),
              }),
          path:
            current.path === undefined
              ? undefined
              : [...path.reverse(), ...current.path],
        });
      } else if (
        t.isConditionalExpression(node) ||
        t.isLogicalExpression(node)
      ) {
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
      } else if (t.isSequenceExpression(node)) {
        const last = node.expressions.at(-1);
        if (last !== undefined) pending.push({ ...current, node: last });
      } else if (t.isFunction(node)) {
        if (current.path === undefined || current.path.length === 0)
          functions.add(node);
        else if (
          current.invocation !== undefined &&
          current.path.every((key) =>
            semanticAliasSelectionChoices(key).every(
              (choice) => choice === "call" || choice === "apply",
            ),
          )
        ) {
          // Own member writes have already selected their actual RHS above.
          // Only a remaining inherited invocation member reaches this branch.
          const methods = semanticAliasSelectionChoices(
            current.path.at(-1)!,
          ).filter(
            (method): method is "call" | "apply" =>
              method === "call" || method === "apply",
          );
          for (const method of methods) {
            const selected = resolveJavaScriptGenericInvocation(
              method,
              current.invocation,
              nativeArrayIteration,
            );
            if (selected !== undefined)
              pending.push({
                node: selected.callable,
                path: [],
                invocation: selected.context,
              });
            else if (current.invocation.receiverUnknown)
              result.unresolvedInvocation = true;
            if (inheritedInvocationChanged(method))
              result.unresolvedInvocation = true;
          }
        }
      } else if (t.isObjectExpression(node))
        selectObjectTargets(node, current, pending, objectTargets);
      else if (t.isArrayExpression(node)) {
        const [key, ...path] = current.path ?? [];
        if (current.path !== undefined && key !== undefined) {
          for (const choice of semanticAliasSelectionChoices(key))
            for (const source of semanticArrayPropertyReferences(node, [
              choice,
            ])) {
              let projection = source.path;
              if (
                source.capturedSelectionAt !== undefined &&
                !semanticKnownArrayIteration(
                  semanticSelectedReferenceSlot(
                    { node: source.node, projection: [] },
                    state,
                    source.capturedSelectionAt,
                  )?.value,
                  state,
                )
              )
                projection = [null, ...source.path.slice(1)];
              const selectedPath = [...projection, ...path];
              pending.push({
                ...current,
                node: source.node,
                path: selectedPath,
                capturedSelections: [
                  ...(semanticShiftCapturedSelections(
                    current.capturedSelections,
                    selectedPath.length - current.path.length,
                  ) ?? []),
                  ...(source.capturedSelectionAt === undefined
                    ? []
                    : [{ at: source.capturedSelectionAt, depth: 1 }]),
                ],
              });
            }
          for (let index = pending.length - 1; index >= 0; index--) {
            const child = pending[index];
            if (child !== undefined)
              enqueue(
                child.node,
                child.path,
                child.readAt,
                child.capturedSelections,
                child.invocation ?? current.invocation,
              );
          }
          continue;
        }
        let uncertainOffset = false;
        node.elements.forEach((element, offset) => {
          if (element === null) return;
          if (t.isSpreadElement(element)) {
            uncertainOffset = true;
            pending.push({
              ...current,
              node: element.argument,
              path: current.path === undefined ? undefined : [null, ...path],
              capturedSelections: [
                ...(current.capturedSelections ?? []),
                { at: element.argument, depth: 1 },
              ],
            });
          } else if (
            current.path === undefined ||
            key === undefined ||
            uncertainOffset ||
            semanticAliasSelectionChoices(key).some((choice) =>
              semanticPropertyPathKeyMatches(choice, String(offset)),
            )
          )
            pending.push({
              ...current,
              node: element,
              path: current.path === undefined ? undefined : path,
              capturedSelections:
                semanticShiftCapturedSelections(
                  current.capturedSelections,
                  -1,
                ) ?? [],
            });
        });
      } else if (t.isNewExpression(node))
        pending.push({ ...current, node: node.callee });
      else if (t.isClass(node)) {
        const [key, ...path] = current.path ?? [];
        for (const member of node.body.body) {
          if (t.isClassMethod(member)) {
            if (
              ((current.path === undefined || current.path.length === 0) &&
                member.kind === "constructor") ||
              current.path === undefined ||
              (key !== undefined &&
                semanticAliasSelectionChoices(key).some((choice) => {
                  const name = semanticStaticPropertyKey(
                    member.key,
                    member.computed,
                  );
                  return (
                    name === null ||
                    semanticPropertyPathKeyMatches(choice, name)
                  );
                }))
            )
              pending.push({
                ...current,
                node: member,
                path: current.path === undefined ? undefined : path,
                capturedSelections: semanticShiftCapturedSelections(
                  current.capturedSelections,
                  -1,
                ),
              });
          } else if (
            t.isClassProperty(member) &&
            member.value !== null &&
            member.value !== undefined &&
            (key !== undefined || current.path === undefined) &&
            (current.path === undefined ||
              (key !== undefined &&
                semanticAliasSelectionChoices(key).some((choice) => {
                  const name = semanticStaticPropertyKey(
                    member.key,
                    member.computed,
                  );
                  return (
                    name === null ||
                    semanticPropertyPathKeyMatches(choice, name)
                  );
                })))
          )
            pending.push({
              ...current,
              node: member.value,
              path: current.path === undefined ? undefined : path,
              capturedSelections: semanticShiftCapturedSelections(
                current.capturedSelections,
                -1,
              ),
            });
        }
        if (node.superClass !== null && node.superClass !== undefined)
          pending.push({ ...current, node: node.superClass });
      }
      for (let index = pending.length - 1; index >= 0; index--) {
        const child = pending[index];
        if (child !== undefined)
          enqueue(
            child.node,
            child.path,
            child.readAt,
            child.capturedSelections,
            child.invocation ?? current.invocation,
          );
      }
    }
    const output = [...functions].flatMap((callable) => {
      // A direct generator/async call produces a fresh iterator/Promise, not
      // the yielded/resolved contents. Escape analysis still retains those
      // potential references for their eventual consumers.
      const resultKind = semanticCallableResultKind(callable);
      if (
        consumption !== "potential-reference" &&
        (resultKind === "iterator" ||
          resultKind === "async-iterator" ||
          (consumption === "direct-call" && resultKind === "promise"))
      )
        return [];
      return semanticCallableResultExpressions(callable).flatMap(
        ({ node, delegated, kind }) =>
          node === null ||
          (consumption !== "potential-reference" && kind !== "return")
            ? []
            : [{ node, projection: delegated ? [null] : [] }],
      );
    });
    result.references = output;
    results.set(callee, {
      result,
      invocation,
      iterationUnknown: state.arrayIterationUnknown,
      ambientWrites: state.ambientWriteEffects.length,
      dependencies: [...dependencies].map(([binding, counts]) => ({
        binding,
        ...counts,
      })),
    });
    if (result.precision === "widened")
      state.returnedReferenceWidenings.add(callee);
    return result;
  };
};

const selectObjectTargets = (
  node: t.ObjectExpression,
  item: Candidate,
  pending: Candidate[],
  indexes: WeakMap<t.ObjectExpression, ObjectTargetIndex>,
): void => {
  const [key, ...path] = item.path ?? [];
  const childPath = item.path === undefined ? undefined : path;
  if (key !== null && typeof key === "object" && "alternatives" in key) {
    for (const choice of semanticAliasSelectionChoices(key))
      selectObjectTargets(
        node,
        { ...item, path: [choice, ...path] },
        pending,
        indexes,
      );
    return;
  }
  if (key !== null && key !== undefined && typeof key !== "object") {
    const index = objectTargetIndex(node, indexes);
    const property = index.propertyByName.get(String(key));
    if (property !== undefined) {
      const unknowns: ObjectTargetUnknown[] = [];
      for (
        let unknown = index.trailingUnknownsByProperty.get(property);
        unknown !== undefined;
        unknown = unknown.previous
      )
        unknowns.push(unknown);
      for (const { node: unknown } of unknowns.reverse())
        pending.push({
          ...item,
          node: t.isSpreadElement(unknown)
            ? unknown.argument
            : t.isObjectProperty(unknown)
              ? unknown.value
              : unknown,
          ...(t.isSpreadElement(unknown) ? {} : { path: childPath }),
          capturedSelections: t.isSpreadElement(unknown)
            ? [
                ...(item.capturedSelections ?? []),
                { at: unknown.argument, depth: 1, ownEnumerable: true },
              ]
            : (semanticShiftCapturedSelections(item.capturedSelections, -1) ??
              []),
        });
      pending.push({
        ...item,
        node: t.isObjectProperty(property) ? property.value : property,
        path: childPath,
        capturedSelections:
          semanticShiftCapturedSelections(item.capturedSelections, -1) ?? [],
      });
      return;
    }
  }
  let replaced = false;
  for (const property of [...node.properties].reverse()) {
    if (replaced) break;
    if (t.isSpreadElement(property)) {
      pending.push({
        ...item,
        node: property.argument,
        capturedSelections: [
          ...(item.capturedSelections ?? []),
          { at: property.argument, depth: 1, ownEnumerable: true },
        ],
      });
      continue;
    }
    const name = semanticStaticPropertyKey(property.key, property.computed);
    if (
      key !== null &&
      key !== undefined &&
      name !== null &&
      !semanticPropertyPathKeyMatches(key, name)
    )
      continue;
    if (t.isObjectProperty(property))
      pending.push({
        ...item,
        node: property.value,
        path: childPath,
        capturedSelections:
          semanticShiftCapturedSelections(item.capturedSelections, -1) ?? [],
      });
    else
      pending.push({
        ...item,
        node: property,
        path: childPath,
        capturedSelections:
          semanticShiftCapturedSelections(item.capturedSelections, -1) ?? [],
      });
    if (
      key !== null &&
      key !== undefined &&
      typeof key !== "object" &&
      name === String(key)
    )
      replaced = true;
  }
};

const objectTargetIndex = (
  node: t.ObjectExpression,
  indexes: WeakMap<t.ObjectExpression, ObjectTargetIndex>,
): ObjectTargetIndex => {
  const existing = indexes.get(node);
  if (existing !== undefined) return existing;
  const propertyByName = new Map<string, t.ObjectMethod | t.ObjectProperty>();
  const trailingUnknownsByProperty = new Map<
    t.ObjectMethod | t.ObjectProperty,
    ObjectTargetUnknown
  >();
  let trailingUnknown: ObjectTargetUnknown | undefined;
  for (const property of [...node.properties].reverse()) {
    if (t.isSpreadElement(property)) {
      trailingUnknown = { node: property, previous: trailingUnknown };
      continue;
    }
    const name = semanticStaticPropertyKey(property.key, property.computed);
    if (name === null) {
      trailingUnknown = { node: property, previous: trailingUnknown };
      continue;
    }
    if (propertyByName.has(name)) continue;
    propertyByName.set(name, property);
    if (trailingUnknown !== undefined)
      trailingUnknownsByProperty.set(property, trailingUnknown);
  }
  const created = { propertyByName, trailingUnknownsByProperty };
  indexes.set(node, created);
  return created;
};
