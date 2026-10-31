import { z } from "zod";
import { ROUTE_RULES } from "./webNetworkRouteTemplates.js";

export const apiSurfaceViewSchema = z.strictObject({
  kind: z.literal("api-surface"),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(50),
  include_query_parameter_names: z
    .boolean()
    .optional()
    .describe(
      "Include distinct observed query parameter names and their original record ordinals; names do not establish required parameters or a complete API schema.",
    ),
});
const ruleSchema = z.enum(ROUTE_RULES);
const groupSchema = z.strictObject({
  method: z.string(),
  origin: z.string(),
  path_template: z.string(),
  templated_segments: z.array(
    z.strictObject({
      segment_index: z.int().nonnegative(),
      rule: ruleSchema,
      basis: z.literal("inferred"),
      observed_values: z.array(z.string()),
    }),
  ),
  record_ordinals: z.array(z.int().nonnegative()),
  statuses: z.array(z.number()),
  content_types: z.array(z.string()),
  query_parameter_names: z
    .array(
      z.strictObject({
        name: z.string(),
        record_ordinals: z.array(z.int().nonnegative()),
      }),
    )
    .optional(),
  flags: z.array(
    z.enum(["single-sample", "mixed-statuses", "mixed-content-types"]),
  ),
});
export const apiSurfaceFields = {
  records: z.strictObject({
    examined: z.int().nonnegative(),
    total: z.int().nonnegative(),
    excluded: z.int().nonnegative(),
  }),
  templated_groups: z
    .int()
    .nonnegative()
    .describe(
      "Groups across every page that carry at least one templated segment.",
    ),
  groups: z.array(groupSchema),
  excluded_records: z.array(
    z.strictObject({
      ordinal: z.int().nonnegative(),
      reason: z.enum([
        "url-redacted",
        "url-unparseable",
        "request-unavailable",
        "method-unavailable",
      ]),
    }),
  ),
};
