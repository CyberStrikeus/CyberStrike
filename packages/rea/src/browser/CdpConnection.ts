import WebSocket, { type RawData } from "ws";

import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import { CdpCommandRejection } from "./CdpCommandRejection.js";
import type { BrowserObservationOperation } from "../domain/browserObservationErrors.js";
import {
  cdpCleanupGraceExpired,
  cdpCommandDeadlineRecovery,
  cdpCommandTimeoutIsSelectable,
  cdpCommandTimeoutUnrelatedControl,
  DEFAULT_CDP_COMMAND_TIMEOUT_MS,
  noRuntimeOverrideSentence,
} from "../domain/browserDeadline.js";
import { safeParseJson } from "../domain/safeJson.js";
import { WEB_RUNTIME_LIMITS } from "../domain/webRuntime.js";

// ws currently stores maxPayload as a signed 32-bit integer. Larger values can
// wrap to a negative number, which disables its limit check.
const MAX_WEBSOCKET_PAYLOAD_BYTES = 0x7fff_ffff;

export interface CdpEvent {
  readonly method: string;
  readonly params: unknown;
  readonly sessionId?: string | undefined;
}

export interface CdpTransportEvent extends CdpEvent {
  /** Original WebSocket message payload size, before JSON parsing. */
  readonly wireBytes: number;
}

interface PendingCommand {
  readonly method: string;
  readonly sessionId?: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: AnalysisError) => void;
  readonly dispose: () => void;
  readonly reschedule: (timeoutMs: number) => void;
}

/** Correlated JSON-RPC transport for one CDP target operation. */
export class CdpConnection {
  readonly #pending = new Map<number, PendingCommand>();
  readonly #listeners = new Set<(event: CdpTransportEvent) => void>();
  readonly #disconnectListeners = new Set<
    (error: BrowserObservationError) => void
  >();
  readonly #protocolFailureListeners = new Set<
    (error: BrowserObservationError) => void
  >();
  #nextId = 1;
  #closed = false;
  #closePromise: Promise<void> | undefined;
  #protocolFailed = false;
  #transportFailure: "disconnected" | "payload_limit" = "disconnected";
  #commandTimeoutMs: number;
  #deadlineKind: "command" | "cleanup" = "command";

