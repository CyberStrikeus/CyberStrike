import { expect, it } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { observeWebSessionInputSchema } from "../../../src/domain/browserSession.js";
import {
  startFakeCdpBrowser,
  type FakeOptions,
} from "../../fixtures/fakeCdpBrowser.js";
import { frameNavigated, trackBrowser } from "./cdpBrowserProvider.support.js";

const observeDuringClockSampling = async (
  commandEvents: NonNullable<FakeOptions["commandEvents"]>,
) => {
  return observeWithFake({
    eventsBeforeReply: ["Performance.getMetrics"],
    commandResult: (command) =>
      command.method === "Performance.getMetrics"
        ? { metrics: [{ name: "Timestamp", value: 20 }] }
        : undefined,
    commandEvents,
  });
};

const observeWithFake = async (options: FakeOptions) => {
  const browser = await startFakeCdpBrowser(options);
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
  return { browser, observation: result.value };
};

const laterInWindowRequest = (
  command: Parameters<NonNullable<FakeOptions["commandEvents"]>>[0],
  origin: string,
) => ({
  method: "Network.requestWillBeSent",
  sessionId: command.sessionId,
  params: {
    requestId: "later-in-window-request",
    timestamp: 21,
    type: "Document",
    frameId: "frame-main",
    redirectResponse: { url: `${origin}/prior` },
    request: { url: `${origin}/later` },
  },
});

const expectNoCommittedFrameWithInvalidTimeline = (
  observation: Awaited<ReturnType<typeof observeWithFake>>["observation"],
) => {
  expect(observation.timeline).not.toContainEqual(
    expect.objectContaining({ type: "navigation_committed" }),
  );
  expect(observation.completeness.excluded).toContainEqual(
    expect.objectContaining({
      section: "timeline",
      reason: "invalid_protocol_value",
    }),
  );
};

it("fails closed on an untimestamped cross-origin main-frame commit during clock sampling", async () => {
  const { observation } = await observeDuringClockSampling(
    (command, origin) => {
      if (command.method !== "Performance.getMetrics") return undefined;
      return [
        frameNavigated(command, {
          id: "frame-main",
          loaderId: "outside-loader",
          url: "https://outside.invalid/path",
        }),
        laterInWindowRequest(command, origin),
      ];
    },
  );

  expect(observation.window.end_reason).toBe("target_left_scope");
  expect(observation.target.final_url).toBeNull();
  expect(observation.timeline).toContainEqual(
    expect.objectContaining({
      type: "navigation_committed",
      loader_id: "outside-loader",
      timestamp: null,
      destination_scope: "outside_policy",
      url: null,
    }),
  );
  expect(observation.timeline).not.toContainEqual(
    expect.objectContaining({ request_id: "later-in-window-request" }),
  );
});

it("keeps an unidentifiable frame commit unknown without inventing a main-frame event", async () => {
  const { observation } = await observeDuringClockSampling((command) =>
    command.method === "Performance.getMetrics"
      ? [frameNavigated(command, { url: "https://outside.invalid/unknown" })]
      : undefined,
  );

  expect(observation.window.end_reason).toBe("window_elapsed");
  expectNoCommittedFrameWithInvalidTimeline(observation);
});

it("marks a frame event with absent parameters as unknown timeline evidence", async () => {
  const { observation } = await observeDuringClockSampling((command) =>
    command.method === "Performance.getMetrics"
      ? [
          {
            method: "Page.frameNavigated",
            sessionId: command.sessionId,
            params: undefined,
          },
        ]
      : undefined,
  );

  expectNoCommittedFrameWithInvalidTimeline(observation);
  expect(observation.completeness.unavailable_sections).toContain("timeline");
});

it("records a malformed child identity without treating it as the main frame", async () => {
  const { observation } = await observeDuringClockSampling((command) =>
    command.method === "Performance.getMetrics"
      ? [
          frameNavigated(command, {
            id: 3,
            parentId: "frame-main",
            url: "https://outside.invalid/child",
          }),
        ]
      : undefined,
  );

  expect(observation.window.end_reason).toBe("window_elapsed");
  expectNoCommittedFrameWithInvalidTimeline(observation);
});

