import type { BinarySessionPort } from "../../application/binary/BinarySessionPort.js";
import type { Evidence } from "../../domain/evidence.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Result } from "../../domain/result.js";
import { recordDerivedEvidence } from "../recordDerivedEvidence.js";
import { workflowUnknownInput } from "../../application/investigation/WorkflowUnknown.js";
import type { WorkflowUnknownInput } from "./types.js";

export const recordWorkflowEvidence = (
  ...[session, evidence, unresolved, input]: readonly [
    session: BinarySessionPort,
    evidence: Evidence,
    unresolved: boolean,
    input: WorkflowUnknownInput,
  ]
): Result<Evidence, AnalysisError> => {
  if (!unresolved) {
    return recordDerivedEvidence(session, evidence, undefined);
  }
  const unknown = workflowUnknownInput(evidence.evidence_id, {
    question: input.question,
    severity: "high",
    domain: input.domain,
    required_authority: input.requiredAuthority,
    required_confidence: input.requiredConfidence,
    required_environment: null,
    recommended_probes: [...input.probes],
    relationships: [],
  });
  return unknown.ok
    ? recordDerivedEvidence(session, evidence, unknown.value)
    : unknown;
};
