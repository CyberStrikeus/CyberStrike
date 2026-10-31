import {
  callPathRequestSchema,
  staticRuntimeCorrelationRequestSchema,
} from "../../contracts/investigationInputContracts.js";
import {
  changedBehaviorInputSchema,
  findChangedBehavior,
} from "../../domain/changedBehavior.js";
import { buildCallPath } from "../../domain/callPath.js";
import { correlateStaticAndRuntime } from "../../domain/staticRuntimeCorrelation.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { readImmutableEvidence } from "../../domain/evidenceValidation.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  CALL_PATH_PROVIDER,
  CHANGED_BEHAVIOR_PROVIDER,
  STATIC_RUNTIME_PROVIDER,
} from "../../domain/investigationProviders.js";
import type { RecordUnknownInput } from "../../domain/residualUnknown.js";
import { err, ok, type Result } from "../../domain/result.js";
import { resolveEvidenceRequest } from "../EvidenceInputResolver.js";
import type { EvidenceReader } from "./InvestigationRecordPort.js";
import type { EvidenceWorkflowExecution } from "./EvidenceWorkflowExecution.js";
import { resolveInvestigationEvidenceClosure } from "./InvestigationEvidence.js";
import { workflowUnknownInput } from "./WorkflowUnknown.js";

export interface InvestigationWorkflowExecution extends EvidenceWorkflowExecution {
  readonly unknown: RecordUnknownInput | undefined;
}

type Reader = Pick<EvidenceReader, "evidenceForAnalysis">;
type UnknownDescription = {
  readonly question: string;
  readonly domain: string;
  readonly requiredAuthority: "shipped-artifact" | "controlled-replay" | null;
  readonly requiredConfidence: "observed" | "derived";
  readonly probes: readonly {
    readonly operation: string;
    readonly rationale: string;
  }[];
};

const finish = (
  evidence: Evidence,
  sources: readonly Evidence[],
  unresolved: boolean,
  description: UnknownDescription,
): Result<InvestigationWorkflowExecution, AnalysisError> => {
  if (!unresolved) return ok({ evidence, sources, unknown: undefined });
  const unknown = workflowUnknownInput(evidence.evidence_id, {
    question: description.question,
    severity: "high",
    domain: description.domain,
    required_authority: description.requiredAuthority,
    required_confidence: description.requiredConfidence,
    required_environment: null,
    recommended_probes: [...description.probes],
    relationships: [],
  });
  return unknown.ok
    ? ok({ evidence, sources, unknown: unknown.value })
    : unknown;
};

/** Compose exact existing dossiers without starting a provider or resending payloads. */
export const buildCallPathEvidence = (
  input: unknown,
  reader: Reader,
  signal?: AbortSignal,
): Result<InvestigationWorkflowExecution, AnalysisError> => {
  const selected = resolveEvidenceRequest(
    "build_call_path",
    input,
    callPathRequestSchema,
    reader.evidenceForAnalysis.bind(reader),
    {
      ...(signal === undefined ? {} : { signal }),
      referenceScope: "retained-closure",
      readEvidence: readImmutableEvidence,
    },
  );
  if (!selected.ok) return selected;
  try {
    const result = buildCallPath(selected.value.input);
    const sources = selected.value.input.functions;
    const closure = resolveInvestigationEvidenceClosure(
      reader,
      result.evidence_links,
      sources,
    );
    if (!closure.ok) return closure;
    const evidence = createEvidence(undefined, CALL_PATH_PROVIDER, {
      predicateType: "rea.call-path",
      operation: "build_call_path",
      parameters: {
        start: selected.value.input.start.address,
        goal: selected.value.input.goal.address,
      },
      result,
      confidence: "derived",
      authority: "analyst-inference",
      limitations: result.limitations,
      evidenceLinks: closure.value,
    });
    return finish(evidence, sources, result.status === "unknown", {
      question:
        "Can the requested call path be established from complete analysis?",
      domain: "call-path",
      requiredAuthority: "shipped-artifact",
      requiredConfidence: "derived",
      probes: [
        {
          operation: "analyze_function",
          rationale:
            "Collect complete callee dossiers for the reported frontier addresses.",
        },
      ],
    });
  } catch (cause: unknown) {
    if (cause instanceof AnalysisError) return err(cause);
    throw cause;
  }
};

