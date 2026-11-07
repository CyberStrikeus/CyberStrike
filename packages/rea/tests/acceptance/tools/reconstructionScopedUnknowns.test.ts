import { expect, it } from "vitest";

import { FUNCTION_COMPARISON_EXAMPLE } from "../../../src/contracts/functionComparisonExample.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { reconstructionVerificationResultSchema } from "../../../src/domain/reconstructionVerificationSchemas.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";

const unchangedRight = () => {
  const left = FUNCTION_COMPARISON_EXAMPLE.left;
  return createEvidence(
    { path: "/fixture/rebuilt", sha256: "2".repeat(64), format: "mach-o" },
    left.provider,
    {
      operation: left.operation,
      parameters: left.parameters,
      result: left.normalized_result,
      confidence: left.confidence,
      authority: left.authority,
      relationshipCoverage: { status: "complete" },
    },
  );
};

const verify = async (
  call: Awaited<ReturnType<typeof connectLocalToolsMcp>>["call"],
  comparisonId: string,
  dimensions: readonly ("overall" | "pseudocode" | "assembly")[],
) => {
  const response = await call("verify_reconstruction", {
    specification: {
      name: "Scoped function uncertainty",
      claims: dimensions.map((dimension) => ({
        kind: "structural-function",
        claim_id: dimension,
        title: `Check ${dimension}`,
        comparison_evidence_id: comparisonId,
        dimension,
      })),
    },
  });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  return reconstructionVerificationResultSchema.parse(
    parseEvidence(response.structuredContent).normalized_result,
  );
};

it.each(["pseudocode", "overall"] as const)(
  "keeps an overall claim unknown for an active %s question through stdio MCP",
  async (dimension) => {
    const { call } = await connectLocalToolsMcp();
    const left = FUNCTION_COMPARISON_EXAMPLE.left;
    const right = unchangedRight();
    const compared = await call("compare_functions", { left, right });
    expect(compared.isError, JSON.stringify(compared)).not.toBe(true);
    const comparison = parseEvidence(compared.structuredContent);
    expect(comparison.normalized_result).toMatchObject({ status: "unchanged" });
    const selectors = ["overall", "pseudocode", "assembly"] as const;
    expect(await verify(call, comparison.evidence_id, selectors)).toMatchObject(
      {
        status: "pass",
        summary: { total: 3, passed: 3, unknown: 0 },
      },
    );

    const probe = {
      operation: "analyze_function",
      rationale: "Check the unresolved pseudocode condition.",
    };
    const recorded = await call("record_unknown", {
      question: "Does the compared implementation preserve the condition?",
      severity: "high",
      domain: "function-comparison",
      supporting_evidence_ids: [comparison.evidence_id],
      contradicting_evidence_ids: [],
      required_authority: null,
      required_confidence: "derived",
      required_environment: null,
      recommended_probes: [probe],
      relationships: [],
      comparison_conclusion_scope: {
        comparison_evidence_id: comparison.evidence_id,
        dimensions: [dimension],
      },
    });
    expect(recorded.isError, JSON.stringify(recorded)).not.toBe(true);
    const unknown = toolContract("record_unknown").outputSchema.parse(
      recorded.structuredContent,
    ).result;
    const aggregate = await verify(call, comparison.evidence_id, ["overall"]);
    expect(aggregate).toMatchObject({
      status: "unknown",
      claims: {
        items: [
          { observed_status: "unchanged", unknown_ids: [unknown.unknown_id] },
        ],
      },
      recommended_probes: [
        { ...probe, claim_ids: ["overall"], unknown_ids: [unknown.unknown_id] },
      ],
    });
    const selected = await verify(call, comparison.evidence_id, selectors);
    expect(selected.claims.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claim_id: "assembly",
          status: "pass",
          unknown_ids: [],
        }),
        expect.objectContaining({
          claim_id: "pseudocode",
          status: dimension === "pseudocode" ? "unknown" : "pass",
          unknown_ids: dimension === "pseudocode" ? [unknown.unknown_id] : [],
        }),
      ]),
    );

    const resolved = await call("update_unknown", {
      unknown_id: unknown.unknown_id,
      expected_revision: unknown.revision,
      status: "resolved",
      severity: unknown.severity,
      supporting_evidence_ids: unknown.supporting_evidence_ids,
      contradicting_evidence_ids: unknown.contradicting_evidence_ids,
      required_authority: unknown.required_authority,
      required_confidence: unknown.required_confidence,
      required_environment: unknown.required_environment,
      recommended_probes: unknown.recommended_probes,
      relationships: unknown.relationships,
      resolution: {
        disposition: "withdrawn",
        rationale: "Question explicitly withdrawn for this control.",
        evidence_ids: [],
      },
    });
    expect(resolved.isError, JSON.stringify(resolved)).not.toBe(true);
    expect(
      await verify(call, comparison.evidence_id, ["overall"]),
    ).toMatchObject({
      status: "pass",
      claims: { items: [{ unknown_ids: [] }] },
    });
    const exported = await call("get_evidence_bundle", { detail: "complete" });
    const bundle = toolContract("get_evidence_bundle").outputSchema.parse(
      exported.structuredContent,
    ).result;
    for (const source of [left, right, comparison])
      expect(
        bundle.records.find(
          ({ evidence_id }) => evidence_id === source.evidence_id,
        ),
      ).toEqual(source);
  },
);
