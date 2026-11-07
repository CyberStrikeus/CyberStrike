import { z } from "zod";
import { digestSchema } from "../digests.js";
import { managedFieldConstantSchema } from "./managedFieldConstant.js";

/** Build-local ECMA-335 metadata token emitted as an eight-digit lowercase hex value. */
export const managedMetadataTokenSchema = z.string().regex(/^0x[0-9a-f]{8}$/u);
const offsetSchema = z.int().min(0);

/** A 16-byte CLI metadata GUID without RFC 4122 version/variant restrictions. */
export const cliMetadataGuidSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/u);

const publicKeyIdentitySchema = z.object({
  kind: z.enum(["none", "public-key", "public-key-token"]),
  byte_length: z.int().min(0),
  sha256: digestSchema.nullable(),
  token: z
    .string()
    .regex(/^[a-f0-9]{16}$/u)
    .nullable(),
});

const assemblyIdentitySchema = z.object({
  name: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/u),
  culture: z.string().nullable(),
  flags: z.int().min(0).max(0xffff_ffff),
  hash_algorithm: z.int().min(0).max(0xffff_ffff),
  public_key: publicKeyIdentitySchema,
  token: managedMetadataTokenSchema,
  row_offset: offsetSchema,
});

const moduleIdentitySchema = z.object({
  name: z.string(),
  generation: z.int().min(0).max(0xffff),
  mvid: cliMetadataGuidSchema.nullable(),
  enc_id: cliMetadataGuidSchema.nullable(),
  enc_base_id: cliMetadataGuidSchema.nullable(),
  token: managedMetadataTokenSchema,
  row_offset: offsetSchema,
});

const managedArtifactReferenceSchema = z.object({
  path: z.string().min(1),
  sha256: digestSchema,
  byte_length: z.int().min(0),
  format: z.literal("pe"),
});

const managedMetadataSummarySchema = z.object({
  status: z.enum(["absent", "complete", "partial", "malformed"]),
  version: z.string().nullable(),
  table_row_counts: z.record(z.string(), z.int().min(0).max(0xffff_ffff)),
});

const managedTokenIdentityScopeSchema = z.object({
  token_identity: z.literal("build-local"),
  requires_artifact_sha256: digestSchema,
  requires_mvid: cliMetadataGuidSchema.nullable(),
});

const assemblyReferenceSchema = z.object({
  name: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/u),
  culture: z.string().nullable(),
  flags: z.int().min(0).max(0xffff_ffff),
  public_key_or_token: publicKeyIdentitySchema,
  hash_value_sha256: digestSchema.nullable(),
  hash_value_length: z.int().min(0),
  token: managedMetadataTokenSchema,
  row_offset: offsetSchema,
});

const managedResourceSchema = z.object({
  name: z.string(),
  flags: z.int().min(0).max(0xffff_ffff),
  visibility: z.enum(["public", "private", "unknown"]),
  implementation_token: managedMetadataTokenSchema.nullable(),
  embedded: z.boolean(),
  declared_offset: z.int().min(0).max(0xffff_ffff),
  data_length: z.int().min(0).nullable(),
  data_sha256: digestSchema.nullable(),
  token: managedMetadataTokenSchema,
  row_offset: offsetSchema,
});

const customAttributeSchema = z.object({
  parent_token: managedMetadataTokenSchema,
  constructor_token: managedMetadataTokenSchema.nullable(),
  type_name: z.string().nullable(),
  value_length: z.int().min(0),
  value_sha256: digestSchema,
  decoded_fixed_string: z.string().nullable(),
  token: managedMetadataTokenSchema,
  row_offset: offsetSchema,
});

