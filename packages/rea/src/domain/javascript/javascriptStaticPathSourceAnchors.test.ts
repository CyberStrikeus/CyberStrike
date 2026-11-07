import { createRequire, wrap } from "node:module";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";

import { expect, it } from "vitest";

import { analyzeCommonJsStaticFixture } from "../../../tests/fixtures/javascriptCommonJsAnalysis.js";

it.each([false, true])(
  "preserves only untouched authored CommonJS dirname vars: assigned=%s",
  (assigned) => {
    const setup = `const path=require('node:path/posix');var __dirname;${assigned ? '__dirname="relative";' : ""}`;
    const fixture = { exports: "" };
    const run = runInThisContext(
      wrap(`${setup}module.exports=path.join(__dirname,'preload.cjs');`),
    );
    run(
      fixture.exports,
      createRequire(import.meta.url),
      fixture,
      "/source/app/main.cjs",
      "/source/app",
    );
    expect(fixture.exports).toBe(
      assigned ? "relative/preload.cjs" : "/source/app/preload.cjs",
    );
    const analysis = analyzeCommonJsStaticFixture(
      `${setup}const{BrowserWindow}=require('electron');new BrowserWindow({webPreferences:{preload:path.join(__dirname,'preload.cjs')}});`,
    );
    expect(analysis.electron.browser_windows).toMatchObject([
      { preload_path: assigned ? null : "preload.cjs" },
    ]);
  },
);

it("keeps local dirname methods from proving a source anchor", () => {
  const helper = { dirname: (_url: string) => "/other" };
  expect(
    posix.resolve(
      "/runtime/base",
      helper.dirname("file:///source/app/main.mjs"),
      "decoy.cjs",
    ),
  ).toBe("/other/decoy.cjs");
  const analysis = analyzeCommonJsStaticFixture(
    `import path from 'node:path';const helper={dirname:()=>'/other'};const{BrowserWindow}=require('electron');new BrowserWindow({webPreferences:{preload:path.resolve(runtimeBase,helper.dirname(import.meta.url),'decoy.cjs')}});`,
  );
  expect(analysis.electron.browser_windows).toMatchObject([
    { preload_path: null },
  ]);
});

it("retains a proven Node dirname of the decoded module URL", () => {
  expect(
    posix.dirname(
      fileURLToPath("file:///source/app/main.mjs", { windows: false }),
    ),
  ).toBe("/source/app");
  const analysis = analyzeCommonJsStaticFixture(
    `import path from 'node:path';import{fileURLToPath}from'node:url';const{BrowserWindow}=require('electron');new BrowserWindow({webPreferences:{preload:path.resolve(runtimeBase,path.dirname(fileURLToPath(import.meta.url)),'preload.cjs')}});`,
  );
  expect(analysis.electron.browser_windows).toMatchObject([
    { preload_path: "preload.cjs" },
  ]);
});

it.each([false, true])(
  "preserves a decoded module URL through its real dirname owner: local=%s",
  (local) => {
    const decoded = fileURLToPath("file:///source/app/main.mjs", {
      windows: false,
    });
    const helper = { dirname: (_file: string) => "/other" };
    expect(local ? helper.dirname(decoded) : posix.dirname(decoded)).toBe(
      local ? "/other" : "/source/app",
    );
    const analysis = analyzeCommonJsStaticFixture(`
      import path from 'node:path';import*as url from 'node:url';
      const helper={dirname:()=>'/other'};const{BrowserWindow}=require('electron');
      new BrowserWindow({webPreferences:{preload:path.resolve(runtimeBase,${local ? "helper" : "path"}.dirname(url.fileURLToPath(import.meta.url)),'preload.cjs')}});
    `);
    expect(analysis.electron.browser_windows).toMatchObject([
      { preload_path: local ? null : "preload.cjs" },
    ]);
  },
);

it("does not use a URL string as a filesystem source-file anchor", () => {
  expect(posix.dirname("file:///source/app/main.mjs")).not.toBe("/source/app");
  const analysis = analyzeCommonJsStaticFixture(
    `import path from 'node:path';const{BrowserWindow}=require('electron');new BrowserWindow({webPreferences:{preload:path.resolve(runtimeBase,path.dirname(import.meta.url),'decoy.cjs')}});`,
  );
  expect(analysis.electron.browser_windows).toMatchObject([
    { preload_path: null },
  ]);
});

it.each([false, true])(
  "proves the CommonJS filename dirname owner: local=%s",
  (local) => {
    const analysis = analyzeCommonJsStaticFixture(
      `const path=require('node:path');const helper={dirname:()=>'.'};const{BrowserWindow}=require('electron');new BrowserWindow({webPreferences:{preload:path.resolve(runtimeBase,${local ? "helper" : "path"}.dirname(__filename),'decoy.cjs')}});`,
    );
    expect(analysis.electron.browser_windows).toMatchObject([
      { preload_path: local ? null : "decoy.cjs" },
    ]);
  },
);

it.each([false, true])(
  "preserves the utility-process dirname parameter until assigned: assigned=%s",
  (assigned) => {
    const analysis = analyzeCommonJsStaticFixture(
      `var __dirname;${assigned ? "__dirname='relative';" : ""}const path=require('node:path');const{utilityProcess}=require('electron');utilityProcess.fork(path.join(__dirname,'worker.cjs'));`,
    );
    expect(analysis.electron.utility_processes).toMatchObject([
      { module_path: assigned ? null : "worker.cjs" },
    ]);
  },
);
