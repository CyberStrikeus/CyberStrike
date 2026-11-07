import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../artifacts/AnalysisCleanupLease.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  AnalysisError,
  type AnalysisCleanupObservation,
} from "../domain/analysisErrorBase.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { bindRegularFileCleanup } from "./RegularFileRead.js";

interface SetupCleanupTask {
  readonly rejectedPrefix?: string;
  close(): Promise<string | AnalysisCleanupObservation | AnalysisError | void>;
}

/** Construct a report from facts already parsed by its owning boundary. */
const setupCleanupReport = (
  cause: unknown,
  observation: AnalysisCleanupObservation,
): AnalysisError =>
  new ProviderCleanupError(
    "setup",
    observation.resources,
    { reason: observation.reason },
    { cause, cleanup: observation, operation: "setup" },
  );

/** Preserve explicit cleanup capabilities when a host rejects instead of reporting. */
export const setupCleanupError = (
  cause: unknown,
  observation = ArtifactReaderFailure.cleanupObservation(cause, []),
): AnalysisError => {
  if (
    cause instanceof AnalysisError &&
    (cause.cleanupIncomplete ||
      cause.hasCleanupOwner ||
      cause.cleanup !== undefined ||
      cause instanceof ProviderCleanupError)
  )
    return cause;
  const error = setupCleanupReport(cause, observation);
  bindRegularFileCleanup(cause, error);
  return error;
};

export const setupCleanupReason = (error: AnalysisError): string =>
  error.cleanup?.reason ??
  (typeof error.diagnostics?.reason === "string"
    ? error.diagnostics.reason
    : error.message);

/** One child callback, its conjunctive completion owner, and latest failure provenance. */
class SetupCleanupChild {
  #generation = {};
  #attempted: object | undefined;
  #completed: object | undefined;
  #failure: { readonly owner: AnalysisError; cause: AnalysisError } | undefined;
  #reportedErrors = new WeakSet<AnalysisError>();
  #delegated: AnalysisError | undefined;
  #reason = "";
  #resources: readonly string[] = [];
  #attempt: ReturnType<SetupCleanupTask["close"]> = Promise.resolve();
  #lease = this.#newLease();

  constructor(private readonly task: SetupCleanupTask) {}

  admit(): void {
    this.#generation = {};
  }
  get hasNewGeneration(): boolean {
    return this.#attempted !== this.#generation;
  }

  get failure():
    | {
        readonly owner: AnalysisError;
        readonly cause: AnalysisError;
        readonly reason: string;
      }
    | undefined {
    if (this.#failure !== undefined && !this.#failure.owner.cleanupIncomplete) {
      this.#completed = this.#attempted;
      this.#failure = undefined;
      this.#reportedErrors = new WeakSet();
    }
    return this.#failure === undefined
      ? undefined
      : { ...this.#failure, reason: this.#reason };
  }

  close(): Promise<void> {
    // A source owner may have completed between rejection and this retry.
    void this.failure;
    if (this.#completed === this.#generation) return Promise.resolve();
    if (this.#lease.released || this.#completed !== undefined) {
      this.#lease = this.#newLease();
      this.#completed = undefined;
      this.#delegated = undefined;
    }
    const generation = this.#generation;
    this.#attempted = generation;
    // Seal terminal child scopes before returning from close.
    try {
      this.#attempt = this.task.close();
    } catch (cause: unknown) {
      this.#attempt = Promise.reject(cause);
    }
    return this.#lease.release().then(() => {
      this.#completed = generation;
    });
  }

  #newLease(): AnalysisCleanupLease {
    return new AnalysisCleanupLease(() => this.#execute(), this);
  }

  get cleanupResources(): readonly string[] {
    return this.#resources;
  }

