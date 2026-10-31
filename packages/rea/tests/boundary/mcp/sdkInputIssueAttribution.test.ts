import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import { z } from "zod";
import { createServer } from "../../../src/server/createServer.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { observed } from "../../fixtures/analysisExecution.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

it("keeps concurrent SDK validation issues attached to their own tool call", async () => {
  let calls = 0;
  const server = createServer({
    kind: "fixed",
    analysis: {
      execute: () => {
        calls += 1;
        return Promise.resolve(observed(null));
      },
    },
  });
  const client = new Client({ name: "input-issue-attribution", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const [read, search, missing] = await Promise.all([
      client.callTool({
        name: "read_bytes",
        arguments: { address: 123, length: 0, document: false },
      }),
      client.callTool({
        name: "search_bytes",
        arguments: { pattern: 123, limit: 0, cursor: 23 },
      }),
      client.callTool({ name: "read_bytes", arguments: {} }),
    ]);
    expect(parseMcpToolError(read)).toMatchObject({
      error: {
        code: "invalid_request",
        details: {
          issues: [
            { path: ["address"], reason: "invalid_type", expected: "string" },
            { path: ["length"], reason: "out_of_range", minimum: 1 },
            { path: ["document"], reason: "invalid_type", expected: "string" },
          ],
        },
      },
    });
    expect(parseMcpToolError(search)).toMatchObject({
      error: {
        code: "invalid_request",
        details: {
          issues: [
            { path: ["pattern"], reason: "invalid_type", expected: "string" },
            { path: ["limit"], reason: "out_of_range", minimum: 1 },
            { path: ["cursor"], reason: "invalid_type", expected: "string" },
          ],
        },
      },
    });
    expect(parseMcpToolError(missing)).toMatchObject({
      error: {
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["address"],
              reason: "missing_argument",
              expected: "string",
            },
          ],
        },
      },
    });
    expect(calls).toBe(0);
    await expect(client.ping()).resolves.toBeDefined();
  } finally {
    await client.close();
    await server.close();
  }
});

it("preserves field diagnostics over production stdio and keeps serving", async () => {
  const { call, client } = await connectLocalToolsMcp();
  const result = await call("read_bytes", {
    address: 123,
    length: 0,
    document: false,
  });
  expect(parseMcpToolError(result)).toMatchObject({
    error: {
      code: "invalid_request",
      recovery: { kind: "inspect_input_contract", operation: "read_bytes" },
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: ["address"],
            reason: "invalid_type",
            expected: "string",
          }),
          expect.objectContaining({
            path: ["length"],
            reason: "out_of_range",
            minimum: 1,
          }),
          expect.objectContaining({
            path: ["document"],
            reason: "invalid_type",
            expected: "string",
          }),
        ]),
      },
    },
  });
  await expect(client.ping()).resolves.toBeDefined();
});

it("retains mixed SDK field diagnostics without repeating custom guidance", async () => {
  const info = { name: "custom-issues", version: "1" };
  const server = new EvidenceMcpServer(
    info,
    { capabilities: {} },
    undefined,
    createToolResultDelivery(4096),
  );
  const inputSchema = z.strictObject({
    first: z.string().regex(/^a$/u, "first correction"),
    second: z.string().regex(/^b$/u, "second correction"),
    count: z.number(),
  });
  server.registerTool("custom_issues", { inputSchema }, async () => ({
    content: [{ type: "text", text: "unexpected dispatch" }],
  }));
  const client = new Client(info);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const argumentsValue = {
      first: "wrong",
      second: "wrong",
      count: "wrong",
      extra: true,
    };
    const parsed = inputSchema.safeParse(argumentsValue);
    if (parsed.success) throw new Error("expected invalid input");
    const countIssue = parsed.error.issues.find(
      (issue) => issue.path[0] === "count",
    );
    if (countIssue === undefined) throw new Error("missing count issue");
    const unknownIssue = parsed.error.issues.find(
      (issue) => issue.code === "unrecognized_keys",
    );
    if (unknownIssue === undefined)
      throw new Error("missing unknown-key issue");
    const result = await client.callTool({
      name: "custom_issues",
      arguments: argumentsValue,
    });
    const error = parseMcpToolError(result).error;
    expect(error.details).toMatchObject({
      issues: [
        {
          path: ["first"],
          reason: "invalid_format",
          message: "first correction",
        },
        {
          path: ["second"],
          reason: "invalid_format",
          message: "second correction",
        },
        {
          path: ["count"],
          reason: "invalid_type",
          expected: "number",
          message: countIssue.message,
        },
        { path: ["extra"], reason: "unknown_argument" },
      ],
    });
    const text = JSON.stringify(error);
    expect(text.split("first correction")).toHaveLength(2);
    expect(text.split("second correction")).toHaveLength(2);
    expect(error.message.split(unknownIssue.message)).toHaveLength(2);
  } finally {
    await client.close();
    await server.close();
  }
});

