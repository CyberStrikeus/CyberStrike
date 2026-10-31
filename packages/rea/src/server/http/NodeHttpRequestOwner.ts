import type { IncomingMessage, ServerResponse } from "node:http";

import { writeWebResponse } from "./nodeHttpBridge.js";
import { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";

export type HttpAdmissionLifetime = "dispatch" | "response";

export interface NodeHttpExchangeContext {
  readonly onDispatchSettled: (state: {
    readonly hasUnreadBody: boolean;
    readonly admissionLifetime: HttpAdmissionLifetime;
  }) => void;
  readonly onBodyCleanup: (cleanup: Promise<void>) => void;
}

interface NodeHttpRequestTarget {
  readonly serve: (
    request: IncomingMessage,
    response: ServerResponse,
    context: NodeHttpExchangeContext,
  ) => Promise<void>;
  readonly refuse: (reason: "capacity" | "cleanup") => Response;
}

/** Own admitted exchanges and separately joinable response-source cleanup. */
export class NodeHttpRequestOwner {
  #active = 0;
  readonly #exchanges = new Set<Promise<void>>();
  readonly #bodyCleanups = new Set<Promise<void>>();
  readonly #cleanupFailures: unknown[] = [];

  constructor(
    private readonly capacity: number,
    private readonly target: NodeHttpRequestTarget,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new RangeError(
        "maxConcurrentDispatches must be a positive safe integer",
      );
  }

  handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Node queues a pipelined response without assigning a socket until its
    // predecessor finishes. Never start work or queue a refusal behind it.
    if (request.socket.destroyed || response.socket === null) {
      request.socket.destroy();
      return Promise.resolve();
    }
    const refusal =
      this.#cleanupFailures.length > 0
        ? "cleanup"
        : this.#active >= this.capacity
          ? "capacity"
          : undefined;
    if (refusal !== undefined) {
      return this.#trackExchange(async () => {
        try {
          await writeWebResponse(this.target.refuse(refusal), response, {
            closeConnection: true,
            onBodyCleanup: this.#trackBodyCleanup,
          });
        } catch {
          response.destroy();
        }
      });
    }
    this.#active += 1;
    let reserved = true;
    let dispatched = false;
    let inputDone = false;
    let responseDone = false;
    let holdResponse = true;
    let pendingCleanups = 0;
    let cleanupFailed = false;
    const release = (): void => {
      if (!reserved) return;
      reserved = false;
      this.#active -= 1;
      request.off("end", inputEnded);
      request.off("close", inputEnded);
      response.off("close", inputEnded);
    };
    const releaseIfReady = (): void => {
      if (
        dispatched &&
        inputDone &&
        (!holdResponse ||
          (responseDone && pendingCleanups === 0 && !cleanupFailed))
      )
        release();
    };
    const inputEnded = (): void => {
      inputDone = true;
      releaseIfReady();
    };
    return this.#trackExchange(async () => {
      if (request.socket.destroyed || response.destroyed) {
        release();
        return;
      }
      try {
        await this.target.serve(request, response, {
          onBodyCleanup: (cleanup) => {
            pendingCleanups += 1;
            this.#trackBodyCleanup(cleanup, (succeeded) => {
              pendingCleanups -= 1;
              cleanupFailed ||= !succeeded;
              releaseIfReady();
            });
          },
          onDispatchSettled: ({ hasUnreadBody, admissionLifetime }) => {
            dispatched = true;
            holdResponse = admissionLifetime === "response";
            if (!hasUnreadBody || request.destroyed || response.destroyed) {
              inputEnded();
              return;
            }
            request.once("end", inputEnded);
            request.once("close", inputEnded);
            response.once("close", inputEnded);
          },
        });
      } catch (cause: unknown) {
        response.destroy();
        release();
        throw cause;
      } finally {
        responseDone = true;
        releaseIfReady();
      }
    });
  }

  #trackExchange(serve: () => Promise<void>): Promise<void> {
    const exchange = Promise.resolve().then(serve);
    this.#exchanges.add(exchange);
    return exchange.finally(() => this.#exchanges.delete(exchange));
  }

  readonly #trackBodyCleanup = (
    cleanup: Promise<void>,
    settled?: (succeeded: boolean) => void,
  ): void => {
    this.#bodyCleanups.add(cleanup);
    void cleanup.then(
      () => {
        this.#bodyCleanups.delete(cleanup);
        settled?.(true);
      },
      (cause: unknown) => {
        this.#cleanupFailures.push(cause);
        this.#bodyCleanups.delete(cleanup);
        settled?.(false);
      },
    );
  };

  async drain(): Promise<void> {
    // An exchange can register cancellation after its route has returned,
    // including when a late Response finds that its client already left.
    while (this.#exchanges.size > 0) await Promise.allSettled(this.#exchanges);
    while (this.#bodyCleanups.size > 0)
      await Promise.allSettled(this.#bodyCleanups);
    if (this.#cleanupFailures.length > 0)
      throw new AnalysisResourceConstraintError(
        "mcp_http_response_cleanup",
        "transport",
        "HTTP response cleanup could not be confirmed; provider shutdown remains blocked",
        { failed_cleanup_count: this.#cleanupFailures.length },
        {
          cause: new AggregateError(
            this.#cleanupFailures,
            "Response cleanup failed",
          ),
          retryable: false,
        },
      );
  }
}