const managedSignatureSchema = z.object({
  raw_length: z.int().min(0),
  raw_sha256: digestSchema,
  // Evidence recorded before this field existed reads back as null.
  resolved_sha256: digestSchema
    .nullable()
    .default(null)
    .describe(
      "SHA-256 of the raw signature with each TypeDef or TypeRef operand replaced by that type's namespace-qualified name; equals raw_sha256 when the signature names no types. Unlike raw_sha256 it does not depend on build-local metadata rows. Null when the signature could not be decoded or names a type REA could not resolve, such as a TypeSpec.",
    ),
  kind: z.enum(["method", "field", "unknown"]),
  parse_status: z.enum(["decoded", "partial", "unsupported", "malformed"]),
  calling_convention: z.string().nullable(),
  generic_parameter_count: z.int().min(0).nullable(),
  parameter_count: z.int().min(0).nullable(),
  return_type: z.string().nullable(),
  parameter_types: z.array(z.string()),
  field_type: z.string().nullable(),
  issue: z.string().nullable(),
});

const managedTypeSchema = z.object({
  token: managedMetadataTokenSchema,
  row_offset: offsetSchema,
  namespace: z.string(),
  name: z.string(),
  full_name: z.string(),
  name_sha256: digestSchema
    .nullable()
    .default(null)
    .describe(
      "Framed nominal namespace/name/enclosing-name digest, independent of build-local rows. Null for historical Evidence or unresolved nesting; defining assemblies and CLR runtime identity are not established.",
    ),
  flags: z.int().min(0).max(0xffff_ffff),
  extends_token: managedMetadataTokenSchema.nullable(),
  enclosing_type_token: managedMetadataTokenSchema
    .nullable()
    .default(null)
    .describe(
      "Observed enclosing TypeDef from NestedClass; null when no enclosing entry was available, which alone does not establish top-level identity.",
    ),
  field_list: z.object({
    first_row: z.int().min(1).nullable(),
    last_row: z.int().min(0).nullable(),
    count: z.int().min(0),
  }),
  method_list: z.object({
    first_row: z.int().min(1).nullable(),
    last_row: z.int().min(0).nullable(),
    count: z.int().min(0),
  }),
});

/** One ExportedType row: a type this assembly exports from another module or forwards. */
const managedExportedTypeSchema = z.object({
  token: managedMetadataTokenSchema,
  row_offset: offsetSchema,
  namespace: z.string(),
  name: z.string(),
  flags: z.int().min(0).max(0xffff_ffff),
  forwarder: z.boolean(),
  type_def_id: z.int().min(0).max(0xffff_ffff),
  implementation_token: managedMetadataTokenSchema.nullable(),
});

const managedFieldSchema = z.object({
  token: managedMetadataTokenSchema,
  row_offset: offsetSchema,
  declaring_type_token: managedMetadataTokenSchema.nullable(),
  declaring_type: z.string().nullable(),
  name: z.string(),
  flags: z.int().min(0).max(0xffff),
  signature: managedSignatureSchema,
  constant: managedFieldConstantSchema
    .nullable()
    .exactOptional()
    .describe(
      "Field-owned ECMA-335 Constant declaration and decoded default. Null means neither a declaration nor HasDefault was observed; omission means historical Evidence without this inspection.",
    ),
});

const managedExceptionRegionSchema = z.object({
  flags: z.int().min(0).max(0xffff_ffff),
  try_offset: z.int().min(0),
  try_length: z.int().min(0),
  handler_offset: z.int().min(0),
  handler_length: z.int().min(0),
  class_token: managedMetadataTokenSchema
    .nullable()
    .describe(
      "Raw build-local catch type token; not a cross-artifact identity",
    ),
  /** Resolved from this artifact's own metadata; raw token remains build-local. */
  class_type: z.string().nullable().default(null),
  class_type_name_sha256: digestSchema
    .nullable()
    .default(null)
    .describe(
      "Nested nominal TypeDef/TypeRef name digest; assembly scope is compared separately and local tokens are not cross-artifact identities",
    ),
  class_type_identity_resolved: z
    .boolean()
    .nullable()
    .default(null)
    .describe(
      "Whether this artifact's local token identifies the reported catch type; null when unexamined",
    ),
  filter_offset: z.int().min(0).nullable(),
});

