import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "preserves catch-shadowed initializer mutations in exported Evidence through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory(
      "rea-catch-initializer-ownership-",
    );
    await writeFile(
      join(root, "app.cjs"),
      `throw new Error("This analysis fixture must not execute");
exports.shadowed = function shadowed() {
  const state = { value: 1 };
  try { throw 0; } catch (handler) {
    var { handler } = { handler: state };
    handler.value = 2;
  }
  return state.value;
};
exports.unshadowed = function unshadowed() {
  const state = { value: 1 };
  try { throw 0; } catch (error) {
    var { handler } = { handler: state };
    handler.value = 2;
  }
  return state.value;
};
exports.readOnly = function readOnly() {
  const state = { value: 1 };
  try { throw 0; } catch (handler) {
    var { handler } = { handler: state };
    const saved = handler.value;
  }
  return state.value;
};
`,
    );
    const { graph } = await analyzeJavaScriptDirectory(surface, cli, root);
    for (const [name, status] of [
      ["shadowed", "unknown"],
      ["unshadowed", "unknown"],
      ["readOnly", "literal"],
    ] as const) {
      const observation = graph.nodes
        .flatMap(({ observations }) => observations)
        .find(
          ({ properties }) =>
            properties.semantic_role === "export-return-shapes" &&
            properties.exported_name === name,
        );
      expect(observation, name).toBeDefined();
      expect(observation?.properties.static_return_shapes).toMatchObject([
        {
          value_status: status,
          fields: [
            { path: "", state: status, value: status === "unknown" ? null : 1 },
          ],
        },
      ]);
    }
  },
);
