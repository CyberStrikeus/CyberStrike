import {
  withPlaywrightExecutionBoundary,
  PLAYWRIGHT_CLEANUP_CONFIRMATION_TIMEOUT_MS,
} from "./PlaywrightExecutionBoundary.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../artifacts/AnalysisCleanupLease.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type { BrowserScenarioCapturePort } from "../application/BrowserScenarioCapturePort.js";
import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../application/AnalysisProvider.js";
import type { BrowserScenario } from "../domain/browserScenario.js";
import {
  BROWSER_SCENARIO_START_STEP_ID,
  type BrowserScenarioAction,
} from "../domain/browserScenarioValues.js";
import {
  browserScenarioCaptureSchema,
  type BrowserScenarioCapture,
  type BrowserScenarioPartialObservation,
} from "../domain/browserScenarioCapture.js";
import {
  classifyBrowserScenarioCompleteness,
  browserScenarioStepSchema,
  browserStepArtifactsSchema,
  type BrowserScenarioCompleteness,
  type BrowserScenarioCompletenessSection,
  type BrowserScenarioStep,
  type BrowserScenarioStepOutcome,
  type BrowserStepArtifacts,
} from "../domain/browserScenarioCaptureValues.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import {
  BrowserObservationError,
  browserCleanupObservation,
} from "../domain/browserObservationError.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { err, ok, type Result } from "../domain/result.js";
import type {
  RetainBrowserScenarioCleanup,
  BrowserScenarioSessionOpener,
  BrowserScenarioSessionPort,
} from "./BrowserScenarioSessionPort.js";
import {
  notExecutedActionError,
  type ScenarioActionStop,
} from "./ScenarioActionSequence.js";
import {
  browserScenarioOperationFailure,
  browserScenarioCaptureData,
} from "./BrowserScenarioPartialObservation.js";

const OPERATION = "capture_browser_scenario" as const;
import { PLAYWRIGHT_BROWSER_SCENARIO_PROVIDER_IDENTITY } from "./providerIdentities.js";

const signalIsAborted = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;

type SnapshotKind = BrowserScenario["capture"]["after_each_step"][number];
const SNAPSHOT_KINDS = [
  "screenshot",
  "dom",
  "accessibility",
  "url",
  "history",
  "storage",
] as const satisfies readonly SnapshotKind[];

const requestedForStep = (
  scenario: BrowserScenario,
  stepIndex: number,
): ReadonlySet<SnapshotKind> =>
  new Set([
    ...scenario.capture.after_each_step,
    ...(stepIndex === scenario.actions.length ? scenario.capture.at_end : []),
  ]);

const unavailableArtifacts = (
  requested: ReadonlySet<SnapshotKind>,
  reason: string,
): BrowserStepArtifacts => {
  const state = (kind: SnapshotKind) =>
    requested.has(kind)
      ? { state: "missing" as const, reason }
      : { state: "not_requested" as const };
  return browserStepArtifactsSchema.parse({
    screenshot: state("screenshot"),
    dom: state("dom"),
    accessibility: state("accessibility"),
    url: state("url"),
    history: state("history"),
    storage: state("storage"),
  });
};

const stepCompleteness = (
  artifacts: BrowserStepArtifacts,
  status: BrowserScenarioStep["status"],
): BrowserScenarioCompleteness => {
  const missing: BrowserScenarioCompletenessSection[] = SNAPSHOT_KINDS.filter(
    (section) => artifacts[section].state === "missing",
  );
  const truncated = SNAPSHOT_KINDS.filter(
    (section) => artifacts[section].state === "truncated",
  );
  if (status !== "completed") missing.push("action");
  return classifyBrowserScenarioCompleteness(missing, truncated);
};

const createStep = (
  input: {
    readonly stepIndex: number;
    readonly stepId: string;
    readonly action: string;
    readonly elapsedMs: number;
    readonly beforeUrl: ReturnType<BrowserScenarioSessionPort["sanitizeUrl"]>;
    readonly afterUrl: ReturnType<BrowserScenarioSessionPort["sanitizeUrl"]>;
    readonly eventStart: number;
    readonly eventEnd: number;
    readonly artifacts: BrowserStepArtifacts;
  } & BrowserScenarioStepOutcome,
): BrowserScenarioStep =>
  browserScenarioStepSchema.parse({
    step_index: input.stepIndex,
    step_id: input.stepId,
    action: input.action,
    status: input.status,
    elapsed_ms: input.elapsedMs,
    before_url: input.beforeUrl,
    after_url: input.afterUrl,
    error: input.error,
    event_sequence_start: input.eventStart,
    event_sequence_end: input.eventEnd,
    artifacts: input.artifacts,
    completeness: stepCompleteness(input.artifacts, input.status),
  });

