import { ProcessAdmissionError } from "./ProcessAdmissionError.js";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import {
  DEFAULT_SWIFTC_COMPILE_TIMEOUT_MS,
  providerStartupTimeoutSchema,
} from "../config/providerStartupTimeout.js";
import { MAX_NODE_TIMER_DELAY_MS } from "../domain/analysisResourceLimits.js";
import { err, ok, type Result } from "../domain/result.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type {
  AnalysisCapturedOutput,
  AnalysisError,
} from "../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { safeParseJson } from "../domain/safeJson.js";
import { boundedUtf8Text } from "./boundedUtf8Text.js";
import { snapshotEnvironment } from "./snapshotEnvironment.js";
import {
  execFileOutput,
  execFileOutputFailure,
  execFileFailureCapturedOutput,
} from "./ExecFileOutput.js";
import type {
  ProcessIdentityObservation,
  ProcessRunTokenObservation,
  ProcessTableEntry,
} from "./ProcessOwnership.js";

const responseSchema = z.strictObject({
  results: z.array(
    z.discriminatedUnion("state", [
      z.strictObject({
        pid: z.int().positive(),
        state: z.literal("readable"),
        run_id: z.string().optional(),
        reason: z.null().optional(),
      }),
      z.strictObject({
        pid: z.int().positive(),
        state: z.literal("unavailable"),
        run_id: z.union([z.string(), z.null()]).optional(),
        reason: z.string().min(1),
      }),
    ]),
  ),
});
const identityResponseSchema = z.strictObject({
  results: z.array(
    z.discriminatedUnion("state", [
      z.strictObject({
        pid: z.int().positive(),
        state: z.literal("absent"),
        identity: z.null().optional(),
        reason: z.literal("not-in-snapshot"),
      }),
      z.strictObject({
        pid: z.int().positive(),
        state: z.literal("readable"),
        identity: z.string().min(1),
        effective_uid: z.int().nonnegative().optional(),
        lifecycle: z.enum(["non-zombie", "zombie"]).optional(),
        relation: z
          .strictObject({
            state: z.literal("observed"),
            parent_pid: z.int().nonnegative(),
            process_group_id: z.int().nonnegative(),
          })
          .optional(),
        reason: z.null().optional(),
      }),
      z.strictObject({
        pid: z.int().positive(),
        state: z.literal("unavailable"),
        identity: z.null().optional(),
        reason: z.string().min(1),
      }),
    ]),
  ),
});

const sourceFiles = [
  fileURLToPath(
    new URL(
      "../../bridge/process/ProcessRunTokenReader.swift",
      import.meta.url,
    ),
  ),
  fileURLToPath(
    new URL(
      "../../bridge/process/ProcessRunTokenReaderMain.swift",
      import.meta.url,
    ),
  ),
];

/**
 * swift-driver runs each frontend job in its own process group. On SIGINT it
 * stops those jobs and deletes their objects before exiting; on SIGTERM it
 * exits while a job can still write objects under TMPDIR.
 */
export const SWIFTC_INTERRUPT = "SIGINT";

/**
 * Resolve the Darwin ownership-helper compile deadline from an explicit option
 * or `REA_SWIFTC_COMPILE_TIMEOUT_MS`. The default matches the measured fresh
 * Swift SDK cache on the supported Intel macOS VM (about 88s), so compilation
 * stays bounded independently of short provider version probes. Invalid ambient
 * values fall back to the default; `parseConfig` still rejects them at CLI/MCP
 * admission. The resolved value is captured when the reader is created.
 * Production creates that reader from the launch environment at process start,
 * so a change applies after REA restarts, on the next ownership-helper compile.
 */
