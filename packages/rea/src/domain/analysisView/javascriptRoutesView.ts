import { javascriptSourceRangeSchema } from "../javascript/javascriptSourceCoordinates.js";
import { z } from "zod";
import { webBundleViewRequestSchema } from "./webBundleView.js";
import { digestSchema } from "../digests.js";
import { isImmutableJsonSnapshot } from "../immutableJson.js";
import { err, ok, type Result } from "../result.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import { AnalysisResourceConstraintError } from "../analysisErrorCore.js";
import type { JsonValue } from "../jsonValue.js";
import { jsonValueByteLength } from "../jsonValueByteLength.js";
import {
  javaScriptRouteInventorySchema,
  javaScriptInventoryRouteSchema,
  javaScriptRouteOccurrenceSchema,
  javaScriptRouteInventorySourceSchema,
  javaScriptRouteGapSchema,
  javaScriptRouteCaptureOmissionSchema,
  type JavaScriptRouteInventory,
  type JavaScriptInventoryRoute,
  type JavaScriptRouteOccurrence,
  type JavaScriptRouteInventorySource,
} from "../javascript/javascriptRouteInventory.js";
import { javaScriptRouteMechanismSchema } from "../javascript/javascriptRouteFacts.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import { assertOwnedView, type AdmittedView } from "./analysisViewShape.js";
import {
  ANALYSIS_VIEW_PAGE_BUDGET_RECOVERY,
  analysisViewInputError,
} from "./analysisViewErrors.js";
import {
  boundedViewMessages,
  completeWithinViewCoverage,
  pageViewCoverage,
} from "./analysisViewCoverage.js";

const identity = { kind: z.literal("javascript-routes") };
const paging = {
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
};
const ids = z.array(z.string()).exactOptional();
export const javaScriptRoutesViewRequestSchema = z.discriminatedUnion(
  "collection",
  [
    z.strictObject({ ...identity, collection: z.literal("summary") }),
    z.strictObject({
      ...identity,
      collection: z.literal("routes"),
      where: z
        .strictObject({
          ids,
          paths: z.array(z.string()).exactOptional(),
          path_prefix: z
            .string()
            .exactOptional()
            .describe("Exact string prefix; no URL/path normalization."),
          classifications: z
            .array(javaScriptInventoryRouteSchema.shape.classification)
            .exactOptional(),
          mechanisms: z.array(javaScriptRouteMechanismSchema).exactOptional(),
          min_confidence:
            javaScriptInventoryRouteSchema.shape.confidence.exactOptional(),
        })
        .default({}),
      fields: z.array(javaScriptInventoryRouteSchema.keyof()).exactOptional(),
      ...paging,
    }),
    z.strictObject({
      ...identity,
      collection: z.literal("occurrences"),
      where: z
        .strictObject({
          ids,
          route_ids: z.array(z.string()).exactOptional(),
          source_ids: z.array(z.string()).exactOptional(),
          mechanisms: z.array(javaScriptRouteMechanismSchema).exactOptional(),
        })
        .default({}),
      fields: z.array(javaScriptRouteOccurrenceSchema.keyof()).exactOptional(),
      ...paging,
    }),
    z.strictObject({
      ...identity,
      collection: z.literal("sources"),
      where: z
        .strictObject({
          ids,
          keys: z.array(z.string()).exactOptional(),
          statuses: z
            .array(javaScriptRouteInventorySourceSchema.shape.status)
            .exactOptional(),
        })
        .default({}),
      fields: z
        .array(javaScriptRouteInventorySourceSchema.keyof())
        .exactOptional(),
      ...paging,
    }),
    z.strictObject({
      ...identity,
      collection: z.literal("unknowns"),
      where: z
        .strictObject({
          ids,
          source_ids: z.array(z.string()).exactOptional(),
          kinds: z.array(javaScriptRouteGapSchema.shape.kind).exactOptional(),
        })
        .default({}),
      fields: z.array(javaScriptRouteGapSchema.keyof()).exactOptional(),
      ...paging,
    }),
  ],
);
/** Select retained delivery explicitly; complete delivery never silently drops facts. */
export const javaScriptRoutesCompleteDeliveryShape = {
  // Optional input participates in discriminator dispatch before its default.
  detail: z.literal("complete").optional().default("complete"),
  view: z.never().exactOptional(),
};
export const javaScriptRoutesSummaryDeliveryShape = {
  detail: z.literal("summary"),
  view: javaScriptRoutesViewRequestSchema.exactOptional(),
};
export const webRoutesSummaryDeliveryShape = {
  detail: z.literal("summary"),
  view: z.union([
    javaScriptRoutesViewRequestSchema,
    webBundleViewRequestSchema,
  ]),
};
export const javaScriptRoutesDeliverySchema = z.discriminatedUnion("detail", [
  z.strictObject(javaScriptRoutesCompleteDeliveryShape),
  z.strictObject(javaScriptRoutesSummaryDeliveryShape),
]);
export const webRoutesDeliverySchema = z.discriminatedUnion("detail", [
  z.strictObject(javaScriptRoutesCompleteDeliveryShape),
  z.strictObject(webRoutesSummaryDeliveryShape),
]);
export const javaScriptRouteProvenanceSchema = z.strictObject({
  source_id: javaScriptRouteInventorySourceSchema.shape.id,
  occurrence_id: javaScriptRouteOccurrenceSchema.shape.id.nullable(),
  source_range: javascriptSourceRangeSchema.nullable(),
  mechanism: javaScriptRouteMechanismSchema.nullable(),
  derivation: javaScriptRouteOccurrenceSchema.shape.derivation.nullable(),
  inferred_base_path: z.string().nullable(),
});
export const javaScriptRoutesViewItemsSchema = z.union([
  z.array(
    javaScriptInventoryRouteSchema
      .partial()
      .required({ id: true })
      .extend({ provenance: javaScriptRouteProvenanceSchema }),
  ),
  z.array(
    javaScriptRouteOccurrenceSchema
      .partial()
      .required({ id: true, route_id: true, source_id: true })
      .extend({ provenance: javaScriptRouteProvenanceSchema }),
  ),
  z.array(
    javaScriptRouteInventorySourceSchema
      .partial()
      .required({ id: true, key: true, sha256: true, status: true }),
  ),
  z.array(
    javaScriptRouteGapSchema
      .partial()
      .required({ id: true, source_id: true, kind: true })
      .extend({ provenance: javaScriptRouteProvenanceSchema.nullable() }),
  ),
]);
export const javaScriptRoutesViewSummarySchema = z.strictObject({
  reported_capture_omissions: z.array(
    z.strictObject({
      id: javaScriptRouteGapSchema.shape.id,
      reason: z.string(),
      ...javaScriptRouteCaptureOmissionSchema.shape,
    }),
  ),
  statistics: javaScriptRouteInventorySchema.shape.statistics,
  gaps: z.int().nonnegative(),
  source_status_counts: z.strictObject({
    complete: z.int().nonnegative(),
    partial: z.int().nonnegative(),
    unavailable: z.int().nonnegative(),
    unknown: z.int().nonnegative(),
  }),
  patterns_by_classification: z.strictObject({
    page: z.int().nonnegative(),
    system: z.int().nonnegative(),
    unknown: z.int().nonnegative(),
  }),
});

