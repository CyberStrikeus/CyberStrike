import { expect, it, vi } from "vitest";

import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { inspectWebPageInputSchema } from "../domain/browserObservation.js";
import { CdpCaptureEvents } from "./CdpCaptureEvents.js";
import type { CdpConnection } from "./CdpConnection.js";
import { CDP_SCRIPT_SOURCE_BYTES_OMISSION_REASON } from "./CdpScriptSourceBudget.js";
import { captureScripts } from "./CdpPageCaptureScripts.js";
import type { CaptureContext } from "./CdpPageCapture.js";
import type { CapturedScript } from "./CdpCaptureEventTypes.js";

const script = (scriptId: string): CapturedScript => ({
  scriptId,
  rawUrl: `https://example.test/${scriptId}.js`,
  url: `https://example.test/${scriptId}.js`,
  origin: "https://example.test",
  hash: scriptId,
  length: null,
  isModule: false,
  language: "JavaScript",
  sourceMapUrl: null,
  sourceMapRawUrl: null,
  executionContextKey: null,
  frameId: null,
});

const capture = async (
  sources: Readonly<Record<string, string>>,
  includeScriptSources = true,
  signal?: AbortSignal,
) => {
  const input = inspectWebPageInputSchema.parse({
    cdp_endpoint: "http://127.0.0.1:9222",
    target_id: "page-1",
    allowed_origins: ["https://example.test"],
    observation_ms: 0,
    include_script_sources: includeScriptSources,
  });
  const events = new CdpCaptureEvents(input, new Set(input.allowed_origins));
  for (const id of Object.keys(sources)) events.scripts.set(id, script(id));
  const send = vi.fn(async (method: string, params: unknown) => {
    if (method !== "Debugger.getScriptSource")
      throw new Error(`Unexpected CDP command: ${method}`);
    const scriptId = (params as { scriptId: string }).scriptId;
    return { scriptSource: sources[scriptId] };
  });
  const context = {
    connection: { send } as unknown as CdpConnection,
    sessionId: undefined,
    operation: "inspect_web_page",
    discovery: undefined,
    target: undefined,
    input,
    ...(signal === undefined ? {} : { signal }),
  } as unknown as CaptureContext;
  const result = await captureScripts({
    context,
    events,
    rawResources: [],
    resources: [],
    frameIds: new Set(),
  });
  return { result, events, send };
};

it("admits a prefix and fitting suffix around an oversized script source", async () => {
  const prefix = "p".repeat(16 * 1024 * 1024);
  const oversized = "o".repeat(17 * 1024 * 1024);
  const suffix = "s".repeat(1024 * 1024);
  const { result, events } = await capture({ prefix, oversized, suffix });
  const byId = new Map(
    result.inventory.items.map((item) => [item.cdp_hash, item.source]),
  );

  expect(byId.get("prefix")).toMatchObject({ included: true });
  expect(byId.get("oversized")).toEqual({
    included: false,
    reason: CDP_SCRIPT_SOURCE_BYTES_OMISSION_REASON,
  });
  expect(byId.get("suffix")).toMatchObject({ included: true });
  expect(events.completeness.snapshot().excluded).toContainEqual({
    section: "script_sources",
    reason: "resource_budget_exhausted",
    count: 1,
  });
});

it("preserves the caller cancellation reason when a source read is pending", async () => {
  const controller = new AbortController();
  const reason = new AnalysisCancelledError("inspect_web_page");
  const input = inspectWebPageInputSchema.parse({
    cdp_endpoint: "http://127.0.0.1:9222",
    target_id: "page-1",
    allowed_origins: ["https://example.test"],
    observation_ms: 0,
    include_script_sources: true,
  });
  const events = new CdpCaptureEvents(input, new Set(input.allowed_origins));
  events.scripts.set("first", script("first"));
  const context = {
    connection: {
      send: async () => {
        controller.abort(reason);
        throw new AnalysisCancelledError("inspect_web_page");
      },
    } as unknown as CdpConnection,
    sessionId: undefined,
    operation: "inspect_web_page",
    discovery: undefined,
    target: undefined,
    input,
    signal: controller.signal,
  } as unknown as CaptureContext;

  await expect(
    captureScripts({
      context,
      events,
      rawResources: [],
      resources: [],
      frameIds: new Set(),
    }),
  ).rejects.toMatchObject({ _tag: "AnalysisCancelledError", cause: reason });
});

it.each([
  { selection: "default", commandTimeoutMs: undefined, deadlineMs: 20_000 },
  { selection: "caller-selected", commandTimeoutMs: 1_234, deadlineMs: 1_234 },
])(
  "stops source reads at the $selection collection deadline and retains metadata",
  async ({ commandTimeoutMs, deadlineMs }) => {
    vi.useFakeTimers();
    try {
      const input = inspectWebPageInputSchema.parse({
        cdp_endpoint: "http://127.0.0.1:9222",
        target_id: "page-1",
        allowed_origins: ["https://example.test"],
        observation_ms: 0,
        include_script_sources: true,
        ...(commandTimeoutMs === undefined
          ? {}
          : { command_timeout_ms: commandTimeoutMs }),
      });
      const events = new CdpCaptureEvents(
        input,
        new Set(input.allowed_origins),
      );
      events.scripts.set("first", script("first"));
      events.scripts.set("second", script("second"));
      const send = vi.fn(
        (
          _method: string,
          _params: unknown,
          _sessionId: string | undefined,
          signal?: AbortSignal,
        ) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new AnalysisCancelledError("inspect_web_page")),
              { once: true },
            );
          }),
      );
      const context = {
        connection: { send } as unknown as CdpConnection,
        sessionId: undefined,
        operation: "inspect_web_page",
        discovery: undefined,
        target: undefined,
        input,
      } as unknown as CaptureContext;
      const pending = captureScripts({
        context,
        events,
        rawResources: [],
        resources: [],
        frameIds: new Set(),
      });

      await vi.advanceTimersByTimeAsync(deadlineMs);
      const result = await pending;

      expect(send).toHaveBeenCalledTimes(1);
      expect(result.inventory.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            cdp_hash: "first",
            url: "https://example.test/first.js",
          }),
          expect.objectContaining({
            cdp_hash: "second",
            url: "https://example.test/second.js",
          }),
        ]),
      );
      const expectedReason = `script source was omitted because the ${deadlineMs} ms command_timeout_ms source collection deadline elapsed (deadlineExpired). This is not the caller observation window. The 33554432-byte source budget stays fixed. This release has no runtime override. command_timeout_ms does not raise it.`;
      expect(result.inventory.items.map((item) => item.source)).toEqual([
        {
          included: false,
          reason: expectedReason,
        },
        {
          included: false,
          reason: expectedReason,
        },
      ]);
      expect(events.completeness.snapshot().excluded).toContainEqual({
        section: "script_sources",
        reason: "resource_budget_exhausted",
        count: 2,
      });
    } finally {
      vi.useRealTimers();
    }
  },
);

it("leaves source-off capture unchanged and does not issue source reads", async () => {
  const { result, events, send } = await capture({ first: "unused" }, false);

  expect(send).not.toHaveBeenCalled();
  expect(result.inventory.items[0]?.source).toEqual({
    included: false,
    reason: "source capture was not selected",
  });
  expect(events.completeness.snapshot().excluded).toContainEqual({
    section: "script_sources",
    reason: "not_approved",
    count: 1,
  });
});
