import { ProcessAdmissionError } from "./ProcessAdmissionError.js";
import { spawn, type ChildProcess } from "node:child_process";
import type { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

import { WindowsOwnedProcess } from "../windows/WindowsOwnedProcess.js";

import {
  ProcessOutputTokenScanner,
  type ProviderProcessOutputToken,
} from "./ProcessOutputTokenScanner.js";

import type {
  OwnedProcessGroup,
  ProcessOwnershipBaseline,
  ProcessCleanupFailure,
  ProcessCleanupResult,
} from "./ProcessOwnership.js";
import {
  prepareProcessOwnershipInspection,
  systemProcessOwnershipHost,
} from "./ProcessOwnershipObservation.js";
import { ProcessOwnershipEvidenceOwner } from "./ProcessOwnershipEvidence.js";
import { mergeEnvironmentOverrides } from "./snapshotEnvironment.js";

const DEFAULT_TERMINATION_GRACE_MS = 250;
const DEFAULT_KILL_GRACE_MS = 1_000;
const OUTPUT_CLOSE_GRACE_MS = 1_000;
const MAX_LATE_OUTPUT_BYTES = 64 * 1024;

/** Spawn coordinates shared by owned, long-lived provider processes. */
export interface OwnedProviderProcessSpawnOptions {
  readonly command: string;
  readonly arguments: readonly string[];
  readonly runId: string;
  /** Null disables argv-prefix matching for interpreter-driven launch scripts. */
  readonly expectedCommand?: string | null;
  /** Preserve a pre-quoted Windows command-interpreter invocation exactly. */
  readonly windowsVerbatimArguments?: boolean;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Host platform used to choose detached process-group behavior. */
  readonly platform?: NodeJS.Platform;
  /** Host environment used as the base for the child environment. */
  readonly hostEnvironment?: NodeJS.ProcessEnv;
  /** Opt into a writable protocol stream; other providers retain ignored stdin. */
  readonly stdin?: "pipe";
  /**
   * Commit limit in bytes for the whole owned process tree, enforced by its
   * Windows Job Object. Other launchers cannot enforce it and refuse it.
   */
  readonly memoryLimitBytes?: number;
  /** Sweep exact run-token descendants during POSIX cleanup. */
  readonly sweepTokenOwnedProcesses?: boolean;
  /** Cancels native ownership preparation before provider process creation. */
  readonly signal?: AbortSignal;
}

/** Spawned process paired with the identity proof required for group cleanup. */
export interface SpawnedOwnedProviderProcess {
  readonly process: ProviderProcessHandle;
  readonly ownership: OwnedProcessGroup;
  readonly cleanup?: () => Promise<ProcessCleanupResult>;
}

/** Process events and streams required by provider lifecycle supervision. */
export interface ProviderProcessHandle extends Pick<
  EventEmitter,
  "on" | "once" | "off"
> {
  readonly pid?: number | undefined;
  readonly stdout: Readable | null;
  readonly stdin?: Writable | null;
  readonly stderr: Readable | null;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  /** True once an enforced process memory limit reported an allocation failure. */
  readonly memoryLimitReached?: boolean;
  /** True if a Windows backpressured stream was destroyed before output drained. */
  readonly outputIncomplete?: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
  unref?(): void;
  ref?(): void;
}

/** Process handle returned by a provider-specific launcher. */
export type ProviderProcessLaunch =
  | {
      readonly process: ProviderProcessHandle;
      readonly ownsProcessLifetime: false;
      readonly ownership?: never;
      readonly cleanup?: never;
    }
  | {
      readonly process: ProviderProcessHandle;
      readonly ownsProcessLifetime: true;
      readonly ownership?: OwnedProcessGroup;
      readonly cleanup?: () => Promise<ProcessCleanupResult>;
    };

/**
 * Process exit recorded by the supervisor.
 * Independent of retained stream diagnostics.
 */
export interface ProviderProcessExitObservation {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** Detached diagnostics captured for one supervised provider process. */
export interface ProviderProcessSnapshot {
  /** True when retained diagnostics omit bytes due to the budget or provider output loss. */
  readonly diagnosticTruncated?: boolean;
  readonly stdout: {
    readonly text: string;
    /** True when retained bytes cannot be represented exactly as UTF-8 text. */
    readonly invalidUtf8?: true;
    /** Bytes retained in text, limited by maxDiagnosticBytes when configured. */
    readonly bytes: number;
    /** All bytes drained from this stream since construction or resetOutput. */
    readonly observedBytes: number;
  };
  readonly stderr: {
    readonly text: string;
    /** True when retained bytes cannot be represented exactly as UTF-8 text. */
    readonly invalidUtf8?: true;
    /** Bytes retained in text, limited by maxDiagnosticBytes when configured. */
    readonly bytes: number;
    readonly observedBytes: number;
  };
  readonly exitCode: number | null | undefined;
  readonly signal: NodeJS.Signals | null | undefined;
  /** Present only when the process tree reached its enforced memory limit. */
  readonly memoryLimitReached?: true;
  /**
   * Present once this supervisor began stopping the process, before any signal
   * it sends. An exit signal observed without it did not come from the owner.
   */
  readonly stopRequested?: true;
  /** Present when a provider stream was destroyed before all bytes were observed. */
  readonly outputIncomplete?: true;
}

declare const processOutputCheckpointBrand: unique symbol;
/** Opaque cursor into one supervisor's raw, byte-counted output history. */
export interface ProviderProcessOutputCheckpoint {
  readonly [processOutputCheckpointBrand]: true;
}

/** Output produced after a checkpoint; incomplete when bytes were not retained or drained. */
export interface ProviderProcessOutputSince {
  readonly snapshot: ProviderProcessSnapshot;
  readonly complete: boolean;
  /**
   * Latest configured output marker per stream produced after the checkpoint,
   * observed from every drained byte regardless of the retention budget.
   */
  readonly markers?: readonly (ProviderProcessOutputToken & {
    readonly stream: "stdout" | "stderr";
  })[];
}

const outputCheckpoints = new WeakMap<
  ProviderProcessOutputCheckpoint,
  {
    readonly owner: ProviderProcessSupervisor;
    readonly epoch: number;
    readonly stdout: number;
    readonly stderr: number;
  }
>();

/** Resource-safe events emitted without imposing provider protocol semantics. */
export type ProviderProcessDiagnostic =
  | {
      readonly type: "output";
      readonly stream: "stdout" | "stderr";
      readonly bytes: number;
      readonly totalBytes: number;
      readonly truncated?: boolean;
    }
  | {
      readonly type: "exit";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly snapshot: ProviderProcessSnapshot;
    }
  | {
      readonly type: "output-close";
      readonly snapshot: ProviderProcessSnapshot;
    }
  | {
      readonly type: "error";
      readonly message: string;
      readonly cause?: Error;
    };

/** Aggregate byte budget, or independent retained stdout and stderr byte budgets. */
export type ProcessDiagnosticBudget =
  | number
  | { readonly stdout: number; readonly stderr: number };

/** Options for process lifecycle diagnostics. */
export interface ProviderProcessSupervisorOptions {
  /** Retain stdout for diagnostics; disable when it carries a parsed protocol. Defaults to true. */
  readonly captureStdout?: boolean;
  /** Retained output budget; overflow is drained and reported, not retained. */
  readonly maxDiagnosticBytes?: ProcessDiagnosticBudget;
  /**
   * Single-line token ending at a non-ASCII-word byte or EOF, located before retention
   * applies, so its latest occurrence survives an exhausted budget.
   */
  readonly outputToken?: string;
  readonly onDiagnostic?: (event: ProviderProcessDiagnostic) => void;
}

/** Optional result of provider-specific cleanup performed before stop. */
export interface ProviderProcessStopOptions {
  readonly cleanupResult?: ProcessCleanupResult;
  readonly terminationGraceMs?: number;
  readonly killGraceMs?: number;
}

/** Exact disposition of one owned process stop attempt. */
export type ProviderProcessStopResult =
  | {
      readonly status:
        | "not-owned"
        | "already-exited"
        | "verified-cleanup"
        | "terminated"
        | "killed";
    }
  | {
      readonly status: "incomplete";
      readonly reason: string;
      readonly cleanupResult?: ProcessCleanupFailure;
    };

const incompleteCleanup = (
  failure: ProcessCleanupFailure,
): ProviderProcessStopResult => ({
  status: "incomplete",
  reason: failure.reason,
  cleanupResult: failure,
});

/**
 * Spawn a provider in an owned Windows job or dedicated POSIX process group.
 *
 * The caller remains responsible for persisting any ownership manifest and for
 * selecting provider-specific command arguments or environment values.
 */
export const spawnOwnedProviderProcess = async (
  options: OwnedProviderProcessSpawnOptions,
): Promise<SpawnedOwnedProviderProcess> => {
  options.signal?.throwIfAborted();
  await prepareProcessOwnershipInspection(options.signal);
  options.signal?.throwIfAborted();
  const platform = options.platform ?? process.platform;
  const sweepTokenOwnedProcesses =
    options.sweepTokenOwnedProcesses === true && platform !== "win32";
  let captureBaseline: ProcessOwnershipBaseline | undefined;
  if (sweepTokenOwnedProcesses) {
    const capture = systemProcessOwnershipHost.captureBaseline;
    if (capture === undefined)
      throw new ProcessAdmissionError("baseline_unavailable");
    captureBaseline = await capture(options.signal);
    options.signal?.throwIfAborted();
  }
  const hostEnvironment = options.hostEnvironment ?? process.env;
  const selectedEnvironment = mergeEnvironmentOverrides(
    hostEnvironment,
    options.env ?? {},
    platform,
  );
  // Ownership is the final layer, including when a caller used another casing.
  // Resolve undefined overrides before the launchers omit unset variables.
  const environment = mergeEnvironmentOverrides(
    selectedEnvironment,
    { REA_PROCESS_RUN_ID: options.runId },
    platform,
  );
  if (platform === "win32" && process.platform === "win32") {
    const child = new WindowsOwnedProcess(
      options.command,
      options.arguments,
      options.cwd,
      environment,
      options.windowsVerbatimArguments ?? false,
      {
        protocolStdin: options.stdin === "pipe",
        ...(options.memoryLimitBytes === undefined
          ? {}
          : { memoryLimitBytes: options.memoryLimitBytes }),
      },
    );
    return {
      process: child,
      ownership: {
        runId: options.runId,
        leaderPid: child.pid,
        processGroupId: child.pid,
        expectedParentPid: process.pid,
      },
      cleanup: () => child.cleanup(),
    };
  }
  if (options.memoryLimitBytes !== undefined)
    throw new ProcessAdmissionError("memory_limit_unsupported");
  const child = spawn(options.command, [...options.arguments], {
    shell: false,
    windowsHide: true,
    stdio: [options.stdin ?? "ignore", "pipe", "pipe"],
    detached: platform !== "win32",
    windowsVerbatimArguments: options.windowsVerbatimArguments ?? false,
    env: environment,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  await waitForSpawn(child);
  const pid = child.pid;
  if (pid === undefined)
    throw new ProcessAdmissionError("launcher_pid_missing");
  const ownership: OwnedProcessGroup = {
    runId: options.runId,
    leaderPid: pid,
    processGroupId: pid,
    expectedParentPid: process.pid,
    evidenceOwner: new ProcessOwnershipEvidenceOwner(),
    ...(sweepTokenOwnedProcesses
      ? {
          sweepTokenOwnedProcesses: true,
          captureBaseline: captureBaseline!,
        }
      : {}),
    ...(options.expectedCommand === null
      ? {}
      : { expectedCommand: options.expectedCommand ?? options.command }),
  };
  return { process: child, ownership };
};

/**
 * Supervises only generic process resources; wire protocol remains adapter-owned.
 *
 * Output retention is complete per stream; adapters own resource budgets. Stop
 * first honors token-verified group cleanup when supplied, otherwise it uses a
 * bounded TERM-to-KILL escalation for a directly owned child.
 */
export class ProviderProcessSupervisor {
  readonly #options: ProviderProcessSupervisorOptions;
  readonly #stdout = new ProcessOutputCapture();
  readonly #stderr = new ProcessOutputCapture();
  readonly #exit = deferred<ProviderProcessExitObservation>();
  readonly #outputClose = deferred<void>();
  #outputClosed = false;
  #outputIncomplete = false;
  #stdoutObservedBytes = 0;
  #stderrObservedBytes = 0;
  #diagnosticTruncated = false;
  #stdoutMarker: ProcessOutputTokenScanner | undefined;
  #stderrMarker: ProcessOutputTokenScanner | undefined;
  readonly #onStdout = (chunk: Buffer | string): void => {
    this.#capture("stdout", this.#stdout, chunk);
  };
  readonly #onStderr = (chunk: Buffer | string): void => {
    this.#capture("stderr", this.#stderr, chunk);
  };
  readonly #onStdoutEnd = (): void => {
    this.#stdoutMarker?.finish();
  };
  readonly #onStderrEnd = (): void => {
    this.#stderrMarker?.finish();
  };
  readonly #onStdoutError = (cause: Error): void => {
    this.#recordStreamError("stdout", cause);
  };
  readonly #onStderrError = (cause: Error): void => {
    this.#recordStreamError("stderr", cause);
  };
  readonly #onExit = (
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void => {
    this.#recordExit(code, signal);
  };
  readonly #onClose = (
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void => {
    this.#recordExit(code, signal);
    this.#outputClosed = true;
    if (!this.#disposed)
      this.#options.onDiagnostic?.({
        type: "output-close",
        snapshot: this.snapshot(),
      });
    this.#outputClose.resolve(undefined);
  };
  readonly #onError = (cause: Error): void => {
    this.#options.onDiagnostic?.({
      type: "error",
      message: cause.message,
      cause,
    });
  };
  #exitObservation: ProviderProcessExitObservation | undefined;
  #stopPromise: Promise<ProviderProcessStopResult> | undefined;
  #stopRequested = false;
  #disposed = false;
  #maxAggregateDiagnosticBytes: number | undefined;
  readonly #maxStreamDiagnosticBytes:
    | Exclude<ProcessDiagnosticBudget, number>
    | undefined;
  #outputEpoch = 0;

  constructor(
    readonly launch: ProviderProcessLaunch,
    options: ProviderProcessSupervisorOptions = {},
  ) {
    this.#options = options;
    const budget = options.maxDiagnosticBytes;
    if (typeof budget === "number") this.#maxAggregateDiagnosticBytes = budget;
    else if (budget !== undefined)
      this.#maxStreamDiagnosticBytes = {
        stdout: budget.stdout,
        stderr: budget.stderr,
      };
    this.#resetMarkers();
    if (options.captureStdout !== false)
      this.#attach(launch.process.stdout, "stdout");
    this.#attach(launch.process.stderr, "stderr");
    launch.process.once("exit", this.#onExit);
    launch.process.once("close", this.#onClose);
    launch.process.on("error", this.#onError);
    if (launch.process.exitCode !== null || launch.process.signalCode !== null)
      this.#recordExit(launch.process.exitCode, launch.process.signalCode);
  }

  /**
   * Recorded process exit without concatenating retained stream diagnostics.
   * Undefined until exit or close is observed.
   */
  observedExit(): ProviderProcessExitObservation | undefined {
    const exit = this.#exitObservation;
    if (exit === undefined) return undefined;
    return { code: exit.code, signal: exit.signal };
  }

  /** Whether the process owner acknowledged output closure, separately from exit. */
  observedOutputClose(): boolean {
    return this.#outputClosed;
  }

  /** Latest retained output and exit observation, with explicit configured truncation. */
  snapshot(): ProviderProcessSnapshot {
    const outputIncomplete =
      this.#outputIncomplete || this.launch.process.outputIncomplete === true;
    return {
      ...(this.#diagnosticTruncated || outputIncomplete
        ? { diagnosticTruncated: true }
        : {}),
      stdout: this.#stdout.snapshot(this.#stdoutObservedBytes),
      stderr: this.#stderr.snapshot(this.#stderrObservedBytes),
      exitCode: this.#exitObservation?.code,
      signal: this.#exitObservation?.signal,
      ...(this.launch.process.memoryLimitReached === true
        ? { memoryLimitReached: true }
        : {}),
      ...(this.#stopRequested ? { stopRequested: true } : {}),
      ...(outputIncomplete ? { outputIncomplete: true } : {}),
    };
  }

  /** Mark the current raw-byte position without copying or retaining output. */
  checkpointOutput(): ProviderProcessOutputCheckpoint {
    const checkpoint = Object.freeze({}) as ProviderProcessOutputCheckpoint;
    outputCheckpoints.set(checkpoint, {
      owner: this,
      epoch: this.#outputEpoch,
      stdout: this.#stdoutObservedBytes,
      stderr: this.#stderrObservedBytes,
    });
    return checkpoint;
  }

  /** Snapshot only bytes produced after a valid checkpoint on this supervisor. */
  snapshotOutputSince(
    checkpoint: ProviderProcessOutputCheckpoint,
  ): ProviderProcessOutputSince {
    const position =
      typeof checkpoint === "object" && checkpoint !== null
        ? outputCheckpoints.get(checkpoint)
        : undefined;
    if (
      position === undefined ||
      position.owner !== this ||
      position.epoch !== this.#outputEpoch
    )
      return {
        snapshot: {
          stdout: { text: "", bytes: 0, observedBytes: 0 },
          stderr: { text: "", bytes: 0, observedBytes: 0 },
          exitCode: this.#exitObservation?.code,
          signal: this.#exitObservation?.signal,
          outputIncomplete: true,
          diagnosticTruncated: true,
        },
        complete: false,
      };
    const stdout = this.#stdout.snapshotRange(
      position.stdout,
      this.#stdoutObservedBytes,
    );
    const stderr = this.#stderr.snapshotRange(
      position.stderr,
      this.#stderrObservedBytes,
    );
    const incomplete =
      stdout.complete === false ||
      stderr.complete === false ||
      this.#outputIncomplete ||
      this.launch.process.outputIncomplete === true;
    return {
      snapshot: {
        ...(incomplete ? { diagnosticTruncated: true } : {}),
        stdout: stdout.stream,
        stderr: stderr.stream,
        exitCode: this.#exitObservation?.code,
        signal: this.#exitObservation?.signal,
        ...(this.launch.process.memoryLimitReached === true
          ? { memoryLimitReached: true }
          : {}),
        ...(incomplete ? { outputIncomplete: true } : {}),
      },
      complete: !incomplete,
      ...this.#markersWithin(position),
    };
  }

  #markersWithin(position: {
    readonly stdout: number;
    readonly stderr: number;
  }): Pick<ProviderProcessOutputSince, "markers"> {
    const stdout = this.#stdoutMarker?.latestWithin(
      position.stdout,
      this.#stdoutObservedBytes,
    );
    const stderr = this.#stderrMarker?.latestWithin(
      position.stderr,
      this.#stderrObservedBytes,
    );
    const markers = [
      ...(stdout === undefined
        ? []
        : [{ stream: "stdout" as const, ...stdout }]),
      ...(stderr === undefined
        ? []
        : [{ stream: "stderr" as const, ...stderr }]),
    ];
    return markers.length === 0 ? {} : { markers };
  }

  #resetMarkers(): void {
    const marker = this.#options.outputToken;
    this.#stdoutMarker =
      marker === undefined ? undefined : new ProcessOutputTokenScanner(marker);
    this.#stderrMarker =
      marker === undefined ? undefined : new ProcessOutputTokenScanner(marker);
  }

  /** Begin a new observation on a retained process without retaining earlier output. */
  resetOutput(): void {
    this.#outputEpoch += 1;
    this.#stdout.reset();
    this.#stderr.reset();
    this.#stdoutObservedBytes = 0;
    this.#stderrObservedBytes = 0;
    this.#diagnosticTruncated = false;
    this.#resetMarkers();
  }

  /** Wait for process exit up to a caller-owned bounded interval. */
  async waitForExit(timeoutMs: number): Promise<boolean> {
    return waitForProcessEvent(
      this.#exitObservation !== undefined,
      this.#exit.promise,
      timeoutMs,
    );
  }

  /** Wait until output streams close; omit the timeout to await physical completion.
   * WindowsOwnedProcess closes only after its whole Job Object settles.
   */
  async waitForOutputClose(
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return waitForProcessEvent(
      this.#outputClosed,
      this.#outputClose.promise,
      timeoutMs,
      signal,
    );
  }

  /** Bound additional retained bytes while still draining all later output. */
  limitAdditionalOutputBytes(maxBytes: number): void {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
      throw new RangeError(
        "Additional output limit must be a non-negative safe integer.",
      );
    const retained = this.#stdout.bytes + this.#stderr.bytes;
    const requestedLimit = Math.min(
      Number.MAX_SAFE_INTEGER,
      retained + maxBytes,
    );
    this.#maxAggregateDiagnosticBytes =
      this.#maxAggregateDiagnosticBytes === undefined
        ? requestedLimit
        : Math.min(this.#maxAggregateDiagnosticBytes, requestedLimit);
  }

  /** Unreference inherited output pipes without closing streams shared with descendants. */
  unrefOutputStreams(): void {
    for (const stream of [
      this.launch.process.stdout,
      this.launch.process.stderr,
    ]) {
      const unref = (stream as (Readable & { unref?: () => void }) | null)
        ?.unref;
      unref?.call(stream);
    }
  }

  /** Share each stop attempt; incomplete cleanup retains ownership and permits retry. */
  stop(
    options: ProviderProcessStopOptions = {},
  ): Promise<ProviderProcessStopResult> {
    this.#stopRequested = true;
    this.#stopPromise ??= this.#stop(options).then((result) => {
      if (result.status === "incomplete") this.#stopPromise = undefined;
      return result;
    });
    return this.#stopPromise;
  }

  /** Detach capture and process listeners after an adapter releases ownership. */
  dispose(): void {
    if (this.#disposed) return;
    // Releasing capture before close cannot establish a complete output history.
    if (!this.#outputClosed) this.#outputIncomplete = true;
    this.#disposed = true;
    this.launch.process.stdout?.off("data", this.#onStdout);
    this.launch.process.stdout?.off("error", this.#onStdoutError);
    this.launch.process.stdout?.off("end", this.#onStdoutEnd);
    this.launch.process.stderr?.off("data", this.#onStderr);
    this.launch.process.stderr?.off("error", this.#onStderrError);
    this.launch.process.stderr?.off("end", this.#onStderrEnd);
    this.launch.process.off("exit", this.#onExit);
    this.launch.process.off("close", this.#onClose);
    this.launch.process.off("error", this.#onError);
  }

  /** Release event-loop references so incomplete cleanup does not prevent host exit. */
  unref(): void {
    const process = this.launch.process;
    process.unref?.();
    (process.stdin as { unref?: () => void } | null | undefined)?.unref?.();
    (process.stdout as { unref?: () => void } | null | undefined)?.unref?.();
    (process.stderr as { unref?: () => void } | null | undefined)?.unref?.();
  }

  /** Restore event-loop references when retrying supervised process cleanup. */
  ref(): void {
    const process = this.launch.process;
    process.ref?.();
    (process.stdin as { ref?: () => void } | null | undefined)?.ref?.();
    (process.stdout as { ref?: () => void } | null | undefined)?.ref?.();
    (process.stderr as { ref?: () => void } | null | undefined)?.ref?.();
  }

  async #stop(
    options: ProviderProcessStopOptions,
  ): Promise<ProviderProcessStopResult> {
    if (this.launch.ownsProcessLifetime) {
      this.ref();
      // Bound retention throughout termination and failed cleanup, including retries.
      this.limitAdditionalOutputBytes(MAX_LATE_OUTPUT_BYTES);
    }
    let completed = false;
    try {
      const result = await this.#stopWithin(options);
      completed = result.status !== "incomplete";
      if (completed && result.status !== "not-owned" && !this.#outputClosed) {
        // Exit proves process lifetime only. Bound final retention while draining
        // inherited pipes; a lost output tail does not revoke verified cleanup.
        if (!(await this.waitForOutputClose(OUTPUT_CLOSE_GRACE_MS))) {
          this.#outputIncomplete = true;
          this.unref();
        }
      }
      if (!completed) this.unref();
      return result;
    } finally {
      if (completed) this.dispose();
    }
  }

  async #stopWithin(
    options: ProviderProcessStopOptions,
  ): Promise<ProviderProcessStopResult> {
    try {
      if (!this.launch.ownsProcessLifetime) return { status: "not-owned" };
      if (this.launch.cleanup !== undefined) {
        const graceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
        const exitObservedBeforeCleanup = this.#exitObservation !== undefined;
        const cleanup = await this.#ownedCleanup(options.cleanupResult);
        if (!cleanup.cleaned) {
          // Process tables can show the launcher mid-exit until verification
          // gives up. The supervisor's own exit observation is positive proof
          // that verification lacked, so verify again only after it arrives.
          if (exitObservedBeforeCleanup || !(await this.waitForExit(graceMs)))
            return incompleteCleanup(cleanup);
          const settled = await this.launch.cleanup();
          return settled.cleaned
            ? { status: "verified-cleanup" }
            : incompleteCleanup(settled);
        }
        if (await this.waitForExit(graceMs))
          return { status: "verified-cleanup" };
        const retried = await this.launch.cleanup();
        if (!retried.cleaned) return incompleteCleanup(retried);
        if (await this.waitForExit(graceMs))
          return { status: "verified-cleanup" };
        return {
          status: "incomplete",
          reason: "verified process-group cleanup did not stop the launcher",
        };
      }

      if (this.#exitObservation !== undefined)
        return { status: "already-exited" };

      this.#signal("SIGTERM");
      if (
        await this.waitForExit(
          options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
        )
      )
        return { status: "terminated" };
      this.#signal("SIGKILL");
      if (await this.waitForExit(options.killGraceMs ?? DEFAULT_KILL_GRACE_MS))
        return { status: "killed" };
      return {
        status: "incomplete",
        reason: "owned provider process did not exit after SIGKILL",
      };
    } catch (cause: unknown) {
      return {
        status: "incomplete",
        reason:
          cause instanceof Error
            ? cause.message
            : "owned provider process cleanup failed",
      };
    }
  }

  #ownedCleanup(
    supplied: ProcessCleanupResult | undefined,
  ): Promise<ProcessCleanupResult> {
    if (supplied !== undefined) return Promise.resolve(supplied);
    const cleanup = this.launch.cleanup;
    return cleanup === undefined
      ? Promise.resolve({
          cleaned: false,
          reason: "owned provider process has no cleanup capability",
        })
      : cleanup();
  }

  #signal(signal: NodeJS.Signals): void {
    if (this.#exitObservation !== undefined) return;
    this.launch.process.kill(signal);
  }

  #attach(stream: Readable | null, name: "stdout" | "stderr"): void {
    if (name === "stdout") {
      stream?.on("data", this.#onStdout);
      stream?.on("error", this.#onStdoutError);
      stream?.on("end", this.#onStdoutEnd);
    } else {
      stream?.on("data", this.#onStderr);
      stream?.on("error", this.#onStderrError);
      stream?.on("end", this.#onStderrEnd);
    }
  }

  #recordStreamError(stream: "stdout" | "stderr", cause: Error): void {
    this.#outputIncomplete = true;
    this.#options.onDiagnostic?.({
      type: "error",
      message: `${stream} stream failed: ${cause.message}`,
      cause,
    });
  }

  #capture(
    stream: "stdout" | "stderr",
    capture: ProcessOutputCapture,
    chunk: Buffer | string,
  ): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (stream === "stdout") {
      this.#stdoutMarker?.scan(bytes, this.#stdoutObservedBytes);
      this.#stdoutObservedBytes += bytes.byteLength;
    } else {
      this.#stderrMarker?.scan(bytes, this.#stderrObservedBytes);
      this.#stderrObservedBytes += bytes.byteLength;
    }
    const aggregateRemaining =
      this.#maxAggregateDiagnosticBytes === undefined
        ? bytes.byteLength
        : Math.max(
            0,
            this.#maxAggregateDiagnosticBytes -
              this.#stdout.bytes -
              this.#stderr.bytes,
          );
    const streamLimit = this.#maxStreamDiagnosticBytes?.[stream];
    const streamRemaining =
      streamLimit === undefined
        ? bytes.byteLength
        : Math.max(0, streamLimit - capture.bytes);
    const retained = Math.min(
      bytes.byteLength,
      aggregateRemaining,
      streamRemaining,
    );
    if (retained < bytes.byteLength) this.#diagnosticTruncated = true;
    if (retained > 0) capture.append(bytes.subarray(0, retained));
    this.#options.onDiagnostic?.({
      type: "output",
      stream,
      bytes: bytes.byteLength,
      totalBytes:
        stream === "stdout"
          ? this.#stdoutObservedBytes
          : this.#stderrObservedBytes,
      ...(retained < bytes.byteLength ? { truncated: true } : {}),
    });
  }

  #recordExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#exitObservation !== undefined) return;
    this.#exitObservation = { code, signal };
    this.#exit.resolve(this.#exitObservation);
    this.#options.onDiagnostic?.({
      type: "exit",
      code,
      signal,
      snapshot: this.snapshot(),
    });
  }
}

class ProcessOutputCapture {
  readonly #chunks: Buffer[] = [];
  #bytes = 0;

  get bytes(): number {
    return this.#bytes;
  }

  reset(): void {
    this.#chunks.length = 0;
    this.#bytes = 0;
  }

  append(chunk: Buffer): void {
    this.#bytes += chunk.byteLength;
    this.#chunks.push(Buffer.from(chunk));
  }

  snapshot(observedBytes: number): ProviderProcessSnapshot["stdout"] {
    return this.#snapshotBuffer(
      Buffer.concat(this.#chunks, this.#bytes),
      observedBytes,
    );
  }

  snapshotRange(
    start: number,
    end: number,
  ): { stream: ProviderProcessSnapshot["stdout"]; complete: boolean } {
    const availableEnd = Math.min(end, this.#bytes);
    const availableStart = Math.min(start, availableEnd);
    const chunks: Buffer[] = [];
    let offset = 0;
    for (const chunk of this.#chunks) {
      const chunkEnd = offset + chunk.byteLength;
      const from = Math.max(availableStart, offset);
      const to = Math.min(availableEnd, chunkEnd);
      if (to > from) chunks.push(chunk.subarray(from - offset, to - offset));
      offset = chunkEnd;
      if (offset >= availableEnd) break;
    }
    const buffer = Buffer.concat(chunks, availableEnd - availableStart);
    return {
      stream: this.#snapshotBuffer(buffer, Math.max(0, end - start)),
      complete: start === end || (start <= this.#bytes && end <= this.#bytes),
    };
  }

  #snapshotBuffer(
    buffer: Buffer,
    observedBytes: number,
  ): ProviderProcessSnapshot["stdout"] {
    const text = buffer.toString("utf8");
    let invalidUtf8 = false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      invalidUtf8 = true;
    }
    return {
      text,
      bytes: buffer.byteLength,
      observedBytes,
      ...(invalidUtf8 ? { invalidUtf8: true } : {}),
    };
  }
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

const deferred = <Value>(): Deferred<Value> => {
  let resolver: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolver = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      resolver?.(value);
    },
  };
};

const waitForSpawn = (child: ChildProcess): Promise<void> =>
  new Promise((resolve, reject) => {
    const onSpawn = (): void => {
      child.off("error", onError);
      resolve();
    };
    const onError = (cause: Error): void => {
      child.off("spawn", onSpawn);
      reject(cause);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });

const waitForProcessEvent = async (
  observed: boolean,
  event: Promise<unknown>,
  timeoutMs: number | undefined,
  signal?: AbortSignal,
): Promise<boolean> => {
  if (observed) return true;
  if (signal?.aborted === true) return false;
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      event.then(() => true),
      new Promise<boolean>((resolve) => {
        if (timeoutMs !== undefined)
          timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
        if (signal !== undefined) {
          onAbort = () => resolve(false);
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
  }
};
