import { functionComparisonInputSchema } from "../../domain/functionComparisonSchemas.js";
import { FUNCTION_COMPARISON_PROVIDER } from "../../domain/comparisonEvidenceIdentity.js";
import { compareFunctions } from "../../domain/functionComparison.js";
import { parseFunctionEvidence } from "../../domain/functionDossierEvidence.js";
import { createEvidence } from "../../domain/evidence.js";
import { uniqueSorted } from "../../domain/canonicalOrdering.js";
import type { RecordUnknownInput } from "../../domain/residualUnknown.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  resolveEvidenceRequest,
  type EvidenceLookup,
} from "../EvidenceInputResolver.js";
import type { EvidenceWorkflowExecution } from "./EvidenceWorkflowExecution.js";

export interface FunctionComparisonExecution extends EvidenceWorkflowExecution {
  readonly unknown: RecordUnknownInput | undefined;
}

/** Resolve selected records once, then compare their producer-owned typed facts. */
export const compareFunctionEvidence = (
  input: unknown,
  lookup?: EvidenceLookup,
  signal?: AbortSignal,
): Result<FunctionComparisonExecution, AnalysisError> => {
  const selected = resolveEvidenceRequest(
    "compare_functions",
    input,
    functionComparisonInputSchema,
    lookup,
    signal === undefined ? {} : { signal },
  );
  if (!selected.ok) return selected;
  const left = parseFunctionEvidence(selected.value.input.left, {
    operation: "compare_functions",
    path: ["left"],
  });
  if (!left.ok) return left;
  const right = parseFunctionEvidence(selected.value.input.right, {
    operation: "compare_functions",
    path: ["right"],
  });
  if (!right.ok) return right;
  try {
    const comparison = compareFunctions(left.value, right.value);
    const leftEvidence = left.value.evidence;
    const rightEvidence = right.value.evidence;
    const leftIds = [leftEvidence.evidence_id];
    const rightIds = [rightEvidence.evidence_id];
    const evidence = createEvidence(undefined, FUNCTION_COMPARISON_PROVIDER, {
      predicateType: "rea.function-comparison",
      operation: "compare_functions",
      parameters: {
        left_evidence_id: leftEvidence.evidence_id,
        right_evidence_id: rightEvidence.evidence_id,
      },
      result: comparison,
      confidence: "derived",
      authority: "analyst-inference",
      limitations: comparison.limitations,
      evidenceLinks: [...leftIds, ...rightIds],
    });
    return ok({
      evidence,
      sources: [leftEvidence, rightEvidence],
      unknown: comparisonUnknownInput(
        comparison,
        leftIds,
        rightIds,
        evidence.evidence_id,
      ),
    });
  } catch (cause: unknown) {
    if (cause instanceof AnalysisError) return err(cause);
    throw cause;
  }
};

const comparisonUnknownInput = (
  comparison: ReturnType<typeof compareFunctions>,
  leftIds: readonly string[],
  rightIds: readonly string[],
  comparisonEvidenceId: string,
): RecordUnknownInput | undefined =>
  functionUnknownInput({
    status: comparison.status,
    dimensions: comparison.dimensions
      .filter(({ status }) =>
        comparison.status === "unknown"
          ? status === "unknown"
          : status === "changed",
      )
      .map(({ dimension }) => dimension),
    leftIds,
    rightIds,
    comparisonEvidenceId,
  });

const functionUnknownInput = ({
  status,
  dimensions,
  leftIds,
  rightIds,
  comparisonEvidenceId,
}: {
  status: ReturnType<typeof compareFunctions>["status"];
  dimensions: readonly ReturnType<
    typeof compareFunctions
  >["dimensions"][number]["dimension"][];
  leftIds: readonly string[];
  rightIds: readonly string[];
  comparisonEvidenceId: string;
}): RecordUnknownInput | undefined => {
  if (status === "unchanged") return undefined;
  const supportingIds = [
    ...new Set([...leftIds, ...rightIds, comparisonEvidenceId]),
  ];
  const contradictingIds = rightIds.filter((id) => !leftIds.includes(id));
  const contradictory = status === "changed";
  return {
    question: `Function comparison is ${status} (comparison ${comparisonEvidenceId})`,
    severity: status === "changed" ? "medium" : "high",
    domain: "function-comparison",
    comparison_conclusion_scope: {
      comparison_evidence_id: comparisonEvidenceId,
      dimensions: uniqueSorted([
        ...(status === "unknown" || dimensions.length === 0
          ? ["overall" as const]
          : []),
        ...dimensions,
      ]),
    },
    supporting_evidence_ids: contradictory
      ? [...leftIds, comparisonEvidenceId]
      : supportingIds,
    contradicting_evidence_ids: contradictory ? contradictingIds : [],
    required_authority: "shipped-artifact",
    required_confidence: "observed",
    required_environment: null,
    recommended_probes: [
      {
        operation: "analyze_function",
        rationale:
          "Capture complete dossiers for both functions under the same target context.",
      },
    ],
    relationships: [],
  };
};
