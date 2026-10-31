import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import pino from "pino";
import { expect, it, onTestFinished, vi } from "vitest";

import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { registerEnhancedTools } from "../../../src/server/registerEnhancedTools.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { withAdmittedAnalysis } from "../../../src/server/analysisAdmission.js";
import type { AnalysisOperationPort } from "../../../src/application/AnalysisProvider.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../../src/domain/evidence.js";
import { join } from "node:path";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import { ok } from "../../../src/domain/result.js";
import { functionDossierSchema } from "../../../src/domain/native/functionDossier.js";
import { ghidraFunctionDossier } from "../../../src/domain/ghidraValues.fixture.js";
import { parseGhidraFunctionInput } from "../../../src/ghidra/GhidraFunctionValues.js";
import { EvidenceLedger } from "../../../src/application/investigation/EvidenceLedger.js";
import { registerAnalysisViewTool } from "../../../src/server/registerAnalysisViewTool.js";

const dossier = functionDossierSchema.parse(ghidraFunctionDossier());
const partialCallees = {
  status: "partial" as const,
  limitations: ["Callees: fixture read limit"],
  limited_directions: ["callees"] as const,
};

// A fixed provider that returns the fixture dossier for any analyze_function
// call, after validating the request exactly as the production Ghidra client does.
const connect = async (
  retain = true,
  result = dossier,
  path = () => "/fixtures/native.exe",
  sources: readonly Evidence[] = [],
) => {
  const ledger = new EvidenceLedger();
  const record = (evidence: Evidence) => ledger.record(evidence);
  const lookup = (id: string) => ledger.forAnalysis(id);
  const execute = vi.fn(
    async (operation: string, parameters: Record<string, JsonValue>) => {
      let observed: JsonValue = result;
      if (operation === "analyze_function") {
        const input = parseGhidraFunctionInput(operation, parameters);
        if (!input.ok) return input;
      } else if (operation === "list_procedures") {
        observed = [{ address: "0x401000", value: "main" }];
      } else if (operation === "procedure_info") {
        observed = null;
      } else if (operation === "procedure_pseudo_code") {
        observed = "int main(void) { return 0; }";
      } else throw new Error(`Unexpected operation: ${operation}`);
      return ok({
        result: observed,
        rawResult: null,
        provider: { id: "ghidra", name: "Ghidra", version: "12.1.4" },
        limitations: [],
        locations: [],
        sourceEvidence: sources,
        subject: {
          path: path(),
          format: "pe" as const,
          sha256: "a".repeat(64),
        },
        relationshipCoverage: partialCallees,
      });
    },
  );
  const analysis = { execute } as unknown as AnalysisOperationPort;
  const delivery = createToolResultDelivery(4 * 1024 * 1024);
  const server = new EvidenceMcpServer(
    { name: "fn-detail", version: "1" },
    {},
    retain ? record : undefined,
    delivery,
  );
  registerEnhancedTools(server, {
    withAdmittedAnalysis: withAdmittedAnalysis({ kind: "fixed", analysis }),
    logger: pino({ enabled: false }),
    activeTarget: () => undefined,
    analysisProfile: undefined,
    recordEvidence: retain ? record : undefined,
    evidenceById: retain ? lookup : undefined,
    recordUnknown: undefined,
    allowsSnapshotReplay: undefined,
    recordWorkflowSnapshot: undefined,
  });
  registerAnalysisViewTool(
    server,
    pino({ enabled: false }),
    retain ? lookup : undefined,
    retain ? record : undefined,
  );
  const client = new Client({ name: "fn-detail-client", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await server.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, ledger, execute };
};

it.each(["analyze_function", "decompile_all"] as const)(
  "retains plain-port source records before delivering %s links",
  async (operation) => {
    const source = createEvidence(
      undefined,
      { id: "ghidra", name: "Ghidra", version: "12.1.4" },
      {
        operation: "health",
        parameters: { facet: "historical-report" },
        result: { origin: "caller-project" },
      },
      { immutable: true },
    );
    const { client, ledger } = await connect(true, dossier, undefined, [
      source,
    ]);
    const parent = await createTestTempDirectory("rea-plain-source-");
    const reply = await client.callTool({
      name: operation,
      arguments:
        operation === "analyze_function"
          ? { procedure: "main", detail: "complete" }
          : { output_directory: join(parent, "out") },
    });
    expect(reply.isError).not.toBe(true);
    const evidence = parseEvidence(reply.structuredContent);
    expect(evidence.evidence_links).toContain(source.evidence_id);
    expect(JSON.stringify(reply)).not.toContain("caller-project");
    expect(ledger.forAnalysis(source.evidence_id)).toEqual(source);
    expect(
      ledger
        .immutableBundle()
        .records.filter((record) => record.evidence_id === source.evidence_id),
    ).toHaveLength(1);
  },
);

it("refuses source links when a plain-port adapter has no retention owner", async () => {
  const source = createEvidence(
    undefined,
    { id: "fixture", name: "Fixture", version: "1" },
    {
      operation: "health",
      parameters: {},
      result: "historical",
    },
  );
  const { client } = await connect(false, dossier, undefined, [source]);
  const reply = await client.callTool({
    name: "analyze_function",
    arguments: { procedure: "main", detail: "complete" },
  });
  expect(reply.isError).toBe(true);
  expect(JSON.stringify(reply)).toContain("retains provider source Evidence");
});

it("keeps complete and summary delivery on the current observed path despite retained same-ID history", async () => {
  let selected = "/old/native.exe";
  const { client, ledger } = await connect(true, dossier, () => selected);
  const call = async (detail: "complete" | "summary") => {
    const reply = await client.callTool({
      name: "analyze_function",
      arguments: { procedure: "main", detail },
    });
    expect(reply.isError).not.toBe(true);
    return parseEvidence(reply.structuredContent);
  };
  const old = await call("complete");
  selected = "/selected/native.exe";
  const complete = await call("complete");
  expect(complete.evidence_id).toBe(old.evidence_id);
  expect(complete.subject?.local_path).toBe(selected);
  const summary = await call("summary");
  expect(summary.evidence_links).toEqual([complete.evidence_id]);
  expect(summary.subject?.local_path).toBe(complete.subject?.local_path);
  expect(summary.normalized_result).toMatchObject({
    artifact: { path: selected },
  });
  expect(summary.locations).toContainEqual({
    kind: "artifact-path",
    path: selected,
  });
  expect(ledger.get(complete.evidence_id)?.subject?.local_path).toBe(
    "/old/native.exe",
  );
  const historicalReply = await client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source: { kind: "retained-evidence", evidence_id: complete.evidence_id },
      view: { kind: "summary" },
    },
  });
  expect(historicalReply.isError).not.toBe(true);
  expect(
    parseEvidence(historicalReply.structuredContent).subject?.local_path,
  ).toBe("/old/native.exe");
});

