import { randomUUID } from "node:crypto";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";

import {
  hopperStartupExitCode,
  type HopperPrivateDisplayStrategy,
  type HopperStartupDiagnostic,
  type HopperStartupFailureDiagnostic,
  type HopperStartupFailureCode,
  type HopperStartupReadyDiagnostic,
} from "../domain/hopperStartupFailure.js";
import { cleanupOwnedProcessGroup } from "../process/ProcessOwnership.js";
import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
  type ProviderProcessLaunch,
} from "../process/ProviderProcess.js";
import { parseLinuxPrivateDisplayDiagnostic } from "./LinuxPrivateDisplayDiagnostic.js";

const PYTHON_PATH = "/usr/bin/python3";
const UNSHARE_PATH = "/usr/bin/unshare";
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

const isAborted = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;

export type LinuxPrivateDisplayRunnableStrategy = Exclude<
  HopperPrivateDisplayStrategy,
  "unavailable"
>;

export interface LinuxPrivateDisplayProbeProcessResult {
  readonly outcome: "exited" | "timed-out" | "cancelled" | "launch-failed";
  readonly exitCode: number | null | undefined;
  readonly stderr: string;
  readonly stderrBytes: number;
  readonly cleanup:
    | { readonly status: "released" }
    | PendingPrivateDisplayCleanup;
}

interface PendingPrivateDisplayCleanup {
  readonly status: "pending";
  readonly lease: AnalysisCleanupLease;
  readonly reason: string;
}

export type LinuxPrivateDisplayProbeRunner = (
  strategy: LinuxPrivateDisplayRunnableStrategy,
  options: {
    readonly helperPath: string;
    readonly environment?: Readonly<NodeJS.ProcessEnv>;
    readonly timeoutMs: number;
    readonly signal?: AbortSignal;
  },
) => Promise<LinuxPrivateDisplayProbeProcessResult>;

export type LinuxPrivateDisplaySelection =
  | {
      readonly ok: true;
      readonly strategy: LinuxPrivateDisplayRunnableStrategy;
      readonly diagnostic: HopperStartupReadyDiagnostic;
    }
  | {
      readonly ok: false;
      readonly strategy: "unavailable";
      readonly exitCode: number;
      readonly diagnostic: HopperStartupFailureDiagnostic;
      readonly cleanup?: PendingPrivateDisplayCleanup;
    };

/** Probe the exact Xvfb boundary and select the least-privileged viable strategy. */
export const selectLinuxPrivateDisplayStrategy = async (options: {
  readonly helperPath: string;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly runProbe?: LinuxPrivateDisplayProbeRunner;
}): Promise<LinuxPrivateDisplaySelection> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const runner = options.runProbe ?? runLinuxPrivateDisplayProbe;
  const direct = await evaluatedProbe("direct", options, timeoutMs, runner);
  if (direct.ok) return direct;
  if (direct.diagnostic.failure_code !== "x11_socket_directory_unusable")
    return unavailable(direct.diagnostic, direct.cleanup);

  const isolated = await evaluatedProbe(
    "user-mount-namespace",
    options,
    timeoutMs,
    runner,
  );
  if (!isolated.ok)
    return unavailable(
      {
        ...direct.diagnostic,
        strategy: "unavailable",
        reason: "namespace_unavailable",
        fallback_reason: isolated.diagnostic.reason,
        effective_socket_directory_mode:
          isolated.diagnostic.effective_socket_directory_mode,
        effective_mount_read_only:
          isolated.diagnostic.effective_mount_read_only,
        xvfb_stderr_bytes: isolated.diagnostic.xvfb_stderr_bytes,
      },
      isolated.cleanup,
    );
  return {
    ok: true,
    strategy: "user-mount-namespace",
    diagnostic: {
      ...isolated.diagnostic,
      socket_directory_mode: direct.diagnostic.socket_directory_mode,
      mount_read_only: direct.diagnostic.mount_read_only,
      fallback_reason: null,
    },
  };
};

