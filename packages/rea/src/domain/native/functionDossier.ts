import { z } from "zod";
import { err, ok, type Result } from "../result.js";
import { AnalysisOutputError } from "../analysisErrorCore.js";
import type { JsonValue } from "../jsonValue.js";
import {
  procedureIdentitySchema,
  localVariableSchema,
} from "./procedureInfo.js";
import { analysisStringSchema } from "./nativeString.js";
import {
  referenceEdgeSchema,
  unresolvedCallSchema,
} from "./nativeReference.js";
import {
  swiftStringLiteralSchema,
  swiftStringLiteralOmissionSchema,
} from "./swiftStringLiteral.js";
import { nativeApiBoundarySchema } from "./nativeApiBoundary.js";
import { nativeValueFlowSchema } from "./nativeValueFlow.js";

/** Provider-neutral complete raw-instruction list for one analyzed function. */
export const functionInstructionWindowSchema = z
  .object({
    procedure: procedureIdentitySchema,
    instructions: z.array(z.string()),
    limitations: z.array(z.string()),
  })
  .strict();

const facetAvailabilitySchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(true) }).strict(),
  z.object({ available: z.literal(false), reason: z.string().min(1) }).strict(),
]);

/** Provider-declared availability per dossier facet; an omitted facet declares nothing. */
export const functionFacetAvailabilitySchema = z
  .object({
    pseudocode: facetAvailabilitySchema.exactOptional(),
    assembly: facetAvailabilitySchema.exactOptional(),
    comments: facetAvailabilitySchema.exactOptional(),
    callers: facetAvailabilitySchema.exactOptional(),
    callees: facetAvailabilitySchema.exactOptional(),
    references: facetAvailabilitySchema.exactOptional(),
    strings_names: facetAvailabilitySchema.exactOptional(),
    cfg: facetAvailabilitySchema.exactOptional(),
  })
  .strict();

export const functionDossierSchema = z
  .object({
    procedure: procedureIdentitySchema.safeExtend({
      signature: z.string().nullable(),
      locals: z.array(localVariableSchema),
    }),
    pseudocode: z.string(),
    assembly: z.array(z.string()),
    comments: z.array(
      z
        .object({
          address: z.string(),
          kind: z.enum(["comment", "inline"]),
          text: z.string(),
        })
        .strict(),
    ),
    callers: z.array(procedureIdentitySchema),
    callees: z.array(procedureIdentitySchema),
    incoming_references: z.array(referenceEdgeSchema),
    outgoing_references: z.array(referenceEdgeSchema),
    unresolved_calls: z.array(unresolvedCallSchema).exactOptional(),
    referenced_strings: z.array(
      analysisStringSchema.extend({ source_address: z.string() }),
    ),
    referenced_names: z.array(
      z
        .object({
          address: z.string(),
          value: z.string(),
          source_address: z.string(),
        })
        .strict(),
    ),
    swift_string_literals: z
      .array(swiftStringLiteralSchema)
      .exactOptional()
      .describe(
        "Swift String literals decoded from constant register values. Absent when the provider does not decode them for this target.",
      ),
    swift_string_literal_omissions: z
      .array(swiftStringLiteralOmissionSchema)
      .exactOptional()
      .describe(
        "Literal candidates omitted for capacity or unresolved control flow. Present exactly when swift_string_literals is present; empty when all examined use sites were classified.",
      ),
    basic_blocks: z.array(
      z
        .object({
          start: z.string(),
          end: z.string(),
          successors: z.array(z.string()),
        })
        .strict(),
    ),
    native_api: nativeApiBoundarySchema.nullable(),
    native_value_flow: nativeValueFlowSchema.nullable(),
    facet_availability: functionFacetAvailabilitySchema.exactOptional(),
    limitations: z.array(z.string()),
  })
  .strict();

/** Strict analyzed-function dossier shared by provider and comparison boundaries. */
export type FunctionDossier = z.infer<typeof functionDossierSchema>;

/** Strictly parse a complete provider-neutral function dossier. */
export const parseFunctionDossier = (
  value: JsonValue,
): Result<FunctionDossier, AnalysisOutputError> => {
  const parsed = functionDossierSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(
        new AnalysisOutputError(
          "analyze_function",
          "provider output did not match the dossier contract",
          { cause: parsed.error },
        ),
      );
};
