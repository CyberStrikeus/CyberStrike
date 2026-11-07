import type { FileSnapshotPartialObservation } from "../../domain/fileSnapshotObservation.js";
import {
  decodeCaptureProtobuf,
  prepareCaptureProtobuf,
} from "./protobuf/ProtobufCapture.js";
import { CaptureFormatError } from "./CaptureFormatError.js";
import {
  CAPTURE_PROCESS_MEMORY_LIMIT_REASON,
  historicalCaptureFailure,
  captureMemoryFailure,
  withCaptureReaderCleanup,
} from "./CaptureFailures.js";
import {
  captureDecoderHeapRecovery,
  resolveCaptureDecoderHeap,
  type CaptureDecoderHeap,
} from "../../config/captureDecoderHeap.js";
import {
  NODE_CAPTURE_HEAP_ENFORCED,
  captureDecoderProcessMemoryLimitBytes,
} from "./CaptureRelease.js";
import type { HistoricalCaptureFormatAdapter } from "./HistoricalCaptureFormatAdapter.js";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExecutionOptions } from "../../application/AnalysisProvider.js";
import { readStableArtifact } from "../../artifacts/readStableArtifact.js";
import { completedStableArtifactObservation } from "../../artifacts/StableArtifactObservation.js";
import type { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import {
  ArtifactResourceScope,
  type ArtifactCleanupAttempt,
} from "../../artifacts/ArtifactResourceScope.js";
import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../../artifacts/AnalysisCleanupLease.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
} from "../../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  WEB_NETWORK_CAPTURE_LIMITS,
  selectedWebNetworkCaptureTimeoutMs,
  type InspectWebNetworkCaptureInput,
  type WebNetworkCapture,
} from "../../domain/webNetworkCapture.js";
import { snapshotEnvironment } from "../../process/snapshotEnvironment.js";
import {
  OwnedCommandFailure,
  runOwnedCommand,
} from "../../process/OwnedCommand.js";
import { PrivateRuntimeRoot } from "../../process/PrivateRuntimeRoot.js";
import { redactExplicitFailure } from "../../domain/explicitSensitiveFailure.js";

import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { readHistoricalCaptureReply } from "./HistoricalCaptureReply.js";

const OPERATION = "inspect_web_network_capture";

/** One owned snapshot/process/root lifecycle for replaceable historical format decoders. */
export class HistoricalCaptureDecoder {
  readonly #resources: ArtifactResourceScope;
  readonly #heap: CaptureDecoderHeap;

  constructor(
    readonly adapters: readonly HistoricalCaptureFormatAdapter[],
    readonly environment: Readonly<NodeJS.ProcessEnv>,
    readonly createRuntime: () => Promise<
      Pick<PrivateRuntimeRoot, "path" | "close">
    > = () => PrivateRuntimeRoot.create({ prefix: "rea-web-capture-" }),
    resources = new ArtifactResourceScope(),
  ) {
    this.#resources = resources;
    // Adapters that launch the Node decoder already carry its parsed heap.
    // Reuse that fact. This environment is only the fallback when none do,
    // or when those facts disagree.
    const shared = sharedCaptureDecoderHeap(adapters);
    this.#heap = shared ?? resolveCaptureDecoderHeap(environment);
  }

