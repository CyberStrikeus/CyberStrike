import { z } from "zod";
import {
  browserDeadlineIncrease,
  browserDeadlineRetry,
  noRuntimeOverrideSentence,
  optionalBrowserDeadlineMs,
} from "./browserDeadline.js";
import { digestSchema } from "./digests.js";
import { absoluteLocalPathStringSchema } from "./localPath.js";
import { exportedWebScriptSchema } from "./webScriptExport.js";
import {
  capturedWebManifestIdentitySchema,
  selectedWebScriptInputSchema,
  webArtifactFileSchema,
} from "./webScriptArtifacts.js";

/** JavaScript source-map positions use UTF-16 columns and one-based lines. */
export const webSourcePositionSchema = z.strictObject({
  line: z.int().min(1),
  column: z.int().min(0),
});

/** Trace one explicit generated position through an explicitly paired local map. */
export const webSourceLocationInputSchema = selectedWebScriptInputSchema.extend(
  {
    source_map: z.strictObject({
      path: absoluteLocalPathStringSchema.describe(
        "Absolute local source-map path; no fetch",
      ),
      url: z
        .string()
        .min(1)
        .describe(
          "Explicit source-map URL context used to resolve original source names",
        ),
    }),
    generated_position: webSourcePositionSchema,
    decode_timeout_ms: optionalBrowserDeadlineMs(
      "Source-map decode deadline in milliseconds (default 20000), for the owned codec process. Omitted means 20000 and applies on the next trace_web_source_location call. deadlineExpired returns no partial mapping. Does not raise the fixed 4 MiB map budget, 32 MiB reply budget, or 192 MiB codec heap. Those have no runtime override.",
    ),
  },
);
export type WebSourceLocationInput = z.output<
  typeof webSourceLocationInputSchema
>;

const originalContentSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("embedded"),
    text: z.string(),
    utf8_sha256: digestSchema,
    utf8_bytes: z.int().min(0),
    representation: z.literal("UTF-8 encoding of decoded sourcesContent text"),
  }),
  z.strictObject({
    state: z.literal("unavailable"),
    reason: z.literal("sourcesContent-not-retained"),
  }),
]);

/** Keep every matching segment, including anonymous mappings and duplicate URLs. */
export const webSourceMapMatchSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("generated-only") }),
  z.strictObject({
    state: z.literal("mapped"),
    flattened_source_index: z.int().min(0),
    section_path: z.array(z.int().min(0)),
    source_index: z.int().min(0),
    reported_source: z.string().nullable(),
    reported_source_root: z.string().nullable(),
    resolved_url: z.string().nullable(),
    ignored: z.boolean(),
    content: originalContentSchema,
    original_position: webSourcePositionSchema.extend({
      offset: z.int().min(0).nullable(),
      content_position: z.enum([
        "verified-in-embedded-text",
        "outside-embedded-text",
        "content-unavailable",
      ]),
    }),
    name: z.string().nullable(),
  }),
]);

/** Codec observations; map association and deployment authenticity remain selected context. */
export const webSourceMapReportSchema = z.strictObject({
  source_map_sha256: digestSchema,
  url_context: z.string().min(1),
  engine: z.strictObject({ id: z.string().min(1), version: z.string().min(1) }),
  runtime: z.discriminatedUnion("id", [
    z.strictObject({
      id: z.literal("node-v8"),
      version: z.string().min(1),
      v8_heap_limit_bytes: z.int().min(1),
    }),
    // Bun reports V8-shaped heap statistics but does not enforce V8 heap flags.
    // On Windows REA instead enforces a Job Object commit limit on the codec.
    z.strictObject({
      id: z.literal("bun"),
      version: z.string().min(1),
      node_compatibility_version: z.string().min(1),
      v8_heap_limit_bytes: z.null(),
      process_memory_limit_bytes: z.int().min(1).nullable(),
    }),
  ]),
  format: z.enum(["regular", "indexed"]),
  reported_file: z.string().nullable(),
  lookup: z.strictObject({
    requested: webSourcePositionSchema,
    matched_generated_position: webSourcePositionSchema.nullable(),
    semantics: z.literal(
      "greatest generated position <= requested, across lines; all equal-position segments",
    ),
    location_units: z.literal("one-based lines; zero-based UTF-16 columns"),
  }),
  matches: z.array(webSourceMapMatchSchema),
  diagnostics: z.array(z.string()),
});

/** Bounds for complete source-map evidence and upstream decoded layouts. */
export const WEB_SOURCE_MAP_LIMITS = {
  mapBytes: 4 * 1024 * 1024,
  outputBytes: 32 * 1024 * 1024,
  decodedRows: 262144,
  decodedSegments: 262144,
  decodedRecords: 262144,
  sectionDepth: 64,
  decodeTimeoutMs: 20000,
  /** V8 old-generation heap for the codec, and its Bun process budget. */
  codecHeapMiB: 192,
} as const;

/** Decode deadline used when decode_timeout_ms is omitted. */
export const DEFAULT_WEB_SOURCE_MAP_DECODE_TIMEOUT_MS =
  WEB_SOURCE_MAP_LIMITS.decodeTimeoutMs;

/** Source-map decode deadlineExpired text for trace_web_source_location. */
export const webSourceMapDecodeTimeoutRecovery = (
  timeoutMs: number,
): { readonly userMessage: string; readonly remediationAction: string } => ({
  userMessage: `trace_web_source_location reached its ${String(timeoutMs)} ms source-map decode deadline (deadlineExpired) for decode_timeout_ms. No partial mapping is returned. This is not the MCP client deadline.`,
  remediationAction: `${browserDeadlineIncrease("decode_timeout_ms", timeoutMs, DEFAULT_WEB_SOURCE_MAP_DECODE_TIMEOUT_MS, "--decode-timeout-ms")} ${browserDeadlineRetry} ${noRuntimeOverrideSentence(`The ${String(WEB_SOURCE_MAP_LIMITS.mapBytes)}-byte map budget, ${String(WEB_SOURCE_MAP_LIMITS.outputBytes)}-byte reply budget, and ${String(WEB_SOURCE_MAP_LIMITS.codecHeapMiB)} MiB codec heap stay fixed.`, "decode_timeout_ms")}`,
});
export type WebSourceMapReport = z.output<typeof webSourceMapReportSchema>;

/** Selected capture/map byte identities and complete point attribution inline. */
export const webSourceLocationResultSchema = webSourceMapReportSchema.extend({
  manifest: capturedWebManifestIdentitySchema,
  source: webArtifactFileSchema.extend({
    script_index: z.int().min(0),
    script: exportedWebScriptSchema,
  }),
  source_map: webArtifactFileSchema.extend({
    url: z.string().min(1),
    association: z.literal("caller-selected"),
  }),
  generated_offset: z.int().min(0),
  source_authenticity: z.literal("unknown"),
  execution: z.literal("unknown"),
  limitations: z.array(z.string()),
});
