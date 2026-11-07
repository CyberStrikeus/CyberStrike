import { describe, expect, it } from "vitest";

import { createEvidence } from "./evidence.js";
import { ANALYSIS_SNAPSHOT_TARGET } from "./analysisSnapshot.fixture.js";
import {
  createEvidenceBundle,
  createImmutableEvidenceBundle,
  NonCanonicalEvidenceBundleError,
  evidenceBundleForTarget,
  parseEvidenceBundle,
  safeParseEvidenceBundle,
} from "./evidenceBundle.js";
import {
  createResidualUnknown,
  recordUnknownInputSchema,
  updateResidualUnknown,
} from "./residualUnknown.js";

const provider = { id: "fixture", name: "Fixture", version: "1" };
const targetDigest = "a".repeat(64);
const foreignDigest = "b".repeat(64);

describe("artifact manifest projection", () => {
  it("round-trips GameCube DOL Evidence through retained bundles and target selection", () => {
    const record = createEvidence(
      {
        path: "/tmp/game.dol",
        sha256: targetDigest,
        format: "gamecube-dol",
        architecture: "powerpc",
      },
      provider,
      {
        operation: "inspect_artifact",
        parameters: {},
        result: { observed: true },
      },
    );
    const bundle = createImmutableEvidenceBundle([record]);
    expect(bundle.artifacts).toEqual([
      {
        digest: { sha256: targetDigest },
        format: "gamecube-dol",
        architecture: "powerpc",
      },
    ]);
    const restored = parseEvidenceBundle(JSON.parse(JSON.stringify(bundle)));
    expect(restored.records[0]?.evidence_id).toBe(record.evidence_id);
    expect(evidenceBundleForTarget(restored, targetDigest)).toEqual(bundle);
  });
});

