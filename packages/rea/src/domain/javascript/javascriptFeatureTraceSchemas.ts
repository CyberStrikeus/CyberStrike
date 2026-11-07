import { z } from "zod";

import { evidenceSchema, providerSchema } from "../evidence.js";
import { javascriptApplicationGraphSchema } from "./javascriptApplicationGraph.js";
import { digestSchema, prefixedDigestSchema } from "../digests.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const nodeIdSchema = prefixedDigestSchema("jag_node");
const edgeIdSchema = prefixedDigestSchema("jag_edge");
const boundedTextSchema = z.string().min(1);

/** Matching mode for a literal seed: string seeds default to containment. */
export const featureSeedMatchMode = (seed: {
  readonly kind: string;
  readonly match: "exact" | "contains" | null;
}): "exact" | "contains" =>
  seed.match ?? (seed.kind === "string" ? "contains" : "exact");

const apiSeedSchema = z.union([
  z.strictObject({
    kind: z.literal("api"),
    value: boundedTextSchema,
    match: z.enum(["exact", "contains"]).nullable().default(null),
    case_sensitive: z.boolean().default(false),
  }),
  z.strictObject({
    kind: z.literal("api"),
    value: z.literal(""),
    match: z.literal("exact"),
    case_sensitive: z.boolean().default(false),
  }),
]);

const apiPathSeedSchema = z.union([
  z.strictObject({
    kind: z.literal("api"),
    value: boundedTextSchema,
    match: z.enum(["exact", "contains"]).nullable().default(null),
    case_sensitive: z.boolean().default(false),
    entry_path: z.array(z.string()).min(1),
  }),
  z.strictObject({
    kind: z.literal("api"),
    value: z.literal(""),
    match: z.literal("exact"),
    case_sensitive: z.boolean().default(false),
    entry_path: z.array(z.string()).min(1),
  }),
]);

/**
 * Literal starting point for one application feature trace. An empty value,
 * such as the channel in `ipcMain.handle("")`, must be an explicit exact
 * literal seed: empty containment would select every node.
 */
export const applicationFeatureSeedSchema = z.union([
  z.strictObject({
    kind: z.enum([
      "node-id",
      "route",
      "string",
      "channel",
      "module",
      "native-export",
    ]),
    value: boundedTextSchema,
    match: z.enum(["exact", "contains"]).nullable().default(null),
    case_sensitive: z.boolean().default(false),
  }),
  z.strictObject({
    kind: z.enum(["route", "string", "channel", "module", "native-export"]),
    value: z.literal(""),
    match: z.literal("exact"),
    case_sensitive: z.boolean().default(false),
  }),
  apiSeedSchema,
  apiPathSeedSchema,
]);

/** Check unique native identities before projecting an application trace. */
const validateApplicationTraceIdentities = (
  input: {
    readonly native_observations: readonly { readonly evidence_id: string }[];
  },
  context: z.RefinementCtx,
): void => {
  const ids = input.native_observations.map(({ evidence_id: id }) => id);
  if (new Set(ids).size !== ids.length)
    context.addIssue({
      code: "custom",
      path: ["native_observations"],
      message: "Native observations must be unique",
    });
};

/** Validate native trace identities without capturing their complete Evidence. */
export const applicationTraceIdentitiesSchema = z
  .object({
    native_observations: z.array(z.object({ evidence_id: evidenceIdSchema })),
  })
  .superRefine(validateApplicationTraceIdentities);

/** Evidence-backed application graph and feature seed. */
export const traceApplicationFeatureInputSchema = z
  .strictObject({
    application: evidenceSchema,
    native_observations: z.array(evidenceSchema).default([]),
    seed: applicationFeatureSeedSchema,
    semantic_page: z
      .strictObject({
        offset: z.int().nonnegative().default(0),
        limit: z.int().positive().default(64),
      })
      .optional()
      .describe(
        "Page retained semantic label matches when a string seed has no application match. Defaults to offset 0 and limit 64.",
      ),
    direction: z.enum(["outgoing", "incoming", "both"]).default("both"),
  })
  .superRefine(validateApplicationTraceIdentities);

