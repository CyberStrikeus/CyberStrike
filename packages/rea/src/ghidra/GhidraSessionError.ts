import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import {
  AnalysisError,
  type AnalysisPartialObservation,
} from "../domain/analysisErrorBase.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { DarwinProcessOwnershipInspectionError } from "../process/DarwinProcessRunTokenReader.js";
import { boundedUtf8Text } from "../process/boundedUtf8Text.js";
import type { GhidraDiagnosticsScope } from "./GhidraDiagnostics.js";
import { ghidraFileOffsetOutcome } from "./GhidraFileOffsetFailure.js";
import { GhidraAdmissionError } from "./GhidraAdmissionError.js";
import { GhidraLaunchSupportError } from "./GhidraJavaLaunch.js";
import {
  GhidraLaunchError,
  GHIDRA_LAUNCH_COMMAND_OUTPUT_BYTES,
} from "./GhidraLauncher.js";

const MAX_CAUSE_DEPTH = 3;
const MAX_CAUSE_MESSAGE_BYTES = 2 * 1024;
const MAX_CAUSE_FIELD_BYTES = 1024;
const MAX_COMPILER_STDERR_BYTES = 8 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 8 * 1024;

/** Stable failure phase for one private Ghidra headless session. */
export type GhidraSessionFailureKind =
  | "admission"
  | "cancelled"
  | "timeout"
  | "start"
  | "process"
  | "protocol"
  | "remote"
  | "analysis_timeout";

/** Message of the failure raised when the provider startup deadline elapses. */
export const GHIDRA_STARTUP_DEADLINE_ELAPSED =
  "Ghidra startup deadline elapsed";

/** Additional structured context for a Ghidra session failure. */
export interface GhidraSessionErrorOptions extends ErrorOptions {
  readonly cancellation?: { readonly reason: unknown };
  readonly partialObservation?: AnalysisPartialObservation;
  readonly timeoutMs?: number;
  readonly remoteCode?: string;
  readonly cleanupFailure?: AnalysisError;
  /** Caller cancellation that closed the session while this failure settled. */
  readonly concurrentCancellation?: { readonly reason: unknown };
}

/** Provider-owned failure with bounded, token-redacted local diagnostics. */
export class GhidraSessionError extends Error {
  readonly diagnostics: Readonly<Record<string, JsonValue>>;
  readonly timeoutMs: number | undefined;
  readonly remoteCode: string | undefined;
  readonly cleanupFailure: AnalysisError | undefined;
  readonly cancellation: { readonly reason: unknown } | undefined;
  readonly partialObservation: AnalysisPartialObservation | undefined;
  readonly concurrentCancellation: { readonly reason: unknown } | undefined;

  constructor(
    readonly kind: GhidraSessionFailureKind,
    message: string,
    diagnostics: Readonly<Record<string, JsonValue>> = {},
    options: GhidraSessionErrorOptions = {},
  ) {
    super(message, options);
    this.name = "GhidraSessionError";
    this.diagnostics = structuredClone(diagnostics);
    this.timeoutMs = options.timeoutMs;
    this.remoteCode = options.remoteCode;
    this.cleanupFailure = options.cleanupFailure;
    this.cancellation = options.cancellation;
    this.partialObservation = options.partialObservation;
    this.concurrentCancellation = options.concurrentCancellation;
  }

  /** Refresh diagnostics without discarding owned failure or cleanup facts. */
  withDiagnostics(
    diagnostics: Readonly<Record<string, JsonValue>>,
    message = this.message,
  ): GhidraSessionError {
    return this.#copy(diagnostics, this.cleanupFailure, message);
  }

  /** Join cleanup uncertainty, following both exact owners through later retry. */
  withCleanupFailure(
    cleanup: AnalysisError,
    diagnostics = this.diagnostics,
  ): GhidraSessionError {
    const combined =
      this.cleanupFailure === undefined || this.cleanupFailure === cleanup
        ? cleanup
        : analysisErrorWithCleanupFailure(
            this.cleanupFailure,
            cleanup,
          ).bindCleanupDependencies([this.cleanupFailure, cleanup]);
    return this.#copy(diagnostics, combined);
  }

