import { z } from "zod";

import { STABLE_IDENTIFIER_PATTERN } from "./stringPatterns.js";

import { evidenceAuthoritySchema } from "./evidence.js";
import { evidenceBundleSchema } from "./evidenceBundle.js";
import { digestSchema, prefixedDigestSchema } from "./../domain/digests.js";
import { canonicalJson } from "./comparisonSemantics.js";
import {
  reconstructionObligationCoverage,
  reconstructionObligationDependencyGraph,
  reconstructionObligationLedgerClosureDigest,
  reconstructionObligationLedgerStatus,
  reconstructionObligationEvidenceIds,
  reconstructionObligationOwnershipGraph,
  reconstructionObligationReports,
  summarizeReconstructionObligations,
} from "./reconstructionObligationLedgerIntegrity.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const stableIdSchema = z.string().regex(STABLE_IDENTIFIER_PATTERN);
const textSchema = z.string().trim().min(1);

const sameProjection = <Value>(
  actual: readonly Value[],
  expected: readonly Value[],
): boolean => {
  if (actual.length !== expected.length) return false;
  const counts = new Map<string, number>();
  for (const value of actual) {
    const key = canonicalJson(value, "Reconstruction obligation ledger");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const value of expected) {
    const key = canonicalJson(value, "Reconstruction obligation ledger");
    const count = counts.get(key);
    if (count === undefined) return false;
    if (count === 1) counts.delete(key);
    else counts.set(key, count - 1);
  }
  return counts.size === 0;
};

export const obligationStatusSchema = z.enum([
  "unowned",
  "characterized",
  "implemented",
  "verified",
  "contradicted",
  "blocked",
  "out-of-scope",
  "unknown",
]);

export const obligationLayerSchema = z.enum([
  "cli",
  "protocol",
  "electron",
  "persistence",
  "process",
  "runtime",
  "packaging",
  "native-abi",
  "application",
  "other",
]);

export const obligationCaseKindSchema = z.enum([
  "positive",
  "negative",
  "malformed",
  "cancellation",
  "teardown",
]);

export const obligationProofAuthoritySchema = z.enum([
  "unit",
  "integration",
  "protocol",
  "renderer",
  "packaged-process",
  "native-abi",
  "live-observation",
  "external",
]);

export const obligationOriginalAuthoritySchema = z.enum([
  "static",
  "runtime",
  "process",
  "external",
]);

const obligationEvidenceStateSchema = z.enum([
  "candidate",
  "observed",
  "reviewed",
  "unknown",
]);

const obligationTargetSchema = z.strictObject({
  artifact_sha256: digestSchema.nullable(),
  application_node_id: z
    .string()
    .regex(/^jag_node_[a-f0-9]{64}$/u)
    .nullable(),
  semantic_node_id: z
    .string()
    .regex(/^jsrg_node_[a-f0-9]{64}$/u)
    .nullable(),
  location: textSchema,
});

const authorityReferenceSchema = z.strictObject({
  evidence_id: evidenceIdSchema,
  authority: evidenceAuthoritySchema,
  state: obligationEvidenceStateSchema,
  location: textSchema,
});

const observedCaseSchema = z.strictObject({
  kind: obligationCaseKindSchema,
  evidence_id: evidenceIdSchema,
  location: textSchema,
});

const ownerBindingSchema = z.strictObject({
  module_path: textSchema,
  symbol: textSchema,
  owner_sha256: digestSchema,
});

const parserTypeBindingSchema = z.strictObject({
  parser: textSchema,
  schema: textSchema,
  domain_type: textSchema,
});

const fixtureBindingSchema = z.strictObject({
  fixture_id: stableIdSchema,
  case_kind: obligationCaseKindSchema,
  authority: obligationProofAuthoritySchema,
  evidence_ids: z.array(evidenceIdSchema).min(1),
});

const nondeterminismSchema = z.strictObject({
  mode: z.enum(["total-order", "partial-order", "finite-traces"]),
  specification: textSchema,
});

const verifierBindingSchema = z.strictObject({
  verifier_id: stableIdSchema,
  claim_id: stableIdSchema,
  command: textSchema,
  authority: obligationProofAuthoritySchema,
  status: z.enum(["pass", "fail", "unknown", "unsupported", "skipped"]),
  result_evidence_id: evidenceIdSchema,
  enumerated_obligation_ids: z.array(stableIdSchema).min(1),
  nondeterminism: nondeterminismSchema,
});

export const reconstructionObligationManifestBindingSchema = z.strictObject({
  obligation_id: stableIdSchema,
  owner: ownerBindingSchema,
  parser_type: parserTypeBindingSchema.nullable(),
  original_cases: z.array(observedCaseSchema),
  fixtures: z.array(fixtureBindingSchema),
  verifier: verifierBindingSchema.nullable(),
});

