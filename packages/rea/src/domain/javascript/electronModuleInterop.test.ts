import { describe, expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { ROLLDOWN_MODULE_INTEROP } from "./javascriptModuleInterop.fixture.js";

const WINDOW =
  'new electron.BrowserWindow({webPreferences:{preload:"./preload.js"}});';
const IMPORT = 'let electron = require("electron");';
const WRAP = "electron = __toESM(electron, 1);";
// The upstream runtime uses control-body braces that its bundled printer omits.
// https://github.com/rolldown/rolldown/blob/22a0ab13732d81f2559ad2b7064b688699324889/crates/rolldown/src/runtime/runtime-base.js
const BLOCK_MODULE_INTEROP = ROLLDOWN_MODULE_INTEROP.replace(
  'if (from && typeof from === "object" || typeof from === "function") for',
  'if (from && typeof from === "object" || typeof from === "function") { for',
)
  .replace(
    "if (!__hasOwnProp.call(to, key) && key !== except) __defProp",
    "if (!__hasOwnProp.call(to, key) && key !== except) { __defProp",
  )
  .replace("    });", "    });\n    }")
  .replace("  return to;", "  }\n  return to;");

describe("Electron module interop identity", () => {
  it("preserves named APIs through the released Rolldown namespace conversion", () => {
    const analysis = analyzeJavaScriptStaticSource(`${ROLLDOWN_MODULE_INTEROP}
      ${IMPORT} ${WRAP} ${WINDOW}
      new electron.BrowserWindow({webPreferences:{preload:runtimePath}});
      electron.ipcMain.handle("ping", () => "pong");
      electron.contextBridge.exposeInMainWorld("api", {ping:true});
    `);
    expect(analysis.electron.browser_windows).toMatchObject([
      { preload_path: "./preload.js" },
      { preload_path: null },
    ]);
    expect(analysis.electron.ipc).toMatchObject([
      { channel: "ping", side: "main" },
    ]);
    expect(analysis.electron.context_bridge_apis).toMatchObject([
      { api_key: "api" },
    ]);
  });

  it("follows lexical identities when helper and parameter names change", () => {
    const source = `${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP} ${WINDOW}`
      .replaceAll("__toESM", "namespaceOf")
      .replaceAll("__copyProps", "copyNamed")
      .replaceAll("mod", "inputModule")
      .replaceAll("isNodeMode", "nodeMode")
      .replaceAll("target", "namespaceTarget")
      .replaceAll("from", "sourceObject");
    expect(
      analyzeJavaScriptStaticSource(source).electron.browser_windows,
    ).toMatchObject([{ preload_path: "./preload.js" }]);
  });

  it("preserves the same operations through control-body braces", () => {
    expect(
      analyzeJavaScriptStaticSource(
        `${BLOCK_MODULE_INTEROP}\n${IMPORT} ${WRAP} ${WINDOW}`,
      ).electron.browser_windows,
    ).toMatchObject([{ preload_path: "./preload.js" }]);
  });

  it("keeps additional operations inside a control block unresolved", () => {
    const altered = BLOCK_MODULE_INTEROP.replace(
      "{ __defProp",
      "{ from = unrelated; __defProp",
    );
    expect(
      analyzeJavaScriptStaticSource(`${altered}\n${IMPORT} ${WRAP} ${WINDOW}`)
        .electron.browser_windows,
    ).toEqual([]);
  });
});

const BOUND_INTRINSIC_MUTATIONS: [string, string][] = [
  [
    "intrinsic changed through aliased prebound arguments",
    `const objectAlias = Object; const key = "create"; const define = Object.defineProperty; const mutate = define.bind(null, objectAlias, key); mutate({value:customCreate}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
  ],
  [
    "intrinsic changed through nested prebinding",
    `const first = Object.defineProperty.bind(null, Object); const second = first.bind(null, "create"); second({value:customCreate}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
  ],
  [
    "a replaced bound mutator bind method is unknown",
    `const first = Object.defineProperty.bind(null, Object); first.bind = customBind; const second = first.bind(null, "create"); second({value:customCreate}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
  ],
  [
    "intrinsic changed through a computed prebound call",
    `const mutate = Object.defineProperty.bind(null, Object, "create"); mutate["call"](null, {value:customCreate}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
  ],
  [
    "intrinsic changed through a computed prebound apply",
    `const mutate = Object.defineProperty.bind(null, Object, "create"); mutate["apply"](null, [{value:customCreate}]); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
  ],
  [
    "a replaced bind intrinsic makes a prebound mutator unknown",
    `Function.prototype.bind = customBind; const mutate = Object.defineProperty.bind(null, Object, "create"); mutate({value:customCreate}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
  ],
];

describe("Electron module interop uncertainty", () => {
  it.each([
    ...BOUND_INTRINSIC_MUTATIONS,
    [
      "intrinsic changed through an unresolved mutator target",
      `Object.defineProperty(getTarget(), "create", {value:customCreate}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed via dynamic apply",
      `const args = [Object, "getOwnPropertyNames", {value:() => []}]; Object.defineProperty.apply(null, args); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed via spread call",
      `const args = [Object, "getOwnPropertyNames", {value:() => []}]; Object.defineProperty.call(null, ...args); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed via Reflect.apply",
      `const args = [Object, "getOwnPropertyNames", {value:() => []}]; Reflect.apply(Object.defineProperty, null, args); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed via spread Reflect.apply",
      `const args = [null, [Object, "create", {value:customCreate}]]; Reflect.apply(Object.defineProperty, ...args); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed via call",
      `Object.defineProperty.call(null, Object, "getOwnPropertyNames", {value:() => []}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed via apply",
      `Object.defineProperty.apply(null, [Object, "getOwnPropertyNames", {value:() => []}]); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed with defineProperty",
      `Object.defineProperty(Object, "getOwnPropertyNames", {value:() => []}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed with Reflect.set",
      `Reflect.set(Object, "getOwnPropertyNames", () => []); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed with an aliased mutator",
      `const change = Object.defineProperty; change(Object, "create", {value:customCreate}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed with assign",
      `Object.assign(Object, {getOwnPropertyNames:() => []}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed with defineProperties",
      `Object.defineProperties(Function.prototype, {bind:{value:customBind}}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "overwritten Object global",
      `Object = customObject; ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "overwritten intrinsic through an alias",
      `const objectAlias = Object; objectAlias.create = customCreate; ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "overwritten intrinsic through globalThis",
      `globalThis.Object.create = customCreate; ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "helper called before initialization",
      `${IMPORT} ${WRAP} ${ROLLDOWN_MODULE_INTEROP}`,
    ],
    [
      "fake helper",
      `${ROLLDOWN_MODULE_INTEROP}\n__toESM = (mod) => ({BrowserWindow:Fake}); ${IMPORT} ${WRAP}`,
    ],
    [
      "changed getter",
      `${ROLLDOWN_MODULE_INTEROP.replace("from[k]", "to[k]")}\n${IMPORT} ${WRAP}`,
    ],
    [
      "replaced copy helper",
      `${ROLLDOWN_MODULE_INTEROP}\n__copyProps = () => ({}); ${IMPORT} ${WRAP}`,
    ],
    [
      "replaced intrinsic alias",
      `${ROLLDOWN_MODULE_INTEROP}\n__defProp = () => ({}); ${IMPORT} ${WRAP}`,
    ],
    [
      "shadowed Object",
      `const Object = customObject; ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "overwritten intrinsic",
      `Object.create = customCreate; ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "overwritten alias call",
      `${ROLLDOWN_MODULE_INTEROP}\n__hasOwnProp.call = customCall; ${IMPORT} ${WRAP}`,
    ],
    [
      "overwritten Function bind",
      `${ROLLDOWN_MODULE_INTEROP}\nFunction.prototype.bind = customBind; ${IMPORT} ${WRAP}`,
    ],
    [
      "conditional conversion",
      `${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} if (flag) { ${WRAP} }`,
    ],
    [
      "compound assignment",
      `${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} electron ||= __toESM(electron, 1);`,
    ],
    [
      "other input",
      `${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} electron = __toESM(other, 1);`,
    ],
    [
      "later overwrite",
      `${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP} electron = unrelated;`,
    ],
    [
      "overwritten constructor",
      `${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP} electron.BrowserWindow = Fake;`,
    ],
  ])("does not infer Electron identity after %s", (_name, setup) => {
    expect(
      analyzeJavaScriptStaticSource(`${setup}\n${WINDOW}`).electron
        .browser_windows,
    ).toEqual([]);
  });
});

describe("Electron module interop helper results", () => {
  it.each([
    'const {BrowserWindow} = __toESM(require("electron"), 1); new BrowserWindow({});',
    'const {BrowserWindow: Window} = __toESM(require("electron"), 1); new Window({});',
    'const {default: {BrowserWindow}} = __toESM(require("electron"), 1); new BrowserWindow({});',
    'const Window = __toESM(require("electron"), 1).BrowserWindow; new Window({});',
  ])("preserves a proven result projection: %s", (source) => {
    expect(
      analyzeJavaScriptStaticSource(`${ROLLDOWN_MODULE_INTEROP}\n${source}`)
        .electron.browser_windows,
    ).toHaveLength(1);
  });

  it.each([
    'const {[key]: Window} = __toESM(require("electron"), 1); new Window({});',
    'const {...electron} = __toESM(require("electron"), 1); new electron.BrowserWindow({});',
    'let {BrowserWindow} = __toESM(require("electron"), 1); BrowserWindow = Fake; new BrowserWindow({});',
  ])("keeps an uncertain result projection unresolved: %s", (source) => {
    expect(
      analyzeJavaScriptStaticSource(`${ROLLDOWN_MODULE_INTEROP}\n${source}`)
        .electron.browser_windows,
    ).toEqual([]);
  });

  it.each([
    "",
    ", 0",
    ", false",
    ", true",
    ", 1",
    ', "node"',
    ', ""',
    ", null",
  ])("preserves named exports with a literal node mode: %s", (mode) => {
    const analysis = analyzeJavaScriptStaticSource(`${ROLLDOWN_MODULE_INTEROP}
        const fresh = __toESM(require("electron")${mode});
        new fresh.BrowserWindow({});
        const {BrowserWindow} = __toESM(require("electron")${mode});
        new BrowserWindow({});
        let electron = require("electron");
        electron = __toESM(electron${mode}); ${WINDOW}
      `);
    expect(analysis.electron.browser_windows).toHaveLength(3);
  });

  it.each(["", ", 0", ", false"])(
    "does not assume a module-valued default with node mode: %s",
    (mode) => {
      const analysis = analyzeJavaScriptStaticSource(`${ROLLDOWN_MODULE_INTEROP}
        const original = require("electron");
        original.__esModule = true;
        original.default = {BrowserWindow: Fake};
        const {default: {BrowserWindow}} = __toESM(require("electron")${mode});
        new BrowserWindow({});
        const other = __toESM(require("electron")${mode}).default;
        new other.BrowserWindow({});
        new (__toESM(require("electron")${mode}).default.BrowserWindow)({});
      `);
      expect(analysis.electron.browser_windows).toEqual([]);
    },
  );

  it.each(["__toESM", "identity"])(
    "rejects side-effecting extra arguments to %s",
    (helper) => {
      const analysis = analyzeJavaScriptStaticSource(`${ROLLDOWN_MODULE_INTEROP}
        function identity(mod) { return mod; }
        const electron = ${helper}(require("electron"), mutate()); ${WINDOW}
      `);
      expect(analysis.electron.browser_windows).toEqual([]);
    },
  );

  it.each([
    "const __toESM = () => ({BrowserWindow:FakeWindow});",
    "const __toESM = async (mod) => mod;",
    "function* __toESM(mod) { return mod; }",
    "const __toESM = (this && this.__toESM) || ((mod) => mod);",
  ])("keeps an unproven fresh result unresolved: %s", (helper) => {
    const analysis = analyzeJavaScriptStaticSource(`${helper}
      const electron = __toESM(require("electron"), 1); ${WINDOW}
      new (__toESM(require("electron"), 1)).BrowserWindow({});
    `);
    expect(analysis.electron.browser_windows).toEqual([]);
  });

  it("preserves a proven fresh namespace and a pure identity helper", () => {
    const analysis = analyzeJavaScriptStaticSource(`${ROLLDOWN_MODULE_INTEROP}
      const electron = __toESM(require("electron"), 1); ${WINDOW}
      new (__toESM(require("electron"), 1)).BrowserWindow({});
      function passthrough(value) {return value;}
      const plain = passthrough(require("electron"));
      new plain.BrowserWindow({});
    `);
    expect(analysis.electron.browser_windows).toHaveLength(3);
  });
});

describe("Electron module interop pattern writes", () => {
  it.each([
    "({Object} = replacements);",
    "[Function] = replacements;",
    "({nested:{Object}} = replacements);",
    "({replacement:Object = customObject} = replacements);",
    "({...Object} = replacements);",
    "[...Function] = replacements;",
    "for ({Object} of replacements) {}",
    "for ([Function] in replacements) {}",
  ])("rejects an intrinsic replaced through %s", (write) => {
    const analysis = analyzeJavaScriptStaticSource(`
      ${write} ${ROLLDOWN_MODULE_INTEROP} ${IMPORT} ${WRAP} ${WINDOW}
    `);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.electron.browser_windows).toEqual([]);
  });

  it.each([
    "({Object:unrelated} = replacements);",
    "function decoy(Object) {({Object} = replacements);}",
  ])("preserves intrinsic identity for an unrelated target: %s", (write) => {
    const analysis = analyzeJavaScriptStaticSource(`
      ${write} ${ROLLDOWN_MODULE_INTEROP} ${IMPORT} ${WRAP} ${WINDOW}
    `);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.electron.browser_windows).toHaveLength(1);
  });

  it("preserves captured operations after later property destructuring", () => {
    const analysis = analyzeJavaScriptStaticSource(`
      ${ROLLDOWN_MODULE_INTEROP} ({create:Object.create} = replacements);
      ${IMPORT} ${WRAP} ${WINDOW}
    `);
    expect(analysis.electron.browser_windows).toHaveLength(1);
  });
});

describe("Electron module interop intrinsic captures", () => {
  it.each([
    "var captured = Object.defineProperty;",
    "const {defineProperty:captured} = Object;",
    "var first = Object.defineProperty; const captured = first;",
  ])("retains the original function capture through %s", (capture) => {
    const runtime = ROLLDOWN_MODULE_INTEROP.replace(
      "__defProp = Object.defineProperty",
      "__defProp = captured",
    );
    const analysis = analyzeJavaScriptStaticSource(`
      ${capture} Object.defineProperty = custom;
      ${runtime} ${IMPORT} ${WRAP} ${WINDOW}
    `);
    expect(analysis.electron.browser_windows).toHaveLength(1);
  });

  it.each(["var", "const"])(
    "keeps an intrinsic alias read before its %s initializer unresolved",
    (kind) => {
      const runtime = ROLLDOWN_MODULE_INTEROP.replace(
        "__defProp = Object.defineProperty",
        "__defProp = later",
      );
      const analysis = analyzeJavaScriptStaticSource(`
        ${runtime} ${kind} later = Object.defineProperty;
        ${IMPORT} ${WRAP} ${WINDOW}
      `);
      expect(analysis.electron.browser_windows).toEqual([]);
    },
  );

  it("requires the helper's intrinsic binding to initialize before conversion", () => {
    const runtime = ROLLDOWN_MODULE_INTEROP.replace(
      "var __defProp = Object.defineProperty;",
      "",
    );
    const analysis = analyzeJavaScriptStaticSource(`
      var captured = Object.defineProperty;
      ${runtime} ${IMPORT} ${WRAP} ${WINDOW}
      var __defProp = captured;
    `);
    expect(analysis.electron.browser_windows).toEqual([]);
  });
});

describe("Electron module interop capture and scope", () => {
  it.each(["metadata", "alias"])(
    "recognizes a hoisted function target through %s",
    (target) => {
      const analysis = analyzeJavaScriptStaticSource(`
        const alias = metadata;
        Object.defineProperty(${target}, "x", {value:1});
        function metadata() {}
        ${ROLLDOWN_MODULE_INTEROP} ${IMPORT} ${WRAP} ${WINDOW}
      `);
      expect(analysis.electron.browser_windows).toHaveLength(1);
    },
  );

  it.each([
    "var metadata = function () {};",
    "const metadata = () => {};",
    "class metadata {}",
  ])("does not hoist fresh targets from %s", (declaration) => {
    const analysis = analyzeJavaScriptStaticSource(`
      Object.defineProperty(metadata, "x", {value:1});
      ${declaration}
      ${ROLLDOWN_MODULE_INTEROP} ${IMPORT} ${WRAP} ${WINDOW}
    `);
    expect(analysis.electron.browser_windows).toEqual([]);
  });

  it.each([
    'const {defineProperty:change} = Object; change(Object,"create",{value:customCreate});',
    "const objectAlias = Object; const {assign:change} = objectAlias; change(Object,{create:customCreate});",
    'const {set:change} = Reflect; change(Object,"create",customCreate);',
    'const {Object:{defineProperty:change}} = globalThis; change(Object,"create",{value:customCreate});',
  ])("rejects a projected intrinsic mutator alias: %s", (write) => {
    const source = `${write} ${ROLLDOWN_MODULE_INTEROP}
      ${IMPORT} ${WRAP} ${WINDOW}
    `.replaceAll("__toESM", "namespaceOf");
    const analysis = analyzeJavaScriptStaticSource(source);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.electron.browser_windows).toEqual([]);
  });

  it.each([
    "const metadata = {};",
    "const metadata = [];",
    "const initial = {}; const metadata = initial;",
    "const metadata = () => {};",
    "const metadata = function () {};",
    "const metadata = async () => {};",
    "const metadata = function* () {};",
    "const metadata = class {};",
    "const metadata = /local/;",
    "function metadata() {}",
    "class metadata {}",
  ])(
    "keeps a fresh mutator target separate from intrinsic identity: %s",
    (setup) => {
      const analysis = analyzeJavaScriptStaticSource(`
      ${setup} Object.defineProperty(metadata,"x",{value:1});
      ${ROLLDOWN_MODULE_INTEROP} ${IMPORT} ${WRAP} ${WINDOW}
    `);
      expect(analysis.electron.browser_windows).toHaveLength(1);
    },
  );

  it.each([
    "const metadata = getMetadata();",
    "let metadata = {}; metadata = Object;",
    "Object.defineProperty(metadata,'x',{value:1}); const metadata = {};",
    "const metadata = {intrinsic:Object}; Object.defineProperty(metadata.intrinsic,'create',{value:customCreate});",
    "const metadata = class {static {Object.create = customCreate;}};",
    "@(() => Object) class metadata {}",
  ])("keeps an unproven mutator target unresolved: %s", (setup) => {
    const analysis = analyzeJavaScriptStaticSource(`
      ${setup} Object.defineProperty(metadata,"x",{value:1});
      ${ROLLDOWN_MODULE_INTEROP} ${IMPORT} ${WRAP} ${WINDOW}
    `);
    expect(analysis.electron.browser_windows).toEqual([]);
  });

  it("does not reject unrelated intrinsic property definitions", () => {
    const analysis = analyzeJavaScriptStaticSource(`
      Object.defineProperty(Object, "unrelated", {value:1});
      ${ROLLDOWN_MODULE_INTEROP} ${IMPORT} ${WRAP} ${WINDOW}
    `);
    expect(analysis.electron.browser_windows).toHaveLength(1);
  });

  it("keeps opaque targets in a generic helper separate from outer module identity", () => {
    const analysis = analyzeJavaScriptStaticSource(`
      function genericAssign() { Object.assign.apply(null, arguments); }
      ${ROLLDOWN_MODULE_INTEROP} ${IMPORT} ${WRAP} ${WINDOW}
    `);
    expect(analysis.electron.browser_windows).toHaveLength(1);
  });

  it("rejects an opaque intrinsic mutation in the namespace's own callable", () => {
    const analysis = analyzeJavaScriptStaticSource(`${ROLLDOWN_MODULE_INTEROP}
      function openWindow(args) {
        Object.defineProperty.apply(null, args);
        ${IMPORT} ${WRAP} ${WINDOW}
      }
    `);
    expect(analysis.electron.browser_windows).toEqual([]);
  });

  it("preserves captured intrinsics across later vendor polyfills and callable writes", () => {
    const analysis = analyzeJavaScriptStaticSource(`${ROLLDOWN_MODULE_INTEROP}
      Object.create = customCreate;
      ${IMPORT} ${WRAP}
      function runLoop(key) { globalThis[key] = this; }
      function polyfill() { Object.create = customCreate; }
      ${WINDOW}
    `);
    expect(analysis.electron.browser_windows).toHaveLength(1);
  });

  it("keeps a shadowed namespace separate from the converted module", () => {
    const analysis = analyzeJavaScriptStaticSource(`${ROLLDOWN_MODULE_INTEROP}
      ${IMPORT} ${WRAP} ${WINDOW}
      function decoy(electron) { ${WINDOW} }
    `);
    expect(analysis.electron.browser_windows).toHaveLength(1);
  });
});

describe("Electron module interop generic invocations", () => {
  it.each([
    'const change = Function.prototype.call.bind(Object.defineProperty); change(null,Object,"create",{value:customCreate});',
    'const call = Function.prototype.call; const change = call.bind(Object.defineProperty); change(null,Object,"create",{value:customCreate});',
    'const change = Function.prototype.call.bind(Object.defineProperty,null,Object,"create"); change({value:customCreate});',
    'Function.prototype.call.apply(Object.defineProperty,[null,Object,"create",{value:customCreate}]);',
    'Reflect.apply(Function.prototype.call,Object.defineProperty,[null,Object,"create",{value:customCreate}]);',
    'const change = Function.prototype.apply.bind(Object.defineProperty); change(null,[Object,"create",{value:customCreate}]);',
    'Reflect.apply(Function.prototype.apply,Object.defineProperty,[null,[Object,"create",{value:customCreate}]]);',
    'const first = Function.prototype.call.bind(Object.defineProperty,null,Object,"create"); const change = first.bind(fake); change({value:customCreate});',
    "const change = Function.prototype.call.bind(Object.defineProperty); change(null,...args);",
    "const change = Function.prototype.apply.bind(Object.defineProperty); change(null,args);",
    'const change = Function.prototype.call.bind(Object.defineProperty,null,...args); change(metadata,"x",{value:1});',
    'Function.prototype.call.call.call(Object.defineProperty,null,Object,"create",{value:customCreate});',
    'Object.defineProperty.call.call(Object.defineProperty,null,Object,"create",{value:customCreate});',
    'Function.prototype.apply.apply(Object.defineProperty,[null,[Object,"create",{value:customCreate}]]);',
    'const change = Object.defineProperty.call.bind(Object.defineProperty); change(null,Object,"create",{value:customCreate});',
    'const change = Function.prototype.call.call.bind(Object.defineProperty,null,Object,"create"); change({value:customCreate});',
  ])("follows the callable receiver of a generic invocation: %s", (write) => {
    expect(
      analyzeJavaScriptStaticSource(
        `${write}\n${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP} ${WINDOW}`,
      ).electron.browser_windows,
    ).toEqual([]);
  });

  it.each([
    'const change = Function.prototype.call.bind(Object.defineProperty); change(null,metadata,"x",{value:1});',
    'const change = Function.prototype.call.bind(Object.defineProperty,null,metadata,"x"); change({value:1});',
    'Function.prototype.call.call(Object.defineProperty,null,metadata,"x",{value:1});',
    'const change = Function.prototype.apply.bind(Object.defineProperty); change(null,[metadata,"x",{value:1}]);',
    'Reflect.apply(Function.prototype.apply,Object.defineProperty,[null,[metadata,"x",{value:1}]]);',
    'Function.prototype.call.call.call(Object.defineProperty,null,metadata,"x",{value:1});',
    'Function.prototype.apply.apply(Object.defineProperty,[null,[metadata,"x",{value:1}]]);',
    'const change = Object.defineProperty.call.bind(Object.defineProperty); change(null,metadata,"x",{value:1});',
  ])("preserves fresh targets through a generic invocation: %s", (write) => {
    expect(
      analyzeJavaScriptStaticSource(
        `const metadata = {}; ${write}\n${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP} ${WINDOW}`,
      ).electron.browser_windows,
    ).toHaveLength(1);
  });
});

describe("Electron module interop bound mutators", () => {
  it.each([
    'const change = Object.defineProperty.bind(null); change(Object,"create",{value:customCreate});',
    'const change = Object.defineProperty.bind(null,Object,"create"); change({value:customCreate});',
    'const first = Object.defineProperty.bind(null,Object); const change = first; change("create",{value:customCreate});',
    'const change = Object.defineProperty.bind(null,Object); change.call(null,"create",{value:customCreate});',
    'const change = Object.defineProperty.bind(null,Object); change.apply(null,["create",{value:customCreate}]);',
    'const change = Object.defineProperty.bind(null,Object); Reflect.apply(change,null,["create",{value:customCreate}]);',
    'Object.defineProperty.bind(null,Object,"create")({value:customCreate});',
    'const change = Object.defineProperty.bind(null,...args); change(Object,"create",{value:customCreate});',
    'const metadata = {}; Object.defineProperty.call(...args,metadata,"x",{value:1});',
    'const metadata = {}; Object.defineProperty.apply(...args,[metadata,"x",{value:1}]);',
    'const change = Function.prototype.call.bind(Object.defineProperty,null); change(Object,"create",{value:customCreate});',
    'const first = Function.prototype.call.bind(Object.defineProperty,null); const change = first.bind(customReceiver,Object,"create"); change({value:customCreate});',
    'const change = Function.prototype.apply.bind(Object.defineProperty,null); change([Object,"create",{value:customCreate}]);',
    'Function.prototype.call.call(Object.defineProperty,null,Object,"create",{value:customCreate});',
    'Function.prototype.apply.call(Object.defineProperty,null,[Object,"create",{value:customCreate}]);',
    'const uncurry = Function.prototype.call.bind(Function.prototype.call); uncurry(Object.defineProperty,null,Object,"create",{value:customCreate});',
    'const change = Function.prototype.bind.call(Object.defineProperty,null); change(Object,"create",{value:customCreate});',
    'const bind = Function.prototype.call.bind(Function.prototype.bind); const change = bind(Object.defineProperty,null); change(Object,"create",{value:customCreate});',
    'const change = Function.prototype.bind.apply(Object.defineProperty,[null,Object,"create"]); change({value:customCreate});',
    'const change = Reflect.apply(Function.prototype.bind,Object.defineProperty,[null,Object,"create"]); change({value:customCreate});',
    'const first = Object.defineProperty.bind(null,Object); const change = Function.prototype.bind.call(first,null,"create"); change({value:customCreate});',
    'Reflect.apply = Object.defineProperty; Reflect.apply(Object,"create",{value:customCreate});',
    'const apply = Reflect.apply; Reflect.apply = Object.defineProperty; Reflect.apply(Object,"create",{value:customCreate});',
    'const change = Reflect.set.bind(null,Object,"create"); change(customCreate);',
    'const change = Object.defineProperty.call; change.call(Object.defineProperty,null,Object,"create",{value:customCreate});',
    'const {apply:change} = Object.defineProperty; change.call(Object.defineProperty,null,[Object,"create",{value:customCreate}]);',
    'const change = Reflect.apply.call; change.call(Reflect.apply,null,Object.defineProperty,null,[Object,"create",{value:customCreate}]);',
    'Reflect.set({},"create",customCreate,Object);',
    'const metadata = {}; Reflect.set(metadata,"create",customCreate,Object);',
    'const change = Reflect.set.bind(null,{},"create",customCreate); change(Object);',
    'Reflect.apply(Reflect.set,null,[{},"create",customCreate,Object]);',
    'Reflect.set({},"create",customCreate,...receivers);',
    'Reflect.set({},"create",...valuesAndReceivers);',
    "Reflect.set({},...keysValuesAndReceivers);",
    'Reflect.set({},"create",customCreate,receiver);',
  ])("rejects intrinsic writes through a bound mutator: %s", (write) => {
    expect(
      analyzeJavaScriptStaticSource(
        `${write}\n${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP} ${WINDOW}`,
      ).electron.browser_windows,
    ).toEqual([]);
  });

  it.each([
    'const change = Object.defineProperty.bind(null); change(metadata,"x",{value:1});',
    'const change = Object.defineProperty.bind(null,metadata,"x"); change({value:1});',
    'const first = Object.defineProperty.bind(null,metadata); const change = first.bind(null,"x"); change({value:1});',
    'const change = Function.prototype.call.bind(Object.defineProperty,null); change(metadata,"x",{value:1});',
    'const change = Function.prototype.apply.bind(Object.defineProperty,null); change([metadata,"x",{value:1}]);',
    'const change = Function.prototype.bind.call(Object.defineProperty,null,metadata,"x"); change({value:1});',
    'const bind = Function.prototype.call.bind(Function.prototype.bind); const change = bind(Object.defineProperty,null,metadata,"x"); change({value:1});',
    'const change = Function.prototype.bind.apply(Object.defineProperty,[null,metadata,"x"]); change({value:1});',
    'const change = Reflect.apply(Function.prototype.bind,Object.defineProperty,[null,metadata,"x"]); change({value:1});',
    'const apply = Reflect.apply; Reflect.apply = replacement; apply(Object.defineProperty,null,[metadata,"x",{value:1}]);',
    'const change = Object.defineProperty.bind(null,Object,"create");',
    'Object.defineProperty.call(null,metadata,"x",{value:1});',
    'Object.defineProperty.apply(null,[metadata,"x",{value:1}]);',
    'const change = Object.defineProperty.call; change.call(Object.defineProperty,null,metadata,"x",{value:1});',
    'const {apply:change} = Object.defineProperty; change.call(Object.defineProperty,null,[metadata,"x",{value:1}]);',
    'Reflect.set(metadata,"x",1,{});',
    'const receiver = {}; Reflect.set({},"x",1,receiver);',
  ])("keeps a fresh bound target or unused binding separate: %s", (write) => {
    expect(
      analyzeJavaScriptStaticSource(
        `const metadata = {}; ${write}\n${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP} ${WINDOW}`,
      ).electron.browser_windows,
    ).toHaveLength(1);
  });
});

it("keeps unrelated exports after an aliased prebound key write", () => {
  const analysis = analyzeJavaScriptStaticSource(`
      const electron = require("electron");
      const key = "Unrelated";
      const mutate = Object.defineProperty.bind(null, electron, key);
      mutate({value: custom});
      new electron.BrowserWindow({});
    `);
  expect(analysis.electron.browser_windows).toHaveLength(1);
});

describe("Electron member syntax ownership", () => {
  it.each([
    "electron as typeof electron",
    "electron!",
    "electron satisfies typeof electron",
  ])("preserves lexical API identity through %s", (receiver) => {
    const source = `const electron = require("electron");
      new ((${receiver}).BrowserWindow as typeof electron.BrowserWindow)({webPreferences:{preload:"./wrapped.js"}});
      ((${receiver}).ipcMain as typeof electron.ipcMain).handle("wrapped:ping", () => "pong");
      (${receiver}).contextBridge.exposeInMainWorld("wrappedApi", {ping:true});`;
    const { electron } = analyzeJavaScriptStaticSource(source);
    expect(electron.browser_windows).toMatchObject([
      { preload_path: "./wrapped.js" },
    ]);
    expect(electron.ipc).toMatchObject([{ channel: "wrapped:ping" }]);
    expect(electron.context_bridge_apis).toMatchObject([
      { api_key: "wrappedApi" },
    ]);
  });

  it.each([
    'const electron = require("other");',
    'function require() { return unknown; } const electron = require("electron");',
    'const electron = require("electron"); electron.BrowserWindow = replacement;',
  ])(
    "retains rejected lexical identity through erased wrappers: %s",
    (setup) => {
      const result = analyzeJavaScriptStaticSource(`${setup}
      new (electron.BrowserWindow as typeof electron.BrowserWindow)({webPreferences:{preload:"./bad.js"}});`);
      expect(result.electron.browser_windows).toEqual([]);
    },
  );

  it("keeps computed unknown member selections unresolved", () => {
    const result =
      analyzeJavaScriptStaticSource(`const electron = require("electron");
      new (electron as typeof electron)[runtimeKey]({webPreferences:{preload:"./bad.js"}});`);
    expect(result.electron.browser_windows).toEqual([]);
  });
});
