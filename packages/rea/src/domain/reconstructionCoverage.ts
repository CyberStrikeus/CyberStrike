import { reconstructionCoverageScope } from "./reconstructionCoverageScope.js";
import { z } from "zod";
import { AnalysisInputError } from "./analysisErrorCore.js";
import type { EvidenceIntegrityError } from "./evidenceErrors.js";
import { projectInputIssues } from "./inputIssueProjection.js";
import { err, ok, type Result } from "./result.js";

import {
  compareUnicodeCodePoints,
  compositeKey,
} from "./unicodeCodePointOrder.js";

import { readEvidenceBundle, evidenceBundleSchema } from "./evidenceBundle.js";
import type { Evidence } from "./evidence.js";
import {
  evaluateReconstructionClaims,
  evaluateReconstructionPackageProofs,
  evaluateReconstructionSurfaces,
  evaluateReconstructionCoverageRisks,
  recommendedReconstructionProbes,
  type ReconstructionEvaluationContext,
} from "./reconstructionCoverageEvaluation.js";
import { digestSchema, prefixedDigestSchema } from "./../domain/digests.js";
import { digestCanonicalValue } from "./canonicalDigest.js";
import {
  offsetDateTimeInstantFromEpochMilliseconds,
  offsetDateTimeSchema,
} from "./offsetDateTime.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const stableIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9._:\x2f\x2d]{0,199}$/u);
const boundedTextSchema = z.string().trim().min(1);

const authoritySchema = z.enum([
  "observed",
  "derived",
  "inferred",
  "historical",
  "external",
]);

const artifactSchema = z.strictObject({
  artifact_id: stableIdSchema,
  artifact_sha256: digestSchema,
  version: z.string().trim().min(1),
  environment_sha256: digestSchema,
  evidence_ids: z.array(evidenceIdSchema).min(1),
});

const surfaceSchema = z.strictObject({
  surface_id: stableIdSchema,
  family: z.string().trim().min(1),
  artifact_id: stableIdSchema,
  occurrence_id: z.string().trim().min(1).nullable(),
  location: boundedTextSchema,
  authority: authoritySchema,
  dependency_surface_ids: z.array(stableIdSchema),
  evidence_ids: z.array(evidenceIdSchema).min(1),
});

const implementationOwnerSchema = z.strictObject({
  disposition: z.literal("implemented"),
  owner_path: boundedTextSchema,
  owner_export: z.string().trim().min(1).nullable(),
  owner_sha256: digestSchema,
  path_state: z.enum(["present", "missing", "unknown"]),
  package_state: z.enum(["distributed", "missing", "unknown"]),
  authority_route: z.enum(["none", "detected", "unknown"]),
});

const externalOwnerSchema = z.strictObject({
  disposition: z.enum(["external", "non-goal"]),
  rationale: boundedTextSchema,
});

const ownerSchema = z.strictObject({
  surface_id: stableIdSchema,
  ownership: z.discriminatedUnion("disposition", [
    implementationOwnerSchema,
    externalOwnerSchema,
  ]),
});

const claimSchema = z.strictObject({
  claim_id: stableIdSchema,
  title: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  surface_ids: z.array(stableIdSchema).min(1),
  required_dimensions: z.array(stableIdSchema).min(1),
  required_authority: z.enum([
    "shipped-artifact",
    "controlled-replay",
    "live-observation",
    "external",
  ]),
});

const verifierContractSchema = z.strictObject({
  verifier_id: stableIdSchema,
  claim_ids: z.array(stableIdSchema).min(1),
  dimensions: z.array(stableIdSchema).min(1),
  authority: z.enum([
    "shipped-artifact",
    "controlled-replay",
    "live-observation",
    "external",
  ]),
  max_age_ms: z.int().min(1),
  minimum_repeats: z.int().min(1),
  normalization_sha256: digestSchema,
  normalization_removes_dimensions: z.literal(false),
  contract_sha256: digestSchema,
});

const verifierResultSchema = z.strictObject({
  verifier_id: stableIdSchema,
  contract_sha256: digestSchema,
  observed_at: offsetDateTimeSchema,
  status: z.enum([
    "pass",
    "fail",
    "unknown",
    "unsupported",
    "truncated",
    "skipped",
  ]),
  covered_claim_ids: z.array(stableIdSchema).min(1),
  covered_dimensions: z.array(stableIdSchema).min(1),
  artifact_sha256s: z.array(digestSchema).min(1),
  owner_sha256s: z.array(digestSchema),
  normalization_sha256: digestSchema,
  repeats: z.int().min(1),
  evidence_ids: z.array(evidenceIdSchema).min(1),
});

