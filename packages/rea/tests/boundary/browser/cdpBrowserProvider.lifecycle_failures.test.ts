import { describe, expect, it, vi } from "vitest";

import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import {
  inspectWebPageInputSchema,
  listBrowserTargetsInputSchema,
} from "../../../src/domain/browserObservation.js";
import { AnalysisInputError } from "../../../src/domain/analysisErrorCore.js";
import { analyzeWebBundleInputSchema } from "../../../src/domain/webBundleAnalysis.js";
import { observeWebSessionInputSchema } from "../../../src/domain/browserSession.js";
import { discoverWebMcpToolsInputSchema } from "../../../src/domain/webMcpDiscovery.js";
import { captureWebScreenshotInputSchema } from "../../../src/domain/webScreenshot.js";
import {
  startFakeCdpBrowser,
  type FakeCdpBrowser,
} from "../../fixtures/fakeCdpBrowser.js";
import { trackBrowser, waitFor } from "./cdpBrowserProvider.support.js";

describe("CdpBrowserProvider: cancellation during cleanup", () => {
  it.each([
    {
      name: "WebMCP discovery",
      operation: "discover_webmcp_tools",
      invoke: (
        provider: CdpBrowserProvider,
        browser: FakeCdpBrowser,
        signal: AbortSignal,
      ) =>
        provider.discoverWebMcpTools(
          discoverWebMcpToolsInputSchema.parse({
            cdp_endpoint: browser.endpoint,
            allowed_origins: [browser.allowedOrigin],
            target_id: "allowed-page",
            observation_ms: 0,
          }),
          { signal },
        ),
    },
    {
      name: "screenshot capture",
      operation: "capture_web_screenshot",
      invoke: (
        provider: CdpBrowserProvider,
        browser: FakeCdpBrowser,
        signal: AbortSignal,
      ) =>
        provider.captureScreenshot(
          captureWebScreenshotInputSchema.parse({
            cdp_endpoint: browser.endpoint,
            allowed_origins: [browser.allowedOrigin],
            target_id: "allowed-page",
          }),
          { signal },
        ),
    },
  ])(
    "reports cancellation during $name cleanup",
    async ({ operation, invoke }) => {
      const browser = await startFakeCdpBrowser({
        hangOnMethod: "Page.disable",
        webMcpTools: true,
      });
      trackBrowser(browser);
      const controller = new AbortController();
      const pending = invoke(
        new CdpBrowserProvider(),
        browser,
        controller.signal,
      );
      await waitFor(
        () => browser.commands.some(({ method }) => method === "Page.disable"),
        "page cleanup did not start",
      );
      controller.abort();
      await expect(pending).resolves.toMatchObject({
        ok: false,
        error: { _tag: "AnalysisCancelledError", operation },
      });
    },
  );

  it("reports cancellation when an interrupt arrives during page cleanup", async () => {
    const browser = await startFakeCdpBrowser({
      hangOnMethod: "Network.disable",
    });
    trackBrowser(browser);
    const controller = new AbortController();
    const pending = new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
      }),
      { signal: controller.signal },
    );
    await waitFor(
      () => browser.commands.some(({ method }) => method === "Network.disable"),
      "page cleanup did not start",
    );
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation: "inspect_web_page",
      },
    });
  });

  it("reports cancellation when an interrupt arrives during session cleanup", async () => {
    const browser = await startFakeCdpBrowser({
      hangOnMethod: "Network.disable",
    });
    trackBrowser(browser);
    const controller = new AbortController();
    const pending = new CdpBrowserProvider().observeSession(
      observeWebSessionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 1,
      }),
      { signal: controller.signal },
    );
    await waitFor(
      () => browser.commands.some(({ method }) => method === "Network.disable"),
      "session cleanup did not start",
    );
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation: "observe_web_session",
      },
    });
  });
});

