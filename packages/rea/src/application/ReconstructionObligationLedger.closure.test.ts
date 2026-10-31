import { describe, expect, it } from "vitest";
import { createEvidenceBundle } from "../domain/evidenceBundle.js";

import {
  build,
  deriveCandidates,
  resolveRequest,
  originalCases,
  processEvidence,
  proofEvidence,
  readyProcessLedgerRequest,
  readyReviewedLedgerRequest,
  request,
  reviewedObligation,
} from "./ReconstructionObligationLedger.fixture.js";
import { evaluateReconstructionObligationLedger } from "./ReconstructionObligationLedgerEvaluation.js";

describe("reconstruction obligation ledger", () => {
  it("emits the complete deterministic ledger and closure identity", () => {
    const evidence = proofEvidence("review");
    const reviewed = [
      reviewedObligation("obl.review.one", evidence.evidence_id),
      reviewedObligation("obl.review.two", evidence.evidence_id),
    ];
    const first = build(
      request([evidence], { reviewed_obligations: reviewed }),
    );
    const second = build(
      request([evidence], { reviewed_obligations: reviewed }),
    );
    expect(first.obligations).toHaveLength(2);
    expect(first).toEqual(second);
    expect(first.obligations[0]?.source_state).toBe("reviewed");
    expect(first.status).toBe("open");
  });

  it("merges repeated captures of one process scenario into one definition", () => {
    const first = processEvidence();
    const second = processEvidence({
      residual_unknowns: [{ scope: "network", reason: "Second run only." }],
    });
    expect(second.evidence_id).not.toBe(first.evidence_id);
    const single = build(request([first]));
    const repeated = build(request([first, second]));

    const obligation = repeated.obligations[0];
    expect(repeated.obligations).toHaveLength(1);
    expect(obligation?.obligation_id).toBe(
      single.obligations[0]?.obligation_id,
    );
    expect(obligation?.diagnostics.map(({ code }) => code)).not.toContain(
      "duplicate-definition",
    );
    expect(
      obligation?.authority_references.map(({ evidence_id: id }) => id).sort(),
    ).toEqual([first.evidence_id, second.evidence_id].sort());
    // The second capture's own uncertainty stays visible after the merge.
    expect(obligation?.unavailable_authority).toContain(
      "network: Second run only.",
    );
  });

  it("still reports a reviewed definition that reuses a generated ID", () => {
    const capture = processEvidence();
    const generated = build(request([capture])).obligations[0];
    if (generated === undefined) throw new Error("Expected process obligation");
    const ledger = build(
      request([capture], {
        reviewed_obligations: [
          reviewedObligation(generated.obligation_id, capture.evidence_id),
        ],
      }),
    );

    expect(
      ledger.obligations[0]?.diagnostics.map(({ code }) => code),
    ).toContain("duplicate-definition");
  });

  it("does not let green unit evidence close a packaged-process obligation", () => {
    const capture = processEvidence();
    const proof = proofEvidence("green-unit");
    const initial = build(request([capture, proof]));
    const obligation = initial.obligations[0];
    if (obligation === undefined)
      throw new Error("Expected process obligation");
    const unitBinding = {
      obligation_id: obligation.obligation_id,
      owner: {
        module_path: "src/processOwner.ts",
        symbol: "runProcess",
        owner_sha256: "1".repeat(64),
      },
      parser_type: null,
      original_cases: originalCases(obligation, capture.evidence_id),
      fixtures: obligation.required_case_kinds.map((caseKind) => ({
        fixture_id: `fixture.${caseKind}`,
        case_kind: caseKind,
        authority: "unit" as const,
        evidence_ids: [proof.evidence_id],
      })),
      verifier: {
        verifier_id: "verifier.unit",
        claim_id: "claim.process",
        command: "npm test -- processOwner",
        authority: "unit" as const,
        status: "pass" as const,
        result_evidence_id: proof.evidence_id,
        enumerated_obligation_ids: [obligation.obligation_id],
        nondeterminism: {
          mode: "total-order" as const,
          specification: "Exact unit-call order.",
        },
      },
    };

    const result = build(
      request([capture, proof], {
        manifest: {
          bindings: [unitBinding],
          contradictions: [],
        },
      }),
    );
    const evaluated = result.obligations[0];
    expect(evaluated?.status).toBe("implemented");
    expect(evaluated?.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "weak-fixture-authority",
        "weak-verifier-authority",
      ]),
    );
    expect(result.status).toBe("open");
  });
});