const contradictionSchema = z.strictObject({
  contradiction_id: stableIdSchema,
  status: z.enum(["active", "resolved"]),
  surface_ids: z.array(stableIdSchema),
  claim_ids: z.array(stableIdSchema),
  evidence_ids: z.array(evidenceIdSchema).min(2),
});

const packageProofSchema = z.strictObject({
  proof_id: stableIdSchema,
  kind: z.enum([
    "build",
    "clean-install",
    "package-contents",
    "runtime-routing",
    "authority-independence",
  ]),
  status: z.enum(["pass", "fail", "unknown", "unsupported", "skipped"]),
  artifact_sha256s: z.array(digestSchema).min(1),
  evidence_ids: z.array(evidenceIdSchema).min(1),
});

const boundarySchema = z.strictObject({
  boundary_id: stableIdSchema,
  title: z.string().trim().min(1),
  required_surface_ids: z.array(stableIdSchema).min(1),
  required_claim_ids: z.array(stableIdSchema).min(1),
  required_package_proof_kinds: z.array(packageProofSchema.shape.kind).min(1),
  allowed_dispositions: z.array(z.enum(["external", "non-goal"])),
  allowed_unknown_ids: z.array(stableIdSchema),
});

export const reconstructionCoverageDataSchema = z.strictObject({
  evidence_bundle: evidenceBundleSchema,
  artifacts: z.array(artifactSchema),
  surfaces: z.array(surfaceSchema),
  owners: z.array(ownerSchema),
  claims: z.array(claimSchema),
  verifier_contracts: z.array(verifierContractSchema),
  verifier_results: z.array(verifierResultSchema),
  residual_unknown_ids: z.array(stableIdSchema),
  contradictions: z.array(contradictionSchema),
  package_proofs: z.array(packageProofSchema),
  boundaries: z.array(boundarySchema),
});

export type ReconstructionCoverageData = z.infer<
  typeof reconstructionCoverageDataSchema
>;
export type ReconstructionVerifierContract = z.infer<
  typeof verifierContractSchema
>;

/** Owned coverage snapshot and its authenticated, unique lookup facts. */
export interface ParsedReconstructionCoverage {
  readonly coverage: ReconstructionCoverageData;
  readonly evidenceById: ReadonlyMap<string, Evidence>;
  readonly artifacts: ReadonlyMap<
    string,
    ReconstructionCoverageData["artifacts"][number]
  >;
  readonly surfaces: ReadonlyMap<
    string,
    ReconstructionCoverageData["surfaces"][number]
  >;
  readonly claims: ReadonlyMap<
    string,
    ReconstructionCoverageData["claims"][number]
  >;
  readonly ownersBySurface: ReadonlyMap<
    string,
    readonly ReconstructionCoverageData["owners"][number][]
  >;
}

const coverageEnvelopeSchema = reconstructionCoverageDataSchema.extend({
  evidence_bundle: z.unknown(),
});

/** Own workspace shape, source authentication, and reference lookup facts once. */
export const readReconstructionCoverageData = (
  input: unknown,
  path: readonly (string | number)[] = [],
): Result<
  ParsedReconstructionCoverage,
  AnalysisInputError | EvidenceIntegrityError
> => {
  const parsed = coverageEnvelopeSchema.safeParse(input);
  if (!parsed.success)
    return err(
      new AnalysisInputError(
        "evaluate_reconstruction_coverage",
        { cause: parsed.error },
        projectInputIssues(parsed.error.issues, input).map((issue) => ({
          ...issue,
          path: [...path, ...issue.path],
        })),
      ),
    );
  const bundle = readEvidenceBundle(parsed.data.evidence_bundle, {
    operation: "evaluate_reconstruction_coverage",
    path: [...path, "evidence_bundle"],
  });
  if (!bundle.ok) return bundle;
  const coverage = { ...parsed.data, evidence_bundle: bundle.value };
  try {
    return ok({ coverage, ...validateCoverageReferences(coverage, path) });
  } catch (cause: unknown) {
    if (cause instanceof AnalysisInputError) return err(cause);
    throw cause;
  }
};

const closureReasonSchema = z.strictObject({
  code: z.enum([
    "surface-missing",
    "owner-missing",
    "owner-duplicate",
    "owner-path-missing",
    "owner-path-unknown",
    "owner-undistributed",
    "owner-distribution-unknown",
    "authority-routing-detected",
    "authority-routing-unknown",
    "disposition-not-allowed",
    "dependency-surface-missing",
    "claim-missing",
    "verifier-missing",
    "verifier-duplicate",
    "verifier-result-missing",
    "verifier-result-stale",
    "verifier-result-incompatible",
    "verifier-result-ambiguous",
    "verifier-failed",
    "verifier-unknown",
    "active-unknown",
    "active-contradiction",
    "package-proof-missing",
    "package-proof-failed",
    "package-proof-unknown",
  ]),
  subject_id: stableIdSchema,
  detail: boundedTextSchema,
});

