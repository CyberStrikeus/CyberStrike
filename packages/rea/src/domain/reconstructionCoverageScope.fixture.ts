import { createEvidence } from "./evidence.js";
import { createEvidenceBundle } from "./evidenceBundle.js";
import {
  completeReconstructionCoverageData,
  reconstructionCoverageEvidenceId,
} from "./reconstructionCoverage.fixture.js";
import type {
  ReconstructionCoverageData,
  ReconstructionClosureResult,
} from "./reconstructionCoverage.js";

const indirectSurface = (coverage: ReconstructionCoverageData): void => {
  coverage.surfaces.push({
    ...coverage.surfaces[0]!,
    surface_id: "cli.indirect",
  });
  coverage.owners.push({
    ...structuredClone(coverage.owners[0]!),
    surface_id: "cli.indirect",
  });
};

const conflictingPackageProof = (
  coverage: ReconstructionCoverageData,
  status: "fail" | "unknown",
): string => {
  const evidence = createEvidence(
    undefined,
    {
      id: "package-proof-fixture",
      name: "Package proof fixture",
      version: "1",
    },
    {
      operation: "record_package_proof",
      parameters: {},
      result: { status },
      authority: "controlled-replay",
      confidence: "observed",
    },
  );
  coverage.evidence_bundle = createEvidenceBundle([
    ...coverage.evidence_bundle.records,
    evidence,
  ]);
  coverage.package_proofs.push({
    ...coverage.package_proofs[0]!,
    proof_id: `proof.additional.${status}`,
    status,
    evidence_ids: [evidence.evidence_id],
  });
  return evidence.evidence_id;
};

const cases: {
  label: string;
  status: ReconstructionClosureResult["status"];
  codes: readonly string[];
  surfaces: number;
  change: (coverage: ReconstructionCoverageData) => readonly string[];
}[] = [
  {
    label: "complete control",
    status: "ready",
    codes: [],
    surfaces: 1,
    change: () => [],
  },
  {
    label: "reachable dependency cycle",
    status: "ready",
    codes: [],
    surfaces: 2,
    change: (coverage) => {
      indirectSurface(coverage);
      coverage.surfaces[0]!.dependency_surface_ids = ["cli.indirect"];
      coverage.surfaces[1]!.dependency_surface_ids = ["cli.help"];
      return [];
    },
  },
  {
    label: "missing transitive dependency",
    status: "partial",
    codes: ["dependency-surface-missing"],
    surfaces: 3,
    change: (coverage) => {
      indirectSurface(coverage);
      coverage.surfaces[0]!.dependency_surface_ids = ["cli.indirect"];
      coverage.surfaces[1]!.dependency_surface_ids = ["cli.absent"];
      return [];
    },
  },
  {
    label: "claim-only authority routing",
    status: "failed",
    codes: ["authority-routing-detected"],
    surfaces: 2,
    change: (coverage) => {
      indirectSurface(coverage);
      coverage.claims[0]!.surface_ids = ["cli.indirect"];
      const owner = coverage.owners[1]!.ownership;
      if (owner.disposition === "implemented")
        owner.authority_route = "detected";
      return [];
    },
  },
  {
    label: "claim-only active contradiction",
    status: "failed",
    codes: ["active-contradiction"],
    surfaces: 2,
    change: (coverage) => {
      indirectSurface(coverage);
      coverage.claims[0]!.surface_ids = ["cli.indirect"];
      const evidenceIds = [
        reconstructionCoverageEvidenceId("1"),
        reconstructionCoverageEvidenceId("5"),
      ];
      coverage.contradictions = [
        {
          contradiction_id: "contradiction.indirect",
          status: "active",
          surface_ids: ["cli.indirect"],
          claim_ids: [],
          evidence_ids: evidenceIds,
        },
      ];
      return evidenceIds;
    },
  },
  {
    label: "claim-only artifact package coverage",
    status: "unknown",
    codes: ["package-proof-unknown", "package-proof-unknown"],
    surfaces: 2,
    change: (coverage) => {
      indirectSurface(coverage);
      coverage.artifacts.push({
        ...coverage.artifacts[0]!,
        artifact_id: "authority.v2",
        artifact_sha256: "9".repeat(64),
      });
      coverage.surfaces[1]!.artifact_id = "authority.v2";
      coverage.claims[0]!.surface_ids = ["cli.indirect"];
      coverage.verifier_results[0]!.artifact_sha256s.push("9".repeat(64));
      return [];
    },
  },
  {
    label: "transitive owner commitment",
    status: "unknown",
    codes: ["verifier-result-incompatible"],
    surfaces: 2,
    change: (coverage) => {
      indirectSurface(coverage);
      coverage.surfaces[0]!.dependency_surface_ids = ["cli.indirect"];
      const owner = coverage.owners[1]!.ownership;
      if (owner.disposition === "implemented")
        owner.owner_sha256 = "9".repeat(64);
      return [];
    },
  },
  ...([false, true] as const).map((reverse) => ({
    label: `conflicting package proofs ${reverse ? "reversed" : "forward"}`,
    status: "failed" as const,
    codes: ["package-proof-failed"],
    surfaces: 1,
    change: (coverage: ReconstructionCoverageData) => {
      const evidenceId = conflictingPackageProof(coverage, "fail");
      if (reverse) coverage.package_proofs.reverse();
      return [evidenceId];
    },
  })),
  {
    label: "unresolved applicable package proof",
    status: "unknown",
    codes: ["package-proof-unknown"],
    surfaces: 1,
    change: (coverage) => [conflictingPackageProof(coverage, "unknown")],
  },
];
/** Small authenticated synthetic workspaces shared by domain and public workflows. */
export const reconstructionCoverageScopeCases = () =>
  cases.map(({ change, ...expectation }) => {
    const coverage = completeReconstructionCoverageData();
    return { ...expectation, coverage, evidenceIds: change(coverage) };
  });