describe("CdpBrowserProvider: cancellation during source-map download", () => {
  it("reports cancellation when an interrupt arrives during source-map download", async () => {
    const browser = await startFakeCdpBrowser({ hangSourceMap: true });
    trackBrowser(browser);
    const controller = new AbortController();
    const pending = new CdpBrowserProvider().analyzeBundle(
      analyzeWebBundleInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
        fetch_source_maps: true,
      }),
      { signal: controller.signal },
    );
    await waitFor(
      () =>
        browser.httpRequests.some(({ url }) => url.startsWith("/app.js.map")),
      "source-map download did not start",
    );
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation: "analyze_web_bundle",
      },
    });
  });

  it("classifies custom source-map abort reasons as cancellation", async () => {
    const browser = await startFakeCdpBrowser({ hangSourceMap: true });
    trackBrowser(browser);
    const controller = new AbortController();
    const pending = new CdpBrowserProvider().analyzeBundle(
      analyzeWebBundleInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
        fetch_source_maps: true,
      }),
      { signal: controller.signal },
    );
    await waitFor(
      () =>
        browser.httpRequests.some(({ url }) => url.startsWith("/app.js.map")),
      "source-map download did not start",
    );
    controller.abort(new Error("stopped"));
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation: "analyze_web_bundle",
      },
    });
  });
});

describe("CdpBrowserProvider: cancellation and session events", () => {
  it("honors cancellation during the final progress callback before publishing inspection", async () => {
    const browser = await startFakeCdpBrowser();
    trackBrowser(browser);
    const controller = new AbortController();
    const result = await new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
      }),
      {
        signal: controller.signal,
        progress: {
          report(update) {
            if (update.completed === 3) controller.abort();
            return Promise.resolve();
          },
        },
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation: "inspect_web_page",
      },
    });
  });

  it("projects direct-session cancellation onto the requested operation", async () => {
    const browser = await startFakeCdpBrowser({
      pageScopedVersionWebSocket: true,
      omitTargetWebSocket: true,
    });
    trackBrowser(browser);
    const controller = new AbortController();
    const result = await new CdpBrowserProvider().observeSession(
      observeWebSessionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 1_000,
      }),
      {
        signal: controller.signal,
        progress: {
          report(update) {
            if (update.completed === 1) controller.abort();
            return Promise.resolve();
          },
        },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation: "observe_web_session",
      },
    });
    const methods = browser.commands.map(({ method }) => method);
    expect(methods).not.toContain("Target.attachToTarget");
    expect(methods).not.toContain("Target.detachFromTarget");
    expect(methods).not.toContain("Target.closeTarget");
    expect(methods).not.toContain("Browser.close");
  });

  it("projects capture-window cancellation onto bundle analysis", async () => {
    const browser = await startFakeCdpBrowser({
      pageScopedVersionWebSocket: true,
      omitTargetWebSocket: true,
    });
    trackBrowser(browser);
    const controller = new AbortController();
    const result = await new CdpBrowserProvider().analyzeBundle(
      analyzeWebBundleInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 1_000,
      }),
      {
        signal: controller.signal,
        progress: {
          report(update) {
            if (update.completed === 2) controller.abort();
            return Promise.resolve();
          },
        },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation: "analyze_web_bundle",
      },
    });
  });

  it("observes user-driven reload, SPA, redirect, failure, and lifecycle events", async () => {
    const browser = await startFakeCdpBrowser({
      sessionTimeline: "same_origin",
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
    expect(result.value.window.end_reason).toBe("window_elapsed");
    expect(result.value.timeline.map(({ type }) => type)).toEqual([
      "navigation_requested",
      "same_origin_reload",
      "same_document_navigation",
      "redirect",
      "load_failed",
      "lifecycle",
    ]);
    expect(result.value.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "same_document_navigation",
          url: `${browser.allowedOrigin}/reloaded?token=session-secret#spa-secret`,
        }),
        expect.objectContaining({
          type: "redirect",
          url: `${browser.allowedOrigin}/redirected?token=redirect-secret`,
        }),
        expect.objectContaining({
          type: "load_failed",
          detail: "net::ERR_CONNECTION_REFUSED",
        }),
      ]),
    );
    expect(result.value.completeness.status).toBe("attach_limited");
    expect(browser.commands.map(({ method }) => method)).toContain(
      "Target.detachFromTarget",
    );
  });
});

