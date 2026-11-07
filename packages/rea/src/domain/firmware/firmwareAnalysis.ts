import { z } from "zod";
import { digestSchema } from "../digests.js";
import { jsonValueSchema, type JsonValue } from "../jsonValue.js";
import { absoluteLocalPathStringSchema } from "../localPath.js";

const bytes = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const range = z.strictObject({ offset: bytes, length: bytes.positive() });
/** Default analysis phase budget, excluding queue admission and publication. */
export const DEFAULT_FIRMWARE_ANALYSIS_TIMEOUT_MS = 120_000;
/** Largest delay supported without overflowing Node timers. */
export const MAX_FIRMWARE_TIMEOUT_MS = 2_147_483_647;
/** Largest staging file-byte budget the schema accepts. */
export const MAX_FIRMWARE_STAGING_BYTES = 512 * 1024 * 1024;
/** Largest staging entry budget the schema accepts. */
export const MAX_FIRMWARE_STAGING_ENTRIES = 100_000;
/** Largest extraction depth the input contract accepts. */
export const MAX_FIRMWARE_EXTRACTION_DEPTH = 10;
const timeout = z.number().int().min(1).max(MAX_FIRMWARE_TIMEOUT_MS);
const target = {
  path: absoluteLocalPathStringSchema.describe(
    "Absolute local firmware file; never executed. Relative paths are rejected.",
  ),
  analysis_timeout_ms: timeout
    .optional()
    .describe(
      "Analysis wall-clock budget in milliseconds (default 120000), from tool resolution through inspection and its final workspace cleanup, or extraction through inventory. Excludes queue admission and extraction publication. Does not raise fixed CPU, memory or byte limits.",
    ),
};

/** Explicit firmware inspection and extraction intent, independent of engines. */
export const firmwareInputSchemas = {
  inspect_firmware_regions: z.strictObject(target),
  extract_firmware: z.strictObject({
    ...target,
    output_directory: absoluteLocalPathStringSchema.describe(
      "Absolute, absent output directory; parent must exist",
    ),
    range: range
      .optional()
      .describe("Explicit file-byte interval; omit to extract the whole file"),
    max_depth: z
      .number()
      .int()
      .min(1)
      .max(MAX_FIRMWARE_EXTRACTION_DEPTH)
      .default(3)
      .describe("Extraction depth; reaching it yields partial analysis"),
    max_output_bytes: z
      .number()
      .int()
      .min(1)
      .max(MAX_FIRMWARE_STAGING_BYTES)
      .default(256 * 1024 * 1024)
      .describe(
        "Staging file-byte budget, checked during extraction; transient overshoot is possible",
      ),
    max_output_files: z
      .number()
      .int()
      .min(1)
      .max(MAX_FIRMWARE_STAGING_ENTRIES)
      .default(10_000)
      .describe("Staging entry budget, including directories and links"),
    publication_timeout_ms: timeout
      .default(120_000)
      .describe(
        "Publication and final cleanup budget in milliseconds, started after extraction and inventory; increase for a slow destination",
      ),
  }),
} as const;

/** Supported firmware operations. */
export type FirmwareOperation = keyof typeof firmwareInputSchemas;
/** Correlated, validated firmware request. */
export type FirmwareRequest = {
  [Name in FirmwareOperation]: {
    operation: Name;
    input: z.infer<(typeof firmwareInputSchemas)[Name]>;
  };
}[FirmwareOperation];
/** Validate the operation with its exact input contract. */
export const firmwareRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("inspect_firmware_regions"),
    input: firmwareInputSchemas.inspect_firmware_regions,
  }),
  z.strictObject({
    operation: z.literal("extract_firmware"),
    input: firmwareInputSchemas.extract_firmware,
  }),
]);

