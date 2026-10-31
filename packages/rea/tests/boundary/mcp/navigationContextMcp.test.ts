import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";

import { ok } from "../../../src/domain/result.js";
import { createServer } from "../../../src/server/createServer.js";
import { observed } from "../../fixtures/analysisExecution.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const navigate = async (
  selection: Readonly<Record<string, unknown>>,
): Promise<CallToolResult> => {
  const session = createTestBinarySession(() => ({
    execute: (operation) =>
      Promise.resolve(observed(selection[operation] ?? null)),
    close: () => Promise.resolve(ok(null)),
  }));
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "navigation-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await client.callTool({
      name: "open_binary",
      arguments: { path: process.execPath },
    });
    return (await client.callTool({
      name: "get_navigation_context",
      arguments: {},
    })) as CallToolResult;
  } finally {
    await Promise.allSettled([client.close(), server.close(), session.close()]);
  }
};

it.each([
  {
    selection: { current_document: null, current_address: "0x401000" },
    operation: "current_document",
  },
  {
    selection: { current_document: "fixture", current_address: null },
    operation: "current_address",
  },
  {
    selection: {
      current_document: "fixture",
      current_address: "0x401000",
      resolve_containing_procedure: null,
    },
    operation: "resolve_containing_procedure",
  },
])(
  "delivers a typed MCP failure when $operation returns malformed output",
  async ({ selection, operation }) => {
    const result = await navigate(selection);
    expect(JSON.stringify(result.content)).not.toContain(
      "Output validation error",
    );
    expect(parseMcpToolError(result).error).toMatchObject({
      code: "unreadable_output",
      details: { operation },
    });
  },
);

it.each([
  null,
  {},
  { found: true, procedure: null },
  { query_address: "0x401000", found: false, procedure: null },
])(
  "rejects malformed procedure resolution rather than reporting absence: %j",
  async (resolution) => {
    const result = await navigate({
      current_document: "fixture",
      current_address: "0x401000",
      resolve_containing_procedure: resolution,
    });
    expect(parseMcpToolError(result).error).toMatchObject({
      code: "unreadable_output",
      details: { operation: "resolve_containing_procedure" },
    });
  },
);

it("keeps explicit procedure absence successful", async () => {
  const result = await navigate({
    current_document: "fixture",
    current_address: "0x401000",
    resolve_containing_procedure: {
      query_address: "0x401000",
      found: false,
      procedure: null,
      reason: "not_in_procedure",
    },
  });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    result: { document: "fixture", address: "0x401000", procedure: null },
  });
});
