import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const client = new Client({ name: "literal-budget-boundary", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve("scripts/rea.mjs"), "mcp"],
  cwd: process.cwd(),
  env: { PATH: process.env.PATH ?? "" },
  stderr: "pipe",
});
beforeAll(async () => {
  await client.connect(transport);
  transport.stderr?.on("data", () => undefined);
});
afterAll(async () => {
  await Promise.all([client.close(), transport.close()]);
});

const large = "x".repeat(200_000);
for (const scenario of [
  { name: "quoted literal", expression: JSON.stringify(large), limited: true },
  { name: "cooked template", expression: `\`${large}\``, limited: true },
  {
    name: "limited member receiver",
    expression: `(${JSON.stringify(large)}).field`,
    limited: true,
  },
  {
    name: "configuration-only default",
    expression: `process.env.MODE ?? ${JSON.stringify(large)}`,
    bare: true,
    limited: true,
  },
  {
    name: "equivalent addition",
    expression: `${JSON.stringify(large.slice(0, 100_000))} + ${JSON.stringify(large.slice(100_000))}`,
    limited: true,
  },
  { name: "small exact control", expression: '"small"', limited: false },
]) {
  cliTest(
    `preserves normalized string-byte coverage for ${scenario.name}`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-literal-budget-");
      const path = join(root, "main.js");
      const source =
        "bare" in scenario
          ? `${scenario.expression};\n`
          : `export const payload = ${scenario.expression};\n`;
      await writeFile(path, source);
      const digest = createHash("sha256").update(source).digest("hex");
      const cliResponse = await cli.run({
        arguments: ["analyze-javascript-application", root, "--json"],
        timeoutMs: 60_000,
      });
      expect(cliResponse.exitCode).toBe(0);
      const cliEvidence = toolContract(
        "analyze_javascript_application",
      ).outputSchema.parse(cliResponse.json);
      const response = await client.callTool({
        name: "analyze_javascript_application",
        arguments: { input_path: root },
      });
      expect(response.isError).not.toBe(true);
      const evidence = toolContract(
        "analyze_javascript_application",
      ).outputSchema.parse(response.structuredContent);
      expect(evidence.evidence_id).toBe(cliEvidence.evidence_id);

      for (const candidate of [cliEvidence, evidence]) {
        const analysis = javascriptApplicationAnalysisResultSchema.parse(
          candidate.normalized_result,
        );
        const stringLengths = analysis.semantic_graph.nodes.flatMap(
          ({ properties }) =>
            typeof properties.value === "string"
              ? [properties.value.length]
              : [],
        );
        expect(stringLengths).not.toContain(large.length);
        if (scenario.limited) {
          expect(analysis.graph.coverage.status).toBe("partial");
          expect(analysis.graph.coverage.limits).toContainEqual(
            expect.objectContaining({
              name: "javascript_semantic_primitive_bytes",
              unit: "bytes",
              value: 1_048_576,
            }),
          );
          expect(analysis.semantic_graph.unknowns).toContainEqual(
            expect.objectContaining({
              reason: "resource-limit",
              detail: expect.stringMatching(
                /primitive string-byte budget exceeded/i,
              ),
            }),
          );
        } else {
          expect(stringLengths).toContain(5);
          expect(analysis.graph.coverage.limits).toEqual([]);
        }
        if ("bare" in scenario) {
          const node = analysis.semantic_graph.nodes.find(
            ({ kind, properties }) =>
              kind === "config-source" && properties.source_kind === "default",
          );
          expect(node?.properties).toMatchObject({
            value: null,
            value_resource_limit: "primitive-bytes",
          });
          expect(analysis.semantic_graph.unknowns).toContainEqual(
            expect.objectContaining({
              node_id: node?.node_id,
              reason: "resource-limit",
            }),
          );
        }
        expect(
          analysis.graph.nodes.find((node) => node.kind === "javascript-asset")
            ?.identity,
        ).toMatchObject({ sha256: digest });
      }
      expect(await readFile(path, "utf8")).toBe(source);
      await client.ping();
    },
  );
}