const initialStep = async (input: {
  readonly session: BrowserScenarioSessionPort;
  readonly scenario: BrowserScenario;
  readonly elapsedMs: number;
  readonly signal: AbortSignal | undefined;
}): Promise<BrowserScenarioStep> => {
  const { session, scenario, elapsedMs, signal } = input;
  const artifacts = await session.capture(
    requestedForStep(scenario, 0),
    signal,
  );
  return createStep({
    stepIndex: 0,
    stepId: BROWSER_SCENARIO_START_STEP_ID,
    action: "goto_start",
    status: "completed",
    elapsedMs,
    beforeUrl: session.sanitizeUrl(session.initialUrl),
    afterUrl: session.sanitizeUrl(session.currentUrl()),
    error: null,
    eventStart: 1,
    eventEnd: session.lastEventSequence(),
    artifacts,
  });
};

const executeStep = async (input: {
  readonly session: BrowserScenarioSessionPort;
  readonly scenario: BrowserScenario;
  readonly action: BrowserScenarioAction;
  readonly stepIndex: number;
  readonly stoppedBy: ScenarioActionStop | undefined;
  readonly signal: AbortSignal | undefined;
}): Promise<BrowserScenarioStep> => {
  const { session, scenario, action, stepIndex, stoppedBy, signal } = input;
  const beforeUrl = session.sanitizeUrl(session.currentUrl());
  const eventStart = session.nextEventSequence();
  const requested = requestedForStep(scenario, stepIndex);
  if (stoppedBy !== undefined) {
    const error = notExecutedActionError(stoppedBy);
    return createStep({
      stepIndex,
      stepId: action.step_id,
      action: action.action,
      status: "cancelled",
      elapsedMs: 0,
      beforeUrl,
      afterUrl: beforeUrl,
      error,
      eventStart,
      eventEnd: session.lastEventSequence(),
      artifacts: unavailableArtifacts(requested, error),
    });
  }

  const actionStartedAt = performance.now();
  session.setStep(stepIndex);
  const requestCancelled = (): boolean => signal?.aborted === true;
  let outcome: BrowserScenarioStepOutcome = {
    status: "completed",
    error: null,
  };
  if (requestCancelled()) {
    outcome = { status: "cancelled", error: "scenario request cancelled" };
  } else {
    try {
      await session.perform(action, signal);
    } catch (cause: unknown) {
      outcome = {
        status: requestCancelled() ? "cancelled" : "failed",
        error: session.redactError(cause),
      };
    }
  }
  const artifacts =
    outcome.status === "cancelled"
      ? unavailableArtifacts(requested, "scenario request cancelled")
      : await session.capture(requested, signal);
  return createStep({
    stepIndex,
    stepId: action.step_id,
    action: action.action,
    ...outcome,
    elapsedMs: Math.max(0, Math.round(performance.now() - actionStartedAt)),
    beforeUrl,
    afterUrl: session.sanitizeUrl(session.currentUrl()),
    eventStart,
    eventEnd: session.lastEventSequence(),
    artifacts,
  });
};

const globalCompleteness = (
  scenario: BrowserScenario,
  session: BrowserScenarioSessionPort,
  steps: readonly BrowserScenarioStep[],
): BrowserScenarioCompleteness => {
  const missing = steps.flatMap(
    ({ completeness }) => completeness.missing_sections,
  );
  const truncated = steps.flatMap(
    ({ completeness }) => completeness.truncated_sections,
  );
  if (session.mode === "connect") missing.push("events");
  if ((session.eventLimitations?.().length ?? 0) > 0) missing.push("events");
  if ((session.storageLimitations?.().length ?? 0) > 0) missing.push("storage");
  return classifyBrowserScenarioCompleteness(missing, truncated);
};