describe("evidence bundle failure classification", () => {
  it("tags valid-shaped bundles that fail canonical ordering", () => {
    const records = ["first", "second"].map((label) =>
      createEvidence(undefined, provider, {
        operation: "observe",
        parameters: { label },
        result: { label },
      }),
    );
    const canonical = createEvidenceBundle(records);
    const parsed = safeParseEvidenceBundle({
      ...canonical,
      records: [...canonical.records].reverse(),
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.kind).toBe("invalid-bundle");
    expect(parsed.error.cause).toBeInstanceOf(NonCanonicalEvidenceBundleError);
  });

  it("treats only authenticated standalone Evidence as the wrong input kind", () => {
    const record = createEvidence(undefined, provider, {
      operation: "observe",
      parameters: {},
      result: { observed: true },
    });
    const single = safeParseEvidenceBundle(record);
    expect(single.ok).toBe(false);
    if (single.ok) return;
    expect(single.error.kind).toBe("single-record");

    const tampered = safeParseEvidenceBundle({
      ...record,
      normalized_result: { observed: false },
    });
    expect(tampered.ok).toBe(false);
    if (tampered.ok) return;
    expect(tampered.error.kind).toBe("invalid-bundle");
  });
});

const makeUnknown = (
  question: string,
  scopeDigest: string,
  dependency?: string,
) => {
  const input = recordUnknownInputSchema.parse({
    question,
    severity: "medium",
    domain: "bundle-projection",
    required_authority: null,
    required_confidence: "derived",
    required_environment: null,
    recommended_probes: [],
    relationships:
      dependency === undefined
        ? []
        : [{ type: "depends-on", unknown_id: dependency }],
  });
  const mutation = createEvidence(undefined, provider, {
    predicateType: "rea.residual-unknown-mutation",
    operation: "record_unknown",
    parameters: { domain: input.domain, severity: input.severity },
    result: {
      action: "record",
      question: input.question,
      required_authority: input.required_authority,
      required_confidence: input.required_confidence,
    },
  });
  return {
    input,
    evidence: mutation,
    unknown: createResidualUnknown(input, mutation.evidence_id, scopeDigest),
  };
};

describe("evidenceBundleForTarget", () => {
  it("retains mutation evidence from other targets for complete revision histories", () => {
    const first = makeUnknown(
      "Target question updated elsewhere",
      targetDigest,
    );
    const update = createEvidence(
      { ...ANALYSIS_SNAPSHOT_TARGET, sha256: foreignDigest },
      provider,
      {
        predicateType: "rea.residual-unknown-mutation",
        operation: "update_unknown",
        parameters: {
          unknown_id: first.unknown.unknown_id,
          expected_revision: 1,
        },
        result: { status: "resolved" },
      },
    );
    const resolved = updateResidualUnknown(
      first.unknown,
      {
        ...first.input,
        unknown_id: first.unknown.unknown_id,
        expected_revision: 1,
        status: "resolved",
        resolution: {
          disposition: "withdrawn",
          rationale: "Withdrawn by the analyst",
          evidence_ids: [],
        },
      },
      update.evidence_id,
    );
    const unrelated = makeUnknown("Unrelated foreign question", foreignDigest);
    const bundle = parseEvidenceBundle(
      createEvidenceBundle(
        [first.evidence, update, unrelated.evidence],
        [first.unknown, resolved, unrelated.unknown],
      ),
    );
    const projected = evidenceBundleForTarget(bundle, targetDigest);
    expect(parseEvidenceBundle(projected)).toEqual(
      createEvidenceBundle([first.evidence, update], [first.unknown, resolved]),
    );
    expect(evidenceBundleForTarget(projected, targetDigest)).toEqual(projected);
  });

  it.each(["evidence", "relationship"])(
    "removes whole histories and their dependents when a revision requires foreign %s",
    (excluded) => {
      const first = makeUnknown(
        "Target history with an excluded revision",
        targetDigest,
      );
      const foreign = makeUnknown("Excluded foreign context", foreignDigest);
      const evidence = createEvidence(
        { ...ANALYSIS_SNAPSHOT_TARGET, sha256: foreignDigest },
        provider,
        { operation: "foreign_observation", parameters: {}, result: true },
      );
      const updated = updateResidualUnknown(
        first.unknown,
        {
          ...first.input,
          unknown_id: first.unknown.unknown_id,
          expected_revision: 1,
          status: "investigating",
          supporting_evidence_ids:
            excluded === "evidence" ? [evidence.evidence_id] : [],
          relationships:
            excluded === "relationship"
              ? [{ type: "related-to", unknown_id: foreign.unknown.unknown_id }]
              : [],
          resolution: null,
        },
        first.evidence.evidence_id,
      );
      const resolved = updateResidualUnknown(
        updated,
        {
          ...first.input,
          unknown_id: first.unknown.unknown_id,
          expected_revision: 2,
          status: "resolved",
          resolution: {
            disposition: "withdrawn",
            rationale: "Foreign context removed from the latest revision",
            evidence_ids: [],
          },
        },
        first.evidence.evidence_id,
      );
      const child = makeUnknown(
        "Dependent target history",
        targetDigest,
        first.unknown.unknown_id,
      );
      const unrelated = makeUnknown("Independent target history", targetDigest);
      const bundle = parseEvidenceBundle(
        createEvidenceBundle(
          [
            first.evidence,
            foreign.evidence,
            evidence,
            child.evidence,
            unrelated.evidence,
          ],
          [
            first.unknown,
            updated,
            resolved,
            foreign.unknown,
            child.unknown,
            unrelated.unknown,
          ],
        ),
      );
      expect(
        parseEvidenceBundle(evidenceBundleForTarget(bundle, targetDigest)),
      ).toEqual(
        createEvidenceBundle([unrelated.evidence], [unrelated.unknown]),
      );
    },
  );
});

describe("evidenceBundleForTarget relationship pruning", () => {
  it("removes dependent unknowns when their foreign-scope root is excluded", () => {
    const foreignRoot = makeUnknown("Foreign root", foreignDigest);
    const child = makeUnknown(
      "Target child",
      targetDigest,
      foreignRoot.unknown.unknown_id,
    );
    const grandchild = makeUnknown(
      "Target grandchild",
      targetDigest,
      child.unknown.unknown_id,
    );
    const retained = makeUnknown("Independent target", targetDigest);
    const bundle = createEvidenceBundle(
      [
        foreignRoot.evidence,
        child.evidence,
        grandchild.evidence,
        retained.evidence,
      ],
      [
        foreignRoot.unknown,
        child.unknown,
        grandchild.unknown,
        retained.unknown,
      ],
    );

    expect(evidenceBundleForTarget(bundle, targetDigest)).toEqual(
      createEvidenceBundle([retained.evidence], [retained.unknown]),
    );
  });

  it("projects a valid graph with more than 125,000 dependents", () => {
    const foreignRoot = makeUnknown("Foreign high-fan-out root", foreignDigest);
    const middle = makeUnknown(
      "Target middle depending on foreign root",
      targetDigest,
      foreignRoot.unknown.unknown_id,
    );
    const unknowns = [foreignRoot.unknown, middle.unknown];
    for (let index = 0; index < 125_000; index += 1) {
      const input = recordUnknownInputSchema.parse({
        question: `Target child ${index}`,
        severity: "medium",
        domain: "bundle-projection",
        required_authority: null,
        required_confidence: "derived",
        required_environment: null,
        recommended_probes: [],
        relationships: [
          { type: "depends-on", unknown_id: middle.unknown.unknown_id },
        ],
      });
      unknowns.push(
        createResidualUnknown(input, middle.evidence.evidence_id, targetDigest),
      );
    }
    const bundle = parseEvidenceBundle(
      createEvidenceBundle([foreignRoot.evidence, middle.evidence], unknowns),
    );

    expect(evidenceBundleForTarget(bundle, targetDigest)).toEqual(
      createEvidenceBundle([], []),
    );
  });
});

describe("immutable serialization bundles", () => {
  it("authenticates sealed records while revalidating detached and malformed input", () => {
    const evidence = createEvidence(undefined, provider, {
      operation: "health",
      parameters: {},
      result: { nested: [true] },
    });
    const bundle = createImmutableEvidenceBundle([evidence]);
    expect(parseEvidenceBundle(bundle)).toBe(bundle);
    expect(Object.isFrozen(bundle.records[0]?.normalized_result)).toBe(true);
    const detached: unknown = JSON.parse(JSON.stringify(bundle));
    expect(parseEvidenceBundle(detached)).toEqual(bundle);
    expect(parseEvidenceBundle(detached)).not.toBe(bundle);
    const tampered = {
      ...bundle,
      records: [{ ...evidence, normalized_result: false }],
    };
    expect(() => parseEvidenceBundle(Object.freeze(tampered))).toThrow();
    expect(() => createImmutableEvidenceBundle(tampered.records)).toThrow();
    expect(() => createImmutableEvidenceBundle([evidence, evidence])).toThrow();
  });
});
