import { createHash, randomBytes } from "node:crypto";
import { open, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { byteEntropySchema } from "../../../src/domain/native/byteEntropy.js";
import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";
import { TOOL_EFFECTS } from "../../../src/contracts/toolEffects.js";
import {
  advertisedMcpToolSchemas,
  assertRecordedMcpEvidence,
} from "../../fixtures/advertisedMcpTool.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, onTestFinished } from "vitest";
import { BinaryLayoutService } from "../../../src/application/binaryDiagnostics/BinaryLayoutService.js";
import { ByteEntropyService } from "../../../src/application/binaryDiagnostics/ByteEntropyService.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { ok } from "../../../src/domain/result.js";
import { createServer } from "../../../src/server/createServer.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { registerByteEntropyTool } from "../../../src/server/registerByteEntropyTool.js";
import { registerAnalysisViewTool } from "../../../src/server/registerAnalysisViewTool.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { withAdmittedAnalysis } from "../../../src/server/analysisAdmission.js";
import { silentLogger } from "../../../src/logger.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import {
  binaryLayoutFixture,
  BINARY_LAYOUT_TEST_PROVIDER,
} from "../../fixtures/binaryDiagnostics/layout.js";
import { elfExportImage } from "../../fixtures/binaryDiagnostics/nativeExports.js";
import { parseNativeExports } from "../../../src/native/exports/NativeExportParser.js";
import { createNativeExportsService } from "../../../src/composition/binaryDiagnostics.js";
import { registerNativeExportsTool } from "../../../src/server/registerNativeExportsTool.js";