it("updates the main frame from a pre-arm root replacement without inventing a navigation row", async () => {
  const { observation } = await observeDuringClockSampling((command, origin) =>
    command.method === "Performance.getMetrics"
      ? [
          frameNavigated(command, {
            id: "replacement-main",
            loaderId: "replacement-loader",
            url: `${origin}/app?token=frame-secret`,
          }),
          {
            method: "Page.lifecycleEvent",
            sessionId: command.sessionId,
            params: {
              frameId: "replacement-main",
              loaderId: "replacement-loader",
              name: "DOMContentLoaded",
              timestamp: 21,
            },
          },
        ]
      : undefined,
  );

  expect(observation.timeline).not.toContainEqual(
    expect.objectContaining({ type: "navigation_committed" }),
  );
  expect(observation.timeline).toContainEqual(
    expect.objectContaining({
      type: "lifecycle",
      frame_id: "replacement-main",
      loader_id: "replacement-loader",
      timestamp: 21,
      detail: "domcontentloaded",
    }),
  );
  expect(observation.limitations).toEqual(
    expect.arrayContaining([
      expect.stringContaining("Buffered events with unknown timing"),
    ]),
  );
});

it("fails closed on an untimestamped out-of-scope main-frame request during clock sampling", async () => {
  const { observation } = await observeDuringClockSampling(
    (command, origin) => {
      if (command.method !== "Performance.getMetrics") return undefined;
      return [
        {
          method: "Page.frameRequestedNavigation",
          sessionId: command.sessionId,
          params: {
            frameId: "frame-main",
            url: "https://outside.invalid/path",
            reason: "scriptInitiated",
          },
        },
        laterInWindowRequest(command, origin),
      ];
    },
  );

  expect(observation.window.end_reason).toBe("target_left_scope");
  expect(observation.timeline).toContainEqual(
    expect.objectContaining({
      type: "navigation_requested",
      timestamp: null,
      destination_scope: "outside_policy",
      url: null,
    }),
  );
  expect(observation.timeline).not.toContainEqual(
    expect.objectContaining({ request_id: "later-in-window-request" }),
  );
});

it("fails closed on an untimestamped out-of-scope redirect during clock sampling", async () => {
  const { observation } = await observeDuringClockSampling(
    (command, origin) => {
      if (command.method !== "Performance.getMetrics") return undefined;
      return [
        {
          method: "Network.requestWillBeSent",
          sessionId: command.sessionId,
          params: {
            requestId: "unknown-time-outside-redirect",
            type: "Document",
            frameId: "frame-main",
            redirectResponse: { url: `${origin}/prior` },
            request: { url: "https://outside.invalid/redirected" },
          },
        },
        {
          method: "Network.requestWillBeSent",
          sessionId: command.sessionId,
          params: {
            requestId: "later-in-window-request",
            timestamp: 21,
            type: "Document",
            frameId: "frame-main",
            redirectResponse: { url: `${origin}/prior` },
            request: { url: `${origin}/later` },
          },
        },
      ];
    },
  );

  expect(observation.window.end_reason).toBe("target_left_scope");
  expect(observation.target.final_url).toBeNull();
  expect(observation.timeline).toContainEqual(
    expect.objectContaining({
      type: "redirect",
      request_id: "unknown-time-outside-redirect",
      timestamp: null,
      destination_scope: "outside_policy",
      url: null,
    }),
  );
  expect(observation.timeline).not.toContainEqual(
    expect.objectContaining({ request_id: "later-in-window-request" }),
  );
});

