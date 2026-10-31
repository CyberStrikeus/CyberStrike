import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect } from "vitest";

import { toolContract } from "../../src/contracts/toolContracts.js";
import { javascriptApplicationAnalysisResultSchema } from "../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { projectedExportReturnShapesSchema } from "../../src/domain/javascript/javascriptExportShapeComparisonSchemas.js";
import { createTestTempDirectory } from "./temporaryDirectory.js";
import type { TestCli } from "../support/cli/cliFixture.js";

const exportedReturnFields = (value: unknown) => {
  const analysis = javascriptApplicationAnalysisResultSchema.parse(value);
  const projections = analysis.graph.nodes
    .flatMap(({ observations }) => observations)
    .filter(
      ({ properties }) => properties.semantic_role === "export-return-shapes",
    )
    .map(({ properties }) =>
      projectedExportReturnShapesSchema.parse(properties),
    );
  return (name: string) => {
    const projection = projections.find(
      ({ exported_name }) => exported_name === name,
    );
    if (projection === undefined) throw new Error(`Missing export ${name}`);
    expect(projection.return_shape_coverage).toMatchObject({
      status: "complete",
      projection_complete: true,
    });
    return projection.static_return_shapes.flatMap(({ fields }) => fields);
  };
};

/** Select complete return fields from a real JavaScript application result. */
export type JavaScriptReturnFields = ReturnType<typeof exportedReturnFields>;

const analyzeReturnShapesThroughCli = async (
  cli: TestCli,
  source: string,
  check: (fields: JavaScriptReturnFields) => void,
  fileName: string,
) => {
  const root = await createTestTempDirectory("rea-return-shapes-");
  await writeFile(join(root, fileName), source);
  const cliResponse = await cli.run({
    arguments: [
      "analyze-javascript-application",
      root,
      "--artifact-format",
      "directory",
      "--json",
    ],
  });
  expect(cliResponse.exitCode).toBe(0);
  const contract = toolContract("analyze_javascript_application");
  const cliEvidence = contract.outputSchema.parse(cliResponse.json);
  check(exportedReturnFields(cliEvidence.normalized_result));
  return { root, contract, cliEvidence };
};

/** Exercise return assertions through the compiled CLI and its real worker. */
export const verifyJavaScriptReturnShapesThroughCli = async (
  cli: TestCli,
  source: string,
  check: (fields: JavaScriptReturnFields) => void,
): Promise<void> => {
  await analyzeReturnShapesThroughCli(cli, source, check, "app.js");
};

/** Exercise identical return assertions through the compiled CLI and stdio MCP. */
export const verifyJavaScriptReturnShapes = async (
  cli: TestCli,
  source: string,
  check: (fields: JavaScriptReturnFields) => void,
  fileName = "app.js",
): Promise<void> => {
  const { root, contract, cliEvidence } = await analyzeReturnShapesThroughCli(
    cli,
    source,
    check,
    fileName,
  );
  const client = new Client({ name: "return-shapes-e2e", version: "1" });
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
    const response = await client.callTool({
      name: "analyze_javascript_application",
      arguments: { input_path: root, format: "directory" },
    });
    expect(response.isError).not.toBe(true);
    const evidence = contract.outputSchema.parse(response.structuredContent);
    expect(evidence.evidence_id).toBe(cliEvidence.evidence_id);
    check(exportedReturnFields(evidence.normalized_result));
    const text = response.content.find((item) => item.type === "text");
    if (text?.type !== "text") throw new Error("Missing MCP text result");
    check(
      exportedReturnFields(
        contract.outputSchema.parse(JSON.parse(text.text)).normalized_result,
      ),
    );
    await client.ping();
  } finally {
    await client.close();
    await transport.close();
  }
};
