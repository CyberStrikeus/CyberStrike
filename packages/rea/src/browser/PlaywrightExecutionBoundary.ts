import {
  AnalysisCancelledError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";

export const PLAYWRIGHT_NETWORK_READ_TIMEOUT_MS = 5_000;

const OPERATION = "capture_browser_scenario" as const;

// Chrome shutdown can take several seconds; expiry bounds the response, not ownership.
export const PLAYWRIGHT_CLEANUP_CONFIRMATION_TIMEOUT_MS = 30_000;

export const withPlaywrightExecutionBoundary = <Value>(
  work: () => Promise<Value>,
  timeoutMs: number | undefined,
  signal?: AbortSignal,
  timeoutError: () => AnalysisTimeoutError = () =>
    new AnalysisTimeoutError(OPERATION, timeoutMs ?? 0),
): Promise<Value> => {
  if (timeoutMs !== undefined && timeoutMs <= 0)
    return Promise.reject(timeoutError());
  if (signal?.aborted === true)
    return Promise.reject(
      new AnalysisCancelledError(OPERATION, { cause: signal.reason }),
    );

  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline =
      timeoutMs === undefined ? undefined : performance.now() + timeoutMs;
    const scheduleTimeout = (): void => {
      if (deadline === undefined) return;
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        fail(timeoutError());
        return;
      }
      timer = setTimeout(scheduleTimeout, Math.min(remaining, 2_147_483_647));
      timer.unref();
    };
    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const succeed = (value: Value): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = (): void => {
      fail(new AnalysisCancelledError(OPERATION, { cause: signal?.reason }));
    };
    scheduleTimeout();
    if (settled) return;
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted === true) {
      onAbort();
      return;
    }
    try {
      void work().then(succeed, fail);
    } catch (cause: unknown) {
      fail(cause);
    }
  });
};