  private constructor(
    private readonly socket: WebSocket,
    private readonly operation: BrowserObservationOperation,
    private readonly maxPayloadBytes: number,
    commandTimeoutMs: number,
  ) {
    this.#commandTimeoutMs = commandTimeoutMs;
    socket.on("message", (data) => this.#receive(data));
    socket.on("close", () => this.#disconnect());
    socket.on("error", (cause) =>
      this.#disconnect(
        isRecord(cause) && cause.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
          ? "payload_limit"
          : "disconnected",
      ),
    );
  }

  /** Connect to one already-validated loopback CDP WebSocket. */
  static async connect(
    url: string,
    operation: BrowserObservationOperation,
    signal?: AbortSignal,
    limits?: {
      readonly maxPayloadBytes?: number;
      readonly commandTimeoutMs?: number;
      /** Handshake budget. Discovery passes its own deadline so a short command budget cannot start first. */
      readonly handshakeTimeoutMs?: number;
    },
    onConnected?: (connection: CdpConnection) => void,
  ): Promise<CdpConnection> {
    if (signal?.aborted === true)
      throw new AnalysisCancelledError(operation, { cause: signal.reason });
    const maxPayloadBytes =
      limits?.maxPayloadBytes ?? WEB_RUNTIME_LIMITS.protocolBytes;
    const commandTimeoutMs =
      limits?.commandTimeoutMs ?? DEFAULT_CDP_COMMAND_TIMEOUT_MS;
    const handshakeTimeoutMs = limits?.handshakeTimeoutMs ?? commandTimeoutMs;
    if (
      !Number.isSafeInteger(maxPayloadBytes) ||
      maxPayloadBytes <= 0 ||
      maxPayloadBytes > MAX_WEBSOCKET_PAYLOAD_BYTES
    )
      throw new RangeError(
        `CDP maxPayloadBytes must be a positive safe integer no greater than ${String(MAX_WEBSOCKET_PAYLOAD_BYTES)}.`,
      );
    const socket = new WebSocket(url, {
      // waitForOpen owns the deadline and typed handshake failures; the
      // connection owner registers this socket before waiting for open.
      handshakeTimeout: 0,
      maxPayload: maxPayloadBytes,
      perMessageDeflate: false,
    });
    const connection = new CdpConnection(
      socket,
      operation,
      maxPayloadBytes,
      commandTimeoutMs,
    );
    try {
      onConnected?.(connection);
    } catch (cause: unknown) {
      await connection.close();
      throw cause;
    }
    try {
      await waitForOpen(socket, operation, signal, handshakeTimeoutMs);
    } catch (cause: unknown) {
      if (onConnected === undefined) {
        try {
          await connection.close();
        } catch (cleanupCause: unknown) {
          throw new AggregateError(
            [cause, cleanupCause],
            "CDP WebSocket handshake failed and its transport cleanup is incomplete.",
            { cause },
          );
        }
      }
      throw cause;
    }
    return connection;
  }

  /** Subscribe to validated CDP event envelopes. */
  onEvent(listener: (event: CdpTransportEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Subscribe to an unexpected transport loss while an operation is active. */
  onDisconnect(listener: (error: BrowserObservationError) => void): () => void {
    if (this.#closed) {
      listener(this.#transportError(this.#transportFailure));
      return () => undefined;
    }
    this.#disconnectListeners.add(listener);
    return () => this.#disconnectListeners.delete(listener);
  }

  /** Notify fatal wire parsing failure even when no command is outstanding. */
  onProtocolFailure(
    listener: (error: BrowserObservationError) => void,
  ): () => void {
    if (this.#protocolFailed) {
      listener(this.#transportError("protocol_error"));
      return () => undefined;
    }
    this.#protocolFailureListeners.add(listener);
    return () => this.#protocolFailureListeners.delete(listener);
  }

  /** Apply the post-discovery command deadline to commands that have not started. */
  selectCommandTimeout(timeoutMs: number): void {
    if (this.#deadlineKind === "cleanup") return;
    this.#commandTimeoutMs = timeoutMs;
  }

  /**
   * Restoration uses the fixed cleanup grace. Commands already waiting are
   * rescheduled from now so a raised command deadline cannot extend them.
   */
  beginCleanupGrace(timeoutMs: number): void {
    this.#deadlineKind = "cleanup";
    this.#commandTimeoutMs = timeoutMs;
    for (const pending of this.#pending.values()) pending.reschedule(timeoutMs);
  }

  /** Bound each response separately from the caller-selected observation window. */
  async send(
    method: string,
    params: Readonly<Record<string, unknown>> = {},
    sessionId?: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.#protocolFailed)
      throw new BrowserObservationError(this.operation, "protocol_error");
    if (this.#closed || this.socket.readyState !== WebSocket.OPEN)
      throw this.#transportError(this.#transportFailure);
    if (signal?.aborted === true)
      throw new AnalysisCancelledError(this.operation, {
        cause: signal.reason,
      });
    const id = this.#nextId;
    this.#nextId += 1;
    const message = JSON.stringify({
      id,
      method,
      params,
      ...(sessionId === undefined ? {} : { sessionId }),
    });
    return await new Promise((resolve, reject) => {
      const onAbort = (): void => {
        const pending = this.#pending.get(id);
        if (pending === undefined) return;
        this.#complete(id, pending);
        reject(
          new AnalysisCancelledError(this.operation, {
            cause: signal?.reason,
          }),
        );
      };
      const failTimeout = (): void => {
        const pending = this.#pending.get(id);
        if (pending === undefined) return;
        this.#complete(id, pending);
        if (this.#deadlineKind === "cleanup") {
          const detail = cdpCleanupGraceExpired();
          reject(
            new BrowserObservationError(this.operation, "timeout", {
              detail,
              remediationAction: detail,
            }),
          );
          return;
        }
        const recovery = cdpCommandDeadlineRecovery(
          this.#commandTimeoutMs,
          "command",
          method,
          cdpCommandTimeoutIsSelectable(this.operation),
        );
        reject(
          new BrowserObservationError(this.operation, "timeout", {
            detail: recovery.userMessage,
            remediationAction: recovery.remediationAction,
          }),
        );
      };
      let timer = setTimeout(failTimeout, this.#commandTimeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#pending.set(id, {
        method,
        ...(sessionId === undefined ? {} : { sessionId }),
        resolve,
        reject,
        reschedule: (timeoutMs: number): void => {
          clearTimeout(timer);
          timer = setTimeout(failTimeout, timeoutMs);
        },
        dispose: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        },
      });
      this.socket.send(message, (error) => {
        if (error === undefined || error === null) return;
        const pending = this.#pending.get(id);
        if (pending === undefined) return;
        this.#complete(id, pending);
        reject(
          new BrowserObservationError(this.operation, "disconnected", {
            cause: error,
          }),
        );
      });
    });
  }

  /** Close only REA's socket; never close the browser or selected page. */
  close(): Promise<void> {
    this.#closePromise ??= this.#closeTransport().catch((cause: unknown) => {
      this.#closePromise = undefined;
      throw cause;
    });
    return this.#closePromise;
  }

  async #closeTransport(): Promise<void> {
    this.#closed = true;
    this.#failPending("disconnected");
    if (socketIsClosed(this.socket)) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let fallbackStarted = false;
      let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (cause?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
        this.socket.off("close", onClose);
        if (cause === undefined) resolve();
        else reject(cause);
      };
      const onClose = (): void => finish();
      const forceClose = (gracefulFailure?: unknown): void => {
        if (settled || fallbackStarted) return;
        fallbackStarted = true;
        clearTimeout(timer);
        if (socketIsClosed(this.socket)) {
          finish();
          return;
        }
        try {
          this.socket.terminate();
        } catch (cause: unknown) {
          gracefulFailure =
            gracefulFailure === undefined
              ? cause
              : new AggregateError(
                  [gracefulFailure, cause],
                  "Graceful and forced CDP WebSocket close both failed.",
                  { cause: gracefulFailure },
                );
        }
        if (socketIsClosed(this.socket)) finish();
        else {
          fallbackTimer = setTimeout(() => {
            if (socketIsClosed(this.socket)) {
              finish();
              return;
            }
            finish(
              gracefulFailure ??
                new BrowserObservationError(this.operation, "cleanup_failed", {
                  detail: "REA could not confirm release of its CDP WebSocket.",
                }),
            );
          }, 1_000);
        }
      };
      const timer = setTimeout(() => forceClose(), 1_000);
      this.socket.once("close", onClose);
      try {
        this.socket.close();
      } catch (closeCause: unknown) {
        forceClose(closeCause);
      }
    });
  }

  #receive(data: RawData): void {
    if (this.#closed || this.#protocolFailed) return;
    const parsed = safeParseJson(rawText(data));
    if (!parsed.ok) {
      this.#failPending("protocol_error");
      return;
    }
    const message: unknown = parsed.value;
    if (!isRecord(message)) {
      this.#failPending("protocol_error");
      return;
    }
    if ("id" in message) {
      if (
        typeof message.id !== "number" ||
        !Number.isSafeInteger(message.id) ||
        message.id < 1
      ) {
        this.#failPending("protocol_error");
        return;
      }
      this.#receiveResponse(message, message.id);
      return;
    }
    if (
      typeof message.method !== "string" ||
      message.method.length === 0 ||
      ("params" in message && !isRecord(message.params)) ||
      ("sessionId" in message && typeof message.sessionId !== "string")
    ) {
      this.#failPending("protocol_error");
      return;
    }
    const wireBytes = rawByteLength(data);
    const event: CdpTransportEvent = {
      method: message.method,
      params: "params" in message ? message.params : {},
      wireBytes,
      ...(typeof message.sessionId === "string"
        ? { sessionId: message.sessionId }
        : {}),
    };
    for (const listener of this.#listeners) listener(event);
  }

  #receiveResponse(message: Record<string, unknown>, id: number): void {
    const pending = this.#pending.get(id);
    if (pending === undefined) return;
    const hasResult = "result" in message;
    const hasError = "error" in message;
    // Chromium cannot route a rejection through a flat session after that
    // session disappears. Its browser-level reply omits sessionId, but the
    // connection-global command id still binds this exact terminal error.
    const detachedSessionError =
      pending.sessionId !== undefined &&
      !("sessionId" in message) &&
      hasError &&
      isRecord(message.error) &&
      message.error.code === -32_001 &&
      message.error.message === "Session with given id not found.";
    if (
      (pending.sessionId === undefined
        ? "sessionId" in message
        : message.sessionId !== pending.sessionId && !detachedSessionError) ||
      hasResult === hasError
    ) {
      this.#failPending("protocol_error");
      return;
    }
    if (hasResult) {
      if (!isRecord(message.result)) {
        this.#failPending("protocol_error");
        return;
      }
      this.#complete(id, pending);
      pending.resolve(message.result);
      return;
    }
    const reported = message.error;
    if (
      !isRecord(reported) ||
      typeof reported.code !== "number" ||
      !Number.isSafeInteger(reported.code) ||
      typeof reported.message !== "string"
    ) {
      this.#failPending("protocol_error");
      return;
    }
    this.#complete(id, pending);
    pending.reject(
      new CdpCommandRejection(
        this.operation,
        pending.method,
        reported.code,
        reported.message,
      ),
    );
  }

  #complete(id: number, pending: PendingCommand): void {
    pending.dispose();
    this.#pending.delete(id);
  }

