import {
  absoluteCallerPath,
  appendCallerPath,
} from "../filesystem/callerPath.js";
import { DEFAULT_JADX_OPERATION_TIMEOUT_MS } from "../domain/analysisResourceLimits.js";
import {
  jadxOperationTimeoutGuidance,
  JADX_OPERATION_TIMEOUT_REMEDIATION,
} from "./JadxOperationTimeout.js";
import { inspectJadxJava, type JadxJavaProbeOptions } from "./JadxJavaProbe.js";
import {
  JadxInterruption,
  throwIfJadxInterrupted,
} from "./JadxInterruption.js";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, resolve } from "node:path";
import { inspectWindowsNativeReadiness } from "../process/WindowsAuthority.js";
import { systemWindowsNativeAuthority } from "../windows/WindowsNativeLoader.js";
import { providerStartupTimeoutSchema } from "../config/providerStartupTimeout.js";
import {
  AnalysisCancelledError,
  AnalysisTimeoutError,
  AnalysisCapabilityUnavailableError,
} from "../domain/analysisErrorCore.js";
import type { AndroidOperation } from "../domain/android/androidAnalysis.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";
import type { ProviderAvailability } from "../application/AnalysisProvider.js";
import { ownedProcessPrerequisiteAvailability } from "../application/ownedProcessAvailability.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  ArtifactFileCancelled,
  ArtifactFileCleanupFailure,
  bindArtifactFileCleanup,
  withArtifactRegularFile,
} from "../artifacts/ArtifactFileOperation.js";
import { analysisClientFailureForOperation } from "../providers/AnalysisClientFailure.js";
import { ZipArtifactReader } from "../artifacts/ZipArtifactReader.js";
import type { DoctorProviderCheck } from "../application/Doctor.js";
import {
  JADX_JAR_CONFIGURATION_REMEDIATION,
  JADX_JAVA_PROBE_REMEDIATION,
  JADX_JAVA_RUNTIME_REMEDIATION,
  JADX_JVM_OPTIONS_REMEDIATION,
  JADX_UNSUPPORTED_HOST_REMEDIATION,
  JADX_WINDOWS_NATIVE_REMEDIATION,
} from "./JadxRelease.js";

// Bound ZIP metadata allocation during discovery. The audited 0.7.1 JAR's
// central directory occupies 2,294,350 bytes; class bodies are not read here.
const JAR_METADATA_READ_MAX_BYTES = 8 * 1024 * 1024;

/** Caller-supplied tools, resolved only when an Android operation is selected. */
export interface JadxConfiguration {
  readonly jar: string;
  readonly java: string;
  readonly jvmArguments: readonly string[];
}

type ConfigurationFailureCode =
  | "not_configured"
  | "executable_missing"
  | "runtime_missing"
  | "runtime_unavailable"
  | "unsupported_host"
  | "unsupported_version"
  | "version_unresolved"
  | "open_options_invalid";

/**
 * Failure kinds tagged at the JADX configuration boundary. Consumers (the
 * doctor adapter) project the boundary's remediation and classification for
 * a kind; they must not reinterpret the phase/setting evidence to derive
 * them.
 */
export type JadxFailureKind =
  | "windows_native_artifact"
  | "windows_native_runtime"
  | "java_runtime"
  | "java_home"
  | "jvm_options"
  | "operation_timeout"
  | "jar"
  | "java_probe"
  | "unsupported_host";

/** Runtime mirror of JadxFailureKind for validating the loose diagnostics tag. */
export const JADX_FAILURE_KINDS: readonly JadxFailureKind[] = [
  "windows_native_artifact",
  "windows_native_runtime",
  "java_runtime",
  "java_home",
  "jvm_options",
  "operation_timeout",
  "jar",
  "java_probe",
  "unsupported_host",
];

export interface JadxFailureOutcome {
  readonly remediation: string;
  readonly classification: DoctorProviderCheck["classification"];
}

/**
 * Project the boundary-owned remediation and classification for a failure
 * kind. A null kind (missing or corrupt tag) keeps JAR guidance, matching
 * the previous fallthrough for unclassified failures.
 */
