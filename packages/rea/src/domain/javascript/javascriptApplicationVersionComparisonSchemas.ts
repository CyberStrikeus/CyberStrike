import { z } from "zod";

import { emptyArraySchema } from "../emptyArraySchema.js";
import {
  isValidatedImmutableJavaScriptApplicationGraph,
  javascriptApplicationGraphSchema,
  type JavaScriptApplicationGraph,
} from "./javascriptApplicationGraph.js";
import { JAVASCRIPT_APPLICATION_NODE_KINDS } from "./javascriptApplicationGraphSchemas.js";
import { prefixedDigestSchema } from "../digests.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const nodeIdSchema = prefixedDigestSchema("jag_node");
const textSchema = z.string().min(1);

/** Check paired version identities and per-side native identity uniqueness. */
const validateApplicationVersionIdentities = (
  input: {
    readonly left: { readonly evidence_id: string };
    readonly right: { readonly evidence_id: string };
    readonly left_native_observations: readonly {
      readonly evidence_id: string;
    }[];
    readonly right_native_observations: readonly {
      readonly evidence_id: string;
    }[];
  },
  context: z.RefinementCtx,
): void => {
  if (input.left.evidence_id === input.right.evidence_id)
    context.addIssue({
      code: "custom",
      path: ["right"],
      message: "Application version Evidence must be distinct",
    });
  for (const side of [
    "left_native_observations",
    "right_native_observations",
  ] as const) {
    const ids = input[side].map(({ evidence_id: id }) => id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        path: [side],
        message: "Native observations must be unique on each side",
      });
  }
};

const evidenceIdentitySchema = z.object({ evidence_id: evidenceIdSchema });

/** Validate paired version identities without capturing whole analysis graphs. */
export const applicationVersionIdentitiesSchema = z
  .object({
    left: evidenceIdentitySchema,
    right: evidenceIdentitySchema,
    left_native_observations: z.array(evidenceIdentitySchema),
    right_native_observations: z.array(evidenceIdentitySchema),
  })
  .superRefine(validateApplicationVersionIdentities);

const candidateNodesSchema = z
  .tuple([nodeIdSchema], nodeIdSchema)
  .check(z.minLength(1));
const exactMatchSchema = z.strictObject({
  status: z.literal("matched"),
  basis: z.enum([
    "exact-node-identity",
    "exact-content-digest",
    "exact-module-source-digest",
  ]),
  confidence: z.literal("exact"),
  candidate_left_node_ids: emptyArraySchema,
  candidate_right_node_ids: emptyArraySchema,
});
const sourceMapMatchSchema = z.strictObject({
  status: z.literal("matched"),
  basis: z.literal("source-map-identity"),
  confidence: z.literal("high"),
  candidate_left_node_ids: emptyArraySchema,
  candidate_right_node_ids: emptyArraySchema,
});
const inferredMatchSchema = z.strictObject({
  status: z.literal("matched"),
  basis: z.enum(["structural-fingerprint", "semantic-key"]),
  confidence: z.literal("medium"),
  candidate_left_node_ids: emptyArraySchema,
  candidate_right_node_ids: emptyArraySchema,
});
const matchedItemMatchSchema = z.union([
  exactMatchSchema,
  sourceMapMatchSchema,
  inferredMatchSchema,
]);
const unmatchedItemMatchSchema = z.strictObject({
  status: z.literal("unmatched"),
  basis: z.literal("none"),
  confidence: z.literal("unknown"),
  candidate_left_node_ids: emptyArraySchema,
  candidate_right_node_ids: emptyArraySchema,
});
const leftAmbiguousMatchSchema = z.strictObject({
  status: z.literal("ambiguous"),
  basis: z.literal("none"),
  confidence: z.literal("unknown"),
  candidate_left_node_ids: emptyArraySchema,
  candidate_right_node_ids: candidateNodesSchema,
});
const rightAmbiguousMatchSchema = z.strictObject({
  status: z.literal("ambiguous"),
  basis: z.literal("none"),
  confidence: z.literal("unknown"),
  candidate_left_node_ids: candidateNodesSchema,
  candidate_right_node_ids: emptyArraySchema,
});