  /** Retain caller-safe completed facts without serializing snapshot byte buffers. */
  withPartialObservation(
    observation: AnalysisPartialObservation,
  ): GhidraSessionError {
    return this.#copy(
      this.diagnostics,
      this.cleanupFailure,
      this.message,
      observation,
    );
  }

  /**
   * Keep this failure primary while recording that caller cancellation closed
   * the session before it settled, so projections do not promise reuse.
   */
  withConcurrentCancellation(cancellation: {
    readonly reason: unknown;
  }): GhidraSessionError {
    return this.#copy(
      { ...this.diagnostics, session_closed_by_cancellation: true },
      this.cleanupFailure,
      this.message,
      this.partialObservation,
      cancellation,
    );
  }

  #copy(
    diagnostics: Readonly<Record<string, JsonValue>>,
    cleanupFailure: AnalysisError | undefined,
    message = this.message,
    partialObservation = this.partialObservation,
    concurrentCancellation = this.concurrentCancellation,
  ): GhidraSessionError {
    return new GhidraSessionError(this.kind, message, diagnostics, {
      ...(Object.hasOwn(this, "cause") ? { cause: this.cause } : {}),
      ...(this.cancellation === undefined
        ? {}
        : { cancellation: this.cancellation }),
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      ...(this.remoteCode === undefined ? {} : { remoteCode: this.remoteCode }),
      ...(cleanupFailure === undefined ? {} : { cleanupFailure }),
      ...(partialObservation === undefined ? {} : { partialObservation }),
      ...(concurrentCancellation === undefined
        ? {}
        : { concurrentCancellation }),
    });
  }
}

/** Build a session failure while preserving bounded remote failure metadata. */
const createGhidraSessionError = (failure: {
  readonly kind: GhidraSessionFailureKind;
  readonly message: string;
  readonly diagnostics: Readonly<Record<string, JsonValue>>;
  readonly cause?: unknown;
  readonly timeoutMs?: number;
  readonly remoteCode?: string;
  readonly cancellation?: { readonly reason: unknown };
  readonly redact: (value: string, incomplete?: boolean) => string;
}): GhidraSessionError =>
  new GhidraSessionError(
    failure.kind,
    failure.message,
    {
      ...failure.diagnostics,
      failure_kind: failure.kind,
      failure_message: failure.message,
      ...(failure.remoteCode === undefined
        ? {}
        : {
            remote_code: failure.redact(failure.remoteCode),
            remote_message: failure.message,
          }),
    },
    {
      ...(failure.cancellation === undefined
        ? {}
        : { cancellation: failure.cancellation }),
      ...(failure.cause === undefined ? {} : { cause: failure.cause }),
      ...(failure.timeoutMs === undefined
        ? {}
        : { timeoutMs: failure.timeoutMs }),
      ...(failure.remoteCode === undefined
        ? {}
        : { remoteCode: failure.remoteCode }),
    },
  );

/** Bridge input failures share classification with their domain error projection. */
export const isGhidraInputFailureCode = (code: string | undefined): boolean =>
  code === "invalid_request" || code === "not_found" || code === "ambiguous";

