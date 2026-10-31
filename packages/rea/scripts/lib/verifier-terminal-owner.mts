import { randomUUID } from "node:crypto";
import type { IDisposable, IPty } from "@lydell/node-pty";

import type { RetainedResourceScope } from "../../src/application/AnalysisProvider.js";
import { AnalysisCleanupLease } from "../../src/artifacts/AnalysisCleanupLease.js";
import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import { err, ok, type Result } from "../../src/domain/result.js";
import {
  cleanupOwnedProcessGroup,
  type PersistentOwnedProcessGroup,
} from "../../src/process/ProcessOwnership.js";
import { ProcessOwnershipEvidenceOwner } from "../../src/process/ProcessOwnershipEvidence.js";
import {
  prepareProcessOwnershipInspection,
  systemProcessOwnershipHost,
} from "../../src/process/ProcessOwnershipObservation.js";
import { PROCESS_CLEANUP_VERIFICATION_GRACE_MS } from "../../src/process/ProcessLifecycle.js";
import { ProviderStartupDeadline } from "../../src/process/ProviderDeadline.js";
import { processCaptureOwnershipUnavailableReason } from "../../src/process/capture/ProcessCaptureCapability.js";
import { retainOwnedCommandCleanup } from "../../src/providers/OwnedCommandCleanup.js";
import type {
  VerifierCleanupOwner,
  VerifierCommands,
} from "./verifier-command-owner.mjs";
import {
  closeVerifierResources,
  withVerifierCleanup,
} from "./verifier-cleanup.mjs";

export interface VerifierTerminalOptions {
  readonly commands: Pick<VerifierCommands, "adopt">;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  /** Capacity of the decoded text's UTF-8 representation, not raw PTY bytes. */
  readonly maxOutputBytes?: number;
  readonly onData?: (output: string, write: (data: string) => void) => void;
  readonly signal?: AbortSignal;
}

export interface VerifierTerminalDependencies {
  readonly loadPty?: () => Promise<typeof import("@lydell/node-pty")>;
  readonly cleanupProcessGroup?: typeof cleanupOwnedProcessGroup;
}

export interface VerifierTerminalResult {
  readonly output: string;
  readonly exitCode: number;
  readonly signal?: number;
}

type TerminalExit = Omit<VerifierTerminalResult, "output">;
type TerminalFailureReason =
  | "timeout"
  | "cancelled"
  | "output_limit"
  | "unsupported_platform";

/** Expected terminal failures retain the decoded output observed at failure. */
export class VerifierTerminalFailure extends Error {
  readonly _tag = "VerifierTerminalFailure";

  constructor(
    readonly reason: TerminalFailureReason,
    readonly output: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "VerifierTerminalFailure";
  }
}

/** The adopted owner remains the exact authority for retrying this release. */
export class VerifierTerminalCleanupFailure extends Error {
  readonly _tag = "VerifierTerminalCleanupFailure";
  readonly reason = "cleanup_incomplete";

  constructor(
    readonly cleanupOwner: VerifierCleanupOwner,
    readonly output: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "VerifierTerminalCleanupFailure";
  }
}

/** Select a code-point prefix before allocating its retained representation. */
const decodedPrefix = (text: string, capacity: number): string => {
  let end = 0;
  let bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > capacity) break;
    bytes += size;
    end += character.length;
  }
  return text.slice(0, end);
};

