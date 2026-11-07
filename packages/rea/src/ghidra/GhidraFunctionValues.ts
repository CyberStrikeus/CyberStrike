import { nativeAddressObservationSchema } from "../domain/native/nativeAddress.js";
import { procedureInfoSchema } from "../domain/native/procedureInfo.js";
import { z } from "zod";
import {
  ghidraNativeApiBoundary,
  ghidraNativeValueFlow,
} from "./GhidraNativeAnalysisValues.js";
import {
  nativeFunctionAnnotationsInputSchema,
  nativeFunctionAnnotationsSchema,
} from "../domain/native/nativeFunctionAnnotations.js";
import { nativeDataTypeSchema } from "../domain/native/nativeDataType.js";
import {
  nativeInstructionSchema,
  nativeCallTargetsSchema,
} from "../domain/native/nativeInstruction.js";

import {
  type AnalysisInputError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import {
  functionInstructionWindowSchema,
  functionDossierSchema,
} from "../domain/native/functionDossier.js";
import {
  availableReferenceKindSchema,
  unresolvedCallSchema,
} from "../domain/native/nativeReference.js";
import {
  swiftSmallStringLiteralSchema,
  swiftLargeStringLiteralSchema,
  swiftSmallStringLiteralOmissionSchema,
  swiftLargeStringLiteralOmissionSchema,
} from "../domain/native/swiftStringLiteral.js";
import { functionBodyEntryAgrees } from "../domain/native/functionBody.js";
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonValue,
} from "../domain/jsonValue.js";
import type { EvidenceLocation } from "../domain/evidence.js";
import {
  relationshipCoverageSchema,
  type RelationshipCoverage,
} from "../domain/relationshipCoverage.js";
import { err, ok, type Result } from "../domain/result.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import {
  ghidraIdentifierSchema,
  ghidraInputAddressSchema,
  ghidraFunctionClassificationSchema as classification,
  ghidraFunctionBodySchema as ghidraFunctionBody,
  ghidraProcedureIdentitySchema as procedureIdentity,
  ghidraFunctionIdentitySchema as dossierProcedureIdentity,
} from "./GhidraInventoryValues.js";

/** Function analysis and annotation operations admitted by the Ghidra adapter. */
export const GHIDRA_FUNCTION_OPERATIONS = [
  "annotate_native_function",
  "inspect_native_data_type",
  "inspect_native_instruction",
  "resolve_native_call_targets",
  "analyze_function",
  "procedure_assembly",
  "procedure_callees",
  "procedure_callers",
  "procedure_info",
  "procedure_pseudo_code",
  "read_function_instructions",
  "procedure_references",
  "xrefs",
] as const;

/** One function-analysis operation implemented by the packaged Java bridge. */
export type GhidraFunctionOperation =
  (typeof GHIDRA_FUNCTION_OPERATIONS)[number];

const operationSet: ReadonlySet<string> = new Set(GHIDRA_FUNCTION_OPERATIONS);

/** Narrow an application operation to the Ghidra function-analysis surface. */
export const isGhidraFunctionOperation = (
  operation: string,
): operation is GhidraFunctionOperation => operationSet.has(operation);

const document = ghidraIdentifierSchema.nullable().default(null);
const procedure = ghidraIdentifierSchema;
const directProcedure = { document, procedure };

const inputSchemas = {
  annotate_native_function: nativeFunctionAnnotationsInputSchema,
  inspect_native_data_type: z
    .object({
      document,
      type: z.string().min(1).nullable().default(null),
      address: ghidraInputAddressSchema.nullable().default(null),
    })
    .strict()
    .refine(
      (value) => (value.type === null) !== (value.address === null),
      "Supply exactly one of type or address",
    ),
  inspect_native_instruction: z
    .object({ document, address: ghidraInputAddressSchema })
    .strict(),
  resolve_native_call_targets: z
    .object({ document, address: ghidraInputAddressSchema })
    .strict(),
  analyze_function: z.object({ procedure }).strict(),
  procedure_assembly: z.object(directProcedure).strict(),
  procedure_callees: z.object(directProcedure).strict(),
  procedure_callers: z.object(directProcedure).strict(),
  procedure_info: z.object(directProcedure).strict(),
  procedure_pseudo_code: z.object(directProcedure).strict(),
  read_function_instructions: z.object(directProcedure).strict(),
  procedure_references: z
    .object({
      ...directProcedure,
      direction: z.enum(["incoming", "outgoing"]).default("outgoing"),
    })
    .strict(),
  xrefs: z.object({ document, address: ghidraInputAddressSchema }).strict(),
} satisfies Readonly<Record<GhidraFunctionOperation, z.ZodType>>;

