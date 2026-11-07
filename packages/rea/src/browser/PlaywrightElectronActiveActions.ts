import type { ElectronApplication, JSHandle, Page } from "playwright-core";
import { z } from "zod";
import { runWithExecutionLimits } from "./PlaywrightElectronExecution.js";

import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import type {
  ArtifactResourceScope,
  ArtifactResourceOwner,
} from "../artifacts/ArtifactResourceScope.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import {
  electronActiveTimelineEventSchema,
  electronActiveProcessMetricSchema,
  electronActiveWindowSchema,
  electronActiveObservationResultSchema,
  type ElectronActiveObservationInput,
  type ElectronActiveObservationResult,
} from "../domain/javascript/electronActiveObservation.js";
import {
  notExecutedActionError,
  type ScenarioActionStop,
} from "./ScenarioActionSequence.js";

const OPERATION = "capture_electron_scenario" as const;
const CANCELLED_STATE_READ_TIMEOUT_MS = 5_000;
const GRACE_EXPIRED = Symbol("cancellation grace expired");

const retention = electronActiveObservationResultSchema.shape.retention.shape;
const hookSnapshotSchema = z.strictObject({
  events: z.array(electronActiveTimelineEventSchema),
  retention_budget_bytes: retention.budget_bytes,
  estimated_retained_bytes: retention.estimated_retained_bytes,
  event_serialized_byte_upper_bound:
    retention.event_serialized_byte_upper_bound,
  retained: retention.retained,
  dropped: retention.dropped,
  dropped_ipc: retention.dropped_ipc,
  dropped_runtime: retention.dropped_runtime,
  dropped_event_families: retention.dropped_event_families,
  dropped_event_roles: retention.dropped_event_roles,
  observed: z.int().min(0),
  observed_ipc: retention.observed_ipc,
  observed_runtime: retention.observed_runtime,
  hook_error: z.boolean(),
});

type ElectronAction = ElectronActiveObservationInput["actions"][number];
type ElectronActions = ElectronActiveObservationResult["actions"];
type SelectedElectronWindow = JSHandle<{
  readonly id: number;
  isDestroyed(): boolean;
  readonly webContents: { forcefullyCrashRenderer(): void };
}>;

export type ElectronHookSnapshot = z.infer<typeof hookSnapshotSchema>;
export type ElectronHookEvent = z.infer<
  typeof electronActiveTimelineEventSchema
>;
export type ElectronMetrics = z.infer<
  typeof electronActiveProcessMetricSchema
>[];
type ElectronWindowMetadata = z.infer<typeof electronActiveWindowSchema>;
type ElectronApplicationState = Awaited<
  ReturnType<typeof readApplicationState>
>;

/**
 * Run explicit actions against provider-owned Electron windows. Every declared
 * action has one result; actions after a failed or cancelled action are
 * recorded as not executed.
 */
