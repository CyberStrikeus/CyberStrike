import {
  artifactGraphManifestSchema,
  artifactInventoryCoverageSchema,
  artifactNodeSchema,
  artifactOccurrenceSchema,
  artifactEdgeSchema,
  integrityContradictionSchema,
} from "../artifactGraph.js";
import { artifactInspectionResultSchema } from "../artifactInspection.js";
import {
  artifactFormatMetadataSchema,
  type ArtifactFormatMetadata,
} from "../artifactFormatMetadata.js";
import { prefixedDigestSchema } from "../digests.js";
import type { ArtifactOccurrence } from "../artifactGraph.js";
import { isImmutableJsonSnapshot } from "../immutableJson.js";
import { z } from "zod";
import { AnalysisInputError } from "../analysisErrorCore.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import { uniqueSorted } from "../canonicalOrdering.js";
import { err, ok, type Result } from "../result.js";
import {
  validateArtifactInventorySubject,
  parseArtifactInspectionInventoryResult,
  parseArtifactInventoryResult,
  ArtifactInventoryValidationError,
  type InventorySet,
} from "../artifactInventoryEvidence.js";
import type { ArtifactInspectionResult } from "../artifactInspection.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  assertOwnedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import {
  completeWithinViewCoverage,
  pageViewCoverage,
} from "./analysisViewCoverage.js";
import { analysisViewResultInputError } from "./analysisViewParent.js";
import { ARTIFACT_INVENTORY_VIEW_CAVEATS } from "./artifactInventoryViewCaveats.js";
import {
  espFlashImageSummaryMetadataSchema,
  summaryRootMetadata,
} from "./espFlashImageSummary.js";

const page = {
  kind: z.literal("inventory"),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().default(64),
};

/** Exact selection intersects filters; record identities always survive projection. */
export const artifactInventoryViewRequestSchema = z.discriminatedUnion(
  "collection",
  [
    z.strictObject({
      ...page,
      collection: z.literal("occurrences"),
      occurrence_ids: z.array(prefixedDigestSchema("occ")).optional(),
      logical_paths: z.array(z.string()).optional(),
      entry_kinds: z
        .array(artifactOccurrenceSchema.shape.entry_kind)
        .optional(),
      fields: z.array(artifactOccurrenceSchema.keyof()).optional(),
    }),
    z.strictObject({
      ...page,
      collection: z.literal("nodes"),
      artifact_ids: z.array(prefixedDigestSchema("art")).optional(),
      fields: z.array(artifactNodeSchema.keyof()).optional(),
    }),
    z.strictObject({
      ...page,
      collection: z.enum(["edges", "integrity_contradictions"]),
    }),
  ],
);
export const artifactInventoryItemsSchema = z.array(
  z.union([
    artifactNodeSchema.partial().required({ artifact_id: true }).strict(),
    artifactOccurrenceSchema
      .partial()
      .required({
        occurrence_id: true,
        artifact_id: true,
        parent_occurrence_id: true,
      })
      .strict(),
    artifactEdgeSchema,
    integrityContradictionSchema,
  ]),
);

export const artifactInventorySummarySchema = z.strictObject({
  source_coverage: artifactInventoryCoverageSchema.exactOptional(),
  available_hash_status_counts: z
    .strictObject({
      verified: z.number().int().nonnegative(),
      mismatched: z.number().int().nonnegative(),
      unavailable: z.number().int().nonnegative(),
      "not-hashed": z.number().int().nonnegative(),
    })
    .exactOptional(),
  manifest: artifactGraphManifestSchema,
  /** An ESP flash layout's nested images appear as summaries here. */
  root_format_metadata: z
    .union([artifactFormatMetadataSchema, espFlashImageSummaryMetadataSchema])
    .exactOptional(),
  available_counts: z.strictObject({
    nodes: z.number().int().nonnegative(),
    occurrences: z.number().int().nonnegative(),
    edges: z.number().int().nonnegative(),
    integrity_contradictions: z.number().int().nonnegative(),
  }),
  observed_entry_kind_counts: z.strictObject({
    file: z.number().int().nonnegative(),
    directory: z.number().int().nonnegative(),
    symlink: z.number().int().nonnegative(),
    slice: z.number().int().nonnegative(),
    metadata: z.number().int().nonnegative().exactOptional(),
  }),
  source_complete: z.boolean(),
  inventory_evidence_ids: z.array(prefixedDigestSchema("ev")).min(1),
  inspection: z
    .strictObject({
      coverage: artifactInspectionResultSchema.shape.coverage,
      unexplored_branches:
        artifactInspectionResultSchema.shape.unexplored_branches,
    })
    .nullable(),
  limitation_count: z.number().int().nonnegative(),
});

