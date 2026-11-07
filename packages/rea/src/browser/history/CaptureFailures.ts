import { analysisSettingLimit } from "../../domain/analysisSettingDefinitions.js";
import type { ExecutionOptions } from "../../application/AnalysisProvider.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import {
  bindArtifactFileCleanup,
  artifactFileCancellationCause,
  artifactFilePrimaryFacts,
} from "../../artifacts/ArtifactFileOperation.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
} from "../../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import {
  WEB_NETWORK_CAPTURE_LIMITS,
  selectedWebNetworkCaptureTimeoutMs,
  webNetworkCaptureTimeoutRecovery,
  type InspectWebNetworkCaptureInput,
} from "../../domain/webNetworkCapture.js";
import {
  captureDecoderHeapRecovery,
  DEFAULT_CAPTURE_DECODER_HEAP,
  type CaptureDecoderHeap,
} from "../../config/captureDecoderHeap.js";
import { OwnedCommandFailure } from "../../process/OwnedCommand.js";
import {
  NODE_CAPTURE_HEAP_ENFORCED,
  NODE_CAPTURE_HEAP_LIMITS,
  captureDecoderProcessMemoryLimitBytes,
} from "./CaptureRelease.js";
const OPERATION = "inspect_web_network_capture";

/** Reason for a decoder whose owned process tree reached its Job Object commit limit. */
export const CAPTURE_PROCESS_MEMORY_LIMIT_REASON =
  "The capture decoder reached its Windows Job Object memory limit";

