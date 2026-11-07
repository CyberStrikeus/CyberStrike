/** A timer owned by one process capture or replay endpoint. */
export interface ProcessTimer {
  cancel(): void;
}

/** Injectable timer primitive for deterministic long-delay tests. */
export type ProcessTimerScheduler = (
  callback: () => void,
  delayMs: number,
) => ProcessTimer;

const systemTimerScheduler: ProcessTimerScheduler = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return { cancel: () => clearTimeout(timer) };
};

/** Schedule a delay using consecutive Node timers without shortening long waits. */
export const scheduleProcessDelay = (
  delayMs: number,
  callback: () => void,
  schedule: ProcessTimerScheduler = systemTimerScheduler,
): ProcessTimer => {
  if (!Number.isSafeInteger(delayMs) || delayMs < 0)
    throw new RangeError("Process delay must be a nonnegative safe integer");
  const maximumTimerDelay = 2_147_483_647;
  let remaining = delayMs;
  let timer: ProcessTimer | undefined;
  let cancelled = false;

  const scheduleNext = (): void => {
    if (cancelled) return;
    const interval = Math.min(remaining, maximumTimerDelay);
    timer = schedule(() => {
      if (cancelled) return;
      remaining -= interval;
      if (remaining === 0) callback();
      else scheduleNext();
    }, interval);
  };

  scheduleNext();
  return {
    cancel: () => {
      cancelled = true;
      timer?.cancel();
    },
  };
};

/** Create an owned interval that shares process-capture cancellation handling. */
export const scheduleProcessInterval = (
  callback: () => void,
  intervalMs: number,
): ProcessTimer => {
  const timer = setInterval(callback, intervalMs);
  return { cancel: () => clearInterval(timer) };
};