/** Bind session-failure construction to its causal diagnostic scope. */
export const bindGhidraSessionFailure =
  (
    diagnostics: (
      scope: GhidraDiagnosticsScope,
    ) => Readonly<Record<string, JsonValue>>,
    redact: (value: string, incomplete?: boolean) => string = (value) => value,
  ) =>
  (
    kind: GhidraSessionFailureKind,
    message: string,
    cause?: unknown,
    options: Pick<
      GhidraSessionErrorOptions,
      "timeoutMs" | "remoteCode" | "cancellation"
    > = {},
  ): GhidraSessionError => {
    const failure = createGhidraSessionError({
      kind,
      message: redact(message),
      diagnostics: {
        ...diagnostics(
          kind === "remote" &&
            (isGhidraInputFailureCode(options.remoteCode) ||
              options.remoteCode === "invalid_function_name" ||
              ghidraFileOffsetOutcome(options.remoteCode) !== undefined)
            ? "request"
            : "session",
        ),
        ...(cause === undefined
          ? {}
          : { failure_cause: describeCause(cause, redact) }),
      },
      redact,
      ...(cause === undefined ? {} : { cause }),
      ...options,
    });
    const cleanup =
      cause instanceof DarwinProcessOwnershipInspectionError ||
      cause instanceof GhidraLaunchError
        ? cause.cleanupFailure
        : cause instanceof AnalysisError && cause.cleanupIncomplete
          ? cause
          : undefined;
    return cleanup === undefined
      ? failure
      : failure.withCleanupFailure(cleanup);
  };

/** Canonical factory contract shared by session lifecycle owners. */
export type GhidraSessionFailureFactory = ReturnType<
  typeof bindGhidraSessionFailure
>;

const describeCause = (
  cause: unknown,
  redact: (value: string, incomplete?: boolean) => string,
  depth = 0,
): JsonValue => {
  if (cause instanceof Error) {
    return describeErrorCause(cause, redact, depth);
  }
  if (typeof cause === "string") {
    const message = boundedUtf8Text(redact(cause), MAX_CAUSE_MESSAGE_BYTES);
    return {
      type: "string",
      message: message.text,
      ...(message.truncated ? { message_truncated: true } : {}),
    };
  }
  if (cause === null || typeof cause === "boolean")
    return { type: cause === null ? "null" : "boolean", value: cause };
  if (typeof cause === "number" && Number.isFinite(cause))
    return { type: "number", value: cause };
  return { type: typeof cause };
};

const describeErrorCause = (
  cause: Error,
  redact: (value: string, incomplete?: boolean) => string,
  depth: number,
): JsonValue => {
  const message = boundedUtf8Text(
    redact(cause.message),
    MAX_CAUSE_MESSAGE_BYTES,
  );
  const name = boundedUtf8Text(redact(cause.name), MAX_CAUSE_FIELD_BYTES);
  return {
    name: name.text,
    ...(name.truncated ? { name_truncated: true } : {}),
    message: message.text,
    ...(message.truncated ? { message_truncated: true } : {}),
    ...causeCode(cause, redact),
    ...causeAdmissionDetail(cause, redact),
    ...causeSignal(cause, redact),
    ...causeCommandOutcome(cause, redact),
    ...causeCompilerOutcome(cause, redact),
    ...causeLaunchOutcome(cause, redact),
    ...causeLaunchRollback(cause, redact, depth),
    ...nestedErrorCause(cause, redact, depth),
  };
};

const causeCommandOutcome = (
  cause: Error,
  redact: (value: string, incomplete?: boolean) => string,
): Record<string, JsonValue> => {
  if (!(cause instanceof GhidraLaunchSupportError)) return {};
  const outcome = cause.outcome;
  if (outcome === undefined) return {};
  const stdout = boundedUtf8Text(
    redact(outcome.stdout, outcome.outputTruncated !== false),
    MAX_COMMAND_OUTPUT_BYTES,
  );
  const stderr = boundedUtf8Text(
    redact(outcome.stderr, outcome.outputTruncated !== false),
    MAX_COMMAND_OUTPUT_BYTES,
  );
  return {
    command_outcome: {
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutBytes: outcome.stdoutBytes ?? Buffer.byteLength(outcome.stdout),
      stderrBytes: outcome.stderrBytes ?? Buffer.byteLength(outcome.stderr),
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      outputTruncated: outcome.outputTruncated,
      killed: outcome.killed,
    },
  };
};

