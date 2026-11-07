import { describe, expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const endpoints = (source: string) =>
  analyzeJavaScriptStaticSource(source).endpoints.map(
    ({ kind, value, mechanism }) => ({ kind, value, mechanism }),
  );

describe("server-sent event endpoints", () => {
  it("reports EventSource URLs like WebSocket URLs", () => {
    expect(
      endpoints(`
        new WebSocket("wss://chat.example/ws");
        new EventSource("/api/chat/stream");
        new window.EventSource("https://chat.example/events", { withCredentials: true });
      `),
    ).toEqual([
      {
        kind: "network",
        value: "wss://chat.example/ws",
        mechanism: "call:WebSocket",
      },
      {
        kind: "network",
        value: "/api/chat/stream",
        mechanism: "call:EventSource",
      },
      {
        kind: "network",
        value: "https://chat.example/events",
        mechanism: "call:window.EventSource",
      },
    ]);
  });

  it("retains a dynamic EventSource target as partial source evidence", () => {
    expect(
      analyzeJavaScriptStaticSource("new EventSource(url);").endpoints,
    ).toEqual([
      expect.objectContaining({
        value: "url",
        mechanism: "call:EventSource",
        resolution: "partial",
      }),
    ]);
  });
});