it.each([
  [
    "Inspector.targetCrashed",
    "target_terminated",
    "target_terminated",
    {
      method: "Inspector.targetCrashed",
      sessionId: "session-1",
      params: {},
    },
  ],
  [
    "Target.detachedFromTarget",
    "session_detached",
    "session_detached",
    {
      method: "Target.detachedFromTarget",
      params: { sessionId: "session-1", targetId: "allowed-page" },
    },
  ],
] as const)(
  "ends on buffered untimestamped %s before collecting later events",
  async (_method, endReason, eventType, terminalEvent) => {
    const { observation } = await observeWithFake({
      eventsBeforeReply: ["Performance.getMetrics"],
      commandResult: (command) =>
        command.method === "Performance.getMetrics"
          ? { metrics: [{ name: "Timestamp", value: 20 }] }
          : undefined,
      commandEvents: (command, origin) => {
        if (command.method !== "Performance.getMetrics") return undefined;
        return [
          terminalEvent,
          {
            method: "Network.requestWillBeSent",
            sessionId: command.sessionId,
            params: {
              requestId: "after-terminal-event",
              timestamp: 21,
              type: "Document",
              frameId: "frame-main",
              redirectResponse: { url: `${origin}/prior` },
              request: { url: `${origin}/later` },
            },
          },
        ];
      },
    });

    expect(observation.window.end_reason).toBe(endReason);
    expect(observation.timeline).toContainEqual(
      expect.objectContaining({
        type: eventType,
        timestamp: null,
      }),
    );
    expect(observation.timeline).not.toContainEqual(
      expect.objectContaining({ request_id: "after-terminal-event" }),
    );
    expect(observation.limitations).toContain(
      "Timeline rows without a comparable producer timestamp have a null timestamp. Buffered events with unknown timing are retained as context only; they do not establish activity inside the selected observation window.",
    );
  },
);

it("represents absent timeline timestamps as unknown and preserves an observed zero", async () => {
  const { browser, observation } = await observeWithFake({
    eventsBeforeReply: ["Page.setLifecycleEventsEnabled"],
    commandEvents: (command, origin) => {
      if (command.method !== "Page.setLifecycleEventsEnabled") return undefined;
      return [
        {
          method: "Page.navigatedWithinDocument",
          sessionId: command.sessionId,
          params: {
            frameId: "frame-main",
            url: `${origin}/without-clock-value`,
            navigationType: "historyApi",
          },
        },
        {
          method: "Network.requestWillBeSent",
          sessionId: command.sessionId,
          params: {
            requestId: "actual-zero-clock-value",
            type: "Document",
            frameId: "frame-main",
            timestamp: 0,
            request: { url: `${origin}/document`, method: "GET" },
          },
        },
        {
          method: "Network.loadingFailed",
          sessionId: command.sessionId,
          params: {
            requestId: "actual-zero-clock-value",
            type: "Document",
            errorText: "net::ERR_CONNECTION_REFUSED",
            timestamp: 0,
          },
        },
      ];
    },
  });

  expect(observation.timeline).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "same_document_navigation",
        url: `${browser.allowedOrigin}/without-clock-value`,
        timestamp: null,
      }),
      expect.objectContaining({
        type: "load_failed",
        request_id: "actual-zero-clock-value",
        timestamp: 0,
      }),
    ]),
  );
});

it("ends an armed observation at a fatal protocol failure without waiting out its window", async () => {
  const browser = await startFakeCdpBrowser({
    malformedEventOnMethod: "Page.setLifecycleEventsEnabled",
  });
  trackBrowser(browser);
  const started = performance.now();
  const result = await new CdpBrowserProvider().observeSession(
    observeWebSessionInputSchema.parse({
      cdp_endpoint: browser.endpoint,
      allowed_origins: [browser.allowedOrigin],
      target_id: "allowed-page",
      observation_ms: 10_000,
    }),
  );
  expect(performance.now() - started).toBeLessThan(5_000);
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "BrowserObservationError", reason: "protocol_error" },
  });
}, 15_000);

it("does not join an empty document request identity to a later loading failure", async () => {
  const { observation } = await observeDuringClockSampling(
    (command, origin) => {
      if (command.method !== "Performance.getMetrics") return undefined;
      return [
        {
          ...laterInWindowRequest(command, origin),
          params: {
            ...laterInWindowRequest(command, origin).params,
            requestId: "",
          },
        },
        {
          method: "Network.loadingFailed",
          sessionId: command.sessionId,
          params: {
            requestId: "",
            timestamp: 22,
            errorText: "net::ERR_FAILED",
          },
        },
      ];
    },
  );
  expect(observation.window.end_reason).toBe("window_elapsed");
  expect(observation.timeline).toContainEqual(
    expect.objectContaining({ type: "redirect", request_id: null }),
  );
  expect(observation.timeline).not.toContainEqual(
    expect.objectContaining({ type: "load_failed" }),
  );
  expect(observation.timeline).not.toContainEqual(
    expect.objectContaining({ request_id: "" }),
  );
  expect(observation.completeness.excluded).toContainEqual(
    expect.objectContaining({
      section: "timeline",
      reason: "invalid_protocol_value",
    }),
  );
});

