import * as t from "@babel/types";

import { unwrapJavaScriptExpression } from "./javascriptAstValues.js";
import { isUnmodifiedGlobalReference } from "./javascriptSemanticAmbientWrites.js";
import { semanticOpaqueGlobalMayHaveChanged } from "./javascriptSemanticOpaqueEffects.js";
import type { JavaScriptSemanticAnalysisState } from "./javascriptSemanticState.js";

const typedArrayConstructors = [
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
];

/** Recognize native integer-indexed allocations, not constructor spelling alone. */
export const isIntrinsicTypedArrayConstruction = (
  node: t.NewExpression,
  state: JavaScriptSemanticAnalysisState,
): boolean =>
  !semanticOpaqueGlobalMayHaveChanged(node, state) &&
  typedArrayConstructors.some(
    (name) =>
      isUnmodifiedGlobalReference(node.callee, state, name) &&
      !state.ambientEscapes.covers(["global", name]),
  );

/** A successful evaluation of these expressions produces a Number, not a key object. */
const hasNumberResult = (node: t.Node): boolean => {
  const pending = [node];
  while (pending.length > 0) {
    const expression = unwrapJavaScriptExpression(pending.pop()!).node;
    if (t.isNumericLiteral(expression)) return true;
    if (t.isUnaryExpression(expression)) {
      if (expression.operator === "+") return true;
      if (expression.operator === "-" || expression.operator === "~")
        pending.push(expression.argument);
    } else if (t.isBinaryExpression(expression)) {
      if (expression.operator === ">>>") return true;
      // These operators reject mixed Number/BigInt operands. Either Number
      // operand proves a Number result on success; + can concatenate strings.
      if (
        ["-", "*", "/", "%", "**", "<<", ">>", "&", "|", "^"].includes(
          expression.operator,
        )
      )
        pending.push(expression.left, expression.right);
    }
  }
  return false;
};

/** Numeric indices never expose an object, even out of bounds or on a detached view. */
export const isTypedArrayNumericIndex = (
  key: t.Node,
  computed: boolean,
): boolean => {
  if (!computed) return false;
  const expression = unwrapJavaScriptExpression(key).node;
  if (t.isStringLiteral(expression))
    return (
      expression.value === "-0" ||
      String(Number(expression.value)) === expression.value
    );
  return hasNumberResult(expression);
};
