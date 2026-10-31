import {
  selectArtifactCommandPath,
  type ArtifactCommandPath,
} from "../process/ArtifactCommandPath.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  FIRMWARE_TOOL_REQUIREMENTS,
  type FirmwareEngineName,
} from "../contracts/firmware/firmwareToolRequirements.js";
import { randomUUID } from "node:crypto";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute } from "node:path";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type {
  AnalysisError,
  AnalysisCapturedOutput,
} from "../domain/analysisErrorBase.js";
import { projectAnalysisErrorWithoutCapturedOutput } from "../domain/analysisErrorProjection.js";
import type { FirmwareDeadline } from "./FirmwareDeadline.js";
import {
  firmwareCancellation,
  firmwareFailure,
  firmwareLimitRecovery,
  firmwarePhaseInterruption,
  firmwareProcessLimitRecovery,
  firmwareSignalLimitError,
} from "./FirmwareFailures.js";
import { prlimitArgumentVector } from "../process/LinuxResourceLimits.js";
import { cleanupOwnedProcessGroup } from "../process/ProcessOwnership.js";
import {
  spawnOwnedProviderProcess,
  ProviderProcessSupervisor,
  type OwnedProviderProcessSpawnOptions,
  type ProviderProcessSnapshot,
  type SpawnedOwnedProviderProcess,
} from "../process/ProviderProcess.js";
import { FIRMWARE_LIMITS } from "./FirmwareRelease.js";
import {
  FirmwareFileAccess,
  inventoryFirmwareOutput,
} from "./FirmwareFiles.js";

/** Injectable owned launcher for production protocol and lifecycle tests. */
export type FirmwareLauncher = (
  options: OwnedProviderProcessSpawnOptions,
) => Promise<SpawnedOwnedProviderProcess>;

/** Captured tool output for one finished firmware command, including byte coverage. */
const capturedFirmwareOutput = (
  snapshot: ProviderProcessSnapshot,
): AnalysisCapturedOutput => ({
  stdout: snapshot.stdout.text,
  stderr: snapshot.stderr.text,
  stdout_bytes: snapshot.stdout.bytes,
  stderr_bytes: snapshot.stderr.bytes,
  exit_code: snapshot.exitCode ?? null,
  signal: snapshot.signal ?? null,
  truncated: snapshot.diagnosticTruncated === true,
});

/** Refuse an unmet host or tool requirement, which another target cannot satisfy. */
export const firmwareToolUnavailable = (
  engine: string,
  operation: string,
  reason: string,
): AnalysisCapabilityUnavailableError =>
  new AnalysisCapabilityUnavailableError(engine, operation, reason, {
    userMessage: reason,
  });

/** Firmware engines run only on Linux; discovery and execution share this check. */
export const firmwareHostSupported = (platform: NodeJS.Platform): boolean =>
  platform === "linux";