const seedMatchSchema = z.strictObject({
  node_id: nodeIdSchema,
  kind: z.string().min(1),
  basis: z.enum(["node-id", "label", "identity", "property"]),
  field: z.string().min(1),
});

const tracePathSchema = z.strictObject({
  path_id: prefixedDigestSchema("jatp"),
  start_node_id: nodeIdSchema,
  end_node_id: nodeIdSchema,
  end_kind: z.string().min(1),
  node_ids: z.array(nodeIdSchema).min(1),
  edge_ids: z.array(edgeIdSchema),
  authorities: z.array(z.string().min(1)),
  contains_inference: z.boolean(),
});

const nativeHandoffSchema = z.strictObject({
  native_node_id: nodeIdSchema,
  artifact_sha256: digestSchema,
  artifact_path: z.string().min(1).nullable(),
  export_node_ids: z.array(nodeIdSchema),
  requested_exports: z.array(boundedTextSchema),
  status: z.enum(["evidence-linked", "requires-provider-analysis"]),
  providers: z.array(providerSchema),
  evidence_ids: z.array(evidenceIdSchema),
  recommended_tools: z.array(
    z.enum([
      "open_binary",
      "binary_overview",
      "search_procedures",
      "analyze_function",
      "xrefs",
    ]),
  ),
});

/** Evidence-preserving complete reachable subgraph and native-analysis handoffs. */
export const applicationFeatureTraceResultSchema = z.strictObject({
  trace_id: prefixedDigestSchema("jatr"),
  source_evidence_id: evidenceIdSchema,
  source_graph_id: prefixedDigestSchema("jag"),
  seed: applicationFeatureSeedSchema,
  direction: z.enum(["outgoing", "incoming", "both"]),
  seed_matches: z.array(seedMatchSchema),
  semantic_discovery: z
    .strictObject({
      source_graph_id: prefixedDigestSchema("jsrg"),
      source_coverage: z.enum([
        "complete",
        "partial",
        "unknown",
        "unavailable",
      ]),
      total: z.int().nonnegative(),
      offset: z.int().nonnegative(),
      limit: z.int().positive(),
      next_offset: z.int().nonnegative().nullable(),
      matches: z.array(
        z.strictObject({
          node_id: prefixedDigestSchema("jsrg_node"),
          kind: z.string().min(1),
          trace_seed: z.strictObject({
            kind: z.literal("semantic-node"),
            node_id: prefixedDigestSchema("jsrg_node"),
          }),
        }),
      ),
    })
    .optional()
    .describe(
      "On an unmatched string seed, retained semantic labels and direct string call arguments use the requested match mode and case sensitivity. Use a trace_seed with trace_javascript_semantics; source coverage limits absence claims.",
    ),
  graph: javascriptApplicationGraphSchema.nullable(),
  paths: z.array(tracePathSchema),
  native_handoffs: z.array(nativeHandoffSchema),
  summary: z.strictObject({
    matched_seeds: z.int().min(0),
    traced_nodes: z.int().min(0),
    traced_edges: z.int().min(0),
    terminal_paths: z.int().min(0),
    native_handoffs: z.int().min(0),
    observed_facts: z.int().min(0),
    inferred_facts: z.int().min(0),
    unknown_facts: z.int().min(0),
    unavailable_facts: z.int().min(0),
  }),
  coverage: z.strictObject({
    status: z.enum(["complete-within-source", "partial", "no-match"]),
    source_graph_status: z.enum([
      "complete",
      "partial",
      "unknown",
      "unavailable",
    ]),
    total_seed_matches: z.int().min(0),
  }),
  evidence_links: z.array(evidenceIdSchema).min(1),
  limitations: z.array(boundedTextSchema),
});

export type TraceApplicationFeatureInput = z.infer<
  typeof traceApplicationFeatureInputSchema
>;
export type ApplicationFeatureSeed = z.output<
  typeof applicationFeatureSeedSchema
>;
export type ApplicationFeatureTraceResult = z.infer<
  typeof applicationFeatureTraceResultSchema
>;
