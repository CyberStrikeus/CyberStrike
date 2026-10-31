import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

import { analyzeCommonJsStaticFixture } from "../../../tests/fixtures/javascriptCommonJsAnalysis.js";

const cases = [
  ["native setter", "const change=app.setAppPath;", true, [1]],
  [
    "local replacement",
    "app.setAppPath=()=>{};const change=app.setAppPath;",
    false,
    [0],
  ],
  [
    "conditional replacement",
    "if(flag)app.setAppPath=()=>{};const change=app.setAppPath;",
    true,
    [1, 0],
  ],
  [
    "capture before replacement",
    "const change=app.setAppPath;app.setAppPath=()=>{};",
    true,
    [1],
  ],
  [
    "capture after replacement",
    "app.setAppPath=()=>{};const change=app.setAppPath;",
    false,
    [0],
  ],
] as const;

it.each(cases)(
  "retains the possible exported app-path effect after %s",
  (_name, body, possible, calls) => {
    const defining = `const {app}=require('electron');${body}`;
    for (const [index, expected] of calls.entries()) {
      let changed = 0;
      // Authored module-namespace values model capture and invocation in two
      // separate VM contexts; the fixture does not execute Electron itself.
      const namespace = runInNewContext(`${defining}({change,app});`, {
        flag: index === 1,
        require: () => ({ app: { setAppPath: () => changed++ } }),
      });
      expect(changed).toBe(0);
      runInNewContext("change.call(app,'./lib');", namespace);
      expect(changed).toBe(expected);
    }
    const exported = analyzeCommonJsStaticFixture(
      `${defining}export{change,app};`,
    );
    expect(exported.parse_error_count).toBe(0);
    expect((exported.electron.app_path_changes ?? []).length > 0).toBe(
      possible,
    );
    const caller = analyzeCommonJsStaticFixture(
      "import{change,app}from'./helper.mjs';change.call(app,'./lib');",
    );
    expect(caller.parse_error_count).toBe(0);
    expect(caller.electron.app_path_changes ?? []).toEqual([]);
  },
);

it("does not treat a type-only exported setter as a runtime escape", () => {
  const analysis = analyzeCommonJsStaticFixture(
    "const{app}=require('electron');const change=app.setAppPath;export type{change};",
  );
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.electron.app_path_changes ?? []).toEqual([]);
});

it.each([
  ["export const change=app.setAppPath;", true],
  ["export default app.setAppPath;", true],
  ["export const change=()=>{};", false],
  ["export default ()=>{};", false],
] as const)(
  "selects the published runtime value in %s",
  (declaration, possible) => {
    const analysis = analyzeCommonJsStaticFixture(
      `const{app}=require('electron');${declaration}`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect((analysis.electron.app_path_changes ?? []).length > 0).toBe(
      possible,
    );
  },
);

it.each(cases)(
  "retains the captured CommonJS namespace setter after %s",
  (_name, body, possible, calls) => {
    const defining = `const {app}=require('electron');${body}module.exports={change,app};`;
    for (const [index, expected] of calls.entries()) {
      let changed = 0;
      const module = { exports: {} };
      runInNewContext(defining, {
        module,
        exports: module.exports,
        flag: index === 1,
        require: () => ({ app: { setAppPath: () => changed++ } }),
      });
      expect(changed).toBe(0);
      runInNewContext("change.call(app,'./lib');", module.exports);
      expect(changed).toBe(expected);
    }
    const analysis = analyzeCommonJsStaticFixture(defining);
    expect(analysis.parse_error_count).toBe(0);
    expect((analysis.electron.app_path_changes ?? []).length > 0).toBe(
      possible,
    );
  },
);

it.each([
  ["module.exports=change;", true],
  ["exports.change=change;", true],
  ["module.exports.change=change;", true],
  ["Object.defineProperty(exports,'change',{value:change});", true],
  ["exports.change=change;module.exports={};", false],
  ["const module={exports:{}};module.exports={change};", false],
  ["const exports={};exports.change=change;", false],
  ["export const namespace={change,app};", true],
] as const)(
  "follows shared runtime export values and receivers in %s",
  (published, possible) => {
    const analysis = analyzeCommonJsStaticFixture(
      `const {app}=require('electron');const change=app.setAppPath;${published}`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect((analysis.electron.app_path_changes ?? []).length > 0).toBe(
      possible,
    );
  },
);
