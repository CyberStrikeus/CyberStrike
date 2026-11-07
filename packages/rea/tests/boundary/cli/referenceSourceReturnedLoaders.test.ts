import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { historicalSourceGraphSchema } from "../../../src/domain/referenceSourceGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "imports immediate CommonJS loader results without promoting local or module values",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-reference-returned-loaders-",
    );
    const config = await createTestTempDirectory(
      "rea-reference-returned-loader-config-",
    );
    const source = `const load = (() => require)(); load('./dep.cjs');\n`;
    const sources = {
      "returned.cjs": source,
      "direct.cjs": `require('./dep.cjs');\n`,
      "local.cjs": `const load = (() => () => ({}))(); load('./dep.cjs');\n`,
      "module.mjs": source,
      "mixed.cjs": `const load = (() => flag ? require : replacement)(); load('./dep.cjs');\n`,
      "dep.cjs": `throw new Error('dependency must not execute');\n`,
    };
    await Promise.all(
      Object.entries(sources).map(([path, text]) =>
        writeFile(join(root, path), text),
      ),
    );
    const response = await cli.run({
      arguments: ["import-reference-source", root, "--json"],
      environment: {
        HOME: config,
        XDG_CONFIG_HOME: config,
        XDG_CACHE_HOME: config,
      },
    });
    expect(response.exitCode, response.stderr).toBe(0);
    const graph = historicalSourceGraphSchema.parse(response.json);
    expect(graph.parse_failures).toEqual([]);
    expect(
      graph.relationships.filter(({ kind }) => kind === "requires"),
    ).toEqual([
      {
        from_path: "direct.cjs",
        to: "dep.cjs",
        kind: "requires",
        resolution: "internal",
        parse_state: "parsed",
      },
      {
        from_path: "returned.cjs",
        to: "dep.cjs",
        kind: "requires",
        resolution: "internal",
        parse_state: "parsed",
      },
    ]);
    expect(graph.entries).toContainEqual(
      expect.objectContaining({
        path: "returned.cjs",
        content_state: "hashed",
        sha256: createHash("sha256").update(source).digest("hex"),
      }),
    );
  },
);
