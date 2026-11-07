import { createHash } from "node:crypto";

import type { CallToolResult } from "@modelcontextprotocol/server";
import { expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { webBundleAcquisitionPartialObservationSchema } from "../../../src/domain/webBundleAnalysis.js";
import { ToolResultDelivery } from "../../../src/server/ToolResultDelivery.js";
import { startSourceMapCancellationBrowser } from "../../fixtures/browserSourceMapCancellation.js";
import { createDeferred } from "../../fixtures/binarySession.js";
import {
  createApplicationMcpHarness,
  type ApplicationMcpHarness,
} from "../../fixtures/applicationMcpHarness.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

it("retains completed source maps through MCP cancellation for later Evidence retrieval", async () => {
  const {
    browser,
    mapText,
    completedMapPath,
    secondRequest,
    releasePendingResponse,
    close,
  } = await startSourceMapCancellationBrowser();
  const controller = new AbortController();
  let harness: ApplicationMcpHarness | undefined;
  onTestFinished(async () => {
    controller.abort();
    vi.restoreAllMocks();
    releasePendingResponse();
    try {
      await harness?.close();
    } finally {
      await close();
    }
  });
  const connected = await createApplicationMcpHarness({
    serverOptions: { browserObservation: new CdpBrowserProvider() },
  });
  harness = connected;

  const delivered = createDeferred<CallToolResult>();
  const original = ToolResultDelivery.prototype.toPartialErrorToolResult;
  vi.spyOn(
    ToolResultDelivery.prototype,
    "toPartialErrorToolResult",
  ).mockImplementation(function (this: ToolResultDelivery, ...args) {
    const result = original.apply(this, args);
    delivered.resolve(result);
    return result;
  });
  const call = connected.client.callTool(
    {
      name: "analyze_web_bundle",
      arguments: {
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
        fetch_source_maps: true,
      },
    },
    { signal: controller.signal },
  );
  const pendingMapPath = await Promise.race([
    secondRequest,
    call.then(
      () => {
        throw new Error("MCP completed before the second map request");
      },
      (cause: unknown) => {
        throw cause;
      },
    ),
  ]);
  const retainedMapPath = await completedMapPath;
  expect([retainedMapPath, pendingMapPath].sort()).toEqual([
    "/first.js.map",
    "/second.js.map",
  ]);
  controller.abort(new Error("Caller cancelled after the first map"));
  await expect(call).rejects.toThrow();

  // SDK cancellation suppresses the reply. This is the server's recording boundary.
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
  const reply = await connected.client.callTool({
    name: "get_evidence_bundle",
    arguments: { detail: "complete" },
  });
  expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true);
  const bundle = toolContract("get_evidence_bundle").outputSchema.parse(
    reply.structuredContent,
  ).result;
  if ("kind" in bundle) throw new Error("Expected complete Evidence bundle");
  const evidence = parseEvidence(
    bundle.records.find(
      (record) => record.evidence_id === reference.evidence_id,
    ),
  );
  expect(evidence.operation).toBe("analyze_web_bundle");
  const acquisition = webBundleAcquisitionPartialObservationSchema.parse(
    evidence.normalized_result,
  );
  expect(acquisition.analysis_status).toBe("not_performed");
  expect(acquisition.source_maps).toMatchObject({
    status: "partial",
    requested: 2,
    processed: 1,
    excluded: [
      { section: "source_maps", reason: "disallowed_origin", count: 1 },
    ],
    items: [
      {
        status: "included",
        declared_url: `${browser.allowedOrigin}${retainedMapPath}`,
        artifact: {
          text: mapText,
          sha256: createHash("sha256").update(mapText).digest("hex"),
        },
      },
    ],
  });
  expect(acquisition.source_maps.items).toHaveLength(1);
  expect(acquisition.inspection.completeness.excluded).toContainEqual({
    section: "source_maps",
    reason: "disallowed_origin",
    count: 1,
  });
  expect(JSON.stringify(evidence)).not.toContain("outside.example.test");
  await expect(connected.client.ping()).resolves.toEqual({});
  expect(browser.activeConnectionCount()).toBe(0);
  expect(
    browser.httpRequests
      .filter(({ url }) => url.endsWith(".map"))
      .map(({ url }) => url),
  ).toEqual([retainedMapPath, pendingMapPath]);
});
