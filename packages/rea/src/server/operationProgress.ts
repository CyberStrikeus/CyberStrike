import type { ProgressReporter } from "../application/ProgressReporter.js";

/** Report one operation start through the shared monotonic boundary. */
export const reportOperationStart = (
  progress: ProgressReporter,
  phase: string,
  message = "started",
): Promise<void> => progress.report({ phase, completed: 0, total: 1, message });

/** Report one operation's terminal disposition. */
export const reportOperationEnd = (
  progress: ProgressReporter,
  phase: string,
  succeeded: boolean,
): Promise<void> =>
  progress.report({
    phase,
    completed: 1,
    total: 1,
    message: succeeded ? "completed" : "failed",
    terminal: true,
  });
