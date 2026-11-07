import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecutionOptions } from "../../application/AnalysisProvider.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
} from "../../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import { err, type Result } from "../../domain/result.js";
import { noRuntimeOverrideSentence } from "../../domain/browserDeadline.js";
import {
  DEFAULT_WEB_SOURCE_MAP_DECODE_TIMEOUT_MS,
  WEB_SOURCE_MAP_LIMITS,
  webSourceMapDecodeTimeoutRecovery,
  type WebSourceMapReport,
} from "../../domain/webSourceLocation.js";
import { parseSourceMapReply } from "./SourceMapReply.js";
import { PrivateRuntimeRoot } from "../../process/PrivateRuntimeRoot.js";
import {
  RuntimeControlUnavailableError,
  runtimeControlCapabilityError,
} from "../../process/RuntimeControlUnavailableError.js";
import { ProviderStartupDeadline } from "../../process/ProviderDeadline.js";
import { javaScriptWorkerMemoryLimitBytes } from "../../process/JavaScriptWorkerMemoryLimit.js";
import { cleanupOwnedProcessGroup } from "../../process/ProcessOwnership.js";
import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
  type OwnedProviderProcessSpawnOptions,
  type ProviderProcessExitObservation,
  type ProviderProcessSnapshot,
  type SpawnedOwnedProviderProcess,
} from "../../process/ProviderProcess.js";
import { prepareProcessOwnershipInspection } from "../../process/ProcessOwnershipObservation.js";

const OPERATION = "trace_web_source_location";
const PROVIDER = "source-map-decoder";
/** Process commit limit enforced on the codec; null where V8 heap flags apply. */
export const SOURCE_MAP_CODEC_MEMORY_LIMIT_BYTES =
  javaScriptWorkerMemoryLimitBytes(WEB_SOURCE_MAP_LIMITS.codecHeapMiB);
/** Launcher seam retains the actual codec protocol and ownership supervisor. */
export type SourceMapCodecLauncher = (
  options: OwnedProviderProcessSpawnOptions,
) => Promise<SpawnedOwnedProviderProcess>;
/** Runtime implementations establish privacy before returning an owned directory. */
export interface SourceMapCodecRuntime {
  readonly path: string;
  close(): Promise<void>;
}
/** Replaceable acquisition boundaries for an owned codec operation. */
export interface SourceMapDecoderDependencies {
  readonly launcher?: SourceMapCodecLauncher;
  readonly createRuntime?: () => Promise<SourceMapCodecRuntime>;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  /** Prepare host ownership inspection outside the codec execution deadline. */
  readonly prepareOwnership?: (signal?: AbortSignal) => Promise<void>;
}

export interface SourceMapCleanupOwner {
  close(): Promise<ProviderCleanupError | undefined>;
}

/** The caller retains retry authority independently of the returned error. */
export interface SourceMapCleanupRetention {
  owner?: SourceMapCleanupOwner | undefined;
}

type CodecPhysicalObservation =
  | {
      readonly kind: "exit";
      readonly exit: ProviderProcessExitObservation;
    }
  | {
      readonly kind: "process-error";
      readonly message: string;
      readonly cause: Error;
    }
  | { readonly kind: "output-limit" };
type CodecOutcome =
  | {
      readonly kind: "physical";
      readonly observation: CodecPhysicalObservation;
    }
  | { readonly kind: "cancelled"; readonly callerReason: unknown }
  | { readonly kind: "timeout" };

export class SourceMapCleanupFailure extends ProviderCleanupError {
  constructor(
    resources: readonly string[],
    diagnostics: Readonly<Record<string, JsonValue>>,
  ) {
    super(PROVIDER, resources, diagnostics, { operation: OPERATION });
  }
}