export const runElectronActions = async (
  application: ElectronApplication,
  input: ElectronActiveObservationInput,
  options: ExecutionOptions,
  resources: ArtifactResourceScope,
): Promise<{
  readonly actions: ElectronActions;
  readonly cleanupError?: AnalysisError;
}> => {
  const actions: ElectronActions = [];
  let cleanupError: AnalysisError | undefined;
  let stoppedBy: ScenarioActionStop | undefined;
  for (const action of input.actions) {
    const actionStartedAt = performance.now();
    const windowIndex = actionWindowIndex(action);
    if (stoppedBy !== undefined) {
      actions.push({
        step_id: action.step_id,
        kind: action.kind,
        window_index: windowIndex,
        target: null,
        status: "cancelled",
        elapsed_ms: 0,
        error: notExecutedActionError(stoppedBy),
      });
      continue;
    }
    let selectedWindow: Page | undefined;
    let selectedHandle: SelectedElectronWindow | undefined;
    let handleOwner: ArtifactResourceOwner | undefined;
    let target: string | null = null;
    let actionError: string | null = null;
    try {
      if (options.signal?.aborted === true)
        throw new BrowserObservationError(OPERATION, "cancelled");
      selectedWindow =
        windowIndex === null
          ? undefined
          : await waitForWindow({
              application,
              windowIndex,
              signal: options.signal,
            });
      if (selectedWindow !== undefined) {
        const selected = ownActionWindow(
          application,
          selectedWindow,
          resources,
        );
        handleOwner = selected.owner;
        selectedHandle = await runWithExecutionLimits(
          selected.handle,
          options.signal,
        );
        const id = z
          .int()
          .safe()
          .nonnegative()
          .parse(
            await runWithExecutionLimits(
              selectedHandle.evaluate((window) => window.id),
              options.signal,
            ),
          );
        target = `window:${String(id)}`;
      }

      await runAction({
        application,
        action,
        selectedWindow,
        selectedHandle,
        options,
      });
    } catch (cause: unknown) {
      stoppedBy = options.signal?.aborted ? "cancelled" : "failed";
      actionError = safeActionErrorMessage(cause);
    }
    const outcome =
      actionError === null
        ? { status: "completed" as const, error: null }
        : { status: stoppedBy ?? "failed", error: actionError };
    actions.push({
      step_id: action.step_id,
      kind: action.kind,
      window_index: windowIndex,
      target,
      ...outcome,
      elapsed_ms: Math.max(0, Math.round(performance.now() - actionStartedAt)),
    });
    if (handleOwner !== undefined) {
      cleanupError = await releaseActionWindow(
        resources,
        handleOwner,
        stoppedBy ?? "completed",
        options.signal,
      );
      if (cleanupError !== undefined) stoppedBy = "failed";
    }
  }
  return { actions, ...(cleanupError === undefined ? {} : { cleanupError }) };
};

const ownActionWindow = (
  application: ElectronApplication,
  page: Page,
  resources: ArtifactResourceScope,
): {
  readonly handle: Promise<SelectedElectronWindow>;
  readonly owner: ArtifactResourceOwner;
} => {
  const handle = Promise.resolve().then(() => application.browserWindow(page));
  let disposing: Promise<void> | undefined;
  const owner: ArtifactResourceOwner = {
    kind: "lease",
    resource: "selected Electron BrowserWindow handle",
    lease: {
      release: async () => {
        if (disposing === undefined) {
          const attempt = handle.then(
            (selected) => selected.dispose(),
            () => undefined,
          );
          disposing = attempt;
          void attempt.catch(() => {
            if (disposing === attempt) disposing = undefined;
          });
        }
        await runWithExecutionLimits(
          disposing,
          undefined,
          performance.now() + CANCELLED_STATE_READ_TIMEOUT_MS,
        );
      },
    },
  };
  resources.retain(owner);
  return { handle, owner };
};

const releaseActionWindow = async (
  resources: ArtifactResourceScope,
  owner: ArtifactResourceOwner,
  actionStatus: ElectronActions[number]["status"],
  signal: AbortSignal | undefined,
): Promise<AnalysisError | undefined> => {
  const released = await resources.release(owner);
  if (released.kind === "released") return undefined;
  const error = new ProviderCleanupError(
    "playwright-electron-active",
    released.lease.cleanupResources ?? [owner.resource],
    {
      reason: safeActionErrorMessage(released.cause),
    },
    { cause: released.cause, operation: OPERATION },
  );
  error.bindCleanupResourceOwner(released.lease);
  released.lease.bindCleanupError(error);
  if (!signal?.aborted) return error;
  const cancellation = new AnalysisCancelledError(OPERATION, {
    cause: signal.reason,
  });
  return actionStatus === "failed"
    ? error.retainSecondaryFailure(cancellation)
    : analysisErrorWithCleanupFailure(
        cancellation,
        error,
        OPERATION,
      ).bindCleanupDependencies([cancellation, error]);
};

