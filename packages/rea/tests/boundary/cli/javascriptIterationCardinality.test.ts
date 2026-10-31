import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "preserves template loop assignments in public semantic Evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-js-iteration-cardinality-");
    await writeFile(
      join(root, "main.js"),
      `
    export function template() { let selected = "before"; for ([selected] in \`abc\`) {} return selected; }
    export function quoted() { let selected = "before"; for ([selected] in "abc") {} return selected; }
    export function empty() { let selected = "before"; for ([selected] in \`\`) {} return selected; }
    export function ordinaryTemplate() { let selected = "before"; for (selected in \`abc\`) {} return selected; }
    for (const [templateKey] in \`abc\`) { void templateKey; }
    for (const [quotedKey] in "abc") { void quotedKey; }
  `,
    );
    const output = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(output.exitCode).toBe(0);
    const envelope = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(output.json);
    const result = envelope.normalized_result;
    const shapeSchema = z.object({
      semantic_role: z.literal("export-return-shapes"),
      exported_name: z.string(),
      static_return_shapes: z.array(
        z.object({
          fields: z.array(z.object({ state: z.string(), value: z.unknown() })),
        }),
      ),
    });
    const shapes = result.graph.nodes.flatMap(({ observations }) =>
      observations.flatMap(({ properties }) => {
        const parsed = shapeSchema.safeParse(properties);
        return parsed.success ? [parsed.data] : [];
      }),
    );
    for (const name of ["template", "quoted", "ordinaryTemplate"]) {
      const shape = shapes.find(({ exported_name }) => exported_name === name);
      expect(shape?.static_return_shapes[0]?.fields[0]).toMatchObject({
        state: "unknown",
        value: null,
      });
    }
    expect(
      shapes.find(({ exported_name }) => exported_name === "empty")
        ?.static_return_shapes[0]?.fields[0],
    ).toMatchObject({ state: "literal", value: "before" });
    const graph = result.semantic_graph;
    for (const label of ["templateKey", "quotedKey"]) {
      const binding = graph.nodes.find(
        (node) => node.kind === "binding" && node.label === label,
      );
      expect(binding).toBeDefined();
      const assignment = graph.relations.find(
        (relation) =>
          relation.relation === "defines" &&
          relation.target_node_id === binding?.node_id &&
          graph.nodes.find((node) => node.node_id === relation.source_node_id)
            ?.label === "assignment",
      );
      expect(assignment).toBeDefined();
    }
  },
);
