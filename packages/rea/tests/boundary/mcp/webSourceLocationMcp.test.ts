import { traceSourceMap } from "../../../src/javascript/sourceMaps/TraceSourceMap.js";
import { webSourceLocationArgs as args } from "../../fixtures/webSourceLocation.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { expect, it, onTestFinished, vi } from "vitest";
import { WebSourceLocationService } from "../../../src/application/WebSourceLocationService.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { ok } from "../../../src/domain/result.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { webSourceLocationFixture } from "../../fixtures/webSourceLocation.js";
import { SourceMapDecoder } from "../../../src/javascript/sourceMaps/SourceMapDecoder.js";
import { createSystemProcessOwnershipHost } from "../../../src/process/ProcessOwnershipObservation.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

it("publishes valid SDK schemas and records the named module trace without a binary target", async () => {
  const service = new WebSourceLocationService(
    {
      load: () => Promise.resolve(ok(webSourceLocationFixture())),
    },
    {
      trace: (input) =>
        Promise.resolve(
          ok(traceSourceMap(input.text, input.url, input.position)),
        ),
    },
  );
  const session = createTestBinarySession(() => {
    throw new Error("binary provider must not start");
  });
  const server = createServer(
    { kind: "session", session },
    { webSourceLocation: service },
  );
  const client = new Client({ name: "module-contract", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const advertised = (await client.listTools()).tools.find(
    (tool) => tool.name === "trace_web_source_location",
  );
  if (advertised?.outputSchema === undefined)
    throw new Error("module trace must advertise both schemas");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const inputSchema: Record<string, unknown> = advertised.inputSchema;
  const outputSchema: Record<string, unknown> = advertised.outputSchema;
  expect(ajv.validate(inputSchema, args)).toBe(true);
  const response = await client.callTool({
    name: "trace_web_source_location",
    arguments: args,
  });
  expect(response.isError).not.toBe(true);
  expect(
    ajv.validate(outputSchema, response.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const parsed = toolContract("trace_web_source_location").outputSchema.parse(
    response.structuredContent,
  );
  const evidence = parseEvidence(parsed);
  const data = webSourceLocationFixture();
  expect(evidence).toMatchObject({
    normalized_result: {
      source: { sha256: data.sourceFile.sha256 },
      source_map: {
        association: "caller-selected",
        sha256: data.sourceMap.file.sha256,
      },
      matches: [{ state: "mapped", content: { text: "original" } }],
      execution: "unknown",
      source_authenticity: "unknown",
    },
    raw_result: { source_map_text: data.sourceMap.text },
  });
  expect(session.evidenceById(evidence.evidence_id)).toEqual(evidence);
  const invalid = await client.callTool({
    name: "trace_web_source_location",
    arguments: { ...args, manifest_path: "relative.json" },
  });
  expect(parseMcpToolError(invalid).error).toMatchObject({
    code: "invalid_request",
    details: {
      issues: [{ path: ["manifest_path"], reason: "invalid_format" }],
    },
  });
});

it("preserves missing Linux ps capability and recovery through source-map tracing", async () => {
  const directory = await createTestTempDirectory("source-map-missing-ps-");
  const prepare = createSystemProcessOwnershipHost("linux", {
    PATH: directory,
  }).prepare;
  if (prepare === undefined)
    throw new Error("Ownership preparation is required");
  const createRuntime = vi.fn(async () => {
    throw new Error("Missing prerequisite must not acquire a runtime");
  });
  const launcher = vi.fn(async () => {
    throw new Error("Missing prerequisite must not launch a codec");
  });
  const decoder = new SourceMapDecoder({
    prepareOwnership: prepare,
    createRuntime,
    launcher,
  });
  const harness = await createApplicationMcpHarness({
    serverOptions: {
      webSourceLocation: new WebSourceLocationService(
        { load: async () => ok(webSourceLocationFixture()) },
        decoder,
      ),
    },
  });
  onTestFinished(() => harness.close());
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await harness.client.callTool({
      name: "trace_web_source_location",
      arguments: args,
    });
    const { error } = parseMcpToolError(response);
    expect(error).toMatchObject({
      code: "capability_unavailable",
      category: "unsupported_provider",
      retryable: false,
      message: expect.stringContaining("procps-compatible ps"),
      remediation: { action: expect.stringContaining("procps-compatible ps") },
      details: {
        provider_id: "process-ownership",
        operation: "prepare_owned_process",
        reason: expect.stringContaining("ENOENT"),
      },
    });
  }
  await harness.client.ping();
  expect(createRuntime).not.toHaveBeenCalled();
  expect(launcher).not.toHaveBeenCalled();
});
