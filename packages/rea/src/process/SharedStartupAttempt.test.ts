import { expect, it } from "vitest";

import { createDeferred } from "../../tests/fixtures/binarySession.js";
import {
  SharedStartupAttempt,
  STARTUP_OWNER_CLOSED,
} from "./SharedStartupAttempt.js";

it("keeps shared startup running for an interested peer", async () => {
  const completed = createDeferred<string>();
  const attempt = new SharedStartupAttempt(() => completed.promise);
  const controller = new AbortController();
  const departing = attempt.wait(controller.signal);
  const staying = attempt.wait();
  controller.abort();
  await expect(departing).resolves.toEqual({ status: "cancelled" });
  expect(attempt.signal.aborted).toBe(false);
  completed.resolve("ready");
  await expect(staying).resolves.toEqual({
    status: "completed",
    value: "ready",
  });
});

it("retains the final cleanup result when all callers cancel together", async () => {
  const cleanup = createDeferred<{ cleanupIncomplete: boolean }>();
  const attempt = new SharedStartupAttempt(() => cleanup.promise);
  const first = new AbortController();
  const last = new AbortController();
  const waits = [attempt.wait(first.signal), attempt.wait(last.signal)];
  first.abort();
  last.abort();
  await expect(waits[0]).resolves.toEqual({ status: "cancelled" });
  expect(attempt.signal.aborted).toBe(true);
  expect(attempt.settled).toBe(false);
  const failure = { cleanupIncomplete: true };
  cleanup.resolve(failure);
  await expect(waits[1]).resolves.toEqual({
    status: "stopped",
    value: failure,
  });
  expect(attempt.settled).toBe(true);
});

it("distinguishes provider closure from a caller's cancellation", async () => {
  const cleanup = createDeferred<string>();
  const attempt = new SharedStartupAttempt(() => cleanup.promise);
  const controller = new AbortController();
  const waiting = attempt.wait(controller.signal);
  attempt.close();
  expect(attempt.signal.reason).toBe(STARTUP_OWNER_CLOSED);
  expect(controller.signal.aborted).toBe(false);
  cleanup.resolve("provider stopped");
  await expect(waiting).resolves.toEqual({
    status: "completed",
    value: "provider stopped",
  });
});

it("does not lose an unexpected producer rejection after its final caller cancels", async () => {
  let reject: ((cause: unknown) => void) | undefined;
  const promise = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  const attempt = new SharedStartupAttempt(() => promise);
  const controller = new AbortController();
  const waiting = attempt.wait(controller.signal);
  controller.abort();
  const cause = new TypeError("Cleanup rejected");
  reject?.(cause);
  await expect(waiting).rejects.toBe(cause);
});

it.each(["caller", "owner"])(
  "preserves %s interruption when owning cancellation and closure occur together",
  async (first) => {
    const completed = createDeferred<string>();
    const controller = new AbortController();
    const reason = { caller: "operation owner" };
    const attempt = new SharedStartupAttempt(
      () => completed.promise,
      controller.signal,
    );
    const waiting = attempt.wait();
    if (first === "caller") {
      controller.abort(reason);
      attempt.close();
    } else {
      attempt.close();
      expect(attempt.signal.aborted).toBe(true);
      expect(attempt.signal.reason).toBe(STARTUP_OWNER_CLOSED);
      controller.abort(reason);
    }
    expect(attempt.signal.reason).toBe(
      first === "caller" ? reason : STARTUP_OWNER_CLOSED,
    );
    expect(attempt.settled).toBe(false);
    completed.resolve("finalized");
    await expect(waiting).resolves.toEqual({
      status: "completed",
      value: "finalized",
    });
  },
);
