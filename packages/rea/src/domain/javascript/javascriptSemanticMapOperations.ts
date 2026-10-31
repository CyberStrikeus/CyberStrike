import * as t from "@babel/types";

import {
  semanticStaticPropertyName,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import { isUnmodifiedGlobalReference } from "./javascriptSemanticAmbientWrites.js";
import { semanticOpaqueGlobalMayHaveChanged } from "./javascriptSemanticOpaqueEffects.js";
import { semanticBindingAtRead } from "./javascriptSemanticMutationInitializers.js";
import {
  resolveSemanticBindingState,
  semanticStableInitializer,
  type JavaScriptBindingIndex,
  type JavaScriptSemanticAnalysisState,
} from "./javascriptSemanticState.js";

/** Prove an unchanged Map operation; undefined requests shared member-mutation facts. */
export const isIntrinsicMapLookup = (
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  bindings: JavaScriptSemanticAnalysisState,
  index?: Pick<JavaScriptBindingIndex, "referenceMayHaveChangedAt">,
): boolean | undefined => {
  const callee = unwrapJavaScriptExpression(node.callee).node;
  if (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee))
    return false;
  const method = semanticStaticPropertyName(callee.property, callee.computed);
  if (method !== "get" && method !== "delete") return false;
  const prototypeMemberMayHaveChanged = (member: string): boolean =>
    ["Map", "Object"].some((owner) => {
      const path = ["global", owner, "prototype", member];
      return (
        bindings.ambientWrites.covers(path) ||
        bindings.ambientEscapes.covers(path)
      );
    });
  if (prototypeMemberMayHaveChanged(method)) return false;
  let receiver = unwrapJavaScriptExpression(callee.object).node;
  const seen = new Set<string>();
  while (t.isIdentifier(receiver)) {
    if (
      index !== undefined &&
      (index.referenceMayHaveChangedAt(node, receiver, [method]) ||
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
    !isUnmodifiedGlobalReference(receiver.callee, bindings, "Map")
  )
    return false;
  // Iterable construction reads and invokes the instance's set hook. A changed
  // adder can install its own get/delete before the constructed value is read.
  if (receiver.arguments.length > 0 && prototypeMemberMayHaveChanged("set"))
    return false;
  if (semanticOpaqueGlobalMayHaveChanged(callee, bindings)) return false;
  return index === undefined && seen.size > 0 ? undefined : true;
};
