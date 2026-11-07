import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { createEvidence, type Evidence } from "../domain/evidence.js";
import type { ReconstructionObligationLedger } from "../domain/reconstructionObligationLedgerSchemas.js";
import { ok, type Result } from "../domain/result.js";
import { JAVASCRIPT_APPLICATION_WORKFLOW_PROVIDER } from "../domain/investigationProviders.js";
import { deriveReconstructionObligationCandidates } from "./ReconstructionObligationCandidates.js";
import { evaluateReconstructionObligationLedger } from "./ReconstructionObligationLedgerEvaluation.js";
import {
  resolveReconstructionObligationLedgerRequest,
  type ResolvedReconstructionObligationRequest,
} from "./ReconstructionObligationLedgerRequest.js";

const OPERATION = "build_reconstruction_obligation_ledger";

/** Build portable ledger Evidence from a caller-selected request. */
export const buildReconstructionObligationLedgerEvidence = (
  input: unknown,
): Result<Evidence, AnalysisError> => {
  const request = resolveReconstructionObligationLedgerRequest(input);
  if (!request.ok) return request;
  return ok(buildResolvedReconstructionObligationLedgerEvidence(request.value));
};

/** Generate and evaluate against the same authenticated bundle and record index. */
export const buildResolvedReconstructionObligationLedgerEvidence = (
  request: ResolvedReconstructionObligationRequest,
): Evidence => {
  const generated = deriveReconstructionObligationCandidates(request);
  const ledger = evaluateReconstructionObligationLedger({
    candidates: generated.candidates,
    sources: request.sources,
    manifest: request.manifest,
    generationLimitations: generated.limitations,
  });
  return createLedgerEvidence(ledger);
};

const createLedgerEvidence = (
  ledger: ReconstructionObligationLedger,
): Evidence =>
  createEvidence(undefined, JAVASCRIPT_APPLICATION_WORKFLOW_PROVIDER, {
    predicateType: "rea.reconstruction-obligation-ledger",
    operation: OPERATION,
    parameters: {
      ledger_id: ledger.ledger_id,
      closure_digest: ledger.closure_digest,
    },
    result: ledger,
    rawResult: null,
    confidence: "inferred",
    authority: "analyst-inference",
    environment: null,
    limitations: ledger.limitations,
    evidenceLinks: ledger.evidence_links,
  });