it.each(["inspect_native_exports", "inspect_byte_entropy"] as const)(
  "refuses %s summary before file admission when retention is unavailable",
  async (name) => {
    const service =
      name === "inspect_native_exports"
        ? createNativeExportsService()
        : new ByteEntropyService();
    const server = new EvidenceMcpServer(
      { name: "exports-preflight", version: "1" },
      {},
      undefined,
      createToolResultDelivery(undefined),
    );
    if (service instanceof ByteEntropyService)
      registerByteEntropyTool(
        server,
        service,
        silentLogger,
        undefined,
        undefined,
        undefined,
      );
    else registerNativeExportsTool(server, service, silentLogger);
    const client = new Client({
      name: "exports-preflight-client",
      version: "1",
    });
    onTestFinished(async () => {
      await client.close();
      await server.close();
      await service.close();
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const schemas = await advertisedMcpToolSchemas(client, name);
    expect(
      schemas.ajv.validate(schemas.inputSchema, {
        path: "/absent/native-library.so",
        detail: "summary",
      }),
    ).toBe(true);
    const refused = await client.callTool({
      name,
      arguments: { path: "/absent/native-library.so", detail: "summary" },
    });
    expect(parseMcpToolError(refused).error).toMatchObject({
      code: "capability_unavailable",
    });
    const complete = await client.callTool({
      name,
      arguments: { path: "/absent/native-library.so" },
    });
    expect(parseMcpToolError(complete).error.code).toBe("invalid_request");
  },
);

it.each([false, true])(
  "preserves a completed byte report through MCP cleanup failure and retry (retained=%s)",
  async (retained) => {
    const root = await createTestTempDirectory("rea-entropy-mcp-cleanup-");
    const path = join(root, "bytes.bin");
    const bytes = Buffer.alloc(512);
    await writeFile(path, bytes);
    let failClose = true;
    let closes = 0;
    const service = new ByteEntropyService({
      stat,
      open: async (...args) => {
        const file = await open(...args);
        const close = file.close.bind(file);
        file.close = async () => {
          closes++;
          if (failClose) throw new Error("injected descriptor close failure");
          await close();
        };
        return file;
      },
    });
    const session = createTestBinarySession(() => {
      throw new Error("deep provider must not start");
    });
    const recordEvidence = retained
      ? (evidence: Evidence) => session.recordEvidence(evidence)
      : undefined;
    const evidenceById = (id: string) => session.evidenceById(id);
    const admission = withAdmittedAnalysis({ kind: "session", session });
    const server = new EvidenceMcpServer(
      { name: "entropy-cleanup", version: "1" },
      {},
      recordEvidence,
      createToolResultDelivery(undefined),
    );
    registerByteEntropyTool(
      server,
      service,
      silentLogger,
      recordEvidence,
      evidenceById,
      admission,
    );
    registerAnalysisViewTool(
      server,
      silentLogger,
      evidenceById,
      recordEvidence,
      admission,
    );
    const client = new Client({ name: "entropy-cleanup-client", version: "1" });
    onTestFinished(async () => {
      failClose = false;
      try {
        await service.close();
      } finally {
        await client.close();
        await server.close();
        await session.close();
      }
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const response = await client.callTool({
      name: "inspect_byte_entropy",
      arguments: { path, block_size: 256 },
    });
    const failure = parseMcpToolError(response).error;
    expect(failure).toMatchObject({
      code: "cleanup_incomplete",
      retryable: false,
      details: { cleanup: "incomplete" },
    });
    expect(closes).toBe(1);
    const partial = failure.details?.partial_observation;
    let evidence;
    if (retained) {
      expect(partial).toEqual({
        kind: "retained-evidence",
        evidence_id: expect.any(String),
      });
      const reference = partial as { evidence_id: string };
      evidence = parseEvidence(evidenceById(reference.evidence_id));
      const viewed = await client.callTool({
        name: "inspect_analysis_view",
        arguments: { source: partial, view: { kind: "summary" } },
      });
      expect(viewed.isError).not.toBe(true);
      expect(
        parseEvidence(viewed.structuredContent).normalized_result,
      ).toMatchObject({
        kind: "summary",
        parent_evidence_id: evidence.evidence_id,
      });
      expect(closes).toBe(1);
    } else {
      evidence = parseEvidence(partial);
      expect(evidenceById(evidence.evidence_id)).toBeUndefined();
    }
    expect(evidence.operation).toBe("inspect_byte_entropy");
    expect(byteEntropySchema.parse(evidence.normalized_result)).toMatchObject({
      artifact: {
        path,
        bytes: 512,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
      window: { offset: 0, length: 512 },
      file_entropy: 0,
      blocks: [
        { offset: 0, length: 256, entropy: 0 },
        { offset: 256, length: 256, entropy: 0 },
      ],
    });
    failClose = false;
    await service.close();
    expect(closes).toBe(2);
    if (retained) expect(evidenceById(evidence.evidence_id)).toEqual(evidence);
  },
);

it("records inline layout with compact schemas and canonical path checks", async () => {
  const value = binaryLayoutFixture();
  let providerClosed = false;
  let providerCalls = 0;
  const service = new BinaryLayoutService({
    inspectAndClose(input, options) {
      return this.inspect(input, options);
    },
    identity: BINARY_LAYOUT_TEST_PROVIDER,
    inspect: () => {
      providerCalls++;
      return Promise.resolve(ok(value));
    },
    close: async () => {
      providerClosed = true;
    },
  });
  const session = createTestBinarySession(() => {
    throw new Error("deep provider must not start");
  });
  const server = createServer(
    { kind: "session", session },
    { binaryLayout: service },
  );
  const client = new Client({ name: "binary-layout-contract", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await server.close();
    expect(providerClosed).toBe(true);
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const schemas = await advertisedMcpToolSchemas(
    client,
    "inspect_binary_layout",
  );
  const { ajv, inputSchema } = schemas;
  expect(ajv.validate(inputSchema, { path: value.artifact.path })).toBe(true);
  expect(
    ajv.validate(inputSchema, {
      path: value.artifact.path,
      approval: true,
    }),
  ).toBe(false);
  const response = await client.callTool({
    name: "inspect_binary_layout",
    arguments: { path: value.artifact.path },
  });
  const evidence = assertRecordedMcpEvidence(
    response,
    "inspect_binary_layout",
    schemas,
    session,
    value,
    "observed",
  );
  const viewed = await client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source: {
        kind: "retained-evidence",
        evidence_id: evidence.evidence_id,
      },
      view: { kind: "summary" },
    },
  });
  expect(viewed.isError).not.toBe(true);
  expect(
    toolContract("inspect_analysis_view").outputSchema.parse(
      viewed.structuredContent,
    ).normalized_result,
  ).toMatchObject({
    kind: "summary",
    parent_evidence_id: evidence.evidence_id,
    summary: { format: "elf", bytes: value.artifact.bytes },
  });
  const relative = await client.callTool({
    name: "inspect_binary_layout",
    arguments: { path: "relative.elf" },
  });
  expect(parseMcpToolError(relative).error.code).toBe("invalid_request");
  expect(providerCalls).toBe(1);
});

it("profiles real bytes with exact offsets, valid advertised schemas and read-only effects", async () => {
  const root = await createTestTempDirectory("rea-entropy-mcp-");
  const path = join(root, "firmware.bin");
  await writeFile(
    path,
    Buffer.concat([
      Buffer.alloc(4096),
      randomBytes(4096),
      Buffer.from("ordinary text ".repeat(400)),
    ]),
  );
  const session = createTestBinarySession(() => {
    throw new Error("No provider needed");
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "entropy-contract", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const { ajv, inputSchema, outputSchema } = await advertisedMcpToolSchemas(
    client,
    "inspect_byte_entropy",
  );
  expect(ajv.validate(inputSchema, { path, surprise: true })).toBe(false);
  const response = await client.callTool({
    name: "inspect_byte_entropy",
    arguments: { path },
  });
  expect(response.isError).not.toBe(true);
  expect(
    ajv.validate(outputSchema, response.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const evidence = parseEvidence(response.structuredContent);
  const report = byteEntropySchema.parse(evidence.normalized_result);
  expect(report.runs).toEqual([
    { offset: 0, length: 4096, classification: "low" },
    { offset: 4096, length: 4096, classification: "high" },
  ]);
  expect(
    report.blocks.map(({ offset, length }) => ({ offset, length })),
  ).toEqual([
    { offset: 0, length: 4096 },
    { offset: 4096, length: 4096 },
    { offset: 8192, length: 4096 },
    { offset: 12288, length: 1504 },
  ]);
  expect(session.evidenceById(evidence.evidence_id)).toEqual(evidence);
  expect(TOOL_EFFECTS.inspect_byte_entropy).toMatchObject({
    launchesProcess: false,
    writesFilesystem: false,
    accessesNetwork: false,
    mutatesTarget: false,
  });
  expect(
    (
      await client.callTool({
        name: "inspect_byte_entropy",
        arguments: { path, offset: 999999 },
      })
    ).isError,
  ).toBe(true);
});

it("records a portable export inventory through MCP without a binary target", async () => {
  const root = await createTestTempDirectory("rea-native-exports-mcp-");
  const path = join(root, "libfixture.so");
  const bytes = elfExportImage({
    symbols: [
      { name: "exported_fn" },
      { name: "hidden_fn", visibility: 2 },
      { name: "versioned_fn", version: 2 },
    ],
    versionDefinitions: ["libfixture.so", "libcafÃ©.so"],
  });
  await writeFile(path, bytes);
  const session = createTestBinarySession(() => {
    throw new Error("deep provider must not start");
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "native-exports-contract", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const schemas = await advertisedMcpToolSchemas(
    client,
    "inspect_native_exports",
  );
  expect(schemas.ajv.validate(schemas.inputSchema, { path })).toBe(true);
  const response = await client.callTool({
    name: "inspect_native_exports",
    arguments: { path },
  });
  expect(
    parseEvidence(response.structuredContent).normalized_result,
  ).toMatchObject({
    format: "elf",
    exports: [
      { name: "exported_fn", version: null },
      {
        name: "versioned_fn",
        version: {
          name: "libcafé.so",
          name_bytes_base64: "bGliY2Fmw6kuc28=",
          name_utf8_decodable: true,
        },
      },
    ],
  });
  assertRecordedMcpEvidence(
    response,
    "inspect_native_exports",
    schemas,
    session,
    parseNativeExports(bytes, {
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    }),
    "observed",
  );
  const relative = await client.callTool({
    name: "inspect_native_exports",
    arguments: { path: "relative.so" },
  });
  expect(parseMcpToolError(relative).error).toMatchObject({
    code: "invalid_request",
    details: { issues: [{ path: ["path"], reason: "invalid_format" }] },
  });
});