/** Interpret a trusted codec reply, then release its process and private root. */
export const runSourceMapCommand = async (
  request: string,
  path: string,
  options: ExecutionOptions | undefined,
  dependencies: SourceMapDecoderDependencies,
  retainedCleanup: SourceMapCleanupRetention,
  decodeTimeoutMs: number = DEFAULT_WEB_SOURCE_MAP_DECODE_TIMEOUT_MS,
): Promise<Result<WebSourceMapReport, AnalysisError>> => {
  try {
    await (dependencies.prepareOwnership ?? prepareProcessOwnershipInspection)(
      options?.signal,
    );
  } catch (cause: unknown) {
    return err(
      options?.signal?.aborted === true
        ? new AnalysisCancelledError(OPERATION, {
            cause: options.signal.reason,
          })
        : cause instanceof AnalysisError
          ? cause
          : new ProviderAdapterError(PROVIDER, OPERATION, {
              cause,
              diagnostics: {
                map_path: path,
                error_message: message(cause),
                phase: "process_ownership_preparation",
              },
            }),
    );
  }
  const deadline = new ProviderStartupDeadline(
    decodeTimeoutMs,
    options?.signal,
  );
  const command = new OwnedCodec(path, dependencies, deadline, decodeTimeoutMs);
  let result: Result<WebSourceMapReport, AnalysisError>;
  try {
    await command.start(request);
    result = parseSourceMapReply(
      await command.collect(),
      path,
      SOURCE_MAP_CODEC_MEMORY_LIMIT_BYTES,
    );
  } catch (cause: unknown) {
    result = err(command.failure(cause));
  } finally {
    command.dispose();
    deadline.dispose();
  }
  const cleanup = await command.close();
  const observation = result.ok ? result.value : undefined;
  const completed =
    result.ok && options?.signal?.aborted
      ? err(
          new AnalysisCancelledError(OPERATION, {
            cause: options.signal.reason,
            partialObservation: observation,
          }),
        )
      : result;
  if (cleanup === undefined) return completed;
  if (observation !== undefined) cleanup.retainPartialObservation(observation);
  retainedCleanup.owner = command;
  return completed.ok
    ? err(cleanup)
    : err(
        analysisErrorWithCleanupFailure(
          completed.error,
          cleanup,
          OPERATION,
        ).bindCleanupDependencies([cleanup], command),
      );
};

