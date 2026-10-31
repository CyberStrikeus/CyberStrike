import { z } from "zod";
import { bundleResourceBoundResultSchema } from "./bundleResourceRoot.js";

import { jsonObjectSchema, jsonValueSchema } from "../jsonValue.js";
import { AnalysisOutputError } from "../analysisErrorCore.js";
import {
  artifactInventoryCoverageSchema,
  type ArtifactInventoryCoverage,
} from "../artifactGraph.js";

const RESOURCE_KEY_FIELDS = new Set([
  "image",
  "imageName",
  "image_name",
  "resourceName",
  "resource_name",
  "assetName",
  "asset_name",
  "UIImageName",
  "NSImageName",
  "NSResourceName",
]);

/** Recognized direct scalar resource fields; nested dictionaries are not inferred. */
export const appleResourceKeyFields = (
  attributes: Readonly<Record<string, unknown>>,
): [string, string][] =>
  Object.entries(attributes).filter(
    (entry): entry is [string, string] =>
      RESOURCE_KEY_FIELDS.has(entry[0]) &&
      typeof entry[1] === "string" &&
      entry[1].length > 0,
  );

/** Caller-controlled page bounds for compiled Apple asset metadata. */
export const appleAssetCatalogInputSchema = z.strictObject({
  offset: z.int().min(0).default(0),
  limit: z.int().min(1).max(10_000).default(1_000),
});

const catalogSchema = z.strictObject({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  record_count: z.int().nonnegative(),
});

const recordSchema = z.strictObject({
  catalog_path: z.string().min(1),
  catalog_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  index: z.int().nonnegative(),
  kind: z.enum(["catalog", "rendition"]),
  asset_name: z.string().nullable(),
  rendition_name: z.string().nullable(),
  metadata: jsonObjectSchema,
});

const resourceKeyMatchSchema = z.strictObject({
  source_node_id: z.string().min(1),
  source_path: z.string().min(1),
  source_archive_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  field: z.string().min(1),
  key: z.string().min(1),
  status: z.enum(["matched", "ambiguous", "unmatched"]),
  renditions: z.array(
    z.strictObject({
      catalog_path: z.string().min(1),
      catalog_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      record_index: z.int().nonnegative(),
      rendition_name: z.string().nullable(),
    }),
  ),
});

const analysisCoverageSchema = z.strictObject({
  status: z.enum(["complete", "partial", "unknown"]),
  reason: z.string().nullable(),
});
export type AppleAssetAnalysisCoverage = z.infer<typeof analysisCoverageSchema>;

/** Normalized result returned by asset catalog inspection. */
export const appleAssetCatalogResultSchema = bundleResourceBoundResultSchema(
  z.string().regex(/^[a-f0-9]{64}$/u),
  {
    catalogs: z.array(catalogSchema),
    inventory_coverage: artifactInventoryCoverageSchema,
    catalog_coverage: analysisCoverageSchema.default({
      status: "unknown",
      reason: "catalog_coverage_not_reported",
    }),
    resource_key_coverage: analysisCoverageSchema.default({
      status: "unknown",
      reason: "resource_key_coverage_not_reported",
    }),
    total_records: z.int().nonnegative(),
    offset: z.int().nonnegative(),
    limit: z.int().positive(),
    records: z.array(recordSchema),
    resource_key_matches: z.array(resourceKeyMatchSchema),
    next_offset: z.int().nonnegative().nullable(),
    truncated: z.boolean(),
    limitations: z.array(z.string()),
  },
);

export type AppleAssetCatalogRecord = z.infer<typeof recordSchema>;

/** Parse assetutil JSON records without discarding format-specific metadata. */
export const parseAppleAssetCatalogRecords = (
  value: unknown,
): readonly Readonly<
  Record<string, ReturnType<typeof jsonValueSchema.parse>>
>[] => {
  if (!Array.isArray(value))
    throw new AnalysisOutputError(
      "inspect_asset_catalog",
      "assetutil output must be a JSON array",
    );
  return value.map((record, index) => {
    const parsed = jsonObjectSchema.safeParse(record);
    if (!parsed.success)
      throw new AnalysisOutputError(
        "inspect_asset_catalog",
        `assetutil record ${index} is not a JSON object`,
        { cause: parsed.error },
      );
    return parsed.data;
  });
};

