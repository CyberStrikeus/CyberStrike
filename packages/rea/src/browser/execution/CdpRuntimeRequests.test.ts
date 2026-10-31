import { expect, it } from "vitest";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";
import { WEB_RUNTIME_LIMITS } from "../../domain/webRuntime.js";
import { CdpRuntimeRequests } from "./CdpRuntimeRequests.js";

const origin = "https://example.test";
const sources = {
  session: {
    operation: "observe_web_execution" as const,
    allowedOrigins: new Set([origin]),
    target: { frame_id: "main" },
  },
  sourceUrl: (_scriptId: string, url: string) => url,
  location: (): never => {
    throw new Error("This parser-only initiator has no callsites");
  },
};
const event = (
  extraRequest: Record<string, string>,
  extraInitiator: Record<string, string> = {},
) => ({
  method: "Network.requestWillBeSent",
  params: {
    requestId: "request",
    frameId: "main",
    timestamp: 1,
    request: { url: `${origin}/resource`, method: "POST", ...extraRequest },
    initiator: { type: "parser", ...extraInitiator },
  },
});

it("budgets retained request facts independently of discarded POST bodies", () => {
  const requests = new CdpRuntimeRequests(sources);
  requests.ingest(
    event({ postData: "p".repeat(WEB_RUNTIME_LIMITS.retainedEventBytes + 1) }),
  );
  const retained = requests.result();
  expect(retained).toHaveLength(1);
  expect(retained[0]).toMatchObject({
    method: "POST",
    reported_initiator: { type: "parser" },
  });
  expect(JSON.stringify(retained)).not.toContain("postData");
});

it("preserves a typed resource refusal for oversized retained initiator facts", () => {
  const requests = new CdpRuntimeRequests(sources);
  requests.ingest(
    event(
      {},
      { retained: "r".repeat(WEB_RUNTIME_LIMITS.retainedEventBytes + 1) },
    ),
  );
  try {
    requests.result();
    expect.fail(
      "Expected the retained initiator allowance to refuse the result",
    );
  } catch (cause) {
    expect(cause).toBeInstanceOf(AnalysisResourceConstraintError);
    if (!(cause instanceof AnalysisResourceConstraintError)) throw cause;
    expect(projectAnalysisError(cause)).toMatchObject({
      code: "resource_constraint",
      details: { resource: "capacity" },
    });
  }
});

it("retains separate occurrences of a reused request identity and raw initiator facts", () => {
  const requests = new CdpRuntimeRequests(sources);
  for (const timestamp of [0, 1.25]) {
    const request = event({ url: `${origin}/resource-${timestamp}` });
    requests.ingest({
      ...request,
      params: {
        ...request.params,
        timestamp,
        initiator: {
          type: "parser",
          vendor_extension: { occurrence: timestamp, labels: ["observed"] },
        },
      },
    });
  }
  expect(requests.result()).toEqual(
    [0, 1.25].map((timestamp) =>
      expect.objectContaining({
        request_id: "request",
        url: `${origin}/resource-${timestamp}`,
        timestamp_seconds: timestamp,
        reported_initiator: {
          type: "parser",
          vendor_extension: { occurrence: timestamp, labels: ["observed"] },
        },
        causal_attribution: "unknown",
      }),
    ),
  );
});
