import { describe, expect, it } from "vitest";

import { scheduleProcessDelay } from "./ProcessTimer.js";

describe("process delay scheduling", () => {
  it("splits long delays into timer-sized chunks and can cancel the next chunk", () => {
    const scheduled: Array<{
      readonly delayMs: number;
      readonly callback: () => void;
      cancelled: boolean;
    }> = [];
    const schedule = (callback: () => void, delayMs: number) => {
      const entry = { delayMs, callback, cancelled: false };
      scheduled.push(entry);
      return { cancel: () => (entry.cancelled = true) };
    };
    let fired = false;
    const timer = scheduleProcessDelay(
      2_147_483_647 + 25,
      () => {
        fired = true;
      },
      schedule,
    );

    expect(scheduled.map(({ delayMs }) => delayMs)).toEqual([2_147_483_647]);
    scheduled[0]?.callback();
    expect(scheduled.map(({ delayMs }) => delayMs)).toEqual([
      2_147_483_647, 25,
    ]);
    expect(fired).toBe(false);

    timer.cancel();
    expect(scheduled[1]?.cancelled).toBe(true);
    scheduled[1]?.callback();
    expect(fired).toBe(false);
  });
});
