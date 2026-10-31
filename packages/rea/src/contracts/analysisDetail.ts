import { z } from "zod";

import { evidenceResultOf } from "./toolOutputSchemaPrimitives.js";

/** Caller-selected delivery of completed analysis Evidence that supports retained views. */
export const analysisDetailSchema = z
  .enum(["complete", "summary"])
  .default("complete")
  .describe(
    "complete returns the complete analysis Evidence inline. summary retains that complete Evidence in this session and returns its inspect_analysis_view summary; inspect pages, items or facets through normalized_result.parent_evidence_id.",
  );

/**
 * analyze_function delivery. Defaults to the token-frugal summary because a
 * complete native dossier can reach several megabytes of value-flow and
 * references; callers that need everything inline pass complete.
 */
export const analysisDetailSummaryDefaultSchema = z
  .enum(["complete", "summary"])
  .default("summary")
  .describe(
    "summary (default) returns a compact dossier and retains the complete analyze_function Evidence in this session; page pseudocode, references and value-flow through normalized_result.parent_evidence_id with inspect_analysis_view. complete returns the full dossier inline.",
  );

/**
 * Complete analysis Evidence, or that operation's summary view of its retained
 * record. Callers pass the summary variant the handler actually returns so the
 * advertised output does not accept other view kinds.
 */
export const analysisDetailOutputSchemaOf = <
  Analysis extends z.ZodType,
  Summary extends z.ZodType,
>(
  analysis: Analysis,
  summary: Summary,
) => evidenceResultOf(z.union([analysis, summary]));
