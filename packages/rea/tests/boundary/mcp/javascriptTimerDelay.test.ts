import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "retains unknown timer delays and unrelated facts through public CLI and MCP",
  { timeout: 60_000 },
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-timer-delay-");
    const source = [
      'export function greet() { return "hello"; }',
      "setTimeout(() => greet(), 1e999);",
      "setInterval(() => greet(), 1e309);",
      "setTimeout(() => greet(), 100);",
      "setTimeout(() => greet(), 1e308);",
      "setTimeout(() => greet(), Infinity);",
      "setImmediate(() => greet());",
    ].join("\n");
    const path = join(root, "main.js");
    await writeFile(path, source);
    const digest = createHash("sha256").update(source).digest("hex");
    const cliResult = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(cliResult.exitCode).toBe(0);
    const contract = toolContract("analyze_javascript_application");
    const cliEvidence = contract.outputSchema.parse(cliResult.json);
    const graph = javascriptApplicationAnalysisResultSchema.parse(
      cliEvidence.normalized_result,
    ).semantic_graph;
    const timers = graph.nodes.filter(({ kind }) => kind === "timer");
    const pairs = timers.map(({ properties }) => [
      properties.method,
      properties.delay_milliseconds,
    ]);
    const sorted = (values: unknown[]) =>
      values.map((value) => JSON.stringify(value)).sort();
    expect(sorted(pairs)).toEqual(
      sorted([
        ["setTimeout", null],
        ["setInterval", null],
        ["setTimeout", 100],
        ["setTimeout", 1e308],
        ["setTimeout", null],
        ["setImmediate", null],
      ]),
    );
    expect(
      graph.nodes.find(
        ({ kind, label }) => kind === "function" && label === "greet",
      )?.identity,
    ).toMatchObject({ module_path: "main.js", artifact_sha256: digest });
    for (const timer of timers) {
      expect(Object.hasOwn(timer.properties, "delay_milliseconds")).toBe(true);
      expect(timer.identity).toMatchObject({
        module_path: "main.js",
        artifact_sha256: digest,
      });
    }

    const client = new Client({ name: "timer-delay-boundary", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("scripts/rea.mjs"), "mcp"],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "" },
      stderr: "pipe",
    });
    transport.stderr?.on("data", () => undefined);
    try {
      await client.connect(transport);
      const reply = await client.callTool({
        name: contract.name,
        arguments: { input_path: root },
      });
      expect(reply.isError).not.toBe(true);
      const evidence = contract.outputSchema.parse(reply.structuredContent);
      expect(evidence.evidence_id).toBe(cliEvidence.evidence_id);
      const text = reply.content.find((item) => item.type === "text");
      if (text?.type !== "text") throw new Error("Missing inline Evidence");
      expect(
        contract.outputSchema.parse(JSON.parse(text.text)).evidence_id,
      ).toBe(evidence.evidence_id);
      const retained = javascriptApplicationAnalysisResultSchema.parse(
        evidence.normalized_result,
      ).semantic_graph;
      expect(retained.nodes.filter(({ kind }) => kind === "timer")).toEqual(
        timers,
      );
      expect(
        retained.nodes.some(
          ({ kind, label }) => kind === "function" && label === "greet",
        ),
      ).toBe(true);
      await expect(client.ping()).resolves.toEqual({});
    } finally {
      await Promise.all([client.close(), transport.close()]);
    }
    expect(await readFile(path, "utf8")).toBe(source);
  },
);