/** Aggregate caller-selected comparisons and preserve their exact source closure. */
export const findChangedBehaviorEvidence = (
  input: unknown,
  reader: Reader,
  signal?: AbortSignal,
): Result<InvestigationWorkflowExecution, AnalysisError> => {
  const selected = resolveEvidenceRequest(
    "find_changed_behavior",
    input,
    changedBehaviorInputSchema,
    reader.evidenceForAnalysis.bind(reader),
    {
      ...(signal === undefined ? {} : { signal }),
      referenceScope: "retained-closure",
      readEvidence: readImmutableEvidence,
    },
  );
  if (!selected.ok) return selected;
  try {
    const { result, comparisonEvidenceIds } = findChangedBehavior(
      selected.value.input,
    );
    const sources = selected.value.input.comparisons;
    const closure = resolveInvestigationEvidenceClosure(
      reader,
      result.evidence_links,
      sources,
    );
    if (!closure.ok) return closure;
    const evidence = createEvidence(undefined, CHANGED_BEHAVIOR_PROVIDER, {
      predicateType: "rea.changed-behavior",
      operation: "find_changed_behavior",
      parameters: { comparison_evidence_ids: [...comparisonEvidenceIds] },
      result,
      confidence: "derived",
      authority: "analyst-inference",
      limitations: result.limitations,
      evidenceLinks: closure.value,
    });
    return finish(
      evidence,
      sources,
      result.behavior_status === "unknown" ||
        result.behavior_status === "truncated",
      {
        question:
          "Did both versions behave the same under a complete controlled replay?",
        domain: "changed-behavior",
        requiredAuthority: "controlled-replay",
        requiredConfidence: "observed",
        probes: [
          {
            operation: "capture_process_scenario",
            rationale:
              "Capture both versions under the same bounded scenario and environment.",
          },
        ],
      },
    );
  } catch (cause: unknown) {
    if (cause instanceof AnalysisError) return err(cause);
    throw cause;
  }
};

/** Keep correlation hypotheses explicit while resolving record transport centrally. */
export const correlateStaticAndRuntimeEvidence = (
  input: unknown,
  reader: Reader,
  signal?: AbortSignal,
): Result<InvestigationWorkflowExecution, AnalysisError> => {
  const selected = resolveEvidenceRequest(
    "correlate_static_and_runtime",
    input,
    staticRuntimeCorrelationRequestSchema,
    reader.evidenceForAnalysis.bind(reader),
    {
      ...(signal === undefined ? {} : { signal }),
      referenceScope: "retained-closure",
      readEvidence: readImmutableEvidence,
    },
  );
  if (!selected.ok) return selected;
  try {
    const result = correlateStaticAndRuntime(selected.value.input);
    const sources = [
      ...selected.value.input.static_comparisons,
      ...selected.value.input.runtime_comparisons,
    ];
    const closure = resolveInvestigationEvidenceClosure(
      reader,
      result.evidence_links,
      sources,
    );
    if (!closure.ok) return closure;
    const evidence = createEvidence(undefined, STATIC_RUNTIME_PROVIDER, {
      predicateType: "rea.static-runtime-correlation",
      operation: "correlate_static_and_runtime",
      parameters: { mapping_count: selected.value.input.mappings.length },
      result,
      confidence: "inferred",
      authority: "analyst-inference",
      limitations: result.limitations,
      evidenceLinks: closure.value,
    });
    return finish(
      evidence,
      sources,
      result.status === "unknown" || result.status === "truncated",
      {
        question: "Does runtime behavior match the available static analysis?",
        domain: "static-runtime-correlation",
        requiredAuthority: null,
        requiredConfidence: "derived",
        probes: [
          {
            operation: "capture_process_scenario",
            rationale:
              "Repeat runtime observations and complete the mapped static comparison Evidence.",
          },
        ],
      },
    );
  } catch (cause: unknown) {
    if (cause instanceof AnalysisError) return err(cause);
    throw cause;
  }
};