const causeAdmissionDetail = (
  cause: Error,
  redact: (value: string, incomplete?: boolean) => string,
): Record<string, JsonValue> => {
  if (!(cause instanceof GhidraAdmissionError) || cause.detail === undefined)
    return {};
  const detail: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(cause.detail)) {
    if (typeof value === "number") {
      detail[key] = value;
      continue;
    }
    const bounded = boundedUtf8Text(redact(value), MAX_CAUSE_FIELD_BYTES);
    detail[key] = bounded.text;
  }
  return { detail };
};

const causeCode = (
  cause: Error,
  redact: (value: string, incomplete?: boolean) => string,
): Record<string, JsonValue> => {
  const code = "code" in cause ? cause.code : undefined;
  if (typeof code === "string") {
    const bounded = boundedUtf8Text(redact(code), MAX_CAUSE_FIELD_BYTES);
    return {
      code: bounded.text,
      ...(bounded.truncated ? { code_truncated: true } : {}),
    };
  }
  if (typeof code === "number" && Number.isFinite(code)) return { code };
  return {};
};

const causeSignal = (
  cause: Error,
  redact: (value: string, incomplete?: boolean) => string,
): Record<string, JsonValue> => {
  const signal = "signal" in cause ? cause.signal : undefined;
  if (typeof signal === "string") {
    const bounded = boundedUtf8Text(redact(signal), MAX_CAUSE_FIELD_BYTES);
    return {
      signal: bounded.text,
      ...(bounded.truncated ? { signal_truncated: true } : {}),
    };
  }
  if (signal === null) return { signal: null };
  return {};
};

const causeCompilerOutcome = (
  cause: Error,
  redact: (value: string, incomplete?: boolean) => string,
): Record<string, JsonValue> => {
  if (!(cause instanceof DarwinProcessOwnershipInspectionError)) return {};
  const outcome = cause.compilerOutcome;
  if (outcome === undefined) return {};
  const stderr = boundedUtf8Text(
    redact(outcome.stderr),
    MAX_COMPILER_STDERR_BYTES,
  );
  const code = boundedCompilerField(outcome.code, redact);
  const signal = boundedCompilerField(outcome.signal, redact);
  return {
    compiler_outcome: {
      ...outcome,
      code: code.value,
      signal: signal.value,
      stderr: stderr.text,
      stderrTruncated: outcome.stderrTruncated || stderr.truncated,
      ...(code.truncated ? { codeTruncated: true } : {}),
      ...(signal.truncated ? { signalTruncated: true } : {}),
    },
  };
};

const boundedCompilerField = (
  value: string | number | null,
  redact: (value: string, incomplete?: boolean) => string,
): { readonly value: string | number | null; readonly truncated: boolean } => {
  if (typeof value !== "string") return { value, truncated: false };
  const bounded = boundedUtf8Text(redact(value), MAX_CAUSE_FIELD_BYTES);
  return { value: bounded.text, truncated: bounded.truncated };
};

