import { reconstructionCoverageScopeCases } from "./reconstructionCoverageScope.fixture.js";
import { describe, expect, it } from "vitest";

import {
  completeReconstructionCoverageData,
  completeReconstructionCoverageFixture,
  assertReconstructionCoverageEvaluation,
  RECONSTRUCTION_COVERAGE_NOW,
  reconstructionCoverageEvidenceId,
  reconstructionCoverageDataFixture,
  reconstructionVerifierContractFixture,
} from "./reconstructionCoverage.fixture.js";
import {
  evaluateParsedReconstructionClosure,
  readReconstructionCoverageData,
  type ReconstructionCoverageData,
} from "./reconstructionCoverage.js";

const digest = (character: string): string => character.repeat(64);

it("preserves duplicate coverage owners instead of overwriting them in shared indexes", () => {
  const workspace = completeReconstructionCoverageData();
  const owner = workspace.owners[0];
  if (owner === undefined) throw new Error("Expected fixture owner");
  const result = assertReconstructionCoverageEvaluation(
    {
      ...workspace,
      owners: [owner, owner],
    },
    "replacement.cli",
    RECONSTRUCTION_COVERAGE_NOW,
  );
  expect(result).toMatchObject({
    status: "partial",
    reasons: expect.arrayContaining([
      expect.objectContaining({
        code: "owner-duplicate",
        subject_id: "cli.help",
      }),
    ]),
  });
});

describe("reconstruction coverage closure", () => {
  it("returns ready only when ownership, verification, package, and authority closure pass", () => {
    const workspace = completeReconstructionCoverageData();

    expect(
      assertReconstructionCoverageEvaluation(
        workspace,
        "replacement.cli",
        RECONSTRUCTION_COVERAGE_NOW,
      ),
    ).toMatchObject({
      status: "ready",
      summary: { required_surfaces: 1, required_claims: 1, reasons: 0 },
      evidence_ids: [
        reconstructionCoverageEvidenceId("2"),
        reconstructionCoverageEvidenceId("3"),
        reconstructionCoverageEvidenceId("4"),
        reconstructionCoverageEvidenceId("5"),
      ].sort(),
    });
  });

  it("keeps an incomplete inventory partial despite every registered verifier passing", () => {
    const workspace = completeReconstructionCoverageData();
    const semantic = workspace;
    const boundary = workspace.boundaries[0];
    if (boundary === undefined) throw new Error("Expected fixture boundary");
    const incomplete = reconstructionCoverageDataFixture({
      ...semantic,
      boundaries: [
        {
          ...boundary,
          required_surface_ids: ["cli.help", "cli.version"],
        },
      ],
    });

    expect(
      assertReconstructionCoverageEvaluation(
        incomplete,
        "replacement.cli",
        RECONSTRUCTION_COVERAGE_NOW,
      ),
    ).toMatchObject({
      status: "partial",
      reasons: [
        expect.objectContaining({
          code: "surface-missing",
          subject_id: "cli.version",
        }),
      ],
      recommended_probes: [
        {
          operation: "update_authoritative_inventory",
          subject_id: "cli.version",
          rationale:
            "Required surface is absent from the authoritative inventory.",
        },
      ],
    });
  });

  it("returns recommendations for every missing required surface", () => {
    const workspace = completeReconstructionCoverageData();
    const boundary = workspace.boundaries[0];
    if (boundary === undefined) throw new Error("Expected fixture boundary");
    const missingSurfaces = Array.from(
      { length: 10_001 },
      (_, index) => `missing.surface.${index}`,
    );
    const incomplete = reconstructionCoverageDataFixture({
      ...workspace,
      boundaries: [{ ...boundary, required_surface_ids: missingSurfaces }],
    });

    const result = assertReconstructionCoverageEvaluation(
      incomplete,
      boundary.boundary_id,
      RECONSTRUCTION_COVERAGE_NOW,
    );

    expect(result.reasons).toHaveLength(missingSurfaces.length);
    expect(result.recommended_probes).toHaveLength(missingSurfaces.length);
  });

  it("invalidates stale verifier contracts and detected authority routing", () => {
    const workspace = completeReconstructionCoverageData();
    const owner = workspace.owners[0];
    if (owner === undefined || owner.ownership.disposition !== "implemented")
      throw new Error("Expected implemented fixture owner");
    const semantic = workspace;
    const changed = reconstructionCoverageDataFixture({
      ...semantic,
      owners: [
        {
          ...owner,
          ownership: {
            ...owner.ownership,
            owner_sha256: digest("9"),
            path_state: "present",
            package_state: "distributed",
            authority_route: "detected",
          },
        },
      ],
    });

    const result = assertReconstructionCoverageEvaluation(
      changed,
      "replacement.cli",
      RECONSTRUCTION_COVERAGE_NOW,
    );
    expect(result.status).toBe("failed");
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "authority-routing-detected" }),
        expect.objectContaining({ code: "verifier-result-incompatible" }),
      ]),
    );
  });

  it("does not let stale verifier results satisfy current claims", () => {
    const workspace = completeReconstructionCoverageData();
    const semantic = workspace;
    const stale = reconstructionCoverageDataFixture({
      ...semantic,
      verifier_results: workspace.verifier_results.map((result) => ({
        ...result,
        observed_at: "2026-07-01T00:00:00.000Z",
      })),
    });

    expect(
      assertReconstructionCoverageEvaluation(
        stale,
        "replacement.cli",
        RECONSTRUCTION_COVERAGE_NOW,
      ),
    ).toMatchObject({
      status: "unknown",
      reasons: [expect.objectContaining({ code: "verifier-result-stale" })],
    });
  });
});

