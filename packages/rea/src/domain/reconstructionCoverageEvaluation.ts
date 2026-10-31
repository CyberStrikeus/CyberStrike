import type { ReconstructionCoverageScope } from "./reconstructionCoverageScope.js";
import type {
  ReconstructionClosureResult,
  ReconstructionCoverageData,
  ReconstructionVerifierContract,
  ParsedReconstructionCoverage,
} from "./reconstructionCoverage.js";
import {
  packageProofHasComparableEvidence,
  verifierHasComparableEvidence,
} from "./reconstructionCoverageEvidence.js";
import {
  compareOffsetDateTimeInstants,
  offsetDateTimeInstantFromEpochMilliseconds,
  type OffsetDateTimeInstant,
} from "./offsetDateTime.js";
import {
  latestVerifierObservationsByVerifier,
  sameVerifierAssessment,
  type VerifierObservation,
} from "./reconstructionCoverageVerifierResults.js";

export const recommendedReconstructionProbes = (
  reasons: readonly ClosureReason[],
): readonly { operation: string; subject_id: string; rationale: string }[] =>
  reasons.map((reason) => ({
    operation: probeOperation(reason.code),
    subject_id: reason.subject_id,
    rationale: reason.detail,
  }));

const probeOperation = (code: ClosureReason["code"]): string => {
  if (code.startsWith("owner-") || code.startsWith("authority-routing"))
    return "reconcile_reconstruction_owner";
  if (code.startsWith("verifier-")) return "run_reconstruction_verifier";
  if (code.startsWith("package-proof")) return "verify_reconstruction_package";
  if (code === "active-contradiction") return "resolve_contradiction";
  if (code === "active-unknown") return "probe_residual_unknown";
  return "update_authoritative_inventory";
};

type Boundary = ReconstructionCoverageData["boundaries"][number];
type ClosureReason = ReconstructionClosureResult["reasons"][number];
export interface ReconstructionEvaluationContext extends ParsedReconstructionCoverage {
  readonly boundary: Boundary;
  readonly scope: ReconstructionCoverageScope;
  readonly nowEpochMs: number;
  readonly nowInstant: OffsetDateTimeInstant;
  readonly reasons: ClosureReason[];
  readonly evidenceIds: Set<string>;
}

export const evaluateReconstructionSurfaces = (
  context: ReconstructionEvaluationContext,
): void => {
  for (const surfaceId of context.scope.surfaceIds) {
    const surface = context.surfaces.get(surfaceId);
    if (surface === undefined) {
      const dependents = context.scope.missingDependencies.get(surfaceId);
      if (dependents === undefined)
        addReason(
          context,
          "surface-missing",
          surfaceId,
          "Required surface is absent from the authoritative inventory.",
        );
      else
        for (const dependentId of dependents)
          addReason(
            context,
            "dependency-surface-missing",
            dependentId,
            `Declared dependency surface is absent: ${surfaceId}`,
          );
      continue;
    }
    addEvidence(context, surface.evidence_ids);
    evaluateOwner(context, surfaceId);
  }
};

