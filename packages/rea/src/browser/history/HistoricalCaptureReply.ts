import { z } from "zod";
import type { JsonValue } from "../../domain/jsonValue.js";
import { CaptureRedaction, capturePointer } from "./CaptureRedaction.js";
import type { WebNetworkCaptureRecord } from "../../domain/webNetworkCapture.js";
import { safeParseUtf8Json } from "../../domain/safeJson.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { artifactFileCancellationCause } from "../../artifacts/ArtifactFileOperation.js";
import {
  completedStableArtifact,
  readStableArtifact,
} from "../../artifacts/readStableArtifact.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { withCaptureReaderCleanup } from "./CaptureFailures.js";
import {
  WEB_NETWORK_CAPTURE_LIMITS,
  webNetworkCapturePayloadSchema,
} from "../../domain/webNetworkCapture.js";

const replySchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    value: webNetworkCapturePayloadSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum([
      "format",
      "unsupported",
      "input-limit",
      "expanded-limit",
      "resource-limit",
      "decoder",
      "limit",
    ]),
    message: z.string(),
    pointer: z.string(),
  }),
]);

/** Decode a bounded reply while keeping its completed read and descriptor finalization distinct. */
export const readHistoricalCaptureReply = async (
  path: string,
  capturePath: string,
  resources: ArtifactResourceScope,
  signal?: AbortSignal,
  sensitiveValues: readonly string[] = [],
) => {
  let finalization: ArtifactReaderFailure | undefined;
  try {
    let file;
    try {
      file = await readStableArtifact(
        path,
        WEB_NETWORK_CAPTURE_LIMITS.outputBytes,
        signal,
        undefined,
        resources,
      );
    } catch (cause: unknown) {
      const completed = completedStableArtifact(cause);
      if (!(cause instanceof ArtifactReaderFailure) || completed === undefined)
        throw cause;
      finalization = cause;
      file = completed;
    }
    const decoded = safeParseUtf8Json(file.bytes);
    if (!decoded.ok) throw decoded.cause;
    const value = replySchema.parse(decoded.value);
    if (value.ok && sensitiveValues.length > 0) {
      excludeNormalizedNumbers(value.value.container, sensitiveValues);
      for (const record of value.value.records)
        excludeNormalizedNumbers(record, sensitiveValues);
    }
    return {
      value,
      bytes: file.bytes.length,
      finalization,
    };
  } catch (cause: unknown) {
    if (cause instanceof ArtifactReaderFailure) throw cause;
    if (
      signal?.aborted === true &&
      (cause === signal.reason ||
        (cause instanceof Error &&
          cause.name === "AbortError" &&
          "code" in cause &&
          cause.code === "ABORT_ERR"))
    )
      throw cause;
    const error = new AnalysisOutputError(
      "inspect_web_network_capture",
      `Owned capture decoder reply failed for ${capturePath}: ${replyFailureReason(cause)}`,
      { cause },
    );
    if (finalization?.reason === "cancelled") {
      const cancellation = new AnalysisCancelledError(
        "inspect_web_network_capture",
        { cause: artifactFileCancellationCause(finalization) },
      );
      error.retainSecondaryFailure(cancellation, {
        reply_finalization_error: projectAnalysisError(cancellation),
      });
    }
    throw withCaptureReaderCleanup(error, finalization);
  }
};

const replyFailureReason = (cause: unknown): string => {
  if (cause instanceof ArtifactReaderFailure) return cause.message;
  if (cause instanceof z.ZodError)
    return `Reply violates its schema at ${cause.issues[0]?.path.map(String).join(".") ?? "root"}.`;
  if (cause instanceof SyntaxError) return "Reply is malformed JSON.";
  if (
    cause instanceof Error &&
    "code" in cause &&
    cause.code === "ERR_ENCODING_INVALID_ENCODED_DATA"
  )
    return "Reply is not valid UTF-8.";
  if (cause instanceof Error && "code" in cause)
    return `Reply file could not be read (${String(cause.code)}).`;
  return "Reply could not be validated.";
};

/** The bridge excludes producer literals; this boundary owns their JavaScript spelling. */
const excludeNormalizedNumbers = (
  projection: Pick<
    WebNetworkCaptureRecord,
    "reported" | "numeric_literals" | "redactions"
  >,
  sensitiveValues: readonly string[],
): void => {
  const redaction = new CaptureRedaction(sensitiveValues);
  const excluded = new Set<string>();
  const visit = (value: JsonValue, pointer: string): JsonValue => {
    if (typeof value === "number") {
      if (redaction.text(String(value), pointer) === null) {
        excluded.add(pointer);
        return null;
      }
    } else if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++)
        value[index] = visit(
          value[index]!,
          capturePointer(pointer, String(index)),
        );
    } else if (value !== null && typeof value === "object") {
      for (const key of Object.keys(value))
        value[key] = visit(value[key]!, capturePointer(pointer, key));
    }
    return value;
  };
  // The schema-validated reply is exclusively owned here, before Evidence retention.
  projection.reported = visit(projection.reported, "");
  if (excluded.size === 0) return;
  projection.numeric_literals = projection.numeric_literals.filter(
    (number) => !excluded.has(number.pointer),
  );
  projection.redactions.push(...redaction.redactions);
};