describe("reconstruction obligation ledger Evidence provenance", () => {
  it("links observed-case Evidence separately from authority references", () => {
    const capture = processEvidence();
    const caseEvidence = proofEvidence("distinct-original-case");
    const bundle = request([capture, caseEvidence]).evidence_bundle;
    const generated = deriveCandidates(bundle, []);
    const candidates = generated.candidates.map((candidate) => ({
      ...candidate,
      observed_cases: candidate.observed_cases.map((observedCase) => ({
        ...observedCase,
        evidence_id: caseEvidence.evidence_id,
      })),
    }));

    const result = evaluateReconstructionObligationLedger({
      candidates,
      sources: resolveRequest({
        evidence_bundle: bundle,
        reviewed_obligations: [],
        manifest: { bindings: [], contradictions: [] },
      }).sources,
      manifest: { bindings: [], contradictions: [] },
      generationLimitations: [],
    });

    expect(result.obligations[0]?.authority_references[0]?.evidence_id).toBe(
      capture.evidence_id,
    );
    expect(result.evidence_links).toContain(caseEvidence.evidence_id);
  });
});

describe("reconstruction obligation ledger case closure", () => {
  it("keeps unobserved original cases open", () => {
    const capture = processEvidence();
    const proof = proofEvidence("packaged-original-gap");
    const initial = build(request([capture, proof]));
    const obligation = initial.obligations[0];
    if (obligation === undefined)
      throw new Error("Expected process obligation");
    const result = build(
      request([capture, proof], {
        manifest: {
          bindings: [
            {
              obligation_id: obligation.obligation_id,
              owner: {
                module_path: "src/processOwner.ts",
                symbol: "runProcess",
                owner_sha256: "4".repeat(64),
              },
              parser_type: null,
              original_cases: obligation.observed_cases,
              fixtures: obligation.required_case_kinds.map((caseKind) => ({
                fixture_id: `packaged.${caseKind}`,
                case_kind: caseKind,
                authority: "packaged-process",
                evidence_ids: [proof.evidence_id],
              })),
              verifier: {
                verifier_id: "verifier.packaged",
                claim_id: "claim.process",
                command: "npm run verify:package -- process",
                authority: "packaged-process",
                status: "pass",
                result_evidence_id: proof.evidence_id,
                enumerated_obligation_ids: [obligation.obligation_id],
                nondeterminism: {
                  mode: "partial-order",
                  specification:
                    "Startup precedes teardown; worker completion is unordered.",
                },
              },
            },
          ],
          contradictions: [],
        },
      }),
    );

    expect(result.obligations[0]?.status).toBe("implemented");
    expect(result.obligations[0]?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-original-case",
          detail: expect.stringContaining("negative"),
        }),
        expect.objectContaining({
          code: "missing-original-case",
          detail: expect.stringContaining("cancellation"),
        }),
      ]),
    );
    expect(result.status).toBe("open");
  });

  it("closes only when every required case and verifier has comparable authority", () => {
    const ledgerRequest = readyProcessLedgerRequest();
    const result = build(ledgerRequest);

    expect(result.obligations[0]).toMatchObject({
      status: "verified",
      diagnostics: [],
    });
    expect(result.status).toBe("ready");
    expect(result.summary.required_open).toBe(0);

    const generated = deriveCandidates(
      ledgerRequest.evidence_bundle,
      ledgerRequest.reviewed_obligations,
    );
    const limited = evaluateReconstructionObligationLedger({
      candidates: generated.candidates,
      sources: resolveRequest(ledgerRequest).sources,
      manifest: ledgerRequest.manifest,
      generationLimitations: ["A supplementary source was unavailable."],
    });
    expect(limited.obligations[0]?.status).toBe("verified");
    expect(limited.status).toBe("unknown");
    expect(limited.coverage.status).toBe("partial");
  });
});

describe("reconstruction obligation manifest references", () => {
  it("does not claim readiness with unresolved references on an optional obligation", () => {
    const input = readyReviewedLedgerRequest();
    const reviewed = input.reviewed_obligations[0]!;
    const binding = input.manifest.bindings[0]!;
    const absent = `ev_${"c".repeat(64)}`;
    const original = binding.original_cases[0]!.evidence_id;
    const proof = binding.verifier!.result_evidence_id;
    const optional = { ...reviewed, required: false };
    const candidates = [
      {
        ...binding,
        original_cases: [
          ...binding.original_cases,
          {
            kind: "malformed" as const,
            evidence_id: absent,
            location: "/extra",
          },
        ],
      },
      {
        ...binding,
        fixtures: [
          ...binding.fixtures,
          {
            fixture_id: "fixture.extra",
            case_kind: "malformed" as const,
            authority: "unit" as const,
            evidence_ids: [absent],
          },
        ],
      },
      {
        ...binding,
        verifier: { ...binding.verifier!, result_evidence_id: absent },
      },
    ];
    for (const candidate of candidates) {
      const result = build({
        ...input,
        reviewed_obligations: [optional],
        manifest: { bindings: [candidate], contradictions: [] },
      });
      expect(result.status).toBe("unknown");
      expect(result.coverage.status).toBe("partial");
      expect(result.evidence_links).toContain(absent);
      expect(result.limitations).toContain(
        "The ledger retains 1 Evidence reference(s) absent from the input bundle; closure cannot be claimed.",
      );
    }
    const contradiction = build({
      ...input,
      reviewed_obligations: [optional],
      manifest: {
        bindings: [binding],
        contradictions: [
          {
            obligation_id: optional.obligation_id,
            evidence_ids: [original, absent],
          },
        ],
      },
    });
    expect(contradiction.status).not.toBe("ready");
    expect(contradiction.evidence_links).toContain(absent);
    const resolved = build({
      ...input,
      reviewed_obligations: [optional],
      manifest: {
        bindings: [
          {
            ...candidates[1]!,
            fixtures: [
              ...binding.fixtures,
              {
                fixture_id: "fixture.extra",
                case_kind: "malformed",
                authority: "unit",
                evidence_ids: [proof],
              },
            ],
          },
        ],
        contradictions: [],
      },
    });
    expect(resolved.status).toBe("ready");
    expect(resolved.obligations[0]?.status).toBe("verified");

    const required = readyProcessLedgerRequest();
    const mixed = build({
      evidence_bundle: createEvidenceBundle([
        ...input.evidence_bundle.records,
        ...required.evidence_bundle.records,
      ]),
      reviewed_obligations: [optional],
      manifest: {
        bindings: [candidates[1]!, ...required.manifest.bindings],
        contradictions: [],
      },
    });
    expect(mixed.summary.required_open).toBe(0);
    expect(mixed.status).toBe("unknown");
    expect(mixed.evidence_links).toContain(absent);
  });
});

