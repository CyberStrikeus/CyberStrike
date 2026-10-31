import * as t from "@babel/types";

import { electronCalleePath } from "./electronStaticAnalysisValues.js";
import {
  semanticStaticPropertyKey,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import { semanticBindingAtRead } from "./javascriptSemanticMutationInitializers.js";
import {
  semanticStableInitializer,
  type JavaScriptBindingIndex,
} from "./javascriptSemanticState.js";
import { completeSemanticSteps } from "./javascriptSemanticTraversal.js";
import type { JavaScriptFindingContext } from "./javascriptStaticAnalysisState.js";

/** A renderer load belongs to an intact, source-proven BrowserWindow instance. */
export const isElectronRendererLoad = (
  callee: t.Node,
  site: t.Node,
  context: JavaScriptFindingContext,
  index: JavaScriptBindingIndex,
): boolean => {
  callee = unwrapJavaScriptExpression(callee).node;
  if (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee))
    return false;
  const method = semanticStaticPropertyKey(callee.property, callee.computed);
  if (method !== "loadFile" && method !== "loadURL") return false;
  const receiver = resolveElectronBrowserWindowReceiver(
    callee.object,
    site,
    [method],
    context,
    index,
  );
  return (
    receiver !== undefined &&
    (receiver.path.length === 1 ||
      (receiver.path.length === 2 && receiver.path[0] === "webContents"))
  );
};

/** Source allocation identity, not a claim about runtime window/frame identity. */
export const resolveElectronBrowserWindowReceiver = (
  node: t.Node,
  site: t.Node,
  suffix: readonly string[],
  context: JavaScriptFindingContext,
  index: JavaScriptBindingIndex,
):
  | { readonly owner: t.NewExpression; readonly path: readonly string[] }
  | undefined => {
  let receiver = unwrapJavaScriptExpression(node).node;
  const path = [...suffix];
  const seen = new Set<string>();
  const aliases: { receiver: t.Identifier; path: readonly string[] }[] = [];
  for (;;) {
    if (
      t.isMemberExpression(receiver) ||
      t.isOptionalMemberExpression(receiver)
    ) {
      const member = semanticStaticPropertyKey(
        receiver.property,
        receiver.computed,
      );
      if (member === null) return undefined;
      path.unshift(member);
      receiver = unwrapJavaScriptExpression(receiver.object).node;
      continue;
    }
    if (!t.isIdentifier(receiver)) break;
    const binding = index.bindingForReferenceAt(receiver);
    if (binding === undefined || seen.has(binding.bindingId)) return undefined;
    seen.add(binding.bindingId);
    const initializer = semanticStableInitializer(binding, index.bindings);
    if (
      initializer === undefined ||
      initializer.projection.length !== 0 ||
      !semanticBindingAtRead(binding, receiver, index.bindings.parentsByNode)
        .hasDefiniteInitializer
    )
      return undefined;
    aliases.push({ receiver, path: [...path] });
    receiver = unwrapJavaScriptExpression(initializer.node).node;
  }
  if (!t.isNewExpression(receiver)) return undefined;
  const constructor = electronCalleePath(receiver.callee, context);
  if (
    constructor?.length !== 1 ||
    constructor[0] !== "BrowserWindow" ||
    !supportedReceiverPath(path)
  )
    return undefined;
  if (
    context.electronExportIntact?.([
      "electron",
      "BrowserWindow",
      "prototype",
      ...path,
    ]) !== true
  )
    return undefined;
  // Only source-proven supported receivers justify the whole-file mutation pass.
  // Keep every alias's consumed path and check at the original invocation site.
  completeSemanticSteps(index.indexMemberMutationFactsSteps());
  for (const alias of aliases)
    if (index.referenceMayHaveChangedAt(site, alias.receiver, alias.path))
      return undefined;
  return { owner: receiver, path };
};

const supportedReceiverPath = (path: readonly string[]): boolean => {
  const operation = path.at(-1);
  if (operation === "loadFile" || operation === "loadURL")
    return (
      path.length === 1 || (path.length === 2 && path[0] === "webContents")
    );
  return (
    path[0] === "webContents" &&
    ((path.length === 3 && path[1] === "ipc") ||
      (path.length === 4 && path[1] === "mainFrame" && path[2] === "ipc"))
  );
};
