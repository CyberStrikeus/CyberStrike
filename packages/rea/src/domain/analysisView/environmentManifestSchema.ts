import { z } from "zod";
import { jsonRecordSchema } from "../jsonRecord.js";
import { TEMPLATE_RULES } from "./environmentManifestRules.js";
import { ROUTE_RULES } from "./webNetworkRouteTemplates.js";

const manifestRuleSchema = z.enum([...ROUTE_RULES, ...TEMPLATE_RULES]);
const jsonTypeNameSchema = z.enum([
  "string",
  "number",
  "boolean",
  "object",
  "array",
  "null",
]);
const toolSchema = z.strictObject({
  name: z.string(),
  method: z.string(),
  path_template: z.string(),
  api_surface_template: z
    .string()
    .describe("Four-rule template of the tool's earliest record."),
  params: z.array(
    z.strictObject({
      index: z.number().int().nonnegative(),
      name: z.string(),
      rule: manifestRuleSchema,
      basis: z.literal("inferred"),
      observed_values: z.array(z.string()),
    }),
  ),
  query_parameter_names: z.array(z.string()),
  body_shape: z
    .strictObject({
      type: z.literal("object"),
      properties: jsonRecordSchema(jsonTypeNameSchema),
    })
    .nullable(),
  statuses: z.array(z.number()),
  content_types: z.array(z.string()),
  record_ordinals: z.array(z.number().int().nonnegative()),
});
export const environmentManifestFields = {
  origin: z
    .string()
    .describe("Primary origin: the origin with the most JSON-like records."),
  name: z
    .string()
    .describe(
      "Kebab-case environment name derived from the primary origin host.",
    ),
  tools: z.array(toolSchema),
  records: z
    .array(
      z.strictObject({
        ordinal: z.number().int().nonnegative(),
        method: z.string(),
        path: z.string(),
        status: z.number().nullable(),
        content_type: z.string().nullable(),
      }),
    )
    .describe(
      "Pointers to the retained parent records cited by tools; no bodies.",
    ),
  excluded: z.array(
    z.strictObject({
      method: z.string(),
      origin: z.string(),
      path_template: z.string(),
      reason: z.enum(["other-origin", "ui-page-or-asset", "non-json"]),
    }),
  ),
  unknowns: z.array(
    z.strictObject({
      kind: z.enum([
        "authorization-model",
        "response-semantics",
        "state-transition",
      ]),
      statement: z.string(),
    }),
  ),
  templated_groups: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "Tools and excluded groups that carry at least one templated segment.",
    ),
};
