import { z } from "zod";

import { digestSchema } from "../digests.js";
import { absoluteLocalPathStringSchema } from "../localPath.js";

const uint = z.number().int().min(0).max(0xffffffff);
const safeCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const hexVa = z.string().regex(/^0x[0-9a-f]+$/u);
const range = z.strictObject({ offset: uint, bytes: uint });

/** Hard ceiling on the caller-selected input read budget. */
export const MAX_INSPECT_PE_LOAD_CONFIG_FILE_BYTES = 536870912;
/** Hard ceiling on non-null TLS callbacks examined in one image. */
export const MAX_INSPECT_PE_LOAD_CONFIG_CALLBACKS = 4096;

/** IMAGE_TLS_DIRECTORY byte width for each optional-header magic. */
export const TLS_STRUCT_BYTES = { 32: 24, 64: 40 } as const;

/** Complete bounded inspection of one PE TLS directory and load configuration. */
export const inspectPeLoadConfigInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema.describe(
    "Absolute filesystem path to a PE image",
  ),
  max_file_bytes: z
    .number()
    .int()
    .min(64)
    .max(MAX_INSPECT_PE_LOAD_CONFIG_FILE_BYTES)
    .default(67108864)
    .describe("Maximum stable artifact bytes to read (default 64 MiB)"),
  max_callbacks: z
    .number()
    .int()
    .min(1)
    .max(MAX_INSPECT_PE_LOAD_CONFIG_CALLBACKS)
    .default(64)
    .describe(
      "Maximum non-null TLS callbacks to examine; exceeding the budget fails without partial success",
    ),
});
export type InspectPeLoadConfigInput = z.infer<
  typeof inspectPeLoadConfigInputSchema
>;

/** Virtual address plus the file location this inspection could establish. */
const locatedSchema = z.strictObject({
  va: hexVa,
  rva: uint.nullable(),
  file_offset: uint.nullable(),
  section: z.string().min(1).nullable(),
});
export type PeLoadConfigLocated = z.infer<typeof locatedSchema>;

const directorySchema = z.strictObject({
  rva: uint,
  size: uint,
  file_offset: uint,
});

/**
 * Guard flag names are observations of set IMAGE_GUARD_* bits.
 * The high nibble is the CFG function-table stride, not one of these names.
 */
export const PE_GUARD_FLAG_NAMES = [
  "IMAGE_GUARD_CF_INSTRUMENTED",
  "IMAGE_GUARD_CFW_INSTRUMENTED",
  "IMAGE_GUARD_CF_FUNCTION_TABLE_PRESENT",
  "IMAGE_GUARD_SECURITY_COOKIE_UNUSED",
  "IMAGE_GUARD_PROTECT_DELAYLOAD_IAT",
  "IMAGE_GUARD_DELAYLOAD_IAT_IN_ITS_OWN_SECTION",
  "IMAGE_GUARD_CF_EXPORT_SUPPRESSION_INFO_PRESENT",
  "IMAGE_GUARD_CF_ENABLE_EXPORT_SUPPRESSION",
  "IMAGE_GUARD_CF_LONGJUMP_TABLE_PRESENT",
  "IMAGE_GUARD_RF_INSTRUMENTED",
  "IMAGE_GUARD_RF_ENABLE",
  "IMAGE_GUARD_RF_STRICT",
  "IMAGE_GUARD_RETPOLINE_PRESENT",
  "IMAGE_GUARD_EH_CONTINUATION_TABLE_PRESENT",
  "IMAGE_GUARD_XFG_ENABLED",
  "IMAGE_GUARD_CASTGUARD_PRESENT",
  "IMAGE_GUARD_MEMCPY_PRESENT",
] as const;

const PE_GUARD_FLAG_BITS: Record<(typeof PE_GUARD_FLAG_NAMES)[number], number> =
  {
    IMAGE_GUARD_CF_INSTRUMENTED: 0x100,
    IMAGE_GUARD_CFW_INSTRUMENTED: 0x200,
    IMAGE_GUARD_CF_FUNCTION_TABLE_PRESENT: 0x400,
    IMAGE_GUARD_SECURITY_COOKIE_UNUSED: 0x800,
    IMAGE_GUARD_PROTECT_DELAYLOAD_IAT: 0x1000,
    IMAGE_GUARD_DELAYLOAD_IAT_IN_ITS_OWN_SECTION: 0x2000,
    IMAGE_GUARD_CF_EXPORT_SUPPRESSION_INFO_PRESENT: 0x4000,
    IMAGE_GUARD_CF_ENABLE_EXPORT_SUPPRESSION: 0x8000,
    IMAGE_GUARD_CF_LONGJUMP_TABLE_PRESENT: 0x10000,
    IMAGE_GUARD_RF_INSTRUMENTED: 0x20000,
    IMAGE_GUARD_RF_ENABLE: 0x40000,
    IMAGE_GUARD_RF_STRICT: 0x80000,
    IMAGE_GUARD_RETPOLINE_PRESENT: 0x100000,
    IMAGE_GUARD_EH_CONTINUATION_TABLE_PRESENT: 0x400000,
    IMAGE_GUARD_XFG_ENABLED: 0x800000,
    IMAGE_GUARD_CASTGUARD_PRESENT: 0x1000000,
    IMAGE_GUARD_MEMCPY_PRESENT: 0x2000000,
  };

