import { z } from "zod";
import { bundleResourceRootSchema } from "../apple/bundleResourceRoot.js";
import { jsonRecordSchema } from "../jsonRecord.js";
import { jsonValueSchema } from "../jsonValue.js";
import { machoSliceEncryptionSchema } from "../apple/machoEncryption.js";

const hexAddress = z.string().regex(/^0x[a-fA-F0-9]+$/u);
const bytesHex = z.string().regex(/^(?:[0-9a-f]{2})*$/u);
const coverage = <Schema extends z.ZodType>(item: Schema) =>
  z.object({
    items: z.array(item),
    total: z.int().min(0).nullable(),
    exhaustive: z.boolean(),
    limitations: z.array(z.string()),
  });

const nativeCommandInvocationSchema = z.object({
  tool: z.string().min(1),
  command: z.array(z.string()),
  tool_version: z.string().nullable(),
  version_reason: z.string().nullable(),
  executable_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  exit: z.object({
    code: z.int().nullable(),
    signal: z.string().nullable(),
  }),
  stdout_bytes: z.int().min(0),
  stderr_bytes: z.int().min(0),
});

const architectureSchema = z.object({
  name: z.string(),
  hidden: z.boolean().exactOptional(),
  cpu_type: z.string().nullable(),
  cpu_subtype: z.string().nullable(),
  file_offset: z
    .int()
    .min(0)
    .nullable()
    .describe("Offset from the start of the input Mach-O container."),
  size: z.int().min(0).nullable(),
  alignment: z.int().min(0).nullable(),
});
const permissionSchema = z.object({
  read: z.boolean().nullable(),
  write: z.boolean().nullable(),
  execute: z.boolean().nullable(),
  raw: z.string().nullable(),
});
const sectionSchema = z.object({
  segment: z.string().nullable(),
  segment_bytes_hex: bytesHex
    .optional()
    .describe(
      "Original segment-name bytes before the first NUL; omitted in older Evidence.",
    ),
  name: z.string().nullable(),
  name_bytes_hex: bytesHex
    .optional()
    .describe(
      "Original section-name bytes before the first NUL; omitted in older Evidence.",
    ),
  address: hexAddress.nullable(),
  size: z.int().min(0).nullable(),
  size_hex: hexAddress
    .optional()
    .describe(
      "Exact section size when it cannot be represented as a safe JSON integer.",
    ),
  file_offset: z
    .int()
    .min(0)
    .nullable()
    .describe("Offset from the start of the selected Mach-O slice."),
  alignment: z.int().min(0).nullable(),
  alignment_exponent: z
    .int()
    .min(0)
    .optional()
    .describe(
      "Exact binary alignment exponent when the corresponding byte alignment is not a safe JSON integer.",
    ),
  flags: z.array(z.string()),
});
const segmentSchema = z.object({
  name: z.string().nullable(),
  name_bytes_hex: bytesHex
    .optional()
    .describe(
      "Original segment-name bytes before the first NUL; omitted in older Evidence.",
    ),
  vm_address: hexAddress.nullable(),
  vm_size: z.int().min(0).nullable(),
  vm_size_hex: hexAddress
    .optional()
    .describe(
      "Exact VM size when it cannot be represented as a safe JSON integer.",
    ),
  file_offset: z
    .int()
    .min(0)
    .nullable()
    .describe("Offset from the start of the selected Mach-O slice."),
  file_offset_hex: hexAddress
    .optional()
    .describe(
      "Exact slice-relative file offset when it cannot be represented as a safe JSON integer.",
    ),
  file_size: z.int().min(0).nullable(),
  file_size_hex: hexAddress
    .optional()
    .describe(
      "Exact file size when it cannot be represented as a safe JSON integer.",
    ),
  maximum_permissions: permissionSchema,
  initial_permissions: permissionSchema,
  sections: coverage(sectionSchema),
});
/** Derived from `name` by the shared Mach-O symbol-name owner. */
const runtimeNameSchema = z
  .string()
  .nullable()
  .default(null)
  .describe(
    "Symbol-table `name` without the one leading underscore Darwin adds to language-level symbols (`_main` is `main`, `__ZN3rea3addEii` is `_ZN3rea3addEii`), as LLDB and dlsym name it and observe_native_calls function breakpoints accept; a name without that underscore, such as `-[Class selector]`, is unchanged. Null when `name` is null, nothing remains, or the Evidence predates this field.",
  );
