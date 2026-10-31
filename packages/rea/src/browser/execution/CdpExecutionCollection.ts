import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { cdpTargetEventMatches } from "../CdpTargetEvents.js";
import { CdpExecutionWindow } from "./CdpExecutionWindow.js";
import { CdpRuntimeRequests } from "./CdpRuntimeRequests.js";
import type { CdpRuntimeSources } from "./CdpRuntimeSources.js";

/** Own source/request collection and failure subscriptions through a precise-sample cutoff. */
export class CdpExecutionCollection {
  readonly window: CdpExecutionWindow;
  readonly requests: CdpRuntimeRequests;
  readonly #unsubscribers: readonly (() => void)[];
  #metadataOpen = true;

  constructor(readonly sources: CdpRuntimeSources) {
    const session = sources.session;
    this.window = new CdpExecutionWindow(session);
    this.requests = new CdpRuntimeRequests(sources);
    this.#unsubscribers = [
      session.transport.connection.onEvent((event) => {
        if (!cdpTargetEventMatches(event, session.transport.sessionId)) return;
        try {
          if (
            this.#metadataOpen &&
            (this.window.reason === undefined ||
              this.window.reason === "window_elapsed")
          )
            sources.ingest(event);
          else if (this.window.reason === "window_elapsed")
            sources.verifyKnownIdentity(event);
          if (this.window.active) this.requests.ingest(event);
          sources.check();
          this.requests.check();
        } catch (cause: unknown) {
          this.window.fail(
            cause instanceof AnalysisError
              ? cause
              : new AnalysisOutputError(session.operation, String(cause)),
          );
        }
        this.window.ingest(event);
      }),
      session.transport.connection.onDisconnect((error) =>
        this.window.fail(error),
      ),
      session.transport.connection.onProtocolFailure((error) =>
        this.window.fail(error),
      ),
    ];
  }

  /** Freeze metadata after receiving the final sample so source joins use one fixed inventory. */
  freezeMetadata(): void {
    this.#metadataOpen = false;
    this.sources.check();
  }

  /** Remove every owned subscription and local timer on success, cancellation or failure. */
  close(): void {
    this.#metadataOpen = false;
    this.window.dispose();
    for (const unsubscribe of this.#unsubscribers) unsubscribe();
  }
}
