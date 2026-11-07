import * as t from "@babel/types";

import {
  semanticStaticPropertyKey,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import {
  semanticAliasSelectionChoices,
  type SemanticAliasSelectionPath,
} from "./javascriptSemanticAliasSelections.js";
import {
  semanticArrayPropertyReferences,
  semanticObjectPropertyReferences,
} from "./javascriptSemanticObjectReferences.js";
import {
  semanticCapturedSelectionsAfterPropertyRead,
  semanticNormalizeCapturedSelections,
  semanticProjectedSourceFactsAtRead,
  semanticShiftCapturedSelections,
  type SemanticCapturedSelection,
} from "./javascriptSemanticProjectedSources.js";
import { createSemanticReturnedReferences } from "./javascriptSemanticReturnedReferences.js";
import { SEMANTIC_ALIAS_SELECTION_LIMIT } from "./javascriptSemanticResourceLimits.js";
import {
  resolveSemanticBindingState,
  type JavaScriptSemanticAnalysisState,
} from "./javascriptSemanticState.js";
import type { createSemanticModuleInterop } from "./javascriptModuleInterop.js";
import { semanticReferenceSourcesInactive } from "./javascriptSemanticReferenceSources.js";
import { assignmentValueSources } from "./javascriptSemanticRequireOrigin.js";
import { semanticRuntimeExportValueSources } from "./javascriptModuleDeclaration.js";
import {
  commonJsRuntimeExportValues,
  commonJsExportApplicability,
  indexCommonJsExportReceiversSteps,
  type CommonJsExportReceiverEffect,
  type CommonJsExportSite,
} from "./javascriptCommonJsExportReceivers.js";
import { completeSemanticSteps } from "./javascriptSemanticTraversal.js";

interface Candidate {
  readonly node: t.Node;
  readonly path: SemanticAliasSelectionPath | undefined;
  readonly readAt?: t.Node | undefined;
  readonly capturedSelections?:
    | readonly SemanticCapturedSelection[]
    | undefined;
  readonly awaitDepths: readonly number[];
  readonly escaping?: true;
}

const isSetterPath = (path: SemanticAliasSelectionPath): boolean =>
  path.length >= 2 &&
  path.every((segment, index) =>
    semanticAliasSelectionChoices(segment).some(
      (key) =>
        key === null ||
        (index < 2
          ? key === ["app", "setAppPath"][index]
          : ["call", "apply", "bind"].includes(String(key))),
    ),
  );

/**
 * A source-local return may carry the shared Electron app even when it cannot
 * establish a concrete API identity. Retain only the possibility of changing
 * its root; callers must not use this query to prove other Electron APIs.
 */
export const createSemanticElectronAppPathChangeQuery = (
  state: JavaScriptSemanticAnalysisState,
  exportPath: (node: t.Node) => readonly string[] | undefined,
  interop: Pick<
    ReturnType<typeof createSemanticModuleInterop>,
    "intrinsicInvocation" | "intrinsicPath"
  >,
): ((node: t.Node) => boolean) => {
  const directReturns = createSemanticReturnedReferences(state, "direct-call");
  const awaitedReturns = createSemanticReturnedReferences(
    state,
    "awaited-call",
  );
  let commonJsReceivers:
    | ReadonlyMap<CommonJsExportSite, CommonJsExportReceiverEffect>
    | undefined;
  const possiblePath = (
    root: t.Node,
    escaping = false,
    projection: SemanticAliasSelectionPath = [],
    ownEnumerable = false,
  ): boolean => {
    const pending: Candidate[] = [];
    const seen = new WeakMap<t.Node, Set<string>>();
    let scheduled = 0;
    let widened = false;
    const enqueue = (candidate: Candidate): void => {
      const node = unwrapJavaScriptExpression(candidate.node).node;
      // Close the finite source graph after the precise context budget is
      // exhausted. Widening alone is never evidence of an Electron origin.
      if (!widened && scheduled >= SEMANTIC_ALIAS_SELECTION_LIMIT) {
        state.valueResourceLimits.add("alias-selections");
        widened = true;
      }
      if (widened)
        candidate = {
          node,
          path: undefined,
          awaitDepths: candidate.awaitDepths.length > 0 ? [0] : [],
          ...(candidate.escaping ? { escaping: true as const } : {}),
        };
      const capturedSelections = semanticNormalizeCapturedSelections(
        candidate.capturedSelections,
        candidate.path?.length,
      );
      const key = JSON.stringify([
        candidate.path,
        candidate.readAt?.start,
        candidate.readAt?.end,
        capturedSelections?.map(({ at, depth, ownEnumerable }) => [
          at.start,
          at.end,
          depth,
          ownEnumerable,
        ]),
        candidate.awaitDepths,
        candidate.escaping,
      ]);
      const contexts = seen.get(node) ?? new Set<string>();
      if (contexts.has(key)) return;
      scheduled++;
      contexts.add(key);
      seen.set(node, contexts);
      pending.push({ ...candidate, node, capturedSelections });
    };
    enqueue({
      node: root,
      path: projection,
      awaitDepths: [],
      ...(escaping ? { escaping: true as const } : {}),
      ...(ownEnumerable
        ? {
            capturedSelections: [
              { at: root, depth: 1, ownEnumerable: true as const },
            ],
          }
        : {}),
    });
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (widened && current.path !== undefined) {
        enqueue(current);
        continue;
      }
      const { node, path } = current;
      const binding = t.isIdentifier(node)
        ? resolveSemanticBindingState(state, node, node.name)
        : undefined;
      const selected =
        binding === undefined || path === undefined
          ? undefined
          : semanticProjectedSourceFactsAtRead(
              binding,
              node,
              path,
              state,
              false,
              current.readAt ?? node,
              current.capturedSelections,
            );
      // Ordinary aliases are followed below with shared source selections.
      // Re-evaluating their whole-binding provenance at every DAG node would
      // repeat that graph merely to obtain a concrete identity we do not need.
      const exported =
        !t.isIdentifier(node) ||
        binding?.directOrigins.length ||
        binding?.initializers.some((source) =>
          t.isCallExpression(unwrapJavaScriptExpression(source.node).node),
        )
          ? exportPath(node)
          : undefined;
      if (
        current.escaping &&
        path?.length === 0 &&
        exported !== undefined &&
        (exported.length === 0 ||
          (exported.length === 1 && exported[0] === "app"))
      ) {
        // Publishing the app (or its namespace) lets an importer select the
        // setter. Re-enter the same projected-source proof so a definite local
        // method replacement still suppresses that native alternative.
        enqueue({
          ...current,
          path: exported.length === 0 ? ["app", "setAppPath"] : ["setAppPath"],
        });
      }
      if (
        exported !== undefined &&
        // The retained app identity alone cannot prove its selected method
        // survived an own write. Conditional or unknown writes keep the native
        // alternative; a definite replacement follows its selected RHS below.
        selected?.retainsOrigin !== false &&
        (path === undefined
          ? exported.length === 0 ||
            (exported.length === 1 && exported[0] === "app") ||
            isSetterPath(exported)
          : isSetterPath([...exported, ...path]))
      )
        return true;
      if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
        enqueue({
          ...current,
          node: node.object,
          path:
            path === undefined
              ? undefined
              : [
                  semanticStaticPropertyKey(node.property, node.computed),
                  ...path,
                ],
          readAt: current.readAt ?? node,
          capturedSelections: semanticShiftCapturedSelections(
            current.capturedSelections,
            1,
          ),
        });
      } else if (t.isIdentifier(node)) {
        if (binding === undefined) continue;
        const sources = selected?.sources;
        // Unknown iteration cannot prove an Electron origin, but must not drop
        // retained source references that can still carry the shared app.
        if (sources === undefined) {
          for (const sources of [
            binding.initializers,
            binding.referenceInitializers,
          ])
            for (const source of sources) {
              if (semanticReferenceSourcesInactive(source, state)) continue;
              enqueue({
                ...current,
                node: source.node,
                path:
                  path === undefined
                    ? undefined
                    : [...source.projection, ...path],
              });
            }
          for (const effect of binding.memberWrites)
            for (const source of effect.assignedSources ?? []) {
              if (semanticReferenceSourcesInactive(source, state)) continue;
              enqueue({ ...current, node: source.node, path: undefined });
            }
          continue;
        }
        for (const source of sources)
          enqueue({
            ...current,
            ...source,
            readAt: path?.length === 0 ? undefined : (current.readAt ?? node),
            capturedSelections: [
              ...(semanticShiftCapturedSelections(
                current.capturedSelections,
                source.path.length - (path?.length ?? 0),
              ) ?? []),
              ...(source.capturedSelections ?? []),
            ],
          });
      } else if (t.isAwaitExpression(node)) {
        enqueue({
          ...current,
          node: node.argument,
          awaitDepths: [
            ...new Set([...current.awaitDepths, path?.length ?? 0]),
          ].sort((left, right) => left - right),
        });
      } else if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) {
        const returned = current.awaitDepths.includes(path?.length ?? 0)
          ? awaitedReturns
          : directReturns;
        for (const source of returned(node.callee, node).references)
          enqueue({
            ...current,
            node: source.node,
            path:
              path === undefined ? undefined : [...source.projection, ...path],
            capturedSelections: semanticShiftCapturedSelections(
              current.capturedSelections,
              source.projection.length,
            ),
          });
      } else if (
        t.isConditionalExpression(node) ||
        t.isLogicalExpression(node)
      ) {
        enqueue({
          ...current,
          node: t.isConditionalExpression(node) ? node.consequent : node.left,
        });
        enqueue({
          ...current,
          node: t.isConditionalExpression(node) ? node.alternate : node.right,
        });
      } else if (t.isSequenceExpression(node)) {
        const last = node.expressions.at(-1);
        if (last !== undefined) enqueue({ ...current, node: last });
      } else if (t.isAssignmentExpression(node)) {
        for (const source of assignmentValueSources(node))
          enqueue({ ...current, node: source });
      } else if (
        (t.isObjectExpression(node) || t.isArrayExpression(node)) &&
        (path === undefined || path.length > 0 || current.escaping)
      ) {
        const [key, ...remaining] =
          path?.length === 0 ? [null] : (path ?? [null]);
        for (const choice of semanticAliasSelectionChoices(key!)) {
          const sources = t.isObjectExpression(node)
            ? semanticObjectPropertyReferences(node, [choice], state)
            : semanticArrayPropertyReferences(node, [choice]);
          for (const source of sources)
            if (
              !source.inherited ||
              !current.capturedSelections?.some(
                (capture) => capture.depth === 1 && capture.ownEnumerable,
              )
            )
              enqueue({
                ...current,
                node: source.node,
                path:
                  path === undefined
                    ? undefined
                    : [...source.path, ...remaining],
                awaitDepths: current.awaitDepths.filter(
                  (depth) => depth !== path?.length,
                ),
                capturedSelections: semanticCapturedSelectionsAfterPropertyRead(
                  current.capturedSelections,
                  source,
                ),
              });
        }
      }
    }
    return false;
  };
  return (node) => {
    if (
      (t.isCallExpression(node) || t.isOptionalCallExpression(node)) &&
      (possiblePath(node.callee) ||
        interop.intrinsicInvocation(node, (callee) =>
          possiblePath(callee)
            ? ["electron-app-path-change"]
            : interop.intrinsicPath(callee),
        )?.path[0] === "electron-app-path-change")
    )
      return true;
    if (
      semanticRuntimeExportValueSources(node).some((value) =>
        possiblePath(value, true),
      )
    )
      return true;
    const exported = commonJsRuntimeExportValues(node, state);
    if (
      !exported.some(
        ({ value, iterationSource }) =>
          value !== null || iterationSource !== undefined,
      ) ||
      (!t.isAssignmentExpression(node) && !t.isCallExpression(node))
    )
      return false;
    const receivers = (commonJsReceivers ??= completeSemanticSteps(
      indexCommonJsExportReceiversSteps(state),
    ));
    return exported.some(
      ({ exportedName, value, projection, ownEnumerable, iterationSource }) =>
        commonJsExportApplicability(receivers.get(node), exportedName) !==
          "detached" &&
        (value !== null
          ? possiblePath(value, true, projection, ownEnumerable)
          : iterationSource !== undefined &&
            // Unknown iteration does not identify any yielded slot. Retain
            // only source reachability through the existing escape query.
            possiblePath(iterationSource, true)),
    );
  };
};
