import { ApktoolCommandCleanup } from "./ApktoolCommandCleanup.js";
import { afterEach, expect, it } from "vitest";

import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import {
  awaitApktoolOperation,
  createApktoolProcessFixture,
} from "../../tests/fixtures/apktoolProcessTree.js";
import { observePosixProcess } from "../../tests/support/process/observePosixProcess.js";
import { inspectApktoolClient } from "./ApktoolConfiguration.js";

// The interpreter is the test runtime itself, so its environment (and the
// ownership run token) is readable on both Linux and macOS.
it.skipIf(process.platform === "win32")(
  "stops an interpreter launcher and its pipe-holding child when the probe is cancelled",
  async () => {
    const root = await createTestTempDirectory("rea-apktool-probe-");
    const fixture = await createApktoolProcessFixture(root, "probe");
    const controller = new AbortController();
    const started = performance.now();
    const probe = inspectApktoolClient(
      { command: fixture.command, commandSource: "environment" },
      commands,
      { signal: controller.signal, environment: process.env },
    ).catch((cause: unknown) => cause);
    try {
      let launched: readonly number[] = [];
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
          { timeout: 10_000, interval: 25 },
        )
        .toBe(true);
      controller.abort();
      // A regressed probe never settles; bound the wait so cleanup still runs.
      const outcome = await awaitApktoolOperation(probe, 15_000);
      expect(outcome).toBeInstanceOf(AnalysisCancelledError);
      expect(performance.now() - started).toBeLessThan(15_000);
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
      controller.abort();
      await fixture.cleanup([probe]);
    }
  },
  30_000,
);

let commands = new ApktoolCommandCleanup();
afterEach(async () => {
  await commands.close();
  commands = new ApktoolCommandCleanup();
});
