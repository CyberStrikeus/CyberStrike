import { expect, it } from "vitest";

import { inspectWebPageInputSchema } from "../domain/browserObservation.js";
import { WEB_RUNTIME_LIMITS } from "../domain/webRuntime.js";
import { CdpCaptureEvents } from "./CdpCaptureEvents.js";

const origin = "http://127.0.0.1:43127";
const deep = (depth: number) => '{"a":'.repeat(depth) + "0" + "}".repeat(depth);
const createEvents = (selected = true) =>
  new CdpCaptureEvents(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: origin,
      allowed_origins: [origin],
      target_id: "page",
      include_console_text: true,
      include_json_body_shapes: selected,
      include_websocket_shapes: selected,
    }),
    new Set([origin]),
  );
const request = (
  events: CdpCaptureEvents,
  id: string,
  body: string,
  redirect = false,
) => {
  events.ingest({
    method: "Network.requestWillBeSent",
    params: {
      requestId: id,
      timestamp: redirect ? 2 : 1,
      initiator: { type: "other" },
      request: {
        url: `${origin}/${redirect ? "next" : "first"}`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        postData: body,
      },
      ...(redirect
        ? {
            redirectResponse: {
              url: `${origin}/first`,
              status: 302,
              encodedDataLength: 0,
            },
          }
        : {}),
    },
  });
};
const response = (events: CdpCaptureEvents, id: string, body: string) => {
  events.ingest({
    method: "Network.responseReceived",
    params: {
      requestId: id,
      response: {
        url: `${origin}/first`,
        status: 200,
        mimeType: "application/json",
      },
    },
  });
  const candidate = events
    .responseBodyRequests()
    .find(({ requestId }) => requestId === id);
  if (candidate === undefined)
    throw new Error("Expected selected response body");
  events.ingestResponseBody(candidate, { body, base64Encoded: false });
  return candidate;
};
const openSocket = (events: CdpCaptureEvents) =>
  events.ingest({
    method: "Network.webSocketCreated",
    params: { requestId: "socket", url: `ws://${origin.slice(7)}/live` },
  });
const frame = (events: CdpCaptureEvents, payloadData: string) =>
  events.ingest({
    method: "Network.webSocketFrameReceived",
    params: { requestId: "socket", response: { opcode: 1, payloadData } },
  });

it.each([
  ["\tAPPLICATION/JSON ; charset=utf-8\t", true],
  ["application/problem+json", true],
  ["model/example+json", true],
  ["+json", false],
  ["application /problem+json", false],
  ["application/problem\n+json", false],
  ["application/\u212a+json", false],
  ["\napplication/json", false],
  ["text/plain", false],
])(
  "admits shapes only from valid media types while preserving %j",
  (mediaType, selected) => {
    const events = createEvents();
    events.ingest({
      method: "Network.requestWillBeSent",
      params: {
        requestId: "typed",
        timestamp: 1,
        initiator: { type: "other" },
        request: {
          url: `${origin}/typed`,
          method: "POST",
          headers: { "Content-Type": mediaType },
          postData: '{"count":1}',
        },
      },
    });
    expect(events.network.get("typed")?.body_shapes.request !== null).toBe(
      selected,
    );
    events.ingest({
      method: "Network.responseReceived",
      params: {
        requestId: "typed",
        response: {
          url: `${origin}/typed`,
          status: 200,
          mimeType: mediaType,
        },
      },
    });
    expect(events.responseBodyRequests().length).toBe(selected ? 1 : 0);
    expect(events.network.get("typed")?.mime_type).toBe(mediaType);
  },
);

it("distinguishes valid over-budget websocket JSON from non-JSON text", () => {
  const events = createEvents();
  openSocket(events);
  frame(events, deep(760));
  frame(events, "ordinary non-JSON text");
  expect(events.webSocketConnectionsById.get("socket")?.events).toMatchObject([
    { payload_shape: { format: "text", json_shape: null } },
  ]);
  const coverage = events.completeness.snapshot();
  expect(coverage.dropped_events.websocket_frames).toBe(1);
  expect(coverage.excluded).toContainEqual({
    section: "websocket_shapes",
    reason: "resource_budget_exhausted",
    count: 1,
  });
});