describe("CdpBrowserProvider: session termination and scope changes", () => {
  it("ends a browser session when its flat target session detaches", async () => {
    const browser = await startFakeCdpBrowser({
      sessionTimeline: "target_detached",
    });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().observeSession(
      observeWebSessionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 1_000,
      }),
    );

    if (!result.ok) throw result.error;
    expect(result.value.window.end_reason).toBe("session_detached");
    expect(result.value.timeline.at(-1)).toMatchObject({
      type: "session_detached",
      detail: "session_detached",
      timestamp: null,
    });
    expect(result.value.limitations).toContain(
      "Timeline rows without a comparable producer timestamp have a null timestamp. Buffered events with unknown timing are retained as context only; they do not establish activity inside the selected observation window.",
    );
  });

  it("reports target termination only for an observed target crash", async () => {
    const browser = await startFakeCdpBrowser({
      sessionTimeline: "target_crashed",
    });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().observeSession(
      observeWebSessionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 1_000,
      }),
    );

    if (!result.ok) throw result.error;
    expect(result.value.window.end_reason).toBe("target_terminated");
    expect(result.value.timeline.at(-1)).toMatchObject({
      type: "target_terminated",
      detail: "target_terminated",
    });
  });

  it("ends a direct page session when its transport disconnects", async () => {
    const browser = await startFakeCdpBrowser({
      pageScopedVersionWebSocket: true,
      omitTargetWebSocket: true,
      closeAfterMethod: "Page.setLifecycleEventsEnabled",
    });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().observeSession(
      observeWebSessionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 1_000,
      }),
    );

    if (!result.ok) throw result.error;
    expect(result.value.window.end_reason).toBe("transport_disconnected");
    expect(result.value.timeline.at(-1)).toMatchObject({
      type: "transport_disconnected",
      detail: "transport_disconnected",
    });
    const methods = browser.commands.map(({ method }) => method);
    expect(methods).not.toContain("Target.attachToTarget");
    expect(methods).not.toContain("Target.detachFromTarget");
    expect(methods).not.toContain("Target.closeTarget");
  });

  it("ends immediately when a redirect leaves policy without exposing its URL", async () => {
    const browser = await startFakeCdpBrowser({
      sessionTimeline: "outside_policy",
    });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().observeSession(
      observeWebSessionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 1_000,
      }),
    );

    if (!result.ok) throw result.error;
    expect(result.value.window.end_reason).toBe("target_left_scope");
    expect(result.value.timeline.at(-1)).toMatchObject({
      type: "redirect",
      url: null,
      destination_scope: "outside_policy",
      redirect_response: {
        url: `${browser.allowedOrigin}/reloaded?token=session-secret`,
        status: 302,
        scope: "approved",
      },
    });
    expect(result.value.completeness).toMatchObject({
      status: "policy_filtered",
      policy_filtered_sections: ["timeline"],
      excluded: [
        {
          section: "timeline",
          reason: "out_of_target_scope",
          count: 1,
        },
      ],
    });
    expect(JSON.stringify(result.value)).not.toContain("private.example.test");
  });

  it("fails closed when the final session frame leaves policy without an event", async () => {
    const browser = await startFakeCdpBrowser({
      frameUrlAfterFirstRead: "https://private.example.test/final",
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
    expect(result.value.window.end_reason).toBe("target_left_scope");
    expect(result.value.target.final_url).toBeNull();
    expect(result.value.completeness).toMatchObject({
      status: "policy_filtered",
      policy_filtered_sections: ["timeline"],
    });
    expect(JSON.stringify(result.value)).not.toContain("private.example.test");
  });
});