const engine = z.strictObject({
  name: z.string(),
  version: z.string(),
  executable_path: z.string(),
  executable_sha256: digestSchema,
  source_revision: z.null(),
  worker_count: z.literal(1),
});
/** Small execution metadata contract; historical omissions remain unknown. */
export const firmwareExecutionBudgetSchema = z.object({
  analysis_timeout_ms: timeout
    .exactOptional()
    .describe(
      "Actual analysis phase budget in milliseconds; absent in historical Evidence means unknown",
    ),
});
const selection = z.strictObject({ ...range.shape, sha256: digestSchema });
const chunk = z.strictObject({
  input_path: z.string(),
  provider_id: z.string(),
  range,
  handler: z.string().nullable(),
  encrypted: z.boolean().nullable(),
  root_file_range: range.nullable(),
  /** The producer reported an extraction error or missing dependency for this chunk. */
  extraction_failed: z.boolean(),
});
/** One unextracted region or failing task/stage, with a supported continuation
 * using already configured capabilities when one exists. */
export const extractionGap = z.strictObject({
  kind: z.enum([
    "missing-extractor-dependency",
    "unknown-chunk-handler",
    "unclassified-range",
    "encrypted-chunk",
    "depth-limited",
    "extractor-failure",
    "unpublished-entry",
  ]),
  /** Logical task path from the producer report; `$output/…` for unpublished entries. */
  input_path: z.string(),
  relative_path: z.string().nullable(),
  handler: z.string().nullable(),
  /** Reported chunk or multi-file stage identity; it does not imply a byte range. */
  provider_id: z.string().nullable(),
  range: range.nullable(),
  root_file_range: range.nullable(),
  /** Extractor executables named by the producer; empty when it named none. */
  dependencies: z.array(z.string()),
  /** Lookup key in the result's extraction_continuations table. */
  continuation_id: z.string(),
});

/** Completed firmware result retained when private-runtime cleanup cannot be confirmed. */
export interface FirmwarePartialObservation {
  readonly kind: "firmware";
  readonly result: JsonValue;
  /** Completed producer data, artifact identity and analysis metadata. */
  readonly provenance?: JsonValue;
}

/** Portable results retain reported boundaries, unknowns and extraction lineage. */
export const firmwareResultSchemas = {
  inspect_firmware_regions: z.strictObject({
    ...firmwareExecutionBudgetSchema.shape,
    engine,
    input_size: bytes,
    regions: z.array(
      z.strictObject({
        provider_id: z.string(),
        offset: bytes,
        reported_size: bytes,
        signature: z.string(),
        description: z.string(),
        reported_confidence: z.number().int().min(0).max(255),
        size_basis: z.literal("provider_reported_validation_unknown"),
      }),
    ),
    coverage: z.literal("signature_scan"),
  }),
  extract_firmware: z.strictObject({
    ...firmwareExecutionBudgetSchema.shape,
    engine,
    selection,
    output_directory: z.string(),
    coverage: z.enum(["complete", "partial"]),
    files: z.array(
      z.strictObject({
        // Producer-relative identity retains source spelling; `path` identifies
        // the actual published file after destination name normalization.
        relative_path: z.string(),
        path: z.string(),
        size: bytes,
        sha256: digestSchema,
        reported_sha256: digestSchema.nullable(),
        mime_type: z.string().nullable(),
        analysis_depth: bytes.nullable(),
        runtime_address: z.null(),
        original_file_range: z.null(),
      }),
    ),
    unpublished_entries: z.array(
      z.strictObject({
        relative_path: z.string(),
        kind: z.enum(["symlink", "special"]),
        link_target: z.string().nullable(),
        // Older retained Evidence may lack raw target bytes.
        link_target_hex: z
          .string()
          .regex(/^(?:[0-9a-f]{2})*$/u)
          .optional(),
      }),
    ),
    chunks: z.array(chunk),
    derivations: z.array(
      z.strictObject({
        parent_path: z.string(),
        child_path: z.string(),
        provider_blob_id: z.string(),
        handler: z.string().nullable(),
        parent_file_range: range.nullable(),
      }),
    ),
    depth_limited_paths: z.array(z.string()),
    diagnostics: z.array(jsonValueSchema),
    extraction_gaps: z.array(extractionGap),
    /** Each distinct recovery instruction is serialized once, shared by gap ID. */
    extraction_continuations: z.array(
      z.strictObject({ id: z.string(), instruction: z.string() }),
    ),
    published_bytes: bytes,
  }),
} as const;
