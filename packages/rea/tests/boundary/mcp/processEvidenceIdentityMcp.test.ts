import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, onTestFinished } from "vitest";

import { compareProcessEvidenceFiles } from "../../../src/application/process/ProcessCli.js";
import { PROCESS_PROVIDER } from "../../../src/domain/process/processEvidenceProvider.js";
import { FUNCTION_COMPARISON_EXAMPLE } from "../../../src/contracts/functionComparisonExample.js";
import {
  FUNCTION_COMPARISON_EVIDENCE,
  INVESTIGATION_EXAMPLES,
  PROCESS_COMPARISON_EVIDENCE,
} from "../../../src/contracts/investigationExamples.js";
import { EMPTY_PROCESS_CAPTURE_EXAMPLE } from "../../../src/domain/process/processCaptureExample.js";
import { findChangedBehavior } from "../../../src/domain/changedBehavior.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { correlateStaticAndRuntime } from "../../../src/domain/staticRuntimeCorrelation.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import { verifyReconstruction } from "../../../src/domain/reconstructionVerification.js";
const providerNames = [
  "REA process capture",
  "REA deterministic process harness",
];

const captureEvidence = (
  side: "left" | "right",
  result: Evidence["normalized_result"] = EMPTY_PROCESS_CAPTURE_EXAMPLE,
) =>
  createEvidence(undefined, PROCESS_PROVIDER, {
    predicateType: "rea.process-capture",
    operation: "capture_process_scenario",
    parameters: { side },
    result,
    confidence: "observed",
    authority: "controlled-replay",
    environment: {
      id: "fixture-process",
      platform: "fixture",
      architecture: "fixture",
      isolation: "process",
    },
  });

const inlineEvidence = (response: { structuredContent?: unknown }) =>
  parseEvidence(response.structuredContent);

