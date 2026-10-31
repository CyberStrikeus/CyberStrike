import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { delayWithCancellation } from "./CdpCaptureValues.js";

describe("cancellable browser observation delays", () => {
  afterEach(() => vi.useRealTimers());

  it("schedules durations beyond the native timer range in consecutive waits", async () => {
    vi.useFakeTimers();
    let completed = false;
    const waiting = delayWithCancellation(
      2_147_483_648,
      "observe_javascript_runtime",
    ).then(() => {
      completed = true;
    });

    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(completed).toBe(false);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(completed).toBe(true);
  });

  it("preserves exact cancellation reasons before and during a capture wait", async () => {
    const preAbortedReason = { _tag: "pre-aborted" };
    const preAborted = new AbortController();
    preAborted.abort(preAbortedReason);
    const beforeStart = await delayWithCancellation(
      1,
      "observe_web_execution",
      preAborted.signal,
    ).catch((error: unknown) => error);

    expect(beforeStart).toBeInstanceOf(AnalysisCancelledError);
    expect(beforeStart).toMatchObject({ cause: preAbortedReason });

    vi.useFakeTimers();
    const reason = new Error("capture wait cancelled");
    const active = new AbortController();
    const waiting = delayWithCancellation(
      10_000,
      "observe_web_execution",
      active.signal,
    ).catch((error: unknown) => error);
    active.abort(reason);
    const duringWait = await waiting;

    expect(duringWait).toBeInstanceOf(AnalysisCancelledError);
    expect(duringWait).toMatchObject({ cause: reason });
    expect(vi.getTimerCount()).toBe(0);
  });
});
