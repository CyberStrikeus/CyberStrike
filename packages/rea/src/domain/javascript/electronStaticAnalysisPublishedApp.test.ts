import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

it.each([
  ["export {app};", true],
  ["export default app;", true],
  ["export const exposed={app};", true],
  ["export const exposed=[app];", true],
  ["app.setAppPath=()=>{};export{app};", false],
  ["const local={setAppPath(){}};export{local};", false],
] as const)(
  "retains whole exported application capabilities in %s",
  (published, possible) => {
    const result = analyzeJavaScriptStaticSource(
      `import {app} from 'electron';${published}`,
    );
    expect(result.parse_error_count).toBe(0);
    expect((result.electron.app_path_changes ?? []).length > 0).toBe(possible);
  },
);

it.each([
  [
    "later local",
    "Object.assign(exports,{change:app.setAppPath},{change(){}});",
    false,
  ],
  [
    "later native",
    "Object.assign(exports,{change(){}},{change:app.setAppPath});",
    true,
  ],
  [
    "inherited",
    "const source={__proto__:{change:app.setAppPath}};Object.assign(exports,source);",
    false,
  ],
  [
    "own",
    "const source={__proto__:{change(){}},change:app.setAppPath};Object.assign(exports,source);",
    true,
  ],
  [
    "later local alias",
    "const local={change(){}};Object.assign(exports,{change:app.setAppPath},local);",
    false,
  ],
  [
    "unrelated later field",
    "Object.assign(exports,{change:app.setAppPath},{other(){}});",
    true,
  ],
  ["array own", "Object.assign(exports,[app.setAppPath]);", true],
  [
    "nullish sources",
    "Object.assign(exports,{change:app.setAppPath},null,undefined);",
    true,
  ],
  [
    "getter deletes a later source slot",
    "Object.assign(exports,{change:app.setAppPath},{get first(){delete this.change},change(){}});",
    true,
  ],
] as const)("publishes only copied fields for %s", (_name, body, possible) => {
  let changed = 0;
  const app = {
    setAppPath() {
      changed++;
    },
  };
  const module = { exports: {} };
  runInNewContext(body, { app, module, exports: module.exports });
  const fields = Object.values(module.exports) as unknown[];
  for (const field of fields)
    if (typeof field === "function") field.call(app, "./lib");
  expect(changed > 0).toBe(possible);
  const result = analyzeJavaScriptStaticSource(
    `const{app}=require('electron');${body}`,
  );
  expect(result.parse_error_count).toBe(0);
  expect((result.electron.app_path_changes ?? []).length > 0).toBe(possible);
});

it("retains the final named own exports without publishing overwritten fields", () => {
  const result = analyzeJavaScriptSemantics(
    "const local=()=>{};Object.assign(exports,{change:require('electron').app.setAppPath,retained:local},{change:local});",
  );
  expect(
    result.moduleLinks
      .filter(({ kind }) => kind === "commonjs-export")
      .map(({ exportedName }) => exportedName)
      .sort(),
  ).toEqual(["change", "retained"]);
});

it("retains copied module provenance without publishing the namespace object", () => {
  const result = analyzeJavaScriptSemantics(
    "Object.assign(exports,require('./factory.cjs'));",
  );
  expect(result.moduleLinks).toContainEqual(
    expect.objectContaining({
      kind: "commonjs-export",
      exportedName: "*",
      specifier: "./factory.cjs",
      importedName: null,
      localName: null,
      callableId: null,
    }),
  );
});
