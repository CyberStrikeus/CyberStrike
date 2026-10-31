import type { Evidence } from "./evidence.js";
import type {
  ReconstructionCoverageData,
  ReconstructionVerifierContract,
} from "./reconstructionCoverage.js";

type Authority = ReconstructionVerifierContract["authority"];
type PackageProof = ReconstructionCoverageData["package_proofs"][number];
type VerifierResult = ReconstructionCoverageData["verifier_results"][number];

const evidenceAuthorities: Readonly<
  Record<Authority, readonly Evidence["authority"][]>
> = {
  "shipped-artifact": ["shipped-artifact"],
  "controlled-replay": ["controlled-replay"],
  "live-observation": ["controlled-replay", "external-service"],
  external: ["external-service"],
};

const packageAuthorities: Readonly<
  Record<PackageProof["kind"], readonly Authority[]>
> = {
  build: ["live-observation"],
  "clean-install": ["live-observation"],
  "package-contents": ["shipped-artifact", "live-observation"],
  "runtime-routing": ["live-observation"],
  "authority-independence": ["shipped-artifact", "live-observation"],
};

/** Qualify only the Evidence cited by this verifier observation. */
export const verifierHasComparableEvidence = (
  result: VerifierResult,
  contract: ReconstructionVerifierContract,
  records: ReadonlyMap<string, Evidence>,
): boolean =>
  hasComparableEvidence(result.evidence_ids, [contract.authority], records);

/** Runtime package claims need observations; static package audits can be derived. */
export const packageProofHasComparableEvidence = (
  proof: PackageProof,
  records: ReadonlyMap<string, Evidence>,
): boolean =>
  hasComparableEvidence(
    proof.evidence_ids,
    packageAuthorities[proof.kind],
    records,
  );

const hasComparableEvidence = (
  evidenceIds: readonly string[],
  requirements: readonly Authority[],
  records: ReadonlyMap<string, Evidence>,
): boolean =>
  evidenceIds.some((id) => {
    const evidence = records.get(id);
    if (evidence === undefined) return false;
    return requirements.some(
      (required) =>
        evidenceAuthorities[required].includes(evidence.authority) &&
        (evidence.confidence === "observed" ||
          (required === "shipped-artifact" &&
            evidence.confidence === "derived")),
    );
  });