describe("reconstruction coverage verifier observations", () => {
  it("uses one contract and result for each claim covered by a shared verifier", () => {
    const workspace = completeReconstructionCoverageData();
    const contract = workspace.verifier_contracts[0];
    const result = workspace.verifier_results[0];
    const claim = workspace.claims[0];
    const boundary = workspace.boundaries[0];
    if (
      contract === undefined ||
      result === undefined ||
      claim === undefined ||
      boundary === undefined
    )
      throw new Error("Expected complete reconstruction coverage fixture");
    const secondClaimId = "claim.cli.version";
    const sharedContract = reconstructionVerifierContractFixture({
      verifier_id: contract.verifier_id,
      claim_ids: [...contract.claim_ids, secondClaimId],
      dimensions: contract.dimensions,
      authority: contract.authority,
      max_age_ms: contract.max_age_ms,
      minimum_repeats: contract.minimum_repeats,
      normalization_sha256: contract.normalization_sha256,
      normalization_removes_dimensions:
        contract.normalization_removes_dimensions,
    });
    const sharedResult = {
      ...result,
      contract_sha256: sharedContract.contract_sha256,
      covered_claim_ids: [...result.covered_claim_ids, secondClaimId],
    };
    const shared = reconstructionCoverageDataFixture({
      ...workspace,
      claims: [
        ...workspace.claims,
        { ...claim, claim_id: secondClaimId, title: "Version output matches" },
      ],
      verifier_contracts: [sharedContract],
      verifier_results: [sharedResult],
      boundaries: [
        {
          ...boundary,
          required_claim_ids: [...boundary.required_claim_ids, secondClaimId],
        },
      ],
    });

    expect(
      assertReconstructionCoverageEvaluation(
        shared,
        boundary.boundary_id,
        RECONSTRUCTION_COVERAGE_NOW,
      ),
    ).toMatchObject({
      status: "ready",
      summary: { required_claims: 2, reasons: 0 },
    });
  });
});

