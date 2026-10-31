import { z } from "zod";
import {
  applicationNodeSchema,
  applicationNodeObservationSchema,
  type ApplicationNode,
} from "../javascript/javascriptApplicationGraphSchemas.js";

const propertyKeySchema =
  applicationNodeObservationSchema.shape.properties.keyType;

/** A homogeneous batch over exact retained observation locations and node kinds. */
export const javascriptFactsViewRequestSchema = z.strictObject({
  kind: z.literal("javascript-facts"),
  where: z
    .strictObject({
      paths: z
        .array(z.string())
        .optional()
        .describe(
          "Exact Evidence artifact-path or source-range source strings. Omitted includes unknown locations; [] matches none. No filesystem lookup or path normalization.",
        ),
      kinds: z.array(applicationNodeSchema.shape.kind).optional(),
    })
    .default({}),
  property_keys: z
    .array(propertyKeySchema)
    .describe(
      "Exact retained observation-property names to read; [] requests identities/provenance only. Missing properties remain omitted, distinct from retained null. No cross-observation merging or inferred values.",
    ),
  include_available_property_keys: z
    .boolean()
    .default(false)
    .describe(
      "Opt into original property names for each returned observation, without unselected values. Use with property_keys: [] to discover fields before reading them.",
    ),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().default(64),
});

/** Original identities and provenance, with only caller-selected properties. */
export const javascriptFactRowSchema = applicationNodeSchema
  .pick({ node_id: true, kind: true, identity: true })
  .extend(
    applicationNodeObservationSchema.pick({
      observation_id: true,
      source_map_reference: true,
      properties: true,
      evidence: true,
    }).shape,
  )
  .extend({
    available_property_keys: z.array(propertyKeySchema).exactOptional(),
  });

type FactRequest = z.infer<typeof javascriptFactsViewRequestSchema>;
type FactRow = z.infer<typeof javascriptFactRowSchema>;

const observationPath = (
  observation: ApplicationNode["observations"][number],
): string | null => {
  const { location } = observation.evidence;
  if (!location.available) return null;
  if (location.value.kind === "artifact-path") return location.value.path;
  if (location.value.kind === "source-range") return location.value.source;
  return null;
};

/** One scan, O(page) retained rows; never materialize a whole node or graph. */
export const projectJavaScriptFacts = (
  nodes: readonly ApplicationNode[],
  view: FactRequest,
): { readonly rows: FactRow[]; readonly total: number } => {
  const paths =
    view.where.paths === undefined ? null : new Set(view.where.paths);
  const kinds =
    view.where.kinds === undefined ? null : new Set(view.where.kinds);
  if (paths?.size === 0 || kinds?.size === 0) return { rows: [], total: 0 };
  const keys = [...new Set(view.property_keys)];
  const rows: FactRow[] = [];
  let total = 0;
  for (const node of nodes) {
    if (kinds !== null && !kinds.has(node.kind)) continue;
    for (const observation of node.observations) {
      if (paths !== null) {
        const path = observationPath(observation);
        if (path === null || !paths.has(path)) continue;
      }
      total += 1;
      if (total <= view.offset || rows.length >= view.limit) continue;
      rows.push({
        node_id: node.node_id,
        kind: node.kind,
        identity: node.identity,
        observation_id: observation.observation_id,
        source_map_reference: observation.source_map_reference,
        ...(view.include_available_property_keys
          ? {
              available_property_keys: Object.keys(
                observation.properties,
              ).sort(),
            }
          : {}),
        properties: Object.fromEntries(
          keys.flatMap((key) => {
            const value = observation.properties[key];
            return value !== undefined &&
              Object.hasOwn(observation.properties, key)
              ? [[key, value] as const]
              : [];
          }),
        ),
        evidence: observation.evidence,
      });
    }
  }
  return { rows, total };
};
