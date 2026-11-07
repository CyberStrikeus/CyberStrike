import {
  javaScriptSemanticQueryInputSchema,
  javaScriptSemanticQueryResultSchema,
} from "../../../../src/domain/javascript/javascriptSemanticQuerySchemas.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { queryJavaScriptSemanticGraph } from "../../../../src/domain/javascript/javascriptSemanticQuery.js";
import { analyzeJavaScriptApplication } from "../../../support/javascriptApplicationScope.js";

it.each([
  {
    source: "export const value = -0;\n",
    target: { kind: "binding", label: "value" },
  },
  {
    source: "export const root = { value: -0 };\n",
    target: { kind: "property-slot", propertyPointer: "/value" },
  },
])(
  "keeps negative-zero value unknown in an exported query (%#)",
  async ({ source, target }) => {
    const root = await createTestTempDirectory("rea-signed-zero-");
    await writeFile(join(root, "app.js"), source);
    const result = await analyzeJavaScriptApplication({
      input_path: root,
      format: "directory",
    });
    if (!result.ok) throw result.error;
    const analysis = javascriptApplicationAnalysisResultSchema.parse(
      result.value.normalized_result,
    );
    const node =
      target.kind === "binding"
        ? analysis.semantic_graph.nodes.find(
            ({ kind, label }) => kind === "binding" && label === target.label,
          )
        : analysis.semantic_graph.nodes.find(
            ({ kind, properties }) =>
              kind === "property-slot" &&
              properties.property_pointer === target.propertyPointer,
          );
    if (node === undefined)
      throw new Error("Expected the selected semantic node");
    const query = queryJavaScriptSemanticGraph(
      analysis.semantic_graph,
      javaScriptSemanticQueryInputSchema.parse({
        seed: { kind: "semantic-node", node_id: node.node_id },
        direction: "backward-provenance",
        allowed_relations: ["defines"],
      }),
    );
    const transportedQuery = javaScriptSemanticQueryResultSchema.parse(
      JSON.parse(JSON.stringify(query)),
    );
    expect(transportedQuery.nodes.some(({ kind }) => kind === "literal")).toBe(
      false,
    );
    expect(transportedQuery.coverage.status).toBe("partial");
    expect(transportedQuery.unknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "unknown-value",
          node_id: node.node_id,
          detail: expect.stringContaining(
            "Negative zero cannot be preserved by JSON primitive evidence.",
          ),
        }),
      ]),
    );
  },
);