const PE_GUARD_FLAG_KNOWN_MASK = PE_GUARD_FLAG_NAMES.reduce(
  (mask, name) => mask | PE_GUARD_FLAG_BITS[name],
  0,
);
const GUARD_STRIDE_MASK = 0xf0000000;

/** Linker claims derived from GuardFlags. They are not observations of code. */
export const PE_LOAD_CONFIG_INFERENCE_IDS = [
  "cfg_instrumented",
  "cf_write_instrumented",
  "rf_instrumented",
  "retpoline_present",
  "xfg_enabled",
  "castguard_present",
] as const;

const PE_LOAD_CONFIG_INFERENCE_BITS: Record<
  (typeof PE_LOAD_CONFIG_INFERENCE_IDS)[number],
  number
> = {
  cfg_instrumented: 0x100,
  cf_write_instrumented: 0x200,
  rf_instrumented: 0x20000,
  retpoline_present: 0x100000,
  xfg_enabled: 0x800000,
  castguard_present: 0x1000000,
};

const inferenceSchema = z.strictObject({
  id: z.enum(PE_LOAD_CONFIG_INFERENCE_IDS),
  evidence_kind: z.literal("inferred"),
  basis: z.string().min(1),
});
export type PeLoadConfigInference = z.infer<typeof inferenceSchema>;

/** Decode one GuardFlags DWORD into observed bits and labeled inferences. */
export const guardFlagRecord = (
  raw: number,
): {
  readonly flags: (typeof PE_GUARD_FLAG_NAMES)[number][];
  readonly unrecognized: number;
  readonly cf_function_table_stride: number;
  readonly inferences: PeLoadConfigInference[];
} => ({
  flags: PE_GUARD_FLAG_NAMES.filter(
    (name) => (raw & PE_GUARD_FLAG_BITS[name]) !== 0,
  ),
  unrecognized:
    (raw >>> 0) & ~((PE_GUARD_FLAG_KNOWN_MASK | GUARD_STRIDE_MASK) >>> 0),
  cf_function_table_stride: 4 + (raw >>> 28),
  inferences: PE_LOAD_CONFIG_INFERENCE_IDS.filter(
    (id) => (raw & PE_LOAD_CONFIG_INFERENCE_BITS[id]) !== 0,
  ).map((id) => ({
    id,
    evidence_kind: "inferred" as const,
    basis: `GuardFlags has ${id} set. That bit is a linker claim; this inspection did not verify the corresponding instructions.`,
  })),
});

const guardFlagsSchema = z.strictObject({
  raw: uint,
  flags: z.array(z.enum(PE_GUARD_FLAG_NAMES)),
  unrecognized: uint,
  cf_function_table_stride: z.number().int().min(4).max(19),
});

/** Located load-config slots. SafeSEH slots are reported for PE32 only. */
export const PE_LOAD_CONFIG_LOCATED_FIELDS = [
  "security_cookie",
  "se_handler_table",
  "guard_cf_check_function_pointer",
  "guard_cf_dispatch_function_pointer",
  "guard_cf_function_table",
  "guard_address_taken_iat_entry_table",
  "guard_long_jump_target_table",
  "guard_eh_continuation_table",
  "guard_xfg_check_function_pointer",
] as const;
export type PeLoadConfigLocatedField =
  (typeof PE_LOAD_CONFIG_LOCATED_FIELDS)[number];

/** Counts stored beside those tables. Presence follows Size, not the count. */
export const PE_LOAD_CONFIG_COUNT_FIELDS = [
  "se_handler_count",
  "guard_cf_function_count",
  "guard_address_taken_iat_entry_count",
  "guard_long_jump_target_count",
  "guard_eh_continuation_count",
] as const;
export type PeLoadConfigCountField =
  (typeof PE_LOAD_CONFIG_COUNT_FIELDS)[number];

/** Pointers reported as raw virtual addresses. Their targets stay undecoded. */
export const PE_LOAD_CONFIG_RAW_FIELDS = [
  "dynamic_value_reloc_table",
  "chpe_metadata_pointer",
] as const;
export type PeLoadConfigRawField = (typeof PE_LOAD_CONFIG_RAW_FIELDS)[number];