/** Validate and default one function request before it crosses the socket. */
export const parseGhidraFunctionInput = (
  operation: GhidraFunctionOperation,
  value: Readonly<Record<string, JsonValue>>,
): Result<Readonly<Record<string, JsonValue>>, AnalysisInputError> => {
  const parsed = inputSchemas[operation].safeParse(value);
  return parsed.success
    ? ok(
        jsonObjectSchema.parse(
          Object.fromEntries(
            Object.entries(parsed.data).filter(
              ([, value]) => value !== undefined,
            ),
          ),
        ),
      )
    : err(
        analysisInputErrorFromIssues(operation, parsed.error.issues, value, {
          cause: parsed.error,
        }),
      );
};

const localVariable = z
  .object({
    description: z.string(),
    provenance: z.literal("ghidra-function-database"),
  })
  .strict();
const referenceKind = availableReferenceKindSchema.safeExtend({
  provenance: z.literal("ghidra-reference-manager"),
  type: z.string().min(1),
});
const referenceEdge = z
  .object({
    source_address: nativeAddressObservationSchema,
    target_address: nativeAddressObservationSchema,
    source_procedure: procedureIdentity.nullable(),
    target_procedure: procedureIdentity.nullable(),
    kind: referenceKind,
  })
  .strict();
const procedureReferences = z
  .object({
    procedure: procedureIdentity,
    direction: z.enum(["incoming", "outgoing"]),
    references: z.array(referenceEdge),
    reference_kinds_available: z.boolean(),
    unresolved_calls: z.array(
      z.strictObject({
        address: nativeAddressObservationSchema,
        reason: z.string(),
      }),
    ),
  })
  .strict();
const procedureInfo = procedureInfoSchema
  .safeExtend({
    name: z.string().min(1),
    entrypoint: nativeAddressObservationSchema,
    length: z.int().min(0),
    locals: z.array(localVariable),
    classification,
    body: ghidraFunctionBody,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !functionBodyEntryAgrees(value.body, value.entrypoint) ||
      (value.body.available &&
        (value.length !== value.body.total_bytes ||
          (!value.classification.external && !value.body.contains_entry)))
    )
      context.addIssue({
        code: "custom",
        message: "Ghidra function body disagrees with entry point or length",
      });
  });

const dossierReferenceEdge =
  functionDossierSchema.shape.incoming_references.element.extend({
    source_address: nativeAddressObservationSchema,
    target_address: nativeAddressObservationSchema,
    source_procedure: dossierProcedureIdentity.nullable(),
    target_procedure: dossierProcedureIdentity.nullable(),
    kind: referenceKind,
  });

const ghidraFunctionDossier = functionDossierSchema
  .extend({
    procedure: dossierProcedureIdentity.safeExtend({
      signature: functionDossierSchema.shape.procedure.shape.signature,
      locals: z.array(localVariable),
    }),
    comments: z.array(
      functionDossierSchema.shape.comments.element.extend({
        address: nativeAddressObservationSchema,
      }),
    ),
    callers: z.array(dossierProcedureIdentity),
    callees: z.array(dossierProcedureIdentity),
    incoming_references: z.array(dossierReferenceEdge),
    outgoing_references: z.array(dossierReferenceEdge),
    unresolved_calls: z
      .array(
        unresolvedCallSchema.extend({
          address: nativeAddressObservationSchema,
        }),
      )
      .exactOptional(),
    referenced_strings: z.array(
      functionDossierSchema.shape.referenced_strings.element.extend({
        address: nativeAddressObservationSchema,
        source_address: nativeAddressObservationSchema,
      }),
    ),
    referenced_names: z.array(
      functionDossierSchema.shape.referenced_names.element.extend({
        address: nativeAddressObservationSchema,
        source_address: nativeAddressObservationSchema,
      }),
    ),
    swift_string_literals: z
      .array(
        z.discriminatedUnion("representation", [
          swiftSmallStringLiteralSchema.extend({
            source_address: nativeAddressObservationSchema,
          }),
          swiftLargeStringLiteralSchema.extend({
            source_address: nativeAddressObservationSchema,
            address: nativeAddressObservationSchema,
          }),
        ]),
      )
      .exactOptional(),
    swift_string_literal_omissions: z
      .array(
        z.discriminatedUnion("representation", [
          swiftSmallStringLiteralOmissionSchema.extend({
            source_address: nativeAddressObservationSchema,
          }),
          swiftLargeStringLiteralOmissionSchema.extend({
            source_address: nativeAddressObservationSchema,
            address: nativeAddressObservationSchema,
          }),
        ]),
      )
      .exactOptional(),
    basic_blocks: z.array(
      functionDossierSchema.shape.basic_blocks.element.extend({
        start: nativeAddressObservationSchema,
        end: nativeAddressObservationSchema,
        successors: z.array(nativeAddressObservationSchema),
      }),
    ),
    native_api: ghidraNativeApiBoundary,
    native_value_flow: ghidraNativeValueFlow,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.swift_string_literals === undefined) !==
      (value.swift_string_literal_omissions === undefined)
    )
      context.addIssue({
        code: "custom",
        message:
          "Ghidra dossier must record Swift literals and their omissions together",
      });
    if (
      !value.limitations.some((item) => /indirect|computed/u.test(item)) ||
      !value.limitations.some((item) => /provider|Ghidra|Hopper/u.test(item))
    )
      context.addIssue({
        code: "custom",
        message: "Ghidra dossier omitted required uncertainty limitations",
      });
  });
