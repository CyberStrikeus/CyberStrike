import type {
  ProcessOwnershipHost,
  ProcessRunTokenObservation,
  ProcessTableEntry,
} from "./ProcessOwnership.js";

/** Structured native token availability, distinct from failed reads and caller cancellation. */
export class ProcessRunTokenReadError extends Error {
  readonly _tag = "ProcessRunTokenReadError";
  constructor(
    readonly pid: number,
    readonly availability: "absent" | "unavailable",
    readonly reason: string,
  ) {
    super(`Run token for PID ${String(pid)}: ${reason}`);
    this.name = "ProcessRunTokenReadError";
  }
}

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** Only a variable observed on this process supplies its run token. */
export const processRunIdFromEnvironment = (
  environment: Readonly<Record<string, string>>,
): string | undefined =>
  Object.hasOwn(environment, "REA_PROCESS_RUN_ID")
    ? environment.REA_PROCESS_RUN_ID
    : undefined;

/** Read only ownership tokens, using per-process fallback for missing batch rows. */
export async function* readProcessRunTokens(
  host: ProcessOwnershipHost,
  processes: readonly ProcessTableEntry[],
  signal?: AbortSignal,
): AsyncGenerator<{
  readonly process: ProcessTableEntry;
  readonly observation: ProcessRunTokenObservation;
}> {
  signal?.throwIfAborted();
  if (processes.length === 0) return;
  let batch: ReadonlyMap<number, ProcessRunTokenObservation> | undefined;
  let batchFailure: string | undefined;
  if (host.runTokens !== undefined) {
    try {
      batch =
        signal === undefined
          ? await host.runTokens(processes)
          : await host.runTokens(processes, signal);
    } catch (cause: unknown) {
      signal?.throwIfAborted();
      batchFailure = errorMessage(cause);
    }
  }
  for (const process of processes) {
    signal?.throwIfAborted();
    let observation = batch?.get(process.pid);
    if (observation === undefined) {
      try {
        const environment =
          signal === undefined
            ? await host.environment(process.pid)
            : await host.environment(process.pid, signal);
        observation = {
          state: "readable",
          runId: processRunIdFromEnvironment(environment),
        };
      } catch (cause: unknown) {
        signal?.throwIfAborted();
        const reason = errorMessage(cause);
        const code =
          cause instanceof Error &&
          "code" in cause &&
          typeof cause.code === "string"
            ? cause.code
            : undefined;
        observation = {
          state: "unavailable",
          ...(code === undefined ? {} : { code }),
          reason:
            batchFailure === undefined
              ? reason
              : `${reason}; run-token batch failed: ${batchFailure}`,
        };
      }
    }
    signal?.throwIfAborted();
    yield { process, observation };
  }
}
