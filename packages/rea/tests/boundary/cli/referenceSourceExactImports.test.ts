import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { historicalSourceGraphSchema } from "../../../src/domain/referenceSourceGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "preserves exact historical dynamic and exported import-equals edges",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-reference-exact-imports-");
    const config = await createTestTempDirectory(
      "rea-reference-exact-imports-config-",
    );
    await Promise.all([
      writeFile(
        join(root, "main.ts"),
        [
          "const templated = import(`./template.mjs`);",
          'const wrapped = import("./wrapped.mjs" as const);',
          'const name = "./not-guessed.mjs"; import(name);',
        ].join("\n"),
      ),
      writeFile(
        join(root, "exported.cts"),
        'export import dep = require("./dep.cjs");\n',
      ),
      writeFile(
        join(root, "plain.cts"),
        'import dep = require("./dep.cjs"); export { dep };\n',
      ),
      ...["template.mjs", "wrapped.mjs"].map((path) =>
        writeFile(join(root, path), "export {};\n"),
      ),
      writeFile(join(root, "dep.cjs"), "module.exports = { value: 1 };\n"),
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
          from_path: "main.ts",
          to: "template.mjs",
          kind: "imports",
          resolution: "internal",
          parse_state: "parsed",
        },
        {
          from_path: "main.ts",
          to: "wrapped.mjs",
          kind: "imports",
          resolution: "internal",
          parse_state: "parsed",
        },
        {
          from_path: "main.ts",
          to: "<dynamic-import>",
          kind: "imports",
          resolution: "unknown",
          parse_state: "partial",
        },
        {
          from_path: "exported.cts",
          to: "dep.cjs",
          kind: "requires",
          resolution: "internal",
          parse_state: "parsed",
        },
        {
          from_path: "plain.cts",
          to: "dep.cjs",
          kind: "requires",
          resolution: "internal",
          parse_state: "parsed",
        },
      ]),
    );
    expect(graph.relationships).toHaveLength(5);
  },
);