const ghidraFunctionInstructionWindow = functionInstructionWindowSchema
  .extend({ procedure: procedureIdentity })
  .strict();

const resultSchemas = {
  annotate_native_function: nativeFunctionAnnotationsSchema.safeExtend({
    dossier: ghidraFunctionDossier,
  }),
  analyze_function: ghidraFunctionDossier,
  procedure_assembly: z.string(),
  procedure_callees: z.array(nativeAddressObservationSchema),
  procedure_callers: z.array(nativeAddressObservationSchema),
  procedure_info: procedureInfo,
  procedure_pseudo_code: z.string().nullable(),
  read_function_instructions: ghidraFunctionInstructionWindow,
  inspect_native_instruction: nativeInstructionSchema,
  inspect_native_data_type: nativeDataTypeSchema,
  resolve_native_call_targets: nativeCallTargetsSchema,
  procedure_references: procedureReferences,
  xrefs: z.array(nativeAddressObservationSchema),
} satisfies Readonly<Record<GhidraFunctionOperation, z.ZodType>>;

const functionBoundaryObservationOperations: ReadonlySet<GhidraFunctionOperation> =
  new Set([
    "analyze_function",
    "procedure_assembly",
    "procedure_callees",
    "procedure_callers",
    "procedure_info",
    "procedure_pseudo_code",
    "procedure_references",
    "read_function_instructions",
  ]);

const functionObservationEnvelope = z.strictObject({
  value: z.unknown(),
  limitations: z.array(z.string()),
  cache_policy: z.literal("live").exactOptional(),
  relationship_coverage: relationshipCoverageSchema.exactOptional(),
  selection: z
    .strictObject({
      file_offset: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
      mapped_address: nativeAddressObservationSchema,
      procedure_address: nativeAddressObservationSchema,
    })
    .exactOptional(),
});

export interface ParsedGhidraFunctionResult {
  readonly value: JsonValue;
  readonly rawResult?: JsonValue;
  readonly cachePolicy?: "live";
  readonly limitations: readonly string[];
  readonly locations?: readonly EvidenceLocation[];
  readonly relationshipCoverage?: RelationshipCoverage;
}

/** Require exact, bounded Java-bridge function output before creating Evidence. */
export const parseGhidraFunctionResult = (
  operation: GhidraFunctionOperation,
  value: JsonValue,
): Result<ParsedGhidraFunctionResult, AnalysisOutputError> => {
  let observation: {
    readonly value: unknown;
    readonly limitations: readonly string[];
    readonly cache_policy?: "live";
    readonly relationship_coverage?: RelationshipCoverage;
    readonly selection?: z.infer<
      typeof functionObservationEnvelope
    >["selection"];
  };
  if (functionBoundaryObservationOperations.has(operation)) {
    const envelope = functionObservationEnvelope.safeParse(value);
    if (
      !envelope.success ||
      (operation !== "analyze_function" &&
        envelope.data.cache_policy !== undefined) ||
      (operation !== "analyze_function" &&
        operation !== "procedure_callers" &&
        operation !== "procedure_callees" &&
        envelope.data.relationship_coverage !== undefined) ||
      (operation !== "procedure_pseudo_code" &&
        envelope.data.selection !== undefined)
    )
      return err(
        new AnalysisOutputError(
          operation,
          "Ghidra bridge returned an invalid function observation envelope for this operation",
          envelope.success ? undefined : { cause: envelope.error },
        ),
      );
    observation = envelope.data;
  } else {
    observation = { value, limitations: [] };
  }
  const parsed = resultSchemas[operation].safeParse(observation.value);
  return parsed.success
    ? ok({
        value: jsonValueSchema.parse(parsed.data),
        limitations: observation.limitations,
        ...(observation.cache_policy === undefined
          ? {}
          : { cachePolicy: observation.cache_policy }),
        ...(observation.relationship_coverage === undefined
          ? {}
          : { relationshipCoverage: observation.relationship_coverage }),
        ...(observation.selection === undefined
          ? {}
          : {
              // Generic locations retain coordinates but not their mapping roles.
              rawResult: value,
              locations: [
                {
                  kind: "file-offset" as const,
                  offset: observation.selection.file_offset,
                },
                {
                  kind: "address" as const,
                  address: observation.selection.mapped_address,
                },
                {
                  kind: "address" as const,
                  address: observation.selection.procedure_address,
                },
              ],
            }),
      })
    : err(
        new AnalysisOutputError(
          operation,
          "Ghidra bridge output did not match the function-analysis contract",
          { cause: parsed.error },
        ),
      );
};
