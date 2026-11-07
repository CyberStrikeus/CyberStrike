/** Keep wall-clock timestamps separate from capture-relative elapsed time. */
export const monotonicProcessCaptureClock = (): number =>
  Math.floor(performance.now());