type RunActionContext = {
  readonly application: ElectronApplication;
  readonly action: ElectronAction;
  readonly selectedWindow: Page | undefined;
  readonly selectedHandle: SelectedElectronWindow | undefined;
  readonly options: ExecutionOptions;
};

const runAction = async ({
  application,
  action,
  selectedWindow,
  selectedHandle,
  options,
}: RunActionContext): Promise<void> => {
  switch (action.kind) {
    case "click":
      if (selectedWindow === undefined)
        throw new BrowserObservationError(OPERATION, "window_not_found");
      await runWithExecutionLimits(
        selectedWindow.locator(action.selector).click({
          timeout: 0,
        }),
        options.signal,
      );
      return;
    case "wait": {
      const page =
        selectedWindow ??
        (await runWithExecutionLimits(
          application.firstWindow({
            timeout: 0,
          }),
          options.signal,
        ));
      await runWithExecutionLimits(
        page.waitForTimeout(action.duration_ms),
        options.signal,
      );
      return;
    }
    case "renderer-reload":
      if (selectedWindow === undefined)
        throw new BrowserObservationError(OPERATION, "window_not_found");
      await runWithExecutionLimits(
        selectedWindow.reload({
          timeout: 0,
        }),
        options.signal,
      );
      return;
    case "renderer-crash": {
      if (selectedHandle === undefined)
        throw new BrowserObservationError(OPERATION, "window_not_found");
      const crashed = await runWithExecutionLimits(
        selectedHandle.evaluate((window) => {
          if (window.isDestroyed()) return false;
          window.webContents.forcefullyCrashRenderer();
          return true;
        }),
        options.signal,
      );
      if (!crashed)
        throw new BrowserObservationError(OPERATION, "window_not_found");
      return;
    }
    case "deep-link":
      await runWithExecutionLimits(
        emitDeepLink(application, action),
        options.signal,
      );
      return;
  }
};

const actionWindowIndex = (action: ElectronAction): number | null => {
  switch (action.kind) {
    case "click":
    case "renderer-reload":
    case "renderer-crash":
      return action.window_index;
    case "wait":
      return action.window_index ?? null;
    case "deep-link":
      return null;
  }
};

type WaitForWindowContext = {
  readonly application: ElectronApplication;
  readonly windowIndex: number;
  readonly signal: AbortSignal | undefined;
};

const waitForWindow = async ({
  application,
  windowIndex,
  signal,
}: WaitForWindowContext): Promise<Page> => {
  while (true) {
    if (signal?.aborted === true)
      throw new BrowserObservationError(OPERATION, "cancelled");
    const window = application.windows()[windowIndex];
    if (window !== undefined) return window;
    await runWithExecutionLimits(
      new Promise<void>((resolve) => setTimeout(resolve, 25)),
      signal,
    );
  }
};

const emitDeepLink = (
  application: ElectronApplication,
  action: Extract<ElectronAction, { kind: "deep-link" }>,
): Promise<boolean> =>
  application.evaluate(
    ({ app }, payload) => {
      if (payload.delivery === "open-url")
        return app.emit(
          "open-url",
          { preventDefault: () => undefined },
          payload.url,
        );
      return app.emit("second-instance", {}, [payload.url], "", {});
    },
    { delivery: action.delivery, url: action.url },
  );

