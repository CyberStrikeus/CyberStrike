import { BrowserObservationError } from "../../src/domain/browserObservationError.js";
import { PlaywrightScenarioSession } from "../../src/browser/PlaywrightScenarioSession.js";
import { chromium, type BrowserContext } from "playwright-core";
import { expect, it, vi } from "vitest";
import { withVerifierCleanup } from "../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../fixtures/lifecycleAcknowledgement.js";
import { captureBrowserScenario } from "../../src/application/BrowserScenarioCaptureService.js";
import { createBrowserScenarioProvider } from "../../src/composition/browserScenario.js";
import { browserScenarioSchema } from "../../src/domain/browserScenario.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import {
  AnalysisError,
  primaryAnalysisError,
} from "../../src/domain/analysisErrorBase.js";

it.each([
  { late: false, secret: "declared-startup-private-value" },
  { late: false, secret: "browser_profile" },
  { late: false, secret: "startup private/value" },
  { late: true, secret: "declared-startup-private-value" },
  { late: true, secret: "browser_profile" },
])(
  "excludes declared startup secrets across opening cleanup and retries: %j",
  async ({ late, secret }) => {
    const scenario = browserScenarioSchema.parse({
      browser: { mode: "launch", executable_path: process.execPath },
      start_url: { url: "https://app.test/" },
      actions: [
        { step_id: "wait", action: "wait_for_timeout", duration_ms: 1 },
      ],
      secrets: [
        { secret_id: "credential", environment_variable: "REA_STARTUP_SECRET" },
      ],
    });
    const diagnosticSecret = encodeURIComponent(secret).replace(
      /%[0-9A-F]{2}/gu,
      (escape) => escape.toLowerCase(),
    );
    let blocked = true;
    let closeCalls = 0;
    const context = {
      // An unusable launch reply fails before a PlaywrightScenarioSession exists.
      browser: () => null,
      close: async () => {
        closeCalls += 1;
        if (blocked)
          throw new Error(`startup cleanup failed ${diagnosticSecret}`);
      },
    } as unknown as BrowserContext;
    let finishOpening: () => void = () => undefined;
    const opening = new Promise<void>((resolve) => {
      finishOpening = resolve;
    });
    let launchStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      launchStarted = resolve;
    });
    const launch = vi
      .spyOn(chromium, "launchPersistentContext")
      .mockImplementation(async () => {
        launchStarted();
        if (late) await opening;
        return context;
      });
    const provider = createBrowserScenarioProvider({
      REA_STARTUP_SECRET: secret,
    });
    if (provider.close === undefined)
      throw new Error("Production scenario provider must expose cleanup");
    const closeProvider = provider.close.bind(provider);
    const cancellation = new AbortController();
    const reason = { caller: "cancelled opening" };
    let capturing: ReturnType<typeof captureBrowserScenario> | undefined;
    await withVerifierCleanup(async () => {
      capturing = captureBrowserScenario(provider, scenario, {
        signal: cancellation.signal,
      });
      await awaitAcknowledgement(started, capturing, "browser launch");
      if (late) cancellation.abort(reason);
      const result = await capturing;
      if (result.ok) throw new Error("Expected startup failure");
      expect(result.error.cleanupIncomplete).toBe(true);
      const initialProjection = JSON.stringify(
        projectAnalysisError(result.error),
      );
      expect(initialProjection).not.toContain(secret);
      expect(initialProjection).not.toContain(diagnosticSecret);
      if (!late && secret === "browser_profile")
        expect(result.error.cleanupResources).toContain(
          "[REDACTED:credential]",
        );
      if (late) {
        expect(primaryAnalysisError(result.error).cause).toBe(reason);
        expect(projectAnalysisError(result.error).code).toBe(
          "cleanup_incomplete",
        );
        finishOpening();
      }
      let retry: unknown;
      try {
        await closeProvider();
      } catch (error) {
        retry = error;
      }
      if (!(retry instanceof AnalysisError))
        throw new Error("Expected retained startup cleanup failure");
      expect(retry.cleanupIncomplete).toBe(true);
      const retryProjection = JSON.stringify(projectAnalysisError(retry));
      expect(retryProjection).not.toContain(secret);
      expect(retryProjection).not.toContain(diagnosticSecret);
      if (secret === "browser_profile")
        expect(retry.cleanupResources).toContain("[REDACTED:credential]");
      expect(closeCalls).toBeGreaterThan(0);
      blocked = false;
      await closeProvider();
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(retry.cleanupIncomplete).toBe(false);
      expect(result.error.cleanupResources).toEqual([]);
    }, [
      () => {
        blocked = false;
        finishOpening();
      },
      async () => {
        await capturing;
      },
      closeProvider,
      () => launch.mockRestore(),
    ]);
  },
);

it.each([false, true])(
  "preserves the original startup failure when no effective secret is declared: %s",
  async (emptyDeclaration) => {
    const scenario = browserScenarioSchema.parse({
      browser: { mode: "launch", executable_path: process.execPath },
      start_url: { url: "https://app.test/" },
      actions: [
        { step_id: "wait", action: "wait_for_timeout", duration_ms: 1 },
      ],
      secrets: emptyDeclaration
        ? [{ secret_id: "empty", environment_variable: "REA_EMPTY_SECRET" }]
        : [],
    });
    const original = new BrowserObservationError(
      "capture_browser_scenario",
      "protocol_error",
      { detail: "ordinary observed startup failure" },
    );
    const close = vi.fn(async () => undefined);
    const launch = vi
      .spyOn(chromium, "launchPersistentContext")
      .mockResolvedValue({
        browser: () => {
          throw original;
        },
        close,
      } as unknown as BrowserContext);
    try {
      await expect(
        PlaywrightScenarioSession.open(scenario, { REA_EMPTY_SECRET: "" }, {}),
      ).rejects.toBe(original);
      expect(close).toHaveBeenCalledOnce();
      expect(original.cleanupIncomplete).toBe(false);
    } finally {
      launch.mockRestore();
    }
  },
);
