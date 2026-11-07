import { z } from "zod";
import {
  pythonPycSchema,
  type PythonPycCodeObject,
} from "../python/pythonPyc.js";
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

const code = pythonPycSchema.shape.code_objects.element;

/** Names match retained display strings; every matching source index survives. */
export const pythonPycViewRequestSchema = z.strictObject({
  kind: z.literal("python-pyc"),
  collection: z.literal("code_objects"),
  names: z.array(z.string()).optional(),
  indices: z.array(z.int().nonnegative()).optional(),
  fields: z.array(code.keyof()).optional(),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
});

export const pythonPycCompleteDeliveryShape = {
  detail: z.literal("complete").optional().default("complete"),
  view: z.never().exactOptional(),
};
export const pythonPycSummaryDeliveryShape = {
  detail: z.literal("summary"),
  view: pythonPycViewRequestSchema.exactOptional(),
};
export const pythonPycDeliverySchema = z.discriminatedUnion("detail", [
  z.strictObject(pythonPycCompleteDeliveryShape),
  z.strictObject(pythonPycSummaryDeliveryShape),
]);

export const pythonPycViewItemsSchema = z.array(
  code.partial().extend({ source_index: z.int().nonnegative() }),
);

/** Source coverage and constructor/header qualifications stay separate from paging. */
export const pythonPycSummarySchema = z.strictObject({
  artifact: pythonPycSchema.shape.artifact,
  header: pythonPycSchema.shape.header,
  coverage: pythonPycSchema.shape.coverage,
  limitation_count: z.int().nonnegative(),
});

const readReport = createAnalysisViewResultReader(pythonPycSchema);

/** Project code-constant references from historical facts, without reopening the pyc. */
export const projectPythonPycView = (
  parent: AnalysisViewParent,
  admitted: AdmittedView,
) => {
  const view = ownedView<
    SummaryAnalysisView | z.output<typeof pythonPycViewRequestSchema>
  >(admitted, "summary", "python-pyc");
  if (view === undefined)
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message: "Python pyc Evidence supports summary and python-pyc views.",
        },
      ]),
    );
  const parsed = readReport(parent);
  if (!parsed.ok) return parsed;
  const { code_objects, limitations, ...identity } = parsed.value;
  const summary = { ...identity, limitation_count: limitations.length };
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_python_pyc" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: {
      path: identity.artifact.path,
      sha256: identity.artifact.sha256,
    },
    limitations: boundedViewMessages(
      [...parent.limitations, ...limitations],
      parent.evidenceId,
      "limitations",
    ),
    unknowns: [],
  };
  if (view.kind === "summary")
    return ok({
      ...shared,
      kind: "summary" as const,
      view,
      summary,
      coverage: completeWithinViewCoverage(
        code_objects.length,
        code_objects.length,
      ),
    });
  const names = view.names === undefined ? undefined : new Set(view.names);
  const indices =
    view.indices === undefined ? undefined : new Set(view.indices);
  const fields = new Set<string>(view.fields ?? code.keyof().options);
  const projectRow = (row: PythonPycCodeObject, source_index: number) => ({
    ...Object.fromEntries(
      Object.entries(row).filter(([key]) => fields.has(key)),
    ),
    source_index,
  });
  const selected =
    names === undefined && indices === undefined
      ? {
          rows: code_objects
            .slice(view.offset, view.offset + view.limit)
            .map((row, index) => projectRow(row, view.offset + index)),
          total: code_objects.length,
        }
      : selectViewRows(
          code_objects,
          view,
          (row, index) =>
            (names === undefined || names.has(row.name)) &&
            (indices === undefined || indices.has(index)),
          projectRow,
        );
  return ok({
    ...shared,
    kind: "python-pyc" as const,
    view,
    pyc: summary,
    items: selected.rows,
    coverage: pageViewCoverage(
      view.offset,
      selected.rows.length,
      selected.total,
    ),
  });
};
