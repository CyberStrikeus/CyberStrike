import { afterEach, expect, it } from "vitest";
import { AnalysisInputError } from "../../../src/domain/analysisErrorCore.js";
import { NoBinaryOpenError } from "../../../src/domain/configurationErrors.js";
import { err } from "../../../src/domain/result.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { closeEnhancedToolResources, connect } from "./enhancedToolsHarness.js";

afterEach(closeEnhancedToolResources);

it.each([
  {
    failure: new AnalysisInputError("analyze_function", {
      userMessage: "Unknown selector: missing",
    }),
    code: "invalid_request",
    category: "invalid_input",
    message: "Unknown selector: missing",
  },
  {
    failure: new NoBinaryOpenError(),
    code: "target_unavailable",
    category: "unavailable",
    message: "No app is open",
  },
])(
  "preserves seed admission diagnostics through registered MCP: $code",
  async ({ failure, code, category, message }) => {
    const attempts: unknown[] = [];
    const client = await connect({
      execute: async (operation, parameters) => {
        attempts.push([operation, parameters]);
        return err(failure);
      },
    });
    const result = await client.callTool({
      name: "trace_native_values",
      arguments: { procedure: "missing" },
    });
    const projected = parseMcpToolError(result).error;
    expect(projected).toMatchObject({
      code,
      category,
      message: expect.stringContaining(message),
    });
    expect(attempts).toEqual([["analyze_function", { procedure: "missing" }]]);
  },
);
