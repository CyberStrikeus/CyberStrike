import { describe, expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

// Webpack 5 standalone bootstrap with an Electron external, as emitted for
// `target: "electron-main"`.
const bootstrap = (external: string, consumer: string, entry = "n(100);") =>
  `(()=>{var m={45840:${external},100:(e,t,n)=>{"use strict";${consumer}}},c={};` +
  `function n(t){var r=c[t];if(void 0!==r)return r.exports;var o=c[t]={exports:{}};` +
  `return m[t](o,o.exports,n),o.exports}` +
  `n.n=e=>e&&e.__esModule?()=>e.default:()=>e;${entry}})();`;

const EXTERNAL = 'e=>{"use strict";e.exports=require("electron")}';
const CONSUMER =
  'const s=n(45840);new s.BrowserWindow({webPreferences:{preload:"./preload.js",contextIsolation:!1}});' +
  's.ipcMain.handle("get-connections",async()=>[]);';

const electronOf = (source: string) =>
  analyzeJavaScriptStaticSource(source).electron;

const expectUnresolved = (source: string) => {
  const electron = electronOf(source);
  expect(electron.browser_windows).toEqual([]);
  // Only direct observations come from this identity; the separate
  // wrapper-substitution path keeps its own resolution basis.
  expect(
    electron.ipc.filter(
      ({ resolution_basis: basis }) => basis !== "wrapper-substitution",
    ),
  ).toEqual([]);
};

describe("Electron identity through Webpack externals", () => {
  it.each([
    ["const key=45840;n.m[key]=local;", 0],
    ["const key='45840';delete n.m[key];", 0],
    ["n.m[runtimeKey]=local;", 0],
    ["const key=45841;n.m[key]=local;", 1],
  ] as const)(
    "preserves only unmodified external slots after %s",
    (write, expected) => {
      expect(
        electronOf(bootstrap(EXTERNAL, CONSUMER, `n.m=m;${write}n(100);`))
          .browser_windows,
      ).toHaveLength(expected);
    },
  );

  it("follows the default-export getter produced by webpack n.n", () => {
    const source = bootstrap(
      EXTERNAL,
      'const s=n.n(n(45840));new (s().BrowserWindow)({webPreferences:{contextIsolation:false}});s().ipcMain.handle("ready",()=>{});',
    );
    const electron = electronOf(source);
    expect(electron.browser_windows).toHaveLength(1);
    expect(electron.ipc).toMatchObject([{ channel: "ready", side: "main" }]);
  });

  it.each([
    [
      "a fake getter",
      bootstrap(
        EXTERNAL,
        "const s=n.n=e=>()=>0;new (s(n(45840))().BrowserWindow)({});",
      ),
    ],
    [
      "a getter replaced while evaluating its argument",
      bootstrap(
        EXTERNAL,
        "new ((n.n=e=>()=>0,n.n(n(45840)))().BrowserWindow)({});",
      ),
    ],
  ])("does not infer Electron through %s", (_name, source) => {
    expect(electronOf(source).browser_windows).toEqual([]);
  });

  const GETTER_CONSUMER = "const s=n.n(n(45840));new (s().BrowserWindow)({});";
  it.each([
    ["Reflect.set", 'Reflect.set(n,"n",e=>()=>({BrowserWindow:class{}}));'],
    [
      "Reflect.defineProperty",
      'Reflect.defineProperty(n,"n",{value:e=>()=>0});',
    ],
    ["delete", "delete n.n;"],
    ["a destructuring write", "({g:n.n}={g:e=>()=>0});"],
    ["an unknown key", "n[key]=e=>()=>0;"],
    [
      "a stable loader alias",
      "const copy=n;copy.n=e=>()=>({BrowserWindow:class{}});",
    ],
    [
      "a reflective write through a loader alias",
      "const copy=n;Reflect.set(copy,'n',e=>()=>({BrowserWindow:class{}}));",
    ],
  ])(
    "does not infer Electron after a getter write through %s",
    (_name, write) => {
      expect(
        electronOf(bootstrap(EXTERNAL, GETTER_CONSUMER, `${write}n(100);`))
          .browser_windows,
      ).toEqual([]);
    },
  );

  it("keeps the getter after a reflective write to another loader key", () => {
    expect(
      electronOf(
        bootstrap(
          EXTERNAL,
          GETTER_CONSUMER,
          'Object.defineProperty(n,"d",{value:1});n(100);',
        ),
      ).browser_windows,
    ).toHaveLength(1);
  });

  it("follows the loader passed to a module factory", () => {
    const electron = electronOf(bootstrap(EXTERNAL, CONSUMER));
    expect(electron.browser_windows).toMatchObject([
      { preload_path: "./preload.js" },
    ]);
    expect(electron.ipc).toMatchObject([
      { channel: "get-connections", side: "main" },
    ]);
  });

  it("follows a direct member read from the loader call", () => {
    expect(
      electronOf(
        bootstrap(
          EXTERNAL,
          'new(n(45840).BrowserWindow)({webPreferences:{preload:"./p.js"}});',
        ),
      ).browser_windows,
    ).toMatchObject([{ preload_path: "./p.js" }]);
  });

  it("follows the runtime loader called from the bootstrap body", () => {
    expect(
      electronOf(
        bootstrap(
          EXTERNAL,
          "",
          'const s=n(45840);new s.BrowserWindow({webPreferences:{preload:"./p.js"}});',
        ),
      ).browser_windows,
    ).toMatchObject([{ preload_path: "./p.js" }]);
  });

  it.each([
    [
      "an external overwritten after the require",
      bootstrap('e=>{e.exports=require("electron");e.exports=other}', CONSUMER),
    ],
    [
      "a local module table entry",
      bootstrap("e=>{e.exports={BrowserWindow:class{}}}", CONSUMER),
    ],
    [
      "a shadowed require inside the external",
      bootstrap(
        'e=>{const require=x=>x;e.exports=require("electron")}',
        CONSUMER,
      ),
    ],
    [
      "a reassigned loader parameter",
      bootstrap(EXTERNAL, `n=other;${CONSUMER}`),
    ],
    [
      "a loader-shaped call outside a proven bootstrap",
      `var m={45840:${EXTERNAL}};function n(t){return other(t)}${CONSUMER}`,
    ],
    [
      "a different table key",
      bootstrap(EXTERNAL, CONSUMER.replace("n(45840)", "n(45841)")),
    ],
  ])("keeps %s unresolved", (_name, source) => {
    expectUnresolved(source);
  });
});

describe("Webpack externals with a tampered runtime", () => {
  it.each([
    [
      "a replaced bootstrap loader",
      bootstrap(
        EXTERNAL,
        CONSUMER,
        "const o=n;n=k=>k===100?o(k):local;n(100);",
      ),
    ],
    [
      "a generator external",
      bootstrap('function*(e){e.exports=require("electron")}', CONSUMER),
    ],
    [
      "an async external",
      bootstrap('async e=>{e.exports=require("electron")}', CONSUMER),
    ],
    [
      "a loader that returns something else",
      bootstrap(EXTERNAL, CONSUMER).replace(
        "return m[t](o,o.exports,n),o.exports}",
        "return m[t](o,o.exports,n),{BrowserWindow:class{}}}",
      ),
    ],
    [
      "a table slot replaced before loading",
      bootstrap(
        EXTERNAL,
        CONSUMER,
        "m[45840]=e=>{e.exports={BrowserWindow:class{}}};n(100);",
      ),
    ],
    [
      "a table slot replaced through an alias",
      bootstrap(EXTERNAL, CONSUMER, "const a=m;a[45840]=local;n(100);"),
    ],
    [
      "a slot replaced through the runtime exposure",
      bootstrap(EXTERNAL, CONSUMER, "n.m=m;n.m[45840]=local;n(100);"),
    ],
    [
      "a cache entry planted before loading",
      bootstrap(EXTERNAL, CONSUMER, "c[45840]={exports:local};n(100);"),
    ],
    [
      "a computed table key that may collide",
      bootstrap(EXTERNAL, CONSUMER).replace(
        "c={};",
        "c={};m={...m,[key]:e=>{e.exports=local}};",
      ),
    ],
    [
      "an unresolved computed key in the table",
      bootstrap(EXTERNAL, CONSUMER).replace(
        `45840:${EXTERNAL},`,
        `45840:${EXTERNAL},[key]:e=>{e.exports=local},`,
      ),
    ],
  ])("keeps %s unresolved", (_name, source) => {
    expectUnresolved(source);
  });
});

describe("Webpack externals with a tampered loader or module object", () => {
  it.each([
    ["invoked", "n.i(runtimeChunks);"],
    ["read through an alias", "const install=n.i;install(runtimeChunks);"],
    ["read through a dynamic key", "n[runtimeMember](runtimeChunks);"],
    ["exposed with its namespace", "publish(n);"],
    [
      "reachable through a helper receiver",
      "n.run=function(){this.i(runtimeChunks)};n.run();",
    ],
  ])(
    "keeps an unknown chunk installation unresolved when %s",
    (_name, invoke) => {
      expectUnresolved(
        bootstrap(
          EXTERNAL,
          CONSUMER,
          `n.m=m;n.i=e=>{for(var k in e)n.m[k]=e[k]};${invoke}n(100);`,
        ),
      );
    },
  );

  it("does not treat a called assignment value as an unused installer", () => {
    expectUnresolved(
      bootstrap(
        EXTERNAL,
        CONSUMER,
        "n.m=m;(n.i=e=>{for(var k in e)n.m[k]=e[k]})(runtimeChunks);n(100);",
      ),
    );
  });

  it.each([
    [
      "cached exports rewritten through the runtime exposure",
      bootstrap(
        EXTERNAL,
        CONSUMER,
        "n.c=c;n(45840);n.c[45840].exports=local;n(100);",
      ),
    ],
    [
      "a pre-populated cache",
      bootstrap(EXTERNAL, CONSUMER).replace(
        "c={};",
        "c={45840:{exports:local}};",
      ),
    ],
    [
      "exports rewritten in the returned sequence",
      bootstrap(EXTERNAL, CONSUMER).replace(
        "return m[t](o,o.exports,n),o.exports}",
        "return m[t](o,o.exports,n),o.exports=local,o.exports}",
      ),
    ],
    [
      "exports rewritten before the return",
      bootstrap(EXTERNAL, CONSUMER).replace(
        "return m[t](o,o.exports,n),o.exports}",
        "m[t](o,o.exports,n);o.exports=local;return o.exports}",
      ),
    ],
    [
      "an alias of the exposed table",
      bootstrap(EXTERNAL, CONSUMER, "n.m=m;const a=n.m;a[45840]=local;n(100);"),
    ],
    [
      "a rewritten module key",
      bootstrap(EXTERNAL, CONSUMER).replace(
        "function n(t){",
        "function n(t){if(t===45840)t=100;",
      ),
    ],
    [
      "a dispatch behind a guard",
      bootstrap(EXTERNAL, CONSUMER).replace(
        "return m[t](o,o.exports,n),o.exports}",
        "if(t===100)m[t](o,o.exports,n);return o.exports}",
      ),
    ],
    [
      "duplicate factory parameter names",
      bootstrap('function(e,e,n){e.exports=require("electron")}', CONSUMER),
    ],
    [
      "an accessor for module exports",
      bootstrap(EXTERNAL, CONSUMER).replace(
        "var o=c[t]={exports:{}}",
        "var o=c[t]={get exports(){return local},set exports(v){}}",
      ),
    ],
  ])("keeps %s unresolved", (_name, source) => {
    expectUnresolved(source);
  });

  it.each([
    [
      "a cache cleared when the factory throws",
      bootstrap(EXTERNAL, CONSUMER).replace(
        "return m[t](o,o.exports,n),o.exports}",
        "var i=!0;try{m[t].call(o.exports,o,o.exports,n),i=!1}finally{i&&delete c[t]}return o.exports}",
      ),
    ],
    [
      "the runtime exposing its cache",
      bootstrap(EXTERNAL, CONSUMER, "n.c=c;n(100);"),
    ],
    [
      "chunk installation through the runtime table",
      bootstrap(
        EXTERNAL,
        CONSUMER,
        "n.m=m;n.i=e=>{for(var k in e)n.m[k]=e[k]};n(100);",
      ),
    ],
    [
      "a loaded flag set before returning",
      bootstrap(EXTERNAL, CONSUMER).replace(
        "return m[t](o,o.exports,n),o.exports}",
        "return m[t].call(o.exports,o,o.exports,n),o.loaded=!0,o.exports}",
      ),
    ],
  ])("still resolves with %s", (_name, source) => {
    expect(electronOf(source).browser_windows).toMatchObject([
      { preload_path: "./preload.js" },
    ]);
  });
});

describe("Webpack externals through the loader's completion paths", () => {
  const MISS_RETURN = "return m[t](o,o.exports,n),o.exports}";
  const missPath = (tail: string) =>
    bootstrap(EXTERNAL, CONSUMER).replace(MISS_RETURN, tail);

  // Falling off the end returns undefined, not the dispatched exports.
  it.each([
    ["returns only cached exports", missPath("m[t](o,o.exports,n)}")],
    [
      "has no returns",
      bootstrap(EXTERNAL, CONSUMER).replace(
        `var r=c[t];if(void 0!==r)return r.exports;var o=c[t]={exports:{}};${MISS_RETURN}`,
        "var o=c[t]={exports:{}};m[t](o,o.exports,n)}",
      ),
    ],
    [
      "returns from one branch",
      missPath("m[t](o,o.exports,n);if(t)return o.exports}"),
    ],
    [
      "returns from a try whose catch falls through",
      missPath("try{return m[t](o,o.exports,n),o.exports}catch(x){}}"),
    ],
    [
      "falls through a catch past a completing finally",
      missPath(
        "try{return m[t](o,o.exports,n),o.exports}catch(x){}finally{t}}",
      ),
    ],
    [
      "returns another value from a finally",
      missPath(
        "try{return m[t](o,o.exports,n),o.exports}finally{return local}}",
      ),
    ],
  ])("keeps a loader that %s unresolved", (_name, source) => {
    expectUnresolved(source);
  });

  it.each([
    [
      "returns exports from both branches",
      missPath(
        "m[t](o,o.exports,n);if(t)return o.exports;else return o.exports}",
      ),
    ],
    [
      "returns exports from a finally after a falling-through catch",
      missPath("try{m[t](o,o.exports,n)}catch(x){}finally{return o.exports}}"),
    ],
  ])("still resolves a loader that %s", (_name, source) => {
    expect(electronOf(source).browser_windows).toMatchObject([
      { preload_path: "./preload.js" },
    ]);
  });
});

describe("Webpack identity through erased TypeScript syntax", () => {
  it.each([
    [
      "the module table",
      bootstrap(
        EXTERNAL,
        CONSUMER,
        "interface RuntimeShape { m(): void } n(100);",
      ),
    ],
    [
      "the fresh module object",
      bootstrap(EXTERNAL, CONSUMER).replace(
        "return m[t](o,o.exports,n)",
        "interface ModuleShape { o(): void } return m[t](o,o.exports,n)",
      ),
    ],
    [
      "the module table through a type query",
      bootstrap(EXTERNAL, CONSUMER, "type RuntimeShape = typeof m; n(100);"),
    ],
    [
      "the fresh module object through a type query",
      bootstrap(EXTERNAL, CONSUMER).replace(
        "return m[t](o,o.exports,n)",
        "type ModuleShape = typeof o; return m[t](o,o.exports,n)",
      ),
    ],
    [
      "the loader beside an uncalled installer",
      bootstrap(
        EXTERNAL,
        CONSUMER,
        "n.m=m;n.i=e=>{for(var k in e)n.m[k]=e[k]};interface RuntimeShape { n(): void } n(100);",
      ),
    ],
    [
      "the loader through a type query beside an uncalled installer",
      bootstrap(
        EXTERNAL,
        CONSUMER,
        "n.m=m;n.i=e=>{for(var k in e)n.m[k]=e[k]};type RuntimeShape = typeof n; n(100);",
      ),
    ],
  ])("does not let erased TypeScript syntax escape %s", (_name, source) => {
    const electron = electronOf(source);
    expect(electron.browser_windows).toMatchObject([
      { preload_path: "./preload.js" },
    ]);
    expect(electron.ipc).toMatchObject([
      { channel: "get-connections", side: "main" },
    ]);
  });

  it.each([
    "const shape = { [m]: true }; n(100);",
    "const kind = typeof m; n(100);",
    "m.extra; n(100);",
  ])(
    "keeps an actual table reference outside the loader unproven: %s",
    (entry) => {
      expectUnresolved(bootstrap(EXTERNAL, CONSUMER, entry));
    },
  );
});
