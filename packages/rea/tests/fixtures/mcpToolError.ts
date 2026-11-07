import type { CallToolResult } from "@modelcontextprotocol/server";
import { expect } from "vitest";
import { z } from "zod";

import { analysisErrorProjectionSchema } from "../../src/contracts/errorSchemas.js";

/** Read and validate the complete typed diagnostic in an MCP tool failure. */
export function parseMcpToolError(result: CallToolResult) {
  expect(result.isError).toBe(true);
  const text = result.content.find((item) => item.type === "text");
  if (text?.type !== "text") throw new Error("Tool error omitted text content");
  return z
    .object({ error: analysisErrorProjectionSchema })
    .strict()
    .parse(JSON.parse(text.text));
}
