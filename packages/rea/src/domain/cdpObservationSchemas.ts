import { z } from "zod";
import { webTextArtifactSchema } from "./webContentArtifact.js";

/** Structural DOM facts shared by passive web and Electron observations. */
export const cdpDomNodeSchema = z.object({
  index: z.number().int().min(0),
  parent_index: z.number().int().min(-1),
  node_type: z.number().int().min(0),
  node_name: z.string(),
  node_value_length: z
    .number()
    .int()
    .min(0)
    .describe("Length in the enclosing DOM snapshot's node_value_length_unit."),
  attribute_names: z.array(z.string()),
});

/** Unit applies to every retained node; historical omission remains unknown. */
export const cdpDomSnapshotSchema = z.object({
  total_nodes: z.int().min(0),
  node_value_length_unit: z
    .enum(["utf16-code-units", "utf8-bytes"])
    .describe(
      "Unit for all node_value_length values; absent in historical captures means unknown.",
    )
    .exactOptional(),
  nodes: z.array(cdpDomNodeSchema),
});

/** Captured text or an explicit reason why source is unavailable. */
export const cdpScriptSourceSchema = z.discriminatedUnion("included", [
  z.object({ included: z.literal(false), reason: z.string() }),
  z.object({
    included: z.literal(true),
    artifact: webTextArtifactSchema,
  }),
]);

/** Producer script declarations; unavailable facts remain null. */
export const cdpScriptMetadataSchema = z.object({
  cdp_hash: z
    .string()
    .nullable()
    .describe("Producer-reported script hash; null when unavailable."),
  length: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe("Producer-reported script length; null when unavailable."),
  is_module: z
    .boolean()
    .nullable()
    .describe(
      "Producer-reported module classification; null when unavailable.",
    ),
  language: z.string().nullable(),
});