type Request = z.output<typeof javaScriptRoutesViewRequestSchema>;
type Gap = z.infer<typeof javaScriptRouteGapSchema>;
interface Table<T extends { id: string }> {
  readonly rows: readonly T[];
  readonly byId: ReadonlyMap<string, { row: T; index: number }>;
}
const table = <T extends { id: string }>(rows: readonly T[]): Table<T> => ({
  rows,
  byId: new Map(rows.map((row, index) => [row.id, { row, index }])),
});
interface Checked {
  readonly inventory: JavaScriptRouteInventory;
  readonly routes: Table<JavaScriptInventoryRoute>;
  readonly occurrences: Table<JavaScriptRouteOccurrence>;
  readonly sources: Table<JavaScriptRouteInventorySource>;
  readonly gaps: Table<Gap>;
  readonly summary: z.infer<typeof javaScriptRoutesViewSummarySchema>;
}
const checkedRoutes = new WeakMap<object, Checked>();
const inputError = (message: string): AnalysisError =>
  analysisViewInputError([
    {
      path: ["source", "normalized_result", "route_inventory"],
      reason: "invalid_value",
      message,
    },
  ]);
const read = (parent: AnalysisViewParent): Result<Checked, AnalysisError> => {
  const raw = parent.normalizedResult;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return err(inputError("Parent result is not an analysis record."));
  const reusable = parent.sealedResult === true && isImmutableJsonSnapshot(raw);
  const retained = reusable ? checkedRoutes.get(raw) : undefined;
  if (retained !== undefined) return ok(retained);
  const value = (raw as Record<string, unknown>).route_inventory;
  if (value === undefined)
    return err(
      inputError(
        "This parent has no measured route inventory; route absence remains unknown.",
      ),
    );
  const parsed = javaScriptRouteInventorySchema.safeParse(value);
  if (!parsed.success)
    return err(
      inputError(
        `Parent route inventory failed validation (${parsed.error.issues.length} issues); the complete source remains in parent Evidence ${parent.evidenceId}.`,
      ),
    );
  const inventory = parsed.data;
  const source_status_counts = {
      complete: 0,
      partial: 0,
      unavailable: 0,
      unknown: 0,
    },
    patterns_by_classification = { page: 0, system: 0, unknown: 0 };
  for (const source of inventory.sources) source_status_counts[source.status]++;
  for (const route of inventory.routes)
    patterns_by_classification[route.classification]++;
  const checked: Checked = {
    inventory,
    routes: table(inventory.routes),
    occurrences: table(inventory.occurrences),
    sources: table(inventory.sources),
    gaps: table(inventory.unknowns),
    summary: {
      reported_capture_omissions: inventory.unknowns.flatMap((gap) =>
        gap.capture_omission === undefined
          ? []
          : [{ id: gap.id, reason: gap.reason, ...gap.capture_omission }],
      ),
      statistics: inventory.statistics,
      gaps: inventory.unknowns.length,
      source_status_counts,
      patterns_by_classification,
    },
  };
  if (reusable) checkedRoutes.set(raw, checked);
  return ok(checked);
};
const candidates = <T extends { id: string }>(
  rows: Table<T>,
  selected: readonly string[] | undefined,
): readonly T[] =>
  selected === undefined
    ? rows.rows
    : [...new Set(selected)]
        .flatMap((id) => {
          const entry = rows.byId.get(id);
          return entry === undefined ? [] : [entry];
        })
        .sort((a, b) => a.index - b.index)
        .map((entry) => entry.row);