const evaluateOwner = (
  context: ReconstructionEvaluationContext,
  surfaceId: string,
): void => {
  const owners = context.ownersBySurface.get(surfaceId) ?? [];
  if (owners.length === 0) {
    addReason(
      context,
      "owner-missing",
      surfaceId,
      "Required surface has no reconstructed owner or explicit disposition.",
    );
    return;
  }
  if (owners.length > 1) {
    addReason(
      context,
      "owner-duplicate",
      surfaceId,
      "Required surface has conflicting ownership declarations.",
    );
    return;
  }
  const owner = owners[0]?.ownership;
  if (owner === undefined) return;
  if (owner.disposition !== "implemented") {
    if (!context.boundary.allowed_dispositions.includes(owner.disposition))
      addReason(
        context,
        "disposition-not-allowed",
        surfaceId,
        `${owner.disposition} is not allowed by this completion boundary.`,
      );
    return;
  }
  const ownerChecks: ReadonlyArray<
    readonly [boolean, ClosureReason["code"], string]
  > = [
    [
      owner.path_state === "missing",
      "owner-path-missing",
      "Declared owner path is missing.",
    ],
    [
      owner.path_state === "unknown",
      "owner-path-unknown",
      "Declared owner path has not been checked.",
    ],
    [
      owner.package_state === "missing",
      "owner-undistributed",
      "Declared owner is absent from the distributable.",
    ],
    [
      owner.package_state === "unknown",
      "owner-distribution-unknown",
      "Owner distribution state is unknown.",
    ],
    [
      owner.authority_route === "detected",
      "authority-routing-detected",
      "Reconstructed owner routes into the authority.",
    ],
    [
      owner.authority_route === "unknown",
      "authority-routing-unknown",
      "Authority independence has not been established.",
    ],
  ];
  for (const [matches, code, detail] of ownerChecks)
    if (matches) addReason(context, code, surfaceId, detail);
};

export const evaluateReconstructionClaims = (
  context: ReconstructionEvaluationContext,
): void => {
  const indexes = createVerifierIndexes(context);
  for (const claimId of context.scope.claimIds) {
    const claim = context.claims.get(claimId);
    if (claim === undefined) {
      addReason(
        context,
        "claim-missing",
        claimId,
        "Required finite claim is absent.",
      );
      continue;
    }
    const contracts = indexes.contractsByClaim.get(claimId) ?? [];
    if (contracts.length === 0) {
      addReason(
        context,
        "verifier-missing",
        claimId,
        "No verifier contract covers this claim.",
      );
      continue;
    }
    if (contracts.length > 1) {
      addReason(
        context,
        "verifier-duplicate",
        claimId,
        "Multiple verifier contracts claim primary coverage.",
      );
      continue;
    }
    const contract = contracts[0];
    if (contract !== undefined)
      evaluateVerifierResult(context, claim, contract, indexes);
  }
};

interface VerifierIndexes {
  readonly claimSurfaceIds: ReconstructionCoverageScope["claimSurfaceIds"];
  readonly contractsByClaim: ReadonlyMap<
    string,
    readonly ReconstructionVerifierContract[]
  >;
  readonly latestResultsByVerifier: ReadonlyMap<
    string,
    readonly VerifierObservation[]
  >;
  readonly artifactDigests: ReadonlySet<string>;
  readonly ownerDigests: ReadonlySet<string>;
  readonly surfaces: ReadonlyMap<
    string,
    ReconstructionCoverageData["surfaces"][number]
  >;
  readonly artifacts: ReadonlyMap<
    string,
    ReconstructionCoverageData["artifacts"][number]
  >;
  readonly ownersBySurface: ReadonlyMap<
    string,
    readonly ReconstructionCoverageData["owners"][number][]
  >;
}

const createVerifierIndexes = (
  context: ReconstructionEvaluationContext,
): VerifierIndexes => {
  const { coverage } = context;
  const contractsByClaim = new Map<string, ReconstructionVerifierContract[]>();
  for (const contract of coverage.verifier_contracts)
    for (const claimId of new Set(contract.claim_ids)) {
      const contracts = contractsByClaim.get(claimId) ?? [];
      contracts.push(contract);
      contractsByClaim.set(claimId, contracts);
    }

  return {
    claimSurfaceIds: context.scope.claimSurfaceIds,
    contractsByClaim,
    latestResultsByVerifier: latestVerifierObservationsByVerifier(
      coverage.verifier_results,
    ),
    artifactDigests: new Set(
      coverage.artifacts.map(({ artifact_sha256: value }) => value),
    ),
    ownerDigests: new Set(
      coverage.owners.flatMap(({ ownership }) =>
        ownership.disposition === "implemented" ? [ownership.owner_sha256] : [],
      ),
    ),
    surfaces: context.surfaces,
    artifacts: context.artifacts,
    ownersBySurface: context.ownersBySurface,
  };
};