  #failPending(
    reason: "disconnected" | "protocol_error" | "payload_limit",
  ): void {
    const wasProtocolFailed = this.#protocolFailed;
    if (reason !== "protocol_error") this.#closed = true;
    else this.#protocolFailed = true;
    for (const [id, pending] of this.#pending) {
      this.#complete(id, pending);
      pending.reject(this.#transportError(reason));
    }
    if (reason === "protocol_error" && !wasProtocolFailed) {
      const error = this.#transportError(reason);
      for (const listener of this.#protocolFailureListeners) listener(error);
      this.#protocolFailureListeners.clear();
    }
  }

  #disconnect(reason: "disconnected" | "payload_limit" = "disconnected"): void {
    const wasClosed = this.#closed;
    if (!wasClosed) this.#transportFailure = reason;
    this.#failPending(reason);
    if (wasClosed) return;
    const error = this.#transportError(reason);
    for (const listener of this.#disconnectListeners) listener(error);
    this.#disconnectListeners.clear();
  }

  #transportError(
    reason: "disconnected" | "protocol_error" | "payload_limit",
  ): BrowserObservationError {
    return new BrowserObservationError(
      this.operation,
      reason,
      reason === "payload_limit"
        ? {
            detail: noRuntimeOverrideSentence(
              `CDP message exceeded the ${String(this.maxPayloadBytes)} byte protocol budget.`,
              cdpCommandTimeoutUnrelatedControl(this.operation),
            ),
          }
        : undefined,
    );
  }
}