describe("CdpBrowserProvider: protocol failures and cancellation cleanup", () => {
  it("degrades optional domains but propagates protocol and payload failures", async () => {
    const optional = await startFakeCdpBrowser({
      unsupportedMethods: ["Accessibility.getFullAXTree"],
    });
    trackBrowser(optional);
    const degraded = await new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: optional.endpoint,
        allowed_origins: [optional.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
      }),
    );
    if (!degraded.ok) throw degraded.error;
    expect(degraded.value.accessibility.nodes).toEqual([]);
    expect(degraded.value.accessibility.text_capture.status).toBe(
      "unavailable",
    );
    expect(degraded.value.completeness.unavailable_sections).toContain(
      "accessibility",
    );
    expect(degraded.value.limitations).toContain(
      "Accessibility.getFullAXTree was unavailable from this browser target.",
    );

    const invalidAccessibilityParams = await startFakeCdpBrowser({
      commandError: (command) =>
        command.method === "Accessibility.getFullAXTree"
          ? { code: -32_602, message: "Invalid params" }
          : undefined,
    });
    trackBrowser(invalidAccessibilityParams);
    const invalidParamsResult = await new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: invalidAccessibilityParams.endpoint,
        allowed_origins: [invalidAccessibilityParams.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
      }),
    );
    expect(invalidParamsResult).toMatchObject({
      ok: false,
      error: {
        _tag: "BrowserObservationError",
        reason: "protocol_error",
        command: "Accessibility.getFullAXTree",
        code: -32_602,
        reportedMessage: "Invalid params",
      },
    });

    for (const [options, reason] of [
      [{ oversizedDiscovery: true }, "invalid_endpoint_response"],
      [{ invalidBrowserWebSocket: true }, "invalid_endpoint_response"],
    ] as const) {
      const failed = await startFakeCdpBrowser(options);
      trackBrowser(failed);
      const result = await new CdpBrowserProvider().listTargets(
        listBrowserTargetsInputSchema.parse({
          cdp_endpoint: failed.endpoint,
          allowed_origins: [failed.allowedOrigin],
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toMatchObject({
          _tag: "BrowserObservationError",
          reason,
        });
    }

    const malformed = await startFakeCdpBrowser({
      malformedMessageOnMethod: "Page.getFrameTree",
    });
    trackBrowser(malformed);
    const protocol = await new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: malformed.endpoint,
        allowed_origins: [malformed.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
      }),
    );
    expect(protocol).toMatchObject({
      ok: false,
      error: { _tag: "BrowserObservationError", reason: "protocol_error" },
    });

    const malformedEvent = await startFakeCdpBrowser({
      malformedEventOnMethod: "Debugger.enable",
    });
    trackBrowser(malformedEvent);
    const eventProtocol = await new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: malformedEvent.endpoint,
        allowed_origins: [malformedEvent.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
      }),
    );
    expect(eventProtocol).toMatchObject({
      ok: false,
      error: { _tag: "BrowserObservationError", reason: "protocol_error" },
    });

    const malformedEventShape = await startFakeCdpBrowser({
      malformedEventShapeOnMethod: "Debugger.enable",
    });
    trackBrowser(malformedEventShape);
    const eventShapeProtocol = await new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: malformedEventShape.endpoint,
        allowed_origins: [malformedEventShape.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
      }),
    );
    expect(eventShapeProtocol).toMatchObject({
      ok: false,
      error: { _tag: "BrowserObservationError", reason: "protocol_error" },
    });
  });

  it("cancels observation and still detaches without closing the page", async () => {
    const browser = await startFakeCdpBrowser();
    trackBrowser(browser);
    const controller = new AbortController();
    const pending = new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 1_000,
      }),
      { signal: controller.signal },
    );
    // Wait until the attach response has been consumed and capture has begun.
    // Seeing the attach request alone races its response under worker load.
    await waitForCommand(browser, "Page.getFrameTree");
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation: "inspect_web_page",
      },
    });
    const methods = browser.commands.map(({ method }) => method);
    expect(methods).toContain("Target.detachFromTarget");
    expect(methods).not.toContain("Target.closeTarget");
    expect(methods).not.toContain("Browser.close");
  });
});

