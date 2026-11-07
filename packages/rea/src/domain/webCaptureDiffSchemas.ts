import { z } from "zod";

import { emptyArraySchema } from "./emptyArraySchema.js";
import { webPageInspectionSchema } from "./browserObservationSchemas.js";
import { webMcpDiscoverySchema } from "./webMcpDiscovery.js";

/** One normalized passive page snapshot accepted by capture comparison. */
export const captureSnapshotSchema = z.object({
  inspection: webPageInspectionSchema
    .describe(
      "Complete normalized_result from inspect_web_page, including capture identity, observations, completeness, and limitations.",
    )
    .meta({ "x-rea-complete-observation": true }),
  webmcp: webMcpDiscoverySchema
    .meta({ "x-rea-complete-observation": true })
    .nullable()
    .default(null)
    .describe(
      "Complete normalized_result from discover_webmcp_tools for this capture, or null when it was not recorded.",
    ),
});

/** Input for deterministic comparison of two normalized web captures. */
export const compareWebCapturesInputSchema = z.strictObject({
  before: captureSnapshotSchema,
  after: captureSnapshotSchema,
});

const changeSchema = z.object({
  identity: z.string(),
  change: z.enum(["added", "removed", "modified"]),
});
const emptyDimensionShape = {
  total_changes: z.literal(0),
  changes: emptyArraySchema,
};
const dimensionSchema = z.union([
  z
    .object({
      status: z.literal("changed"),
      total_changes: z.int().min(1),
      changes: z.array(changeSchema),
      reason: z.null(),
    })
    .superRefine((dimension, context) => {
      if (dimension.changes.length !== dimension.total_changes)
        context.addIssue({
          code: "custom",
          message: "Inline changes must equal total changes",
          path: ["total_changes"],
        });
    }),
  z.object({
    ...emptyDimensionShape,
    status: z.literal("unchanged"),
    reason: z.null(),
  }),
  z.object({
    ...emptyDimensionShape,
    status: z.literal("unknown"),
    reason: z.string(),
  }),
]);
/** Completeness-aware changes across stable browser evidence dimensions. */
export const webCaptureDiffSchema = z
  .object({
    overall_status: z.enum(["changed", "unchanged", "unknown"]),
    before_target: z.object({ target_id: z.string(), url: z.string() }),
    after_target: z.object({ target_id: z.string(), url: z.string() }),
    dimensions: z.object({
      dom_structure: dimensionSchema,
      scripts: dimensionSchema,
      resources: dimensionSchema,
      network: dimensionSchema,
      metadata: dimensionSchema,
      webmcp: dimensionSchema,
      accessibility: dimensionSchema,
      storage: dimensionSchema,
    }),
    limitations: z.array(z.string()),
  })
  .superRefine((comparison, context) => {
    const statuses = Object.values(comparison.dimensions).map(
      ({ status }) => status,
    );
    const expected = statuses.includes("changed")
      ? "changed"
      : statuses.includes("unknown")
        ? "unknown"
        : "unchanged";
    if (comparison.overall_status !== expected)
      context.addIssue({
        code: "custom",
        message: "Overall status must summarize dimension statuses",
        path: ["overall_status"],
      });
  });

export type CompareWebCapturesInput = z.infer<
  typeof compareWebCapturesInputSchema
>;
export type WebCaptureDiff = z.infer<typeof webCaptureDiffSchema>;
export type WebCaptureDimension =
  WebCaptureDiff["dimensions"][keyof WebCaptureDiff["dimensions"]];
export type WebCaptureChange = WebCaptureDimension["changes"][number];