export const resolveSwiftcCompileTimeoutMs = (
  options: {
    readonly compileTimeoutMs?: number;
    readonly environment?: Readonly<Record<string, string | undefined>>;
  } = {},
): number => {
  if (options.compileTimeoutMs !== undefined) return options.compileTimeoutMs;
  const raw = (options.environment ?? process.env)
    .REA_SWIFTC_COMPILE_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_SWIFTC_COMPILE_TIMEOUT_MS;
  const parsed = providerStartupTimeoutSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SWIFTC_COMPILE_TIMEOUT_MS;
};

/** Name the existing swiftc deadline when a helper compile times out. */
export const swiftcCompileTimeoutRecovery = (timeoutMs: number): string =>
  `The effective REA_SWIFTC_COMPILE_TIMEOUT_MS value is ${String(timeoutMs)} ms (integer range 1..${String(MAX_NODE_TIMER_DELAY_MS)}; omitted default ${String(DEFAULT_SWIFTC_COMPILE_TIMEOUT_MS)} ms). Set it in the environment that starts REA and restart REA; the next ownership-helper compile uses the new value.`;

/** Bound on compiler diagnostics embedded in the inspection failure text. */
const STDERR_EXCERPT_LIMIT = 512;

/** The native Darwin process-ownership reader could not be prepared. */
export class DarwinProcessOwnershipInspectionError extends Error {
  readonly #cleanupOwner: { close(): Promise<void> } | undefined;
  get cleanupOwner(): { close(): Promise<void> } | undefined {
    return this.#cleanupOwner;
  }
  constructor(
    message: string,
    options?: ErrorOptions & {
      readonly compilerOutcome?: DarwinCompilerOutcome;
      readonly capturedOutput?: AnalysisCapturedOutput;
      readonly cleanupOwner?: { close(): Promise<void> } | undefined;
      readonly cleanupFailure?: AnalysisError;
      readonly cancellation?: { readonly reason: unknown };
    },
  ) {
    const {
      compilerOutcome,
      capturedOutput,
      cleanupFailure,
      cleanupOwner,
      cancellation,
      ...errorOptions
    } = options ?? {};
    super(message, errorOptions);
    this.name = "DarwinProcessOwnershipInspectionError";
    this.compilerOutcome = compilerOutcome;
    this.capturedOutput = capturedOutput;
    this.#cleanupOwner = cleanupOwner;
    this.cleanupFailure = cleanupFailure;
    this.cancellation = cancellation;
  }

  readonly compilerOutcome: DarwinCompilerOutcome | undefined;
  readonly capturedOutput: AnalysisCapturedOutput | undefined;
  readonly cleanupFailure: AnalysisError | undefined;
  readonly cancellation: { readonly reason: unknown } | undefined;

  /** Preserve the physical preparation failure while following the exact cleanup owner. */
  withCleanupFailure(
    cleanup: AnalysisError,
    owner?: { close(): Promise<void> },
  ): DarwinProcessOwnershipInspectionError {
    const combined =
      this.cleanupFailure === undefined || this.cleanupFailure === cleanup
        ? cleanup
        : analysisErrorWithCleanupFailure(
            this.cleanupFailure,
            cleanup,
          ).bindCleanupDependencies([this.cleanupFailure, cleanup]);
    return new DarwinProcessOwnershipInspectionError(this.message, {
      ...(Object.hasOwn(this, "cause") ? { cause: this.cause } : {}),
      ...(this.compilerOutcome === undefined
        ? {}
        : { compilerOutcome: this.compilerOutcome }),
      ...(this.capturedOutput === undefined
        ? {}
        : { capturedOutput: this.capturedOutput }),
      cleanupFailure: combined,
      cleanupOwner: owner ?? this.cleanupOwner,
      ...(this.cancellation === undefined
        ? {}
        : { cancellation: this.cancellation }),
    });
  }
}

/** Explicit, bounded outcome from compiling REA's Darwin ownership helper. */
export interface DarwinCompilerOutcome {
  readonly outcome:
    | "exited"
    | "signaled"
    | "timed_out"
    | "spawn_failed"
    | "failed";
  readonly code: string | number | null;
  readonly signal: string | null;
  readonly stderr: string;
  readonly stderrBytes?: number;
  readonly stderrTruncated: boolean;
  readonly outputTruncated: boolean;
  readonly killed: boolean;
  readonly timeoutMs?: number;
}