/** Preserve the origin and typed cause of a historical capture failure. */
export const historicalCaptureFailure = (
  input: InspectWebNetworkCaptureInput,
  rawCause: unknown,
  phase: "capture-read" | "descriptor-read" | "decoder",
  options?: ExecutionOptions,
  heap: CaptureDecoderHeap = DEFAULT_CAPTURE_DECODER_HEAP,
): AnalysisError => {
  const { cause, origin } = artifactFilePrimaryFacts(rawCause);
  if (origin === "owned-or-classified" && cause instanceof AnalysisError)
    return cause;
  const descriptorRead = phase === "descriptor-read";
  const sourcePath = descriptorRead
    ? (input.protobuf?.schema?.descriptor_set_path ?? input.capture_path)
    : input.capture_path;
  const inputPath = descriptorRead
    ? ["protobuf", "schema", "descriptor_set_path"]
    : ["capture_path"];
  const sourceLabel = descriptorRead ? "descriptor set" : "capture";
  if (
    origin === "owned-or-classified" &&
    cause instanceof OwnedCommandFailure
  ) {
    if (cause.cleanupFailure !== null) {
      const cleanup = new ProviderCleanupError(
        input.format,
        cause.resources,
        {
          reason: cause.cleanupFailure,
          previous_error: {
            failure_kind: cause.reason,
            message: cause.message,
            exit_code: cause.snapshot?.exitCode ?? null,
            signal: cause.snapshot?.signal ?? null,
            stdout: cause.snapshot?.stdout.text ?? null,
            stderr: cause.snapshot?.stderr.text ?? null,
            diagnostic_truncated: cause.snapshot?.diagnosticTruncated ?? null,
          },
        },
        { operation: OPERATION, cause },
      );
      return cause.cause instanceof OwnedCommandFailure
        ? analysisErrorWithCleanupFailure(
            historicalCaptureFailure(input, cause.cause, phase, options, heap),
            cleanup,
            OPERATION,
          )
        : cleanup;
    }
    if (cause.reason === "cancelled")
      return new AnalysisCancelledError(OPERATION, {
        cause:
          cause.cancellation === undefined
            ? options?.signal?.aborted === true
              ? options.signal.reason
              : undefined
            : cause.cancellation.reason,
      });
    if (cause.reason === "timeout") {
      const timeoutMs = selectedWebNetworkCaptureTimeoutMs(
        input.capture_timeout_ms,
      );
      return new AnalysisTimeoutError(
        OPERATION,
        timeoutMs,
        webNetworkCaptureTimeoutRecovery(timeoutMs),
      );
    }
    if (cause.reason === "output-limit")
      return new AnalysisOutputError(OPERATION, cause.message);
    // The job's own notification is runtime-independent; Bun's exit status
    // and diagnostics for an allocation failure are not.
    if (
      phase === "decoder" &&
      cause.reason === "process" &&
      cause.snapshot?.memoryLimitReached === true
    )
      return captureMemoryFailure(
        input,
        CAPTURE_PROCESS_MEMORY_LIMIT_REASON,
        cause,
        heap,
      );
    if (
      phase === "decoder" &&
      input.format !== "mitmproxy" &&
      cause.reason === "process" &&
      (cause.snapshot?.signal === "SIGABRT" ||
        (cause.snapshot?.signal === null && cause.snapshot.exitCode === 134)) &&
      /FATAL ERROR:[^\r\n]*heap out of memory/u.test(cause.snapshot.stderr.text)
    )
      return captureMemoryFailure(
        input,
        `The ${input.format} decoder exhausted its ${String(heap.oldGenerationMiB)} MiB V8 old-generation heap (source ${heap.source})`,
        cause,
        heap,
      );
  }
  if (
    phase !== "decoder" &&
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "integrity"
  )
    return new AnalysisArtifactChangedError(
      OPERATION,
      sourcePath,
      cause.message,
      { cause },
    );
  if (
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "cancelled"
  )
    return new AnalysisCancelledError(OPERATION, {
      cause: artifactFileCancellationCause(cause),
    });
  if (
    phase !== "decoder" &&
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    (cause.reason === "limit" ||
      cause.reason === "format" ||
      cause.reason === "path")
  )
    return new AnalysisInputError(OPERATION, { cause }, [
      {
        path: inputPath,
        reason: cause.reason === "limit" ? "out_of_range" : "invalid_format",
        message:
          cause.reason === "limit"
            ? `${cause.message}. Select a ${sourceLabel} within the ${String(WEB_NETWORK_CAPTURE_LIMITS.inputBytes)}-byte input budget. This release has no runtime override. capture_timeout_ms does not raise it.`
            : cause.message,
        ...(cause.reason === "limit"
          ? {
              expected: {
                [descriptorRead
                  ? "maximum_descriptor_set_bytes"
                  : "maximum_capture_bytes"]:
                  WEB_NETWORK_CAPTURE_LIMITS.inputBytes,
              },
            }
          : {}),
      },
    ]);
  if (
    phase !== "decoder" &&
    cause instanceof Error &&
    "code" in cause &&
    (cause.code === "EACCES" || cause.code === "EPERM")
  )
    return new AnalysisAccessDeniedError(OPERATION, sourcePath, cause.code, {
      cause,
    });
  if (
    phase !== "decoder" &&
    cause instanceof Error &&
    "code" in cause &&
    ["ENOENT", "ENOTDIR"].includes(String(cause.code))
  )
    return new AnalysisInputError(OPERATION, { cause }, [
      {
        path: inputPath,
        reason: "invalid_value",
        message: `Selected ${sourceLabel} could not be read (${String(cause.code)}): ${sourcePath}.`,
      },
    ]);
  if (
    // Stable source reads report owned cancellation with ArtifactReaderFailure.
    // Bare syscall rejections remain physical even when they equal the abort reason.
    phase === "decoder" &&
    origin === "owned-or-classified" &&
    options?.signal?.aborted === true &&
    (cause === options.signal.reason ||
      (cause instanceof Error &&
        cause.name === "AbortError" &&
        "code" in cause &&
        cause.code === "ABORT_ERR"))
  )
    return new AnalysisCancelledError(OPERATION, {
      cause: options.signal.reason,
    });
  return new ProviderAdapterError(input.format, OPERATION, {
    cause,
    diagnostics: {
      phase,
      capture_path: input.capture_path,
      ...(descriptorRead
        ? { source_path: sourcePath, input_path: inputPath }
        : {}),
      reason: cause instanceof Error ? cause.message : String(cause),
      ...(origin === "owned-or-classified" &&
      cause instanceof ArtifactReaderFailure
        ? { failure_kind: cause.reason }
        : {}),
      ...(origin === "owned-or-classified" &&
      cause instanceof OwnedCommandFailure &&
      cause.snapshot !== null
        ? {
            exit_code: cause.snapshot.exitCode ?? null,
            signal: cause.snapshot.signal ?? null,
            stdout: cause.snapshot.stdout.text,
            stderr: cause.snapshot.stderr.text,
            diagnostic_truncated: cause.snapshot.diagnosticTruncated ?? false,
          }
        : {}),
    },
  });
};

