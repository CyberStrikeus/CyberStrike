import { readyReviewedLedgerRequest } from "../../src/application/ReconstructionObligationLedger.fixture.js";
import { createEvidence } from "../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../src/domain/evidenceBundle.js";

import { reconstructionObligationProofSchema } from "../../src/domain/reconstructionObligationProof.js";
import type { ReconstructionObligationLedgerInput } from "../../src/domain/reconstructionObligationLedgerSchemas.js";

const replaceProof = (
  input: ReconstructionObligationLedgerInput,
  result: unknown,
): void => {
  const original = input.evidence_bundle.records.find(
    (record) => record.predicate_type === "rea.reconstruction-proof",
  )!;
  const replacement = createEvidence(undefined, original.provider, {
    predicateType: original.predicate_type,
    operation: original.operation,
    parameters: original.parameters,
    result: result,
    confidence: original.confidence,
    authority: original.authority,
  });
  input.evidence_bundle = createEvidenceBundle(
    input.evidence_bundle.records.map((record) =>
      record.evidence_id === original.evidence_id ? replacement : record,
    ),
  );
  const binding = input.manifest.bindings[0]!;
  binding.fixtures[0]!.evidence_ids = [replacement.evidence_id];
  binding.verifier!.result_evidence_id = replacement.evidence_id;
};

