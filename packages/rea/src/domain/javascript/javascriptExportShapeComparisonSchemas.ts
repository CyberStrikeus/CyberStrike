import { z } from "zod";

import { javascriptSourceRangeSchema } from "./javascriptSourceCoordinates.js";

import { evidenceSchema } from "../evidence.js";
import { prefixedDigestSchema } from "../digests.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const graphIdSchema = prefixedDigestSchema("jag");
const nodeIdSchema = prefixedDigestSchema("jag_node");
const textSchema = z.string().min(1);
const exportNameSchema = z.string();
const semanticPrimitiveSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

function isJsonPointer(value: string): boolean {
  if (value === "") return true;
  if (!value.startsWith("/")) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "~") continue;
    const escaped = value[index + 1];
    if (escaped !== "0" && escaped !== "1") return false;
    index += 1;
  }
  return true;
}

const jsonPointerSchema = z
  .string()
  .refine(isJsonPointer, "Expected an RFC 6901 JSON Pointer");

/** Check that export-shape comparisons bind distinct source Evidence. */
const validateJavaScriptExportShapeIdentities = (
  input: {
    readonly left: { readonly evidence_id: string };
    readonly right: { readonly evidence_id: string };
  },
  context: z.RefinementCtx,
): void => {
  if (input.left.evidence_id === input.right.evidence_id)
    context.addIssue({
      code: "custom",
      path: ["right"],
      message: "JavaScript export shape Evidence must be distinct",
    });
};

const evidenceIdentitySchema = z.object({ evidence_id: evidenceIdSchema });

/** Validate export-shape identities without capturing complete source graphs. */
export const javaScriptExportShapeIdentitiesSchema = z
  .object({
    left: evidenceIdentitySchema,
    right: evidenceIdentitySchema,
  })
  .superRefine(validateJavaScriptExportShapeIdentities);

/** Two authenticated application graphs and exact export selectors. */
export const compareJavaScriptExportShapesInputSchema = z
  .strictObject({
    left: evidenceSchema,
    right: evidenceSchema,
    left_module_path: textSchema,
    left_export_name: exportNameSchema,
    right_module_path: textSchema,
    right_export_name: exportNameSchema,
  })
  .superRefine(validateJavaScriptExportShapeIdentities);

const projectedReturnFieldShape = {
  path: jsonPointerSchema,
  presence: z.enum(["present", "absent", "unknown-coverage"]),
};
const projectedReturnFieldSchema = z.discriminatedUnion("state", [
  z.strictObject({
    ...projectedReturnFieldShape,
    state: z.literal("literal"),
    value: semanticPrimitiveSchema,
    reason: z.null(),
  }),
  z.strictObject({
    ...projectedReturnFieldShape,
    state: z.literal("union"),
    value: z.array(semanticPrimitiveSchema).min(1),
    reason: z.null(),
  }),
  z.strictObject({
    ...projectedReturnFieldShape,
    state: z.literal("unknown"),
    value: z.null(),
    reason: textSchema,
  }),
]);
export type ProjectedReturnField = z.infer<typeof projectedReturnFieldSchema>;

const projectedPropertyCoverageSchema = z.discriminatedUnion("status", [
  z.strictObject({
    path: jsonPointerSchema,
    status: z.literal("complete"),
    omitted: z.literal(0),
  }),
  z.strictObject({
    path: jsonPointerSchema,
    status: z.literal("partial"),
    omitted: z.union([z.int().positive(), z.null()]),
  }),
]);
export type ProjectedPropertyCoverage = z.infer<
  typeof projectedPropertyCoverageSchema
>;

const projectedReturnShapeSchema = z
  .strictObject({
    source_range: javascriptSourceRangeSchema,
    value_status: z.enum([
      "literal",
      "union",
      "object",
      "array",
      "unknown",
      "ambiguous",
      "cycle",
    ]),
    fields: z.array(projectedReturnFieldSchema),
    property_coverage: z.array(projectedPropertyCoverageSchema),
  })
  .superRefine((shape, context) => {
    const fieldPaths = shape.fields.map(({ path }) => path);
    if (new Set(fieldPaths).size !== fieldPaths.length)
      context.addIssue({
        code: "custom",
        path: ["fields"],
        message: "Projected return field paths must be unique",
      });
    const coveragePaths = shape.property_coverage.map(({ path }) => path);
    if (new Set(coveragePaths).size !== coveragePaths.length)
      context.addIssue({
        code: "custom",
        path: ["property_coverage"],
        message: "Projected property coverage paths must be unique",
      });
  });

/** Strict graph-observation payload produced by static return-shape recovery. */
export const projectedExportReturnShapesSchema = z
  .strictObject({
    semantic_role: z.literal("export-return-shapes"),
    module_path: textSchema,
    exported_name: exportNameSchema,
    callable_id: textSchema,
    callable_kind: z.enum(["function", "class", "method"]),
    static_return_shapes: z.array(projectedReturnShapeSchema),
    return_shape_coverage: z.strictObject({
      status: z.enum(["complete", "partial", "truncated"]),
      retained_return_sites: z.int().min(0),
      omitted_return_sites: z.int().min(0).nullable(),
      omitted_fields: z.int().min(0),
      omitted_property_coverage: z.int().min(0),
      projection_complete: z.boolean(),
    }),
  })
  .superRefine((projection, context) => {
    if (
      projection.return_shape_coverage.retained_return_sites !==
      projection.static_return_shapes.length
    )
      context.addIssue({
        code: "custom",
        path: ["return_shape_coverage", "retained_return_sites"],
        message: "Retained return-site count must match projected shapes",
      });
  });

