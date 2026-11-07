import { z } from "zod";
import { AnalysisResourceConstraintError } from "../analysisErrorCore.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import { androidResultSchemas } from "../android/androidAnalysis.js";
import {
  androidManifestComponentSchema,
  androidManifestComponentsSchema,
  type AndroidManifestComponent,
} from "../android/androidManifestComponents.js";
import { jsonValueByteLength } from "../jsonValueByteLength.js";
import type { JsonValue } from "../jsonValue.js";
import { err, ok, type Result } from "../result.js";
import { createAnalysisViewResultReader } from "./analysisViewParent.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import { androidViewRequestSchema } from "../android/androidPackageQuery.js";
import {
  assertOwnedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import {
  boundedViewMessages,
  completeWithinViewCoverage,
  pageViewCoverage,
} from "./analysisViewCoverage.js";
import {
  ANALYSIS_VIEW_PAGE_BUDGET_RECOVERY,
  analysisViewInputError,
} from "./analysisViewErrors.js";
import {
  analysisTextPage,
  analysisTextPageItemSchema,
} from "./analysisViewText.js";

export {
  androidViewRequestSchema,
  androidManifestViewRequestSchema,
  androidComponentsViewRequestSchema,
  androidComponentSummaryViewRequestSchema,
} from "../android/androidPackageQuery.js";

const packageSchema = androidResultSchemas.inspect_android_package;
const readReport = createAnalysisViewResultReader(packageSchema);
const PAGE_BYTES = 1024 * 1024;
const DIGEST_BYTES = jsonValueByteLength({ view_digest: "0".repeat(64) }) - 1;
const PROJECTION_BYTES = PAGE_BYTES - DIGEST_BYTES;

/** Legacy package summary preserves its declarations; only manifest text is retained. */
export const androidPackageSummarySchema = packageSchema.extend({
  manifest: packageSchema.shape.manifest.omit({ text: true }).extend({
    text_code_units: z.int().nonnegative(),
    text_included: z.literal(false),
  }),
});

export const androidManifestViewItemSchema = analysisTextPageItemSchema.extend({
  source_status: packageSchema.shape.manifest.shape.status,
  reported_total_bytes: packageSchema.shape.manifest.shape.reported_total_bytes,
});

/** Parent-array ordinal and declaration coverage survive every field selection. */
export const androidComponentViewRowSchema = androidManifestComponentSchema
  .omit({ declaration_coverage: true })
  .partial()
  .extend({
    source_index: z.int().nonnegative(),
    declaration_coverage:
      androidManifestComponentSchema.shape.declaration_coverage,
  });
export const androidComponentViewContextSchema = z.strictObject({
  source_status: androidManifestComponentsSchema.shape.status,
  source_components: z.int().nonnegative(),
});
const booleanCountsSchema = z.strictObject({
  true: z.int().nonnegative(),
  false: z.int().nonnegative(),
  unknown: z.int().nonnegative(),
});
export const androidComponentSummarySchema = z.strictObject({
  matching_components: z.int().nonnegative(),
  by_kind: z.strictObject({
    activity: z.int().nonnegative(),
    "activity-alias": z.int().nonnegative(),
    service: z.int().nonnegative(),
    receiver: z.int().nonnegative(),
    provider: z.int().nonnegative(),
  }),
  exported_declarations: booleanCountsSchema,
  exported_defaults: booleanCountsSchema,
  declaration_coverage: z.strictObject({
    complete: z.int().nonnegative(),
    partial: z.int().nonnegative(),
    unknown: z.int().nonnegative(),
  }),
});

const choose = <T extends object>(
  row: T,
  fields: ReadonlySet<string> | undefined,
): Partial<T> => {
  if (fields === undefined) return { ...row };
  const out: Partial<T> = {};
  for (const key of Object.keys(row) as (keyof T)[])
    if (fields.has(String(key))) out[key] = row[key];
  return out;
};

/** Project authenticated retained facts without reopening the APK or engine. */
export const projectAndroidPackageView = (
  parent: AnalysisViewParent,
  view: AdmittedView,
) => {
  if (view.kind !== "summary" && view.kind !== "android")
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message:
            "Android package Evidence supports summary, manifest and component views.",
        },
      ]),
    );
  assertOwnedView<
    SummaryAnalysisView | z.output<typeof androidViewRequestSchema>
  >(view, "summary", "android");
  if (parent.operation !== "inspect_android_package")
    return err(
      analysisViewInputError([
        {
          path: ["source", "operation"],
          reason: "invalid_value",
          message:
            "Android package views require inspect_android_package Evidence.",
        },
      ]),
    );
  const parsed = readReport(parent);
  if (!parsed.ok) return parsed;
  // The engine digest identifies the JAR, never the authenticated APK subject.
  if (parent.subject == null)
    return err(
      analysisViewInputError([
        {
          path: ["source", "subject"],
          reason: "invalid_value",
          message:
            "Android package views require the recorded APK subject identity.",
        },
      ]),
    );
  const report = parsed.value;
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_android_package" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: {
      path: parent.subject.local_path,
      sha256: parent.subject.digest.sha256,
    },
    limitations: [...parent.limitations],
    unknowns: [
      "APK signatures were not verified; package declarations do not establish authenticity or runtime behavior.",
      ...(report.manifest.status === "partial"
        ? [
            "The decoded manifest is partial; exhausting retained text does not establish complete manifest coverage.",
          ]
        : []),
    ],
  };
  if (view.kind === "summary") {
    const { text, ...manifest } = report.manifest;
    return ok({
      kind: "summary" as const,
      view,
      ...shared,
      summary: {
        ...report,
        manifest: {
          ...manifest,
          text_code_units: text.length,
          text_included: false as const,
        },
      },
      coverage: completeWithinViewCoverage(1, 1),
    });
  }
  if (view.facet === "manifest") {
    const page = analysisTextPage(
      report.manifest.text,
      view.offset,
      view.limit,
      "Manifest",
    );
    if (!page.ok) return page;
    return ok({
      kind: "android" as const,
      view,
      ...shared,
      item: {
        ...page.value.item,
        source_status: report.manifest.status,
        reported_total_bytes: report.manifest.reported_total_bytes,
      },
      coverage: page.value.coverage,
    });
  }

  const rows = report.components.items;
  const context = {
    ...shared,
    source_status: report.components.status,
    source_components: rows.length,
    limitations: boundedViewMessages(
      [...parent.limitations, ...report.components.limitations],
      parent.evidenceId,
      "limitations",
    ),
    unknowns: boundedViewMessages(
      [
        ...shared.unknowns,
        "Components are static declarations. Omitted historical declaration fields remain unknown; exported declarations and SDK defaults are distinct.",
        ...(report.components.status === "complete"
          ? []
          : [
              `Component source coverage is ${report.components.status}; an empty filtered result does not establish absence from the complete manifest.`,
            ]),
      ],
      parent.evidenceId,
      "unknowns",
    ),
  };
  const tooLarge = (): Result<never, AnalysisError> =>
    err(
      new AnalysisResourceConstraintError(
        "inspect_analysis_view",
        "transport",
        "The Android component view exceeds the analysis-view byte budget; select fewer fields or a smaller page. Complete parent Evidence remains retained.",
        {
          parent_evidence_id: parent.evidenceId,
          limit_bytes: PAGE_BYTES,
          facet: view.facet,
        },
        ANALYSIS_VIEW_PAGE_BUDGET_RECOVERY,
      ),
    );
  // Admit caller selections and provenance before building filter indexes or output rows.
  if (
    jsonValueByteLength(
      { ...context, view } as unknown as JsonValue,
      PROJECTION_BYTES,
    ) > PROJECTION_BYTES
  )
    return tooLarge();
  const kinds = view.kinds === undefined ? undefined : new Set(view.kinds);
  const names = view.names === undefined ? undefined : new Set(view.names);
  const actions =
    view.actions === undefined ? undefined : new Set(view.actions);
  const filtered =
    kinds !== undefined ||
    names !== undefined ||
    actions !== undefined ||
    view.exported !== undefined;
  const matches = (row: AndroidManifestComponent): boolean =>
    (kinds === undefined || kinds.has(row.kind)) &&
    (names === undefined ||
      names.has(row.name) ||
      names.has(row.declared_name)) &&
    (actions === undefined ||
      row.actions.some((action) => actions.has(action))) &&
    (view.exported === undefined || row.exported === view.exported);

  if (view.facet === "component-summary") {
    const summary: z.output<typeof androidComponentSummarySchema> = {
      matching_components: 0,
      by_kind: {
        activity: 0,
        "activity-alias": 0,
        service: 0,
        receiver: 0,
        provider: 0,
      },
      exported_declarations: { true: 0, false: 0, unknown: 0 },
      exported_defaults: { true: 0, false: 0, unknown: 0 },
      declaration_coverage: { complete: 0, partial: 0, unknown: 0 },
    };
    for (const row of rows) {
      if (!matches(row)) continue;
      summary.matching_components++;
      summary.by_kind[row.kind]++;
      summary.exported_declarations[
        row.exported === null ? "unknown" : row.exported ? "true" : "false"
      ]++;
      summary.exported_defaults[
        row.exported_default === null
          ? "unknown"
          : row.exported_default
            ? "true"
            : "false"
      ]++;
      summary.declaration_coverage[row.declaration_coverage]++;
    }
    const result = {
      ...context,
      kind: "android" as const,
      facet: "component-summary" as const,
      view,
      summary,
      coverage: completeWithinViewCoverage(rows.length, rows.length),
    };
    return jsonValueByteLength(
      result as unknown as JsonValue,
      PROJECTION_BYTES,
    ) > PROJECTION_BYTES
      ? tooLarge()
      : ok(result);
  }

  const envelope = {
    ...context,
    kind: "android" as const,
    facet: "components" as const,
    view,
    items: [],
    byte_limited: false,
    coverage: {
      status: "complete-within-view",
      examined: Number.MAX_SAFE_INTEGER,
      total: Number.MAX_SAFE_INTEGER,
      next_offset: Number.MAX_SAFE_INTEGER,
      exhausted: false,
    },
  };
  let bytes =
    DIGEST_BYTES +
    jsonValueByteLength(envelope as unknown as JsonValue, PROJECTION_BYTES);
  if (bytes > PAGE_BYTES) return tooLarge();
  const fields =
    view.fields === undefined ? undefined : new Set<string>(view.fields);
  const items: z.output<typeof androidComponentViewRowSchema>[] = [];
  let byte_limited = false;
  let total = filtered ? 0 : rows.length;
  for (
    let source_index = filtered ? 0 : Math.min(view.offset, rows.length);
    source_index < rows.length;
    source_index++
  ) {
    const row = rows[source_index]!;
    if (filtered && !matches(row)) continue;
    const ordinal = filtered ? total++ : source_index;
    if (ordinal < view.offset) continue;
    if (items.length >= view.limit || byte_limited) {
      if (!filtered) break;
      continue;
    }
    const item = {
      source_index,
      ...choose(row, fields),
      declaration_coverage: row.declaration_coverage,
    };
    const added =
      jsonValueByteLength(item as unknown as JsonValue, PAGE_BYTES - bytes) +
      Number(items.length > 0);
    if (bytes + added > PAGE_BYTES) {
      if (items.length === 0) return tooLarge();
      byte_limited = true;
      if (!filtered) break;
      continue;
    }
    bytes += added;
    items.push(item);
  }
  const result = {
    ...context,
    kind: "android" as const,
    facet: "components" as const,
    view,
    items,
    byte_limited,
    coverage: pageViewCoverage(view.offset, items.length, total),
  };
  return jsonValueByteLength(result as unknown as JsonValue, PROJECTION_BYTES) >
    PROJECTION_BYTES
    ? tooLarge()
    : ok(result);
};
