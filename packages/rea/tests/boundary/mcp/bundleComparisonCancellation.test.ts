import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";

import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import {
  createEvidenceBundle,
  serializeEvidenceBundle,
} from "../../../src/domain/evidenceBundle.js";
import { createServer } from "../../../src/server/createServer.js";
import { ToolResultDelivery } from "../../../src/server/ToolResultDelivery.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { holdFirstFileRead } from "../../support/holdFirstFileRead.js";

it("leaves the session unchanged after bundle comparison cancellation and permits a retry", async () => {
  const root = await createTestTempDirectory("rea-mcp-compare-cancel-");
  const leftPath = join(root, "left.json");
  const rightPath = join(root, "right.json");
  const provider = { id: "fixture", name: "Fixture", version: "1" };
  const left = createEvidence(undefined, provider, {
    operation: "observation",
    parameters: { side: "left" },
    result: { side: "left" },
  });
  const right = createEvidence(undefined, provider, {
    operation: "observation",
    parameters: { side: "right" },
    result: { side: "right" },
  });
  const leftContents =
    " ".repeat(8 * 1024 * 1024) +
    serializeEvidenceBundle(createEvidenceBundle([left]));
  await Promise.all([
    // Just over the native-parse budget, without a large JSON tree.
    writeFile(leftPath, leftContents),
    writeFile(
      rightPath,
      serializeEvidenceBundle(createEvidenceBundle([right])),
    ),
  ]);

  const session = createTestBinarySession(() => {
    throw new Error("Bundle comparison must not start a binary provider");
  });
  const existing = createEvidence(undefined, provider, {
    operation: "existing_observation",
    parameters: {},
    result: { retained: true },
  });
  const recorded = session.recordEvidence(existing);
  if (!recorded.ok) throw recorded.error;
  const before = session.exportEvidenceBundle();
  const server = createServer({ kind: "session", session });
  const client = new Client({
    name: "bundle-comparison-cancellation",
    version: "1",
  });
  const controller = new AbortController();
  let releaseRead: (() => void) | undefined;
  onTestFinished(async () => {
    controller.abort();
    releaseRead?.();
    vi.restoreAllMocks();
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const reader = await holdFirstFileRead(leftPath);
  releaseRead = reader.release;

  let resolveDispatched: (() => void) | undefined;
  const dispatched = new Promise<void>((resolve) => {
    resolveDispatched = resolve;
  });
  const send = clientTransport.send.bind(clientTransport);
  vi.spyOn(clientTransport, "send").mockImplementation(
    async (message, ...args) => {
      await send(message, ...args);
      if ("method" in message && message.method === "tools/call")
        resolveDispatched?.();
    },
  );
  let resolveCompleted: (() => void) | undefined;
  const completed = new Promise<void>((resolve) => {
    resolveCompleted = resolve;
  });
  let settledResult: unknown;
  const deliver = ToolResultDelivery.prototype.toCallToolResult;
  vi.spyOn(ToolResultDelivery.prototype, "toCallToolResult").mockImplementation(
    function (this: ToolResultDelivery, result, contract) {
      const reply = deliver.call(this, result, contract);
      if (contract.name === "compare_bundles") {
        settledResult = result;
        resolveCompleted?.();
      }
      return reply;
    },
  );

  const args = {
    left_bundle_path: leftPath,
    right_bundle_path: rightPath,
    record_pairs: [
      {
        left_evidence_id: left.evidence_id,
        right_evidence_id: right.evidence_id,
      },
    ],
  };
  const cancellation = client
    .callTool(
      { name: "compare_bundles", arguments: args },
      { signal: controller.signal },
    )
    .then(
      () => "completed",
      (error: unknown) => error,
    );
  await dispatched;
  await reader.firstRead;
  await client.ping();
  controller.abort(new Error("SDK bundle comparison cancellation"));
  reader.release();
  expect(await cancellation).toMatchObject({
    message: expect.stringContaining("SDK bundle comparison cancellation"),
  });
  // Wait for the handler's delivered Result as well as the client's rejection.
  await completed;
  expect(settledResult).toMatchObject({
    ok: false,
    error: expect.any(AnalysisCancelledError),
  });
  expect(reader.readCount).toBe(1);
  expect(reader.totalReadBytes).toBeLessThan(leftContents.length);
  expect(session.exportEvidenceBundle()).toEqual(before);

  await client.ping();
  const retry = await client.callTool({
    name: "compare_bundles",
    arguments: args,
  });
  expect(retry.isError, JSON.stringify(retry)).not.toBe(true);
  expect(retry.structuredContent).toMatchObject({
    normalized_result: { status: "changed" },
  });
  const after = session.exportEvidenceBundle();
  expect(after.unknowns).toEqual(before.unknowns);
  expect(after.records).toEqual(
    expect.arrayContaining([
      ...before.records,
      left,
      right,
      expect.objectContaining({
        operation: "compare_bundles",
        evidence_links: [left.evidence_id, right.evidence_id],
      }),
    ]),
  );
});
