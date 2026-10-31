import { processComparisonInputSchema } from "../../contracts/processComparisonContracts.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { describeValidationFailure } from "../../domain/validationFailure.js";
import { EvidenceIntegrityError } from "../../domain/evidenceErrors.js";
import {
  PROCESS_COMPARISON_DIMENSIONS,
  type ProcessCaptureComparison,
} from "../../domain/process/processComparison.js";
import {
  compareProcessCaptureEvidence,
  type ParsedProcessCaptureEvidence,
} from "../../domain/process/processComparisonEvidence.js";
import { PROCESS_PROVIDER } from "../../domain/process/processEvidenceProvider.js";
import type { RecordUnknownInput } from "../../domain/residualUnknown.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  parseProcessCaptureEvidence,
  type ProcessCaptureEvidenceFailure,
} from "./ProcessEvidence.js";
import {
  resolveEvidenceRequest,
  type EvidenceLookup,
} from "../EvidenceInputResolver.js";
import type { EvidenceWorkflowExecution } from "../investigation/EvidenceWorkflowExecution.js";

interface ProcessComparisonExecution extends EvidenceWorkflowExecution {
  readonly unknown: RecordUnknownInput | undefined;
}

/** Shared exact-source selection and process-capture interpretation for CLI/MCP. */
export const compareProcessEvidence = (
  input: unknown,
  lookup?: EvidenceLookup,
  options: {
    readonly signal?: AbortSignal;
    readonly now?: () => number;
  } = {},
): Result<ProcessComparisonExecution, AnalysisError> => {
  const selected = resolveEvidenceRequest(
    "compare_process_captures",
    input,
    processComparisonInputSchema,
    lookup,
    options,
  );
  if (!selected.ok) return selected;
  const request = selected.value.input;
  const left = readProcessComparisonSource("left", request.left);
  if (!left.ok) return left;
  const right = readProcessComparisonSource("right", request.right);
  if (!right.ok) return right;
  return compareParsedProcessEvidence(left.value, right.value, {
    ...(request.max_capture_age_ms === undefined
      ? {}
      : { maxCaptureAgeMs: request.max_capture_age_ms }),
    ...(request.trace_spec === undefined
      ? {}
      : { traceSpecification: request.trace_spec }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
};

/** Compare authenticated facts without reinterpreting or copying source carriers. */
export const compareParsedProcessEvidence = (
  left: ParsedProcessCaptureEvidence,
  right: ParsedProcessCaptureEvidence,
  options: Parameters<typeof compareProcessCaptureEvidence>[2] = {},
): Result<ProcessComparisonExecution, AnalysisError> => {
  try {
    const { comparison, evidence } = compareProcessCaptureEvidence(
      left,
      right,
      options,
    );
    return ok({
      evidence,
      sources: [left.record, right.record],
      unknown: comparisonUnknownInput(
        {
          left_evidence_id: left.record.evidence_id,
          right_evidence_id: right.record.evidence_id,
          comparison_evidence_id: evidence.evidence_id,
        },
        comparison,
      ),
    });
  } catch (cause: unknown) {
    if (cause instanceof AnalysisError) return err(cause);
    throw cause;
  }
};

/** Authenticate each selected capture before a caller admits its next source. */
export const readProcessComparisonSource = (
  side: "left" | "right",
  value: unknown,
  projectFailure?: (
    failure: ProcessCaptureEvidenceFailure,
    side: "left" | "right",
    input: unknown,
  ) => AnalysisError,
): Result<ParsedProcessCaptureEvidence, AnalysisError> => {
  const operation = "compare_process_captures";
  const parsed = parseProcessCaptureEvidence(value);
  if (parsed.ok) return parsed;
  const failure = parsed.error;
  if (projectFailure !== undefined)
    return err(projectFailure(failure, side, value));
  switch (failure.kind) {
    case "invalid-evidence":
      return err(
        new EvidenceIntegrityError(`${side} Evidence failed validation`, {
          cause: failure.cause,
          userMessage: `The ${side} Evidence failed validation (${describeValidationFailure(failure.cause)}). Supply unmodified capture Evidence from capture_process_scenario.`,
        }),
      );
    case "wrong-workflow":
      return err(
        new AnalysisInputError(operation, undefined, [
          {
            path: [side],
            reason: "invalid_value",
            message: `Expected process capture Evidence (operation ${failure.expected.operation}, predicate ${failure.expected.predicate}); the ${side} Evidence has operation ${failure.actual.operation} and predicate ${failure.actual.predicate}.`,
          },
        ]),
      );
    case "unsupported-provider":
      return err(
        new AnalysisInputError(operation, undefined, [
          {
            path: [side, "provider"],
            reason: "invalid_value",
            message: `The ${side} Evidence provider ${failure.provider.id} v${failure.provider.version} (${failure.provider.name}) is not the current or supported legacy ${PROCESS_PROVIDER.id} v${PROCESS_PROVIDER.version} process capture provider.`,
          },
        ]),
      );
    case "invalid-capture":
      return err(
        new EvidenceIntegrityError(
          `${side} process capture failed validation`,
          {
            cause: failure.cause,
            userMessage: `The ${side} Evidence has an invalid process capture result (${describeValidationFailure(failure.cause)}). Recreate the capture with capture_process_scenario.`,
          },
        ),
      );
  }
};

const comparisonUnknownInput = (
  parsed: {
    readonly left_evidence_id: string;
    readonly right_evidence_id: string;
    readonly comparison_evidence_id: string;
  },
  comparison: ProcessCaptureComparison,
): RecordUnknownInput | undefined => {
  if (comparison.status === "unchanged") return undefined;
  const differingScopes = PROCESS_COMPARISON_DIMENSIONS.filter(
    (dimension) => comparison[dimension] !== "unchanged",
  ).join(", ");
  const contradictory =
    comparison.status === "changed" &&
    parsed.left_evidence_id !== parsed.right_evidence_id;
  // Unknown identity uses the question, not its supporting records. Bind the
  // question to this comparison so distinct capture pairs and policies coexist.
  return {
    question: `${contradictory ? "Process captures disagree" : `Process comparison is ${comparison.status}`} across: ${differingScopes} (comparison ${parsed.comparison_evidence_id})`,
    severity: "high",
    domain: "process-comparison",
    supporting_evidence_ids: contradictory
      ? [parsed.left_evidence_id]
      : [...new Set([parsed.left_evidence_id, parsed.right_evidence_id])],
    contradicting_evidence_ids: contradictory ? [parsed.right_evidence_id] : [],
    required_authority: "controlled-replay",
    required_confidence: "observed",
    required_environment: null,
    recommended_probes: [
      {
        operation: "capture_process_scenario",
        rationale:
          "Repeat both scenarios under the same controlled environment.",
      },
    ],
    relationships: [],
  };
};
