import {
  DEFAULT_REQUEST_TIMEOUT_MSEC,
  SdkError,
  SdkErrorCode,
} from "@modelcontextprotocol/client";
import {
  AnalysisCancelledError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";
import { MAX_NODE_TIMER_DELAY_MS } from "../domain/analysisResourceLimits.js";
import { ProviderStartupDeadline } from "../process/ProviderDeadline.js";

/** Which JEB MCP phase consumed `REA_JEB_MCP_TIMEOUT_MS`. */
export type JebMcpDeadlinePhase = "discovery" | "tools/call";

/** Name the launch-environment deadline that both JEB phases share. */
export const jebMcpTimeoutGuidance = (
  phase: JebMcpDeadlinePhase,
  timeoutMs: number,
): { readonly userMessage: string; readonly remediationAction: string } => ({
  userMessage: `This request reached REA's configured JEB ${phase === "discovery" ? "catalog discovery" : phase} deadline of ${String(timeoutMs)} ms (deadlineExpired).`,
  remediationAction: `Increase REA_JEB_MCP_TIMEOUT_MS in REA's launch environment to an integer from 1 to ${String(MAX_NODE_TIMER_DELAY_MS)} milliseconds (omitted means ${String(DEFAULT_REQUEST_TIMEOUT_MSEC)} ms) and restart and reconnect REA to apply it. The same setting raises catalog discovery and each tools/call. Allow execution, cleanup and delivery headroom in the outer MCP client deadline. Confirm outstanding work and cleanup before retrying.`,
});

/** SDK 2.3.1 preserves an SdkError abort reason by identity. */
export class JebMcpDeadline {
  readonly #deadline: ProviderStartupDeadline;
  readonly #controller = new AbortController();
  readonly #interruption = new SdkError(
    SdkErrorCode.RequestTimeout,
    "JEB MCP interrupted",
  );
  readonly #onAbort = (): void => this.#controller.abort(this.#interruption);

  constructor(
    readonly timeoutMs: number,
    signal?: AbortSignal,
    readonly phase: JebMcpDeadlinePhase = "tools/call",
  ) {
    this.#deadline = new ProviderStartupDeadline(timeoutMs, signal);
    if (this.#deadline.signal.aborted) this.#onAbort();
    else
      this.#deadline.signal.addEventListener("abort", this.#onAbort, {
        once: true,
      });
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }
  remainingMs(): number {
    return this.#deadline.remainingMs();
  }

  /** Classify only the rejection produced by this deadline's exact abort. */
  failure(operation: string, cause: unknown): unknown {
    if (cause === this.#interruption) {
      return this.#deadline.interruption === "timeout"
        ? new AnalysisTimeoutError(operation, this.timeoutMs, {
            cause: this.#deadline.signal.reason,
            ...jebMcpTimeoutGuidance(this.phase, this.timeoutMs),
          })
        : new AnalysisCancelledError(operation, {
            cause: this.#deadline.signal.reason,
          });
    }
    if (cause instanceof SdkError && cause.code === SdkErrorCode.RequestTimeout)
      return new AnalysisTimeoutError(operation, this.timeoutMs, {
        cause,
        ...jebMcpTimeoutGuidance(this.phase, this.timeoutMs),
      });
    return cause;
  }

  dispose(): void {
    this.#deadline.signal.removeEventListener("abort", this.#onAbort);
    this.#deadline.dispose();
  }
}
