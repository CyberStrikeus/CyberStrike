import { parse } from "@babel/parser";
import { traverseFast } from "@babel/types";

const literalValue = (node) => {
  if (node?.type === "StringLiteral") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? undefined;
  return undefined;
};

/** Static string specifier on one import or re-export node, when it has one. */
export const importSpecifier = (node) => {
  switch (node.type) {
    case "ImportDeclaration":
    case "ExportNamedDeclaration":
    case "ExportAllDeclaration":
    case "ImportExpression":
    case "TSImportType":
      return literalValue(node.source);
    case "TSImportEqualsDeclaration":
      return node.moduleReference.type === "TSExternalModuleReference"
        ? literalValue(node.moduleReference.expression)
        : undefined;
    default:
      return undefined;
  }
};

/**
 * Static import and re-export specifiers in source order.
 * Comments and string literals are not imports. Non-string dynamic imports
 * are omitted. Callers decide which specifiers are in-repo edges.
 */
export const readImportSpecifiers = (source) => {
  const specifiers = [];
  const tree = parse(source, { sourceType: "module", plugins: ["typescript"] });
  traverseFast(tree, (node) => {
    const specifier = importSpecifier(node);
    if (specifier === undefined) return;
    specifiers.push({ specifier, line: node.loc?.start.line ?? 1 });
  });
  return specifiers;
};
