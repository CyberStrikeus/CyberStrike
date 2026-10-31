import type { JavaScriptSemanticGraphNode } from "./javascriptSemanticGraphSchemas.js";

/** Read retained direct call literals without interpreting other node properties. */
export const semanticCallLiteralValues = (
  node: JavaScriptSemanticGraphNode,
): (string | number | boolean | null)[] => {
  if (node.kind !== "call-site" || !Array.isArray(node.properties.arguments))
    return [];
  return node.properties.arguments.flatMap((argument) => {
    if (
      argument === null ||
      typeof argument !== "object" ||
      Array.isArray(argument) ||
      !Object.hasOwn(argument, "value")
    )
      return [];
    const value = argument.value;
    return value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
      ? [value]
      : [];
  });
};
