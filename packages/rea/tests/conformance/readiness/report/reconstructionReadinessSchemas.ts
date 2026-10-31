import { z } from "zod";

import { STABLE_IDENTIFIER_PATTERN } from "../../../../src/domain/stringPatterns.js";

import { evidenceBundleSchema } from "../../../../src/domain/evidenceBundle.js";
import { reconstructionObligationLedgerSchema } from "../../../../src/domain/reconstructionObligationLedgerSchemas.js";
import {
  digestSchema,
  prefixedDigestSchema,
} from "../../../../src/domain/digests.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const stableIdSchema = z.string().regex(STABLE_IDENTIFIER_PATTERN);
const boundedTextSchema = z.string().trim().min(1);

export const readinessStatusSchema = z.enum([
  "pass",
  "fail",
  "unknown",
  "unsupported",
  "truncated",
  "skipped",
]);

export const readinessStageIdSchema = z.enum([
  "discover-classify",
  "diagnose-environment",
  "acquire-authority",
  "static-analysis",
  "reactive-scenarios",
  "compare-authority-candidate",
  "preserve-contradictions",
  "verify-reconstruction-closure",
  "export-replay",
]);

const versionObservationSchema = z.strictObject({
  component: stableIdSchema,
  version: boundedTextSchema.nullable(),
  digest: digestSchema.nullable(),
  state: z.enum(["current", "stale", "unavailable"]),
  remediation: boundedTextSchema.nullable(),
});

const providerIdentitySchema = z.strictObject({
  provider_id: stableIdSchema,
  version: boundedTextSchema.nullable(),
  digest: digestSchema.nullable(),
  state: z.enum(["available", "unavailable", "incompatible", "broken-host"]),
  reason_code: stableIdSchema.nullable(),
});

const limitSchema = z.strictObject({
  name: stableIdSchema,
  value: z.number().finite().nonnegative(),
  unit: z.enum(["count", "bytes", "milliseconds", "ratio"]),
});

const capabilitySchema = z.strictObject({
  capability_id: stableIdSchema,
  available: z.boolean(),
  bounded: z.boolean(),
  side_effect: z.enum([
    "none",
    "reads-target",
    "launches-process",
    "writes-workspace",
    "network-observation",
  ]),
  authority_scopes: z.array(stableIdSchema),
  limits: z.array(limitSchema),
  unavailable_reason: boundedTextSchema.nullable(),
});

const fixtureSchema = z.strictObject({
  fixture_id: stableIdSchema,
  kind: z.enum([
    "native",
    "javascript-cli",
    "electron",
    "incomplete-reconstruction",
    "broken-runtime",
  ]),
  artifact_sha256: digestSchema,
  environment_id: stableIdSchema,
  deliberate_faults: z.array(stableIdSchema).min(1),
});

const workflowCandidateSchema = z.strictObject({
  fixture_id: stableIdSchema,
  workflow_id: stableIdSchema,
  provider_id: stableIdSchema.nullable(),
  selected: z.boolean(),
  invoked: z.boolean(),
  compatibility: z.enum(["compatible", "incompatible", "unavailable"]),
  reason_code: stableIdSchema,
});

const grantSchema = z.strictObject({
  grant_id: stableIdSchema,
  scope: stableIdSchema,
  decision: z.enum(["granted", "denied", "cancelled", "restart-required"]),
  launched_process: z.boolean(),
  evidence_ids: z.array(evidenceIdSchema),
});

const comparisonSchema = z.strictObject({
  comparison_id: stableIdSchema,
  verdict: z.enum(["equivalent", "different", "unknown"]),
  schedule_semantics: z.enum(["total-order", "partial-order", "finite-traces"]),
  concurrent: z.boolean(),
  truncated: z.boolean(),
  unavailable_authority: z.boolean(),
  unstable: z.boolean(),
  deliberate_divergence_ref: boundedTextSchema.nullable(),
  divergence_refs: z.array(boundedTextSchema),
  contradiction_ids: z.array(stableIdSchema),
  evidence_ids: z.array(evidenceIdSchema).min(1),
});

const contradictionSchema = z.strictObject({
  contradiction_id: stableIdSchema,
  declared_sha256: digestSchema,
  observed_sha256: digestSchema,
  policy: z.literal("record-and-continue"),
  affected_comparison_ids: z.array(stableIdSchema).min(1),
  evidence_ids: z.array(evidenceIdSchema).min(2),
});

const operationOutcomeSchema = z.strictObject({
  sequence: z.int().min(0),
  operation: stableIdSchema,
  surface: z.enum(["cli", "mcp"]),
  call_kind: z.enum([
    "valid",
    "malformed",
    "over-limit",
    "incompatible-provider",
    "setup",
    "permission",
    "operation",
  ]),
  expected_success: z.boolean(),
  cli_exit_code: z.int().min(0).nullable(),
  mcp_status: z.enum(["success", "non-success"]).nullable(),
  error_code: stableIdSchema.nullable(),
  recovered: z.boolean(),
  evidence_ids: z.array(evidenceIdSchema),
});

const cleanupSchema = z.strictObject({
  run_id: stableIdSchema,
  cancelled: z.boolean(),
  owned_resources_remaining: z.int().min(0),
  diagnostic_evidence_ids: z.array(evidenceIdSchema),
});

