import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { afterEach, describe, expect, it } from "vitest";

import { closeEnhancedToolResources, connect } from "./enhancedToolsHarness.js";
import { observed as ok } from "../../fixtures/analysisExecution.js";

afterEach(closeEnhancedToolResources);

describe("enhanced MCP input validation", () => {
  it("lets the SDK reject misspelled tool inputs", async () => {
    const client = await connect({ execute: () => Promise.resolve(ok([])) });
    const valid = await client.callTool({
      name: "trace_feature",
      arguments: { query: "needle" },
    });
    expect(valid.isError).not.toBe(true);
    const misspelled = await client.callTool({
      name: "trace_feature",
      arguments: { query: "needle", unrecognized_option: true },
    });
    expect(misspelled.isError).toBe(true);
    expect(misspelled.structuredContent).toBeUndefined();
    const nestedMisspelled = await client.callTool({
      name: "analyze_function",
      arguments: {
        procedure: "0x1",
        collection_offset: { commentz: 1 },
      },
    });
    expect(nestedMisspelled.isError).toBe(true);
    expect(nestedMisspelled.structuredContent).toBeUndefined();
  });

  it("returns a typed tool error for malformed Hopper boundary values", async () => {
    const client = await connect({
      execute: () => Promise.resolve(ok(["not", "a", "procedure", "map"])),
    });
    const result = await client.callTool({
      name: "analyze_swift_types",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const text = result.content.find((item) => item.type === "text");
    expect(text?.type === "text" ? text.text : "").toBe(
      JSON.stringify(parseMcpToolError(result)),
    );
  });
});
