import { z } from "zod";
import { devicetreeSchema } from "../firmware/devicetree.js";
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

export const devicetreeViewRequestSchema = z.strictObject({
  kind: z.literal("devicetree"),
  collection: z.enum(["nodes", "properties", "reservations", "references"]),
  path: z
    .string()
    .optional()
    .describe(
      "Exact node path; required for properties and optional for nodes",
    ),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().max(256).default(32),
});
const sourceIndex = { source_index: z.int().nonnegative() };
export const devicetreeViewItemsSchema = z.union([
  z.array(
    devicetreeSchema.shape.nodes.element
      .omit({ properties: true })
      .extend({ property_count: z.int().nonnegative(), ...sourceIndex }),
  ),
  z.array(
    devicetreeSchema.shape.nodes.element.shape.properties.element.extend(
      sourceIndex,
    ),
  ),
  z.array(devicetreeSchema.shape.reservations.element.extend(sourceIndex)),
  z.array(devicetreeSchema.shape.references.element.extend(sourceIndex)),
]);
const counts = {
  reservation_count: z.int().nonnegative(),
  reference_count: z.int().nonnegative(),
  unresolved_reference_count: z.int().nonnegative(),
};
export const devicetreeSummarySchema = devicetreeSchema
  .pick({ artifact: true, header: true, summary: true, coverage: true })
  .extend(counts);
/** Fixed-size page context; unbounded summary strings stay in the summary view. */
export const devicetreePageContextSchema = devicetreeSchema
  .pick({ artifact: true, header: true, coverage: true })
  .extend({ ...counts, alias_count: z.int().nonnegative() });
const readReport = createAnalysisViewResultReader(devicetreeSchema);
export const projectDevicetreeView = (
  parent: AnalysisViewParent,
  view: AdmittedView,
) => {
  const invalid = (message: string) =>
    err(
      analysisViewInputError([
        { path: ["view"], reason: "invalid_value", message },
      ]),
    );
  if (view.kind !== "summary" && view.kind !== "devicetree")
    return invalid(
      "Devicetree Evidence supports summary and devicetree views.",
    );
  assertOwnedView<
    SummaryAnalysisView | z.output<typeof devicetreeViewRequestSchema>
  >(view, "summary", "devicetree");
  const parsed = readReport(parent);
  if (!parsed.ok) return parsed;
  const r = parsed.value;
  const context = {
    artifact: r.artifact,
    header: r.header,
    coverage: r.coverage,
    reservation_count: r.reservations.length,
    reference_count: r.references.length,
    unresolved_reference_count: r.references.filter(
      (ref) => ref.target === null,
    ).length,
  };
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_devicetree" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: { path: r.artifact.path, sha256: r.artifact.sha256 },
    limitations: boundedViewMessages(
      [...parent.limitations, ...r.limitations],
      parent.evidenceId,
      "limitations",
    ),
    unknowns: [
      "Binding-specific references, address translation and runtime hardware state are not established.",
    ],
  };
  if (view.kind === "summary")
    return ok({
      ...shared,
      kind: "summary" as const,
      view,
      summary: { ...context, summary: r.summary },
      coverage: completeWithinViewCoverage(r.nodes.length, r.nodes.length),
    });
  if (view.collection === "properties" && view.path === undefined)
    return invalid("A properties page requires an exact node path.");
  if (
    view.path !== undefined &&
    view.collection !== "nodes" &&
    view.collection !== "properties"
  )
    return invalid("path selects only nodes or properties.");
  const nodeIndex =
    view.path === undefined
      ? -1
      : r.nodes.findIndex((n) => n.path === view.path);
  const node = r.nodes[nodeIndex];
  if (view.collection === "properties" && node === undefined)
    return invalid("The selected node path is absent from this Evidence.");
  // Slice retained rows before allocating projections; exact node selection keeps its original index.
  const page = <T>(rows: readonly T[], originalIndex?: number) => ({
    items: rows.slice(view.offset, view.offset + view.limit).map((row, i) => ({
      ...row,
      source_index: originalIndex ?? view.offset + i,
    })),
    total: rows.length,
  });
  const selectedNodes = page(
    view.path === undefined ? r.nodes : node === undefined ? [] : [node],
    view.path === undefined ? undefined : nodeIndex,
  );
  const selected =
    view.collection === "nodes"
      ? {
          items: selectedNodes.items.map(({ properties, ...n }) => ({
            ...n,
            property_count: properties.length,
          })),
          total: selectedNodes.total,
        }
      : view.collection === "properties"
        ? page(node?.properties ?? [])
        : view.collection === "reservations"
          ? page(r.reservations)
          : page(r.references);
  const { items, total } = selected;
  return ok({
    ...shared,
    kind: "devicetree" as const,
    view,
    devicetree: { ...context, alias_count: r.summary.aliases.length },
    items,
    coverage: pageViewCoverage(view.offset, items.length, total),
  });
};
