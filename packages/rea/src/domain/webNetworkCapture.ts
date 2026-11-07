import { z } from "zod";
import {
  browserDeadlineIncrease,
  browserDeadlineRetry,
  noRuntimeOverrideSentence,
  optionalBrowserDeadlineMs,
  selectedBrowserDeadlineMs,
} from "./browserDeadline.js";
import { jsonValueSchema } from "./jsonValue.js";
import { absoluteLocalPathStringSchema } from "./localPath.js";
import {
  protobufDecodingSchema,
  protobufOptionsSchema,
} from "./protobufWire.js";
import { qlogCaptureFactsSchema } from "./qlogCapture.js";
import { canBorrowParsedJsonSnapshot } from "./immutableJson.js";

/** Complete historical evidence budgets; exceeding a budget returns no partial capture. */
export const WEB_NETWORK_CAPTURE_LIMITS = {
  inputBytes: 32 * 1024 * 1024,
  outputBytes: 96 * 1024 * 1024,
  timeoutMs: 30_000,
  depth: 64,
} as const;

/** Capture deadline used when capture_timeout_ms is omitted. */
export const DEFAULT_WEB_NETWORK_CAPTURE_TIMEOUT_MS =
  WEB_NETWORK_CAPTURE_LIMITS.timeoutMs;

export const selectedWebNetworkCaptureTimeoutMs = (
  selected: number | undefined,
): number =>
  selectedBrowserDeadlineMs(selected, DEFAULT_WEB_NETWORK_CAPTURE_TIMEOUT_MS);

/** Caller-visible capture deadline. Byte and depth caps stay fixed. */
export const webNetworkCaptureTimeoutRecovery = (
  timeoutMs: number,
): { readonly userMessage: string; readonly remediationAction: string } => ({
  userMessage: `inspect_web_network_capture reached its ${String(timeoutMs)} ms capture deadline (deadlineExpired) for capture_timeout_ms. No partial capture is returned. This is not the MCP client deadline.`,
  remediationAction: `${browserDeadlineIncrease("capture_timeout_ms", timeoutMs, DEFAULT_WEB_NETWORK_CAPTURE_TIMEOUT_MS, "--capture-timeout-ms")} ${browserDeadlineRetry} ${noRuntimeOverrideSentence(`The ${String(WEB_NETWORK_CAPTURE_LIMITS.inputBytes)}-byte input budget, ${String(WEB_NETWORK_CAPTURE_LIMITS.outputBytes)}-byte reply budget, and ${String(WEB_NETWORK_CAPTURE_LIMITS.depth)}-level nesting cap stay fixed.`, "capture_timeout_ms")}`,
});

export const WEB_NETWORK_CAPTURE_FORMATS = [
  "har",
  "mitmproxy",
  "saz",
  "qlog",
] as const;

/** Inspect an explicit retained capture without contacting its recorded destinations. */
export const inspectWebNetworkCaptureInputSchema = z.strictObject({
  capture_path: absoluteLocalPathStringSchema.describe(
    "Absolute local HAR, mitmproxy, Fiddler SAZ or aioquic qlog capture path.",
  ),
  format: z.enum(WEB_NETWORK_CAPTURE_FORMATS),
  record_ordinals: z
    .array(z.int().nonnegative())
    .min(1)
    .optional()
    .describe(
      "Zero-based producer record ordinals, in caller-selected order. Omit to inspect every record.",
    ),
  protobuf: protobufOptionsSchema.optional(),
  sensitive_values: z
    .array(z.string().min(1))
    .default([])
    .describe(
      "Literal text excluded from capture payloads, byte/numeric projections, producer coordinates, artifact paths/digests and diagnostic text. Declaration strings are never persisted in Evidence parameters. Canonical contract keys, enums and provider identities remain intact.",
    ),
  capture_timeout_ms: optionalBrowserDeadlineMs(
    `Capture wall-clock deadline in milliseconds (default ${String(DEFAULT_WEB_NETWORK_CAPTURE_TIMEOUT_MS)}), from decoder start through process exit. Omitted means ${String(DEFAULT_WEB_NETWORK_CAPTURE_TIMEOUT_MS)} and applies on the next capture. deadlineExpired returns no partial capture. Does not raise the fixed ${String(WEB_NETWORK_CAPTURE_LIMITS.inputBytes)}-byte input budget, ${String(WEB_NETWORK_CAPTURE_LIMITS.outputBytes)}-byte reply budget, or ${String(WEB_NETWORK_CAPTURE_LIMITS.depth)}-level nesting cap. Those have no runtime override.`,
  ),
});