describe("CdpBrowserProvider: navigation commit and target identity", () => {
  it("waits for navigation commit and rechecks the attached main-frame origin", async () => {
    const transitioning = await startFakeCdpBrowser({
      transitionalFrameReads: 2,
    });
    trackBrowser(transitioning);
    const input = (browser: FakeCdpBrowser) =>
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 0,
      });
    const committed = await new CdpBrowserProvider().inspectPage(
      input(transitioning),
    );
    if (!committed.ok) throw committed.error;
    expect(committed.value.target.origin).toBe(transitioning.allowedOrigin);
    expect(committed.value.frames).toContainEqual(
      expect.objectContaining({
        frame_id: "frame-main",
        origin: transitioning.allowedOrigin,
      }),
    );

    const navigated = await startFakeCdpBrowser({
      attachedFrameUrl: "https://unapproved.example.test/after-attach",
    });
    trackBrowser(navigated);
    const denied = await new CdpBrowserProvider().inspectPage(input(navigated));
    expect(denied).toMatchObject({
      ok: false,
      error: { _tag: "BrowserObservationError", reason: "target_not_allowed" },
    });
    const methods = navigated.commands.map(({ method }) => method);
    expect(methods).toContain("Target.detachFromTarget");
    expect(methods).not.toContain("DOMSnapshot.captureSnapshot");
    expect(methods).not.toContain("Storage.getUsageAndQuota");

    const duringObservation = await startFakeCdpBrowser({
      navigateDuringObservationUrl:
        "https://unapproved.example.test/during-observation",
    });
    trackBrowser(duringObservation);
    const interrupted = await new CdpBrowserProvider().inspectPage(
      input(duringObservation),
    );
    expect(interrupted).toMatchObject({
      ok: false,
      error: { _tag: "BrowserObservationError", reason: "target_not_allowed" },
    });
    expect(
      duringObservation.commands.map(({ method }) => method),
    ).not.toContain("Accessibility.getFullAXTree");

    const captureOptions: { navigateDuringCaptureUrl?: string } = {};
    const duringCapture = await startFakeCdpBrowser(captureOptions);
    captureOptions.navigateDuringCaptureUrl = `${duringCapture.allowedOrigin}/changed`;
    trackBrowser(duringCapture);
    const discarded = await new CdpBrowserProvider().inspectPage(
      input(duringCapture),
    );
    expect(discarded).toMatchObject({
      ok: false,
      error: { _tag: "BrowserObservationError", reason: "target_changed" },
    });
    expect(duringCapture.commands.map(({ method }) => method)).toContain(
      "Target.detachFromTarget",
    );

    const crossOriginCapture = await startFakeCdpBrowser({
      navigateDuringCaptureUrl:
        "https://unapproved.example.test/during-capture",
    });
    trackBrowser(crossOriginCapture);
    const rejectedCapture = await new CdpBrowserProvider().inspectPage(
      input(crossOriginCapture),
    );
    expect(rejectedCapture).toMatchObject({
      ok: false,
      error: { _tag: "BrowserObservationError", reason: "target_not_allowed" },
    });
  });
});

describe("CdpBrowserProvider: source-map cancellation", () => {
  it("classifies an AnalysisError abort reason as cancellation", async () => {
    const browser = await startFakeCdpBrowser({
      sourceMapBody: JSON.stringify({
        version: 3,
        sources: ["app.ts"],
        names: [],
        mappings: "",
      }),
    });
    trackBrowser(browser);
    const controller = new AbortController();
    const reason = new AnalysisInputError("caller_operation");
    let markSourceMapRequested!: () => void;
    const sourceMapRequested = new Promise<void>((resolve) => {
      markSourceMapRequested = resolve;
    });
    const originalFetch = globalThis.fetch;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((resource, init) => {
        if (String(resource).includes("/app.js.map")) {
          markSourceMapRequested();
          return new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (signal?.aborted === true) {
              reject(signal.reason);
              return;
            }
            signal?.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          });
        }
        return originalFetch(resource, init);
      });
    try {
      const pending = new CdpBrowserProvider().analyzeBundle(
        analyzeWebBundleInputSchema.parse({
          cdp_endpoint: browser.endpoint,
          allowed_origins: [browser.allowedOrigin],
          target_id: "allowed-page",
          observation_ms: 0,
          fetch_source_maps: true,
        }),
        { signal: controller.signal },
      );
      await sourceMapRequested;
      controller.abort(reason);
      const result = await pending;
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisCancelledError",
          operation: "analyze_web_bundle",
        },
      });
      if (result.ok) throw new Error("Expected source-map cancellation");
      expect(result.error.cause).toBe(reason);
    } finally {
      fetchMock.mockRestore();
    }
  });
});

const waitForCommand = async (
  browser: FakeCdpBrowser,
  method: string,
): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (browser.commands.some((command) => command.method === method)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for fake CDP command ${method}`);
};
