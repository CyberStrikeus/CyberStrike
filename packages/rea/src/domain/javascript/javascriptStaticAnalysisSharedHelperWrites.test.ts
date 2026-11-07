import changedPath from "node:path";
import path from "node:path";
import posix from "node:path/posix";
import changedUrl from "node:url";
import url from "node:url";
import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it("observes that separate Node default imports share mutable helper slots", () => {
  expect(changedPath).toBe(path);
  expect(changedUrl).toBe(url);
  expect(path.posix).toBe(posix);
  const resolve = changedPath.resolve;
  const decode = changedUrl.fileURLToPath;
  try {
    changedPath.resolve = (first) => first;
    changedUrl.fileURLToPath = () => "/changed/main.mjs";
    expect(path.resolve("/runtime/actual.cjs", "/source", "decoy.cjs")).toBe(
      "/runtime/actual.cjs",
    );
    expect(url.fileURLToPath("file:///source/main.mjs")).toBe(
      "/changed/main.mjs",
    );
  } finally {
    changedPath.resolve = resolve;
    changedUrl.fileURLToPath = decode;
  }
});

it.each([
  [
    "path resolve",
    "import changed from 'node:path';import path from 'path';changed.resolve=first=>first;",
    "path.resolve(runtimePath,__dirname,'decoy.cjs')",
  ],
  [
    "POSIX path resolve",
    "import changed from 'node:path/posix';import path from 'path/posix';changed.resolve=first=>first;",
    "path.resolve(runtimePath,__dirname,'decoy.cjs')",
  ],
  [
    "decoded URL source anchor",
    "import changed from 'node:url';import url from 'url';import path from 'node:path';changed.fileURLToPath=()=>'/changed/main.mjs';",
    "path.resolve(runtimePath,path.dirname(url.fileURLToPath(import.meta.url)),'decoy.cjs')",
  ],
  [
    "POSIX exported child identity",
    "import changed from 'node:path/posix';import path from 'node:path';changed.resolve=first=>first;",
    "path.posix.resolve(runtimePath,__dirname,'decoy.cjs')",
  ],
  [
    "direct POSIX module identity",
    "import changed from 'node:path';import path from 'node:path/posix';changed.posix.resolve=first=>first;",
    "path.resolve(runtimePath,__dirname,'decoy.cjs')",
  ],
] as const)(
  "retains shared default writes before proving %s",
  (_name, setup, expression) => {
    const analysis = analyzeJavaScriptStaticSource(`${setup}
      import {BrowserWindow,utilityProcess} from 'electron';
      new BrowserWindow({webPreferences:{preload:${expression}}});
      utilityProcess.fork(${expression});`);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.electron.browser_windows).toMatchObject([
      { preload_path: null },
    ]);
    expect(analysis.electron.utility_processes).toMatchObject([
      { module_path: null },
    ]);
  },
);

it("distinguishes replacing a path child slot from changing its exported object", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    import changed from 'node:path';import path from 'node:path/posix';
    changed.posix={resolve(first){return first}};
    import{BrowserWindow}from'electron';
    new BrowserWindow({webPreferences:{preload:path.resolve(runtimePath,__dirname,'decoy.cjs')}});`);
  expect(analysis.electron.browser_windows).toMatchObject([
    { preload_path: "decoy.cjs" },
  ]);
});
