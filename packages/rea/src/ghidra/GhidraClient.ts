import { ghidraAsciiLiteralCandidate } from "./GhidraLiteralSearch.js";
import {
  fileSnapshotPartialObservationSchema,
  type FileSnapshotPartialObservation,
} from "../domain/fileSnapshotObservation.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import type { Socket } from "node:net";
import type { ProgressReporter } from "../application/ProgressReporter.js";

import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import {
  providerRetryAction,
  type ProviderOperationHealth,
} from "../domain/providerOperationHealth.js";
import { err, ok, type Result } from "../domain/result.js";
import { silentLogger } from "../logger.js";
import type { Logger } from "pino";
import {
  readLinuxCgroupMemoryState,
  type LinuxCgroupMemoryState,
} from "../process/LinuxCgroupMemory.js";
import { PendingOperations } from "../process/PendingOperations.js";
import { DecodedNdjsonLineBuffer } from "../process/DecodedNdjsonLineBuffer.js";
import { ABORTED, waitForAbortable } from "../process/AbortablePromise.js";
import {
  SharedStartupAttempt,
  STARTUP_OWNER_CLOSED,
} from "../process/SharedStartupAttempt.js";
import { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import { ProviderStartupDeadline } from "../process/ProviderDeadline.js";
import { ProviderRunLineage } from "../process/ProviderRunLineage.js";
import {
  type ProviderProcessDiagnostic,
  type ProviderProcessOutputCheckpoint,
  type ProviderProcessSnapshot,
  ProviderProcessSupervisor,
} from "../process/ProviderProcess.js";
import { DEFAULT_GHIDRA_STARTUP_TIMEOUT_MS } from "../domain/analysisResourceLimits.js";
import { DEFAULT_BRIDGE_MAX_REQUEST } from "../config/bridgeMaxRequestBytes.js";
import type {
  GhidraClientOptions,
  GhidraRequestOptions,
  GhidraStartResult,
} from "./GhidraClientTypes.js";
import type { GhidraInventoryOperation } from "./GhidraInventoryValues.js";
import type { GhidraFunctionOperation } from "./GhidraFunctionValues.js";
import {
  createGhidraDiagnostics,
  ghidraDiagnosticStream,
  ghidraFailureOutput,
  GHIDRA_JVM_OOME_MARKER,
  GHIDRA_PROCESS_DIAGNOSTIC_BYTES,
  type GhidraDiagnosticsScope,
} from "./GhidraDiagnostics.js";
import { GhidraLaunchError, type GhidraLaunch } from "./GhidraLauncher.js";
import { GhidraResponseRouter } from "./GhidraResponseRouter.js";
import { GhidraRequestQueue } from "./GhidraRequestQueue.js";
import {
  bindGhidraSessionFailure,
  GHIDRA_STARTUP_DEADLINE_ELAPSED,
  GhidraSessionError,
} from "./GhidraSessionError.js";
import {
  isGhidraShutdownAcknowledgement,
  parseGhidraSessionInfo,
  type GhidraSessionInfo,
} from "./GhidraSessionValues.js";
import { createGhidraTargetSnapshot } from "./GhidraTargetSnapshot.js";
import { attestGhidraDosSnapshot } from "./GhidraDosSnapshot.js";
import {
  nativeLoadImagePartialObservationSchema,
  type NativeLoadImage,
  type NativeLoadImageObservation,
  type NativeLoadImagePartialObservation,
} from "../domain/native/nativeLoadImage.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  artifactFileCancellationCause,
  artifactFilePrimaryFacts,
  bindArtifactFileCleanup,
  withArtifactRegularFile,
} from "../artifacts/ArtifactFileOperation.js";
import { readArtifactFileChunks } from "../artifacts/readArtifactFileChunks.js";
import { readBoundedFileBytes } from "../process/BoundedFileBytes.js";
import {
  assertRegularFileActive,
  RegularFileChangedError,
  sameRegularFileState,
} from "../filesystem/RegularFile.js";
import { redactCapturedTransportCredential } from "../process/ProviderDiagnosticRedaction.js";

export type GhidraTargetSnapshot =
  | { readonly kind: "captured"; readonly bytes: Buffer }
  | {
      readonly kind: "over-capacity";
      readonly sourceBytesAtLeast: number;
      readonly maximumBytes: number;
    };
import { connectGhidraSocket } from "./GhidraSocketConnection.js";
import {
  createGhidraEndpoint,
  type GhidraEndpoint,
} from "./GhidraTransport.js";
import { GhidraWire } from "./GhidraClientWire.js";
import { completeGhidraStartupHandshake } from "./GhidraClientStartup.js";
import { ghidraSessionRoot } from "./GhidraSessionRoot.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;
const SESSION_ROOT = ghidraSessionRoot();

type GhidraStartupAttempt = SharedStartupAttempt<GhidraStartResult>;

/** Closed Java-bridge operation union callable after the exact handshake. */
export type GhidraOperation =
  | GhidraInventoryOperation
  | GhidraFunctionOperation;

