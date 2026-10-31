import { writeFile } from "node:fs/promises";

/** @implements {import("vitest/node").Reporter} */
export default class TestTimingReporter {
  /**
   * @param {ReadonlyArray<import("vitest/node").TestModule>} modules
   * @param {ReadonlyArray<import("vitest/node").SerializedError>} errors
   * @param {import("vitest/node").TestRunEndReason} reason
   */
  async onTestRunEnd(modules, errors, reason) {
    const files = modules.map((module) => {
      const diagnostic = module.diagnostic();
      // These disjoint phases match Vitest's per-file wall-time accounting.
      // Import timings already include transform waits; do not add them again.
      const phases = {
        execution: diagnostic.duration,
        preparation: diagnostic.prepareDuration,
        environment: diagnostic.environmentSetupDuration,
        imports: diagnostic.collectDuration,
        setup: diagnostic.setupDuration,
      };
      return {
        name: module.moduleId,
        state: module.state(),
        durationMs: Object.values(phases).reduce(
          (total, value) => total + value,
          0,
        ),
        phases,
      };
    });
    await writeFile(
      "test-timings.json",
      JSON.stringify({
        version: 1,
        success: reason === "passed" && errors.length === 0,
        reason,
        unhandledErrors: errors.length,
        files,
      }),
    );
  }
}
