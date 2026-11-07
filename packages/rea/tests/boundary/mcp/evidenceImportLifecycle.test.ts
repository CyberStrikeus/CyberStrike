import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";

import { createEvidence } from "../../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { createServer } from "../../../src/server/createServer.js";
import {
  createDeferred,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const connectImportSession = async () => {
  const root = await createTestTempDirectory("rea-mcp-import-lifecycle-");
  const session = createTestBinarySession(() => {
    throw new Error("Evidence import must not start a binary provider");
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({
    name: "evidence-import-lifecycle",
    version: "1",
  });
  const readCompleted = createDeferred<void>();
  const releaseRead = createDeferred<void>();
  const originalFileClose = OwnedFileHandle.prototype.close;
  vi.spyOn(OwnedFileHandle.prototype, "close").mockImplementationOnce(
    async function (this: OwnedFileHandle) {
      await originalFileClose.call(this);
      readCompleted.resolve();
      await releaseRead.promise;
    },
  );
  const closeStarted = createDeferred<void>();
  const originalSessionClose = session.close.bind(session);
  const events: string[] = [];
  vi.spyOn(session, "close").mockImplementation((...args) => {
    const closing = originalSessionClose(...args);
    closeStarted.resolve();
    return closing.then((result) => {
      events.push("close");
      return result;
    });
  });
  const originalImport = session.importEvidenceBundle.bind(session);
  vi.spyOn(session, "importEvidenceBundle").mockImplementation((bundle) => {
    const imported = originalImport(bundle);
    events.push("import");
    return imported;
  });
  onTestFinished(async () => {
    releaseRead.resolve();
    vi.restoreAllMocks();
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const laterImportDispatched = createDeferred<void>();
  let importsDispatched = 0;
  const send = clientTransport.send.bind(clientTransport);
  vi.spyOn(clientTransport, "send").mockImplementation(
    async (message, ...args) => {
      await send(message, ...args);
      if (
        "method" in message &&
        message.method === "tools/call" &&
        message.params?.name === "import_evidence_bundle"
      ) {
        importsDispatched += 1;
        if (importsDispatched === 2) laterImportDispatched.resolve();
      }
    },
  );
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const importBundle = async (operation: string) => {
    const record = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      { operation, parameters: {}, result: { retained: operation } },
    );
    const path = join(root, `${operation}.json`);
    await writeFile(path, JSON.stringify(createEvidenceBundle([record])));
    return client.callTool({
      name: "import_evidence_bundle",
      arguments: { path },
    });
  };
  return {
    client,
    session,
    events,
    importBundle,
    readCompleted: readCompleted.promise,
    closeStarted: closeStarted.promise,
    laterImportDispatched: laterImportDispatched.promise,
    releaseRead: () => releaseRead.resolve(),
  };
};

it("drains a file import before close_binary clears the session", async () => {
  const fixture = await connectImportSession();
  const importing = fixture.importBundle("before_close");
  await fixture.readCompleted;
  const closing = fixture.client.callTool({
    name: "close_binary",
    arguments: {},
  });
  await fixture.closeStarted;
  await fixture.client.ping();
  fixture.releaseRead();
  const [imported, closed] = await Promise.all([importing, closing]);

  expect(imported.isError, JSON.stringify(imported)).not.toBe(true);
  expect(imported.structuredContent).toMatchObject({
    result: { imported: 1, unknowns_added: 0, total: 1 },
  });
  expect(closed.isError, JSON.stringify(closed)).not.toBe(true);
  expect(fixture.events).toEqual(["import", "close"]);
  expect(fixture.session.exportEvidenceBundle().records).toEqual([]);
  await fixture.client.ping();
});

it("admits a later import after close_binary without retaining the earlier bundle", async () => {
  const fixture = await connectImportSession();
  const earlier = fixture.importBundle("before_close");
  await fixture.readCompleted;
  const closing = fixture.client.callTool({
    name: "close_binary",
    arguments: {},
  });
  await fixture.closeStarted;
  const later = fixture.importBundle("after_close");
  await fixture.laterImportDispatched;
  await fixture.client.ping();
  fixture.releaseRead();
  const results = await Promise.all([earlier, closing, later]);

  for (const result of results)
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect(results[2]?.structuredContent).toMatchObject({
    result: { imported: 1, unknowns_added: 0, total: 1 },
  });
  expect(fixture.events).toEqual(["import", "close", "import"]);
  expect(
    fixture.session
      .exportEvidenceBundle()
      .records.map((record) => record.operation),
  ).toEqual(["after_close"]);
  await fixture.client.ping();
});

it("reports newly committed Unknown revisions and counts a repeated import once", async () => {
  const root = await createTestTempDirectory("rea-mcp-import-counts-");
  const source = createTestBinarySession(() => {
    throw new Error("Evidence import must not start a binary provider");
  });
  const unknown = source.recordUnknown({
    question: "Does this artifact have an unresolved dependency?",
    severity: "medium",
    domain: "investigation",
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
    required_authority: "analyst-inference",
    required_confidence: "derived",
    required_environment: null,
    recommended_probes: [],
    relationships: [],
  });
  if (!unknown.ok) throw unknown.error;
  const bundle = source.exportEvidenceBundle();
  const path = join(root, "unknowns.json");
  await writeFile(path, JSON.stringify(bundle));
  const session = createTestBinarySession(() => {
    throw new Error("Evidence import must not start a binary provider");
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "import-counts", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await session.close();
    await source.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const first = await client.callTool({
    name: "import_evidence_bundle",
    arguments: { path },
  });
  expect(first.isError).not.toBe(true);
  expect(first.structuredContent).toEqual({
    result: {
      imported: bundle.records.length,
      unknowns_added: 1,
      total: bundle.records.length,
    },
  });
  const repeated = await client.callTool({
    name: "import_evidence_bundle",
    arguments: { path },
  });
  expect(repeated.isError).not.toBe(true);
  expect(repeated.structuredContent).toEqual({
    result: { imported: 0, unknowns_added: 0, total: bundle.records.length },
  });
});