const inputError = (
  field: "source" | "view",
  message: string,
): AnalysisInputError =>
  new AnalysisInputError("inspect_analysis_view", undefined, [
    {
      path: [field],
      reason: "invalid_value",
      message,
    },
  ]);

interface InventoryCounts {
  readonly kinds: Readonly<Record<ArtifactOccurrence["entry_kind"], number>>;
  readonly hashes: Readonly<Record<ArtifactOccurrence["hash_status"], number>>;
}

interface InventorySource {
  readonly inventory: InventorySet;
  readonly evidenceIds: readonly string[];
  readonly inspection: ArtifactInspectionResult | null;
  rootMetadata?: ArtifactFormatMetadata | null;
  nodeIndex?: ReadonlyMap<string, number>;
  index?: {
    byId: ReadonlyMap<string, number>;
    byPath: ReadonlyMap<string, readonly number[]>;
    byKind: ReadonlyMap<ArtifactOccurrence["entry_kind"], readonly number[]>;
  };
  counts?: InventoryCounts;
}

/** Reuse the owning inventory integrity/completeness parser for both carriers. */
const checkedSources = new WeakMap<
  object,
  { readonly operation: string; readonly source: InventorySource }
>();

const parseSource = (
  parent: AnalysisViewParent,
): Result<InventorySource, AnalysisError> => {
  const key = parent.normalizedResult;
  const reusable =
    parent.sealedResult === true &&
    typeof key === "object" &&
    key !== null &&
    isImmutableJsonSnapshot(key);
  const cached = reusable ? checkedSources.get(key) : undefined;
  if (cached !== undefined && cached.operation === parent.operation) {
    try {
      validateArtifactInventorySubject(
        parent.subject ?? null,
        cached.source.inventory.manifest,
      );
    } catch (cause: unknown) {
      return sourceFailure(parent.normalizedResult, cause);
    }
    return ok(cached.source);
  }
  const parsed = parseSourceUncached(parent);
  if (parsed.ok && reusable)
    checkedSources.set(key, {
      operation: parent.operation,
      source: parsed.value,
    });
  return parsed;
};

const parseSourceUncached = (
  parent: AnalysisViewParent,
): Result<InventorySource, AnalysisError> => {
  try {
    if (parent.operation === "inventory_artifact")
      return ok({
        inventory: parseArtifactInventoryResult(
          parent.normalizedResult,
          parent.subject ?? null,
        ),
        evidenceIds: [],
        inspection: null,
      });
    const parsed = parseArtifactInspectionInventoryResult(
      parent.normalizedResult,
      parent.subject ?? null,
    );
    return ok({
      inventory: parsed.inventory,
      evidenceIds: parsed.evidenceIds,
      inspection: parsed.inspection,
    });
  } catch (cause: unknown) {
    return sourceFailure(parent.normalizedResult, cause);
  }
};

const sourceFailure = (
  input: unknown,
  cause: unknown,
): Result<never, AnalysisError> => {
  if (cause instanceof z.ZodError)
    return err(analysisViewResultInputError(input, cause));
  if (!(cause instanceof ArtifactInventoryValidationError)) throw cause;
  return err(inputError("source", cause.message));
};