it("keeps same-path union and independent issues attributed to their producers", async () => {
  const info = { name: "issue-producer", version: "1" };
  const server = new EvidenceMcpServer(
    info,
    { capabilities: {} },
    undefined,
    createToolResultDelivery(4096),
  );
  const inputSchema = z.intersection(
    z.object({
      a: z.union([z.object({ x: z.string() }), z.object({ x: z.number() })]),
    }),
    z.object({ a: z.object({ x: z.array(z.string()) }) }),
  );
  server.registerTool("overlapping_issues", { inputSchema }, async () => ({
    content: [{ type: "text", text: "unexpected dispatch" }],
  }));
  const client = new Client(info);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const input = { a: { x: false } };
    const parsed = inputSchema.safeParse(input);
    if (parsed.success) throw new Error("expected invalid input");
    const rawArrayIssue = parsed.error.issues.find(
      (issue) => issue.code === "invalid_type",
    );
    if (rawArrayIssue === undefined) throw new Error("missing array issue");
    const result = await client.callTool({
      name: "overlapping_issues",
      arguments: input,
    });
    const error = parseMcpToolError(result).error;
    const issues = z
      .array(
        z
          .object({
            expected: z.unknown().optional(),
            message: z.string().optional(),
          })
          .passthrough(),
      )
      .parse(error.details?.issues);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["a", "x"],
          reason: "invalid_type",
          expected: "array",
          message: rawArrayIssue.message,
        }),
        expect.objectContaining({
          path: ["a", "x"],
          reason: "invalid_type",
          expected: "string",
        }),
        expect.objectContaining({
          path: ["a", "x"],
          reason: "invalid_type",
          expected: "number",
        }),
      ]),
    );
    const stringIssue = issues.find((issue) => issue.expected === "string");
    expect(stringIssue?.message).not.toBe(rawArrayIssue.message);
  } finally {
    await client.close();
    await server.close();
  }
});

it("discloses when bounded projection cannot retain union branch details", async () => {
  const info = { name: "bounded-issues", version: "1" };
  const server = new EvidenceMcpServer(
    info,
    { capabilities: {} },
    undefined,
    createToolResultDelivery(4096),
  );
  const branches = Array.from({ length: 256 }, (_, index) =>
    z.object({ [`field_${String(index)}`]: z.string() }),
  );
  const first = branches[0];
  const second = branches[1];
  if (first === undefined || second === undefined)
    throw new Error("missing branches");
  const inputSchema = z.object({
    value: z.union([first, second, ...branches.slice(2)]),
  });
  server.registerTool("bounded_issues", { inputSchema }, async () => ({
    content: [{ type: "text", text: "unexpected dispatch" }],
  }));
  const sdkServer = new McpServer(info);
  sdkServer.registerTool("bounded_issues", { inputSchema }, async () => ({
    content: [{ type: "text", text: "unexpected dispatch" }],
  }));
  const keySchema = z.strictObject({});
  const unreachable = async () => ({
    content: [{ type: "text" as const, text: "unexpected dispatch" }],
  });
  server.registerTool("long_key", { inputSchema: keySchema }, unreachable);
  sdkServer.registerTool("long_key", { inputSchema: keySchema }, unreachable);
  const client = new Client(info);
  const sdkClient = new Client(info);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const [sdkClientTransport, sdkServerTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await sdkServer.connect(sdkServerTransport);
    await sdkClient.connect(sdkClientTransport);
    const sdkResult = await sdkClient.callTool({
      name: "bounded_issues",
      arguments: { value: {} },
    });
    const sdkText = sdkResult.content.find(
      (item) => item.type === "text",
    )?.text;
    const prefix =
      "Input validation error: Invalid arguments for tool bounded_issues: ";
    expect(sdkText?.startsWith(prefix)).toBe(true);
    const diagnostic = sdkText?.slice(prefix.length);
    expect(diagnostic).toBeTruthy();
    const result = await client.callTool({
      name: "bounded_issues",
      arguments: { value: {} },
    });
    expect(parseMcpToolError(result)).toMatchObject({
      error: {
        code: "invalid_request",
        details: {
          issues: [
            {
              path: [],
              reason: "invalid_value",
              message: diagnostic,
              observed: { field_details: "omitted" },
            },
          ],
        },
      },
    });
    const argumentsWithLongKey = { [`key_${"x".repeat(1600)}`]: true };
    const sdkLongKey = await sdkClient.callTool({
      name: "long_key",
      arguments: argumentsWithLongKey,
    });
    const sdkLongText = sdkLongKey.content.find(
      (item) => item.type === "text",
    )?.text;
    const keyPrefix =
      "Input validation error: Invalid arguments for tool long_key: ";
    expect(sdkLongText?.startsWith(keyPrefix)).toBe(true);
    const keyDiagnostic = sdkLongText?.slice(keyPrefix.length);
    expect(keyDiagnostic).toBeTruthy();
    const longKey = await client.callTool({
      name: "long_key",
      arguments: argumentsWithLongKey,
    });
    const longKeyError = parseMcpToolError(longKey).error;
    expect(longKeyError).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: [],
            reason: "invalid_value",
            message: keyDiagnostic,
            observed: { field_details: "omitted" },
          },
        ],
      },
    });
    expect(longKeyError.message).not.toContain(keyDiagnostic);
    await expect(client.ping()).resolves.toBeDefined();
  } finally {
    await client.close();
    await server.close();
    await sdkClient.close();
    await sdkServer.close();
  }
});