const socketIsClosed = (socket: WebSocket): boolean =>
  socket.readyState === WebSocket.CLOSED;

const rawText = (data: RawData): string =>
  Array.isArray(data)
    ? Buffer.concat(data).toString("utf8")
    : Buffer.isBuffer(data)
      ? data.toString("utf8")
      : Buffer.from(data).toString("utf8");

const rawByteLength = (data: RawData): number =>
  Array.isArray(data)
    ? data.reduce((bytes, chunk) => bytes + chunk.byteLength, 0)
    : data.byteLength;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const waitForOpen = async (
  socket: WebSocket,
  operation: BrowserObservationOperation,
  signal?: AbortSignal,
  commandTimeoutMs: number = DEFAULT_CDP_COMMAND_TIMEOUT_MS,
): Promise<void> =>
  await new Promise((resolve, reject) => {
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onFailure = (cause: unknown): void => {
      cleanup();
      reject(
        new BrowserObservationError(operation, "endpoint_unreachable", {
          cause,
        }),
      );
    };
    const onClose = (code: number, reason: Buffer): void => {
      onFailure(
        new Error(
          `CDP WebSocket closed before opening (${code}: ${reason.toString("utf8")})`,
        ),
      );
    };
    const onAbort = (): void => {
      cleanup();
      terminateSocket(socket);
      reject(new AnalysisCancelledError(operation, { cause: signal?.reason }));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off("open", onOpen);
      socket.off("error", onFailure);
      socket.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };
    const timer = setTimeout(() => {
      terminateSocket(socket);
      cleanup();
      const recovery = cdpCommandDeadlineRecovery(
        commandTimeoutMs,
        "handshake",
        undefined,
        cdpCommandTimeoutIsSelectable(operation),
      );
      reject(
        new BrowserObservationError(operation, "timeout", {
          detail: recovery.userMessage,
          remediationAction: recovery.remediationAction,
        }),
      );
    }, commandTimeoutMs);
    socket.once("open", onOpen);
    socket.once("error", onFailure);
    socket.once("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted === true) onAbort();
  });

const terminateSocket = (socket: WebSocket): void => {
  try {
    socket.terminate();
  } catch {
    // The owning connection remains registered and will retry bounded close.
  }
};
