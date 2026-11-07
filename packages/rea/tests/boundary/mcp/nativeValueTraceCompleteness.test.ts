import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, expect, it } from "vitest";
import { valueTraceDiamond } from "../../../src/application/native/NativeValueTrace.fixture.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { nativeValueTraceSchema } from "../../../src/domain/native/nativeValueTrace.js";
import { advertisedMcpToolSchemas } from "../../fixtures/advertisedMcpTool.js";
import { createServer } from "../../../src/server/createServer.js";
import {
  closeEnhancedToolResources,
  resources,
} from "./enhancedToolsHarness.js";

afterEach(closeEnhancedToolResources);

it.each(["full", "compact"] as const)(
  "separates page omission from named traversal budgets through the advertised %s MCP contract",
  async (profile) => {
    const server = createServer(
      { kind: "fixed", analysis: valueTraceDiamond().port },
      { environment: { REA_MCP_OUTPUT_SCHEMA_PROFILE: profile } },
    );
    const client = new Client({ name: "value-trace-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    resources.push(client, server);
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { toolDefinition, ajv, outputSchema } =
      await advertisedMcpToolSchemas(client, "trace_native_values");
    if (profile === "full")
      for (const field of [
        "page_truncated",
        "traversal",
        "max_nodes",
        "max_edges",
      ])
        expect(JSON.stringify(outputSchema)).toContain(`"${field}"`);
    const trace = async (arguments_: Record<string, unknown>) => {
      const reply = await client.callTool(
        { name: "trace_native_values", arguments: arguments_ },
        { toolDefinition },
      );
      expect(reply.isError).not.toBe(true);
      expect(
        ajv.validate(outputSchema, reply.structuredContent),
        JSON.stringify(ajv.errors),
      ).toBe(true);
      return nativeValueTraceSchema.parse(
        parseEvidence(reply.structuredContent).normalized_result,
      );
    };
    const request = { procedure: "0x1000", max_depth: 1 };

    const complete = await trace(request);
    expect(complete).toMatchObject({
      total_nodes: 11,
      next_offset: null,
      page_truncated: false,
      traversal: { status: "complete" },
      truncated: false,
    });
    const pages = [];
    for (let offset: number | null = 0; offset !== null;) {
      const page = await trace({ ...request, offset, limit: 4 });
      expect(page).toMatchObject({
        page_truncated: true,
        traversal: { status: "complete" },
      });
      pages.push(page);
      offset = page.next_offset;
    }
    expect(pages.map(({ nodes }) => nodes.length)).toEqual([4, 4, 3]);
    expect(pages.flatMap(({ nodes }) => nodes.map(({ id }) => id))).toEqual(
      complete.nodes.map(({ id }) => id),
    );

    for (const { budgets, offset, reason, unknown } of [
      {
        budgets: { max_nodes: 9 },
        offset: 8,
        reason: "max_nodes",
        unknown: "Node budget reached",
      },
      {
        budgets: { max_edges: 2 },
        offset: 3,
        reason: "max_edges",
        unknown: "Edge budget reached",
      },
    ] as const) {
      const last = await trace({ ...request, ...budgets, offset, limit: 3 });
      expect(last).toMatchObject({
        nodes: [{}],
        next_offset: null,
        page_truncated: true,
        traversal: { status: "truncated", reasons: [reason] },
        truncated: true,
      });
      expect(last.unknowns.map(({ reason }) => reason)).toContain(unknown);
    }
    // Raising the named budget to the retained graph size recovers completeness.
    expect(
      await trace({ ...request, max_nodes: 11, max_edges: 9 }),
    ).toMatchObject({
      traversal: { status: "complete" },
      truncated: false,
      unknowns: [],
    });
  },
);
