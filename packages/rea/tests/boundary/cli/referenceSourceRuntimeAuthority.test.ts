import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { expect } from "vitest";

import { historicalSourceGraphSchema } from "../../../src/domain/referenceSourceGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";

const writeSources = async (root: string, sources: Record<string, string>) => {
  await Promise.all(
    Object.entries(sources).map(async ([path, source]) => {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), source);
    }),
  );
};

const importGraph = async (cli: TestCli, root: string) => {
  const config = await createTestTempDirectory(
    "rea-reference-authority-config-",
  );
  const result = await cli.run({
    arguments: ["import-reference-source", root, "--json"],
    environment: {
      HOME: config,
      XDG_CONFIG_HOME: config,
      XDG_CACHE_HOME: config,
    },
  });
  expect(result.exitCode, result.stderr + JSON.stringify(result.json)).toBe(0);
  return historicalSourceGraphSchema.parse(result.json);
};

cliTest(
  "shares runtime authority without promoting unresolved source contexts",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-reference-runtime-authority-",
    );
    const request = 'require("./dep.cjs");\n';
    const derived = [
      'const { createRequire } = require("node:module");',
      'const load = createRequire(import.meta.url); load("./dep.cjs");',
    ].join("\n");
    const sources = {
      "package.json": '{"type":"module"}\n',
      ".gitignore": "excluded/package.json\n",
      "main.js": request,
      "main.ts": request,
      "derived.js": derived,
      "derived.mjs": derived,
      "main.cjs": request,
      "main.cts": request,
      "dep.cjs": "module.exports = 1;\n",
      "untyped/package.json": "{}\n",
      "untyped/main.js": request,
      "untyped/dep.cjs": "module.exports = 2;\n",
      "untyped/syntax.js": request + "export {};\n",
      "untyped/erased.ts": 'import type { Stats } from "node:fs";\n' + request,
      "unknown/package.json": "{\n",
      "unknown/main.ts": request,
      "unknown/main.jsx": request,
      "unknown/main.tsx": request,
      "unknown/factory.js": derived,
      "unknown/dep.cjs": "module.exports = 3;\n",
      "excluded/package.json": '{"type":"commonjs"}\n',
      "excluded/main.js": request,
      "excluded/dep.cjs": "module.exports = 4;\n",
      "factory.mjs": [
        'import { createRequire } from "node:module";',
        'const load = createRequire(import.meta.url); load("./dep.cjs");',
      ].join("\n"),
    };
    await writeSources(root, sources);
    const graph = await importGraph(cli, root);
    expect(graph.parse_failures).toEqual([]);
    const requires = graph.relationships.filter(
      ({ kind }) => kind === "requires",
    );
    for (const [from_path, to] of [
      ["main.cjs", "dep.cjs"],
      ["main.cts", "dep.cjs"],
      ["untyped/main.js", "untyped/dep.cjs"],
      ["factory.mjs", "dep.cjs"],
    ])
      expect(requires).toContainEqual({
        from_path,
        to,
        kind: "requires",
        resolution: "internal",
        parse_state: "parsed",
      });
    for (const from_path of [
      "untyped/erased.ts",
      "unknown/main.ts",
      "unknown/main.jsx",
      "unknown/main.tsx",
      "unknown/factory.js",
      "excluded/main.js",
    ]) {
      expect(requires).toContainEqual({
        from_path,
        to: "./dep.cjs",
        kind: "requires",
        resolution: "unknown",
        parse_state: "partial",
      });
      expect(graph.entries).toContainEqual(
        expect.objectContaining({
          path: from_path,
          limitations: [expect.stringContaining("Module context is unknown")],
        }),
      );
    }
    expect(requires).toContainEqual({
      from_path: "unknown/factory.js",
      to: "node:module",
      kind: "requires",
      resolution: "unknown",
      parse_state: "partial",
    });
    expect(requires).toHaveLength(11);
    for (const path of [
      "main.js",
      "main.ts",
      "derived.js",
      "derived.mjs",
      "untyped/syntax.js",
    ])
      expect(requires.filter(({ from_path }) => from_path === path)).toEqual(
        [],
      );
    expect(graph.entries).toContainEqual(
      expect.objectContaining({
        path: "derived.js",
        sha256: createHash("sha256").update(derived).digest("hex"),
        content_state: "hashed",
      }),
    );
  },
);

cliTest(
  "preserves owned CommonJS factories through erased TypeScript syntax",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-reference-ts-factory-");
    const source = [
      'import type { Stats } from "node:fs";',
      'const { createRequire } = require("node:module");',
      'const load = createRequire(__filename); load("./dep.cjs");',
    ].join("\n");
    await writeSources(root, {
      "package.json": '{"type":"module"}\n',
      "main.cts": source,
      "dep.cjs": "module.exports = 1;\n",
      "cjs/package.json": '{"type":"commonjs"}\n',
      "cjs/main.ts": source,
      "cjs/dep.cjs": "module.exports = 2;\n",
    });
    const graph = await importGraph(cli, root);
    expect(graph.parse_failures).toEqual([]);
    expect(graph.relationships).toHaveLength(6);
    for (const from_path of ["main.cts", "cjs/main.ts"]) {
      expect(graph.relationships).toContainEqual({
        from_path,
        to: "node:fs",
        kind: "imports",
        resolution: "external",
        parse_state: "parsed",
      });
      expect(graph.relationships).toContainEqual({
        from_path,
        to: "node:module",
        kind: "requires",
        resolution: "external",
        parse_state: "parsed",
      });
      // __filename remains outside the supported createRequire base forms.
      expect(graph.relationships).toContainEqual({
        from_path,
        to: "./dep.cjs",
        kind: "requires",
        resolution: "unknown",
        parse_state: "partial",
      });
    }
  },
);

cliTest(
  "retains unknown bases when the selected root omits its package scope",
  async ({ cli }) => {
    const parent = await createTestTempDirectory(
      "rea-reference-unseen-authority-",
    );
    await writeSources(parent, {
      "package.json": '{"type":"module"}\n',
      "selected/main.js": 'require("./dep.cjs");\n',
      "selected/dep.cjs": "module.exports = 1;\n",
    });
    const graph = await importGraph(cli, join(parent, "selected"));
    expect(graph.parse_failures).toEqual([]);
    expect(graph.relationships).toEqual([
      {
        from_path: "main.js",
        to: "./dep.cjs",
        kind: "requires",
        resolution: "unknown",
        parse_state: "partial",
      },
    ]);
    expect(graph.entries.map(({ path }) => path)).toEqual([
      "dep.cjs",
      "main.js",
    ]);
    expect(graph.limitations).toContainEqual(
      expect.stringContaining("Module context is unknown"),
    );
  },
);