const connectedComparison = async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Process comparison must not launch a provider");
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({
    name: "process-evidence-identity",
    version: "1",
  });
  onTestFinished(async () => {
    await Promise.allSettled([client.close(), server.close(), session.close()]);
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  for (const evidence of [
    FUNCTION_COMPARISON_EXAMPLE.left,
    FUNCTION_COMPARISON_EXAMPLE.right,
    FUNCTION_COMPARISON_EVIDENCE,
  ])
    expect(session.recordEvidence(evidence).ok).toBe(true);
  const left = captureEvidence("left");
  const right = captureEvidence("right");
  const response = await client.callTool({
    name: "compare_process_captures",
    arguments: { left, right },
  });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  const comparison = inlineEvidence(response);
  expect(comparison.provider).toEqual({
    id: "rea-process",
    name: "REA process capture",
    version: "3",
  });
  expect(comparison.normalized_result).toMatchObject({ status: "unchanged" });
  return { session, client, left, right, comparison };
};

const correlationInput = (comparison: Evidence) => {
  const mapping =
    INVESTIGATION_EXAMPLES.correlate_static_and_runtime.mappings[0];
  if (mapping === undefined) throw new Error("Missing correlation mapping");
  return {
    static_comparisons: [FUNCTION_COMPARISON_EVIDENCE],
    runtime_comparisons: [comparison],
    mappings: [
      {
        ...mapping,
        runtime: {
          ...mapping.runtime,
          comparison_evidence_id: comparison.evidence_id,
        },
      },
    ],
  };
};

const specification = (comparison: Evidence) => ({
  name: "Terminal compatibility",
  claims: [
    {
      kind: "behavioral",
      claim_id: "terminal-output",
      title: "Terminal output remains equivalent",
      comparison_evidence_id: comparison.evidence_id,
      dimension: "terminal",
    },
  ],
});

const consumerCalls = (comparison: Evidence) => [
  {
    name: "find_changed_behavior",
    arguments: { comparisons: [comparison] },
    expected: { behavior_status: "observed_unchanged" },
  },
  {
    name: "correlate_static_and_runtime",
    arguments: correlationInput(comparison),
    expected: { status: "correlated" },
  },
  {
    name: "verify_reconstruction",
    arguments: { specification: specification(comparison) },
    expected: { status: "pass" },
  },
];

const expectConsumerResults = async (client: Client, comparison: Evidence) => {
  for (const { expected, ...call } of consumerCalls(comparison)) {
    const response = await client.callTool(call);
    expect(
      response.isError,
      `${call.name}: ${JSON.stringify(response)}`,
    ).not.toBe(true);
    expect(inlineEvidence(response).normalized_result).toMatchObject(expected);
  }
};

it("feeds the exact public CLI/MCP process comparison into all three MCP consumers", async () => {
  const { client, left, right, comparison } = await connectedComparison();
  const root = await createTestTempDirectory("rea-process-identity-");
  const leftPath = join(root, "left.json");
  const rightPath = join(root, "right.json");
  await Promise.all([
    writeFile(leftPath, JSON.stringify(left)),
    writeFile(rightPath, JSON.stringify(right)),
  ]);
  const cliComparison = parseEvidence(
    await compareProcessEvidenceFiles(leftPath, rightPath),
  );
  expect(cliComparison).toEqual(comparison);
  await expectConsumerResults(client, comparison);
});

it("advertises the same process comparison Evidence that its example inputs produce", async () => {
  const { client } = await connectedComparison();
  const response = await client.callTool({
    name: "compare_process_captures",
    arguments: INVESTIGATION_EXAMPLES.compare_process_captures.input,
  });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  expect(inlineEvidence(response)).toEqual(PROCESS_COMPARISON_EVIDENCE);
});

type IdentityChange = Partial<
  Pick<
    Evidence,
    | "provider"
    | "predicate_type"
    | "operation"
    | "subject"
    | "confidence"
    | "authority"
  >
>;

// Use the public Evidence builder so each admission control has a valid digest.
const rehashedComparison = (
  base: Evidence,
  change: IdentityChange,
): Evidence => {
  const next = { ...base, ...change };
  const subject = next.subject;
  return createEvidence(
    subject === null
      ? undefined
      : {
          path: subject.local_path,
          sha256: subject.digest.sha256,
          format: subject.format,
          ...(subject.architecture === null
            ? {}
            : { architecture: subject.architecture }),
        },
    next.provider,
    {
      predicateType: next.predicate_type,
      operation: next.operation,
      parameters: next.parameters,
      result: next.normalized_result,
      rawResult: next.raw_result,
      confidence: next.confidence,
      authority: next.authority,
      environment: next.environment,
      limitations: next.limitations,
      locations: next.locations,
      evidenceLinks: next.evidence_links,
    },
  );
};

it.each(providerNames)(
  "admits the exact v3 provider name %s in every MCP consumer",
  async (name) => {
    const { session, client, comparison } = await connectedComparison();
    const admitted = rehashedComparison(comparison, {
      provider: { ...comparison.provider, name },
    });
    expect(parseEvidence(admitted)).toEqual(admitted);
    expect(session.recordEvidence(admitted).ok).toBe(true);
    await expectConsumerResults(client, admitted);
  },
);

const DIGEST_MISMATCH_REASON =
  "Evidence validation failed at evidence_id: Evidence semantic identifier does not match its record";

const identityMismatchReason = (tool: string): string => {
  switch (tool) {
    case "find_changed_behavior":
      return "Comparison Evidence operation, predicate, and provider disagree";
    case "correlate_static_and_runtime":
      return "Comparison Evidence operation, predicate, provider, or citations disagree";
    case "verify_reconstruction":
      return "Comparison Evidence identity or authority disagrees";
    default:
      throw new Error(`Unexpected comparison consumer ${tool}`);
  }
};

const unsupportedOperationIssue = (
  tool: string,
): {
  readonly path: readonly (string | number)[];
  readonly message: string;
} => {
  switch (tool) {
    case "find_changed_behavior":
      return {
        path: ["comparisons", 0],
        message:
          "Changed-behavior analysis requires process, artifact, or function comparison Evidence",
      };
    case "correlate_static_and_runtime":
      return {
        path: ["runtime_comparisons", 0],
        message:
          "Static/runtime correlation requires process comparison Evidence",
      };
    case "verify_reconstruction":
      return {
        path: ["claims", 0, "comparison_evidence_id"],
        message:
          "Claim terminal-output requires compare_process_captures Evidence; selected fixture_comparison",
      };
    default:
      throw new Error(`Unexpected comparison consumer ${tool}`);
  }
};

const expectComparisonRejection = (
  response: Parameters<typeof parseMcpToolError>[0],
  tool: string,
  kind: "identity" | "operation" | "digest",
) => {
  if (kind === "operation") {
    const issue = unsupportedOperationIssue(tool);
    expect(parseMcpToolError(response), tool).toMatchObject({
      error: {
        code: "invalid_request",
        category: "invalid_input",
        message: issue.message,
        recovery: { kind: "inspect_input_contract", operation: tool },
        details: {
          operation: tool,
          issues: [
            {
              path: [...issue.path],
              reason: "invalid_value",
              message: issue.message,
            },
          ],
        },
      },
    });
    return;
  }
  const reason =
    kind === "digest" ? DIGEST_MISMATCH_REASON : identityMismatchReason(tool);
  expect(parseMcpToolError(response), tool).toMatchObject({
    error: {
      code: "evidence_integrity_mismatch",
      category: "integrity_mismatch",
      message: reason,
      details: { reason },
    },
  });
};

const invalidIdentities: ReadonlyArray<{
  label: string;
  kind: "identity" | "operation";
  change: (base: Evidence) => IdentityChange;
}> = [
  {
    label: "wrong name",
    kind: "identity",
    change: ({ provider }) => ({
      provider: { ...provider, name: `${provider.name} extra` },
    }),
  },
  {
    label: "wrong id",
    kind: "identity",
    change: ({ provider }) => ({
      provider: { ...provider, id: "fixture-process" },
    }),
  },
  {
    label: "old version",
    kind: "identity",
    change: ({ provider }) => ({ provider: { ...provider, version: "2" } }),
  },
  {
    label: "future version",
    kind: "identity",
    change: ({ provider }) => ({ provider: { ...provider, version: "4" } }),
  },
  {
    label: "missing version",
    kind: "identity",
    change: ({ provider }) => ({ provider: { ...provider, version: null } }),
  },
  {
    label: "wrong predicate",
    kind: "identity",
    change: () => ({ predicate_type: "fixture.comparison" }),
  },
  {
    label: "wrong operation",
    kind: "operation",
    change: () => ({ operation: "fixture_comparison" }),
  },
  {
    label: "non-null subject",
    kind: "identity",
    change: () => ({ subject: FUNCTION_COMPARISON_EXAMPLE.left.subject }),
  },
  {
    label: "wrong confidence",
    kind: "identity",
    change: () => ({ confidence: "observed" }),
  },
  {
    label: "wrong authority",
    kind: "identity",
    change: () => ({ authority: "controlled-replay" }),
  },
];

for (const name of providerNames)
  it.each(invalidIdentities)(
    `rejects independently rehashed $label for ${name} in every MCP consumer`,
    async ({ change, kind }) => {
      const { session, client, comparison } = await connectedComparison();
      const named = rehashedComparison(comparison, {
        provider: { ...comparison.provider, name },
      });
      const invalid = rehashedComparison(named, change(named));
      expect(invalid.evidence_id).not.toBe(named.evidence_id);
      expect(parseEvidence(invalid)).toEqual(invalid);
      expect(session.recordEvidence(invalid).ok).toBe(true);
      for (const { expected: _expected, ...call } of consumerCalls(invalid)) {
        const response = await client.callTool(call);
        expect(response.isError, call.name).toBe(true);
        expectComparisonRejection(response, call.name, kind);
      }
    },
  );

it("separately rejects a tampered digest before admission to any consumer or session", async () => {
  const { session, client, comparison } = await connectedComparison();
  const tampered = {
    ...comparison,
    provider: {
      ...comparison.provider,
      name: "REA deterministic process harness",
    },
  };
  const digestMismatch = /semantic identifier does not match/u;
  expect(() => parseEvidence(tampered)).toThrow(digestMismatch);
  expect(() => findChangedBehavior({ comparisons: [tampered] })).toThrow(
    digestMismatch,
  );
  expect(() => correlateStaticAndRuntime(correlationInput(tampered))).toThrow(
    digestMismatch,
  );
  const records = session
    .exportEvidenceBundle()
    .records.map((record) =>
      record.evidence_id === tampered.evidence_id ? tampered : record,
    );
  expect(() =>
    verifyReconstruction(
      specification(tampered),
      createEvidenceBundle(records),
    ),
  ).toThrow(digestMismatch);
  expect(session.recordEvidence(tampered).ok).toBe(false);
  for (const { expected: _expected, ...call } of consumerCalls(tampered).filter(
    ({ name }) => name !== "verify_reconstruction",
  )) {
    const response = await client.callTool(call);
    expect(response.isError, call.name).toBe(true);
    expectComparisonRejection(response, call.name, "digest");
  }
});

it("maps malformed changed-behavior Evidence to an integrity mismatch before closure lookup", async () => {
  const { client, comparison } = await connectedComparison();
  const malformed = { ...comparison, evidence_links: undefined } as unknown;
  const response = await client.callTool({
    name: "find_changed_behavior",
    arguments: { comparisons: [malformed] },
  });
  expect(response.isError).toBe(true);
  const reason =
    "Evidence validation failed at evidence_links: Invalid input: expected array, received undefined";
  expect(parseMcpToolError(response)).toMatchObject({
    error: {
      code: "evidence_integrity_mismatch",
      category: "integrity_mismatch",
      message: reason,
      details: { reason },
    },
  });
});

it("keeps withheld ownership unknown through CLI and MCP comparison", async () => {
  const { client, right } = await connectedComparison();
  const left = captureEvidence("left", {
    ...EMPTY_PROCESS_CAPTURE_EXAMPLE,
    cleanup: {
      ...EMPTY_PROCESS_CAPTURE_EXAMPLE.cleanup,
      unverified_processes: [
        { pid: 900, reason: "platform_binary_environment_withheld" },
      ],
    },
    residual_unknowns: [
      { scope: "process", reason: "Ownership of process 900 was withheld" },
    ],
  });
  const response = await client.callTool({
    name: "compare_process_captures",
    arguments: { left, right },
  });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  const comparison = inlineEvidence(response);
  expect(comparison.normalized_result).toMatchObject({ status: "unknown" });
  const root = await createTestTempDirectory("rea-withheld-ownership-");
  const leftPath = join(root, "left.json");
  const rightPath = join(root, "right.json");
  await writeFile(leftPath, JSON.stringify(left));
  await writeFile(rightPath, JSON.stringify(right));
  expect(
    parseEvidence(await compareProcessEvidenceFiles(leftPath, rightPath)),
  ).toEqual(comparison);
});