describe("reconstruction coverage verifier selection", () => {
  it("keeps ambiguous verifier contracts and missing results actionable", () => {
    const workspace = completeReconstructionCoverageData();
    const contract = workspace.verifier_contracts[0];
    const result = workspace.verifier_results[0];
    const boundary = workspace.boundaries[0];
    if (
      contract === undefined ||
      result === undefined ||
      boundary === undefined
    )
      throw new Error("Expected complete reconstruction coverage fixture");
    const alternateContract = reconstructionVerifierContractFixture({
      verifier_id: "verify.cli.help.alternate",
      claim_ids: contract.claim_ids,
      dimensions: contract.dimensions,
      authority: contract.authority,
      max_age_ms: contract.max_age_ms,
      minimum_repeats: contract.minimum_repeats,
      normalization_sha256: contract.normalization_sha256,
      normalization_removes_dimensions:
        contract.normalization_removes_dimensions,
    });
    const ambiguous = reconstructionCoverageDataFixture({
      ...workspace,
      verifier_contracts: [...workspace.verifier_contracts, alternateContract],
      verifier_results: [
        ...workspace.verifier_results,
        {
          ...result,
          verifier_id: alternateContract.verifier_id,
          contract_sha256: alternateContract.contract_sha256,
        },
      ],
    });
    expect(
      assertReconstructionCoverageEvaluation(
        ambiguous,
        boundary.boundary_id,
        RECONSTRUCTION_COVERAGE_NOW,
      ).reasons,
    ).toEqual([
      expect.objectContaining({
        code: "verifier-duplicate",
        subject_id: "claim.cli.help",
      }),
    ]);

    const missing = reconstructionCoverageDataFixture({
      ...workspace,
      verifier_results: [],
    });
    expect(
      assertReconstructionCoverageEvaluation(
        missing,
        boundary.boundary_id,
        RECONSTRUCTION_COVERAGE_NOW,
      ).reasons,
    ).toEqual([
      expect.objectContaining({
        code: "verifier-result-missing",
        subject_id: "claim.cli.help",
      }),
    ]);
  });
});

describe("reconstruction coverage conflicting latest verifier observations", () => {
  it("keeps conflicting tied assessments unknown regardless of input order", () => {
    const { workspace, result, boundary } =
      completeReconstructionCoverageFixture();
    const failed = {
      ...result,
      status: "fail" as const,
      evidence_ids: [reconstructionCoverageEvidenceId("1")],
    };
    const firstPass = reconstructionCoverageDataFixture({
      ...workspace,
      verifier_results: [result, failed],
    });
    const firstFail = reconstructionCoverageDataFixture({
      ...workspace,
      verifier_results: [failed, result],
    });

    const firstPassResult = assertReconstructionCoverageEvaluation(
      firstPass,
      boundary.boundary_id,
      RECONSTRUCTION_COVERAGE_NOW,
    );
    const firstFailResult = assertReconstructionCoverageEvaluation(
      firstFail,
      boundary.boundary_id,
      RECONSTRUCTION_COVERAGE_NOW,
    );
    expect(firstPassResult).toEqual(firstFailResult);
    expect(firstPassResult).toMatchObject({
      status: "unknown",
      reasons: [
        expect.objectContaining({
          code: "verifier-result-ambiguous",
          subject_id: "claim.cli.help",
        }),
      ],
    });
    expect(firstPassResult.evidence_ids).toEqual(
      expect.arrayContaining([
        reconstructionCoverageEvidenceId("3"),
        reconstructionCoverageEvidenceId("1"),
      ]),
    );
  });
});

