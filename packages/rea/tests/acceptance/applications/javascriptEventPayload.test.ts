import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { javaScriptSemanticTraceResultSchema } from "../../../src/domain/javascript/javascriptSemanticTraceSchemas.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "retains large event names and emitter-scoped listener ownership through CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-event-payload-");
    const name = "payload/ğ".repeat(80_000);
    const lookalike = `value-sha256:${createHash("sha256").update(JSON.stringify(name)).digest("hex")}`;
    const source = [
      'import {EventEmitter} from "node:events";',
      "const bus = new EventEmitter(); const other = new EventEmitter(); const handler = () => {};",
      `bus.on(${JSON.stringify(name)}, handler);`,
      `bus.emit(${JSON.stringify(name)});`,
      `bus.off(${JSON.stringify(name)}, handler);`,
      `bus.on(${JSON.stringify(lookalike)}, handler); bus.emit(${JSON.stringify(lookalike)});`,
      'bus.on("ok", handler); bus.emit("ok"); other.on("ok", handler); other.emit("ok");',
      "bus.on(getEventName(), handler);",
    ].join("\n");
    await writeFile(join(root, "main.js"), source);
    const cliResponse = await cli.run({
      arguments: [
        "analyze-javascript-application",
        root,
        "--artifact-format",
        "directory",
        "--json",
      ],
      timeoutMs: 60_000,
    });
    expect(cliResponse.exitCode).toBe(0);
    const cliEvidence = toolContract(
      "analyze_javascript_application",
    ).outputSchema.parse(cliResponse.json);
    const client = new Client({ name: "event-payload-e2e", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("scripts/rea.mjs"), "mcp"],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "" },
      stderr: "pipe",
    });
    transport.stderr?.on("data", () => undefined);
    try {
      await client.connect(transport);
      const response = await client.callTool({
        name: "analyze_javascript_application",
        arguments: { input_path: root, format: "directory" },
      });
      expect(response.isError).not.toBe(true);
      const evidence = toolContract(
        "analyze_javascript_application",
      ).outputSchema.parse(response.structuredContent);
      expect(evidence.evidence_id).toBe(cliEvidence.evidence_id);
      const text = response.content.find((item) => item.type === "text");
      if (text?.type !== "text") throw new Error("Missing MCP text result");
      expect(
        toolContract("analyze_javascript_application").outputSchema.parse(
          JSON.parse(text.text),
        ).evidence_id,
      ).toBe(evidence.evidence_id);
      const graph = javascriptApplicationAnalysisResultSchema.parse(
        evidence.normalized_result,
      ).semantic_graph;
      const events = graph.nodes.filter((node) => node.kind === "event");
      const selected = events.filter(
        (node) => node.properties.event_name === name,
      );
      expect(selected).toHaveLength(1);
      const event = selected[0];
      if (event === undefined) throw new Error("Complete event was lost");
      const listeners = graph.nodes.filter(
        (node) =>
          node.kind === "listener" && node.properties.event_name === name,
      );
      expect(new Set(listeners.map((node) => node.properties.method))).toEqual(
        new Set(["on", "off"]),
      );
      const listenerIds = new Set(listeners.map((node) => node.node_id));
      expect(
        graph.relations
          .filter(
            (relation) =>
              relation.source_node_id === event.node_id &&
              listenerIds.has(relation.target_node_id),
          )
          .map((relation) => relation.relation),
      ).toEqual(
        expect.arrayContaining(["registers-listener", "removes-listener"]),
      );
      const lookalikeEvent = events.find(
        (node) => node.properties.event_name === lookalike,
      );
      expect(lookalikeEvent).toBeDefined();
      expect(lookalikeEvent?.node_id).not.toBe(event.node_id);
      const shortEvents = events.filter(
        (node) => node.properties.event_name === "ok",
      );
      expect(shortEvents).toHaveLength(2);
      expect(
        new Set(shortEvents.map((node) => node.properties.emitter_key)).size,
      ).toBe(2);
      expect(
        shortEvents.every(
          (node) =>
            node.label === "ok" && node.identity.role_key.endsWith("\0ok"),
        ),
      ).toBe(true);
      const dynamic = events.find(
        (node) => node.properties.event_name === null,
      );
      expect(dynamic?.label).toBeNull();
      expect(
        graph.unknowns.some(
          (unknown) =>
            unknown.node_id === dynamic?.node_id && unknown.family === "event",
        ),
      ).toBe(true);
      const traceResponse = await client.callTool({
        name: "trace_javascript_semantics",
        arguments: {
          application: {
            kind: "retained-evidence",
            evidence_id: evidence.evidence_id,
          },
          query: {
            seed: { kind: "event", name },
            direction: "forward-influence",
          },
        },
      });
      expect(traceResponse.isError).not.toBe(true);
      const traceEvidence = toolContract(
        "trace_javascript_semantics",
      ).outputSchema.parse(traceResponse.structuredContent);
      const trace = javaScriptSemanticTraceResultSchema.parse(
        traceEvidence.normalized_result,
      );
      expect(new Set(trace.seed_node_ids)).toEqual(
        new Set([event.node_id, ...listenerIds]),
      );
      expect(
        trace.nodes
          .filter((node) => listenerIds.has(node.node_id))
          .map((node) => node.properties.event_name),
      ).toEqual(listeners.map(() => name));
      await client.ping();
    } finally {
      await client.close();
      await transport.close();
    }
  },
  120_000,
);
