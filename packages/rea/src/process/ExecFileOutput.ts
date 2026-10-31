import type { AnalysisCapturedOutput } from "../domain/analysisErrorBase.js";
import {
  execFile,
  spawn,
  type ExecFileOptionsWithBufferEncoding,
} from "node:child_process";

type ExecFileOutputOptions = Omit<
  ExecFileOptionsWithBufferEncoding,
  "encoding" | "maxBuffer"
> & {
  readonly maxBuffer?: number;
  /**
   * Signal that stops the process on abort or timeout. The promise then
   * settles only after that process's stdio pipes close, so a caller can
   * remove files the command wrote. A descendant that inherited those pipes
   * keeps them open until it exits; destroying the readers is not
   * process-family completion and must not unblock this settlement. A process
   * still running after a grace period is killed. Without this signal, Node's
   * execFile sends SIGTERM on abort and rejects before the process exits.
   */
  readonly stopSignal?: NodeJS.Signals;
  /** Wait for inherited copies of an extra drained descriptor to close. Requires stopSignal. */
  readonly lifetimePipe?: boolean;
};

/** How long a stopped process may take to exit before it is killed. */
const STOP_GRACE_MS = 5_000;

/** Cancellation observed by the command owner, with the caller's exact reason. */
export class ExecFileOutputCancelledError extends Error {
  readonly _tag = "ExecFileOutputCancelledError";
  readonly code = "ABORT_ERR";

  constructor(reason: unknown) {
    super("The operation was aborted", { cause: reason });
    this.name = "AbortError";
  }
}

/**
 * A command stopped at its timeout can still exit cleanly, so the timeout is
 * the failure. Like Node's execFile timeout, it reports `killed: true`.
 */
const timeoutError = (
  command: string,
  timeout: number,
  exit: Error | null,
): Error => {
  const error = new Error(
    `Command timed out after ${String(timeout)} ms: ${command}`,
    exit === null ? undefined : { cause: exit },
  );
  Reflect.set(error, "code", "ETIMEDOUT");
  Reflect.set(error, "killed", true);
  Reflect.set(
    error,
    "signal",
    exit === null ? null : (Reflect.get(exit, "signal") ?? null),
  );
  return error;
};

/**
 * The `timeout` contract for both modes, checked before spawning. A stoppable
 * command keeps its own deadline, so execFile never validates it. Node 26's
 * execFile also caps it at Number.MAX_SAFE_INTEGER; Node 22 and 24 accept
 * larger integers, which their timers then clamp to 1 ms.
 */
const invalidTimeout = (timeout: number): RangeError | undefined => {
  if (Number.isSafeInteger(timeout) && timeout >= 0) return undefined;
  const error = new RangeError(
    `The value of "timeout" is out of range. It must be an unsigned integer. Received ${String(timeout)}`,
  );
  Reflect.set(error, "code", "ERR_OUT_OF_RANGE");
  return error;
};

/** Captured subprocess output read from an execFileOutput rejection. */
export interface ExecFileOutputFailure {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: string | number | null;
  readonly signal: string | null;
  readonly killed: boolean;
  readonly outputTruncated: boolean;
  readonly stdoutBytes?: number;
  readonly stderrBytes?: number;
  readonly collectionFailure?: boolean;
}

/** Read captured output metadata from a failed execFileOutput invocation. */
export const execFileOutputFailure = (
  cause: unknown,
): ExecFileOutputFailure | undefined => {
  if (!(cause instanceof Error)) return undefined;
  const stdout = Reflect.get(cause, "stdout");
  const stderr = Reflect.get(cause, "stderr");
  const code = Reflect.get(cause, "code");
  const signal = Reflect.get(cause, "signal");
  const killed = Reflect.get(cause, "killed");
  const outputTruncated = Reflect.get(cause, "outputTruncated");
  const stdoutBytes = Reflect.get(cause, "stdoutBytes");
  const stderrBytes = Reflect.get(cause, "stderrBytes");
  const collectionFailure = Reflect.get(cause, "collectionFailure");
  if (typeof stdout !== "string" || typeof stderr !== "string")
    return undefined;
  return {
    stdout,
    stderr,
    ...(typeof stdoutBytes === "number" &&
    Number.isSafeInteger(stdoutBytes) &&
    stdoutBytes >= 0
      ? { stdoutBytes }
      : {}),
    ...(typeof stderrBytes === "number" &&
    Number.isSafeInteger(stderrBytes) &&
    stderrBytes >= 0
      ? { stderrBytes }
      : {}),
    code: typeof code === "string" || typeof code === "number" ? code : null,
    signal: typeof signal === "string" ? signal : null,
    killed: killed === true,
    outputTruncated:
      outputTruncated === true || code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    ...(collectionFailure === true ? { collectionFailure: true } : {}),
  };
};