  async #execute(): Promise<void> {
    let failure: AnalysisError;
    try {
      const report = await this.#attempt;
      if (report === undefined) return;
      failure =
        report instanceof AnalysisError
          ? setupCleanupError(report)
          : setupCleanupError(
              undefined,
              typeof report === "string"
                ? { reason: report, resources: [] }
                : report,
            );
      this.#reason = setupCleanupReason(failure);
    } catch (cause: unknown) {
      failure = setupCleanupError(cause);
      this.#reason =
        (this.task.rejectedPrefix === undefined
          ? ""
          : this.task.rejectedPrefix + ": ") + setupCleanupReason(failure);
    }
    // Keep this attempt's diagnostics separate from the owner followed by
    // every earlier report from this generation.
    if (this.#failure !== undefined) this.#failure.cause = failure;
    let dependency = failure;
    if (failure.cleanupIncomplete && !failure.hasCleanupOwner) {
      this.#resources = [...failure.cleanupResources];
      if (this.#delegated === undefined) {
        // Ownerless source errors remain evidence snapshots. A private report
        // binds this callback without changing shared or immutable input.
        this.#delegated = setupCleanupReport(failure, {
          reason: this.#reason,
          resources: this.#resources,
        });
        new AnalysisCleanupLeaseGroup(this.#delegated, [this.#lease]);
      }
      // Every attempt shares this exact callback lease and one dependency.
      dependency = this.#delegated;
    }
    if (dependency !== undefined && dependency.cleanupIncomplete) {
      if (!this.#reportedErrors.has(dependency)) {
        if (
          this.#failure === undefined ||
          !this.#failure.owner.cleanupIncomplete
        ) {
          this.#failure = {
            owner: setupCleanupReport(
              new AggregateError(
                [dependency],
                "Setup child cleanup authorities",
              ),
              { reason: this.#reason, resources: [] },
            ),
            cause: failure,
          };
          this.#reportedErrors = new WeakSet();
        } else this.#failure.owner.retainSecondaryFailure(dependency);
        this.#failure.owner.bindCleanupDependencies([dependency]);
        this.#reportedErrors.add(dependency);
      }
    }
    // A source's release cannot confirm an earlier delegated callback, and a
    // successful callback cannot release an independently owned source.
    if (failure.cleanupIncomplete) throw failure;
    if (this.#delegated?.cleanupIncomplete) throw this.#delegated;
  }
}

/** Preserve completed peers and follow live source errors through exact retries. */
export class SetupCleanupOwner {
  readonly #children: ReadonlyMap<SetupCleanupTask, SetupCleanupChild>;
  #closing: Promise<AnalysisError | undefined> | undefined;

  constructor(tasks: readonly SetupCleanupTask[]) {
    this.#children = new Map(
      tasks.map((task) => [task, new SetupCleanupChild(task)]),
    );
  }

  /** Admit actual new cleanup work, never merely another retry of a failed peer. */
  admit(task: SetupCleanupTask): void {
    const child = this.#children.get(task);
    if (child === undefined)
      throw new TypeError("Cleanup task is not owned by this setup host");
    child.admit();
  }

  close(): Promise<AnalysisError | undefined> {
    if (this.#closing !== undefined) return this.#closing;
    const attempt = this.#attempt().finally(() => {
      if (this.#closing === attempt) this.#closing = undefined;
    });
    this.#closing = attempt;
    return attempt;
  }

  async #attempt(): Promise<AnalysisError | undefined> {
    const children = [...this.#children.values()];
    // An active producer can admit its final cleanup outcome while draining.
    do {
      await Promise.allSettled(children.map((child) => child.close()));
    } while (children.some((child) => child.hasNewGeneration));
    const failures = children.flatMap((child) => {
      const failure = child.failure;
      return failure === undefined ? [] : [failure];
    });
    if (failures.length === 0) return undefined;
    const observation: AnalysisCleanupObservation = {
      reason: failures.map((failure) => failure.reason).join("; "),
      resources: [
        ...new Set(
          failures.flatMap((failure) => failure.owner.cleanupResources),
        ),
      ],
    };
    const error = setupCleanupReport(
      new AggregateError(
        failures.map((failure) => failure.cause),
        "Setup child cleanup failures",
        {
          cause: new AggregateError(
            failures.map((failure) => failure.owner),
            "Setup cleanup ownership reports",
          ),
        },
      ),
      observation,
    ).bindCleanupDependencies(failures.map((failure) => failure.owner));
    return error.cleanupIncomplete ? error : undefined;
  }
}