export const projectJadxFailureOutcome = (
  kind: JadxFailureKind | null,
  configured: boolean,
): JadxFailureOutcome => {
  const drift = configured ? "config_drift" : "missing_analysis_engine";
  switch (kind) {
    case "windows_native_artifact":
      return {
        remediation: JADX_WINDOWS_NATIVE_REMEDIATION,
        classification: "missing_dependency",
      };
    case "windows_native_runtime":
      return {
        remediation: JADX_WINDOWS_NATIVE_REMEDIATION,
        classification: "runtime_failure",
      };
    case "java_runtime":
      return {
        remediation: JADX_JAVA_RUNTIME_REMEDIATION,
        classification: "missing_dependency",
      };
    case "java_home":
      return {
        remediation: JADX_JAVA_RUNTIME_REMEDIATION,
        classification: drift,
      };
    case "jvm_options":
      return {
        remediation: JADX_JVM_OPTIONS_REMEDIATION,
        classification: drift,
      };
    case "operation_timeout":
      return {
        remediation: JADX_OPERATION_TIMEOUT_REMEDIATION,
        classification: drift,
      };
    case "jar":
      return {
        remediation: JADX_JAR_CONFIGURATION_REMEDIATION,
        classification: drift,
      };
    case "java_probe":
      return {
        remediation: JADX_JAVA_PROBE_REMEDIATION,
        classification: drift,
      };
    case "unsupported_host":
      return {
        remediation: JADX_UNSUPPORTED_HOST_REMEDIATION,
        classification: "unsupported_host",
      };
    case null:
      return {
        remediation: JADX_JAR_CONFIGURATION_REMEDIATION,
        classification: drift,
      };
  }
};

