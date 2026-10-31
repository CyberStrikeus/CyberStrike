import { z } from "zod";
import { nativeMetadataRecoverySchema } from "./nativeMetadataRecovery.js";

/** Select a database type by exact category path or a defined typed data address. */
export const nativeDataTypeInputSchema = z
  .strictObject({
    type: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
    document: z.string().optional(),
  })
  .refine(
    (value) => (value.type === undefined) !== (value.address === undefined),
    "Supply exactly one of type or address",
  );
/** Types remain analysis database observations; child identities can be inspected separately. */
export const nativeDataTypeSchema = z.strictObject({
  status: z.enum(["available", "unavailable"]),
  reason: z.string().nullable(),
  id: z.string().nullable(),
  name: z.string().nullable(),
  kind: z.enum([
    "struct",
    "union",
    "enum",
    "pointer",
    "array",
    "typedef",
    "scalar",
    "unsupported",
    "unavailable",
  ]),
  source: z.literal("analysis-database"),
  source_archive: z.string().nullable(),
  address: z.string().nullable(),
  size_bytes: z.int().nonnegative().nullable(),
  alignment_bytes: z.int().positive().nullable(),
  packing_enabled: z.boolean().nullable(),
  referenced_type: z.string().nullable(),
  array_count: z.int().nonnegative().nullable(),
  array_stride_bytes: z.int().nonnegative().nullable(),
  fields: z.array(
    z.strictObject({
      ordinal: z.int().nonnegative(),
      name: z.string().nullable(),
      offset_bytes: z.int().nonnegative(),
      size_bytes: z.int().nonnegative().nullable(),
      type_id: z.string(),
      bit_size: z.int().nonnegative().nullable(),
      bit_offset: z.int().nonnegative().nullable(),
      status: z.enum(["observed", "unsupported"]),
      flexible_tail: z.literal("unknown"),
    }),
  ),
  members: z.array(z.strictObject({ name: z.string(), value: z.string() })),
  total_fields: z.int().nonnegative(),
  truncated: z.boolean(),
  limitations: z.array(z.string()),
  metadata_recovery: nativeMetadataRecoverySchema.optional(),
});