/** Read declarations through their owning schema for service and adapter failures. */
export const captureSensitiveValues = (
  rawInput: unknown,
): readonly string[] => {
  const parsed =
    inspectWebNetworkCaptureInputSchema.shape.sensitive_values.safeParse(
      typeof rawInput === "object" &&
        rawInput !== null &&
        "sensitive_values" in rawInput
        ? rawInput.sensitive_values
        : undefined,
    );
  return parsed.success ? parsed.data : [];
};

const pointerSchema = z
  .string()
  .describe("RFC 6901 pointer in the producer's reported object.");
const redactionSchema = z.union([
  z.strictObject({
    pointer: pointerSchema,
    reason: z.enum(["transport-credential", "explicit-sensitive-value"]),
  }),
  z.strictObject({
    pointer: pointerSchema,
    reason: z.literal("explicit-sensitive-value"),
    scope: z
      .literal("property-name")
      .describe(
        "An omitted property name; pointer identifies its actual parent, not an invented child coordinate.",
      ),
  }),
]);
const binaryBase = {
  pointer: pointerSchema,
  representation: z.enum(["producer-bytes", "har-base64-content"]),
};
const retainedBinaryDescriptorSchema = z.strictObject({
  ...binaryBase,
  state: z.literal("retained"),
  bytes: z.int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
const redactedBinaryDescriptorSchema = z.strictObject({
  ...binaryBase,
  state: z.literal("redacted"),
  bytes: z.null(),
  sha256: z.null(),
});
/** Exact byte facts shared by complete records and previews that omit content. */
export const webNetworkCaptureBinaryDescriptorSchema = z.discriminatedUnion(
  "state",
  [retainedBinaryDescriptorSchema, redactedBinaryDescriptorSchema],
);
const binarySchema = z.discriminatedUnion("state", [
  retainedBinaryDescriptorSchema.extend({ content_base64: z.string() }),
  redactedBinaryDescriptorSchema.extend({ content_base64: z.null() }),
]);
const numberSchema = z.strictObject({
  pointer: pointerSchema,
  producer_type: z.enum(["json-number", "integer", "float"]),
  literal: z.string(),
});

/** Preserve producer representations with independent sidecars rather than invented browser IDs. */
export const webNetworkCaptureRecordSchema = z.strictObject({
  ordinal: z.int().nonnegative(),
  location: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("unknown"),
      reason: z.literal("explicit-sensitive-value"),
    }),
    z.strictObject({ kind: z.literal("json-pointer"), pointer: pointerSchema }),
    z.strictObject({
      kind: z.literal("archive-members"),
      members: z.array(z.string()).min(1),
    }),
    z.strictObject({
      kind: z.literal("byte-range"),
      offset: z.int().nonnegative(),
      bytes: z.int().positive(),
    }),
  ]),
  reported: jsonValueSchema,
  binary_fields: z.array(binarySchema),
  numeric_literals: z.array(numberSchema),
  redactions: z.array(redactionSchema),
  limitations: z.array(z.string()),
  protobuf: z
    .array(protobufDecodingSchema)
    .exactOptional()
    .describe(
      "Flat decoding facts for explicitly selected records. Field indices are local to a body; offset_basis states whether ranges refer to retained or base64-decoded bytes. Interpretations without a caller-supplied schema are candidates.",
    ),
});

/** The selected offline parser profile, independent of authenticated producer identity. */
export const webNetworkCaptureDecoderSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
});