const MAX_COMPILER_OUTPUT_BYTES = 8 * 1024;

const compilerFailureFacts = (
  cause: unknown,
  timeoutMs: number,
):
  | {
      readonly outcome: DarwinCompilerOutcome;
      readonly capturedOutput: AnalysisCapturedOutput;
    }
  | undefined => {
  const failure = execFileOutputFailure(cause);
  if (failure === undefined) return undefined;
  const stderr = boundedUtf8Text(failure.stderr, MAX_COMPILER_OUTPUT_BYTES);
  const stdout = boundedUtf8Text(failure.stdout, MAX_COMPILER_OUTPUT_BYTES);
  const outcome =
    failure.code === "ETIMEDOUT"
      ? "timed_out"
      : typeof failure.code === "number"
        ? "exited"
        : failure.signal !== null
          ? "signaled"
          : failure.code === "ENOENT"
            ? "spawn_failed"
            : "failed";
  return {
    outcome: {
      outcome,
      code: failure.code,
      signal: failure.signal,
      stderr: stderr.text,
      ...(failure.stderrBytes === undefined
        ? {}
        : { stderrBytes: failure.stderrBytes }),
      stderrTruncated: stderr.truncated,
      outputTruncated: failure.outputTruncated,
      killed: failure.killed,
      ...(outcome === "timed_out" ? { timeoutMs } : {}),
    },
    capturedOutput: {
      ...execFileFailureCapturedOutput(failure),
      stdout: stdout.text,
      stderr: stderr.text,
      truncated:
        stdout.truncated || stderr.truncated || failure.outputTruncated,
    },
  };
};

const compilerOutcomeDescription = (
  outcome: DarwinCompilerOutcome | undefined,
  fallbackCode: string | number,
): string => {
  if (outcome === undefined) return `compiler result: ${String(fallbackCode)}`;
  if (outcome.outcome === "exited")
    return `compiler result: exit code ${String(outcome.code)}`;
  if (outcome.outcome === "timed_out") {
    if (outcome.timeoutMs === undefined)
      return "compiler result: timed out. The effective REA_SWIFTC_COMPILE_TIMEOUT_MS value was not reported.";
    return `compiler result: timed out after ${String(outcome.timeoutMs)} ms. ${swiftcCompileTimeoutRecovery(outcome.timeoutMs)}`;
  }
  if (outcome.outcome === "signaled")
    return `compiler result: stopped by signal ${outcome.signal ?? "an unknown signal"}`;
  return `compiler result: ${String(outcome.code)}`;
};

const compilerInspectionError = (
  cause: unknown,
  timeoutMs: number,
  compiler: DarwinProcessReaderCompiler,
): DarwinProcessOwnershipInspectionError => {
  const facts = compilerFailureFacts(cause, timeoutMs);
  const outcome = facts?.outcome;
  const code = outcome?.code ?? "unknown";
  const description = compilerOutcomeDescription(outcome, code);
  const launcher =
    compiler.kind === "xcrun"
      ? "xcrun"
      : "the selected Swift compiler (REA_DARWIN_SWIFTC_PATH)";
  const prefix =
    code === "ENOENT"
      ? `macOS process ownership inspection requires the Apple Swift compiler via ${launcher}`
      : `macOS process ownership helper compilation failed via ${launcher}`;
  const stderr = boundedUtf8Text(outcome?.stderr ?? "", STDERR_EXCERPT_LIMIT);
  const diagnostics = stderr.text.trim();
  const truncated =
    stderr.truncated ||
    outcome?.stderrTruncated === true ||
    outcome?.outputTruncated === true;
  const truncationNote = !truncated
    ? ""
    : stderr.truncated
      ? `… [diagnostics truncated at ${String(STDERR_EXCERPT_LIMIT)} bytes; this release has no runtime override]`
      : "… [diagnostics truncated; this release has no runtime override]";
  const suffix = diagnostics
    ? `: ${diagnostics}${truncationNote}`
    : outcome === undefined
      ? `: ${cause instanceof Error ? cause.message : String(cause)}`
      : ": no compiler diagnostics were captured";
  return new DarwinProcessOwnershipInspectionError(
    `${prefix} (${description})${suffix}`,
    {
      cause,
      ...(facts === undefined
        ? {}
        : {
            compilerOutcome: facts.outcome,
            capturedOutput: facts.capturedOutput,
          }),
    },
  );
};

