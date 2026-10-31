import {
  addMissingEvidenceFindings,
  readinessFinding as finding,
} from "./reconstructionReadinessFindingHelpers.js";
import type {
  ReadinessFinding,
  ReconstructionReadinessInput,
} from "./reconstructionReadinessSchemas.js";

export const readinessIntegrityFindings = (
  input: ReconstructionReadinessInput,
  evidenceIds: ReadonlySet<string>,
  sourceDigest: string,
): ReadinessFinding[] => [
  ...comparisonFindings(input, evidenceIds),
  ...contradictionFindings(input, evidenceIds),
  ...closureFindings(input, evidenceIds),
  ...cleanupFindings(input, evidenceIds),
  ...replayFindings(input, evidenceIds, sourceDigest),
];

const comparisonFindings = (
  input: ReconstructionReadinessInput,
  evidenceIds: ReadonlySet<string>,
): ReadinessFinding[] => {
  const findings: ReadinessFinding[] = [];
  for (const comparison of input.comparisons) {
    const unsafeEquivalent =
      comparison.verdict === "equivalent" &&
      (comparison.truncated ||
        comparison.unavailable_authority ||
        comparison.unstable ||
        comparison.contradiction_ids.length > 0);
    if (unsafeEquivalent)
      findings.push(
        finding(
          "false-equivalence",
          "compare-authority-candidate",
          "fail",
          `${comparison.comparison_id} claims equivalence across incomplete or contradicted Evidence.`,
          comparison.evidence_ids,
        ),
      );
    if (
      comparison.concurrent &&
      comparison.schedule_semantics === "total-order"
    )
      findings.push(
        finding(
          "unsafe-concurrency-semantics",
          "compare-authority-candidate",
          "fail",
          `${comparison.comparison_id} uses total-order semantics for concurrent behavior.`,
          comparison.evidence_ids,
        ),
      );
    if (
      comparison.deliberate_divergence_ref !== null &&
      !comparison.divergence_refs.includes(comparison.deliberate_divergence_ref)
    )
      findings.push(
        finding(
          "divergence-not-localized",
          "compare-authority-candidate",
          "fail",
          `${comparison.comparison_id} did not localize its deliberate primary divergence.`,
          comparison.evidence_ids,
        ),
      );
    addMissingEvidenceFindings(
      findings,
      "compare-authority-candidate",
      comparison.evidence_ids,
      evidenceIds,
    );
  }
  return findings;
};

const contradictionFindings = (
  input: ReconstructionReadinessInput,
  evidenceIds: ReadonlySet<string>,
): ReadinessFinding[] => {
  const findings: ReadinessFinding[] = [];
  const comparisons = new Map(
    input.comparisons.map((comparison) => [
      comparison.comparison_id,
      comparison,
    ]),
  );
  for (const contradiction of input.contradictions) {
    if (
      contradiction.declared_sha256 === contradiction.observed_sha256 ||
      new Set(contradiction.evidence_ids).size < 2
    )
      findings.push(
        finding(
          "contradiction-proof-incomplete",
          "preserve-contradictions",
          "fail",
          `${contradiction.contradiction_id} must preserve distinct hashes and Evidence records.`,
          contradiction.evidence_ids,
        ),
      );
    for (const comparisonId of contradiction.affected_comparison_ids) {
      const comparison = comparisons.get(comparisonId);
      if (comparison === undefined)
        findings.push(
          finding(
            "contradiction-comparison-missing",
            "preserve-contradictions",
            "unknown",
            `Contradiction references missing comparison ${comparisonId}.`,
            contradiction.evidence_ids,
          ),
        );
      else if (
        comparison.verdict === "equivalent" ||
        !comparison.contradiction_ids.includes(contradiction.contradiction_id)
      )
        findings.push(
          finding(
            "contradiction-equivalence-not-blocked",
            "preserve-contradictions",
            "fail",
            `${comparisonId} does not preserve contradiction ${contradiction.contradiction_id}.`,
            contradiction.evidence_ids,
          ),
        );
    }
    addMissingEvidenceFindings(
      findings,
      "preserve-contradictions",
      contradiction.evidence_ids,
      evidenceIds,
    );
  }
  return findings;
};