const choose = (
  row: Record<string, JsonValue>,
  fields: readonly string[],
): Record<string, JsonValue> =>
  Object.fromEntries(
    [...new Set(fields)]
      .filter((field) => Object.hasOwn(row, field))
      .map((field) => [field, row[field]!]),
  );
const matches = (
  values: ReadonlySet<string> | undefined,
  value: string | null,
): boolean => values === undefined || (value !== null && values.has(value));
const selectedSet = (values: readonly string[] | undefined) =>
  values === undefined ? undefined : new Set(values);
const ranks = { low: 0, medium: 1, high: 2 };
const PAGE_BYTES = 1024 * 1024;
// Sealing appends this field to a nonempty JSON object after projection.
const DIGEST_BYTES = jsonValueByteLength({ view_digest: "0".repeat(64) }) - 1;
const PROJECTION_BYTES = PAGE_BYTES - DIGEST_BYTES;
const appIdentity = z.object({
  input_path: z.string().min(1),
  root_artifact_sha256: digestSchema,
});
const captureIdentity = z.object({
  capture: z.object({ target_url: z.string() }),
});

/** Historical projection: no source file reads, browser connection or reanalysis. */
export const projectJavaScriptRoutesView = (
  parent: AnalysisViewParent,
  selected: AdmittedView,
) => {
  if (selected.kind !== "javascript-routes")
    return err(inputError("Select a javascript-routes view."));
  assertOwnedView<z.output<typeof javaScriptRoutesViewRequestSchema>>(
    selected,
    "javascript-routes",
  );
  const operation = parent.operation;
  if (
    operation !== "analyze_javascript_application" &&
    operation !== "analyze_web_bundle"
  )
    return err(
      inputError(
        "Route views require JavaScript application or captured web-bundle Evidence.",
      ),
    );
  let artifact = parent.artifact ?? null,
    capture_url: string | null = null;
  if (operation === "analyze_javascript_application") {
    const identity = appIdentity.safeParse(parent.normalizedResult);
    if (!identity.success)
      return err(
        inputError(
          "Parent application artifact identity is missing or malformed.",
        ),
      );
    artifact = {
      path: identity.data.input_path,
      sha256: identity.data.root_artifact_sha256,
    };
    const subject = parent.subject;
    if (subject != null && subject.digest.sha256 !== artifact.sha256)
      return err(
        inputError(
          "Parent subject does not match its application artifact identity.",
        ),
      );
  } else {
    const identity = captureIdentity.safeParse(parent.normalizedResult);
    if (!identity.success)
      return err(
        inputError("Parent captured-page identity is missing or malformed."),
      );
    capture_url = identity.data.capture.target_url;
  }
  const parsed = read(parent);
  if (!parsed.ok) return parsed;
  const data = parsed.value,
    inventory = data.inventory,
    view: Request = selected;
  const shared = {
    kind: "javascript-routes" as const,
    view,
    parent_evidence_id: parent.evidenceId,
    parent_operation: operation as
      | "analyze_javascript_application"
      | "analyze_web_bundle",
    parent_digest: parent.evidenceId.slice(3),
    artifact,
    capture_url,
    inventory_id: inventory.inventory_id,
    source_manifest_sha256: inventory.source_manifest_sha256,
    source_coverage: { ...inventory.coverage },
    inventory_capacity:
      inventory.capacity === null ? null : { ...inventory.capacity },
    limitations: boundedViewMessages(
      [...parent.limitations, ...inventory.limitations],
      parent.evidenceId,
      "limitations",
    ),
    unknowns: [
      "The complete application route set, reachability and runtime permissions remain unknown.",
      ...(inventory.coverage.candidate_enumeration === "partial"
        ? [
            "Some source/routing facts are incomplete; inspect sources and unknowns without reanalyzing.",
          ]
        : []),
    ],
  };
  const tooLarge = (): Result<never, AnalysisError> =>
    err(
      new AnalysisResourceConstraintError(
        "inspect_analysis_view",
        "transport",
        "The requested route page cannot fit the analysis-view byte budget; select fewer fields or a smaller selection. The complete parent is retained.",
        {
          parent_evidence_id: parent.evidenceId,
          limit_bytes: PAGE_BYTES,
          collection: view.collection,
        },
        ANALYSIS_VIEW_PAGE_BUDGET_RECOVERY,
      ),
    );
  if (view.collection === "summary") {
    const summary = {
      ...shared,
      items: [],
      sources: [],
      summary: {
        ...data.summary,
        statistics: { ...data.summary.statistics },
        source_status_counts: { ...data.summary.source_status_counts },
        patterns_by_classification: {
          ...data.summary.patterns_by_classification,
        },
      },
      byte_limited: false,
      coverage: completeWithinViewCoverage(
        inventory.routes.length,
        inventory.routes.length,
      ),
    };
    return jsonValueByteLength(summary, PROJECTION_BYTES) > PROJECTION_BYTES
      ? tooLarge()
      : ok(summary);
  }
  const page = view;
  const proof = (
    occurrence: JavaScriptRouteOccurrence,
  ): z.infer<typeof javaScriptRouteProvenanceSchema> => ({
    source_id: occurrence.source_id,
    occurrence_id: occurrence.id,
    source_range: occurrence.source_range,
    mechanism: occurrence.mechanism,
    derivation: occurrence.derivation,
    inferred_base_path: occurrence.inferred_base_path,
  });
  const deliver = <T extends { id: string }>(
    source: Table<T>,
    ids: readonly string[] | undefined,
    predicate: (row: T) => boolean,
    project: (row: T) => {
      item: Record<string, JsonValue>;
      sources: readonly string[];
    },
  ) => {
    const rows = candidates(source, ids).filter(predicate),
      items: Record<string, JsonValue>[] = [],
      refs = new Map<string, JavaScriptRouteInventorySource>();
    // Count the fixed envelope once. Counter widths and status text reserve the
    // largest representation, so growing a page never rescans earlier sources.
    let bytes =
        DIGEST_BYTES +
        jsonValueByteLength(
          {
            ...shared,
            items: [],
            sources: [],
            summary: null,
            byte_limited: false,
            coverage: {
              status: "complete-within-view",
              examined: Number.MAX_SAFE_INTEGER,
              total: Number.MAX_SAFE_INTEGER,
              next_offset: Number.MAX_SAFE_INTEGER,
              exhausted: false,
            },
          },
          PROJECTION_BYTES,
        ),
      byte_limited = false;
    if (bytes > PAGE_BYTES) return tooLarge();
    for (
      let index = page.offset;
      index < rows.length && items.length < page.limit;
      index++
    ) {
      const projected = project(rows[index]!),
        additions: JavaScriptRouteInventorySource[] = [];
      let addedBytes =
        jsonValueByteLength(projected.item, PAGE_BYTES - bytes) +
        (items.length > 0 ? 1 : 0);
      for (const id of new Set(projected.sources)) {
        if (refs.has(id)) continue;
        const entry = data.sources.byId.get(id);
        if (entry !== undefined) {
          addedBytes +=
            jsonValueByteLength(
              entry.row,
              Math.max(0, PAGE_BYTES - bytes - addedBytes),
            ) + (refs.size + additions.length > 0 ? 1 : 0);
          additions.push(entry.row);
        }
      }
      if (bytes + addedBytes > PAGE_BYTES) {
        if (items.length === 0) return tooLarge();
        byte_limited = true;
        break;
      }
      bytes += addedBytes;
      items.push(projected.item);
      for (const row of additions) refs.set(row.id, row);
    }
    const result = {
      ...shared,
      items: javaScriptRoutesViewItemsSchema.parse(items),
      sources: [...refs.values()],
      summary: null,
      byte_limited,
      coverage: pageViewCoverage(page.offset, items.length, rows.length),
    };
    return jsonValueByteLength({ ...result, items }, PROJECTION_BYTES) >
      PROJECTION_BYTES
      ? tooLarge()
      : ok(result);
  };
  if (page.collection === "routes") {
    const where = page.where,
      filters = {
        paths: selectedSet(where.paths),
        classifications: selectedSet(where.classifications),
        mechanisms: selectedSet(where.mechanisms),
      },
      fields = page.fields ?? [
        "path",
        "classification",
        "classification_basis",
        "confidence",
        "mechanisms",
        "occurrence_count",
        "source_count",
      ];
    return deliver(
      data.routes,
      where.ids,
      (row) =>
        matches(filters.paths, row.path) &&
        (where.path_prefix === undefined ||
          row.path.startsWith(where.path_prefix)) &&
        matches(filters.classifications, row.classification) &&
        (where.mechanisms === undefined ||
          row.mechanisms.some((mechanism) =>
            filters.mechanisms!.has(mechanism),
          )) &&
        (where.min_confidence === undefined ||
          ranks[row.confidence] >= ranks[where.min_confidence]),
      (row) => {
        const occurrence = data.occurrences.byId.get(
          row.primary_occurrence_id,
        )!.row;
        return {
          item: {
            ...choose(row, fields),
            id: row.id,
            provenance: proof(occurrence),
          },
          sources: [occurrence.source_id],
        };
      },
    );
  }
  if (page.collection === "occurrences") {
    const where = page.where,
      filters = {
        route_ids: selectedSet(where.route_ids),
        source_ids: selectedSet(where.source_ids),
        mechanisms: selectedSet(where.mechanisms),
      },
      fields = page.fields ?? [
        "mechanism",
        "confidence",
        "derivation",
        "origin",
        "source_range",
        "unprefixed_path",
        "inferred_base_path",
      ];
    return deliver(
      data.occurrences,
      where.ids,
      (row) =>
        matches(filters.route_ids, row.route_id) &&
        matches(filters.source_ids, row.source_id) &&
        matches(filters.mechanisms, row.mechanism),
      (row) => ({
        item: {
          ...choose(row, fields),
          id: row.id,
          route_id: row.route_id,
          source_id: row.source_id,
          provenance: proof(row),
        },
        sources: [row.source_id],
      }),
    );
  }
  if (page.collection === "sources") {
    const where = page.where,
      filters = {
        keys: selectedSet(where.keys),
        statuses: selectedSet(where.statuses),
      },
      fields = page.fields ?? [
        "path",
        "url",
        "container_sha256",
        "reason",
        "base_path",
        "reported_route_capacity",
      ];
    return deliver(
      data.sources,
      where.ids,
      (row) =>
        matches(filters.keys, row.key) && matches(filters.statuses, row.status),
      (row) => ({
        item: {
          ...choose(row, fields),
          id: row.id,
          key: row.key,
          sha256: row.sha256,
          status: row.status,
        },
        sources: [],
      }),
    );
  }
  const where = page.where,
    filters = {
      source_ids: selectedSet(where.source_ids),
      kinds: selectedSet(where.kinds),
    },
    fields = page.fields ?? ["source_range", "reason"];
  return deliver(
    data.gaps,
    where.ids,
    (row) =>
      matches(filters.source_ids, row.source_id) &&
      matches(filters.kinds, row.kind),
    (row) => ({
      item: {
        ...choose(row, fields),
        id: row.id,
        source_id: row.source_id,
        kind: row.kind,
        provenance:
          row.source_id === null
            ? null
            : {
                source_id: row.source_id,
                occurrence_id: null,
                source_range: row.source_range,
                mechanism: null,
                derivation: null,
                inferred_base_path: null,
              },
      },
      sources: row.source_id === null ? [] : [row.source_id],
    }),
  );
};
