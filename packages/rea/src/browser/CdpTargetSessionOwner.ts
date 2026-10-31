import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../artifacts/AnalysisCleanupLease.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import type { BrowserObservationOperation } from "../domain/browserObservationErrors.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { CdpConnection } from "./CdpConnection.js";
import type { ExecutionOptions } from "../application/AnalysisProvider.js";

/** Typed ownership facts shared by transport errors and their adapter projections. */
class CdpTransportCleanupFailure extends ProviderCleanupError {
  constructor(
    readonly cleanupLeases: readonly AnalysisCleanupLease[],
    failure: {
      readonly resources: readonly string[];
      readonly operation: string;
      readonly diagnostics: Readonly<Record<string, JsonValue>>;
      readonly cause: unknown;
    },
  ) {
    super("rea-cdp-browser", failure.resources, failure.diagnostics, {
      operation: failure.operation,
      cause: failure.cause,
    });
    new AnalysisCleanupLeaseGroup(this, cleanupLeases);
  }
}

/** Bind a translated error without interpreting diagnostic cause chains. */
export const bindCdpTransportCleanup = <Failure extends AnalysisError>(
  cause: unknown,
  failure: Failure,
): Failure => {
  if (cause instanceof CdpTransportCleanupFailure)
    new AnalysisCleanupLeaseGroup(failure, cause.cleanupLeases);
  return failure;
};

interface OwnedConnection {
  readonly connection: CdpConnection;
  readonly operation: BrowserObservationOperation;
  readonly resource: string;
  readonly cleanupLease: AnalysisCleanupLease;
  active: boolean;
  readonly settled: Promise<void>;
  settle: () => void;
  cleanup: (() => Promise<void>) | undefined;
  cleanupAttempted: boolean;
  failure: ProviderCleanupError | undefined;
}

/** Retains exact REA-owned CDP transports until their close is observed. */
export class CdpTargetSessionOwner {
  readonly #connections = new Map<CdpConnection, OwnedConnection>();
  #closing = false;
  #admissions = 0;
  #closePromise: Promise<void> | undefined;
  readonly #admissionWaiters = new Set<() => void>();

