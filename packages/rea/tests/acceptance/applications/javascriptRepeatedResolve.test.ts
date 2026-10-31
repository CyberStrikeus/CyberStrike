import { expect } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains consecutive native resolver relationships through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-repeat-resolve-");
    await writeFixtureFiles(root, {
      "main.cjs":
        'require.resolve("./first.js");require.resolve("./second.js");',
      "first.js": "module.exports=1;",
      "second.js": "module.exports=2;",
    });
    const result = await analyzeJavaScriptDirectory(surface, cli, root);
    const edges = result.graph.edges.filter(
      (edge) => edge.properties.operation === "resolve",
    );
    expect(
      edges.map((edge) => [
        edge.properties.specifier,
        edge.properties.resolved_path,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["./first.js", "first.js"],
        ["./second.js", "second.js"],
      ]),
    );
  },
);
