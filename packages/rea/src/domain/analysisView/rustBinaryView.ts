import { binaryMetadataArchitecture } from "../binaryMetadataArchitecture.js";
import { metadataReportSubjectFormat } from "../apple/machoTargetSelection.js";
import { z } from "zod";
import {
  rustBinarySchema,
  rustAuditableMetadataSchema,
  rustcCommitSchema,
  type RustBinary,
} from "../rust/rustBinary.js";
import { err, ok } from "../result.js";
import {
  createAnalysisViewResultReader,
  type AnalysisViewParent,
} from "./analysisViewParent.js";
import {
  assertOwnedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import { rustBinaryViewRequestSchema } from "../rust/rustBinaryQuery.js";
import {
  boundedViewMessages,
  completeWithinViewCoverage,
  pageViewCoverage,
} from "./analysisViewCoverage.js";
import { analysisViewInputError } from "./analysisViewErrors.js";
import { selectViewRows } from "./selectViewRows.js";

const count = z.number().int().nonnegative();
export const rustBinarySummarySchema = z.strictObject({
  bytes: count,
  format: rustBinarySchema.shape.format,
  architecture: rustBinarySchema.shape.architecture,
  bits: rustBinarySchema.shape.bits,
  byte_order: rustBinarySchema.shape.byte_order,
  selected_slice: rustBinarySchema.shape.selected_slice,
  auditable_metadata: rustAuditableMetadataSchema
    .omit({
      packages: true,
      dependency_edges: true,
      cyclic_dependency_indices: true,
    })
    .extend({
      counts: z.strictObject({
        packages: count,
        edges: count,
        cyclic_packages: count,
      }),
    })
    .nullable(),
  rustc_commit: rustcCommitSchema
    .omit({ hashes: true })
    .extend({ hashes_count: count })
    .nullable(),
});
export const rustBinaryViewContextSchema = z.strictObject({
  source_coverage: z.strictObject({
    auditable_metadata_available: z.boolean(),
    embedded_records: z.enum(["complete", "unknown"]),
    runtime_dependencies: z.literal("unknown"),
  }),
});

const parseReport = createAnalysisViewResultReader(rustBinarySchema);

const summarize = (
  report: RustBinary,
): z.infer<typeof rustBinarySummarySchema> => {
  const {
    artifact,
    auditable_metadata: metadata,
    rustc_commit: compiler,
  } = report;
  const section =
    metadata === null
      ? null
      : {
          section_name: metadata.section_name,
          file_offset: metadata.file_offset,
          section_bytes: metadata.section_bytes,
          compressed_bytes: metadata.compressed_bytes,
          uncompressed_bytes: metadata.uncompressed_bytes,
          format_version: metadata.format_version,
          root_package_index: metadata.root_package_index,
          counts: {
            packages: metadata.packages.length,
            edges: metadata.dependency_edges.length,
            cyclic_packages: metadata.cyclic_dependency_indices.length,
          },
        };
  return {
    format: report.format,
    architecture: report.architecture,
    bits: report.bits,
    byte_order: report.byte_order,
    ...(report.selected_slice === undefined
      ? {}
      : { selected_slice: report.selected_slice }),
    bytes: artifact.bytes,
    auditable_metadata: section,
    rustc_commit:
      compiler === null
        ? null
        : {
            evidence_kind: compiler.evidence_kind,
            hashes_count: compiler.hashes.length,
          },
  };
};

/** Query owner-normalized facts without reopening a source or walking dependency paths. */
export const projectRustBinaryView = (
  parent: AnalysisViewParent,
  view: AdmittedView,
) => {
  if (view.kind !== "summary" && view.kind !== "rust")
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message: "Rust Evidence supports summary and rust views.",
        },
      ]),
    );
  assertOwnedView<
    SummaryAnalysisView | z.output<typeof rustBinaryViewRequestSchema>
  >(view, "summary", "rust");
  const parsed = parseReport(parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  const subject = parent.subject;
  if (
    subject == null ||
    subject.digest.sha256 !== report.artifact.sha256 ||
    subject.format !== metadataReportSubjectFormat(report) ||
    subject.architecture !==
      (binaryMetadataArchitecture(report.architecture) ?? null)
  )
    return err(
      analysisViewInputError([
        {
          path: ["source", "subject"],
          reason: "invalid_value",
          message:
            "Rust parent subject must identify the report's exact artifact.",
        },
      ]),
    );
  const metadata = report.auditable_metadata;
  const unknown =
    "Embedded dependency records do not authenticate build provenance or establish complete runtime dependencies or target behavior.";
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_rust_binary" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: { path: report.artifact.path, sha256: report.artifact.sha256 },
    source_coverage: {
      auditable_metadata_available: metadata !== null,
      embedded_records:
        metadata === null ? ("unknown" as const) : ("complete" as const),
      runtime_dependencies: "unknown" as const,
    },
    limitations: boundedViewMessages(
      [...parent.limitations, ...report.limitations],
      parent.evidenceId,
      "limitations",
    ),
    unknowns: boundedViewMessages(
      [
        unknown,
        ...(metadata === null
          ? [
              "No cargo-auditable metadata was observed; missing metadata does not establish an empty dependency set.",
            ]
          : []),
      ],
      parent.evidenceId,
      "unknowns",
      [unknown],
    ),
  };
  const summary = summarize(report);
  if (view.kind === "summary")
    return ok({
      kind: "summary" as const,
      view,
      ...shared,
      summary,
      coverage: completeWithinViewCoverage(1, 1),
    });
  const indices =
    view.indices === undefined ? undefined : new Set(view.indices);
  const fields =
    view.fields === undefined ? undefined : new Set<string>(view.fields);
  if (view.collection === "packages") {
    const names = view.names === undefined ? undefined : new Set(view.names);
    const versions =
      view.versions === undefined ? undefined : new Set(view.versions);
    const selected = selectViewRows(
      metadata?.packages ?? [],
      view,
      (row, index) =>
        (indices?.has(index) ?? true) &&
        (names?.has(row.name) ?? true) &&
        (versions?.has(row.version) ?? true),
      (row, index) => ({
        index,
        ...((fields?.has("name") ?? true) && { name: row.name }),
        ...((fields?.has("version") ?? true) && { version: row.version }),
        ...((fields?.has("source") ?? true) && { source: row.source }),
        ...((fields?.has("kind") ?? true) && { kind: row.kind }),
        ...((fields?.has("root") ?? true) && { root: row.root }),
        ...(fields?.has("dependencies") === true && {
          dependencies: row.dependencies,
        }),
        ...(fields?.has("features") === true && {
          features: row.features,
        }),
      }),
    );
    return ok({
      kind: "rust" as const,
      view,
      ...shared,
      rust: summary,
      page: { collection: "packages" as const, rows: selected.rows },
      coverage: pageViewCoverage(
        view.offset,
        selected.rows.length,
        selected.total,
      ),
    });
  }
  const from =
    view.from_indices === undefined ? undefined : new Set(view.from_indices);
  const to =
    view.to_indices === undefined ? undefined : new Set(view.to_indices);
  const selected = selectViewRows(
    metadata?.dependency_edges ?? [],
    view,
    (row, index) =>
      (indices?.has(index) ?? true) &&
      (from?.has(row.from_index) ?? true) &&
      (to?.has(row.to_index) ?? true),
    (row, index) => ({
      index,
      ...((fields?.has("from_index") ?? true) && {
        from_index: row.from_index,
      }),
      ...((fields?.has("to_index") ?? true) && { to_index: row.to_index }),
    }),
  );
  return ok({
    kind: "rust" as const,
    view,
    ...shared,
    rust: summary,
    page: { collection: "edges" as const, rows: selected.rows },
    coverage: pageViewCoverage(
      view.offset,
      selected.rows.length,
      selected.total,
    ),
  });
};
