import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { ArtifactOperationError } from "../../domain/artifactOperationError.js";
import { err, ok, type Result } from "../../domain/result.js";
import { javaScriptRuntime } from "../../domain/runtimeVersion.js";
import type { WebSourceMapReport } from "../../domain/webSourceLocation.js";
import { sourceMapCodecReplySchema } from "./SourceMapCodecProtocol.js";

const OPERATION = "trace_web_source_location";

/** Interpret the complete codec reply before its command owner finalizes. */
export const parseSourceMapReply = (
  text: string,
  path: string,
  processMemoryLimitBytes: number | null,
): Result<WebSourceMapReport, AnalysisError> => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause: unknown) {
    return err(
      new AnalysisOutputError(
        OPERATION,
        `Malformed codec JSON reply: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    );
  }
  const reply = sourceMapCodecReplySchema.safeParse(value);
  if (!reply.success)
    return err(
      new AnalysisOutputError(
        OPERATION,
        `Malformed codec reply: ${reply.error.message}`,
      ),
    );
  if (reply.data.state === "failure")
    return codecFailure(path, reply.data.reason, reply.data.message);
  const runtimeFailure = codecRuntimeFailure(
    reply.data.report.runtime,
    processMemoryLimitBytes,
  );
  return runtimeFailure === undefined
    ? ok(reply.data.report)
    : err(new AnalysisOutputError(OPERATION, runtimeFailure));
};

/** Only the launched Node runtime's V8 heap, or Bun's process limit, is admitted. */
const codecRuntimeFailure = (
  runtime: WebSourceMapReport["runtime"],
  processMemoryLimitBytes: number | null,
): string | undefined => {
  if (
    runtime.id !==
    (javaScriptRuntime(process.versions).id === "bun" ? "bun" : "node-v8")
  )
    return `Codec reported runtime ${runtime.id}, not the runtime that launched it.`;
  if (
    runtime.id === "node-v8" &&
    runtime.v8_heap_limit_bytes > 256 * 1024 * 1024
  )
    return "Codec reported a V8 heap limit exceeding its independent process budget.";
  if (
    runtime.id === "bun" &&
    runtime.process_memory_limit_bytes !== processMemoryLimitBytes
  )
    return "Codec reported a process memory limit other than the one its launcher enforced.";
  return undefined;
};

const codecFailure = (
  path: string,
  reason: "format" | "unsupported" | "limit",
  detail: string,
): Result<never, AnalysisError> =>
  err(
    reason === "limit"
      ? new ArtifactOperationError(
          OPERATION,
          "limit",
          undefined,
          `${path}: ${detail}`,
        )
      : reason === "unsupported"
        ? new AnalysisCapabilityUnavailableError(
            "source-map-decoder",
            OPERATION,
            "unsupported_source_map_profile",
            { userMessage: `${path}: ${detail}` },
          )
        : new AnalysisInputError(OPERATION, undefined, [
            {
              path: ["source_map", "path"],
              reason: "invalid_format",
              message: `${path}: ${detail}`,
            },
          ]),
  );
