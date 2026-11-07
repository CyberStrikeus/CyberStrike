import { expect, it } from "vitest";

import {
  FUNCTION_COMPARISON_EVIDENCE,
  INVESTIGATION_EXAMPLES,
  PROCESS_COMPARISON_EVIDENCE,
} from "../contracts/investigationExamples.js";
import {
  createResidualUnknown,
  recordUnknownInputSchema,
  residualUnknownSchema,
  updateResidualUnknown,
  updateUnknownInputSchema,
} from "./residualUnknown.js";
import {
  correlateStaticAndRuntime,
  staticRuntimeCorrelationInputSchema,
  staticRuntimeCorrelationResultSchema,
} from "./staticRuntimeCorrelation.js";

const evidenceId = (index: number): string =>
  `ev_${index.toString(16).padStart(64, "0")}`;

const unknownId = (index: number): string =>
  `unk_${index.toString(16).padStart(64, "0")}`;

it("accepts complete residual unknown evidence, probe, and relationship lists", () => {
  const supportingEvidence = Array.from({ length: 101 }, (_, i) =>
    evidenceId(i + 1),
  );
  const contradictingEvidence = Array.from({ length: 101 }, (_, i) =>
    evidenceId(i + 102),
  );
  const relationships = Array.from({ length: 101 }, (_, i) => ({
    type: "related-to" as const,
    unknown_id: unknownId(i + 1),
  }));
  const recommendedProbes = Array.from({ length: 21 }, (_, i) => ({
    operation: `inspect_${i}`,
    rationale: `Inspect evidence path ${i}.`,
  }));
  const recordInput = recordUnknownInputSchema.parse({
    question: "Does this behavior depend on an external service?",
    severity: "medium",
    domain: "protocol",
    supporting_evidence_ids: supportingEvidence,
    contradicting_evidence_ids: contradictingEvidence,
    required_authority: "controlled-replay",
    required_confidence: "observed",
    required_environment: null,
    recommended_probes: recommendedProbes,
    relationships,
  });
  const created = createResidualUnknown(recordInput, evidenceId(500), null);

  expect(created.supporting_evidence_ids).toHaveLength(101);
  expect(created.contradicting_evidence_ids).toHaveLength(101);
  expect(created.recommended_probes).toHaveLength(21);
  expect(created.relationships).toHaveLength(101);

  const updateInput = updateUnknownInputSchema.parse({
    unknown_id: created.unknown_id,
    expected_revision: created.revision,
    status: "investigating",
    severity: created.severity,
    supporting_evidence_ids: supportingEvidence,
    contradicting_evidence_ids: contradictingEvidence,
    required_authority: created.required_authority,
    required_confidence: created.required_confidence,
    required_environment: created.required_environment,
    recommended_probes: recommendedProbes,
    relationships,
    resolution: null,
  });
  const updated = updateResidualUnknown(created, updateInput, evidenceId(501));

  expect(residualUnknownSchema.parse(updated)).toMatchObject({
    revision: 2,
    mutation_evidence_ids: [evidenceId(500), evidenceId(501)],
    supporting_evidence_ids: supportingEvidence,
    contradicting_evidence_ids: contradictingEvidence,
    recommended_probes: recommendedProbes,
    relationships,
  });
  expect(() =>
    recordUnknownInputSchema.parse({
      ...recordInput,
      supporting_evidence_ids: ["not-an-evidence-id"],
    }),
  ).toThrow();
});

it("correlates every supplied mapping and accepts complete comparison lists", () => {
  const [mapping] =
    INVESTIGATION_EXAMPLES.correlate_static_and_runtime.mappings;
  if (mapping === undefined) throw new Error("missing correlation example");
  const mappings = Array.from({ length: 501 }, (_, i) => ({
    ...mapping,
    hypothesis: {
      ...mapping.hypothesis,
      statement: `Hypothesis ${i} ${"x".repeat(600)}`,
    },
  }));
  const input = {
    static_comparisons: Array.from(
      { length: 101 },
      () => FUNCTION_COMPARISON_EVIDENCE,
    ),
    runtime_comparisons: Array.from(
      { length: 101 },
      () => PROCESS_COMPARISON_EVIDENCE,
    ),
    mappings,
  };

  expect(
    staticRuntimeCorrelationInputSchema.parse(input).mappings,
  ).toHaveLength(501);
  expect(
    staticRuntimeCorrelationInputSchema.parse(input).mappings[0]?.hypothesis
      .statement.length,
  ).toBeGreaterThan(500);
  const fullInput = {
    ...input,
    static_comparisons: [FUNCTION_COMPARISON_EVIDENCE],
    runtime_comparisons: [PROCESS_COMPARISON_EVIDENCE],
  };
  const result = correlateStaticAndRuntime(fullInput);
  expect(result.correlations.items).toHaveLength(501);

  expect(
    staticRuntimeCorrelationResultSchema.parse({
      ...result,
      evidence_links: Array.from({ length: 20_101 }, (_, i) => evidenceId(i)),
    }).evidence_links,
  ).toHaveLength(20_101);
});