/** Read the current Electron windows, metrics, and hook snapshot. */
export const readApplicationState = async (
  application: ElectronApplication,
): Promise<{
  readonly windows: ReadonlyArray<ElectronWindowMetadata>;
  readonly metrics: ElectronMetrics;
  readonly electronVersion: string;
  readonly hookSnapshot: ElectronHookSnapshot;
}> => {
  const windowMetadataPromise: Promise<ElectronWindowMetadata[]> = application
    .evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map(
        (window: {
          readonly id: number;
          readonly webContents: {
            readonly id: number;
            getURL(): string;
            getTitle(): string;
          };
          isDestroyed(): boolean;
          isVisible(): boolean;
        }) => ({
          window_id: `window:${String(window.id)}`,
          web_contents_id: `webContents:${String(window.webContents.id)}`,
          url: window.webContents.getURL(),
          title: window.webContents.getTitle(),
          visible: window.isDestroyed() ? null : window.isVisible(),
          destroyed: window.isDestroyed(),
        }),
      ),
    )
    .then((value) => z.array(electronActiveWindowSchema).parse(value));
  const processMetricsPromise: Promise<ElectronMetrics> = application
    .evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map(
          (metric: {
            readonly pid: number;
            readonly type: string;
            readonly name?: string;
            readonly serviceName?: string;
          }) => ({
            pid: metric.pid,
            type: metric.type,
            name: metric.name ?? null,
            service_name: metric.serviceName ?? null,
          }),
        ),
    )
    .then((value) => z.array(electronActiveProcessMetricSchema).parse(value));
  const electronVersionPromise: Promise<string> = application
    .evaluate(() => process.versions.electron)
    .then((value) => z.string().parse(value));
  const hookSnapshotPromise: Promise<ElectronHookSnapshot> = application
    .evaluate(() => {
      const candidate = Reflect.get(globalThis, "__reaElectronActiveSnapshot");
      return typeof candidate === "function"
        ? candidate()
        : {
            events: [],
            retention_budget_bytes: 0,
            estimated_retained_bytes: 0,
            event_serialized_byte_upper_bound: 0,
            retained: 0,
            dropped: 0,
            dropped_ipc: 0,
            dropped_runtime: 0,
            dropped_event_families: [],
            dropped_event_roles: [],
            observed: 0,
            observed_ipc: 0,
            observed_runtime: 0,
            hook_error: true,
          };
    })
    .then((value) => hookSnapshotSchema.parse(value));
  const [windowMetadata, processMetrics, electronVersion, hookSnapshot] =
    await Promise.all([
      windowMetadataPromise,
      processMetricsPromise,
      electronVersionPromise,
      hookSnapshotPromise,
    ]);
  return {
    windows: windowMetadata,
    metrics: processMetrics,
    electronVersion,
    hookSnapshot,
  };
};

/**
 * Read the post-action state. Cancellation before or during the read leaves the
 * same bounded grace period so a responsive app still yields its final state;
 * expiry of that period is the caller's cancellation, with the expiry kept in
 * the error diagnostics.
 */
export const readFinalApplicationState = async (
  application: ElectronApplication,
  signal: AbortSignal | undefined,
): Promise<ElectronApplicationState> => {
  const state = readApplicationState(application);
  if (signal?.aborted !== true)
    try {
      return await runWithExecutionLimits(state, signal);
    } catch (cause: unknown) {
      if (
        !(cause instanceof BrowserObservationError) ||
        cause.reason !== "cancelled"
      )
        throw cause;
    }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const graceExpired = new Promise<typeof GRACE_EXPIRED>((resolve) => {
    timer = setTimeout(
      () => resolve(GRACE_EXPIRED),
      CANCELLED_STATE_READ_TIMEOUT_MS,
    );
  });
  try {
    const settled = await Promise.race([state, graceExpired]);
    if (settled !== GRACE_EXPIRED) return settled;
  } finally {
    clearTimeout(timer);
  }
  // The grace period exists only because of cancellation, so its expiry is
  // reported as that cancellation; a read failure inside it stays primary.
  throw new BrowserObservationError(OPERATION, "cancelled", {
    cause: signal?.reason,
    diagnostics: {
      final_state_read: "cancellation_grace_expired",
      cancellation_grace_ms: CANCELLED_STATE_READ_TIMEOUT_MS,
    },
  });
};

const safeActionErrorMessage = (cause: unknown): string => {
  return cause instanceof Error ? cause.message : "Electron action failed";
};
