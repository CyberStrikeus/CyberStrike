import { DarwinProcessOwnershipInspectionError } from "../DarwinProcessRunTokenReader.js";
import {
  AnalysisError,
  type AnalysisErrorOptions,
} from "../../domain/analysisErrorBase.js";
import type {
  PartialProcessCaptureObservation,
  ProcessCaptureCleanupReport,
} from "../../domain/process/processCapture.js";

interface ProcessCaptureErrorOptions extends AnalysisErrorOptions {
  readonly userMessage?: string;
  readonly userCategory?: "cancelled";
  readonly reason?: "capture_failed" | "cleanup_incomplete" | "cancelled";
  readonly executionFailure?: string;
  readonly partialObservation?: PartialProcessCaptureObservation;
  readonly cleanupReport?: ProcessCaptureCleanupReport;
}

/** Typed application failure produced by controlled process capture. */
export class ProcessCaptureError extends AnalysisError {
  readonly _tag = "ProcessCaptureError";

  override readonly userMessage: string | undefined;
  override readonly userCategory: "cancelled" | undefined;
  readonly reason: NonNullable<ProcessCaptureErrorOptions["reason"]>;
  override readonly executionFailure: string | undefined;
  override readonly partialObservation:
    | PartialProcessCaptureObservation
    | undefined;
  override readonly cleanupReport: ProcessCaptureCleanupReport | undefined;

  constructor(message: string, options?: ProcessCaptureErrorOptions) {
    super(message, options);
    this.userMessage = options?.userMessage ?? message;
    this.userCategory = options?.userCategory;
    this.reason =
      options?.reason ??
      (options?.userCategory === "cancelled" ? "cancelled" : "capture_failed");
    this.cleanupIncomplete ||= this.reason === "cleanup_incomplete";
    this.executionFailure = options?.executionFailure ?? message;
    this.partialObservation = options?.partialObservation;
    this.cleanupReport = options?.cleanupReport;
  }

  /** Add final capture observations while preserving primary facts and cleanup ownership. */
  withFinalization(
    options: Pick<
      ProcessCaptureErrorOptions,
      "executionFailure" | "partialObservation" | "cleanupReport"
    > & { readonly cleanupFailure?: AnalysisError },
  ): ProcessCaptureError {
    const secondary = options.cleanupFailure;
    const resources = [
      ...new Set([
        ...this.cleanupResources,
        ...(secondary?.cleanupResources ?? []),
      ]),
    ];
    const executionFailure = this.executionFailure ?? options.executionFailure;
    const partialObservation =
      this.partialObservation ?? options.partialObservation;
    const cleanupReport = this.cleanupReport ?? options.cleanupReport;
    const finalized = new ProcessCaptureError(this.message, {
      cleanupPrimary: this,
      ...(Object.hasOwn(this, "cause") ? { cause: this.cause } : {}),
      ...(this.userMessage === undefined
        ? {}
        : { userMessage: this.userMessage }),
      ...(this.userCategory === undefined
        ? {}
        : { userCategory: this.userCategory }),
      reason: this.reason,
      ...(this.capturedOutput === undefined
        ? {}
        : { capturedOutput: this.capturedOutput }),
      ...(secondary === undefined
        ? this.cleanup === undefined
          ? {}
          : { cleanup: this.cleanup }
        : { cleanup: { reason: secondary.message, resources } }),
      ...(executionFailure === undefined ? {} : { executionFailure }),
      ...(partialObservation === undefined ? {} : { partialObservation }),
      ...(cleanupReport === undefined ? {} : { cleanupReport }),
    }).bindCleanupDependencies([
      this,
      ...(secondary === undefined ? [] : [secondary]),
    ]);
    if (secondary !== undefined) finalized.retainSecondaryFailure(secondary);
    return finalized;
  }
}

/** Return one non-recursive, domain-neutral summary of an execution failure. */
export const describeProcessCaptureExecutionFailure = (
  failure: unknown,
): string | undefined => {
  if (failure instanceof Error) return failure.message || failure.name;
  if (typeof failure === "string") return failure;
  if (failure === undefined) return undefined;
  return "Process capture failed with a non-error rejection.";
};

/** Caller-visible cancellation without exposing capture implementation state. */
export const processCaptureCancelled = (
  reason?: unknown,
): ProcessCaptureError =>
  new ProcessCaptureError("process capture was cancelled", {
    cause: reason,
    userCategory: "cancelled",
    reason: "cancelled",
    userMessage: "Process capture was cancelled. Start it again when ready.",
  });

/** Preserve typed process-inspection preflight failures at the capture boundary. */
export const normalizeCaptureFailure = (
  cause: unknown,
  signal: AbortSignal | undefined,
): unknown => {
  if (cause instanceof ProcessCaptureError) return cause;
  if (cause instanceof DarwinProcessOwnershipInspectionError) {
    const normalized = new ProcessCaptureError(cause.message, {
      cause,
      ...(cause.cancellation === undefined
        ? {}
        : { userCategory: "cancelled" as const, reason: "cancelled" as const }),
      ...(cause.cleanupFailure === undefined
        ? {}
        : {
            cleanup: {
              reason: cause.cleanupFailure.message,
              resources: cause.cleanupFailure.cleanupResources,
            },
          }),
      ...(cause.capturedOutput === undefined
        ? {}
        : { capturedOutput: cause.capturedOutput }),
    });
    return cause.cleanupFailure === undefined
      ? normalized
      : normalized.bindCleanupDependencies([cause.cleanupFailure]);
  }
  if (
    signal?.aborted === true &&
    (cause === signal.reason ||
      (cause instanceof Error && cause.name === "AbortError"))
  )
    return processCaptureCancelled(signal.reason);
  return cause;
};