const comparisonItemContextShape = {
  item_id: prefixedDigestSchema("javc_item"),
  node_kind: z.enum(JAVASCRIPT_APPLICATION_NODE_KINDS),
  dimensions: z.array(
    z.enum([
      "content",
      "location",
      "properties",
      "relationships",
      "availability",
      "coverage",
    ]),
  ),
  evidence_links: z.array(evidenceIdSchema).min(2),
  limitations: z.array(textSchema),
};

const comparisonItemSchema = z.union([
  z.strictObject({
    ...comparisonItemContextShape,
    status: z.enum(["unchanged", "changed", "unknown"]),
    left_node_id: nodeIdSchema,
    right_node_id: nodeIdSchema,
    match: matchedItemMatchSchema,
  }),
  z.strictObject({
    ...comparisonItemContextShape,
    status: z.enum(["removed", "unknown"]),
    left_node_id: nodeIdSchema,
    right_node_id: z.null(),
    match: unmatchedItemMatchSchema,
  }),
  z.strictObject({
    ...comparisonItemContextShape,
    status: z.enum(["added", "unknown"]),
    left_node_id: z.null(),
    right_node_id: nodeIdSchema,
    match: unmatchedItemMatchSchema,
  }),
  z.strictObject({
    ...comparisonItemContextShape,
    status: z.literal("unknown"),
    left_node_id: nodeIdSchema,
    right_node_id: z.null(),
    match: leftAmbiguousMatchSchema,
  }),
  z.strictObject({
    ...comparisonItemContextShape,
    status: z.literal("unknown"),
    left_node_id: z.null(),
    right_node_id: nodeIdSchema,
    match: rightAmbiguousMatchSchema,
  }),
]);

const comparisonCoverageSchema = z.strictObject({
  left_graph_status: z.enum(["complete", "partial", "unknown", "unavailable"]),
  right_graph_status: z.enum(["complete", "partial", "unknown", "unavailable"]),
  left_graph_omitted_count: z.int().min(0).nullable(),
  right_graph_omitted_count: z.int().min(0).nullable(),
  status: z.enum(["complete-within-inputs", "partial", "truncated"]),
});

/** Tiered module/entity matching plus its complete cross-version change graph. */
export const applicationVersionComparisonResultSchema = z
  .strictObject({
    comparison_id: prefixedDigestSchema("javc"),
    left: z.strictObject({
      evidence_id: evidenceIdSchema,
      graph_id: prefixedDigestSchema("jag"),
      root_artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    }),
    right: z.strictObject({
      evidence_id: evidenceIdSchema,
      graph_id: prefixedDigestSchema("jag"),
      root_artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    }),
    summary: z.strictObject({
      unchanged: z.int().min(0),
      added: z.int().min(0),
      removed: z.int().min(0),
      changed: z.int().min(0),
      unknown: z.int().min(0),
    }),
    matching: z.strictObject({
      exact_node_identity: z.int().min(0),
      exact_content_digest: z.int().min(0),
      exact_module_source_digest: z.int().min(0),
      source_map_identity: z.int().min(0),
      structural_fingerprint: z.int().min(0),
      semantic_key: z.int().min(0),
      ambiguous: z.int().min(0),
      unmatched: z.int().min(0),
    }),
    items: z.array(comparisonItemSchema),
    graph: javascriptApplicationGraphSchema,
    coverage: comparisonCoverageSchema,
    evidence_links: z.array(evidenceIdSchema).min(2),
    limitations: z.array(textSchema),
  })
  .superRefine((result, context) => {
    const sourceGraphsComplete =
      result.coverage.left_graph_status === "complete" &&
      result.coverage.right_graph_status === "complete";
    if (
      (result.coverage.status === "complete-within-inputs") !==
      sourceGraphsComplete
    )
      context.addIssue({
        code: "custom",
        path: ["coverage", "status"],
        message: "Comparison coverage must match source graph completeness",
      });
  });

/** Reuse the exact owned change graph while validating the rest of the result. */
export const ownedApplicationVersionComparisonResultSchema =
  applicationVersionComparisonResultSchema.safeExtend({
    graph: z.custom<JavaScriptApplicationGraph>(
      isValidatedImmutableJavaScriptApplicationGraph,
    ),
  });

export type ApplicationVersionComparisonItem = z.infer<
  typeof comparisonItemSchema
>;
export type ApplicationVersionComparisonResult = z.infer<
  typeof applicationVersionComparisonResultSchema
>;
