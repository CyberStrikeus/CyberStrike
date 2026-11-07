import { z } from "zod";

import {
  JAVASCRIPT_SEMANTIC_NODE_KINDS,
  JAVASCRIPT_SEMANTIC_RELATIONS,
  javaScriptSemanticNodeSchema,
  javaScriptSemanticRelationSchema,
  javaScriptSemanticEvidenceContextSchema,
  javaScriptSemanticUnknownSchema,
} from "./javascriptSemanticGraphSchemas.js";
import { digestSchema, prefixedDigestSchema } from "../digests.js";

const semanticNodeIdSchema = prefixedDigestSchema("jsrg_node");
const literalValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const literalSeedSchema = z.strictObject({
  kind: z.literal("literal"),
  value: literalValueSchema,
});

/** Authenticated starting points accepted by semantic tracing. */
export const javaScriptSemanticQuerySeedSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("semantic-node"),
    node_id: semanticNodeIdSchema,
  }),
  z.strictObject({
    kind: z.literal("application-node"),
    node_id: prefixedDigestSchema("jag_node"),
  }),
  literalSeedSchema,
  z.strictObject({
    kind: z.literal("function"),
    fingerprint_sha256: digestSchema,
  }),
  z.strictObject({
    kind: z.literal("property"),
    name: z.string(),
  }),
  z.strictObject({
    kind: z.literal("endpoint"),
    value: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("event"),
    name: z.string(),
  }),
  z.strictObject({
    kind: z.literal("boundary-field"),
    field: z.string().min(1),
  }),
]);

/** Parsed pure-domain query over one authenticated companion graph. */
export const javaScriptSemanticQueryInputSchema = z.strictObject({
  seed: javaScriptSemanticQuerySeedSchema,
  direction: z.enum([
    "backward-provenance",
    "forward-influence",
    "callers",
    "ownership",
  ]),
  allowed_relations: z
    .array(z.enum(JAVASCRIPT_SEMANTIC_RELATIONS))
    .min(1)
    .optional(),
  include_ambiguous_dynamic_edges: z.boolean().default(false),
  expected: z
    .strictObject({
      role: z.enum(["source", "sink"]),
      classes: z.array(z.enum(JAVASCRIPT_SEMANTIC_NODE_KINDS)).min(1),
    })
    .nullable()
    .default(null),
});

/** Deterministic semantic trace result. */
export const javaScriptSemanticQueryResultSchema = z.strictObject({
  query_id: prefixedDigestSchema("jsrq"),
  source_graph_id: prefixedDigestSchema("jsrg"),
  seed: javaScriptSemanticQuerySeedSchema,
  direction: javaScriptSemanticQueryInputSchema.shape.direction,
  status: z.enum(["found", "no-match", "ambiguous", "partial", "unsupported"]),
  seed_node_ids: z.array(semanticNodeIdSchema),
  evidence_contexts: z.array(javaScriptSemanticEvidenceContextSchema),
  nodes: z.array(javaScriptSemanticNodeSchema),
  relations: z.array(javaScriptSemanticRelationSchema),
  unknowns: z.array(javaScriptSemanticUnknownSchema),
  expected_match_node_ids: z.array(semanticNodeIdSchema),
  summary: z.strictObject({
    total_seed_matches: z.int().min(0),
    traversed_nodes: z.int().min(0),
    traversed_relations: z.int().min(0),
    traversed_functions: z.int().min(0),
    traversed_modules: z.int().min(0),
    relevant_unknowns: z.int().min(0),
  }),
  coverage: z.strictObject({
    status: z.enum(["complete", "partial", "unavailable"]),
  }),
  limitations: z.array(z.string().min(1)),
});

/** Validated semantic query input. */
export type JavaScriptSemanticQueryInput = z.infer<
  typeof javaScriptSemanticQueryInputSchema
>;
/** Validated semantic query result. */
export type JavaScriptSemanticQueryResult = z.infer<
  typeof javaScriptSemanticQueryResultSchema
>;
