import type { Client } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";

import { FUNCTION_COMPARISON_EXAMPLE } from "../../../src/contracts/functionComparisonExample.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { functionDossierSchema } from "../../../src/domain/native/functionDossier.js";

import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const withClient = async (
  run: (
    client: Client,
    session: ReturnType<typeof createTestBinarySession>,
  ) => Promise<void>,
): Promise<void> => {
  const session = createTestBinarySession(() => {
    throw new Error("This workflow must not launch an analysis provider");
  });
  const harness = await createApplicationMcpHarness({ session });
  try {
    await run(harness.client, session);
  } finally {
    await harness.close();
  }
};

const pathSource = () => {
  const template = FUNCTION_COMPARISON_EXAMPLE.left;
  if (template.subject === null)
    throw new Error("Call-path fixtures must be artifact-bound");
  const dossier = functionDossierSchema.parse(template.normalized_result);
  return createEvidence(
    {
      path: `${template.subject.local_path}/workflow-unknown-path`,
      sha256: template.subject.digest.sha256,
      format: template.subject.format,
    },
    template.provider,
    {
      operation: "analyze_function",
      parameters: {
        ...template.parameters,
        observation: "workflow-unknown-path",
      },
      result: {
        ...dossier,
        callees: [
          {
            address: "0x2000",
            name: "missing-helper",
            classification: null,
            body: { available: false, reason: "No body was observed." },
          },
        ],
      },
      confidence: template.confidence,
      authority: template.authority,
      relationshipCoverage: { status: "complete" },
    },
  );
};

const incompleteRight = (suffix: string) => {
  const template = FUNCTION_COMPARISON_EXAMPLE.right;
  if (template.subject === null)
    throw new Error("Comparison fixtures must be artifact-bound");
  return createEvidence(
    {
      path: `${template.subject.local_path}/${suffix}`,
      sha256: template.subject.digest.sha256,
      format: template.subject.format,
    },
    template.provider,
    {
      operation: "analyze_function",
      parameters: { ...template.parameters, observation: suffix },
      result: functionDossierSchema.parse(
        FUNCTION_COMPARISON_EXAMPLE.left.normalized_result,
      ),
      confidence: template.confidence,
      authority: template.authority,
      relationshipCoverage: {
        status: "unknown",
        reason: "The fixture omits call relationship coverage.",
      },
    },
  );
};

const compareIncomplete = async (client: Client, suffix: string) => {
  const response = await client.callTool({
    name: "compare_functions",
    arguments: {
      left: FUNCTION_COMPARISON_EXAMPLE.left,
      right: incompleteRight(suffix),
    },
  });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  const comparison = parseEvidence(response.structuredContent);
  expect(comparison.normalized_result).toMatchObject({ status: "unknown" });
  return comparison;
};

const verifyCallClaim = async (
  client: Client,
  comparison: ReturnType<typeof parseEvidence>,
) =>
  client.callTool({
    name: "verify_reconstruction",
    arguments: {
      specification: {
        name: "Same unresolved call claim",
        claims: [
          {
            kind: "structural-function",
            claim_id: "call-coverage",
            title: "Call coverage is complete",
            comparison_evidence_id: comparison.evidence_id,
            dimension: "calls",
          },
        ],
      },
    },
  });

const assertUnknownEvidence = (
  response: Awaited<ReturnType<Client["callTool"]>>,
) => {
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  expect(
    parseEvidence(response.structuredContent).normalized_result,
  ).toMatchObject({ status: "unknown" });
};

it("retains separate unresolved call-path workflows in one session", async () => {
  await withClient(async (client, session) => {
    const source = pathSource();
    expect(session.recordEvidence(source).ok).toBe(true);
    const responses = [];
    for (const goal of ["0x3000", "0x4000", "0x3000"])
      responses.push(
        await client.callTool({
          name: "build_call_path",
          arguments: {
            functions: [source],
            start: { address: "0x1000" },
            goal: { address: goal },
          },
        }),
      );
    responses.forEach(assertUnknownEvidence);
    const ids = responses.map(
      (response) => parseEvidence(response.structuredContent).evidence_id,
    );
    expect(ids[2]).toBe(ids[0]);
    expect(ids[1]).not.toBe(ids[0]);
    expect(
      session
        .listUnknowns({ domain: "call-path" })
        .map(({ supporting_evidence_ids }) => supporting_evidence_ids),
    ).toEqual(expect.arrayContaining([...new Set(ids)].map((id) => [id])));
    expect(
      session
        .listUnknowns({ domain: "call-path" })
        .map(({ question }) => question)
        .sort(),
    ).toEqual(
      [...new Set(ids)]
        .map(
          (id) =>
            `Can the requested call path be established from complete analysis? (Evidence ${id})`,
        )
        .sort(),
    );
    const unknowns = await client.callTool({
      name: "list_unknowns",
      arguments: { domain: "call-path" },
    });
    expect(unknowns.structuredContent).toMatchObject({
      result: { total: 2, items: expect.any(Array) },
    });
  });
});

it("retains separate unresolved reconstruction verifications with identical claim names", async () => {
  await withClient(async (client, session) => {
    const firstComparison = await compareIncomplete(
      client,
      "verification-unknown-a",
    );
    const secondComparison = await compareIncomplete(
      client,
      "verification-unknown-b",
    );
    const responses = [
      await verifyCallClaim(client, firstComparison),
      await verifyCallClaim(client, secondComparison),
      await verifyCallClaim(client, firstComparison),
    ];
    responses.forEach(assertUnknownEvidence);
    const ids = responses.map(
      (response) => parseEvidence(response.structuredContent).evidence_id,
    );
    expect(ids[2]).toBe(ids[0]);
    expect(ids[1]).not.toBe(ids[0]);
    expect(
      session
        .listUnknowns({ domain: "reconstruction-verification" })
        .map(({ supporting_evidence_ids }) => supporting_evidence_ids),
    ).toEqual(expect.arrayContaining([...new Set(ids)].map((id) => [id])));
    const unknowns = await client.callTool({
      name: "list_unknowns",
      arguments: { domain: "reconstruction-verification" },
    });
    expect(unknowns.structuredContent).toMatchObject({
      result: { total: 2, items: expect.any(Array) },
    });
  });
});

it("continues rejecting duplicate explicit record_unknown identities", async () => {
  await withClient(async (client) => {
    const input = {
      question: "Does this explicitly submitted question remain unique?",
      severity: "medium",
      domain: "manual-duplicate-control",
      required_authority: null,
      required_confidence: "derived",
      required_environment: null,
      recommended_probes: [],
      relationships: [],
    };
    const first = await client.callTool({
      name: "record_unknown",
      arguments: input,
    });
    expect(first.isError).not.toBe(true);
    const duplicate = await client.callTool({
      name: "record_unknown",
      arguments: input,
    });
    expect(parseMcpToolError(duplicate).error).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining("already exists"),
    });
  });
});
