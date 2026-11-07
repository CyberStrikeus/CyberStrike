import { expect, it, vi } from "vitest";
import { WebRuntimeService } from "../../../src/application/WebRuntimeService.js";
import { CdpWebRuntimeProvider } from "../../../src/browser/execution/CdpWebRuntimeProvider.js";
import { AnalysisOutputError } from "../../../src/domain/analysisErrorCore.js";
import { startRuntimeBrowser } from "../../fixtures/webRuntime.js";

it.each([
  new Error("operator stopped observation"),
  new AnalysisOutputError("inspect_web_page", "caller supplied reason"),
  { requested: "stop the armed observation" },
])(
  "preserves caller reason through the armed service workflow and stops instrumentation (%s)",
  async (reason) => {
    const browser = await startRuntimeBrowser();
    const provider = new CdpWebRuntimeProvider();
    const service = new WebRuntimeService(provider);
    const input = {
      cdp_endpoint: browser.endpoint,
      target_id: "allowed-page",
      observation_ms: 5,
    };
    try {
      const before = await service.observe(input);
      if (!before.ok) throw before.error;
      const controller = new AbortController();
      const cancelled = await service.observe(input, {
        signal: controller.signal,
        progress: {
          report: async (update) => {
            if (update.completed === 1) controller.abort(reason);
          },
        },
      });
      expect(cancelled.ok).toBe(false);
      if (cancelled.ok) throw new Error("Expected cancellation at arming");
      expect(cancelled.error._tag).toBe("AnalysisCancelledError");
      expect(cancelled.error.cause).toBe(controller.signal.reason);
      expect(cancelled.error.cause).toBe(reason);
      expect(cancelled.error.cleanupIncomplete).toBe(false);
      expect(
        browser.commands.filter(
          (command) => command.method === "Profiler.stopPreciseCoverage",
        ),
      ).toHaveLength(2);
      await vi.waitFor(() => expect(browser.activeConnectionCount()).toBe(0));
      const after = await service.observe(input);
      if (!after.ok) throw after.error;
      await vi.waitFor(() => expect(browser.activeConnectionCount()).toBe(0));
    } finally {
      await provider.close();
      await browser.close();
    }
  },
);

it("preserves the caller reason when a navigation observation is cancelled at arming", async () => {
  const { CdpBrowserProvider } =
    await import("../../../src/browser/CdpBrowserProvider.js");
  const { observeWebSession } =
    await import("../../../src/application/BrowserObservationService.js");
  const { observeWebSessionInputSchema } =
    await import("../../../src/domain/browserSession.js");
  const browser = await startRuntimeBrowser();
  const provider = new CdpBrowserProvider();
  const controller = new AbortController();
  const reason = { requested: "stop navigation observation" };
  try {
    const result = await observeWebSession(
      provider,
      observeWebSessionInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        allowed_origins: [browser.allowedOrigin],
        target_id: "allowed-page",
        observation_ms: 30_000,
      }),
      {
        signal: controller.signal,
        progress: {
          report: async (update) => {
            if (update.completed === 1) controller.abort(reason);
          },
        },
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected cancelled navigation observation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(result.error.cause).toBe(reason);
    expect(result.error.cleanupIncomplete).toBe(false);
    await vi.waitFor(() => expect(browser.activeConnectionCount()).toBe(0));
  } finally {
    await provider.close();
    await browser.close();
  }
});
