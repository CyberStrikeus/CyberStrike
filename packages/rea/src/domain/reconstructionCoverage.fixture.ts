import { createHash } from "node:crypto";

import canonicalize from "canonicalize";
import type { z } from "zod";

import { createEvidence } from "./evidence.js";
import { createEvidenceBundle } from "./evidenceBundle.js";
import {
  evaluateParsedReconstructionClosure,
  readReconstructionCoverageData,
  reconstructionCoverageDataSchema,
  type ReconstructionCoverageData,
  type ReconstructionVerifierContract,
} from "./reconstructionCoverage.js";

const verifierContractInputSchema =
  reconstructionCoverageDataSchema.shape.verifier_contracts.element.omit({
    contract_sha256: true,
  });

/** Author test coverage through the live authentication and reference owner. */
export const reconstructionCoverageDataFixture = (
  input: unknown,
): ReconstructionCoverageData => {
  const parsed = readReconstructionCoverageData(input);
  if (!parsed.ok) throw parsed.error;
  return parsed.value.coverage;
};

/** Commit schema-owned verifier fields with an independent canonical hash. */
export const reconstructionVerifierContractFixture = (
  input: z.input<typeof verifierContractInputSchema>,
): ReconstructionVerifierContract => {
  const contract = verifierContractInputSchema.parse(input);
  const encoded = canonicalize(contract);
  if (encoded === undefined)
    throw new TypeError("Unserializable fixture verifier contract");
  return {
    ...contract,
    contract_sha256: createHash("sha256").update(encoded).digest("hex"),
  };
};

const digest = (character: string): string => character.repeat(64);

const EVIDENCE_RECORDS = ["1", "2", "3", "4", "5"].map((character) =>
  createEvidence(
    undefined,
    { id: "fixture", name: "Fixture", version: "1" },
    {
      predicateType: "rea.coverage-fixture",
      operation: `fixture-${character}`,
      parameters: {},
      result: { character },
      confidence: "observed",
      authority:
        character === "3" || character === "4"
          ? "controlled-replay"
          : "shipped-artifact",
    },
  ),
);

/** Fixed evaluation time used by reconstruction-coverage tests. */
export const RECONSTRUCTION_COVERAGE_NOW = Date.parse(
  "2026-07-16T12:00:00.000Z",
);

/** Resolve the stable Evidence identifier for one fixture record. */
export const reconstructionCoverageEvidenceId = (character: string): string => {
  const record = EVIDENCE_RECORDS.find(
    ({ operation }) => operation === `fixture-${character}`,
  );
  if (record === undefined) throw new Error("Missing fixture Evidence");
  return record.evidence_id;
};

/** Build one fully closed reconstruction-coverage workspace. */
export const completeReconstructionCoverageData = () => {
  const contract = reconstructionVerifierContractFixture({
    verifier_id: "verify.cli.help",
    claim_ids: ["claim.cli.help"],
    dimensions: ["output", "exit"],
    authority: "controlled-replay",
    max_age_ms: 86_400_000,
    minimum_repeats: 2,
    normalization_sha256: digest("4"),
    normalization_removes_dimensions: false,
  });
  return reconstructionCoverageDataFixture({
    evidence_bundle: createEvidenceBundle(EVIDENCE_RECORDS),
    artifacts: [
      {
        artifact_id: "authority.v1",
        artifact_sha256: digest("1"),
        version: "1.0.0",
        environment_sha256: digest("2"),
        evidence_ids: [reconstructionCoverageEvidenceId("1")],
      },
    ],
    surfaces: [
      {
        surface_id: "cli.help",
        family: "cli-command",
        artifact_id: "authority.v1",
        occurrence_id: "occ-help",
        location: "bin/app --help",
        authority: "observed",
        dependency_surface_ids: [],
        evidence_ids: [reconstructionCoverageEvidenceId("2")],
      },
    ],
    owners: [
      {
        surface_id: "cli.help",
        ownership: {
          disposition: "implemented",
          owner_path: "src/cli.ts",
          owner_export: "registerHelp",
          owner_sha256: digest("3"),
          path_state: "present",
          package_state: "distributed",
          authority_route: "none",
        },
      },
    ],
    claims: [
      {
        claim_id: "claim.cli.help",
        title: "Help output and exit behavior match",
        kind: "behavioral",
        surface_ids: ["cli.help"],
        required_dimensions: ["output", "exit"],
        required_authority: "controlled-replay",
      },
    ],
    verifier_contracts: [contract],
    verifier_results: [
      {
        verifier_id: contract.verifier_id,
        contract_sha256: contract.contract_sha256,
        observed_at: "2026-07-16T11:00:00.000Z",
        status: "pass",
        covered_claim_ids: ["claim.cli.help"],
        covered_dimensions: ["output", "exit"],
        artifact_sha256s: [digest("1")],
        owner_sha256s: [digest("3")],
        normalization_sha256: digest("4"),
        repeats: 2,
        evidence_ids: [reconstructionCoverageEvidenceId("3")],
      },
    ],
    residual_unknown_ids: [],
    contradictions: [],
    package_proofs: [
      {
        proof_id: "proof.clean-install",
        kind: "clean-install",
        status: "pass",
        artifact_sha256s: [digest("1")],
        evidence_ids: [reconstructionCoverageEvidenceId("4")],
      },
      {
        proof_id: "proof.authority-independence",
        kind: "authority-independence",
        status: "pass",
        artifact_sha256s: [digest("1")],
        evidence_ids: [reconstructionCoverageEvidenceId("5")],
      },
    ],
    boundaries: [
      {
        boundary_id: "replacement.cli",
        title: "CLI replacement",
        required_surface_ids: ["cli.help"],
        required_claim_ids: ["claim.cli.help"],
        required_package_proof_kinds: [
          "clean-install",
          "authority-independence",
        ],
        allowed_dispositions: [],
        allowed_unknown_ids: [],
      },
    ],
  });
};

/** Assert successful domain parsing and evaluation for semantic test fixtures. */
export const assertReconstructionCoverageEvaluation = (
  input: unknown,
  boundaryId: string,
  nowEpochMs: number,
) => {
  const parsed = readReconstructionCoverageData(input, ["coverage"]);
  if (!parsed.ok) throw parsed.error;
  const result = evaluateParsedReconstructionClosure(
    parsed.value,
    boundaryId,
    nowEpochMs,
  );
  if (!result.ok) throw result.error;
  return result.value;
};

/** Complete workspace with its first verifier result and boundary narrowed once. */
export const completeReconstructionCoverageFixture = () => {
  const workspace = completeReconstructionCoverageData();
  const result = workspace.verifier_results[0];
  const boundary = workspace.boundaries[0];
  if (result === undefined || boundary === undefined)
    throw new Error("Expected complete reconstruction coverage fixture");
  return { workspace, result, boundary };
};
