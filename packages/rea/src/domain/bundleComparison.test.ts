import { describe, expect, it } from "vitest";

import {
  bundleComparisonInputSchema,
  bundleComparisonResultSchema,
  compareBundles,
} from "./bundleComparison.js";
import { AnalysisInputError } from "./analysisErrorCore.js";
import { createEvidence } from "./evidence.js";
import { createEvidenceBundle } from "./evidenceBundle.js";
import {
  createResidualUnknown,
  recordUnknownInputSchema,
  updateResidualUnknown,
  updateUnknownInputSchema,
} from "./residualUnknown.js";

const PROVIDER = { id: "fixture", name: "Fixture", version: "1" } as const;
const evidence = (label: string) =>
  createEvidence(undefined, PROVIDER, {
    operation: "observe",
    parameters: { label },
    result: { label },
    confidence: "derived",
    authority: "analyst-inference",
  });

describe("bundle comparison explicit cross-pairs", () => {
  it("accounts for every unpaired occurrence after cross-pairing shared records", () => {
    const first = evidence("first-cross-pair");
    const second = evidence("second-cross-pair");
    const unchanged = evidence("unchanged-cross-pair");
    const bundle = createEvidenceBundle([first, second, unchanged]);
    const result = compareBundles(bundle, bundle, [
      {
        left_evidence_id: first.evidence_id,
        right_evidence_id: second.evidence_id,
      },
    ]);
    expect(result.summary).toMatchObject({
      records_unchanged: 1,
      records_changed: 1,
      records_added: 0,
      records_removed: 0,
      unresolved: 2,
    });
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: "unknown",
          conclusion_kind: "unresolved_branch",
          left_evidence_ids: [second.evidence_id],
        }),
        expect.objectContaining({
          classification: "unknown",
          conclusion_kind: "unresolved_branch",
          right_evidence_ids: [first.evidence_id],
        }),
      ]),
    );
    expect(result.status).toBe("unknown");
    expect(result.changes).toHaveLength(3);
    const changedOrUnknown = result.changes.filter(
      ({ entity }) => entity === "evidence",
    );
    expect(
      result.summary.records_unchanged +
        changedOrUnknown.flatMap(({ left_evidence_ids }) => left_evidence_ids)
          .length,
    ).toBe(bundle.records.length);
    expect(
      result.summary.records_unchanged +
        changedOrUnknown.flatMap(({ right_evidence_ids }) => right_evidence_ids)
          .length,
    ).toBe(bundle.records.length);
  });
});

