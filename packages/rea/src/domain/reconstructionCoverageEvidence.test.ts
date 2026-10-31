import { expect, it } from "vitest";

import { createEvidence, type Evidence } from "./evidence.js";
import { createEvidenceBundle } from "./evidenceBundle.js";
import {
  completeReconstructionCoverageFixture,
  assertReconstructionCoverageEvaluation,
  RECONSTRUCTION_COVERAGE_NOW,
  reconstructionCoverageDataFixture,
  reconstructionVerifierContractFixture,
} from "./reconstructionCoverage.fixture.js";
import type { ReconstructionCoverageData } from "./reconstructionCoverage.js";

const proof = (
  authority: Evidence["authority"],
  confidence: Evidence["confidence"],
) =>
  createEvidence(
    undefined,
    { id: "proof-test", name: "Proof fixture", version: "1" },
    {
      operation: "verify",
      parameters: {},
      authority,
      confidence,
      result:
        confidence === "observed" ||
        (authority === "shipped-artifact" && confidence === "derived")
          ? { status: "pass" }
          : { status: "unknown", note: "No replay was performed" },
    },
  );

const withProofs = (records: readonly Evidence[]) => {
  const { workspace, result } = completeReconstructionCoverageFixture();
  return reconstructionCoverageDataFixture({
    ...workspace,
    evidence_bundle: createEvidenceBundle([
      ...workspace.evidence_bundle.records,
      ...records,
    ]),
    verifier_results: [
      {
        ...result,
        evidence_ids: records.map(({ evidence_id }) => evidence_id),
      },
    ],
  });
};

const withPackageProof = (
  kind: ReconstructionCoverageData["package_proofs"][number]["kind"],
  record: Evidence,
  status: ReconstructionCoverageData["package_proofs"][number]["status"] = "pass",
) => {
  const { workspace } = completeReconstructionCoverageFixture();
  return reconstructionCoverageDataFixture({
    ...workspace,
    evidence_bundle: createEvidenceBundle([
      ...workspace.evidence_bundle.records,
      record,
    ]),
    package_proofs: [
      {
        proof_id: "selected",
        kind,
        status,
        artifact_sha256s: ["1".repeat(64)],
        evidence_ids: [record.evidence_id],
      },
    ],
    boundaries: workspace.boundaries.map((boundary) => ({
      ...boundary,
      required_package_proof_kinds: [kind],
    })),
  });
};

const evaluate = (coverage: ReconstructionCoverageData) =>
  assertReconstructionCoverageEvaluation(
    coverage,
    "replacement.cli",
    RECONSTRUCTION_COVERAGE_NOW,
  );

it.each([
  ["analyst-inference", "inferred"],
  ["analyst-inference", "derived"],
  ["analyst-inference", "observed"],
  ["controlled-replay", "inferred"],
  ["controlled-replay", "derived"],
  ["shipped-artifact", "observed"],
  ["external-service", "observed"],
  ["historical-reference", "observed"],
] as const)(
  "does not promote %s/%s into observed controlled replay",
  (authority, confidence) => {
    const record = proof(authority, confidence);
    const coverage = withProofs([record]);
    const result = evaluate(coverage);
    expect(result).toMatchObject({
      status: "unknown",
      reasons: [
        expect.objectContaining({
          code: "verifier-result-incompatible",
          subject_id: "claim.cli.help",
        }),
      ],
      evidence_ids: expect.arrayContaining([record.evidence_id]),
      recommended_probes: [
        expect.objectContaining({ operation: "run_reconstruction_verifier" }),
      ],
    });
    expect(
      coverage.evidence_bundle.records.find(
        ({ evidence_id }) => evidence_id === record.evidence_id,
      ),
    ).toEqual(record);
    expect(result.reasons[0]?.detail).toContain(
      "controlled-replay authority and confidence",
    );
  },
);

it("accepts cited observed replay alongside contextual inference without borrowing uncited proof", () => {
  const weak = proof("analyst-inference", "inferred");
  const observed = proof("controlled-replay", "observed");
  expect(evaluate(withProofs([weak, observed]))).toMatchObject({
    status: "ready",
    evidence_ids: expect.arrayContaining([
      weak.evidence_id,
      observed.evidence_id,
    ]),
  });
  expect(evaluate(withProofs([weak])).status).toBe("unknown");
});

