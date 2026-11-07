import { analysisErrorWithCancellation } from "../../domain/analysisErrorCancellation.js";
import { safeParseUtf8Json } from "../../domain/safeJson.js";
import { analysisSettingLimit } from "../../domain/analysisSettingDefinitions.js";
import { WorkerFrameSignal } from "../../process/WorkerFrameSignal.js";
import type {
  JavaScriptSemanticProjectionCapacity,
  JavaScriptSemanticFileProjection,
} from "../../domain/javascript/javascriptSemanticFileProjection.js";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { getHeapStatistics } from "node:v8";
import { z } from "zod";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import type { JavaScriptStaticAnalysis } from "../../domain/javascript/javascriptStaticAnalysisTypes.js";
import { estimateJavaScriptStaticApplicationProjection } from "../../domain/javascript/javascriptApplicationProjectionResources.js";
import type { JavaScriptModuleSemanticIr } from "../../domain/javascript/javascriptModuleSemanticIr.js";
import type {
  JavaScriptAnalyzedSource,
  JavaScriptSourceAnalysisFailure,
  JavaScriptSourceAnalysisLimits,
  JavaScriptRevokedStaticProjection,
} from "../../domain/javascript/javascriptSourceAnalysis.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisTimeoutError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
} from "../../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import { ok, err, type Result } from "../../domain/result.js";
import { javaScriptRuntime } from "../../domain/runtimeVersion.js";
import {
  RuntimeControlUnavailableError,
  runtimeControlCapabilityError,
} from "../../process/RuntimeControlUnavailableError.js";
import { javaScriptWorkerMemoryLimitBytes } from "../../process/JavaScriptWorkerMemoryLimit.js";
import {
  spawnOwnedProviderProcess,
  type ProviderProcessDiagnostic,
  type ProviderProcessSupervisor,
} from "../../process/ProviderProcess.js";
import {
  OwnedWorkerRuntime,
  OwnedWorkerRuntimeCleanupError,
  WorkerCleanupRegistry,
  processWorkerCleanup,
} from "../../process/OwnedWorkerRuntime.js";
import { prepareProcessOwnershipInspection } from "../../process/ProcessOwnershipObservation.js";
import {
  ProviderStartupDeadline,
  waitForAbortableDelay,
} from "../../process/ProviderDeadline.js";
import {
  readJavaScriptAnalysisTransfer,
  JAVASCRIPT_ANALYSIS_TRANSFER_RECORD_BYTES,
  javaScriptForwardedTransferRemediation,
  javaScriptTransferRetentionBytes,
} from "./JavaScriptAnalysisTransfer.js";
import {
  JAVASCRIPT_PARENT_CHECKPOINT_HEAP_REMEDIATION,
  JAVASCRIPT_PARENT_RESULT_BUDGET_REMEDIATION,
  JAVASCRIPT_WORKER_HEAP_MIB_MAXIMUM,
  JAVASCRIPT_WORKER_HEAP_MIB_MINIMUM,
  javaScriptWorkerHeapExhaustionRecovery,
  javaScriptWorkerHeapRemediation,
} from "../../domain/javascript/javascriptAnalysisResourceControls.js";
import { javaScriptWorkerStaticAnalysisSchema } from "./JavaScriptAnalysisWorkerSchemas.js";
import {
  JAVASCRIPT_ANALYSIS_WORKER_DEFAULTS as DEFAULTS,
  javaScriptCheckpointCeilingRemediation,
  javaScriptWorkerMessageSchema,
  javaScriptWorkerRequestSchema,
  javaScriptWorkerAdmissionSchema,
  type JavaScriptWorkerMessage,
} from "./JavaScriptAnalysisWorkerProtocol.js";

const OPERATION = "analyze_javascript_application";
const PROVIDER = "javascript-static-analysis";
const MIB = 1024 * 1024;
const STATIC_CHECKPOINT_RETENTION_EXPANSION = 6;
/** The worker runs on this executable; Bun accepts but ignores V8 heap flags. */
const WORKER_HEAP_FLAGS_ENFORCED =
  javaScriptRuntime(process.versions).id === "node";

type WorkerPrimaryFailure =
  | { readonly kind: "memory" }
  | { readonly kind: "output"; readonly reason: string }
  | { readonly kind: "input"; readonly cause: Error }
  | {
      readonly kind: "protocol";
      readonly id: string;
      readonly phase: string;
      readonly response: Extract<JavaScriptWorkerMessage, { kind: "failure" }>;
    }
  | {
      readonly kind: "exit";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly heapExhaustion: boolean;
    };

