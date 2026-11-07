import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HopperCancelledError,
  HopperProtocolError,
} from "../domain/hopperErrors.js";
import { ok } from "../domain/result.js";
import { HopperRequestQueue } from "./HopperRequestQueue.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HopperRequestQueue deadlines", () => {
  it("times out active callers while retaining the wire until the late reply", async () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const queue = new HopperRequestQueue(({ id }) => sent.push(id));
    const result = vi.fn();
    const pending = queue
      .run(1, "analyze_function", {}, { timeoutMs: 25 })
      .then(result);
    const next = queue.run(2, "echo", {}, {});
    await vi.advanceTimersByTimeAsync(25);
    expect(result).toHaveBeenCalledWith({
      ok: false,
      error: expect.objectContaining({
        _tag: "HopperTimeoutError",
        timeoutMs: 25,
        operation: "analyze_function",
        requestId: 1,
        providerState: "busy",
      }),
    });
    expect(sent).toEqual([1]);
    expect(queue.activity()).toMatchObject({
      callerState: "cancelled",
      queuedRequests: 1,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(queue.accept(1, ok("late"))).toBe(true);
    expect(sent).toEqual([1, 2]);
    queue.accept(2, ok("next"));
    await pending;
    await expect(next).resolves.toEqual(ok("next"));
    expect(result).toHaveBeenCalledTimes(1);
    expect(queue.activity()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("expires a queued request without transmitting it", async () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const queue = new HopperRequestQueue(({ id }) => sent.push(id));
    const active = queue.run(1, "active", {}, {});
    const settled = vi.fn();
    const queued = queue.run(2, "queued", {}, { timeoutMs: 10 }).then(settled);
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          _tag: "HopperTimeoutError",
          requestId: 2,
          providerState: "not_started",
        }),
      }),
    );
    expect(queue.hasQueued(2)).toBe(false);
    queue.accept(1, ok(null));
    await Promise.all([active, queued]);
    expect(sent).toEqual([1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans deadline and abort observers on success before the deadline", async () => {
    vi.useFakeTimers();
    const queue = new HopperRequestQueue(() => {});
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const settled = vi.fn();
    const pending = queue
      .run(1, "echo", {}, { timeoutMs: 25, signal: controller.signal })
      .then(settled);
    queue.accept(1, ok(42));
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(settled).toHaveBeenCalledExactlyOnceWith(ok(42));
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps explicit cancellation distinct from a later timeout", async () => {
    vi.useFakeTimers();
    const queue = new HopperRequestQueue(() => {});
    const controller = new AbortController();
    const pending = queue.run(
      1,
      "echo",
      {},
      { timeoutMs: 25, signal: controller.signal },
    );
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { cause: controller.signal.reason },
    });
    expect(vi.getTimerCount()).toBe(0);
    queue.accept(1, ok(null));
    await vi.advanceTimersByTimeAsync(100);
    expect(queue.activity()).toBeNull();
  });

  it("does not recreate timers when a progress observer cancels synchronously", async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const queue = new HopperRequestQueue(send);
    const controller = new AbortController();
    const reason = { source: "progress" };
    const pending = queue.run(
      1,
      "echo",
      {},
      {
        timeoutMs: 100,
        signal: controller.signal,
        progress: {
          report: () => {
            controller.abort(reason);
            return Promise.resolve();
          },
        },
      },
    );
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { cause: reason },
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(queue.activity()).toBeNull();
    const next = queue.run(2, "next", {}, {});
    expect(send).toHaveBeenCalledExactlyOnceWith(
      { id: 2, method: "next", params: {} },
      expect.any(Function),
    );
    queue.accept(2, ok(null));
    await next;
  });

  it("cleans all deadlines on teardown, including after an active timeout", async () => {
    vi.useFakeTimers();
    const queue = new HopperRequestQueue(() => {});
    const result = vi.fn();
    const active = queue.run(1, "active", {}, { timeoutMs: 10 }).then(result);
    const queued = queue.run(2, "queued", {}, { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(10);
    const failure = new HopperProtocolError("closed");
    queue.failAll(failure);
    await active;
    await expect(queued).resolves.toEqual({ ok: false, error: failure });
    expect(result).toHaveBeenCalledTimes(1);
    expect(queue.activity()).toBeNull();
    expect(queue.queuedCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("HopperRequestQueue deadline admission and races", () => {
  it("removes queued cancelled work and honours cancellation before admission", async () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const queue = new HopperRequestQueue(({ id }) => sent.push(id));
    const active = queue.run(1, "active", {}, {});
    const controller = new AbortController();
    const queued = queue.run(
      2,
      "queued",
      {},
      { timeoutMs: 100, signal: controller.signal },
    );
    controller.abort();
    await expect(queued).resolves.toMatchObject({
      ok: false,
      error: { _tag: "HopperCancelledError" },
    });
    await expect(
      queue.run(
        3,
        "pre-aborted",
        {},
        { timeoutMs: 100, signal: controller.signal },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { _tag: "HopperCancelledError" },
    });
    expect(queue.queuedCount()).toBe(0);
    queue.accept(1, ok(null));
    await active;
    expect(sent).toEqual([1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([NaN, Infinity, -1, 0.5, 2_147_483_648])(
    "rejects invalid deadline %s without sending",
    async (timeoutMs) => {
      vi.useFakeTimers();
      const send = vi.fn();
      const queue = new HopperRequestQueue(send);
      await expect(
        queue.run(1, "echo", {}, { timeoutMs }),
      ).resolves.toMatchObject({
        ok: false,
        error: { _tag: "HopperProtocolError" },
      });
      expect(send).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("expires zero deadlines without sending and settles only once if aborted afterward", async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const queue = new HopperRequestQueue(send);
    await expect(
      queue.run(1, "echo", {}, { timeoutMs: 0 }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        _tag: "HopperTimeoutError",
        timeoutMs: 0,
        providerState: "not_started",
      },
    });
    expect(send).not.toHaveBeenCalled();
    const controller = new AbortController();
    const settled = vi.fn();
    const pending = queue
      .run(2, "echo", {}, { timeoutMs: 10, signal: controller.signal })
      .then(settled);
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    queue.accept(2, ok("late"));
    await pending;
    expect(settled).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ _tag: "HopperTimeoutError" }),
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Hopper deadlines before timer dispatch", () => {
  it("does not transmit overdue queued work when the event loop delays its timer", async () => {
    vi.useFakeTimers();
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const sent: number[] = [];
    const queue = new HopperRequestQueue(({ id }) => sent.push(id));
    const active = queue.run(1, "active", {}, {});
    const expired = queue.run(2, "set_comment", {}, { timeoutMs: 10 });
    clock.mockReturnValue(20);
    queue.accept(1, ok(null));
    await expect(expired).resolves.toMatchObject({
      ok: false,
      error: {
        _tag: "HopperTimeoutError",
        operation: "set_comment",
        providerState: "not_started",
      },
    });
    await active;
    expect(sent).toEqual([1]);
    expect(queue.activity()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts an overdue active reply without turning elapsed timeout into success", async () => {
    vi.useFakeTimers();
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const sent: number[] = [];
    const queue = new HopperRequestQueue(({ id }) => sent.push(id));
    const expired = queue.run(1, "active", {}, { timeoutMs: 10 });
    const next = queue.run(2, "next", {}, {});
    clock.mockReturnValue(20);
    expect(queue.accept(1, ok("late"))).toBe(true);
    await expect(expired).resolves.toMatchObject({
      ok: false,
      error: { _tag: "HopperTimeoutError" },
    });
    expect(sent).toEqual([1, 2]);
    queue.accept(2, ok(null));
    await next;
    expect(queue.activity()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("HopperRequestQueue caller abort reasons", () => {
  const reason = { source: "caller", opaque: 7 };

  it("retains an opaque reason for a signal aborted before admission", async () => {
    const queue = new HopperRequestQueue(() => {});
    const controller = new AbortController();
    controller.abort(reason);
    const result = await queue.run(
      1,
      "echo",
      {},
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error).toBeInstanceOf(HopperCancelledError);
    expect(result.error.cause).toBe(reason);
  });

  it("retains an opaque reason when the active caller aborts", async () => {
    const sent: number[] = [];
    const queue = new HopperRequestQueue(({ id }) => sent.push(id));
    const controller = new AbortController();
    const pending = queue.run(1, "echo", {}, { signal: controller.signal });
    controller.abort(reason);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error.cause).toBe(reason);
    expect(sent).toEqual([1]);
    expect(queue.accept(1, ok(null))).toBe(true);
    expect(result.error.cause).toBe(reason);
    expect(queue.activity()).toBeNull();
  });

  it("retains an opaque reason for a queued caller without transmitting it", async () => {
    const sent: number[] = [];
    const queue = new HopperRequestQueue(({ id }) => sent.push(id));
    const active = queue.run(1, "active", {}, {});
    const controller = new AbortController();
    const queued = queue.run(2, "queued", {}, { signal: controller.signal });
    controller.abort(reason);
    const result = await queued;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error.cause).toBe(reason);
    expect(queue.hasQueued(2)).toBe(false);
    queue.accept(1, ok(null));
    await active;
    expect(sent).toEqual([1]);
  });
});

it("does not hand a waiting request to the sender until it reaches the wire", async () => {
  const sent: number[] = [];
  const queue = new HopperRequestQueue(({ id }) => sent.push(id));
  const active = queue.run(1, "active", { value: "A" }, {});
  const queued = queue.run(2, "queued", { value: "B" }, {});
  expect(sent).toEqual([1]);
  expect(queue.queuedCount()).toBe(1);
  queue.accept(1, ok(null));
  expect(sent).toEqual([1, 2]);
  queue.accept(2, ok(null));
  await active;
  await queued;
});
