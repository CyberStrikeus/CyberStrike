import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it.each([
  ["async function get(){return module;}(await get())", true],
  ["async function get(){return module;}const api=await get();api", true],
  [
    "async function get(){return module;}const pending=get();const api=await pending;api",
    true,
  ],
  ["function get(){return module;}const api=await get();api", true],
  ["function* get(){yield module;}const api=await get();api", false],
  ["function* get(){return module;}const api=await get();api", false],
  ["async function* get(){yield module;}const api=await get();api", false],
  [
    "async function get(){return {require(){}};}const api=await get();api",
    false,
  ],
  ["async function get(){return module;}const api=get();api", false],
  [
    "async function child(){return module;}async function get(){return {child:child()};}(await get()).child",
    false,
  ],
  [
    "async function child(){return module;}function get(){return {child:child()};}(await get().child)",
    true,
  ],
  [
    "async function child(){return module;}async function get(){return {child:child()};}const {child:pending}=await get();const api=await pending;api",
    true,
  ],
  [
    "async function get(){return module;}const pending=get();const api=flag?pending:await pending;api",
    true,
  ],
  [
    "async function get(){return module;}const pending=get();const api=flag?await pending:pending;api",
    true,
  ],
  [
    "async function inner(){return module;}function get(){return inner();}(await get())",
    true,
  ],
])(
  "preserves awaited result consumption through aliases and projections: %s",
  (receiver, expected) => {
    const analysis = analyzeJavaScriptStaticSource(
      `${receiver}.require('./shared.cjs');`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual(
      expected
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);

it.each([
  "const {make=host}={make:class{}};",
  "class Local{}const {make=host}={make:Local};",
  "const [make=host]=[class{}];",
])(
  "excludes inactive defaults for known class constructors: %s",
  (declaration) => {
    const analysis = analyzeJavaScriptStaticSource(
      `function host(){return module;}${declaration}new make().require=()=>{};require('./shared.cjs');`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual([
      expect.objectContaining({ kind: "require", specifier: "./shared.cjs" }),
    ]);
  },
);

it.each([
  ["const {make=host}={make(){return {};}};", false],
  ["const {make=host}={make:()=>({})};", false],
  ["const [make=host]=[()=>({})];", false],
  ["const {box:{make=host}={}}={box:{make(){return {};}}};", false],
  ["const {make=host}={};", true],
  ["const [make=host]=[];", true],
  ["const {box:{make=host}={}}={};", true],
  ["const {make=host}=unknown;", true],
  ["const [make=host]=unknown;", true],
  ["const {make=host}={make:unknown};", true],
  ["const {make=host}={make:undefined};", true],
  ["const [make=host]=[undefined];", true],
  ["const {make=host}={get make(){return undefined;}};", true],
  ["const {make=host}={make:flag?()=>({}):()=>({})};", false],
  [
    "const values=[()=>({})];values[Symbol.iterator]=function*(){yield undefined;};const [make=host]=values;",
    true,
  ],
  [
    "Array.prototype[Symbol.iterator]=function*(){yield undefined;};const [make=host]=[()=>({})];",
    true,
  ],
  ["const {make=host}={make:host};", true],
  ["const [make=host]=[host];", true],
  ["const make=host;", true],
  ["const make=()=>({});", false],
])(
  "retains only applicable default callable sources: %s",
  (declaration, expected) => {
    const analysis = analyzeJavaScriptStaticSource(
      `function host(){return module;}${declaration}make().require=()=>{};require('./shared.cjs');`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references.at(-1)).toEqual(
      expect.objectContaining({
        kind: "require",
        specifier: expected ? null : "./shared.cjs",
      }),
    );
  },
);

it.each([
  "function* get(){yield module;}",
  "function* get(){return module;}",
  "async function get(){return module;}",
  "async function* get(){yield module;}",
  "const get=async()=>module;",
])(
  "distinguishes direct wrapper objects from their eventual contents: %s",
  (declaration) => {
    const analysis = analyzeJavaScriptStaticSource(
      `${declaration}const api=get();api.require=()=>{};api.require('./unused.cjs');require('./shared.cjs');`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual([
      expect.objectContaining({ kind: "require", specifier: "./shared.cjs" }),
    ]);
  },
);

it.each([
  "const table={x(){return{};},y(){return{};},z(){return module;}};const get=flag?table.x:table.y;",
  "const table={a:{b(){return{};},d(){return module;}},c:{d(){return{};},b(){return module;}}};const get=flag?table.a.b:table.c.d;",
])("retains precise selected direct-return receivers: %s", (declaration) => {
  const analysis = analyzeJavaScriptStaticSource(
    `${declaration}get().require('./unused.cjs');`,
  );
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.references).toEqual([]);
});

it.each([
  ["Object.prototype[0]=module;", true],
  ["Object.prototype['0']=module;", true],
  ["Object.prototype.constructor.prototype[0]=module;", true],
  ["globalThis.Object.prototype[0]=module;", true],
  ["global.Object.prototype[0]=module;", true],
  ["window.Object.prototype[0]=module;", true],
  ["self.Object.prototype[0]=module;", true],
  ["Object.prototype['01']=module;", false],
  ["Object.prototype.extra=module;", false],
  ["Object.prototype.require=replacement;", false],
  ["Array.prototype[0]=module;", true],
  ["Array.prototype['0']=module;", true],
  ["Array.prototype.constructor.prototype[0]=module;", true],
  ["Array.prototype['01']=module;", false],
  ["Array.prototype.extra=module;", false],
  ["Array.prototype.require=replacement;", false],
])("retains inherited numeric array iteration slots: %s", (write, expected) => {
  const analysis = analyzeJavaScriptStaticSource(
    `${write}const [api]=[,];api.require('./shared.cjs');`,
  );
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.references).toEqual(
    expected
      ? [expect.objectContaining({ kind: "require", specifier: null })]
      : [],
  );
});

it.each([
  "function local(Object){Object.prototype[0]=module;const[api]=[,];api.require('./shared.cjs');}",
  "function local(globalThis){globalThis.Object.prototype[0]=module;const[api]=[,];api.require('./shared.cjs');}",
])("retains shadowed prototype controls: %s", (source) => {
  const analysis = analyzeJavaScriptStaticSource(source);
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.references).toEqual([]);
});

it.each([
  [
    "Array.prototype.constructor.prototype[Symbol.iterator]=function*(){yield module;};",
    true,
  ],
  [
    "Array.prototype.constructor.prototype.constructor.prototype[Symbol.iterator]=custom;",
    true,
  ],
  ["Array.prototype.constructor.prototype.extra=1;", false],
  ["Array.prototype.constructor.prototype.require=replacement;", false],
  ["Array.prototype.require=replacement;", false],
])(
  "tracks iterator changes through prototype constructor cycles: %s",
  (write, expected) => {
    const analysis = analyzeJavaScriptStaticSource(
      `${write}const [selected]=[];selected.require('./shared.cjs');`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual(
      expected
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);

it.each([
  ["const get=()=>module;get()", true],
  ["function get(){return module;}get()", true],
  ["const get=()=>module;const alias=get;alias()", true],
  ["const get=()=>({loader:module});get().loader", true],
  ["const get=()=>flag?module:{};get()", true],
  ["const inner=()=>module;const get=()=>inner();get()", true],
  ["(()=>module)()", true],
  ["const get=()=>({require(){}});get()", false],
  ["const get=()=>module.exports;get()", false],
  ["function get(module){return module;}get({require(){}})", false],
  ["let get=()=>module;get=()=>({require(){}});get()", false],
])("retains possible returned module receivers: %s", (receiver, expected) => {
  const analysis = analyzeJavaScriptStaticSource(
    `${receiver}.require('./shared.cjs');`,
  );
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.references).toEqual(
    expected
      ? [expect.objectContaining({ kind: "require", specifier: null })]
      : [],
  );
});

it.each([
  [
    "const [api]=[module];Array.prototype.extra=1;api.require=replacement;",
    true,
  ],
  [
    "const [api]=[module];Array.prototype[Symbol.iterator]=custom;api.require=replacement;",
    true,
  ],
  ["const [api]=[{}];Array.prototype.extra=1;api.require=replacement;", false],
  [
    "const values={*[Symbol.iterator](){yield module;}};const [api]=values;api.require=replacement;",
    true,
  ],
  [
    "const values=[{}];values[Symbol.iterator]=function*(){yield module;};const [api]=values;api.require=replacement;",
    true,
  ],
  [
    "Array.prototype[Symbol.iterator]=custom;const [api]=[{}];api.require=replacement;",
    true,
  ],
  ["const get=()=>module;get().require=replacement;", true],
  ["const get=()=>({require(){}});get().require=replacement;", false],
])(
  "retains host delegate uncertainty after possible receiver writes: %s",
  (write, expected) => {
    const analysis = analyzeJavaScriptStaticSource(
      `${write}require('./shared.cjs');`,
    );
    expect(analysis.references).toEqual([
      expect.objectContaining({
        kind: "require",
        specifier: expected ? null : "./shared.cjs",
      }),
    ]);
  },
);

it("preserves a require before later returned-receiver delegate writes", () => {
  const analysis = analyzeJavaScriptStaticSource(
    `require('./shared.cjs');const get=()=>module;get().require=replacement;`,
  );
  expect(analysis.references).toEqual([
    expect.objectContaining({ kind: "require", specifier: "./shared.cjs" }),
  ]);
});