describe("reconstruction coverage equivalent latest verifier observations", () => {
  it("coalesces equivalent equal-instant observations and retains all evidence", () => {
    const { workspace, result, boundary } =
      completeReconstructionCoverageFixture();
    const first = {
      ...result,
      observed_at: "2026-07-16T11:00:00.123456789012345678900Z",
    };
    const equivalent = {
      ...first,
      observed_at: "2026-07-16T06:00:00.1234567890123456789-05:00",
      covered_claim_ids: [...result.covered_claim_ids].reverse(),
      covered_dimensions: [...result.covered_dimensions].reverse(),
      artifact_sha256s: [...result.artifact_sha256s].reverse(),
      owner_sha256s: [...result.owner_sha256s].reverse(),
      evidence_ids: [reconstructionCoverageEvidenceId("1")],
    };
    const forward = reconstructionCoverageDataFixture({
      ...workspace,
      verifier_results: [first, equivalent],
    });
    const reversed = reconstructionCoverageDataFixture({
      ...workspace,
      verifier_results: [equivalent, first],
    });
    const forwardResult = assertReconstructionCoverageEvaluation(
      forward,
      boundary.boundary_id,
      RECONSTRUCTION_COVERAGE_NOW,
    );
    const reversedResult = assertReconstructionCoverageEvaluation(
      reversed,
      boundary.boundary_id,
      RECONSTRUCTION_COVERAGE_NOW,
    );

    expect(forwardResult).toEqual(reversedResult);
    expect(forwardResult.status).toBe("ready");
    expect(forwardResult.evidence_ids).toEqual(
      expect.arrayContaining([
        reconstructionCoverageEvidenceId("3"),
        reconstructionCoverageEvidenceId("1"),
      ]),
    );
  });
});

describe("reconstruction coverage verifier timestamp selection", () => {
  it("lets a later unambiguous observation supersede an older tie", () => {
    const { workspace, result, boundary } =
      completeReconstructionCoverageFixture();
    const failed = { ...result, status: "fail" as const };
    const latestPass = {
      ...result,
      observed_at: "2026-07-16T11:30:00.000Z",
    };
    const changed = reconstructionCoverageDataFixture({
      ...workspace,
      verifier_results: [result, failed, latestPass],
    });

    expect(
      assertReconstructionCoverageEvaluation(
        changed,
        boundary.boundary_id,
        RECONSTRUCTION_COVERAGE_NOW,
      ),
    ).toMatchObject({ status: "ready", reasons: [] });
  });

  /** Evaluate a workspace whose newest verifier observation fails the closure. */
  const expectNewestObservationFails = (passedAt: string, failedAt: string) => {
    const { workspace, result } = completeReconstructionCoverageFixture();
    const changed = reconstructionCoverageDataFixture({
      ...workspace,
      verifier_results: [
        { ...result, observed_at: passedAt },
        { ...result, observed_at: failedAt, status: "fail" },
      ],
    });

    expect(
      assertReconstructionCoverageEvaluation(
        changed,
        "replacement.cli",
        RECONSTRUCTION_COVERAGE_NOW,
      ),
    ).toMatchObject({
      status: "failed",
      reasons: [expect.objectContaining({ code: "verifier-failed" })],
    });
  };

  it("orders offset-bearing verifier timestamps chronologically", () => {
    expectNewestObservationFails(
      "2026-07-16T08:00:00.000Z",
      "2026-07-16T04:00:00.000-05:00",
    );
  });

  it("selects the later result when timestamps differ below millisecond precision", () => {
    expectNewestObservationFails(
      "2026-07-16T11:00:00.1231Z",
      "2026-07-16T11:00:00.1239Z",
    );
  });
});

