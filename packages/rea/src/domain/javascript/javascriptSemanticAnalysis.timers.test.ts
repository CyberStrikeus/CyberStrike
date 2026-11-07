import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

const timerOperations = (source: string) =>
  analyzeJavaScriptSemantics(source).timerOperations;

it("does not link cancellation to a timer after its handle is cleared", () => {
  const operations = timerOperations(`
    let handle = setTimeout(work, 10);
    handle = null;
    clearTimeout(handle);
  `);

  expect(operations.at(-1)).toMatchObject({
    kind: "cancel",
    linkedTimerId: null,
    resolution: "unresolved",
  });
});

it("links cancellation to the latest preceding timer assignment", () => {
  const operations = timerOperations(`
    let handle = setTimeout(first, 10);
    handle = setTimeout(second, 20);
    clearTimeout(handle);
  `);

  expect(operations[2]).toMatchObject({
    kind: "cancel",
    linkedTimerId: operations[1]?.timerId,
    resolution: "complete",
  });
});

it("does not link cancellation to a timer scheduled later", () => {
  const operations = timerOperations(`
    let handle;
    clearTimeout(handle);
    handle = setTimeout(work, 10);
  `);

  expect(operations[0]).toMatchObject({
    kind: "cancel",
    linkedTimerId: null,
    resolution: "unresolved",
  });
});

it("preserves an immutable timer handle captured by a closure", () => {
  const operations = timerOperations(`
    const handle = setTimeout(work, 10);
    const cancel = () => clearTimeout(handle);
  `);

  expect(operations[1]).toMatchObject({
    kind: "cancel",
    linkedTimerId: operations[0]?.timerId,
    resolution: "complete",
  });
});

it("keeps cancellation uncertain after a conditional handle replacement", () => {
  const operations = timerOperations(`
    let handle = setTimeout(work, 10);
    if (condition) handle = null;
    clearTimeout(handle);
  `);

  expect(operations.at(-1)).toMatchObject({
    kind: "cancel",
    linkedTimerId: operations[0]?.timerId,
    resolution: "partial",
  });
});

it("keeps cancellation uncertain across a mutable closure capture", () => {
  const operations = timerOperations(`
    let handle = setTimeout(work, 10);
    const cancel = () => clearTimeout(handle);
    handle = null;
  `);

  expect(operations[1]).toMatchObject({
    kind: "cancel",
    linkedTimerId: operations[0]?.timerId,
    resolution: "partial",
  });
});
