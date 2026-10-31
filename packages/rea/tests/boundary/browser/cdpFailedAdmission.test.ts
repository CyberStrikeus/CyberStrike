import { expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import { CdpConnection } from "../../../src/browser/CdpConnection.js";
import {
  attachCdpTargetSession,
  openCdpEndpoint,
} from "../../../src/browser/CdpTargetSession.js";
import { PlaywrightScenarioServiceWorkers } from "../../../src/browser/PlaywrightScenarioServiceWorkers.js";
import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { BrowserObservationError } from "../../../src/domain/browserObservationError.js";
import { browserObservationEndpointSchema } from "../../../src/domain/browserObservation.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";

it.each(["Target.getTargets", "Target.attachToTarget"])(
  "retains %s setup failure and retries the exact policy transport after rejected close",
  async (method) => {
    for (const failClose of [false, true]) {
      const browser = await startFakeCdpBrowser({
        commandError: (command) =>
          command.method === method
            ? { code: -32000, message: "controlled primary failure" }
            : undefined,
      });
      let reject = failClose;
      const original = CdpConnection.prototype.close;
      const close = vi
        .spyOn(CdpConnection.prototype, "close")
        .mockImplementation(async function (this: CdpConnection) {
          await original.call(this);
          if (reject) {
            reject = false;
            throw new BrowserObservationError(
              "capture_browser_scenario",
              "cleanup_failed",
              { detail: "controlled close failure" },
            );
          }
        });
      const page = {
        frames: () => [{ evaluate: async () => null, isDetached: () => false }],
        isClosed: () => true,
      } as unknown as Page;
      const policy = new PlaywrightScenarioServiceWorkers(
        page,
        browser.browserWebSocketUrl,
        "allowed-page",
      );
      try {
        const failure: unknown = await policy
          .initialize()
          .catch((cause: unknown) => cause);
        expect(failure).toBeInstanceOf(AnalysisError);
        if (!(failure instanceof AnalysisError))
          throw new Error("Expected typed setup failure");
        expect(projectAnalysisError(failure).message).toContain(
          `${method} failed`,
        );
        expect(projectAnalysisError(failure).message).toContain(
          "controlled primary failure",
        );
        expect(failure.cleanupIncomplete).toBe(failClose);
        if (failClose)
          expect(failure.cleanupPrimary).toMatchObject({
            reason: "protocol_error",
          });
        expect(close).toHaveBeenCalledTimes(1);
        await policy.close();
        expect(close).toHaveBeenCalledTimes(failClose ? 2 : 1);
        expect(failure.cleanupIncomplete).toBe(false);
      } finally {
        await policy.close();
        close.mockRestore();
        await browser.close();
      }
    }
  },
);

it.each(["Target.getTargets", "Target.attachToTarget"])(
  "also composes rejected close with %s failure for an ownerless caller",
  async (method) => {
    const browser = await startFakeCdpBrowser({
      commandError: (command) =>
        command.method === method
          ? { code: -32000, message: "ownerless primary failure" }
          : undefined,
    });
    const original = CdpConnection.prototype.close;
    const close = vi
      .spyOn(CdpConnection.prototype, "close")
      .mockImplementation(async function (this: CdpConnection) {
        await original.call(this);
        throw new BrowserObservationError(
          "capture_browser_scenario",
          "cleanup_failed",
          { detail: "ownerless close failure" },
        );
      });
    try {
      const admission = async () => {
        const opened = await openCdpEndpoint(
          browserObservationEndpointSchema.parse(browser.browserWebSocketUrl),
          "capture_browser_scenario",
        );
        const target = opened.discovery.targets.find(
          ({ id }) => id === "allowed-page",
        );
        if (opened.connection === undefined || target === undefined)
          throw new Error("Missing fixture target");
        return await attachCdpTargetSession(
          opened.connection,
          target,
          "capture_browser_scenario",
        );
      };
      const failure: unknown = await admission().catch(
        (cause: unknown) => cause,
      );
      expect(failure).toBeInstanceOf(AnalysisError);
      if (!(failure instanceof AnalysisError))
        throw new Error("Expected typed admission failure");
      expect(failure.cleanupPrimary).toMatchObject({
        reason: "protocol_error",
      });
      expect(projectAnalysisError(failure).message).toContain(
        "ownerless primary failure",
      );
      expect(failure.cleanupIncomplete).toBe(true);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      close.mockRestore();
      await browser.close();
    }
  },
);
