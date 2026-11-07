import type { Socket } from "node:net";

import type { ProgressReporter } from "../application/ProgressReporter.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { HopperError } from "../domain/hopperErrors.js";
import { HopperProcessError } from "../domain/hopperErrors.js";

import type { JsonValue } from "../domain/jsonValue.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { err, ok, type Result } from "../domain/result.js";
import type { Logger } from "pino";
import type { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import type {
  ProcessCleanupResult,
  ProcessIdentityObservation,
} from "../process/ProcessOwnership.js";
import type { ProviderProcessSupervisor } from "../process/ProviderProcess.js";
import { observeProcessStartIdentityExit } from "../process/ProcessOwnershipObservation.js";
import type { BridgeLaunch } from "./BridgeLauncher.js";
import {
  createOwnedHopperShutdownDiagnostic,
  type HopperDiagnostic,
  providerCleanupFailure,
} from "./HopperDiagnostics.js";
import type { HopperRequestActivity } from "./HopperRequestQueue.js";
import {
  isHopperCleanupRequired,
  isHopperShutdownAcknowledgement,
} from "./HopperSessionValues.js";

interface CleanupIssue {
  readonly resource: string;
  readonly reason: string;
}

interface CleanupState {
  readonly issues: CleanupIssue[];
  readonly resources: Set<string>;
  cleanupResult: ProcessCleanupResult | undefined;
  processStopped: boolean;
}

/** Owned capabilities survive failed cleanup until their release is verified. */
export interface HopperOwnedResources {
  launch: BridgeLaunch | undefined;
  processSupervisor: ProviderProcessSupervisor | undefined;
  runtimeRoot: PrivateRuntimeRoot | undefined;
  shutdownConfirmed: boolean;
  externalApplication:
    | {
        readonly pid: number;
        readonly identity: ProcessIdentityObservation;
      }
    | undefined;
}

export interface HopperCleanupInput {
  readonly socket: Socket | undefined;
  readonly resources: HopperOwnedResources;
  readonly activeRequest: HopperRequestActivity | null;
  readonly retainDocument: boolean;
  readonly progress: ProgressReporter | undefined;
  readonly logger: Logger;
  readonly onDiagnostic: ((event: HopperDiagnostic) => void) | undefined;
  request(
    method: "shutdown" | "shutdown_document",
  ): Promise<Result<JsonValue, HopperError>>;
  releaseTransport(socket: Socket | undefined): void;
}

/** Close Hopper phases and retain every resource whose cleanup is unverified. */
export const cleanupHopperSession = async (
  input: HopperCleanupInput,
): Promise<Result<null, AnalysisError>> => {
  const state: CleanupState = {
    issues: [],
    resources: new Set(),
    cleanupResult: undefined,
    processStopped: input.resources.processSupervisor === undefined,
  };
  await confirmExternalApplicationExit(
    input.resources,
    input.socket,
    input.releaseTransport,
  );
  await report(
    input.progress,
    0,
    input.retainDocument &&
      input.resources.launch?.preparedImagePath === undefined
      ? "detaching REA from the Hopper document"
      : "requesting Hopper document shutdown",
  );
  await requestShutdown(input, state);
  await report(input.progress, 0.35, "releasing Hopper bridge transport");
  if (
    input.resources.shutdownConfirmed ||
    input.resources.launch?.providerLifetime !== "external-application"
  )
    input.releaseTransport(input.socket);
  await stopProcess(input, state);
  // A late authenticated application may exit while shutdown is in flight.
  await confirmExternalApplicationExit(
    input.resources,
    input.socket,
    input.releaseTransport,
  );
  recordUnconfirmedDocument(input, state);
  await report(input.progress, 0.75, "removing Hopper private runtime files");
  if (
    input.resources.runtimeRoot !== undefined &&
    (!state.processStopped ||
      (!input.resources.shutdownConfirmed &&
        (input.resources.launch?.preparedImagePath !== undefined ||
          input.resources.launch?.providerLifetime === "external-application")))
  ) {
    const resource = input.resources.runtimeRoot.path;
    state.resources.add(resource);
    state.issues.push({
      resource,
      reason:
        "Private runtime retained because process or native document closure was not confirmed",
    });
  } else {
    await closeRuntimeRoot(input, state);
  }
  if (state.processStopped && input.resources.shutdownConfirmed) {
    const launch = input.resources.launch;
    try {
      await launch?.releaseLease?.();
      input.resources.launch = undefined;
    } catch (cause: unknown) {
      state.resources.add("hopper-lease");
      state.issues.push({
        resource: "hopper-lease",
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return cleanupOutcome(input, state);
};

export const confirmExternalApplicationExit = async (
  resources: HopperOwnedResources,
  socket: Socket | undefined,
  releaseTransport: (socket: Socket | undefined) => void,
  observeExit: typeof observeProcessStartIdentityExit = observeProcessStartIdentityExit,
): Promise<void> => {
  const application = resources.externalApplication;
  if (
    resources.shutdownConfirmed ||
    resources.launch?.providerLifetime !== "external-application" ||
    application?.identity.state !== "readable"
  )
    return;
  if (
    (await observeExit(application.pid, application.identity.identity)) ===
    "exited"
  ) {
    resources.shutdownConfirmed = true;
    releaseTransport(socket);
  }
};

const requestShutdown = async (
  input: HopperCleanupInput,
  state: CleanupState,
): Promise<void> => {
  if (
    input.resources.shutdownConfirmed ||
    input.socket === undefined ||
    input.socket.destroyed ||
    input.activeRequest !== null
  ) {
    if (input.activeRequest !== null)
      input.logger.warn(
        {
          method: input.activeRequest.operation,
          callerState: input.activeRequest.callerState,
        },
        "Hopper shutdown skipped because a bridge operation remained active",
      );
    return;
  }
  const method =
    (input.retainDocument &&
      input.resources.launch?.preparedImagePath === undefined) ||
    input.resources.launch?.shutdownMode === "process-cleanup"
      ? "shutdown"
      : "shutdown_document";
  const shutdown = await input
    .request(method)
    .catch((cause: unknown) => err(shutdownRequestFailure(method, cause)));
  if (
    shutdown.ok &&
    isHopperCleanupRequired(shutdown.value) &&
    input.resources.launch?.shutdownMode === "process-cleanup"
  ) {
    state.cleanupResult = await input.resources.launch
      .cleanup()
      .catch(providerCleanupFailure);
    if (!state.cleanupResult.cleaned) {
      input.resources.shutdownConfirmed = await fallbackDocumentShutdown(input);
    }
  } else if (shutdown.ok) {
    input.resources.shutdownConfirmed = isHopperShutdownAcknowledgement(
      shutdown.value,
    );
  }
  if (
    !shutdown.ok ||
    (!input.resources.shutdownConfirmed && state.cleanupResult === undefined)
  )
    input.logger.warn(
      {
        status: shutdown.ok ? "invalid-acknowledgement" : "failed",
        ...(shutdown.ok ? {} : shutdownFailureDetails(shutdown.error)),
      },
      "Hopper document shutdown was not confirmed",
    );
};

const fallbackDocumentShutdown = async (
  input: HopperCleanupInput,
): Promise<boolean> => {
  const fallback = await input
    .request("shutdown_document")
    .catch((cause: unknown) =>
      err(shutdownRequestFailure("shutdown_document", cause)),
    );
  const confirmed =
    fallback.ok && isHopperShutdownAcknowledgement(fallback.value);
  if (!confirmed)
    input.logger.warn(
      {
        status: fallback.ok ? "invalid-acknowledgement" : "failed",
        ...(fallback.ok ? {} : shutdownFailureDetails(fallback.error)),
      },
      "Hopper document shutdown fallback was not confirmed",
    );
  return confirmed;
};

const shutdownRequestFailure = (
  operation: "shutdown" | "shutdown_document",
  cause: unknown,
): HopperProcessError => {
  return new HopperProcessError(null, { operation, cause });
};

const shutdownFailureDetails = (
  error: HopperError,
): Record<string, JsonValue> => ({
  errorTag: error._tag,
  ...(error instanceof HopperProcessError && error.operation !== undefined
    ? { operation: error.operation }
    : {}),
  ...(error instanceof HopperProcessError && error.requestId !== undefined
    ? { requestId: error.requestId }
    : {}),
  ...(error.cause === undefined
    ? {}
    : { failure_cause: describeFailureCause(error.cause) }),
});

const describeFailureCause = (cause: unknown): JsonValue => {
  if (cause instanceof Error) {
    const code = "code" in cause ? cause.code : undefined;
    return {
      name: cause.name,
      message: cause.message,
      ...(typeof code === "string" ||
      (typeof code === "number" && Number.isFinite(code))
        ? { code }
        : {}),
    };
  }
  if (typeof cause === "string") return { type: "string", message: cause };
  if (
    cause === null ||
    typeof cause === "boolean" ||
    (typeof cause === "number" && Number.isFinite(cause))
  )
    return { type: cause === null ? "null" : typeof cause, value: cause };
  return { type: typeof cause };
};

const stopProcess = async (
  input: HopperCleanupInput,
  state: CleanupState,
): Promise<void> => {
  const supervisor = input.resources.processSupervisor;
  if (supervisor === undefined) return;
  const stopped = await supervisor.stop(
    state.cleanupResult === undefined
      ? {}
      : { cleanupResult: state.cleanupResult },
  );
  const diagnostic = createOwnedHopperShutdownDiagnostic(
    supervisor.launch,
    stopped,
    state.cleanupResult,
  );
  try {
    input.onDiagnostic?.(diagnostic);
  } catch (cause: unknown) {
    // Diagnostic consumers cannot change the already-observed cleanup result.
    void cause;
  }
  input.logger.info(diagnostic, "Owned Hopper launcher shutdown completed");
  if (stopped.status !== "incomplete") {
    if (
      input.resources.launch?.providerLifetime === "launcher-process" &&
      stopped.status !== "not-owned"
    )
      input.resources.shutdownConfirmed = true;
    state.processStopped = true;
    input.resources.processSupervisor = undefined;
    return;
  }
  const processGroupId = supervisor.launch.ownership?.processGroupId;
  const resource =
    processGroupId === undefined
      ? "hopper-process"
      : `process-group:${String(processGroupId)}`;
  state.resources.add(resource);
  state.issues.push({ resource, reason: stopped.reason });
  input.logger.warn(
    { reason: stopped.reason },
    "Owned launcher cleanup failed closed",
  );
};

const recordUnconfirmedDocument = (
  input: HopperCleanupInput,
  state: CleanupState,
): void => {
  if (
    input.socket === undefined &&
    state.processStopped &&
    input.resources.launch?.providerLifetime === "launcher-process"
  ) {
    // Startup never connected a document; the verified provider lifetime ended.
    input.resources.shutdownConfirmed = true;
  }
  if (
    (input.socket === undefined && input.resources.launch === undefined) ||
    input.resources.shutdownConfirmed
  )
    return;
  state.resources.add("hopper-document");
  state.issues.push({
    resource: "hopper-document",
    reason:
      input.activeRequest === null
        ? "authenticated shutdown acknowledgement was not observed"
        : `bridge operation ${input.activeRequest.operation} remained active after caller ${input.activeRequest.callerState}`,
  });
};

const closeRuntimeRoot = async (
  input: HopperCleanupInput,
  state: CleanupState,
): Promise<void> => {
  const runtimeRoot = input.resources.runtimeRoot;
  try {
    await runtimeRoot?.close();
    input.resources.runtimeRoot = undefined;
  } catch (cause: unknown) {
    const resource = runtimeRoot?.path ?? "hopper-runtime-root";
    state.resources.add(resource);
    state.issues.push({
      resource,
      reason:
        cause instanceof Error
          ? cause.message
          : "private runtime root cleanup failed",
    });
  }
};

const cleanupOutcome = (
  input: HopperCleanupInput,
  state: CleanupState,
): Result<null, AnalysisError> => {
  if (state.issues.length === 0) return ok(null);
  return err(
    new ProviderCleanupError(
      "hopper",
      [...state.resources],
      {
        issues: cleanupIssueDetails(state.issues),
        ...(input.resources.runtimeRoot === undefined
          ? {}
          : { runtime_root: input.resources.runtimeRoot.path }),
        ...(input.activeRequest === null
          ? {}
          : { active_request: activityDetails(input.activeRequest) }),
        ...(state.resources.has("hopper-document")
          ? {
              authenticated_application:
                input.resources.externalApplication === undefined
                  ? "not_observed"
                  : input.resources.externalApplication.identity.state,
            }
          : {}),
      },
      state.resources.has("hopper-document")
        ? {
            remediationAction:
              "Export the Evidence bundle before close_binary clears session records. Let Hopper finish initial analysis or complete its pending dialog, then retry close_binary on this connection so REA can authenticate and close the retained document. If no matching bridge becomes available, manually close the reported document in Hopper, then restart the MCP connection. A helper exit or open:false does not establish that retained cleanup is complete.",
          }
        : undefined,
    ),
  );
};

const cleanupIssueDetails = (issues: readonly CleanupIssue[]): JsonValue =>
  issues.map((issue) => ({
    resource: issue.resource,
    reason: issue.reason,
  }));

const activityDetails = (activity: HopperRequestActivity): JsonValue => ({
  request_id: activity.requestId,
  operation: activity.operation,
  elapsed_ms: activity.elapsedMs,
  caller_state: activity.callerState,
  queued_requests: activity.queuedRequests,
});

const report = async (
  progress: ProgressReporter | undefined,
  completed: number,
  message: string,
): Promise<void> => {
  // best-effort cleanup: progress reporting must not fail session cleanup.
  await progress
    ?.report({
      phase: "hopper_cleanup",
      completed,
      total: 1,
      message,
    })
    .catch(() => undefined);
};
