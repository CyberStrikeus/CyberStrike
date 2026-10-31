import type { EvidenceWriter } from "./InvestigationRecordPort.js";
import { EvidenceIntegrityError } from "../../domain/evidenceErrors.js";
import type { Evidence } from "../../domain/evidence.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisCapabilityUnavailableError } from "../../domain/analysisErrorCore.js";

/** Source facts remain available even when a completed observation is cancelled. */
export type AnalysisResultWithSources<Value> = Result<Value, AnalysisError> & {
  readonly sourceEvidence?: readonly Evidence[];
};

export const withEvidenceSources = <
  Outcome extends Result<unknown, AnalysisError>,
>(
  result: Outcome,
  sources: readonly Evidence[],
): Outcome & { readonly sourceEvidence?: readonly Evidence[] } =>
  sources.length === 0 ? result : { ...result, sourceEvidence: sources };

/** Retain producer sources; caller-owned records remain available without a writer. */
export const retainAnalysisResultSources = <Value>(
  operation: string,
  recordEvidence: EvidenceWriter["recordEvidence"] | undefined,
  result: AnalysisResultWithSources<Value>,
  options: { readonly sourceOwner?: "caller" } = {},
): Result<Value, AnalysisError> => {
  const sources = result.sourceEvidence ?? [];
  const retained =
    sources.length > 0 &&
    recordEvidence === undefined &&
    options.sourceOwner !== "caller"
      ? err(
          new AnalysisCapabilityUnavailableError(
            "rea",
            operation,
            "Provider source Evidence requires an explicit retention owner.",
            {
              userMessage:
                "Use an analysis session that retains provider source Evidence, or supply an Evidence recorder when registering this adapter.",
            },
          ),
        )
      : recordEvidenceSources(recordEvidence, sources);
  if (retained.ok) return result;
  if (result.ok) return retained;
  result.error.retainSecondaryFailure(retained.error);
  return result;
};

/** Record source evidence in order, stopping at the first session rejection. */
export const recordEvidenceSources = (
  recordEvidence: EvidenceWriter["recordEvidence"] | undefined,
  sources: readonly Evidence[],
): Result<null, EvidenceIntegrityError> => {
  for (const source of sources) {
    const recorded = recordEvidence?.(source);
    if (recorded !== undefined && !recorded.ok) return recorded;
  }
  return ok(null);
};
