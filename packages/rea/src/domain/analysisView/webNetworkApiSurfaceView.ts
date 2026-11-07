import { z } from "zod";
import { AnalysisUnsupportedTargetError } from "../analysisErrorCore.js";
import { err, ok } from "../result.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  assertOwnedView,
  ownedView,
  type AdmittedView,
} from "./analysisViewShape.js";
import { WebNetworkApiSurfaceAccumulator } from "./WebNetworkApiSurfaceAccumulator.js";
import { admitHarCaptureParent } from "./WebNetworkProjectionAccumulator.js";

import { apiSurfaceFields, apiSurfaceViewSchema } from "./apiSurfaceSchema.js";

export { apiSurfaceFields, apiSurfaceViewSchema };

/** Create the budget and query-name policy shared by admission and projection. */
export const createApiSurfaceAccumulator = (
  view: AdmittedView,
): WebNetworkApiSurfaceAccumulator => {
  const selected = ownedView<z.output<typeof apiSurfaceViewSchema>>(
    view,
    "api-surface",
  );
  return new WebNetworkApiSurfaceAccumulator(
    undefined,
    selected?.include_query_parameter_names === true,
  );
};

/** Group retained HAR request lines; format matches do not establish handler identity. */
export const projectWebNetworkApiSurfaceView = (
  parent: AnalysisViewParent,
  view: AdmittedView,
  accumulator = createApiSurfaceAccumulator(view),
) => {
  if (view.kind !== "api-surface")
    return err(
      new AnalysisUnsupportedTargetError(
        "inspect_analysis_view",
        parent.evidenceId,
        `View ${view.kind} is unsupported for parent operation ${parent.operation}; api-surface requires inspect_web_network_capture.`,
      ),
    );
  assertOwnedView<z.output<typeof apiSurfaceViewSchema>>(view, "api-surface");
  const admitted = admitHarCaptureParent(parent, "api-surface", accumulator);
  if (!admitted.ok) return admitted;
  const capture = admitted.value;
  const limitations = accumulator.addLimitations([
    ...parent.limitations,
    ...capture.limitations,
    "Grouping does not establish handler identity, URL-space schemas or causality.",
    ...(view.include_query_parameter_names === true
      ? [
          "Observed query parameter names do not establish required parameters, value types or a complete API schema.",
        ]
      : []),
    ...(capture.records.length < capture.total_records
      ? [
          "Parent contains an ordinal subset; the surface covers only retained records.",
        ]
      : []),
  ]);
  if (!limitations.ok) return limitations;
  for (const record of capture.records) {
    const added = accumulator.add(record);
    if (!added.ok) return added;
  }
  const page = accumulator.page(view.offset, view.limit);
  return ok({
    kind: "api-surface" as const,
    view,
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_web_network_capture" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: { path: capture.artifact.path, sha256: capture.artifact.sha256 },
    records: {
      examined: capture.records.length,
      total: capture.total_records,
      excluded: page.excluded_records.length,
    },
    ...page,
  });
};
