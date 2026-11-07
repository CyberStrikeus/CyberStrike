import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("preserves Map omission and uncertain endpoint Evidence through public MCP", async () => {
  const root = await createTestTempDirectory("rea-map-endpoint-mcp-");
  await writeFile(
    join(root, "app.mjs"),
    `
    const records = new Map();
    const alias = records;
    alias.get('/accounts');
    records.delete('/accounts');
    client.get('/uncertain');
    fetch('/network');
  `,
  );
  const client = new Client({ name: "map-endpoint-regression", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("scripts/rea.mjs"), "mcp"],
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? "" },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const output = await client.callTool({
      name: "analyze_javascript_application",
      arguments: { input_path: root },
    });
    expect(output.isError).not.toBe(true);
    const evidence = parseEvidence(output.structuredContent);
    const text = output.content.find((block) => block.type === "text");
    expect(text?.type === "text" ? JSON.parse(text.text) : undefined).toEqual(
      evidence,
    );
    const result = javascriptApplicationAnalysisResultSchema.parse(
      evidence.normalized_result,
    );
    const endpoints = result.graph.nodes.filter(
      ({ kind }) => kind === "endpoint",
    );
    expect(
      endpoints
        .flatMap(({ observations }) =>
          observations.map(({ properties }) => properties.value),
        )
        .sort(),
    ).toEqual(["/network", "/uncertain"]);
    const candidate = endpoints.find(
      ({ observations }) => observations[0]?.properties.value === "/uncertain",
    );
    expect(candidate?.observations[0]).toMatchObject({
      properties: { interpretation: "candidate" },
      evidence: {
        state: "inferred",
        confidence: "low",
        limitations: expect.arrayContaining([
          expect.stringContaining("only a candidate"),
        ]),
      },
    });
    expect(
      result.graph.edges.find(
        ({ target_node_id }) => target_node_id === candidate?.node_id,
      )?.evidence,
    ).toMatchObject({ state: "inferred", confidence: "low" });
    expect(
      endpoints.find(
        ({ observations }) => observations[0]?.properties.value === "/network",
      )?.observations[0]?.evidence,
    ).toMatchObject({ state: "observed", confidence: "exact" });
  } finally {
    await client.close();
    await transport.close();
  }
}, 20_000);