const managedInstructionAnchorSchema = z.object({
  il_offset: z.int().min(0),
  opcode: z.string().min(1),
  operand_kind: z.enum([
    "none",
    "branch",
    "constant",
    "field",
    "method",
    "signature",
    "string",
    "switch",
    "token",
    "type",
    "variable",
    "unknown",
  ]),
  operand: z.string().nullable(),
});

const managedMethodBodySchema = z.object({
  status: z.enum(["present", "partial", "absent", "malformed"]),
  header_format: z.enum(["tiny", "fat", "none", "unknown"]),
  rva: z.int().min(0).max(0xffff_ffff),
  file_offset: offsetSchema.nullable(),
  max_stack: z.int().min(0).nullable(),
  init_locals: z.boolean().nullable(),
  local_var_sig_token: managedMetadataTokenSchema.nullable(),
  local_var_signature: z
    .object({
      raw_sha256: digestSchema,
      has_context_dependent_types: z.boolean(),
    })
    .nullable()
    .default(null)
    .describe(
      "Validated LocalVarSig blob facts; null when absent or unrecorded. Named types, modifiers and generic variables require metadata or declaring context; equal raw digests do not establish their cross-artifact type identity.",
    ),
  il_size: z.int().min(0),
  il_sha256: digestSchema
    .nullable()
    .describe(
      "SHA-256 of exactly the raw il_size CIL bytes; excludes the method header, locals signature, alignment, and extra sections",
    ),
  normalized_il_sha256: digestSchema
    .nullable()
    .describe(
      "Member-result-v1 SHA-256 of UTF-8 JSON [opcode, operand_kind, operand] tuples for a complete decode; retains build-local tokens, omits switch targets, and excludes headers, locals, and exception regions",
    ),
  instruction_count: z.int().min(0),
  decoded_instruction_count: z.int().min(0),
  truncated_instructions: z.int().min(0),
  opcode_counts: z.record(z.string(), z.int().min(1)),
  anchors: z.array(managedInstructionAnchorSchema),
  exception_regions: z.array(managedExceptionRegionSchema),
  issue: z.string().nullable(),
});

const managedMethodSchema = z.object({
  token: managedMetadataTokenSchema,
  row_offset: offsetSchema,
  declaring_type_token: managedMetadataTokenSchema.nullable(),
  declaring_type: z.string().nullable(),
  name: z.string(),
  rva: z.int().min(0).max(0xffff_ffff),
  impl_flags: z.int().min(0).max(0xffff),
  flags: z.int().min(0).max(0xffff),
  signature: managedSignatureSchema,
  body: managedMethodBodySchema,
});

// Declaring types are namespace-qualified like TypeDef `full_name`, nested
// types keep bare names, and a generic instantiation names its generic type.
// Evidence recorded before declaring types were named reads them as null.
const declaringTypeNameSchema = z.string().nullable().default(null);

const managedMemberReferenceSchema = z.object({
  token: managedMetadataTokenSchema,
  row_offset: offsetSchema,
  parent_token: managedMetadataTokenSchema.nullable(),
  parent_name: declaringTypeNameSchema.describe(
    "Name of a TypeDef, TypeRef, or generic-instantiation TypeSpec parent; null for other parents or when unknown",
  ),
  name: z.string(),
  signature: managedSignatureSchema,
});

const managedUserStringSchema = z.object({
  token: managedMetadataTokenSchema,
  offset: offsetSchema.describe("File offset of the #US item"),
  value: z
    .string()
    .describe(
      "Decoded UTF-16 code units, excluding the terminal flag byte; unpaired surrogates are kept",
    ),
});

const managedModuleReferenceSchema = z.object({
  token: managedMetadataTokenSchema,
  row_offset: offsetSchema,
  name: z.string(),
});