/** Preserve a decoder's observed memory failure and its actual workload limits. */
export const captureMemoryFailure = (
  input: InspectWebNetworkCaptureInput,
  reason: string,
  cause?: unknown,
  heap: CaptureDecoderHeap = DEFAULT_CAPTURE_DECODER_HEAP,
): AnalysisResourceConstraintError => {
  const processMemoryLimitBytes = captureDecoderProcessMemoryLimitBytes(
    heap.oldGenerationMiB,
  );
  const recovery = captureDecoderHeapRecovery(heap);
  return new AnalysisResourceConstraintError(
    OPERATION,
    "memory",
    `${reason}: ${input.capture_path}. No complete capture result is available.`,
    {
      boundary: "historical-capture-decoder",
      capture_path: input.capture_path,
      format: input.format,
      maximum_input_bytes: WEB_NETWORK_CAPTURE_LIMITS.inputBytes,
      maximum_reply_bytes: WEB_NETWORK_CAPTURE_LIMITS.outputBytes,
      ...(input.format !== "mitmproxy" && NODE_CAPTURE_HEAP_ENFORCED
        ? {
            old_generation_heap_mib: heap.oldGenerationMiB,
            old_generation_heap_source: heap.source,
            semi_space_heap_mib: NODE_CAPTURE_HEAP_LIMITS.semiSpaceMiB,
          }
        : {}),
      ...(input.format !== "mitmproxy" && processMemoryLimitBytes !== null
        ? {
            process_memory_limit_bytes: processMemoryLimitBytes,
          }
        : {}),
      ...(cause instanceof OwnedCommandFailure
        ? {
            observed_exit_code: cause.snapshot?.exitCode ?? null,
            observed_signal: cause.snapshot?.signal ?? null,
          }
        : {}),
    },
    {
      cause,
      ...(input.format !== "mitmproxy" &&
      (NODE_CAPTURE_HEAP_ENFORCED || processMemoryLimitBytes !== null)
        ? {
            limit: analysisSettingLimit(
              "capture.decoder_old_generation_mib",
              heap.oldGenerationMiB,
              heap.source,
            ),
          }
        : {}),
      remediationAction: `Use a smaller capture exported by its producer, or another decoder with sufficient capacity for the original capture. Preserve the original for provenance; a subset does not establish complete-capture coverage.${input.format !== "mitmproxy" ? ` ${recovery}` : ""}${input.format !== "mitmproxy" && processMemoryLimitBytes !== null ? ` The Windows Job Object commit limit for this decoder is ${String(processMemoryLimitBytes)} bytes, ${String(heap.oldGenerationMiB)} MiB plus a 512 MiB Bun reserve.` : ""}`,
      ...(cause instanceof OwnedCommandFailure && cause.snapshot !== null
        ? {
            capturedOutput: {
              stdout: cause.snapshot.stdout.text,
              stderr: cause.snapshot.stderr.text,
              truncated: cause.snapshot.diagnosticTruncated ?? false,
            },
          }
        : {}),
    },
  );
};

/** Preserve the exact file owner when capture or descriptor acquisition needs cleanup. */
export const withCaptureReaderCleanup = (
  primary: AnalysisError,
  cause: unknown,
): AnalysisError => {
  if (!(cause instanceof ArtifactReaderFailure) || cause.cleanup === undefined)
    return primary;
  const cleanup = new ProviderCleanupError(
    "web-network-capture",
    cause.cleanup.resources,
    { reason: cause.cleanup.reason },
    { operation: OPERATION, cause },
  );
  bindArtifactFileCleanup(cause, cleanup);
  if (
    cause.reason === "unavailable" &&
    primary instanceof ProviderAdapterError &&
    primary.cause === cause
  ) {
    if (primary.partialObservation !== undefined)
      cleanup.retainPartialObservation(primary.partialObservation);
    return cleanup;
  }
  const composed = analysisErrorWithCleanupFailure(
    primary,
    cleanup,
    OPERATION,
  ).bindCleanupDependencies([primary, cleanup]);
  bindArtifactFileCleanup(cause, composed);
  return composed;
};
