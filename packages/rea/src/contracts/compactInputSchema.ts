import {
  COMPACT_SCHEMA_MAX_DEPTH,
  hasGatewayIncompatibleShape,
  inlineWithinBudget,
  reduceToShallowProperties,
  schemaDepth,
  serializedBytes,
  stripAnnotations,
  typeArrayItemUnions,
} from "./compactJsonSchema.js";

// Kimi expands schema-local references before sending tools to Moonshot.
// Compact advertisements must fit after expansion, independently of client
// reference handling. Canonical server-side validation remains unchanged.

export type AdvertisedInputSchemaPresentation = "inline" | "reduced";

/** Budget selected by the caller for compact MCP input-schema presentation. */
export interface CompactInputSchemaPresentation {
  readonly budgetBytes: number;
}

export interface CompactedInputSchema {
  readonly schema: Record<string, unknown>;
  readonly presentation: AdvertisedInputSchemaPresentation;
}

const INPUT_REDUCED_ANNOTATION =
  "Advertised in reduced form by the compact input schema profile; the server still validates complete canonical inputs.";

/**
 * Render an advertised input schema within a per-schema byte budget for
 * providers that validate the literal serialized schema size. Validation
 * keywords and the canonical contract are preserved; only
 * annotation prose and, for structurally oversized schemas, nested
 * validation detail leave the advertised form.
 */
export const compactAdvertisedInputSchema = (
  schema: Record<string, unknown>,
  budgetBytes: number,
): CompactedInputSchema => {
  const expanded = inlineWithinBudget(stripAnnotations(schema), budgetBytes);
  const inline =
    expanded === undefined ? undefined : typeArrayItemUnions(expanded);
  if (
    inline !== undefined &&
    serializedBytes(inline) <= budgetBytes &&
    schemaDepth(inline) <= COMPACT_SCHEMA_MAX_DEPTH &&
    !hasGatewayIncompatibleShape(inline)
  )
    return { schema: inline, presentation: "inline" };
  const reduced = reduceToShallowProperties(schema, INPUT_REDUCED_ANNOTATION);
  if (serializedBytes(reduced) <= budgetBytes)
    return { schema: reduced, presentation: "reduced" };
  // A future contract with an extreme root-property count still advertises
  // an honest, budget-fitting shape instead of an oversized one.
  return {
    schema: reduceToShallowProperties(
      {
        type: "object",
        description:
          (typeof schema.description === "string"
            ? `${schema.description} `
            : "") + INPUT_REDUCED_ANNOTATION,
      },
      INPUT_REDUCED_ANNOTATION,
    ),
    presentation: "reduced",
  };
};

/** Return the JSON schema clients receive for the selected input presentation. */
export const presentAdvertisedInputSchema = (
  schema: Record<string, unknown>,
  compactPresentation: CompactInputSchemaPresentation | undefined,
): Record<string, unknown> =>
  compactPresentation === undefined
    ? schema
    : compactAdvertisedInputSchema(schema, compactPresentation.budgetBytes)
        .schema;