/** Project the producer's tagged rollback facts independently of the primary cause. */
const causeLaunchRollback = (
  cause: Error,
  redact: (value: string, incomplete?: boolean) => string,
  depth: number,
): Record<string, JsonValue> => {
  if (
    !(cause instanceof GhidraLaunchError) ||
    cause.rollbackFailure === undefined
  )
    return {};
  const rollback = cause.rollbackFailure;
  if (rollback.kind === "rejected")
    return {
      rollback_failure: {
        kind: rollback.kind,
        ...(depth >= MAX_CAUSE_DEPTH
          ? { cause_truncated: true }
          : { cause: describeCause(rollback.cause, redact, depth + 1) }),
      },
    };
  const result = rollback.result;
  const reason = boundedUtf8Text(
    redact(result.reason),
    MAX_CAUSE_MESSAGE_BYTES,
  );
  const diagnostic = (value: string | undefined): Record<string, JsonValue> => {
    if (value === undefined) return {};
    const bounded = boundedUtf8Text(redact(value), MAX_CAUSE_MESSAGE_BYTES);
    return {
      diagnostic: bounded.text,
      ...(bounded.truncated ? { diagnostic_truncated: true } : {}),
    };
  };
  // Share one member-evidence budget, matching a retained launcher-command stream.
  // Keep the complete typed result on GhidraLaunchError for the process owner.
  let remainingBytes = GHIDRA_LAUNCH_COMMAND_OUTPUT_BYTES;
  const members = <Member>(
    values: readonly Member[],
    project: (value: Member) => JsonValue,
  ): { readonly rows: JsonValue[]; readonly omitted: number } => {
    const rows: JsonValue[] = [];
    for (const value of values) {
      const row = project(value);
      const bytes =
        Buffer.byteLength(JSON.stringify(row)) + (rows.length === 0 ? 0 : 1);
      if (bytes > remainingBytes) break;
      remainingBytes -= bytes;
      rows.push(row);
    }
    return { rows, omitted: values.length - rows.length };
  };
  const failures =
    result.failures === undefined
      ? undefined
      : members(result.failures, (failure) => ({
          pid: failure.pid,
          reason: failure.reason,
          ...diagnostic(failure.diagnostic),
        }));
  const unverified =
    result.unverified === undefined
      ? undefined
      : members(result.unverified, (member) => ({
          pid: member.pid,
          ...diagnostic(member.diagnostic),
        }));
  return {
    rollback_failure: {
      kind: rollback.kind,
      result: {
        cleaned: false,
        reason: reason.text,
        ...(reason.truncated ? { reason_truncated: true } : {}),
        ...(failures === undefined
          ? {}
          : {
              failures: failures.rows,
              ...(failures.omitted === 0
                ? {}
                : { failures_omitted: failures.omitted }),
            }),
        ...(unverified === undefined
          ? {}
          : {
              unverified: unverified.rows,
              ...(unverified.omitted === 0
                ? {}
                : { unverified_omitted: unverified.omitted }),
            }),
      },
    },
  };
};

/** Retain a launch failure's launcher command outcome in its cause envelope. */
const causeLaunchOutcome = (
  cause: Error,
  redact: (value: string, incomplete?: boolean) => string,
): Record<string, JsonValue> => {
  if (!(cause instanceof GhidraLaunchError)) return {};
  const launchSupport =
    cause.launchSupport.length === 0
      ? {}
      : {
          launch_support: cause.launchSupport.map((output) => ({
            ...output,
            stderr: redact(output.stderr),
          })),
        };
  // A failed LaunchSupport helper reports its own command outcome in the
  // nested cause; earlier helper warnings still belong to this launch.
  if (cause.cause instanceof GhidraLaunchSupportError) return launchSupport;
  const output = cause.capturedOutput;
  if (output === undefined) return launchSupport;
  const stdout = boundedUtf8Text(
    redact(output.stdout),
    GHIDRA_LAUNCH_COMMAND_OUTPUT_BYTES,
  );
  const stderr = boundedUtf8Text(
    redact(output.stderr),
    GHIDRA_LAUNCH_COMMAND_OUTPUT_BYTES,
  );
  const truncated = output.truncated || stdout.truncated || stderr.truncated;
  return {
    ...launchSupport,
    launch_outcome: {
      stdout: stdout.text,
      stderr: stderr.text,
      truncated,
      ...(output.stdout_bytes === undefined
        ? {}
        : { stdout_bytes: output.stdout_bytes }),
      ...(output.stderr_bytes === undefined
        ? {}
        : { stderr_bytes: output.stderr_bytes }),
      ...(output.exit_code === undefined
        ? {}
        : { exit_code: output.exit_code }),
      ...(output.signal === undefined ? {} : { signal: output.signal }),
    },
  };
};

const nestedErrorCause = (
  cause: Error,
  redact: (value: string, incomplete?: boolean) => string,
  depth: number,
): Record<string, JsonValue> => {
  if (!("cause" in cause)) return {};
  if (depth >= MAX_CAUSE_DEPTH) return { cause_truncated: true };
  return { cause: describeCause(cause.cause, redact, depth + 1) };
};
