import * as t from "@babel/types";

/** Operands exposed to user-defined primitive conversion by language operations. */
export const semanticCoercionOperands = (
  node: t.Node,
  isObject: (operand: t.Node) => boolean = () => false,
): readonly t.Node[] => {
  if (t.isBinaryExpression(node)) {
    if (["===", "!=="].includes(node.operator)) return [];
    if (node.operator === "instanceof") return [node.left, node.right];
    if (
      ["==", "!="].includes(node.operator) &&
      ((t.isThisExpression(node.left) && t.isThisExpression(node.right)) ||
        (isObject(node.left) && isObject(node.right)))
    )
      return [];
    return node.operator === "in" ? [node.left] : [node.left, node.right];
  }
  if (t.isUnaryExpression(node) && ["+", "-", "~"].includes(node.operator))
    return [node.argument];
  if (t.isUpdateExpression(node)) return [node.argument];
  if (
    t.isAssignmentExpression(node) &&
    !["=", "&&=", "||=", "??="].includes(node.operator)
  )
    return [node.left, node.right];
  if (
    (t.isMemberExpression(node) ||
      t.isOptionalMemberExpression(node) ||
      t.isObjectProperty(node) ||
      t.isObjectMethod(node) ||
      t.isClassProperty(node) ||
      t.isClassMethod(node) ||
      t.isClassAccessorProperty(node)) &&
    node.computed
  )
    return [
      t.isMemberExpression(node) || t.isOptionalMemberExpression(node)
        ? node.property
        : node.key,
    ];
  return [];
};
