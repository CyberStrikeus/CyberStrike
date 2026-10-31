import { analysisSettingLimit } from "../domain/analysisSettingDefinitions.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  artifactFileCancellationCause,
  bindArtifactFileCleanup,
} from "../artifacts/ArtifactFileOperation.js";
import { boundedUtf8Text } from "../process/boundedUtf8Text.js";
import type { ProviderProcessSnapshot } from "../process/ProviderProcess.js";
import {
  AnalysisError,
  type AnalysisCapturedOutput,
} from "../domain/analysisErrorBase.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  AnalysisCancelledError,
  AnalysisArtifactChangedError,
  AnalysisAccessDeniedError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
  AnalysisCapabilityUnavailableError,
} from "../domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { OwnedCommandFailure } from "../process/OwnedCommand.js";
import {
  RuntimeControlUnavailableError,
  runtimeControlCapabilityError,
} from "../process/RuntimeControlUnavailableError.js";
import { WabtAdmissionError } from "./WabtAdmissionError.js";
import {
  DEFAULT_WASM_COMMAND_TIMEOUT_MS,
  MAX_WASM_COMMAND_TIMEOUT_MS,
} from "../domain/wasm/wasmArtifact.js";
import {
  WABT_LIMITS,
  WABT_PROVIDER_IDENTITY,
  WABT_VERSION,
} from "./WabtRelease.js";
const OUTPUT_LIMIT_EXCERPT_BYTES = 4096;
const OUTPUT_LIMIT_REASON = `WABT output exceeded the ${String(WABT_LIMITS.outputBytes)}-byte output budget`;

/** Facts owned before dispatch, even when a version command does not return successfully. */
export type WabtVersionProbe = {
  readonly configuration_key: "REA_WABT_BIN_DIRECTORY";
  readonly executable_path: string;
  readonly tool: string;
  readonly expected_version: typeof WABT_VERSION;
};

type WabtFailureContext = {
  readonly commandTimeoutMs: number;
  readonly versionProbe?: WabtVersionProbe;
  readonly inputField?: readonly (string | number)[];
  readonly observedOutput?: AnalysisCapturedOutput | undefined;
};

/** Configuration is captured by the server; fixing files and changing its environment are distinct repairs. */
export const wabtConfigurationRecoveryAction = (cause?: unknown): string => {
  const code =
    cause instanceof Error && "code" in cause ? cause.code : undefined;
  const action =
    code === "EACCES" || code === "EPERM"
      ? "Check this REA process has read and execute access to the reported caller-supplied tools, or select an accessible trusted copy. "
      : code === "ENOTDIR"
        ? "Select the tools' containing directory, not an individual executable. "
        : code === "ENOENT"
          ? "The reported configured tool is missing. "
          : "";
  return `${action}Set absolute REA_WABT_BIN_DIRECTORY to a directory that contains wasm-validate, wasm-objdump and wasm2wat from WABT ${WABT_VERSION}; each --version must report ${WABT_VERSION} on stdout with empty stderr. Correct the reported tool path, access or release before retrying, not the WASM input. Set this in the shell for the next CLI call, or in the MCP server launch environment and restart that server; a shell export does not update a running MCP server. Do not repeat the unchanged call or install tools implicitly.`;
};
/** Past the output budget, retained text is a prefix of an oversized stream; keep a bounded excerpt of each. */
const outputLimitExcerpt = (snapshot: ProviderProcessSnapshot) => ({
  stdout: boundedUtf8Text(snapshot.stdout.text, OUTPUT_LIMIT_EXCERPT_BYTES)
    .text,
  stderr: boundedUtf8Text(snapshot.stderr.text, OUTPUT_LIMIT_EXCERPT_BYTES)
    .text,
  // The command reports output-limit only after retention was truncated.
  truncated: true,
  stdout_bytes: snapshot.stdout.bytes,
  stderr_bytes: snapshot.stderr.bytes,
  exit_code: snapshot.exitCode ?? null,
  signal: snapshot.signal ?? null,
});
/** Preserve lifecycle failures and diagnostic bytes instead of returning partial success. */
export const wabtFailure = (
  cause: unknown,
  phase: "configuration" | "artifact" | "producer",
  path: string,
  execution?: WabtFailureContext,
): AnalysisError => {
  const failure = classifyWabtFailure(cause, phase, path, execution);
  bindArtifactFileCleanup(cause, failure);
  return failure;
};