it("does not fall back to older observed proof when the latest result only cites inference", () => {
  const record = proof("analyst-inference", "inferred");
  const coverage = withProofs([record]);
  const { result: previous } = completeReconstructionCoverageFixture();
  const latest = coverage.verifier_results[0];
  if (latest === undefined) throw new Error("Expected verifier result");
  const result = evaluate(
    reconstructionCoverageDataFixture({
      ...coverage,
      verifier_results: [
        previous,
        { ...latest, observed_at: "2026-07-16T11:30:00.000Z" },
      ],
    }),
  );
  expect(result.status).toBe("unknown");
  expect(result.evidence_ids).not.toContain(previous.evidence_ids[0]);
});

it.each([
  ["shipped-artifact", "shipped-artifact", "observed", "ready"],
  ["shipped-artifact", "shipped-artifact", "derived", "ready"],
  ["shipped-artifact", "shipped-artifact", "inferred", "unknown"],
  ["live-observation", "external-service", "observed", "ready"],
  ["live-observation", "controlled-replay", "observed", "ready"],
  ["external", "external-service", "observed", "ready"],
  ["external", "controlled-replay", "observed", "unknown"],
] as const)(
  "checks %s authority against actual %s/%s Evidence",
  (required, authority, confidence, status) => {
    const coverage = withProofs([proof(authority, confidence)]);
    const original = coverage.verifier_contracts[0];
    const result = coverage.verifier_results[0];
    if (original === undefined || result === undefined)
      throw new Error("Expected verifier contract");
    const { contract_sha256: _digest, ...input } = original;
    const contract = reconstructionVerifierContractFixture({
      ...input,
      authority: required,
    });
    const changed = reconstructionCoverageDataFixture({
      ...coverage,
      claims: coverage.claims.map((claim) => ({
        ...claim,
        required_authority: required,
      })),
      verifier_contracts: [contract],
      verifier_results: [
        { ...result, contract_sha256: contract.contract_sha256 },
      ],
    });
    expect(evaluate(changed).status).toBe(status);
  },
);

it.each([
  "build",
  "clean-install",
  "package-contents",
  "runtime-routing",
  "authority-independence",
] as const)("keeps %s unknown when only inferred Evidence is cited", (kind) => {
  const record = proof("analyst-inference", "inferred");
  const coverage = withPackageProof(kind, record);
  expect(evaluate(coverage)).toMatchObject({
    status: "unknown",
    reasons: [
      expect.objectContaining({
        code: "package-proof-unknown",
        subject_id: kind,
      }),
    ],
    evidence_ids: expect.arrayContaining([record.evidence_id]),
  });
});

it.each([
  ["build", "shipped-artifact", "observed", "unknown"],
  ["build", "external-service", "observed", "ready"],
  ["runtime-routing", "controlled-replay", "observed", "ready"],
  ["clean-install", "controlled-replay", "derived", "unknown"],
  ["package-contents", "shipped-artifact", "derived", "ready"],
  ["authority-independence", "shipped-artifact", "derived", "ready"],
] as const)(
  "checks %s proof at the actual %s/%s boundary",
  (kind, authority, confidence, status) => {
    expect(
      evaluate(withPackageProof(kind, proof(authority, confidence))).status,
    ).toBe(status);
  },
);

it("distinguishes observed package failure from an inferred failure claim", () => {
  const inference = proof("analyst-inference", "inferred");
  expect(evaluate(withPackageProof("build", inference, "fail"))).toMatchObject({
    status: "unknown",
    evidence_ids: expect.arrayContaining([inference.evidence_id]),
  });
  const observed = proof("controlled-replay", "observed");
  expect(evaluate(withPackageProof("build", observed, "fail"))).toMatchObject({
    status: "failed",
    reasons: [expect.objectContaining({ code: "package-proof-failed" })],
    evidence_ids: expect.arrayContaining([observed.evidence_id]),
  });
});
