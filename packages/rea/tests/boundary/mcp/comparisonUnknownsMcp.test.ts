import { expect, it } from "vitest";

import { ARTIFACT_COMPARISON_EXAMPLE } from "../../../src/contracts/artifactComparisonExample.js";
import { FUNCTION_COMPARISON_EXAMPLE } from "../../../src/contracts/functionComparisonExample.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../../src/domain/evidence.js";
import { jsonValueSchema } from "../../../src/domain/jsonValue.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";

const connect = async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Evidence comparison must not launch a provider");
  });
  return createApplicationMcpHarness({
    session,
    clientIdentity: { name: "comparison-unknowns", version: "1" },
    serverOptions: {
      environment: {
        ...process.env,
        REA_MCP_MAX_INPUT_ELEMENTS: process.env.REA_MCP_MAX_INPUT_ELEMENTS,
      },
    },
  });
};

const observeAgain = (
  source: Evidence,
  observation: number,
  result = source.normalized_result,
) =>
  createEvidence(
    source.subject === null
      ? undefined
      : {
          path: `/tmp/fixture-${observation}`,
          sha256: source.subject.digest.sha256,
          format: source.subject.format,
        },
    source.provider,
    {
      predicateType: source.predicate_type,
      operation: source.operation,
      parameters: { observation },
      result,
      confidence: source.confidence,
      authority: source.authority,
      ...(source.relationship_coverage === null
        ? {}
        : { relationshipCoverage: source.relationship_coverage }),
    },
  );

it("retains one open unknown for an incomplete artifact compared with itself", async () => {
  const { client, session } = await connect();
  const source = ARTIFACT_COMPARISON_EXAMPLE.left;
  const result = jsonValueSchema.parse(source.normalized_result);
  if (result === null || Array.isArray(result) || typeof result !== "object")
    throw new Error("Expected an inventory object");
  const incomplete = observeAgain(source, 1, {
    ...result,
    nodes: [],
    occurrences: [],
  });
  const response = await client.callTool({
    name: "compare_artifacts",
    arguments: { left: incomplete, right: incomplete },
  });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  expect(response.structuredContent).toMatchObject({
    normalized_result: { status: "truncated" },
  });
  expect(session.listUnknowns({ domain: "artifact-comparison" })).toMatchObject(
    [
      {
        status: "open",
        supporting_evidence_ids: [incomplete.evidence_id],
        contradicting_evidence_ids: [],
      },
    ],
  );
});

it.each([
  {
    tool: "compare_artifacts",
    domain: "artifact-comparison",
    pair: ARTIFACT_COMPARISON_EXAMPLE,
  },
  {
    tool: "compare_functions",
    domain: "function-comparison",
    pair: FUNCTION_COMPARISON_EXAMPLE,
  },
])(
  "keeps independent $domain observations and repeated comparisons idempotent",
  async ({ tool, domain, pair }) => {
    const { client, session } = await connect();
    const right = observeAgain(pair.right, 2);
    for (const source of [pair.right, right]) {
      const response = await client.callTool({
        name: tool,
        arguments: { left: pair.left, right: source },
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expect(response.structuredContent).toMatchObject({
        normalized_result: { status: "changed" },
      });
    }
    expect(session.listUnknowns({ domain })).toHaveLength(2);
    const before = session.exportEvidenceBundle();
    const repeated = await client.callTool({
      name: tool,
      arguments: { left: pair.left, right },
    });
    expect(repeated.isError, JSON.stringify(repeated)).not.toBe(true);
    const compared = parseEvidence(repeated.structuredContent);
    expect(session.evidenceById(compared.evidence_id)).toEqual(compared);
    expect(session.exportEvidenceBundle()).toEqual(before);
  },
);
