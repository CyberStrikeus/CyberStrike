import { GhidraAdmissionError } from "./GhidraAdmissionError.js";
import { retainOwnedCommandCleanup } from "../providers/OwnedCommandCleanup.js";
import { analysisClientFailureForOperation } from "../providers/AnalysisClientFailure.js";
import { randomUUID } from "node:crypto";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import type { RetainedResourceScope } from "../application/AnalysisProvider.js";
import { DarwinProcessOwnershipInspectionError } from "../process/DarwinProcessRunTokenReader.js";
import {
  OwnedCommandFailure,
  runOwnedCommand,
  prepareOwnedCommand,
} from "../process/OwnedCommand.js";
import type { ProviderProcessSnapshot } from "../process/ProviderProcess.js";
import { boundedUtf8Text } from "../process/boundedUtf8Text.js";
import { constants, accessSync, statSync } from "node:fs";
import { posix, win32 } from "node:path";
import { err, ok, type Result } from "../domain/result.js";
import type { AnalysisCapturedOutput } from "../domain/analysisErrorBase.js";

/**
 * Bound the Java version probe so a chatty or hostile JVM cannot force an
 * unbounded in-memory capture. Well-behaved JVMs print a few kilobytes for
 * `-XshowSettings:properties`; the same 1 MiB budget used for other Java
 * listings leaves ample headroom. A probe that exceeds the budget yields no
 * observation and is reported through the existing failed-probe path.
 */
const JAVA_PROBE_MAX_OUTPUT_BYTES = 1024 * 1024;

/** Parsed identity of the JDK selected for Ghidra. */
export interface GhidraJavaObservation {
  readonly version: string;
  readonly major: number;
  readonly home: string;
  readonly bits: number | null;
  /** Present when Java reported a bitness value that could not be parsed exactly. */
  readonly unparsedBits?: string;
  readonly runtime: "jdk" | "jre";
  readonly vmName?: string;
  /**
   * Observed JVM os.arch property, which Ghidra uses to select its native
   * decompiler directory. Omitted when the probe cannot establish it.
   */
  readonly osArch?: string;
  /**
   * Observed JVM os.name property, which Ghidra uses with os.arch to select
   * its native decompiler OS directory. Omitted when the probe cannot
   * establish it.
   */
  readonly osName?: string;
}

/** Expected probe failures retain their producing process facts. */
export interface GhidraJavaProbeFailure {
  readonly _tag: "GhidraJavaProbeFailure";
  readonly code:
    | "runtime_missing"
    | "runtime_unavailable"
    | "version_unresolved";
  readonly detail: string;
  /** Non-enumerable caller reason observed during finalization; the probe failure stays primary. */
  readonly cancellation?: { readonly reason: unknown };
  readonly processErrorCode?: string;
  readonly output?: AnalysisCapturedOutput;
  readonly properties?: {
    readonly version: string | null;
    readonly home: string | null;
    readonly vmName: string | null;
    readonly osArch: string | null;
    readonly osName: string | null;
    readonly bits: number | null;
  };
}

const JAVA_DIAGNOSTIC_STREAM_BYTES = 8192;
const capturedProbeOutput = (
  observed: ProviderProcessSnapshot,
): AnalysisCapturedOutput => {
  const stdout = boundedUtf8Text(
    observed.stdout.text,
    JAVA_DIAGNOSTIC_STREAM_BYTES,
  );
  const stderr = boundedUtf8Text(
    observed.stderr.text,
    JAVA_DIAGNOSTIC_STREAM_BYTES,
  );
  return {
    stdout: stdout.text,
    stderr: stderr.text,
    truncated:
      stdout.truncated ||
      stderr.truncated ||
      observed.diagnosticTruncated === true ||
      observed.outputIncomplete === true,
    stdout_bytes: observed.stdout.observedBytes,
    stderr_bytes: observed.stderr.observedBytes,
    exit_code: observed.exitCode ?? null,
    signal: observed.signal ?? null,
  };
};

const executablePath = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
};
export interface GhidraJavaProbeOptions {
  readonly resourceOwner: RetainedResourceScope;
  readonly signal?: AbortSignal;
  readonly launcher?: NonNullable<
    Parameters<typeof runOwnedCommand>[2]
  >["launcher"];
  /** Tests can shorten the production five-second deadline. */
  readonly timeoutMs?: number;
}

/** Admit one complete probe into its caller's durable cleanup scope. */
export const probeGhidraJava = async (
  command: string,
  environment: NodeJS.ProcessEnv,
  options: GhidraJavaProbeOptions,
): Promise<
  Result<GhidraJavaObservation, GhidraJavaProbeFailure | AnalysisError>
> => {
  try {
    return await options.resourceOwner.run(() =>
      observeGhidraJava(command, environment, options),
    );
  } catch (cause: unknown) {
    return err(
      analysisClientFailureForOperation(cause, "ghidra", "ghidra:java"),
    );
  }
};