/** Project exact source records; exhausted pages cover available records, not runtime behavior. */
export const projectArtifactInventoryView = (
  parent: AnalysisViewParent,
  view: AdmittedView,
) => {
  const operation = parent.operation;
  if (operation !== "inventory_artifact" && operation !== "inspect_artifact")
    return err(
      inputError(
        "source",
        "Inventory views require inventory_artifact or inspect_artifact Evidence.",
      ),
    );
  if (view.kind !== "summary" && view.kind !== "inventory")
    return err(
      inputError(
        "view",
        "Artifact Evidence supports summary and inventory views.",
      ),
    );
  assertOwnedView<
    SummaryAnalysisView | z.output<typeof artifactInventoryViewRequestSchema>
  >(view, "summary", "inventory");
  const parsed = parseSource(parent);
  if (!parsed.ok) return parsed;
  const source = parsed.value;
  const { inventory, inspection } = source;
  const evidenceIds =
    inspection === null ? [parent.evidenceId] : source.evidenceIds;
  if (source.rootMetadata === undefined)
    source.rootMetadata =
      inventory.occurrences.find((row) => row.logical_path === ".")
        ?.format_metadata ?? null;
  const rootMetadata = source.rootMetadata;
  // Producer traversal coverage is the owner's fact for every format; missing
  // coverage would read as unknown, so every view carries it inline.
  const sourceCoverage = { source_coverage: inventory.coverage };
  const includeHashCounts =
    view.kind === "inventory" ||
    inventory.manifest.root_format === "godot-pck" ||
    inventory.manifest.root_format === "unityfs" ||
    inventory.manifest.root_format === "pyinstaller" ||
    inventory.manifest.root_format === "node-sea" ||
    inventory.manifest.root_format === "intel-hex" ||
    inventory.manifest.root_format === "srec" ||
    inventory.manifest.root_format === "esp-image" ||
    inventory.manifest.root_format === "uf2" ||
    inventory.manifest.root_format === "dfuse" ||
    inventory.manifest.root_format === "esp-flash-image" ||
    inventory.manifest.root_format === "fit";
  const counts = inventoryCounts(source);
  const limitations = uniqueSorted([
    ...parent.limitations,
    ...inventory.limitations,
    ...(inspection?.limitations ?? []),
  ]);
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: operation,
    parent_digest: parent.evidenceId.slice(3),
    artifact: {
      path: parent.artifact?.path ?? "",
      sha256: inventory.manifest.root_sha256,
    },
    limitations,
    unknowns: [
      "Inventory does not establish application runtime behavior or complete format-specific analysis.",
      ...(inventory.coverage.status === "unknown"
        ? [ARTIFACT_INVENTORY_VIEW_CAVEATS.unknownTraversal]
        : []),
      ...(counts.hashes.unavailable > 0 || counts.hashes["not-hashed"] > 0
        ? [ARTIFACT_INVENTORY_VIEW_CAVEATS.unknownContentHashes]
        : []),
      ...(inventory.complete
        ? []
        : [
            "Parent inventory is partial; counts and exhausted pages cover only available records. Missing matches do not establish absence.",
          ]),
    ],
  } satisfies {
    parent_evidence_id: string;
    parent_operation: "inspect_artifact" | "inventory_artifact";
    parent_digest: string;
    artifact: { path: string; sha256: string };
    limitations: readonly string[];
    unknowns: readonly string[];
  };
  if (view.kind === "summary") {
    const examined =
      inventory.nodes.length +
      inventory.occurrences.length +
      inventory.edges.length;
    return ok({
      kind: "summary" as const,
      view,
      summary: {
        manifest: inventory.manifest,
        available_counts: {
          nodes: inventory.nodes.length,
          occurrences: inventory.occurrences.length,
          edges: inventory.edges.length,
          integrity_contradictions: inventory.integrityContradictions.length,
        },
        observed_entry_kind_counts: {
          file: counts.kinds.file,
          directory: counts.kinds.directory,
          symlink: counts.kinds.symlink,
          slice: counts.kinds.slice,
          ...(counts.kinds.metadata === 0
            ? {}
            : { metadata: counts.kinds.metadata }),
        },
        ...(includeHashCounts
          ? { available_hash_status_counts: counts.hashes }
          : {}),
        source_complete: inventory.complete,
        ...sourceCoverage,
        inventory_evidence_ids: [...evidenceIds],
        ...(rootMetadata === null
          ? {}
          : { root_format_metadata: summaryRootMetadata(rootMetadata) }),
        inspection:
          inspection === null
            ? null
            : {
                coverage: inspection.coverage,
                unexplored_branches: inspection.unexplored_branches,
              },
        limitation_count: limitations.length,
      },
      coverage: completeWithinViewCoverage(examined, examined),
      ...shared,
    });
  }
  const selected =
    view.collection === "occurrences"
      ? occurrencePage(source, view)
      : view.collection === "nodes"
        ? nodePage(source, view)
        : {
            items: (view.collection === "edges"
              ? inventory.edges
              : inventory.integrityContradictions
            ).slice(view.offset, view.offset + view.limit),
            total:
              view.collection === "edges"
                ? inventory.edges.length
                : inventory.integrityContradictions.length,
          };
  return ok({
    kind: "inventory" as const,
    view,
    manifest: inventory.manifest,
    inventory_evidence_ids: [...evidenceIds],
    source_complete: inventory.complete,
    ...sourceCoverage,
    items: selected.items,
    coverage: pageViewCoverage(
      view.offset,
      selected.items.length,
      selected.total,
    ),
    ...shared,
  });
};

const occurrencePage = (source: InventorySource, view: OccurrenceView) => {
  const indices = occurrenceIndices(source, view);
  const rows = source.inventory.occurrences;
  const total = indices?.length ?? rows.length;
  const items = [];
  for (
    let at = view.offset;
    at < Math.min(total, view.offset + view.limit);
    at++
  )
    items.push(selectOccurrenceFields(rows[indices?.[at] ?? at]!, view.fields));
  return { items, total };
};