const closureFindings = (
  input: ReconstructionReadinessInput,
  evidenceIds: ReadonlySet<string>,
): ReadinessFinding[] => {
  const findings: ReadinessFinding[] = [];
  if (input.obligation_ledger.summary.required === 0)
    findings.push(
      finding(
        "reconstruction-obligations-empty",
        "verify-reconstruction-closure",
        "unknown",
        "A ready ledger must include at least one required reconstruction obligation.",
      ),
    );
  if (
    input.obligation_ledger.status !== "ready" ||
    input.obligation_ledger.summary.required_open > 0
  )
    findings.push(
      finding(
        "reconstruction-closure-open",
        "verify-reconstruction-closure",
        "unknown",
        `Obligation ledger is ${input.obligation_ledger.status} with ${String(input.obligation_ledger.summary.required_open)} required obligations open.`,
        input.obligation_ledger.evidence_links,
      ),
    );
  addMissingEvidenceFindings(
    findings,
    "verify-reconstruction-closure",
    input.obligation_ledger.evidence_links,
    evidenceIds,
  );
  evaluateClosureHistory(input, findings, evidenceIds);
  for (const check of input.delegation_checks) {
    if (check.delegates_to_authority)
      findings.push(
        finding(
          "candidate-delegates-to-authority",
          "verify-reconstruction-closure",
          "fail",
          `${check.candidate_id} delegates behavior back to the authority.`,
          check.evidence_ids,
        ),
      );
    addMissingEvidenceFindings(
      findings,
      "verify-reconstruction-closure",
      check.evidence_ids,
      evidenceIds,
    );
  }
  return findings;
};

const evaluateClosureHistory = (
  input: ReconstructionReadinessInput,
  findings: ReadinessFinding[],
  evidenceIds: ReadonlySet<string>,
): void => {
  const history = [...input.closure_history].sort(
    (left, right) => left.sequence - right.sequence,
  );
  if (
    new Set(history.map(({ sequence }) => sequence)).size !== history.length ||
    history.at(-1)?.ledger_digest !== input.obligation_ledger.closure_digest
  )
    findings.push(
      finding(
        "closure-history-identity-mismatch",
        "verify-reconstruction-closure",
        "fail",
        "Closure history sequences must be unique and end at the supplied ledger digest.",
      ),
    );
  if (
    history[0]?.required_open === 0 ||
    history.at(-1)?.required_open !== 0 ||
    history.at(-1)?.status !== "ready"
  )
    findings.push(
      finding(
        "incremental-closure-history-missing",
        "verify-reconstruction-closure",
        "unknown",
        "Closure history must begin partial and end ready with zero required obligations open.",
      ),
    );
  const verifiedRequiredIds = new Set(
    input.obligation_ledger.obligations
      .filter(({ required, status }) => required && status === "verified")
      .map(({ obligation_id }) => obligation_id),
  );
  const previouslyVerifiedIds = new Set<string>();
  for (const [index, observation] of history.entries()) {
    const previous = history[index - 1];
    const newlyVerifiedIds = new Set(observation.newly_verified_obligation_ids);
    if (
      (observation.status === "ready" && observation.required_open !== 0) ||
      ((observation.status === "open" || observation.status === "failed") &&
        observation.required_open === 0) ||
      observation.required_open > input.obligation_ledger.summary.required ||
      newlyVerifiedIds.size !==
        observation.newly_verified_obligation_ids.length ||
      [...newlyVerifiedIds].some((id) => previouslyVerifiedIds.has(id)) ||
      (previous === undefined
        ? newlyVerifiedIds.size !== 0
        : observation.required_open > previous.required_open ||
          newlyVerifiedIds.size !==
            previous.required_open - observation.required_open)
    )
      findings.push(
        finding(
          "invalid-obligation-closure-transition",
          "verify-reconstruction-closure",
          "fail",
          `Closure observation ${String(observation.sequence)} must establish the starting count without claiming a transition, report zero required obligations open when ready, a positive open count when open or failed, and count only distinct, previously uncounted required obligations within the ledger's required count.`,
          observation.evidence_ids,
        ),
      );
    if ([...newlyVerifiedIds].some((id) => !verifiedRequiredIds.has(id)))
      findings.push(
        finding(
          "closure-obligation-proof-missing",
          "verify-reconstruction-closure",
          "fail",
          `Closure observation ${String(observation.sequence)} names an obligation without verified required ledger proof.`,
          observation.evidence_ids,
        ),
      );
    for (const id of newlyVerifiedIds) previouslyVerifiedIds.add(id);
    addMissingEvidenceFindings(
      findings,
      "verify-reconstruction-closure",
      observation.evidence_ids,
      evidenceIds,
    );
  }
};

