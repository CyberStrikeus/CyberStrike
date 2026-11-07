import { createRequire } from "node:module";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it("keeps the actual CommonJS module export separate from an ESM synthetic default", () => {
  const require = createRequire(import.meta.url);
  const exported = require("node:module");
  expect(Object.hasOwn(exported, "default")).toBe(false);
  expect(exported.default).toBeUndefined();
  expect(() =>
    runInNewContext(
      "const load=require('node:module').default.createRequire(base);load('node:path');",
      { require, base: import.meta.url },
    ),
  ).toThrow();
  const analysis = analyzeJavaScriptStaticSource(
    "const load=require('node:module').default.createRequire(import.meta.url);load('node:path');",
  );
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.references).toEqual([
    expect.objectContaining({ kind: "require", specifier: "node:module" }),
  ]);
});

it.each(["call", "apply"] as const)(
  "retains both native and local created-loader %s alternatives",
  (method) => {
    const body = (base: string) =>
      `const load=make(${base});if(flag)load.${method}=()=>({kind:'local'});load.${method}(null,${method === "call" ? "'node:path'" : "['node:path']"});`;
    for (const flag of [false, true]) {
      const result = runInNewContext(body("base"), {
        make: createRequire,
        base: import.meta.url,
        flag,
      });
      expect(result.join === path.join).toBe(!flag);
      if (flag) expect(result.kind).toBe("local");
    }
    const analysis = analyzeJavaScriptStaticSource(
      `import {createRequire as make} from 'node:module';${body("import.meta.url")}`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect(
      analysis.references.filter(({ kind }) => kind === "require"),
    ).toEqual([expect.objectContaining({ kind: "require", specifier: null })]);
  },
);

it.each(["call", "apply"] as const)(
  "retains both native and local captured-wrapper %s alternatives",
  (method) => {
    const body = `const load=require;if(flag)load.${method}=()=>({kind:'local'});load.${method}(null,${method === "call" ? "'node:path'" : "['node:path']"});`;
    for (const flag of [false, true]) {
      const result = runInNewContext(body, {
        require: createRequire(import.meta.url),
        flag,
      });
      expect(result.join === path.join).toBe(!flag);
      if (flag) expect(result.kind).toBe("local");
    }
    const analysis = analyzeJavaScriptStaticSource(body);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual([
      expect.objectContaining({ kind: "require", specifier: null }),
    ]);
  },
);
