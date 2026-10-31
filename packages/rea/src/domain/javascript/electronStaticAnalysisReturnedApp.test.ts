import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it.each([
  [
    "direct factory",
    "const getApp=()=>app;getApp().setAppPath('./lib');",
    true,
  ],
  [
    "returned alias",
    "const getApp=()=>app;const runtime=getApp();runtime.setAppPath('./lib');",
    true,
  ],
  [
    "method factory",
    "const api={get(){return app}};api.get().setAppPath('./lib');",
    true,
  ],
  [
    "projected return",
    "const getApp=()=>({runtime:app});getApp().runtime.setAppPath('./lib');",
    true,
  ],
  ["method return", "const change=()=>app.setAppPath;change()('./lib');", true],
  [
    "awaited factory",
    "const getApp=async()=>app;(await getApp()).setAppPath('./lib');",
    true,
  ],
  [
    "unawaited promise",
    "const getApp=async()=>app;getApp().setAppPath('./lib');",
    false,
  ],
  [
    "generator",
    "function*getApp(){return app}getApp().setAppPath('./lib');",
    false,
  ],
  [
    "awaited generator",
    "function*getApp(){return app}(await getApp()).setAppPath('./lib');",
    false,
  ],
  [
    "local factory",
    "const getApp=()=>({setAppPath(){}});getApp().setAppPath('./lib');",
    false,
  ],
  [
    "escaped local",
    "const local={setAppPath(){}};escape(local);local.setAppPath('./lib');",
    false,
  ],
  [
    "external local",
    "const local=require('local-library');local.setAppPath('./lib');",
    false,
  ],
  [
    "unknown return",
    "const getApp=()=>unknown;getApp().setAppPath('./lib');",
    false,
  ],
  [
    "unrelated unknown invocation",
    "const local={make(){}};escape(local);local.make();",
    false,
  ],
  [
    "local method",
    "const api={get(){return {setAppPath(){}}}};api.get().setAppPath('./lib');",
    false,
  ],
  [
    "shadowed app",
    "function local(app){const getApp=()=>app;getApp().setAppPath('./lib');}",
    false,
  ],
  [
    "mixed return",
    "const getApp=()=>flag?app:{setAppPath(){}};getApp().setAppPath('./lib');",
    true,
  ],
  [
    "replacement factory",
    "const api={get:()=>({setAppPath(){}})};api.get=()=>app;api.get().setAppPath('./lib');",
    true,
  ],
  [
    "local replacement",
    "const api={get:()=>app};api.get=()=>({setAppPath(){}});api.get().setAppPath('./lib');",
    false,
  ],
  [
    "later member replacement",
    "const getApp=()=>app;getApp().setAppPath('./lib');app.setAppPath=()=>{};",
    true,
  ],
  [
    "returned setter call",
    "const getApp=()=>app;getApp().setAppPath.call(app,'./lib');",
    true,
  ],
  [
    "returned setter reflect",
    "const getApp=()=>app;Reflect.apply(getApp().setAppPath,app,['./lib']);",
    true,
  ],
  [
    "factory call delegate",
    "const getApp=()=>app;getApp.call(null).setAppPath('./lib');",
    true,
  ],
  [
    "factory apply delegate",
    "const getApp=()=>app;getApp.apply(null,[]).setAppPath('./lib');",
    true,
  ],
  [
    "captured app before replacement",
    "let runtime=app;const held=runtime;runtime={setAppPath(){}};const getApp=()=>held;getApp().setAppPath('./lib');",
    true,
  ],
  [
    "captured local before replacement",
    "let runtime={setAppPath(){}};const held=runtime;runtime=app;const getApp=()=>held;getApp().setAppPath('./lib');",
    false,
  ],
  [
    "captured local after replacement",
    "let runtime=app;runtime={setAppPath(){}};const held=runtime;const getApp=()=>held;getApp().setAppPath('./lib');",
    false,
  ],
  [
    "captured app after replacement",
    "let runtime={setAppPath(){}};runtime=app;const held=runtime;const getApp=()=>held;getApp().setAppPath('./lib');",
    true,
  ],
] as const)(
  "retains only possible Electron app path changes from %s",
  (_name, body, expected) => {
    const analysis = analyzeJavaScriptStaticSource(
      `const {app}=require('electron');${body}`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect((analysis.electron.app_path_changes ?? []).length > 0).toBe(
      expected,
    );
    // A possible return must not promote other APIs to proven Electron identity.
    expect(analysis.electron.browser_windows).toEqual([]);
  },
);

it.each([
  "const getApp=()=>require('electron').app;getApp().setAppPath('./lib');",
  "const getElectron=()=>require('electron');getElectron().app.setAppPath('./lib');",
  "const getApp=()=>require('other').app;getApp().setAppPath('./lib');",
])(
  "follows returned require origins without an import shortcut: %s",
  (source) => {
    const analysis = analyzeJavaScriptStaticSource(source);
    expect(analysis.parse_error_count).toBe(0);
    expect((analysis.electron.app_path_changes ?? []).length > 0).toBe(
      !source.includes("'other'"),
    );
  },
);

it("does not promote a returned Electron constructor to proven API identity", () => {
  const analysis = analyzeJavaScriptStaticSource(
    "const {BrowserWindow}=require('electron');const get=()=>BrowserWindow;new (get())();",
  );
  expect(analysis.electron.browser_windows).toEqual([]);
  expect(analysis.electron.app_path_changes ?? []).toEqual([]);
});

it.each([
  ["call", true],
  ["call", false],
  ["apply", true],
  ["apply", false],
] as const)(
  "uses the actual receiver of a captured %s wrapper (host=%s)",
  (method, host) => {
    const local = "({setAppPath(){}})";
    const analysis = analyzeJavaScriptStaticSource(
      `const {app}=require('electron');
       const original=()=>${host ? local : "app"};
       const selected=()=>${host ? "app" : local};
       const invoke=original.${method};
       invoke.call(selected,null${method === "apply" ? ",[]" : ""}).setAppPath('./lib');`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect((analysis.electron.app_path_changes ?? []).length > 0).toBe(host);
  },
);

it.each([true, false])(
  "keeps a finite source closure after an Electron app selector budget is reached (host=%s)",
  (host) => {
    const declarations = Array.from(
      { length: 550 },
      (_, index) =>
        `const selected${index}=selected${index === 0 ? "Root" : index - 1};`,
    ).join("");
    const analysis = analyzeJavaScriptStaticSource(
      `const {app}=require('electron');const selectedRoot={runtime:${host ? "app" : "{setAppPath(){}}"}};${declarations}const getApp=()=>selected549.runtime;getApp().setAppPath('./lib');`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect((analysis.electron.app_path_changes ?? []).length > 0).toBe(host);
    expect(analysis.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Alias selection expansion"),
      ]),
    );
  },
);

it.each([true, false])(
  "closes cyclic returned app copies without inventing an Electron origin (host=%s)",
  (host) => {
    const analysis = analyzeJavaScriptStaticSource(
      `const {app}=require('electron');let box={runtime:${host ? "app" : "{setAppPath(){}}"}};while(flag)box={...box};const getApp=()=>box.runtime;getApp().setAppPath('./lib');`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect((analysis.electron.app_path_changes ?? []).length > 0).toBe(host);
  },
);
