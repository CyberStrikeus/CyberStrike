import { analysisViewInputError } from "./analysisViewErrors.js";
import { z } from "zod";
import type { AnalysisError } from "../analysisErrorBase.js";
import { uniqueSorted } from "../canonicalOrdering.js";
import { isMachOFormat } from "../binaryTargetTypes.js";
import {
  inspectMachoSchema,
  retainedInspectMachoSchema,
} from "../native/nativeInspection.js";
import { err, ok, type Result } from "../result.js";
import { parseAnalysisViewResult } from "./analysisViewParent.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  ownedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import {
  completeWithinViewCoverage,
  pageViewCoverage,
} from "./analysisViewCoverage.js";

const MACHO_COLLECTIONS = [
  "entrypoints",
  "architectures",
  "build_metadata",
  "load_commands",
  "dependencies",
  "imports",
  "exports",
  "segments",
  "encryption",
] as const;
type MachoCollection = (typeof MACHO_COLLECTIONS)[number];

/** Original inspect_macho rows; offsets count rows in the retained collection. */
export const machoViewRequestSchema = z.strictObject({
  kind: z.literal("macho"),
  facet: z.enum([...MACHO_COLLECTIONS, "provenance"]),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
});

const { shape } = inspectMachoSchema;
/** Preserve the existing exact page rows using the producer's fields and defaults. */
const exactRows = <Shape extends z.ZodRawShape>(
  rows: z.ZodArray<z.ZodObject<Shape>>,
) => z.array(z.strictObject(rows.element.shape));
/** Each facet's exact rows, owned by the complete producer contract. */
export const machoViewRows = {
  entrypoints: exactRows(shape.entrypoints.shape.items),
  architectures: exactRows(shape.architectures.shape.items),
  build_metadata: exactRows(shape.build_metadata.shape.items),
  load_commands: exactRows(shape.load_commands.shape.items),
  dependencies: exactRows(shape.dependencies.shape.items),
  imports: exactRows(shape.imports.shape.items),
  exports: exactRows(shape.exports.shape.items),
  segments: exactRows(shape.segments.shape.items),
  encryption: exactRows(shape.encryption.shape.items),
  provenance: exactRows(shape.provenance),
};

/** The producer's own coverage of the paged collection, not of this page. */
export const machoViewContextSchema = z.strictObject({
  source_total: z.int().nonnegative().nullable(),
  source_exhaustive: z.boolean(),
});

const collectionCountSchema = z.strictObject({
  returned: z.int().nonnegative(),
  total: z.int().nonnegative().nullable(),
  exhaustive: z.boolean(),
});

/** Slice identity and per-collection counts without the collections themselves. */
export const machoSummarySchema = z.strictObject({
  format: shape.format,
  selected_architecture: shape.selected_architecture,
  endian: shape.endian,
  word_size: shape.word_size,
  file_type: shape.file_type,
  flags: shape.flags,
  uuid: shape.uuid,
  collections: z.strictObject(
    Object.fromEntries(
      MACHO_COLLECTIONS.map((name) => [name, collectionCountSchema]),
    ) as Record<MachoCollection, typeof collectionCountSchema>,
  ),
  provenance_count: z.int().nonnegative(),
  limitation_count: z.int().nonnegative(),
});

type MachoReport = z.output<typeof inspectMachoSchema>;

/** Admit a well-formed report whose recorded subject, if any, is a Mach-O. */
const parseMachoReport = (
  parent: AnalysisViewParent,
): Result<MachoReport, AnalysisError> => {
  const parsed = parseAnalysisViewResult(retainedInspectMachoSchema, parent);
  if (!parsed.ok) return parsed;
  if (parent.subject != null && !isMachOFormat(parent.subject.format))
    return err(
      analysisViewInputError([
        {
          path: ["source", "subject"],
          reason: "invalid_value",
          message:
            "Mach-O parent Evidence subject must identify a thin or universal Mach-O.",
        },
      ]),
    );
  return ok(parsed.value);
};

