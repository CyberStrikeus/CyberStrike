import type { JsonValue } from "../domain/jsonValue.js";
import { redactCapturedTransportCredential } from "../process/ProviderDiagnosticRedaction.js";
import type {
  ProviderProcessOutputSince,
  ProviderProcessSnapshot,
} from "../process/ProviderProcess.js";
import type { GhidraLaunch } from "./GhidraLauncher.js";
import type { GhidraTransportKind } from "./GhidraTransport.js";

/** Aggregate in-memory retention budget for this provider's launcher output. */
export const GHIDRA_PROCESS_DIAGNOSTIC_BYTES = 8 * 1024 * 1024;

/** JVM error class located in all launcher output, beyond the retention budget. */
export const GHIDRA_JVM_OOME_MARKER = "java.lang.OutOfMemoryError";

/** A rejected caller input owns request output, not the launcher's history. */
export type GhidraDiagnosticsScope = "session" | "request";

/** Inputs needed to project bounded diagnostics for one Ghidra runtime. */
export interface GhidraDiagnosticsOptions {
  readonly scope?: GhidraDiagnosticsScope;
  readonly targetPath: string;
  readonly targetSha256: string;
  readonly targetAdmission?: JsonValue;
  readonly transport: GhidraTransportKind;
  readonly providerVersion: string;
  readonly profileDigest: string;
  readonly runId?: string;
  readonly runtimeRoot?: string;
  readonly socketRoot?: string;
  readonly endpointPath?: string;
  readonly launch?: GhidraLaunch;
  readonly snapshot?: ProviderProcessSnapshot;
  readonly token?: string;
  readonly previous: Readonly<Record<string, JsonValue>>;
  readonly failure_output?: JsonValue;
}

/** Preserve actionable runtime coordinates after cleanup and redact bearer data. */
export const createGhidraDiagnostics = (
  options: GhidraDiagnosticsOptions,
): Readonly<Record<string, JsonValue>> => {
  if (
    options.runtimeRoot === undefined &&
    options.launch === undefined &&
    Object.keys(options.previous).length > 0
  ) {
    const history: Record<string, JsonValue> = { ...options.previous };
    delete history.failure_output;
    if (options.scope === "request") {
      delete history.stdout;
      delete history.stderr;
      delete history.launch_support;
      history.diagnostic_scope = "request";
    }
    return history;
  }
  return {
    ...(options.scope === "request" ? { diagnostic_scope: "request" } : {}),
    target_path: options.targetPath,
    target_sha256: options.targetSha256,
    ...(options.targetAdmission === undefined
      ? {}
      : { target_admission: options.targetAdmission }),
    transport: options.transport,
    provider_version: options.providerVersion,
    profile_digest: options.profileDigest,
    ...(options.runId === undefined ? {} : { run_id: options.runId }),
    ...(options.runtimeRoot === undefined
      ? {}
      : { runtime_root: options.runtimeRoot }),
    ...(options.socketRoot === undefined
      ? {}
      : { socket_root: options.socketRoot }),
    ...(options.endpointPath === undefined
      ? {}
      : { endpoint_path: options.endpointPath }),
    ...(options.launch === undefined
      ? {}
      : {
          project_root: options.launch.projectRoot,
          ghidra_log_path: options.launch.ghidraLogPath,
          script_log_path: options.launch.scriptLogPath,
          process_id: options.launch.process.pid ?? null,
          ...(options.scope === "request" ||
          options.launch.launchSupport === undefined
            ? {}
            : {
                launch_support: options.launch.launchSupport.map((output) => ({
                  ...output,
                })),
              }),
        }),
    ...(options.launch?.configuredMaxHeap === undefined
      ? {}
      : { configured_jvm_max_heap: options.launch.configuredMaxHeap }),
    ...(options.snapshot === undefined
      ? {}
      : {
          exit_code: options.snapshot.exitCode ?? null,
          exit_signal: options.snapshot.signal ?? null,
          stop_requested: options.snapshot.stopRequested === true,
          diagnostic_truncated: options.snapshot.diagnosticTruncated === true,
          output_incomplete: options.snapshot.outputIncomplete === true,
          ...(options.scope === "request"
            ? {}
            : {
                stdout: ghidraDiagnosticStream(
                  options.snapshot.stdout,
                  options.token,
                ),
                stderr: ghidraDiagnosticStream(
                  options.snapshot.stderr,
                  options.token,
                ),
              }),
        }),
    ...(options.failure_output === undefined
      ? {}
      : { failure_output: options.failure_output }),
  };
};

/**
 * Operation-scoped output, plus OOME lines observed after the checkpoint even
 * when the retention budget dropped them from the retained text.
 */
export const ghidraFailureOutput = (
  scoped: ProviderProcessOutputSince,
  token: string | undefined,
  drainIncomplete: boolean,
): JsonValue => ({
  stdout: ghidraDiagnosticStream(scoped.snapshot.stdout, token),
  stderr: ghidraDiagnosticStream(scoped.snapshot.stderr, token),
  complete: scoped.complete && !drainIncomplete,
  observed_oome: (scoped.markers ?? []).map((marker) => {
    const bytes = Buffer.byteLength(marker.line, "utf8");
    return {
      stream: marker.stream,
      offset: marker.offset,
      line: redactCapturedTransportCredential(
        {
          text: marker.line,
          bytes,
          // A cut line may end in a partial credential.
          observedBytes:
            marker.trailingContextIncomplete === true ? bytes + 1 : bytes,
        },
        token,
        "[REDACTED]",
      ),
      line_complete: marker.trailingContextIncomplete !== true,
      ...(marker.truncated ? { truncated: true } : {}),
      ...(marker.invalidUtf8 === true ? { invalid_utf8: true } : {}),
    };
  }),
});

export const ghidraDiagnosticStream = (
  stream: ProviderProcessSnapshot["stdout"],
  token: string | undefined,
): JsonValue => ({
  text: redactCapturedTransportCredential(stream, token, "[REDACTED]"),
  // Preserve the historical total-byte counter; text is now bounded separately.
  bytes: stream.observedBytes,
  retained_bytes: stream.bytes,
  ...(stream.invalidUtf8 === true ? { invalid_utf8: true } : {}),
});
