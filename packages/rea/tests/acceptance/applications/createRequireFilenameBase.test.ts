import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import {
  analyzeJavaScriptDirectory,
  runNodeJsonControl,
} from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "resolves proven createRequire filenames from their own directory through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-create-require-base-");
    await writeFixtureFiles(root, {
      "main.mjs": `import { createRequire } from "node:module";
const nested = createRequire(new URL("./nested/anchor.cjs", import.meta.url));
const current = createRequire(import.meta.url);
console.log(JSON.stringify([nested("./dep.cjs"), current("./dep.cjs")]));`,
      "dep.cjs": 'module.exports = "root";',
      "nested/anchor.cjs": "",
      "nested/dep.cjs": 'module.exports = "nested";',
    });

    expect(await runNodeJsonControl(root, "main.mjs")).toEqual([
      "nested",
      "root",
    ]);
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    const dependencies = graph.edges
      .filter(
        ({ relation, properties }) =>
          relation === "imports" &&
          properties.specifier === "./dep.cjs" &&
          properties.kind === "require",
      )
      .map(({ properties }) => ({
        resolution_base_path: properties.resolution_base_path,
        resolved_path: properties.resolved_path,
      }));
    expect(dependencies).toHaveLength(2);
    expect(dependencies).toEqual(
      expect.arrayContaining([
        {
          resolution_base_path: "./nested/anchor.cjs",
          resolved_path: "nested/dep.cjs",
        },
        { resolution_base_path: null, resolved_path: "dep.cjs" },
      ]),
    );
  },
);
