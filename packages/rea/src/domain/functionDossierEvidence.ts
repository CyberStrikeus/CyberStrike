import type { Evidence } from "./evidence.js";
import { AnalysisInputError } from "./analysisErrorCore.js";
import type { EvidenceIntegrityError } from "./evidenceErrors.js";
import { readEvidence, readEvidencePayload } from "./evidenceValidation.js";
import type { JsonValue } from "./jsonValue.js";
import { err, ok, type Result } from "./result.js";
import { compareUnicodeCodePoints } from "./unicodeCodePointOrder.js";
import {
  functionDossierSchema,
  type FunctionDossier,
} from "./native/functionDossier.js";
import { assessFunctionCallCoverage } from "./functionCallCoverage.js";
import { functionCoordinateContextsEqual } from "./native/functionCoordinateContext.js";

/** Complete function observation parsed from one analyze_function Evidence record. */
export interface FunctionSnapshot {
  readonly evidence: Evidence;
  readonly subject: NonNullable<Evidence["subject"]>;
  readonly dossier: FunctionDossier;
  readonly limitations: readonly string[];
  readonly callCoverageBlockers: readonly string[];
  readonly unresolvedCallCaveats: readonly string[];
  readonly callCoverageDiagnostics: readonly string[];
}

/** Artifact identity and provider-owned mapping jointly establish coordinate applicability. */
export type FunctionSnapshotCoordinateContext =
  | "common"
  | "cross-artifact"
  | "unknown";

export const functionSnapshotCoordinateContext = (
  left: FunctionSnapshot,
  right: FunctionSnapshot,
): FunctionSnapshotCoordinateContext => {
  if (left.subject.digest.sha256 !== right.subject.digest.sha256)
    return "cross-artifact";
  return left.subject.format === right.subject.format &&
    left.subject.architecture !== null &&
    left.subject.architecture === right.subject.architecture &&
    functionCoordinateContextsEqual(
      left.evidence.analysis_profile,
      right.evidence.analysis_profile,
    )
    ? "common"
    : "unknown";
};

/** Parse one complete analyze_function Evidence record for comparison workflows. */
export const parseFunctionEvidence = (
  input: unknown,
  selection: {
    readonly operation: "compare_functions" | "build_call_path";
    readonly path: readonly (string | number)[];
  },
): Result<FunctionSnapshot, AnalysisInputError | EvidenceIntegrityError> => {
  const parsed = readEvidence(input);
  if (!parsed.ok) return parsed;
  const evidence = parsed.value;
  const invalidSelection = (message: string, expected?: JsonValue) =>
    err(
      new AnalysisInputError(selection.operation, { userMessage: message }, [
        {
          path: selection.path,
          reason: "invalid_value",
          message,
          ...(expected === undefined ? {} : { expected }),
        },
      ]),
    );
  if (
    evidence.operation !== "analyze_function" ||
    evidence.predicate_type !== "rea.analysis"
  ) {
    const location = selection.path.map(String).join(".");
    const subject =
      location === ""
        ? "supplied Evidence"
        : selection.path.length === 1
          ? `${location} Evidence`
          : `Evidence at ${location}`;
    return invalidSelection(
      `Function analysis requires analyze_function Evidence with the rea.analysis predicate; the ${subject} has operation ${evidence.operation} and predicate ${evidence.predicate_type}.`,
      { operation: "analyze_function", predicate_type: "rea.analysis" },
    );
  }
  if (evidence.subject === null)
    return invalidSelection(
      "Function analysis requires artifact-bound Evidence",
    );
  const dossier = readEvidencePayload(
    functionDossierSchema,
    evidence.normalized_result,
  );
  if (!dossier.ok) return dossier;
  const callCoverage = assessFunctionCallCoverage(
    evidence.relationship_coverage,
    dossier.value,
  );
  return ok({
    evidence,
    subject: evidence.subject,
    dossier: dossier.value,
    limitations: [
      ...new Set([...evidence.limitations, ...dossier.value.limitations]),
    ].sort((left, right) => compareUnicodeCodePoints(left, right)),
    callCoverageBlockers: callCoverage.blockers,
    unresolvedCallCaveats: callCoverage.unresolvedCallCaveats,
    callCoverageDiagnostics: callCoverage.diagnostics,
  });
};
