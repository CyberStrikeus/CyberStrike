/** Attempt every independent cleanup and preserve each failure. */
export function closeVerifierResources(
  tasks: readonly (() => void | Promise<void>)[],
): Promise<void>;

/** Finish one operation and its cleanup without losing either failure. */
export function withVerifierCleanup<T>(
  operation: () => T | Promise<T>,
  cleanupTasks: readonly (() => void | Promise<void>)[],
): Promise<T>;
