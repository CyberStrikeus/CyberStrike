import {
  AnalysisCancelledError,
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";
import { isAbsolute, win32 } from "node:path";
import { findWindowsExecutable } from "../process/WindowsExecutable.js";
import { ProviderStartupDeadline } from "../process/ProviderDeadline.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";

import {
  execFileOutput,
  execFileFailureCapturedOutput,
  ExecFileOutputCancelledError,
  execFileOutputFailure,
} from "../process/ExecFileOutput.js";
import type { ProviderAvailability } from "../application/AnalysisProvider.js";
import type { ProviderRejectionCode } from "../domain/providerSelection.js";
import { fixedAllowanceOptions } from "../domain/fixedAllowanceRemediation.js";
import type { JsonValue } from "../domain/jsonValue.js";

/** Environment key selecting the caller's adb binary. */
export const ADB_BINARY_ENV = "REA_ADB_PATH";

const VERSION_TIMEOUT_MS = 10_000;
const VERSION_MAX_OUTPUT_BYTES = 64 * 1024;

/** How the adb binary was selected for this provider instance. */
export interface AdbBinarySelection {
  readonly binary: string;
  readonly pathSource: "environment" | "path";
  readonly environment: Readonly<Record<string, string | undefined>>;
}

/**
 * Resolve the caller-supplied adb binary. `REA_ADB_PATH` must be absolute so
 * the selection stays explicit. Windows resolves the default from the selected
 * PATH before launch; POSIX retains execFile PATH lookup.
 */
export const resolveAdbBinary = async (
  environment: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
  signal?: AbortSignal,
): Promise<AdbBinarySelection> => {
  const selectedEnvironment = snapshotEnvironment(environment, platform);
  const configured = selectedEnvironment[ADB_BINARY_ENV];
  if (configured === undefined || configured.trim() === "")
    return {
      binary:
        platform === "win32"
          ? await resolveWindowsAdb(selectedEnvironment, signal)
          : "adb",
      pathSource: "path",
      environment: selectedEnvironment,
    };
  if (
    !(platform === "win32"
      ? win32.isAbsolute(configured)
      : isAbsolute(configured))
  )
    throw new AdbConfigurationFailure(
      "not_absolute",
      `${ADB_BINARY_ENV} must be an absolute path to the adb binary`,
      { configured_path: configured },
    );
  return {
    binary: configured,
    pathSource: "environment",
    environment: selectedEnvironment,
  };
};

const resolveWindowsAdb = async (
  environment: Readonly<NodeJS.ProcessEnv>,
  signal?: AbortSignal,
): Promise<string> => {
  const deadline = new ProviderStartupDeadline(VERSION_TIMEOUT_MS, signal);
  try {
    const found = await findWindowsExecutable("adb", environment, {
      signal: deadline.signal,
    });
    if (found.ok) return found.value;
    const failure = found.error;
    if (failure.kind === "interrupted") {
      if (deadline.interruption === "cancelled")
        throw new AnalysisCancelledError("inspect_adb_client", {
          cause: signal?.reason,
        });
      throw new AnalysisTimeoutError("inspect_adb_client", VERSION_TIMEOUT_MS, {
        diagnostics: { phase: "windows_path_lookup" },
      });
    }
    throw new AdbConfigurationFailure(
      failure.kind === "missing" ? "binary_missing" : "binary_unresolved",
      "The adb binary could not be selected from the Windows PATH/PATHEXT",
      {
        selected_binary: "adb",
        path_source: "path",
        remediation: `Set ${ADB_BINARY_ENV} to an absolute adb executable, or add it to PATH/PATHEXT`,
        ...(failure.kind === "invalid_extension"
          ? { invalid_extension: failure.extension }
          : {}),
        ...(failure.kind === "inspection"
          ? {
              candidate_path: failure.path,
              ...(failure.code === null
                ? {}
                : { filesystem_error: failure.code }),
            }
          : {}),
      },
      failure.kind === "inspection" ? { cause: failure.cause } : undefined,
    );
  } finally {
    deadline.dispose();
  }
};

export type AdbConfigurationFailureCode =
  | "not_absolute"
  | "binary_missing"
  | "binary_unresolved"
  | "binary_not_executable"
  | "version_unresolved";

export class AdbConfigurationFailure extends Error {
  constructor(
    readonly code: AdbConfigurationFailureCode,
    message: string,
    readonly diagnostics: Readonly<Record<string, JsonValue>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface AdbClientIdentity {
  readonly version: string | null;
  readonly installedPath: string | null;
}

/**
 * Parse `adb version` output. The first line carries the protocol version,
 * `Version ` the build version (no colon), and `Installed as` the binary path.
 */
export const parseAdbVersionOutput = (stdout: string): AdbClientIdentity => {
  const build = /^Version\s+(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\s*$/mu.exec(
    stdout,
  );
  const installed = /^Installed as\s+(.+)$/mu.exec(stdout);
  return {
    version: build === null ? null : build[1]!.trim(),
    installedPath: installed === null ? null : installed[1]!.trim(),
  };
};

/**
 * Probe the selected adb binary without contacting devices. `adb version`
 * never starts the adb server, so this stays a pure client check.
 */
export const inspectAdbClient = async (
  selection: AdbBinarySelection,
  signal?: AbortSignal,
): Promise<AdbClientIdentity> => {
  try {
    const { stdout, stderr } = await execFileOutput(
      selection.binary,
      ["version"],
      {
        env: selection.environment,
        timeout: VERSION_TIMEOUT_MS,
        stopSignal: "SIGTERM",
        maxBuffer: VERSION_MAX_OUTPUT_BYTES,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    const identity = parseAdbVersionOutput(stdout);
    const hasRecognizedProtocolVersion =
      /^Android Debug Bridge version\s+\d+\.\d+\.\d+\s*$/mu.test(stdout);
    if (identity.version === null && !hasRecognizedProtocolVersion)
      throw new AdbConfigurationFailure(
        "version_unresolved",
        "The selected adb binary exited successfully but did not report a recognizable protocol or build version",
        {
          selected_binary: selection.binary,
          path_source: selection.pathSource,
          version_probe: "unrecognized_output",
          stdout,
          stderr,
        },
      );
    return identity;
  } catch (cause) {
    if (cause instanceof AdbConfigurationFailure) throw cause;
    const failure = execFileOutputFailure(cause);
    if (cause instanceof ExecFileOutputCancelledError)
      throw new AnalysisCancelledError("inspect_adb_client", {
        cause: cause.cause,
        ...(failure === undefined
          ? {}
          : { capturedOutput: execFileFailureCapturedOutput(failure) }),
      });
    const diagnostics = {
      selected_binary: selection.binary,
      path_source: selection.pathSource,
      ...(failure === undefined ? {} : { exit_code: failure.code }),
    };
    const options = {
      cause,
      diagnostics,
      ...(failure === undefined
        ? {}
        : { capturedOutput: execFileFailureCapturedOutput(failure) }),
    };
    if (failure?.outputTruncated === true) {
      throw new AnalysisResourceConstraintError(
        "inspect_adb_client",
        "memory",
        `adb version output exceeded the ${String(VERSION_MAX_OUTPUT_BYTES)}-byte capture budget`,
        { max_output_bytes: VERSION_MAX_OUTPUT_BYTES },
        {
          ...options,
          ...fixedAllowanceOptions(
            `The adb version-output capture allowance of ${String(VERSION_MAX_OUTPUT_BYTES)} bytes (this release has no runtime override)`,
            "capture",
          ),
        },
      );
    }
    if (failure?.code === "ETIMEDOUT")
      throw new AnalysisTimeoutError("inspect_adb_client", VERSION_TIMEOUT_MS, {
        ...options,
        userMessage: `adb version probe reached its ${String(VERSION_TIMEOUT_MS)} ms deadline (deadlineExpired). This release has no runtime override.`,
        remediationAction: `This ${String(VERSION_TIMEOUT_MS)} ms adb version probe has no runtime override. Allow execution, cleanup and delivery headroom in the outer MCP client deadline. Confirm outstanding work and cleanup before retrying.`,
      });
    if (failure?.code === "ENOENT")
      throw new AdbConfigurationFailure(
        "binary_missing",
        `The selected adb binary was not found: ${selection.binary}`,
        {
          selected_binary: selection.binary,
          path_source: selection.pathSource,
          remediation: `Set ${ADB_BINARY_ENV} to an absolute path to an existing adb binary`,
        },
        { cause },
      );
    if (failure?.code === "EACCES" || failure?.code === "EPERM")
      throw new AdbConfigurationFailure(
        "binary_not_executable",
        `Execution of the selected adb binary was denied (${failure.code}): ${selection.binary}`,
        {
          selected_binary: selection.binary,
          path_source: selection.pathSource,
          filesystem_error: failure.code,
          remediation: `Check file type and execute permission for ${ADB_BINARY_ENV} or select an executable adb binary`,
        },
        { cause },
      );
    throw new AdbConfigurationFailure(
      "version_unresolved",
      "The selected adb binary did not report a usable version",
      {
        selected_binary: selection.binary,
        ...(failure === undefined
          ? {}
          : {
              exit_code: failure.code,
              stderr_excerpt: failure.stderr.slice(0, 512),
            }),
      },
      { cause },
    );
  }
};

/** Availability in the shape shared by every provider. */
const rejectionCodeOf = (
  code: AdbConfigurationFailureCode,
): ProviderRejectionCode =>
  code === "binary_missing"
    ? "executable_missing"
    : code === "not_absolute" ||
        code === "binary_not_executable" ||
        code === "binary_unresolved"
      ? "not_configured"
      : "version_unresolved";

export const adbConfigurationAvailability = (
  cause: AdbConfigurationFailure,
): ProviderAvailability =>
  ({
    status: "unavailable",
    code: rejectionCodeOf(cause.code),
    reason: cause.message,
    diagnostics: { ...cause.diagnostics },
  }) as ProviderAvailability;
