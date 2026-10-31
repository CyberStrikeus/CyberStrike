import { Ajv2020 } from "ajv/dist/2020.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, onTestFinished } from "vitest";
import { z } from "zod";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { inspectAnalysisViewInputSchema } from "../../../src/domain/analysisView/analysisView.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { NATIVE_INVENTORY_OPERATIONS } from "../../../src/domain/native/nativeInventory.js";
import { ok } from "../../../src/domain/result.js";
import { createServer } from "../../../src/server/createServer.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { connectGhidraMcp } from "./ghidraMcpHarness.js";

const procedureRows = [
  {
    address: "0x1000",
    value: "first",
    procedure: { external: false, thunk: false, thunk_target: null },
  },
  {
    address: "0x2000",
    value: "second",
    procedure: { external: false, thunk: false, thunk_target: null },
  },
];
// Ghidra 12.1.4 search_procedures capture from the source-owned PowerPC DOL.
const searchProcedureRows = [
  {
    address: "0x80003100",
    value: "FUN_80003100",
    symbol: {
      primary: true,
      dynamic: false,
      external: false,
      type: "function",
      source: "default",
    },
  },
  {
    address: "0x80003130",
    value: "__start",
    symbol: {
      primary: true,
      dynamic: false,
      external: false,
      type: "function",
      source: "user_defined",
    },
  },
];
const stringRows = [
  {
    address: "0x3000",
    value: "hello",
    string: {
      encoding: "utf-8",
      termination: "present_or_not_required",
      byte_length: 6,
    },
  },
];
const nameRows = [
  {
    address: "0x1000",
    value: "first",
    symbol: {
      primary: true,
      dynamic: false,
      external: false,
      type: "function",
      source: "analysis",
    },
  },
];

