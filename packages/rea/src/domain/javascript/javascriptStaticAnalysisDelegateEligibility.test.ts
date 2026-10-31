import { Module } from "node:module";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it("keeps repeated Node resolver calls separate from loader delegate eligibility", () => {
  const expression = "path.resolve(runtimePath,__dirname,'preload.js')";
  const source = `
    const path=require('node:path');
    const {BrowserWindow,utilityProcess}=require('electron');
    new BrowserWindow({webPreferences:{preload:${expression}}});
    utilityProcess.fork(${expression});
  `;
  const observed: string[] = [];
  runInNewContext(source, {
    runtimePath: "/runtime",
    __dirname: "/fixture/app",
    require: (specifier: string) =>
      specifier === "node:path"
        ? path.posix
        : {
            BrowserWindow: class {
              constructor(options: { webPreferences: { preload: string } }) {
                observed.push(options.webPreferences.preload);
              }
            },
            utilityProcess: { fork: (file: string) => observed.push(file) },
          },
  });
  expect(observed).toEqual([
    "/fixture/app/preload.js",
    "/fixture/app/preload.js",
  ]);
  const analysis = analyzeJavaScriptStaticSource(source);
  expect(analysis.parse_status).toBe("complete");
  expect(analysis.references).toEqual([
    expect.objectContaining({ kind: "require", specifier: "node:path" }),
    expect.objectContaining({ kind: "require", specifier: "electron" }),
  ]);
  expect(analysis.electron.browser_windows[0]?.preload_path).toBe("preload.js");
  expect(analysis.electron.utility_processes[0]?.module_path).toBe(
    "preload.js",
  );
});

it("retains an escaped selected native delegate as a possible loader", () => {
  const source =
    "const box={load:module.require};opaque(box);box.load.call(module,'node:path');";
  const module = new Module("delegate-eligibility.cjs");
  expect(runInNewContext(source, { module, opaque: () => {} }).join).toBe(
    path.join,
  );
  const analysis = analyzeJavaScriptStaticSource(source);
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.references).toEqual([
    expect.objectContaining({ kind: "require", specifier: null }),
  ]);
});