  /** Heap the selected adapter launches, or the shared fallback when it has none. */
  #reportedHeap(
    adapter: HistoricalCaptureFormatAdapter | undefined,
  ): CaptureDecoderHeap {
    return adapter?.heap ?? this.#heap;
  }

  /** Retry retained readers and private roots at service shutdown. */
  close(): Promise<void> {
    return this.#resources.close();
  }

  /** Snapshot the selected artifact, decode it offline, and release private credentials and processes. */
  async inspect(
    input: InspectWebNetworkCaptureInput,
    options?: ExecutionOptions,
  ): Promise<Result<WebNetworkCapture, AnalysisError>> {
    try {
      return await this.#resources.run(() =>
        this.inspectAdmitted(input, options),
      );
    } catch (cause: unknown) {
      const error = historicalCaptureFailure(
        input,
        cause,
        "capture-read",
        options,
        this.#heap,
      );
      return err(
        redactExplicitFailure(
          withCaptureReaderCleanup(error, cause),
          input.sensitive_values,
        ),
      );
    }
  }

  private async inspectAdmitted(
    input: InspectWebNetworkCaptureInput,
    options?: ExecutionOptions,
  ): Promise<Result<WebNetworkCapture, AnalysisError>> {
    const selectedEnvironment = snapshotEnvironment(this.environment);
    let runtime: Pick<PrivateRuntimeRoot, "path" | "close"> | undefined;
    const runtimeResources = new ArtifactResourceScope();
    let processLease: AnalysisCleanupLease | undefined;
    let sourceObservation: FileSnapshotPartialObservation | undefined;
    let result: Result<WebNetworkCapture, AnalysisError>;
    let phase: "capture-read" | "decoder" = "capture-read";
    let encodedReplyBytes = 0;
    let reportedHeap = this.#heap;
    let replyFinalization: ArtifactReaderFailure | undefined;
    try {
      const selectedAdapter = this.adapters.find(
        (candidate) => candidate.format === input.format,
      );
      const adapter =
        selectedAdapter?.snapshotConfiguration?.() ?? selectedAdapter;
      reportedHeap = this.#reportedHeap(adapter);
      if (adapter === undefined)
        throw new AnalysisCapabilityUnavailableError(
          input.format,
          OPERATION,
          "No adapter is configured for the selected capture format.",
        );
      const snapshot = await readStableArtifact(
        input.capture_path,
        WEB_NETWORK_CAPTURE_LIMITS.inputBytes,
        options?.signal,
        undefined,
        this.#resources,
      );
      sourceObservation = {
        kind: "file-snapshot-hash",
        path: input.capture_path,
        sha256: snapshot.sha256,
        bytes: snapshot.bytes.length,
      };
      phase = "decoder";
      runtime = await this.createRuntime();
      const snapshotPath = join(runtime.path, "capture.snapshot");
      const requestPath = join(runtime.path, "request.json");
      const replyPath = join(runtime.path, "reply.json");
      await writeFile(snapshotPath, snapshot.bytes, {
        mode: 0o600,
        flag: "wx",
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      });
      await writeFile(
        requestPath,
        JSON.stringify({
          snapshot_path: snapshotPath,
          reply_path: replyPath,
          sensitive_values: input.sensitive_values,
        }),
        { mode: 0o600, flag: "wx" },
      );
      const command = await adapter.command(requestPath, runtime.path);
      const environment: NodeJS.ProcessEnv = {
        ...selectedEnvironment,
        UV_THREADPOOL_SIZE: "1",
      };
      delete environment.NODE_OPTIONS;
      const completed = await runOwnedCommand(
        {
          ...command,
          runId: `rea-web-capture-${randomUUID()}`,
          cwd: runtime.path,
          hostEnvironment: environment,
        },
        {
          timeoutMs: selectedWebNetworkCaptureTimeoutMs(
            input.capture_timeout_ms,
          ),
          diagnosticBytes: 1024 * 1024,
        },
        options?.signal === undefined ? {} : { signal: options.signal },
      );
      // A decoder that survived a failed allocation may still reply; its
      // reply is not trusted as complete once the limit was reached.
      if (completed.memoryLimitReached === true)
        throw captureMemoryFailure(
          input,
          CAPTURE_PROCESS_MEMORY_LIMIT_REASON,
          undefined,
          reportedHeap,
        );
      const decodedReply = await readHistoricalCaptureReply(
        replyPath,
        input.capture_path,
        runtimeResources,
        options?.signal,
        input.sensitive_values,
      );
      const reply = decodedReply.value;
      encodedReplyBytes = decodedReply.bytes;
      replyFinalization = decodedReply.finalization;
      if (!reply.ok) {
        if (reply.reason === "format")
          throw new AnalysisInputError(OPERATION, undefined, [
            {
              path: ["capture_path", reply.pointer],
              reason: "invalid_format",
              message: reply.message,
            },
          ]);
        if (reply.reason === "input-limit")
          throw new AnalysisInputError(OPERATION, undefined, [
            {
              path: ["capture_path", reply.pointer],
              reason: "out_of_range",
              message: reply.message,
              expected: {
                maximum_capture_nesting: WEB_NETWORK_CAPTURE_LIMITS.depth,
              },
            },
          ]);
        if (reply.reason === "expanded-limit")
          throw new AnalysisInputError(OPERATION, undefined, [
            {
              path: ["capture_path", reply.pointer],
              reason: "out_of_range",
              message: reply.message,
              expected: {
                maximum_expanded_capture_bytes:
                  WEB_NETWORK_CAPTURE_LIMITS.inputBytes,
              },
            },
          ]);
        if (reply.reason === "resource-limit")
          throw captureMemoryFailure(
            input,
            reply.message,
            undefined,
            reportedHeap,
          );
        if (reply.reason === "decoder")
          throw new ProviderAdapterError(input.format, OPERATION, {
            diagnostics: {
              phase: "decoder",
              failure_kind: reply.reason,
              reason: reply.message,
              pointer: reply.pointer,
            },
          });
        if (reply.reason === "unsupported")
          throw new AnalysisCapabilityUnavailableError(
            input.format,
            OPERATION,
            reply.message,
          );
        throw new AnalysisOutputError(OPERATION, reply.message, {
          userMessage: `The capture decoder refused a complete reply exceeding ${String(WEB_NETWORK_CAPTURE_LIMITS.outputBytes)} bytes: ${reply.message}`,
          remediationAction: `The ${String(WEB_NETWORK_CAPTURE_LIMITS.outputBytes)}-byte complete-reply allowance has no runtime override. Select a smaller capture exported by its producer when a narrower observation is acceptable. Record selection, delivery mode and worker memory do not raise it; no completed capture Evidence is available from this refusal.`,
          diagnostics: {
            maximum_reply_bytes: WEB_NETWORK_CAPTURE_LIMITS.outputBytes,
            boundary: "historical-capture-reply",
          },
        });
      }
      if (
        reply.value.decoder.id !== adapter.identity.id ||
        reply.value.decoder.name !== adapter.identity.name ||
        reply.value.decoder.version !== adapter.identity.version
      )
        throw new AnalysisOutputError(
          OPERATION,
          "Capture decoder changed the selected upstream profile identity.",
        );
      const common = {
        artifact: {
          path: input.capture_path,
          sha256: snapshot.sha256,
          bytes: snapshot.bytes.length,
        },

        runtime_attribution: "unknown" as const,
        limitations: [
          ...(adapter.limitations ?? []),
          "This is retained producer evidence, without live browser transaction IDs, scenario provenance, execution attribution or deployment authenticity. Recorded URLs are never fetched.",
          "Every record is decoded before selection; no partial success is returned on malformed input or a resource limit.",
          "Known authentication headers/cookies and explicitly marked literal values are excluded. Unknown extension names do not establish sensitivity.",
          `Complete evidence is bounded by a ${String(WEB_NETWORK_CAPTURE_LIMITS.inputBytes)}-byte input budget, a ${String(WEB_NETWORK_CAPTURE_LIMITS.outputBytes)}-byte reply budget, and a ${String(WEB_NETWORK_CAPTURE_LIMITS.depth)}-level nesting cap. Those have no runtime override. capture_timeout_ms is ${String(selectedWebNetworkCaptureTimeoutMs(input.capture_timeout_ms))} ms (omitted means ${String(WEB_NETWORK_CAPTURE_LIMITS.timeoutMs)}). ${nodeMemoryLimitation(reportedHeap)} Mitmproxy decoding uses a 768 MiB Linux address-space limit.`,
        ],
      };
      if (input.format === "qlog") {
        if (!("qlog" in reply.value))
          throw new AnalysisOutputError(
            OPERATION,
            "Capture decoder omitted qlog transport facts.",
          );
        result = ok({ ...reply.value, ...common, format: "qlog" });
      } else {
        if ("qlog" in reply.value)
          throw new AnalysisOutputError(
            OPERATION,
            "Capture decoder supplied inapplicable qlog transport facts.",
          );
        result = ok({ ...reply.value, ...common, format: input.format });
      }
      if (result.ok) {
        let safePartialSource = false;
        try {
          const prepared = await prepareCaptureProtobuf(
            result.value,
            input,
            options?.signal,
          );
          safePartialSource = true;
          await decodeCaptureProtobuf(
            result.value,
            input,
            this.#resources,
            prepared,
            options?.signal,
            encodedReplyBytes + Buffer.byteLength(JSON.stringify(common)) + 16,
          );
        } catch (cause) {
          const error =
            cause instanceof CaptureFormatError && cause.reason === "limit"
              ? new AnalysisResourceConstraintError(
                  OPERATION,
                  "capacity",
                  cause.message,
                  {
                    maximum_encoded_capture_bytes:
                      WEB_NETWORK_CAPTURE_LIMITS.outputBytes,
                  },
                  {
                    retryable: false,
                    remediationAction:
                      "Select smaller records, or inspect the retained original source bytes.",
                  },
                )
              : cause instanceof CaptureFormatError
                ? new AnalysisInputError(OPERATION, undefined, [
                    {
                      path: ["protobuf"],
                      reason: "invalid_format",
                      message: cause.message,
                    },
                  ])
                : historicalCaptureFailure(
                    input,
                    cause,
                    phase,
                    options,
                    reportedHeap,
                  );
          if (safePartialSource) error.retainPartialObservation(result.value);
          throw error;
        }
        if (replyFinalization !== undefined) {
          const error = historicalCaptureFailure(
            input,
            replyFinalization,
            phase,
            options,
            reportedHeap,
          );
          error.retainPartialObservation(result.value);
          throw error;
        }
      }
    } catch (cause: unknown) {
      if (
        cause instanceof OwnedCommandFailure &&
        cause.cleanupOwner !== undefined
      ) {
        const supervisor = cause.cleanupOwner;
        processLease = new AnalysisCleanupLease(async () => {
          const stopped = await supervisor.stop();
          if (stopped.status === "incomplete")
            throw new ProviderCleanupError(
              input.format,
              cause.resources,
              {
                reason: stopped.reason,
              },
              { operation: OPERATION, cause: stopped },
            );
        }, cause.resources);
        runtimeResources.retain({
          kind: "lease",
          resource: runtime?.path ?? input.capture_path,
          lease: processLease,
        });
      }
      const error = historicalCaptureFailure(
        input,
        cause,
        phase,
        options,
        reportedHeap,
      );
      if (
        replyFinalization?.reason === "cancelled" &&
        !(error instanceof AnalysisCancelledError)
      ) {
        const cancellation = historicalCaptureFailure(
          input,
          replyFinalization,
          phase,
          options,
          reportedHeap,
        );
        error.retainSecondaryFailure(cancellation, {
          reply_finalization_error: projectAnalysisError(cancellation),
        });
      }
      const failure = withCaptureReaderCleanup(
        error,
        replyFinalization ?? cause,
      );
      if (processLease !== undefined)
        new AnalysisCleanupLeaseGroup(failure, [processLease]);
      if (phase === "capture-read") {
        const snapshot = completedStableArtifactObservation(
          cause,
          input.capture_path,
        );
        if (snapshot !== undefined) failure.retainPartialObservation(snapshot);
      }
      if (
        failure.partialObservation === undefined &&
        sourceObservation !== undefined
      )
        failure.retainPartialObservation(sourceObservation);
      result = err(redactExplicitFailure(failure, input.sensitive_values));
    }
    const completedCapture = result.ok ? result.value : undefined;
    let cleanupFailure:
      | Extract<ArtifactCleanupAttempt, { readonly kind: "failed" }>
      | undefined;
    if (runtime !== undefined) {
      const root = runtime;
      const lease = new AnalysisCleanupLease(
        async () => {
          await runtimeResources.close();
          await root.close();
        },
        {
          get cleanupResources() {
            return [
              ...new Set([root.path, ...runtimeResources.cleanupResources]),
            ];
          },
        },
      );
      const owner = { kind: "lease" as const, resource: root.path, lease };
      if (runtimeResources.hasPending) {
        // Failed child cleanup is retried by the service owner, after active peers settle.
        this.#resources.retain(owner);
        cleanupFailure = {
          kind: "failed",
          owner,
          lease,
          cause: new ProviderCleanupError(
            input.format,
            lease.cleanupResources ?? [root.path],
            {
              reason:
                "Capture decoder resources must be released before runtime removal.",
            },
            { operation: OPERATION },
          ),
        };
      } else {
        const cleanup = await this.#resources.release(owner);
        if (cleanup.kind === "failed") cleanupFailure = cleanup;
      }
    }
    if (result.ok && options?.signal?.aborted)
      result = err(
        new AnalysisCancelledError(OPERATION, {
          cause: options.signal.reason,
        }),
      );
    if (cleanupFailure !== undefined) {
      const cleanupError = new ProviderCleanupError(
        input.format,
        [cleanupFailure.owner.resource],
        {
          capture_path: input.capture_path,
          reason:
            cleanupFailure.cause instanceof Error
              ? cleanupFailure.cause.message
              : String(cleanupFailure.cause),
        },
        {
          operation: OPERATION,
          cause: cleanupFailure.cause,
        },
      );
      const failure = result.ok
        ? cleanupError
        : analysisErrorWithCleanupFailure(
            result.error,
            cleanupError,
            OPERATION,
          );
      if (completedCapture !== undefined)
        failure.retainPartialObservation(completedCapture);
      new AnalysisCleanupLeaseGroup(cleanupError, [cleanupFailure.lease]);
      if (!result.ok)
        failure.bindCleanupDependencies([result.error, cleanupError]);
      new AnalysisCleanupLeaseGroup(failure, [cleanupFailure.lease]);
      return err(redactExplicitFailure(failure, input.sensitive_values));
    }
    if (!result.ok && completedCapture !== undefined)
      result.error.retainPartialObservation(completedCapture);
    return result;
  }
}