it("retains the peer body facts when a selected request or response shape exceeds the allowance", () => {
  const events = createEvents();
  request(events, "request-large", deep(760));
  response(events, "request-large", '{"response":true}');
  expect(events.network.get("request-large")?.body_shapes).toMatchObject({
    status: "partial",
    request: null,
    response: { root_type: "object" },
  });
  request(events, "response-large", '{"request":true}');
  response(events, "response-large", deep(760));
  expect(events.network.get("response-large")?.body_shapes).toMatchObject({
    status: "partial",
    request: { root_type: "object" },
    response: null,
  });
  const coverage = events.completeness.snapshot();
  expect(coverage.truncated_sections).toContain("json_body_shapes");
  expect(coverage.excluded).toContainEqual({
    section: "json_body_shapes",
    reason: "resource_budget_exhausted",
    count: 2,
  });
});

it("replaces response receipts without charging the same retained result a hundred times", () => {
  const events = createEvents();
  request(events, "repeat", '{"request":true}');
  const candidate = response(events, "repeat", deep(100));
  const retained = events.retainedEventBytes;
  for (let index = 0; index < 100; index++)
    events.ingestResponseBody(candidate, {
      body: deep(100),
      base64Encoded: false,
    });
  expect(events.retainedEventBytes).toBe(retained);
  response(events, "repeat", '{"smaller":true}');
  const shapes = events.network.get("repeat")?.body_shapes;
  if (shapes === undefined) throw new Error("Expected retained request");
  expect(shapes.status).toBe("included");
  expect(events.retainedEventBytes).toBe(
    Buffer.byteLength(JSON.stringify(shapes.request)) +
      Buffer.byteLength(JSON.stringify(shapes.response)),
  );
  expect(events.completeness.snapshot().truncated_sections).not.toContain(
    "json_body_shapes",
  );
});

it("refunds replaced and removed request records while ignoring stale response occurrences", () => {
  const events = createEvents();
  request(events, "redirect", deep(100));
  const stale = response(events, "redirect", deep(100));
  request(events, "redirect", '{"next":true}', true);
  const retained = events.retainedEventBytes;
  events.ingestResponseBody(stale, { body: deep(760), base64Encoded: false });
  expect(events.retainedEventBytes).toBe(retained);
  expect(events.network.get("redirect")?.body_shapes.response).toBeNull();
  events.ingest({
    method: "Network.responseReceived",
    params: {
      requestId: "redirect",
      response: { url: "https://excluded.invalid/next", status: 200 },
    },
  });
  expect(events.network.has("redirect")).toBe(false);
  expect(events.retainedEventBytes).toBe(0);
  request(events, "fresh", deep(600));
  expect(events.network.get("fresh")?.body_shapes.status).toBe("included");
  events.beginAuthorizedFrame("frame");
  expect(events.retainedEventBytes).toBe(0);
  request(events, "after-reset", deep(600));
  expect(events.network.get("after-reset")?.body_shapes.status).toBe(
    "included",
  );
});

it("shares the remaining allowance across console entries, body shapes and websocket shapes", () => {
  const events = createEvents();
  events.ingest({
    method: "Runtime.consoleAPICalled",
    params: {
      type: "log",
      timestamp: 1,
      args: [{ type: "string", value: "x".repeat(1024 * 1024) }],
      stackTrace: {
        callFrames: [
          { url: `${origin}/app.js`, lineNumber: 0, columnNumber: 0 },
        ],
      },
    },
  });
  request(events, "body", deep(600));
  expect(events.console).toHaveLength(1);
  expect(events.network.get("body")?.body_shapes.status).toBe("included");
  openSocket(events);
  frame(events, deep(400));
  expect(events.webSocketConnectionsById.get("socket")?.events).toHaveLength(0);
  expect(events.completeness.snapshot().dropped_events.websocket_frames).toBe(
    1,
  );
  expect(events.retainedEventBytes).toBeLessThanOrEqual(
    WEB_RUNTIME_LIMITS.retainedEventBytes,
  );
  const empty = createEvents();
  openSocket(empty);
  frame(empty, deep(400));
  expect(empty.webSocketConnectionsById.get("socket")?.events).toHaveLength(1);
});

it("does not infer unselected body or websocket shapes", () => {
  const events = createEvents(false);
  request(events, "unselected", deep(760));
  expect(events.network.get("unselected")?.body_shapes).toEqual({
    status: "not_approved",
    request: null,
    response: null,
  });
  expect(events.responseBodyRequests()).toEqual([]);
  openSocket(events);
  frame(events, deep(760));
  expect(events.webSocketConnectionsById.get("socket")?.events).toMatchObject([
    { payload_shape: null },
  ]);
  expect(events.completeness.snapshot().dropped_events.total).toBe(0);
});
