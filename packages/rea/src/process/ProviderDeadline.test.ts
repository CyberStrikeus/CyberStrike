import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderStartupDeadline } from "./ProviderDeadline.js";

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each([-3_600_000, 3_600_000])(
  "keeps the elapsed budget when the wall clock jumps by %i ms",
  async (jump) => {
    const deadline = new ProviderStartupDeadline(1000);
    try {
      await vi.advanceTimersByTimeAsync(250);
      vi.setSystemTime(Date.now() + jump);
      expect(deadline.remainingMs()).toBe(750);
      expect(deadline.interruption).toBeUndefined();
      expect(deadline.signal.aborted).toBe(false);
      const waiting = deadline.wait(2000);
      await vi.advanceTimersByTimeAsync(749);
      expect(deadline.interruption).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await expect(waiting).resolves.toBe("aborted");
      expect(deadline.interruption).toBe("timeout");
      expect(deadline.remainingMs()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      deadline.dispose();
    }
  },
);

it("preserves caller cancellation after a forward wall-clock correction", async () => {
  const controller = new AbortController();
  const reason = new Error("caller cancelled");
  const deadline = new ProviderStartupDeadline(1000, controller.signal);
  try {
    const waiting = deadline.wait(1000);
    await vi.advanceTimersByTimeAsync(100);
    vi.setSystemTime(Date.now() + 3_600_000);
    controller.abort(reason);
    await expect(waiting).resolves.toBe("aborted");
    expect(deadline.interruption).toBe("cancelled");
    expect(deadline.signal.reason).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    deadline.dispose();
  }
});

it("does not revive an expired budget after the wall clock moves backward", async () => {
  const deadline = new ProviderStartupDeadline(1000);
  try {
    await vi.advanceTimersByTimeAsync(1000);
    vi.setSystemTime(Date.now() - 3_600_000);
    expect(deadline.remainingMs()).toBe(0);
    expect(deadline.interruption).toBe("timeout");
    await expect(deadline.wait(1000)).resolves.toBe("aborted");
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    deadline.dispose();
  }
});

it("classifies elapsed time before a delayed timer callback and a later abort", () => {
  const controller = new AbortController();
  const deadline = new ProviderStartupDeadline(1000, controller.signal);
  try {
    // Model an event-loop stall: elapsed time advanced, but timers have not run.
    vi.spyOn(performance, "now").mockReturnValue(1001);
    vi.setSystemTime(Date.now() - 3_600_000);
    expect(deadline.interruption).toBe("timeout");
    expect(deadline.remainingMs()).toBe(0);
    controller.abort();
    expect(deadline.interruption).toBe("timeout");
    expect(deadline.signal.reason).toMatchObject({ name: "TimeoutError" });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    deadline.dispose();
  }
});

it("keeps remaining milliseconds integral for downstream request budgets", () => {
  const now = vi.spyOn(performance, "now").mockReturnValue(10.25);
  const deadline = new ProviderStartupDeadline(1000);
  try {
    now.mockReturnValue(260.5);
    expect(deadline.remainingMs()).toBe(750);
    now.mockReturnValue(1010.2);
    expect(deadline.remainingMs()).toBe(1);
    expect(deadline.interruption).toBeUndefined();
    now.mockReturnValue(1010.25);
    expect(deadline.remainingMs()).toBe(0);
    expect(deadline.interruption).toBe("timeout");
  } finally {
    deadline.dispose();
  }
});

it("keeps remaining time and cancellation classification stable across wall-clock jumps", () => {
  const dateNow = vi.spyOn(Date, "now").mockReturnValue(10_000);
  const caller = new AbortController();
  const deadline = new ProviderStartupDeadline(10_000, caller.signal);
  try {
    dateNow.mockReturnValue(9_000_000_000_000);
    const remaining = deadline.remainingMs();
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(10_000);
    expect(Number.isInteger(remaining)).toBe(true);
    expect(deadline.interruption).toBeUndefined();
    caller.abort(new Error("caller stopped startup"));
    expect(deadline.interruption).toBe("cancelled");
  } finally {
    deadline.dispose();
  }
});

it("aborts a bounded wait when its real monotonic deadline expires", async () => {
  vi.useRealTimers();
  const deadline = new ProviderStartupDeadline(40);
  try {
    await expect(deadline.wait(500)).resolves.toBe("aborted");
    expect(deadline.interruption).toBe("timeout");
    expect(deadline.remainingMs()).toBe(0);
  } finally {
    deadline.dispose();
  }
});

it("does not expire a future monotonic deadline on an early timer callback", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let monotonic = 0;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  const deadline = new ProviderStartupDeadline(40);
  try {
    monotonic = 39;
    await vi.advanceTimersByTimeAsync(40);
    expect(deadline.remainingMs()).toBe(1);
    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.interruption).toBeUndefined();
  } finally {
    deadline.dispose();
    vi.useRealTimers();
  }
});