/** One shared parsed heap, when every Node adapter agrees. Disagreement stays unresolved here. */
const sharedCaptureDecoderHeap = (
  adapters: readonly HistoricalCaptureFormatAdapter[],
): CaptureDecoderHeap | undefined => {
  const heaps = adapters.flatMap((adapter) =>
    adapter.heap === undefined ? [] : [adapter.heap],
  );
  const first = heaps[0];
  if (first === undefined) return undefined;
  return heaps.every(
    (heap) =>
      heap === first ||
      (heap.oldGenerationMiB === first.oldGenerationMiB &&
        heap.source === first.source),
  )
    ? first
    : undefined;
};

/** The Node capture decoder runs on this executable; only Node.js enforces its V8 heap flags. */
const nodeMemoryLimitation = (heap: CaptureDecoderHeap): string => {
  const recovery = captureDecoderHeapRecovery(heap);
  if (NODE_CAPTURE_HEAP_ENFORCED)
    return `HAR/SAZ/qlog use a ${String(heap.oldGenerationMiB)} MiB Node old-generation heap (source ${heap.source}). ${recovery}`;
  const commitLimit = captureDecoderProcessMemoryLimitBytes(
    heap.oldGenerationMiB,
  );
  return commitLimit === null
    ? `HAR/SAZ/qlog run on Bun, which does not enforce REA's V8 heap flags. ${recovery}`
    : `HAR/SAZ/qlog run on Bun, which does not enforce REA's V8 heap flags, under a ${String(commitLimit)}-byte Windows Job Object commit limit. ${recovery}`;
};
