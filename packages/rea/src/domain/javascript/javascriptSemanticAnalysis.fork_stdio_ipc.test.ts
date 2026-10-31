import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

/**
 * Node's `fork()` requires an explicit `stdio` array to carry the IPC channel:
 * `if (!ArrayIncludes(options.stdio, 'ipc')) throw new ERR_CHILD_PROCESS_IPC_REQUIRED`.
 * The throw is synchronous, before any child process exists, so such a call is
 * not a spawn. A string `stdio` is normalised with `"ipc"` appended, so only the
 * array form can omit it, and the same array is valid for `spawn`.
 */
const spawnsFor = (call: string) =>
  analyzeJavaScriptSemantics(
    `import { fork } from "node:child_process"; ${call};`,
  ).childProcessSpawns;

it.each([
  ["three inherits", `["inherit", "inherit", "inherit"]`],
  ["three pipes", `["pipe", "pipe", "pipe"]`],
  ["ignore then pipes", `["ignore", "pipe", "pipe"]`],
  ["one inherit", `["inherit"]`],
  ["an empty array", `[]`],
] as const)(
  "emits no fork for a literal stdio array with %s and no ipc",
  (_name, stdio) => {
    expect(spawnsFor(`fork("worker.js", { stdio: ${stdio} })`)).toEqual([]);
  },
);

it.each([
  ["a fourth element", `["inherit", "inherit", "inherit", "ipc"]`],
  ["only ipc", `["ipc"]`],
  ["ipc and a pipe", `["pipe", "ipc"]`],
] as const)("keeps the fork for a stdio array with %s", (_name, stdio) => {
  expect(spawnsFor(`fork("worker.js", { stdio: ${stdio} })`)).toEqual([
    expect.objectContaining({ method: "fork", stdioMode: "array" }),
  ]);
});

it.each([
  ["a string stdio", `fork("worker.js", { stdio: "pipe" })`],
  ["omitted stdio", `fork("worker.js", {})`],
] as const)("keeps the fork for %s", (_name, call) => {
  expect(spawnsFor(call)).toHaveLength(1);
});

it.each([
  ["a spread element", `[...base, "ipc"]`],
  ["a non-literal element", `[channel]`],
] as const)(
  "keeps the fork when %s may still supply the channel",
  (_name, stdio) => {
    expect(spawnsFor(`fork("worker.js", { stdio: ${stdio} })`)).toHaveLength(1);
  },
);

it("keeps the same array for spawn, which has no IPC requirement", () => {
  const spawned = analyzeJavaScriptSemantics(
    `import { spawn } from "node:child_process"; spawn("tool", [], { stdio: ["inherit", "inherit", "inherit"] });`,
  );
  expect(spawned.childProcessSpawns).toHaveLength(1);
});