class JadxConfigurationFailure extends Error {
  constructor(
    readonly code: ConfigurationFailureCode,
    message: string,
    readonly diagnostics: Readonly<Record<string, JsonValue>>,
    readonly kind: JadxFailureKind,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** Inspect the same JAR and Java prerequisites that gate actual execution. */
export const inspectJadxAvailability = async (
  environment: Readonly<Record<string, string | undefined>>,
  options: JadxJavaProbeOptions & {
    /** Admitted runtime override; omission retains launch configuration. */
    readonly operationTimeoutMs?: number | undefined;
  },
): Promise<ProviderAvailability> => {
  try {
    const operationTimeoutMs = readOperationTimeout(
      environment,
      options.operationTimeoutMs,
    );
    const configuration = await readJadxConfigurationInputs(
      environment,
      options.signal,
    );
    await validateJadxConfigurationContents(
      configuration,
      environment,
      options,
    );
    return {
      status: "available",
      code: null,
      reason: null,
      diagnostics: {
        configured: true,
        java_executable: configuration.java,
        jdk_compiler: true,
        jar_path: configuration.jar,
        operation_timeout_ms: operationTimeoutMs,
      },
    };
  } catch (cause) {
    if (cause instanceof JadxInterruption)
      throw new AnalysisCancelledError(
        options.operation ?? "inspect_jadx_configuration",
        { cause: cause.reason },
      );
    if (cause instanceof JadxConfigurationFailure)
      return {
        status: "unavailable",
        code: cause.code,
        reason: cause.message,
        diagnostics: { ...cause.diagnostics, failure_kind: cause.kind },
      };
    const prerequisite = ownedProcessPrerequisiteAvailability(cause);
    if (prerequisite !== undefined) return prerequisite;
    throw cause;
  }
};

/**
 * Resolve the whole-operation deadline before any admission work starts, so
 * one value bounds the provider operation and each upstream call.
 */
export const resolveJadxOperationTimeout = (
  environment: Readonly<Record<string, string | undefined>>,
  operation: AndroidOperation,
  runtimeTimeoutMs?: number,
): Result<number, AnalysisCapabilityUnavailableError> => {
  try {
    return ok(readOperationTimeout(environment, runtimeTimeoutMs));
  } catch (cause) {
    if (!(cause instanceof JadxConfigurationFailure)) throw cause;
    return err(projectConfigurationFailure(operation, cause));
  }
};

/** Resolve caller-selected paths and JVM options without probing their contents. */
export const resolveJadxConfigurationInputs = async (
  environment: Readonly<Record<string, string | undefined>>,
  operation: AndroidOperation,
  signal?: AbortSignal,
): Promise<JadxConfiguration> => {
  try {
    return await readJadxConfigurationInputs(environment, signal);
  } catch (cause) {
    if (!(cause instanceof JadxConfigurationFailure)) throw cause;
    throw projectConfigurationFailure(operation, cause);
  }
};

/** Probe Java and archive prerequisites before starting a new engine session. */
export const validateJadxConfiguration = async (
  configuration: JadxConfiguration,
  environment: Readonly<Record<string, string | undefined>>,
  operation: AndroidOperation,
  options: JadxJavaProbeOptions,
): Promise<void> => {
  try {
    await validateJadxConfigurationContents(configuration, environment, {
      ...options,
      operation,
    });
  } catch (cause) {
    if (!(cause instanceof JadxConfigurationFailure)) throw cause;
    throw projectConfigurationFailure(operation, cause);
  }
};

const readJadxConfigurationInputs = async (
  environment: Readonly<Record<string, string | undefined>>,
  signal?: AbortSignal,
): Promise<JadxConfiguration> => {
  throwIfJadxInterrupted(signal);
  requireSupportedHost();
  const jar = await resolveJar(environment);
  const java = await resolveJava(environment, signal);
  await requireJavaHomeExecutable(environment.JAVA_HOME, java);
  throwIfJadxInterrupted(signal);
  return { jar, java, jvmArguments: resolveJvmArguments(environment) };
};

const validateJadxConfigurationContents = async (
  configuration: JadxConfiguration,
  environment: Readonly<Record<string, string | undefined>>,
  options: JadxJavaProbeOptions,
): Promise<void> => {
  throwIfJadxInterrupted(options.signal);
  await inspectJavaRuntime(configuration.java, environment, options);
  await requireEngineArchive(configuration.jar, options);
};

const projectConfigurationFailure = (
  operation: string,
  cause: JadxConfigurationFailure,
): AnalysisCapabilityUnavailableError => {
  const output = cause.diagnostics;
  const { stdout: _stdout, stderr: _stderr, ...facts } = output;
  return new AnalysisCapabilityUnavailableError(
    "jadx",
    operation,
    cause.message,
    {
      cause,
      userMessage: cause.message,
      diagnostics: {
        ...facts,
        failure_kind: cause.kind,
        failure_code: cause.code,
      },
      ...(typeof output.stdout === "string" && typeof output.stderr === "string"
        ? {
            capturedOutput: {
              stdout: output.stdout,
              stderr: output.stderr,
              truncated: output.output_truncated === true,
            },
          }
        : {}),
    },
  );
};

const requireEngineArchive = async (
  jar: string,
  options: JadxJavaProbeOptions,
): Promise<void> => {
  const operation = options.operation ?? "inspect_jadx_configuration";
  try {
    await options.resourceOwner.run(() =>
      withArtifactRegularFile(
        jar,
        {
          retain: ({ lease, resource }) =>
            options.resourceOwner.retain(
              {
                close: () => lease.release(),
              },
              resource,
            ),
        },
        options.signal,
        async ({ handle, initial }) => {
          try {
            // Metadata enumeration borrows this descriptor. The file workflow
            // alone owns admission, final close, cancellation and failed retry.
            const reader = new ZipArtifactReader(
              jar,
              "zip",
              JAR_METADATA_READ_MAX_BYTES,
              { handle, initial },
            );
            const missing = new Set([
              "com/atxx/jhmcp/JadxSession.class",
              "com/atxx/jhmcp/SessionHolder.class",
              "jadx/api/JadxDecompiler.class",
              "com/google/gson/Gson.class",
              "io/modelcontextprotocol/kotlin/sdk/server/Server.class",
            ]);
            for await (const entry of reader.entries(options.signal)) {
              if (entry.kind === "file" && !entry.encrypted)
                missing.delete(entry.path);
              if (missing.size === 0) return;
            }
            throw configurationFailure(
              "unsupported_version",
              `REA_JADX_MCP_JAR ${jar} does not contain the required metadata bridge classes: ${[...missing].join(", ")}. ${JADX_JAR_CONFIGURATION_REMEDIATION}`,
              {
                jar_path: jar,
                phase: "jar-inspection",
                missing_classes: [...missing],
              },
              "jar",
            );
          } catch (cause: unknown) {
            if (
              cause instanceof JadxConfigurationFailure ||
              (cause instanceof ArtifactReaderFailure &&
                cause.reason === "cancelled")
            )
              throw cause;
            throw archiveInspectionFailure(jar, cause);
          }
        },
      ),
    );
  } catch (cause: unknown) {
    if (cause instanceof ArtifactFileCleanupFailure) {
      const physical = cause.fileCleanupFailure;
      const cleanup = new ProviderCleanupError(
        "jadx",
        [jar],
        {
          phase: "jar-inspection",
          ...(physical.outcome.kind === "completed"
            ? { archive_observation: { jar_path: jar, required_classes: true } }
            : {}),
        },
        { operation, cause: physical.cleanupCause },
      );
      bindArtifactFileCleanup(cause, cleanup);
      const primary =
        physical.outcome.kind === "failed"
          ? archiveAnalysisFailure(jar, physical.outcome.cause, options)
          : physical.completionCancellation === undefined
            ? undefined
            : archiveCancellation(
                physical.completionCancellation.reason,
                options,
                {
                  archive_observation: {
                    jar_path: jar,
                    required_classes: true,
                  },
                },
              );
      if (primary === undefined) throw cleanup;
      throw analysisErrorWithCleanupFailure(
        primary,
        cleanup,
        operation,
      ).bindCleanupDependencies([primary, cleanup]);
    }
    if (cause instanceof ArtifactFileCancelled) {
      throw archiveCancellation(cause.fileCancellation.reason, options, {
        archive_observation: { jar_path: jar, required_classes: true },
      });
    }
    if (cause instanceof ArtifactReaderFailure) {
      if (cause.reason === "cancelled")
        throw archiveCancellation(cause.cancellation?.reason, options);
      throw analysisClientFailureForOperation(cause, "jadx", operation);
    }
    if (
      cause instanceof AnalysisError ||
      cause instanceof JadxConfigurationFailure
    )
      throw cause;
    throw archiveInspectionFailure(jar, cause);
  }
};

const archiveInspectionFailure = (jar: string, cause: unknown) => {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return configurationFailure(
    "version_unresolved",
    `Cannot inspect REA_JADX_MCP_JAR ${jar} as a Java archive: ${reason}. ${JADX_JAR_CONFIGURATION_REMEDIATION}`,
    {
      jar_path: jar,
      phase: "jar-inspection",
      archive_error: reason,
      maximum_metadata_read_bytes: JAR_METADATA_READ_MAX_BYTES,
    },
    "jar",
    cause,
  );
};

const archiveAnalysisFailure = (
  jar: string,
  cause: unknown,
  options: JadxJavaProbeOptions,
): AnalysisError => {
  if (cause instanceof AnalysisError) return cause;
  if (cause instanceof ArtifactReaderFailure && cause.reason === "cancelled")
    return archiveCancellation(cause.cancellation?.reason, options);
  return projectConfigurationFailure(
    options.operation ?? "inspect_jadx_configuration",
    cause instanceof JadxConfigurationFailure
      ? cause
      : archiveInspectionFailure(jar, cause),
  );
};

const archiveCancellation = (
  reason: unknown,
  options: JadxJavaProbeOptions,
  diagnostics?: Readonly<Record<string, JsonValue>>,
) => {
  const operation = options.operation ?? "inspect_jadx_configuration";
  return options.operationDeadline?.signal.aborted === true &&
    reason === options.operationDeadline.signal.reason
    ? new AnalysisTimeoutError(operation, options.operationDeadline.timeoutMs, {
        cause: reason,
        diagnostics,
        ...jadxOperationTimeoutGuidance(options.operationDeadline.timeoutMs),
      })
    : new AnalysisCancelledError(operation, { cause: reason, diagnostics });
};

const requireSupportedHost = (): void => {
  if (process.platform === "linux" || process.platform === "darwin") return;
  if (process.platform === "win32" && process.arch === "x64") {
    const loaded = systemWindowsNativeAuthority();
    if (loaded.available) {
      if (loaded.authority.inspection.protocolStdin === true) return;
      throw configurationFailure(
        "runtime_missing",
        "The bundled Windows native artifact lacks owned protocol stdin; use a matching current Windows x64 REA package.",
        {
          platform: process.platform,
          architecture: process.arch,
          phase: "process-ownership",
          owned_protocol_stdin: false,
        },
        "windows_native_artifact",
      );
    }
    const readiness = inspectWindowsNativeReadiness(process.platform, loaded);
    throw configurationFailure(
      readiness.available ? "runtime_unavailable" : readiness.code,
      readiness.available
        ? "Windows native readiness disagreed with the native loader result."
        : readiness.reason,
      {
        platform: process.platform,
        architecture: process.arch,
        phase: "process-ownership",
        owned_protocol_stdin: false,
        ...(readiness.available
          ? {}
          : {
              failure_stage: readiness.failureStage,
              remediation: readiness.remediation,
            }),
      },
      readiness.available
        ? "windows_native_runtime"
        : readiness.code === "unsupported_host"
          ? "unsupported_host"
          : readiness.code === "runtime_missing"
            ? "windows_native_artifact"
            : "windows_native_runtime",
    );
  }
  throw configurationFailure(
    "unsupported_host",
    `Android JADX subprocess ownership is unsupported on ${process.platform}/${process.arch}; use Linux, macOS, or Windows x64 with its bundled native controls.`,
    { platform: process.platform },
    "unsupported_host",
  );
};

const resolveJar = async (
  environment: Readonly<Record<string, string | undefined>>,
): Promise<string> => {
  const jar = environment.REA_JADX_MCP_JAR;
  if (jar === undefined)
    throw configurationFailure(
      "not_configured",
      JADX_JAR_CONFIGURATION_REMEDIATION,
      { jar_configured: false },
      "jar",
    );
  // A supplied selection stays configured even when rejected, so callers can
  // tell it from an omitted setting and see the exact value REA refused.
  if (!isAbsolute(jar))
    throw configurationFailure(
      "open_options_invalid",
      `REA_JADX_MCP_JAR must be an absolute path; received ${JSON.stringify(jar)}. ${JADX_JAR_CONFIGURATION_REMEDIATION}`,
      { jar_configured: true, jar_path: jar, path_requirement: "absolute" },
      "jar",
    );
  try {
    await access(jar, constants.R_OK);
    if (!(await stat(jar)).isFile())
      throw configurationFailure(
        "executable_missing",
        `REA_JADX_MCP_JAR is not a regular file: ${jar}`,
        { jar_path: jar },
        "jar",
      );
    return await realpath(jar);
  } catch (cause) {
    if (cause instanceof JadxConfigurationFailure) throw cause;
    throw configurationFailure(
      "executable_missing",
      `Cannot read REA_JADX_MCP_JAR ${jar}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { jar_path: jar },
      "jar",
      cause,
    );
  }
};

const resolveJava = async (
  environment: Readonly<Record<string, string | undefined>>,
  signal?: AbortSignal,
): Promise<string> => {
  const executable = process.platform === "win32" ? "java.exe" : "java";
  if (environment.JAVA_HOME === undefined) {
    const windows = process.platform === "win32";
    const path = windows
      ? (Object.entries(environment).find(
          ([key]) => key.toLowerCase() === "path",
        )?.[1] ?? "")
      : (environment.PATH ?? "/usr/bin:/bin");
    // Resolve in the caller's directory once. The module probe and the engine
    // run in different directories, and the selected executable also owns the
    // retained session's cache identity. Empty POSIX PATH components select cwd.
    const directories = path.split(delimiter);
    for (const directory of windows
      ? directories.filter((entry) => entry !== "")
      : directories) {
      throwIfJadxInterrupted(signal);
      // Windows PATH commonly quotes individual entries containing spaces.
      const selected =
        windows && directory.startsWith('"') && directory.endsWith('"')
          ? directory.slice(1, -1)
          : directory;
      const candidate = windows
        ? resolve(selected, executable)
        : absoluteCallerPath(appendCallerPath(selected, executable));
      try {
        await access(
          candidate,
          windows ? constants.R_OK | constants.X_OK : constants.X_OK,
        );
        if ((await stat(candidate)).isFile())
          return windows ? await realpath(candidate) : candidate;
      } catch (cause: unknown) {
        if (
          typeof cause === "object" &&
          cause !== null &&
          "code" in cause &&
          (cause.code === "ENOENT" ||
            cause.code === "ENOTDIR" ||
            (!windows && (cause.code === "EACCES" || cause.code === "EPERM")))
        )
          continue;
        throw configurationFailure(
          "runtime_missing",
          `Cannot inspect selected Java executable ${candidate}: ${errorText(cause)}`,
          { java_executable: candidate },
          "java_runtime",
          cause,
        );
      }
    }
    throw configurationFailure(
      "runtime_missing",
      `Cannot find an executable ${executable} on the selected ${windows ? "Windows " : ""}PATH. Select a full JDK with JAVA_HOME or PATH, then verify it with java --list-modules. REA does not install Java.`,
      { java_executable: executable, phase: "path-lookup" },
      "java_runtime",
    );
  }
  if (isAbsolute(environment.JAVA_HOME))
    return appendCallerPath(environment.JAVA_HOME, `bin/${executable}`);
  throw configurationFailure(
    "open_options_invalid",
    "JAVA_HOME must select an existing JDK by absolute path; omit it to use java on PATH.",
    { java_home: environment.JAVA_HOME },
    "java_home",
  );
};

const requireJavaHomeExecutable = async (
  javaHome: string | undefined,
  java: string,
): Promise<void> => {
  if (javaHome === undefined) return;
  try {
    await access(java, constants.R_OK | constants.X_OK);
    if ((await stat(java)).isFile()) return;
    throw configurationFailure(
      "runtime_missing",
      `JAVA_HOME java is not a regular file: ${java}`,
      { java_executable: java },
      "java_runtime",
    );
  } catch (cause) {
    if (cause instanceof JadxConfigurationFailure) throw cause;
    throw configurationFailure(
      "runtime_missing",
      `Cannot execute JAVA_HOME java ${java}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { java_executable: java },
      "java_runtime",
      cause,
    );
  }
};

const resolveJvmArguments = (
  environment: Readonly<Record<string, string | undefined>>,
): readonly string[] => {
  const result: string[] = [];
  for (const [name, prefix, suffix] of [
    ["REA_JADX_HEAP_MIB", "-Xmx", "m"],
    ["REA_JADX_ACTIVE_PROCESSOR_COUNT", "-XX:ActiveProcessorCount=", ""],
  ] as const) {
    const value = environment[name];
    if (value === undefined) continue;
    if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value)))
      throw configurationFailure(
        "open_options_invalid",
        `${name} must be a positive safe integer; received ${value}.`,
        { setting: name, value },
        "jvm_options",
      );
    if (
      name === "REA_JADX_ACTIVE_PROCESSOR_COUNT" &&
      Number(value) > 2_147_483_647
    )
      throw configurationFailure(
        "open_options_invalid",
        `${name} exceeds the JVM's signed 32-bit processor-count range.`,
        { setting: name, value },
        "jvm_options",
      );
    result.push(`${prefix}${value}${suffix}`);
  }
  return result;
};