it("aborts when the re-armed timer reaches the absolute deadline", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let monotonic = 0;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  const deadline = new ProviderStartupDeadline(40);
  try {
    monotonic = 39;
    await vi.advanceTimersByTimeAsync(40);
    expect(deadline.signal.aborted).toBe(false);
    monotonic = 40;
    await vi.advanceTimersByTimeAsync(1);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.interruption).toBe("timeout");
    expect(deadline.remainingMs()).toBe(0);
  } finally {
    deadline.dispose();
    vi.useRealTimers();
  }
});

it("reports a wait that resolves at the deadline as aborted, not elapsed", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let monotonic = 0;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  const deadline = new ProviderStartupDeadline(40);
  try {
    const pending = deadline.wait(500);
    monotonic = 40;
    await vi.advanceTimersByTimeAsync(40);
    await expect(pending).resolves.toBe("aborted");
  } finally {
    deadline.dispose();
    vi.useRealTimers();
  }
});

it("resolves a polling interval shorter than the budget as elapsed", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let monotonic = 0;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  const deadline = new ProviderStartupDeadline(40);
  try {
    const pending = deadline.wait(10);
    monotonic = 10;
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toBe("elapsed");
    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.remainingMs()).toBe(30);
  } finally {
    deadline.dispose();
    vi.useRealTimers();
  }
});

it("keeps caller cancellation classified without reporting an exhausted budget", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let monotonic = 0;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  const caller = new AbortController();
  const deadline = new ProviderStartupDeadline(40, caller.signal);
  try {
    monotonic = 20;
    caller.abort(new Error("caller stopped startup"));
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.interruption).toBe("cancelled");
    expect(deadline.remainingMs()).toBe(20);
  } finally {
    deadline.dispose();
    vi.useRealTimers();
  }
});

// Probe from issue #2760 review: both the abort timer and the clamped polling
// timer can fire early at the same monotonic instant. The full-budget wait must
// stay pending until the absolute deadline expires.
it("keeps a full-budget wait pending when both timers fire early", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let monotonic = 0;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  const caller = new AbortController();
  const deadline = new ProviderStartupDeadline(40, caller.signal);
  let outcome: string | undefined;
  const pending = deadline.wait(500).then((result) => {
    outcome = result;
    return result;
  });
  try {
    monotonic = 39;
    await vi.advanceTimersByTimeAsync(40);
    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.remainingMs()).toBe(1);
    expect(outcome).toBeUndefined();
    monotonic = 40;
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe("aborted");
    expect(deadline.remainingMs()).toBe(0);
  } finally {
    caller.abort();
    deadline.dispose();
    vi.useRealTimers();
  }
});

it("releases the timer and listener on dispose with a pending wait", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let monotonic = 0;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  const caller = new AbortController();
  const deadline = new ProviderStartupDeadline(40, caller.signal);
  try {
    const pending = deadline.wait(500);
    deadline.dispose();
    // The external abort listener is removed: caller cancellation after
    // dispose must not abort the deadline or classify it as cancelled.
    caller.abort(new Error("caller stopped startup"));
    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.interruption).toBeUndefined();
    monotonic = 100;
    await vi.advanceTimersByTimeAsync(100);
    expect(deadline.signal.aborted).toBe(false);
    // The deadline expired while disposed, so the clamped wait resolves
    // "aborted" from the monotonic clock instead of polling past expiry.
    await expect(pending).resolves.toBe("aborted");
  } finally {
    deadline.dispose();
    vi.useRealTimers();
  }
});

// Retain the authored terminal-budget regression under the newer monotonic
// expiry policy and re-arm contract for an early native timer callback.
it("reports no remaining time after terminal expiry near the monotonic boundary", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
  const deadline = new ProviderStartupDeadline(40);
  try {
    now.mockReturnValue(1_039.6);
    await vi.advanceTimersByTimeAsync(40);
    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.remainingMs()).toBe(1);
    now.mockReturnValue(1_040);
    await vi.advanceTimersByTimeAsync(1);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.interruption).toBe("timeout");
    // A terminal timeout stays terminal even if the monotonic source is
    // observed below its deadline after the abort timer has fired.
    now.mockReturnValue(1_039);
    expect(deadline.remainingMs()).toBe(0);
  } finally {
    deadline.dispose();
    vi.useRealTimers();
  }
});