/** Source values of the dynamic relocation table offset and section slots. */
export const PE_LOAD_CONFIG_NUMBER_FIELDS = [
  "dynamic_value_reloc_table_offset",
  "dynamic_value_reloc_table_section",
] as const;
export type PeLoadConfigNumberField =
  (typeof PE_LOAD_CONFIG_NUMBER_FIELDS)[number];

export type PeLoadConfigField =
  | PeLoadConfigLocatedField
  | PeLoadConfigCountField
  | PeLoadConfigRawField
  | PeLoadConfigNumberField
  | "guard_flags";

type FieldLayout = { readonly offset: number; readonly width: 2 | 4 | 8 };

/**
 * Offsets of IMAGE_LOAD_CONFIG_DIRECTORY32. A field is present when Size
 * reaches offset + width. Code integrity occupies 12 bytes at offset 92 and
 * is not itself a reported field; it shifts every later slot.
 */
const PE32_LOAD_CONFIG_FIELDS: Record<PeLoadConfigField, FieldLayout> = {
  security_cookie: { offset: 60, width: 4 },
  se_handler_table: { offset: 64, width: 4 },
  se_handler_count: { offset: 68, width: 4 },
  guard_cf_check_function_pointer: { offset: 72, width: 4 },
  guard_cf_dispatch_function_pointer: { offset: 76, width: 4 },
  guard_cf_function_table: { offset: 80, width: 4 },
  guard_cf_function_count: { offset: 84, width: 4 },
  guard_flags: { offset: 88, width: 4 },
  guard_address_taken_iat_entry_table: { offset: 104, width: 4 },
  guard_address_taken_iat_entry_count: { offset: 108, width: 4 },
  guard_long_jump_target_table: { offset: 112, width: 4 },
  guard_long_jump_target_count: { offset: 116, width: 4 },
  dynamic_value_reloc_table: { offset: 120, width: 4 },
  chpe_metadata_pointer: { offset: 124, width: 4 },
  dynamic_value_reloc_table_offset: { offset: 136, width: 4 },
  dynamic_value_reloc_table_section: { offset: 140, width: 2 },
  guard_eh_continuation_table: { offset: 164, width: 4 },
  guard_eh_continuation_count: { offset: 168, width: 4 },
  guard_xfg_check_function_pointer: { offset: 172, width: 4 },
};

/**
 * Offsets of IMAGE_LOAD_CONFIG_DIRECTORY64. ProcessAffinityMask precedes
 * ProcessHeapFlags, unlike PE32. SafeSEH names exist as slots but are not a
 * SafeSEH table on PE32+.
 */
const PE64_LOAD_CONFIG_FIELDS: Record<PeLoadConfigField, FieldLayout> = {
  security_cookie: { offset: 88, width: 8 },
  se_handler_table: { offset: 96, width: 8 },
  se_handler_count: { offset: 104, width: 8 },
  guard_cf_check_function_pointer: { offset: 112, width: 8 },
  guard_cf_dispatch_function_pointer: { offset: 120, width: 8 },
  guard_cf_function_table: { offset: 128, width: 8 },
  guard_cf_function_count: { offset: 136, width: 8 },
  guard_flags: { offset: 144, width: 4 },
  guard_address_taken_iat_entry_table: { offset: 160, width: 8 },
  guard_address_taken_iat_entry_count: { offset: 168, width: 8 },
  guard_long_jump_target_table: { offset: 176, width: 8 },
  guard_long_jump_target_count: { offset: 184, width: 8 },
  dynamic_value_reloc_table: { offset: 192, width: 8 },
  chpe_metadata_pointer: { offset: 200, width: 8 },
  dynamic_value_reloc_table_offset: { offset: 224, width: 4 },
  dynamic_value_reloc_table_section: { offset: 228, width: 2 },
  guard_eh_continuation_table: { offset: 264, width: 8 },
  guard_eh_continuation_count: { offset: 272, width: 8 },
  guard_xfg_check_function_pointer: { offset: 280, width: 8 },
};

/** Byte offset and width of one load-config field for this image width. */
export const loadConfigFieldLayout = (
  bits: 32 | 64,
  name: PeLoadConfigField,
): FieldLayout =>
  (bits === 32 ? PE32_LOAD_CONFIG_FIELDS : PE64_LOAD_CONFIG_FIELDS)[name];

/**
 * Whether `Size` covers the field. PE32+ never covers SafeSEH slots: those
 * names in the 64-bit struct are not a handler table.
 */
export const loadConfigFieldCovered = (
  bits: 32 | 64,
  size: number,
  name: PeLoadConfigField,
): boolean => {
  if (
    bits === 64 &&
    (name === "se_handler_table" || name === "se_handler_count")
  )
    return false;
  const field = loadConfigFieldLayout(bits, name);
  return size >= field.offset + field.width;
};

