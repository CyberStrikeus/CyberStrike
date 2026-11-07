import { completeSemanticSteps } from "./javascriptSemanticTraversal.js";
import {
  semanticStaticPropertyName,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import { semanticBindingAtRead } from "./javascriptSemanticMutationInitializers.js";
import { semanticOpaqueGlobalMayHaveChanged } from "./javascriptSemanticOpaqueEffects.js";
import {
  resolveSemanticBindingState,
  semanticStableInitializer,
  type JavaScriptBindingIndex,
  type JavaScriptSemanticAnalysisState,
} from "./javascriptSemanticState.js";
import * as t from "@babel/types";
import { isUnmodifiedGlobalReference } from "./javascriptSemanticAmbientWrites.js";

export const isFetchCall = (
  node: t.Node,
  bindings: JavaScriptSemanticAnalysisState,
): boolean =>
  (t.isCallExpression(node) || t.isOptionalCallExpression(node)) &&
  isUnmodifiedGlobalReference(node.callee, bindings, "fetch");

/** Browser request identity requires an intact intrinsic, not a method spelling. */
export const isBrowserNetworkRequest = (
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  bindings: JavaScriptSemanticAnalysisState,
): boolean =>
  isFetchCall(node, bindings) ||
  (t.isNewExpression(node) &&
    (isUnmodifiedGlobalReference(node.callee, bindings, "WebSocket") ||
      isUnmodifiedGlobalReference(node.callee, bindings, "EventSource"))) ||
  ((t.isCallExpression(node) || t.isOptionalCallExpression(node)) &&
    isUnmodifiedGlobalReference(node.callee, bindings, [
      "navigator",
      "sendBeacon",
    ]));

const isXhrOpenRequest = (
  node: t.Node,
  bindings: JavaScriptSemanticAnalysisState,
  index?: Pick<JavaScriptBindingIndex, "referenceMayHaveChangedAt">,
): boolean | undefined => {
  if (!t.isCallExpression(node) && !t.isOptionalCallExpression(node))
    return false;
  const callee = unwrapJavaScriptExpression(node.callee).node;
  if (
    (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee)) ||
    semanticStaticPropertyName(callee.property, callee.computed) !== "open"
  )
    return false;
  if (
    ["XMLHttpRequest", "Object"].some((owner) =>
      ["open", "__proto__"].some(
        (member) =>
          bindings.ambientWrites.covers([
            "global",
            owner,
            "prototype",
            member,
          ]) ||
          bindings.ambientEscapes.covers([
            "global",
            owner,
            "prototype",
            member,
          ]),
      ),
    )
  )
    return false;
  let receiver = unwrapJavaScriptExpression(callee.object).node;
  const seen = new Set<string>();
  while (t.isIdentifier(receiver)) {
    if (
      index !== undefined &&
      (index.referenceMayHaveChangedAt(node, receiver, ["open"]) ||
        index.referenceMayHaveChangedAt(node, receiver, ["__proto__"]))
    )
      return false;
    const binding = resolveSemanticBindingState(
      bindings,
      receiver,
      receiver.name,
    );
    if (binding === undefined || seen.has(binding.bindingId)) return false;
    seen.add(binding.bindingId);
    const initializer = semanticStableInitializer(binding, bindings);
    if (
      initializer === undefined ||
      initializer.projection.length !== 0 ||
      !semanticBindingAtRead(binding, receiver, bindings.parentsByNode)
        .hasDefiniteInitializer
    )
      return false;
    receiver = unwrapJavaScriptExpression(initializer.node).node;
  }
  if (
    !t.isNewExpression(receiver) ||
    !isUnmodifiedGlobalReference(receiver.callee, bindings, "XMLHttpRequest") ||
    semanticOpaqueGlobalMayHaveChanged(callee, bindings)
  )
    return false;
  return index === undefined && seen.size > 0 ? undefined : true;
};

/** Resolve once through the shared mutation index when lexical proof needs it. */
export const createXhrOpenRequestQuery =
  (index: JavaScriptBindingIndex): ((node: t.Node) => boolean) =>
  (node) => {
    const proof = isXhrOpenRequest(node, index.bindings);
    if (proof !== undefined) return proof;
    completeSemanticSteps(index.indexMemberMutationFactsSteps());
    return isXhrOpenRequest(node, index.bindings, index) === true;
  };
