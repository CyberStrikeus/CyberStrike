import { join } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import {
  analyzeJavaScriptDirectory,
  runNodeJsonControl,
} from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "preserves module classification and explicit source identities through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-module-owner-semantics-");
    const valid = {
      "legacy/x%2Ey.js": "node_modules/legacy/x.y.js",
      "mapped/encoded": "node_modules/mapped/x.y.js",
      "mapped/double": "node_modules/mapped/x%2Ey.js",
      "#encoded": "local.file.mjs",
      "./dep.mjs ": "dep.mjs",
      "./de\np.mjs": "dep.mjs",
      "\n./dep.mjs": "node_modules/dep.mjs",
      "\t./dep.mjs": "node_modules/dep.mjs",
      "\r./dep.mjs": "node_modules/dep.mjs",
    };
    const rejected = {
      " ./dep.mjs": "ERR_MODULE_NOT_FOUND",
      ".\n/dep.mjs": "ERR_INVALID_MODULE_SPECIFIER",
    };
    await writeFixtureFiles(root, {
      "package.json": JSON.stringify({
        type: "module",
        imports: { "#encoded": "./local%2Efile.mjs" },
      }),
      "main.mjs": [
        ...Object.keys(valid),
        ...Object.keys(rejected),
        "./absent.mjs",
        "mapped/missing",
        "mapped/invalid",
        "./dep.d.ts",
        "./cfg.d.mts",
        "./legacy.d.cts",
      ]
        .map((specifier) => `import ${JSON.stringify(specifier)};`)
        .join("\n"),
      "main.cjs": [
        "./dep.d.ts",
        "./cfg.d.mts",
        "./legacy.d.cts",
        "mapped/encoded",
        "mapped/double",
      ]
        .map((specifier) => `require(${JSON.stringify(specifier)});`)
        .join("\n"),
      "fallback.cts": 'require("./only.js");',
      "dep.d.ts": "export declare const value: number;",
      "cfg.d.mts": "export declare const value: number;",
      "legacy.d.cts": "export declare const value: number;",
      "only.d.ts": "export declare const value: number;",
      "dep.mjs": 'throw new Error("must never load");',
      "local.file.mjs": 'throw new Error("must never load");',
      "node_modules/dep.mjs": 'throw new Error("must never load");',
      "node_modules/legacy/package.json": '{"type":"module"}',
      "node_modules/legacy/x.y.js": 'throw new Error("must never load");',
      "node_modules/mapped/package.json": JSON.stringify({
        type: "module",
        exports: {
          "./encoded": "./x%2Ey.js",
          "./double": "./x%252Ey.js",
          "./missing": ["./absent%2Efile.js", "./x.y.js"],
          "./invalid": "./%2e%2e/escape.js",
        },
      }),
      "node_modules/mapped/x.y.js": 'throw new Error("must never load");',
      "node_modules/mapped/x%2Ey.js": 'throw new Error("must never load");',
      "oracle.mjs": `
import { fileURLToPath } from "node:url";
import { relative } from "node:path";
import { existsSync } from "node:fs";
const valid = ${JSON.stringify(Object.keys(valid))};
const rejected = ${JSON.stringify(Object.keys(rejected))};
const resolveFile = request => {
  const path = fileURLToPath(import.meta.resolve(request));
  return { path: relative(process.cwd(), path), exists: existsSync(path) };
};
console.log(JSON.stringify({
  valid: valid.map(resolveFile),
  rejected: rejected.map(request => {
    try { return { resolved: resolveFile(request) }; }
    catch (error) { return { code: error.code }; }
  }),
  missing: resolveFile("./absent.mjs"),
}));`,
    });
    // import.meta.resolve returns missing file URLs. A nonthrowing call alone
    // establishes neither file existence nor relative-versus-package identity.
    expect(await runNodeJsonControl(root, join(root, "oracle.mjs"))).toEqual({
      valid: Object.values(valid).map((path) => ({ path, exists: true })),
      rejected: Object.values(rejected).map((code) => ({ code })),
      missing: { path: "absent.mjs", exists: false },
    });
    const result = await analyzeJavaScriptDirectory(surface, cli, root);
    expect(result.statistics.parse_failures).toBe(0);
    const edges = (specifier: string) =>
      result.graph.edges.filter(
        (edge) =>
          edge.relation === "imports" &&
          edge.properties.specifier === specifier,
      );
    for (const [specifier, target] of Object.entries(valid)) {
      const matches = edges(specifier);
      expect(matches.length, specifier).toBeGreaterThan(0);
      for (const edge of matches)
        expect(edge.properties).toMatchObject({
          resolution_status: "resolved",
          resolved_path: target,
        });
    }
    for (const specifier of Object.keys(rejected)) {
      const matches = edges(specifier);
      expect(matches.length, specifier).toBeGreaterThan(0);
      for (const edge of matches)
        expect(edge.properties.resolved_path).toBeNull();
    }
    for (const suffix of ["dep.d.ts", "cfg.d.mts", "legacy.d.cts"]) {
      const matches = edges(`./${suffix}`);
      expect(matches.length, suffix).toBeGreaterThan(0);
      for (const edge of matches)
        expect(edge.properties).toMatchObject({
          resolution_status: "resolved",
          resolved_path: suffix,
        });
    }
    for (const [specifier, status] of [
      ["./only.js", "unavailable"],
      ["./absent.mjs", "not-found"],
      ["mapped/missing", "not-found"],
      ["mapped/invalid", "rejected"],
    ] as const) {
      const matches = edges(specifier);
      expect(matches.length, specifier).toBeGreaterThan(0);
      for (const edge of matches)
        expect(edge.properties).toMatchObject({
          resolution_status: status,
          resolved_path: null,
        });
    }
  },
);
