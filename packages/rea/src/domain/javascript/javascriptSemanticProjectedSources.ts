import * as t from "@babel/types";
import type {
  JavaScriptSemanticAnalysisState,
  JavaScriptSemanticBindingState,
} from "./javascriptSemanticState.js";
import type { JavaScriptSemanticPropertyPath } from "./javascriptSemanticPropertyPaths.js";
import { unwrapJavaScriptExpression } from "./javascriptAstValues.js";
import {
  semanticObjectPropertyReferences,
  semanticArrayPropertyReferences,
  type JavaScriptSemanticObjectReference,
} from "./javascriptSemanticObjectReferences.js";
import { SEMANTIC_ALIAS_SELECTION_LIMIT } from "./javascriptSemanticResourceLimits.js";
import {
  semanticBindingAtRead,
  semanticDefiniteEffectPrecedesReference,
  semanticEffectTiming,
  semanticTopLevelEffectFollowsCapture,
} from "./javascriptSemanticMutationInitializers.js";
import {
  semanticCopiedReferencePath,
  semanticReferenceIterationUnknown,
  semanticReferenceSourcesInactive,
} from "./javascriptSemanticReferenceSources.js";
import { semanticStoredSourceSelection } from "./javascriptSemanticIterationSources.js";
import {
  semanticEffectPathCandidates,
  semanticEffectPathMatches,
  semanticSomeEffectPathCandidate,
} from "./javascriptSemanticEffectPathIndex.js";
import {
  semanticAliasSelectionChoices,
  type SemanticAliasSelectionPath,
} from "./javascriptSemanticAliasSelections.js";

export interface SemanticCapturedSelection {
  readonly at: t.Node;
  readonly depth: number;
  /** Object spread/rest reads only an own enumerable slot at this depth. */
  readonly ownEnumerable?: true;
}

/** The next origin crossed owns a repeated copy boundary at the same depth. */
export const semanticNormalizeCapturedSelections = (
  selections: readonly SemanticCapturedSelection[] | undefined,
  pathLength?: number,
): readonly SemanticCapturedSelection[] | undefined => {
  const byDepth = new Map<number, SemanticCapturedSelection>();
  for (const capture of selections ?? [])
    if (
      capture.depth > 0 &&
      (pathLength === undefined || capture.depth <= pathLength)
    )
      byDepth.set(capture.depth, capture);
  const normalized = [...byDepth.values()].sort(
    (left, right) => left.depth - right.depth,
  );
  return normalized.length ? normalized : undefined;
};

/** Keep capture boundaries aligned as a selected prefix is added or consumed. */
export const semanticShiftCapturedSelections = (
  selections: readonly SemanticCapturedSelection[] | undefined,
  delta: number,
): readonly SemanticCapturedSelection[] | undefined => {
  const shifted = selections?.flatMap((selection) =>
    selection.depth + delta > 0
      ? [{ ...selection, depth: selection.depth + delta }]
      : [],
  );
  return semanticNormalizeCapturedSelections(shifted);
};

/** Record an object/array property selected when a shallow copy was made. */
export const semanticCapturedSelectionsAfterPropertyRead = (
  selections: readonly SemanticCapturedSelection[] | undefined,
  source: Pick<
    JavaScriptSemanticObjectReference,
    "path" | "capturedSelectionAt" | "ownEnumerable"
  >,
): readonly SemanticCapturedSelection[] => [
  ...(semanticShiftCapturedSelections(selections, source.path.length - 1) ??
    []),
  ...(source.capturedSelectionAt === undefined
    ? []
    : [
        {
          at: source.capturedSelectionAt,
          depth: source.path.length,
          ...(source.ownEnumerable ? { ownEnumerable: true as const } : {}),
        },
      ]),
];

interface ProjectedSource {
  readonly node: t.Node;
  readonly path: SemanticAliasSelectionPath;
  readonly capturedSelections?: readonly SemanticCapturedSelection[];
}

