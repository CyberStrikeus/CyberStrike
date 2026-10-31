import { createEvidence } from "../../../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../../../src/domain/evidenceBundle.js";
import { READINESS_REQUIRED_CHECKS } from "./reconstructionReadinessJourneyFindings.js";
import {
  reconstructionObligationLedgerClosureDigest,
  summarizeReconstructionObligations,
} from "../../../../src/domain/reconstructionObligationLedgerIntegrity.js";
import type { ReconstructionObligationLedger } from "../../../../src/domain/reconstructionObligationLedgerSchemas.js";
import {
  readinessStageIdSchema,
  type ReconstructionReadinessInput,
} from "./reconstructionReadinessSchemas.js";

const HASH = "a".repeat(64);
const sourceEvidence = (variant: string) =>
  createEvidence(
    undefined,
    {
      id: "rea-readiness-fixture",
      name: "REA readiness fixture",
      version: "1",
    },
    {
      predicateType: "rea.reconstruction-readiness-fixture",
      operation: "run_reconstruction_readiness_fixture",
      parameters: { variant },
      result: { passed: true, variant },
      confidence: "observed",
      authority: "controlled-replay",
    },
  );
const SOURCE = sourceEvidence("authority");
const CONTRADICTING_SOURCE = sourceEvidence("contradiction");
const EVIDENCE_ID = SOURCE.evidence_id;
const CASES = [
  "positive",
  "negative",
  "malformed",
  "cancellation",
  "teardown",
] as const;
const FIXTURES = [
  "native",
  "javascript-cli",
  "electron",
  "incomplete-reconstruction",
  "broken-runtime",
] as const;
const READINESS_OBLIGATION_LEDGER = (() => {
  const facts: Omit<
    ReconstructionObligationLedger,
    "closure_digest" | "summary"
  > = {
    schema: "ReconstructionObligationLedger",
    ledger_id: `rol_${HASH}`,
    status: "ready",
    coverage: {
      status: "complete",
    },
    reports: {
      missing_owner_obligation_ids: [],
      missing_verifier_obligation_ids: [],
      contradicted_obligation_ids: [],
      residual_unknown_ids: [],
    },
    ownership_graph: [
      {
        obligation_id: "obl.readiness",
        module_path: "src/readiness.ts",
        symbol: "runReadiness",
      },
    ],
    dependency_graph: [],
    obligations: [
      {
        obligation_id: "obl.readiness",
        obligation_version: 1,
        title: "Preserve the packaged readiness fixture lifecycle",
        origin: "reviewed",
        application_layer: "process",
        family: "packaged-process-lifecycle",
        target: {
          artifact_sha256: HASH,
          application_node_id: null,
          semantic_node_id: null,
          location: "/fixture",
        },
        authority_references: [
          {
            evidence_id: EVIDENCE_ID,
            authority: "controlled-replay",
            state: "observed",
            location: "/fixture",
          },
        ],
        source_state: "observed",
        observed_cases: CASES.map((kind) => ({
          kind,
          evidence_id: EVIDENCE_ID,
          location: `/original/${kind}`,
        })),
        required: true,
        required_case_kinds: [...CASES],
        required_original_authority: "process",
        required_fixture_authority: "packaged-process",
        required_verifier_authority: "packaged-process",
        requires_parser_type: false,
        dependency_obligation_ids: [],
        residual_unknown_ids: [],
        unavailable_authority: [],
        required_next_evidence: [],
        binding: {
          obligation_id: "obl.readiness",
          owner: {
            module_path: "src/readiness.ts",
            symbol: "runReadiness",
            owner_sha256: HASH,
          },
          parser_type: null,
          original_cases: CASES.map((kind) => ({
            kind,
            evidence_id: EVIDENCE_ID,
            location: `/original/${kind}`,
          })),
          fixtures: CASES.map((kind) => ({
            fixture_id: `fixture.${kind}`,
            case_kind: kind,
            authority: "packaged-process",
            evidence_ids: [EVIDENCE_ID],
          })),
          verifier: {
            verifier_id: "verifier.readiness",
            claim_id: "claim.readiness",
            command: "npm run verify:readiness",
            authority: "packaged-process",
            status: "pass",
            result_evidence_id: EVIDENCE_ID,
            enumerated_obligation_ids: ["obl.readiness"],
            nondeterminism: {
              mode: "partial-order",
              specification: "Startup precedes teardown.",
            },
          },
        },
        status: "verified",
        diagnostics: [],
      },
    ],
    evidence_links: [EVIDENCE_ID],
    limitations: [],
  };
  const ledger = {
    ...facts,
    summary: summarizeReconstructionObligations(facts.obligations),
  };
  return {
    ...ledger,
    closure_digest: reconstructionObligationLedgerClosureDigest(ledger),
  };
})();

