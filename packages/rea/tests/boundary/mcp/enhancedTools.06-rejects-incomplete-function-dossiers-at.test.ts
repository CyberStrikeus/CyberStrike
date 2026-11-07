import type { CallToolResult } from "@modelcontextprotocol/server";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { afterEach, describe, expect, it } from "vitest";

import { functionDossierSchema } from "../../../src/domain/native/functionDossier.js";
import { ghidraFunctionDossier } from "../../../src/domain/ghidraValues.fixture.js";
import { observed } from "../../fixtures/analysisExecution.js";
import { closeEnhancedToolResources, connect } from "./enhancedToolsHarness.js";

afterEach(closeEnhancedToolResources);

const expectDossierFailure = (result: CallToolResult) => {
  const error = parseMcpToolError(result);
  expect(error.error).toMatchObject({
    code: "unreadable_output",
    details: {
      operation: "analyze_function",
      reason: "provider output did not match the dossier contract",
    },
  });
  expect(result.content).toContainEqual({
    type: "text",
    text: JSON.stringify(error),
  });
};

describe("analyze_function MCP producer validation", () => {
  it("rejects an incomplete function dossier", async () => {
    const client = await connect({
      execute: () =>
        Promise.resolve(
          observed({
            procedure: { address: "0x1", name: "entry" },
            pseudocode: { text: "plausible but incomplete" },
          }),
        ),
    });
    const result = await client.callTool({
      name: "analyze_function",
      arguments: { procedure: "0x1", detail: "complete" },
    });

    expectDossierFailure(result);
  });

  it.each([
    "procedure.classification",
    "procedure.body",
    "native_api",
    "native_value_flow",
    "limitations",
  ])("rejects a complete dossier missing %s", async (field) => {
    const dossier = functionDossierSchema.parse(ghidraFunctionDossier());
    const value = structuredClone(dossier) as unknown as Record<
      string,
      unknown
    >;
    if (field.startsWith("procedure.")) {
      const procedure = value.procedure as Record<string, unknown>;
      delete procedure[field.slice("procedure.".length)];
    } else delete value[field];

    const client = await connect({
      execute: () => Promise.resolve(observed(value)),
    });
    const result = await client.callTool({
      name: "analyze_function",
      arguments: { procedure: "0x1", detail: "complete" },
    });

    expectDossierFailure(result);
  });

  it("rejects a malformed collection in an otherwise complete dossier", async () => {
    const dossier = functionDossierSchema.parse(ghidraFunctionDossier());
    const client = await connect({
      execute: () =>
        Promise.resolve(
          observed({
            ...dossier,
            comments: {
              items: [],
              total: 0,
              returned: 1,
              truncated: false,
              next_offset: null,
            },
          }),
        ),
    });
    const result = await client.callTool({
      name: "analyze_function",
      arguments: { procedure: "0x1", detail: "complete" },
    });

    expectDossierFailure(result);
  });
});
