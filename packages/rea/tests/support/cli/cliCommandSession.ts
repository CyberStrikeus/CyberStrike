import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { waitForExit } from "../process/processFixture.js";
import {
  createCliSessionFrameReader,
  encodeCliSessionFrame,
} from "./cliCommandSessionFrames.mjs";

const workerPath = fileURLToPath(
  new URL("./cliCommandSessionWorker.mjs", import.meta.url),
);
const SHUTDOWN_GRACE_MS = 1_000;
/** Restart after this many commands so one file cannot retain every heap. */
const COMMAND_REUSE_LIMIT = 32;
/** Restart when the worker reports a resident set at least this large. */
const RESIDENT_REUSE_LIMIT_BYTES = 1024 * 1024 * 1024;

const responseSchema = z.object({
  ready: z.boolean().optional(),
  id: z.number().optional(),
  exitCode: z.number().nullable().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  pid: z.number().optional(),
  rss: z.number().finite().nonnegative().optional(),
  fatal: z.boolean().optional(),
});

/** One compiled CLI command sent to the shared process. */
export interface CliCommandRequest {
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
}

/** Captured result from one shared CLI command. */
export interface CliCommandResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly json: unknown | undefined;
}

/** File-scoped compiled CLI process. */
export interface CliCommandSession {
  run(request: CliCommandRequest): Promise<CliCommandResult>;
  /** PID of the live process, when one is running. */
  processId(): number | undefined;
  close(): Promise<void>;
}

interface CliCommandSessionDependencies {
  readonly spawnWorker?: (
    environment: Readonly<Record<string, string>>,
  ) => ChildProcessWithoutNullStreams;
  /** Commands served by one process before the next command starts a new one. */
  readonly commandLimit?: number;
  /** Resident-set bytes, reported by the worker, that start a new process. */
  readonly residentLimitBytes?: number;
  /** Optional caller-selected startup and command deadlines; unset by default. */
  readonly startTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  /** Grace for EOF cleanup and each signal before escalation. */
  readonly shutdownGraceMs?: number;
}

interface PendingCommand {
  readonly id: number;
  readonly resolve: (result: CliCommandResult) => void;
  readonly reject: (error: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout> | undefined;
}

interface RetiredWorker {
  readonly child: ChildProcessWithoutNullStreams;
  attempt: Promise<void> | undefined;
}

type SessionResponse = z.infer<typeof responseSchema>;

const closedError = (): Error => new Error("Shared CLI session is closed");

const positiveLimit = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;

const selectedTimeout = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;

const envKey = (environment: Readonly<Record<string, string>>): string =>
  JSON.stringify(
    Object.keys(environment)
      .sort()
      .map((key) => [key, environment[key]]),
  );

const parseCliStdout = (stdout: string): unknown | undefined => {
  const document = stdout.trim();
  if (document.length === 0) return undefined;
  try {
    return JSON.parse(document) as unknown;
  } catch {
    return undefined;
  }
};

const signalChild = (
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void => {
  try {
    child.kill(signal);
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "ESRCH") throw error;
  }
};

const stopChild = async (
  child: ChildProcessWithoutNullStreams,
  graceMs: number,
): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  // EOF lets the worker await closeCliResources before exiting.
  if (!child.stdin.writableEnded) child.stdin.end();
  if (await waitForExit(child, graceMs)) return;
  signalChild(child, "SIGTERM");
  if (await waitForExit(child, graceMs)) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalChild(child, "SIGKILL");
  if (await waitForExit(child, graceMs)) return;
  throw new Error(
    `shared CLI process ${String(child.pid)} did not exit after SIGKILL`,
  );
};

const commandResult = (message: SessionResponse): CliCommandResult => ({
  exitCode: message.exitCode ?? null,
  signal: null,
  stdout: message.stdout ?? "",
  stderr: message.stderr ?? "",
  json: parseCliStdout(message.stdout ?? ""),
});

