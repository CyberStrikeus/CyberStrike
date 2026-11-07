import type {
  BrowserObservationFailureReason,
  BrowserObservationOperation,
} from "./browserObservationErrors.js";
import {
  AnalysisError,
  type AnalysisCleanupObservation,
  type AnalysisErrorOptions,
} from "./analysisErrorBase.js";
import { AnalysisCancelledError } from "./analysisErrorCore.js";

/** Describe browser cleanup failure without discarding its resource evidence. */
export const browserCleanupObservation = (
  cause: unknown,
): AnalysisCleanupObservation =>
  cause instanceof AnalysisError && cause.cleanup !== undefined
    ? cause.cleanup
    : {
        reason: cause instanceof Error ? cause.message : String(cause),
        resources:
          cause instanceof AnalysisError && cause.cleanupResources.length > 0
            ? cause.cleanupResources
            : ["browser_transport"],
      };

/** A bounded passive browser observation failed at its CDP boundary. */
export class BrowserObservationError extends AnalysisError {
  readonly _tag = "BrowserObservationError";
  override cleanupIncomplete: boolean;
  override readonly userCategory: "cancelled" | undefined;
  override readonly userMessage: string | undefined;
  /** Producer-supplied explanation; undefined selects the operation default. */
  readonly detail: string | undefined;
  readonly remediationAction: string | undefined;

  constructor(
    readonly operation: BrowserObservationOperation,
    readonly reason: BrowserObservationFailureReason,
    options?: AnalysisErrorOptions & {
      readonly detail?: string;
      readonly remediationAction?: string;
    },
  ) {
    super(`Browser observation ${operation} failed: ${reason}`, options);
    this.detail = options?.detail;
    this.userMessage =
      options?.detail ?? observationFailureMessage(operation, reason);
    this.remediationAction = options?.remediationAction;
    this.cleanupIncomplete =
      this.cleanup !== undefined || reason === "cleanup_failed";
    this.setCleanupResources(
      this.cleanup?.resources ??
        (reason === "cleanup_failed" ? ["browser_transport"] : []),
    );
    this.userCategory =
      reason === "cancelled" ||
      options?.cause instanceof AnalysisCancelledError ||
      (options?.cause instanceof AnalysisError &&
        options.cause.userCategory === "cancelled")
        ? "cancelled"
        : undefined;
  }

  /**
   * Attribute this failure to the caller's operation without discarding
   * producer facts; the original cause keeps the primary failure chain intact.
   */
  forOperation(
    operation: BrowserObservationOperation,
  ): BrowserObservationError {
    if (operation === this.operation) return this;
    return new BrowserObservationError(operation, this.reason, {
      cause: this.cause,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
      ...(this.remediationAction === undefined
        ? {}
        : { remediationAction: this.remediationAction }),
      cleanupPrimary: this.cleanupPrimary,
      diagnostics: this.diagnostics,
      capturedOutput: this.capturedOutput,
      cleanup: this.cleanup,
      partialObservation: this.partialObservation,
    });
  }
}

const observationFailureMessage = (
  operation: BrowserObservationOperation,
  reason: BrowserObservationFailureReason,
): string | undefined => {
  if (reason === "cancelled")
    return `${operation} was cancelled. Collected observations and cleanup status are reported when available.`;
  if (reason === "timeout")
    return `${operation} exceeded its execution deadline. Review the target's responsiveness and retained observations before retrying.`;
  if (reason === "endpoint_unreachable")
    return `${operation} could not reach the selected loopback debugging endpoint. Verify that the target process is running with debugging enabled and that the endpoint's port matches it, then retry.`;
  if (reason === "target_not_found")
    return `${operation} could not find the selected target at the debugging endpoint. Refresh target discovery for that endpoint and retry with a returned target ID.`;
  if (reason === "target_session_detached")
    return `${operation} lost its debugging session while the target may still exist. Refresh target discovery and attach to the selected target again.`;
  if (reason === "target_changed")
    return `${operation} could not retain a stable document because the target changed during observation. Retry after navigation settles; refresh target discovery if the selected page was replaced.`;
  if (reason === "service_worker_blocked")
    return `${operation} refused the selected page because it is controlled by or has a registered service worker while the service-worker policy is block. Set environment.service_workers to allow to permit observation, or remove the service worker registration through the browser.`;
  if (reason === "disconnected")
    return `${operation} lost its debugging connection. Verify that the target process is still running, refresh target discovery, and retry the observation.`;
  return undefined;
};