  /** Admit and own one WebSocket from handshake completion onward. */
  async connect(
    url: string,
    operation: BrowserObservationOperation,
    options: ExecutionOptions,
    resource: string,
    limits?: {
      readonly maxPayloadBytes?: number;
      readonly commandTimeoutMs?: number;
      readonly handshakeTimeoutMs?: number;
    },
  ): Promise<CdpConnection> {
    if (this.#closing)
      throw new ProviderCleanupError(
        "rea-cdp-browser",
        [resource],
        { reason: "CDP provider is closing and cannot admit another session." },
        { operation },
      );
    await this.retryPending();
    if (this.#closing)
      throw new ProviderCleanupError(
        "rea-cdp-browser",
        [resource],
        { reason: "CDP provider is closing and cannot admit another session." },
        { operation },
      );
    if (options.signal?.aborted === true)
      throw new AnalysisCancelledError(operation, {
        cause: options.signal.reason,
      });
    this.#admissions += 1;
    let connection: CdpConnection | undefined;
    try {
      return await CdpConnection.connect(
        url,
        operation,
        options.signal,
        limits,
        (opened) => {
          connection = opened;
          this.register(opened, operation, resource);
        },
      );
    } catch (cause: unknown) {
      if (connection === undefined) throw cause;
      try {
        await this.finish(connection);
      } catch (cleanupCause: unknown) {
        if (
          cause instanceof AnalysisError &&
          cleanupCause instanceof AnalysisError
        )
          throw bindCdpTransportCleanup(
            cleanupCause,
            analysisErrorWithCleanupFailure(cause, cleanupCause, operation),
          );
        throw new AggregateError(
          [cause, cleanupCause],
          `CDP operation ${operation} failed during handshake and cleanup remains incomplete.`,
          { cause },
        );
      }
      throw cause;
    } finally {
      this.#admissions -= 1;
      if (this.#admissions === 0) {
        for (const resolve of this.#admissionWaiters) resolve();
        this.#admissionWaiters.clear();
      }
    }
  }

  /** Register synchronously before awaiting the WebSocket handshake. */
  register(
    connection: CdpConnection,
    operation: BrowserObservationOperation,
    resource: string,
  ): void {
    let settle = (): void => undefined;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    this.#connections.set(connection, {
      connection,
      operation,
      resource,
      cleanupLease: new AnalysisCleanupLease(
        () => connection.close(),
        [resource],
      ),
      active: true,
      settled,
      settle,
      cleanup: undefined,
      cleanupAttempted: false,
      failure: undefined,
    });
  }

  /** Finish one admitted operation, retaining a failed transport for retry. */
  async finish(
    connection: CdpConnection,
    cleanup?: () => Promise<void>,
  ): Promise<void> {
    const record = this.#connections.get(connection);
    if (record === undefined) return;
    if (record.failure !== undefined) throw record.failure;
    record.cleanup ??= cleanup;
    try {
      if (!record.cleanupAttempted && record.cleanup !== undefined) {
        record.cleanupAttempted = true;
        await record.cleanup();
      }
      await record.cleanupLease.release();
      this.#connections.delete(connection);
    } catch (cause: unknown) {
      const failure = cleanupError(record, cause);
      record.failure = failure;
      throw failure;
    } finally {
      record.active = false;
      record.settle();
    }
  }

  /** Retry only retained failed transports; active peers finish their own cleanup. */
  async close(): Promise<void> {
    this.#closing = true;
    this.#closePromise ??= this.#closeAll().catch((cause: unknown) => {
      this.#closePromise = undefined;
      throw cause;
    });
    return await this.#closePromise;
  }

  /** Retry retained failures without touching concurrently active sessions. */
  async retryPending(): Promise<void> {
    const failures: CdpTransportCleanupFailure[] = [];
    for (const record of this.#connections.values()) {
      if (record.active || record.failure === undefined) continue;
      try {
        await record.cleanupLease.release();
        this.#connections.delete(record.connection);
      } catch (cause: unknown) {
        const failure = cleanupError(record, cause);
        record.failure = failure;
        failures.push(failure);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw aggregateCleanupFailures(failures);
  }

  async #closeAll(): Promise<void> {
    while (this.#admissions > 0)
      await new Promise<void>((resolve) => this.#admissionWaiters.add(resolve));
    while (true) {
      const active = [...this.#connections.values()].filter(
        ({ active }) => active,
      );
      if (active.length === 0) break;
      await Promise.all(active.map(({ settled }) => settled));
    }
    const failures: CdpTransportCleanupFailure[] = [];
    for (const record of this.#connections.values()) {
      try {
        await record.cleanupLease.release();
        this.#connections.delete(record.connection);
      } catch (cause: unknown) {
        const failure = cleanupError(record, cause);
        record.failure = failure;
        failures.push(failure);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw aggregateCleanupFailures(failures);
  }
}

const cleanupError = (
  record: OwnedConnection,
  cause: unknown,
): CdpTransportCleanupFailure =>
  new CdpTransportCleanupFailure([record.cleanupLease], {
    resources: [record.resource],
    operation: record.operation,
    cause,
    diagnostics: {
      reason:
        cause instanceof AnalysisError
          ? (cause.userMessage ?? cause.message)
          : cause instanceof Error
            ? cause.message
            : String(cause),
    },
  });

const aggregateCleanupFailures = (
  failures: readonly CdpTransportCleanupFailure[],
): CdpTransportCleanupFailure =>
  new CdpTransportCleanupFailure(
    failures.flatMap((failure) => failure.cleanupLeases),
    {
      resources: failures.flatMap(({ cleanupResources }) => cleanupResources),
      operation: "close_cdp_transports",
      cause: new AggregateError(
        failures,
        "One or more REA-owned CDP transports remain open.",
      ),
      diagnostics: {
        failures: failures.map(({ message, diagnostics }) => ({
          message,
          diagnostics: diagnostics ?? {},
        })),
      },
    },
  );