export const reconstructionObligationManifestSchema = z.strictObject({
  bindings: z.array(reconstructionObligationManifestBindingSchema),
  contradictions: z.array(
    z.strictObject({
      obligation_id: stableIdSchema,
      evidence_ids: z.array(evidenceIdSchema).min(2),
    }),
  ),
});

export const reviewedReconstructionObligationSchema = z.strictObject({
  obligation_id: stableIdSchema,
  obligation_version: z.int().min(1),
  title: textSchema,
  application_layer: obligationLayerSchema,
  family: textSchema,
  target: obligationTargetSchema,
  required: z.boolean(),
  required_case_kinds: z.array(obligationCaseKindSchema).min(1),
  required_original_authority: obligationOriginalAuthoritySchema,
  required_fixture_authority: obligationProofAuthoritySchema,
  required_verifier_authority: obligationProofAuthoritySchema,
  requires_parser_type: z.boolean(),
  dependency_obligation_ids: z.array(stableIdSchema),
  residual_unknown_ids: z.array(stableIdSchema),
  unavailable_authority: z.array(textSchema),
  required_next_evidence: z.array(textSchema),
  disposition: z.enum(["active", "blocked", "out-of-scope"]),
  review_evidence_ids: z.array(evidenceIdSchema).min(1),
});

const diagnosticSchema = z.strictObject({
  code: z.enum([
    "duplicate-definition",
    "missing-owner",
    "ambiguous-owner",
    "missing-parser-type",
    "missing-original-case",
    "weak-original-case-authority",
    "missing-case",
    "weak-fixture-authority",
    "inapplicable-fixture-proof",
    "fixture-failed",
    "missing-verifier",
    "verifier-does-not-enumerate",
    "missing-verifier-result",
    "weak-verifier-authority",
    "verifier-failed",
    "verifier-unavailable",
    "inapplicable-verifier-proof",
    "static-only",
    "contradiction",
    "contradiction-evidence-missing",
    "residual-unknown",
    "dependency-missing",
    "dependency-open",
    "unavailable-authority",
    "blocked",
    "out-of-scope",
  ]),
  detail: textSchema,
});

export const reconstructionObligationSchema = z.strictObject({
  obligation_id: stableIdSchema,
  obligation_version: z.int().min(1),
  title: textSchema,
  origin: z.enum(["generated", "reviewed"]),
  application_layer: obligationLayerSchema,
  family: textSchema,
  target: obligationTargetSchema,
  authority_references: z.array(authorityReferenceSchema).min(1),
  source_state: obligationEvidenceStateSchema,
  observed_cases: z.array(observedCaseSchema),
  required: z.boolean(),
  required_case_kinds: z.array(obligationCaseKindSchema).min(1),
  required_original_authority: obligationOriginalAuthoritySchema,
  required_fixture_authority: obligationProofAuthoritySchema,
  required_verifier_authority: obligationProofAuthoritySchema,
  requires_parser_type: z.boolean(),
  dependency_obligation_ids: z.array(stableIdSchema),
  residual_unknown_ids: z.array(stableIdSchema),
  unavailable_authority: z.array(textSchema),
  required_next_evidence: z.array(textSchema),
  binding: reconstructionObligationManifestBindingSchema.nullable(),
  status: obligationStatusSchema,
  diagnostics: z.array(diagnosticSchema),
});

const countBySchema = <Schema extends z.ZodType>(
  key: Schema,
): z.ZodArray<
  z.ZodObject<{
    key: Schema;
    count: z.ZodNumber;
  }>
> =>
  z.array(
    z.strictObject({
      key,
      count: z.int().min(0),
    }),
  );

const countEntriesMatch = (
  actual: readonly { readonly key: string; readonly count: number }[],
  expected: readonly { readonly key: string; readonly count: number }[],
): boolean => {
  const actualCounts = new Map(actual.map(({ key, count }) => [key, count]));
  return (
    actualCounts.size === actual.length &&
    actual.length === expected.length &&
    expected.every(({ key, count }) => actualCounts.get(key) === count)
  );
};

const obligationSummariesMatch = (
  actual: ReconstructionObligationLedger["summary"],
  expected: ReconstructionObligationLedger["summary"],
): boolean =>
  actual.total === expected.total &&
  actual.required === expected.required &&
  actual.verified === expected.verified &&
  actual.required_open === expected.required_open &&
  countEntriesMatch(actual.by_status, expected.by_status) &&
  countEntriesMatch(
    actual.by_application_layer,
    expected.by_application_layer,
  ) &&
  countEntriesMatch(
    actual.by_evidence_authority,
    expected.by_evidence_authority,
  ) &&
  countEntriesMatch(actual.by_source_state, expected.by_source_state);

