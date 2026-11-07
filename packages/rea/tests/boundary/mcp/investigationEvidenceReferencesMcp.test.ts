import { expect, it } from "vitest";

import { FUNCTION_COMPARISON_EXAMPLE } from "../../../src/contracts/functionComparisonExample.js";
import {
  FUNCTION_COMPARISON_EVIDENCE,
  INVESTIGATION_EXAMPLES,
  PROCESS_CAPTURE_REFERENCE,
  PROCESS_CAPTURE_RECONSTRUCTION,
  PROCESS_COMPARISON_EVIDENCE,
} from "../../../src/contracts/investigationExamples.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../../src/domain/evidence.js";
import { functionDossierSchema } from "../../../src/domain/native/functionDossier.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const reference = (source: Evidence) => ({
  kind: "retained-evidence" as const,
  evidence_id: source.evidence_id,
});

const harness = (inputElements?: string) =>
  createApplicationMcpHarness({
    session: createTestBinarySession(() => {
      throw new Error("Composing completed Evidence must not open a provider");
    }),
    ...(inputElements === undefined
      ? {}
      : {
          serverOptions: {
            environment: { REA_MCP_MAX_INPUT_ELEMENTS: inputElements },
          },
        }),
  });

it("admits an independent inline dossier and composes its summary parent without producer work", async () => {
  const { session, client } = await harness();
  const source = FUNCTION_COMPARISON_EXAMPLE.left;
  const selection = {
    start: { address: "0x1000" },
    goal: { address: "0x1000" },
  };
  expect(session.hasEvidence(source.evidence_id)).toBe(false);
  const inline = await client.callTool({
    name: "build_call_path",
    arguments: { ...selection, functions: [source] },
  });
  expect(inline.isError, JSON.stringify(inline)).not.toBe(true);
  const expected = parseEvidence(inline.structuredContent);
  expect(expected.normalized_result).toMatchObject({
    status: "found",
    shortest_hops: 0,
  });
  expect(session.hasEvidence(source.evidence_id)).toBe(true);

  const summary = await client.callTool({
    name: "inspect_analysis_view",
    arguments: { source: reference(source), view: { kind: "summary" } },
  });
  expect(summary.isError, JSON.stringify(summary)).not.toBe(true);
  const receipt = parseEvidence(summary.structuredContent);
  expect(receipt.normalized_result).toMatchObject({
    parent_evidence_id: source.evidence_id,
  });
  const retained = await client.callTool({
    name: "build_call_path",
    arguments: { ...selection, functions: [reference(source)] },
  });
  expect(retained.isError, JSON.stringify(retained)).not.toBe(true);
  expect(parseEvidence(retained.structuredContent)).toEqual(expected);
});

it("keeps input capacity limits while composing dossiers that cannot be resent inline", async () => {
  const { session, client } = await harness("1024");
  const base = FUNCTION_COMPARISON_EXAMPLE.left;
  if (base.subject === null) throw new Error("Missing fixture subject");
  const dossier = functionDossierSchema.parse(base.normalized_result);
  const source = createEvidence(
    {
      path: base.subject.local_path,
      sha256: base.subject.digest.sha256,
      format: base.subject.format,
    },
    base.provider,
    {
      operation: "analyze_function",
      parameters: base.parameters,
      result: {
        ...dossier,
        assembly: Array.from({ length: 1200 }, () => "nop"),
      },
      confidence: base.confidence,
      authority: base.authority,
      relationshipCoverage: { status: "complete" },
    },
  );
  expect(session.recordEvidence(source).ok).toBe(true);
  const selection = {
    start: { address: "0x1000" },
    goal: { address: "0x1000" },
  };
  const inline = await client.callTool({
    name: "build_call_path",
    arguments: { ...selection, functions: [source] },
  });
  expect(parseMcpToolError(inline)).toMatchObject({
    error: { code: "resource_constraint" },
  });
  const retained = await client.callTool({
    name: "build_call_path",
    arguments: { ...selection, functions: [reference(source)] },
  });
  expect(retained.isError, JSON.stringify(retained)).not.toBe(true);
  expect(
    parseEvidence(retained.structuredContent).normalized_result,
  ).toMatchObject({ status: "found" });
});

it("resolves comparison arrays and process pairs with complete source lineage", async () => {
  const { session, client } = await harness();
  for (const source of [
    FUNCTION_COMPARISON_EXAMPLE.left,
    FUNCTION_COMPARISON_EXAMPLE.right,
    PROCESS_CAPTURE_REFERENCE,
    PROCESS_CAPTURE_RECONSTRUCTION,
  ])
    expect(session.recordEvidence(source).ok).toBe(true);
  const pair = await client.callTool({
    name: "compare_process_captures",
    arguments: {
      left: reference(PROCESS_CAPTURE_REFERENCE),
      right: reference(PROCESS_CAPTURE_RECONSTRUCTION),
    },
  });
  expect(pair.isError, JSON.stringify(pair)).not.toBe(true);
  expect(parseEvidence(pair.structuredContent)).toEqual(
    PROCESS_COMPARISON_EVIDENCE,
  );
  // Neither selected comparison has to be pre-inserted: inline admission owns it.
  const inline = await client.callTool({
    name: "correlate_static_and_runtime",
    arguments: INVESTIGATION_EXAMPLES.correlate_static_and_runtime,
  });
  expect(inline.isError, JSON.stringify(inline)).not.toBe(true);
  const expected = parseEvidence(inline.structuredContent);
  const retained = await client.callTool({
    name: "correlate_static_and_runtime",
    arguments: {
      ...INVESTIGATION_EXAMPLES.correlate_static_and_runtime,
      static_comparisons: [reference(FUNCTION_COMPARISON_EVIDENCE)],
      runtime_comparisons: [reference(PROCESS_COMPARISON_EVIDENCE)],
    },
  });
  expect(retained.isError, JSON.stringify(retained)).not.toBe(true);
  expect(parseEvidence(retained.structuredContent)).toEqual(expected);
  for (const id of expected.evidence_links)
    expect(session.hasEvidence(id), id).toBe(true);
});

it("reports missing or wrong-kind records without recording a successful workflow", async () => {
  const { session, client } = await harness();
  const selection = {
    start: { address: "0x1000" },
    goal: { address: "0x1000" },
  };
  const missing = await client.callTool({
    name: "build_call_path",
    arguments: {
      ...selection,
      functions: [
        { kind: "retained-evidence", evidence_id: `ev_${"f".repeat(64)}` },
      ],
    },
  });
  expect(parseMcpToolError(missing)).toMatchObject({
    error: { details: { reason: "missing" } },
  });
  expect(session.exportEvidenceBundle().records).toHaveLength(0);
  expect(session.recordEvidence(PROCESS_CAPTURE_REFERENCE).ok).toBe(true);
  const wrong = await client.callTool({
    name: "build_call_path",
    arguments: {
      ...selection,
      functions: [reference(PROCESS_CAPTURE_REFERENCE)],
    },
  });
  expect(wrong.isError).toBe(true);
  expect(session.exportEvidenceBundle().records).toHaveLength(1);
});
