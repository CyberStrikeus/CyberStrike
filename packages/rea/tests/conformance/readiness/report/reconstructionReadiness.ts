import { digestCanonicalValue } from "../../../../src/domain/canonicalDigest.js";
import { authenticateParsedEvidenceBundle } from "../../../../src/domain/evidenceBundle.js";
import { readinessFindingOrder } from "./reconstructionReadinessFindingHelpers.js";
import { readinessJourneyFindings } from "./reconstructionReadinessJourneyFindings.js";
import { readinessIntegrityFindings } from "./reconstructionReadinessIntegrityFindings.js";
import {
  readinessStageIdSchema,
  reconstructionReadinessInputSchema,
  reconstructionReadinessReportSchema,
  type ReadinessFinding,
  type ReconstructionReadinessInput,
  type ReconstructionReadinessReport,
} from "./reconstructionReadinessSchemas.js";

/** Evaluate synthetic conformance observations into a deterministic fail-closed report. */
export const createReconstructionReadinessReport = (
  inputValue: unknown,
): ReconstructionReadinessReport => {
  const input = reconstructionReadinessInputSchema.parse(inputValue);
  const sourceDigest = digest(sourceValue(input));
  const evidenceIds = new Set(
    authenticateParsedEvidenceBundle(input.evidence_bundle).records.map(
      ({ evidence_id: evidenceId }) => evidenceId,
    ),
  );
  const findings = [
    ...readinessJourneyFindings(input, evidenceIds),
    ...readinessIntegrityFindings(input, evidenceIds, sourceDigest),
  ].sort(readinessFindingOrder);
  const stages = effectiveStages(input, findings);
  const status = aggregateStatus(stages);
  const semantic = {
    source_digest: sourceDigest,
    status,
    summary: {
      stages: stages.length,
      required_stages: stages.filter(({ required }) => required).length,
      passed_required_stages: stages.filter(
        ({ required, status: stageStatus }) =>
          required && stageStatus === "pass",
      ).length,
      findings: findings.length,
      failed_findings: findings.filter(
        ({ status: findingStatus }) => findingStatus === "fail",
      ).length,
      unknown_findings: findings.filter(
        ({ status: findingStatus }) => findingStatus === "unknown",
      ).length,
    },
    metrics: readinessMetrics(input),
    stages,
    findings,
    evidence_links: [...evidenceIds].sort(),
    snapshot: input,
  };
  const reportDigest = digest({
    schema: "ReconstructionReadinessReport",
    ...semantic,
  });
  return reconstructionReadinessReportSchema.parse({
    schema: "ReconstructionReadinessReport",
    report_id: `rr_${reportDigest}`,
    report_digest: reportDigest,
    ...semantic,
  });
};

const effectiveStages = (
  input: ReconstructionReadinessInput,
  findings: readonly ReadinessFinding[],
): ReconstructionReadinessReport["stages"] =>
  readinessStageIdSchema.options.map((stageId) => {
    const stage = input.stages.find(({ stage_id: id }) => id === stageId);
    const stageFindings = findings.filter(({ stage_id: id }) => id === stageId);
    const status = stageFindings.some(
      ({ status: findingStatus }) => findingStatus === "fail",
    )
      ? "fail"
      : stage !== undefined && stage.status !== "pass"
        ? stage.status
        : stageFindings.length > 0
          ? "unknown"
          : (stage?.status ?? "fail");
    return stage === undefined
      ? {
          stage_id: stageId,
          required: true,
          status,
          capability_issue: null,
          next_action: "Supply the missing conformance stage.",
          evidence_ids: [],
          checks: [],
        }
      : { ...stage, required: true, status };
  });

const aggregateStatus = (
  stages: ReconstructionReadinessReport["stages"],
): ReconstructionReadinessReport["status"] => {
  const required = stages.filter(({ required }) => required);
  if (required.some(({ status }) => status === "fail")) return "fail";
  if (required.every(({ status }) => status === "pass")) return "pass";
  for (const status of [
    "unknown",
    "truncated",
    "unsupported",
    "skipped",
  ] as const)
    if (required.some(({ status: stageStatus }) => stageStatus === status))
      return status;
  return "unknown";
};

const readinessMetrics = (
  input: ReconstructionReadinessInput,
): ReconstructionReadinessReport["metrics"] => {
  const selectedFixtures = input.fixtures.filter((fixture) =>
    input.workflow_candidates.some(
      ({ fixture_id: fixtureId, selected, compatibility }) =>
        fixtureId === fixture.fixture_id &&
        selected &&
        compatibility === "compatible",
    ),
  ).length;
  const prerequisiteFailures = input.operation_outcomes.filter(
    ({ call_kind: kind, expected_success: success }) =>
      !success && ["setup", "permission"].includes(kind),
  );
  const localized = input.comparisons.filter(
    ({ deliberate_divergence_ref: expected, divergence_refs: observed }) =>
      expected !== null && observed.includes(expected),
  ).length;
  const deliberate = input.comparisons.filter(
    ({ deliberate_divergence_ref: expected }) => expected !== null,
  ).length;
  const falseEquivalence = input.comparisons.filter(
    (comparison) =>
      comparison.verdict === "equivalent" &&
      (comparison.truncated ||
        comparison.unavailable_authority ||
        comparison.unstable ||
        comparison.contradiction_ids.length > 0),
  ).length;
  return {
    first_valid_workflow_selection_rate: ratio(
      selectedFixtures,
      input.fixtures.length,
    ),
    malformed_or_over_limit_call_rate: ratio(
      input.operation_outcomes.filter(({ call_kind: kind }) =>
        ["malformed", "over-limit"].includes(kind),
      ).length,
      input.operation_outcomes.length,
    ),
    incompatible_provider_invocations: input.workflow_candidates.filter(
      ({ invoked, compatibility }) => invoked && compatibility !== "compatible",
    ).length,
    failed_calls_before_prerequisites: prerequisiteFailures.length,
    recovery_rate: ratio(
      prerequisiteFailures.filter(({ recovered }) => recovered).length,
      prerequisiteFailures.length,
    ),
    divergence_localization_precision: ratio(localized, deliberate),
    false_equivalence_count: falseEquivalence,
    unowned_obligation_count:
      input.obligation_ledger.reports.missing_owner_obligation_ids.length,
    cleanup_leak_count: input.cleanup.filter(
      ({ owned_resources_remaining: remaining }) => remaining > 0,
    ).length,
    nondeterministic_replay_count: input.replay.deterministic ? 0 : 1,
  };
};

const sourceValue = (input: ReconstructionReadinessInput): unknown => ({
  ...input,
  replay: { ...input.replay, expected_source_digest: null },
});

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 1 : numerator / denominator;

const digest = (value: unknown): string => {
  return digestCanonicalValue(value, "Reconstruction readiness");
};