class VerifierTerminalOwner implements VerifierCleanupOwner {
  readonly #controller = new AbortController();
  readonly #runId = randomUUID();
  readonly #evidence = new ProcessOwnershipEvidenceOwner();
  readonly #preparationResources = new ArtifactResourceScope();
  readonly #resourceOwner: RetainedResourceScope = {
    run: (work) => this.#preparationResources.run(work),
    retain: (owner, resource) =>
      this.#preparationResources.retain({
        kind: "lease",
        resource,
        lease: AnalysisCleanupLease.forCloseOwner(owner, resource),
      }),
  };
  readonly #subscriptions = new Set<IDisposable>();
  readonly #maxOutputBytes: number;
  #output = "";
  #outputBytes = 0;
  #outputLimited = false;
  #terminal: IPty | undefined;
  #ownership: PersistentOwnedProcessGroup | undefined;
  #startup: Promise<Result<void, unknown>> | undefined;
  #releasePromise: Promise<void> | undefined;
  #groupReleased = false;
  #released = false;
  #settled = false;
  #cancelled: VerifierTerminalFailure | undefined;
  #deadline: ProviderStartupDeadline | undefined;
  #resolveCompletion!: (result: Result<TerminalExit, unknown>) => void;
  readonly #completion = new Promise<Result<TerminalExit, unknown>>(
    (resolve) => {
      this.#resolveCompletion = resolve;
    },
  );
  #resolveExit!: () => void;
  readonly #nativeExit = new Promise<void>((resolve) => {
    this.#resolveExit = resolve;
  });
  readonly #onAbort = (): void => {
    this.#cancel(this.options.signal?.reason);
  };
  readonly #onDeadlineAbort = (): void => {
    const deadline = this.#deadline;
    if (deadline === undefined) return;
    if (deadline.interruption === "timeout") {
      this.#finish(
        err(
          new VerifierTerminalFailure(
            "timeout",
            this.#output,
            `Verifier terminal timed out after ${String(this.options.timeoutMs)} ms`,
          ),
        ),
      );
      return;
    }
    this.#cancel(deadline.signal.reason);
  };

  constructor(
    private readonly options: VerifierTerminalOptions,
    private readonly dependencies: VerifierTerminalDependencies,
  ) {
    this.#maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
  }

  start(): void {
    // Adoption precedes even the first asynchronous preparation operation.
    this.#startup = Promise.resolve()
      .then(() => this.#acquire())
      .then(ok, (cause: unknown) => {
        // Retain behind the already adopted terminal owner, even while its
        // parent is closing. Startup cannot settle before transfer completes.
        retainOwnedCommandCleanup(
          cause,
          this.#resourceOwner,
          "package-verifier",
          this.options.command,
        );
        return err(cause);
      });
    this.options.signal?.addEventListener("abort", this.#onAbort, {
      once: true,
    });
    if (this.options.signal?.aborted === true) this.#onAbort();
  }

  async result(): Promise<Result<VerifierTerminalResult, unknown>> {
    const startup = await this.#startup;
    if (startup !== undefined && !startup.ok) return startup;
    const exit = await this.#completion;
    return exit.ok ? ok({ output: this.#output, ...exit.value }) : exit;
  }

  throwIfCancelled(): void {
    if (this.#cancelled !== undefined) throw this.#cancelled;
  }

  close(): Promise<void> {
    if (!this.#released)
      this.#cancel(new Error("Verifier terminal owner closed"));
    return this.release();
  }

  /** Normal finalization releases resources without cancelling its own run. */
  release(): Promise<void> {
    if (this.#released) return Promise.resolve();
    if (this.#releasePromise !== undefined) return this.#releasePromise;
    const attempt = Promise.resolve()
      .then(() => this.#release())
      .finally(() => {
        if (this.#releasePromise === attempt) this.#releasePromise = undefined;
      });
    this.#releasePromise = attempt;
    return attempt;
  }

  async #acquire(): Promise<void> {
    const { signal } = this.#controller;
    signal.throwIfAborted();
    await prepareProcessOwnershipInspection(signal);
    signal.throwIfAborted();
    const captureBaseline = systemProcessOwnershipHost.captureBaseline;
    if (captureBaseline === undefined)
      throw new Error("Process ownership baseline is unavailable on this host");
    const baseline = await captureBaseline(signal);
    signal.throwIfAborted();
    const { spawn } = await (
      this.dependencies.loadPty ?? (() => import("@lydell/node-pty"))
    )();
    signal.throwIfAborted();
    const terminal = spawn(this.options.command, [...this.options.args], {
      cwd: this.options.cwd,
      env: { ...this.options.environment, REA_PROCESS_RUN_ID: this.#runId },
      name: "xterm-256color",
      cols: 120,
      rows: 40,
    });
    this.#terminal = terminal;
    this.#ownership = {
      runId: this.#runId,
      leaderPid: terminal.pid,
      processGroupId: terminal.pid,
      expectedParentPid: process.pid,
      captureBaseline: baseline,
      sweepTokenOwnedProcesses: true,
      evidenceOwner: this.#evidence,
    };
    this.#subscriptions.add(
      terminal.onExit((exit) => {
        this.#resolveExit();
        this.#finish(ok(exit));
      }),
    );
    this.#subscriptions.add(terminal.onData((data) => this.#onData(data)));
    if (!this.#settled) {
      this.#deadline = new ProviderStartupDeadline(
        this.options.timeoutMs,
        this.#controller.signal,
      );
      this.#deadline.signal.addEventListener("abort", this.#onDeadlineAbort, {
        once: true,
      });
      if (this.#deadline.signal.aborted) this.#onDeadlineAbort();
    }
  }

  #onData(data: string): void {
    if (this.#outputLimited) return;
    const bytes = Buffer.byteLength(data, "utf8");
    const remaining = this.#maxOutputBytes - this.#outputBytes;
    if (bytes > remaining) {
      const prefix = decodedPrefix(data, remaining);
      this.#output += prefix;
      this.#outputBytes += Buffer.byteLength(prefix, "utf8");
      this.#outputLimited = true;
      this.#finish(
        err(
          new VerifierTerminalFailure(
            "output_limit",
            this.#output,
            `Verifier terminal decoded output exceeded ${String(this.#maxOutputBytes)} UTF-8 bytes`,
          ),
        ),
      );
      return;
    }
    this.#output += data;
    this.#outputBytes += bytes;
    if (this.#settled) return;
    try {
      this.options.onData?.(this.#output, (input) =>
        this.#terminal?.write(input),
      );
    } catch (cause: unknown) {
      this.#finish(err(cause));
    }
  }

  #finish(result: Result<TerminalExit, unknown>): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#disposeDeadline();
    this.#resolveCompletion(result);
  }

  #disposeDeadline(): void {
    this.#deadline?.signal.removeEventListener("abort", this.#onDeadlineAbort);
    this.#deadline?.dispose();
    this.#deadline = undefined;
  }

  #cancel(cause: unknown): void {
    if (this.#released || this.#cancelled !== undefined) return;
    this.#cancelled = new VerifierTerminalFailure(
      "cancelled",
      this.#output,
      "Verifier terminal was cancelled",
      { cause },
    );
    this.#controller.abort(this.#cancelled);
    this.#finish(err(this.#cancelled));
  }

  async #release(): Promise<void> {
    // Join acquisition, not result(): close itself may be what ends execution.
    await this.#startup;
    this.#disposeDeadline();
    const terminal = await this.#releaseTerminal().then(ok, err);
    const preparation = await this.#preparationResources.close().then(ok, err);
    if (!terminal.ok && !preparation.ok)
      throw new AggregateError(
        [terminal.error, preparation.error],
        "Verifier terminal and ownership preparation cleanup failed",
      );
    if (!terminal.ok) throw terminal.error;
    if (!preparation.ok) throw preparation.error;
    this.options.signal?.removeEventListener("abort", this.#onAbort);
    this.#released = true;
  }

  async #releaseTerminal(): Promise<void> {
    if (this.#ownership !== undefined && !this.#groupReleased) {
      const result = await (
        this.dependencies.cleanupProcessGroup ?? cleanupOwnedProcessGroup
      )(this.#ownership);
      if (!result.cleaned)
        throw new VerifierTerminalCleanupFailure(
          this,
          this.#output,
          result.reason,
          { cause: result },
        );
      this.#groupReleased = true;
    }
    if (this.#terminal !== undefined && !(await this.#waitForNativeExit()))
      throw new VerifierTerminalCleanupFailure(
        this,
        this.#output,
        "Verified process cleanup did not produce the native terminal exit event",
      );
    await closeVerifierResources(
      [...this.#subscriptions].map((subscription) => () => {
        subscription.dispose();
        this.#subscriptions.delete(subscription);
      }),
    );
  }

  async #waitForNativeExit(): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.#nativeExit.then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(
            () => resolve(false),
            PROCESS_CLEANUP_VERIFICATION_GRACE_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Run one native POSIX PTY through observed exit and retained family cleanup. */
export async function runOwnedVerifierTerminal(
  options: VerifierTerminalOptions,
  dependencies: VerifierTerminalDependencies = {},
): Promise<VerifierTerminalResult> {
  const unavailable = processCaptureOwnershipUnavailableReason(
    process.platform,
  );
  if (unavailable !== undefined)
    throw new VerifierTerminalFailure("unsupported_platform", "", unavailable);
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
    throw new RangeError(
      "Verifier terminal timeout must be positive and finite",
    );
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0)
    throw new RangeError(
      "Verifier terminal output capacity must be a non-negative safe integer",
    );
  const owner = new VerifierTerminalOwner(options, dependencies);
  options.commands.adopt(owner, `verifier terminal ${options.command}`);
  owner.start();
  let release: Promise<void> | undefined;
  const finish = (): Promise<void> => (release ??= owner.release());
  return withVerifierCleanup(async () => {
    const result = await owner.result();
    // Select late cancellation after finalization; composition reuses this exact
    // attempt, including its rejection, instead of invoking cleanup twice.
    await finish().then(ok, err);
    if (!result.ok) throw result.error;
    owner.throwIfCancelled();
    return result.value;
  }, [finish]);
}
