import { AnalysisCancelledError } from "../../domain/analysisErrorCore.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { WebExecution } from "../../domain/webExecution.js";
import type { CdpEvent } from "../CdpConnection.js";
import type { CdpRuntimeSession } from "./CdpRuntimeSession.js";
import { BrowserObservationError } from "../../domain/browserObservationError.js";
import {
  selectCdpFrameIdentity,
  cdpFrameEventFacts,
} from "../CdpFrameIdentity.js";

type EndReason = WebExecution["window"]["end_reason"];
/** One finite document-scoped window, with an actual armed point and event-driven termination. */
export class CdpExecutionWindow {
  armedAt: string | undefined;
  endedAt: string | undefined;
  reason: EndReason | undefined;
  #timer: NodeJS.Timeout | undefined;
  #resolve: ((reason: EndReason) => void) | undefined;
  #reject: ((error: AnalysisError) => void) | undefined;
  #failure: AnalysisError | undefined;
  #removeAbort: (() => void) | undefined;
  constructor(
    readonly session: Pick<CdpRuntimeSession, "operation" | "options"> & {
      readonly target: { readonly frame_id: string };
    },
  ) {}

  /** Collection ends on a main-document replacement, never follows source URLs into another context. */
  ingest(event: CdpEvent): void {
    if (event.method === "Target.detachedFromTarget") {
      this.end("session_detached");
      return;
    }
    if (event.method === "Inspector.targetCrashed") {
      this.end("target_terminated");
      return;
    }
    if (!this.active) return;
    if (event.method === "Runtime.executionContextsCleared")
      this.end("document_changed");
    if (event.method === "Page.frameNavigated") {
      const identity = selectCdpFrameIdentity(
        cdpFrameEventFacts(event),
        this.session.target.frame_id,
      );
      if (identity.identityIssue !== null || identity.parentIssue !== null) {
        this.fail(
          new BrowserObservationError(this.session.operation, "protocol_error"),
        );
        return;
      }
      if (identity.selection === "main") {
        this.end("document_changed");
        return;
      }
      if (identity.parentRelation === "child") return;
      if (
        identity.selection === "other" &&
        identity.parentRelation === "root"
      ) {
        this.end("document_changed");
        return;
      }
      this.fail(
        new BrowserObservationError(this.session.operation, "protocol_error"),
      );
      return;
    }
    if (
      event.method === "Page.frameDetached" &&
      cdpFrameEventFacts(event).frameId === this.session.target.frame_id
    )
      this.end("document_changed");
  }
  /** Metadata before arming is inventory; request events outside the window are excluded. */
  get active(): boolean {
    return (
      this.armedAt !== undefined &&
      this.reason === undefined &&
      this.endedAt === undefined
    );
  }

  /** The timer starts at arming, before progress delivery can delay the external action. */
  start(duration: number): Promise<EndReason> {
    if (this.#failure !== undefined) return Promise.reject(this.#failure);
    if (this.reason !== undefined) return Promise.resolve(this.reason);
    this.armedAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
      this.#timer = setTimeout(() => this.end("window_elapsed"), duration);
      const signal = this.session.options.signal;
      const abort = (): void => {
        this.fail(
          new AnalysisCancelledError(this.session.operation, {
            cause: signal?.reason,
          }),
        );
      };
      this.#removeAbort = () => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  /** A producer lifecycle fact ends the window; instrumentation cleanup still requires confirmation. */
  end(reason: EndReason): void {
    if (this.reason !== undefined || this.#failure !== undefined) return;
    this.reason = reason;
    this.endedAt = new Date().toISOString();
    this.dispose();
    this.#resolve?.(reason);
  }
  /** Invalid producer data ends instrumentation immediately with its original failure. */
  fail(error: AnalysisError): void {
    if (this.reason !== undefined || this.#failure !== undefined) return;
    this.#failure = error;
    this.endedAt = new Date().toISOString();
    this.dispose();
    this.#reject?.(error);
  }
  /** Surface a failure recorded before local arming without emitting misleading progress. */
  check(): void {
    if (this.#failure !== undefined) throw this.#failure;
  }
  /** Release local timer and abort listener on every setup/failure path. */
  dispose(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#removeAbort?.();
  }
}
