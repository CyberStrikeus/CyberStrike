import { expect, it } from "vitest";
import { completeJavaScriptAnalysisSteps } from "./JavaScriptAnalysisControl.js";
import { collectElectronWrappedCallPathsSteps } from "../../domain/javascript/electronWrappedCallPaths.js";
import {
  indexJavaScriptBindingsWithReceiversSteps,
  indexJavaScriptElectronIdentitySteps,
} from "../../domain/javascript/javascriptSemanticAnalysis.js";
import { completeSemanticSteps } from "../../domain/javascript/javascriptSemanticTraversal.js";
import { parseJavaScriptSource } from "../../domain/javascript/javascriptSourceParser.js";
import { createJavaScriptAnalysisAccumulator } from "../../domain/javascript/javascriptStaticAnalysisState.js";

it("cancels actual call-path work while its first seed indexes a long block", async () => {
  const source = `const e = require("electron"); {
    e.ipcMain.on("first", event => event.sender.copy());
    ${"0;".repeat(2048)}
  }`;
  const parsed = parseJavaScriptSource(source);
  if (parsed === null) throw new Error("Expected parsed source");
  const index = completeSemanticSteps(
    indexJavaScriptBindingsWithReceiversSteps(parsed.program),
  );
  const identity = completeSemanticSteps(
    indexJavaScriptElectronIdentitySteps(parsed.program, index.bindings),
  );
  const accumulator = createJavaScriptAnalysisAccumulator(source.length);
  const work = collectElectronWrappedCallPathsSteps(
    parsed.program,
    index.bindings,
    source,
    accumulator,
    identity,
  );
  // The first candidate has not yet been expanded: this checkpoint is inside
  // its block indexing, before the walker's completed batch is yielded.
  expect(work.next()).toEqual({ done: false, value: undefined });
  expect(accumulator.ipc).toEqual([]);
  const controller = new AbortController();
  const reason = { request: "cancel prefix indexing" };
  controller.abort(reason);
  await expect(
    completeJavaScriptAnalysisSteps(work, controller.signal),
  ).rejects.toMatchObject({ reason: "cancelled", cause: reason });
  expect(work.next()).toEqual({ done: true, value: undefined });
  expect(accumulator.ipc).toEqual([]);
  expect(accumulator.electronCallPathLimitReached).toBeUndefined();

  // A new analysis owns a new index and can still complete the same source.
  const completed = createJavaScriptAnalysisAccumulator(source.length);
  expect(
    completeSemanticSteps(
      collectElectronWrappedCallPathsSteps(
        parsed.program,
        index.bindings,
        source,
        completed,
        identity,
      ),
    ),
  ).toContainEqual(expect.objectContaining({ entry: "first", conditions: [] }));
  expect(completed.electronCallPathLimitReached).toBeUndefined();
});
