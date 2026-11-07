/** Provider-neutral progress observation for one ordinary request. */
export interface ProgressUpdate {
  readonly phase: string;
  readonly completed: number;
  readonly total: number | null;
  readonly message: string;
  readonly terminal?: boolean;
}

/** Progress boundary shared by CLI, MCP, application workflows, and providers. */
export interface ProgressReporter {
  report(update: ProgressUpdate): Promise<void>;
}

/** Create a monotonic, rate-bounded reporter around a surface-specific sink. */
export const createProgressReporter = (
  sink: (
    update: ProgressUpdate & { readonly sequence: number },
  ) => Promise<void>,
  options: {
    readonly minimumIntervalMs?: number;
    readonly now?: () => number;
  } = {},
): ProgressReporter => {
  const minimumIntervalMs = options.minimumIntervalMs ?? 100;
  const now = options.now ?? (() => performance.now());
  let lastCompleted = -1;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let sequence = 0;
  return {
    async report(update) {
      if (!Number.isFinite(update.completed) || update.completed < 0)
        throw new TypeError("Progress completed must be a nonnegative number");
      if (update.total !== null && update.total < update.completed)
        throw new TypeError("Progress total cannot be less than completed");
      if (update.completed < lastCompleted)
        throw new TypeError("Progress cannot move backwards");
      lastCompleted = update.completed;
      const observedAt = now();
      if (
        update.terminal !== true &&
        observedAt - lastSentAt < minimumIntervalMs
      )
        return;
      lastSentAt = observedAt;
      sequence += 1;
      await sink({ ...update, sequence });
    },
  };
};

/** Surface that deliberately ignores progress while preserving one workflow API. */
export const silentProgressReporter: ProgressReporter = {
  report: () => Promise.resolve(),
};