export const managedNativeImportSchema = z.object({
  token: managedMetadataTokenSchema,
  row_offset: offsetSchema,
  mapping_flags: z.int().min(0).max(0xffff),
  mapping_flags_hex: z.string().regex(/^0x[0-9a-f]{4}$/u),
  member_token: managedMetadataTokenSchema.nullable(),
  member_kind: z.enum(["method", "field", "unknown"]),
  member_name: z.string().nullable(),
  import_name: z.string(),
  import_scope_token: managedMetadataTokenSchema.nullable(),
  import_scope_name: z.string().nullable(),
  no_mangle: z.boolean(),
  char_set: z.enum(["not-specified", "ansi", "unicode", "auto", "unknown"]),
  call_convention: z.enum([
    "not-specified",
    "winapi",
    "cdecl",
    "stdcall",
    "thiscall",
    "fastcall",
    "unknown",
  ]),
  supports_last_error: z.boolean(),
  best_fit: z.enum(["assembly-default", "enabled", "disabled", "unknown"]),
  throw_on_unmappable_char: z.enum([
    "assembly-default",
    "enabled",
    "disabled",
    "unknown",
  ]),
  verification: z.literal("managed-declaration-only"),
});

const managedNativeImplementationSchema = z.object({
  token: managedMetadataTokenSchema,
  row_offset: offsetSchema,
  name: z.string(),
  rva: z.int().min(0).max(0xffff_ffff),
  flags: z.int().min(0).max(0xffff),
  impl_flags: z.int().min(0).max(0xffff),
  code_type: z.enum(["il", "native", "optil", "runtime", "unknown"]),
  managed_kind: z.enum(["managed", "unmanaged", "unknown"]),
  pinvoke_declared: z.boolean(),
  boundary_kind: z.enum([
    "pinvoke",
    "native-body",
    "runtime-provided",
    "unmanaged-method",
    "mixed-or-unknown",
  ]),
  body_interpretation: z.enum([
    "managed-cil",
    "native-or-runtime",
    "not-file-backed",
    "unknown",
  ]),
});

const managedCallEdgeSchema = z.object({
  caller_token: managedMetadataTokenSchema,
  il_offset: offsetSchema.nullable().default(null),
  target_identity_sha256: digestSchema
    .nullable()
    .default(null)
    .describe(
      "Nominal declaring-type/name/signature digest; null when unresolved or unrecorded. Does not establish assembly or runtime binding.",
    ),
  caller: z.string().nullable(),
  opcode: z.string(),
  target_token: managedMetadataTokenSchema,
  target_kind: z.enum(["method-def", "member-ref", "method-spec", "unknown"]),
  target_name: z
    .string()
    .nullable()
    .describe("Method name; a method-spec target reports its generic method"),
  target_declaring_type: declaringTypeNameSchema.describe(
    "Declaring type of the called method; null when unknown",
  ),
});

const managedFieldAccessSchema = z.object({
  method_token: managedMetadataTokenSchema,
  il_offset: offsetSchema.nullable().default(null),
  target_identity_sha256: digestSchema
    .nullable()
    .default(null)
    .describe(
      "Nominal declaring-type/name/signature digest; null when unresolved or unrecorded. Does not establish assembly or runtime binding.",
    ),
  method: z.string().nullable(),
  opcode: z.string(),
  field_token: managedMetadataTokenSchema,
  field_name: z.string().nullable(),
  field_declaring_type: declaringTypeNameSchema.describe(
    "Declaring type of the accessed field; null when unknown",
  ),
});

const managedParseIssueSchema = z.object({
  code: z.enum([
    "resource-limit",
    "invalid-cli-header",
    "invalid-directory",
    "invalid-metadata-root",
    "invalid-stream",
    "missing-stream",
    "invalid-tables",
    "unsupported-metadata",
    "invalid-row",
    "invalid-heap-index",
    "invalid-string",
    "invalid-blob",
    "unsupported-signature",
    "invalid-guid",
    "invalid-resource",
  ]),
  scope: z.string().min(1),
  offset: offsetSchema.nullable(),
  detail: z.string().min(1),
});

