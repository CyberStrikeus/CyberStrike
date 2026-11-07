import { readFile } from "node:fs/promises";

import type { DebuggerAdmissionLimit } from "../config/debuggerSessionLimits.js";
import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { parseLinuxProcessStat } from "./LinuxProcessStat.js";

/** Result of terminating one debugger process owned by this application. */
export type OwnedDebuggerStopResult =
  | { readonly status: "stopped" | "already_exited" }
  | { readonly status: "incomplete"; readonly reason: string };

/** Structured facts a limit error exposes. The sentence is display text. */
export const debuggerAdmissionDiagnostics = (
  admission: DebuggerAdmissionLimit,
): {
  readonly setting: string;
  readonly effective_value: number;
  readonly source: DebuggerAdmissionLimit["source"];
  readonly default_value: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly unit: DebuggerAdmissionLimit["unit"];
  readonly restart_required: true;
} => ({
  setting: admission.setting,
  effective_value: admission.value,
  source: admission.source,
  default_value: admission.defaultValue,
  minimum: admission.minimum,
  maximum: admission.maximum,
  unit: admission.unit,
  restart_required: true,
});

/** Name the setting, the effective value, its source, the range, and a restart. */
export const debuggerAdmissionRecovery = (
  admission: DebuggerAdmissionLimit,
): string =>
  `The effective ${admission.setting} value is ${String(admission.value)} ${admission.unit} (source ${admission.source}; default ${String(admission.defaultValue)} ${admission.unit}, floor ${String(admission.minimum)} ${admission.unit}, maximum ${String(admission.maximum)} ${admission.unit}). Set ${admission.setting} in the environment that starts REA to a positive decimal integer from ${String(admission.minimum)} to ${String(admission.maximum)}, then restart REA.`;

/** Fixed startup deadline. Distinct from the shared command deadline setting. */
export const fixedDeadlineGuidance = (
  what: string,
  timeoutMs: number,
): { readonly userMessage: string; readonly remediationAction: string } => ({
  userMessage: `${what} reached its ${String(timeoutMs)} ms deadline (deadlineExpired). This release has no runtime override.`,
  remediationAction: `This ${String(timeoutMs)} ms deadline has no runtime override. Allow execution, cleanup and delivery headroom in the outer MCP client deadline. Confirm outstanding work and cleanup before retrying.`,
});

/** Shared command deadline. The setting, not a per-provider constant, owns the cap. */
export const configurableDeadlineGuidance = (
  what: string,
  admission: DebuggerAdmissionLimit,
): {
  readonly userMessage: string;
  readonly remediationAction: string;
  readonly diagnostics: ReturnType<typeof debuggerAdmissionDiagnostics>;
} => {
  const recovery = debuggerAdmissionRecovery(admission);
  return {
    userMessage: `${what} reached its ${String(admission.value)} ms deadline (deadlineExpired). ${recovery}`,
    remediationAction: recovery,
    diagnostics: debuggerAdmissionDiagnostics(admission),
  };
};

/** Capacity refusal whose projection carries the setting, value, source, and range. */
export const debuggerResourceConstraintError = (
  operation: string,
  resource: "memory" | "transport",
  summary: string,
  remediation: string,
  admission: DebuggerAdmissionLimit,
  reported: Readonly<Record<string, JsonValue>>,
): AnalysisResourceConstraintError => {
  const facts = debuggerAdmissionDiagnostics(admission);
  const recovery = debuggerAdmissionRecovery(admission);
  return new AnalysisResourceConstraintError(
    operation,
    resource,
    `${summary} ${recovery}`,
    { ...facts, ...reported },
    {
      remediationAction: `${remediation} ${recovery}`,
      diagnostics: facts,
    },
  );
};

const DETACH_TIMEOUT_MS = 1_000;
const MAX_LATE_DEBUGGER_OUTPUT_BYTES = 64 * 1024;
export type OwnedDebuggerDetachResult =
  | { readonly status: "no-inferior" }
  | { readonly status: "detached"; readonly outputSink: "durable" };
export interface OwnedInferiorIdentity {
  readonly pid: string;
  readonly startTime: string;
}

export type ProcessStartTimeReader = (pid: string) => Promise<string | null>;

/** Read one Linux identity; absence is distinct from unreadable or malformed data. */
export const readLinuxProcessStartTime: ProcessStartTimeReader = async (
  pid,
) => {
  if (process.platform !== "linux")
    throw new Error(
      "Inferior process identity verification requires Linux /proc.",
    );
  let stat: string;
  try {
    stat = await readFile(`/proc/${pid}/stat`, "utf8");
  } catch (cause: unknown) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "ENOENT"
    )
      return null;
    throw cause;
  }
  const parsed = parseLinuxProcessStat(stat);
  if (parsed === undefined || parsed.pid !== Number(pid))
    throw new Error(`Inferior PID ${pid} has an unreadable process identity.`);
  return parsed.startTime;
};