/** Project admitted command failure facts without reinterpreting failure policy. */
export const execFileFailureCapturedOutput = (
  failure: ExecFileOutputFailure,
): AnalysisCapturedOutput => ({
  stdout: failure.stdout,
  stderr: failure.stderr,
  ...(failure.stdoutBytes === undefined
    ? {}
    : { stdout_bytes: failure.stdoutBytes }),
  ...(failure.stderrBytes === undefined
    ? {}
    : { stderr_bytes: failure.stderrBytes }),
  exit_code: typeof failure.code === "number" ? failure.code : null,
  signal: failure.signal,
  truncated: failure.outputTruncated,
});

/** Run a shell-free command with no input while capturing its complete output bytes. */
export const execFileBytes = (
  command: string,
  arguments_: readonly string[],
  options: ExecFileOutputOptions = {},
): Promise<{ readonly stdout: Buffer; readonly stderr: Buffer }> =>
  new Promise((resolve, reject) => {
    const { stopSignal, signal, timeout, lifetimePipe, ...execOptions } =
      options;
    if (lifetimePipe === true && stopSignal === undefined) {
      reject(new TypeError("lifetimePipe requires stopSignal"));
      return;
    }
    const invalid = timeout === undefined ? undefined : invalidTimeout(timeout);
    if (invalid !== undefined) {
      reject(invalid);
      return;
    }
    if (stopSignal !== undefined && signal?.aborted === true) {
      reject(new ExecFileOutputCancelledError(signal.reason));
      return;
    }
    const complete = (
      error: Error | null,
      stdout: Buffer,
      stderr: Buffer,
    ): void => {
      if (error !== null) {
        Reflect.set(error, "stdout", stdout.toString("utf8"));
        Reflect.set(error, "stderr", stderr.toString("utf8"));
        Reflect.set(error, "stdoutBytes", stdout.byteLength);
        Reflect.set(error, "stderrBytes", stderr.byteLength);
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    };
    if (stopSignal === undefined) {
      const child = execFile(
        command,
        [...arguments_],
        {
          ...execOptions,
          ...(signal === undefined ? {} : { signal }),
          ...(timeout === undefined ? {} : { timeout }),
          encoding: "buffer",
          maxBuffer: options.maxBuffer ?? Number.POSITIVE_INFINITY,
        },
        (error, stdout, stderr) =>
          complete(
            error?.name === "AbortError" && error.code === "ABORT_ERR"
              ? new ExecFileOutputCancelledError(error.cause)
              : error,
            stdout,
            stderr,
          ),
      );
      // This promise API exposes no input writer; EOF belongs to the owner.
      child.stdin?.end();
      return;
    }
    startStoppableCommand(
      command,
      arguments_,
      { ...options, stopSignal },
      complete,
    );
  });

/** Own stop requests and bounded capture until the root and inherited pipes close. */
const startStoppableCommand = (
  command: string,
  arguments_: readonly string[],
  options: ExecFileOutputOptions & { readonly stopSignal: NodeJS.Signals },
  complete: (error: Error | null, stdout: Buffer, stderr: Buffer) => void,
): void => {
  const { stopSignal, signal, timeout, lifetimePipe, ...execOptions } = options;
  const maxBuffer = options.maxBuffer ?? Number.POSITIVE_INFINITY;
  if (typeof maxBuffer !== "number" || !(maxBuffer >= 0)) {
    const error = new RangeError("maxBuffer must be a nonnegative number");
    Reflect.set(error, "code", "ERR_OUT_OF_RANGE");
    throw error;
  }
  let stopped: "abort" | "timeout" | "output-limit" | undefined;
  let processError: Error | null = null;
  let rootFailed = false;
  let outputError: Error | undefined;
  let deadline: NodeJS.Timeout | undefined;
  let grace: NodeJS.Timeout | undefined;
  // Node's execFile destroys both pipes when maxBuffer is exceeded. Own
  // bounded capture here so overflow stops the root without discarding the
  // pipe lifetime of descendants still using caller-owned temporary files.
  const child = spawn(command, [...arguments_], {
    ...execOptions,
    stdio:
      lifetimePipe === true
        ? ["ignore", "pipe", "pipe", "pipe"]
        : ["ignore", "pipe", "pipe"],
    killSignal: stopSignal,
  });
  if (lifetimePipe === true) {
    const pipe = child.stdio[3];
    if (pipe != null && "resume" in pipe) pipe.resume();
  }
  // The first stop request names the failure; a later one is not resent.
  const stop = (reason: "abort" | "timeout" | "output-limit"): void => {
    if (stopped !== undefined || rootFailed || processError !== null) return;
    stopped = reason;
    child.kill(stopSignal);
    grace = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS);
  };
  const onAbort = (): void => {
    stop("abort");
  };
  const capture = (
    stream: NonNullable<typeof child.stdout>,
    name: "stdout" | "stderr",
  ) => {
    const chunks: Buffer[] = [];
    let retained = 0;
    stream.on("data", (chunk: Buffer) => {
      const remaining = Math.max(0, Math.floor(maxBuffer - retained));
      if (chunk.byteLength <= remaining) {
        chunks.push(chunk);
        retained += chunk.byteLength;
        return;
      }
      if (remaining > 0) {
        chunks.push(Buffer.from(chunk.subarray(0, remaining)));
        retained += remaining;
      }
      if (outputError === undefined) {
        outputError = new RangeError(`${name} maxBuffer length exceeded`);
        Reflect.set(outputError, "code", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
        stop("output-limit");
      }
    });
    return () => Buffer.concat(chunks, retained);
  };
  const stdout = capture(child.stdout!, "stdout");
  const stderr = capture(child.stderr!, "stderr");
  child.on("error", (error: Error) => {
    processError ??= error;
  });
  child.on("exit", (code, exitSignal) => {
    // A failed root has completed its outcome even while descendants retain
    // its pipes. Finalization cancellation cannot replace that failure.
    rootFailed = code !== 0 || exitSignal !== null;
  });
  child.on("close", (code, exitSignal) => {
    signal?.removeEventListener("abort", onAbort);
    clearTimeout(deadline);
    clearTimeout(grace);
    const out = stdout();
    const diagnostic = stderr();
    const invocation = [command, ...arguments_].join(" ");
    if (processError === null && (code !== 0 || exitSignal !== null)) {
      processError = new Error(
        `Command failed: ${invocation}\n${diagnostic.toString("utf8")}`,
      );
      Reflect.set(processError, "code", code);
      Reflect.set(processError, "signal", exitSignal);
      Reflect.set(processError, "killed", child.killed);
    }
    if (processError !== null) Reflect.set(processError, "cmd", invocation);
    if (outputError !== undefined) Reflect.set(outputError, "cmd", invocation);
    const failure =
      stopped === "abort" && signal !== undefined
        ? new ExecFileOutputCancelledError(signal.reason)
        : stopped === "timeout" && timeout !== undefined
          ? timeoutError(command, timeout, processError)
          : rootFailed && stopped === undefined
            ? processError
            : (outputError ?? processError);
    if (failure !== null && outputError !== undefined)
      Reflect.set(failure, "outputTruncated", true);
    complete(failure, out, diagnostic);
  });
  signal?.addEventListener("abort", onAbort, { once: true });
  if (timeout !== undefined && timeout > 0)
    deadline = setTimeout(() => {
      stop("timeout");
    }, timeout);
};

/** Run a shell-free command while capturing its complete UTF-8 output. */
export const execFileOutput = (
  command: string,
  arguments_: readonly string[],
  options: ExecFileOutputOptions = {},
): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
}> =>
  execFileBytes(command, arguments_, options).then(({ stdout, stderr }) => ({
    stdout: stdout.toString("utf8"),
    stderr: stderr.toString("utf8"),
    stdoutBytes: stdout.byteLength,
    stderrBytes: stderr.byteLength,
  }));