const evaluateVerifierResult = (
  context: ReconstructionEvaluationContext,
  claim: ReconstructionCoverageData["claims"][number],
  contract: ReconstructionVerifierContract,
  indexes: VerifierIndexes,
): void => {
  const latestResults = indexes.latestResultsByVerifier.get(
    contract.verifier_id,
  );
  if (latestResults === undefined) {
    addReason(
      context,
      "verifier-result-missing",
      claim.claim_id,
      "Verifier has no recorded result.",
    );
    return;
  }
  addEvidence(
    context,
    latestResults.flatMap(({ result }) => result.evidence_ids),
  );
  const latest = latestResults[0];
  if (latest === undefined) return;
  if (
    !latestResults.every((candidate) =>
      sameVerifierAssessment(latest.result, candidate.result),
    )
  ) {
    addReason(
      context,
      "verifier-result-ambiguous",
      claim.claim_id,
      "Latest verifier observations have conflicting assessment content.",
    );
    return;
  }
  const comparable = latestResults.find(({ result }) =>
    verifierHasComparableEvidence(result, contract, context.evidenceById),
  );
  if (comparable === undefined) {
    addReason(
      context,
      "verifier-result-incompatible",
      claim.claim_id,
      `Latest verifier observation has no cited Evidence with comparable ${contract.authority} authority and confidence.`,
    );
    return;
  }
  const { result } = comparable;
  if (!verifierResultMatchesContract(claim, contract, result, indexes)) {
    addReason(
      context,
      "verifier-result-incompatible",
      claim.claim_id,
      "Latest verifier result does not match current artifacts, owners, dimensions, authority, normalization, repeats, or contract.",
    );
    return;
  }
  const cutoffEpochMs = context.nowEpochMs - contract.max_age_ms;
  if (
    compareOffsetDateTimeInstants(comparable.instant, context.nowInstant) > 0 ||
    (cutoffEpochMs >= -Number.MAX_SAFE_INTEGER &&
      compareOffsetDateTimeInstants(
        comparable.instant,
        offsetDateTimeInstantFromEpochMilliseconds(cutoffEpochMs),
      ) < 0)
  ) {
    addReason(
      context,
      "verifier-result-stale",
      claim.claim_id,
      "Latest compatible verifier result is stale.",
    );
    return;
  }
  if (result.status === "fail")
    addReason(
      context,
      "verifier-failed",
      claim.claim_id,
      "Latest compatible verifier result failed.",
    );
  else if (result.status !== "pass")
    addReason(
      context,
      "verifier-unknown",
      claim.claim_id,
      `Latest compatible verifier result is ${result.status}.`,
    );
};

const verifierResultMatchesContract = (
  claim: ReconstructionCoverageData["claims"][number],
  contract: ReconstructionVerifierContract,
  result: ReconstructionCoverageData["verifier_results"][number],
  indexes: VerifierIndexes,
): boolean => {
  const requiredSurfaceIds = [
    ...(indexes.claimSurfaceIds.get(claim.claim_id) ?? []),
  ];
  const expectedArtifactDigests = requiredSurfaceIds.flatMap((surfaceId) => {
    const surface = indexes.surfaces.get(surfaceId);
    const artifact =
      surface === undefined
        ? undefined
        : indexes.artifacts.get(surface.artifact_id);
    return artifact === undefined ? [] : [artifact.artifact_sha256];
  });
  const expectedOwnerDigests = requiredSurfaceIds.flatMap((surfaceId) =>
    (indexes.ownersBySurface.get(surfaceId) ?? []).flatMap(({ ownership }) =>
      ownership.disposition === "implemented" ? [ownership.owner_sha256] : [],
    ),
  );
  return (
    result.contract_sha256 === contract.contract_sha256 &&
    result.normalization_sha256 === contract.normalization_sha256 &&
    result.covered_claim_ids.includes(claim.claim_id) &&
    result.covered_claim_ids.every((item) =>
      contract.claim_ids.includes(item),
    ) &&
    claim.required_dimensions.every((item) =>
      contract.dimensions.includes(item),
    ) &&
    claim.required_dimensions.every((item) =>
      result.covered_dimensions.includes(item),
    ) &&
    result.covered_dimensions.every((item) =>
      contract.dimensions.includes(item),
    ) &&
    result.artifact_sha256s.every((item) =>
      indexes.artifactDigests.has(item),
    ) &&
    expectedArtifactDigests.every((item) =>
      result.artifact_sha256s.includes(item),
    ) &&
    result.owner_sha256s.every((item) => indexes.ownerDigests.has(item)) &&
    expectedOwnerDigests.every((item) => result.owner_sha256s.includes(item)) &&
    result.repeats >= contract.minimum_repeats &&
    claim.required_authority === contract.authority
  );
};

