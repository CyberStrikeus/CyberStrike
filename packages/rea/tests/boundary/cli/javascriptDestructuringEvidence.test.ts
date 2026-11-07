import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "retains assignment and nested-default destructuring Evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-js-destructuring-evidence-",
    );
    await writeFile(
      join(root, "main.js"),
      `
    const src = { a: 1 };
    const { a: declared } = src;
    let a;
    ({ a } = src);
    const nested = { a: [1], b: 2 };
    const { a: [plain] } = nested;
    const { a: [fallback] = [] } = nested;
    const { b: scalar = 0 } = nested;
  `,
    );
    const output = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(output.exitCode).toBe(0);
    const { normalized_result: result } = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(output.json);
    const graph = result.semantic_graph;
    for (const [name, path] of [
      ["declared", ["a"]],
      ["a", ["a"]],
      ["plain", ["a", "0"]],
      ["fallback", ["a", "0"]],
      ["scalar", ["b"]],
    ] as const) {
      const binding = graph.nodes.find(
        (node) => node.kind === "binding" && node.label === name,
      );
      expect(binding).toBeDefined();
      const relations = graph.relations.filter(
        (relation) =>
          relation.relation === "destructures" &&
          relation.target_node_id === binding?.node_id,
      );
      expect(relations).toHaveLength(1);
      expect(relations[0]?.resolution).toBe("resolved");
      expect(
        graph.nodes.find(
          (node) => node.node_id === relations[0]?.source_node_id,
        )?.properties.property_path,
      ).toEqual(path);
    }
  },
);
