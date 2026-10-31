import { z } from "zod";
import type { AnalysisError } from "../analysisErrorBase.js";
import { analysisViewInputError } from "./analysisViewErrors.js";
import { uniqueSorted } from "../canonicalOrdering.js";
import {
  interfaceBuilderAnalysisSchema,
  interfaceBuilderDocumentSchema,
} from "../apple/interfaceBuilderGraph.js";
import {
  nativeInvestigationCoverageSchema,
  nativeInvestigationEdgeSchema,
  nativeInvestigationNodeSchema,
  nativeInvestigationProviderSchema,
} from "../native/nativeInvestigationGraph.js";
import { err, ok, type Result } from "../result.js";
import { createAnalysisViewResultReader } from "./analysisViewParent.js";
import { selectViewRows } from "./selectViewRows.js";
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

const page = {
  kind: z.literal("interface-builder"),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
} as const;

/** Original decoded rows; graph rows can be narrowed to one decoded document. */
export const interfaceBuilderViewRequestSchema = z.discriminatedUnion(
  "collection",
  [
    z.strictObject({
      ...page,
      collection: z.enum(["nodes", "edges"]),
      document: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Exact documents[].relative_path; selects rows whose evidence names that archive.",
        ),
    }),
    z.strictObject({
      ...page,
      collection: z.enum(["documents", "coverage"]),
    }),
  ],
);

export const interfaceBuilderViewItemsSchema = z.union([
  z.array(interfaceBuilderDocumentSchema),
  z.array(nativeInvestigationNodeSchema),
  z.array(nativeInvestigationEdgeSchema),
  z.array(nativeInvestigationCoverageSchema),
]);

/** The decoder's own truncation, independent of page exhaustion. */
export const interfaceBuilderViewContextSchema = z.strictObject({
  source_truncated: z.boolean(),
});

const countsSchema = z.record(z.string(), z.int().positive());

/** Every decoded document with graph counts; rows and evidence stay retained. */
export const interfaceBuilderSummarySchema = z.strictObject({
  target_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  provider: nativeInvestigationProviderSchema,
  documents: interfaceBuilderDocumentSchema.array().max(64),
  available_counts: z.strictObject({
    nodes: z.int().nonnegative(),
    edges: z.int().nonnegative(),
    coverage: z.int().nonnegative(),
  }),
  node_kinds: countsSchema,
  edge_relations: countsSchema,
  coverage_statuses: countsSchema,
  truncated: z.boolean(),
  limitation_count: z.int().nonnegative(),
});

const tally = (values: readonly string[]): Record<string, number> => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries(
    [...counts].sort(([left], [right]) => (left < right ? -1 : 1)),
  );
};

type InterfaceBuilderReport = z.output<typeof interfaceBuilderAnalysisSchema>;
type InterfaceBuilderPage = z.output<typeof interfaceBuilderViewRequestSchema>;

const pageRows = <Row>(rows: readonly Row[], view: InterfaceBuilderPage) => ({
  rows: rows.slice(view.offset, view.offset + view.limit),
  total: rows.length,
});

const selectDocumentRows = <
  Row extends { readonly evidence: readonly { artifact_path: unknown }[] },
>(
  rows: readonly Row[],
  view: InterfaceBuilderPage,
  document: string | undefined,
) =>
  document === undefined
    ? pageRows(rows, view)
    : selectViewRows(
        rows,
        view,
        (row) =>
          row.evidence.some((evidence) => evidence.artifact_path === document),
        (row) => row,
      );

const readReport = createAnalysisViewResultReader(
  interfaceBuilderAnalysisSchema,
);

/** Admit a well-formed report bound to its recorded target, if one exists. */
const parseInterfaceBuilderReport = (
  parent: AnalysisViewParent,
): Result<InterfaceBuilderReport, AnalysisError> => {
  const parsed = readReport(parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  if (
    report.graph.target_sha256 !== report.target_sha256 ||
    (parent.subject != null &&
      parent.subject.digest.sha256 !== report.target_sha256)
  )
    return err(
      analysisViewInputError([
        {
          path: ["source", "subject"],
          reason: "invalid_value",
          message:
            "Interface Builder parent Evidence subject and graph must identify the report's target SHA-256.",
        },
      ]),
    );
  return parsed;
};

/** Every decoded document with graph tallies; rows stay in the retained parent. */
const summarizeInterfaceBuilder = (
  report: InterfaceBuilderReport,
  limitationCount: number,
) => {
  const { graph } = report;
  const total =
    report.documents.length +
    graph.nodes.length +
    graph.edges.length +
    graph.coverage.length;
  return {
    summary: interfaceBuilderSummarySchema.parse({
      target_sha256: report.target_sha256,
      provider: graph.provider,
      documents: report.documents,
      available_counts: {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        coverage: graph.coverage.length,
      },
      node_kinds: tally(graph.nodes.map((node) => node.kind)),
      edge_relations: tally(graph.edges.map((edge) => edge.relation)),
      coverage_statuses: tally(graph.coverage.map((row) => row.status)),
      truncated: graph.truncated,
      limitation_count: limitationCount,
    }),
    coverage: completeWithinViewCoverage(total, total),
  };
};

/** Project retained decode_interface_builder Evidence without reopening archives. */
export const projectInterfaceBuilderView = (
  parent: AnalysisViewParent,
  admitted: AdmittedView,
) => {
  const view = ownedView<
    SummaryAnalysisView | z.output<typeof interfaceBuilderViewRequestSchema>
  >(admitted, "summary", "interface-builder");
  if (view === undefined)
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message:
            "Interface Builder decoding supports summary and interface-builder views.",
        },
      ]),
    );
  const parsed = parseInterfaceBuilderReport(parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  const { graph } = report;
  const limitations = uniqueSorted([
    ...parent.limitations,
    ...report.limitations,
  ]);
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "decode_interface_builder" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: {
      path:
        parent.subject?.local_path ??
        report.resource_root?.canonical_path ??
        "",
      sha256: report.target_sha256,
    },
    ...(report.resource_root === undefined
      ? {}
      : { resource_root: report.resource_root }),
    limitations,
    unknowns: [
      "Rows describe recognized archive objects and connections only; unrecognized classes, fields and runtime-created UI remain unknown.",
      ...(graph.truncated
        ? [
            "The decoded graph is incomplete (see coverage and limitations for the cause); page exhaustion does not establish absence of undecoded objects or connections.",
          ]
        : []),
    ],
  };
  if (view.kind === "summary")
    return ok({
      kind: "summary" as const,
      view,
      ...shared,
      ...summarizeInterfaceBuilder(report, limitations.length),
    });
  const document =
    view.collection === "nodes" || view.collection === "edges"
      ? view.document
      : undefined;
  if (
    document !== undefined &&
    !report.documents.some((row) => row.relative_path === document)
  )
    return err(
      analysisViewInputError([
        {
          path: ["view", "document"],
          reason: "invalid_value",
          message:
            "Select an exact documents[].relative_path from this decoded report.",
        },
      ]),
    );
  const selected =
    view.collection === "documents"
      ? pageRows(report.documents, view)
      : view.collection === "coverage"
        ? pageRows(graph.coverage, view)
        : view.collection === "nodes"
          ? selectDocumentRows(graph.nodes, view, document)
          : selectDocumentRows(graph.edges, view, document);
  return ok({
    kind: "interface-builder" as const,
    view,
    items: selected.rows,
    ...shared,
    source_truncated: graph.truncated,
    coverage: pageViewCoverage(
      view.offset,
      selected.rows.length,
      selected.total,
    ),
  });
};