/** Provider-neutral, execution-free PE/CLI triage and identity result. */
export const managedArtifactInspectionSchema = z.object({
  artifact: managedArtifactReferenceSchema,
  pe: z.object({
    machine: z.int().min(0).max(0xffff),
    machine_hex: z.string().regex(/^0x[0-9a-f]{4}$/u),
    architecture: z.enum(["x86", "x86_64", "arm", "arm64"]),
    optional_header: z.enum(["pe32", "pe32-plus"]),
    section_count: z.int().min(1).max(0xffff),
    characteristics: z.int().min(0).max(0xffff),
    cli: z
      .object({
        header_offset: offsetSchema,
        header_size: z.int().min(72),
        runtime_version: z.string(),
        flags: z.int().min(0).max(0xffff_ffff),
        flag_names: z.array(z.string()),
        entry_point: z.object({
          kind: z.enum(["metadata-token", "native-rva", "none"]),
          value: z.string().nullable(),
        }),
        metadata_rva: z.int().min(1).max(0xffff_ffff),
        metadata_size: z.int().min(1).max(0xffff_ffff),
        resources_rva: z.int().min(0).max(0xffff_ffff),
        resources_size: z.int().min(0).max(0xffff_ffff),
        strong_name_rva: z.int().min(0).max(0xffff_ffff),
        strong_name_size: z.int().min(0).max(0xffff_ffff),
        managed_native_header_rva: z.int().min(0).max(0xffff_ffff),
        managed_native_header_size: z.int().min(0).max(0xffff_ffff),
        ready_to_run_signature: z.boolean(),
      })
      .nullable(),
  }),
  classification: z.object({
    status: z.enum(["managed", "not-managed", "malformed"]),
    container: z.literal("pe"),
    runtime_family: z.enum([
      "dotnet-framework",
      "modern-dotnet",
      "unity-mono",
      "mixed-clr-native",
      "unknown",
    ]),
    implementation: z.enum([
      "cil",
      "cil-and-ready-to-run",
      "cpp-cli-mixed",
      "metadata-only",
      "not-managed",
      "unknown",
    ]),
    managed_architecture: z.enum([
      "anycpu",
      "anycpu-prefer-32",
      "x86",
      "x86_64",
      "arm",
      "arm64",
      "unknown",
    ]),
    evidence: z.array(
      z.object({
        code: z.string().min(1),
        detail: z.string().min(1),
        file_offset: offsetSchema.nullable(),
      }),
    ),
  }),
  metadata: z.object({
    status: z.enum(["absent", "complete", "partial", "malformed"]),
    version: z.string().nullable(),
    stream_names: z.array(z.string()),
    table_row_counts: z.record(z.string(), z.int().min(0).max(0xffff_ffff)),
  }),
  module: moduleIdentitySchema.nullable(),
  assembly: assemblyIdentitySchema.nullable(),
  target_frameworks: z.array(z.string()),
  references: z.array(assemblyReferenceSchema),
  resources: z.array(managedResourceSchema),
  attributes: z.array(customAttributeSchema),
  coverage: z.object({
    state: z.enum(["complete", "partial", "unavailable"]),
    issues: z.array(managedParseIssueSchema),
  }),
  limitations: z.array(z.string()),
});