it("defaults to a retained summary and strips delivery detail before the provider", async () => {
  const { client, ledger, execute } = await connect();
  const progress: number[] = [];
  const reply = await client.callTool(
    { name: "analyze_function", arguments: { procedure: "main" } },
    { onprogress: (update) => progress.push(update.progress) },
  );
  expect(progress.length).toBeGreaterThanOrEqual(2);
  progress.forEach((value, index) => {
    expect(value).toBeGreaterThan(progress[index - 1] ?? 0);
  });
  const evidence = parseEvidence(reply.structuredContent);
  expect(evidence.normalized_result).toMatchObject({
    kind: "summary",
    parent_operation: "analyze_function",
  });
  const parentId = (
    evidence.normalized_result as { parent_evidence_id: string }
  ).parent_evidence_id;
  // The complete dossier is retained in-session so the summary's parent can be paged.
  expect(ledger.has(parentId)).toBe(true);
  // Delivery detail never crosses into the provider request.
  const providerParameters = execute.mock.calls[0]?.[1] ?? {};
  expect(providerParameters).not.toHaveProperty("detail");
  expect(providerParameters).toMatchObject({ procedure: "main" });
  // Partial caller/callee discovery stays with the summary that reports their counts.
  expect(evidence.relationship_coverage).toEqual(partialCallees);
  expect(ledger.get(parentId)?.relationship_coverage).toEqual(partialCallees);
  // The summary envelope locates the function it describes.
  expect(evidence.locations).toEqual([
    { kind: "artifact-path", path: "/fixtures/native.exe" },
    { kind: "address", address: dossier.procedure.address },
  ]);
  // Optional records the fixture omits stay unknown rather than reading as empty.
  expect(evidence.normalized_result).toMatchObject({
    summary: {
      counts: { unresolved_calls: null, swift_string_literals: null },
    },
  });
});

it("keeps value-flow counts unknown in the default summary when the provider records none", async () => {
  // IDA and Kuna dossiers carry native_value_flow: null.
  const { client } = await connect(true, {
    ...dossier,
    native_value_flow: null,
  });
  const reply = await client.callTool({
    name: "analyze_function",
    arguments: { procedure: "main" },
  });
  const evidence = parseEvidence(reply.structuredContent);
  expect(evidence.normalized_result).toMatchObject({
    kind: "summary",
    summary: {
      value_flow: { available: false, truncated: false },
      counts: {
        value_flow_operations: null,
        value_flow_def_use: null,
        value_flow_effects: null,
        value_flow_parameters: null,
        value_flow_parameter_uses: null,
      },
    },
    unknowns: expect.arrayContaining(["native_value_flow was not recorded"]),
  });
});

it("composes inspect_native_api from a provider input without delivery detail", async () => {
  const { client, execute } = await connect();
  const reply = await client.callTool({
    name: "inspect_native_api",
    arguments: { procedure: "main" },
  });
  expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true);
  expect(
    parseEvidence(reply.structuredContent).normalized_result,
  ).toMatchObject({ procedure: { name: dossier.procedure.name } });
  expect(execute.mock.calls.map((call) => call[1])).toEqual([
    { procedure: "main" },
  ]);
});

it("returns the complete dossier inline when detail is complete", async () => {
  const { client } = await connect();
  const reply = await client.callTool({
    name: "analyze_function",
    arguments: { procedure: "main", detail: "complete" },
  });
  const evidence = parseEvidence(reply.structuredContent);
  expect(evidence.normalized_result).toMatchObject({
    pseudocode: dossier.pseudocode,
  });
  expect(evidence.normalized_result).toHaveProperty("native_value_flow");
});

it("rejects a summary request before analysis when the server retains no Evidence", async () => {
  const { client, execute } = await connect(false);
  const reply = await client.callTool({
    name: "analyze_function",
    arguments: { procedure: "main" },
  });
  expect(reply.isError).toBe(true);
  expect(execute).not.toHaveBeenCalled();
});
