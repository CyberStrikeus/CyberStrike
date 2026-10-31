import { expect, it } from "vitest";

import { inspectElectronIpcNode } from "./electronStaticAnalysisIpc.js";
import { resolveElectronBrowserWindowReceiver } from "./electronStaticRenderer.js";
import { createJavaScriptRpcScan } from "./javascriptRpcEndpoints.js";
import {
  indexJavaScriptBindingsWithReceiversSteps,
  indexJavaScriptElectronIdentitySteps,
} from "./javascriptSemanticAnalysis.js";
import { createSemanticExpressionShapeResolver } from "./javascriptSemanticExpressionShapes.js";
import {
  completeSemanticSteps as complete,
  traverseJavaScriptAst,
} from "./javascriptSemanticTraversal.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import {
  createJavaScriptAnalysisAccumulator,
  type JavaScriptFindingContext,
} from "./javascriptStaticAnalysisState.js";

const inspect = (source: string) => {
  const file = parseJavaScriptSource(source);
  if (file === null) throw new Error("Fixture must parse");
  const index = complete(
    indexJavaScriptBindingsWithReceiversSteps(file.program),
  );
  complete(index.indexAmbientWritesSteps());
  const identity = complete(
    indexJavaScriptElectronIdentitySteps(file.program, index.bindings),
  );
  let mutationIndexCalls = 0;
  const original = index.indexMemberMutationFactsSteps.bind(index);
  index.indexMemberMutationFactsSteps = function* () {
    mutationIndexCalls += 1;
    yield* original();
  };
  const context: JavaScriptFindingContext = {
    source,
    accumulator: createJavaScriptAnalysisAccumulator(source.length),
    vitePreloadDependencyTable: null,
    electronBindings: identity.bindings,
    electronExportIntact: identity.intactExport,
    rpcScan: createJavaScriptRpcScan(
      source,
      index.receivers.rpcClientRoots,
      index,
    ),
    expressionShapes: createSemanticExpressionShapeResolver(index.bindings),
    browserWindowReceiver: (node, site, suffix) =>
      resolveElectronBrowserWindowReceiver(node, site, suffix, context, index),
  };
  traverseJavaScriptAst(file, {
    enter: (node) => inspectElectronIpcNode(node, context),
  });
  return { findings: context.accumulator.ipc, mutationIndexCalls };
};

it.each([
  [
    "ordinary EventEmitter",
    `import {EventEmitter} from "node:events";
    const emitter = new EventEmitter(); emitter.on("event", listener);`,
  ],
  [
    "unsupported BrowserWindow path",
    `const {BrowserWindow} = require("electron");
    const window = new BrowserWindow(); window.on("ready", listener);`,
  ],
])("does not request whole-file mutation facts for %s", (_, source) => {
  const result = inspect(source);
  expect(result.findings).toEqual([]);
  expect(result.mutationIndexCalls).toBe(0);
});

it("still checks mutations for a source-proven scoped Electron receiver", () => {
  const result = inspect(`const {BrowserWindow} = require("electron");
    const window = new BrowserWindow(); window.webContents.ipc.handle("channel", () => {});`);
  expect(result.findings).toHaveLength(1);
  expect(result.mutationIndexCalls).toBeGreaterThan(0);
});
