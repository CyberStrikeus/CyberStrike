import * as t from "@babel/types";

import { builtinDataEffectCallablePath } from "./javascriptSemanticDataEffectHelpers.js";
import type { JavaScriptBindingIndex } from "./javascriptSemanticState.js";
import { completeSemanticSteps } from "./javascriptSemanticTraversal.js";
import { evaluateSemanticExpressionProvenance } from "./javascriptSemanticValues.js";
import {
  isUnmodifiedGlobalReference,
  isUnmodifiedImportMetaUrl,
} from "./javascriptSemanticAmbientWrites.js";
import { unwrapJavaScriptExpression } from "./javascriptAstValues.js";
import type { JavaScriptStaticPathIntrinsicQuery } from "./javascriptStaticAnalysisHelpers.js";

/** Prove path and URL intrinsic identity before applying native semantics. */
export const createStaticPathIntrinsicQuery = (
  index: JavaScriptBindingIndex,
): JavaScriptStaticPathIntrinsicQuery => {
  const facts = new WeakMap<t.Node, Map<string, boolean>>();
  const nativeMethod = (
    callee: t.Node,
    method: string,
    modules: readonly string[],
  ): boolean => {
    const provenance = evaluateSemanticExpressionProvenance(
      callee,
      index.bindings,
    );
    if (
      provenance.status !== "module" ||
      provenance.origins[0].importedPath.at(-1) !== method ||
      !modules.includes(provenance.origins[0].specifier.replace(/^node:/u, ""))
    )
      return false;
    completeSemanticSteps(index.indexMemberMutationFactsSteps());
    const path = builtinDataEffectCallablePath(callee, index.bindings, modules);
    return (
      path !== null &&
      ((path.length === 1 && path[0] === method) ||
        (modules.includes("path") &&
          path.length === 2 &&
          path[0] === "posix" &&
          path[1] === method))
    );
  };
  const sourceFile = (node: t.Node | undefined): boolean => {
    if (node === undefined) return false;
    node = unwrapJavaScriptExpression(node).node;
    if (t.isIdentifier(node, { name: "__filename" }))
      return isUnmodifiedGlobalReference(node, index.bindings, "__filename");
    return (
      t.isCallExpression(node) &&
      node.arguments.length === 1 &&
      nativeMethod(node.callee, "fileURLToPath", ["url"]) &&
      isUnmodifiedImportMetaUrl(node.arguments[0], index.bindings)
    );
  };
  return (callee, fact) => {
    if (fact === "source-directory") {
      callee = unwrapJavaScriptExpression(callee).node;
      return t.isIdentifier(callee, { name: "__dirname" })
        ? isUnmodifiedGlobalReference(callee, index.bindings, "__dirname")
        : t.isCallExpression(callee) &&
            callee.arguments.length === 1 &&
            nativeMethod(callee.callee, "dirname", ["path", "path/posix"]) &&
            sourceFile(callee.arguments[0]);
    }
    const kind = fact ?? "resolve";
    const cached = facts.get(callee)?.get(kind);
    if (cached !== undefined) return cached;
    const proven =
      kind === "source-url"
        ? t.isNewExpression(callee) &&
          callee.arguments.length === 2 &&
          (isUnmodifiedGlobalReference(callee.callee, index.bindings, "URL") ||
            nativeMethod(callee.callee, "URL", ["url"])) &&
          isUnmodifiedImportMetaUrl(callee.arguments[1], index.bindings)
        : kind === "file-url-to-path"
          ? nativeMethod(callee, "fileURLToPath", ["url"])
          : nativeMethod(callee, kind, ["path", "path/posix"]);
    let entry = facts.get(callee);
    if (entry === undefined) {
      entry = new Map();
      facts.set(callee, entry);
    }
    entry.set(kind, proven);
    return proven;
  };
};
