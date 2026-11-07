import {
  createEvidence,
  type Evidence,
  type EvidenceCreationOptions,
  type EvidenceLocation,
  type EvidenceProvider,
  type EvidenceSubjectTarget,
} from "./evidence.js";
import type { AnalysisProfileCommitment } from "./analysisProfile.js";
import type { JsonValue } from "./jsonValue.js";
import type { RelationshipCoverage } from "./relationshipCoverage.js";

/** Provider observations that can be committed to Evidence. */
export interface AnalysisObservation {
  readonly result: JsonValue;
  readonly rawResult: JsonValue | null;
  readonly provider: EvidenceProvider;
  readonly analysisProfile?: AnalysisProfileCommitment;
  readonly limitations: readonly string[];
  /** Provider-owned completeness assessment for caller/callee observations. */
  readonly relationshipCoverage?: RelationshipCoverage;
  readonly locations: readonly EvidenceLocation[];
  /** Atomic source records supplied by the producer, with links derived from their identities. */
  readonly sourceEvidence?: readonly Evidence[];
  /**
   * Missing means the selected operation's default subject should be bound by
   * its caller. Explicit null means the observation has no file subject.
   */
  readonly subject?: EvidenceSubjectTarget | null;
}

/** Commit identical facts on success and when retaining a completed observation after cancellation. */
export const createAnalysisExecutionEvidence = (
  operation: string,
  input: unknown,
  execution: AnalysisObservation,
  confidence: "observed" | "derived",
  options?: EvidenceCreationOptions,
): Evidence =>
  createEvidence(
    execution.subject === undefined
      ? undefined
      : (execution.subject ?? undefined),
    execution.provider,
    {
      operation,
      parameters: input,
      result: execution.result,
      rawResult: execution.rawResult,
      limitations: execution.limitations,
      ...(execution.analysisProfile === undefined
        ? {}
        : { analysisProfile: execution.analysisProfile }),
      ...(execution.relationshipCoverage === undefined
        ? {}
        : { relationshipCoverage: execution.relationshipCoverage }),
      locations: execution.locations,
      evidenceLinks:
        execution.sourceEvidence?.map(({ evidence_id }) => evidence_id) ?? [],
      confidence,
    },
    options,
  );