export const reconstructionClosureResultSchema = z.strictObject({
  boundary_id: stableIdSchema,
  status: z.enum(["partial", "failed", "unknown", "ready"]),
  summary: z.strictObject({
    required_surfaces: z.int().min(0),
    required_claims: z.int().min(0),
    reasons: z.int().min(0),
  }),
  reasons: z.array(closureReasonSchema),
  recommended_probes: z.array(
    z.strictObject({
      operation: stableIdSchema,
      subject_id: stableIdSchema,
      rationale: boundedTextSchema,
    }),
  ),
  evidence_ids: z.array(evidenceIdSchema),
});

export type ReconstructionClosureResult = z.infer<
  typeof reconstructionClosureResultSchema
>;

type ClosureReason = z.infer<typeof closureReasonSchema>;

/** Evaluate the owner's authenticated workspace and lookup facts. */
export const evaluateParsedReconstructionClosure = (
  parsed: ParsedReconstructionCoverage,
  boundaryId: string,
  nowEpochMs: number,
): Result<ReconstructionClosureResult, AnalysisInputError> => {
  const boundary = parsed.coverage.boundaries.find(
    ({ boundary_id: id }) => id === boundaryId,
  );
  if (boundary === undefined)
    return err(
      coverageInputError(
        ["boundary_id"],
        `Unknown reconstruction boundary: ${boundaryId}`,
      ),
    );
  const nowInstant = offsetDateTimeInstantFromEpochMilliseconds(nowEpochMs);
  const context: ReconstructionEvaluationContext = {
    ...parsed,
    boundary,
    scope: reconstructionCoverageScope(parsed, boundary),
    nowEpochMs,
    nowInstant,
    reasons: [],
    evidenceIds: new Set<string>(),
  };
  evaluateReconstructionSurfaces(context);
  evaluateReconstructionClaims(context);
  evaluateReconstructionCoverageRisks(context);
  evaluateReconstructionPackageProofs(context);
  const reasons = [...context.reasons].sort(reasonOrder);
  return ok(
    reconstructionClosureResultSchema.parse({
      boundary_id: boundary.boundary_id,
      status: closureStatus(reasons),
      summary: {
        required_surfaces: context.scope.surfaceIds.size,
        required_claims: context.scope.claimIds.size,
        reasons: reasons.length,
      },
      reasons,
      recommended_probes: recommendedReconstructionProbes(reasons),
      evidence_ids: [...context.evidenceIds].sort(),
    }),
  );
};