/** Provider-neutral, execution-free metadata/signature/IL member inspection. */
export const managedMemberInspectionSchema = z.object({
  signature_resolution: z
    .enum(["type-names-v1", "type-names-v2"])
    .nullable()
    .default(null)
    .describe(
      "Signature type-name resolution was examined, including unresolved operands; v2 also renders readable operand names, v1 retains raw operand text; null means no attestation, including historical or capacity-limited Evidence.",
    ),
  artifact: managedArtifactReferenceSchema,
  module: moduleIdentitySchema.nullable(),
  assembly: assemblyIdentitySchema.nullable().default(null),
  metadata: managedMetadataSummarySchema,
  identity_scope: managedTokenIdentityScopeSchema,
  types: z.array(managedTypeSchema),
  // Member Evidence recorded before NestedClass rows were read omits this
  // field; null is historical uncertainty. False means a current NestedClass
  // row was unreadable or invalid, not that no nested types exist.
  nesting_read: z
    .boolean()
    .nullable()
    .default(null)
    .describe(
      "Whether all NestedClass rows were read and valid. Null for historical Evidence; false means current nesting is incomplete. Individual name digests can remain unresolved for missing, cyclic or over-deep enclosing chains.",
    ),
  // Member Evidence recorded before ExportedType rows were read omits this
  // field; null means the table was not examined, not that it was empty.
  exported_types: z.array(managedExportedTypeSchema).nullable().default(null),
  fields: z.array(managedFieldSchema),
  methods: z.array(managedMethodSchema),
  member_refs: z.array(managedMemberReferenceSchema),
  call_edges: z.array(managedCallEdgeSchema),
  field_accesses: z.array(managedFieldAccessSchema),
  // Distinct #US literals loaded by ldstr in the inspected method bodies, in
  // token order, with their own coverage: #US issues never enter the member
  // coverage. null means they were not examined, not that there were none.
  user_strings: z
    .object({
      state: z.enum(["complete", "partial"]),
      literals: z.array(managedUserStringSchema),
      issues: z.array(managedParseIssueSchema),
    })
    .nullable()
    .default(null),
  /** Caller-selected declaring types; null when every type was inspected. */
  selection: z
    .object({
      type_names: z.array(z.string().min(1)).min(1),
      unmatched_type_names: z.array(z.string().min(1)),
    })
    .nullable()
    .default(null),
  method_rows: z
    .object({
      offset: z.int().nonnegative(),
      count: z.int().nonnegative(),
      total: z.int().nonnegative(),
    })
    .nullable()
    .default(null)
    .describe(
      "Examined zero-based MethodDef row interval before declaring-type selection; null means the row scope was not recorded. Row coordinates are build-local and cannot prove cross-build member absence for a page.",
    ),
  coverage: z.object({
    state: z.enum(["complete", "partial", "unavailable"]),
    issues: z.array(managedParseIssueSchema),
  }),
  limitations: z.array(z.string()),
});

/** Provider-neutral managed/native boundary observations from PE/CLI metadata. */
export const managedNativeBoundaryInspectionSchema = z.object({
  artifact: managedArtifactReferenceSchema,
  module: moduleIdentitySchema.nullable(),
  metadata: managedMetadataSummarySchema,
  identity_scope: managedTokenIdentityScopeSchema,
  cli_native: z
    .object({
      il_only: z.boolean(),
      requires_32bit: z.boolean(),
      strong_name_signed: z.boolean(),
      native_entry_point: z.boolean(),
      ready_to_run_signature: z.boolean(),
      managed_native_header_rva: z.int().min(0).max(0xffff_ffff),
      managed_native_header_size: z.int().min(0).max(0xffff_ffff),
    })
    .nullable(),
  module_refs: z.array(managedModuleReferenceSchema),
  pinvoke_imports: z.array(managedNativeImportSchema),
  native_implementations: z.array(managedNativeImplementationSchema),
  summary: z.object({
    module_ref_count: z.int().min(0),
    pinvoke_import_count: z.int().min(0),
    native_implementation_count: z.int().min(0),
    ready_to_run: z.boolean().nullable(),
    mixed_mode_or_native_header: z.boolean().nullable(),
  }),
  coverage: z.object({
    state: z.enum(["complete", "partial", "unavailable"]),
    issues: z.array(managedParseIssueSchema),
  }),
  limitations: z.array(z.string()),
});

export type ManagedArtifactInspection = z.infer<
  typeof managedArtifactInspectionSchema
>;
export type ManagedMemberInspection = z.infer<
  typeof managedMemberInspectionSchema
>;
export type ManagedNativeBoundaryInspection = z.infer<
  typeof managedNativeBoundaryInspectionSchema
>;
export type ManagedParseIssue = z.infer<typeof managedParseIssueSchema>;
