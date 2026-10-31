import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import {
  assertArtifactCommandPath,
  type ArtifactCommandPath,
} from "../process/ArtifactCommandPath.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { artifactFileCancellationCause } from "../artifacts/ArtifactFileOperation.js";
import { randomUUID } from "node:crypto";
import { fixedAllowanceOptions } from "../domain/fixedAllowanceRemediation.js";
import {
  AnalysisError,
  type AnalysisCapturedOutput,
} from "../domain/analysisErrorBase.js";
import { createPcapDiagnosticProjection } from "./PcapDiagnosticOutput.js";
import {
  AnalysisCancelledError,
  AnalysisProtocolError,
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import {
  OwnedCommandFailure,
  ownedCommandResources,
  prepareOwnedCommand,
  runOwnedCommand,
} from "../process/OwnedCommand.js";
import type {
  ProviderProcessSupervisor,
  ProviderProcessSnapshot,
} from "../process/ProviderProcess.js";
import {
  isWindowsBatchFile,
  windowsBatchCommand,
  WindowsBatchCommandError,
} from "../process/WindowsBatchCommand.js";
import { pcapToolUnavailable } from "./PcapConfiguration.js";

export type PcapCommandLauncher = NonNullable<
  Parameters<typeof runOwnedCommand>[2]
>["launcher"];

export interface PcapCommandCleanup {
  readonly reason: string;
  readonly resources: readonly string[];
  readonly capturedOutput: AnalysisCapturedOutput;
}

export interface PcapCommandOutput {
  /** Lazy safe diagnostics; raw stdout remains owned by the successful parser. */
  readonly capturedOutput: AnalysisCapturedOutput;
  readonly stdout: string;
  readonly stderr: string;
  readonly invalidUtf8Streams: readonly ("stdout" | "stderr")[];
  readonly cleanup?: PcapCommandCleanup;
}

export interface PcapCommandLimits {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

/** Owned process execution shared by version probes and capture reads. */
export const runPcapCommand = async (options: {
  readonly operation: string;
  readonly command: string;
  readonly arguments: readonly string[];
  readonly limits: PcapCommandLimits;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal | undefined;
  readonly inputPath?: string;
  readonly redactHttpTransportCredentials?: boolean;
  readonly nativeBound?: {
    readonly limiter?: {
      command: ArtifactCommandPath;
      arguments: readonly string[];
    };
    readonly memoryLimitBytes?: number;
  };
  readonly launcher?: PcapCommandLauncher;
  readonly retain: (
    owner: ProviderProcessSupervisor,
    resources: readonly string[],
    reason: string,
    capturedOutput: PcapCommandCleanup["capturedOutput"],
  ) => void;
}): Promise<PcapCommandOutput> => {
  const { operation, command, limits, signal } = options;
  const projectDiagnostic = createPcapDiagnosticProjection(
    options.redactHttpTransportCredentials === true,
  );
  const captureDiagnostic = (
    snapshot: ProviderProcessSnapshot,
  ): AnalysisCapturedOutput =>
    projectDiagnostic({
      stdout: snapshot.stdout.text,
      stderr: snapshot.stderr.text,
      stdout_bytes: snapshot.stdout.bytes,
      stderr_bytes: snapshot.stderr.bytes,
      exit_code: snapshot.exitCode ?? null,
      signal: snapshot.signal ?? null,
      truncated:
        snapshot.diagnosticTruncated === true ||
        snapshot.outputIncomplete === true,
    });
  if (signal?.aborted)
    throw new AnalysisCancelledError(operation, { cause: signal.reason });
  const hostEnvironment = {
    ...options.environment,
    LC_ALL: "C",
    LANG: "C",
  };
  let cleanup: PcapCommandCleanup | undefined;
  try {
    const batch = process.platform === "win32" && isWindowsBatchFile(command);
    const invocation = batch
      ? windowsBatchCommand({
          environment: hostEnvironment,
          batchPath: command,
          arguments: options.arguments,
        })
      : { command, arguments: options.arguments };
    const boundedInvocation =
      options.nativeBound?.limiter === undefined
        ? invocation
        : {
            command: options.nativeBound.limiter.command.invocationPath,
            arguments: [
              ...options.nativeBound.limiter.arguments,
              invocation.command,
              ...invocation.arguments,
            ],
          };
    // Native ownership preparation has its own bounded compiler lifecycle;
    // do not spend the tool's execution deadline rebuilding a cold SDK cache.
    await prepareOwnedCommand(signal);
    const selectedLimiter = options.nativeBound?.limiter?.command;
    if (selectedLimiter !== undefined)
      await assertArtifactCommandPath(selectedLimiter, operation, { signal });
    const output = await runOwnedCommand(
      {
        ...boundedInvocation,
        runId: randomUUID(),
        hostEnvironment,
        windowsVerbatimArguments: batch,
        expectedCommand: null,
        ...(options.nativeBound?.memoryLimitBytes === undefined
          ? {}
          : { memoryLimitBytes: options.nativeBound.memoryLimitBytes }),
      },
      { timeoutMs: limits.timeoutMs, diagnosticBytes: limits.maxOutputBytes },
      {
        ...(signal === undefined ? {} : { signal }),
        ...(options.launcher === undefined
          ? {}
          : { launcher: options.launcher }),
        retainCleanup: (owner, stopped) => {
          const resources =
            owner.launch.ownership === undefined
              ? ["owned-process"]
              : ownedCommandResources(owner.launch.ownership);
          const snapshot = owner.snapshot();
          const capturedOutput = captureDiagnostic(snapshot);
          options.retain(owner, resources, stopped.reason, capturedOutput);
          cleanup = { reason: stopped.reason, resources, capturedOutput };
        },
      },
    );
    if (selectedLimiter !== undefined)
      await assertArtifactCommandPath(selectedLimiter, operation, {
        get capturedOutput() {
          return captureDiagnostic(output);
        },
      });
    return {
      get capturedOutput() {
        return captureDiagnostic(output);
      },
      stdout: output.stdout.text,
      stderr: output.stderr.text,
      invalidUtf8Streams: [
        ...(output.stdout.invalidUtf8 === true ? (["stdout"] as const) : []),
        ...(output.stderr.invalidUtf8 === true ? (["stderr"] as const) : []),
      ],
      ...(cleanup === undefined ? {} : { cleanup }),
    };
  } catch (cause) {
    if (cause instanceof AnalysisError) {
      if (cleanup !== undefined) {
        const pending = new ProviderCleanupError(
          "pcap",
          cleanup.resources,
          {
            reason: cleanup.reason,
          },
          {
            operation,
            capturedOutput: cleanup.capturedOutput,
            cleanup: { reason: cleanup.reason, resources: cleanup.resources },
          },
        );
        throw analysisErrorWithCleanupFailure(cause, pending, operation);
      }
      throw cause;
    }
    if (cause instanceof ArtifactReaderFailure && cause.reason === "cancelled")
      throw new AnalysisCancelledError(operation, {
        cause: artifactFileCancellationCause(cause),
      });
    if (
      cause instanceof OwnedCommandFailure &&
      cause.cleanupOwner !== undefined
    )
      options.retain(
        cause.cleanupOwner,
        cause.resources,
        cause.cleanupFailure ?? cause.message,
        cause.snapshot === null
          ? { stdout: "", stderr: "", truncated: true }
          : captureDiagnostic(cause.snapshot),
      );
    const details = {
      cause,
      ...(cause instanceof OwnedCommandFailure && cause.snapshot !== null
        ? {
            capturedOutput: captureDiagnostic(cause.snapshot),
          }
        : {}),
      ...(cleanup !== undefined
        ? { cleanup }
        : cause instanceof OwnedCommandFailure && cause.cleanupFailure !== null
          ? {
              cleanup: {
                reason: cause.cleanupFailure,
                resources: cause.resources,
              },
            }
          : {}),
    };
    if (cause instanceof OwnedCommandFailure && cause.reason === "cancelled")
      throw new AnalysisCancelledError(operation, {
        ...details,
        cause: cause.cancellation?.reason,
      });
    if (
      cause instanceof OwnedCommandFailure &&
      cause.snapshot?.memoryLimitReached === true
    )
      throw new AnalysisResourceConstraintError(
        operation,
        "memory",
        "The owned Windows tool tree reached its enforced committed-memory limit.",
        {
          process_memory_limit_bytes:
            options.nativeBound?.memoryLimitBytes ?? null,
        },
        details,
      );
    if (
      cause instanceof OwnedCommandFailure &&
      (cause.snapshot?.signal === "SIGXCPU" ||
        cause.snapshot?.signal === "SIGXFSZ")
    )
      throw new AnalysisResourceConstraintError(
        operation,
        cause.snapshot.signal === "SIGXCPU" ? "cpu" : "file-size",
        `Producer terminated with ${cause.snapshot.signal}; its exact cause is not independently established.`,
        null,
        details,
      );
    if (cause instanceof OwnedCommandFailure && cause.reason === "timeout")
      throw new AnalysisTimeoutError(operation, limits.timeoutMs, details);
    if (cause instanceof OwnedCommandFailure && cause.reason === "output-limit")
      throw new AnalysisResourceConstraintError(
        operation,
        "memory",
        "Tool output exceeded its complete-output budget",
        { max_output_bytes: limits.maxOutputBytes },
        {
          ...details,
          ...fixedAllowanceOptions(
            "The packet-tool output capture allowance",
            "capture",
          ),
        },
      );
    if (
      cause instanceof WindowsBatchCommandError ||
      (cause instanceof Error &&
        "code" in cause &&
        (cause.code === "ENOENT" || cause.code === "EACCES"))
    )
      throw pcapToolUnavailable(
        operation,
        `Cannot run selected tool ${command}: ${cause.message}`,
        details,
      );
    const diagnostic =
      cause instanceof OwnedCommandFailure
        ? cause.snapshot?.stderr.text.trim() || cause.message
        : cause instanceof Error
          ? cause.message
          : String(cause);
    if (options.inputPath === undefined)
      throw pcapToolUnavailable(
        operation,
        `The selected tool ${command} cannot report its version: ${diagnostic}`,
        details,
      );
    if (
      options.inputPath !== undefined &&
      /not a capture file|file.*isn't a capture file|file format.*not supported/iu.test(
        diagnostic,
      )
    )
      throw new AnalysisUnsupportedTargetError(
        operation,
        options.inputPath,
        diagnostic,
        details,
      );
    throw new AnalysisProtocolError(
      `Packet capture tool ${command} failed: ${diagnostic}`,
      details,
    );
  }
};
