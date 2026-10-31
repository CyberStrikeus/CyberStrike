import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";
import { z } from "zod";

import { JSON_LINES_SELECTION_REMEDIATION } from "../../../src/cli/jsonLines.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const filter = "evidence_id,normalized_result.graph.nodes[0,1].node_id";

for (const scenario of [
  {
    command: "analyze-javascript-application",
    format: "json",
    fullOutput: false,
    filtered: true,
  },
  {
    command: "analyze-javascript-application",
    format: "jsonl",
    fullOutput: true,
    filtered: true,
  },
  { command: "analyze", format: "json", fullOutput: true, filtered: false },
  { command: "analyze", format: "jsonl", fullOutput: false, filtered: false },
] as const) {
  cliTest(
    `${scenario.command} ${scenario.format === "jsonl" ? "refuses graph documents without a supported record boundary" : "preserves representative JSON output"}`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-js-json-output-");
      await writeFile(join(root, "main.js"), "fetch('');\n");
      const direct = await analyzeJavaScriptApplication({ input_path: root });
      if (!direct.ok) throw direct.error;
      const normalized = javascriptApplicationAnalysisResultSchema.parse(
        direct.value.normalized_result,
      );
      const output = await cli.run({
        arguments: [
          scenario.command,
          root,
          "--format",
          scenario.format,
          ...(scenario.fullOutput ? ["--full-output"] : []),
          ...(scenario.filtered ? ["--filter-output", filter] : []),
        ],
      });
      if (scenario.format === "jsonl") {
        expect(output.exitCode).toBe(1);
        const record = z
          .object({
            $rea: z.literal("jsonl/v1"),
            type: z.literal("error"),
            result: z.unknown(),
          })
          .parse(output.json);
        const failure = scenario.fullOutput
          ? z
              .object({
                ok: z.literal(false),
                error: z.unknown(),
                meta: z.object({ command: z.literal(scenario.command) }),
              })
              .parse(record.result).error
          : record.result;
        expect(failure).toMatchObject({
          code: "invalid_request",
          category: "invalid_input",
          remediation: { action: JSON_LINES_SELECTION_REMEDIATION },
          details: {
            issues: [
              {
                path: [scenario.filtered ? "filter-output" : "format"],
                reason: "invalid_value",
              },
            ],
          },
        });
        return;
      }
      expect(output.exitCode).toBe(0);
      let data: unknown = output.json;
      if (scenario.fullOutput) {
        const envelope = z
          .object({
            ok: z.literal(true),
            data: z.unknown(),
            meta: z.object({
              command: z.literal(scenario.command),
              duration: z.string().regex(/^\d+ms$/u),
            }),
          })
          .parse(output.json);
        data = envelope.data;
      }
      expect(data).toEqual(
        scenario.filtered
          ? {
              evidence_id: direct.value.evidence_id,
              normalized_result: {
                graph: {
                  nodes: normalized.graph.nodes
                    .slice(0, 1)
                    .map(({ node_id }) => ({ node_id })),
                },
              },
            }
          : direct.value,
      );
      if (scenario.filtered)
        expect(normalized.graph.nodes.length).toBeGreaterThan(0);
    },
  );
}

cliTest(
  "preserves a complete empty filtered JSON document",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-js-json-empty-filter-");
    await writeFile(join(root, "main.js"), "export const value = 1;\n");
    const output = await cli.run({
      arguments: [
        "analyze-javascript-application",
        root,
        "--json",
        "--filter-output",
        "absent.field",
      ],
    });
    expect(output.exitCode).toBe(0);
    expect(output.json).toEqual({});
  },
);

cliTest(
  "preserves a typed failed analysis in the JSON result",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-js-json-failure-");
    const output = await cli.run({
      arguments: [
        "analyze-javascript-application",
        join(root, "absent"),
        "--json",
      ],
    });
    expect(output.json).toMatchObject({
      code: "invalid_request",
      details: { issues: [{ path: ["input_path"], reason: "invalid_value" }] },
    });
  },
);

cliTest(
  "preserves JSON omission for inherited filter methods",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-js-json-inherited-filter-");
    await writeFile(join(root, "main.js"), "export const value = 1;\n");
    const output = await cli.run({
      arguments: [
        "analyze-javascript-application",
        root,
        "--json",
        "--filter-output",
        "toString",
      ],
    });
    expect(output.exitCode).toBe(0);
    expect(output.json).toEqual({});
  },
);

cliTest(
  "honors caller-selected semantic node limits across files and records them in Evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-js-node-budgets-");
    await writeFile(join(root, "first.js"), "external;\n".repeat(40));
    await writeFile(join(root, "second.js"), "another;\n".repeat(40));
    const output = await cli.run({
      arguments: [
        "analyze-javascript-application",
        root,
        "--format",
        "json",
        "--max-semantic-nodes",
        "50",
        "--max-semantic-nodes-per-file",
        "30",
      ],
    });
    expect(output.exitCode).toBe(0);
    const result = z
      .object({
        parameters: z.object({
          max_semantic_nodes: z.number(),
          max_semantic_nodes_per_file: z.number(),
        }),
        normalized_result: z.object({
          semantic_graph: z.object({
            nodes: z.array(
              z.object({ identity: z.object({ module_path: z.string() }) }),
            ),
            coverage: z.object({
              truncated: z.boolean(),
              omitted_nodes: z.number().nullable(),
              limits: z.array(
                z.object({ name: z.string(), value: z.number() }),
              ),
            }),
          }),
        }),
      })
      .parse(output.json);
    expect(result.parameters).toEqual({
      max_semantic_nodes: 50,
      max_semantic_nodes_per_file: 30,
    });
    const graph = result.normalized_result.semantic_graph;
    expect(graph.nodes).toHaveLength(50);
    expect(
      graph.nodes.filter((node) => node.identity.module_path === "first.js"),
    ).toHaveLength(30);
    expect(
      graph.nodes.filter((node) => node.identity.module_path === "second.js"),
    ).toHaveLength(20);
    expect(graph.coverage.truncated).toBe(true);
    expect(graph.coverage.omitted_nodes).toBeNull();
    expect(graph.coverage.limits).toEqual(
      expect.arrayContaining([
        { name: "semantic_graph_node_ceiling", value: 50 },
        { name: "semantic_graph_file_node_ceiling", value: 30 },
        { name: "max_semantic_nodes", value: 50 },
        { name: "max_semantic_nodes_per_file", value: 30 },
      ]),
    );
    const limitation = z
      .object({
        normalized_result: z.object({
          semantic_graph: z.object({
            limitations: z.array(z.string()),
          }),
        }),
      })
      .parse(output.json);
    expect(
      limitation.normalized_result.semantic_graph.limitations.join("\n"),
    ).toContain("max_semantic_nodes");
    expect(
      limitation.normalized_result.semantic_graph.limitations.join("\n"),
    ).toContain("1 to 1000000");
  },
);