const runScenario = async (
  openSession: BrowserScenarioSessionOpener,
  scenario: BrowserScenario,
  options: ExecutionOptions,
  retainCleanup: RetainBrowserScenarioCleanup,
): Promise<BrowserScenarioCapture> => {
  if (options.signal?.aborted)
    throw new BrowserObservationError(OPERATION, "cancelled", {
      cause: options.signal.reason,
    });
  const startedAt = performance.now();
  const session = await openSession(scenario, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    retainCleanup,
  });
  const steps: BrowserScenarioStep[] = [];
  let operationOutcome:
    | { readonly ok: true }
    | {
        readonly ok: false;
        readonly cause: unknown;
      } = { ok: true };
  try {
    steps.push(
      await initialStep({
        session,
        scenario,
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
        signal: options.signal,
      }),
    );
    let stoppedBy: ScenarioActionStop | undefined;
    for (const [offset, action] of scenario.actions.entries()) {
      const step = await executeStep({
        session,
        scenario,
        action,
        stepIndex: offset + 1,
        stoppedBy,
        signal: options.signal,
      });
      steps.push(step);
      if (stoppedBy === undefined && step.status !== "completed")
        stoppedBy = step.status;
    }
  } catch (cause: unknown) {
    operationOutcome = { ok: false, cause };
  }
  let cleanupOutcome:
    | {
        readonly ok: true;
        readonly cleanup: "terminated-owned-process" | "disconnected-external";
      }
    | { readonly ok: false; readonly cause: unknown };
  try {
    cleanupOutcome = { ok: true, cleanup: await session.close() };
  } catch (cause: unknown) {
    const cleanup = browserCleanupObservation(cause);
    const failure = new BrowserObservationError(OPERATION, "cleanup_failed", {
      cause,
      cleanup,
    });
    retainCleanup(session.cleanupLease);
    new AnalysisCleanupLeaseGroup(failure, [session.cleanupLease]);
    cleanupOutcome = { ok: false, cause: failure };
  }
  if (!cleanupOutcome.ok) {
    if (operationOutcome.ok && options.signal?.aborted)
      operationOutcome = {
        ok: false,
        cause: new AnalysisCancelledError(OPERATION, {
          cause: options.signal.reason,
        }),
      };
    const cleanup = browserCleanupObservation(cleanupOutcome.cause);
    const partialObservation: BrowserScenarioPartialObservation = {
      kind: "browser-scenario-observation",
      capture: browserScenarioCaptureData({
        session,
        scenario,
        startedAt,
        steps,
        cleanup: "incomplete",
        limitations: [
          "Scenario observations are partial because browser cleanup could not be confirmed.",
        ],
      }),
    };
    if (!operationOutcome.ok)
      throw browserScenarioOperationFailure(
        operationOutcome.cause,
        partialObservation,
        { cause: cleanupOutcome.cause },
      );
    const failure = new BrowserObservationError(OPERATION, "cleanup_failed", {
      cause: cleanupOutcome.cause,
      cleanup,
      partialObservation,
      detail: `Browser scenario cleanup could not be confirmed: ${cleanup.reason}. Collected steps and events are retained in partial_observation. Review the reported resources before retrying.`,
    });
    if (
      cleanupOutcome.cause instanceof AnalysisError &&
      cleanupOutcome.cause.cleanupIncomplete
    )
      failure.bindCleanupDependencies([cleanupOutcome.cause]);
    throw failure;
  }
  if (!operationOutcome.ok)
    throw browserScenarioOperationFailure(operationOutcome.cause, {
      kind: "browser-scenario-observation",
      capture: browserScenarioCaptureData({
        session,
        scenario,
        startedAt,
        steps,
        cleanup: cleanupOutcome.cleanup,
        limitations: [
          "Scenario capture ended after an operation failed; uncollected steps are not represented.",
        ],
      }),
    });
  const completeness = globalCompleteness(scenario, session, steps);
  const capture = browserScenarioCaptureSchema.parse({
    ...browserScenarioCaptureData({
      session,
      scenario,
      startedAt,
      steps,
      cleanup: cleanupOutcome.cleanup,
    }),
    completeness,
  });
  if (signalIsAborted(options.signal))
    throw new AnalysisCancelledError(OPERATION, {
      cause: options.signal?.reason,
      partialObservation: {
        kind: "browser-scenario-observation",
        capture: {
          ...capture,
          limitations: [
            ...capture.limitations,
            "Scenario capture was cancelled; collected steps, observations, and cleanup state are retained.",
          ],
        },
      },
    });
  return capture;
};

/** Controlled Playwright/CDP scenario driver with exact process ownership. */
export class PlaywrightBrowserScenarioProvider implements BrowserScenarioCapturePort {
  #tail: Promise<void> = Promise.resolve();
  #closing = false;
  #closePromise: Promise<void> | undefined;
  readonly #pendingCleanup = new Map<
    AnalysisCleanupLease,
    (value: string) => string
  >();

  constructor(private readonly openSession: BrowserScenarioSessionOpener) {}

  identity(): ProviderIdentity {
    return PLAYWRIGHT_BROWSER_SCENARIO_PROVIDER_IDENTITY;
  }

