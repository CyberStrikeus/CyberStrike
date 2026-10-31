import type { BinarySessionPort } from "../application/binary/BinarySessionPort.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { Evidence } from "../domain/evidence.js";
import type { RecordUnknownInput } from "../domain/residualUnknown.js";
import { ok, type Result } from "../domain/result.js";

/** Atomically record derived Evidence with an optional supported unknown. */
export const recordDerivedEvidence = (
  session: BinarySessionPort,
  evidence: Evidence,
  unknown: RecordUnknownInput | undefined,
): Result<Evidence, AnalysisError> => {
  if (unknown !== undefined) {
    const recorded = session.recordEvidenceWithUnknown(evidence, unknown);
    return recorded.ok ? ok(evidence) : recorded;
  }
  const recorded = session.recordEvidence(evidence);
  return recorded.ok ? ok(evidence) : recorded;
};
