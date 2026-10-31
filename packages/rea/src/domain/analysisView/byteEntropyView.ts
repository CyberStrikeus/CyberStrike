import { z } from "zod";
import { AnalysisInputError } from "../analysisErrorCore.js";
import { byteEntropySchema, type ByteEntropy } from "../native/byteEntropy.js";
import { err, ok } from "../result.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  assertOwnedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import { completeWithinViewCoverage } from "./analysisViewCoverage.js";

export const byteEntropySummarySchema = byteEntropySchema
  .omit({ blocks: true, runs: true, limitations: true })
  .extend({
    block_count: z.number().int().nonnegative(),
    run_count: z.number().int().nonnegative(),
    top_runs: byteEntropySchema.shape.runs,
  });

/** Rank ten longest runs for triage; the full series remains in parent Evidence. */
export const projectByteEntropyView = (
  parent: AnalysisViewParent,
  report: ByteEntropy,
  view: AdmittedView,
) => {
  if (view.kind !== "summary")
    return err(
      new AnalysisInputError("inspect_analysis_view", undefined, [
        {
          path: ["view"],
          reason: "invalid_value",
          message:
            "Byte entropy Evidence supports the summary view; retrieve parent Evidence for the complete block series.",
        },
      ]),
    );
  assertOwnedView<SummaryAnalysisView>(view, "summary");
  return ok({
    kind: "summary" as const,
    view,
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_byte_entropy" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: { path: report.artifact.path, sha256: report.artifact.sha256 },
    summary: {
      artifact: report.artifact,
      block_size: report.block_size,
      window: report.window,
      file_entropy: report.file_entropy,
      thresholds: report.thresholds,
      block_count: report.blocks.length,
      run_count: report.runs.length,
      top_runs: [...report.runs]
        .sort((a, b) => b.length - a.length || a.offset - b.offset)
        .slice(0, 10),
    },
    coverage: completeWithinViewCoverage(
      report.blocks.length,
      report.blocks.length,
    ),
    limitations: [
      ...new Set([...parent.limitations, ...report.limitations]),
    ].sort(),
    unknowns: [] as string[],
  });
};