/** Project catalog records and apply stable global pagination. */
export const projectAppleAssetCatalogPage = (input: {
  readonly inventoryCoverage?: ArtifactInventoryCoverage;
  readonly catalogCoverage?: AppleAssetAnalysisCoverage;
  readonly resourceKeyCoverage?: AppleAssetAnalysisCoverage;
  readonly targetSha256: string | null;
  readonly resourceRoot?: import("./bundleResourceRoot.js").BundleResourceRoot;
  readonly catalogs: readonly {
    readonly path: string;
    readonly sha256: string;
    readonly records: readonly Readonly<
      Record<string, ReturnType<typeof jsonValueSchema.parse>>
    >[];
  }[];
  readonly offset: number;
  readonly limit: number;
  readonly resourceReferences?: readonly {
    readonly sourceNodeId: string;
    readonly sourcePath: string;
    readonly sourceArchiveSha256: string;
    readonly field: string;
    readonly key: string;
  }[];
}) => {
  const all = input.catalogs.flatMap((catalog) =>
    catalog.records.map((metadata, index): AppleAssetCatalogRecord => ({
      catalog_path: catalog.path,
      catalog_sha256: catalog.sha256,
      index,
      kind:
        typeof metadata.RenditionName === "string" ||
        typeof metadata.Name === "string"
          ? "rendition"
          : "catalog",
      asset_name: typeof metadata.Name === "string" ? metadata.Name : null,
      rendition_name:
        typeof metadata.RenditionName === "string"
          ? metadata.RenditionName
          : null,
      metadata,
    })),
  );
  const records = all.slice(input.offset, input.offset + input.limit);
  const next = input.offset + records.length;
  const recordsByAssetName = new Map<string, typeof all>();
  for (const record of all) {
    if (record.kind !== "rendition" || record.asset_name === null) continue;
    const matches = recordsByAssetName.get(record.asset_name) ?? [];
    matches.push(record);
    recordsByAssetName.set(record.asset_name, matches);
  }
  const resourceKeyMatches = (input.resourceReferences ?? []).map((source) => {
    const matches = recordsByAssetName.get(source.key) ?? [];
    return {
      source_node_id: source.sourceNodeId,
      source_path: source.sourcePath,
      source_archive_sha256: source.sourceArchiveSha256,
      field: source.field,
      key: source.key,
      status:
        matches.length === 0
          ? ("unmatched" as const)
          : matches.length === 1
            ? ("matched" as const)
            : ("ambiguous" as const),
      renditions: matches.map((record) => ({
        catalog_path: record.catalog_path,
        catalog_sha256: record.catalog_sha256,
        record_index: record.index,
        rendition_name: record.rendition_name,
      })),
    };
  });
  return appleAssetCatalogResultSchema.parse({
    inventory_coverage: input.inventoryCoverage ?? {
      scope: "container-entries",
      status: "unknown",
    },
    catalog_coverage: input.catalogCoverage ?? {
      status: "unknown",
      reason: "catalog_coverage_not_reported",
    },
    resource_key_coverage: input.resourceKeyCoverage ?? {
      status: "unknown",
      reason: "resource_key_coverage_not_reported",
    },
    target_sha256: input.targetSha256,
    ...(input.resourceRoot === undefined
      ? {}
      : { resource_root: input.resourceRoot }),
    catalogs: input.catalogs.map(
      ({ path, sha256, records: catalogRecords }) => ({
        path,
        sha256,
        record_count: catalogRecords.length,
      }),
    ),
    total_records: all.length,
    offset: input.offset,
    limit: input.limit,
    records,
    resource_key_matches: resourceKeyMatches,
    next_offset: next < all.length ? next : null,
    truncated: records.length !== all.length,
    limitations: [
      "Rendition metadata is reported as emitted by the installed assetutil version; private fields and platform-specific interpretations are not normalized.",
      "Asset catalog inspection does not decode or extract rendition image bytes.",
    ],
  });
};
