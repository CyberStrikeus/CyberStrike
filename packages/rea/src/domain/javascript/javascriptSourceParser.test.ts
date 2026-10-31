import { expect, it } from "vitest";
import * as t from "@babel/types";

import {
  parseJavaScriptSource,
  parseRecoveredJavaScript,
  parserPluginsForPath,
  javaScriptRuntimeContext,
  javaScriptProgramStrictness,
} from "./javascriptSourceParser.js";
import { analyzeParsedJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it.each([
  ['import type {T} from "example";', "fixture.cts", "commonjs"],
  ['import type {T} from "example";', "fixture.mts", "module"],
  ['import type {T} from "example";', "fixture.ts", "unknown"],
  ['import cp = require("node:child_process");', "fixture.ts", "module"],
  ['import type cp = require("node:child_process");', "fixture.ts", "unknown"],
  ["const value=[]; export = value;", "fixture.ts", "commonjs"],
  ['export type {T} from "example";', "fixture.ts", "unknown"],
  ['import {type T} from "example";', "fixture.ts", "unknown"],
  ['export {type T} from "example";', "fixture.ts", "unknown"],
  ["export declare const value: unknown;", "fixture.ts", "unknown"],
  ["export default function f(): void;", "fixture.ts", "unknown"],
  ["export default interface I {}", "fixture.ts", "unknown"],
  ["export default function f() {}", "fixture.ts", "module"],
  ["export default class C {}", "fixture.ts", "module"],
  ['import {} from "example";', "fixture.js", "module"],
  ['import {} from "example";', "fixture.cjs", "commonjs"],
  ["export {};", "fixture.ts", "module"],
  ["const value = 1;", "fixture.mjs", "module"],
  ["const value = 1;", "fixture.js", "unknown"],
  ["const value = 1;", "fixture.cjs", "commonjs"],
  ["const value = 1;", "fixture.cts", "commonjs"],
  ["declare const value: unknown;", "fixture.d.cts", "unknown"],
] as const)(
  "keeps runtime context consistent across parser entries: %s (%s)",
  (source, path, context) => {
    const parsed = parseJavaScriptSource(source, path);
    if (parsed === null) throw new Error("Expected parsed source");
    const recovered = parseRecoveredJavaScript(source, path, {
      plugins: parserPluginsForPath(path),
    }).file;
    expect(javaScriptRuntimeContext(parsed.program)).toBe(context);
    expect(javaScriptRuntimeContext(recovered.program)).toBe(context);
    expect(javaScriptRuntimeContext(t.cloneNode(parsed.program, true))).toBe(
      "unknown",
    );
  },
);

it.each([
  ["const args=[]; export = args;", "fixture.ts", "sloppy"],
  ['"use strict"; const args=[]; export = args;', "fixture.ts", "strict"],
  ['import type {T} from "example";', "fixture.ts", "unknown"],
  ["const args=[];", "fixture.mjs", "strict"],
  ["const args=[];", "fixture.cjs", "sloppy"],
] as const)(
  "owns program strictness independently of parser syntax: %s (%s)",
  (source, path, strictness) => {
    const parsed = parseJavaScriptSource(source, path);
    if (parsed === null) throw new Error("Expected parsed source");
    expect(javaScriptProgramStrictness(parsed.program)).toBe(strictness);
    const recovered = parseRecoveredJavaScript(source, path, {
      plugins: parserPluginsForPath(path),
    }).file;
    expect(javaScriptProgramStrictness(recovered.program)).toBe(strictness);
  },
);

const analyze = (source: string, path: string) => {
  const parsed = parseJavaScriptSource(source, path);
  return parsed === null
    ? null
    : {
        errors: parsed.errors.length,
        facts: analyzeParsedJavaScriptStaticSource(source, parsed),
      };
};

it("parses conditional arrow bodies in JavaScript sources with JavaScript grammar", () => {
  // Bundlers emit this shape; TypeScript reads `):H=>` as a return type.
  const source = `const {ipcMain}=require("electron");
const pick=n===0?H=>({start:H.startY}):H=>({start:H.startX});
ipcMain.handle("layout:ready",()=>pick);`;
  for (const path of ["main.js", "main.cjs", "main.mjs", "main.jsx"]) {
    const result = analyze(source, path);
    expect(result?.errors).toBe(0);
    expect(result?.facts.electron.ipc).toContainEqual(
      expect.objectContaining({ channel: "layout:ready", operation: "handle" }),
    );
  }
});

it("keeps JavaScript comparison meaning for angle brackets in JavaScript sources", () => {
  const source = `const a=fetch<limit>("/api/compare");`;
  expect(analyze(source, "main.js")?.facts.endpoints).toEqual([]);
  expect(analyze(source, "main.ts")?.facts.endpoints).toContainEqual(
    expect.objectContaining({ value: "/api/compare" }),
  );
});

it("keeps TypeScript syntax available for TypeScript and unnamed sources", () => {
  const source = "let count: number = 1; export type Id = string;";
  expect(parseJavaScriptSource(source, "value.ts")?.errors).toEqual([]);
  expect(parseJavaScriptSource(source)?.errors).toEqual([]);
});