describe("bundle comparison", () => {
  it("does not report display-only bundle differences as unexplained changes", () => {
    const target = {
      path: "/left/artifact.elf",
      sha256: "a".repeat(64),
      format: "elf" as const,
      architecture: "x86_64" as const,
    };
    const record = createEvidence(target, PROVIDER, {
      operation: "observe",
      parameters: {},
      result: { observed: true },
      confidence: "observed",
      authority: "shipped-artifact",
    });
    const left = createEvidenceBundle([record]);
    const rightRecord = {
      ...record,
      subject: {
        ...record.subject!,
        name: "renamed.elf",
        local_path: "/right/renamed.elf",
      },
    };
    const right = { ...left, records: [rightRecord] };
    const result = compareBundles(left, right);
    expect(result).toMatchObject({
      status: "unchanged",
      summary: { records_unchanged: 1, unresolved: 0 },
      changes: [],
    });
    expect(result.left_bundle_sha256).not.toBe(result.right_bundle_sha256);
  });

  it("accepts long caller-selected bundle paths", () => {
    const path = `/${"deep/".repeat(1_000)}bundle.json`;
    expect(
      bundleComparisonInputSchema.parse({
        left_bundle_path: path,
        right_bundle_path: path,
      }),
    ).toMatchObject({ left_bundle_path: path, right_bundle_path: path });
  });

  it("returns unchanged only for equal canonical bundles", () => {
    const first = evidence("first");
    const second = evidence("second");
    const left = createEvidenceBundle([first, second]);
    const right = createEvidenceBundle([second, first]);
    const result = compareBundles(left, right);
    expect(bundleComparisonResultSchema.parse(result)).toMatchObject({
      status: "unchanged",
      summary: {
        records_unchanged: 2,
        records_added: 0,
        records_removed: 0,
        unresolved: 0,
      },
      changes: [],
    });
    expect(result.left_bundle_sha256).toBe(result.right_bundle_sha256);
  });

  it("classifies explicit pairs and leaves one-sided membership unresolved", () => {
    const oldRecord = evidence("old");
    const newRecord = evidence("new");
    const removed = evidence("removed");
    const added = evidence("added");
    const left = createEvidenceBundle([oldRecord, removed]);
    const right = createEvidenceBundle([newRecord, added]);
    const pairs = [
      {
        left_evidence_id: oldRecord.evidence_id,
        right_evidence_id: newRecord.evidence_id,
      },
    ];
    const first = compareBundles(left, right, pairs);
    const repeated = compareBundles(left, right, pairs);
    expect(first).toEqual(repeated);
    expect(first).toMatchObject({
      status: "unknown",
      summary: {
        records_added: 0,
        records_removed: 0,
        records_changed: 1,
        unresolved: 2,
      },
      changes: expect.arrayContaining([
        expect.objectContaining({ classification: "changed" }),
        expect.objectContaining({
          classification: "unknown",
          conclusion_kind: "unresolved_branch",
        }),
      ]),
    });
    expect(first.changes).toHaveLength(3);
    expect(first.limitations).toContain(
      "EvidenceBundle has no inventory completeness marker; one-sided membership remains unknown.",
    );
  });

  it("returns more than 500 changes without a display-page ceiling", () => {
    const records = Array.from({ length: 501 }, (_, index) =>
      evidence(`record-${String(index)}`),
    );
    const result = compareBundles(
      createEvidenceBundle([]),
      createEvidenceBundle(records),
    );
    expect(result.changes).toHaveLength(501);
    expect(bundleComparisonResultSchema.parse(result).changes).toHaveLength(
      501,
    );
  });

  it("rejects missing and non-bijective explicit pairs", () => {
    const leftRecord = evidence("left");
    const rightRecord = evidence("right");
    const left = createEvidenceBundle([leftRecord]);
    const right = createEvidenceBundle([rightRecord]);
    expect(() =>
      compareBundles(left, right, [
        {
          left_evidence_id: evidence("missing").evidence_id,
          right_evidence_id: rightRecord.evidence_id,
        },
      ]),
    ).toThrow(AnalysisInputError);
    expect(() =>
      compareBundles(left, right, [
        {
          left_evidence_id: leftRecord.evidence_id,
          right_evidence_id: rightRecord.evidence_id,
        },
        {
          left_evidence_id: leftRecord.evidence_id,
          right_evidence_id: rightRecord.evidence_id,
        },
      ]),
    ).toThrow(AnalysisInputError);
    expect(() =>
      compareBundles({ ...left, records: [leftRecord, leftRecord] }, right),
    ).toThrow(/duplicate record IDs/u);
  });
});

describe("bundle comparison history", () => {
  it("distinguishes advanced and missing unknown histories from equality", () => {
    const mutationOne = evidence("mutation-one");
    const initial = createResidualUnknown(
      recordUnknownInputSchema.parse({
        question: "Which branch remains unexplained?",
        severity: "high",
        domain: "comparison",
        supporting_evidence_ids: [],
        contradicting_evidence_ids: [],
        required_authority: "shipped-artifact",
        required_confidence: "observed",
        required_environment: null,
        recommended_probes: [],
        relationships: [],
      }),
      mutationOne.evidence_id,
      null,
    );
    const mutationTwo = evidence("mutation-two");
    const advanced = updateResidualUnknown(
      initial,
      updateUnknownInputSchema.parse({
        unknown_id: initial.unknown_id,
        expected_revision: 1,
        status: "investigating",
        severity: initial.severity,
        supporting_evidence_ids: [],
        contradicting_evidence_ids: [],
        required_authority: initial.required_authority,
        required_confidence: initial.required_confidence,
        required_environment: null,
        recommended_probes: [],
        relationships: [],
        resolution: null,
      }),
      mutationTwo.evidence_id,
    );
    const initialBundle = createEvidenceBundle([mutationOne], [initial]);
    const advancedBundle = createEvidenceBundle(
      [mutationOne, mutationTwo],
      [initial, advanced],
    );
    expect(compareBundles(initialBundle, advancedBundle)).toMatchObject({
      status: "unknown",
      summary: { unknowns_advanced: 1, unresolved: 1 },
      changes: [
        expect.objectContaining({
          entity: "evidence",
          classification: "unknown",
        }),
        expect.objectContaining({
          entity: "residual_unknown",
          classification: "history_advanced",
        }),
      ],
    });
    const absent = createEvidenceBundle([]);
    const missing = compareBundles(initialBundle, absent);
    expect(missing).toMatchObject({
      status: "unknown",
      summary: {
        unknowns_added: 0,
        unknowns_removed: 0,
        unresolved: 2,
      },
    });
    expect(missing.changes).toContainEqual(
      expect.objectContaining({
        classification: "unknown",
        conclusion_kind: "unresolved_branch",
        limitations: [
          "EvidenceBundle has no inventory completeness marker; one-sided history membership remains unknown.",
        ],
      }),
    );
  });
});