/** Resolve explicitly supplied executable paths; never install or search for engines. */
export const resolveFirmwareCommand = async (
  environment: Readonly<Record<string, string | undefined>>,
  engine: FirmwareEngineName,
  operation: string,
  files: FirmwareFileAccess,
  signal?: AbortSignal,
) => {
  const variable = FIRMWARE_TOOL_REQUIREMENTS[engine].commandEnvironment;
  const configured = environment[variable];
  if (
    !firmwareHostSupported(process.platform) ||
    configured === undefined ||
    !isAbsolute(configured)
  )
    throw firmwareToolUnavailable(
      engine,
      operation,
      `This integration requires Linux and an absolute ${variable} path to the caller-supplied tool`,
    );
  const selection = await selectArtifactCommandPath(configured, signal).catch(
    (cause: unknown) => {
      if (cause instanceof ArtifactReaderFailure) throw cause;
      throw firmwareToolUnavailable(
        engine,
        operation,
        `${variable} is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    },
  );
  const command = selection.invocationPath;
  let sha256: string;
  try {
    await access(command, constants.R_OK | constants.X_OK);
    if (!(await stat(command)).isFile())
      throw new TypeError("Configured path is not a regular file");
    sha256 = await files.hash(selection.resolvedPath, signal);
  } catch (cause: unknown) {
    if (cause instanceof ArtifactReaderFailure) throw cause;
    throw firmwareToolUnavailable(
      engine,
      operation,
      `${variable} is not a readable executable regular file: ${command}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const limiter =
    environment.REA_FIRMWARE_PRLIMIT_COMMAND ?? "/usr/bin/prlimit";
  if (!isAbsolute(limiter))
    throw firmwareToolUnavailable(
      engine,
      operation,
      "REA_FIRMWARE_PRLIMIT_COMMAND must be absolute",
    );
  let limiterSelection: ArtifactCommandPath;
  try {
    limiterSelection = await selectArtifactCommandPath(limiter, signal);
    await access(limiterSelection.resolvedPath, constants.X_OK);
    if (!(await stat(limiter)).isFile())
      throw new TypeError("Configured path is not a regular file");
  } catch (cause: unknown) {
    if (cause instanceof ArtifactReaderFailure) throw cause;
    throw firmwareToolUnavailable(
      engine,
      operation,
      `Resource limiter is not an executable regular file: ${limiter}: ${cause instanceof Error ? cause.message : String(cause)}; provide util-linux prlimit`,
    );
  }
  return {
    command: selection,
    limiter: limiterSelection,
    sha256,
    fileSizeCeiling: await files.fileSizeCeiling(signal),
  };
};

/** Execute one bounded provider command and verify its owned descendants have stopped. */
export const runFirmwareCommand = async (context: {
  engine: string;
  operation: string;
  command: string;
  limiter: string;
  /** Observed inherited soft/hard file policy; never raised by metadata headroom. */
  fileSizeCeiling: number;
  args: readonly string[];
  cwd: string;
  environment: Readonly<Record<string, string | undefined>>;
  signal: AbortSignal;
  deadline: FirmwareDeadline;
  launcher?: FirmwareLauncher;
  outputBudget?: { root: string; bytes: number; entries: number };
  acceptReportedExtractionFailure?: boolean;
  retainCleanup(supervisor: ProviderProcessSupervisor): void;
}) => {
  const { engine, operation, signal } = context;
  // RLIMIT_FSIZE covers every producer file, including mandatory reports/logs.
  // Aggregate extracted payload remains governed by outputBudget inventory.
  const fileSizeBytes = Math.min(
    context.fileSizeCeiling,
    Math.max(
      context.outputBudget?.bytes ?? 0,
      FIRMWARE_LIMITS.reportBytes,
      FIRMWARE_LIMITS.diagnosticBytes,
    ),
  );
  const fileSizeAdjustable =
    context.outputBudget !== undefined &&
    context.fileSizeCeiling > context.outputBudget.bytes &&
    context.outputBudget.bytes >=
      Math.max(FIRMWARE_LIMITS.reportBytes, FIRMWARE_LIMITS.diagnosticBytes);
  const checkInterruption = () => {
    const failure = firmwarePhaseInterruption(
      operation,
      signal,
      context.deadline,
    );
    if (failure !== undefined) throw failure;
  };
  checkInterruption();
  const runId = `rea-firmware-${randomUUID()}`;
  const spawned = await (context.launcher ?? spawnOwnedProviderProcess)({
    command: context.limiter,
    arguments: [
      ...prlimitArgumentVector(
        {
          address_space_bytes: FIRMWARE_LIMITS.addressSpaceBytes,
          file_bytes: fileSizeBytes,
          cpu_seconds: FIRMWARE_LIMITS.cpuSeconds,
        },
        context.command,
      ),
      ...context.args,
    ],
    expectedCommand: null,
    runId,
    cwd: context.cwd,
    hostEnvironment: context.environment,
    signal,
    env: {
      TMPDIR: context.cwd,
      OMP_NUM_THREADS: "1",
      OPENBLAS_NUM_THREADS: "1",
      RAYON_NUM_THREADS: "1",
      NO_COLOR: "1",
    },
  }).catch((cause: unknown) => {
    // Owned admission can reject before a supervisor/child exists. Attribute
    // only this signal's raw reason or a linked Node AbortError, never an
    // unrelated failure merely because a timer also fired.
    if (
      signal.aborted &&
      (cause === signal.reason ||
        (cause instanceof Error &&
          cause.name === "AbortError" &&
          cause.cause === signal.reason))
    )
      throw firmwareCancellation(operation, signal.reason, context.deadline);
    throw cause;
  });
  let failure: AnalysisError | undefined;
  const isFailedExit = (code: number | null | undefined) =>
    code !== undefined &&
    code !== 0 &&
    !(context.acceptReportedExtractionFailure === true && code === 1);
  const completedFailure = (snapshot: ProviderProcessSnapshot) => {
    if (isFailedExit(snapshot.exitCode)) {
      const signalLimit = firmwareSignalLimitError(
        operation,
        snapshot.signal,
        fileSizeBytes,
        fileSizeAdjustable,
        capturedFirmwareOutput(snapshot),
      );
      if (signalLimit !== undefined) return signalLimit;
      return new ProviderAdapterError(engine, operation, {
        diagnostics: {
          reason:
            "Tool failed; inspect exit status and stderr for format, dependency, sandbox or resource-limit failures",
          exit_code: snapshot.exitCode ?? null,
          signal: snapshot.signal ?? null,
          stdout: snapshot.stdout.text,
          stderr: snapshot.stderr.text,
          stdout_bytes: snapshot.stdout.bytes,
          stderr_bytes: snapshot.stderr.bytes,
          truncated: snapshot.diagnosticTruncated === true,
        },
        remediationAction: `Inspect exit status and stderr for format, dependency, sandbox, or resource-limit failures. ${firmwareProcessLimitRecovery(fileSizeBytes, fileSizeAdjustable)} A format or dependency failure is not repaired by changing analysis_timeout_ms.`,
      });
    }
    return undefined;
  };
  let completedFailureObserved = false;
  let diagnosticTruncated = false;
  const supervisor = new ProviderProcessSupervisor(
    {
      ...spawned,
      ownsProcessLifetime: true,
      cleanup:
        spawned.cleanup ?? (() => cleanupOwnedProcessGroup(spawned.ownership)),
    },
    {
      maxDiagnosticBytes: FIRMWARE_LIMITS.diagnosticBytes,
      onDiagnostic: (event) => {
        if (event.type === "output" && event.truncated === true)
          diagnosticTruncated = true;
        // Root exit and inherited-pipe closure are different observations.
        // Retain a completed failure before drain or cleanup can be interrupted,
        // while cancellation already present at exit keeps its precedence.
        if (
          event.type === "exit" &&
          failure === undefined &&
          !diagnosticTruncated &&
          firmwarePhaseInterruption(operation, signal, context.deadline) ===
            undefined
        )
          completedFailureObserved = isFailedExit(event.code);
      },
    },
  );
  const checkDiagnostics = () => {
    if (diagnosticTruncated) {
      const snapshot = supervisor.snapshot();
      throw new AnalysisOutputError(
        operation,
        `Tool diagnostics exceeded the ${FIRMWARE_LIMITS.diagnosticBytes}-byte capture budget`,
        {
          capturedOutput: {
            stdout: snapshot.stdout.text,
            stderr: snapshot.stderr.text,
            truncated: true,
          },
          userMessage: `Firmware diagnostics exceeded the ${String(FIRMWARE_LIMITS.diagnosticBytes)}-byte capture allowance. This release has no runtime override.`,
          remediationAction: firmwareLimitRecovery(
            `The firmware diagnostic capture allowance is ${String(FIRMWARE_LIMITS.diagnosticBytes)} bytes`,
          ),
        },
      );
    }
  };
  try {
    while (!(await supervisor.waitForOutputClose(100))) {
      checkDiagnostics();
      checkInterruption();
      if (context.outputBudget !== undefined)
        await inventoryFirmwareOutput(
          context.outputBudget.root,
          context.outputBudget.bytes,
          context.outputBudget.entries,
          operation,
          signal,
        );
    }
    checkDiagnostics();
    checkInterruption();
  } catch (cause: unknown) {
    failure ??= firmwareFailure(cause, context);
  }
  const stopped = await supervisor.stop();
  // Cleanup is an awaited part of this phase. Preserve a prior observed failure,
  // otherwise retain an interruption that arrived while stopping owned resources.
  failure ??= firmwarePhaseInterruption(operation, signal, context.deadline);
  const snapshot = supervisor.snapshot();
  // Capture diagnostics only after owned cleanup has drained the inherited pipes.
  if (completedFailureObserved) failure = completedFailure(snapshot);
  if (stopped.status === "incomplete") {
    context.retainCleanup(supervisor);
    const previous =
      failure === undefined
        ? undefined
        : projectAnalysisErrorWithoutCapturedOutput(failure);
    // Retain typed recovery history, but give captured output exactly one owner.
    throw new ProviderCleanupError(
      engine,
      [runId, context.cwd],
      {
        reason: stopped.reason,
        leader_pid: spawned.ownership.leaderPid,
        process_group_id: spawned.ownership.processGroupId,
        previous_error: previous ?? null,
      },
      {
        operation,
        cleanupPrimary: failure,
        capturedOutput: capturedFirmwareOutput(snapshot),
      },
    );
  }
  if (failure !== undefined) throw failure;
  return {
    stdout: snapshot.stdout,
    stderr: snapshot.stderr,
    exit_code: snapshot.exitCode,
    signal: snapshot.signal ?? null,
    command: context.command,
    args: [...context.args],
    resource_limiter: context.limiter,
  };
};

/**
 * Consume the report a completed command was asked to write. A successful exit
 * status is not analysis Evidence by itself: an absent, empty or malformed report
 * fails with the observed report state and command facts, without retrying or
 * substituting an empty result.
 */
export const readFirmwareCommandReport = async (context: {
  path: string;
  engine: string;
  operation: string;
  execution: Awaited<ReturnType<typeof runFirmwareCommand>>;
  files: FirmwareFileAccess;
  signal?: AbortSignal;
}): Promise<unknown> => {
  try {
    return await context.files.report(
      context.path,
      context.operation,
      context.signal,
    );
  } catch (cause: unknown) {
    if (cause instanceof ArtifactReaderFailure) throw cause;
    const { engine, operation, execution } = context;
    const reportFailure =
      cause instanceof AnalysisOutputError
        ? cause.reason
        : `Report could not be read: ${cause instanceof Error ? cause.message : String(cause)}`;
    const diagnostics = {
      ...(cause instanceof AnalysisOutputError ? cause.diagnostics : {}),
      report_path: context.path,
      report_failure: reportFailure,
      command: execution.command,
      args: execution.args,
      resource_limiter: execution.resource_limiter,
      exit_code: execution.exit_code ?? null,
      signal: execution.signal,
      stdout: execution.stdout.text,
      stderr: execution.stderr.text,
      stdout_bytes: execution.stdout.bytes,
      stderr_bytes: execution.stderr.bytes,
    };
    if (execution.exit_code === 1)
      throw new ProviderAdapterError(engine, operation, {
        cause,
        diagnostics: {
          reason:
            "Tool exited 1 without a usable analysis report; inspect stderr for startup, sandbox or dependency failures",
          ...diagnostics,
        },
      });
    const oversized =
      cause instanceof AnalysisOutputError &&
      cause.diagnostics?.report_state === "oversized";
    const reportFacts =
      "Review diagnostics.report_state, the exit status and captured stdout/stderr. REA did not retry or substitute an empty result. diagnostics.command and diagnostics.args record what ran; their workspace paths are REA-private and removed after the attempt, so they cannot be replayed as-is.";
    const reportAllowance = firmwareLimitRecovery(
      `The firmware report allowance is ${String(FIRMWARE_LIMITS.reportBytes)} bytes`,
    );
    const observed = `${engine} exited successfully but left no usable report (${reportFailure}), so ${operation} produced no Evidence. A successful exit status is not an empty or complete result.`;
    throw new AnalysisOutputError(
      operation,
      `${engine} exited ${String(execution.exit_code)} without a usable report: ${reportFailure}`,
      {
        cause,
        diagnostics,
        userMessage: oversized ? `${observed} ${reportAllowance}` : observed,
        remediationAction: oversized
          ? `${reportFacts} ${reportAllowance} \`rea doctor\` checks configuration only and cannot recover this report.`
          : `${reportFacts} Rerun the same REA request to check whether this is intermittent; each attempt uses a fresh workspace. If it recurs, copy the selected input bytes into a new directory and run diagnostics.command with the same flags, replacing every private path with your copy and a new report path, under the documented firmware resource limits; confirm that it writes the requested report. \`rea doctor\` checks configuration only and cannot recover this report.`,
      },
    );
  }
};
