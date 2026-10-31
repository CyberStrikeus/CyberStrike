import { z } from "zod";
import { androidResultSchemas } from "../android/androidAnalysis.js";
import {
  androidJniBindingSchema,
  androidJniCandidateSchema,
  androidJniDeclarationSchema,
  androidJniLibrarySchema,
} from "../android/androidJniBindings.js";
import {
  androidJniViewItemsSchema,
  androidJniViewRequestSchema,
} from "../android/androidJniQuery.js";
import { AnalysisResourceConstraintError } from "../analysisErrorCore.js";
import type { JsonValue } from "../jsonValue.js";
import { jsonValueByteLength } from "../jsonValueByteLength.js";
import { err, ok } from "../result.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  assertOwnedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import {
  ANALYSIS_VIEW_PAGE_BUDGET_RECOVERY,
  analysisViewInputError,
} from "./analysisViewErrors.js";
import { createAnalysisViewResultReader } from "./analysisViewParent.js";
import {
  boundedViewMessages,
  pageViewCoverage,
  analysisViewCoverageSchema,
} from "./analysisViewCoverage.js";
import { selectViewRows } from "./selectViewRows.js";

const reportSchema = androidResultSchemas.inspect_android_jni_bindings;
const readReport = createAnalysisViewResultReader(reportSchema);
/** A bounded relation closure; preview coverage counts selected binding rows only. */
export const androidJniSummarySchema = reportSchema
  .pick({
    engine: true,
    apk: true,
    selection: true,
    native_inventory: true,
    library_inventory: true,
  })
  .extend({
    counts: z.strictObject({
      declarations: z.int().nonnegative(),
      selected_declarations: z.int().nonnegative(),
      libraries: z.int().nonnegative(),
      candidates: z.int().nonnegative(),
      bindings: z.int().nonnegative(),
      matched: z.int().nonnegative(),
      unmatched: z.int().nonnegative(),
      ambiguous: z.int().nonnegative(),
      unknown: z.int().nonnegative(),
    }),
    bindings: z.array(androidJniBindingSchema),
    declarations: z.array(androidJniDeclarationSchema),
    candidates: z.array(androidJniCandidateSchema),
    libraries: z.array(androidJniLibrarySchema),
    selected_declaration_ids: z.array(z.string()),
    declaration_coverage: analysisViewCoverageSchema,
  });

