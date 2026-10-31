import { describe, expect, it } from "vitest";
import { JAVASCRIPT_FEATURE_TRACE_EXAMPLE } from "../contracts/javascript/javascriptApplicationWorkflowExamples.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { resolveEvidenceInput } from "./EvidenceInputResolver.js";

const evidence = JAVASCRIPT_FEATURE_TRACE_EXAMPLE.application;
const reference = {
  kind: "retained-evidence" as const,
  evidence_id: evidence.evidence_id,
};

describe("exact Evidence input resolution", () => {
  it("reports a missing reference and an available recovery", () => {
    for (const lookup of [undefined, () => undefined]) {
      const result = resolveEvidenceInput(reference, lookup);
      if (result.ok) throw new Error("unknown reference was resolved");
      const projected = projectAnalysisError(result.error);
      expect(projected).toMatchObject({
        details: {
          evidence_id: reference.evidence_id,
          reason: "missing",
          actual: null,
        },
      });
      expect(projected.message).toContain(
        "not available from the selected source",
      );
      expect(projected.remediation.action).toContain(
        "complete inline Evidence",
      );
      expect(projected.details).not.toHaveProperty("reference_scope");
    }
  });

  it("rejects a lookup returning another record rather than guessing identity", () => {
    const otherId = `ev_${"f".repeat(64)}`;
    const result = resolveEvidenceInput(
      { ...reference, evidence_id: otherId },
      () => evidence,
    );
    if (result.ok) throw new Error("mismatched reference was resolved");
    expect(projectAnalysisError(result.error)).toMatchObject({
      details: {
        reason: "identity_mismatch",
        expected: otherId,
        actual: evidence.evidence_id,
      },
    });
  });
});
