import { z } from "zod";
import { overallStatus, summarize } from "./functionComparisonResults.js";
import { canonicalJson } from "./comparisonSemantics.js";
import { evidenceInputSchema } from "./evidenceReference.js";
import { digestSchema, prefixedDigestSchema } from "./../domain/digests.js";
import { nativeAddressSchema } from "./native/nativeAddress.js";

const comparisonStatusSchema = z.enum(["unchanged", "changed", "unknown"]);
export const functionComparisonDimensionNameSchema = z.enum([
  "identity",
  "pseudocode",
  "assembly",
  "comments",
  "calls",
  "references",
  "strings_names",
  "cfg",
]);
const evidenceIdSchema = prefixedDigestSchema("ev");

/** Inputs for explicit function-to-function comparison. */
export const functionComparisonInputSchema = z.strictObject({
  left: evidenceInputSchema,
  right: evidenceInputSchema,
});

const textDeltaSchema = z.object({
  added_lines: z.int().min(0),
  removed_lines: z.int().min(0),
  hunks: z.int().min(0),
});

const functionDimensionContextShape = {
  dimension: functionComparisonDimensionNameSchema,
  left_count: z.int().min(0).nullable(),
  right_count: z.int().min(0).nullable(),
  evidence_links: z.array(evidenceIdSchema).min(2),
  limitations: z.array(z.string()),
};

const functionDimensionSchema = z.union([
  z.object({
    ...functionDimensionContextShape,
    status: z.literal("unchanged"),
    left_digest: digestSchema,
    right_digest: digestSchema,
    text_delta: textDeltaSchema.nullable(),
    conclusion_kind: z.literal("derived_relationship"),
  }),
  z.object({
    ...functionDimensionContextShape,
    status: z.literal("changed"),
    left_digest: digestSchema,
    right_digest: digestSchema,
    text_delta: textDeltaSchema.nullable(),
    conclusion_kind: z.enum(["derived_relationship", "contradiction"]),
  }),
  z.object({
    ...functionDimensionContextShape,
    status: z.literal("unknown"),
    left_digest: z.null(),
    right_digest: z.null(),
    text_delta: z.null(),
    conclusion_kind: z.literal("unresolved_branch"),
  }),
]);

const functionMatchSchema = z.union([
  z.object({
    status: z.literal("matched"),
    method: z.literal("symbol"),
    left_name: z.string(),
    right_name: z.string(),
  }),
  z.object({
    status: z.literal("matched"),
    method: z.literal("same-entry"),
    entry_address: nativeAddressSchema,
    left_name: z.string(),
    right_name: z.string(),
  }),
  z.object({
    status: z.enum(["mismatched", "ambiguous"]),
    method: z.literal("explicit"),
    left_name: z.string(),
    right_name: z.string(),
  }),
]);

/** Deterministic dimension-classified function comparison Evidence payload. */
export const functionComparisonResultSchema = z
  .object({
    status: comparisonStatusSchema,
    function_match: functionMatchSchema,
    left_subject_sha256: digestSchema,
    right_subject_sha256: digestSchema,
    summary: z.object({
      unchanged: z.int().min(0),
      changed: z.int().min(0),
      unknown: z.int().min(0),
    }),
    dimensions: z
      .array(functionDimensionSchema)
      .length(functionComparisonDimensionNameSchema.options.length),
    changes: z.array(functionDimensionSchema),
    limitations: z.array(z.string()),
  })
  .superRefine((result, context) => {
    const dimensions = new Map<DimensionName, FunctionDimension>();
    for (const [index, dimension] of result.dimensions.entries()) {
      if (dimensions.has(dimension.dimension))
        context.addIssue({
          code: "custom",
          path: ["dimensions", index, "dimension"],
          message: "Function comparison dimensions must occur exactly once.",
        });
      dimensions.set(dimension.dimension, dimension);
    }
    const expectedSummary = summarize(result.dimensions);
    for (const status of comparisonStatusSchema.options)
      if (result.summary[status] !== expectedSummary[status])
        context.addIssue({
          code: "custom",
          path: ["summary", status],
          message: "Function comparison summary must count its dimensions.",
        });
    const changes = new Set<DimensionName>();
    for (const [index, change] of result.changes.entries()) {
      const dimension = dimensions.get(change.dimension);
      if (
        changes.has(change.dimension) ||
        dimension === undefined ||
        change.status === "unchanged" ||
        canonicalJson(change) !== canonicalJson(dimension)
      )
        context.addIssue({
          code: "custom",
          path: ["changes", index],
          message:
            "Function comparison changes must cite each changed or unknown dimension exactly as recorded.",
        });
      changes.add(change.dimension);
    }
    if (
      result.dimensions.some(
        ({ dimension, status }) =>
          status !== "unchanged" && !changes.has(dimension),
      )
    )
      context.addIssue({
        code: "custom",
        path: ["changes"],
        message:
          "Function comparison changes must include every changed or unknown dimension.",
      });
    if (
      result.status !==
      overallStatus(result.dimensions, result.function_match.status)
    )
      context.addIssue({
        code: "custom",
        path: ["status"],
        message:
          "Function comparison status contradicts its dimensions or function match.",
      });
  });

export type FunctionComparisonResult = z.infer<
  typeof functionComparisonResultSchema
>;
export type FunctionDimension = z.infer<typeof functionDimensionSchema>;
export type DimensionName = z.infer<
  typeof functionComparisonDimensionNameSchema
>;
