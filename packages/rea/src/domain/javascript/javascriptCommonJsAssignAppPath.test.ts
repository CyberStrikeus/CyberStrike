import { runInNewContext } from "node:vm";

import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

const cases = [
  [
    "native source spread",
    "Object.assign(exports,...[{change:app.setAppPath,app}]);",
    true,
  ],
  [
    "native target spread",
    "Object.assign(...[exports,{change:app.setAppPath,app}]);",
    true,
  ],
  [
    "native call",
    "Object.assign.call(null,exports,{change:app.setAppPath,app});",
    true,
  ],
  [
    "native apply",
    "Object.assign.apply(null,[exports,{change:app.setAppPath,app}]);",
    true,
  ],
  [
    "captured intrinsic before replacement",
    "const publish=Object.assign;Object.assign=()=>{};publish(exports,{change:app.setAppPath,app});",
    true,
  ],
  [
    "replaced intrinsic",
    "Object.assign=()=>{};Object.assign(exports,{change:app.setAppPath,app});",
    false,
  ],
  [
    "replaced call",
    "Object.assign.call=()=>{};Object.assign.call(null,exports,{change:app.setAppPath,app});",
    false,
  ],
  [
    "replaced apply",
    "Object.assign.apply=()=>{};Object.assign.apply(null,[exports,{change:app.setAppPath,app}]);",
    false,
  ],
  [
    "replaced Function call",
    "Function.prototype.call=()=>{};Object.assign.call(null,exports,{change:app.setAppPath,app});",
    false,
  ],
  [
    "replaced Function apply",
    "Function.prototype.apply=()=>{};Object.assign.apply(null,[exports,{change:app.setAppPath,app}]);",
    false,
  ],
  [
    "native exports",
    "Object.assign(exports,{change:app.setAppPath,app});",
    true,
  ],
  [
    "native module exports",
    "Object.assign(module.exports,{change:app.setAppPath,app});",
    true,
  ],
  [
    "detached before",
    "module.exports={};Object.assign(exports,{change:app.setAppPath,app});",
    false,
  ],
  [
    "detached after",
    "Object.assign(exports,{change:app.setAppPath,app});module.exports={};",
    false,
  ],
  [
    "reconnected",
    "exports=module.exports={};Object.assign(exports,{change:app.setAppPath,app});",
    true,
  ],
  [
    "local exports",
    "const exports={};Object.assign(exports,{change:app.setAppPath,app});",
    false,
  ],
  [
    "local Object",
    "const Object={assign(){}};Object.assign(exports,{change:app.setAppPath,app});",
    false,
  ],
  [
    "local setter",
    "app.setAppPath=()=>{};Object.assign(exports,{change:app.setAppPath,app});",
    false,
  ],
] as const;

it.each(cases)(
  "retains an Object.assign-published setter for %s",
  (_name, body, possible) => {
    const defining = `const{app}=require('electron');${body}`;
    let changed = 0;
    const module = { exports: {} };
    runInNewContext(defining, {
      module,
      exports: module.exports,
      require: () => ({ app: { setAppPath: () => changed++ } }),
    });
    expect(changed).toBe(0);
    runInNewContext(
      "if(typeof change==='function')change.call(app,'./lib');",
      module.exports,
    );
    expect(changed).toBe(possible ? 1 : 0);
    const analysis = analyzeJavaScriptStaticSource(defining);
    expect(analysis.parse_error_count).toBe(0);
    expect((analysis.electron.app_path_changes ?? []).length > 0).toBe(
      possible,
    );
  },
);

it("retains native source uncertainty when an array iterator is overwritten", () => {
  const defining =
    "const{app}=require('electron');const sources=[{change:app.setAppPath,app}];sources[Symbol.iterator]=function*(){yield{change(){},app}};Object.assign(exports,...sources);";
  let changed = 0;
  const module = { exports: {} };
  runInNewContext(defining, {
    module,
    exports: module.exports,
    require: () => ({ app: { setAppPath: () => changed++ } }),
  });
  runInNewContext("change.call(app,'./lib');", module.exports);
  expect(changed).toBe(0);
  runInNewContext("app.setAppPath('./lib');", module.exports);
  expect(changed).toBe(1);
  // The local change function is harmless, but the published app still permits
  // a caller to select the native setter. Unknown iteration retains that
  // possibility without identifying a yielded value or an exact export link.
  const analysis = analyzeJavaScriptStaticSource(defining);
  expect((analysis.electron.app_path_changes ?? []).length).toBeGreaterThan(0);
  const ir = analyzeJavaScriptSemantics(defining);
  expect(
    ir.moduleLinks.filter(({ kind }) => kind === "commonjs-export"),
  ).toEqual([
    expect.objectContaining({
      exportedName: "*",
      specifier: null,
      importedName: null,
      callableId: null,
    }),
  ]);
});

it.each([
  [
    "opaque iteration without an Electron source",
    "const sources=[{change(){}}];sources[Symbol.iterator]=opaqueIterator;Object.assign(exports,...sources);",
  ],
  [
    "unresolved iteration into a detached export receiver",
    "const{app}=require('electron');const sources=[{change:app.setAppPath,app}];sources[Symbol.iterator]=opaqueIterator;module.exports={};Object.assign(exports,...sources);",
  ],
])("does not invent a public app-path effect from %s", (_name, source) => {
  const analysis = analyzeJavaScriptStaticSource(source);
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.electron.app_path_changes ?? []).toEqual([]);
});