/**
 * IMAGE_SCN_ALIGN nibble in TLS Characteristics bits 20–23.
 * Index 0 and 15 mean the alignment was not specified.
 */
const TLS_ALIGNMENT_BYTES = [
  null,
  1,
  2,
  4,
  8,
  16,
  32,
  64,
  128,
  256,
  512,
  1024,
  2048,
  4096,
  8192,
  null,
] as const;

/** Decode the TLS characteristics alignment nibble. Null means unspecified. */
export const tlsAlignment = (characteristics: number): number | null =>
  TLS_ALIGNMENT_BYTES[(characteristics >>> 20) & 0xf] ?? null;

const tlsSchema = z
  .strictObject({
    directory: directorySchema,
    start_address_of_raw_data: hexVa,
    end_address_of_raw_data: hexVa,
    raw_data_size: uint,
    raw_data_file_offset: uint.nullable(),
    raw_data_section: z.string().min(1).nullable(),
    address_of_index: locatedSchema,
    address_of_callbacks: hexVa,
    size_of_zero_fill: uint,
    characteristics: uint,
    alignment: z.number().int().positive().nullable(),
    callbacks: z.array(locatedSchema),
    callback_array_locations: z.array(range),
  })
  .nullable();

const loadConfigSchema = z
  .strictObject({
    directory: directorySchema,
    size: uint,
    /** File span of the `Size` bytes checked as file-backed; may exceed `directory`. */
    structure_location: range,
    security_cookie: locatedSchema.nullable(),
    se_handler_table: locatedSchema.nullable(),
    se_handler_count: safeCount.nullable(),
    guard_cf_check_function_pointer: locatedSchema.nullable(),
    guard_cf_dispatch_function_pointer: locatedSchema.nullable(),
    guard_cf_function_table: locatedSchema.nullable(),
    guard_cf_function_count: safeCount.nullable(),
    guard_flags: guardFlagsSchema.nullable(),
    guard_address_taken_iat_entry_table: locatedSchema.nullable(),
    guard_address_taken_iat_entry_count: safeCount.nullable(),
    guard_long_jump_target_table: locatedSchema.nullable(),
    guard_long_jump_target_count: safeCount.nullable(),
    dynamic_value_reloc_table: hexVa.nullable(),
    chpe_metadata_pointer: hexVa.nullable(),
    dynamic_value_reloc_table_offset: uint.nullable(),
    dynamic_value_reloc_table_section: z
      .number()
      .int()
      .min(0)
      .max(0xffff)
      .nullable(),
    guard_eh_continuation_table: locatedSchema.nullable(),
    guard_eh_continuation_count: safeCount.nullable(),
    guard_xfg_check_function_pointer: locatedSchema.nullable(),
    inferences: z.array(inferenceSchema),
  })
  .nullable();

/** Limits that apply to every successful TLS and load-config report. */
export const PE_LOAD_CONFIG_LIMITATIONS = [
  "TLS callbacks and load-config fields reproduce IMAGE_DIRECTORY_ENTRY_TLS and IMAGE_DIRECTORY_ENTRY_LOAD_CONFIG. They do not establish that a callback runs or that a mitigation is enforced at load.",
  "Claims such as CFG instrumentation are inferred from GuardFlags bits and are not observations of instrumented instructions.",
  "A missing TLS or load-config directory is observed absence of that table, not proof the image never registered callbacks or mitigations through another mechanism.",
  "SafeSEH table and count are reported only for PE32. PE32+ struct slots that share those names are not a SafeSEH table.",
  "CHPE metadata and dynamic value relocation pointers are raw virtual addresses. Dynamic relocation table offset and section are separate source values; their target is not derived or decoded.",
  "Load-config fields newer than GuardXFGCheckFunctionPointer stay unread. A Size larger than the fields this version knows does not fail the read.",
] as const;

/** Static TLS and load-config inventory of one PE32/PE32+ image. */
export const peLoadConfigSchema = z.strictObject({
  artifact: z.strictObject({
    path: z.string().min(1),
    sha256: digestSchema,
    bytes: uint,
  }),
  format: z.enum(["pe32", "pe32-plus"]),
  machine: uint,
  bits: z.union([z.literal(32), z.literal(64)]),
  architecture: z.string().min(1),
  tls: tlsSchema,
  load_config: loadConfigSchema,
  examined_callbacks: uint,
  limitations: z.array(z.string().min(1)),
});
export type PeLoadConfig = z.infer<typeof peLoadConfigSchema>;
export type PeLoadConfigTls = NonNullable<PeLoadConfig["tls"]>;
export type PeLoadConfigDirectory = NonNullable<PeLoadConfig["load_config"]>;
