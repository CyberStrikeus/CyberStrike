/** The phase and budget that own an observed firmware timeout. */
export interface FirmwareDeadline {
  readonly phase: "analysis" | "publication";
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly expiresAtMs: number;
}

/** Keep a phase's selected budget paired with its cancellation identity. */
export const startFirmwareDeadline = (
  phase: FirmwareDeadline["phase"],
  timeoutMs: number,
): FirmwareDeadline => ({
  phase,
  expiresAtMs: performance.now() + timeoutMs,
  signal: AbortSignal.timeout(timeoutMs),
  timeoutMs,
});

/** Timers may not have run when synchronous inventory or result parsing returns. */
export const firmwareDeadlineElapsed = (deadline: FirmwareDeadline): boolean =>
  performance.now() >= deadline.expiresAtMs;
