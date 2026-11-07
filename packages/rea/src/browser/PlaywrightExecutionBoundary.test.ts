import { getEventListeners } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { withPlaywrightExecutionBoundary } from "./PlaywrightExecutionBoundary.js";
import {
  AnalysisCancelledError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";

describe("withPlaywrightExecutionBoundary", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rejects work that exceeds its absolute remaining duration", async () => {
    vi.useFakeTimers();
    const result = withPlaywrightExecutionBoundary(
      () => new Promise<never>(() => undefined),
      25,
    );
    const rejection =
      expect(result).rejects.toBeInstanceOf(AnalysisTimeoutError);
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
  });

  it("uses the owning policy's timeout error when its deadline expires", async () => {
    vi.useFakeTimers();
    const timeout = new AnalysisTimeoutError("capture_browser_scenario", 25, {
      userMessage: "Fixed service-worker policy deadline.",
    });
    const result = withPlaywrightExecutionBoundary(
      () => new Promise<never>(() => undefined),
      25,
      undefined,
      () => timeout,
    );
    const rejection = expect(result).rejects.toBe(timeout);
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
  });

  it("does not admit work or attach cancellation after synchronous expiry", async () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_001);
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const work = vi.fn(async () => "unreachable");

    await expect(
      withPlaywrightExecutionBoundary(work, 0.5, controller.signal),
    ).rejects.toBeInstanceOf(AnalysisTimeoutError);
    expect(work).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
  });

  it("cleans up when admitted work throws synchronously", async () => {
    vi.useFakeTimers();
    const cause = { opaque: true };
    const controller = new AbortController();
    const work = vi.fn((): Promise<never> => {
      throw cause;
    });
    const pending = withPlaywrightExecutionBoundary(
      work,
      1_000,
      controller.signal,
    );

    await expect(pending).rejects.toBe(cause);
    expect(work).toHaveBeenCalledOnce();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects when the caller cancels active work", async () => {
    const controller = new AbortController();
    const result = withPlaywrightExecutionBoundary(
      () => new Promise<never>(() => undefined),
      1_000,
      controller.signal,
    );
    controller.abort();
    await expect(result).rejects.toBeInstanceOf(AnalysisCancelledError);
  });

  it("keeps its timeout stable across a wall-clock jump", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValue(10_000_000);

    await expect(
      withPlaywrightExecutionBoundary(
        () =>
          new Promise<string>((resolve) =>
            setTimeout(() => resolve("done"), 5),
          ),
        1_000,
      ),
    ).resolves.toBe("done");
  });
});

it.each(["before", "during"] as const)(
  "keeps typed caller reasons opaque when cancelled %s work",
  async (phase) => {
    const caller = new AbortController();
    const reason = new AnalysisTimeoutError("capture_browser_scenario", 123);
    if (phase === "before") caller.abort(reason);
    const pending = withPlaywrightExecutionBoundary(
      () => new Promise<never>(() => {}),
      undefined,
      caller.signal,
    );
    if (phase === "during") caller.abort(reason);
    const error: unknown = await pending.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(AnalysisCancelledError);
    if (!(error instanceof AnalysisCancelledError))
      throw new Error("Expected typed cancellation");
    expect(error.cause).toBe(reason);
  },
);
