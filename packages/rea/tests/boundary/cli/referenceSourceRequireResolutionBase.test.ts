import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { historicalSourceGraphSchema } from "../../../src/domain/referenceSourceGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "resolves a proven createRequire URL base and preserves unsupported alternatives",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-reference-require-base-");
    const config = await createTestTempDirectory(
      "rea-reference-require-base-config-",
    );
    await mkdir(join(root, "sub"), { recursive: true });
    await Promise.all([
      writeFile(
        join(root, "main.mjs"),
        [
          'import { createRequire } from "node:module";',
          'const custom = createRequire(new URL("./sub/entry.cjs", import.meta.url));',
          'custom("./dep.cjs");',
          "const local = createRequire(import.meta.url);",
          'local("./dep.cjs");',
          'local.resolve("./alias-options.cjs", { paths: [] });',
        ].join("\n"),
      ),
      writeFile(join(root, "dep.cjs"), "module.exports = 'root';\n"),
      writeFile(join(root, "sub", "dep.cjs"), "module.exports = 'sub';\n"),
      writeFile(join(root, "sub", "entry.cjs"), "module.exports = {};\n"),
    ]);

    const result = await cli.run({
      arguments: ["import-reference-source", root, "--json"],
      environment: {
        HOME: config,
        XDG_CONFIG_HOME: config,
        XDG_CACHE_HOME: config,
      },
    });
    expect(result.exitCode, result.stderr + JSON.stringify(result.json)).toBe(
      0,
    );
    const graph = historicalSourceGraphSchema.parse(result.json);
    expect(graph.relationships).toEqual(
      expect.arrayContaining([
        {
          from_path: "main.mjs",
          to: "sub/dep.cjs",
          kind: "requires",
          resolution: "internal",
          parse_state: "parsed",
        },
        {
          from_path: "main.mjs",
          to: "dep.cjs",
          kind: "requires",
          resolution: "internal",
          parse_state: "parsed",
        },
        {
          from_path: "main.mjs",
          to: "./alias-options.cjs",
          kind: "requires",
          resolution: "unknown",
          parse_state: "partial",
        },
      ]),
    );
  },
);

cliTest(
  "honors supported require.resolve search options and leaves alternate paths unknown",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-reference-require-resolve-paths-",
    );
    const config = await createTestTempDirectory(
      "rea-reference-require-resolve-paths-config-",
    );
    await mkdir(join(root, "sub"), { recursive: true });
    await Promise.all([
      writeFile(
        join(root, "main.cjs"),
        [
          'require.resolve("./dep.cjs");',
          'require.resolve("./same-path.cjs", { paths: [__dirname] });',
          'require.resolve("./dep.cjs", { paths: [__dirname + "/sub"] });',
          'require.resolve("./dep.cjs", { paths: [] });',
          'function shadow(__dirname) { require.resolve("./shadow.cjs", { paths: [__dirname] }); }',
        ].join("\n"),
      ),
      writeFile(join(root, "dep.cjs"), "module.exports = 'root';\n"),
      writeFile(join(root, "same-path.cjs"), "module.exports = 'same path';\n"),
      writeFile(join(root, "sub", "dep.cjs"), "module.exports = 'sub';\n"),
      writeFile(join(root, "shadow.cjs"), "module.exports = 'shadow';\n"),
    ]);

    const result = await cli.run({
      arguments: ["import-reference-source", root, "--json"],
      environment: {
        HOME: config,
        XDG_CONFIG_HOME: config,
        XDG_CACHE_HOME: config,
      },
    });
    expect(result.exitCode, result.stderr + JSON.stringify(result.json)).toBe(
      0,
    );
    const graph = historicalSourceGraphSchema.parse(result.json);
    const relationships = graph.relationships.filter(
      ({ from_path, kind }) => from_path === "main.cjs" && kind === "requires",
    );
    expect(relationships).toEqual(
      expect.arrayContaining([
        {
          from_path: "main.cjs",
          to: "dep.cjs",
          kind: "requires",
          resolution: "internal",
          parse_state: "parsed",
        },
        {
          from_path: "main.cjs",
          to: "./dep.cjs",
          kind: "requires",
          resolution: "unknown",
          parse_state: "partial",
        },
        {
          from_path: "main.cjs",
          to: "same-path.cjs",
          kind: "requires",
          resolution: "internal",
          parse_state: "parsed",
        },
        {
          from_path: "main.cjs",
          to: "./shadow.cjs",
          kind: "requires",
          resolution: "unknown",
          parse_state: "partial",
        },
      ]),
    );
    expect(relationships).toHaveLength(4);
  },
);
