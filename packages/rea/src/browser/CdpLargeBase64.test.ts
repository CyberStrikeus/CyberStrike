import { createHash } from "node:crypto";

import { expect, it, vi } from "vitest";

import { inspectWebPageInputSchema } from "../domain/browserObservation.js";
import { CdpCaptureEvents } from "./CdpCaptureEvents.js";
import { captureStorageFingerprints } from "./CdpCaptureStorageFingerprints.js";
import type { CdpConnection } from "./CdpConnection.js";

const ORIGIN = "https://example.test";
const CDP_ENDPOINT = "http://127.0.0.1:9222";
const BODY_BYTES = 4 * 1024 * 1024;

const captureCacheFingerprint = async (encodedBody: string) => {
  const send = vi.fn(async (method: string) => {
    if (method === "Network.getCookies") return { cookies: [] };
    if (method === "CacheStorage.requestEntries")
      return {
        cacheDataEntries: [
          {
            requestURL: `${ORIGIN}/cached`,
            requestMethod: "GET",
            requestHeaders: [],
          },
        ],
        returnCount: 1,
      };
    if (method === "CacheStorage.requestCachedResponse")
      return { response: { body: encodedBody } };
    throw new Error(`Unexpected CDP command ${method}`);
  });
  const input = inspectWebPageInputSchema.parse({
    cdp_endpoint: CDP_ENDPOINT,
    allowed_origins: [ORIGIN],
    target_id: "page",
  });
  return captureStorageFingerprints({
    context: {
      connection: { send } as unknown as CdpConnection,
      sessionId: "page-session",
      input,
    },
    origin: ORIGIN,
    cookieUrl: `${ORIGIN}/`,
    local: { items: [], complete: true },
    session: { items: [], complete: true },
    indexedDbNames: [],
    caches: [{ name: "cache", id: "cache-id" }],
    limitations: [],
  });
};

const createEvents = (includeJsonBodyShapes = true): CdpCaptureEvents =>
  new CdpCaptureEvents(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: CDP_ENDPOINT,
      allowed_origins: [ORIGIN],
      target_id: "page",
      include_json_body_shapes: includeJsonBodyShapes,
    }),
    new Set([ORIGIN]),
  );

const startJsonResponse = (
  events: CdpCaptureEvents,
  requestId: string,
  path: string,
): void => {
  events.ingest({
    method: "Network.requestWillBeSent",
    params: {
      requestId,
      request: { url: `${ORIGIN}${path}`, method: "GET" },
      initiator: { type: "other" },
      timestamp: 1,
    },
  });
  events.ingest({
    method: "Network.responseReceived",
    params: {
      requestId,
      response: {
        url: `${ORIGIN}${path}`,
        status: 200,
        mimeType: "application/json",
      },
    },
  });
};

it("fingerprints large cached bodies and retains CDP padding-bit acceptance", async () => {
  const body = Buffer.alloc(BODY_BYTES, 0x81);
  const large = await captureCacheFingerprint(body.toString("base64"));
  expect(large.complete).toBe(true);
  expect(large.items[0]?.value_sha256).toBe(
    createHash("sha256").update(body).digest("hex"),
  );

  const padBits = await captureCacheFingerprint("e31=");
  expect(padBits.items[0]?.value_sha256).toBe(
    createHash("sha256").update(Buffer.from("e31=", "base64")).digest("hex"),
  );

  const malformed = await captureCacheFingerprint("%%%not-base64%%%");
  expect(malformed.complete).toBe(false);
  expect(malformed.items[0]?.value_sha256).toBeNull();
});

it("decodes large JSON response bodies and preserves malformed and pad-bit behavior", () => {
  const events = createEvents();
  startJsonResponse(events, "large-json", "/large.json");
  const encoded = Buffer.from(
    JSON.stringify({ value: "x".repeat(BODY_BYTES) }),
  ).toString("base64");
  const candidate = events.responseBodyRequests()[0];
  expect(candidate).toBeDefined();
  events.ingestResponseBody(candidate!, {
    body: encoded,
    base64Encoded: true,
  });
  expect(events.network.get("large-json")?.body_shapes.response).toMatchObject({
    root_type: "object",
    node_count: 2,
  });

  startJsonResponse(events, "pad-bits", "/pad-bits.json");
  const padBits = events
    .responseBodyRequests()
    .find(({ requestId }) => requestId === "pad-bits");
  expect(padBits).toBeDefined();
  events.ingestResponseBody(padBits!, {
    body: "e31=",
    base64Encoded: true,
  });
  expect(events.network.get("pad-bits")?.body_shapes.response?.root_type).toBe(
    "object",
  );

  startJsonResponse(events, "malformed", "/malformed.json");
  const malformed = events
    .responseBodyRequests()
    .find(({ requestId }) => requestId === "malformed");
  expect(malformed).toBeDefined();
  events.ingestResponseBody(malformed!, {
    body: "%%%not-base64%%%",
    base64Encoded: true,
  });
  expect(events.network.get("malformed")?.body_shapes.response).toBeNull();
});

it("counts large binary WebSocket frames without accepting malformed base64", () => {
  const events = createEvents(false);
  const encoded = Buffer.alloc(BODY_BYTES, 0x81).toString("base64");
  events.ingest({
    method: "Network.webSocketCreated",
    params: { requestId: "socket", url: "wss://example.test/socket" },
  });
  events.ingest({
    method: "Network.webSocketFrameReceived",
    params: {
      requestId: "socket",
      response: { opcode: 2, payloadData: encoded },
    },
  });
  expect(
    events.webSocketConnectionsById.get("socket")?.events[0]?.payload_bytes,
  ).toBe(BODY_BYTES);

  events.ingest({
    method: "Network.webSocketFrameReceived",
    params: {
      requestId: "socket",
      response: { opcode: 2, payloadData: "%%%not-base64%%%" },
    },
  });
  expect(
    events.webSocketConnectionsById.get("socket")?.events[1]?.payload_bytes,
  ).toBeNull();
  expect(events.completeness.snapshot().excluded).toContainEqual({
    section: "websocket_frames",
    reason: "invalid_protocol_value",
    count: 1,
  });
});
