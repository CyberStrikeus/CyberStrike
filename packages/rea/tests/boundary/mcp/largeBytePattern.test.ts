import { expect, it } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/server";

import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const LARGE_PATTERN_BYTES = 4 * 1024 * 1024;

const inputValidationError = (result: CallToolResult) => {
  expect(result.isError).toBe(true);
  const diagnostic = parseMcpToolError(result).error;
  expect(diagnostic).toMatchObject({
    code: "invalid_request",
    recovery: {
      kind: "inspect_input_contract",
      operation: "search_bytes",
    },
  });
  const text = JSON.stringify(diagnostic);
  expect(text).not.toMatch(/RangeError|Maximum call stack/i);
  return diagnostic;
};

it("validates large search_bytes inputs without breaking stdio MCP", async () => {
  const { client, call } = await connectLocalToolsMcp();

  const definition = (await client.listTools()).tools.find(
    ({ name }) => name === "search_bytes",
  );
  expect(definition?.inputSchema.properties?.pattern).toMatchObject({
    type: "string",
  });
  expect(definition?.inputSchema.properties?.pattern).not.toHaveProperty(
    "pattern",
  );
  expect(definition?.inputSchema.properties?.mask).toMatchObject({
    type: "string",
  });
  expect(definition?.inputSchema.properties?.mask).not.toHaveProperty(
    "pattern",
  );

  const initial = await call("search_bytes", { pattern: "aa" });
  expect(parseMcpToolError(initial).error.code).toBe("target_unavailable");

  const largePattern = "aa".repeat(LARGE_PATTERN_BYTES);
  const largeSearch = await call("search_bytes", { pattern: largePattern });
  expect(parseMcpToolError(largeSearch).error.code).toBe("target_unavailable");

  const malformedPattern = `${largePattern.slice(0, -2)}a?`;
  const malformed = inputValidationError(
    await call("search_bytes", { pattern: malformedPattern }),
  );
  expect(malformed.details).toMatchObject({
    issues: [{ path: ["pattern"], reason: "invalid_value" }],
  });

  const oversizedMask = inputValidationError(
    await call("search_bytes", {
      pattern: "aa",
      mask: "ff".repeat(LARGE_PATTERN_BYTES),
    }),
  );
  expect(oversizedMask.details).toMatchObject({
    issues: [
      {
        path: ["mask"],
        reason: "invalid_value",
        message: "Mask length must equal pattern length",
      },
    ],
  });

  const final = await call("search_bytes", { pattern: "aa" });
  expect(parseMcpToolError(final).error.code).toBe("target_unavailable");
  await client.ping();
});