export const reconstructionObligationLedgerSchema = z
  .strictObject({
    schema: z.literal("ReconstructionObligationLedger"),
    ledger_id: prefixedDigestSchema("rol"),
    closure_digest: digestSchema,
    status: z.enum(["ready", "open", "failed", "unknown"]),
    coverage: z.strictObject({
      status: z.enum(["complete", "partial"]),
    }),
    summary: z.strictObject({
      total: z.int().min(0),
      required: z.int().min(0),
      verified: z.int().min(0),
      required_open: z.int().min(0),
      by_status: countBySchema(obligationStatusSchema),
      by_application_layer: countBySchema(obligationLayerSchema),
      by_evidence_authority: countBySchema(evidenceAuthoritySchema).describe(
        "Obligations per Evidence authority. An obligation counts once under each distinct authority among its authority_references, so counts can sum above total.",
      ),
      by_source_state: countBySchema(obligationEvidenceStateSchema).describe(
        "Obligations per source_state; each obligation counts once.",
      ),
    }),
    reports: z.strictObject({
      missing_owner_obligation_ids: z.array(stableIdSchema),
      missing_verifier_obligation_ids: z.array(stableIdSchema),
      contradicted_obligation_ids: z.array(stableIdSchema),
      residual_unknown_ids: z.array(stableIdSchema),
    }),
    ownership_graph: z.array(
      z.strictObject({
        obligation_id: stableIdSchema,
        module_path: textSchema,
        symbol: textSchema,
      }),
    ),
    dependency_graph: z.array(
      z.strictObject({
        obligation_id: stableIdSchema,
        depends_on_obligation_id: stableIdSchema,
      }),
    ),
    obligations: z.array(reconstructionObligationSchema),
    evidence_links: z.array(evidenceIdSchema),
    limitations: z.array(textSchema),
  })
  .superRefine((ledger, context) => {
    if (
      ledger.status !==
      reconstructionObligationLedgerStatus(
        ledger.obligations,
        ledger.limitations,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Ledger status does not match its obligations",
      });
    if (
      !obligationSummariesMatch(
        ledger.summary,
        summarizeReconstructionObligations(ledger.obligations),
      )
    )
      context.addIssue({
        code: "custom",
        path: ["summary"],
        message: "Ledger summary does not match its obligations",
      });
    if (
      ledger.closure_digest !==
      reconstructionObligationLedgerClosureDigest(ledger)
    )
      context.addIssue({
        code: "custom",
        path: ["closure_digest"],
        message: "Ledger closure digest does not match its contents",
      });
    if (
      ledger.coverage.status !==
      reconstructionObligationCoverage(ledger.limitations).status
    )
      context.addIssue({
        code: "custom",
        path: ["coverage"],
        message: "Ledger coverage does not match its limitations",
      });
    const expectedReports = reconstructionObligationReports(ledger.obligations);
    for (const key of [
      "missing_owner_obligation_ids",
      "missing_verifier_obligation_ids",
      "contradicted_obligation_ids",
      "residual_unknown_ids",
    ] as const)
      if (!sameProjection(ledger.reports[key], expectedReports[key]))
        context.addIssue({
          code: "custom",
          path: ["reports", key],
          message: "Ledger report does not match its obligations",
        });
    if (
      !sameProjection(
        ledger.ownership_graph,
        reconstructionObligationOwnershipGraph(ledger.obligations),
      )
    )
      context.addIssue({
        code: "custom",
        path: ["ownership_graph"],
        message: "Ownership graph does not match its obligations",
      });
    if (
      !sameProjection(
        ledger.dependency_graph,
        reconstructionObligationDependencyGraph(ledger.obligations),
      )
    )
      context.addIssue({
        code: "custom",
        path: ["dependency_graph"],
        message: "Dependency graph does not match its obligations",
      });
    const ledgerEvidenceIds = new Set(ledger.evidence_links);
    if (ledgerEvidenceIds.size !== ledger.evidence_links.length)
      context.addIssue({
        code: "custom",
        path: ["evidence_links"],
        message: "Evidence links must be unique",
      });
    if (
      reconstructionObligationEvidenceIds(ledger.obligations).some(
        (evidenceId) => !ledgerEvidenceIds.has(evidenceId),
      )
    )
      context.addIssue({
        code: "custom",
        path: ["evidence_links"],
        message: "Evidence links omit Evidence referenced by an obligation",
      });
  });

export const reconstructionObligationLedgerInputSchema = z.strictObject({
  evidence_bundle: evidenceBundleSchema,
  reviewed_obligations: z.array(reviewedReconstructionObligationSchema),
  manifest: reconstructionObligationManifestSchema,
});

export type ReconstructionObligation = z.infer<
  typeof reconstructionObligationSchema
>;
export type ReconstructionObligationLedger = z.infer<
  typeof reconstructionObligationLedgerSchema
>;
export type ReconstructionObligationLedgerInput = z.infer<
  typeof reconstructionObligationLedgerInputSchema
>;
export type ReviewedReconstructionObligation = z.infer<
  typeof reviewedReconstructionObligationSchema
>;
export type ReconstructionObligationManifest = z.infer<
  typeof reconstructionObligationManifestSchema
>;