/** Counts replace rows; every collection caveat stays in the limitations. */
const summarizeMacho = (
  report: MachoReport,
  parentLimitations: readonly string[],
) => {
  const limitations = uniqueSorted([
    ...parentLimitations,
    ...report.limitations,
    ...MACHO_COLLECTIONS.flatMap((name) => report[name].limitations),
  ]);
  const collections = Object.fromEntries(
    MACHO_COLLECTIONS.map((name) => [
      name,
      {
        returned: report[name].items.length,
        total: report[name].total,
        exhaustive: report[name].exhaustive,
      },
    ]),
  ) as Record<MachoCollection, z.output<typeof collectionCountSchema>>;
  return {
    limitations,
    returned: MACHO_COLLECTIONS.reduce(
      (sum, name) => sum + report[name].items.length,
      0,
    ),
    summary: {
      format: report.format,
      selected_architecture: report.selected_architecture,
      endian: report.endian,
      word_size: report.word_size,
      file_type: report.file_type,
      flags: report.flags,
      uuid: report.uuid,
      collections,
      provenance_count: report.provenance.length,
      limitation_count: limitations.length,
    },
  };
};

/** Project retained inspect_macho Evidence without rerunning native tools. */
export const projectMachoView = (
  parent: AnalysisViewParent,
  admitted: AdmittedView,
) => {
  const view = ownedView<
    SummaryAnalysisView | z.output<typeof machoViewRequestSchema>
  >(admitted, "summary", "macho");
  if (view === undefined)
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message: "Mach-O inspection supports summary and macho views.",
        },
      ]),
    );
  const parsed = parseMachoReport(parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  const incomplete = MACHO_COLLECTIONS.filter(
    (name) => !report[name].exhaustive,
  );
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_macho" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact:
      parent.subject == null
        ? { path: "", sha256: null }
        : {
            path: parent.subject.local_path,
            sha256: parent.subject.digest.sha256,
          },
    unknowns: [
      ...(incomplete.length === 0
        ? []
        : [
            `Inspection did not establish exhaustive ${incomplete.join(", ")}; page exhaustion does not establish absence of unreturned rows.`,
          ]),
      ...(parent.subject == null
        ? [
            "The parent has no recorded subject, so the inspected artifact path and SHA-256 are unknown.",
          ]
        : []),
    ],
  };
  if (view.kind === "summary") {
    const { summary, limitations, returned } = summarizeMacho(
      report,
      parent.limitations,
    );
    return ok({
      kind: "summary" as const,
      view,
      ...shared,
      limitations,
      summary,
      coverage: completeWithinViewCoverage(returned, returned),
    });
  }
  const source =
    view.facet === "provenance"
      ? {
          items: report.provenance,
          total: report.provenance.length,
          exhaustive: true,
          limitations: [],
        }
      : report[view.facet];
  const common = {
    kind: "macho" as const,
    ...shared,
    limitations: uniqueSorted([
      ...parent.limitations,
      ...report.limitations,
      ...source.limitations,
    ]),
    source_total: source.total,
    source_exhaustive: source.exhaustive,
  };
  const page = <Facet extends MachoCollection | "provenance", Row>(
    facet: Facet,
    rows: Row[],
  ) => {
    const item = rows.slice(view.offset, view.offset + view.limit);
    return {
      ...common,
      view: { ...view, facet },
      item,
      coverage: pageViewCoverage(view.offset, item.length, rows.length),
    };
  };
  switch (view.facet) {
    case "entrypoints":
      return ok(page("entrypoints", report.entrypoints.items));
    case "architectures":
      return ok(page("architectures", report.architectures.items));
    case "build_metadata":
      return ok(page("build_metadata", report.build_metadata.items));
    case "load_commands":
      return ok(page("load_commands", report.load_commands.items));
    case "dependencies":
      return ok(page("dependencies", report.dependencies.items));
    case "imports":
      return ok(page("imports", report.imports.items));
    case "exports":
      return ok(page("exports", report.exports.items));
    case "segments":
      return ok(page("segments", report.segments.items));
    case "encryption":
      return ok(page("encryption", report.encryption.items));
    case "provenance":
      return ok(page("provenance", report.provenance));
  }
};