const closureObservationSchema = z.strictObject({
  sequence: z.int().min(0),
  ledger_digest: digestSchema,
  status: z.enum(["ready", "open", "failed", "unknown"]),
  required_open: z.int().min(0),
  newly_verified_obligation_ids: z.array(stableIdSchema),
  evidence_ids: z.array(evidenceIdSchema).min(1),
});

const delegationCheckSchema = z.strictObject({
  candidate_id: stableIdSchema,
  delegates_to_authority: z.boolean(),
  evidence_ids: z.array(evidenceIdSchema).min(1),
});

const stageCheckSchema = z.strictObject({
  check_id: stableIdSchema,
  status: readinessStatusSchema,
  detail: boundedTextSchema,
  evidence_ids: z.array(evidenceIdSchema),
});

const stageSchema = z.strictObject({
  stage_id: readinessStageIdSchema,
  required: z.boolean(),
  status: readinessStatusSchema,
  capability_issue: stableIdSchema.nullable(),
  next_action: boundedTextSchema.nullable(),
  evidence_ids: z.array(evidenceIdSchema),
  checks: z.array(stageCheckSchema),
});

const readinessStagesSchema = z
  .array(stageSchema)
  .length(readinessStageIdSchema.options.length)
  .superRefine((stages, context) => {
    const seen = new Set<string>();
    stages.forEach((stage, index) => {
      if (seen.has(stage.stage_id))
        context.addIssue({
          code: "custom",
          path: [index, "stage_id"],
          message: "Readiness stage IDs must be unique",
        });
      seen.add(stage.stage_id);
    });
  });

const replaySchema = z.strictObject({
  expected_source_digest: digestSchema.nullable(),
  deterministic: z.boolean(),
  tamper_detected: z.boolean(),
  stale_input_detected: z.boolean(),
  evidence_ids: z.array(evidenceIdSchema),
});

export const reconstructionReadinessInputSchema = z.strictObject({
  identity: z.strictObject({
    cli_version: boundedTextSchema,
    server_version: boundedTextSchema,
    catalog_digest: digestSchema,
    skill_digest: digestSchema.nullable(),
    versions: z.array(versionObservationSchema).min(1),
    providers: z.array(providerIdentitySchema),
  }),
  client: z.strictObject({
    name: boundedTextSchema,
    version: boundedTextSchema,
    negotiated_capabilities: z.array(stableIdSchema),
  }),
  capabilities: z.array(capabilitySchema).min(1),
  fixtures: z.array(fixtureSchema).min(1),
  workflow_candidates: z.array(workflowCandidateSchema).min(1),
  grants: z.array(grantSchema),
  evidence_bundle: evidenceBundleSchema,
  comparisons: z.array(comparisonSchema),
  contradictions: z.array(contradictionSchema),
  obligation_ledger: reconstructionObligationLedgerSchema,
  operation_outcomes: z.array(operationOutcomeSchema),
  cleanup: z.array(cleanupSchema),
  closure_history: z.array(closureObservationSchema).min(2),
  delegation_checks: z.array(delegationCheckSchema).min(1),
  replay: replaySchema,
  stages: readinessStagesSchema,
});

const findingSchema = z.strictObject({
  code: stableIdSchema,
  stage_id: readinessStageIdSchema,
  status: z.enum(["fail", "unknown"]),
  detail: boundedTextSchema,
  evidence_ids: z.array(evidenceIdSchema),
});

export const reconstructionReadinessReportSchema = z.strictObject({
  schema: z.literal("ReconstructionReadinessReport"),
  report_id: prefixedDigestSchema("rr"),
  source_digest: digestSchema,
  report_digest: digestSchema,
  status: readinessStatusSchema,
  summary: z.strictObject({
    stages: z.int().min(0),
    required_stages: z.int().min(0),
    passed_required_stages: z.int().min(0),
    findings: z.int().min(0),
    failed_findings: z.int().min(0),
    unknown_findings: z.int().min(0),
  }),
  metrics: z.strictObject({
    first_valid_workflow_selection_rate: z.number().min(0).max(1),
    malformed_or_over_limit_call_rate: z.number().min(0).max(1),
    incompatible_provider_invocations: z.int().min(0),
    failed_calls_before_prerequisites: z.int().min(0),
    recovery_rate: z.number().min(0).max(1),
    divergence_localization_precision: z.number().min(0).max(1),
    false_equivalence_count: z.int().min(0),
    unowned_obligation_count: z.int().min(0),
    cleanup_leak_count: z.int().min(0),
    nondeterministic_replay_count: z.int().min(0),
  }),
  stages: readinessStagesSchema,
  findings: z.array(findingSchema),
  evidence_links: z.array(evidenceIdSchema),
  snapshot: reconstructionReadinessInputSchema,
});

export type ReconstructionReadinessInput = z.infer<
  typeof reconstructionReadinessInputSchema
>;
export type ReconstructionReadinessReport = z.infer<
  typeof reconstructionReadinessReportSchema
>;
export type ReadinessStageId = z.infer<typeof readinessStageIdSchema>;
export type ReadinessFinding = z.infer<typeof findingSchema>;
