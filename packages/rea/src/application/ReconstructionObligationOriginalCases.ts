import type { Evidence } from "../domain/evidence.js";
import type { ReconstructionObligation } from "../domain/reconstructionObligationLedgerSchemas.js";
import { evidenceSupportsOriginalAuthority } from "./ReconstructionObligationAuthority.js";
import type { ReconstructionObligationCandidate } from "./ReconstructionObligationCandidates.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";

type Binding = NonNullable<ReconstructionObligation["binding"]>;
type Diagnostic = ReconstructionObligation["diagnostics"][number];

/** Merge generated and manifest-supplied original observations canonically. */
export const originalCasesFor = (
  candidate: ReconstructionObligationCandidate,
  binding: Binding | null,
): ReconstructionObligation["observed_cases"] =>
  [
    ...new Map(
      [...candidate.observed_cases, ...(binding?.original_cases ?? [])].map(
        (observed) => [
          `${observed.kind}:${observed.evidence_id}:${observed.location}`,
          observed,
        ],
      ),
    ).values(),
  ].sort((left, right) =>
    compareUnicodeCodePoints(
      `${left.kind}:${left.evidence_id}:${left.location}`,
      `${right.kind}:${right.evidence_id}:${right.location}`,
    ),
  );

/** Report original cases that are absent or lack comparable Evidence authority. */
export const originalCaseDiagnostics = (
  candidate: ReconstructionObligationCandidate,
  originalCases: ReconstructionObligation["observed_cases"],
  evidenceById: ReadonlyMap<string, Evidence>,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  // Retain optional case rows, but never leave one of their Evidence links
  // unresolved merely because its kind is not required for closure.
  for (const { kind, evidence_id: evidenceId } of originalCases)
    if (!evidenceById.has(evidenceId))
      diagnostics.push({
        code: "missing-original-case",
        detail: `Original ${kind} case references Evidence ${evidenceId}, which is absent from the bundle.`,
      });
  for (const caseKind of candidate.required_case_kinds) {
    const cases = originalCases.filter(({ kind }) => kind === caseKind);
    if (cases.length === 0) {
      diagnostics.push({
        code: "missing-original-case",
        detail: `Original ${caseKind} behavior has not been observed.`,
      });
      continue;
    }
    if (
      !cases.some(({ evidence_id: evidenceId }) => {
        const evidence = evidenceById.get(evidenceId);
        return (
          evidence !== undefined &&
          evidenceSupportsOriginalAuthority(
            evidence,
            candidate.required_original_authority,
          )
        );
      })
    )
      diagnostics.push({
        code: "weak-original-case-authority",
        detail: `Original ${caseKind} behavior lacks ${candidate.required_original_authority} Evidence.`,
      });
  }
  return diagnostics;
};
