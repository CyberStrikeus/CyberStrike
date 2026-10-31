import { expect, it } from "vitest";

import { expandToolAvailability } from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import { sessionOutputSchemas } from "../../../src/contracts/toolOutputSchemaGroups.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

it("reports debugger start host restrictions without requiring an analysis target", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("discovery must not start binary analysis");
  });
  const { client } = await createApplicationMcpHarness({ session });
  const entries = async (detail: "summary" | "complete") => {
    const response = await client.callTool({
      name: "binary_session",
      arguments: { detail },
    });
    expect(response.isError).not.toBe(true);
    const parsed = sessionOutputSchemas.binary_session.parse(
      response.structuredContent,
    ).result;
    expect(parsed.open).toBe(false);
    return expandToolAvailability(parsed.tool_availability);
  };
  for (const detail of ["summary", "complete"] as const) {
    const tools = await entries(detail);
    for (const name of ["start_gdb_session", "start_rizin_debug_session"]) {
      expect(tools.find((tool) => tool.name === name)).toMatchObject(
        process.platform === "linux"
          ? { available: true, reason: "available" }
          : {
              available: false,
              reason: "unsupported_host",
              remediation: expect.stringContaining("Linux"),
            },
      );
    }
    expect(
      tools.find((tool) => tool.name === "gdb_session_status"),
    ).toMatchObject({ available: true });
  }
  if (process.platform !== "linux") {
    for (const [name, args] of [
      ["start_gdb_session", {}],
      [
        "start_rizin_debug_session",
        { path: "./absent.bin", inferior_tty: "/dev/null" },
      ],
    ] as const) {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError).toBe(true);
      expect(parseMcpToolError(response)).toMatchObject({
        error: { code: "capability_unavailable" },
      });
    }
    const after = await entries("complete");
    for (const name of ["start_gdb_session", "start_rizin_debug_session"])
      expect(after.find((tool) => tool.name === name)).toMatchObject({
        available: false,
        reason: "unsupported_host",
      });
  }
});
