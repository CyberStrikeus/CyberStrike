import { z } from "zod";
import { AnalysisOutputError } from "../domain/analysisErrorCore.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";
import type { AndroidOperation } from "../domain/android/androidAnalysis.js";
import {
  androidMethodSelectorSchema,
  dexStaticValueSchema,
} from "../domain/android/androidAnalysis.js";
import {
  dexDescriptorSchema,
  dexTypeSchema,
} from "../domain/android/dexTypes.js";
import { androidNativeDeclarationsSchema } from "../domain/android/androidNativeDeclarations.js";

/** Native-only raw DEX facts authored before decompiler deduplication. */
export const jadxNativeDeclarationsSchema = androidNativeDeclarationsSchema;

const count = z.int().nonnegative();
/** Typed allocation failures authored before upstream erases the JVM exception. */
const jadxMemoryFailureSchema = z.strictObject({
  kind: z.literal("jvm-memory-failure"),
  memory_area: z.enum(["heap", "unknown"]),
  exception_type: z.literal("java.lang.OutOfMemoryError"),
  message: z.string().optional(),
  max_heap_bytes: z.int().positive().safe(),
});
/** Selector failures authored by REA's bridge, separate from arbitrary engine errors. */
const jadxInputFailureSchema = z.strictObject({
  kind: z.literal("invalid-input"),
  field: z.enum(["class_name", "method_name", "overload_index"]),
  message: z.string().min(1),
});
const jadxReferenceLimitSchema = z.strictObject({
  kind: z.literal("reference-output-limit"),
  stage: z.enum(["method_inventory", "caller_inventory"]),
  limit_bytes: z.int().positive().safe(),
});
const bridgeFailureSchema = z.discriminatedUnion("kind", [
  jadxInputFailureSchema,
  jadxMemoryFailureSchema,
  jadxReferenceLimitSchema,
]);

/** Arbitrary upstream failure text stays text unless it matches a named bridge contract. */
export const parseJadxFailure = (
  text: string,
): z.infer<typeof bridgeFailureSchema> | undefined => {
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = bridgeFailureSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
};
/** Values observed inside the exact JVM producing the analysis. */
export const jadxRuntimeSchema = z.object({
  engine_reported_version: z.string().min(1),
  max_heap_bytes: z.int().positive().safe(),
  available_processors: z.int().positive(),
  java_version: z.string().min(1),
  metadata_scope: z.literal("parsed_members"),
});
export const jadxLoadSchema = z.object({
  state: z.literal("LOADED"),
  apk_path: z.string(),
  class_count: count,
  resource_count: count,
  threads: z.literal(1),
  resources: z.literal("full"),
});
export const jadxAppSchema = z.object({
  package: z.string(),
  version_name: z.string(),
  version_code: z.string(),
  min_sdk: z.string(),
  target_sdk: z.string(),
  permissions: z.array(z.string()),
});
const jadxClassPageSchema = z
  .object({
    scope: z.literal("top_level"),
    total_classes: count,
    next_offset: count,
    offset: count,
    limit: count,
    items: z.array(z.string()),
  })
  .catchall(jsonValueSchema);
export type JadxClassPage = z.infer<typeof jadxClassPageSchema>;

/** Validate a decoded page without dropping observed JSON members such as __proto__. */
export const parseJadxClassPage = (value: JsonValue): JadxClassPage => {
  jadxClassPageSchema.parse(value);
  return value as JadxClassPage;
};

const jadxMethodMetadataSchema = z.object({
  name: z.string(),
  raw_name: z.string().min(1),
  signature: z.string(),
  dex_descriptor: dexDescriptorSchema,
  is_constructor: z.boolean(),
  def_pos: z.int(),
});

