import type { ProviderProcessSupervisor } from "./ProviderProcess.js";

type FrameOutcome = "frame" | "failure";

/** Own frame waiters and release the losing output-close wait after each race. */
export class WorkerFrameSignal {
  readonly #waiters = new Set<(outcome: FrameOutcome) => void>();

  wake(outcome: FrameOutcome): void {
    for (const wake of this.#waiters) wake(outcome);
    this.clear();
  }

  clear(): void {
    this.#waiters.clear();
  }

  async waitForOutputClose(
    supervisor: ProviderProcessSupervisor,
    signal: AbortSignal,
  ): Promise<FrameOutcome | "closed" | "interrupted"> {
    let wakeFrame!: (outcome: FrameOutcome) => void;
    const frameAvailable = new Promise<FrameOutcome>((resolve) => {
      wakeFrame = resolve;
      this.#waiters.add(wakeFrame);
    });
    const outputCloseController = new AbortController();
    const interruptOutputClose = () =>
      outputCloseController.abort(signal.reason);
    if (signal.aborted) interruptOutputClose();
    else signal.addEventListener("abort", interruptOutputClose, { once: true });
    try {
      const outputClose = supervisor
        .waitForOutputClose(undefined, outputCloseController.signal)
        .then((closed): "closed" | "interrupted" =>
          closed ? "closed" : "interrupted",
        );
      return await Promise.race([frameAvailable, outputClose]);
    } finally {
      outputCloseController.abort();
      signal.removeEventListener("abort", interruptOutputClose);
      this.#waiters.delete(wakeFrame);
    }
  }
}
