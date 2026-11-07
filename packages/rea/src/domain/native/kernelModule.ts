import { z } from "zod";

import { digestSchema } from "../digests.js";
import { fixedTupleSchema } from "../fixedTupleSchema.js";
import { localPathStringSchema } from "../localPath.js";
import { ELF_OBJECT_TYPE_NAMES } from "./elfNotes.js";

const uint = z.number().int().min(0).max(0xffffffff);
const uint8 = z.number().int().min(0).max(255);
const range = z.strictObject({ offset: uint, bytes: uint });
const hex = z.string().regex(/^[0-9a-f]*$/u);

/** Hard ceiling on the caller-selected input read budget. */
export const MAX_INSPECT_KERNEL_MODULE_FILE_BYTES = 536870912;
/**
 * Hard ceiling on decoded .modinfo and __versions entries plus listed
 * file-backed __ksymtab* sections combined.
 */
export const MAX_INSPECT_KERNEL_MODULE_ENTRIES = 65536;
/**
 * Retained .modinfo key length. Longer keys stay malformed per entry and are
 * not copied into the result.
 */
export const MAX_KERNEL_MODULE_KEY_BYTES = 256;
/**
 * Retained .modinfo value length. Longer values stay malformed per entry and
 * are not copied into the result.
 */
export const MAX_KERNEL_MODULE_VALUE_BYTES = 4096;
/**
 * Retained __ksymtab* section-name length. Longer names stay listed with a
 * null name and are not copied into the result.
 */
export const MAX_KERNEL_MODULE_SECTION_NAME_BYTES = 256;
/** Inline raw-entry hex ceiling. Longer entries keep only their SHA-256. */
export const MAX_KERNEL_MODULE_RAW_BYTES = 4096;
/**
 * `struct modversion_info` is `unsigned long crc` plus
 * `char name[64 - sizeof(unsigned long)]`, so every entry is 64 bytes.
 * ELF32 stores a u32 CRC and a 60-byte name. ELF64 stores a u64
 * unsigned long and a 56-byte name.
 */
export const KERNEL_MODULE_VERSION_ENTRY_BYTES = 64;
/** `struct module_signature` is 12 bytes, with sig_len big-endian. */
export const MODULE_SIGNATURE_INFO_BYTES = 12;
/** Trailer magic, including the trailing newline, from MODULE_SIG_STRING. */
export const MODULE_SIGNATURE_MAGIC = "~Module signature appended~\n";
/** `PKEY_ID_PKCS7` from the kernel public-key identifier enum. */
export const MODULE_SIGNATURE_PKCS7_ID_TYPE = 2;

export const KERNEL_MODULE_APPLICABILITY = [
  "applicable",
  "not_applicable",
  "unsupported",
] as const;

export const KERNEL_MODULE_MODINFO_ENTRY_REASONS = [
  "unterminated_modinfo_entry",
  "modinfo_missing_separator",
  "modinfo_empty_key",
  "modinfo_field_exceeds_limit",
] as const;

export const KERNEL_MODULE_MODINFO_SECTION_REASONS = [
  "modinfo_section_compressed",
  "modinfo_section_not_file_backed",
] as const;

export const KERNEL_MODULE_VERSION_ENTRY_REASONS = [
  "version_name_unterminated",
] as const;

export const KERNEL_MODULE_VERSION_SECTION_REASONS = [
  "versions_size_not_multiple",
  "versions_section_compressed",
  "versions_section_not_file_backed",
] as const;

export const KERNEL_MODULE_KSYMTAB_SECTION_REASONS = [
  "ksymtab_name_exceeds_limit",
] as const;

export const KERNEL_MODULE_SIGNATURE_REASONS = [
  "signature_trailer_truncated",
  "signature_length_inconsistent",
  "signature_parameters_nonzero",
  "signature_id_type_not_pkcs7",
] as const;

export const KERNEL_MODULE_VERSION_LAYOUTS = [
  "elf32_unsigned_long_name60",
  "elf64_unsigned_long_name56",
] as const;

const sectionStatus = z.enum([
  "present",
  "absent",
  "unknown",
  "malformed",
  "unsupported",
]);

const entryStatus = z.enum(["observed", "malformed"]);

const modinfoEntrySchema = z.strictObject({
  index: uint,
  location: range,
  key: z.string().nullable(),
  value: z.string().nullable(),
  raw_sha256: digestSchema,
  raw_hex: hex.nullable(),
  status: entryStatus,
  reason: z.enum(KERNEL_MODULE_MODINFO_ENTRY_REASONS).nullable(),
});

const modinfoSchema = z.strictObject({
  status: sectionStatus,
  location: range.nullable(),
  sha256: digestSchema.nullable(),
  entries: z.array(modinfoEntrySchema),
  reason: z.enum(KERNEL_MODULE_MODINFO_SECTION_REASONS).nullable(),
});