const readOperationTimeout = (
  environment: Readonly<Record<string, string | undefined>>,
  runtimeTimeoutMs?: number,
): number => {
  if (runtimeTimeoutMs !== undefined) return runtimeTimeoutMs;
  const value = environment.REA_JADX_OPERATION_TIMEOUT_MS;
  if (value === undefined) return DEFAULT_JADX_OPERATION_TIMEOUT_MS;
  const parsed = providerStartupTimeoutSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw configurationFailure(
    "open_options_invalid",
    `REA_JADX_OPERATION_TIMEOUT_MS must be a decimal millisecond count from 1 to 2147483647; received ${value}.`,
    { setting: "REA_JADX_OPERATION_TIMEOUT_MS", value },
    "operation_timeout",
  );
};

const inspectJavaRuntime = async (
  java: string,
  environment: Readonly<Record<string, string | undefined>>,
  options: JadxJavaProbeOptions,
): Promise<void> => {
  const result = await inspectJadxJava(java, environment, options);
  if (!result.ok) {
    const failure = result.error;
    throw configurationFailure(
      failure.code,
      failure.message,
      failure.diagnostics,
      failure.kind,
    );
  }
};

const configurationFailure = (
  code: ConfigurationFailureCode,
  message: string,
  diagnostics: Readonly<Record<string, JsonValue>>,
  kind: JadxFailureKind,
  cause?: unknown,
): JadxConfigurationFailure =>
  new JadxConfigurationFailure(
    code,
    message,
    diagnostics,
    kind,
    cause === undefined ? undefined : { cause },
  );

const errorText = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