/** Owns an authenticated private Ghidra session with transport-bound mutation authority. */
export class GhidraClient {
  readonly #options: Required<
    Pick<GhidraClientOptions, "startupTimeoutMs" | "transport" | "platform">
  > &
    GhidraClientOptions;
  readonly #logger: Logger;
  readonly #pending = new PendingOperations<
    number,
    Result<JsonValue, GhidraSessionError>
  >();
  #socket: Socket | undefined;
  #detachSocket: (() => void) | undefined;
  #launch: GhidraLaunch | undefined;
  #process: ProviderProcessSupervisor | undefined;
  #runtimeRoot: PrivateRuntimeRoot | undefined;
  #socketRoot: PrivateRuntimeRoot | undefined;
  #endpointPath: string | undefined;
  #snapshotPath: string | undefined;
  #memoryCgroupBaseline: LinuxCgroupMemoryState | undefined;
  readonly #fileResources = new ArtifactResourceScope();
  readonly #cleanupFailures = new Set<AnalysisError>();
  #targetAdmission: JsonValue | undefined;
  #token: string | undefined;
  // Retain authentication identities for diagnostics from late request settlement.
  readonly #authenticationTokens = new Set<string>();
  #runId: string | undefined;
  readonly #lineage = new ProviderRunLineage();
  #nextId = 1;
  #closing = false;
  #processSnapshot: ProviderProcessSnapshot | undefined;
  #startupOutputCheckpoint: ProviderProcessOutputCheckpoint | undefined;
  #activeOutputCheckpoint: ProviderProcessOutputCheckpoint | undefined;
  #outputDrainPromise: Promise<boolean> | undefined;
  #outputDrainIncomplete = false;
  #lastDiagnostics: Readonly<Record<string, JsonValue>> = {};
  #startupAttempt: GhidraStartupAttempt | undefined;
  #closePromise: Promise<void> | undefined;
  readonly #failure = bindGhidraSessionFailure(
    (scope) => this.#diagnostics(scope),
    (value, incomplete) => this.#redactAuthentication(value, incomplete),
  );
  readonly #wire: GhidraWire;
  readonly #requestQueue: GhidraRequestQueue;
  readonly #responseRouter = new GhidraResponseRouter({
    pending: this.#pending,
    nextId: () => this.#nextId,
    remoteFailure: (failure) =>
      this.#failure("remote", failure.message, failure, {
        remoteCode: failure.code,
      }),
    protocolFailure: (message, cause) => this.#abortProtocol(message, cause),
  });
  readonly #responseLines = new DecodedNdjsonLineBuffer();
  readonly #onSocketData = (chunk: string): void => {
    for (const line of this.#responseLines.push(chunk))
      this.#responseRouter.route(line);
  };
  readonly #onSocketError = (): void => {
    this.#failAll(this.#failure("process", "Ghidra bridge socket failed"));
  };
  readonly #onSocketClose = (): void => {
    if (!this.#closing)
      this.#failAll(this.#failure("process", "Ghidra bridge socket closed"));
  };
  constructor(options: GhidraClientOptions) {
    this.#options = {
      ...options,
      startupTimeoutMs:
        options.startupTimeoutMs ?? DEFAULT_GHIDRA_STARTUP_TIMEOUT_MS,
      platform: options.platform ?? process.platform,
      transport: options.transport ?? "unix-socket",
    };
    this.#logger = options.logger ?? silentLogger;
    this.#wire = new GhidraWire({
      getSocket: () => this.#socket,
      getToken: () => this.#token,
      nextId: () => this.#nextId++,
      pending: this.#pending,
      logger: this.#logger,
      failure: this.#failure,
      bridgeMaxRequestBytes:
        options.bridgeMaxRequestBytes ?? DEFAULT_BRIDGE_MAX_REQUEST,
    });
    this.#requestQueue = new GhidraRequestQueue(
      async (method, parameters, requestOptions) => {
        const owner = this.#process;
        const checkpoint = owner?.checkpointOutput();
        const token = this.#token;
        this.#activeOutputCheckpoint = checkpoint;
        try {
          const result = await this.#wire.request(
            method,
            parameters,
            requestOptions,
          );
          if (
            !result.ok &&
            (result.error.kind === "process" ||
              result.error.kind === "protocol")
          ) {
            const drained = await this.#drainOutputBounded(
              requestOptions.signal,
            );
            return err(
              await this.#withMemoryCgroupEvidence(
                this.#refreshProcessFailure(
                  result.error,
                  owner,
                  checkpoint,
                  token,
                  !drained,
                ),
              ),
            );
          }
          return result;
        } finally {
          if (this.#activeOutputCheckpoint === checkpoint)
            this.#activeOutputCheckpoint = undefined;
        }
      },
      this.#failure,
      () => this.#stopAfterActiveCancellation(),
    );
  }

  /** Launch Ghidra once and require its exact post-analysis handshake. */
  start(
    signal?: AbortSignal,
    progress?: ProgressReporter,
  ): Promise<GhidraStartResult> {
    if (progress !== undefined)
      return this.#reportStartupWait(this.start(signal), signal, progress);
    if (signal?.aborted === true)
      return Promise.resolve(err(this.#startupWaitCancellation(signal)));
    if (this.#closePromise !== undefined)
      return waitForAbortable(this.#closePromise, signal).then(
        (closed) =>
          closed === ABORTED
            ? err(this.#startupWaitCancellation(signal))
            : this.start(signal),
        (cause: unknown) =>
          err(
            new GhidraSessionError(
              "process",
              "Ghidra cleanup remains incomplete",
              this.#diagnostics(),
              { cause, cleanupFailure: this.#cleanupError(cause) },
            ),
          ),
      );
    const current = this.#startupAttempt;
    if (current !== undefined) {
      if (current.signal.aborted)
        return this.#retryAfterAbortedStartup(current, signal);
      return this.#waitForStartup(current, signal);
    }
    const attempt = new SharedStartupAttempt((signal) => this.#start(signal));
    const { promise } = attempt;
    this.#startupAttempt = attempt;
    void promise.then(
      (result) => {
        if (
          !result.ok &&
          this.#startupAttempt === attempt &&
          result.error.cleanupFailure === undefined
        )
          this.#startupAttempt = undefined;
      },
      (cause: unknown) => {
        this.#logger.debug(
          { error: cause instanceof Error ? cause.message : String(cause) },
          "Ghidra startup promise rejected during bookkeeping",
        );
        if (this.#startupAttempt === attempt) this.#startupAttempt = undefined;
      },
    );
    return this.#waitForStartup(attempt, signal);
  }

  /** Preserve cleanup failures for the last caller leaving shared startup. */
  async #waitForStartup(
    attempt: GhidraStartupAttempt,
    signal: AbortSignal | undefined,
  ): Promise<GhidraStartResult> {
    const waited = await attempt.wait(signal);
    if (waited.status === "completed") return waited.value;
    if (waited.status === "stopped" && !waited.value.ok) return waited.value;
    return err(this.#startupWaitCancellation(signal));
  }

  /** Wait for abandoned startup cleanup before retrying under the new caller. */
  async #retryAfterAbortedStartup(
    attempt: GhidraStartupAttempt,
    signal: AbortSignal | undefined,
  ): Promise<GhidraStartResult> {
    const signalAborted = (): boolean => signal?.aborted === true;
    if (signalAborted()) return err(this.#startupWaitCancellation(signal));
    const waited = await waitForAbortable(attempt.promise, signal);
    if (waited === ABORTED || (waited.ok && signalAborted()))
      return err(this.#startupWaitCancellation(signal));
    if (waited.ok || waited.error.cleanupFailure !== undefined) return waited;
    return this.start(signal);
  }

  async #reportStartupWait(
    started: Promise<GhidraStartResult>,
    signal: AbortSignal | undefined,
    progress: ProgressReporter,
  ): Promise<GhidraStartResult> {
    const startedAt = performance.now();
    let active = true;
    let reporting = false;
    const timer = setInterval(() => {
      if (!active || reporting || signal?.aborted) return;
      reporting = true;
      void Promise.resolve()
        .then(() => {
          if (!active || signal?.aborted) return;
          return progress.report({
            phase: "ghidra_startup",
            completed: 0,
            total: null,
            message: `Waiting for Ghidra startup (${String(Math.floor((performance.now() - startedAt) / 1000))}s elapsed); import, auto-analysis and bridge readiness may still be pending`,
          });
        })
        // Notification failure does not release the owned startup process.
        .catch(() => {})
        .finally(() => {
          reporting = false;
        });
    }, 10_000);
    try {
      return await started;
    } finally {
      active = false;
      clearInterval(timer);
    }
  }

  /** Revalidate live bridge, provider, run, and profile metadata. */
  async ping(
    options: GhidraRequestOptions = {},
  ): Promise<Result<GhidraSessionInfo, GhidraSessionError>> {
    const started = await this.start(options.signal);
    if (!started.ok) return started;
    const result = await this.#requestQueue.run("ping", {}, options);
    if (!result.ok) return result;
    return this.#parseSessionInfo(result.value);
  }

  /** Execute one admitted operation through the serial per-Program queue.
   * Insensitive literal searches return conservative native candidates; the
   * inventory adapter owns shared matching and retains these raw source rows.
   */
  async callTool(
    operation: GhidraOperation,
    parameters: Readonly<Record<string, JsonValue>>,
    options: {
      readonly signal?: AbortSignal;
      readonly progress?: ProgressReporter;
      readonly decompileTimeoutSeconds?: number | null;
    } = {},
  ): Promise<Result<JsonValue, GhidraSessionError>> {
    const started = await this.start(options.signal, options.progress);
    if (!started.ok) return started;
    return this.#callTool(operation, parameters, options);
  }

  /** Dispatch against the connected bridge without invoking startup or retry. */
  callToolIfReady(
    operation: GhidraOperation,
    parameters: Readonly<Record<string, JsonValue>>,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<Result<JsonValue, GhidraSessionError> | undefined> {
    if (!this.isReady()) return Promise.resolve(undefined);
    return this.#callTool(operation, parameters, options);
  }

  async #callTool(
    operation: GhidraOperation,
    parameters: Readonly<Record<string, JsonValue>>,
    options: {
      readonly signal?: AbortSignal;
      readonly decompileTimeoutSeconds?: number | null;
    },
  ): Promise<Result<JsonValue, GhidraSessionError>> {
    const pattern =
      (operation === "search_procedures" || operation === "search_strings") &&
      parameters.mode === "literal" &&
      parameters.case_sensitive === false &&
      typeof parameters.pattern === "string"
        ? parameters.pattern
        : undefined;
    return this.#requestQueue.run(
      operation,
      pattern !== undefined
        ? {
            ...parameters,
            literal_ascii_candidate: ghidraAsciiLiteralCandidate(pattern),
          }
        : parameters,
      {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.decompileTimeoutSeconds === undefined
          ? {}
          : { decompileTimeoutSeconds: options.decompileTimeoutSeconds }),
      },
    );
  }

  /** Read the private immutable source for format parsers that require captured bytes. */
  readTargetSnapshot(
    maximumBytes?: number,
    signal?: AbortSignal,
  ): Promise<Result<GhidraTargetSnapshot, GhidraSessionError>> {
    return this.#withTargetSnapshot<GhidraTargetSnapshot>(
      async (handle, initial, path) => {
        if (
          maximumBytes !== undefined &&
          (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0)
        )
          throw new RangeError("Snapshot byte limit must be a safe integer");
        if (maximumBytes !== undefined && initial.size > maximumBytes)
          return {
            kind: "over-capacity",
            sourceBytesAtLeast: initial.size,
            maximumBytes,
          };
        const bytes = await readBoundedFileBytes(
          handle,
          maximumBytes ?? initial.size,
          {
            signal,
            expectedSize: initial.size,
            cancellationFailure: (reason) =>
              new ArtifactReaderFailure(
                "cancelled",
                "Snapshot read cancelled",
                { cause: reason },
              ),
          },
        );
        if (bytes === undefined || bytes.length !== initial.size)
          throw new RegularFileChangedError(path);
        return { kind: "captured", bytes };
      },
      (value, path) =>
        fileSnapshotPartialObservationSchema.parse({
          kind: "file-snapshot-read",
          path,
          admitted_sha256: this.#options.targetSha256,
          capture:
            value.kind === "captured"
              ? { status: "captured", bytes: value.bytes.length }
              : {
                  status: "over-capacity",
                  source_bytes_at_least: value.sourceBytesAtLeast,
                  maximum_bytes: value.maximumBytes,
                },
        }),
      signal,
    );
  }

  /** Measure the complete snapshot identity without retaining its bytes in memory. */
  hashTargetSnapshot(
    signal?: AbortSignal,
  ): Promise<
    Result<
      { readonly sha256: string; readonly bytes: number },
      GhidraSessionError
    >
  > {
    return this.#withTargetSnapshot(
      async (handle, initial, path) => {
        const hash = createHash("sha256");
        let bytes = 0;
        for await (const chunk of readArtifactFileChunks(handle, {
          end: initial.size,
          signal,
        })) {
          bytes += chunk.length;
          if (bytes > initial.size) throw new RegularFileChangedError(path);
          hash.update(chunk);
        }
        if (bytes !== initial.size) throw new RegularFileChangedError(path);
        return { sha256: hash.digest("hex"), bytes };
      },
      (value, path) =>
        fileSnapshotPartialObservationSchema.parse({
          kind: "file-snapshot-hash",
          path,
          ...value,
        }),
      signal,
    );
  }

  /**
   * Hash the immutable snapshot and each byte range in one streamed pass, so a
   * DOL section is verified without retaining the whole file in memory.
   */
  hashTargetSnapshotRanges(
    ranges: readonly { readonly start: number; readonly end: number }[],
    signal?: AbortSignal,
  ): Promise<
    Result<
      {
        readonly sha256: string;
        readonly bytes: number;
        readonly rangeSha256: readonly string[];
      },
      GhidraSessionError
    >
  > {
    return this.#withTargetSnapshot(
      async (handle, initial, path) => {
        for (const range of ranges)
          if (
            !Number.isSafeInteger(range.start) ||
            !Number.isSafeInteger(range.end) ||
            range.start < 0 ||
            range.end < range.start ||
            range.end > initial.size
          )
            throw new RangeError("Snapshot range must lie within the target");
        const hash = createHash("sha256");
        const rangeHashes = ranges.map(() => createHash("sha256"));
        let position = 0;
        for await (const chunk of readArtifactFileChunks(handle, {
          end: initial.size,
          signal,
        })) {
          const chunkEnd = position + chunk.length;
          if (chunkEnd > initial.size) throw new RegularFileChangedError(path);
          hash.update(chunk);
          ranges.forEach((range, index) => {
            const start = Math.max(range.start, position);
            const end = Math.min(range.end, chunkEnd);
            if (start < end)
              rangeHashes[index]?.update(
                chunk.subarray(start - position, end - position),
              );
          });
          position = chunkEnd;
        }
        if (position !== initial.size) throw new RegularFileChangedError(path);
        return {
          sha256: hash.digest("hex"),
          bytes: position,
          rangeSha256: rangeHashes.map((rangeHash) => rangeHash.digest("hex")),
        };
      },
      (value, path) =>
        fileSnapshotPartialObservationSchema.parse({
          kind: "file-snapshot-hash",
          path,
          sha256: value.sha256,
          bytes: value.bytes,
        }),
      signal,
    );
  }

  /** Compare MZ source identity without retaining unbounded appended overlays. */
  attestDosTargetSnapshot(
    observations: NativeLoadImageObservation,
    signal?: AbortSignal,
  ): Promise<Result<NativeLoadImage, GhidraSessionError>> {
    return this.#withTargetSnapshot(
      async (handle, initial, path) => {
        const result = await attestGhidraDosSnapshot(
          handle,
          initial.size,
          path,
          this.#options.targetSha256,
          observations,
          signal,
        );
        if (!result.ok) throw this.#failure("protocol", result.error);
        return result.value;
      },
      (result) =>
        nativeLoadImagePartialObservationSchema.parse({
          kind: "native-load-image",
          stage: "completed",
          result,
        }),
      signal,
    );
  }

  async #withTargetSnapshot<T>(
    read: (handle: FileHandle, initial: Stats, path: string) => Promise<T>,
    observe: (
      value: T,
      path: string,
    ) => FileSnapshotPartialObservation | NativeLoadImagePartialObservation,
    signal?: AbortSignal,
  ): Promise<Result<T, GhidraSessionError>> {
    let completedObservation:
      | FileSnapshotPartialObservation
      | NativeLoadImagePartialObservation
      | undefined;
    try {
      return await this.#fileResources.run(async () => {
        const path = this.#snapshotPath;
        if (
          path === undefined ||
          this.#closing ||
          this.#closePromise !== undefined
        )
          return err(
            this.#failure(
              "protocol",
              "Ghidra target snapshot is unavailable before startup or after close",
            ),
          );
        return ok(
          await withArtifactRegularFile(
            path,
            this.#fileResources,
            signal,
            async ({ handle, initial }) => {
              assertRegularFileActive(signal);
              if (!Number.isSafeInteger(initial.size) || initial.size < 0)
                throw new RangeError("Snapshot size must be a safe integer");
              const value = await read(handle, initial, path);
              assertRegularFileActive(signal);
              const after = await handle.stat();
              assertRegularFileActive(signal);
              if (!sameRegularFileState(initial, after))
                throw new RegularFileChangedError(path);
              completedObservation = observe(value, path);
              return value;
            },
          ),
        );
      });
    } catch (cause: unknown) {
      const cancellation =
        cause instanceof ArtifactReaderFailure && cause.reason === "cancelled"
          ? { reason: artifactFileCancellationCause(cause) }
          : undefined;
      const { cause: primary, origin } = artifactFilePrimaryFacts(cause);
      let failure =
        origin === "owned-or-classified" &&
        primary instanceof GhidraSessionError
          ? primary
          : this.#failure(
              cancellation === undefined ? "protocol" : "cancelled",
              "Ghidra target snapshot read or finalization did not complete",
              cause,
              cancellation === undefined ? {} : { cancellation },
            );
      if (completedObservation !== undefined)
        failure = failure.withPartialObservation(completedObservation);
      if (
        cause instanceof ArtifactReaderFailure &&
        cause.cleanup !== undefined
      ) {
        const cleanup = new ProviderCleanupError(
          "ghidra",
          cause.cleanup.resources,
          { reason: this.#redactAuthentication(cause.cleanup.reason) },
          {
            operation: "read_target_snapshot",
            cause,
            partialObservation: completedObservation,
          },
        );
        bindArtifactFileCleanup(cause, cleanup);
        failure = failure.withCleanupFailure(cleanup);
      }
      return err(failure);
    }
  }

  /** This waiter owns its cancellation reason, independently of shared startup. */
  #startupWaitCancellation(
    signal: AbortSignal | undefined,
  ): GhidraSessionError {
    return this.#failure(
      "cancelled",
      "Ghidra startup wait was cancelled",
      signal?.reason,
      signal === undefined ? {} : { cancellation: { reason: signal.reason } },
    );
  }

  /** Stop the owned process group and remove all project/runtime artifacts. */
  async close(): Promise<Result<null, AnalysisError>> {
    try {
      await this.#requestClose(false);
      return ok(null);
    } catch (cause: unknown) {
      return err(this.#cleanupError(cause));
    }
  }

  /** Read completion from the current attempt; no independent readiness flag. */
  #startupSucceeded(): boolean {
    const startup = this.#startupAttempt?.settlement;
    return startup?.status === "completed" && startup.value.ok;
  }

  /** True only after the authenticated startup handshake has completed. */
  isReady(): boolean {
    return (
      this.#startupSucceeded() &&
      this.#socket !== undefined &&
      !this.#socket.destroyed &&
      !this.#closing &&
      this.#closePromise === undefined
    );
  }

  #cleanupError(cause: unknown): AnalysisError {
    if (cause instanceof AnalysisError && cause.cleanupIncomplete)
      return this.#retainCleanupFailure(cause);
    const failure = new ProviderCleanupError(
      "ghidra",
      [
        ...(this.#process === undefined ? [] : ["ghidra-process"]),
        ...(cause instanceof ArtifactReaderFailure
          ? (cause.cleanup?.resources ?? [])
          : []),
        ...this.#fileResources.cleanupResources,
        ...[this.#runtimeRoot, this.#socketRoot].flatMap((root) =>
          root === undefined ? [] : [root.path],
        ),
      ],
      {
        reason: cause instanceof Error ? cause.message : String(cause),
        diagnostics: this.#diagnostics(),
      },
      { cause },
    );
    return this.#retainCleanupFailure(failure);
  }

  async #startupFailure(
    primary: GhidraSessionError,
    deadline?: ProviderStartupDeadline,
  ): Promise<GhidraStartResult> {
    await this.#drainOutputBounded(deadline?.signal);
    const refreshed = this.#failure(
      primary.kind,
      primary.message,
      primary.cause,
      {
        ...(primary.cancellation === undefined
          ? {}
          : { cancellation: primary.cancellation }),
        ...(primary.timeoutMs === undefined
          ? {}
          : { timeoutMs: primary.timeoutMs }),
        ...(primary.remoteCode === undefined
          ? {}
          : { remoteCode: primary.remoteCode }),
      },
    );
    primary = await this.#withMemoryCgroupEvidence(
      primary.withDiagnostics(refreshed.diagnostics, refreshed.message),
    );
    try {
      await this.#cleanup();
      return err(primary);
    } catch (cause: unknown) {
      return err(primary.withCleanupFailure(this.#cleanupError(cause)));
    }
  }

  #requestClose(forceStop: boolean): Promise<void> {
    const starting = this.#startupAttempt;
    starting?.close();
    this.#closePromise ??= Promise.resolve().then(() =>
      this.#close(starting, forceStop),
    );
    return this.#closePromise;
  }

  #stopAfterActiveCancellation(): Promise<Result<null, AnalysisError>> {
    return this.#requestClose(true).then(
      () => ok(null),
      (cause: unknown) => {
        this.#logger.error(
          { error: cause instanceof Error ? cause.message : String(cause) },
          "Ghidra cleanup after active request cancellation failed",
        );
        return err(this.#cleanupError(cause));
      },
    );
  }

  #retainCleanupFailure<Failure extends AnalysisError>(
    failure: Failure,
  ): Failure {
    const client = this;
    failure.bindCleanupResourceOwner({
      get cleanupResources() {
        return [
          ...(client.#process === undefined ? [] : ["ghidra-process"]),
          ...client.#fileResources.cleanupResources,
          ...[client.#runtimeRoot, client.#socketRoot].flatMap((root) =>
            root === undefined ? [] : [root.path],
          ),
        ];
      },
    });
    this.#cleanupFailures.add(failure);
    return failure;
  }

  /** Observed failures that prevent a retained session from being reused. */
  operationHealthSnapshot(): ProviderOperationHealth | undefined {
    const exit = this.#process?.observedExit();
    const state =
      exit !== undefined
        ? "exited"
        : this.#socket?.destroyed === true
          ? "unreachable"
          : !this.#startupSucceeded() &&
              (this.#startupAttempt === undefined ||
                this.#startupAttempt.settled) &&
              this.#hasOwnedResources()
            ? "unknown"
            : undefined;
    if (state === undefined) return undefined;
    return {
      state,
      stage: null,
      retryAction: providerRetryAction(state),
      exitCode: exit?.code ?? null,
      requests: [],
    };
  }

  /** Latest bounded local diagnostics, with bearer material redacted. */
  diagnostics(): Readonly<Record<string, JsonValue>> {
    return structuredClone(this.#diagnostics());
  }

  /** Latest token-verified launcher lineage for the active run. */
  runtimeLineage() {
    return this.#lineage.snapshot();
  }

  async #start(signal: AbortSignal): Promise<GhidraStartResult> {
    if (signal.aborted) return err(this.#startupWaitCancellation(signal));
    if (this.#hasOwnedResources())
      return err(this.#failure("protocol", "Ghidra client is already started"));
    this.#lastDiagnostics = {};
    this.#processSnapshot = undefined;
    this.#startupOutputCheckpoint = undefined;
    this.#activeOutputCheckpoint = undefined;
    this.#outputDrainPromise = undefined;
    this.#outputDrainIncomplete = false;
    const deadline = new ProviderStartupDeadline(
      this.#options.readStartupTimeoutMs?.() ?? this.#options.startupTimeoutMs,
      signal,
    );
    try {
      const result = await this.#startWithin(deadline);
      return result.ok && deadline.signal.aborted
        ? await this.#startupInterrupted(deadline)
        : result;
    } catch (cause: unknown) {
      if (cause instanceof GhidraSessionError) return err(cause);
      throw cause;
    } finally {
      deadline.dispose();
    }
  }

  /** Every retained cleanup capability blocks replacement by a new startup. */
  #hasOwnedResources(): boolean {
    return (
      this.#process !== undefined ||
      this.#launch !== undefined ||
      this.#socket !== undefined ||
      this.#runtimeRoot !== undefined ||
      this.#socketRoot !== undefined ||
      this.#fileResources.hasPending
    );
  }

  async #startWithin(
    deadline: ProviderStartupDeadline,
  ): Promise<GhidraStartResult> {
    try {
      this.#runtimeRoot = await PrivateRuntimeRoot.create({
        parent: SESSION_ROOT,
        prefix: "rea-ghidra-",
        platform: this.#options.platform,
      });
    } catch (cause: unknown) {
      return err(
        this.#failure("start", "Ghidra runtime root creation failed", cause),
      );
    }
    if (deadline.signal.aborted) return this.#startupInterrupted(deadline);
    let endpoint: GhidraEndpoint;
    try {
      const allocated = await createGhidraEndpoint(
        this.#runtimeRoot.path,
        this.#options.transport,
        this.#options.platform,
      );
      endpoint = allocated.endpoint;
      this.#socketRoot = allocated.socketRoot;
      this.#endpointPath = endpoint.path;
    } catch (cause: unknown) {
      const failure = this.#failure(
        "start",
        "Ghidra private endpoint allocation failed",
        cause,
      );
      return this.#startupFailure(failure, deadline);
    }
    try {
      const snapshot = await createGhidraTargetSnapshot(
        this.#options.targetPath,
        this.#runtimeRoot.path,
        this.#options.targetSha256,
        {
          signal: deadline.signal,
          platform: this.#options.platform,
          resourceScope: this.#fileResources,
        },
      );
      this.#snapshotPath = snapshot.path;
      this.#targetAdmission = snapshot.admission;
    } catch (cause: unknown) {
      const failure =
        cause instanceof ArtifactReaderFailure && cause.reason === "cancelled"
          ? this.#interruptionFailure(
              deadline,
              artifactFileCancellationCause(cause),
            )
          : this.#failure(
              "start",
              "Ghidra target snapshot failed admission",
              cause,
            );
      // Snapshot finalization has settled and no launcher exists yet. Preserve
      // its producer outcome rather than reclassifying from a later deadline.
      return this.#startupFailure(failure);
    }
    if (deadline.signal.aborted) return this.#startupInterrupted(deadline);
    this.#token = randomBytes(32).toString("hex");
    this.#authenticationTokens.add(this.#token);
    this.#lineage.reset();
    this.#runId = this.#options.runId ?? randomUUID();
    this.#memoryCgroupBaseline = await this.#readMemoryCgroup();
    const launched = await this.#options.launcher
      .launch(
        {
          runtimeRoot: this.#runtimeRoot.path,
          transport: endpoint.transport,
          endpointPath: endpoint.path,
          token: this.#token,
          runId: this.#runId,
          targetPath: this.#snapshotPath,
          targetSha256: this.#options.targetSha256,
          providerVersion: this.#options.providerVersion,
          profileDigest: this.#options.profileDigest,
        },
        { signal: deadline.signal, resourceScope: this.#fileResources },
      )
      .catch((cause: unknown) =>
        err(this.#failure("start", "Ghidra launcher failed", cause)),
      );
    if (!launched.ok) {
      const partialLaunch =
        launched.error instanceof GhidraLaunchError
          ? launched.error.partialLaunch
          : undefined;
      if (partialLaunch !== undefined) {
        this.#launch = partialLaunch;
        this.#process = new ProviderProcessSupervisor(partialLaunch, {
          maxDiagnosticBytes: GHIDRA_PROCESS_DIAGNOSTIC_BYTES,
          outputToken: GHIDRA_JVM_OOME_MARKER,
          onDiagnostic: (event) => this.#onProcessDiagnostic(event),
        });
        this.#startupOutputCheckpoint = this.#process.checkpointOutput();
      }
      const producerFailure =
        launched.error instanceof AnalysisCancelledError
          ? launched.error
          : launched.error instanceof GhidraLaunchError
            ? launched.error.primaryFailure
            : undefined;
      const failure =
        producerFailure instanceof AnalysisCancelledError
          ? this.#interruptionFailure(deadline, launched.error, {
              reason: producerFailure.cause,
            })
          : launched.error instanceof GhidraSessionError
            ? launched.error
            : this.#failure("start", launched.error.message, launched.error);
      return this.#startupFailure(failure, deadline);
    }
    this.#launch = launched.value;
    this.#process = new ProviderProcessSupervisor(launched.value, {
      maxDiagnosticBytes: GHIDRA_PROCESS_DIAGNOSTIC_BYTES,
      outputToken: GHIDRA_JVM_OOME_MARKER,
      onDiagnostic: (event) => this.#onProcessDiagnostic(event),
    });
    this.#startupOutputCheckpoint = this.#process.checkpointOutput();
    const completed = await this.#connectAndHandshake(endpoint, deadline);
    if (!completed.ok) return this.#startupFailure(completed.error, deadline);
    try {
      await this.#lineage.observe(this.#launch);
    } catch (cause: unknown) {
      return this.#startupFailure(
        this.#failure(
          "start",
          "Ghidra process lineage observation failed",
          cause,
        ),
        deadline,
      );
    }
    if (deadline.signal.aborted) return this.#startupInterrupted(deadline);
    this.#startupOutputCheckpoint = undefined;
    this.#requestQueue.reopen();
    return completed;
  }

  async #connectAndHandshake(
    endpoint: GhidraEndpoint,
    deadline: ProviderStartupDeadline,
  ): Promise<GhidraStartResult> {
    // Retry only a dropped loopback transport, never identity or protocol failures.
    for (let attempt = 0; ; attempt += 1) {
      const connected = await this.#connect(endpoint, deadline);
      if (!connected.ok) return connected;
      const completed = await completeGhidraStartupHandshake({
        deadline,
        request: (method, params, requestOptions) =>
          this.#wire.request(method, params, requestOptions),
        parseSessionInfo: (value) => this.#parseSessionInfo(value),
        failure: this.#failure,
        startupTimeoutMs: deadline.timeoutMs,
      });
      if (
        completed.ok ||
        completed.error.kind !== "process" ||
        endpoint.transport !== "authenticated-loopback-tcp" ||
        attempt >= 2 ||
        deadline.signal.aborted ||
        this.#closing ||
        this.#process?.observedExit() !== undefined
      )
        return completed;
      this.#detachSocket?.();
      this.#detachSocket = undefined;
      this.#socket?.destroy();
      this.#socket = undefined;
      this.#responseLines.reset();
    }
  }

  async #connect(
    endpoint: GhidraEndpoint,
    deadline: ProviderStartupDeadline,
  ): Promise<Result<undefined, GhidraSessionError>> {
    const connected = await connectGhidraSocket({
      endpoint,
      deadline,
      resourceScope: this.#fileResources,
      failure: this.#failure,
      isClosed: () => this.#closing,
      processExited: () => this.#process?.observedExit() !== undefined,
      startupTimeoutMs: deadline.timeoutMs,
      handlers: {
        data: this.#onSocketData,
        error: this.#onSocketError,
        close: this.#onSocketClose,
      },
    });
    if (!connected.ok) return connected;
    this.#socket = connected.value.socket;
    this.#detachSocket = connected.value.detach;
    return ok(undefined);
  }

  #parseSessionInfo(value: JsonValue) {
    const runId = this.#runId;
    if (runId === undefined)
      return err(this.#failure("protocol", "Ghidra run identity is missing"));
    const parsed = parseGhidraSessionInfo(value, {
      runId,
      expectedReadOnly:
        this.#options.existingProject === true ||
        this.#options.transport === "authenticated-loopback-tcp",
      expectedExistingProject: this.#options.existingProject === true,
      providerVersion: this.#options.providerVersion,
      profileDigest: this.#options.profileDigest,
      targetSha256: this.#options.targetSha256,
      ...(this.#targetAdmission === undefined
        ? {}
        : { targetAdmission: this.#targetAdmission }),
      ...(this.#options.expectedLanguageId === undefined
        ? {}
        : { expectedLanguageId: this.#options.expectedLanguageId }),
      ...(this.#options.expectedCompilerSpecId === undefined
        ? {}
        : { expectedCompilerSpecId: this.#options.expectedCompilerSpecId }),
    });
    if (parsed.ok) return parsed;
    return err(
      this.#failure(
        "protocol",
        "Ghidra bridge handshake is invalid",
        parsed.error,
      ),
    );
  }

  async #close(
    starting: GhidraStartupAttempt | undefined,
    forceStop: boolean,
  ): Promise<void> {
    try {
      // best-effort cleanup: a rejected startup must not mask close/cleanup.
      await starting?.promise.catch(() => undefined);
      await this.#cleanup(forceStop);
    } finally {
      if (this.#startupAttempt === starting) this.#startupAttempt = undefined;
      this.#closePromise = undefined;
    }
  }

  async #cleanup(forceStop = false): Promise<void> {
    this.#closing = true;
    let forcedStopFailure: { readonly cause: unknown } | undefined;
    try {
      this.#requestQueue.failQueued(
        this.#failure("process", "Ghidra session closed"),
      );
      const socket = this.#socket;
      if (!forceStop && socket !== undefined && !socket.destroyed) {
        const shutdown = await this.#wire
          .request("shutdown", {}, { timeoutMs: SHUTDOWN_TIMEOUT_MS })
          .catch((cause: unknown) =>
            err(
              this.#failure("process", "Ghidra shutdown request failed", cause),
            ),
          );
        if (!shutdown.ok || !isGhidraShutdownAcknowledgement(shutdown.value))
          this.#logger.warn(
            {
              status: shutdown.ok ? "invalid-acknowledgement" : "failed",
              ...(shutdown.ok
                ? {}
                : {
                    kind: shutdown.error.kind,
                    message: shutdown.error.message,
                    diagnostics: shutdown.error.diagnostics,
                  }),
            },
            "Ghidra bridge shutdown was not confirmed",
          );
      }
      this.#failAll(this.#failure("process", "Ghidra session closed"));
      this.#detachSocket?.();
      this.#detachSocket = undefined;
      socket?.destroy();
      this.#socket = undefined;
      if (this.#process !== undefined) {
        await this.#process.waitForExit(500);
        this.#processSnapshot = this.#process.snapshot();
        const stopped = await this.#process.stop();
        this.#processSnapshot = this.#process.snapshot();
        if (stopped.status === "incomplete") {
          this.#options.onDiagnostic?.({
            type: "cleanup-incomplete",
            reason: stopped.reason,
          });
          this.#logger.warn(
            { reason: stopped.reason },
            "Ghidra process cleanup failed closed",
          );
          // Keep the supervisor and private files available for a later close.
          // A still-live JVM can recreate files if its runtime is removed here.
          throw this.#failure(
            "process",
            `Ghidra process cleanup was incomplete: ${stopped.reason}`,
          );
        }
      }
      this.#lastDiagnostics = this.#diagnostics();
      this.#process = undefined;
      this.#launch = undefined;
      await this.#fileResources.retryCleanup();
      try {
        await this.#removeRuntimeRoots();
      } catch (cause: unknown) {
        if (forceStop) forcedStopFailure = { cause };
        else throw cause;
      }
      this.#snapshotPath = undefined;
      this.#endpointPath = undefined;
      this.#token = undefined;
      this.#runId = undefined;
      this.#responseLines.reset();
      if (forcedStopFailure !== undefined) throw forcedStopFailure.cause;
      for (const failure of this.#cleanupFailures) failure.resolveCleanup();
      this.#cleanupFailures.clear();
    } finally {
      this.#closing = false;
    }
  }

  /**
   * Remove the runtime and socket roots, keeping each one that could not be
   * removed so a later close retries it rather than reporting success.
   */
  async #removeRuntimeRoots(): Promise<void> {
    const roots = [
      {
        root: this.#runtimeRoot,
        release: () => (this.#runtimeRoot = undefined),
      },
      { root: this.#socketRoot, release: () => (this.#socketRoot = undefined) },
    ];
    const leftovers: { readonly path: string; readonly reason: string }[] = [];
    let firstCause: unknown;
    for (const { root, release } of roots) {
      if (root === undefined) continue;
      try {
        await root.close();
        release();
      } catch (cause: unknown) {
        firstCause ??= cause;
        leftovers.push({
          path: root.path,
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
    if (leftovers.length > 0) {
      const failure = new ProviderCleanupError(
        "ghidra",
        leftovers.map(({ path }) => path),
        {
          reason:
            "Ghidra's private runtime directory could not be removed; it is retained for a later close.",
          leftover_paths: leftovers.map(({ path }) => path),
          failures: leftovers.map(({ path, reason }) => `${path}: ${reason}`),
        },
        { cause: firstCause },
      );
      this.#retainCleanupFailure(failure);
      throw failure;
    }
  }

  #redactAuthentication(value: string, incomplete = false): string {
    for (const token of this.#authenticationTokens) {
      const bytes = Buffer.byteLength(value);
      value = redactCapturedTransportCredential(
        { text: value, bytes, observedBytes: bytes + (incomplete ? 1 : 0) },
        token,
        "[REDACTED]",
      );
    }
    return value;
  }

  #onProcessDiagnostic(event: ProviderProcessDiagnostic): void {
    if (event.type === "output") {
      this.#options.onDiagnostic?.({
        type: "launcher-output",
        stream: event.stream,
        bytes: event.bytes,
        totalBytes: event.totalBytes,
      });
      return;
    }
    if (event.type === "error") {
      this.#logger.warn(
        { message: event.message },
        "Ghidra process emitted an error",
      );
      return;
    }
    this.#processSnapshot = event.snapshot;
    if (event.type === "output-close") return;
    this.#options.onDiagnostic?.({
      type: "launcher-exit",
      code: event.code,
      signal: event.signal,
    });
    if (!this.#closing)
      this.#failAll(this.#failure("process", "Ghidra process exited"));
  }

  #abortProtocol(message: string, cause?: Error): void {
    this.#failAll(this.#failure("protocol", message, cause));
    this.#socket?.destroy();
  }

  #failAll(error: GhidraSessionError): void {
    this.#pending.failAll(() => err(error));
  }

  async #startupInterrupted(
    deadline: ProviderStartupDeadline,
  ): Promise<GhidraStartResult> {
    const failure = this.#interruptionFailure(deadline);
    return this.#startupFailure(failure, deadline);
  }

  #interruptionFailure(
    deadline: ProviderStartupDeadline,
    cause?: unknown,
    cancellation?: { readonly reason: unknown },
  ): GhidraSessionError {
    if (
      cancellation !== undefined &&
      !(
        deadline.signal.aborted &&
        cancellation.reason === deadline.signal.reason
      )
    )
      return this.#failure("cancelled", "Ghidra startup was cancelled", cause, {
        cancellation,
      });
    if (deadline.signal.reason === STARTUP_OWNER_CLOSED)
      return this.#failure(
        "process",
        "Ghidra session closed during startup",
        cause,
      );
    return deadline.interruption === "cancelled"
      ? this.#failure("cancelled", "Ghidra startup was cancelled", cause, {
          cancellation: { reason: deadline.signal.reason },
        })
      : this.#failure("timeout", GHIDRA_STARTUP_DEADLINE_ELAPSED, cause, {
          timeoutMs: deadline.timeoutMs,
        });
  }

  #diagnostics(
    requestedScope: GhidraDiagnosticsScope = "session",
  ): Readonly<Record<string, JsonValue>> {
    // Startup errors still need launcher evidence. A request projection must
    // have both a completed handshake and its own active output checkpoint.
    const scope =
      requestedScope === "request" &&
      this.#startupSucceeded() &&
      this.#activeOutputCheckpoint !== undefined
        ? "request"
        : "session";
    const currentSnapshot = this.#process?.snapshot() ?? this.#processSnapshot;
    const snapshot: ProviderProcessSnapshot | undefined =
      this.#outputDrainIncomplete && currentSnapshot !== undefined
        ? {
            ...currentSnapshot,
            diagnosticTruncated: true,
            outputIncomplete: true,
          }
        : currentSnapshot;
    const checkpoint =
      scope === "request"
        ? this.#activeOutputCheckpoint
        : (this.#activeOutputCheckpoint ?? this.#startupOutputCheckpoint);
    const scoped =
      checkpoint === undefined
        ? undefined
        : this.#process?.snapshotOutputSince(checkpoint);
    const failureOutput: JsonValue | undefined =
      scoped === undefined
        ? undefined
        : ghidraFailureOutput(scoped, this.#token, this.#outputDrainIncomplete);
    return createGhidraDiagnostics({
      scope,
      targetPath: this.#options.targetPath,
      targetSha256: this.#options.targetSha256,
      ...(this.#targetAdmission === undefined
        ? {}
        : { targetAdmission: this.#targetAdmission }),
      transport: this.#options.transport,
      providerVersion: this.#options.providerVersion,
      profileDigest: this.#options.profileDigest,
      ...(this.#runId === undefined ? {} : { runId: this.#runId }),
      ...(this.#runtimeRoot === undefined
        ? {}
        : { runtimeRoot: this.#runtimeRoot.path }),
      ...(this.#socketRoot === undefined
        ? {}
        : { socketRoot: this.#socketRoot.path }),
      ...(this.#endpointPath === undefined
        ? {}
        : { endpointPath: this.#endpointPath }),
      ...(this.#launch === undefined ? {} : { launch: this.#launch }),
      ...(snapshot === undefined ? {} : { snapshot }),
      ...(this.#token === undefined ? {} : { token: this.#token }),
      previous: this.#lastDiagnostics,
      ...(failureOutput === undefined ? {} : { failure_output: failureOutput }),
    });
  }

  #refreshProcessFailure(
    failure: GhidraSessionError,
    owner: ProviderProcessSupervisor | undefined,
    checkpoint: ProviderProcessOutputCheckpoint | undefined,
    token: string | undefined,
    drainIncomplete: boolean,
  ): GhidraSessionError {
    if (owner === undefined || checkpoint === undefined) return failure;
    const snapshot = owner.snapshot();
    const scoped = owner.snapshotOutputSince(checkpoint);
    const incomplete = drainIncomplete || !scoped.complete;
    return failure.withDiagnostics({
      ...failure.diagnostics,
      exit_code: snapshot.exitCode ?? null,
      exit_signal: snapshot.signal ?? null,
      stop_requested: snapshot.stopRequested === true,
      diagnostic_truncated: snapshot.diagnosticTruncated === true || incomplete,
      output_incomplete: snapshot.outputIncomplete === true || drainIncomplete,
      stdout: ghidraDiagnosticStream(snapshot.stdout, token),
      stderr: ghidraDiagnosticStream(snapshot.stderr, token),
      failure_output: ghidraFailureOutput(scoped, token, drainIncomplete),
    });
  }

  #readMemoryCgroup(): Promise<LinuxCgroupMemoryState | undefined> {
    return (this.#options.readMemoryCgroup ?? readLinuxCgroupMemoryState)();
  }

  /**
   * Compare REA's memory cgroup with its pre-launch observation once Ghidra is
   * known to have died by SIGKILL, so a kernel OOM kill becomes evidence.
   */
  async #withMemoryCgroupEvidence(
    failure: GhidraSessionError,
  ): Promise<GhidraSessionError> {
    const before = this.#memoryCgroupBaseline;
    if (
      before === undefined ||
      failure.diagnostics.exit_signal !== "SIGKILL" ||
      failure.diagnostics.stop_requested !== false
    )
      return failure;
    const after = await this.#readMemoryCgroup();
    if (after === undefined || after.path !== before.path) return failure;
    return failure.withDiagnostics({
      ...failure.diagnostics,
      memory_cgroup: {
        path: after.path,
        oom_kill_before: before.oomKills,
        oom_kill_after: after.oomKills,
        memory_max: after.memoryMax,
      },
    });
  }

  #drainOutputBounded(signal?: AbortSignal): Promise<boolean> {
    if (this.#outputDrainPromise !== undefined) return this.#outputDrainPromise;
    const process = this.#process;
    if (process === undefined) return Promise.resolve(true);
    const pending = process.waitForOutputClose(1_000, signal).then((closed) => {
      if (this.#process !== process) return;
      if (!closed) this.#outputDrainIncomplete = true;
      const snapshot = process.snapshot();
      this.#processSnapshot = this.#outputDrainIncomplete
        ? { ...snapshot, diagnosticTruncated: true, outputIncomplete: true }
        : snapshot;
      return closed;
    });
    this.#outputDrainPromise = pending.then((closed) => closed ?? false);
    return this.#outputDrainPromise;
  }
}
