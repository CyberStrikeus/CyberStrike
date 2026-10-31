import { z } from "zod";
import { nativeAotReasonSchema } from "./nativeAotReason.js";

const address = z.string().regex(/^0x[0-9a-f]+$/u);
const relatedType = z.strictObject({ address, type: z.string().nullable() });

/** Runtime-format metadata recovered in an analysis image, with explicit inference boundaries. */
export const nativeMetadataRecoverySchema = z.strictObject({
  format: z.literal("dotnet-nativeaot"),
  /** Identifies parser-only facts without claiming Ghidra defined a DataType. */
  source: z.enum(["analysis-database", "read-only-derived-overlay"]).optional(),
  status: z.enum(["complete", "partial"]),
  header_address: address,
  format_major: z.int().nonnegative(),
  format_minor: z.int().nonnegative(),
  method_table_address: address,
  name_origin: z.enum(["generated", "inferred"]),
  original_name: z.null(),
  base_size_bytes: z.int().nonnegative(),
  related_type: relatedType.nullable(),
  interfaces: z.array(relatedType),
  virtual_slots: z.array(
    z.strictObject({
      slot: z.int().nonnegative(),
      slot_address: address,
      target_address: address.nullable(),
      procedure_name: z.string().nullable(),
      basis: z.literal("method-table-pointer"),
    }),
  ),
  derived_memory: z
    .strictObject({
      address,
      size_bytes: z.int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      file_offset: z.null(),
    })
    .nullable(),
  truncated: z.boolean().optional(),
  virtual_slots_omitted: z.int().nonnegative().optional(),
  interfaces_omitted: z.int().nonnegative().optional(),
  output_budget_bytes: z.int().nonnegative().optional(),
  diagnostics: z.array(z.string()),
  limitations: z.array(z.string()),
});
export type NativeMetadataRecovery = z.infer<
  typeof nativeMetadataRecoverySchema
>;

/** Discover a recovered runtime format and reusable type identities from the loaded image. */
export const nativeMetadataRecoverySummarySchema = z.strictObject({
  format: z.literal("dotnet-nativeaot"),
  analysis_mode: z.literal("read-only-derived-overlay").optional(),
  status: z.enum(["complete", "partial", "not_applicable"]),
  // The read-only parser publishes a code. The optional Ghidra extension
  // still sends the historical string on not_applicable, unsupported, and
  // failed image summaries. Both shapes remain valid at this boundary.
  reason: z.union([nativeAotReasonSchema, z.string(), z.null()]),
  analysis_artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  header_address: address.nullable(),
  discovery: z.enum(["symbol", "signature-heuristic"]).nullable(),
  format_major: z.int().nonnegative().nullable(),
  format_minor: z.int().nonnegative().nullable(),
  method_tables: z.int().nonnegative(),
  types: z.array(relatedType),
  frozen_strings: z
    .array(z.strictObject({ address, value: z.string() }))
    .optional(),
  truncated: z.boolean().optional(),
  types_omitted: z.int().nonnegative().optional(),
  frozen_strings_omitted: z.int().nonnegative().optional(),
  output_budget_bytes: z.int().nonnegative().optional(),
  derived_overlay: z
    .strictObject({
      address,
      size_bytes: z.int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .nullable()
    .optional(),
  derived_memory: nativeMetadataRecoverySchema.shape.derived_memory,
  coverage: z
    .strictObject({
      frozen_object_candidates: z.int().nonnegative().optional(),
      frozen_objects_annotated: z.int().nonnegative().optional(),
      pointer_candidates_examined: z.int().nonnegative().optional(),
      pointer_slots_examined: z.int().nonnegative().optional(),
      scan_bytes_examined: z.int().nonnegative().optional(),
      scan_bytes_omitted: z.int().nonnegative().optional(),
      rtr_signature_scan_bytes_examined: z.int().nonnegative().optional(),
      rtr_signature_scan_bytes_omitted: z.int().nonnegative().optional(),
      method_table_validation_items_examined: z.int().nonnegative().optional(),
      work_units_examined: z.int().nonnegative().optional(),
      method_tables_recovered: z.int().nonnegative().optional(),
      frozen_string_candidates: z.int().nonnegative().optional(),
      frozen_scan_bytes_examined: z.int().nonnegative().optional(),
      frozen_scan_bytes_omitted: z.int().nonnegative().optional(),
      frozen_string_data_bytes_examined: z.int().nonnegative().optional(),
      source_bytes_examined: z.int().nonnegative().optional(),
      source_bytes_omitted: z.int().nonnegative().optional(),
      source_byte_budget_bytes: z.int().nonnegative().optional(),
      work_budget_units: z.int().nonnegative().optional(),
      working_memory_budget_bytes: z.int().nonnegative().optional(),
      working_memory_bytes_peak: z.int().nonnegative().optional(),
      truncation_reason: z
        .enum([
          "source-byte-budget",
          "work-unit-budget",
          "working-memory-budget",
          "response-budget",
        ])
        .optional(),
      basis: z.enum([
        "rehydrated-pointer-candidates-and-committed-instance-types",
        "raw-image-pointer-scan",
        "raw-image-and-rehydrated-pointer-scan",
        "unsupported-layout",
        "no-rtr-header",
      ]),
    })
    .nullable(),
  diagnostics: z.array(z.string()),
  limitations: z.array(z.string()),
});