const applicabilitySpecifications = [
  {
    name: "matching implementation and revision",
    codes: [],
    status: "ready",
    reason: null,
  },
  {
    name: "stronger proof authority",
    codes: [],
    status: "ready",
    reason: null,
  },
  {
    name: "conflicting duplicate outcomes",
    codes: ["verifier-failed"],
    status: "failed",
    reason: "failed-proof",
  },
  {
    name: "failed proof for stale implementation",
    codes: ["inapplicable-fixture-proof", "inapplicable-verifier-proof"],
    status: "open",
    reason: "owner-mismatch",
  },
  {
    name: "changed implementation",
    codes: ["inapplicable-fixture-proof", "inapplicable-verifier-proof"],
    status: "open",
    reason: "owner-mismatch",
  },
  {
    name: "changed obligation revision",
    codes: ["inapplicable-fixture-proof", "inapplicable-verifier-proof"],
    status: "open",
    reason: "revision-mismatch",
  },
  {
    name: "legacy ID-only proof",
    codes: ["inapplicable-fixture-proof", "inapplicable-verifier-proof"],
    status: "open",
    reason: "invalid-proof",
  },
  {
    name: "missing implementation commitment",
    codes: ["inapplicable-fixture-proof", "inapplicable-verifier-proof"],
    status: "open",
    reason: "invalid-proof",
  },
  {
    name: "missing obligation revision",
    codes: ["inapplicable-fixture-proof", "inapplicable-verifier-proof"],
    status: "open",
    reason: "invalid-proof",
  },
  {
    name: "fixture case pair mismatch",
    codes: ["inapplicable-fixture-proof"],
    status: "open",
    reason: "claim-mismatch",
  },
  {
    name: "verifier claim pair mismatch",
    codes: ["inapplicable-verifier-proof"],
    status: "open",
    reason: "claim-mismatch",
  },
  {
    name: "claims in a stale binding",
    codes: ["inapplicable-fixture-proof", "inapplicable-verifier-proof"],
    status: "open",
    reason: "claim-mismatch",
  },
  {
    name: "failed fixture",
    codes: ["fixture-failed"],
    status: "failed",
    reason: "failed-proof",
  },
  ...[
    "mixed fixture outcomes",
    "reversed mixed fixture outcomes",
    "distinct fixture outcomes",
    "combined fixture proof IDs",
  ].map(
    (name) =>
      ({
        name,
        codes: ["fixture-failed"],
        status: "failed",
        reason: "failed-proof",
      }) as const,
  ),
  {
    name: "passing fixture with stale failed proof",
    codes: ["inapplicable-fixture-proof"],
    status: "open",
    reason: "owner-mismatch",
  },
  {
    name: "passing fixture with unselected failed proof",
    codes: [],
    status: "ready",
    reason: null,
  },
  {
    name: "failed verifier",
    codes: ["verifier-failed"],
    status: "failed",
    reason: "failed-proof",
  },
  {
    name: "unknown verifier declaration",
    codes: ["verifier-unavailable"],
    status: "open",
    reason: "Latest verifier status is unknown",
  },
] as const;
/** Authenticated synthetic Evidence; no declared verifier command executes. */
export const reconstructionProofApplicabilityCases = () =>
  applicabilitySpecifications.map((specification) => {
    const input = readyReviewedLedgerRequest();
    const result = reconstructionObligationProofSchema.parse(
      input.evidence_bundle.records.find(
        (record) => record.predicate_type === "rea.reconstruction-proof",
      )!.normalized_result,
    );
    const proof = result.bindings[0]!;
    switch (specification.name) {
      case "matching implementation and revision":
        break;
      case "stronger proof authority":
        input.manifest.bindings[0]!.fixtures[0]!.authority = "integration";
        input.manifest.bindings[0]!.verifier!.authority = "integration";
        break;
      case "conflicting duplicate outcomes":
        proof.verifiers.push({ ...proof.verifiers[0]!, passed: false });
        replaceProof(input, result);
        break;
      case "failed proof for stale implementation":
        input.manifest.bindings[0]!.owner.owner_sha256 = "2".repeat(64);
        proof.fixtures[0]!.passed = false;
        proof.verifiers[0]!.passed = false;
        replaceProof(input, result);
        break;
      case "changed implementation":
        input.manifest.bindings[0]!.owner.owner_sha256 = "2".repeat(64);
        break;
      case "changed obligation revision":
        input.reviewed_obligations[0]!.obligation_version = 2;
        break;
      case "legacy ID-only proof":
        replaceProof(input, {
          passed: true,
          obligation_ids: [proof.obligation_id],
          fixture_ids: [proof.fixtures[0]!.fixture_id],
          case_kinds: ["positive"],
          verifier_ids: [proof.verifiers[0]!.verifier_id],
          claim_ids: [proof.verifiers[0]!.claim_id],
        });
        break;
      case "missing implementation commitment":
        Reflect.deleteProperty(proof, "owner_sha256");
        replaceProof(input, result);
        break;
      case "missing obligation revision":
        Reflect.deleteProperty(proof, "obligation_version");
        replaceProof(input, result);
        break;
      case "fixture case pair mismatch":
        proof.fixtures[0]!.case_kind = "negative";
        proof.fixtures.push({
          fixture_id: "fixture.other",
          case_kind: "positive",
          passed: true,
        });
        replaceProof(input, result);
        break;
      case "verifier claim pair mismatch":
        proof.verifiers[0]!.claim_id = "claim.other";
        proof.verifiers.push({
          verifier_id: "verifier.other",
          claim_id: "claim.reviewed",
          passed: true,
        });
        replaceProof(input, result);
        break;
      case "claims in a stale binding":
        result.bindings.push({
          ...structuredClone(proof),
          owner_sha256: "2".repeat(64),
        });
        proof.fixtures = [];
        proof.verifiers = [];
        replaceProof(input, result);
        break;
      case "failed fixture":
        proof.fixtures[0]!.passed = false;
        replaceProof(input, result);
        break;
      case "mixed fixture outcomes":
      case "reversed mixed fixture outcomes":
      case "distinct fixture outcomes":
      case "combined fixture proof IDs":
      case "passing fixture with stale failed proof":
      case "passing fixture with unselected failed proof": {
        const binding = input.manifest.bindings[0]!;
        const passing = binding.fixtures[0]!;
        proof.fixtures[0]!.passed = false;
        if (specification.name === "distinct fixture outcomes")
          proof.fixtures[0]!.fixture_id = "fixture.failed";
        if (specification.name === "passing fixture with stale failed proof")
          proof.owner_sha256 = "2".repeat(64);
        const failed = createEvidence(
          undefined,
          {
            id: "failed-fixture",
            name: "Fixture verifier",
            version: "1",
          },
          {
            predicateType: "rea.reconstruction-proof",
            operation: "verify_reconstruction_obligations",
            parameters: {},
            result,
            confidence: "observed",
            authority: "controlled-replay",
          },
        );
        input.evidence_bundle = createEvidenceBundle([
          ...input.evidence_bundle.records,
          failed,
        ]);
        if (
          specification.name === "passing fixture with unselected failed proof"
        )
          break;
        if (specification.name === "combined fixture proof IDs")
          passing.evidence_ids.push(failed.evidence_id);
        else {
          const failing = {
            ...passing,
            fixture_id: proof.fixtures[0]!.fixture_id,
            evidence_ids: [failed.evidence_id],
          };
          binding.fixtures =
            specification.name === "reversed mixed fixture outcomes"
              ? [failing, passing]
              : [passing, failing];
        }
        break;
      }
      case "failed verifier":
        proof.verifiers[0]!.passed = false;
        replaceProof(input, result);
        break;
      case "unknown verifier declaration":
        input.manifest.bindings[0]!.verifier!.status = "unknown";
        break;
    }
    return { ...specification, input };
  });