const classifyWabtFailure = (
  cause: unknown,
  phase: "configuration" | "artifact" | "producer",
  path: string,
  execution: WabtFailureContext | undefined,
): AnalysisError => {
  const versionProbe = execution?.versionProbe;
  if (cause instanceof AnalysisError) return cause;
  const artifactCleanup =
    cause instanceof ArtifactReaderFailure ? cause.cleanup : undefined;
  const artifactOptions = {
    ...(artifactCleanup === undefined ? {} : { cleanup: artifactCleanup }),
    ...(execution?.observedOutput === undefined
      ? {}
      : { capturedOutput: execution.observedOutput }),
  };
  const reason = cause instanceof Error ? cause.message : String(cause);
  if (
    (cause instanceof ArtifactReaderFailure && cause.reason === "cancelled") ||
    (cause instanceof Error && cause.name === "AbortError")
  )
    return new AnalysisCancelledError("inspect_wasm_artifact", {
      cause:
        cause instanceof ArtifactReaderFailure
          ? artifactFileCancellationCause(cause)
          : cause,
      ...artifactOptions,
    });
  if (cause instanceof OwnedCommandFailure) {
    const capturedOutput =
      cause.snapshot === null
        ? undefined
        : cause.reason === "output-limit"
          ? outputLimitExcerpt(cause.snapshot)
          : {
              stdout: cause.snapshot.stdout.text,
              stderr: cause.snapshot.stderr.text,
              truncated: cause.snapshot.diagnosticTruncated ?? false,
            };
    const options = {
      cause,
      ...(capturedOutput === undefined ? {} : { capturedOutput }),
      ...(versionProbe === undefined ? {} : { diagnostics: versionProbe }),
    };
    // Classify once before cleanup takes precedence, so the primary remains actionable.
    const timeoutMs =
      execution?.commandTimeoutMs ?? DEFAULT_WASM_COMMAND_TIMEOUT_MS;
    const timeout =
      cause.reason === "timeout"
        ? new AnalysisTimeoutError("inspect_wasm_artifact", timeoutMs, {
            limit: analysisSettingLimit(
              "wasm.command_timeout_ms",
              timeoutMs,
              undefined,
            ),
            ...options,
            // The cleanup wrapper retains output once; its nested primary needs only recovery facts.
            capturedOutput:
              cause.cleanupFailure === null ? capturedOutput : undefined,
            userMessage: `A WABT command reached its ${String(timeoutMs)} ms server/provider deadline (command_timeout_ms), not the whole-inspection or MCP client deadline.`,
            remediationAction: `${
              timeoutMs < MAX_WASM_COMMAND_TIMEOUT_MS
                ? `Increase command_timeout_ms above ${String(timeoutMs)} (integer milliseconds, maximum ${String(MAX_WASM_COMMAND_TIMEOUT_MS)}), or use rea inspect-wasm-artifact <path> --command-timeout-ms <milliseconds> on the CLI.`
                : `command_timeout_ms is already at the maximum supported ${String(MAX_WASM_COMMAND_TIMEOUT_MS)} ms; no higher command deadline is supported. Report this blocker or select another suitable complete artifact with caller approval.`
            } This is a per-call setting; no server restart is needed. Allow the MCP client deadline to cover all version/analysis commands, file checks, cleanup and delivery; increasing only that client deadline does not change this budget. Input/output safety limits stay fixed, and detail: summary reduces delivery size, not analysis work. Resolve any incomplete cleanup before retrying; do not repeat the unchanged failed call.`,
          })
        : undefined;
    if (cause.cleanupFailure !== null)
      return new ProviderCleanupError(
        WABT_PROVIDER_IDENTITY.id,
        cause.resources,
        {
          ...versionProbe,
          reason: cause.cleanupFailure,
          previous_error:
            timeout !== undefined
              ? projectAnalysisError(timeout)
              : cause.reason === "output-limit"
                ? {
                    failure_kind: "output-limit",
                    message: OUTPUT_LIMIT_REASON,
                    max_output_bytes: WABT_LIMITS.outputBytes,
                  }
                : reason,
          ...(capturedOutput === undefined
            ? {}
            : { captured_output: capturedOutput }),
        },
        { operation: "inspect_wasm_artifact", cause },
      );
    if (cause.reason === "cancelled")
      return new AnalysisCancelledError("inspect_wasm_artifact", {
        ...options,
        cause:
          cause.cancellation === undefined ? cause : cause.cancellation.reason,
      });
    if (timeout !== undefined) return timeout;
    if (phase !== "configuration" && cause.reason === "output-limit")
      return new AnalysisResourceConstraintError(
        "inspect_wasm_artifact",
        "memory",
        OUTPUT_LIMIT_REASON,
        { max_output_bytes: WABT_LIMITS.outputBytes },
        {
          ...options,
          remediationAction: `The WABT output allowance is ${String(WABT_LIMITS.outputBytes)} bytes. This release has no runtime override. command_timeout_ms does not raise it. The WABT output budget is fixed, so retrying with the same input will fail the same way.`,
        },
      );
    if (phase === "configuration" && cause.reason === "process")
      return new AnalysisCapabilityUnavailableError(
        WABT_PROVIDER_IDENTITY.id,
        "inspect_wasm_artifact",
        reason,
        {
          ...options,
          userMessage: `Configured WABT could not start. Check executable/interpreter access and WABT ${WABT_VERSION} profile; inspect retained diagnostics.`,
          remediationAction: wabtConfigurationRecoveryAction(cause),
        },
      );
    return new AnalysisOutputError("inspect_wasm_artifact", reason, options);
  }
  if (cause instanceof RuntimeControlUnavailableError)
    return runtimeControlCapabilityError(
      WABT_PROVIDER_IDENTITY.id,
      "inspect_wasm_artifact",
      cause,
    );
  if (
    phase === "configuration" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "limit" &&
    cause.boundary === "file-size"
  )
    return new AnalysisCapabilityUnavailableError(
      WABT_PROVIDER_IDENTITY.id,
      "inspect_wasm_artifact",
      cause.message,
      {
        cause,
        ...artifactOptions,
        userMessage: `Configured WABT tools exceed the ${String(WABT_LIMITS.toolBytes)}-byte tool allowance. This release has no runtime override.`,
        remediationAction: `The WABT tool allowance is ${String(WABT_LIMITS.toolBytes)} bytes. This release has no runtime override. command_timeout_ms and REA_WABT_BIN_DIRECTORY do not raise it. Select tools within the allowance. Do not repeat the unchanged call.`,
      },
    );
  if (phase === "configuration") {
    const admission = cause instanceof WabtAdmissionError ? cause : undefined;
    return new AnalysisCapabilityUnavailableError(
      WABT_PROVIDER_IDENTITY.id,
      "inspect_wasm_artifact",
      admission?.code ?? reason,
      {
        cause,
        ...artifactOptions,
        ...(admission === undefined
          ? {}
          : {
              diagnostics: {
                code: admission.code,
                ...admission.detail,
              },
            }),
        userMessage:
          admission === undefined
            ? reason
            : "WABT configuration cannot be used",
        remediationAction: wabtConfigurationRecoveryAction(cause),
      },
    );
  }
  if (
    phase === "artifact" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "limit" &&
    cause.boundary === "file-size"
  )
    return new AnalysisResourceConstraintError(
      "inspect_wasm_artifact",
      "file-size",
      reason,
      { maximum_input_bytes: WABT_LIMITS.inputBytes },
      {
        cause,
        ...artifactOptions,
        retryable: false,
        remediationAction: `Select a suitable stable artifact within the reported ${String(WABT_LIMITS.inputBytes)}-byte input byte allowance. This release has no runtime override. command_timeout_ms does not raise it. Do not truncate required bytes; retrying the unchanged oversized input will fail again.`,
      },
    );
  if (
    phase === "artifact" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "integrity"
  )
    return new AnalysisArtifactChangedError(
      "inspect_wasm_artifact",
      path,
      reason,
      { cause, ...artifactOptions },
    );
  if (
    phase === "artifact" &&
    cause instanceof Error &&
    "code" in cause &&
    (cause.code === "EACCES" || cause.code === "EPERM")
  )
    return new AnalysisAccessDeniedError(
      "inspect_wasm_artifact",
      path,
      cause.code,
      { cause, ...artifactOptions },
    );
  if (phase === "artifact")
    return new AnalysisInputError(
      "inspect_wasm_artifact",
      { cause, ...artifactOptions },
      [
        {
          path: [...(execution?.inputField ?? ["path"])],
          reason: "invalid_value",
          message: reason,
        },
      ],
    );
  return new AnalysisOutputError("inspect_wasm_artifact", reason, {
    cause,
    ...artifactOptions,
  });
};
