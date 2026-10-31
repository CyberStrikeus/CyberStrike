import { z } from "zod";
import { prefixedDigestSchema } from "../digests.js";
import {
  applicationGraphEvidenceSchema,
  applicationNodeIdentitySchema,
} from "../javascript/javascriptApplicationEvidenceSchemas.js";

const moduleKindSchema = z.enum([
  "javascript-asset",
  "javascript-module",
  "source-module",
]);

/** Exact filters over retained owner facts; paths are not filesystem lookups. */
export const javascriptModuleReferencesRequestSchema = z.strictObject({
  kind: z.literal("javascript"),
  collection: z.literal("modules"),
  projection: z.literal("references"),
  where: z
    .strictObject({
      path: z.string().nullable().optional(),
      kind: moduleKindSchema.optional(),
    })
    .default({}),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
});

/** Unique support states, without promoting mixed observations to one fact. */
const basisSchema = z.strictObject({
  authority: applicationGraphEvidenceSchema.shape.authority,
  state: applicationGraphEvidenceSchema.shape.state,
  confidence: applicationGraphEvidenceSchema.shape.confidence,
});

/** Reusable facts rather than task-specific dependency interpretations. */
export const javascriptModuleReferenceSchema = z.strictObject({
  node_id: prefixedDigestSchema("jag_node"),
  kind: moduleKindSchema,
  path: z.string().nullable(),
  identity: applicationNodeIdentitySchema,
  retained_source_range_count: z.int().nonnegative(),
  basis: z.array(basisSchema).min(1),
});

export type JavaScriptModuleReference = z.infer<
  typeof javascriptModuleReferenceSchema
>;