const symbolSchema = z.object({
  /** Exact Mach-O symbol-table name, the source fact. */
  name: z.string(),
  runtime_name: runtimeNameSchema,
  address: hexAddress.nullable(),
  weak: z.boolean().nullable(),
  reexport: z.boolean().nullable(),
  source: z.string().nullable(),
});
const importSymbolSchema = z.object({
  /** Resolved symbol identity; null when the textual row has multiple parses. */
  name: z.string().nullable(),
  runtime_name: runtimeNameSchema,
  /** Exact import text retained when a chained suffix makes identity ambiguous. */
  raw_name: z.string().nullable().default(null),
  name_status: z.enum(["exact", "ambiguous"]).nullable().default(null),
  /** Addend is unknown when only the ambiguous text expression is available. */
  addend: hexAddress.nullable().default(null),
  address: hexAddress.nullable(),
  weak: z.boolean().nullable(),
  reexport: z.boolean().nullable(),
  source: z.string().nullable(),
});
const dependencySchema = z.object({
  path: z.string().nullable(),
  path_bytes_hex: bytesHex
    .optional()
    .describe(
      "Original load-command path bytes before the first NUL; omitted in older Evidence.",
    ),
  kind: z.string(),
  current_version: z.string().nullable(),
  compatibility_version: z.string().nullable(),
});
const loadCommandSchema = z.object({
  index: z.int().min(0),
  kind: z.string(),
  fields: jsonRecordSchema(z.union([z.string(), z.number(), z.null()])),
});
const buildMetadataSchema = z.object({
  platform: z.string().nullable(),
  minimum_os: z.string().nullable(),
  sdk: z.string().nullable(),
  tools: z.array(z.object({ name: z.string(), version: z.string() })),
});

export const inspectMachoSchema = z.object({
  format: z.enum(["mach-o", "mach-o-universal"]),
  /** Exact lipo slice selected for inspection and its offset in the input container. */
  selected_architecture: z.object({
    name: z
      .string()
      .nullable()
      .describe(
        "Exact architecture name selected from lipo output; null when selection is unknown.",
      ),
    container_file_offset: z
      .int()
      .min(0)
      .nullable()
      .describe(
        "Offset of the selected slice from the start of the input Mach-O container; null when unknown.",
      ),
  }),
  endian: z.enum(["little", "big"]).nullable(),
  word_size: z.union([z.literal(32), z.literal(64)]).nullable(),
  file_type: z.string().nullable(),
  flags: z.array(z.string()),
  uuid: z.string().nullable(),
  entrypoints: coverage(
    z.object({
      file_offset: z
        .int()
        .min(0)
        .describe(
          "LC_MAIN entry offset from the start of the selected Mach-O slice.",
        ),
    }),
  ),
  architectures: coverage(architectureSchema),
  build_metadata: coverage(buildMetadataSchema),
  load_commands: coverage(loadCommandSchema),
  dependencies: coverage(dependencySchema),
  imports: coverage(importSymbolSchema),
  exports: coverage(symbolSchema),
  segments: coverage(segmentSchema),
  encryption: coverage(machoSliceEncryptionSchema).describe(
    "LC_ENCRYPTION_INFO(_64) status of every slice, read from load commands only.",
  ),
  provenance: z.array(nativeCommandInvocationSchema),
  limitations: z.array(z.string()),
});

/**
 * Retained inspect_macho Evidence, including results recorded before
 * `encryption` was reported. Not recorded is unknown, never evidence that no
 * slice is encrypted.
 */
export const retainedInspectMachoSchema = inspectMachoSchema
  .extend({ encryption: inspectMachoSchema.shape.encryption.optional() })
  .transform(({ encryption, ...report }) => ({
    ...report,
    encryption: encryption ?? {
      items: [],
      total: null,
      exhaustive: false,
      limitations: [
        "This inspect_macho Evidence predates encryption reporting; slice encryption status is unknown.",
      ],
    },
  }));

export const inspectSignatureSchema = z.object({
  signed: z.boolean(),
  identifier: z.string().nullable(),
  team_identifier: z.string().nullable(),
  format: z.string().nullable(),
  cdhashes: z.array(z.string()),
  hash_algorithms: z.array(z.string()),
  authorities: z.array(z.string()),
  designated_requirement: z.string().nullable(),
  entitlements: jsonValueSchema.nullable(),
  timestamp: z.string().nullable(),
  hardened_runtime: z.boolean().nullable(),
  provenance: z.array(nativeCommandInvocationSchema),
  limitations: z.array(z.string()),
});

export const inspectPlistSchema = z.object({
  format: z.enum(["xml", "binary", "json", "unknown"]),
  value: jsonValueSchema,
  bundle: z.object({
    identifier: z.string().nullable(),
    executable: z.string().nullable(),
    name: z.string().nullable(),
    version: z.string().nullable(),
    short_version: z.string().nullable(),
  }),
  source_path: z.string(),
  resource_root: bundleResourceRootSchema.optional(),
  provenance: z.array(nativeCommandInvocationSchema),
  limitations: z.array(z.string()),
});

export const listArchitecturesSchema = z.object({
  architectures: coverage(architectureSchema),
  provenance: z.array(nativeCommandInvocationSchema),
  limitations: z.array(z.string()),
});

export const demangleSwiftSchema = z.object({
  symbols: z.array(
    z.object({
      input: z.string(),
      output: z.string(),
      status: z.enum(["demangled", "unchanged", "invalid"]),
    }),
  ),
  provenance: z.array(nativeCommandInvocationSchema),
  limitations: z.array(z.string()),
});

export type NativeCommandInvocation = z.infer<
  typeof nativeCommandInvocationSchema
>;
export type InspectMacho = z.infer<typeof inspectMachoSchema>;
export type InspectSignature = z.infer<typeof inspectSignatureSchema>;
