import {
  resolveEvidenceRequest,
  type EvidenceLookup,
} from "../EvidenceInputResolver.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  createEvidence,
  type Evidence,
  type EvidenceSubjectTarget,
} from "../../domain/evidence.js";
import {
  managedApplicationGraphReferenceInputSchema,
  projectManagedGraph,
  readManagedGraphProjection,
  type ManagedApplicationGraphResult,
  type ManagedGraphProjection,
  type ParsedManagedGraphInput,
} from "../../domain/managed/managedApplicationGraph.js";
import { ok, type Result } from "../../domain/result.js";
import { MANAGED_WORKFLOW_PROVIDER } from "../../domain/investigationProviders.js";

const OPERATION = "project_managed_application_graph" as const;

/** Project authenticated managed Evidence into a provider-neutral graph. */
export const projectManagedApplicationGraphEvidence = (
  rawInput: unknown,
  lookup?: EvidenceLookup,
  options: Pick<ExecutionOptions, "signal"> = {},
): Result<Evidence, AnalysisError> => {
  const request = resolveManagedGraphEvidenceInput(rawInput, lookup, options);
  if (!request.ok) return request;
  return ok(projectManagedGraphEvidence(request.value));
};

/** Resolve selected records before the managed owner authenticates and joins them. */
export const resolveManagedGraphEvidenceInput = (
  rawInput: unknown,
  lookup?: EvidenceLookup,
  options: Pick<ExecutionOptions, "signal"> = {},
): Result<ManagedGraphProjection, AnalysisError> => {
  const request = resolveEvidenceRequest(
    OPERATION,
    rawInput,
    managedApplicationGraphReferenceInputSchema,
    lookup,
    options,
  );
  return request.ok ? readManagedGraphProjection(request.value.input) : request;
};

/** Project the workflow owner's authenticated, identity-checked source facts. */
export const projectManagedGraphEvidence = (
  request: ManagedGraphProjection,
): Evidence =>
  createManagedApplicationGraphEvidence(
    request.sources,
    projectManagedGraph(request),
  );

const createManagedApplicationGraphEvidence = (
  input: ParsedManagedGraphInput,
  result: ManagedApplicationGraphResult,
): Evidence =>
  createEvidence(subjectTarget(input), MANAGED_WORKFLOW_PROVIDER, {
    predicateType: "rea.managed-application-graph",
    operation: OPERATION,
    parameters: {
      managed_artifact_evidence_id:
        input.artifact?.evidence.evidence_id ?? null,
      managed_members_evidence_id: input.members?.evidence.evidence_id ?? null,
      managed_native_boundaries_evidence_id:
        input.boundaries?.evidence.evidence_id ?? null,
    },
    result,
    rawResult: null,
    confidence: "inferred",
    authority: "analyst-inference",
    environment: null,
    limitations: result.limitations,
    evidenceLinks: result.evidence_links,
  });

const subjectTarget = (
  input: ParsedManagedGraphInput,
): EvidenceSubjectTarget | undefined => {
  const subject =
    input.artifact?.evidence.subject ??
    input.members?.evidence.subject ??
    input.boundaries?.evidence.subject;
  if (subject === undefined || subject === null || subject.format !== "pe")
    return undefined;
  return {
    path: subject.local_path,
    sha256: subject.digest.sha256,
    format: "pe",
    ...(subject.architecture === null
      ? {}
      : { architecture: subject.architecture }),
  };
};
