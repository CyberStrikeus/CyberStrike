import { z } from "zod";
import { erlangBeamSchema, type ErlangBeam } from "../erlang/beam.js";
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

const atom = erlangBeamSchema.shape.atoms.unwrap().element;
const exported = erlangBeamSchema.shape.exports.unwrap().element;
const imported = erlangBeamSchema.shape.imports.unwrap().element;
const lambda = erlangBeamSchema.shape.lambdas.unwrap().element;
const chunk = erlangBeamSchema.shape.chunks.element;
const page = {
  kind: z.literal("beam"),
  names: z.array(z.string()).optional(),
  indices: z.array(z.int().nonnegative()).optional(),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
};

/** Names select exact retained names; function names retain every arity and row. */
export const erlangBeamViewRequestSchema = z.discriminatedUnion("collection", [
  z.strictObject({
    ...page,
    collection: z.literal("atoms"),
    fields: z.array(atom.keyof()).optional(),
  }),
  z.strictObject({
    ...page,
    collection: z.literal("exports"),
    fields: z.array(exported.keyof()).optional(),
  }),
  z.strictObject({
    ...page,
    collection: z.literal("imports"),
    modules: z.array(z.string()).optional(),
    fields: z.array(imported.keyof()).optional(),
  }),
  z.strictObject({
    ...page,
    collection: z.literal("lambdas"),
    fields: z.array(lambda.keyof()).optional(),
  }),
  z.strictObject({
    ...page,
    collection: z.literal("chunks"),
    fields: z.array(chunk.keyof()).optional(),
  }),
]);
const index = { source_index: z.int().nonnegative() };
export const erlangBeamViewPageSchema = z.discriminatedUnion("collection", [
  z.strictObject({
    collection: z.literal("atoms"),
    items: z.array(atom.partial().extend(index)),
  }),
  z.strictObject({
    collection: z.literal("exports"),
    items: z.array(exported.partial().extend(index)),
  }),
  z.strictObject({
    collection: z.literal("imports"),
    items: z.array(imported.partial().extend(index)),
  }),
  z.strictObject({
    collection: z.literal("lambdas"),
    items: z.array(lambda.partial().extend(index)),
  }),
  z.strictObject({
    collection: z.literal("chunks"),
    items: z.array(chunk.partial().extend(index)),
  }),
]);
const count = z.int().nonnegative();
/** Null counts preserve unavailable tables separately from decoded empty tables. */
export const erlangBeamSummarySchema = erlangBeamSchema
  .omit({
    chunks: true,
    atoms: true,
    exports: true,
    imports: true,
    lambdas: true,
    limitations: true,
  })
  .extend({
    counts: z.strictObject({
      chunks: count,
      atoms: count.nullable(),
      exports: count.nullable(),
      imports: count.nullable(),
      lambdas: count.nullable(),
    }),
    limitation_count: count,
  });
export const erlangBeamCompleteDeliveryShape = {
  detail: z.literal("complete").optional().default("complete"),
  view: z.never().exactOptional(),
};
export const erlangBeamSummaryDeliveryShape = {
  detail: z.literal("summary"),
  view: erlangBeamViewRequestSchema.exactOptional(),
};
export const erlangBeamDeliverySchema = z.discriminatedUnion("detail", [
  z.strictObject(erlangBeamCompleteDeliveryShape),
  z.strictObject(erlangBeamSummaryDeliveryShape),
]);
const readReport = createAnalysisViewResultReader(erlangBeamSchema);
type Table = "atoms" | "exports" | "imports" | "lambdas" | "chunks";
type Row = NonNullable<ErlangBeam[Table]>[number];
type BeamView = z.infer<typeof erlangBeamViewRequestSchema>;

/** Select already parsed rows; original atom/lambda indexes are never repurposed. */
const selectRows = (rows: readonly Row[] | null, view: BeamView) => {
  const names = view.names === undefined ? undefined : new Set(view.names);
  const indices =
    view.indices === undefined ? undefined : new Set(view.indices);
  const modules =
    view.collection === "imports" && view.modules !== undefined
      ? new Set(view.modules)
      : undefined;
  const fields =
    view.fields === undefined ? undefined : new Set<string>(view.fields);
  const project = (row: Row, source_index: number) => ({
    ...Object.fromEntries(
      Object.entries(row).filter(
        ([key]) => fields === undefined || fields.has(key),
      ),
    ),
    source_index,
  });
  const source = rows ?? [];
  if (names === undefined && indices === undefined && modules === undefined)
    return {
      rows: source
        .slice(view.offset, view.offset + view.limit)
        .map((row, i) => project(row, view.offset + i)),
      total: source.length,
    };
  return selectViewRows(
    source,
    view,
    (row, i) => {
      const name = "name" in row ? row.name : row.function;
      return (
        (indices === undefined || indices.has(i)) &&
        (names === undefined || (name !== null && names.has(name))) &&
        (modules === undefined ||
          ("module" in row && row.module !== null && modules.has(row.module)))
      );
    },
    project,
  );
};

/** Project retained BEAM facts without reopening files or reinterpreting chunks. */
export const projectErlangBeamView = (
  parent: AnalysisViewParent,
  admitted: AdmittedView,
) => {
  const view = ownedView<
    SummaryAnalysisView | z.output<typeof erlangBeamViewRequestSchema>
  >(admitted, "summary", "beam");
  if (view === undefined)
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message: "BEAM Evidence supports summary and beam views.",
        },
      ]),
    );
  const parsed = readReport(parent);
  if (!parsed.ok) return parsed;
  const { atoms, exports, imports, lambdas, chunks, limitations, ...identity } =
    parsed.value;
  const summary = {
    ...identity,
    counts: {
      atoms: atoms?.length ?? null,
      exports: exports?.length ?? null,
      imports: imports?.length ?? null,
      lambdas: lambdas?.length ?? null,
      chunks: chunks.length,
    },
    limitation_count: limitations.length,
  };
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_erlang_beam" as const,
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
    unknowns: (["atoms", "exports", "imports", "lambdas"] as const)
      .filter((key) => summary.counts[key] === null)
      .map(
        (key) =>
          `No ${key} table was decoded; runtime absence is not established.`,
      ),
  };
  if (view.kind === "summary")
    return ok({
      ...shared,
      kind: "summary" as const,
      view,
      summary,
      coverage: completeWithinViewCoverage(chunks.length, chunks.length),
    });
  const selected = selectRows(parsed.value[view.collection], view);
  return ok({
    ...shared,
    kind: "beam" as const,
    view,
    beam: summary,
    page: { collection: view.collection, items: selected.rows },
    coverage: pageViewCoverage(
      view.offset,
      selected.rows.length,
      selected.total,
    ),
  });
};