  captureScenario(
    scenario: BrowserScenario,
    options: ExecutionOptions = {},
  ): Promise<Result<BrowserScenarioCapture, AnalysisError>> {
    if (this.#closing) return Promise.resolve(err(this.#closedError()));
    const operation = this.#tail.then(() =>
      this.#closing
        ? err(this.#closedError())
        : this.#captureScenario(scenario, options),
    );
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #captureScenario(
    scenario: BrowserScenario,
    options: ExecutionOptions,
  ): Promise<Result<BrowserScenarioCapture, AnalysisError>> {
    const pending = await this.#retryCleanup();
    if (pending !== undefined) return err(pending);
    const retained: AnalysisCleanupLease[] = [];
    try {
      return ok(
        await runScenario(
          this.openSession,
          scenario,
          options,
          (lease, redactText = (value) => value) => {
            this.#pendingCleanup.set(lease, redactText);
            retained.push(lease);
          },
        ),
      );
    } catch (cause: unknown) {
      const primary =
        cause instanceof AnalysisError
          ? cause
          : new ProviderAdapterError(
              PLAYWRIGHT_BROWSER_SCENARIO_PROVIDER_IDENTITY.id,
              OPERATION,
              { cause },
            );
      if (retained.length === 0) return err(primary);
      const cleanup = new ProviderCleanupError(
        PLAYWRIGHT_BROWSER_SCENARIO_PROVIDER_IDENTITY.id,
        retained.flatMap((lease) =>
          (lease.cleanupResources ?? []).map(
            this.#pendingCleanup.get(lease) ?? ((value) => value),
          ),
        ),
        { reason: "Browser scenario cleanup capabilities remain retained." },
        { operation: OPERATION, cause },
      );
      this.#bindCleanup(cleanup, retained);
      return err(
        analysisErrorWithCleanupFailure(
          primary,
          cleanup,
          OPERATION,
        ).bindCleanupDependencies([primary, cleanup]),
      );
    }
  }

  async close(): Promise<void> {
    this.#closing = true;
    this.#closePromise ??= this.#tail
      .then(async () => {
        const failure = await this.#retryCleanup();
        if (failure !== undefined) throw failure;
      })
      .catch((cause: unknown) => {
        this.#closePromise = undefined;
        throw cause;
      });
    return this.#closePromise;
  }

  #closedError(): AnalysisError {
    return new BrowserObservationError(OPERATION, "cleanup_failed", {
      detail: "Browser scenario provider is closing.",
      cleanup: { reason: "Provider is closing", resources: [] },
    });
  }

  #bindCleanup(
    error: AnalysisError,
    leases: readonly AnalysisCleanupLease[],
  ): void {
    new AnalysisCleanupLeaseGroup(error, leases);
    const projections = this.#pendingCleanup;
    error.bindCleanupResourceOwner({
      get cleanupResources() {
        const pending = leases.filter((lease) => !lease.released);
        if (pending.some((lease) => lease.cleanupResources === undefined))
          return undefined;
        return [
          ...new Set(
            pending.flatMap((lease) =>
              (lease.cleanupResources ?? []).map(
                projections.get(lease) ?? ((value) => value),
              ),
            ),
          ),
        ];
      },
    });
  }

  async #retryCleanup(): Promise<AnalysisError | undefined> {
    const failures: AnalysisError[] = [];
    for (const [pending, redactText] of this.#pendingCleanup) {
      try {
        await withPlaywrightExecutionBoundary(
          () => pending.release(),
          PLAYWRIGHT_CLEANUP_CONFIRMATION_TIMEOUT_MS,
        );
        this.#pendingCleanup.delete(pending);
      } catch (cause: unknown) {
        const failure = new ProviderCleanupError(
          PLAYWRIGHT_BROWSER_SCENARIO_PROVIDER_IDENTITY.id,
          (pending.cleanupResources ?? []).map(redactText),
          {
            reason: redactText(
              cause instanceof Error ? cause.message : String(cause),
            ),
          },
          { operation: OPERATION, cause },
        );
        this.#bindCleanup(failure, [pending]);
        failures.push(failure);
      }
    }
    if (failures.length === 0) return undefined;
    if (failures.length === 1) return failures[0];
    return new ProviderCleanupError(
      PLAYWRIGHT_BROWSER_SCENARIO_PROVIDER_IDENTITY.id,
      failures.flatMap((failure) => failure.cleanupResources),
      { reason: "One or more browser scenario resources remain owned." },
      {
        operation: OPERATION,
        cause: new AggregateError(failures, "Browser scenario cleanup failed"),
      },
    ).bindCleanupDependencies(failures);
  }
}