/** Own a bounded prerequisite process, its interpretation, and exact cleanup retries. */
const observeGhidraJava = async (
  command: string,
  environment: NodeJS.ProcessEnv,
  options: GhidraJavaProbeOptions,
): Promise<
  Result<GhidraJavaObservation, GhidraJavaProbeFailure | AnalysisError>
> => {
  let interpreted:
    | Result<GhidraJavaObservation, GhidraJavaProbeFailure>
    | undefined;
  try {
    await prepareOwnedCommand(options.signal);
    await runOwnedCommand(
      {
        command,
        arguments: [
          "-Dstdout.encoding=UTF-8",
          "-Dstderr.encoding=UTF-8",
          "-Dsun.stdout.encoding=UTF-8",
          "-Dsun.stderr.encoding=UTF-8",
          "-XX:-UsePerfData",
          "-XshowSettings:properties",
          "-version",
        ],
        runId: randomUUID(),
        expectedCommand: null,
        hostEnvironment: environment,
        sweepTokenOwnedProcesses: true,
      },
      {
        timeoutMs: options.timeoutMs ?? 5000,
        diagnosticBytes: JAVA_PROBE_MAX_OUTPUT_BYTES,
        acceptNonZeroExit: true,
        observeCompleted: (snapshot) => {
          interpreted = parseGhidraJavaOutput(command, snapshot);
        },
      },
      {
        signal: options.signal,
        ...(options.launcher === undefined
          ? {}
          : { launcher: options.launcher }),
      },
    );
    if (interpreted === undefined)
      throw new GhidraAdmissionError("output_unobserved");
    return interpreted;
  } catch (cause: unknown) {
    const commandFailure =
      cause instanceof OwnedCommandFailure ? cause : undefined;
    const preparation =
      commandFailure?.preparationFailure ??
      (cause instanceof DarwinProcessOwnershipInspectionError
        ? cause
        : undefined);
    const output =
      commandFailure?.snapshot === undefined || commandFailure.snapshot === null
        ? preparation?.capturedOutput
        : capturedProbeOutput(commandFailure.snapshot);
    if (
      interpreted !== undefined &&
      !interpreted.ok &&
      commandFailure?.cancellation !== undefined
    )
      Object.defineProperty(interpreted.error, "cancellation", {
        value: commandFailure.cancellation,
      });
    const cleanups = retainOwnedCommandCleanup(
      cause,
      options.resourceOwner,
      "ghidra",
      "ghidra:java",
    );
    let primary: AnalysisError | undefined;
    if (interpreted !== undefined && !interpreted.ok) {
      // A completed, invalid report remains the primary fact across cleanup-time cancellation.
      if (cleanups.length === 0) return interpreted;
      primary = probeFailureError(interpreted.error, cause);
    } else if (
      commandFailure?.reason === "cancelled" &&
      commandFailure.cancellation !== undefined
    ) {
      primary = new AnalysisCancelledError("ghidra:java", {
        cause: commandFailure.cancellation.reason,
        ...(output === undefined ? {} : { capturedOutput: output }),
        ...(interpreted?.ok === true
          ? {
              diagnostics: {
                java_observation: jsonValueSchema.parse(interpreted.value),
              },
            }
          : {}),
      });
    } else if (
      interpreted?.ok === true &&
      commandFailure?.cleanupOwner !== undefined
    ) {
      primary = new ProviderAdapterError("ghidra", "ghidra:java", {
        cause,
        ...(output === undefined ? {} : { capturedOutput: output }),
        diagnostics: {
          java_observation: jsonValueSchema.parse(interpreted.value),
          stage: "cleanup",
          ...(commandFailure.cancellation === undefined
            ? {}
            : { cancellation_observed: true }),
        },
      });
    } else if (preparation !== undefined) {
      primary = new ProviderAdapterError("ghidra", "ghidra:java", {
        cause,
        ...(output === undefined ? {} : { capturedOutput: output }),
        diagnostics: {
          stage: "ownership_preparation",
          ...(preparation.compilerOutcome === undefined
            ? {}
            : {
                compiler_outcome: jsonValueSchema.parse(
                  preparation.compilerOutcome,
                ),
              }),
        },
      });
    } else if (cause instanceof AnalysisError) {
      primary = cause;
    }
    if (primary === undefined) {
      const code =
        commandFailure?.reason === "timeout"
          ? "ETIMEDOUT"
          : commandFailure?.reason === "output-limit"
            ? "ENOBUFS"
            : systemCode(commandFailure?.processError ?? cause);
      const failed: GhidraJavaProbeFailure = {
        _tag: "GhidraJavaProbeFailure",
        code: code === "ENOENT" ? "runtime_missing" : "runtime_unavailable",
        detail: `${command}: ${cause instanceof Error ? cause.message : String(cause)}`,
        ...(code === undefined ? {} : { processErrorCode: code }),
        ...(output === undefined ? {} : { output }),
      };
      if (commandFailure?.cancellation !== undefined)
        Object.defineProperty(failed, "cancellation", {
          value: commandFailure.cancellation,
        });
      if (cleanups.length === 0) return err(failed);
      primary = probeFailureError(failed, cause);
    }
    for (const cleanup of cleanups)
      primary = analysisErrorWithCleanupFailure(
        primary,
        cleanup,
        "ghidra:java",
      ).bindCleanupDependencies([primary, cleanup]);
    return err(primary);
  }
};

