import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { evidenceBundleSchema } from "../../../src/domain/evidenceBundle.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "retains a partial call-site record when its arguments exceed transfer capacity",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-call-transfer-input-");
    const output = await createTestTempDirectory("rea-call-transfer-output-");
    const source = `rpc(${Array.from({ length: 64 }, () => JSON.stringify("x".repeat(140_000))).join(",")});`;
    await writeFile(join(root, "large.js"), source);
    const bundlePath = join(output, "evidence.json");
    const response = await cli.run({
      arguments: [
        "analyze-javascript-application",
        root,
        "--artifact-format",
        "directory",
        "--max-heap-mb",
        "1024",
        "--analysis-timeout-ms",
        "30000",
        "--detail",
        "summary",
        "--evidence_output",
        bundlePath,
        "--json",
      ],
      timeoutMs: 60_000,
    });
    expect(response.exitCode).toBe(0);
    const bundle = evidenceBundleSchema.parse(
      JSON.parse(await readFile(bundlePath, "utf8")),
    );
    const evidence = bundle.records.find(
      (record) => record.operation === "analyze_javascript_application",
    );
    if (evidence === undefined)
      throw new Error("Expected application Evidence");
    const result = javascriptApplicationAnalysisResultSchema.parse(
      evidence.normalized_result,
    );
    const graph = result.semantic_graph;
    const call = graph.nodes.find((node) => node.kind === "call-site");
    expect(call?.properties.arguments).toEqual(expect.any(Array));
    expect(graph.unknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_id: call?.node_id,
          reason: "resource-limit",
          detail: expect.stringMatching(/worker transfer record ceiling/u),
        }),
      ]),
    );
  },
  90_000,
);