/** A fresh parent does not prove a descendant receiver is a fresh allocation. */
const hasFreshProjectedReceiver = (
  root: t.Node,
  path: JavaScriptSemanticPropertyPath,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  const pending = [{ node: root, path }];
  const examined = new WeakMap<t.Node, Set<string>>();
  let selections = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    const node = unwrapJavaScriptExpression(current.node).node;
    const key = JSON.stringify(current.path);
    const paths = examined.get(node) ?? new Set<string>();
    if (paths.has(key)) return false;
    paths.add(key);
    examined.set(node, paths);
    if (++selections > SEMANTIC_ALIAS_SELECTION_LIMIT) {
      state.valueResourceLimits.add("alias-selections");
      return false;
    }
    if (current.path.length === 0) {
      if (
        !t.isObjectExpression(node) &&
        !t.isArrayExpression(node) &&
        !t.isFunction(node) &&
        !t.isClassExpression(node)
      )
        return false;
      continue;
    }
    const [selected, ...remaining] = current.path;
    const sources = t.isObjectExpression(node)
      ? semanticObjectPropertyReferences(node, [selected!], state)
      : t.isArrayExpression(node)
        ? semanticArrayPropertyReferences(node, [selected!])
        : [];
    if (sources.length === 0) return false;
    if (
      selections + pending.length + sources.length >
      SEMANTIC_ALIAS_SELECTION_LIMIT
    ) {
      state.valueResourceLimits.add("alias-selections");
      return false;
    }
    pending.push(
      ...sources.map((source) => ({
        node: source.node,
        path: [...source.path, ...remaining],
      })),
    );
  }
  return true;
};

/** Select retained assignment and copy sources at one projected member read. */
export const semanticProjectedSourcesAtRead = (
  ...arguments_: Parameters<typeof semanticProjectedSourceFactsAtRead>
): readonly ProjectedSource[] | undefined =>
  semanticProjectedSourceFactsAtRead(...arguments_)?.sources;

/** Retain the selected receiver's possible owners after its current value becomes opaque. */
export const semanticProjectedSourceEligibilityAtRead = (
  binding: JavaScriptSemanticBindingState,
  reference: t.Node,
  path: SemanticAliasSelectionPath,
  state: JavaScriptSemanticAnalysisState,
  memberReadAt: t.Node = reference,
  capturedSelections: readonly SemanticCapturedSelection[] = [],
): readonly ProjectedSource[] | undefined =>
  projectedSourceFactsAtRead(
    binding,
    reference,
    path,
    state,
    false,
    memberReadAt,
    capturedSelections,
    true,
  )?.sources;

/** Keep imported origins subject to the same selected writes as other values. */
// Projection alternatives are introduced by callers. An ordinary property path
// remains ordinary while the owner selects stored and copied source prefixes.
export function semanticProjectedSourceFactsAtRead(
  binding: JavaScriptSemanticBindingState,
  reference: t.Node,
  path: JavaScriptSemanticPropertyPath,
  state: JavaScriptSemanticAnalysisState,
  includeUnknown: boolean,
  memberReadAt?: t.Node,
  capturedSelections?: readonly SemanticCapturedSelection[],
  retainEligibility?: boolean,
):
  | {
      readonly sources: readonly (Omit<ProjectedSource, "path"> & {
        readonly path: JavaScriptSemanticPropertyPath;
      })[];
      readonly storedSources: readonly (Omit<ProjectedSource, "path"> & {
        readonly path: JavaScriptSemanticPropertyPath;
      })[];
      readonly retainsOrigin: boolean;
    }
  | undefined;
export function semanticProjectedSourceFactsAtRead(
  ...arguments_: Parameters<typeof projectedSourceFactsAtRead>
): ReturnType<typeof projectedSourceFactsAtRead>;
export function semanticProjectedSourceFactsAtRead(
  ...arguments_: Parameters<typeof projectedSourceFactsAtRead>
): ReturnType<typeof projectedSourceFactsAtRead> {
  return projectedSourceFactsAtRead(...arguments_);
}