/** One allocated helper root, including its shared finalization and live cleanup status. */
interface ProcessReaderRoot {
  readonly path: string;
  cleanupPromise?: Promise<void> | undefined;
  cleanupAnchor?: ProviderCleanupError | undefined;
}

interface ProcessReaderCompilation {
  readonly controller: AbortController;
  promise: Promise<Result<string, unknown>>;
  primaryFailure?: { readonly cause: unknown };
  waiters: number;
  aborting: boolean;
  settled: boolean;
}

const abortReason = (signal: AbortSignal): unknown => {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
};

const isExpectedAbort = (cause: unknown, signal: AbortSignal): boolean =>
  signal.aborted &&
  (cause === signal.reason ||
    (cause instanceof Error && cause.name === "AbortError"));

type CompilationWaitOutcome =
  | { readonly kind: "completed"; readonly result: Result<string, unknown> }
  | { readonly kind: "cancelled"; readonly reason: unknown };

const waitForCompilation = async (
  operation: ProcessReaderCompilation,
  signal: AbortSignal | undefined,
): Promise<CompilationWaitOutcome> => {
  if (signal === undefined)
    return { kind: "completed", result: await operation.promise };
  return new Promise((resolve) => {
    let completed = false;
    const finish = (outcome: CompilationWaitOutcome) => {
      if (completed) return;
      completed = true;
      signal.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = () => {
      // Finalization belongs to an already observed physical failure.
      if (operation.primaryFailure !== undefined) return;
      finish({ kind: "cancelled", reason: signal.reason });
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.promise.then((result) =>
      finish({ kind: "completed", result }),
    );
    if (signal.aborted) onAbort();
  });
};

/** Explicit tool selection; direct Swift compilation also needs its matching SDK. */
export type DarwinProcessReaderCompiler =
  | { readonly kind: "xcrun"; readonly executable: string }
  | {
      readonly kind: "swiftc";
      readonly executable: string;
      readonly sdkRoot: string;
    };

/** Compile and retain the narrow Darwin sysctl reader for this REA process. */
export const createDarwinProcessRunTokenReader = (
  options: {
    readonly compiler?: DarwinProcessReaderCompiler;
    /** Deadline for helper compilation, independent of provider execution. */
    readonly compileTimeoutMs?: number;
    /** Captured compiler/helper environment and default compile deadline. */
    readonly environment?: Readonly<Record<string, string | undefined>>;
    /**
     * Caller-owned directory holding the compiler's module cache. Unset keeps
     * Swift's reusable default cache; a supplied directory outlives this
     * reader because cleanup only removes the per-run helper root.
     */
    readonly moduleCachePath?: string;
  } = {},
) => {
  const compiler = options.compiler ?? {
    kind: "xcrun",
    executable: "/usr/bin/xcrun",
  };
  const environment = snapshotEnvironment(options.environment ?? process.env);
  const compilerTimeoutMs = resolveSwiftcCompileTimeoutMs({
    ...options,
    environment,
  });
  const moduleCachePath = options.moduleCachePath ?? "";
  let root: ProcessReaderRoot | undefined;
  let executable: string | undefined;
  let compilation: ProcessReaderCompilation | undefined;
  let closePromise: Promise<void> | undefined;
  let closed = false;
  let exitCleanupInstalled = false;
  const activeCommands = new Set<Promise<string>>();

  const cleanupAtExit = () => {
    if (root !== undefined) rmSync(root.path, { recursive: true, force: true });
  };
  const cleanupRoot = (target = root): Promise<void> => {
    if (target === undefined) return Promise.resolve();
    target.cleanupPromise ??= Promise.resolve()
      .then(async () => {
        try {
          await rm(target.path, { recursive: true, force: true });
        } catch (cause: unknown) {
          const failure = new ProviderCleanupError(
            "process-ownership",
            [target.path],
            {
              reason:
                "The Darwin ownership helper root remains owned until removal succeeds.",
            },
            { cause, operation: "prepare_owned_process" },
          );
          if (target.cleanupAnchor === undefined)
            target.cleanupAnchor = failure;
          else failure.bindCleanupDependencies([target.cleanupAnchor]);
          throw failure;
        }
        target.cleanupAnchor?.resolveCleanup();
        target.cleanupAnchor = undefined;
        if (root !== target) return;
        root = undefined;
        executable = undefined;
        if (exitCleanupInstalled) process.removeListener("exit", cleanupAtExit);
        exitCleanupInstalled = false;
      })
      .catch((cause: unknown) => {
        target.cleanupPromise = undefined;
        throw cause;
      });
    return target.cleanupPromise;
  };
  const runCompilation = async (
    operation: ProcessReaderCompilation,
  ): Promise<string> => {
    const signal = operation.controller.signal;
    let operationRoot: ProcessReaderRoot | undefined;
    try {
      if (
        compiler.kind === "swiftc" &&
        (!isAbsolute(compiler.executable) || !isAbsolute(compiler.sdkRoot))
      ) {
        throw new DarwinProcessOwnershipInspectionError(
          "Direct Darwin helper compilation requires absolute REA_DARWIN_SWIFTC_PATH and SDKROOT paths selecting a compatible installed Swift compiler and macOS SDK.",
        );
      }
      operationRoot = {
        path: await mkdtemp(join(tmpdir(), "rea-process-token-")),
      };
      root = operationRoot;
      process.once("exit", cleanupAtExit);
      exitCleanupInstalled = true;
      if (signal.aborted || closed) throw abortReason(signal);
      const output = join(operationRoot.path, "reader");
      // swiftc keeps intermediate objects under TMPDIR, so keep them inside
      // the root that cleanup removes.
      const compilerTemporary = join(operationRoot.path, "tmp");
      await mkdir(compilerTemporary);
      const compilerEnvironment: NodeJS.ProcessEnv = {
        ...environment,
        TMPDIR: compilerTemporary,
      };
      const compilerArguments =
        compiler.kind === "xcrun" ? ["swiftc"] : ["-sdk", compiler.sdkRoot];
      if (compiler.kind === "swiftc")
        compilerEnvironment.SDKROOT = compiler.sdkRoot;
      if (moduleCachePath === "") {
        // Use Swift's reusable default cache for REA's internal helper compilation.
        delete compilerEnvironment.CLANG_MODULE_CACHE_PATH;
      } else {
        await mkdir(moduleCachePath, { recursive: true });
        compilerArguments.push("-module-cache-path", moduleCachePath);
        compilerEnvironment.CLANG_MODULE_CACHE_PATH = moduleCachePath;
      }
      compilerArguments.push(...sourceFiles, "-o", output);
      try {
        await execFileOutput(compiler.executable, compilerArguments, {
          timeout: compilerTimeoutMs,
          maxBuffer: 1024 * 1024,
          signal,
          stopSignal: SWIFTC_INTERRUPT,
          lifetimePipe: true,
          env: compilerEnvironment,
        });
      } catch (cause: unknown) {
        if (isExpectedAbort(cause, signal)) throw cause;
        throw compilerInspectionError(cause, compilerTimeoutMs, compiler);
      }
      if (signal.aborted || closed) throw abortReason(signal);
      executable = output;
      return output;
    } catch (cause: unknown) {
      operation.primaryFailure = { cause };
      if (operationRoot !== undefined) {
        // The extra pipe keeps settlement pending for Swift frontend writers
        // that inherit it after the driver and its standard streams close.
        // It cannot establish completion of a child that did not inherit it.
        try {
          await cleanupRoot(operationRoot);
        } catch (cleanup: unknown) {
          if (!(cleanup instanceof ProviderCleanupError)) throw cleanup;
          const primary =
            cause instanceof DarwinProcessOwnershipInspectionError
              ? cause
              : new DarwinProcessOwnershipInspectionError(
                  "Darwin process ownership helper preparation failed",
                  { cause },
                );
          throw primary.withCleanupFailure(cleanup, {
            close: () => cleanupRoot(operationRoot),
          });
        }
      }
      throw cause;
    }
  };

  const beginCompilation = (): ProcessReaderCompilation => {
    const controller = new AbortController();
    const operation: ProcessReaderCompilation = {
      controller,
      promise: Promise.resolve()
        .then(() => runCompilation(operation))
        .then(ok, err)
        .finally(() => {
          operation.settled = true;
          if (compilation === operation) compilation = undefined;
        }),
      waiters: 0,
      aborting: false,
      settled: false,
    };
    compilation = operation;
    return operation;
  };

  const compile = async (signal?: AbortSignal): Promise<string> => {
    if (closed) throw new ProcessAdmissionError("reader_closed");
    signal?.throwIfAborted();
    while (true) {
      if (closed) throw new ProcessAdmissionError("reader_closed");
      signal?.throwIfAborted();
      if (executable !== undefined) return executable;
      if (compilation === undefined && root !== undefined) {
        await cleanupRoot();
        continue;
      }
      let operation = compilation;
      if (operation?.aborting === true) {
        const waited = await waitForCompilation(operation, signal);
        if (waited.kind === "cancelled") throw waited.reason;
        if (
          !waited.result.ok &&
          waited.result.error instanceof
            DarwinProcessOwnershipInspectionError &&
          waited.result.error.cleanupFailure !== undefined
        )
          throw waited.result.error;
        continue;
      }
      operation ??= beginCompilation();
      operation.waiters += 1;
      const waited = await waitForCompilation(operation, signal);
      operation.waiters -= 1;
      if (
        operation.waiters === 0 &&
        !operation.settled &&
        !operation.aborting
      ) {
        operation.aborting = true;
        operation.controller.abort();
        const finalized = await operation.promise;
        if (
          waited.kind === "cancelled" &&
          !finalized.ok &&
          finalized.error instanceof DarwinProcessOwnershipInspectionError &&
          finalized.error.cleanupFailure !== undefined
        ) {
          throw new DarwinProcessOwnershipInspectionError(
            "Darwin process ownership helper preparation was cancelled",
            {
              cause: waited.reason,
              cancellation: { reason: waited.reason },
              cleanupFailure: finalized.error.cleanupFailure,
              cleanupOwner: finalized.error.cleanupOwner,
            },
          );
        }
      }
      if (waited.kind === "cancelled") throw waited.reason;
      if (!waited.result.ok) throw waited.result.error;
      return waited.result.value;
    }
  };

  const runHelper = (
    arguments_: readonly string[],
    signal?: AbortSignal,
  ): Promise<string> => {
    if (closed)
      return Promise.reject(new ProcessAdmissionError("reader_closed"));
    const pending = (async () => {
      const binary = await compile(signal);
      const { stdout } = await execFileOutput(binary, arguments_, {
        env: environment,
        timeout: 15_000,
        stopSignal: "SIGTERM",
        ...(signal === undefined ? {} : { signal }),
      });
      signal?.throwIfAborted();
      return stdout;
    })();
    activeCommands.add(pending);
    return pending.finally(() => {
      activeCommands.delete(pending);
    });
  };

  const read = async (
    processes: readonly ProcessTableEntry[],
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<number, ProcessRunTokenObservation>> => {
    signal?.throwIfAborted();
    if (processes.length === 0) return new Map();
    const pids = processes.map(({ pid }) => String(pid));
    const stdout = await runHelper(pids, signal);
    const decoded = safeParseJson(stdout);
    if (!decoded.ok)
      throw new ProcessAdmissionError(
        "token_json_invalid",
        { parser: decoded.error },
        { cause: decoded.cause },
      );
    const parsed = responseSchema.safeParse(decoded.value);
    if (!parsed.success)
      throw new ProcessAdmissionError("token_response_invalid", undefined, {
        cause: parsed.error,
      });
    const requested = new Set(processes.map(({ pid }) => pid));
    const observations = new Map<number, ProcessRunTokenObservation>();
    for (const result of parsed.data.results) {
      if (!requested.has(result.pid) || observations.has(result.pid))
        throw new ProcessAdmissionError("token_pid_set");
      observations.set(
        result.pid,
        result.state === "readable"
          ? { state: "readable", runId: result.run_id }
          : {
              state: "unavailable",
              reason:
                result.reason ?? "process token observation is unavailable",
            },
      );
    }
    if (observations.size !== requested.size)
      throw new ProcessAdmissionError("token_pid_incomplete");
    return observations;
  };

  const identities = async (
    processes: readonly ProcessTableEntry[],
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<number, ProcessIdentityObservation>> => {
    if (processes.length === 0) return new Map();
    const pids = processes.map(({ pid }) => String(pid));
    const stdout = await runHelper(["--identities", ...pids], signal);
    const decoded = safeParseJson(stdout);
    if (!decoded.ok)
      throw new ProcessAdmissionError(
        "identity_json_invalid",
        { parser: decoded.error },
        { cause: decoded.cause },
      );
    const parsed = identityResponseSchema.safeParse(decoded.value);
    if (!parsed.success)
      throw new ProcessAdmissionError("identity_response_invalid", undefined, {
        cause: parsed.error,
      });
    const requested = new Set(processes.map(({ pid }) => pid));
    const observations = new Map<number, ProcessIdentityObservation>();
    for (const result of parsed.data.results) {
      if (!requested.has(result.pid) || observations.has(result.pid))
        throw new ProcessAdmissionError("identity_pid_set");
      observations.set(
        result.pid,
        result.state === "readable"
          ? {
              state: "readable",
              identity: result.identity,
              ...(result.effective_uid === undefined
                ? {}
                : { effectiveUid: result.effective_uid }),
              ...(result.lifecycle === undefined
                ? {}
                : {
                    lifecycle: {
                      state: "observed" as const,
                      lifecycle: result.lifecycle,
                    },
                  }),
              ...(result.relation === undefined
                ? {}
                : {
                    relation: {
                      state: "observed" as const,
                      parentPid: result.relation.parent_pid,
                      processGroupId: result.relation.process_group_id,
                    },
                  }),
            }
          : result.state === "absent"
            ? { state: "absent", reason: result.reason }
            : { state: "unavailable", reason: result.reason },
      );
    }
    if (observations.size !== requested.size)
      throw new ProcessAdmissionError("identity_pid_incomplete");
    return observations;
  };

  const close = (): Promise<void> => {
    if (closePromise !== undefined) return closePromise;
    closed = true;
    const pendingClose = (async () => {
      const operation = compilation;
      if (operation !== undefined && !operation.settled) {
        operation.aborting = true;
        operation.controller.abort();
        await operation.promise;
      }
      await Promise.allSettled(activeCommands);
      await cleanupRoot();
    })().catch((cause: unknown) => {
      if (closePromise === pendingClose) closePromise = undefined;
      throw cause;
    });
    closePromise = pendingClose;
    return closePromise;
  };

  return { read, identities, prepare: compile, close };
};
