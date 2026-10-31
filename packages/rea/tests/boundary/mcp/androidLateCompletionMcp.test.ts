import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { silentLogger } from "../../../src/logger.js";
import { createServer } from "../../../src/server/createServer.js";
import { ToolResultDelivery } from "../../../src/server/ToolResultDelivery.js";
import { createJadxProtocolFixture } from "../../fixtures/android/jadx.js";
import {
  createDeferred,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

it("retains completed Android Evidence through the MCP cancellation delivery path", async () => {
  const fixture = await createJadxProtocolFixture();
  const controller = new AbortController();
  let cancelOnCompletion = false;
  const session = createTestBinarySession(() => {
    throw new Error("Unexpected native admission");
  });
  const server = createServer(
    { kind: "session", session },
    {
      logger: silentLogger,
      androidAnalysis: {
        inspectAvailability: fixture.provider.inspectAvailability.bind(
          fixture.provider,
        ),
        close: fixture.provider.close.bind(fixture.provider),
        execute: async (target, request, options) => {
          const result = await fixture.provider.execute(
            target,
            request,
            options,
          );
          if (result.ok && cancelOnCompletion) {
            const signal = options?.signal;
            if (signal === undefined)
              throw new Error("MCP did not forward cancellation");
            controller.abort();
            if (!signal.aborted)
              await new Promise<void>((resolve) =>
                signal.addEventListener("abort", () => resolve(), {
                  once: true,
                }),
              );
          }
          return result;
        },
      },
    },
  );
  const client = new Client({ name: "android-late-completion", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  onTestFinished(async () => {
    controller.abort();
    vi.restoreAllMocks();
    await client.close();
    await server.close();
    await session.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const request = {
    name: "inspect_android_package",
    arguments: { path: fixture.apk },
  };
  const controlReply = await client.callTool(request);
  expect(controlReply.isError).not.toBe(true);
  const control = parseEvidence(controlReply.structuredContent);
  const delivered = createDeferred<CallToolResult>();
  const deliver = server.delivery.toPartialErrorToolResult.bind(
    server.delivery,
  );
  vi.spyOn(
    ToolResultDelivery.prototype,
    "toPartialErrorToolResult",
  ).mockImplementation((...args) => {
    const result = deliver(...args);
    delivered.resolve(result);
    return result;
  });
  cancelOnCompletion = true;
  await expect(
    client.callTool(request, { signal: controller.signal }),
  ).rejects.toThrow();
  // The SDK suppresses a cancelled reply; observe the server's canonical
  // recording/delivery boundary rather than treating client rejection as proof.
  const { error } = parseMcpToolError(await delivered.promise);
  expect(error.code).toBe("cancelled");
  const reference = z
    .object({
      partial_observation: z.object({
        kind: z.literal("retained-evidence"),
        evidence_id: z.string(),
      }),
    })
    .parse(error.details).partial_observation;
  expect(session.evidenceById(reference.evidence_id)).toMatchObject({
    operation: control.operation,
    normalized_result: control.normalized_result,
    subject: control.subject,
    parameters: control.parameters,
    confidence: control.confidence,
  });
  await expect(client.ping()).resolves.toEqual({});
});