describe("reconstruction obligation manifest reference controls", () => {
  it("withholds readiness when a manifest entry names absent Evidence", () => {
    const ledgerRequest = readyProcessLedgerRequest();
    // A valid entry for the same case kind must not hide an absent reference.
    const absent = `ev_${"a".repeat(64)}`;
    const binding = ledgerRequest.manifest.bindings[0];
    if (binding === undefined) throw new Error("Expected binding");
    const variants: {
      readonly code: string;
      readonly kind: "positive" | "malformed";
      readonly binding: typeof binding;
    }[] = [
      {
        code: "missing-original-case",
        kind: "positive",
        binding: {
          ...binding,
          original_cases: [
            ...binding.original_cases,
            { kind: "positive", evidence_id: absent, location: "/old" },
          ],
        },
      },
      {
        code: "missing-case",
        kind: "positive",
        binding: {
          ...binding,
          fixtures: [
            ...binding.fixtures,
            {
              fixture_id: "packaged.old",
              case_kind: "positive",
              authority: "packaged-process",
              evidence_ids: [absent],
            },
          ],
        },
      },
      {
        code: "missing-original-case",
        kind: "malformed",
        binding: {
          ...binding,
          original_cases: [
            ...binding.original_cases,
            { kind: "malformed", evidence_id: absent, location: "/old" },
          ],
        },
      },
      {
        code: "missing-case",
        kind: "malformed",
        binding: {
          ...binding,
          fixtures: [
            ...binding.fixtures,
            {
              fixture_id: "packaged.old",
              case_kind: "malformed",
              authority: "packaged-process",
              evidence_ids: [absent],
            },
          ],
        },
      },
    ];
    for (const { code, kind, binding: dangling } of variants) {
      const open = build({
        ...ledgerRequest,
        manifest: { ...ledgerRequest.manifest, bindings: [dangling] },
      });
      expect(open.status).not.toBe("ready");
      expect(open.obligations[0]?.status).toBe("implemented");
      expect(open.obligations[0]?.diagnostics).toContainEqual({
        code,
        detail: expect.stringMatching(new RegExp(`${kind}.*${absent}`)),
      });
      expect(open.evidence_links).toContain(absent);
    }

    const surplusEvidence = proofEvidence("surplus-case");
    const validSurplus = build(
      request([...ledgerRequest.evidence_bundle.records, surplusEvidence], {
        manifest: {
          ...ledgerRequest.manifest,
          bindings: [
            {
              ...binding,
              original_cases: [
                ...binding.original_cases,
                {
                  kind: "malformed",
                  evidence_id: surplusEvidence.evidence_id,
                  location: "/retained",
                },
              ],
              fixtures: [
                ...binding.fixtures,
                {
                  fixture_id: "packaged.malformed",
                  case_kind: "malformed",
                  authority: "packaged-process",
                  evidence_ids: [surplusEvidence.evidence_id],
                },
              ],
            },
          ],
        },
      }),
    );
    expect(validSurplus.status).toBe("ready");
    expect(validSurplus.obligations[0]?.observed_cases).toContainEqual(
      expect.objectContaining({ kind: "malformed", location: "/retained" }),
    );
    expect(validSurplus.obligations[0]?.binding?.fixtures).toContainEqual(
      expect.objectContaining({
        case_kind: "malformed",
        fixture_id: "packaged.malformed",
      }),
    );
    expect(validSurplus.evidence_links).toContain(surplusEvidence.evidence_id);
  });
});
