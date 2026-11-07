import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, onTestFinished } from "vitest";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { ok } from "../../../src/domain/result.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import {
  nativeDolLoadImageFixture,
  nativeRawLoadImageFixture,
} from "../../fixtures/nativeLoadImage.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";

it("preserves raw and DOL verification facts and selected DOL sections through the advertised SDK output", async () => {
  const { call } = await connectLocalToolsMcp();
  for (const { report, format } of [
    { report: nativeRawLoadImageFixture(), format: "raw-binary" },
    { report: nativeDolLoadImageFixture(), format: "gamecube-dol" },
  ] as const) {
    expect(report.format).toBe(format);
    const parent = createEvidence(
      {
        path: "/selected/fixture",
        sha256: report.target_sha256,
        format: report.format,
        architecture: report.architecture,
      },
      { id: "ghidra", name: "Ghidra", version: "12.1.4" },
      {
        operation: "inspect_native_load_image",
        parameters: {},
        result: report,
      },
    );
    const source = { kind: "inline", evidence: parent };
    const summary = await call("inspect_analysis_view", {
      source,
      view: { kind: "summary" },
    });
    expect(summary.isError, JSON.stringify(summary.content)).not.toBe(true);
    const result = analysisViewResultSchema.parse(
      parseEvidence(summary.structuredContent).normalized_result,
    );
    const {
      observations: _observations,
      checks,
      limitations: _limitations,
      ...verification
    } = report;
    if ("sections" in verification)
      Reflect.deleteProperty(verification, "sections");
    expect(result).toMatchObject({
      summary: {
        verification,
        counts: {
          checks: checks.length,
          sections: format === "gamecube-dol" ? 2 : null,
        },
      },
    });
    if (format !== "gamecube-dol") continue;
    const page = await call("inspect_analysis_view", {
      source,
      view: {
        kind: "native-load-image",
        collection: "sections",
        indices: [1, 0, 1],
        offset: 1,
        limit: 1,
        fields: ["kind", "address"],
      },
    });
    expect(page.isError, JSON.stringify(page.content)).not.toBe(true);
    const section = analysisViewResultSchema.parse(
      parseEvidence(page.structuredContent).normalized_result,
    );
    if (section.kind !== "native-load-image") throw new Error("Expected page");
    expect(section.items.rows).toEqual([
      {
        source_index: 1,
        record: { kind: "data", address: "ram:0x80004000" },
      },
    ]);
    expect(section).toMatchObject({
      verification_status: "mismatch",
      parent_evidence_id: parent.evidence_id,
      items: {
        collection: "sections",
        rows: [
          {
            source_index: 1,
            record: { kind: "data", address: "ram:0x80004000" },
          },
        ],
      },
      coverage: { total: 2, next_offset: null, exhausted: true },
      limitations: expect.arrayContaining(report.limitations),
    });
  }
}, 30_000);

it("delivers load-image summaries from the complete retained public-tool observation", async () => {
  const report = nativeRawLoadImageFixture();
  const inputs: unknown[] = [];
  const session = createTestBinarySession(() => ({
    execute: async (operation, parameters) => {
      if (operation === "inspect_native_load_image") inputs.push(parameters);
      return ok(
        createAnalysisExecution(operation === "health" ? null : report, {
          id: "fixture",
          name: "Fixture",
          version: "1",
        }),
      );
    },
    close: async () => ok(null),
  }));
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "load-image-summary", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const opened = await client.callTool({
    name: "open_binary",
    arguments: { path: process.execPath },
  });
  expect(opened.isError, JSON.stringify(opened.content)).not.toBe(true);
  const contract = toolContract("inspect_native_load_image");
  const completeReply = await client.callTool({
    name: contract.name,
    arguments: {},
  });
  expect(completeReply.isError, JSON.stringify(completeReply.content)).not.toBe(
    true,
  );
  const complete = parseEvidence(
    contract.outputSchema.parse(completeReply.structuredContent),
  );
  const summaryReply = await client.callTool({
    name: contract.name,
    arguments: { detail: "summary" },
  });
  expect(summaryReply.isError, JSON.stringify(summaryReply.content)).not.toBe(
    true,
  );
  const summary = parseEvidence(
    contract.outputSchema.parse(summaryReply.structuredContent),
  );
  expect(complete.parameters).toEqual({});
  expect(complete.normalized_result).toEqual(report);
  expect(summary.normalized_result).toMatchObject({
    kind: "summary",
    parent_operation: contract.name,
    parent_evidence_id: complete.evidence_id,
    source_parameters: {},
  });
  expect(session.evidenceById(complete.evidence_id)).toEqual(complete);
  expect(inputs.length).toBeGreaterThan(0);
  expect(inputs).not.toContainEqual(
    expect.objectContaining({ detail: expect.anything() }),
  );
});