const systemCode = (cause: unknown): string | undefined =>
  cause instanceof Error && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;
const probeFailureError = (
  failure: GhidraJavaProbeFailure,
  cause: unknown,
): AnalysisError => {
  const { output, ...facts } = failure;
  return new ProviderAdapterError("ghidra", "ghidra:java", {
    cause,
    ...(output === undefined ? {} : { capturedOutput: output }),
    diagnostics: {
      java_probe_failure: jsonValueSchema.parse(facts),
      ...(failure.cancellation === undefined
        ? {}
        : { cancellation_observed: true }),
    },
  });
};

/** Parse only complete command output; callers retain interruption separately. */
export const parseGhidraJavaOutput = (
  command: string,
  observed: ProviderProcessSnapshot,
): Result<GhidraJavaObservation, GhidraJavaProbeFailure> => {
  if (observed.exitCode !== 0 || observed.signal !== null)
    return err({
      _tag: "GhidraJavaProbeFailure",
      code: "runtime_unavailable",
      detail: `${command}: Java exited ${String(observed.exitCode)}${observed.signal == null ? "" : ` (${observed.signal})`}`,
      output: capturedProbeOutput(observed),
    });
  const output = `${observed.stdout.text}\n${observed.stderr.text}`;
  const version = javaProperty(output, "java.version") || null;
  const home = javaProperty(output, "java.home") || null;
  const vmName = javaProperty(output, "java.vm.name");
  const osArch = javaProperty(output, "os.arch");
  const osName = javaProperty(output, "os.name");
  const reportedBits = javaProperty(output, "sun.arch.data.model");
  const parsedBits =
    reportedBits !== null && /^\d+$/.test(reportedBits)
      ? Number(reportedBits)
      : null;
  const bits =
    parsedBits !== null && Number.isSafeInteger(parsedBits) ? parsedBits : null;
  const major = version === null ? undefined : javaMajor(version);
  if (version === null || home === null || major === undefined)
    return err({
      _tag: "GhidraJavaProbeFailure",
      code: "version_unresolved",
      detail: `${command}: successful Java probe did not establish a valid java.version and nonempty java.home`,
      output: capturedProbeOutput(observed),
      properties: { version, home, vmName, osArch, osName, bits },
    });
  return ok({
    version,
    major,
    home,
    ...(vmName === null ? {} : { vmName }),
    ...(osArch === null ? {} : { osArch }),
    ...(osName === null ? {} : { osName }),
    bits,
    ...(reportedBits === null || bits !== null
      ? {}
      : { unparsedBits: reportedBits }),
    runtime: executablePath(
      (process.platform === "win32" ? win32 : posix).join(
        home,
        "bin",
        process.platform === "win32" ? "javac.exe" : "javac",
      ),
    )
      ? "jdk"
      : "jre",
  });
};
// OpenJDK LauncherHelper prints indentation, the property name, " = ", then
// the scalar value verbatim. Only the one separator space belongs to framing;
// further whitespace is part of the value, including for filesystem paths.
const javaProperty = (output: string, name: string): string | null =>
  new RegExp(
    `^[ \\t]*${name.replaceAll(".", "\\.")} = ([^\\r\\n]*)\\r?$`,
    "mu",
  ).exec(output)?.[1] ?? null;

// Runtime.Version's numeric/pre-release/build grammar; Java 8 used 1.8.0_... .
// https://docs.oracle.com/en/java/javase/24/docs/api/java.base/java/lang/Runtime.Version.html
const javaMajor = (version: string): number | undefined => {
  const legacy =
    /^1\.([1-8])(?:\.[0-9]+)*(?:_[0-9]+)?(?:-[-a-zA-Z0-9.]+)?$/u.exec(version);
  if (legacy?.[1] !== undefined) return Number(legacy[1]);
  const modern =
    /^(?<number>[1-9][0-9]*(?:(?:\.0)*\.[1-9][0-9]*)*)(?:(?:-[a-zA-Z0-9]+)?\+(?<build>0|[1-9][0-9]*)(?:-[-a-zA-Z0-9.]+)?|-[a-zA-Z0-9]+(?:-[-a-zA-Z0-9.]+)?|\+-[-a-zA-Z0-9.]+)?$/u.exec(
      version,
    );
  const number = modern?.groups?.number;
  if (number === undefined) return undefined;
  const parts = number.split(".").map(Number);
  const build = modern?.groups?.build;
  // Runtime.Version parses numeric components and the build as Java integers.
  if (
    [...parts, ...(build === undefined ? [] : [Number(build)])].some(
      (value) => !Number.isSafeInteger(value) || value > 0x7fffffff,
    )
  )
    return undefined;
  return parts[0];
};