const cleanupFindings = (
  input: ReconstructionReadinessInput,
  evidenceIds: ReadonlySet<string>,
): ReadinessFinding[] => {
  const findings: ReadinessFinding[] = [];
  for (const cleanup of input.cleanup) {
    if (cleanup.owned_resources_remaining > 0)
      findings.push(
        finding(
          "owned-resource-leak",
          "reactive-scenarios",
          "fail",
          `${cleanup.run_id} retained ${String(cleanup.owned_resources_remaining)} owned resources.`,
          cleanup.diagnostic_evidence_ids,
        ),
      );
    if (cleanup.cancelled && cleanup.diagnostic_evidence_ids.length === 0)
      findings.push(
        finding(
          "cancelled-diagnostic-evidence-missing",
          "reactive-scenarios",
          "unknown",
          `${cleanup.run_id} cancellation retained no diagnostic Evidence.`,
        ),
      );
    addMissingEvidenceFindings(
      findings,
      "reactive-scenarios",
      cleanup.diagnostic_evidence_ids,
      evidenceIds,
    );
  }
  for (const grant of input.grants) {
    if (
      ["denied", "cancelled"].includes(grant.decision) &&
      grant.launched_process
    )
      findings.push(
        finding(
          "denied-authority-launched-process",
          "acquire-authority",
          "fail",
          `${grant.grant_id} launched a process after ${grant.decision}.`,
          grant.evidence_ids,
        ),
      );
    addMissingEvidenceFindings(
      findings,
      "acquire-authority",
      grant.evidence_ids,
      evidenceIds,
    );
  }
  return findings;
};

const replayFindings = (
  input: ReconstructionReadinessInput,
  evidenceIds: ReadonlySet<string>,
  sourceDigest: string,
): ReadinessFinding[] => {
  const findings: ReadinessFinding[] = [];
  if (!input.replay.deterministic)
    findings.push(
      finding(
        "replay-nondeterministic",
        "export-replay",
        "fail",
        "Clean replay did not reproduce the same semantic report.",
        input.replay.evidence_ids,
      ),
    );
  if (!input.replay.tamper_detected)
    findings.push(
      finding(
        "tamper-not-detected",
        "export-replay",
        "fail",
        "The conformance replay did not reject a tampered input.",
        input.replay.evidence_ids,
      ),
    );
  if (!input.replay.stale_input_detected)
    findings.push(
      finding(
        "stale-input-not-detected",
        "export-replay",
        "fail",
        "The conformance replay did not reject a stale digest.",
        input.replay.evidence_ids,
      ),
    );
  if (
    input.replay.expected_source_digest !== null &&
    input.replay.expected_source_digest !== sourceDigest
  )
    findings.push(
      finding(
        "replay-source-digest-mismatch",
        "export-replay",
        "fail",
        `Expected ${input.replay.expected_source_digest}; observed ${sourceDigest}.`,
        input.replay.evidence_ids,
      ),
    );
  addMissingEvidenceFindings(
    findings,
    "export-replay",
    input.replay.evidence_ids,
    evidenceIds,
  );
  return findings;
};
