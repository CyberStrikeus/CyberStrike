import * as t from "@babel/types";

import { inspectElectronBrowserNode } from "./electronStaticAnalysisBrowser.js";
import { inspectElectronIpcNode } from "./electronStaticAnalysisIpc.js";
import { inspectElectronNativeNode } from "./electronStaticAnalysisNative.js";
import { inspectElectronProtocolNode } from "./electronStaticAnalysisProtocol.js";
import type { JavaScriptFindingContext } from "./javascriptStaticAnalysisState.js";
import { electronCalleePath } from "./electronStaticAnalysisValues.js";
import { addLocatedFinding } from "./javascriptStaticAnalysisFindings.js";
import { range } from "./javascriptStaticAnalysisHelpers.js";

/** Collect Electron-specific syntax during the shared inert AST traversal. */
export const inspectElectronStaticNode = (
  node: t.Node,
  context: JavaScriptFindingContext,
): void => {
  inspectElectronBrowserNode(node, context);
  inspectElectronIpcNode(node, context);
  inspectElectronNativeNode(node, context);
  const path =
    t.isCallExpression(node) || t.isOptionalCallExpression(node)
      ? (electronCalleePath(node.callee, context) ??
        context.electronInvocationPath?.(node))
      : undefined;
  if (
    (path !== undefined &&
      path[0] === "app" &&
      path[1] === "setAppPath" &&
      path
        .slice(2)
        .every((member) => ["call", "apply", "bind"].includes(member))) ||
    context.electronAppPathChangePossible?.(node) === true
  )
    // A bound or exported setter may escape this source before it changes the
    // shared app path. Keep that possibility without claiming an invocation.
    addLocatedFinding(context, {
      collection: context.accumulator.appPathChanges,
      key: "electron:app-path-change",
      node,
      value: { module_key: null, location: range(node) },
    });
  inspectElectronProtocolNode(node, context);
};
