import { expect, it } from "vitest";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { createAnalysisProfile } from "../../domain/analysisProfile.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import { err, ok } from "../../domain/result.js";
import { createAnalysisExecution } from "../AnalysisProvider.js";
import { AnalysisProviderRegistry } from "./AnalysisProviderRegistry.js";
import { BinarySession } from "./BinarySession.js";
import {
  SessionProviderRouter,
  type SessionProviderRoute,
} from "./SessionProviderRouter.js";

it.each([
  { cancelled: false, cleanupFails: false },
  { cancelled: true, cleanupFails: false },
  { cancelled: false, cleanupFails: true },
  { cancelled: true, cleanupFails: true },
])(
  "retains failed restoration after switch cancellation=$cancelled, cleanup failure=$cleanupFails",
  async ({ cancelled, cleanupFails }) => {
    const session = new BinarySession(
      SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), []),
    );
    const controller = new AbortController();
    const identity = {
      id: "restoration-test",
      name: "Restoration test",
      version: "1",
    };
    const restorationFailure = new AnalysisOutputError(
      "health",
      "Previous target could not restart",
    );
    const switchFailure = new AnalysisOutputError(
      "health",
      "Selected target could not start",
    );
    const cleanupFailure = new ProviderCleanupError(
      identity.id,
      ["restored-client"],
      { reason: "close failed" },
    );
    let created = 0;
    let restorationCloseCalls = 0;
    const route: SessionProviderRoute = {
      identity,
      capabilities: new Map(),
      profile: createAnalysisProfile(identity, { fixture: "original" }),
      binding: null,
      selection: undefined,
      createClient: () => {
        const restoring = created++ > 0;
        return {
          execute: async () =>
            restoring
              ? err(restorationFailure)
              : ok(createAnalysisExecution(null, identity)),
          close: async () => {
            if (!restoring) {
              if (cancelled) controller.abort("cancel switch");
              return ok(null);
            }
            restorationCloseCalls += 1;
            if (cleanupFails && restorationCloseCalls === 1)
              return err(cleanupFailure);
            cleanupFailure.resolveCleanup();
            return ok(null);
          },
        };
      },
    };
    try {
      const target = await session.resolveTarget(process.execPath);
      expect(target.ok).toBe(true);
      if (!target.ok) return;
      expect(
        (await session.openResolvedTarget({ target: target.value, route })).ok,
      ).toBe(true);
      expect(session.activeTarget()).toEqual(target.value);
      const result = await session.openResolvedTarget(
        {
          target: target.value,
          route: {
            ...route,
            profile: createAnalysisProfile(identity, { fixture: "selected" }),
            createClient: () => ({
              execute: async () => err(switchFailure),
              close: async () => ok(null),
            }),
          },
        },
        { signal: controller.signal },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(session.activeTarget()).toBeUndefined();
      expect(await session.status()).toMatchObject({
        open: false,
        cleanup_pending: cleanupFails,
      });
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: cleanupFails
          ? "cleanup_incomplete"
          : cancelled
            ? "cancelled"
            : "unreadable_output",
      });
      expect((await session.close()).ok).toBe(true);
      expect(restorationCloseCalls).toBe(cleanupFails ? 2 : 1);
      expect(await session.status()).toMatchObject({
        open: false,
        cleanup_pending: false,
      });
      expect(projectAnalysisError(result.error).code).toBe(
        cancelled ? "cancelled" : "unreadable_output",
      );
      expect(projectAnalysisError(result.error)).toMatchObject({
        details: {
          diagnostics: {
            restoration_error: projectAnalysisError(restorationFailure),
          },
        },
      });
      if (cancelled) {
        const primary = result.error.cleanupPrimary ?? result.error;
        expect(primary).toBeInstanceOf(AnalysisCancelledError);
      } else {
        expect(result.error.cleanupPrimary ?? result.error).toBe(switchFailure);
      }
    } finally {
      await session.close();
    }
  },
);