/** Confirm only that every previously identified inferior process has ended. */
export const verifyOwnedInferiorsEnded = async (
  identities: Iterable<OwnedInferiorIdentity>,
  readStartTime: ProcessStartTimeReader = readLinuxProcessStartTime,
): Promise<boolean> => {
  let foundIdentity = false;
  for (const identity of identities) {
    foundIdentity = true;
    const observed = await readStartTime(identity.pid);
    if (observed === identity.startTime) return false;
  }
  return foundIdentity;
};

const detachAttempts = new WeakMap<
  object,
  Promise<OwnedDebuggerDetachResult>
>();
const detachOutcomes = new WeakMap<
  object,
  "confirmed" | "unconfirmed" | "inferior-ended"
>();

const isVerifiedDetachResult = (
  result: unknown,
): result is OwnedDebuggerDetachResult =>
  typeof result === "object" &&
  result !== null &&
  (("status" in result && result.status === "no-inferior") ||
    ("status" in result &&
      result.status === "detached" &&
      "outputSink" in result &&
      result.outputSink === "durable"));

const waitForInferiorDetach = async (
  session: object,
  detach: () => Promise<OwnedDebuggerDetachResult>,
): Promise<OwnedDebuggerDetachResult | undefined> => {
  let attempt = detachAttempts.get(session);
  if (attempt === undefined) {
    // Providers may use `this` to access their command transport.
    const pending = Promise.resolve().then(() => detach.call(session));
    const tracked = pending.then(
      (result) => {
        detachAttempts.delete(session);
        detachOutcomes.set(
          session,
          isVerifiedDetachResult(result) ? "confirmed" : "unconfirmed",
        );
        return result;
      },
      (cause: unknown) => {
        detachAttempts.delete(session);
        detachOutcomes.set(session, "unconfirmed");
        throw cause;
      },
    );
    attempt = tracked;
    detachAttempts.set(session, tracked);
  }
  let timer!: NodeJS.Timeout;
  try {
    return await Promise.race([
      attempt,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), DETACH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

interface OwnedDebuggerProcess {
  readonly id: string;
  readonly exited: boolean;
  readonly inferiorStateUnknown?: () => boolean;
  readonly verifyInferiorsEndedAfterExit?: () => Promise<boolean>;
  readonly launched: {
    readonly process: { kill(signal: NodeJS.Signals): boolean };
  };
  /** Must return only after the provider verifies detachment or no inferior. */
  /** Confirms no inferior, or detaches only after verifying a durable output sink. */
  readonly detachInferior?: () => Promise<OwnedDebuggerDetachResult>;
  readonly supervisor: {
    waitForExit(timeoutMs: number): Promise<boolean>;
    /** WindowsOwnedProcess closes output only after the whole Job Object settles. */
    waitForOutputClose(timeoutMs: number): Promise<boolean>;
    unrefOutputStreams(): void;
    /** Cap bytes retained after debugger shutdown while continuing to drain. */
    limitAdditionalOutputBytes(maxBytes: number): void;
    dispose(): void;
  };
}

const finishExitedDebuggerSession = async (
  session: OwnedDebuggerProcess,
  debuggerName: string,
  platform: NodeJS.Platform,
  status: "stopped" | "already_exited",
): Promise<OwnedDebuggerStopResult> => {
  try {
    session.supervisor.limitAdditionalOutputBytes(
      MAX_LATE_DEBUGGER_OUTPUT_BYTES,
    );
    if (!(await session.supervisor.waitForOutputClose(1_000))) {
      return {
        status: "incomplete",
        reason:
          platform === "win32"
            ? `Owned ${debuggerName} process leader exited, but its Windows Job Object still has active descendants or has not reported settlement.`
            : `Owned ${debuggerName} process leader exited, but inherited output streams are still open or have not reported settlement.`,
      };
    }
  } catch (cause: unknown) {
    return {
      status: "incomplete",
      reason:
        platform === "win32"
          ? `Owned ${debuggerName} Windows Job Object settlement could not be verified: ${cause instanceof Error ? cause.message : String(cause)}`
          : `Owned ${debuggerName} inherited output stream settlement could not be verified: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  if (platform !== "win32") session.supervisor.unrefOutputStreams();
  session.supervisor.dispose();
  return { status };
};

/**
 * Stop only the directly owned debugger process, never its process group or target.
 * The caller must permanently close command admission before the first attempt;
 * retries retain completed detach facts while process termination is pending.
 */
export const stopOwnedDebuggerProcess = async (
  session: OwnedDebuggerProcess,
  debuggerName: string,
  options: { readonly platform?: NodeJS.Platform } = {},
): Promise<OwnedDebuggerStopResult> => {
  const platform = options.platform ?? process.platform;
  if (session.exited) {
    if (detachAttempts.has(session))
      return {
        status: "incomplete",
        reason: `Owned ${debuggerName} inferior detach is still pending after the process exited.`,
      };
    const detachOutcome = detachOutcomes.get(session);
    if (
      detachOutcome === "unconfirmed" ||
      (detachOutcome === undefined && session.inferiorStateUnknown?.() === true)
    ) {
      try {
        if ((await session.verifyInferiorsEndedAfterExit?.()) !== true)
          return {
            status: "incomplete",
            reason: `Owned ${debuggerName} inferior disposition was not verified before the debugger exited, and no owner proof confirms the identified inferior processes have ended.`,
          };
        detachOutcomes.set(session, "inferior-ended");
      } catch (cause: unknown) {
        return {
          status: "incomplete",
          reason: `Owned ${debuggerName} inferior process identity could not be verified after debugger exit: ${cause instanceof Error ? cause.message : String(cause)}`,
        };
      }
    }
    return finishExitedDebuggerSession(
      session,
      debuggerName,
      platform,
      "already_exited",
    );
  }
  if (platform === "win32")
    return {
      status: "incomplete",
      reason: `Owned ${debuggerName} process cannot be stopped safely on Windows because job termination can also terminate its inferior processes.`,
    };
  // Admission remains closed once cleanup starts. A verified detach is an
  // owned completion fact, even when terminating the debugger later fails.
  // Retrying the command transport can no longer improve that fact and may
  // block termination if shutdown already made the transport unavailable.
  if (detachOutcomes.get(session) !== "confirmed") {
    try {
      if (session.detachInferior === undefined) {
        detachOutcomes.set(session, "unconfirmed");
        return {
          status: "incomplete",
          reason: `Owned ${debuggerName} inferior detach cannot be verified because the provider has no detach capability.`,
        };
      }
      const detached = await waitForInferiorDetach(
        session,
        session.detachInferior,
      );
      if (detached === undefined)
        return {
          status: "incomplete",
          reason: `Owned ${debuggerName} inferior detach was not verified within ${String(DETACH_TIMEOUT_MS)} ms. This release has no runtime override.`,
        };
      if (!isVerifiedDetachResult(detached)) {
        detachOutcomes.set(session, "unconfirmed");
        return {
          status: "incomplete",
          reason: `Owned ${debuggerName} provider did not confirm no inferior or detachment with a durable output sink.`,
        };
      }
      detachOutcomes.set(session, "confirmed");
    } catch (cause: unknown) {
      return {
        status: "incomplete",
        reason: `Owned ${debuggerName} inferior detach could not be verified: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
  }
  session.launched.process.kill("SIGTERM");
  if (!(await session.supervisor.waitForExit(300))) {
    session.launched.process.kill("SIGKILL");
    const exitedAfterKill = await session.supervisor.waitForExit(1_000);
    if (exitedAfterKill)
      return finishExitedDebuggerSession(
        session,
        debuggerName,
        platform,
        "stopped",
      );
    return {
      status: "incomplete",
      reason: `Owned ${debuggerName} process did not exit after direct termination.`,
    };
  }
  return finishExitedDebuggerSession(
    session,
    debuggerName,
    platform,
    "stopped",
  );
};

/**
 * Stop every owned session and retain failed sessions for possible recovery.
 * Callers must block replacement admission and drain in-flight starts until
 * this settles; incomplete cleanup leaves the old owner in the map for retry.
 */
export const closeOwnedDebuggerSessions = async <
  Session extends { id: string },
>(
  sessions: Map<string, Session>,
  stop: (session: Session) => Promise<OwnedDebuggerStopResult>,
  debuggerName: string,
): Promise<void> => {
  const results = await Promise.allSettled(
    [...sessions.entries()].map(async ([key, session]) => ({
      key,
      session,
      result: await stop(session),
    })),
  );
  const failures: Error[] = [];
  for (const settled of results) {
    if (settled.status === "rejected") {
      failures.push(
        settled.reason instanceof Error
          ? settled.reason
          : new Error(String(settled.reason)),
      );
      continue;
    }
    const { key, session, result } = settled.value;
    if (result.status === "incomplete") failures.push(new Error(result.reason));
    else if (sessions.get(key) === session) sessions.delete(key);
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      `One or more owned ${debuggerName} processes did not stop cleanly`,
    );
};
