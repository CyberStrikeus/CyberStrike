import { setImmediate } from "node:timers/promises";

/** Dispatch queued callbacks, then the OS signal notifications they may enqueue. */
export const dispatchQueuedInterrupts = async (): Promise<void> => {
  await setImmediate();
  await setImmediate();
};
