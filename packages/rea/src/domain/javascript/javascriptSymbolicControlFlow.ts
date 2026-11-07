import * as t from "@babel/types";
import {
  symbolicTruth,
  type SymbolicValue,
} from "./javascriptSymbolicValues.js";

/** Shared branch decision after each value lattice establishes truth/nullishness. */
export const logicalRightOperand = (
  operator: t.LogicalExpression["operator"],
  truth: boolean | undefined,
  nullish: boolean | undefined,
): boolean | undefined =>
  operator === "??"
    ? nullish
    : truth === undefined
      ? undefined
      : operator === "&&"
        ? truth
        : !truth;

/** Whether short-circuit evaluation reaches the right operand; unknown stays unknown. */
export const symbolicLogicalRight = (
  operator: t.LogicalExpression["operator"],
  left: SymbolicValue,
): boolean | undefined => {
  if (left.kind === "namespace" && left.runtimeValueUnknown) return undefined;
  if (left.kind === "union") {
    const choices = left.values.map((value) =>
      symbolicLogicalRight(operator, value),
    );
    return choices.length > 0 &&
      choices.every((choice) => choice === choices[0])
      ? choices[0]
      : undefined;
  }
  if (operator === "??") {
    if (left.kind === "literal")
      return left.value === null || left.value === undefined;
    return [
      "function",
      "object",
      "namespace",
      "array",
      "record",
      "loader",
      "promise",
      "iterator",
    ].includes(left.kind)
      ? false
      : undefined;
  }
  const truth = symbolicTruth(left);
  return logicalRightOperand(operator, truth, undefined);
};
