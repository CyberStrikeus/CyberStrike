import { expect, it, onTestFinished, vi } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { CdpConnection } from "../../../src/browser/CdpConnection.js";
import { recordValue } from "../../../src/browser/CdpCaptureValues.js";
import { observeWebSessionInputSchema } from "../../../src/domain/browserSession.js";
import {
  startFakeCdpBrowser,
  type FakeOptions,
} from "../../fixtures/fakeCdpBrowser.js";
import { trackBrowser, waitFor } from "./cdpBrowserProvider.support.js";

const clockResponseEvents: NonNullable<FakeOptions["commandEvents"]> = (
  command,
  origin,
) => {
  if (command.method === "Page.enable")
    return [
      {
        method: "Page.frameNavigated",
        sessionId: command.sessionId,
        params: {
          frame: {
            id: "frame-main",
            loaderId: "loader-before-window",
            url: `${origin}/initial`,
          },
        },
      },
    ];
  if (command.method === "Performance.getMetrics")
    return [
      {
        method: "Page.lifecycleEvent",
        sessionId: command.sessionId,
        params: {
          frameId: "frame-main",
          loaderId: "loader-before-window",
          name: "load",
          timestamp: 19,
        },
      },
      {
        method: "Page.navigatedWithinDocument",
        sessionId: command.sessionId,
        params: {
          frameId: "frame-main",
          url: `${origin}#during-clock-response`,
          navigationType: "historyApi",
        },
      },
      {
        method: "Network.requestWillBeSent",
        sessionId: command.sessionId,
        params: {
          requestId: "request-before-window",
          timestamp: 19,
          type: "Document",
          frameId: "frame-main",
          redirectResponse: { url: `${origin}/before-redirect` },
          request: { url: `${origin}/before-window` },
        },
      },
      {
        method: "Network.requestWillBeSent",
        sessionId: command.sessionId,
        params: {
          requestId: "request-window-redirect",
          timestamp: 21,
          type: "Document",
          frameId: "frame-main",
          redirectResponse: { url: `${origin}/prior-hop-context`, status: 302 },
          request: { url: `${origin}/after-cutoff` },
        },
      },
      {
        method: "Network.requestWillBeSent",
        sessionId: command.sessionId,
        params: {
          requestId: "failure-before-window",
          type: "Document",
          frameId: "frame-main",
          timestamp: 18,
          request: { url: `${origin}/document`, method: "GET" },
        },
      },
      {
        method: "Network.loadingFailed",
        sessionId: command.sessionId,
        params: {
          requestId: "failure-before-window",
          timestamp: 19,
          type: "Document",
          errorText: "net::ERR_CONNECTION_REFUSED",
        },
      },
      {
        method: "Network.requestWillBeSent",
        sessionId: command.sessionId,
        params: {
          requestId: "failure-window",
          type: "Document",
          frameId: "frame-main",
          timestamp: 21,
          request: { url: `${origin}/document`, method: "GET" },
        },
      },
      {
        method: "Network.loadingFailed",
        sessionId: command.sessionId,
        params: {
          requestId: "failure-window",
          timestamp: 22,
          type: "Document",
          errorText: "net::ERR_CONNECTION_REFUSED",
        },
      },
    ];
  if (command.method === "Page.setLifecycleEventsEnabled")
    return [
      {
        method: "Page.lifecycleEvent",
        sessionId: command.sessionId,
        params: {
          frameId: "frame-main",
          loaderId: "loader-current-window",
          name: "load",
          timestamp: 21,
        },
      },
      {
        method: "Page.navigatedWithinDocument",
        sessionId: command.sessionId,
        params: {
          frameId: "frame-main",
          url: `${origin}#in-window`,
          navigationType: "historyApi",
        },
      },
    ];
  return undefined;
};

