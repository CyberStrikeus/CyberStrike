import { expect } from "vitest";

import { processScenarioSchema } from "../../../src/domain/process/processScenario.js";
import { captureProcessScenario } from "../../../src/process/capture/ProcessHarness.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { itWithCaptureCapability } from "./processCaptureCapability.js";

itWithCaptureCapability(
  "retains completed capture facts and the exact reason when cleanup reporting cancels",
  async () => {
    const root = await createTestTempDirectory("rea-capture-reason-");
    const controller = new AbortController();
    const reason = { request: "cancel after cleanup completed" };
    let cleanupReported = false;
    const result = await captureProcessScenario(
      processScenarioSchema.parse({
        executable: process.execPath,
        arguments: ["--eval", "console.log('completed capture')"],
        working_directory: root,
        settle_ms: 0,
      }),
      controller.signal,
      process.platform,
      process.env,
      undefined,
      undefined,
      {
        report: async (update) => {
          if (update.phase === "cleanup" && update.terminal === true) {
            cleanupReported = true;
            controller.abort(reason);
          }
        },
      },
    );
    expect(cleanupReported).toBe(true);
    if (result.ok) throw new Error("Expected finalization cancellation");
    expect(result.error.cause).toBe(reason);
    expect(result.error).toMatchObject({
      reason: "cancelled",
      partialObservation: {
        capture: { exit: { code: 0 } },
        cleanup: { temporary_root: { state: "cleaned" } },
      },
    });
  },
  20_000,
);
