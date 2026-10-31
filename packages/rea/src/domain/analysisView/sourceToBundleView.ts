import { z } from "zod";
import type { JsonValue } from "../jsonValue.js";
import {
  sourceToBundleComparisonResultSchema,
  type SourceToBundleComparisonResult,
} from "../javascript/sourceToBundleComparisonSchemas.js";
import { err, ok } from "../result.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  ownedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import { analysisViewInputError } from "./analysisViewErrors.js";
import { createAnalysisViewResultReader } from "./analysisViewParent.js";
import {
  boundedViewMessages,
  completeWithinViewCoverage,
  pageViewCoverage,
} from "./analysisViewCoverage.js";
import { selectViewRows } from "./selectViewRows.js";

const mapping = sourceToBundleComparisonResultSchema.shape.items.element;
const candidate = mapping.shape.candidates.element;
const identity = mapping
  .pick({ mapping_id: true, source_path: true })
  .extend({ source_index: z.number().int().nonnegative() });
const mappingRow = mapping
  .omit({ candidates: true, current_node_ids: true })
  .extend({
    source_index: identity.shape.source_index,
    candidate_count: z.number().int().nonnegative(),
    mapped_node_count: z.number().int().nonnegative(),
  });
const candidateRow = candidate.extend({
  ...identity.shape,
  candidate_index: z.number().int().nonnegative(),
  mapped: z.boolean(),
});
const page = {
  kind: z.literal("source-to-bundle"),
  source_paths: z.array(z.string()).optional(),
  mapping_ids: z.array(mapping.shape.mapping_id).optional(),
  statuses: z.array(mapping.shape.status).optional(),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().default(64),
};
/** Select completed mapping facts or their candidate relationships without reclassifying a subset. */
export const sourceToBundleViewRequestSchema = z.discriminatedUnion(
  "collection",
  [
    z.strictObject({
      ...page,
      collection: z.literal("mappings"),
      fields: z.array(mappingRow.keyof()).optional(),
    }),
    z.strictObject({
      ...page,
      collection: z.literal("candidates"),
      fields: z.array(candidateRow.keyof()).optional(),
    }),
  ],
);
export const sourceToBundleViewItemsSchema = z.union([
  z.array(
    mappingRow
      .partial()
      .required({ mapping_id: true, source_path: true, source_index: true }),
  ),
  z.array(
    candidateRow.partial().required({
      mapping_id: true,
      source_path: true,
      source_index: true,
      candidate_index: true,
      current_node_id: true,
      mapped: true,
    }),
  ),
]);
export const sourceToBundleViewContextSchema =
  sourceToBundleComparisonResultSchema
    .pick({
      comparison_id: true,
      reference: true,
      application: true,
      scoring: true,
      summary: true,
      evidence_links: true,
    })
    .extend({
      source_coverage: sourceToBundleComparisonResultSchema.shape.coverage,
      unmapped_current_node_count: z.number().int().nonnegative(),
    });

const checkedReport = createAnalysisViewResultReader(
  sourceToBundleComparisonResultSchema,
);
const selected = (values: readonly string[] | undefined) =>
  values === undefined ? undefined : new Set(values);
const columns = (
  row: object,
  fields: readonly string[],
): Record<string, JsonValue> => {
  const source = row as Record<string, JsonValue>;
  return Object.fromEntries(fields.map((field) => [field, source[field]!]));
};

/** Page facts owned by a complete comparison; page exhaustion does not upgrade source coverage. */
export const projectSourceToBundleView = (
  parent: AnalysisViewParent,
  admitted: AdmittedView,
) => {
  const view = ownedView<
    SummaryAnalysisView | z.output<typeof sourceToBundleViewRequestSchema>
  >(admitted, "summary", "source-to-bundle");
  if (view === undefined)
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message:
            "Source-to-bundle comparisons support summary and source-to-bundle pages",
        },
      ]),
    );
  const parsed = checkedReport(parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  const {
    items: _items,
    unmapped_current_node_ids,
    coverage: source_coverage,
    limitations: _limitations,
    ...facts
  } = report;
  const context = {
    ...facts,
    source_coverage,
    unmapped_current_node_count: unmapped_current_node_ids.length,
  };
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "compare_source_to_bundle" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: null,
    limitations: boundedViewMessages(
      [...parent.limitations, ...report.limitations],
      parent.evidenceId,
      "limitations",
    ),
    unknowns: [
      "Candidate correspondence is not behavioral equivalence. Exhausting a selected page does not establish absence outside the examined inputs.",
    ],
  };
  if (view.kind === "summary")
    return ok({
      kind: "summary" as const,
      view,
      ...shared,
      summary: context,
      coverage: completeWithinViewCoverage(1, 1),
    });
  const paths = selected(view.source_paths),
    ids = selected(view.mapping_ids),
    statuses = selected(view.statuses);
  const matches = (row: SourceToBundleComparisonResult["items"][number]) =>
    (paths === undefined || paths.has(row.source_path)) &&
    (ids === undefined || ids.has(row.mapping_id)) &&
    (statuses === undefined || statuses.has(row.status));
  const fields =
    view.fields ??
    (view.collection === "mappings"
      ? [
          "status",
          "confidence",
          "source_sha256",
          "source_language",
          "candidate_count",
          "mapped_node_count",
        ]
      : ["current_node_kind", "score", "confidence"]);
  let items: z.output<typeof sourceToBundleViewItemsSchema>, total: number;
  if (view.collection === "mappings") {
    const page = selectViewRows(
      report.items,
      view,
      matches,
      (row, source_index) => ({
        ...columns(
          {
            ...row,
            source_index,
            candidate_count: row.candidates.length,
            mapped_node_count: row.current_node_ids.length,
          },
          fields,
        ),
        mapping_id: row.mapping_id,
        source_path: row.source_path,
        source_index,
      }),
    );
    items = page.rows;
    total = page.total;
  } else {
    items = [];
    total = 0;
    for (const [source_index, row] of report.items.entries()) {
      if (!matches(row)) continue;
      const start = Math.max(0, view.offset - total);
      const end = Math.min(
        row.candidates.length,
        start + view.limit - items.length,
      );
      if (start < end) {
        const mapped = new Set(row.current_node_ids);
        for (
          let candidate_index = start;
          candidate_index < end;
          candidate_index++
        ) {
          const candidate = row.candidates[candidate_index]!;
          items.push({
            ...columns(candidate, fields),
            mapping_id: row.mapping_id,
            source_path: row.source_path,
            source_index,
            candidate_index,
            current_node_id: candidate.current_node_id,
            mapped: mapped.has(candidate.current_node_id),
          });
        }
      }
      total += row.candidates.length;
    }
  }
  return ok({
    kind: "source-to-bundle" as const,
    view,
    ...shared,
    ...context,
    items,
    coverage: pageViewCoverage(view.offset, items.length, total),
  });
};