/** Source facts are already parsed; views never reopen the APK or rerun either reader. */
export const projectAndroidJniView = (
  parent: AnalysisViewParent,
  view: AdmittedView,
) => {
  if (
    parent.operation !== "inspect_android_jni_bindings" ||
    (view.kind !== "summary" && view.kind !== "android-jni")
  )
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message:
            "JNI Evidence supports summary or android-jni collection pages.",
        },
      ]),
    );
  assertOwnedView<
    SummaryAnalysisView | z.output<typeof androidJniViewRequestSchema>
  >(view, "summary", "android-jni");
  const parsed = readReport(parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  const shared = {
    parent_operation: "inspect_android_jni_bindings" as const,
    parent_evidence_id: parent.evidenceId,
    parent_digest: parent.evidenceId.slice(3),
    artifact: report.apk,
    limitations: boundedViewMessages(
      parent.limitations,
      parent.evidenceId,
      "limitations",
    ),
    unknowns: boundedViewMessages(
      report.unknowns,
      parent.evidenceId,
      "unknowns",
    ),
  };
  const overBudget = (value: object): boolean =>
    jsonValueByteLength(value as unknown as JsonValue, 1024 * 1024 - 128) >
    1024 * 1024 - 128;
  const budgetError = () =>
    err(
      new AnalysisResourceConstraintError(
        "inspect_analysis_view",
        "transport",
        "JNI view exceeds its 1 MiB serialized allowance.",
        { parent_evidence_id: parent.evidenceId, limit_bytes: 1024 * 1024 },
        ANALYSIS_VIEW_PAGE_BUDGET_RECOVERY,
      ),
    );
  if (view.kind === "summary") {
    const bindings = report.bindings.slice(0, 64);
    const candidateIds = new Set(
      bindings.flatMap((binding) => binding.candidate_ids),
    );
    const candidates = report.candidates.filter((candidate) =>
      candidateIds.has(candidate.candidate_id),
    );
    const declarationIds = new Set([
      ...report.selected_declaration_ids.slice(0, 64),
      ...bindings.map((binding) => binding.declaration_id),
      ...candidates.flatMap((candidate) => candidate.declaration_ids),
    ]);
    const counts = {
      declarations: report.declarations.length,
      selected_declarations: report.selected_declaration_ids.length,
      libraries: report.libraries.length,
      candidates: report.candidates.length,
      bindings: report.bindings.length,
      matched: 0,
      unmatched: 0,
      ambiguous: 0,
      unknown: 0,
    };
    for (const binding of report.bindings) counts[binding.status]++;
    const summary = {
      ...shared,
      kind: "summary" as const,
      view,
      coverage: pageViewCoverage(0, bindings.length, report.bindings.length),
      summary: {
        engine: report.engine,
        apk: report.apk,
        selection: report.selection,
        native_inventory: report.native_inventory,
        library_inventory: report.library_inventory,
        counts,
        bindings,
        candidates,
        declarations: report.declarations.filter((method) =>
          declarationIds.has(method.declaration_id),
        ),
        // Absence, unsupported encoding and read failures have no positive
        // candidate edge. Their selected library provenance is still essential.
        libraries: report.libraries,
        selected_declaration_ids: report.selected_declaration_ids.slice(0, 64),
        declaration_coverage: pageViewCoverage(
          0,
          Math.min(64, report.selected_declaration_ids.length),
          report.selected_declaration_ids.length,
        ),
      },
    };
    if (overBudget(summary)) return budgetError();
    return ok(summary);
  } else {
    const indices =
      view.indices === undefined ? undefined : new Set(view.indices);
    const fields =
      view.fields === undefined ? undefined : new Set<string>(view.fields);
    const project = <Row extends object>(row: Row, index: number) =>
      fields === undefined
        ? { ...row, row_index: index }
        : {
            ...Object.fromEntries(
              Object.entries(row).filter(([key]) => fields.has(key)),
            ),
            row_index: index,
          };
    const pick = <Row extends object>(
      rows: readonly Row[],
      matches: (row: Row) => boolean,
    ) =>
      selectViewRows(
        rows,
        view,
        (row, index) =>
          (indices === undefined || indices.has(index)) && matches(row),
        project,
      );
    const set = (values: readonly string[] | undefined) =>
      values === undefined ? undefined : new Set(values);
    let selected: { rows: object[]; total: number };
    switch (view.collection) {
      case "declarations": {
        const classes = set(view.class_names),
          names = set(view.method_names),
          ids = set(view.declaration_ids),
          descriptors = set(view.descriptors);
        selected = pick(
          report.declarations,
          (row) =>
            (classes === undefined || classes.has(row.class_name)) &&
            (names === undefined || names.has(row.method_name)) &&
            (ids === undefined || ids.has(row.declaration_id)) &&
            (descriptors === undefined || descriptors.has(row.descriptor)),
        );
        break;
      }
      case "libraries": {
        const ids = set(view.library_ids),
          abis = set(view.abis);
        selected = pick(
          report.libraries,
          (row) =>
            (ids === undefined || ids.has(row.library_id)) &&
            (abis === undefined || abis.has(row.abi)),
        );
        break;
      }
      case "candidates": {
        const ids = set(view.declaration_ids),
          libs = set(view.library_ids),
          candidates = set(view.candidate_ids);
        selected = pick(
          report.candidates,
          (row) =>
            (ids === undefined ||
              row.declaration_ids.some((id) => ids.has(id))) &&
            (libs === undefined || libs.has(row.library_id)) &&
            (candidates === undefined || candidates.has(row.candidate_id)),
        );
        break;
      }
      case "bindings": {
        const ids = set(view.declaration_ids),
          abis = set(view.abis),
          statuses = set(view.statuses);
        selected = pick(
          report.bindings,
          (row) =>
            (ids === undefined || ids.has(row.declaration_id)) &&
            (abis === undefined || abis.has(row.abi)) &&
            (statuses === undefined || statuses.has(row.status)),
        );
        break;
      }
    }
    const source = {
      native_inventory: report.native_inventory,
      library_inventory: report.library_inventory,
      selection: report.selection,
    };
    const page = {
      ...shared,
      kind: "android-jni" as const,
      view,
      source,
      items: androidJniViewItemsSchema.parse(selected.rows),
      coverage: pageViewCoverage(
        view.offset,
        selected.rows.length,
        selected.total,
      ),
    };
    if (overBudget(page)) return budgetError();
    return ok(page);
  }
};