it("buffers clock-response events while dropping lifecycle history before the clock boundary", async () => {
  const browser = await startFakeCdpBrowser({
    eventsBeforeReply: [
      "Page.enable",
      "Performance.getMetrics",
      "Page.setLifecycleEventsEnabled",
    ],
    commandResult: (command) => {
      if (command.method === "Performance.enable") return {};
      if (command.method === "Performance.getMetrics")
        return { metrics: [{ name: "Timestamp", value: 20 }] };
      return undefined;
    },
    commandEvents: clockResponseEvents,
  });
  trackBrowser(browser);
  const result = await new CdpBrowserProvider().observeSession(
    observeWebSessionInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 20,
    }),
  );

  if (!result.ok) throw result.error;
  expect(browser.commands.map(({ method }) => method)).toContain(
    "Performance.getMetrics",
  );
  expect(result.value.timeline).toContainEqual(
    expect.objectContaining({
      type: "lifecycle",
      loader_id: "loader-current-window",
      timestamp: 21,
    }),
  );
  expect(result.value.timeline).not.toContainEqual(
    expect.objectContaining({ loader_id: "loader-before-window" }),
  );
  expect(result.value.timeline).not.toContainEqual(
    expect.objectContaining({ type: "navigation_committed" }),
  );
  expect(result.value.timeline).toContainEqual(
    expect.objectContaining({
      type: "same_document_navigation",
      url: `${browser.allowedOrigin}#during-clock-response`,
      timestamp: null,
    }),
  );
  expect(result.value.timeline).not.toContainEqual(
    expect.objectContaining({ request_id: "request-before-window" }),
  );
  expect(result.value.timeline).toContainEqual(
    expect.objectContaining({
      type: "redirect",
      request_id: "request-window-redirect",
      timestamp: 21,
      url: `${browser.allowedOrigin}/after-cutoff`,
      redirect_response: {
        url: `${browser.allowedOrigin}/prior-hop-context`,
        status: 302,
        scope: "approved",
      },
    }),
  );
  expect(result.value.timeline).not.toContainEqual(
    expect.objectContaining({ request_id: "failure-before-window" }),
  );
  expect(result.value.timeline).toContainEqual(
    expect.objectContaining({
      type: "load_failed",
      request_id: "failure-window",
      timestamp: 22,
    }),
  );
  expect(result.value.limitations).toContain(
    "Timeline rows without a comparable producer timestamp have a null timestamp. Buffered events with unknown timing are retained as context only; they do not establish activity inside the selected observation window.",
  );
});

it.each([
  ["missing Timestamp", { metrics: [] }],
  ["invalid Timestamp", { metrics: [{ name: "Timestamp", value: -1 }] }],
])(
  "fails closed when Performance.getMetrics returns %s",
  async (_name, resultValue) => {
    const browser = await startFakeCdpBrowser({
      commandResult: (command) =>
        command.method === "Performance.enable"
          ? {}
          : command.method === "Performance.getMetrics"
            ? resultValue
            : undefined,
    });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().observeSession(
      observeWebSessionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 20,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "BrowserObservationError",
        reason: "protocol_error",
      },
    });
    expect(browser.commands.map(({ method }) => method)).not.toContain(
      "Page.setLifecycleEventsEnabled",
    );
  },
);

it.each([
  ["out-of-scope navigation", "Page.frameNavigated"],
  ["target termination", "Inspector.targetCrashed"],
])(
  "fails closed when the pre-clock event buffer is exceeded before %s",
  async (_name, eventAfterBudget) => {
    const oversizedHash = "x".repeat(8 * 1024 * 1024);
    const browser = await startFakeCdpBrowser({
      eventsBeforeReply: ["Performance.getMetrics"],
      commandResult: (command) =>
        command.method === "Performance.enable"
          ? {}
          : command.method === "Performance.getMetrics"
            ? { metrics: [{ name: "Timestamp", value: 20 }] }
            : undefined,
      commandEvents: (command, origin) => {
        if (command.method !== "Performance.getMetrics") return undefined;
        return [
          {
            method: "Page.frameNavigated",
            sessionId: command.sessionId,
            params: {
              frame: {
                id: "frame-main",
                loaderId: "oversized-loader",
                url: `${origin}#${oversizedHash}`,
              },
            },
          },
          eventAfterBudget === "Page.frameNavigated"
            ? {
                method: "Page.frameNavigated",
                sessionId: command.sessionId,
                params: {
                  frame: {
                    id: "frame-main",
                    loaderId: "outside-after-budget",
                    url: "https://outside.example/path",
                  },
                },
              }
            : {
                method: "Inspector.targetCrashed",
                sessionId: command.sessionId,
                params: {},
              },
        ];
      },
    });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().observeSession(
      observeWebSessionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 20,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "BrowserObservationError",
        reason: "payload_limit",
        userMessage: expect.stringContaining("retained CDP event buffer"),
      },
    });
    expect(browser.commands.map(({ method }) => method)).not.toContain(
      "Page.setLifecycleEventsEnabled",
    );
  },
);

