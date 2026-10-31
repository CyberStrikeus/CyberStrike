import { setImmediate } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { completeJavaScriptAnalysisSteps } from "./JavaScriptAnalysisControl.js";

describe("JavaScript cooperative computation lifecycle", () => {
  it("observes scheduler cancellation and closes abandoned work", async () => {
    const controller = new AbortController();
    const reason = { request: "caller cancelled computation" };
    let released = false;
    function* work(): Generator<void, number> {
      try {
        for (;;) yield;
      } finally {
        released = true;
      }
    }
    const cancellation = setImmediate().then(() => controller.abort(reason));
    await expect(
      completeJavaScriptAnalysisSteps(work(), controller.signal),
    ).rejects.toMatchObject({ reason: "cancelled", cause: reason });
    await cancellation;
    expect(released).toBe(true);
  });

  it("does not start pre-cancelled work and preserves completed values", async () => {
    const controller = new AbortController();
    const reason = { request: "caller cancelled computation" };
    controller.abort(reason);
    let started = false;
    function* work(): Generator<void, number> {
      started = true;
      yield;
      return 42;
    }
    await expect(
      completeJavaScriptAnalysisSteps(work(), controller.signal),
    ).rejects.toMatchObject({ reason: "cancelled", cause: reason });
    expect(started).toBe(false);
    expect(await completeJavaScriptAnalysisSteps(work())).toBe(42);
  });
});
