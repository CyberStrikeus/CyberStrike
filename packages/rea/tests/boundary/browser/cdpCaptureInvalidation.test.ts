import { expect, it } from "vitest";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { inspectWebPageInputSchema } from "../../../src/domain/browserObservation.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { frameNavigated, trackBrowser } from "./cdpBrowserProvider.support.js";

it.each([
  { method: "Network.enable", sourceFails: false },
  { method: "DOMSnapshot.captureSnapshot", sourceFails: false },
  { method: "DOMSnapshot.captureSnapshot", sourceFails: true },
])(
  "explains observed origin refusal during $method with source failure $sourceFails",
  async ({ method: stage, sourceFails }) => {
    const browser = await startFakeCdpBrowser({
      eventsBeforeReply: [stage],
      commandEvents: (command) =>
        command.method === stage
          ? [
              frameNavigated(command, {
                id: "frame-main",
                loaderId: "outside-document",
                url: "https://outside.example/page",
              }),
            ]
          : undefined,
      commandError: ({ method }) =>
        sourceFails && method === "Debugger.getScriptSource"
          ? { code: -32000, message: "No script for id" }
          : undefined,
    });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 0,
        include_script_sources: true,
      }),
    );
    if (result.ok) throw new Error("Expected observed origin refusal");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "target_unavailable",
      message: expect.stringContaining("permitted HTTP(S) origin scope"),
      remediation: { action: expect.stringContaining("allowed_origins") },
      details: {
        operation: "inspect_web_page",
        reason: "target_not_allowed",
      },
    });
    if (sourceFails)
      expect(result.error.cause).toMatchObject({ reason: "protocol_error" });
    expect(browser.commands.map(({ method }) => method)).toContain(
      "Target.detachFromTarget",
    );
  },
);

it.each([
  { changed: true, sourceFails: true, reason: "target_changed" },
  { changed: false, sourceFails: true, reason: "protocol_error" },
  { changed: false, sourceFails: false, reason: null },
])(
  "preserves observed navigation before a stale source-read failure: $changed/$sourceFails",
  async ({ changed, sourceFails, reason }) => {
    const browser = await startFakeCdpBrowser({
      eventsBeforeReply: ["DOMSnapshot.captureSnapshot"],
      commandEvents: (command, origin) =>
        changed && command.method === "DOMSnapshot.captureSnapshot"
          ? [
              frameNavigated(command, {
                id: "frame-main",
                loaderId: "reloaded-document",
                url: origin + "/reloaded",
              }),
            ]
          : undefined,
      commandError: ({ method }) =>
        sourceFails && method === "Debugger.getScriptSource"
          ? { code: -32000, message: "No script for id" }
          : undefined,
    });
    trackBrowser(browser);
    const result = await new CdpBrowserProvider().inspectPage(
      inspectWebPageInputSchema.parse({
        cdp_endpoint: browser.endpoint,
        target_id: "allowed-page",
        observation_ms: 0,
        include_script_sources: true,
      }),
    );
    if (reason === null) {
      if (!result.ok) throw result.error;
      expect(
        result.value.scripts.items.some(({ source }) => source.included),
      ).toBe(true);
      return;
    }
    expect(result).toMatchObject({ ok: false, error: { reason } });
    if (result.ok) throw new Error("Expected a capture refusal");
    if (changed) {
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "target_unavailable",
        message: expect.stringContaining("target changed"),
        remediation: {
          action: expect.stringContaining("Retry after navigation settles"),
        },
      });
      expect(result.error.cause).toMatchObject({ reason: "protocol_error" });
    }
    expect(browser.commands.map(({ method }) => method)).toContain(
      "Target.detachFromTarget",
    );
  },
);
