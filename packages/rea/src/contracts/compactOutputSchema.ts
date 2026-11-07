import {
  COMPACT_SCHEMA_MAX_DEPTH,
  inlineWithinBudget,
  isSchemaObject,
  jsonValueSchema,
  reduceToShallowProperties,
  schemaDepth,
  serializedBytes,
  stripAnnotations,
} from "./compactJsonSchema.js";

// Output schemas dominate a complete `tools/list` frame. The compact profile
// bounds each advertised output contract so frame-capped hosts can finish the
// handshake, while canonical result validation and `structuredContent` stay
// unchanged. Every projection is a widening: a valid canonical result always
// satisfies the advertised schema.

export type AdvertisedOutputSchemaPresentation = "inline" | "reduced";

/** Budget selected by the caller for compact MCP output-schema presentation. */
export interface CompactOutputSchemaPresentation {
  readonly budgetBytes: number;
}

export interface CompactedOutputSchema {
  readonly schema: Record<string, unknown>;
  readonly presentation: AdvertisedOutputSchemaPresentation;
}

const OUTPUT_REDUCED_ANNOTATION =
  "Advertised in reduced form by the compact output schema profile; the server still validates complete canonical results.";

/**
 * Drop the canonical contract's content-bound `$id` and anchors. The compact
 * bytes differ from the canonical schema the identity was derived from, so
 * retaining that identity would misstate what the advertised document is.
 * References are already inlined, so no identity is needed to resolve them.
 */
const withoutContentBoundIdentity = (
  schema: Record<string, unknown>,
): Record<string, unknown> => {
  const { $id: _id, $anchor: _anchor, ...advertised } = schema;
  return advertised;
};

/**
 * Render an advertised output schema within a per-schema byte budget. The
 * complete validation structure is kept when it fits; otherwise the root
 * property shape and first-level types remain and nested detail is elided.
 * The registered canonical schema still validates every delivered result.
 */
export const compactAdvertisedOutputSchema = (
  schema: Record<string, unknown>,
  budgetBytes: number,
): CompactedOutputSchema => {
  const inline = inlineWithinBudget(stripAnnotations(schema), budgetBytes);
  if (inline !== undefined && schemaDepth(inline) <= COMPACT_SCHEMA_MAX_DEPTH)
    return {
      schema: withoutContentBoundIdentity(inline),
      presentation: "inline",
    };
  // Every REA output contract is an object at the root. A non-object root still
  // advertises an accepting shape rather than a projection that could reject
  // valid canonical output.
  const reduced =
    schema.type === "object" || isSchemaObject(schema.properties)
      ? reduceToShallowProperties(schema, OUTPUT_REDUCED_ANNOTATION)
      : jsonValueSchema();
  if (serializedBytes(reduced) <= budgetBytes)
    return {
      schema: withoutContentBoundIdentity(reduced),
      presentation: "reduced",
    };
  // A root description can itself be large; keep the advertisement inside the
  // budget instead of carrying it into a shape with no nested detail left.
  const minimal = reduceToShallowProperties(
    { type: "object" },
    OUTPUT_REDUCED_ANNOTATION,
  );
  return {
    schema:
      serializedBytes(minimal) <= budgetBytes ? minimal : jsonValueSchema(),
    presentation: "reduced",
  };
};

/** Return the JSON schema clients receive for the selected output presentation. */
export const presentAdvertisedOutputSchema = (
  schema: Record<string, unknown>,
  compactPresentation: CompactOutputSchemaPresentation | undefined,
): Record<string, unknown> =>
  compactPresentation === undefined
    ? schema
    : compactAdvertisedOutputSchema(schema, compactPresentation.budgetBytes)
        .schema;