it("ignores unrelated protocol payloads before charging the timeline buffer", async () => {
  const browser = await startFakeCdpBrowser({
    eventsBeforeReply: ["Performance.getMetrics"],
    commandResult: (command) =>
      command.method === "Performance.getMetrics"
        ? { metrics: [{ name: "Timestamp", value: 20 }] }
        : undefined,
    commandEvents: (command, origin) => {
      if (command.method !== "Performance.getMetrics") return undefined;
      return [
        {
          method: "Network.responseReceived",
          sessionId: command.sessionId,
          params: {
            requestId: "unselected-response",
            timestamp: 21,
            type: "Document",
            response: {
              url: origin,
              status: 200,
              headers: { "x-large-field": "x".repeat(8 * 1024 * 1024) },
            },
          },
        },
        {
          method: "Page.navigatedWithinDocument",
          sessionId: command.sessionId,
          params: { frameId: "frame-main", url: `${origin}#selected` },
        },
      ];
    },
  });
  trackBrowser(browser);
  const result = await new CdpBrowserProvider().observeSession(
    observeWebSessionInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 1,
    }),
  );
  if (!result.ok) throw result.error;
  expect(result.value.timeline).toContainEqual(
    expect.objectContaining({
      type: "same_document_navigation",
      url: `${browser.allowedOrigin}#selected`,
      timestamp: null,
    }),
  );
});

it("keeps cancellation authoritative while an over-budget clock request is pending", async () => {
  let received = false;
  const onEvent = CdpConnection.prototype.onEvent;
  const subscribe = vi
    .spyOn(CdpConnection.prototype, "onEvent")
    .mockImplementation(function (this: CdpConnection, listener) {
      return onEvent.call(this, (event) => {
        listener(event);
        if (
          event.method === "Page.frameNavigated" &&
          recordValue(recordValue(event.params)?.frame)?.loaderId ===
            "oversized-before-clock"
        )
          // All subscribers finish synchronously before this microtask, including
          // the timeline owner that admits or rejects the received payload.
          queueMicrotask(() => {
            received = true;
          });
      });
    });
  onTestFinished(() => subscribe.mockRestore());
  const browser = await startFakeCdpBrowser({
    hangOnMethod: "Performance.getMetrics",
  });
  trackBrowser(browser);
  const controller = new AbortController();
  const pending = new CdpBrowserProvider().observeSession(
    observeWebSessionInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 20,
    }),
    { signal: controller.signal },
  );
  await waitFor(
    () =>
      browser.commands.some(
        ({ method }) => method === "Performance.getMetrics",
      ),
    "the performance clock request did not start",
  );
  browser.emitEvent({
    method: "Page.frameNavigated",
    sessionId: "session-1",
    params: {
      frame: {
        id: "frame-main",
        loaderId: "oversized-before-clock",
        url: `https://outside.example/${"x".repeat(8 * 1024 * 1024)}`,
      },
    },
  });
  await waitFor(() => received, "the over-budget event was not received");
  controller.abort();

  await expect(pending).resolves.toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      operation: "observe_web_session",
    },
  });
  expect(browser.commands.map(({ method }) => method)).not.toContain(
    "Page.setLifecycleEventsEnabled",
  );
  await waitFor(
    () => browser.activeConnectionCount() === 0,
    "the cancelled observation did not release its CDP connection",
  );
});
