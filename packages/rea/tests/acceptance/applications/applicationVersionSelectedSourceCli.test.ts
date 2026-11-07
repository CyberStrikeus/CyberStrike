import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { applicationVersionComparisonResultSchema } from "../../../src/domain/javascript/javascriptApplicationVersionComparisonSchemas.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "keeps unexamined identical sources unknown in both comparison directions",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-version-selected-");
    await writeFile(join(root, "main.js"), "export const name = 'one';\n");
    await writeFile(
      join(root, "lib.js"),
      "export function shared() { return 1; }\n",
    );
    const run = async (args: string[]) => {
      const result = await cli.run({
        arguments: args,
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(result.exitCode, result.stderr).toBe(0);
      return parseEvidence(result.json);
    };
    const complete = await run([
      "analyze-javascript-application",
      root,
      "--json",
    ]);
    const selected = await run([
      "analyze-javascript-application",
      root,
      "--source-path",
      "main.js",
      "--json",
    ]);
    const graph = javascriptApplicationAnalysisResultSchema.parse(
      complete.normalized_result,
    ).graph;
    const asset = graph.nodes.find(
      (node) =>
        node.kind === "javascript-asset" &&
        node.observations.some(
          ({ properties }) => properties.path === "lib.js",
        ),
    );
    expect(asset).toBeDefined();
    for (const [left, right] of [
      [complete, selected],
      [selected, complete],
    ] as const) {
      const input = join(root, "comparison.json");
      await writeFile(input, JSON.stringify({ left, right }));
      const result = applicationVersionComparisonResultSchema.parse(
        (await run(["compare-application-versions", input, "--json"]))
          .normalized_result,
      );
      const item = result.items.find(
        (entry) =>
          entry.left_node_id === asset?.node_id ||
          entry.right_node_id === asset?.node_id,
      );
      expect(item).toMatchObject({
        status: "unknown",
        match: { basis: "exact-content-digest" },
        dimensions: expect.arrayContaining(["coverage"]),
      });
      expect(item?.dimensions).not.toContain("properties");
      expect(item?.limitations.join(" ")).toContain(
        "Source file analysis was not complete",
      );
    }
  },
);
