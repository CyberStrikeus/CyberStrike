import { expect, it } from "vitest";

import { inspectWebPageInputSchema } from "../domain/browserObservation.js";
import { webPageInspectionSchema } from "../domain/browserObservationSchemas.js";
import { CdpCaptureEvents } from "./CdpCaptureEvents.js";

const origin = "https://example.test";

const createEvents = (): CdpCaptureEvents =>
  new CdpCaptureEvents(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: "http://127.0.0.1:9222",
      allowed_origins: [origin],
      target_id: "page",
      include_websocket_shapes: true,
    }),
    new Set([origin]),
  );

const captureFrame = (
  opcode: unknown,
  payloadData: unknown,
  includeOpcode = true,
  includePayload = true,
) => {
  const events = createEvents();
  events.ingest({
    method: "Network.webSocketCreated",
    params: { requestId: "socket", url: "wss://example.test/live" },
  });
  events.ingest({
    method: "Network.webSocketFrameReceived",
    params: {
      requestId: "socket",
      response: {
        ...(includeOpcode ? { opcode } : {}),
        ...(includePayload ? { payloadData } : {}),
      },
    },
  });
  return {
    events,
    frame: events.webSocketConnectionsById.get("socket")?.events[0],
  };
};

it.each([
  {
    label: "missing",
    opcode: undefined,
    payload: "",
    hasOpcode: false,
    hasPayload: true,
  },
  {
    label: "wrong type",
    opcode: "1",
    payload: "text",
    hasOpcode: true,
    hasPayload: true,
  },
  {
    label: "explicit null",
    opcode: null,
    payload: "",
    hasOpcode: true,
    hasPayload: true,
  },
  {
    label: "negative",
    opcode: -1,
    payload: "",
    hasOpcode: true,
    hasPayload: true,
  },
  {
    label: "fractional",
    opcode: 1.5,
    payload: "text",
    hasOpcode: true,
    hasPayload: true,
  },
  {
    label: "above opcode width",
    opcode: 16,
    payload: "",
    hasOpcode: true,
    hasPayload: true,
  },
  {
    label: "non-finite",
    opcode: Number.NaN,
    payload: "",
    hasOpcode: true,
    hasPayload: true,
  },
] as const)(
  "keeps $label WebSocket opcode unknown",
  ({ opcode, payload, hasOpcode, hasPayload }) => {
    const { events, frame } = captureFrame(
      opcode,
      payload,
      hasOpcode,
      hasPayload,
    );
    expect(frame).toEqual({
      direction: "received",
      opcode: null,
      payload_bytes: null,
      payload_shape: null,
    });
    expect(events.completeness.snapshot().excluded).toContainEqual({
      section: "websocket_frames",
      reason: "invalid_protocol_value",
      count: 1,
    });
    expect(
      webPageInspectionSchema.shape.network.shape.websocket_connections.element.safeParse(
        {
          request_id: "socket",
          url: "wss://example.test/live",
          events: [frame],
        },
      ).success,
    ).toBe(true);
  },
);

it.each([
  { label: "continuation", opcode: 0, payload: "", bytes: 0, format: "binary" },
  { label: "empty text", opcode: 1, payload: "", bytes: 0, format: "text" },
  {
    label: "reserved four-bit opcode",
    opcode: 15,
    payload: "",
    bytes: 0,
    format: "binary",
  },
] as const)(
  "preserves observed $label data",
  ({ opcode, payload, bytes, format }) => {
    const { events, frame } = captureFrame(opcode, payload);
    expect(frame).toEqual({
      direction: "received",
      opcode,
      payload_bytes: bytes,
      payload_shape: { format, json_shape: null },
    });
    expect(events.completeness.snapshot().excluded).not.toContainEqual(
      expect.objectContaining({
        section: "websocket_frames",
        reason: "invalid_protocol_value",
      }),
    );
  },
);

it.each([
  {
    label: "missing payload",
    opcode: 1,
    payload: undefined,
    hasPayload: false,
  },
  { label: "wrong-type payload", opcode: 1, payload: 42, hasPayload: true },
] as const)(
  "does not fabricate an empty payload for $label",
  ({ opcode, payload, hasPayload }) => {
    const { events, frame } = captureFrame(opcode, payload, true, hasPayload);
    expect(frame).toEqual({
      direction: "received",
      opcode,
      payload_bytes: null,
      payload_shape: null,
    });
    expect(events.completeness.snapshot().excluded).toContainEqual({
      section: "websocket_frames",
      reason: "invalid_protocol_value",
      count: 1,
    });
  },
);