/** Source coverage is shared by every offline decoder. */
export const protobufCaptureCoverageSchema = z
  .strictObject({
    status: z.enum(["complete", "partial"]),
    selected_records: z.number().int().nonnegative(),
    inspected_records: z.number().int().nonnegative(),
  })
  .superRefine((coverage, context) => {
    if (
      coverage.inspected_records > coverage.selected_records ||
      (coverage.status === "complete" &&
        coverage.inspected_records !== coverage.selected_records)
    )
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Protobuf coverage contradicts its inspected selection.",
      });
  });
const payloadShape = {
  protobuf_coverage: protobufCaptureCoverageSchema.exactOptional(),
  decoder: webNetworkCaptureDecoderSchema,
  container: z.strictObject({
    reported: jsonValueSchema,
    numeric_literals: z.array(numberSchema),
    redactions: z.array(redactionSchema),
    records_pointer: pointerSchema.nullable(),
  }),
  total_records: z.int().nonnegative(),
  records: z.array(webNetworkCaptureRecordSchema),
};
const refineCoverage = (
  capture: { total_records: number; records: { ordinal: number }[] },
  context: z.RefinementCtx,
): void => {
  const seen = new Set<number>();
  for (const [index, record] of capture.records.entries()) {
    if (record.ordinal >= capture.total_records || seen.has(record.ordinal)) {
      context.addIssue({
        code: "custom",
        path: ["records", index, "ordinal"],
        message:
          "Retained ordinals must be unique and within the declared capture total.",
      });
      return;
    }
    seen.add(record.ordinal);
  }
};
/** Strict alternatives prevent undefined-valued facets from entering JSON Evidence. */
export const webNetworkCapturePayloadSchema = z
  .union([
    z.strictObject({ ...payloadShape, qlog: qlogCaptureFactsSchema }),
    z.strictObject(payloadShape),
  ])
  .superRefine(refineCoverage);
/** Caller-selected file identity; explicit exclusions remain unknown. */
export const webNetworkCaptureArtifactSchema = z.strictObject({
  path: z
    .string()
    .describe(
      "Selected artifact path; empty when explicitly excluded from Evidence.",
    ),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable()
    .describe("Observed SHA-256; null only when explicitly excluded."),
  bytes: z.int().nonnegative(),
});
const artifactShape = {
  artifact: webNetworkCaptureArtifactSchema,
  runtime_attribution: z.literal("unknown"),
  limitations: z.array(z.string()),
};
/** Qlog transport facts occur exactly on the qlog alternative. */
export const webNetworkCaptureSchema = z
  .discriminatedUnion("format", [
    z.strictObject({
      ...payloadShape,
      ...artifactShape,
      format: z.enum(["har", "mitmproxy", "saz"]),
    }),
    z.strictObject({
      ...payloadShape,
      ...artifactShape,
      format: z.literal("qlog"),
      qlog: qlogCaptureFactsSchema,
    }),
  ])
  .superRefine(refineCoverage);

export type InspectWebNetworkCaptureInput = z.output<
  typeof inspectWebNetworkCaptureInputSchema
>;
export type WebNetworkCapture = z.output<typeof webNetworkCaptureSchema>;
export type WebNetworkCaptureRecord = z.output<
  typeof webNetworkCaptureRecordSchema
>;

const validatedImmutableCaptures = new WeakSet<object>();

/** Reuse successful validation of the exact owned snapshot, without a retained copy. */
export const safeParseOwnedWebNetworkCapture = (
  input: unknown,
): z.ZodSafeParseResult<WebNetworkCapture> => {
  if (
    typeof input === "object" &&
    input !== null &&
    validatedImmutableCaptures.has(input)
  )
    return { success: true, data: input as WebNetworkCapture };
  const parsed = webNetworkCaptureSchema.safeParse(input);
  if (parsed.success && canBorrowParsedJsonSnapshot(input, parsed.data)) {
    // Borrow only when full validation preserves values, schema normalization
    // and alias topology. Merely frozen or mutable objects never gain a proof.
    validatedImmutableCaptures.add(input);
    return { success: true, data: input };
  }
  return parsed;
};
