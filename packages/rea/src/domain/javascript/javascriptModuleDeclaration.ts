import * as t from "@babel/types";
import { semanticWriteTargets } from "./javascriptAstValues.js";

/** Declaration syntax that establishes no runtime value, regardless of export form. */
export const isErasedJavaScriptDeclaration = (node: t.Node): boolean =>
  t.isTSInterfaceDeclaration(node) ||
  t.isTSTypeAliasDeclaration(node) ||
  t.isTSDeclareFunction(node) ||
  ((t.isVariableDeclaration(node) ||
    t.isClassDeclaration(node) ||
    t.isTSEnumDeclaration(node) ||
    t.isTSModuleDeclaration(node)) &&
    node.declare === true);

/** Namespace/enum lowering introduces runtime scopes absent from this source index. */
export const isUnmodeledJavaScriptRuntimeScope = (node: t.Node): boolean =>
  t.isTSModuleDeclaration(node) || t.isTSEnumDeclaration(node);

/** Whether TypeScript explicitly erases this entire import declaration. */
export const isTypeOnlyImportDeclaration = (
  node: t.ImportDeclaration,
): boolean => node.importKind === "type" || node.importKind === "typeof";

/** Whether TypeScript explicitly erases this entire export declaration. */
export const isTypeOnlyExportDeclaration = (
  node: t.ExportNamedDeclaration | t.ExportAllDeclaration,
): boolean =>
  node.exportKind === "type" ||
  (t.isExportNamedDeclaration(node) &&
    node.declaration != null &&
    isErasedJavaScriptDeclaration(node.declaration));

/** Runtime static module source, shared by source and captured-script consumers. */
export const semanticStaticModuleSource = (
  node: t.Node,
): t.StringLiteral | null => {
  if (t.isImportDeclaration(node))
    return isTypeOnlyImportDeclaration(node) ? null : node.source;
  if (t.isExportAllDeclaration(node) || t.isExportNamedDeclaration(node))
    return isTypeOnlyExportDeclaration(node) ? null : (node.source ?? null);
  return null;
};

/**
 * Runtime external-module target for a value import-equals declaration;
 * `import type X = require("m")` is erased and declares no dependency.
 */
export const semanticImportEqualsSpecifier = (
  node: t.TSImportEqualsDeclaration,
): string | null =>
  node.importKind !== "type" &&
  t.isTSExternalModuleReference(node.moduleReference) &&
  t.isStringLiteral(node.moduleReference.expression)
    ? node.moduleReference.expression.value
    : null;

/** Whether this import binding is explicitly type-only. */
export const isTypeOnlyImportSpecifier = (node: t.ImportSpecifier): boolean =>
  node.importKind === "type" || node.importKind === "typeof";

/** Whether this exported binding is explicitly type-only. */
export const isTypeOnlyExportSpecifier = (node: t.ExportSpecifier): boolean =>
  node.exportKind === "type";

/** Runtime values published by a local ESM export; source re-exports have no local value. */
export const semanticRuntimeExportValueSources = (
  node: t.Node,
): readonly t.Node[] => {
  if (t.isExportDefaultDeclaration(node))
    return isErasedJavaScriptDeclaration(node.declaration)
      ? []
      : [node.declaration];
  if (
    !t.isExportNamedDeclaration(node) ||
    node.source != null ||
    isTypeOnlyExportDeclaration(node)
  )
    return [];
  const values: t.Node[] = [];
  if (t.isVariableDeclaration(node.declaration))
    for (const declaration of node.declaration.declarations)
      values.push(...semanticWriteTargets(declaration.id));
  else if (
    (t.isFunctionDeclaration(node.declaration) ||
      t.isClassDeclaration(node.declaration)) &&
    node.declaration.id != null
  )
    values.push(node.declaration.id);
  for (const specifier of node.specifiers)
    if (t.isExportSpecifier(specifier) && !isTypeOnlyExportSpecifier(specifier))
      values.push(specifier.local);
  return values;
};

/** A regular import whose bindings are all erased but may retain side effects. */
export const hasOnlyInlineTypeImportSpecifiers = (
  node: t.ImportDeclaration,
): boolean =>
  !isTypeOnlyImportDeclaration(node) &&
  node.specifiers.length > 0 &&
  node.specifiers.every(
    (specifier) =>
      t.isImportSpecifier(specifier) && isTypeOnlyImportSpecifier(specifier),
  );

/** A regular re-export whose bindings are all erased but may retain side effects. */
export const hasOnlyInlineTypeExportSpecifiers = (
  node: t.ExportNamedDeclaration,
): boolean =>
  !isTypeOnlyExportDeclaration(node) &&
  node.source != null &&
  node.specifiers.length > 0 &&
  node.specifiers.every(
    (specifier) =>
      t.isExportSpecifier(specifier) && isTypeOnlyExportSpecifier(specifier),
  );

/** Whether compiler options leave an inline type-only declaration's side effect unknown. */
export const hasUncertainTypeOnlyModuleSideEffect = (
  program: t.Program,
): boolean =>
  program.body.some(
    (node) =>
      (t.isImportDeclaration(node) &&
        hasOnlyInlineTypeImportSpecifiers(node)) ||
      (t.isExportNamedDeclaration(node) &&
        hasOnlyInlineTypeExportSpecifiers(node)),
  );
