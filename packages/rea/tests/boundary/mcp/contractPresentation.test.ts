import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { isCallToolResult } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import { z } from "zod";

import { GENERATED_MCP_TOOL_CATALOG } from "../../fixtures/mcpToolCatalog.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const execute = promisify(execFile);
const fixture = fileURLToPath(
  new URL("../../fixtures/contractPresentation.mjs", import.meta.url),
);
const resultSchema = z.object({
  catalog: z.array(
    z.object({
      name: z.string(),
      inputSchema: z.record(z.string(), z.unknown()),
      outputSchema: z.record(z.string(), z.unknown()),
    }),
  ),
  responses: z.array(
    z.object({ name: z.string(), response: z.record(z.string(), z.unknown()) }),
  ),
});

it("preserves full advertised schemas and handler meaning when presentation order changes", async () => {
  const { stdout } = await execute(process.execPath, [fixture, "reversed"], {
    env: {
      ...process.env,
      REA_MCP_INPUT_SCHEMA_PROFILE: "full",
      REA_MCP_OUTPUT_SCHEMA_PROFILE: "full",
    },
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const result = resultSchema.parse(JSON.parse(stdout));
  expect(result.catalog).toHaveLength(GENERATED_MCP_TOOL_CATALOG.length);
  expect(new Set(result.catalog.map(({ name }) => name))).toEqual(
    new Set(GENERATED_MCP_TOOL_CATALOG.map(({ name }) => name)),
  );
  for (const advertised of result.catalog) {
    const canonical = GENERATED_MCP_TOOL_CATALOG.find(
      ({ name }) => name === advertised.name,
    );
    expect(advertised.inputSchema).toEqual(canonical?.inputSchema);
    expect(advertised.outputSchema).toEqual(canonical?.outputSchema);
  }
  for (const { name, response } of result.responses) {
    if (!isCallToolResult(response))
      throw new Error(`Invalid tools/call fixture result for ${name}`);
    if (name === "reconcile_javascript_runtime") {
      expect(response.isError).not.toBe(true);
      expect(response.structuredContent).toMatchObject({
        operation: name,
      });
    } else {
      expect(response.isError, name).toBe(true);
      expect(parseMcpToolError(response), name).toMatchObject({
        error: { details: { operation: name } },
      });
    }
  }
});
