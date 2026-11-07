import {
  spawn as nodeSpawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";

import { test as base } from "vitest";

const SHUTDOWN_GRACE_MS = 1_000;

/** Captured output and termination state from one child process. */
export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Options for a bounded, output-capturing child process invocation. */
export interface ProcessRunOptions extends SpawnOptionsWithoutStdio {
  readonly timeoutMs?: number;
  readonly input?: string | Uint8Array;
}

/** Registry for child processes owned by one test. */
export interface TestProcesses {
  spawn(
    command: string,
    arguments_: readonly string[],
    options?: SpawnOptionsWithoutStdio,
  ): ChildProcessWithoutNullStreams;
  run(
    command: string,
    arguments_: readonly string[],
    options?: ProcessRunOptions,
  ): Promise<ProcessResult>;
  shutdown(): Promise<void>;
}

/** Wait for a child process to exit within a timeout, reporting completion. */
export const waitForExit = (
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(false);
    }, timeoutMs);
    timer.unref();
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });

const stopChild = async (
  child: ChildProcessWithoutNullStreams,
): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  child.kill("SIGTERM");
  if (await waitForExit(child, SHUTDOWN_GRACE_MS)) return true;
  child.kill("SIGKILL");
  return waitForExit(child, SHUTDOWN_GRACE_MS);
};

/** Create a child-process registry for a fixture composition root. */
export const createTestProcessRegistry = (
  spawnChild: (
    command: string,
    arguments_: readonly string[],
    options: SpawnOptionsWithoutStdio,
  ) => ChildProcessWithoutNullStreams = nodeSpawn,
): TestProcesses => {
  const children = new Set<ChildProcessWithoutNullStreams>();

  const spawn = (
    command: string,
    arguments_: readonly string[],
    options: SpawnOptionsWithoutStdio = {},
  ): ChildProcessWithoutNullStreams => {
    const child = spawnChild(command, arguments_, {
      ...options,
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.add(child);
    child.once("exit", () => children.delete(child));
    child.once("close", () => children.delete(child));
    return child;
  };

  return {
    spawn,
    run: async (command, arguments_, options = {}) => {
      const { input, timeoutMs, ...spawnOptions } = options;
      const child = spawn(command, arguments_, spawnOptions);
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      if (input === undefined) child.stdin.end();
      else child.stdin.end(input);

      let timedOut = false;
      let killTimeout: NodeJS.Timeout | undefined;
      let closeTimeout: NodeJS.Timeout | undefined;
      let rejectUnclosed: ((error: Error) => void) | undefined;
      const captured = (): ProcessResult => ({
        exitCode: child.exitCode,
        signal: child.signalCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
      const timeoutFailure = (): Error =>
        new Error(`Test process exceeded its ${timeoutMs}ms deadline`, {
          cause: captured(),
        });
      const timeout =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true;
              if (child.exitCode === null && child.signalCode === null) {
                child.kill("SIGTERM");
              }
              killTimeout = setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) {
                  child.kill("SIGKILL");
                }
                closeTimeout = setTimeout(() => {
                  // An inherited output pipe may stay open after the leader exits.
                  rejectUnclosed?.(timeoutFailure());
                  child.stdout.destroy();
                  child.stderr.destroy();
                }, SHUTDOWN_GRACE_MS);
                closeTimeout.unref();
              }, SHUTDOWN_GRACE_MS);
              killTimeout.unref();
            }, timeoutMs);
      timeout?.unref();

      const result = await new Promise<ProcessResult>((resolve, reject) => {
        rejectUnclosed = reject;
        child.once("error", reject);
        child.once("close", (exitCode, signal) =>
          resolve({
            exitCode,
            signal,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
          }),
        );
      }).finally(() => {
        if (timeout !== undefined) clearTimeout(timeout);
        if (killTimeout !== undefined) clearTimeout(killTimeout);
        if (closeTimeout !== undefined) clearTimeout(closeTimeout);
      });
      if (timedOut) {
        throw new Error(`Test process exceeded its ${timeoutMs}ms deadline`, {
          cause: result,
        });
      }
      return result;
    },
    shutdown: async () => {
      const results = await Promise.allSettled(
        [...children].reverse().map(async (child) => {
          if (!(await stopChild(child))) {
            throw new Error(
              `test child process ${String(child.pid)} did not exit after SIGKILL`,
            );
          }
        }),
      );
      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (children.size > 0) {
        failures.push(
          new Error(`${children.size} test child process(es) leaked`),
        );
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          "Test child process shutdown failed",
        );
      }
    },
  };
};

/** Vitest API extended with a bounded child-process registry. */
export const processTest = base.extend<{ processes: TestProcesses }>({
  // oxlint-disable-next-line no-empty-pattern -- Vitest parses fixture dependencies from object destructuring.
  processes: async ({}, use) => {
    const processes = createTestProcessRegistry();
    try {
      await use(processes);
    } finally {
      await processes.shutdown();
    }
  },
});