const versionEntrySchema = z.strictObject({
  index: uint,
  location: range,
  crc_hex: z.string().regex(/^(?:[0-9a-f]{8}|[0-9a-f]{16})$/u),
  name: z.string().nullable(),
  status: entryStatus,
  reason: z.enum(KERNEL_MODULE_VERSION_ENTRY_REASONS).nullable(),
});

const versionsSchema = z.strictObject({
  status: sectionStatus,
  layout: z.enum(KERNEL_MODULE_VERSION_LAYOUTS).nullable(),
  entry_bytes: z.literal(KERNEL_MODULE_VERSION_ENTRY_BYTES).nullable(),
  location: range.nullable(),
  sha256: digestSchema.nullable(),
  entries: z.array(versionEntrySchema),
  reason: z.enum(KERNEL_MODULE_VERSION_SECTION_REASONS).nullable(),
});

const thisModuleSchema = z.strictObject({
  status: z.enum(["present", "absent", "unknown", "unsupported"]),
  location: range.nullable(),
  /** `struct module` changes with the kernel version and is not decoded. */
  layout: z.literal("unknown"),
});

const sizedSectionSchema = z.strictObject({
  status: z.enum(["present", "absent", "unknown"]),
  location: range.nullable(),
  /** Observed file-backed size. Null when the section is not file-backed. */
  bytes: uint.nullable(),
  compressed: z.boolean().nullable(),
});

const ksymtabSchema = z.strictObject({
  status: z.enum(["observed", "unknown"]),
  sections: z.array(
    z.strictObject({
      name: z
        .string()
        .min(1)
        .max(MAX_KERNEL_MODULE_SECTION_NAME_BYTES)
        .nullable(),
      location: range,
      compressed: z.boolean(),
      reason: z.enum(KERNEL_MODULE_KSYMTAB_SECTION_REASONS).nullable(),
    }),
  ),
});

const signatureInfoSchema = z.strictObject({
  location: range,
  algo: uint8,
  hash: uint8,
  id_type: uint8,
  signer_len: uint8,
  key_id_len: uint8,
  pad: fixedTupleSchema([uint8, uint8, uint8]),
  sig_len: uint,
});

const signatureSchema = z.strictObject({
  status: z.enum(["absent", "present", "malformed", "unsupported"]),
  magic: range.nullable(),
  info: signatureInfoSchema.nullable(),
  pkcs7: z
    .strictObject({
      location: range,
      sha256: digestSchema,
    })
    .nullable(),
  reason: z.enum(KERNEL_MODULE_SIGNATURE_REASONS).nullable(),
});

/** Complete bounded inspection of one relocatable Linux kernel module. */
export const inspectKernelModuleInputSchema = z.strictObject({
  path: localPathStringSchema.describe(
    "Absolute filesystem path to an ELF kernel module or a compressed .ko container",
  ),
  max_file_bytes: z
    .number()
    .int()
    .min(64)
    .max(MAX_INSPECT_KERNEL_MODULE_FILE_BYTES)
    .default(67108864)
    .describe("Maximum stable artifact bytes to read (default 64 MiB)"),
  max_entries: z
    .number()
    .int()
    .min(1)
    .max(MAX_INSPECT_KERNEL_MODULE_ENTRIES)
    .default(8192)
    .describe(
      "Maximum .modinfo and __versions entries plus file-backed __ksymtab* sections to examine; exceeding the budget fails without partial success",
    ),
});

/**
 * Observed kernel-module metadata. ET_REL images are applicable. Other ELF
 * types are not applicable. gzip, xz, and zstd containers are unsupported.
 */
export const kernelModuleSchema = z.strictObject({
  artifact: z.strictObject({
    path: z.string().min(1),
    sha256: digestSchema,
    bytes: uint,
  }),
  format: z.enum(["elf32", "elf64"]).nullable(),
  byte_order: z.enum(["little", "big"]).nullable(),
  machine: uint.nullable(),
  type: uint.nullable(),
  type_name: z.enum(ELF_OBJECT_TYPE_NAMES).nullable(),
  applicability: z.enum(KERNEL_MODULE_APPLICABILITY),
  compression: z
    .strictObject({
      codec: z.enum(["gzip", "xz", "zstd"]),
      status: z.literal("unsupported"),
    })
    .nullable(),
  next_probe: z
    .strictObject({
      operation: z
        .literal("external_decompression")
        .describe(
          "External decompression with a codec utility, not a REA tool",
        ),
      rationale: z.string().min(1),
    })
    .nullable(),
  modinfo: modinfoSchema.nullable(),
  versions: versionsSchema.nullable(),
  this_module: thisModuleSchema.nullable(),
  ksymtab: ksymtabSchema.nullable(),
  init_text: sizedSectionSchema.nullable(),
  exit_text: sizedSectionSchema.nullable(),
  signature: signatureSchema.nullable(),
  coverage: z.strictObject({
    status: z.enum(["complete", "not_applicable", "unsupported"]),
    examined_entries: uint,
  }),
  limitations: z.array(z.string()),
});

export type KernelModule = z.infer<typeof kernelModuleSchema>;
export type InspectKernelModuleInput = z.infer<
  typeof inspectKernelModuleInputSchema
>;
