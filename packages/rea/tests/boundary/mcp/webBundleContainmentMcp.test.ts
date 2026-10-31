import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { ok as resultOk } from "../../../src/domain/result.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { observed } from "../../fixtures/analysisExecution.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";

const capturedSource = `
  fetch("/api/orders");
  navigator.modelContext.registerTool({
    name: "search_orders",
    description: "Search orders",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } }
    }
  });
`;

const resources: Array<{ close(): Promise<unknown> }> = [];
const browsers: Array<{ close(): Promise<unknown> }> = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
  await Promise.all(browsers.splice(0).map((browser) => browser.close()));
});

it("retains timeout Evidence and recovers on the same MCP server", async () => {
  const browser = await startFakeCdpBrowser({
    commandResult: ({ method }) =>
      method === "Debugger.getScriptSource"
        ? { scriptSource: capturedSource }
        : undefined,
  });
  browsers.push(browser);
  const session = createTestBinarySession(() => ({
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(resultOk(null)),
  }));
  const server = createServer(
    { kind: "session", session },
    {
      browserObservation: new CdpBrowserProvider(),
      availabilityPolicy: () => ({
        processCaptureEnabled: false,
        investigationInputRoots: 0,
      }),
    },
  );
  const client = new Client({
    name: "web-bundle-containment-test",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server, session);
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const interrupted = await client.callTool({
    name: "analyze_web_bundle",
    arguments: {
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 0,
      max_heap_mb: 128,
      analysis_timeout_ms: 1,
      total_analysis_timeout_ms: 1,
    },
  });
  const timeout = parseMcpToolError(interrupted).error;
  expect(timeout).toMatchObject({
    code: "provider_timeout",
    message: expect.stringContaining("total_analysis_timeout_ms"),
    remediation: {
      action: expect.stringContaining("total_analysis_timeout_ms"),
    },
    recovery: {
      kind: "inspect_timeout_state",
      operation: "analyze_web_bundle",
      timeout_ms: 1,
    },
  });
  const timeoutDetails = z
    .object({ partial_observation: z.unknown() })
    .passthrough()
    .parse(timeout.details);
  const partialReference = z
    .object({
      kind: z.literal("retained-evidence"),
      evidence_id: z.string(),
    })
    .parse(timeoutDetails.partial_observation);

  const retainedReply = await client.callTool({
    name: "get_evidence_bundle",
    arguments: {
      detail: "complete",
    },
  });
  expect(retainedReply.isError, JSON.stringify(retainedReply.content)).not.toBe(
    true,
  );
  const retainedBundle = toolContract("get_evidence_bundle").outputSchema.parse(
    retainedReply.structuredContent,
  ).result;
  if ("kind" in retainedBundle)
    throw new Error("Expected complete retained Evidence");
  const retained = parseEvidence(
    retainedBundle.records.find(
      (record) => record.evidence_id === partialReference.evidence_id,
    ),
  );
  expect(retained.evidence_id).toBe(partialReference.evidence_id);
  expect(retained.parameters).toMatchObject({
    max_heap_mb: 128,
    analysis_timeout_ms: 1,
    total_analysis_timeout_ms: 1,
  });
  expect(retained.normalized_result).toMatchObject({
    completeness: { status: "partial", parse_failures: 0 },
    unknowns: expect.arrayContaining([
      expect.objectContaining({ affected_script_keys: expect.any(Array) }),
    ]),
  });

  const recovered = await client.callTool({
    name: "analyze_web_bundle",
    arguments: {
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 0,
    },
  });
  expect(recovered.isError, JSON.stringify(recovered.content)).not.toBe(true);
  expect(recovered.structuredContent).toMatchObject({
    normalized_result: {
      observations: {
        endpoints: [expect.objectContaining({ value: "/api/orders" })],
        webmcp_declarations: [
          expect.objectContaining({
            name: "search_orders",
            trust: "page-declared-untrusted",
          }),
        ],
      },
    },
  });
  await client.ping();
  expect(browser.activeConnectionCount()).toBe(0);
}, 60_000);
