import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import pino from "pino";
import { expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";
import { createEvidence } from "../../src/domain/evidence.js";
import { createServer } from "../../src/server/createServer.js";
import {
  createDeferred,
  createTestBinarySession,
} from "../fixtures/binarySession.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import type { ProgressUpdate } from "../../src/application/ProgressReporter.js";

const progressBoundary = vi.hoisted(() => ({
  observe: undefined as ((update: ProgressUpdate) => Promise<void>) | undefined,
}));

// Observe each application boundary deterministically; transport rate limiting
// is covered by reporter tests and must not select the cancellation site.
vi.mock("../../src/application/ProgressReporter.js", async (original) => {
  const actual =
    await original<
      typeof import("../../src/application/ProgressReporter.js")
    >();
  return {
    ...actual,
    createProgressReporter: (
      ...args: Parameters<typeof actual.createProgressReporter>
    ) =>
      actual.createProgressReporter(
        async (update) => {
          await args[0](update);
          await progressBoundary.observe?.(update);
        },
        {
          ...args[1],
          minimumIntervalMs: 0,
        },
      ),
  };
});

const createCancellationBoundary = (phase: string, message: string) => {
  const released = createDeferred<void>();
  let heldAtBoundary = false;
  let acknowledgedCancellation = false;
  let acknowledgementError: unknown;
  const release = () => released.resolve(undefined);
  return {
    release,
    async observe(update: ProgressUpdate) {
      if (update.phase === phase && update.message.includes(message)) {
        heldAtBoundary = true;
        await released.promise;
      }
    },
    acknowledge(client: Client) {
      // Ordered in-memory messages make the ping acknowledge the cancellation
      // before the producer crosses the held boundary.
      void client.ping().then(
        () => {
          acknowledgedCancellation = true;
          release();
        },
        (error: unknown) => {
          acknowledgementError = error;
          release();
        },
      );
    },
    expectAcknowledged() {
      expect(heldAtBoundary).toBe(true);
      expect(acknowledgedCancellation).toBe(true);
      expect(acknowledgementError).toBeUndefined();
    },
  };
};

it.each([
  { phase: "parse_javascript_source", message: "second.js", parsedFiles: 1 },
  {
    phase: "analyze_javascript_application",
    message: "Application graph and Electron boundaries reconstructed",
    parsedFiles: 2,
  },
])(
  "retains completed facts and prior Evidence after SDK cancellation during $phase, then accepts subsequent work",
  async ({ phase, message, parsedFiles }) => {
    const boundary = createCancellationBoundary(phase, message);
    progressBoundary.observe = boundary.observe;
    const root = await createTestTempDirectory("rea-mcp-js-cancellation-");
    await writeFile(join(root, "main.js"), "export const observed = 1;\n");
    await writeFile(join(root, "second.js"), "export const pending = 2;\n");
    const session = createTestBinarySession(() => {
      throw new Error(
        "Static JavaScript analysis must not start a binary provider",
      );
    });
    const prior = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "prior_observation",
        parameters: {},
        result: { preserved: true },
      },
    );
    expect(session.recordEvidence(prior).ok).toBe(true);
    const completed = createDeferred<string>();
    const completionSchema = z.object({
      tool: z.string(),
      status: z.string(),
      msg: z.string(),
    });
    const logger = pino(
      { level: "info" },
      {
        write(line) {
          const value: unknown = JSON.parse(line);
          const parsed = completionSchema.safeParse(value);
          if (
            parsed.success &&
            parsed.data.tool === "analyze_javascript_application" &&
            parsed.data.msg === "MCP tool execution completed"
          )
            completed.resolve(parsed.data.status);
        },
      },
    );
    const server = createServer({ kind: "session", session }, { logger });
    const client = new Client({
      name: "javascript-cancellation",
      version: "1",
    });
    onTestFinished(async () => {
      boundary.release();
      progressBoundary.observe = undefined;
      await client.close();
      await server.close();
      await session.close();
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const controller = new AbortController();
    let requested = false;
    const call = client.callTool(
      {
        name: "analyze_javascript_application",
        arguments: {
          input_path: root,
          format: "directory",
        },
      },
      {
        signal: controller.signal,
        onprogress(update) {
          if (
            !update.message?.startsWith(`${phase}:`) ||
            !update.message.includes(message)
          )
            return;
          requested = true;
          controller.abort(new Error("SDK cancellation verification"));
          boundary.acknowledge(client);
        },
      },
    );
    await expect(call).rejects.toThrow("SDK cancellation verification");
    expect(requested).toBe(true);
    // A rejected client promise alone does not prove that the server stopped.
    expect(await completed.promise).toBe("error");
    boundary.expectAcknowledged();
    await client.ping();
    const bundle = await client.callTool({
      name: "get_evidence_bundle",
      arguments: {},
    });
    const records = z
      .object({
        result: z.object({
          records: z.array(z.object({ evidence_id: z.string() })),
        }),
      })
      .parse(bundle.structuredContent).result.records;
    expect(records).toContainEqual({ evidence_id: prior.evidence_id });
    const partial = records.find(
      ({ evidence_id }) => evidence_id !== prior.evidence_id,
    );
    if (partial === undefined)
      throw new Error(
        "Cancelled analysis discarded its completed source facts",
      );
    expect(
      z
        .object({
          statistics: z.object({
            parsed_javascript_files: z.number(),
            parse_failures: z.number(),
          }),
        })
        .parse(session.evidenceById(partial.evidence_id)?.normalized_result)
        .statistics,
    ).toEqual({ parsed_javascript_files: parsedFiles, parse_failures: 0 });
    const view = await client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source: { kind: "retained-evidence", evidence_id: partial.evidence_id },
        view: { kind: "summary" },
      },
    });
    expect(view.isError, JSON.stringify(view)).not.toBe(true);
    const next = await client.callTool({
      name: "analyze_javascript_application",
      arguments: {
        input_path: root,
        format: "directory",
      },
    });
    expect(next.isError, JSON.stringify(next)).not.toBe(true);
    await client.ping();
  },
);
