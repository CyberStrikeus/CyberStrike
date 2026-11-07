import type { ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";

/** Terminal states that can prevent Chrome from publishing a CDP port. */
export type BrowserStartupFailure =
  | "spawn-error"
  | "exited"
  | "signalled"
  | "timeout";

/** Safe diagnostics for a browser process that did not publish a CDP port. */
export class BrowserStartupError extends Error {
  readonly _tag = "BrowserStartupError" as const;
  readonly failure: BrowserStartupFailure;
  readonly executable: string;
  readonly elapsedMs: number;
  readonly startupTimeoutMs: number;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  readonly stderr: string;

  constructor(
    diagnostics: {
      readonly failure: BrowserStartupFailure;
      readonly executable: string;
      readonly elapsedMs: number;
      readonly startupTimeoutMs: number;
      readonly exitCode: number | null;
      readonly signalCode: NodeJS.Signals | null;
      readonly stderr: string;
    },
    options?: ErrorOptions,
  ) {
    super(browserStartupMessage(diagnostics.failure, diagnostics), options);
    this.failure = diagnostics.failure;
    this.executable = diagnostics.executable;
    this.elapsedMs = diagnostics.elapsedMs;
    this.startupTimeoutMs = diagnostics.startupTimeoutMs;
    this.exitCode = diagnostics.exitCode;
    this.signalCode = diagnostics.signalCode;
    this.stderr = diagnostics.stderr;
  }
}

/**
 * Single owner of the wait for Chrome to publish its DevToolsActivePort.
 *
 * Callers that need a different budget pass `timeoutMs`; nobody else should
 * restate this number, because a per-caller literal silently changes how long
 * a cold Chrome launch is tolerated before the failure names its ceiling.
 */
export const BROWSER_DEVTOOLS_STARTUP_TIMEOUT_MS = 60_000;

/** Owned child process and startup policy for Chrome CDP discovery. */
export interface BrowserStartupOptions {
  /** Caller retains process error handling through its complete resource lifetime. */
  readonly child: ChildProcess;
  readonly executable: string;
  readonly activePortPath: string;
  readonly stderr: () => string;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
}

/** Wait for Chrome's valid DevToolsActivePort or a terminal process outcome. */
export const waitForBrowserDevtoolsPort = async (
  options: BrowserStartupOptions,
): Promise<number> => {
  const timeoutMs = options.timeoutMs ?? BROWSER_DEVTOOLS_STARTUP_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  const startedAt = performance.now();
  const terminal = childTermination(options, startedAt, timeoutMs);
  const deadline = startedAt + timeoutMs;

  try {
    while (true) {
      const terminalState = currentTerminalState(options.child);
      if (terminalState !== null)
        throw startupError(options, startedAt, timeoutMs, terminalState);

      const port = await readDevtoolsPort(options.activePortPath);
      if (port !== null) return port;

      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0)
        throw startupError(options, startedAt, timeoutMs, {
          failure: "timeout",
        });

      const outcome = await Promise.race([
        terminal.outcome,
        delay(Math.min(pollIntervalMs, remainingMs)).then(() => null),
      ]);
      if (outcome !== null) throw outcome;
    }
  } finally {
    terminal.close();
  }
};

type TerminalState =
  | { readonly failure: "spawn-error"; readonly cause: unknown }
  | { readonly failure: "exited" }
  | { readonly failure: "signalled" }
  | { readonly failure: "timeout" };

const childTermination = (
  options: BrowserStartupOptions,
  startedAt: number,
  startupTimeoutMs: number,
): { readonly outcome: Promise<BrowserStartupError>; close(): void } => {
  let onError: (cause: unknown) => void;
  let onExit: () => void;
  const outcome = new Promise<BrowserStartupError>((resolve) => {
    onError = (cause: unknown) => {
      resolve(
        startupError(options, startedAt, startupTimeoutMs, {
          failure: "spawn-error",
          cause,
        }),
      );
    };
    onExit = () => {
      resolve(
        startupError(
          options,
          startedAt,
          startupTimeoutMs,
          options.child.signalCode === null
            ? { failure: "exited" }
            : { failure: "signalled" },
        ),
      );
    };
    options.child.once("error", onError);
    options.child.once("exit", onExit);
  });
  return {
    outcome,
    close: () => {
      options.child.off("error", onError);
      options.child.off("exit", onExit);
    },
  };
};

const currentTerminalState = (child: ChildProcess): TerminalState | null => {
  if (child.signalCode !== null) return { failure: "signalled" };
  if (child.exitCode !== null) return { failure: "exited" };
  return null;
};

const startupError = (
  options: BrowserStartupOptions,
  startedAt: number,
  startupTimeoutMs: number,
  state: TerminalState,
): BrowserStartupError =>
  new BrowserStartupError(
    {
      failure: state.failure,
      executable: options.executable,
      elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
      startupTimeoutMs,
      exitCode: options.child.exitCode,
      signalCode: options.child.signalCode,
      stderr: options.stderr(),
    },
    state.failure === "spawn-error" ? { cause: state.cause } : undefined,
  );

const readDevtoolsPort = async (path: string): Promise<number | null> => {
  try {
    const firstLine = (await readFile(path, "utf8")).trim().split("\n")[0];
    const port = Number(firstLine);
    return Number.isSafeInteger(port) && port > 0 && port <= 65_535
      ? port
      : null;
  } catch (cause: unknown) {
    // Missing or unreadable port files mean the port is unknown.
    void cause;
    return null;
  }
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const browserStartupMessage = (
  failure: BrowserStartupFailure,
  diagnostics: {
    readonly executable: string;
    readonly elapsedMs: number;
    readonly startupTimeoutMs: number;
    readonly exitCode: number | null;
    readonly signalCode: NodeJS.Signals | null;
    readonly stderr: string;
  },
): string =>
  `Chrome CDP startup ${failure}; executable=${diagnostics.executable}; elapsed_ms=${String(diagnostics.elapsedMs)}; timeoutMs=${String(diagnostics.startupTimeoutMs)} (DevToolsActivePort wait; omitted means ${String(BROWSER_DEVTOOLS_STARTUP_TIMEOUT_MS)} ms); exit_code=${diagnostics.exitCode === null ? "null" : String(diagnostics.exitCode)}; signal=${diagnostics.signalCode ?? "null"}; stderr=${diagnostics.stderr.length === 0 ? "<empty>" : diagnostics.stderr}`;
