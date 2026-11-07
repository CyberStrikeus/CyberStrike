import { expect, it } from "vitest";

import { FUNCTION_COMPARISON_EXAMPLE } from "../../../src/contracts/functionComparisonExample.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { functionDossierSchema } from "../../../src/domain/native/functionDossier.js";
import { jsonValueSchema } from "../../../src/domain/jsonValue.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";

const sourceWithCoverage = (
  template: typeof FUNCTION_COMPARISON_EXAMPLE.left,
  observation: string,
  result: typeof template.normalized_result,
  relationshipCoverage:
    | { readonly status: "complete" }
    | { readonly status: "unknown"; readonly reason: string },
) => {
  if (template.subject === null)
    throw new Error("Function comparison fixtures must be artifact-bound");
  return createEvidence(
    {
      path: `${template.subject.local_path}/${observation}`,
      sha256: template.subject.digest.sha256,
      format: template.subject.format,
    },
    template.provider,
    {
      operation: "analyze_function",
      parameters: { ...template.parameters, observation },
      result,
      confidence: template.confidence,
      authority: template.authority,
      relationshipCoverage,
    },
  );
};

const verify = async (
  call: (
    name: string,
    arguments_: Record<string, unknown>,
  ) => Promise<{
    readonly isError?: boolean | undefined;
    readonly structuredContent?: unknown | undefined;
  }>,
  comparison: ReturnType<typeof parseEvidence>,
  dimensions: readonly ("calls" | "overall" | "pseudocode")[],
) => {
  const response = await call("verify_reconstruction", {
    specification: {
      name: "Function call coverage verification",
      claims: dimensions.map((dimension) => ({
        kind: "structural-function",
        claim_id: dimension,
        title: `Check ${dimension}`,
        comparison_evidence_id: comparison.evidence_id,
        dimension,
      })),
    },
  });
  expect(response.isError, JSON.stringify(response.structuredContent)).not.toBe(
    true,
  );
  return parseEvidence(response.structuredContent);
};

const assertChangedDespiteUnknownCalls = async (
  call: Parameters<typeof verify>[0],
  left: ReturnType<typeof parseEvidence>,
): Promise<void> => {
  const changedRight = sourceWithCoverage(
    FUNCTION_COMPARISON_EXAMPLE.right,
    "coverage-changed-right",
    jsonValueSchema.parse({
      ...functionDossierSchema.parse(
        FUNCTION_COMPARISON_EXAMPLE.right.normalized_result,
      ),
      pseudocode: "return 1;",
    }),
    { status: "unknown", reason: "Call graph unavailable." },
  );
  const changed = await call("compare_functions", {
    left,
    right: changedRight,
  });
  expect(changed.isError, JSON.stringify(changed.structuredContent)).not.toBe(
    true,
  );
  const changedComparison = parseEvidence(changed.structuredContent);
  expect(changedComparison.normalized_result).toMatchObject({
    status: "changed",
    dimensions: expect.arrayContaining([
      expect.objectContaining({ dimension: "calls", status: "unknown" }),
      expect.objectContaining({ dimension: "pseudocode", status: "changed" }),
    ]),
  });
  const verification = await verify(call, changedComparison, ["overall"]);
  expect(verification.normalized_result).toMatchObject({
    status: "fail",
    summary: { total: 1, passed: 0, failed: 1, unknown: 0 },
    claims: {
      items: [
        expect.objectContaining({
          claim_id: "overall",
          status: "fail",
          observed_status: "changed",
        }),
      ],
    },
  });
};

it("keeps incomplete calls unknown through public comparison and verification while preserving confirmed changes", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Function comparison must not launch a provider");
  });
  const { client } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "function-coverage-test", version: "1" },
    serverOptions: {
      environment: {
        ...process.env,
        REA_MCP_MAX_INPUT_ELEMENTS: process.env.REA_MCP_MAX_INPUT_ELEMENTS,
      },
    },
  });
  const left = sourceWithCoverage(
    FUNCTION_COMPARISON_EXAMPLE.left,
    "coverage-left",
    FUNCTION_COMPARISON_EXAMPLE.left.normalized_result,
    { status: "complete" },
  );
  const right = sourceWithCoverage(
    FUNCTION_COMPARISON_EXAMPLE.right,
    "coverage-right",
    FUNCTION_COMPARISON_EXAMPLE.left.normalized_result,
    { status: "unknown", reason: "Call graph unavailable." },
  );
  expect(left.subject).not.toBeNull();
  expect(right.subject).not.toBeNull();
  expect(left.limitations).not.toContain(
    "Artifact identity is unavailable for this observation.",
  );
  expect(right.limitations).not.toContain(
    "Artifact identity is unavailable for this observation.",
  );
  const compared = await client.callTool({
    name: "compare_functions",
    arguments: { left, right },
  });
  expect(compared.isError, JSON.stringify(compared.structuredContent)).not.toBe(
    true,
  );
  const comparison = parseEvidence(compared.structuredContent);
  expect(session.evidenceById(left.evidence_id)?.subject).toEqual(
    expect.any(Object),
  );
  expect(session.evidenceById(right.evidence_id)?.subject).toEqual(
    expect.any(Object),
  );
  expect(comparison.normalized_result).toMatchObject({
    status: "unknown",
    summary: { unchanged: 7, changed: 0, unknown: 1 },
    dimensions: expect.arrayContaining([
      expect.objectContaining({
        dimension: "calls",
        status: "unknown",
        conclusion_kind: "unresolved_branch",
        left_count: 0,
        right_count: 0,
        limitations: ["Right: Call graph unavailable."],
        evidence_links: [left.evidence_id, right.evidence_id],
      }),
    ]),
  });
  expect(comparison.evidence_links).toEqual(
    expect.arrayContaining([left.evidence_id, right.evidence_id]),
  );

  const unknowns = await client.callTool({
    name: "list_unknowns",
    arguments: { domain: "function-comparison" },
  });
  expect(unknowns.isError).not.toBe(true);
  expect(unknowns.structuredContent).toMatchObject({
    result: {
      items: [
        expect.objectContaining({
          domain: "function-comparison",
          status: "open",
          supporting_evidence_ids: expect.arrayContaining([
            left.evidence_id,
            right.evidence_id,
          ]),
        }),
      ],
    },
  });

  const verification = await verify(
    async (name, arguments_) =>
      client.callTool({ name, arguments: arguments_ }),
    comparison,
    ["calls", "overall", "pseudocode"],
  );
  expect(verification.normalized_result).toMatchObject({
    status: "unknown",
    summary: { total: 3, passed: 1, failed: 0, unknown: 2 },
    claims: {
      items: expect.arrayContaining([
        expect.objectContaining({
          claim_id: "calls",
          status: "unknown",
          observed_status: "unknown",
        }),
        expect.objectContaining({
          claim_id: "overall",
          status: "unknown",
          observed_status: "unknown",
        }),
        expect.objectContaining({
          claim_id: "pseudocode",
          status: "pass",
          observed_status: "unchanged",
        }),
      ]),
    },
  });

  await assertChangedDespiteUnknownCalls(
    async (name, arguments_) =>
      client.callTool({ name, arguments: arguments_ }),
    left,
  );
});
