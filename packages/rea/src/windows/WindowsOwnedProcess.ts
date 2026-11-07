import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

import { z } from "zod";

import type { ProcessCleanupResult } from "../process/ProcessOwnership.js";
import { RuntimeControlUnavailableError } from "../process/RuntimeControlUnavailableError.js";
import {
  requireWindowsNativeAuthority,
  windowsHandleSchema,
  type WindowsNativeAuthority,
} from "./WindowsNativeLoader.js";

const launchSchema = z.strictObject({
  pid: z.int().positive().max(0xffff_ffff),
  handle: windowsHandleSchema,
  jobAssigned: z.literal(true),
  killOnOwnerClose: z.literal(true),
});
const pollSchema = z.strictObject({
  stdout: z.instanceof(Buffer),
  stderr: z.instanceof(Buffer),
  stdoutEnded: z.boolean(),
  stderrEnded: z.boolean(),
  exitCode: z.int().nonnegative().max(0xffff_ffff).nullable(),
  activeProcesses: z.int().nonnegative(),
});
// A commit-limited job reports its applied limit at launch and its
// notification state on every poll; an unlimited job reports neither.
const limitedPollSchema = pollSchema.extend({
  memoryLimitReached: z.boolean(),
  peakJobMemoryBytes: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

/** Optional native job controls for one owned Windows process tree. */
export interface WindowsOwnedProcessOptions {
  /** Open a writable protocol pipe; otherwise stdin is NUL. */
  readonly protocolStdin?: boolean;
  /** Job Object commit limit for the whole process tree, in bytes. */
  readonly memoryLimitBytes?: number;
  /** Verified native authority; defaults to the package-owned artifact. */
  readonly authority?: WindowsNativeAuthority;
}

/** Native job control that an admitted artifact may predate. */
export type WindowsNativeControl = "protocol-stdin" | "job-memory-limit";

const NATIVE_CONTROL_NAMES: Readonly<Record<WindowsNativeControl, string>> = {
  "protocol-stdin": "owned protocol stdin",
  "job-memory-limit": "Job Object memory limits",
};

/** A requested launch control is absent from the admitted native artifact. */
export class WindowsNativeControlUnavailableError extends RuntimeControlUnavailableError {
  readonly code = "windows-native-control-unavailable";

  constructor(readonly control: WindowsNativeControl) {
    super(
      `The bundled Windows native artifact does not support ${NATIVE_CONTROL_NAMES[control]}; use a matching current Windows x64 REA package.`,
      {
        remediationAction:
          "Install the matching current Windows x64 REA package; its native inspection must prove this control. REA does not launch without it, so retrying the unchanged installation will not succeed.",
      },
    );
    this.name = "WindowsNativeControlUnavailableError";
  }
}

/** Encode one ordinary Windows argv token using the CRT backslash rules. */
export const quoteWindowsProcessArgument = (value: string): string => {
  if (value.includes("\0"))
    throw new TypeError("Windows process argument contains NUL");
  return `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, "$1$1")}"`;
};

// Back off after a failed native poll instead of retrying at the idle cadence.
const POLL_RETRY_MS = 250;

/** Process events and streams backed by a retained native Job Object. */
export class WindowsOwnedProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable | null;
  readonly signalCode: NodeJS.Signals | null = null;
  exitCode: number | null = null;
  readonly pid: number;
  readonly #handle: object;
  readonly #authority: WindowsNativeAuthority;
  readonly #settled: Promise<void>;
  #settle: (() => void) | undefined;
  #closed = false;
  // Settlement was observed and stream teardown finished, but process_close
  // has not released every native handle. Later cleanup retries that close
  // alone; kill and poll still need the job or process handle.
  #releasePending = false;
  #failure: string | undefined;
  #timer: NodeJS.Timeout | undefined;
  #blockedWake: NodeJS.Timeout | undefined;
  readonly #blockedOutput = new Set<PassThrough>();
  #unreferenced = false;
  #cleanup: Promise<ProcessCleanupResult> | undefined;
  readonly #memoryLimitBytes: number | undefined;
  #memoryLimitReached = false;
  #peakJobMemoryBytes: number | undefined;
  #outputIncomplete = false;

  constructor(
    command: string,
    arguments_: readonly string[],
    cwd: string | undefined,
    environment: NodeJS.ProcessEnv,
    verbatim: boolean,
    options: WindowsOwnedProcessOptions = {},
  ) {
    super();
    const protocolStdin = options.protocolStdin === true;
    this.#memoryLimitBytes = options.memoryLimitBytes;
    this.#authority = options.authority ?? requireWindowsNativeAuthority();
    if (protocolStdin && this.#authority.inspection.protocolStdin !== true)
      throw new WindowsNativeControlUnavailableError("protocol-stdin");
    // A requested limit is never dropped: an artifact without the control
    // refuses the launch instead of starting an unlimited process.
    if (
      this.#memoryLimitBytes !== undefined &&
      this.#authority.inspection.jobMemoryLimit !== true
    )
      throw new WindowsNativeControlUnavailableError("job-memory-limit");
    const entries = Object.entries(environment)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => `${key}=${value}`);
    const line = [
      // cmd.exe parses its own command line rather than the CRT argv rules;
      // its executable token must match the native drive-path representation.
      quoteWindowsProcessArgument(command.replaceAll("/", "\\")),
      ...arguments_.map((value) =>
        verbatim ? value : quoteWindowsProcessArgument(value),
      ),
    ].join(" ");
    // Earlier artifacts accept only 4 or 5 arguments; keep that shape unless
    // a commit limit is requested.
    let controls: unknown[] = protocolStdin ? [true] : [];
    if (this.#memoryLimitBytes !== undefined)
      controls = [protocolStdin, this.#memoryLimitBytes];
    const spawned = this.#authority.call("process_spawn", [
      command,
      line,
      cwd ?? "",
      entries,
      ...controls,
    ]);
    const launched =
      this.#memoryLimitBytes === undefined
        ? launchSchema.parse(spawned)
        : launchSchema
            .extend({ jobMemoryLimitBytes: z.literal(this.#memoryLimitBytes) })
            .parse(spawned);
    this.pid = launched.pid;
    this.#handle = launched.handle;
    this.stdin = protocolStdin
      ? new Writable({
          write: (chunk: unknown, _encoding, callback) => {
            void this.#writeInput(chunk).then(
              () => callback(),
              (cause: unknown) =>
                callback(
                  cause instanceof Error ? cause : new Error(String(cause)),
                ),
            );
          },
          final: (callback) => {
            try {
              this.#authority.call("process_stdin_close", [this.#handle]);
              callback();
            } catch (cause: unknown) {
              callback(
                cause instanceof Error ? cause : new Error(String(cause)),
              );
            }
          },
          destroy: (cause, callback) => {
            try {
              if (!this.#closed)
                this.#authority.call("process_stdin_close", [this.#handle]);
              callback(cause);
            } catch (failure: unknown) {
              callback(
                failure instanceof Error ? failure : new Error(String(failure)),
              );
            }
          },
        })
      : null;
    this.#settled = new Promise((resolve) => {
      this.#settle = resolve;
    });
    this.#schedule();
  }

  /** Whether the job reported reaching its commit limit; sticky once observed. */
  get memoryLimitReached(): boolean {
    return this.#memoryLimitReached;
  }

  /** Latest observed peak job commit; undefined for an unlimited job. */
  get peakJobMemoryBytes(): number | undefined {
    return this.#peakJobMemoryBytes;
  }

  /** True when cleanup destroyed a backpressured stream before all output was observed. */
  get outputIncomplete(): boolean {
    return this.#outputIncomplete;
  }

  async #writeInput(chunk: unknown): Promise<void> {
    const bytes = z.instanceof(Buffer).parse(chunk);
    const written = z
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .parse(
        await this.#authority.call("process_stdin_write", [
          this.#handle,
          bytes,
        ]),
      );
    if (written !== bytes.length)
      throw new Error(
        "Owned Windows input write did not preserve all requested bytes",
      );
  }

  /** Terminate the retained job, never a PID supplied by another caller. */
  kill(signal?: NodeJS.Signals | number): boolean {
    if (signal === 0)
      return (
        !this.#closed &&
        z
          .number()
          .parse(this.#authority.call("process_alive", [this.#handle])) > 0
      );
    return this.#closed
      ? false
      : z
          .boolean()
          .parse(this.#authority.call("process_terminate", [this.#handle]));
  }

  /** Terminate and verify that the entire job has settled before releasing it. */
  cleanup(): Promise<ProcessCleanupResult> {
    this.#cleanup ??= this.#stop().then((result) => {
      if (!result.cleaned) this.#cleanup = undefined;
      return result;
    });
    return this.#cleanup;
  }

  /** Release event-loop references so unsettled jobs do not prevent host exit. */
  unref(): void {
    this.#unreferenced = true;
    this.#timer?.unref();
    this.#blockedWake?.unref();
  }

  /** Restore event-loop references when retrying process lifecycle observation. */
  ref(): void {
    this.#unreferenced = false;
    this.#timer?.ref();
    this.#blockedWake?.ref();
  }

  async #stop(): Promise<ProcessCleanupResult> {
    if (this.#closed) return { cleaned: true, signaled: false };
    if (this.#releasePending) {
      try {
        this.#release();
        return { cleaned: true, signaled: false };
      } catch (cause: unknown) {
        return {
          cleaned: false,
          reason: cause instanceof Error ? cause.message : String(cause),
        };
      }
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const signaled = this.kill();
      this.#discardBlockedOutput();
      this.#schedule();
      const settled = await Promise.race([
        this.#settled.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 5_000);
        }),
      ]);
      return settled
        ? { cleaned: true, signaled }
        : {
            cleaned: false,
            reason:
              this.#failure ??
              "Windows Job Object did not settle within the cleanup deadline",
          };
    } catch (cause: unknown) {
      return {
        cleaned: false,
        reason: cause instanceof Error ? cause.message : String(cause),
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  #schedule(delay = 25): void {
    if (
      this.#closed ||
      this.#timer !== undefined ||
      this.#blockedOutput.size > 0
    )
      return;
    this.#timer = setTimeout(() => this.#poll(), delay);
    if (this.#unreferenced) this.#timer.unref();
  }

  #scheduleBlockedWake(): void {
    if (
      this.#closed ||
      this.#blockedOutput.size === 0 ||
      this.#blockedWake !== undefined
    )
      return;
    this.#blockedWake = setTimeout(() => {
      this.#blockedWake = undefined;
      this.#scheduleBlockedWake();
    }, 1_000);
    if (this.#unreferenced) this.#blockedWake.unref();
  }

  #clearBlockedWake(): void {
    if (this.#blockedWake !== undefined) clearTimeout(this.#blockedWake);
    this.#blockedWake = undefined;
  }

  #unblockOutput(stream: PassThrough): void {
    if (stream.destroyed) this.#outputIncomplete = true;
    this.#blockedOutput.delete(stream);
    if (this.#blockedOutput.size === 0) this.#clearBlockedWake();
    this.#schedule(0);
  }

  #discardBlockedOutput(): void {
    if (this.#blockedOutput.size > 0) this.#outputIncomplete = true;
    for (const stream of this.#blockedOutput) stream.destroy();
    this.#blockedOutput.clear();
    this.#clearBlockedWake();
  }

  #poll(): void {
    this.#timer = undefined;
    if (this.#closed) return;
    if (this.#releasePending) {
      try {
        this.#release();
      } catch (cause: unknown) {
        const failure =
          cause instanceof Error ? cause : new Error(String(cause));
        this.#failure = failure.message;
        if (this.listenerCount("error") > 0) this.emit("error", failure);
      }
      return;
    }
    try {
      const observed: unknown = this.#authority.call("process_poll", [
        this.#handle,
      ]);
      let state: z.output<typeof pollSchema>;
      if (this.#memoryLimitBytes === undefined)
        state = pollSchema.parse(observed);
      else {
        const limited = limitedPollSchema.parse(observed);
        // Recorded before exit is emitted, so exit listeners observe it.
        this.#memoryLimitReached ||= limited.memoryLimitReached;
        this.#peakJobMemoryBytes = limited.peakJobMemoryBytes;
        state = limited;
      }
      this.#failure = undefined;
      // Stop native reads while either consumer is backpressured. A slower
      // cadence still accumulates unbounded unread output in the parent heap.
      const idle = state.stdout.length === 0 && state.stderr.length === 0;
      this.#writeOutput(this.stdout, state.stdout);
      this.#writeOutput(this.stderr, state.stderr);
      if (state.exitCode !== null && this.exitCode === null) {
        this.exitCode = state.exitCode;
        this.emit("exit", state.exitCode, null);
      }
      if (
        state.exitCode !== null &&
        state.stdoutEnded &&
        state.stderrEnded &&
        state.activeProcesses === 0
      ) {
        this.#release();
      } else this.#schedule(idle ? 25 : 0);
    } catch (cause: unknown) {
      const failure = cause instanceof Error ? cause : new Error(String(cause));
      const repeated = this.#failure !== undefined;
      this.#failure = failure.message;
      // Native lifecycle failures belong to the error/cleanup channels, never
      // the captured stderr observation produced by the child itself. A run of
      // consecutive failures is reported once.
      if (!repeated && this.listenerCount("error") > 0)
        this.emit("error", failure);
      // Poll failures keep the job for another observation. Without one, a
      // single failed poll would stop output and exit delivery for the rest of
      // the process lifetime. A process_close failure leaves #releasePending so
      // cleanup retries that close alone.
      this.#schedule(POLL_RETRY_MS);
    }
  }

  #writeOutput(stream: PassThrough, bytes: Buffer): void {
    if (bytes.length === 0 || stream.writableEnded) return;
    if (stream.destroyed) {
      this.#outputIncomplete = true;
      return;
    }
    if (stream.write(bytes)) return;
    this.#blockedOutput.add(stream);
    const unblock = () => {
      stream.off("drain", unblock);
      stream.off("close", unblock);
      this.#unblockOutput(stream);
    };
    stream.once("drain", unblock);
    stream.once("close", unblock);
    this.#scheduleBlockedWake();
  }

  #release(): void {
    if (this.#closed) return;
    if (!this.#releasePending) {
      if (this.#timer !== undefined) clearTimeout(this.#timer);
      this.#timer = undefined;
      this.#clearBlockedWake();
      this.stdin?.destroy();
      if (!this.stdout.destroyed) this.stdout.end();
      if (!this.stderr.destroyed) this.stderr.end();
      this.#releasePending = true;
    }
    // Streams are already ended. A failed close retries this call alone.
    this.#authority.call("process_close", [this.#handle]);
    this.#releasePending = false;
    this.#closed = true;
    this.#settle?.();
    this.emit("close", this.exitCode, null);
  }
}