/** Complete synthetic input for the repository's evaluator conformance checks. */
export const RECONSTRUCTION_READINESS_EXAMPLE: ReconstructionReadinessInput = {
  identity: {
    cli_version: "2.4.0",
    server_version: "2.4.0",
    catalog_digest: HASH,
    skill_digest: HASH,
    versions: [
      {
        component: "rea-cli",
        version: "2.4.0",
        digest: HASH,
        state: "current",
        remediation: null,
      },
      {
        component: "rea-server",
        version: "2.3.0",
        digest: "b".repeat(64),
        state: "stale",
        remediation: "Restart the connected MCP server.",
      },
      {
        component: "rea-server",
        version: "2.4.0",
        digest: HASH,
        state: "current",
        remediation: null,
      },
    ],
    providers: [
      {
        provider_id: "javascript-application",
        version: "1",
        digest: HASH,
        state: "available",
        reason_code: null,
      },
      {
        provider_id: "broken-runtime-probe",
        version: null,
        digest: null,
        state: "broken-host",
        reason_code: "host-runtime-linker-failure",
      },
    ],
  },
  client: {
    name: "synthetic-mcp-client",
    version: "1",
    negotiated_capabilities: ["elicitation", "progress", "resources"],
  },
  capabilities: [
    {
      capability_id: "analyze-javascript-application",
      available: true,
      bounded: true,
      side_effect: "reads-target",
      authority_scopes: ["investigation-input"],
      limits: [{ name: "max-ast-nodes", value: 2_000_000, unit: "count" }],
      unavailable_reason: null,
    },
  ],
  fixtures: FIXTURES.map((kind) => ({
    fixture_id: `fixture.${kind}`,
    kind,
    artifact_sha256: HASH,
    environment_id: "environment.synthetic",
    deliberate_faults: [`fault.${kind}`],
  })),
  workflow_candidates: FIXTURES.map((kind) => ({
    fixture_id: `fixture.${kind}`,
    workflow_id: `workflow.${kind}`,
    provider_id: kind === "broken-runtime" ? null : `provider.${kind}`,
    selected: true,
    invoked: true,
    compatibility: "compatible",
    reason_code: "compatible-artifact-family",
  })),
  grants: [
    {
      grant_id: "grant.denied",
      scope: "process-capture",
      decision: "denied",
      launched_process: false,
      evidence_ids: [EVIDENCE_ID],
    },
    {
      grant_id: "grant.session",
      scope: "process-capture",
      decision: "granted",
      launched_process: true,
      evidence_ids: [EVIDENCE_ID],
    },
  ],
  evidence_bundle: createEvidenceBundle([SOURCE, CONTRADICTING_SOURCE]),
  comparisons: [
    {
      comparison_id: "comparison.concurrent",
      verdict: "equivalent",
      schedule_semantics: "partial-order",
      concurrent: true,
      truncated: false,
      unavailable_authority: false,
      unstable: false,
      deliberate_divergence_ref: null,
      divergence_refs: [],
      contradiction_ids: [],
      evidence_ids: [EVIDENCE_ID],
    },
    {
      comparison_id: "comparison.divergence",
      verdict: "different",
      schedule_semantics: "finite-traces",
      concurrent: true,
      truncated: false,
      unavailable_authority: false,
      unstable: false,
      deliberate_divergence_ref: "/events/primary",
      divergence_refs: ["/events/primary"],
      contradiction_ids: [],
      evidence_ids: [EVIDENCE_ID],
    },
    {
      comparison_id: "comparison.contradicted",
      verdict: "unknown",
      schedule_semantics: "finite-traces",
      concurrent: false,
      truncated: false,
      unavailable_authority: false,
      unstable: false,
      deliberate_divergence_ref: null,
      divergence_refs: [],
      contradiction_ids: ["contradiction.artifact"],
      evidence_ids: [EVIDENCE_ID],
    },
  ],
  contradictions: [
    {
      contradiction_id: "contradiction.artifact",
      declared_sha256: HASH,
      observed_sha256: "b".repeat(64),
      policy: "record-and-continue",
      affected_comparison_ids: ["comparison.contradicted"],
      evidence_ids: [EVIDENCE_ID, CONTRADICTING_SOURCE.evidence_id],
    },
  ],
  obligation_ledger: READINESS_OBLIGATION_LEDGER,
  operation_outcomes: [
    {
      sequence: 0,
      operation: "inspect-artifact",
      surface: "cli",
      call_kind: "valid",
      expected_success: true,
      cli_exit_code: 0,
      mcp_status: null,
      error_code: null,
      recovered: false,
      evidence_ids: [EVIDENCE_ID],
    },
    {
      sequence: 1,
      operation: "inspect-artifact",
      surface: "mcp",
      call_kind: "valid",
      expected_success: true,
      cli_exit_code: null,
      mcp_status: "success",
      error_code: null,
      recovered: false,
      evidence_ids: [EVIDENCE_ID],
    },
    {
      sequence: 2,
      operation: "capture-process",
      surface: "cli",
      call_kind: "permission",
      expected_success: false,
      cli_exit_code: 2,
      mcp_status: null,
      error_code: "permission-required",
      recovered: true,
      evidence_ids: [EVIDENCE_ID],
    },
    {
      sequence: 3,
      operation: "capture-process",
      surface: "mcp",
      call_kind: "permission",
      expected_success: false,
      cli_exit_code: null,
      mcp_status: "non-success",
      error_code: "permission-required",
      recovered: true,
      evidence_ids: [EVIDENCE_ID],
    },
  ],
  cleanup: [
    {
      run_id: "run.cancelled",
      cancelled: true,
      owned_resources_remaining: 0,
      diagnostic_evidence_ids: [EVIDENCE_ID],
    },
  ],
  closure_history: [
    {
      sequence: 0,
      ledger_digest: "b".repeat(64),
      status: "open",
      required_open: 1,
      newly_verified_obligation_ids: [],
      evidence_ids: [EVIDENCE_ID],
    },
    {
      sequence: 1,
      ledger_digest: READINESS_OBLIGATION_LEDGER.closure_digest,
      status: "ready",
      required_open: 0,
      newly_verified_obligation_ids: ["obl.readiness"],
      evidence_ids: [EVIDENCE_ID],
    },
  ],
  delegation_checks: [
    {
      candidate_id: "candidate.reconstructed",
      delegates_to_authority: false,
      evidence_ids: [EVIDENCE_ID],
    },
  ],
  replay: {
    expected_source_digest: null,
    deterministic: true,
    tamper_detected: true,
    stale_input_detected: true,
    evidence_ids: [EVIDENCE_ID],
  },
  stages: readinessStageIdSchema.options.map((stageId) => ({
    stage_id: stageId,
    required: true,
    status: "pass",
    capability_issue: null,
    next_action: null,
    evidence_ids: [EVIDENCE_ID],
    checks: READINESS_REQUIRED_CHECKS[stageId].map((checkId) => ({
      check_id: checkId,
      status: "pass",
      detail: `Synthetic conformance proved ${checkId}.`,
      evidence_ids: [EVIDENCE_ID],
    })),
  })),
};