const projectedSourceFactsAtRead = (
  binding: JavaScriptSemanticBindingState,
  reference: t.Node,
  path: SemanticAliasSelectionPath,
  state: JavaScriptSemanticAnalysisState,
  includeUnknown: boolean,
  memberReadAt: t.Node = reference,
  capturedSelections: readonly SemanticCapturedSelection[] = [],
  retainEligibility = false,
):
  | {
      readonly sources: readonly ProjectedSource[];
      readonly storedSources: readonly ProjectedSource[];
      readonly retainsOrigin: boolean;
    }
  | undefined => {
  const read = semanticBindingAtRead(binding, reference, state.parentsByNode);
  const captured = [
    ...read.binding.initializers,
    ...read.binding.referenceInitializers,
  ];
  const normalizedCaptures = semanticNormalizeCapturedSelections(
    capturedSelections,
    path.length,
  );
  const captureForDepth = (depth: number): t.Node | undefined =>
    normalizedCaptures?.find((capture) => capture.depth >= depth)?.at;
  const selectedAt = (depth: number): t.Node =>
    captureForDepth(depth) ?? memberReadAt;
  const samePrefix = (
    prefix: JavaScriptSemanticBindingState["memberWrites"][number],
    effect: JavaScriptSemanticBindingState["memberWrites"][number],
  ): boolean =>
    prefix.path.length < effect.path.length &&
    prefix.path.every(
      (key, index) =>
        key !== null &&
        typeof key !== "object" &&
        effect.path[index] !== null &&
        typeof effect.path[index] !== "object" &&
        String(key) === String(effect.path[index]),
    );
  // Only a definite assignment can replace an already captured receiver.
  // Select candidates once per query rather than rescanning every propagated
  // may-write for each matching effect.
  type PrefixReplacement =
    JavaScriptSemanticBindingState["memberWrites"][number] & {
      readonly receiverIdentity: "definite";
      readonly node: t.AssignmentExpression;
    };
  const prefixReplacements =
    normalizedCaptures === undefined
      ? []
      : binding.memberWrites.filter(
          (replacement): replacement is PrefixReplacement =>
            replacement.receiverIdentity === "definite" &&
            t.isAssignmentExpression(replacement.node, { operator: "=" }) &&
            replacement.path.length < path.length,
        );
  const targetsReplacedPrefix = (
    effect: JavaScriptSemanticBindingState["memberWrites"][number],
  ): boolean =>
    capturedSelections.length > 0 &&
    prefixReplacements.some((replacement) => {
      const capture = captureForDepth(replacement.path.length);
      const receiverAt = effect.receiverAt ?? effect.node;
      return (
        capture !== undefined &&
        receiverAt !== undefined &&
        samePrefix(replacement, effect) &&
        semanticTopLevelEffectFollowsCapture(
          capture,
          replacement.node,
          state.parentsByNode,
        ) &&
        semanticDefiniteEffectPrecedesReference(
          replacement.node,
          receiverAt,
          state.parentsByNode,
        ) &&
        hasFreshProjectedReceiver(
          replacement.node.right,
          effect.path.slice(replacement.path.length, -1),
          state,
        )
      );
    });
  // Every condition is a pure query. Test the selected path first: it is the
  // cheapest and rejects most records of a binding with many member paths.
  const matches = (
    effect: JavaScriptSemanticBindingState["memberWrites"][number],
  ) =>
    semanticEffectPathMatches(effect.path, path) &&
    (effect.receiverInitializers === undefined ||
      effect.receiverInitializers.length === 0 ||
      captured.length === 0 ||
      effect.receiverInitializers.some((receiver) =>
        captured.some(
          (source) =>
            source.node === receiver.node &&
            JSON.stringify(source.projection) ===
              JSON.stringify(receiver.projection),
        ),
      )) &&
    semanticEffectTiming(selectedAt(effect.path.length), effect.node, state) !==
      "after" &&
    !targetsReplacedPrefix(effect);
  const writes = semanticEffectPathCandidates(
    binding.memberWrites,
    path,
  ).filter(matches);
  let replacement:
    | JavaScriptSemanticBindingState["memberWrites"][number]
    | undefined;
  for (const effect of writes) {
    if (
      effect.receiverIdentity === "definite" &&
      t.isAssignmentExpression(effect.node, { operator: "=" }) &&
      effect.path.every(
        (key, index) =>
          key !== null &&
          typeof key !== "object" &&
          path[index] !== null &&
          typeof path[index] !== "object" &&
          String(key) === String(path[index]),
      ) &&
      semanticDefiniteEffectPrecedesReference(
        effect.node,
        selectedAt(effect.path.length),
        state.parentsByNode,
      ) &&
      (replacement === undefined ||
        semanticDefiniteEffectPrecedesReference(
          replacement.node!,
          effect.node,
          state.parentsByNode,
        ) ||
        (replacement.node === effect.node &&
          (replacement.assignedSources?.[0]?.target?.start ?? -1) <
            (effect.assignedSources?.[0]?.target?.start ?? -1)))
    )
      replacement = effect;
  }
  const superseded = (
    effect: JavaScriptSemanticBindingState["memberWrites"][number],
  ) =>
    replacement !== undefined &&
    effect.node !== undefined &&
    effect !== replacement &&
    (semanticEffectTiming(replacement.node!, effect.node, state) === "before" ||
      (effect.node === replacement.node &&
        (effect.assignedSources?.[0]?.target?.start ?? -1) <
          (replacement.assignedSources?.[0]?.target?.start ?? -1)));
  if (
    includeUnknown &&
    semanticSomeEffectPathCandidate(
      binding.escapedPaths,
      path,
      (effect) => matches(effect) && !superseded(effect),
    )
  )
    return undefined;
  const sources: ProjectedSource[] = [];
  const sourceKeys = new WeakMap<t.Node, Set<string>>();
  const captureIds = new WeakMap<t.Node, number>();
  let nextCaptureId = 0;
  const appendSource = (source: ProjectedSource): void => {
    const captures = semanticNormalizeCapturedSelections(
      source.capturedSelections,
    )?.map(({ at, depth, ownEnumerable }) => {
      let id = captureIds.get(at);
      if (id === undefined) {
        id = nextCaptureId++;
        captureIds.set(at, id);
      }
      return [id, depth, ownEnumerable];
    });
    const key = JSON.stringify([source.path, captures]);
    const keys = sourceKeys.get(source.node) ?? new Set<string>();
    if (keys.has(key)) return;
    keys.add(key);
    sourceKeys.set(source.node, keys);
    sources.push(source);
  };
  for (const effect of writes) {
    if (!retainEligibility && superseded(effect)) continue;
    if (
      !t.isAssignmentExpression(effect.node) ||
      !["=", "||=", "&&=", "??="].includes(effect.node.operator)
    ) {
      if (includeUnknown) return undefined;
      continue;
    }
    if (effect.assignedSources === undefined) {
      if (includeUnknown) return undefined;
      continue;
    }
    const remaining = path.slice(effect.path.length);
    for (const source of effect.assignedSources) {
      if (semanticReferenceIterationUnknown(source, state)) return undefined;
      if (semanticReferenceSourcesInactive(source, state)) continue;
      const [key, ...suffix] = remaining;
      for (const choice of key === undefined
        ? [undefined]
        : semanticAliasSelectionChoices(key)) {
        const selection = semanticStoredSourceSelection(
          source,
          choice === undefined ? [] : [choice],
        );
        if (selection !== null)
          appendSource({
            node: source.node,
            path: [...selection.projection, ...suffix],
            ...(selection.capturedSelectionDepth === undefined
              ? {}
              : {
                  capturedSelections: [
                    {
                      at: source.node,
                      depth: selection.capturedSelectionDepth,
                      ...(selection.ownEnumerable
                        ? { ownEnumerable: true as const }
                        : {}),
                    },
                  ],
                }),
          });
      }
    }
  }
  const storedSources = [...sources];
  if (!retainEligibility && replacement !== undefined)
    return { sources, storedSources, retainsOrigin: false };
  for (const initializer of read.binding.initializers) {
    if (semanticReferenceIterationUnknown(initializer, state)) return undefined;
    if (semanticReferenceSourcesInactive(initializer, state)) continue;
    appendSource({
      node: initializer.node,
      path: [...initializer.projection, ...path],
    });
  }
  for (const initializer of read.binding.referenceInitializers) {
    if (semanticReferenceIterationUnknown(initializer, state)) return undefined;
    if (semanticReferenceSourcesInactive(initializer, state)) continue;
    const [key, ...suffix] = path;
    for (const choice of key === undefined
      ? [undefined]
      : semanticAliasSelectionChoices(key)) {
      const projection = semanticCopiedReferencePath(
        initializer,
        choice === undefined ? [] : [choice],
        "identity",
      );
      if (projection !== null)
        appendSource({
          node: initializer.node,
          path: [...projection, ...suffix],
          capturedSelections:
            initializer.copyProjectionOffset === undefined
              ? []
              : [
                  {
                    at: initializer.node,
                    depth: projection.length + suffix.length - path.length + 1,
                    ...(initializer.copyKind === "object-rest"
                      ? { ownEnumerable: true as const }
                      : {}),
                  },
                ],
        });
    }
  }
  return { sources, storedSources, retainsOrigin: true };
};