class OwnedCodec implements SourceMapCleanupOwner {
  readonly #runId = `rea-source-map-${randomUUID()}`;
  #runtime: SourceMapCodecRuntime | undefined;
  #supervisor: ProviderProcessSupervisor | undefined;
  #cleanupAnchor: SourceMapCleanupFailure | undefined;
  #outcome: CodecOutcome | undefined;
  #drainStop: CodecPhysicalObservation | undefined;
  readonly #onInterruption: () => void;
  constructor(
    readonly path: string,
    readonly dependencies: SourceMapDecoderDependencies,
    readonly deadline: ProviderStartupDeadline,
    readonly decodeTimeoutMs: number,
  ) {
    this.#onInterruption = () => this.#observeInterruption();
    if (deadline.signal.aborted) this.#observeInterruption();
    else
      deadline.signal.addEventListener("abort", this.#onInterruption, {
        once: true,
      });
  }

  /** Stop recording event order after an outcome has been selected. */
  dispose(): void {
    this.deadline.signal.removeEventListener("abort", this.#onInterruption);
  }

  async start(request: string): Promise<void> {
    this.check();
    this.#runtime = await (
      this.dependencies.createRuntime ??
      (() => PrivateRuntimeRoot.create({ prefix: "rea-source-map-" }))
    )();
    this.check();
    const requestPath = join(this.#runtime.path, "request.json");
    await writeFile(requestPath, request, {
      flag: "wx",
      mode: 0o600,
      signal: this.deadline.signal,
    });
    this.check();
    const environment: NodeJS.ProcessEnv = {
      ...(this.dependencies.environment ?? process.env),
      UV_THREADPOOL_SIZE: "1",
    };
    delete environment.NODE_OPTIONS;
    const spawned = await (
      this.dependencies.launcher ?? spawnOwnedProviderProcess
    )({
      command: process.execPath,
      arguments: [
        `--max-old-space-size=${String(WEB_SOURCE_MAP_LIMITS.codecHeapMiB)}`,
        "--max-semi-space-size=8",
        "--v8-pool-size=1",
        "--single-threaded",
        "--stack_size=2048",
        fileURLToPath(new URL("./SourceMapCodecProcess.js", import.meta.url)),
        requestPath,
      ],
      runId: this.#runId,
      cwd: this.#runtime.path,
      hostEnvironment: environment,
      ...(SOURCE_MAP_CODEC_MEMORY_LIMIT_BYTES === null
        ? {}
        : { memoryLimitBytes: SOURCE_MAP_CODEC_MEMORY_LIMIT_BYTES }),
      signal: this.deadline.signal,
    });
    this.#supervisor = new ProviderProcessSupervisor(
      {
        ...spawned,
        ownsProcessLifetime: true,
        cleanup:
          spawned.cleanup ??
          (() => cleanupOwnedProcessGroup(spawned.ownership)),
      },
      {
        maxDiagnosticBytes: WEB_SOURCE_MAP_LIMITS.outputBytes + 1024 * 1024,
        onDiagnostic: (event) => {
          if (
            event.type === "exit" &&
            (event.code !== 0 || event.signal !== null)
          )
            this.#recordPhysicalFailure({
              kind: "exit",
              exit: { code: event.code, signal: event.signal },
            });
          if (event.type === "error") {
            this.#recordPhysicalFailure({
              kind: "process-error",
              message: event.message,
              cause: event.cause ?? new Error(event.message),
            });
          }
          if (
            event.type === "output" &&
            (event.truncated === true ||
              event.totalBytes >
                (event.stream === "stdout"
                  ? WEB_SOURCE_MAP_LIMITS.outputBytes
                  : 1024 * 1024))
          ) {
            this.#recordPhysicalFailure({ kind: "output-limit" });
          }
        },
      },
    );
  }

  async collect(): Promise<string> {
    const supervisor = this.#supervisor;
    if (supervisor === undefined)
      throw new Error("Codec process was not acquired");
    while (!(await supervisor.waitForOutputClose(50))) {
      const outcome = this.#outcome;
      if (
        outcome?.kind !== "physical" ||
        outcome.observation.kind !== "exit" ||
        this.deadline.signal.aborted ||
        this.#drainStop !== undefined
      )
        this.check();
    }
    this.check();
    const snapshot = supervisor.snapshot();
    // No partial codec result exists; a reached limit fails the whole trace.
    if (snapshot.memoryLimitReached === true)
      throw this.#memoryLimitFailure(snapshot);
    return snapshot.stdout.text;
  }

  check(): void {
    this.#observeInterruption();
    const outcome = this.#outcome;
    if (outcome?.kind === "physical")
      throw this.#physicalFailure(outcome.observation);
    if (outcome?.kind === "cancelled")
      throw new AnalysisCancelledError(OPERATION, {
        cause: outcome.callerReason,
      });
    if (outcome?.kind === "timeout")
      throw new AnalysisTimeoutError(
        OPERATION,
        this.decodeTimeoutMs,
        webSourceMapDecodeTimeoutRecovery(this.decodeTimeoutMs),
      );
  }

  failure(cause: unknown): AnalysisError {
    this.#observeInterruption();
    const outcome = this.#outcome;
    if (outcome?.kind === "physical")
      return this.#physicalFailure(outcome.observation);
    if (outcome?.kind === "cancelled")
      return new AnalysisCancelledError(OPERATION, {
        cause: outcome.callerReason,
      });
    if (outcome?.kind === "timeout")
      return new AnalysisTimeoutError(
        OPERATION,
        this.decodeTimeoutMs,
        webSourceMapDecodeTimeoutRecovery(this.decodeTimeoutMs),
      );
    if (cause instanceof AnalysisError) return cause;
    return cause instanceof RuntimeControlUnavailableError
      ? runtimeControlCapabilityError(PROVIDER, OPERATION, cause)
      : new ProviderAdapterError(PROVIDER, OPERATION, {
          cause,
          diagnostics: { map_path: this.path, error_message: message(cause) },
        });
  }

  #observeInterruption(): void {
    if (this.#outcome !== undefined) return;
    if (!this.deadline.signal.aborted) return;
    const interruption = this.deadline.interruption;
    if (interruption === undefined) return;
    this.#outcome =
      interruption === "cancelled"
        ? { kind: "cancelled", callerReason: this.deadline.signal.reason }
        : { kind: "timeout" };
  }

  #recordPhysicalFailure(observation: CodecPhysicalObservation): void {
    this.#observeInterruption();
    if (this.#outcome === undefined)
      this.#outcome = { kind: "physical", observation };
    else if (observation.kind !== "exit" && this.#drainStop === undefined)
      this.#drainStop = observation;
  }

  #physicalFailure(observation: CodecPhysicalObservation): AnalysisError {
    const snapshot = this.#supervisor?.snapshot();
    if (observation.kind === "exit") {
      if (snapshot?.memoryLimitReached === true)
        return this.#memoryLimitFailure(snapshot);
      return this.#exitFailure(observation.exit, snapshot);
    }
    if (observation.kind === "process-error")
      return this.#processErrorFailure(observation, snapshot);
    return this.#outputLimitFailure(snapshot);
  }

  #exitFailure(
    exit: ProviderProcessExitObservation,
    snapshot: ProviderProcessSnapshot | undefined,
  ): AnalysisError {
    const outputComplete = this.#supervisor?.observedOutputClose() ?? false;
    const capturedOutput = this.#capturedOutput(snapshot, exit, outputComplete);
    return new ProviderAdapterError(PROVIDER, OPERATION, {
      diagnostics: {
        map_path: this.path,
        exit_code: exit.code,
        signal: exit.signal,
        output_complete: outputComplete,
        stderr: snapshot?.stderr.text ?? "",
        ...(this.#drainStop?.kind === "output-limit"
          ? { output_limit_reached: true }
          : {}),
        ...(this.#drainStop?.kind === "process-error"
          ? { drain_error_message: this.#drainStop.message }
          : {}),
      },
      ...(capturedOutput === undefined ? {} : { capturedOutput }),
    });
  }

  #processErrorFailure(
    observation: Extract<CodecPhysicalObservation, { kind: "process-error" }>,
    snapshot: ProviderProcessSnapshot | undefined,
  ): AnalysisError {
    const outputComplete = this.#supervisor?.observedOutputClose() ?? false;
    const capturedOutput = this.#capturedOutput(
      snapshot,
      undefined,
      outputComplete,
    );
    return new ProviderAdapterError(PROVIDER, OPERATION, {
      cause: observation.cause,
      diagnostics: {
        map_path: this.path,
        error_message: observation.message,
        output_complete: outputComplete,
      },
      ...(capturedOutput === undefined ? {} : { capturedOutput }),
    });
  }

  #outputLimitFailure(
    snapshot: ProviderProcessSnapshot | undefined,
  ): AnalysisError {
    const outputComplete = this.#supervisor?.observedOutputClose() ?? false;
    const capturedOutput = this.#capturedOutput(
      snapshot,
      undefined,
      outputComplete,
    );
    return new AnalysisOutputError(
      OPERATION,
      "Codec output exceeds its complete-evidence or diagnostic budget.",
      {
        capturedOutput: {
          stdout: capturedOutput?.stdout ?? "",
          stderr: capturedOutput?.stderr ?? "",
          stdout_bytes: capturedOutput?.stdout_bytes ?? 0,
          stderr_bytes: capturedOutput?.stderr_bytes ?? 0,
          truncated: true,
        },
      },
    );
  }

  #capturedOutput(
    snapshot: ProviderProcessSnapshot | undefined,
    exit: ProviderProcessExitObservation | undefined,
    outputComplete: boolean,
  ) {
    if (snapshot === undefined) return undefined;
    return {
      stdout: snapshot.stdout.text,
      stderr: snapshot.stderr.text,
      truncated: snapshot.diagnosticTruncated === true || !outputComplete,
      stdout_bytes: snapshot.stdout.observedBytes,
      stderr_bytes: snapshot.stderr.observedBytes,
      ...(exit === undefined
        ? {}
        : { exit_code: exit.code, signal: exit.signal }),
    };
  }

  #memoryLimitFailure(snapshot: ProviderProcessSnapshot): AnalysisError {
    return new AnalysisResourceConstraintError(
      OPERATION,
      "memory",
      `Source-map codec reached its ${SOURCE_MAP_CODEC_MEMORY_LIMIT_BYTES === null ? "" : `${String(SOURCE_MAP_CODEC_MEMORY_LIMIT_BYTES)}-byte `}process memory limit for ${this.path}; no partial evidence was returned. ${noRuntimeOverrideSentence(`The ${String(WEB_SOURCE_MAP_LIMITS.codecHeapMiB)} MiB codec heap stays fixed.`, "decode_timeout_ms")}`,
      {
        codec_process_memory_limit_bytes: SOURCE_MAP_CODEC_MEMORY_LIMIT_BYTES,
      },
      {
        capturedOutput: {
          stdout: "",
          stderr: snapshot.stderr.text,
          truncated:
            snapshot.diagnosticTruncated === true ||
            !(this.#supervisor?.observedOutputClose() ?? false),
        },
        remediationAction: noRuntimeOverrideSentence(
          `The ${String(WEB_SOURCE_MAP_LIMITS.codecHeapMiB)} MiB codec heap, ${String(WEB_SOURCE_MAP_LIMITS.mapBytes)}-byte map budget, and ${String(WEB_SOURCE_MAP_LIMITS.outputBytes)}-byte reply budget stay fixed.`,
          "decode_timeout_ms",
        ),
      },
    );
  }

  /** Current ownership, independent of historical cleanup diagnostics. */
  get cleanupResources(): readonly string[] {
    return [
      ...(this.#supervisor === undefined ? [] : [this.#runId]),
      ...(this.#runtime === undefined ? [] : [this.#runtime.path]),
    ];
  }

  async close(): Promise<ProviderCleanupError | undefined> {
    const failures: string[] = [];
    let processReleased = this.#supervisor === undefined;
    if (this.#supervisor !== undefined) {
      const stopped = await this.#supervisor.stop();
      if (stopped.status === "incomplete") failures.push(stopped.reason);
      else {
        processReleased = true;
        this.#supervisor = undefined;
      }
    }
    if (processReleased && this.#runtime !== undefined) {
      try {
        await this.#runtime.close();
        this.#runtime = undefined;
      } catch (cause: unknown) {
        failures.push(message(cause));
      }
    }
    if (failures.length === 0) {
      this.#cleanupAnchor?.resolveCleanup();
      this.#cleanupAnchor = undefined;
      return undefined;
    }
    const failure = new SourceMapCleanupFailure(this.cleanupResources, {
      map_path: this.path,
      cleanup_failures: failures,
      codec_pid: this.#supervisor?.launch.process.pid ?? null,
    }).bindCleanupResourceOwner(this);
    if (this.#cleanupAnchor === undefined) this.#cleanupAnchor = failure;
    else failure.bindCleanupDependencies([this.#cleanupAnchor], this);
    return failure;
  }
}
const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
