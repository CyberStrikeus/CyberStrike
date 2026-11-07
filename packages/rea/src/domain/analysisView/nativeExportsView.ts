import { z } from "zod";
import {
  nativeExportsSchema,
  peNativeExportsSchema as pe,
  elfNativeExportsSchema as elf,
  type NativeExports,
} from "../native/nativeExports.js";
import { err, ok } from "../result.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  assertOwnedView,
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

const peRow = pe.shape.exports.element;
const elfRow = elf.shape.exports.element;
const issue = pe.shape.issues.element;
const sourceIndex = { source_index: z.int().nonnegative() };
const page = {
  kind: z.literal("native-exports"),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
};

/** Exact names preserve all versions/aliases; indices are scoped to the complete parent. */
export const nativeExportsViewRequestSchema = z.discriminatedUnion(
  "collection",
  [
    z.strictObject({
      ...page,
      collection: z.literal("exports"),
      names: z
        .array(z.string())
        .optional()
        .describe(
          "Exact PE names, or UTF-8 ELF source names. ELF display fallbacks and names with unknown encoding are not identities; use indices for those rows. Omitted includes all names; [] matches none.",
        ),
      indices: z.array(z.int().nonnegative()).optional(),
      fields: z.array(z.union([peRow.keyof(), elfRow.keyof()])).optional(),
    }),
    z.strictObject({
      ...page,
      collection: z.literal("issues"),
      indices: z.array(z.int().nonnegative()).optional(),
    }),
  ],
);

export const nativeExportsViewItemsSchema = z.union([
  z.array(peRow.partial().extend(sourceIndex)),
  z.array(
    elfRow.partial().extend({
      ...sourceIndex,
      // Historical defaults normalize complete source rows, never omitted columns.
      name_bytes_base64: elfRow.shape.name_bytes_base64
        .removeDefault()
        .optional(),
      name_utf8_decodable: elfRow.shape.name_utf8_decodable
        .removeDefault()
        .optional(),
    }),
  ),
  z.array(issue.extend(sourceIndex)),
]);

const counts = {
  export_count: z.int().nonnegative(),
  issue_count: z.int().nonnegative(),
  limitation_count: z.int().nonnegative(),
};
/** Source coverage remains distinct from page coverage, including an empty partial page. */
export const nativeExportsSummarySchema = z.discriminatedUnion("format", [
  pe.omit({ exports: true, issues: true, limitations: true }).extend(counts),
  elf.omit({ exports: true, issues: true, limitations: true }).extend(counts),
]);

const readReport = createAnalysisViewResultReader(nativeExportsSchema);

/** Read selected export facts without reopening the artifact or reinterpreting its tables. */
export const projectNativeExportsView = (
  parent: AnalysisViewParent,
  view: AdmittedView,
) => {
  const invalid = (message: string) =>
    err(
      analysisViewInputError([
        { path: ["view"], reason: "invalid_value", message },
      ]),
    );
  if (view.kind !== "summary" && view.kind !== "native-exports")
    return invalid(
      "Native export Evidence supports summary and native-exports views.",
    );
  assertOwnedView<
    SummaryAnalysisView | z.output<typeof nativeExportsViewRequestSchema>
  >(view, "summary", "native-exports");
  const parsed = readReport(parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  const { exports, issues, limitations, ...identity } = report;
  const summary = {
    ...identity,
    export_count: exports.length,
    issue_count: issues.length,
    limitation_count: limitations.length,
  };
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_native_exports" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: { path: report.artifact.path, sha256: report.artifact.sha256 },
    limitations: boundedViewMessages(
      [...parent.limitations, ...limitations],
      parent.evidenceId,
      "limitations",
    ),
    unknowns:
      report.coverage.status === "complete"
        ? []
        : [
            report.coverage.reason ??
              "Export-table coverage is incomplete; no-match pages do not prove absence.",
          ],
  };
  if (view.kind === "summary")
    return ok({
      ...shared,
      kind: "summary" as const,
      view,
      summary,
      coverage: completeWithinViewCoverage(exports.length, exports.length),
    });
  const indices =
    view.indices === undefined ? undefined : new Set(view.indices);
  if (view.collection === "issues") {
    const selected =
      indices === undefined
        ? {
            rows: issues
              .slice(view.offset, view.offset + view.limit)
              .map((row, index) => ({
                ...row,
                source_index: view.offset + index,
              })),
            total: issues.length,
          }
        : selectViewRows(
            issues,
            view,
            (_, index) => indices.has(index),
            (row, source_index) => ({ ...row, source_index }),
          );
    return ok({
      ...shared,
      kind: "native-exports" as const,
      view,
      exports: summary,
      items: selected.rows,
      coverage: pageViewCoverage(
        view.offset,
        selected.rows.length,
        selected.total,
      ),
    });
  }
  const allowed =
    report.format === "pe" ? peRow.keyof().options : elfRow.keyof().options;
  const fields =
    view.fields === undefined ? allowed : [...new Set(view.fields)];
  const allowedFields: readonly string[] = allowed;
  if (fields.some((field) => !allowedFields.includes(field)))
    return invalid(
      `Selected export fields do not belong to ${report.format}; available fields: ${allowed.join(", ")}.`,
    );
  const names = view.names === undefined ? undefined : new Set(view.names);
  const encodedNames =
    names === undefined
      ? undefined
      : new Set(
          [...names].flatMap((name) => {
            const bytes = Buffer.from(name, "utf8");
            return bytes.toString("utf8") === name
              ? [bytes.toString("base64")]
              : [];
          }),
        );
  if (
    names !== undefined &&
    names.size > 0 &&
    report.format === "elf" &&
    report.exports.some(
      (row) =>
        row.name_utf8_decodable === null ||
        (row.name_utf8_decodable &&
          row.name_bytes_base64 === null &&
          !/^[\x00-\x7f]*$/u.test(row.name)),
    )
  )
    shared.unknowns.push(
      "Some ELF names lack retained encoding facts and cannot be matched by UTF-8 identity; select their source indices. A no-match page does not establish their absence.",
    );
  // A projected decoded name still carries its exact bytes and encoding qualification.
  const columns = new Set<string>(fields);
  if (report.format === "elf" && columns.has("name")) {
    columns.add("name_bytes_base64");
    columns.add("name_utf8_decodable");
  }
  const rows: readonly NativeExports["exports"][number][] = exports;
  const projectRow = (
    row: NativeExports["exports"][number],
    source_index: number,
  ) => ({
    ...Object.fromEntries(
      Object.entries(row).filter(([key]) => columns.has(key)),
    ),
    source_index,
  });
  // Unfiltered pages use the owner's original order directly; no whole-table scan.
  const selected =
    names === undefined && indices === undefined
      ? {
          rows: rows
            .slice(view.offset, view.offset + view.limit)
            .map((row, index) => projectRow(row, view.offset + index)),
          total: rows.length,
        }
      : selectViewRows(
          rows,
          view,
          (row, index) =>
            (indices === undefined || indices.has(index)) &&
            (names === undefined ||
              ("name_utf8_decodable" in row
                ? row.name_utf8_decodable === true &&
                  (row.name_bytes_base64 !== null
                    ? encodedNames!.has(row.name_bytes_base64)
                    : /^[\x00-\x7f]*$/u.test(row.name) && names.has(row.name))
                : row.name !== null && names.has(row.name))),
          projectRow,
        );
  return ok({
    ...shared,
    kind: "native-exports" as const,
    view,
    exports: summary,
    items: selected.rows,
    coverage: pageViewCoverage(
      view.offset,
      selected.rows.length,
      selected.total,
    ),
  });
};