const validateCoverageReferences = (
  workspace: ReconstructionCoverageData,
  path: readonly (string | number)[],
): Omit<ParsedReconstructionCoverage, "coverage"> => {
  const invalid = (location: readonly (string | number)[], message: string) =>
    coverageInputError([...path, ...location], message);
  const evidenceById = new Map(
    workspace.evidence_bundle.records.map((record) => [
      record.evidence_id,
      record,
    ]),
  );
  const unknownIds = new Set(
    workspace.evidence_bundle.unknowns.map(({ unknown_id: id }) => id),
  );
  const artifacts = indexUnique(workspace.artifacts, "artifact_id", [
    ...path,
    "artifacts",
  ]);
  const surfaces = indexUnique(workspace.surfaces, "surface_id", [
    ...path,
    "surfaces",
  ]);
  const claims = indexUnique(workspace.claims, "claim_id", [...path, "claims"]);
  const contracts = indexUnique(workspace.verifier_contracts, "verifier_id", [
    ...path,
    "verifier_contracts",
  ]);
  indexUnique(workspace.contradictions, "contradiction_id", [
    ...path,
    "contradictions",
  ]);
  indexUnique(workspace.package_proofs, "proof_id", [
    ...path,
    "package_proofs",
  ]);
  indexUnique(workspace.boundaries, "boundary_id", [...path, "boundaries"]);
  for (const [index, contract] of workspace.verifier_contracts.entries()) {
    const { contract_sha256: contractSha256, ...base } = contract;
    if (
      contractSha256 !== digestCanonicalValue(base, "Reconstruction coverage")
    )
      throw invalid(
        ["verifier_contracts", index, "contract_sha256"],
        `Verifier contract digest is invalid: ${contract.verifier_id}`,
      );
  }
  for (const [index, surface] of workspace.surfaces.entries())
    if (!artifacts.has(surface.artifact_id))
      throw invalid(
        ["surfaces", index, "artifact_id"],
        `Surface artifact is missing: ${surface.surface_id}`,
      );
  const ownersBySurface = new Map<
    string,
    ReconstructionCoverageData["owners"][number][]
  >();
  for (const [index, owner] of workspace.owners.entries()) {
    if (!surfaces.has(owner.surface_id))
      throw invalid(
        ["owners", index, "surface_id"],
        `Owner surface is missing: ${owner.surface_id}`,
      );
    const owners = ownersBySurface.get(owner.surface_id);
    if (owners === undefined) ownersBySurface.set(owner.surface_id, [owner]);
    else owners.push(owner);
  }
  for (const [index, claim] of workspace.claims.entries()) {
    const missingSurface = claim.surface_ids.findIndex(
      (id) => !surfaces.has(id),
    );
    if (missingSurface !== -1)
      throw invalid(
        ["claims", index, "surface_ids", missingSurface],
        `Claim surface is missing: ${claim.claim_id}`,
      );
  }
  for (const [index, contract] of workspace.verifier_contracts.entries()) {
    const missingClaim = contract.claim_ids.findIndex((id) => !claims.has(id));
    if (missingClaim !== -1)
      throw invalid(
        ["verifier_contracts", index, "claim_ids", missingClaim],
        `Verifier claim is missing: ${contract.verifier_id}`,
      );
  }
  for (const [index, result] of workspace.verifier_results.entries())
    if (!contracts.has(result.verifier_id))
      throw invalid(
        ["verifier_results", index, "verifier_id"],
        `Verifier result contract is missing: ${result.verifier_id}`,
      );
  const evidenceSources = [
    ["artifacts", workspace.artifacts],
    ["surfaces", workspace.surfaces],
    ["verifier_results", workspace.verifier_results],
    ["contradictions", workspace.contradictions],
    ["package_proofs", workspace.package_proofs],
  ] as const;
  for (const [collection, items] of evidenceSources)
    for (const [index, item] of items.entries())
      for (const [referenceIndex, id] of item.evidence_ids.entries())
        if (!evidenceById.has(id))
          throw invalid(
            [collection, index, "evidence_ids", referenceIndex],
            `Coverage workspace Evidence is missing: ${id}`,
          );
  for (const [index, id] of workspace.residual_unknown_ids.entries())
    if (!unknownIds.has(id))
      throw invalid(
        ["residual_unknown_ids", index],
        `Coverage workspace residual unknown is missing: ${id}`,
      );
  return { evidenceById, artifacts, surfaces, claims, ownersBySurface };
};

const indexUnique = <Item extends Record<Key, string>, Key extends keyof Item>(
  items: readonly Item[],
  key: Key,
  path: readonly (string | number)[],
): ReadonlyMap<string, Item> => {
  const values = new Map<string, Item>();
  for (const [index, item] of items.entries()) {
    if (values.has(item[key]))
      throw coverageInputError(
        [...path, index, String(key)],
        `Duplicate reconstruction coverage ${String(key)}`,
      );
    values.set(item[key], item);
  }
  return values;
};

const coverageInputError = (
  path: readonly (string | number)[],
  message: string,
): AnalysisInputError =>
  new AnalysisInputError(
    "evaluate_reconstruction_coverage",
    { userMessage: message },
    [{ path, reason: "invalid_value", message }],
  );

const closureStatus = (
  reasons: readonly ClosureReason[],
): ReconstructionClosureResult["status"] => {
  if (reasons.length === 0) return "ready";
  if (
    reasons.some(({ code }) =>
      [
        "verifier-failed",
        "active-contradiction",
        "authority-routing-detected",
        "owner-path-missing",
        "owner-undistributed",
        "package-proof-failed",
      ].includes(code),
    )
  )
    return "failed";
  if (
    reasons.some(({ code }) =>
      [
        "verifier-result-stale",
        "verifier-result-incompatible",
        "verifier-result-ambiguous",
        "verifier-unknown",
        "active-unknown",
        "owner-path-unknown",
        "owner-distribution-unknown",
        "authority-routing-unknown",
        "package-proof-unknown",
      ].includes(code),
    )
  )
    return "unknown";
  return "partial";
};

const reasonOrder = (left: ClosureReason, right: ClosureReason): number =>
  compareUnicodeCodePoints(
    compositeKey([left.code, left.subject_id]),
    compositeKey([right.code, right.subject_id]),
  );
