import { z } from "zod";
import { nativeMetadataRecoverySummarySchema } from "./nativeMetadataRecovery.js";
import { jsonValueSchema } from "../jsonValue.js";
import { binaryArchitectureSchema } from "../rawBinary.js";
import { nativeAddressObservationSchema } from "./nativeAddress.js";

const integer = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const hexBytes = z.string().regex(/^(?:[a-f0-9]{2})*$/u);

/** Measured provider image, without exporting the complete executable bytes. */
export const nativeLoadImageObservationSchema = z.strictObject({
  metadata_recovery: z.array(nativeMetadataRecoverySummarySchema).optional(),
  executable_format: z.string().min(1),
  language_id: z.string().min(1),
  compiler_spec_id: z.string().min(1),
  image_base: nativeAddressObservationSchema,
  default_address_space: z.string().min(1),
  source_files: z.array(
    z.strictObject({
      name: z.string(),
      size: integer,
      original_sha256: digest,
      modified_sha256: digest,
    }),
  ),
  mappings: z.array(
    z.strictObject({
      block: z.string(),
      start: nativeAddressObservationSchema,
      end: nativeAddressObservationSchema,
      address_space: z.string().min(1),
      initialized: z.boolean(),
      loaded: z.boolean(),
      overlay: z.boolean(),
      // Optional so inspection snapshots saved before permissions were measured still parse.
      readable: z.boolean().optional(),
      writable: z.boolean().optional(),
      executable: z.boolean().optional(),
      length: integer.min(1),
      source_file_index: integer.nullable(),
      file_offset: integer.nullable(),
      sha256: digest.nullable(),
    }),
  ),
  relocations: z.array(
    z.strictObject({
      address: nativeAddressObservationSchema,
      segment: integer.max(0xffff).nullable(),
      offset: integer.max(0xffff).nullable(),
      status: z.string().min(1),
      type: z.int(),
      values: z.array(
        z.int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
      ),
      original_bytes_hex: hexBytes.nullable(),
      memory_bytes_hex: hexBytes.nullable(),
    }),
  ),
  entry_points: z.array(nativeAddressObservationSchema),
  entry_context: z.array(
    z.strictObject({
      address: nativeAddressObservationSchema,
      registers: z.array(
        z.strictObject({
          name: z.string().min(1),
          value_hex: z
            .string()
            .regex(/^0x[a-f0-9]+$/u)
            .nullable(),
        }),
      ),
    }),
  ),
});

/** Independent comparison, preserving both expectations and measured values. */
export const nativeLoadImageCheckSchema = z.strictObject({
  name: z.string().min(1),
  matched: z.boolean(),
  expected: jsonValueSchema,
  observed: jsonValueSchema,
  file_offset: integer.nullable(),
  address: nativeAddressObservationSchema.nullable(),
});

/** Measured observations when independent format verification is unsupported. */
export const nativeUnsupportedLoadImageSchema = z.strictObject({
  status: z.literal("unsupported"),
  reason: z.string().min(1),
  observations: nativeLoadImageObservationSchema,
  limitations: z.array(z.string().min(1)),
});
export const nativeDosLoadImageSchema = z.strictObject({
  status: z.enum(["verified", "mismatch"]),
  format: z.enum(["dos-mz", "dos-com"]),
  target_sha256: digest,
  load_segment: integer.max(0xffff),
  header_bytes: integer,
  module_bytes: integer,
  overlay_bytes: integer,
  entry: z.strictObject({
    relative_segment: integer.max(0xffff),
    offset: integer.max(0xffff),
    linear_address: nativeAddressObservationSchema,
  }),
  observations: nativeLoadImageObservationSchema,
  checks: z.array(nativeLoadImageCheckSchema),
  limitations: z.array(z.string().min(1)),
});
export const nativeRawLoadImageSchema = z.strictObject({
  status: z.enum(["verified", "mismatch"]),
  format: z.literal("raw-binary"),
  target_sha256: digest,
  architecture: binaryArchitectureSchema,
  language_id: z.string().min(1),
  compiler_spec_id: z.string().min(1),
  base_address: nativeAddressObservationSchema,
  file_bytes: integer.min(1),
  entry: z.strictObject({
    address: nativeAddressObservationSchema,
    file_offset: z.literal(0),
  }),
  observations: nativeLoadImageObservationSchema,
  checks: z.array(nativeLoadImageCheckSchema),
  limitations: z.array(z.string().min(1)),
});
export const nativeDolLoadImageSchema = z.strictObject({
  status: z.enum(["verified", "mismatch"]),
  format: z.literal("gamecube-dol"),
  target_sha256: digest,
  architecture: z.literal("powerpc"),
  language_id: z.string().min(1),
  compiler_spec_id: z.string().min(1),
  file_bytes: integer.min(1),
  entry: z.strictObject({ address: nativeAddressObservationSchema }),
  sections: z.array(
    z.strictObject({
      kind: z.enum(["text", "data"]),
      index: integer,
      file_offset: nativeAddressObservationSchema,
      address: nativeAddressObservationSchema,
      size: nativeAddressObservationSchema,
    }),
  ),
  bss: z.strictObject({
    address: nativeAddressObservationSchema,
    size: nativeAddressObservationSchema,
  }),
  observations: nativeLoadImageObservationSchema,
  checks: z.array(nativeLoadImageCheckSchema),
  limitations: z.array(z.string().min(1)),
});

/** Read-only native image verification; verified applies only to declared coverage. */
export const nativeLoadImageSchema = z.union([
  nativeUnsupportedLoadImageSchema,
  nativeDosLoadImageSchema,
  nativeRawLoadImageSchema,
  nativeDolLoadImageSchema,
]);

/** Provider-neutral native load-image result. */
export type NativeLoadImage = z.infer<typeof nativeLoadImageSchema>;
/** Measured source mappings, bytes, relocations and entries. */
export type NativeLoadImageObservation = z.infer<
  typeof nativeLoadImageObservationSchema
>;

/** Remove entry-context rows that carry no register observations. */
export const normalizeNativeLoadImageObservation = (
  observation: NativeLoadImageObservation,
): NativeLoadImageObservation => ({
  ...observation,
  entry_context: observation.entry_context.filter(
    ({ registers }) => registers.length > 0,
  ),
});

/** One independently compared native import fact. */
export type NativeLoadImageCheck = z.infer<typeof nativeLoadImageCheckSchema>;

/** Measured provider facts, or a completed comparison retained after interruption. */
export const nativeLoadImagePartialObservationSchema = z.discriminatedUnion(
  "stage",
  [
    z.strictObject({
      kind: z.literal("native-load-image"),
      stage: z.literal("measured"),
      observations: nativeLoadImageObservationSchema,
    }),
    z.strictObject({
      kind: z.literal("native-load-image"),
      stage: z.literal("completed"),
      result: nativeLoadImageSchema,
    }),
  ],
);
export type NativeLoadImagePartialObservation = z.infer<
  typeof nativeLoadImagePartialObservationSchema
>;
