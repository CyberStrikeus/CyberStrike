import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createServer } from "../../../src/server/createServer.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { ok } from "../../../src/domain/result.js";
import { z } from "zod";
import { afterAll, expect, it } from "vitest";
import { parseEvidence } from "../../../src/domain/evidence.js";
import {
  analysisViewResultSchema,
  inspectAnalysisViewInputSchema,
} from "../../../src/domain/analysisView/analysisView.js";
import { NATIVE_PRIMITIVE_OBSERVATION_OPERATIONS } from "../../../src/domain/native/nativeObservation.js";
import { connectGhidraMcp } from "./ghidraMcpHarness.js";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";
import { advertisedMcpToolSchemas } from "../../fixtures/advertisedMcpTool.js";

const validation = createMcpSchemaValidation();
afterAll(() => validation.clear());

it("delivers native primitive and graph summaries with exact retained parents and SDK-validated context pages", async () => {
  const harness = await connectGhidraMcp("native-observation-views");
  try {
    const definitions = new Map(
      (await harness.mcp.listTools()).tools.map((tool) => [tool.name, tool]),
    );
    const call = async (name: string, input: Record<string, unknown>) => {
      const tool = definitions.get(name);
      if (!tool?.outputSchema) throw new Error("Missing named contract");
      const result = await harness.mcp.callTool(
        { name, arguments: input },
        { toolDefinition: tool },
      );
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect(
        validation.assertions.validate(
          tool.outputSchema,
          result.structuredContent,
        ),
        JSON.stringify(validation.assertions.errors),
      ).toBe(true);
      return parseEvidence(result.structuredContent);
    };
    const viewSchemas = await advertisedMcpToolSchemas(
      harness.mcp,
      "inspect_analysis_view",
      validation.assertions,
    );
    for (const operation of [
      ...NATIVE_PRIMITIVE_OBSERVATION_OPERATIONS,
      "get_call_graph",
    ] as const) {
      const input =
        operation === "get_call_graph"
          ? { address: "fixture_main" }
          : operation === "resolve_containing_procedure"
            ? { address: "0x401001" }
            : { procedure: "fixture_main" };
      const complete = await call(operation, input);
      const summary = await call(operation, { ...input, detail: "summary" });
      expect(complete.operation).toBe(operation);
      expect(complete.parameters).not.toHaveProperty("detail");
      expect(summary.normalized_result).toMatchObject({
        kind: "summary",
        parent_operation: operation,
        parent_evidence_id: complete.evidence_id,
        source_parameters: complete.parameters,
        source_provider: complete.provider,
      });
      expect(harness.session.evidenceById(complete.evidence_id)).toEqual(
        complete,
      );
      const calls = harness.calls.length;
      const source = {
        kind: "retained-evidence",
        evidence_id: complete.evidence_id,
      };
      const page = await call("inspect_analysis_view", {
        source,
        view: { kind: "native-observation", offset: 0, limit: 1 },
      });
      const parsed = analysisViewResultSchema.parse(page.normalized_result);
      expect(parsed).toMatchObject({
        kind: "native-observation",
        parent_evidence_id: complete.evidence_id,
      });
      for (const facet of [
        "overview",
        "analysis-profile",
        "limitations",
        "result-limitations",
      ]) {
        const context = await call("inspect_analysis_view", {
          source,
          view: { kind: "native-context", facet, offset: 0, limit: 1 },
        });
        expect(context.relationship_coverage).toEqual(
          complete.relationship_coverage,
        );
        expect(context.normalized_result).toMatchObject({
          kind: "native-context",
          facet,
          parent_evidence_id: complete.evidence_id,
        });
      }
      expect(harness.calls).toHaveLength(calls);
      const invalid = {
        source,
        view: { kind: "native-context", facet: "unknown" },
      };
      expect(inspectAnalysisViewInputSchema.safeParse(invalid).success).toBe(
        false,
      );
      const rejected = await harness.mcp.callTool(
        { name: "inspect_analysis_view", arguments: invalid },
        { toolDefinition: viewSchemas.toolDefinition },
      );
      expect(rejected.isError).toBe(true);
    }
  } finally {
    await harness.close();
  }
}, 90_000);

it("follows native overflow continuations through MCP without repeating provider work", async () => {
  let reads = 0;
  const provider = { id: "fixture", name: "Fixture", version: "1" };
  const session = createTestBinarySession(() => ({
    execute: async (operation) => {
      reads++;
      return ok(
        createAnalysisExecution(
          operation === "procedure_address"
            ? "0x1000"
            : operation === "resolve_containing_procedure"
              ? {
                  query_address: "0x9999",
                  found: false,
                  procedure: null,
                  reason: "not_in_procedure",
                }
              : [],
          provider,
          {
            limitations: ["Capacity fixture ".repeat(1500)],
            relationshipCoverage: {
              status: "partial",
              limitations: ["Indirect edges unknown"],
            },
          },
        ),
      );
    },
    close: async () => ok(null),
  }));
  // Exercise the real delivery/SDK path with a small injected response budget.
  const server = createServer(
    { kind: "session", session },
    { delivery: createToolResultDelivery(32 * 1024) },
  );
  const client = new Client({
    name: "native-observation-capacity",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path: process.execPath },
    });
    expect(opened.isError).not.toBe(true);
    for (const name of [
      ...NATIVE_PRIMITIVE_OBSERVATION_OPERATIONS,
      "get_call_graph",
    ] as const) {
      const input =
        name === "get_call_graph" || name === "resolve_containing_procedure"
          ? { address: "0x1000" }
          : { procedure: "fixture_main" };
      const complete = await client.callTool({ name, arguments: input });
      const error = parseMcpToolError(complete).error;
      expect(error.code).toBe("resource_constraint");
      const continuation = z
        .object({
          reported_limits: z.object({
            continuation: z.object({
              name: z.literal("inspect_analysis_view"),
              arguments: inspectAnalysisViewInputSchema,
            }),
          }),
        })
        .parse(error.details).reported_limits.continuation;
      expect(continuation.arguments.view.kind).toBe("native-observation");
      const before = reads;
      const page = await client.callTool(continuation);
      expect(page.isError, JSON.stringify(page.content)).not.toBe(true);
      const evidence = parseEvidence(page.structuredContent);
      expect(evidence.normalized_result).toMatchObject({
        kind: "native-observation",
        parent_operation: name,
      });
      expect(reads).toBe(before);
    }
  } finally {
    await Promise.all([client.close(), server.close()]);
    const closed = await session.close();
    if (!closed.ok) throw closed.error;
  }
}, 90_000);
