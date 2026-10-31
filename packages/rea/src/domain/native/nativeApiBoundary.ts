import { z } from "zod";

const inferenceConfidenceSchema = z.enum(["low", "medium", "high"]);

const inferenceEvidenceSchema = z
  .object({
    kind: z.enum([
      "signature-source",
      "decompiler-type",
      "type-lock",
      "calling-convention",
      "jump-table",
    ]),
    source: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();

const inferredBoundaryTypeFacts = {
  ordinal: z.int().min(0).nullable(),
  name: z.string().min(1).nullable(),
  data_type: z.string().min(1),
  size_bytes: z.int().min(0).nullable(),
  storage: z.string().min(1).nullable(),
  confidence: inferenceConfidenceSchema,
  evidence: z.array(inferenceEvidenceSchema).min(1),
  decompiler_artifacts: z.array(
    z.enum([
      "recovered-signature",
      "register-or-stack-storage",
      "compiler-generated-variable",
    ]),
  ),
} as const;

const inferredReturnTypeSchema = z.strictObject({
  ...inferredBoundaryTypeFacts,
  role: z.literal("return"),
  ordinal: z.null(),
  name: z.null(),
});

const inferredParameterTypeSchema = z.strictObject({
  ...inferredBoundaryTypeFacts,
  role: z.literal("parameter"),
  ordinal: z.int().min(0),
});

const jumpTableDataSourceSchema = z
  .object({
    address: z.string().min(1),
    provenance: z.enum([
      "ghidra-decompiler-load-table",
      "ghidra-dispatch-block-data-reference",
      "ghidra-aarch64-byte-table",
      "ghidra-aarch64-halfword-table",
    ]),
    entry_size_bytes: z.int().min(1).nullable(),
    entry_count: z.int().min(0).nullable(),
    confidence: inferenceConfidenceSchema,
    evidence: z.array(inferenceEvidenceSchema).min(1),
  })
  .strict();

const jumpTableMappingSchema = z
  .object({
    case_value: z.int().nullable(),
    target_address: z.string().min(1),
    confidence: inferenceConfidenceSchema,
    evidence: z.array(inferenceEvidenceSchema).min(1),
  })
  .strict();

const jumpTableDefaultTargetSchema = z.strictObject({
  target_address: z.string().min(1),
  confidence: inferenceConfidenceSchema,
  evidence: z.array(inferenceEvidenceSchema).min(1),
});

const inferredJumpTableSchema = z
  .object({
    dispatch_address: z.string().min(1),
    data_sources: z.array(jumpTableDataSourceSchema),
    mappings: z.array(jumpTableMappingSchema),
    default_targets: z.array(jumpTableDefaultTargetSchema),
    limitations: z.array(z.string()),
  })
  .strict();

export const availableNativeApiBoundarySchema = z
  .object({
    available: z.literal(true),
    provenance: z.string().min(1),
    signature_source: z.string().min(1),
    calling_convention: z.string().min(1),
    return_type: inferredReturnTypeSchema,
    parameters: z.array(inferredParameterTypeSchema),
    jump_tables: z.array(inferredJumpTableSchema),
    pseudocode: z
      .object({
        classification: z.literal("decompiler-generated-non-source"),
        compilable: z.literal(false),
      })
      .strict(),
    decompiler_artifacts: z.array(
      z.enum([
        "recovered-signature",
        "register-and-stack-variables",
        "compiler-generated-control-flow",
        "pointer-arithmetic",
        "pseudocode",
      ]),
    ),
    limitations: z.array(z.string()),
  })
  .strict();

export const unavailableNativeApiBoundarySchema = z
  .object({
    available: z.literal(false),
    reason: z.string().min(1),
    residual_unknowns: z.array(z.string().min(1)).min(1),
  })
  .strict();

/** Provider-neutral native API boundary observations attached to a function dossier. */
export const nativeApiBoundarySchema = z.discriminatedUnion("available", [
  unavailableNativeApiBoundarySchema,
  availableNativeApiBoundarySchema,
]);

/** One validated provider-neutral native API boundary observation. */
export type NativeApiBoundary = z.infer<typeof nativeApiBoundarySchema>;

const nativeApiInspectionSubstepSchema = z
  .object({
    operation: z.enum([
      "analyze_function",
      "project_native_api_boundary",
      "preserve_residual_unknowns",
    ]),
    status: z.enum(["completed", "unsupported"]),
    observations: z.array(z.string().min(1)),
  })
  .strict();

/** Agent-facing projection of structured native API reconstruction substeps. */
export const nativeApiInspectionResultSchema = z
  .object({
    procedure: z
      .object({
        address: z.string().min(1),
        name: z.string().min(1),
      })
      .strict(),
    boundary: nativeApiBoundarySchema,
    substeps: z.array(nativeApiInspectionSubstepSchema).length(3),
    unsupported_branches: z.array(z.string().min(1)),
    residual_unknowns: z.array(z.string().min(1)),
  })
  .strict();

/** One validated agent-facing native API inspection result. */
export type NativeApiInspectionResult = z.infer<
  typeof nativeApiInspectionResultSchema
>;
