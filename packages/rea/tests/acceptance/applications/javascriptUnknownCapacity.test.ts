import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "preserves caller unknown capacities and omission coverage through real worker, CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-js-unknown-capacity-");
    for (const name of ["first.js", "second.js"])
      await writeFile(
        join(root, name),
        "globalThis.u.p(globalThis.v[k]);\n".repeat(4),
      );
    const options = {
      max_semantic_nodes: 100,
      max_semantic_nodes_per_file: 100,
      max_semantic_unknowns: 3,
      max_semantic_unknowns_per_file: 2,
    };
    const contract = toolContract("analyze_javascript_application");
    const output = await cli.run({
      arguments: [
        "analyze-javascript-application",
        root,
        "--format",
        "json",
        "--max-semantic-nodes",
        "100",
        "--max-semantic-nodes-per-file",
        "100",
        "--max-semantic-unknowns",
        "3",
        "--max-semantic-unknowns-per-file",
        "2",
      ],
    });
    expect(output.exitCode).toBe(0);
    const evidence = contract.outputSchema.parse(output.json);
    expect(evidence.parameters).toMatchObject(options);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      evidence.normalized_result,
    );
    expect(result.semantic_graph.unknowns).toHaveLength(3);
    expect(result.semantic_graph.coverage).toMatchObject({
      status: "partial",
      truncated: true,
      omitted_nodes: 0,
    });
    expect(
      result.semantic_graph.coverage.omitted_unknown_occurrences!.reduce(
        (sum, row) => sum + row.occurrences,
        0,
      ),
    ).toBe(29);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("scripts/rea.mjs"), "mcp"],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "", REA_LOG_LEVEL: "silent" },
      stderr: "pipe",
    });
    const client = new Client({
      name: "unknown-capacity-regression",
      version: "1",
    });
    try {
      await client.connect(transport);
      const response = await client.callTool({
        name: contract.name,
        arguments: { input_path: root, detail: "complete", ...options },
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      const mcp = contract.outputSchema.parse(response.structuredContent);
      expect(mcp.parameters).toEqual(evidence.parameters);
      expect(mcp.evidence_id).toBe(evidence.evidence_id);
      expect(mcp.normalized_result).toEqual(evidence.normalized_result);
    } finally {
      try {
        await client.close();
      } finally {
        await transport.close();
      }
    }
  },
  30_000,
);
