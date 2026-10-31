import { expect, it } from "vitest";

import {
  createResidualUnknown,
  recordUnknownInputSchema,
  residualUnknownSchema,
  updateResidualUnknown,
} from "./residualUnknown.js";

it("accepts complete unknown questions, environment details and probe guidance", () => {
  const longText = "x".repeat(4_097);
  const parsed = recordUnknownInputSchema.parse({
    question: longText,
    severity: "medium",
    domain: longText,
    required_authority: null,
    required_confidence: "inferred",
    required_environment: {
      id: longText,
      platform: longText,
      architecture: longText,
      isolation: "process",
    },
    recommended_probes: [{ operation: longText, rationale: longText }],
    relationships: [],
  });

  expect(parsed.question).toHaveLength(4_097);
  expect(parsed.recommended_probes[0]?.operation).toHaveLength(4_097);
});

const input = recordUnknownInputSchema.parse({
  question: "Fixture 0",
  domain: "canonical-constructor",
  severity: "medium",
  required_authority: null,
  required_confidence: "derived",
  required_environment: null,
  recommended_probes: [],
  relationships: [],
});
const mutationId = `ev_${"a".repeat(64)}`;
const scopeDigest = "b".repeat(64);

it("preserves persisted canonical identity and digests while authenticating imported changes", () => {
  const created = createResidualUnknown(input, mutationId, scopeDigest);
  expect(created.unknown_id).toBe(
    "unk_139dc8e6c9feb0ba370584d190003eaa5064ec693cf1dfd5ec4be7496d59559c",
  );
  expect(created.revision_digest).toBe(
    "7f41f8ddcfdb364f7b05bda5d9ff75ea3a83fe8f3a29f07dfadfe00141b72c25",
  );
  const updated = updateResidualUnknown(
    created,
    {
      ...input,
      unknown_id: created.unknown_id,
      expected_revision: 1,
      status: "investigating",
      severity: "high",
      required_confidence: "observed",
      recommended_probes: [
        { operation: "inspect_native_api", rationale: "Fixture probe" },
      ],
      resolution: null,
    },
    mutationId,
  );
  expect(updated.revision_digest).toBe(
    "8f2d8c1985f143724b087524ed997d13602d343db6f444b4c37bb8bc9e91dcbb",
  );
  expect(residualUnknownSchema.parse(updated)).toEqual(updated);
  expect(
    residualUnknownSchema.safeParse({ ...updated, severity: "low" }).success,
  ).toBe(false);
});

it("normalizes producer text before identity and revision authentication", () => {
  const raw = {
    ...input,
    question: "\uFEFFFixture\t0\n",
    domain: " canonical-constructor ",
    recommended_probes: [
      { operation: "inspect_native_api", rationale: " Replay " },
    ],
  };
  const created = createResidualUnknown(raw, mutationId, scopeDigest);
  const canonical = createResidualUnknown(
    recordUnknownInputSchema.parse(raw),
    mutationId,
    scopeDigest,
  );
  expect(created).toEqual(canonical);
  expect(created.unknown_id).toBe(
    createResidualUnknown(input, mutationId, scopeDigest).unknown_id,
  );
  expect(residualUnknownSchema.parse(created)).toEqual(created);
});

it("authenticates typed comparison scope and preserves it across revisions", () => {
  const comparisonId = `ev_${"c".repeat(64)}`;
  const scopedInput = recordUnknownInputSchema.parse({
    ...input,
    domain: "function-comparison",
    supporting_evidence_ids: [comparisonId],
    comparison_conclusion_scope: {
      comparison_evidence_id: comparisonId,
      dimensions: ["calls"],
    },
  });
  const created = createResidualUnknown(scopedInput, mutationId, scopeDigest);
  const updated = updateResidualUnknown(
    created,
    {
      ...input,
      unknown_id: created.unknown_id,
      expected_revision: 1,
      status: "investigating",
      severity: "high",
      supporting_evidence_ids: [comparisonId],
      required_confidence: "observed",
      recommended_probes: [],
      resolution: null,
    },
    mutationId,
  );
  expect(updated.comparison_conclusion_scope).toEqual({
    comparison_evidence_id: comparisonId,
    dimensions: ["calls"],
  });
  expect(residualUnknownSchema.parse(updated)).toEqual(updated);
  expect(
    residualUnknownSchema.safeParse({
      ...created,
      comparison_conclusion_scope: {
        comparison_evidence_id: `ev_${"d".repeat(64)}`,
        dimensions: ["calls"],
      },
    }).success,
  ).toBe(false);
});

it("keeps generated revisions subject to state and relationship validation", () => {
  const created = createResidualUnknown(input, mutationId, scopeDigest);
  const command = {
    ...input,
    unknown_id: created.unknown_id,
    expected_revision: 1,
    status: "resolved" as const,
    resolution: null,
  };
  expect(() => updateResidualUnknown(created, command, mutationId)).toThrow(
    /Only resolved unknowns carry a resolution/u,
  );
  expect(() =>
    updateResidualUnknown(
      created,
      { ...command, status: "contradicted" },
      mutationId,
    ),
  ).toThrow(/Contradicted status requires contradicting evidence/u);
  expect(() =>
    updateResidualUnknown(
      created,
      {
        ...command,
        status: "open",
        relationships: [{ type: "related-to", unknown_id: created.unknown_id }],
      },
      mutationId,
    ),
  ).toThrow(/An unknown cannot relate to itself/u);
});