export const evaluateReconstructionCoverageRisks = (
  context: ReconstructionEvaluationContext,
): void => {
  for (const unknownId of context.coverage.residual_unknown_ids)
    if (!context.boundary.allowed_unknown_ids.includes(unknownId))
      addReason(
        context,
        "active-unknown",
        unknownId,
        "Active residual unknown is not permitted by the completion boundary.",
      );
  for (const contradiction of context.coverage.contradictions)
    if (
      contradiction.status === "active" &&
      (contradiction.surface_ids.some((id) =>
        context.scope.surfaceIds.has(id),
      ) ||
        contradiction.claim_ids.some((id) => context.scope.claimIds.has(id)))
    ) {
      addEvidence(context, contradiction.evidence_ids);
      addReason(
        context,
        "active-contradiction",
        contradiction.contradiction_id,
        "Active contradiction affects the completion boundary.",
      );
    }
};

export const evaluateReconstructionPackageProofs = (
  context: ReconstructionEvaluationContext,
): void => {
  const requiredArtifactDigests = [...context.scope.surfaceIds].flatMap(
    (surfaceId) => {
      const surface = context.surfaces.get(surfaceId);
      const artifact =
        surface === undefined
          ? undefined
          : context.artifacts.get(surface.artifact_id);
      return artifact === undefined ? [] : [artifact.artifact_sha256];
    },
  );
  for (const kind of context.boundary.required_package_proof_kinds) {
    const proofs = context.coverage.package_proofs.filter(
      (proof) => proof.kind === kind,
    );
    const applicable = (
      proof: ReconstructionCoverageData["package_proofs"][number],
    ): boolean =>
      requiredArtifactDigests.every((digest) =>
        proof.artifact_sha256s.includes(digest),
      ) && packageProofHasComparableEvidence(proof, context.evidenceById);
    const applicableProofs = proofs.filter(applicable);
    addEvidence(
      context,
      applicableProofs.flatMap((proof) => proof.evidence_ids),
    );
    if (applicableProofs.some((proof) => proof.status === "fail")) {
      addReason(
        context,
        "package-proof-failed",
        kind,
        "Required package or integration proof failed; all applicable outcomes are retained.",
      );
    } else if (
      applicableProofs.length > 0 &&
      applicableProofs.every((proof) => proof.status === "pass")
    ) {
      continue;
    } else if (proofs.length > 0) {
      if (applicableProofs.length === 0)
        addEvidence(
          context,
          proofs.flatMap((proof) => proof.evidence_ids),
        );
      addReason(
        context,
        "package-proof-unknown",
        kind,
        "Required package or integration proof has unresolved or unqualified outcomes.",
      );
    } else
      addReason(
        context,
        "package-proof-missing",
        kind,
        "Required package or integration proof is missing.",
      );
  }
};

const addReason = (
  context: ReconstructionEvaluationContext,
  code: ClosureReason["code"],
  subjectId: string,
  detail: string,
): void => {
  context.reasons.push({ code, subject_id: subjectId, detail });
};

const addEvidence = (
  context: ReconstructionEvaluationContext,
  evidenceIds: readonly string[],
): void => {
  for (const evidenceId of evidenceIds) context.evidenceIds.add(evidenceId);
};