export const jadxClassSchema = z.object({
  full_name: z.string().min(1),
  raw_name: z.string().min(1),
  name: z.string(),
  method_count: count,
  field_count: count,
  inner_class_count: count,
  methods: z.array(jadxMethodMetadataSchema),
  fields: z.array(
    z.object({
      name: z.string(),
      raw_name: z.string().min(1),
      type: z.string(),
      dex_type: dexTypeSchema,
      def_pos: z.int(),
      dex_static_value: dexStaticValueSchema.optional(),
    }),
  ),
  inner_classes: z.array(z.string()),
  /** Original binary names, index-aligned with the display names above. */
  inner_class_raw_names: z.array(z.string()),
});
/** Reference-only prototypes are not an external class definition or field inventory. */
export const jadxExternalReferenceSummarySchema = z.object({
  reference_target: z.literal("external"),
  class_name: z.string().min(1),
  observed_method_count: count,
  prototypes: z.array(jadxMethodMetadataSchema).min(1),
});
export const jadxMethodSchema = z.object({
  class_name: z.string(),
  method_name: z.string(),
  full_name: z.string(),
  overload_index: count,
  overload_count: count,
  dex_descriptor: dexDescriptorSchema,
  mode: z.enum(["java", "smali"]),
  fell_back: z.boolean(),
  markers: z.array(z.string()),
  body: z.string(),
});
export const jadxXrefsSchema = z.object({
  target: z.string(),
  reference_target: z.literal("external").optional(),
  reference_scope: z.literal("direct_dex_invokes").optional(),
  dex_descriptor: dexDescriptorSchema.optional(),
  overload_index: count.optional(),
  reported_signature: z.string().optional(),
  total: count,
  count,
  resolve_line: z.literal(false),
  items: z.array(
    z.object({
      kind: z.string(),
      name: z.string(),
      full_name: z.string(),
      containing_class: z.string(),
      top_class: z.string(),
      def_pos: z.int(),
      source_selector: androidMethodSelectorSchema.optional(),
      direct_invokes_exhaustive: z.boolean().optional(),
      direct_invokes: z
        .array(
          z.object({
            dex_entry: z.string().min(1),
            source_raw_method_id: z.string().min(1),
            dex_code_unit_offset: count,
            dex_method_index: count,
            opcode: z.string().regex(/^INVOKE_/u),
          }),
        )
        .optional(),
    }),
  ),
});
const toolResponse = z
  .object({
    content: z.tuple([
      z
        .object({ type: z.literal("text"), text: z.string() })
        .catchall(jsonValueSchema),
    ]),
    isError: z.boolean().exactOptional(),
  })
  .catchall(jsonValueSchema);

/** Parse the upstream text-only envelope, preserving errors at the producing boundary. */
export const parseJadxEnvelope = (
  response: JsonValue,
  operation: AndroidOperation,
): z.infer<typeof toolResponse> => {
  const parsed = toolResponse.safeParse(response);
  if (!parsed.success)
    throw new AnalysisOutputError(
      operation,
      "JADX returned an unsupported MCP content envelope",
    );
  // The schema establishes the shape; its object copy would omit __proto__.
  return response as z.infer<typeof toolResponse>;
};

/** Decode an upstream JSON text payload without trusting its contents. */
export const parseJadxJson = (
  text: string,
  operation: AndroidOperation,
): z.infer<typeof jsonValueSchema> => {
  try {
    return jsonValueSchema.parse(JSON.parse(text));
  } catch (cause) {
    throw new AnalysisOutputError(
      operation,
      "JADX returned malformed JSON text",
      { cause },
    );
  }
};

/** Upstream byte truncation is reported rather than promoted to a complete source. */
export const normalizeJadxText = (
  text: string,
): {
  status: "complete" | "partial";
  text: string;
  reported_total_bytes: number | null;
} => {
  const marker =
    /\n\n\.\.\. \[truncated: exceeds (\d+) bytes, total (\d+) bytes\]$/u.exec(
      text,
    );
  const total = marker?.[2] === undefined ? null : Number(marker[2]);
  return {
    status: marker === null ? "complete" : "partial",
    text,
    reported_total_bytes:
      total !== null && Number.isSafeInteger(total) ? total : null,
  };
};