const writeChild = (
  child: ChildProcessWithoutNullStreams,
  frame: Buffer,
): Promise<void> =>
  new Promise((resolve, reject) => {
    child.stdin.write(frame, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });

const defaultSpawnWorker = (
  environment: Readonly<Record<string, string>>,
): ChildProcessWithoutNullStreams =>
  spawn(process.execPath, [workerPath], {
    cwd: process.cwd(),
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });

class SharedCliProcess implements CliCommandSession {
  readonly #spawnWorker: (
    environment: Readonly<Record<string, string>>,
  ) => ChildProcessWithoutNullStreams;

  readonly #commandLimit: number;
  readonly #residentLimitBytes: number;
  readonly #startTimeoutMs: number | undefined;
  readonly #requestTimeoutMs: number | undefined;
  readonly #shutdownGraceMs: number;
  #child: ChildProcessWithoutNullStreams | undefined;
  #childEnvKey: string | undefined;
  #commands = 0;
  #residentBytes: number | undefined;
  #retiring: RetiredWorker | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;
  #starting: Promise<void> | undefined;
  #nextId = 1;
  #pending: PendingCommand | undefined;
  #resolveReady: (() => void) | undefined;
  #rejectReady: ((error: unknown) => void) | undefined;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(dependencies: CliCommandSessionDependencies) {
    this.#spawnWorker = dependencies.spawnWorker ?? defaultSpawnWorker;
    this.#commandLimit = positiveLimit(
      dependencies.commandLimit,
      COMMAND_REUSE_LIMIT,
    );
    this.#residentLimitBytes = positiveLimit(
      dependencies.residentLimitBytes,
      RESIDENT_REUSE_LIMIT_BYTES,
    );
    this.#startTimeoutMs = selectedTimeout(dependencies.startTimeoutMs);
    this.#requestTimeoutMs = selectedTimeout(dependencies.requestTimeoutMs);
    this.#shutdownGraceMs = positiveLimit(
      dependencies.shutdownGraceMs,
      SHUTDOWN_GRACE_MS,
    );
  }

  run(request: CliCommandRequest): Promise<CliCommandResult> {
    const result = this.#queue.then(() => this.#invoke(request));
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  processId(): number | undefined {
    const child = this.#child;
    if (
      child === undefined ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      return undefined;
    }
    return child.pid;
  }

  close(): Promise<void> {
    this.#closed = true;
    if (this.#closing !== undefined) return this.#closing;
    let attempt: Promise<void>;
    attempt = this.#shutdown().catch((error: unknown) => {
      if (this.#closing === attempt) this.#closing = undefined;
      throw error;
    });
    this.#closing = attempt;
    return attempt;
  }

  async #shutdown(): Promise<void> {
    const pendingStart = this.#starting;
    this.#failReady(closedError());
    this.#failPending(closedError());
    const owner = this.#child;
    if (owner !== undefined) this.#retire(owner);
    await this.#finishRetirement();
    if (pendingStart !== undefined) await pendingStart.catch(() => undefined);
  }

  async #invoke(request: CliCommandRequest): Promise<CliCommandResult> {
    if (this.#closed) throw closedError();
    await this.#finishRetirement();
    const current = this.#child;
    if (
      !this.#reusable(current, envKey(request.environment)) &&
      current !== undefined
    ) {
      this.#retire(current);
      await this.#finishRetirement();
    }
    if (this.#closed) throw closedError();
    let result: CliCommandResult;
    try {
      if (this.#child === undefined) await this.#start(request.environment);
      result = await this.#run(request);
    } catch (primary) {
      try {
        await this.#finishRetirement();
      } catch (cleanup) {
        const primaryReason =
          primary instanceof Error ? primary.message : String(primary);
        const cleanupReason =
          cleanup instanceof Error ? cleanup.message : String(cleanup);
        throw new AggregateError(
          [primary, cleanup],
          `${primaryReason}; shared CLI cleanup failed: ${cleanupReason}`,
          { cause: primary },
        );
      }
      throw primary;
    }
    await this.#finishRetirement();
    return result;
  }

  async #run(request: CliCommandRequest): Promise<CliCommandResult> {
    const owner = this.#child;
    if (this.#closed || owner === undefined) throw closedError();
    const id = this.#nextId;
    this.#nextId += 1;
    const result = new Promise<CliCommandResult>((resolve, reject) => {
      const timer =
        this.#requestTimeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              this.#failTransport(
                owner,
                new Error(
                  `Shared CLI command did not respond within ${String(this.#requestTimeoutMs)} ms`,
                ),
              );
            }, this.#requestTimeoutMs);
      timer?.unref();
      this.#pending = { id, resolve, reject, timer };
    });
    try {
      void writeChild(
        owner,
        encodeCliSessionFrame({
          id,
          arguments: request.arguments,
          cwd: request.cwd,
          env: request.environment,
        }),
      ).catch((error: unknown) => {
        this.#failTransport(owner, error);
      });
    } catch (error) {
      this.#failTransport(owner, error);
    }
    return await result;
  }

  async #finishRetirement(): Promise<void> {
    const retiring = this.#retiring;
    if (retiring === undefined) return;
    retiring.attempt ??= stopChild(
      retiring.child,
      this.#shutdownGraceMs,
    ).finally(() => {
      retiring.attempt = undefined;
    });
    await retiring.attempt;
    if (this.#retiring === retiring) this.#retiring = undefined;
  }

  #reusable(
    current: ChildProcessWithoutNullStreams | undefined,
    key: string,
  ): current is ChildProcessWithoutNullStreams {
    if (
      current === undefined ||
      current.exitCode !== null ||
      current.signalCode !== null ||
      this.#childEnvKey !== key
    ) {
      return false;
    }
    if (this.#commands >= this.#commandLimit) return false;
    return !(
      this.#residentBytes !== undefined &&
      this.#residentBytes >= this.#residentLimitBytes
    );
  }

  #start(environment: Readonly<Record<string, string>>): Promise<void> {
    if (this.#closed) return Promise.reject(closedError());
    const started = this.#spawnWorker(environment);
    this.#child = started;
    this.#childEnvKey = envKey(environment);
    this.#commands = 0;
    this.#residentBytes = undefined;
    const ready = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    this.#starting = ready;
    const timer =
      this.#startTimeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            this.#failTransport(
              started,
              new Error(
                `Shared CLI worker did not become ready within ${String(this.#startTimeoutMs)} ms`,
              ),
            );
          }, this.#startTimeoutMs);
    timer?.unref();
    this.#watch(started);
    if (this.#closed) {
      this.#failReady(closedError());
      this.#retire(started);
    }
    return ready.finally(() => {
      clearTimeout(timer);
      if (this.#starting === ready) this.#starting = undefined;
    });
  }

  #watch(started: ChildProcessWithoutNullStreams): void {
    const reader = createCliSessionFrameReader((frame) => {
      this.#onFrame(started, frame);
    });
    started.stdout.on("data", (chunk: Buffer) => {
      try {
        reader(chunk);
      } catch (error) {
        this.#failTransport(started, error);
      }
    });
    started.stderr.resume();
    started.stdin.on("error", (error) => {
      this.#failTransport(started, error);
    });
    started.once("error", (error) => {
      this.#failTransport(started, error);
    });
    started.once("close", (code, signal) => {
      this.#onClose(started, code, signal);
    });
  }

  #onFrame(owner: ChildProcessWithoutNullStreams, value: unknown): void {
    if (this.#child !== owner || this.#closed) return;
    const parsed = responseSchema.safeParse(value);
    if (!parsed.success) {
      this.#failTransport(
        owner,
        new Error("CLI session response was not a command result"),
      );
      return;
    }
    const message = parsed.data;
    if (message.ready === true && message.id === undefined) {
      const resolve = this.#resolveReady;
      this.#resolveReady = undefined;
      this.#rejectReady = undefined;
      resolve?.();
      return;
    }
    const current = this.#pending;
    if (current === undefined || message.id !== current.id) {
      this.#failTransport(
        owner,
        new Error("CLI session response did not match the command"),
      );
      return;
    }
    if (message.exitCode === undefined) {
      this.#failTransport(
        owner,
        new Error("CLI session response omitted its exit code"),
      );
      return;
    }
    this.#pending = undefined;
    clearTimeout(current.timer);
    if (message.fatal === true) {
      this.#retire(owner);
    } else {
      this.#commands += 1;
      if (message.rss !== undefined) this.#residentBytes = message.rss;
    }
    current.resolve(commandResult(message));
  }

  #retire(owner: ChildProcessWithoutNullStreams): void {
    if (this.#child === owner) {
      this.#child = undefined;
      this.#childEnvKey = undefined;
    }
    this.#commands = 0;
    this.#residentBytes = undefined;
    this.#retiring ??= { child: owner, attempt: undefined };
  }

  #onClose(
    owner: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.#child !== owner) return;
    this.#child = undefined;
    this.#childEnvKey = undefined;
    const error = this.#closed
      ? closedError()
      : new Error(
          `Shared CLI process exited (${String(code ?? signal ?? "unknown")})`,
        );
    this.#failReady(error);
    this.#failPending(error);
  }

  #failTransport(owner: ChildProcessWithoutNullStreams, error: unknown): void {
    if (this.#child !== owner) return;
    this.#failReady(error);
    this.#failPending(error);
    // Clear the worker before the queued command runs. SIGTERM does not set
    // signalCode until the process actually exits, so #reusable would still
    // accept this process and write into it.
    this.#retire(owner);
  }

  #failPending(error: unknown): void {
    const current = this.#pending;
    this.#pending = undefined;
    clearTimeout(current?.timer);
    current?.reject(error);
  }

  #failReady(error: unknown): void {
    const reject = this.#rejectReady;
    this.#resolveReady = undefined;
    this.#rejectReady = undefined;
    reject?.(error);
  }
}

/**
 * Keep one compiled CLI process for commands that share an environment.
 * The process restarts after its command limit, after a reported resident-set
 * limit, when the environment changes, or when a command fails fatally.
 */
export const createCliCommandSession = (
  dependencies: CliCommandSessionDependencies = {},
): CliCommandSession => new SharedCliProcess(dependencies);
