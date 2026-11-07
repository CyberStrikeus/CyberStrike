import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";

import {
  awaitApktoolOperation,
  createApktoolProcessFixture,
} from "../../fixtures/apktoolProcessTree.js";
import { observePosixProcess } from "../../support/process/observePosixProcess.js";
import { ApktoolProvider } from "../../../src/apktool/ApktoolProvider.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const DECODE_TIMEOUT_MS = 2_500;

// Windows Job Object cleanup is a separate owned-command lane. This observes
// the POSIX process group the apktool decode launcher actually uses.
it.skipIf(process.platform === "win32")(
  "stops a hanging launcher and its pipe-holding child when the decode deadline elapses",
  async () => {
    const root = await createTestTempDirectory("rea-apktool-decode-deadline-");
    const fixture = await createApktoolProcessFixture(root, "decode");
    const apk = join(root, "probe.apk");
    await writeFile(apk, "apk-bytes");
    const provider = new ApktoolProvider({
      environment: { REA_APKTOOL_COMMAND: fixture.command },
    });
    const started = performance.now();
    const pending = provider.execute({
      operation: "decode_android_resources",
      input: {
        path: apk,
        include_strings: false,
        decode_timeout_ms: DECODE_TIMEOUT_MS,
      },
    });
    let launched: readonly number[] = [];
    try {
      await expect
        .poll(
          async () => {
            const marker = await fixture.readMarker();
            if (marker?.ready !== true) return false;
            launched = [marker.rootPid, marker.childPid];
            return (await Promise.all(launched.map(observePosixProcess))).every(
              ({ kind }) => kind === "running",
            );
          },
          { timeout: 8_000, interval: 25 },
        )
        .toBe(true);
      const outcome = await awaitApktoolOperation(pending, 15_000);
      const elapsed = performance.now() - started;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error.cleanupIncomplete).toBe(false);
      const projected = projectAnalysisError(outcome.error);
      expect(projected).toMatchObject({
        code: "provider_timeout",
        details: { timeout_ms: DECODE_TIMEOUT_MS },
      });
      expect(projected.message).toContain(`${String(DECODE_TIMEOUT_MS)} ms`);
      expect(projected.remediation.action).toContain("decode_timeout_ms");
      expect(projected.remediation.action).toContain("next decode");
      // Settlement includes the owned-command deadline, so the timer elapsed.
      expect(elapsed).toBeGreaterThanOrEqual(DECODE_TIMEOUT_MS - 50);
      expect(elapsed).toBeLessThan(15_000);
      await expect
        .poll(
          async () =>
            (await Promise.all(launched.map(observePosixProcess))).every(
              ({ kind }) => kind !== "running",
            ),
          { timeout: 5_000, interval: 25 },
        )
        .toBe(true);
    } finally {
      await fixture.cleanup([pending, provider.close()]);
    }
  },
  30_000,
);