const exportCandidateSchema = z.strictObject({
  node_id: nodeIdSchema,
  module_path: textSchema,
  export_name: exportNameSchema,
  matches_requested_module: z.boolean(),
  matches_requested_export: z.boolean(),
});

const selectorResultShape = {
  evidence_id: evidenceIdSchema,
  graph_id: graphIdSchema,
  requested_module_path: textSchema,
  requested_export_name: exportNameSchema,
  candidates: z.array(exportCandidateSchema),
  omitted_candidates: z.int().min(0),
};
const selectorResultSchema = z.union([
  z.strictObject({
    ...selectorResultShape,
    status: z.literal("selected"),
    selected_node_id: nodeIdSchema,
  }),
  z.strictObject({
    ...selectorResultShape,
    status: z.enum(["missing", "ambiguous"]),
    selected_node_id: z.null(),
  }),
  z.strictObject({
    ...selectorResultShape,
    status: z.literal("unavailable"),
    selected_node_id: nodeIdSchema.nullable(),
  }),
]);

const valueAvailabilitySchema = z.discriminatedUnion("availability", [
  z.strictObject({ availability: z.literal("absent") }),
  z.strictObject({
    availability: z.literal("literal"),
    value: semanticPrimitiveSchema,
  }),
  z.strictObject({
    availability: z.literal("union"),
    values: z.array(semanticPrimitiveSchema).min(1),
  }),
  z.strictObject({
    availability: z.literal("unknown"),
    reason: textSchema,
  }),
]);

const discriminantSchema = z.strictObject({
  path: jsonPointerSchema,
  value: semanticPrimitiveSchema,
});

const propertyPresenceSchema = z.enum([
  "present",
  "absent",
  "unknown-coverage",
]);

/** One change row; presence is required even when values stay unknown. */
export const javaScriptExportShapeComparisonChangeSchema = z.strictObject({
  change_id: prefixedDigestSchema("jesc_change"),
  status: z.enum(["added", "removed", "changed", "unknown"]),
  path: jsonPointerSchema,
  discriminant: discriminantSchema.nullable(),
  presence: z.strictObject({
    left: propertyPresenceSchema,
    right: propertyPresenceSchema,
  }),
  left: valueAvailabilitySchema,
  right: valueAvailabilitySchema,
  left_source_range: javascriptSourceRangeSchema.nullable(),
  right_source_range: javascriptSourceRangeSchema.nullable(),
  evidence_links: z.array(evidenceIdSchema).length(2),
  limitations: z.array(textSchema),
});

const inventoryPropertyCoverageSchema = z.strictObject({
  path: jsonPointerSchema,
  status: z.enum(["complete", "partial"]),
});

const propertyInventorySchema = z.strictObject({
  side: z.enum(["left", "right"]),
  variant_index: z.int().nonnegative(),
  discriminant: discriminantSchema.nullable(),
  paired: z.boolean(),
  source_range: javascriptSourceRangeSchema,
  properties: z.array(jsonPointerSchema),
  property_coverage: z.array(inventoryPropertyCoverageSchema),
});

/** Static export-return comparison with explicit unknown semantics. */
export const javaScriptExportShapeComparisonResultSchema = z.strictObject({
  comparison_id: prefixedDigestSchema("jesc"),
  left: selectorResultSchema,
  right: selectorResultSchema,
  property_inventories: z.array(propertyInventorySchema),
  summary: z.strictObject({
    added: z.int().min(0),
    removed: z.int().min(0),
    changed: z.int().min(0),
    unknown: z.int().min(0),
  }),
  changes: z.array(javaScriptExportShapeComparisonChangeSchema),
  coverage: z.strictObject({
    status: z.enum(["complete-within-inputs", "partial", "truncated"]),
    left_graph_status: z.enum([
      "complete",
      "partial",
      "unknown",
      "unavailable",
    ]),
    right_graph_status: z.enum([
      "complete",
      "partial",
      "unknown",
      "unavailable",
    ]),
    paired_variants: z.int().min(0),
    unpaired_left_variants: z.int().min(0),
    unpaired_right_variants: z.int().min(0),
    omitted_left_variants: z.int().min(0),
    omitted_right_variants: z.int().min(0),
    left_source_omitted_variants: z.int().min(0).nullable(),
    right_source_omitted_variants: z.int().min(0).nullable(),
    left_omitted_fields: z.int().min(0),
    right_omitted_fields: z.int().min(0),
    left_omitted_property_coverage: z.int().min(0),
    right_omitted_property_coverage: z.int().min(0),
    omitted_candidates: z.int().min(0),
    omitted_changes: z.int().min(0),
  }),
  evidence_links: z.array(evidenceIdSchema).length(2),
  limitations: z.array(textSchema),
});

export type ProjectedExportReturnShapes = z.output<
  typeof projectedExportReturnShapesSchema
>;
export type JavaScriptExportShapeComparisonResult = z.output<
  typeof javaScriptExportShapeComparisonResultSchema
>;
export type JavaScriptExportShapeComparisonChange = z.output<
  typeof javaScriptExportShapeComparisonChangeSchema
>;
export type JavaScriptExportShapePropertyInventory = z.output<
  typeof propertyInventorySchema
>;