const redirectCases = [
  ...(
    [
      ["string status", "302"],
      ["null status", null],
      ["boolean status", false],
      ["object status", {}],
    ] as const
  ).map(([name, status]) => ({
    name,
    invalidStatus: true,
    response: (origin: string) => ({ url: `${origin}/prior`, status }),
    expected: (origin: string) => ({
      url: `${origin}/prior`,
      status: null,
      scope: "approved",
    }),
  })),
  {
    name: "malformed URL",
    response: (_origin: string) => ({ url: "http://%", status: 302 }),
    expected: (_origin: string) => ({ url: null, status: null, scope: null }),
  },
  {
    name: "empty URL",
    response: (_origin: string) => ({ url: "", status: 302 }),
    expected: (_origin: string) => ({ url: null, status: null, scope: null }),
  },

  {
    name: "missing URL",
    response: (_origin: string) => ({ status: 302 }),
    expected: (_origin: string) => ({ url: null, status: null, scope: null }),
  },
  {
    name: "missing status",
    response: (origin: string) => ({ url: `${origin}/prior` }),
    expected: (origin: string) => ({
      url: `${origin}/prior`,
      status: null,
      scope: "approved",
    }),
  },
  {
    name: "zero status",
    response: (origin: string) => ({ url: `${origin}/prior`, status: 0 }),
    expected: (origin: string) => ({
      url: `${origin}/prior`,
      status: 0,
      scope: "approved",
    }),
  },
  {
    name: "outside origin",
    response: (_origin: string) => ({
      url: "https://outside.invalid/previous",
      status: 302,
    }),
    expected: (_origin: string) => ({
      url: null,
      status: null,
      scope: "outside_policy",
    }),
  },
  {
    name: "unsupported URL",
    response: (_origin: string) => ({
      url: "data:text/html,discard-redirect-body",
      status: 302,
    }),
    expected: (_origin: string) => ({
      url: null,
      status: null,
      scope: "unsupported",
    }),
  },
  {
    name: "credentials",
    response: (origin: string) => ({
      url:
        origin.replace("http://", "http://user:discard-redirect-secret@") +
        "/prior?token=visible",
      status: 302,
    }),
    expected: (origin: string) => ({
      url: `${origin}/prior?token=visible`,
      status: 302,
      scope: "approved",
    }),
  },
];

it.each(redirectCases)(
  "preserves scoped redirect response facts with $name",
  async (testCase) => {
    const { response, expected } = testCase;
    const { browser, observation } = await observeDuringClockSampling(
      (command, origin) => {
        if (command.method !== "Performance.getMetrics") return undefined;
        return [
          {
            method: "Network.requestWillBeSent",
            sessionId: command.sessionId,
            params: {
              requestId: "redirect-context",
              timestamp: 21,
              type: "Document",
              frameId: "frame-main",
              request: { url: `${origin}/next`, method: "GET" },
              redirectResponse: {
                ...response(origin),
                headers: { Authorization: "discard-redirect-header" },
              },
            },
          },
        ];
      },
    );
    expect(observation.timeline).toContainEqual(
      expect.objectContaining({
        type: "redirect",
        request_id: "redirect-context",
        redirect_response: expected(browser.allowedOrigin),
      }),
    );
    if (
      expected(browser.allowedOrigin).scope === null ||
      "invalidStatus" in testCase
    )
      expect(observation.completeness.excluded).toContainEqual(
        expect.objectContaining({
          section: "timeline",
          reason: "invalid_protocol_value",
        }),
      );
    else
      expect(observation.completeness.excluded).not.toContainEqual(
        expect.objectContaining({
          section: "timeline",
          reason: "invalid_protocol_value",
        }),
      );
    const scope = expected(browser.allowedOrigin).scope;
    if (scope === "outside_policy" || scope === "unsupported") {
      expect(observation.completeness.excluded).toContainEqual(
        expect.objectContaining({
          section: "timeline",
          reason:
            scope === "outside_policy"
              ? "disallowed_origin"
              : "unsupported_url",
        }),
      );
      expect(observation.completeness.policy_filtered_sections).toContain(
        "timeline",
      );
    }
    const serialized = JSON.stringify(observation);
    expect(serialized).not.toContain("discard-redirect-");
    expect(serialized).not.toContain("outside.invalid");
  },
);
