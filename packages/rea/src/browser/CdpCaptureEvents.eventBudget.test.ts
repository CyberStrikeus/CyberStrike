import { expect, it } from "vitest";

import { inspectWebPageInputSchema } from "../domain/browserObservation.js";
import { WEB_RUNTIME_LIMITS } from "../domain/webRuntime.js";
import { CdpCaptureEvents } from "./CdpCaptureEvents.js";

const origin = "http://127.0.0.1:43127";

const createEvents = (extra: Record<string, unknown> = {}): CdpCaptureEvents =>
  new CdpCaptureEvents(
    inspectWebPageInputSchema.parse({
      cdp_endpoint: origin,
      allowed_origins: [origin],
      target_id: "page",
      include_console_text: true,
      include_websocket_shapes: true,
      ...extra,
    }),
    new Set([origin]),
  );

it("admits console events until the shared retained-event budget and reports the dropped count", () => {
  const events = createEvents();
  const text = "x".repeat(1024 * 1024);
  const total =
    Math.ceil(WEB_RUNTIME_LIMITS.retainedEventBytes / text.length) + 2;
  for (let index = 0; index < total; index += 1)
    events.ingest({
      method: "Runtime.consoleAPICalled",
      params: {
        type: "log",
        timestamp: index,
        args: [{ type: "string", value: text }],
        stackTrace: {
          callFrames: [
            { url: `${origin}/app.js`, lineNumber: 0, columnNumber: 0 },
          ],
        },
      },
    });
  expect(events.console.length).toBeLessThan(total);
  expect(events.console.length).toBeGreaterThan(0);
  const snapshot = events.completeness.snapshot();
  const dropped = total - events.console.length;
  expect(snapshot.dropped_events.console_events).toBe(dropped);
  expect(snapshot.dropped_events.total).toBe(dropped);
});

it("keeps a small console inventory admitted under the budget untouched", () => {
  const events = createEvents();
  for (let index = 0; index < 16; index += 1)
    events.ingest({
      method: "Runtime.consoleAPICalled",
      params: {
        type: "log",
        timestamp: index,
        args: [{ type: "string", value: `entry ${String(index)}` }],
        stackTrace: {
          callFrames: [
            { url: `${origin}/app.js`, lineNumber: 0, columnNumber: 0 },
          ],
        },
      },
    });
  expect(events.console).toHaveLength(16);
  expect(events.completeness.snapshot().dropped_events.total).toBe(0);
});

it("drops a websocket frame whose retained shape alone exceeds the shared budget", () => {
  const events = createEvents();
  events.ingest({
    method: "Network.webSocketCreated",
    params: { requestId: "socket", url: `ws://${origin.slice(7)}/live` },
  });
  events.ingest({
    method: "Network.webSocketFrameReceived",
    params: {
      requestId: "socket",
      response: { opcode: 1, payloadData: '{"small":"frame"}' },
    },
  });
  const keys = Array.from(
    { length: 120_000 },
    (_value, index) => `key${String(index)}`,
  );
  events.ingest({
    method: "Network.webSocketFrameReceived",
    params: {
      requestId: "socket",
      response: {
        opcode: 1,
        payloadData: `{${keys.map((key) => `"${key}":"v"`).join(",")}}`,
      },
    },
  });
  const connection = events.webSocketConnectionsById.get("socket");
  expect(connection?.events).toHaveLength(1);
  const snapshot = events.completeness.snapshot();
  expect(snapshot.dropped_events.websocket_frames).toBe(1);
  expect(snapshot.dropped_events.total).toBe(1);
});

it("spends one shared allowance across console entries and websocket frames", () => {
  const events = createEvents();
  const text = "x".repeat(1024 * 1024);
  // Seven megabyte console entries leave roughly one megabyte of the shared
  // allowance, so a shape that fits an empty allowance no longer fits.
  for (let index = 0; index < 7; index += 1)
    events.ingest({
      method: "Runtime.consoleAPICalled",
      params: {
        type: "log",
        timestamp: index,
        args: [{ type: "string", value: text }],
        stackTrace: {
          callFrames: [
            { url: `${origin}/app.js`, lineNumber: 0, columnNumber: 0 },
          ],
        },
      },
    });
  expect(events.console).toHaveLength(7);
  events.ingest({
    method: "Network.webSocketCreated",
    params: { requestId: "socket", url: `ws://${origin.slice(7)}/live` },
  });
  const keys = Array.from(
    { length: 20_000 },
    (_value, index) => `key${String(index)}`,
  );
  events.ingest({
    method: "Network.webSocketFrameReceived",
    params: {
      requestId: "socket",
      response: {
        opcode: 1,
        payloadData: `{${keys.map((key) => `"${key}":"v"`).join(",")}}`,
      },
    },
  });
  expect(events.webSocketConnectionsById.get("socket")?.events).toHaveLength(0);
  const snapshot = events.completeness.snapshot();
  expect(snapshot.dropped_events.console_events).toBe(0);
  expect(snapshot.dropped_events.websocket_frames).toBe(1);
  expect(snapshot.dropped_events.total).toBe(1);
});
