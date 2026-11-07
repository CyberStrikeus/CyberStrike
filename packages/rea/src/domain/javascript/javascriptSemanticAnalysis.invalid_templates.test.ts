import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

const effects = (call: (value: string) => string, value: string) => {
  const ir = analyzeJavaScriptSemantics(`
    const { spawn } = require("child_process");
    const { EventEmitter } = require("events");
    ${call(value)}
  `);
  return {
    commands: ir.childProcessSpawns.map(({ command }) => command),
    endpoints: ir.requestOperations.map(({ endpoint }) => endpoint),
    events: ir.eventOperations.map(({ eventName }) => eventName),
  };
};

const calls = (value: string) =>
  [
    `spawn(${value});`,
    `fetch(${value});`,
    `new EventEmitter().on(${value}, () => 1);`,
  ].join("\n");

it("keeps recovered templates without a cooked value dynamic", () => {
  // `\\unicode` is an invalid escape: Babel recovers it with `cooked: null`.
  expect(effects(calls, "`\\unicode`")).toEqual({
    commands: [null],
    endpoints: [null],
    events: [null],
  });
  // Valid templates keep their cooked value, including escapes.
  expect(effects(calls, "`ready\\n`")).toEqual({
    commands: ["ready\n"],
    endpoints: ["ready\n"],
    events: ["ready\n"],
  });
});