const nodePage = (
  source: InventorySource,
  view: Extract<
    z.output<typeof artifactInventoryViewRequestSchema>,
    { kind: "inventory"; collection: "nodes" }
  >,
) => {
  const indices = nodeIndices(source, view.artifact_ids);
  const rows = source.inventory.nodes;
  const total = indices?.length ?? rows.length;
  const items = [];
  for (
    let at = view.offset;
    at < Math.min(total, view.offset + view.limit);
    at++
  ) {
    const row = rows[indices?.[at] ?? at]!;
    items.push(
      view.fields === undefined
        ? row
        : { ...selectFields(row, view.fields), artifact_id: row.artifact_id },
    );
  }
  return { items, total };
};

const inventoryCounts = (source: InventorySource): InventoryCounts => {
  if (source.counts !== undefined) return source.counts;
  const kinds = { file: 0, directory: 0, symlink: 0, slice: 0, metadata: 0 };
  const hashes = {
    verified: 0,
    mismatched: 0,
    unavailable: 0,
    "not-hashed": 0,
  };
  for (const occurrence of source.inventory.occurrences) {
    kinds[occurrence.entry_kind]++;
    if (occurrence.entry_kind === "file" || occurrence.entry_kind === "slice")
      hashes[occurrence.hash_status]++;
  }
  source.counts = Object.freeze({
    kinds: Object.freeze(kinds),
    hashes: Object.freeze(hashes),
  });
  return source.counts;
};

type OccurrenceView = Extract<
  z.output<typeof artifactInventoryViewRequestSchema>,
  { kind: "inventory"; collection: "occurrences" }
>;

/** Index authenticated facts only when an exact lookup is requested. */
const occurrenceIndices = (
  source: InventorySource,
  view: OccurrenceView,
): number[] | undefined => {
  if (
    view.occurrence_ids === undefined &&
    view.logical_paths === undefined &&
    view.entry_kinds === undefined
  )
    return undefined;
  if (
    view.occurrence_ids?.length === 0 ||
    view.logical_paths?.length === 0 ||
    view.entry_kinds?.length === 0
  )
    return [];
  if (source.index === undefined) {
    const byId = new Map<string, number>();
    const byPath = new Map<string, number[]>();
    const byKind = new Map<ArtifactOccurrence["entry_kind"], number[]>();
    for (const [index, row] of source.inventory.occurrences.entries()) {
      byId.set(row.occurrence_id, index);
      const existing = byPath.get(row.logical_path);
      if (existing === undefined) byPath.set(row.logical_path, [index]);
      else existing.push(index);
      const kind = byKind.get(row.entry_kind);
      if (kind === undefined) byKind.set(row.entry_kind, [index]);
      else kind.push(index);
    }
    source.index = { byId, byPath, byKind };
  }
  const lookup = source.index;
  const paths =
    view.logical_paths === undefined ? undefined : new Set(view.logical_paths);
  const selected =
    view.occurrence_ids === undefined
      ? paths === undefined
        ? [...new Set(view.entry_kinds)].flatMap(
            (kind) => lookup.byKind.get(kind) ?? [],
          )
        : [...paths].flatMap((path) => lookup.byPath.get(path) ?? [])
      : [...new Set(view.occurrence_ids)].flatMap((id) => {
          const index = lookup.byId.get(id);
          return index === undefined ||
            (paths !== undefined &&
              !paths.has(source.inventory.occurrences[index]!.logical_path))
            ? []
            : [index];
        });
  const kinds =
    view.entry_kinds === undefined ? undefined : new Set(view.entry_kinds);
  return selected
    .filter(
      (index) =>
        kinds === undefined ||
        kinds.has(source.inventory.occurrences[index]!.entry_kind),
    )
    .sort((left, right) => left - right);
};

const nodeIndices = (
  source: InventorySource,
  ids: string[] | undefined,
): number[] | undefined => {
  if (ids === undefined) return undefined;
  if (ids.length === 0) return [];
  const byId = (source.nodeIndex ??= new Map(
    source.inventory.nodes.map((row, index) => [row.artifact_id, index]),
  ));
  return [...new Set(ids)]
    .flatMap((id) => {
      const index = byId.get(id);
      return index === undefined ? [] : [index];
    })
    .sort((left, right) => left - right);
};

const selectFields = <Row extends object>(
  row: Row,
  fields: (keyof Row)[] | undefined,
): Partial<Row> => {
  if (fields === undefined) return row;
  const selected: Partial<Row> = {};
  for (const field of fields) {
    const value = row[field];
    if (value !== undefined) selected[field] = value;
  }
  return selected;
};

/** Parent linkage and content identity survive even an explicitly empty field set. */
const selectOccurrenceFields = (
  row: ArtifactOccurrence,
  fields: OccurrenceView["fields"],
) =>
  fields === undefined
    ? row
    : {
        ...selectFields(row, fields),
        occurrence_id: row.occurrence_id,
        artifact_id: row.artifact_id,
        parent_occurrence_id: row.parent_occurrence_id,
      };