/** Run one helper probe in an owned process group and retain its full diagnostics. */
export const runLinuxPrivateDisplayProbe: LinuxPrivateDisplayProbeRunner =
  async (strategy, options) => {
    if (isAborted(options.signal)) return emptyProcessResult("cancelled");
    const command = privateDisplayProbeCommand(options.helperPath, strategy);
    let started: Awaited<ReturnType<typeof spawnOwnedProviderProcess>>;
    try {
      started = await spawnOwnedProviderProcess({
        command: command.command,
        arguments: command.arguments,
        runId: randomUUID(),
        expectedCommand: null,
        ...(options.environment === undefined
          ? {}
          : { hostEnvironment: options.environment }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (cause: unknown) {
      // best-effort cleanup: probe spawn failure is reported as launch-failed.
      void cause;
      return emptyProcessResult(
        isAborted(options.signal) ? "cancelled" : "launch-failed",
      );
    }
    const launch: ProviderProcessLaunch = {
      process: started.process,
      ownsProcessLifetime: true,
      cleanup: () => cleanupOwnedProcessGroup(started.ownership),
    };
    const supervisor = new ProviderProcessSupervisor(launch);
    const outcome = await waitForProbeOutputClose(
      supervisor,
      options.timeoutMs,
      options.signal,
    );
    let cleanup: LinuxPrivateDisplayProbeProcessResult["cleanup"] = {
      status: "released",
    };
    const lease = new AnalysisCleanupLease(async () => {
      const stopped = await supervisor.stop();
      if (stopped.status === "incomplete") throw new Error(stopped.reason);
      if (stopped.status === "not-owned")
        throw new Error("Private-display probe ownership remains unresolved");
      supervisor.dispose();
    }, [`hopper-private-display-probe:${started.ownership.runId}`]);
    try {
      await lease.release();
    } catch (cause: unknown) {
      cleanup = {
        status: "pending",
        lease,
        reason: cause instanceof Error ? cause.message : String(cause),
      };
    }
    const snapshot = supervisor.snapshot();
    return {
      outcome:
        outcome === "exit"
          ? "exited"
          : outcome === "timeout"
            ? "timed-out"
            : "cancelled",
      exitCode: snapshot.exitCode,
      stderr: snapshot.stderr.text,
      stderrBytes: snapshot.stderr.bytes,
      cleanup,
    };
  };

const privateDisplayProbeCommand = (
  helperPath: string,
  strategy: LinuxPrivateDisplayRunnableStrategy,
): { readonly command: string; readonly arguments: readonly string[] } =>
  strategy === "direct"
    ? {
        command: PYTHON_PATH,
        arguments: [helperPath, "--probe", "--strategy", "direct"],
      }
    : {
        command: UNSHARE_PATH,
        arguments: [
          "--user",
          "--map-root-user",
          "--mount",
          "--propagation",
          "private",
          PYTHON_PATH,
          helperPath,
          "--probe",
          "--strategy",
          "user-mount-namespace",
          "--mount-private-x11",
        ],
      };

const evaluatedProbe = async (
  strategy: LinuxPrivateDisplayRunnableStrategy,
  options: {
    readonly helperPath: string;
    readonly environment?: Readonly<NodeJS.ProcessEnv>;
    readonly signal?: AbortSignal;
  },
  timeoutMs: number,
  runner: LinuxPrivateDisplayProbeRunner,
): Promise<
  | {
      readonly ok: true;
      readonly strategy: LinuxPrivateDisplayRunnableStrategy;
      readonly diagnostic: HopperStartupReadyDiagnostic;
    }
  | {
      readonly ok: false;
      readonly diagnostic: HopperStartupFailureDiagnostic;
      readonly cleanup?: PendingPrivateDisplayCleanup;
    }
> => {
  let processResult: LinuxPrivateDisplayProbeProcessResult;
  try {
    processResult = await runner(strategy, {
      helperPath: options.helperPath,
      ...(options.environment === undefined
        ? {}
        : { environment: options.environment }),
      timeoutMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (cause: unknown) {
    // Runner failure is reported with the synthetic probe_failed diagnostic.
    void cause;
    return {
      ok: false,
      diagnostic: syntheticDiagnostic(strategy, "probe_failed"),
    };
  }
  const cleanup =
    processResult.cleanup.status === "pending"
      ? processResult.cleanup
      : undefined;
  const failed = (reason: string) => ({
    ok: false as const,
    diagnostic: syntheticDiagnostic(strategy, reason),
    ...(cleanup === undefined ? {} : { cleanup }),
  });
  if (processResult.outcome === "cancelled") return failed("cancelled");
  if (processResult.outcome === "timed-out") return failed("probe_timeout");
  if (processResult.outcome === "launch-failed") return failed("probe_failed");
  if (cleanup !== undefined) return failed("cleanup_incomplete");
  const parsed = parseLinuxPrivateDisplayDiagnostic(processResult.stderr);
  if (!parsed.ok)
    return {
      ok: false,
      diagnostic: syntheticDiagnostic(strategy, parsed.reason),
    };
  const diagnostic = parsed.value;
  if (
    diagnostic.strategy !== strategy ||
    diagnostic.operation !== "probe" ||
    !exitMatchesDiagnostic(processResult.exitCode, diagnostic)
  )
    return {
      ok: false,
      diagnostic: syntheticDiagnostic(strategy, "diagnostic_malformed"),
    };
  return diagnostic.status === "ready"
    ? { ok: true, strategy, diagnostic }
    : { ok: false, diagnostic };
};

const exitMatchesDiagnostic = (
  exitCode: number | null | undefined,
  diagnostic: HopperStartupDiagnostic,
): boolean =>
  diagnostic.status === "ready"
    ? exitCode === 0
    : hopperStartupExitCode(diagnostic.failure_code) === exitCode;

const syntheticDiagnostic = (
  strategy: LinuxPrivateDisplayRunnableStrategy,
  reason: string,
  failureCode: HopperStartupFailureCode = "private_display_unavailable",
): HopperStartupFailureDiagnostic => ({
  component: "hopper_private_display",
  operation: "probe",
  status: "error",
  failure_code: failureCode,
  reason,
  socket_directory: "/tmp/.X11-unix",
  socket_directory_mode: null,
  mount_read_only: null,
  effective_socket_directory_mode: null,
  effective_mount_read_only: null,
  wsl: false,
  strategy,
  fallback_reason: null,
  xvfb_stderr_bytes: 0,
});

const unavailable = (
  diagnostic: HopperStartupFailureDiagnostic,
  cleanup?: PendingPrivateDisplayCleanup,
): LinuxPrivateDisplaySelection => ({
  ok: false,
  strategy: "unavailable",
  exitCode: hopperStartupExitCode(diagnostic.failure_code) ?? 70,
  diagnostic: { ...diagnostic, strategy: "unavailable" },
  ...(cleanup === undefined ? {} : { cleanup }),
});

const emptyProcessResult = (
  outcome: Extract<
    LinuxPrivateDisplayProbeProcessResult["outcome"],
    "cancelled" | "launch-failed"
  >,
): LinuxPrivateDisplayProbeProcessResult => ({
  outcome,
  exitCode: undefined,
  stderr: "",
  stderrBytes: 0,
  cleanup: { status: "released" },
});

const waitForProbeOutputClose = async (
  supervisor: ProviderProcessSupervisor,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<"exit" | "timeout" | "cancelled"> => {
  if (signal?.aborted === true) return "cancelled";
  const closed = await supervisor.waitForOutputClose(
    Math.max(1, timeoutMs),
    signal,
  );
  return closed ? "exit" : isAborted(signal) ? "cancelled" : "timeout";
};