/** One sequential owned worker, retained between source files and closed after analysis. */
export class JavaScriptAnalysisWorker {
  readonly #runId = `rea-javascript-analysis-${randomUUID()}`;
  readonly #runtime: OwnedWorkerRuntime;
  #ready = false;
  #heapLimitBytes = 0;
  #frames: JavaScriptWorkerMessage[] = [];
  readonly #frameSignal = new WorkerFrameSignal();
  #pending = "";
  #decoder = new StringDecoder("utf8");
  #primaryFailure: WorkerPrimaryFailure | undefined;
  #activeJobId: string | undefined;
  #activeJobPhase = "startup";
  #staticResponseId: string | undefined;
  #terminalResponseId: string | undefined;
  #phase = "startup";
  #lastFailure: AnalysisError | undefined;
  #estimatedRetainedBytes = 0;
  #staticProjectionReservations: {
    sourceIndex: number;
    path: string;
    bytes: number;
  }[] = [];
  #revokedStaticProjections: JavaScriptRevokedStaticProjection[] = [];
  #nextSourceIndex = 0;
  #applicationProjectionFailure: AnalysisResourceConstraintError | undefined;
  #parentCapacityExhausted = false;
  #sourcesRemaining: number | undefined;
  #deadline: ProviderStartupDeadline | undefined;
  #resultBudgetBytes = 0;
  /** Null when the runtime enforces the V8 heap flags instead. */
  readonly #processMemoryLimitBytes: number | null;
  readonly #onStdout = (chunk: Buffer | string): void => {
    if (this.#deadline?.interruption !== undefined) return;
    this.#observeMemoryLimit();
    try {
      this.#pending +=
        typeof chunk === "string" ? chunk : this.#decoder.write(chunk);
      let newline: number;
      while ((newline = this.#pending.indexOf("\n")) >= 0) {
        const line = this.#pending.slice(0, newline);
        this.#pending = this.#pending.slice(newline + 1);
        if (
          Buffer.byteLength(line) > DEFAULTS.protocolBytes ||
          this.#frames.length >= 16
        ) {
          this.#latchOutputFailure(
            "JavaScript worker exceeded its control-frame budget",
          );
          return;
        }
        const raw: unknown = JSON.parse(line);
        const frame = javaScriptWorkerMessageSchema.parse(raw);
        this.#frames.push(frame);
        this.#observeJobFrame(frame);
        this.#frameSignal.wake("frame");
      }
      if (Buffer.byteLength(this.#pending) > DEFAULTS.protocolBytes)
        this.#latchOutputFailure(
          "JavaScript worker control frame is unterminated or oversized",
        );
    } catch (cause: unknown) {
      this.#latchOutputFailure(message(cause));
    }
  };

  readonly #workerCleanup: WorkerCleanupRegistry;

  constructor(
    readonly limits: JavaScriptSourceAnalysisLimits = DEFAULTS,
    readonly launcher: typeof spawnOwnedProviderProcess = spawnOwnedProviderProcess,
    sourceCount?: number,
    workerCleanup: WorkerCleanupRegistry = processWorkerCleanup,
  ) {
    this.#workerCleanup = workerCleanup;
    this.#runtime = new OwnedWorkerRuntime({
      rootPrefix: "rea-javascript-analysis-",
      launcher,
      cleanupRegistry: workerCleanup,
      supervisorOptions: {
        captureStdout: false,
        maxDiagnosticBytes: 256 * 1024,
        onDiagnostic: (event) => this.#observeProcessDiagnostic(event),
      },
      onInputFailure: (cause) => this.#latchInputFailure(cause),
    });
    if (
      !Number.isSafeInteger(limits.heapMb) ||
      limits.heapMb < JAVASCRIPT_WORKER_HEAP_MIB_MINIMUM ||
      limits.heapMb > JAVASCRIPT_WORKER_HEAP_MIB_MAXIMUM ||
      !Number.isSafeInteger(limits.timeoutMs) ||
      limits.timeoutMs <= 0 ||
      limits.timeoutMs > 2_147_483_647
    )
      throw new RangeError(
        "JavaScript worker requires valid heap and execution limits",
      );
    if (
      sourceCount !== undefined &&
      (!Number.isSafeInteger(sourceCount) || sourceCount < 0)
    )
      throw new RangeError(
        "JavaScript worker source count must be a nonnegative safe integer",
      );
    this.#sourcesRemaining = sourceCount;
    this.#processMemoryLimitBytes = javaScriptWorkerMemoryLimitBytes(
      limits.heapMb,
    );
    this.#refreshResultBudget();
  }

  /**
   * Whether this idle process can analyze another application. A failed,
   * cancelled, or still-open job must not be reused.
   */
  canReuse(): boolean {
    return (
      this.#ready &&
      this.#activeJobId === undefined &&
      this.#primaryFailure === undefined &&
      this.#lastFailure === undefined &&
      this.#frames.length === 0 &&
      this.#pending === "" &&
      this.#runtime.inputFailure === undefined &&
      !this.#runtime.hasPendingCleanup &&
      this.#runtime.supervisor !== undefined
    );
  }

  /**
   * Reset per-analysis admission for one idle process. The worker heap limit
   * stays the one selected at launch; callers must not reuse across limits.
   */
  prepareForAnotherAnalysis(sourceCount: number): boolean {
    if (!this.canReuse()) return false;
    if (!Number.isSafeInteger(sourceCount) || sourceCount < 0)
      throw new RangeError(
        "JavaScript worker source count must be a nonnegative safe integer",
      );
    this.#sourcesRemaining = sourceCount;
    this.#estimatedRetainedBytes = 0;
    this.#staticProjectionReservations = [];
    this.#revokedStaticProjections = [];
    this.#nextSourceIndex = 0;
    this.#parentCapacityExhausted = false;
    this.#applicationProjectionFailure = undefined;
    this.#refreshResultBudget();
    return true;
  }

  /** Keep the limit and usage in one V8 observation for every admission path. */
  #remainingParentHeapBytes(): number {
    const { heap_size_limit, used_heap_size } = getHeapStatistics();
    return heap_size_limit - used_heap_size;
  }

  /**
   * Reserve host-side control, schema/Evidence work, and a maximum record's
   * transient copies. Admission also accounts for retained earlier files.
   */
  #refreshResultBudget(): void {
    this.#resultBudgetBytes = Math.max(
      0,
      Math.floor(
        (this.#remainingParentHeapBytes() -
          24 * JAVASCRIPT_ANALYSIS_TRANSFER_RECORD_BYTES) /
          2,
      ),
    );
  }

  /** Analyze inert source; hard worker failure does not terminate this process. */
  async analyze(
    file: JavaScriptArtifactFile,
    capacity: JavaScriptSemanticProjectionCapacity,
    signal?: AbortSignal,
    onPhase?: (phase: string) => Promise<void>,
  ): Promise<
    Result<JavaScriptAnalyzedSource, JavaScriptSourceAnalysisFailure>
  > {
    let javascript: JavaScriptStaticAnalysis | null = null;
    let module: JavaScriptModuleSemanticIr | null = null;
    let projection: JavaScriptSemanticFileProjection | null = null;
    const id = randomUUID();
    const sourceIndex = this.#nextSourceIndex++;
    this.#applicationProjectionFailure = undefined;
    this.#parentCapacityExhausted = false;
    this.#revokedStaticProjections = [];
    if (this.#sourcesRemaining !== undefined)
      this.#sourcesRemaining = Math.max(0, this.#sourcesRemaining - 1);
    let deadline: ProviderStartupDeadline | undefined;
    let result: Result<
      JavaScriptAnalyzedSource,
      JavaScriptSourceAnalysisFailure
    >;
    try {
      if (signal?.aborted === true)
        throw new AnalysisCancelledError(OPERATION, { cause: signal.reason });
      if (!file.text.included || file.kind !== "javascript")
        throw new TypeError(
          "JavaScript analysis worker requires included JavaScript text",
        );
      // Host ownership preparation is outside the parser execution deadline.
      await prepareProcessOwnershipInspection(signal);
      await this.#workerCleanup.retry();
      deadline = new ProviderStartupDeadline(this.limits.timeoutMs, signal);
      this.#deadline = deadline;
      await this.#start(deadline);
      const rootPath = this.#runtime.rootPath;
      const supervisor = this.#runtime.supervisor;
      if (rootPath === undefined || supervisor === undefined)
        throw new TypeError("JavaScript worker resources were not acquired");
      if (this.#frames.length !== 0 || this.#pending !== "")
        throw new AnalysisOutputError(
          OPERATION,
          "JavaScript worker has unsolicited or incomplete control frames",
        );
      supervisor.resetOutput();
      this.#phase = "source-transfer";
      await writeFile(join(rootPath, `${id}.source`), file.text.value, {
        flag: "wx",
        mode: 0o600,
        signal: deadline.signal,
      });
      const { text: _text, ...metadata } = file;
      let offeredResultBudget = 0;
      const request = javaScriptWorkerRequestSchema.parse({
        id,
        node_budget: capacity.nodes,
        unknown_budget: capacity.unknowns,
        text_sha256: createHash("sha256").update(file.text.value).digest("hex"),
        file: metadata,
      });
      const frame = `${JSON.stringify(request)}\n`;
      if (Buffer.byteLength(frame) > DEFAULTS.protocolBytes)
        throw new AnalysisResourceConstraintError(
          OPERATION,
          "transport",
          `Source identity for ${file.path} exceeds the ${String(DEFAULTS.protocolBytes)}-byte worker request ceiling. This release has no runtime override.`,
          { worker_request_bytes: DEFAULTS.protocolBytes },
          {
            remediationAction: `This release has no runtime override for the ${String(DEFAULTS.protocolBytes)}-byte JavaScript worker request ceiling. Raising max_heap_mb does not raise it. Repeating the unchanged request fails the same way.`,
          },
        );
      const stdin = supervisor.launch.process.stdin;
      if (stdin === undefined || stdin === null)
        throw new TypeError("JavaScript worker has no writable request stream");
      this.#activeJobId = id;
      this.#activeJobPhase = this.#phase;
      this.#staticResponseId = undefined;
      this.#terminalResponseId = undefined;
      await new Promise<void>((resolve, reject) =>
        stdin.write(frame, (error) =>
          error === null || error === undefined ? resolve() : reject(error),
        ),
      );
      for (;;) {
        const response = await this.#next(deadline, file.path);
        // A ready frame is outside this job. A frame for another job is not
        // this request's result; keep waiting so a later caller abort is
        // still cancellation.
        if (response.kind === "ready")
          throw new AnalysisOutputError(
            OPERATION,
            "JavaScript worker response names a different source job",
          );
        if (response.id !== id) continue;
        if (response.kind === "phase") {
          this.#phase = response.phase;
          await onPhase?.(response.phase);
          continue;
        }
        if (response.kind === "static") {
          if (javascript !== null)
            throw new AnalysisOutputError(
              OPERATION,
              "JavaScript worker emitted a duplicate static checkpoint",
            );
          javascript = await this.#readCheckpoint(
            id,
            file.path,
            sourceIndex,
            response,
          );
          if (this.#parentCapacityExhausted)
            throw new AnalysisResourceConstraintError(
              OPERATION,
              "memory",
              `The parent's result capacity was exhausted after retaining static facts for ${file.path}; remaining sources were not analyzed`,
              {
                ...this.#limits(),
                parent_result_budget_bytes: this.#resultBudgetBytes,
                parent_result_budget_exhausted: true,
              },
              {
                remediationAction: JAVASCRIPT_PARENT_RESULT_BUDGET_REMEDIATION,
              },
            );
          offeredResultBudget =
            this.#applicationProjectionFailure !== undefined &&
            this.#sourcesRemaining !== undefined &&
            this.#sourcesRemaining > 0
              ? 0
              : this.#remainingResultBudget();
          const admission = javaScriptWorkerAdmissionSchema.parse({
            id,
            semantic_result_budget_bytes: offeredResultBudget,
          });
          await new Promise<void>((resolve, reject) =>
            stdin.write(`${JSON.stringify(admission)}\n`, (error) =>
              error === null || error === undefined ? resolve() : reject(error),
            ),
          );
          continue;
        }
        if (response.kind === "failure") {
          if (
            this.#primaryFailure?.kind === "protocol" &&
            this.#primaryFailure.id === response.id
          )
            this.#primaryFailure = undefined;
          if (response.reason === "resource") {
            result = err({
              javascript,
              module,
              projection,
              error: this.#protocolFailure(file.path, response, this.#phase),
            });
            break;
          }
          throw this.#protocolFailure(file.path, response, this.#phase);
        }
        if (javascript === null)
          throw new AnalysisOutputError(
            OPERATION,
            "JavaScript worker completed before a static checkpoint",
          );
        if (response.descriptor === null) {
          result = ok({ javascript, module: null, projection: null });
          break;
        }
        const descriptor = response.descriptor;
        // JSON bytes alone omit object/array overhead and the later graph/Evidence
        // sealing/serialization copies. Reserve a conservative expansion budget.
        const moduleEstimate = javaScriptTransferRetentionBytes(
          descriptor.module_bytes,
          descriptor.module_records,
        );
        const graphEstimate = javaScriptTransferRetentionBytes(
          descriptor.graph_bytes,
          descriptor.graph_records,
        );
        const remaining = Math.min(
          offeredResultBudget,
          this.#remainingResultBudget(),
        );
        if (moduleEstimate > remaining) {
          result = err({
            javascript,
            module: null,
            projection: null,
            error: new AnalysisResourceConstraintError(
              OPERATION,
              "memory",
              `Completed module facts for ${file.path} exceed the parent's remaining result budget; static facts were retained`,
              {
                ...this.#limits(),
                parent_result_budget_bytes: this.#resultBudgetBytes,
                parent_available_result_budget_bytes: remaining,
                module_transfer_bytes: descriptor.module_bytes,
                module_retention_estimate_bytes: moduleEstimate,
              },
              {
                remediationAction: `Use the retained static facts or analyze fewer source files. ${JAVASCRIPT_PARENT_RESULT_BUDGET_REMEDIATION}`,
              },
            ),
          });
          break;
        }
        const retainGraph = moduleEstimate + graphEstimate <= remaining;
        this.#phase = "result-admission";
        const decoded = await readJavaScriptAnalysisTransfer(
          join(rootPath, `${id}.records`),
          descriptor,
          file,
          deadline.signal,
          retainGraph ? capacity : null,
        );
        module = decoded.module;
        projection = decoded.projection;
        this.#estimatedRetainedBytes +=
          moduleEstimate + (retainGraph ? graphEstimate : 0);
        result = retainGraph
          ? ok({ javascript, module, projection: decoded.projection })
          : err({
              javascript,
              module,
              projection,
              error: new AnalysisResourceConstraintError(
                OPERATION,
                "memory",
                `Semantic graph for ${file.path} exceeds the parent's remaining result budget; static and module facts were retained`,
                {
                  ...this.#limits(),
                  parent_result_budget_bytes: this.#resultBudgetBytes,
                  parent_available_result_budget_bytes: remaining,
                  module_retention_estimate_bytes: moduleEstimate,
                  graph_retention_estimate_bytes: graphEstimate,
                  graph_transfer_bytes: descriptor.graph_bytes,
                  graph_records: descriptor.graph_records,
                },
                {
                  remediationAction: `Use the retained static and module facts or analyze fewer source files. ${JAVASCRIPT_PARENT_RESULT_BUDGET_REMEDIATION}`,
                },
              ),
            });
        break;
      }
      // An allocation failure may surface as a protocol failure or be caught
      // inside the worker; any reached limit makes this file's result partial.
      this.#observeMemoryLimit();
      if (this.#primaryFailure?.kind === "memory")
        throw this.#projectPrimaryFailure(file.path);
    } catch (cause: unknown) {
      const error = this.#failure(cause, file.path, deadline, signal);
      if (
        this.#primaryFailure !== undefined &&
        deadline?.interruption === "cancelled"
      )
        error.retainSecondaryFailure(
          new AnalysisCancelledError(OPERATION, {
            cause: deadline.signal.reason,
            capturedOutput: this.#captured(),
          }),
        );
      this.#lastFailure = error;
      // Complete checkpoints remain readable after a child crash or cancellation.
      const cleanup = await this.#stop(error);
      if (
        cleanup === undefined &&
        javascript === null &&
        this.#runtime.rootPath !== undefined
      ) {
        try {
          javascript = await this.#readCheckpoint(id, file.path, sourceIndex);
        } catch (checkpointCause: unknown) {
          void checkpointCause;
        }
      }
      result = err({ error: cleanup ?? error, javascript, module, projection });
    } finally {
      deadline?.dispose();
      if (this.#deadline === deadline) this.#deadline = undefined;
      if (this.#activeJobId === id) this.#activeJobId = undefined;
    }
    if (result.ok) this.#lastFailure = undefined;
    else if (!(result.error.error instanceof ProviderCleanupError))
      this.#lastFailure = result.error.error;
    // Child stop must be verified before temporary files are released. On
    // cleanup uncertainty, close retains this owner for a later retry.
    const rootPath = this.#runtime.rootPath;
    if (rootPath !== undefined && !this.#runtime.hasPendingCleanup) {
      try {
        for (const suffix of ["source", "static.json", "records"])
          await rm(join(rootPath, `${id}.${suffix}`), { force: true });
      } catch (cause: unknown) {
        this.#runtime.retainForCleanup();
        const previous = result.ok ? undefined : result.error.error;
        const primary = signal?.aborted
          ? analysisErrorWithCancellation(
              previous,
              new AnalysisCancelledError(OPERATION, {
                cause: signal.reason,
                capturedOutput: this.#captured(),
              }),
            )
          : previous;
        const error = this.#cleanupError(message(cause), primary);
        this.#runtime.bindCleanupFailure(error);
        result = err({
          javascript,
          module,
          projection,
          error,
        });
      }
    }
    if (signal?.aborted === true) {
      const error = analysisErrorWithCancellation(
        result.ok ? undefined : result.error.error,
        new AnalysisCancelledError(OPERATION, {
          cause: signal.reason,
          capturedOutput: this.#captured(),
        }),
      );
      if (result.ok) this.#lastFailure = error;
      result = err({ error, javascript, module, projection });
    }
    if (
      this.#applicationProjectionFailure !== undefined ||
      this.#revokedStaticProjections.length > 0
    )
      return result.ok
        ? ok({
            ...result.value,
            ...(this.#applicationProjectionFailure === undefined
              ? {}
              : {
                  applicationProjectionFailure:
                    this.#applicationProjectionFailure,
                }),
            ...(this.#revokedStaticProjections.length === 0
              ? {}
              : { revokedStaticProjections: this.#revokedStaticProjections }),
          })
        : err({
            ...result.error,
            ...(this.#applicationProjectionFailure === undefined
              ? {}
              : {
                  applicationProjectionFailure:
                    this.#applicationProjectionFailure,
                }),
            ...(this.#revokedStaticProjections.length === 0
              ? {}
              : { revokedStaticProjections: this.#revokedStaticProjections }),
          });
    return result;
  }

  /** Verify process cleanup, then release the private runtime; failed close is retryable. */
  async close(): Promise<void> {
    try {
      await this.#runtime.close();
      this.#ready = false;
      this.#resetState();
    } catch (cause: unknown) {
      if (cause instanceof OwnedWorkerRuntimeCleanupError) {
        const error = this.#cleanupError(
          cause.message,
          this.#lastFailure,
          cause.cleanupResources,
          cause.processId,
        );
        cause.bindCleanupFailure(error);
        throw error;
      }
      throw cause;
    }
  }

  async #start(deadline: ProviderStartupDeadline): Promise<void> {
    if (this.#runtime.supervisor !== undefined && this.#ready) return;
    this.#phase = "startup";
    this.#heapLimitBytes = 0;
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      UV_THREADPOOL_SIZE: "1",
    };
    delete environment.NODE_OPTIONS;
    await this.#runtime.start(
      {
        command: process.execPath,
        arguments: [
          `--max-old-space-size=${String(this.limits.heapMb)}`,
          "--max-semi-space-size=8",
          "--v8-pool-size=1",
          "--expose-gc",
          "--stack_size=2048",
          fileURLToPath(import.meta.resolve("#javascript-analysis-worker")),
        ],
        runId: `${this.#runId}-${randomUUID()}`,
        hostEnvironment: environment,
        stdin: "pipe",
        ...(this.#processMemoryLimitBytes === null
          ? {}
          : { memoryLimitBytes: this.#processMemoryLimitBytes }),
        signal: deadline.signal,
      },
      async () => {
        this.#runtime.onStdout(this.#onStdout);
        const ready = await this.#next(deadline, "worker startup");
        if (ready.kind !== "ready")
          throw new AnalysisOutputError(
            OPERATION,
            "JavaScript worker emitted facts before its startup handshake",
          );
        if ((ready.heap_limit_bytes === null) === WORKER_HEAP_FLAGS_ENFORCED)
          throw new AnalysisOutputError(
            OPERATION,
            "JavaScript worker heap limit does not match the runtime that launched it",
          );
        this.#heapLimitBytes = ready.heap_limit_bytes ?? 0;
        this.#ready = true;
      },
    );
  }

  async #next(
    deadline: ProviderStartupDeadline,
    path: string,
  ): Promise<JavaScriptWorkerMessage> {
    for (;;) {
      if (deadline.interruption !== undefined) {
        const failure = this.#interruptionFailure(path, deadline);
        throw failure;
      }
      this.#observeMemoryLimit();
      const inputFailure = this.#runtime.inputFailure;
      if (inputFailure !== undefined) this.#latchInputFailure(inputFailure);
      if (
        this.#primaryFailure !== undefined &&
        this.#primaryFailure.kind !== "exit" &&
        this.#primaryFailure.kind !== "protocol"
      )
        throw this.#projectPrimaryFailure(path);
      const frame = this.#frames.shift();
      if (frame !== undefined) return frame;
      const supervisor = this.#runtime.supervisor;
      const snapshot = supervisor?.snapshot();
      if (
        supervisor !== undefined &&
        snapshot !== undefined &&
        (snapshot.exitCode !== undefined || snapshot.signal !== undefined)
      ) {
        // Exit does not complete the protocol: descendants may still hold its pipes
        // or write a final response. The operation deadline bounds this wait.
        const outcome = await this.#waitForFrameOrOutputClose(
          supervisor,
          deadline,
        );
        if (outcome === "interrupted") {
          const completedFrame = this.#frames.shift();
          if (completedFrame !== undefined) return completedFrame;
          throw this.#interruptionFailure(path, deadline);
        }
        if (outcome === "failure") {
          const bufferedFrame = this.#frames.shift();
          if (bufferedFrame !== undefined) return bufferedFrame;
          throw this.#selectedWorkerFailure(path);
        }
        const finalFrame = this.#frames.shift();
        if (finalFrame !== undefined) return finalFrame;
        if (outcome === "frame") continue;
        throw this.#selectedWorkerFailure(path);
      }
      await waitForAbortableDelay(10, deadline.signal);
    }
  }

  async #readCheckpoint(
    id: string,
    sourcePath: string,
    sourceIndex: number,
    expected?: { readonly bytes: number; readonly sha256: string },
  ): Promise<JavaScriptStaticAnalysis> {
    const rootPath = this.#runtime.rootPath;
    if (rootPath === undefined)
      throw new TypeError("JavaScript checkpoint has no owned runtime");
    const path = join(rootPath, `${id}.static.json`);
    const bytes = (await stat(path)).size;
    if (
      bytes > DEFAULTS.checkpointBytes ||
      (expected !== undefined && expected.bytes !== bytes)
    )
      throw new AnalysisOutputError(
        OPERATION,
        "JavaScript static checkpoint byte count exceeds or differs from its declared budget",
      );
    if (bytes * 16 + 4 * MIB > this.#remainingParentHeapBytes() - 64 * MIB)
      throw new AnalysisResourceConstraintError(
        OPERATION,
        "memory",
        "The parent's remaining heap cannot safely decode the completed JavaScript static checkpoint",
        { ...this.#limits(), checkpoint_bytes: bytes },
        {
          remediationAction: JAVASCRIPT_PARENT_CHECKPOINT_HEAP_REMEDIATION,
        },
      );
    const checkpoint = await readFile(path);
    if (
      expected !== undefined &&
      createHash("sha256").update(checkpoint).digest("hex") !== expected.sha256
    )
      throw new AnalysisOutputError(
        OPERATION,
        "JavaScript static checkpoint digest does not match",
      );
    const decoded = safeParseUtf8Json(checkpoint);
    if (!decoded.ok) throw decoded.cause;
    const facts = javaScriptWorkerStaticAnalysisSchema.parse(decoded.value);
    const retainedBytes = bytes * STATIC_CHECKPOINT_RETENTION_EXPANSION;
    // Application relationships are materialized only after all source files
    // have been examined. Reclaim their pending reservations to keep room for
    // later static observations, without relaxing the actual retained bound.
    const needed =
      retainedBytes - (this.#resultBudgetBytes - this.#estimatedRetainedBytes);
    const liveAvailable =
      this.#remainingParentHeapBytes() -
      24 * JAVASCRIPT_ANALYSIS_TRANSFER_RECORD_BYTES;
    if (needed > 0 && retainedBytes <= liveAvailable) {
      // Plan all revocations first so an insufficient set leaves the earlier
      // relationships intact rather than sacrificing them for a failed read.
      let start = this.#staticProjectionReservations.length;
      let reclaimable = 0;
      while (start > 0 && reclaimable < needed) {
        start--;
        reclaimable += this.#staticProjectionReservations[start]!.bytes;
      }
      if (reclaimable >= needed) {
        const revoked = this.#staticProjectionReservations.splice(start);
        for (const reservation of revoked) {
          this.#estimatedRetainedBytes -= reservation.bytes;
          this.#revokedStaticProjections.push({
            sourceIndex: reservation.sourceIndex,
            error: new AnalysisResourceConstraintError(
              OPERATION,
              "memory",
              `Expanded application relationships for ${reservation.path} were omitted to retain static facts for later sources`,
              { parent_result_budget_bytes: this.#resultBudgetBytes },
              {
                remediationAction: `Read the retained static facts or analyze fewer source files. ${JAVASCRIPT_PARENT_RESULT_BUDGET_REMEDIATION}`,
              },
            ),
          });
        }
      }
    }
    // Use the same live-heap observation for the reclamation decision and
    // admission so a second read cannot reject after revocations commit.
    const remaining = Math.max(
      0,
      Math.min(
        this.#resultBudgetBytes - this.#estimatedRetainedBytes,
        liveAvailable,
      ),
    );
    this.#parentCapacityExhausted = retainedBytes > remaining;
    this.#estimatedRetainedBytes += retainedBytes;
    const expandedBytes = estimateJavaScriptStaticApplicationProjection(
      facts,
      bytes,
      sourcePath,
    );
    const availableResultBudget = this.#remainingResultBudget();
    if (expandedBytes <= availableResultBudget) {
      this.#estimatedRetainedBytes += expandedBytes;
      this.#staticProjectionReservations.push({
        sourceIndex,
        path: sourcePath,
        bytes: expandedBytes,
      });
    } else
      this.#applicationProjectionFailure = new AnalysisResourceConstraintError(
        OPERATION,
        "memory",
        `Expanded application relationships for ${sourcePath} exceed the parent's result budget; complete static facts were retained on the file node`,
        {
          parent_result_budget_bytes: this.#resultBudgetBytes,
          parent_available_result_budget_bytes: availableResultBudget,
          application_projection_required_bytes: expandedBytes,
        },
        {
          remediationAction: `Read the complete static facts on the file node or analyze fewer source files. Expanded application relationships exceed the parent result budget. ${JAVASCRIPT_PARENT_RESULT_BUDGET_REMEDIATION}`,
        },
      );
    return facts;
  }

  #limits() {
    return {
      ...(WORKER_HEAP_FLAGS_ENFORCED
        ? {
            worker_old_space_mb: this.limits.heapMb,
            ...(this.#heapLimitBytes === 0
              ? {}
              : { worker_heap_limit_bytes: this.#heapLimitBytes }),
          }
        : // Bun enforces no worker heap limit; report it as unavailable.
          { worker_heap_limit_bytes: null }),
      ...(this.#processMemoryLimitBytes === null
        ? {}
        : {
            worker_process_memory_limit_bytes: this.#processMemoryLimitBytes,
          }),
      worker_timeout_ms: this.limits.timeoutMs,
    };
  }
  #memoryLimitReached(): boolean {
    return this.#runtime.supervisor?.launch.process.memoryLimitReached === true;
  }
  #memoryFailure(path: string): AnalysisResourceConstraintError {
    return new AnalysisResourceConstraintError(
      OPERATION,
      "memory",
      `Owned JavaScript worker reached its ${this.#processMemoryLimitBytes === null ? "" : `${String(this.#processMemoryLimitBytes)}-byte `}process memory limit while analyzing ${path} during ${this.#phase}. That limit is max_heap_mb ${String(this.limits.heapMb)} MiB plus a 512 MiB Bun runtime reserve`,
      this.#limits(),
      {
        capturedOutput: this.#captured(),
        limit: analysisSettingLimit(
          "javascript.max_heap_mb",
          this.limits.heapMb,
          undefined,
        ),
        remediationAction: javaScriptWorkerHeapRemediation(this.limits.heapMb),
      },
    );
  }
  #remainingResultBudget(): number {
    // One sequential worker produces one next checkpoint at a time. Reserve
    // its maximum protocol size at the same retained expansion used on receipt;
    // earlier checkpoints are already charged to estimatedRetainedBytes.
    // Reserving every unexamined source's maximum would reject useful results
    // merely because many small files remain. Actual retained growth and live
    // heap capacity are checked again for every checkpoint and transfer.
    const checkpointReserve =
      DEFAULTS.checkpointBytes * STATIC_CHECKPOINT_RETENTION_EXPANSION;
    const staticReserve =
      this.#sourcesRemaining !== undefined && this.#sourcesRemaining > 0
        ? checkpointReserve
        : 0;
    return Math.max(0, this.#remainingTotalResultBudget() - staticReserve);
  }
  #remainingTotalResultBudget(): number {
    return Math.max(
      0,
      Math.min(
        this.#resultBudgetBytes - this.#estimatedRetainedBytes,
        this.#remainingParentHeapBytes() -
          24 * JAVASCRIPT_ANALYSIS_TRANSFER_RECORD_BYTES,
      ),
    );
  }
  #captured() {
    const snapshot = this.#runtime.supervisor?.snapshot();
    const supervisor = this.#runtime.supervisor;
    return {
      stdout: "",
      stderr: snapshot?.stderr.text ?? "",
      truncated:
        snapshot?.diagnosticTruncated === true ||
        snapshot?.outputIncomplete === true ||
        (supervisor !== undefined && !supervisor.observedOutputClose()),
      stderr_bytes: snapshot?.stderr.observedBytes ?? 0,
      exit_code: snapshot?.exitCode ?? null,
      signal: snapshot?.signal ?? null,
    };
  }
  #observeProcessDiagnostic(event: ProviderProcessDiagnostic): void {
    if (this.#deadline?.interruption !== undefined) return;
    this.#observeMemoryLimit();
    if (event.type === "output-close") {
      if (
        this.#deadline !== undefined &&
        (this.#activeJobId === undefined ||
          this.#terminalResponseId !== this.#activeJobId)
      )
        this.#latchOutputFailure(
          "JavaScript worker closed output before the operation received its terminal response",
        );
      return;
    }
    if (
      event.type === "output" &&
      event.stream === "stderr" &&
      this.#primaryFailure?.kind === "exit" &&
      /heap out of memory|heap limit|allocation failed/iu.test(
        this.#runtime.supervisor?.snapshot().stderr.text ?? "",
      )
    ) {
      this.#primaryFailure = { ...this.#primaryFailure, heapExhaustion: true };
      this.#frameSignal.wake("failure");
    }
    if (event.type === "exit" && (event.code !== 0 || event.signal !== null)) {
      if (this.#primaryFailure === undefined)
        this.#primaryFailure = {
          kind: "exit",
          code: event.code,
          signal: event.signal,
          heapExhaustion:
            /heap out of memory|heap limit|allocation failed/iu.test(
              event.snapshot.stderr.text,
            ),
        };
      else if (
        this.#primaryFailure.kind === "exit" &&
        /heap out of memory|heap limit|allocation failed/iu.test(
          event.snapshot.stderr.text,
        )
      ) {
        this.#primaryFailure = {
          ...this.#primaryFailure,
          heapExhaustion: true,
        };
        this.#frameSignal.wake("failure");
      }
    }
  }
  #observeMemoryLimit(): void {
    if (
      this.#deadline?.interruption === undefined &&
      this.#memoryLimitReached()
    ) {
      if (this.#primaryFailure === undefined)
        this.#primaryFailure = { kind: "memory" };
      else if (this.#primaryFailure.kind === "exit")
        this.#primaryFailure = {
          ...this.#primaryFailure,
          heapExhaustion: true,
        };
      if (
        this.#primaryFailure?.kind === "memory" ||
        this.#primaryFailure?.kind === "exit"
      )
        this.#frameSignal.wake("failure");
    }
  }
  #observeJobFrame(frame: JavaScriptWorkerMessage): void {
    if (
      this.#deadline?.interruption !== undefined ||
      this.#activeJobId === undefined ||
      frame.kind === "ready"
    )
      return;
    if (frame.id !== this.#activeJobId) return;
    if (frame.kind === "phase") {
      this.#activeJobPhase = frame.phase;
      return;
    }
    if (frame.kind === "static") {
      this.#staticResponseId = frame.id;
      return;
    }
    if (frame.kind === "complete") {
      if (this.#staticResponseId !== frame.id) {
        if (this.#primaryFailure === undefined)
          this.#primaryFailure = {
            kind: "output",
            reason: "JavaScript worker completed before a static checkpoint",
          };
        this.#frameSignal.wake("failure");
        return;
      }
      this.#terminalResponseId = frame.id;
      return;
    }
    if (frame.kind === "failure") this.#terminalResponseId = frame.id;
    if (frame.kind === "failure" && this.#primaryFailure === undefined)
      this.#primaryFailure = {
        kind: "protocol",
        id: frame.id,
        phase: this.#activeJobPhase,
        response: frame,
      };
  }
  #latchOutputFailure(reason: string): void {
    if (this.#deadline?.interruption !== undefined) return;
    if (this.#primaryFailure === undefined)
      this.#primaryFailure = { kind: "output", reason };
    this.#frameSignal.wake("failure");
  }
  #latchInputFailure(cause: Error): void {
    if (this.#deadline?.interruption !== undefined) return;
    if (this.#primaryFailure === undefined)
      this.#primaryFailure = { kind: "input", cause };
    this.#frameSignal.wake("failure");
  }
  async #waitForFrameOrOutputClose(
    supervisor: ProviderProcessSupervisor,
    deadline: ProviderStartupDeadline,
  ): Promise<"frame" | "failure" | "closed" | "interrupted"> {
    if (this.#frames.length !== 0) return "frame";
    return this.#frameSignal.waitForOutputClose(supervisor, deadline.signal);
  }
  #selectedWorkerFailure(path: string): AnalysisError {
    if (this.#primaryFailure !== undefined)
      return this.#projectPrimaryFailure(path);
    const snapshot = this.#runtime.supervisor?.snapshot();
    if (snapshot?.exitCode !== undefined || snapshot?.signal !== undefined)
      return this.#workerExitFailure(path, {
        kind: "exit",
        code: snapshot.exitCode ?? null,
        signal: snapshot.signal ?? null,
        heapExhaustion: false,
      });
    return new ProviderAdapterError(PROVIDER, OPERATION, {
      capturedOutput: this.#captured(),
      diagnostics: { source_path: path, phase: this.#phase },
    });
  }
  #interruptionFailure(
    path: string,
    deadline: ProviderStartupDeadline,
  ): AnalysisError {
    if (this.#primaryFailure !== undefined)
      return this.#projectPrimaryFailure(path);
    return deadline.interruption === "timeout"
      ? new AnalysisTimeoutError(OPERATION, this.limits.timeoutMs, {
          limit: analysisSettingLimit(
            "javascript.analysis_timeout_ms",
            this.limits.timeoutMs,
            undefined,
          ),
          capturedOutput: this.#captured(),
          userMessage: `JavaScript source analysis reached its ${String(this.limits.timeoutMs)}ms per-source server/provider deadline (analysis_timeout_ms), not the MCP client deadline.`,
          remediationAction:
            "Reuse accessible partial_observation Evidence to avoid recomputation; reading it is not a prerequisite for a corrected retry. Increase analysis_timeout_ms through MCP, or use rea analyze-javascript-application <input_path> --analysis-timeout-ms <milliseconds> on the CLI. Alternatively, reduce semantic limits or select exact inventoried source_paths (CLI: --source-path on that command). Omit source_paths to analyze all sources; an empty array is invalid. detail: summary reduces response size, not analysis work. Allow execution, cleanup and delivery headroom in the MCP client tool deadline; increasing that client deadline alone does not change this server budget. Resolve any reported incomplete cleanup before retrying.",
        })
      : new AnalysisCancelledError(OPERATION, {
          cause: deadline.signal.reason,
          capturedOutput: this.#captured(),
        });
  }
  #workerExitFailure(
    path: string,
    failure: Extract<WorkerPrimaryFailure, { kind: "exit" }>,
  ): AnalysisError {
    if (failure.heapExhaustion) {
      const recovery = javaScriptWorkerHeapExhaustionRecovery({
        heapFlagsEnforced: WORKER_HEAP_FLAGS_ENFORCED,
        heapMb: this.limits.heapMb,
        path,
        phase: this.#phase,
      });
      return new AnalysisResourceConstraintError(
        OPERATION,
        "memory",
        recovery.reason,
        this.#limits(),
        {
          capturedOutput: this.#captured(),
          ...(WORKER_HEAP_FLAGS_ENFORCED
            ? {
                limit: analysisSettingLimit(
                  "javascript.max_heap_mb",
                  this.limits.heapMb,
                  undefined,
                ),
              }
            : {}),
          remediationAction: recovery.remediationAction,
        },
      );
    }
    return new ProviderAdapterError(PROVIDER, OPERATION, {
      capturedOutput: this.#captured(),
      diagnostics: {
        source_path: path,
        phase: this.#phase,
        exit_code: failure.code,
        signal: failure.signal,
      },
    });
  }
  #projectPrimaryFailure(path: string): AnalysisError {
    const failure = this.#primaryFailure;
    if (failure === undefined) return this.#selectedWorkerFailure(path);
    if (failure.kind === "memory") return this.#memoryFailure(path);
    if (failure.kind === "exit") return this.#workerExitFailure(path, failure);
    if (failure.kind === "input")
      return new AnalysisOutputError(
        OPERATION,
        `Owned JavaScript worker request stream failed during ${path}`,
        { cause: failure.cause, capturedOutput: this.#captured() },
      );
    if (failure.kind === "protocol") {
      return this.#protocolFailure(path, failure.response, failure.phase);
    }
    return new AnalysisOutputError(OPERATION, failure.reason, {
      capturedOutput: this.#captured(),
    });
  }
  #protocolFailure(
    path: string,
    response: Extract<JavaScriptWorkerMessage, { kind: "failure" }>,
    phase: string,
  ): AnalysisError {
    if (response.reason === "io")
      return new ProviderAdapterError(PROVIDER, OPERATION, {
        capturedOutput: this.#captured(),
        userMessage: `Owned JavaScript worker storage failed for ${path} during ${phase}. Retained observations and cleanup status are reported separately.`,
        remediationAction:
          "Check the availability and permissions of REA's private temporary storage, correct the reported I/O failure, and retry. Changing the selected source is not required by this storage failure.",
        diagnostics: {
          source_path: path,
          phase,
          worker_failure_reason: response.reason,
          message: response.message,
        },
      });
    if (response.reason === "resource") {
      const reported = response.limits;
      const limits = { ...this.#limits(), ...reported };
      const transferRemediation =
        javaScriptForwardedTransferRemediation(reported);
      const checkpointBytes = reported?.checkpoint_limit_bytes;
      const checkpointRemediation =
        typeof checkpointBytes === "number"
          ? javaScriptCheckpointCeilingRemediation(checkpointBytes)
          : undefined;
      const parentBudget =
        reported?.semantic_result_budget_bytes !== undefined ||
        reported?.parent_result_budget_bytes !== undefined;
      const remediationAction =
        transferRemediation ??
        checkpointRemediation ??
        (parentBudget
          ? JAVASCRIPT_PARENT_RESULT_BUDGET_REMEDIATION
          : undefined);
      return new AnalysisResourceConstraintError(
        OPERATION,
        response.resource ?? "memory",
        response.message,
        limits,
        remediationAction === undefined ? undefined : { remediationAction },
      );
    }
    return new AnalysisOutputError(
      OPERATION,
      `${path} during ${phase}: ${response.message}`,
      { capturedOutput: this.#captured() },
    );
  }
  #failure(
    cause: unknown,
    path: string,
    deadline: ProviderStartupDeadline | undefined,
    signal: AbortSignal | undefined,
  ): AnalysisError {
    if (
      deadline?.interruption === "cancelled" &&
      cause === deadline.signal.reason
    )
      return this.#interruptionFailure(path, deadline);
    if (
      deadline === undefined &&
      signal?.aborted === true &&
      cause === signal.reason
    )
      return new AnalysisCancelledError(OPERATION, {
        cause: signal.reason,
        capturedOutput: this.#captured(),
      });
    if (cause instanceof OwnedWorkerRuntimeCleanupError) {
      const error = this.#cleanupError(
        cause.message,
        this.#lastFailure,
        cause.cleanupResources,
        cause.processId,
      );
      cause.bindCleanupFailure(error);
      return error;
    }
    // Ownership preparation is abortable before the worker deadline exists.
    if (deadline?.interruption !== undefined)
      return this.#interruptionFailure(path, deadline);
    if (
      deadline === undefined &&
      signal?.aborted === true &&
      !(cause instanceof ProviderCleanupError)
    )
      return new AnalysisCancelledError(OPERATION, {
        cause: signal.reason,
        capturedOutput: this.#captured(),
      });
    const inputFailure = this.#runtime.inputFailure;
    if (inputFailure !== undefined)
      return new AnalysisOutputError(
        OPERATION,
        `Owned JavaScript worker request stream failed during ${this.#phase}`,
        { cause: inputFailure, capturedOutput: this.#captured() },
      );
    // A reached process limit explains the worker's exit, broken pipe or
    // truncated frame better than the symptom it produced.
    if (
      this.#memoryLimitReached() &&
      !(cause instanceof AnalysisResourceConstraintError)
    )
      return this.#memoryFailure(path);
    if (cause instanceof AnalysisError) return cause;
    if (
      cause instanceof z.ZodError ||
      cause instanceof TypeError ||
      cause instanceof SyntaxError
    )
      return new AnalysisOutputError(
        OPERATION,
        `${path} during ${this.#phase}: ${message(cause)}`,
        { cause, capturedOutput: this.#captured() },
      );
    return cause instanceof RuntimeControlUnavailableError
      ? runtimeControlCapabilityError(PROVIDER, OPERATION, cause)
      : new ProviderAdapterError(PROVIDER, OPERATION, {
          cause,
          capturedOutput: this.#captured(),
          diagnostics: {
            source_path: path,
            phase: this.#phase,
            message: message(cause),
          },
        });
  }
  #cleanupError(
    reason: string,
    original: AnalysisError | undefined = this.#lastFailure,
    cleanupResources: readonly string[] = [
      this.#runId,
      ...(this.#runtime.rootPath === undefined ? [] : [this.#runtime.rootPath]),
    ],
    processId: number | null = this.#runtime.supervisor?.launch.process.pid ??
      null,
  ): ProviderCleanupError {
    return new ProviderCleanupError(
      PROVIDER,
      cleanupResources,
      {
        reason,
        worker_pid: processId,
        ...(original === undefined
          ? {}
          : {
              execution_failure: {
                tag: original._tag,
                message: original.message,
                captured_output: {
                  stdout: original.capturedOutput?.stdout ?? "",
                  stderr: original.capturedOutput?.stderr ?? "",
                  truncated: original.capturedOutput?.truncated ?? false,
                },
              },
            }),
      },
      {
        operation: OPERATION,
        ...(original === undefined ? {} : { cleanupPrimary: original }),
        cause: new Error(
          reason,
          original === undefined ? undefined : { cause: original },
        ),
      },
    );
  }
  async #stop(
    original: AnalysisError | undefined = this.#lastFailure,
  ): Promise<ProviderCleanupError | undefined> {
    const stopped = await this.#runtime.stop();
    if (stopped.status === "incomplete") {
      this.#resetState();
      const error = this.#cleanupError(stopped.reason, original);
      this.#runtime.bindCleanupFailure(error);
      return error;
    }
    this.#ready = false;
    this.#resetState();
    return undefined;
  }

  #resetState(): void {
    this.#ready = false;
    this.#frames = [];
    this.#frameSignal.clear();
    this.#pending = "";
    this.#decoder = new StringDecoder("utf8");
    this.#primaryFailure = undefined;
    this.#activeJobId = undefined;
    this.#staticResponseId = undefined;
    this.#terminalResponseId = undefined;
  }
}

const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