describe("reconstruction coverage verifier future timestamps", () => {
  it("treats an observation beyond millisecond-precision now as future", () => {
    const { workspace, result } = completeReconstructionCoverageFixture();
    const changed = reconstructionCoverageDataFixture({
      ...workspace,
      verifier_results: [
        { ...result, observed_at: "2026-07-16T12:00:00.1239Z" },
      ],
    });

    expect(
      assertReconstructionCoverageEvaluation(
        changed,
        "replacement.cli",
        Date.parse("2026-07-16T12:00:00.123Z") + 0.5,
      ),
    ).toMatchObject({
      status: "unknown",
      reasons: [expect.objectContaining({ code: "verifier-result-stale" })],
    });
  });

  it("rejects a non-finite evaluation clock", () => {
    const workspace = completeReconstructionCoverageData();
    const parsed = readReconstructionCoverageData(workspace, ["coverage"]);
    if (!parsed.ok) throw parsed.error;
    expect(() =>
      evaluateParsedReconstructionClosure(
        parsed.value,
        "replacement.cli",
        Number.NaN,
      ),
    ).toThrow("Expected finite epoch milliseconds.");
  });

  it("rejects verifier observations from the future", () => {
    const { workspace, result } = completeReconstructionCoverageFixture();
    const semantic = workspace;
    const changed = reconstructionCoverageDataFixture({
      ...semantic,
      verifier_results: [
        { ...result, observed_at: "2026-07-17T12:00:00.000Z" },
      ],
    });

    expect(
      assertReconstructionCoverageEvaluation(
        changed,
        "replacement.cli",
        RECONSTRUCTION_COVERAGE_NOW,
      ),
    ).toMatchObject({
      status: "unknown",
      reasons: [expect.objectContaining({ code: "verifier-result-stale" })],
    });
  });

  it("rejects green results and package proofs that omit current commitments", () => {
    const workspace = completeReconstructionCoverageData();
    const semantic = workspace;
    const incomplete = reconstructionCoverageDataFixture({
      ...semantic,
      verifier_results: workspace.verifier_results.map((result) => ({
        ...result,
        owner_sha256s: [],
      })),
      package_proofs: workspace.package_proofs.map((proof) => ({
        ...proof,
        artifact_sha256s: [digest("8")],
      })),
    });

    const result = assertReconstructionCoverageEvaluation(
      incomplete,
      "replacement.cli",
      RECONSTRUCTION_COVERAGE_NOW,
    );
    expect(result.status).toBe("unknown");
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "verifier-result-incompatible" }),
        expect.objectContaining({ code: "package-proof-unknown" }),
      ]),
    );
  });
});

describe("reconstruction coverage reference constraints", () => {
  it.each([
    {
      label: "surface artifact",
      change: (coverage: ReconstructionCoverageData) => ({
        ...coverage,
        surfaces: coverage.surfaces.map((surface) => ({
          ...surface,
          artifact_id: "missing.artifact",
        })),
      }),
      path: ["coverage", "surfaces", 0, "artifact_id"],
    },
    {
      label: "artifact Evidence",
      change: (coverage: ReconstructionCoverageData) => ({
        ...coverage,
        artifacts: coverage.artifacts.map((artifact) => ({
          ...artifact,
          evidence_ids: [`ev_${"f".repeat(64)}`],
        })),
      }),
      path: ["coverage", "artifacts", 0, "evidence_ids", 0],
    },
    {
      label: "verifier contract digest",
      change: (coverage: ReconstructionCoverageData) => ({
        ...coverage,
        verifier_contracts: coverage.verifier_contracts.map((contract) => ({
          ...contract,
          contract_sha256: "f".repeat(64),
        })),
      }),
      path: ["coverage", "verifier_contracts", 0, "contract_sha256"],
    },
  ])(
    "locates the invalid $label independently of source bundle integrity",
    ({ change, path }) => {
      const coverage = completeReconstructionCoverageData();
      const result = readReconstructionCoverageData(change(coverage), [
        "coverage",
      ]);
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisInputError",
          issues: [{ path, reason: "invalid_value" }],
        },
      });
    },
  );
});

describe("effective reconstruction boundary", () => {
  for (const {
    label,
    coverage,
    status,
    codes,
    surfaces,
    evidenceIds,
  } of reconstructionCoverageScopeCases())
    it(label, () => {
      const result = assertReconstructionCoverageEvaluation(
        coverage,
        "replacement.cli",
        RECONSTRUCTION_COVERAGE_NOW,
      );
      expect(result.status).toBe(status);
      expect(result.summary.required_surfaces).toBe(surfaces);
      expect(result.reasons.map(({ code }) => code).sort()).toEqual(
        [...codes].sort(),
      );
      expect(result.evidence_ids).toEqual(
        expect.arrayContaining([...evidenceIds]),
      );
      expect(result.recommended_probes).toHaveLength(codes.length);
    });
});