it("shares complete/summary source identity and advertised contracts across all five inventory tools", async () => {
  const harness = await connectGhidraMcp(
    "native-inventory-views",
    (operation) => {
      if (operation === "search_procedures")
        return Promise.resolve(ok(searchProcedureRows));
      if (operation === "search_strings")
        return Promise.resolve(
          ok(stringRows.map(({ address, value }) => ({ address, value }))),
        );
      const result =
        operation === "list_names"
          ? nameRows
          : operation.endsWith("strings")
            ? stringRows
            : procedureRows;
      return Promise.resolve(ok(result));
    },
  );
  onTestFinished(() => harness.close());
  const tools = (await harness.mcp.listTools()).tools;
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const viewTool = tools.find((tool) => tool.name === "inspect_analysis_view");
  if (viewTool?.outputSchema === undefined)
    throw new Error("Missing view schema");
  const viewInputSchema: Record<string, unknown> = viewTool.inputSchema;
  const viewOutputSchema: Record<string, unknown> = viewTool.outputSchema;
  expect(ajv.validateSchema(viewInputSchema)).toBe(true);
  expect(ajv.validateSchema(viewOutputSchema)).toBe(true);
  for (const operation of NATIVE_INVENTORY_OPERATIONS) {
    const contract = toolContract(operation);
    const advertised = tools.find((tool) => tool.name === operation);
    if (advertised?.outputSchema === undefined)
      throw new Error("Missing operation schema");
    const inputSchema: Record<string, unknown> = advertised.inputSchema;
    const outputSchema: Record<string, unknown> = advertised.outputSchema;
    expect(ajv.validateSchema(inputSchema)).toBe(true);
    expect(ajv.validateSchema(outputSchema)).toBe(true);
    const parameters = operation.startsWith("search_")
      ? { pattern: ".", mode: "regex" }
      : {};
    const completeReply = await harness.mcp.callTool({
      name: operation,
      arguments: parameters,
    });
    if (completeReply.isError) throw new Error(JSON.stringify(completeReply));
    expect(
      ajv.validate(outputSchema, completeReply.structuredContent),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    const complete = parseEvidence(
      contract.outputSchema.parse(completeReply.structuredContent),
    );
    if (!Array.isArray(complete.normalized_result))
      throw new Error("Expected complete row array");
    expect(complete.normalized_result.length).toBeGreaterThan(0);
    if (operation === "search_procedures")
      expect(complete.normalized_result).toEqual(searchProcedureRows);
    expect(complete.parameters).not.toHaveProperty("detail");
    const summaryReply = await harness.mcp.callTool({
      name: operation,
      arguments: { ...parameters, detail: "summary" },
    });
    if (summaryReply.isError) throw new Error(JSON.stringify(summaryReply));
    expect(
      ajv.validate(outputSchema, summaryReply.structuredContent),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    const summary = parseEvidence(
      contract.outputSchema.parse(summaryReply.structuredContent),
    );
    expect(summary).toMatchObject({
      operation: "inspect_analysis_view",
      evidence_links: [complete.evidence_id],
      normalized_result: {
        parent_evidence_id: complete.evidence_id,
        source_provider: complete.provider,
        source_analysis_profile_digest:
          complete.analysis_profile?.digest ?? null,
        source_parameters: complete.parameters,
        summary: {
          row_count: (complete.normalized_result as unknown[]).length,
          discovery_coverage: "unknown",
        },
      },
    });
    expect(summary.limitations).toEqual(
      expect.arrayContaining(complete.limitations),
    );
    expect(harness.session.evidenceById(complete.evidence_id)).toEqual(
      complete,
    );
    const allRows = [];
    for (
      let offset = 0;
      offset < (complete.normalized_result as unknown[]).length;
      offset++
    ) {
      const pageReply = await harness.mcp.callTool({
        name: "inspect_analysis_view",
        arguments: {
          source: {
            kind: "retained-evidence",
            evidence_id: complete.evidence_id,
          },
          view: { kind: "native-inventory", offset, limit: 1 },
        },
      });
      if (pageReply.isError) throw new Error(JSON.stringify(pageReply));
      expect(
        ajv.validate(viewOutputSchema, pageReply.structuredContent),
        JSON.stringify(ajv.errors),
      ).toBe(true);
      const page = toolContract("inspect_analysis_view").outputSchema.parse(
        pageReply.structuredContent,
      ).normalized_result;
      if (page.kind !== "native-inventory")
        throw new Error("Expected inventory page");
      expect(page.rows[0]?.source_index).toBe(offset);
      allRows.push(...page.rows.map((row) => row.record));
    }
    expect(allRows).toEqual(complete.normalized_result);
  }
  expect(
    harness.calls.filter((name) =>
      NATIVE_INVENTORY_OPERATIONS.some((operation) => operation === name),
    ),
  ).toHaveLength(10);
});

it("recovers an oversized complete inventory through a working retained page without another provider read", async () => {
  const items = Array.from({ length: 1000 }, (_, index) => ({
    address: `0x${(0x1000 + index * 0x2000).toString(16)}`,
    value: "x".repeat(7000),
    string: {
      encoding: "utf-8",
      termination: "present_or_not_required",
      byte_length: 7001,
    },
  }));
  const harness = await connectGhidraMcp("native-inventory-capacity", () =>
    Promise.resolve(ok(items)),
  );
  onTestFinished(() => harness.close());
  const complete = await harness.mcp.callTool({
    name: "list_strings",
    arguments: {},
  });
  expect(complete.isError).toBe(true);
  const error = parseMcpToolError(complete).error;
  expect(error.code).toBe("resource_constraint");
  const recovery = z
    .object({
      reported_limits: z.object({
        boundary: z.literal("mcp-response"),
        continuation: z.unknown(),
      }),
    })
    .parse(error.details).reported_limits;
  const continuation = z
    .object({
      name: z.literal("inspect_analysis_view"),
      arguments: inspectAnalysisViewInputSchema,
    })
    .parse(recovery.continuation);
  const pageReply = await harness.mcp.callTool(continuation);
  if (pageReply.isError) throw new Error(JSON.stringify(pageReply));
  const page = toolContract("inspect_analysis_view").outputSchema.parse(
    pageReply.structuredContent,
  ).normalized_result;
  if (page.kind !== "native-inventory")
    throw new Error("Expected inventory page");
  expect(page.rows.map((row) => row.record)).toEqual(items.slice(0, 64));
  expect(page.coverage).toMatchObject({ total: 1000, next_offset: 64 });
  expect(harness.calls).toEqual(["list_strings"]);
  const summaryReply = await harness.mcp.callTool({
    name: "list_strings",
    arguments: { detail: "summary" },
  });
  if (summaryReply.isError) throw new Error(JSON.stringify(summaryReply));
  expect(
    parseEvidence(summaryReply.structuredContent).normalized_result,
  ).toMatchObject({ summary: { row_count: 1000 } });
});

it("refuses summary before provider work when no retaining session is configured", async () => {
  let calls = 0;
  const server = createServer({
    kind: "fixed",
    analysis: {
      execute: async () => {
        calls++;
        return ok(
          createAnalysisExecution(procedureRows, {
            id: "fixture",
            name: "Fixture",
            version: "1",
          }),
        );
      },
    },
  });
  const client = new Client({
    name: "unretained-native-summary",
    version: "1",
  });
  onTestFinished(async () => {
    await client.close();
    await server.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  for (const [name, parameters] of [
    ["list_procedures", {}],
    ["inspect_native_load_image", {}],
    ["procedure_address", { procedure: "fixture_main" }],
    ["procedure_callees", { procedure: "fixture_main" }],
    ["procedure_callers", { procedure: "fixture_main" }],
    ["resolve_containing_procedure", { address: "0x401001" }],
    ["get_call_graph", { address: "fixture_main" }],
  ] as const) {
    const reply = await client.callTool({
      name,
      arguments: { ...parameters, detail: "summary" },
    });
    expect(reply.isError).toBe(true);
    expect(parseMcpToolError(reply).error.code).toBe("capability_unavailable");
  }
  expect(calls).toBe(0);
});

it("projects imported inventories with an unknown artifact without inventing a path or opening a provider", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Retained views must not open a provider");
  });
  const source = createEvidence(
    undefined,
    { id: "borrowed.native", name: "Borrowed engine", version: "1" },
    {
      operation: "list_procedures",
      parameters: {},
      result: procedureRows,
      limitations: [
        "The engine did not bind this observation to an artifact digest.",
      ],
    },
  );
  const recorded = session.recordEvidence(source);
  if (!recorded.ok) throw recorded.error;
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "unbound-native-views", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await server.close();
    const closed = await session.close();
    if (!closed.ok) throw closed.error;
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  for (const view of [
    { kind: "summary" },
    { kind: "native-inventory", fields: [] },
  ]) {
    const reply = await client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source: { kind: "retained-evidence", evidence_id: source.evidence_id },
        view,
      },
    });
    if (reply.isError) throw new Error(JSON.stringify(reply));
    const evidence = parseEvidence(reply.structuredContent);
    expect(evidence).toMatchObject({
      subject: null,
      locations: [],
      evidence_links: [source.evidence_id],
      normalized_result: {
        artifact: null,
        source_provider: source.provider,
        source_parameters: {},
      },
    });
  }
});
