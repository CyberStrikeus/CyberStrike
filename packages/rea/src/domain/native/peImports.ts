import { z } from "zod";

import { digestSchema } from "../digests.js";
import { absoluteLocalPathStringSchema } from "../localPath.js";

const uint = z.number().int().min(0).max(0xffffffff);
const range = z.strictObject({ offset: uint, bytes: uint });
const md5Schema = z.string().regex(/^[a-f0-9]{32}$/u);

/** Hard ceiling on the caller-selected input read budget. */
export const MAX_INSPECT_PE_IMPORT_FILE_BYTES = 536870912;
/** Hard ceiling on import and delay-load descriptors examined together. */
export const MAX_INSPECT_PE_IMPORT_DLLS = 4096;
/** Hard ceiling on named and ordinal functions across every table. */
export const MAX_INSPECT_PE_IMPORT_FUNCTIONS = 262144;
/** Fixed ceiling on decoded DLL and function name text retained in one report. */
export const MAX_INSPECT_PE_IMPORT_RETAINED_TEXT_BYTES = 16 * 1024 * 1024;

/** Complete bounded inspection of PE import and delay-load tables. */
export const inspectPeImportsInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema.describe(
    "Absolute filesystem path to a PE image",
  ),
  max_file_bytes: z
    .number()
    .int()
    .min(64)
    .max(MAX_INSPECT_PE_IMPORT_FILE_BYTES)
    .default(67108864)
    .describe("Maximum stable artifact bytes to read (default 64 MiB)"),
  max_dlls: z
    .number()
    .int()
    .min(1)
    .max(MAX_INSPECT_PE_IMPORT_DLLS)
    .default(256)
    .describe(
      "Maximum import and delay-load descriptors to examine; exceeding the budget fails without partial success",
    ),
  max_functions: z
    .number()
    .int()
    .min(1)
    .max(MAX_INSPECT_PE_IMPORT_FUNCTIONS)
    .default(8192)
    .describe(
      "Maximum imported functions to examine across every table; exceeding the budget fails without partial success",
    ),
});
export type InspectPeImportsInput = z.infer<typeof inspectPeImportsInputSchema>;

const peImportFunctionSchema = z.strictObject({
  hint: uint.nullable(),
  name: z.string().min(1).nullable(),
  ordinal: z.number().int().min(0).max(0xffff).nullable(),
  ilt_rva: uint.nullable(),
  iat_rva: uint,
  thunk_hex: z.string().regex(/^[0-9a-f]+$/u),
});

const peImportDllSchema = z.strictObject({
  index: uint,
  name: z.string().min(1).nullable(),
  name_rva: uint,
  original_first_thunk_rva: uint,
  first_thunk_rva: uint,
  time_date_stamp: uint,
  forwarder_chain: uint,
  location: range,
  functions: z.array(peImportFunctionSchema),
});

const peDelayImportDllSchema = z.strictObject({
  index: uint,
  name: z.string().min(1).nullable(),
  name_rva: uint,
  attributes: uint,
  import_address_table_rva: uint,
  import_name_table_rva: uint,
  bound_import_rva: uint,
  unload_information_table_rva: uint,
  module_handle_rva: uint,
  time_date_stamp: uint,
  location: range,
  functions: z.array(peImportFunctionSchema),
});

/**
 * `locations` are the file spans the parser actually consumed for the
 * descriptor array and its terminator, in RVA order. Consecutive descriptors
 * that map to discontiguous file bytes produce separate spans.
 * No bytes are consumed when the first slot cannot be examined; the declared
 * directory remains present and coverage is partial.
 */
const directorySchema = z
  .strictObject({
    rva: uint,
    size: uint,
    locations: z.array(range),
  })
  .nullable();

const peImportIssueSchema = z.strictObject({
  code: z.enum([
    "malformed_entry",
    "descriptor_unreadable",
    "name_unreadable",
    "thunk_unreadable",
    "unsupported_form",
  ]),
  location: z.string().min(1).nullable(),
  message: z.string().min(1),
});

const coverageSchema = z.strictObject({
  status: z.enum(["complete", "partial"]),
  reason: z.string().min(1).nullable(),
  examined_dlls: uint,
  imports: uint,
  delay_imports: uint,
});

const imphashSchema = z.strictObject({
  algorithm: z.literal("pefile"),
  md5: md5Schema.nullable(),
  reason: z.string().min(1).nullable(),
});

/** Static import inventory of one PE32/PE32+ image, read without execution. */
export const peImportsSchema = z.strictObject({
  artifact: z.strictObject({
    path: z.string().min(1),
    sha256: digestSchema,
    bytes: uint,
  }),
  format: z.enum(["pe32", "pe32-plus"]),
  machine: uint,
  bits: z.union([z.literal(32), z.literal(64)]),
  architecture: z.string().min(1),
  import_directory: directorySchema,
  delay_import_directory: directorySchema,
  imports: z.array(peImportDllSchema),
  delay_imports: z.array(peDelayImportDllSchema),
  imphash: imphashSchema,
  coverage: coverageSchema,
  issues: z.array(peImportIssueSchema),
  limitations: z.array(z.string().min(1)),
});
export type PeImports = z.infer<typeof peImportsSchema>;
export type PeImportDll = z.infer<typeof peImportDllSchema>;
export type PeDelayImportDll = z.infer<typeof peDelayImportDllSchema>;
export type PeImportFunction = z.infer<typeof peImportFunctionSchema>;
export type PeImportIssue = z.infer<typeof peImportIssueSchema>;
