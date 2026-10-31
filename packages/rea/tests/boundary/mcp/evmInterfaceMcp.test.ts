import {
  advertisedMcpToolSchemas,
  assertRecordedMcpEvidence,
} from "../../fixtures/advertisedMcpTool.js";
import { createHash } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it, onTestFinished, vi } from "vitest";
import { EvmInterfaceService } from "../../../src/application/evm/EvmInterfaceService.js";
import { WasmArtifactService } from "../../../src/application/wasm/WasmArtifactService.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
} from "../../../src/domain/analysisErrorCore.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { evmInterfaceSummaryViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import { inspectSolidityMetadata } from "../../../src/evm/SolidityMetadata.js";
import { err, ok } from "../../../src/domain/result.js";
import { silentLogger } from "../../../src/logger.js";
import { createServer } from "../../../src/server/createServer.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { registerEvmTools } from "../../../src/server/registerEvmTools.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";
import { ownArtifactSession } from "../../support/mcp/artifactSession.js";
import {
  createDeferred,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { wasmArtifactExecution } from "../../fixtures/wasm/artifact.js";
import {
  evmInterfaceFixture,
  evmInterfaceExecution,
} from "../../fixtures/evm/interface.js";

const decodedMetadataFixture = () => {
  const bytes = Buffer.from("00a1011bffffffffffffffff000b", "hex");
  const value = evmInterfaceFixture();
  value.bytecode = {
    ...value.bytecode,
    hex: bytes.toString("hex"),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    metadata: inspectSolidityMetadata(bytes),
  };
  return value;
};

mcpTest(
  "preserves shared EVM detail guidance and defaults through full SDK discovery",
  async ({ mcp }) => {
    const inspect = vi.fn(async () => {
      throw new Error("Discovery must not invoke the provider");
    });
    const server = new EvidenceMcpServer(
      { name: "evm-detail", version: "1" },
      {},
      undefined,
      createToolResultDelivery(undefined),
    );
    registerEvmTools(
      server,
      new EvmInterfaceService({ inspect }),
      silentLogger,
    );
    const client = await mcp.connect(server, {
      name: "evm-detail",
      version: "1",
    });
    const { inputSchema } = await advertisedMcpToolSchemas(
      client,
      "inspect_evm_interface",
    );
    expect(inputSchema).toHaveProperty(["properties", "detail"], {
      type: "string",
      enum: ["complete", "summary"],
      default: "complete",
      description: expect.stringContaining(
        "summary retains that complete Evidence",
      ),
    });
    expect(inspect).not.toHaveBeenCalled();
  },
);

mcpTest(
  "advertises exact valid schemas and records inline EVM interface evidence without a binary target",
  async ({ mcp, onTestFinished }) => {
    const value = decodedMetadataFixture();
    const inspect = vi.fn(() =>
      Promise.resolve(ok(evmInterfaceExecution(value))),
    );
    const service = new EvmInterfaceService({
      inspect,
    });
    const session = createTestBinarySession(() => {
      throw new Error("deep provider must not start");
    });
    const server = createServer(
      { kind: "session", session },
      { evmInterface: service },
    );
    ownArtifactSession(session, onTestFinished);
    const client = await mcp.connect(server, {
      name: "evm-interface-contract",
      version: "1",
    });
    const schemas = await advertisedMcpToolSchemas(
      client,
      "inspect_evm_interface",
    );
    const { ajv, inputSchema } = schemas;
    expect(
      ajv.validate(inputSchema, { path: value.artifact.path, encoding: "hex" }),
    ).toBe(true);
    expect(
      ajv.validate(inputSchema, {
        path: value.artifact.path,
        encoding: "hex",
        approval: true,
      }),
    ).toBe(false);
    expect(() => registerEvmTools(server, service, silentLogger)).toThrow(
      /inspect_evm_interface.*already registered/,
    );
    expect(inspect).not.toHaveBeenCalled();
    expect(
      (await client.listTools()).tools.filter(
        (tool) => tool.name === "inspect_evm_interface",
      ),
    ).toHaveLength(1);
    const response = await client.callTool({
      name: "inspect_evm_interface",
      arguments: { path: value.artifact.path, encoding: "hex" },
    });
    assertRecordedMcpEvidence(
      response,
      "inspect_evm_interface",
      schemas,
      session,
      value,
      "inferred",
    );
    expect(
      (
        await client.callTool({
          name: "inspect_evm_interface",
          arguments: { path: "relative.hex", encoding: "hex" },
        })
      ).isError,
    ).toBe(true);
  },
);

it("rejects an EVM provider response with a non-file subject before recording Evidence", async () => {
  const value = evmInterfaceFixture();
  const execution = evmInterfaceExecution(value);
  const malformed = {
    ...execution,
    subject: { ...execution.subject, format: "elf" },
  } as unknown as typeof execution;
  const harness = await createApplicationMcpHarness({
    serverOptions: {
      evmInterface: new EvmInterfaceService({
        inspect: () => Promise.resolve(ok(malformed)),
      }),
    },
  });
  onTestFinished(harness.close);
  const before = harness.session.exportEvidenceBundle().records.length;
  const response = await harness.client.callTool({
    name: "inspect_evm_interface",
    arguments: { path: value.artifact.path, encoding: "hex" },
  });
  expect(parseMcpToolError(response).error.code).toBe("unreadable_output");
  expect(harness.session.exportEvidenceBundle().records).toHaveLength(before);
});

it.each(["unavailable", "incompatible-output"])(
  "preserves a healthy WASM peer and explicit EVM failure: %s",
  async (scenario) => {
    const value = evmInterfaceFixture();
    const inspect = vi.fn(() =>
      Promise.resolve(
        scenario === "unavailable"
          ? err(
              new AnalysisCapabilityUnavailableError(
                "fixture-evm",
                "inspect_evm_interface",
                "selected engine unavailable",
              ),
            )
          : ok(
              evmInterfaceExecution({
                ...value,
                artifact: { ...value.artifact, encoding: "raw" },
              }),
            ),
      ),
    );
    const harness = await createApplicationMcpHarness({
      serverOptions: {
        evmInterface: new EvmInterfaceService({ inspect }),
        wasmArtifact: new WasmArtifactService({
          close: () => Promise.resolve(),
          inspect: () => Promise.resolve(ok(wasmArtifactExecution())),
        }),
      },
    });
    onTestFinished(harness.close);
    const invalid = await harness.client.callTool({
      name: "inspect_evm_interface",
      arguments: { path: value.artifact.path, encoding: "hex", approval: true },
    });
    expect(invalid.isError).toBe(true);
    expect(inspect).not.toHaveBeenCalled();
    const failure = await harness.client.callTool({
      name: "inspect_evm_interface",
      arguments: { path: value.artifact.path, encoding: "hex" },
    });
    expect(parseMcpToolError(failure).error.code).toBe(
      scenario === "unavailable"
        ? "capability_unavailable"
        : "unreadable_output",
    );
    const peer = await harness.client.callTool({
      name: "inspect_wasm_artifact",
      arguments: { path: "/artifacts/module.wasm" },
    });
    expect(peer.isError).not.toBe(true);
    const parsed = toolContract("inspect_wasm_artifact").outputSchema.parse(
      peer.structuredContent,
    );
    const evidence = parseEvidence(parsed);
    expect(harness.session.evidenceById(evidence.evidence_id)).toEqual(
      evidence,
    );
    await harness.client.ping();
  },
);

mcpTest(
  "retains the injected EVM owner and retries failed cleanup on server shutdown",
  async ({ mcp, onTestFinished }) => {
    const close = vi
      .fn()
      .mockRejectedValueOnce(new Error("retained EVM worker"))
      .mockResolvedValue(undefined);
    const service = new EvmInterfaceService({
      close,
      inspect: () => Promise.resolve(ok(evmInterfaceExecution())),
    });
    const session = createTestBinarySession(() => {
      throw new Error("deep provider must not start");
    });
    const server = createServer(
      { kind: "session", session },
      { evmInterface: service },
    );
    ownArtifactSession(session, onTestFinished);
    const client = await mcp.connect(server, {
      name: "evm-cleanup-retry",
      version: "1",
    });
    const response = await client.callTool({
      name: "inspect_evm_interface",
      arguments: { path: "/artifacts/source-owned.hex", encoding: "hex" },
    });
    expect(response.isError).not.toBe(true);
    await expect(server.close()).rejects.toThrow("REA session cleanup failed");
    await server.close();
    expect(close).toHaveBeenCalledTimes(2);
  },
);

it("settles the admitted EVM operation after SDK cancellation and accepts a subsequent request", async () => {
  const entered = createDeferred<void>();
  const stopped = createDeferred<void>();
  let invocations = 0;
  const harness = await createApplicationMcpHarness({
    serverOptions: {
      evmInterface: new EvmInterfaceService({
        inspect: async (_input, options) => {
          if (invocations++ > 0) return ok(evmInterfaceExecution());
          const signal = options?.signal;
          if (signal === undefined)
            throw new Error("MCP request omitted cancellation signal");
          const aborted = new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else
              signal.addEventListener("abort", () => resolve(), { once: true });
          });
          entered.resolve();
          await aborted;
          stopped.resolve();
          return err(new AnalysisCancelledError("inspect_evm_interface"));
        },
      }),
    },
  });
  onTestFinished(harness.close);
  const controller = new AbortController();
  const input = {
    name: "inspect_evm_interface",
    arguments: { path: "/artifacts/source-owned.hex", encoding: "hex" },
  };
  const cancellation = harness.client
    .callTool(input, { signal: controller.signal })
    .then(
      () => "completed",
      (error: unknown) => error,
    );
  await entered.promise;
  controller.abort(new Error("SDK EVM cancellation verification"));
  expect(await cancellation).toMatchObject({
    message: expect.stringContaining("SDK EVM cancellation verification"),
    code: "REQUEST_TIMEOUT",
  });
  await stopped.promise;
  await harness.client.ping();
  expect((await harness.client.callTool(input)).isError).not.toBe(true);
  expect(invocations).toBe(2);
});

it("returns the exact inferred interface summary while preserving complete defaults and retained source", async () => {
  const value = decodedMetadataFixture();
  expect(value.bytecode.metadata?.status).toBe("decoded");
  value.functions = [
    {
      selector: "0x11223344",
      bytecode_offset: 0,
      dispatch: "abi",
      inferred_arguments: null,
      inferred_state_mutability: null,
    },
    {
      selector: "0xaabbccdd",
      bytecode_offset: 4,
      dispatch: "fallback",
      inferred_arguments: "uint256",
      inferred_state_mutability: "view",
    },
  ];
  value.diagnostics = {
    stdout: "exact producer JSON\n",
    stderr: "source warning\n",
    truncated: false,
  };
  const inspect = vi.fn(() =>
    Promise.resolve(ok(evmInterfaceExecution(value))),
  );
  const harness = await createApplicationMcpHarness({
    serverOptions: { evmInterface: new EvmInterfaceService({ inspect }) },
  });
  onTestFinished(harness.close);
  const definition = (await harness.client.listTools()).tools.find(
    (tool) => tool.name === "inspect_evm_interface",
  );
  if (definition?.outputSchema === undefined)
    throw new Error("Missing EVM output schema");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const inputSchema: Record<string, unknown> = definition.inputSchema;
  const outputSchema: Record<string, unknown> = definition.outputSchema;
  expect(ajv.validateSchema(inputSchema)).toBe(true);
  expect(ajv.validateSchema(outputSchema)).toBe(true);
  const input = { path: value.artifact.path, encoding: "hex" };
  let original;
  for (const detail of [undefined, "complete"] as const) {
    const response = await harness.client.callTool({
      name: "inspect_evm_interface",
      arguments: { ...input, ...(detail ? { detail } : {}) },
    });
    expect(response.isError).not.toBe(true);
    expect(
      ajv.validate(outputSchema, response.structuredContent),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    const evidence = parseEvidence(response.structuredContent);
    expect(evidence.normalized_result).toEqual(value);
    expect(evidence.parameters).toEqual(input);
    original = evidence;
  }
  if (original === undefined) throw new Error("No complete control");
  const response = await harness.client.callTool({
    name: "inspect_evm_interface",
    arguments: { ...input, detail: "summary" },
  });
  expect(response.isError).not.toBe(true);
  expect(
    ajv.validate(outputSchema, response.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const derived = parseEvidence(response.structuredContent);
  const view = evmInterfaceSummaryViewResultSchema.parse(
    derived.normalized_result,
  );
  expect(derived.evidence_id).not.toBe(original.evidence_id);
  expect(derived.evidence_links).toEqual([original.evidence_id]);
  // Retention and paging do not make inferred candidates more certain.
  expect(original.confidence).toBe("inferred");
  expect(derived.confidence).toBe("inferred");
  const { hex: _hex, ...bytecode } = value.bytecode;
  expect(view).toMatchObject({
    parent_operation: "inspect_evm_interface",
    parent_evidence_id: original.evidence_id,
    summary: {
      artifact: value.artifact,
      bytecode,
      functions: value.functions,
      evidence_kind: "inferred",
      discovery_completeness: "unknown",
      runtime_execution: "not-performed",
      limitations: value.limitations,
      diagnostics: {
        stderr: value.diagnostics.stderr,
        stdout_code_units: value.diagnostics.stdout.length,
      },
    },
    coverage: { examined: 2, total: 2, exhausted: true },
  });
  expect(view.summary.bytecode).not.toHaveProperty("hex");
  expect(view.summary.diagnostics).not.toHaveProperty("stdout");
  expect(harness.session.evidenceById(original.evidence_id)).toEqual(original);
  for (const [facet, offset, limit, item] of [
    ["functions", 1, 1, [value.functions[1]]],
    [
      "bytecode_hex",
      2,
      4,
      { text: value.bytecode.hex.slice(2, 6), unit: "utf16-code-units" },
    ],
    [
      "stdout",
      0,
      128,
      { text: value.diagnostics.stdout, unit: "utf16-code-units" },
    ],
  ] as const) {
    const selected = await harness.client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source: {
          kind: "retained-evidence",
          evidence_id: original.evidence_id,
        },
        view: { kind: "evm", facet, offset, limit },
      },
    });
    expect(selected.isError).not.toBe(true);
    const parsed = toolContract("inspect_analysis_view").outputSchema.parse(
      selected.structuredContent,
    );
    expect(parsed.normalized_result).toMatchObject({
      parent_evidence_id: original.evidence_id,
      item,
    });
  }
  expect(inspect).toHaveBeenCalledTimes(3);
  for (const call of inspect.mock.calls)
    expect(call).toEqual([input, expect.any(Object)]);
  expect(harness.session.evidenceById(original.evidence_id)).toEqual(original);
});

it.each(["valid", "wrong-subject", "no-subject"])(
  "preserves historical portable EVM Evidence and rejects incompatible identity: %s",
  async (scenario) => {
    const value = evmInterfaceFixture();
    const { metadata: _metadata, ...historicalBytecode } = value.bytecode;
    const source = createEvidence(
      scenario === "no-subject"
        ? undefined
        : {
            path: value.artifact.path,
            sha256:
              scenario === "wrong-subject"
                ? "b".repeat(64)
                : value.artifact.sha256,
            format: "file",
          },
      { id: "historical-evm", name: "Original EVM producer", version: "1" },
      {
        operation: "inspect_evm_interface",
        parameters: { path: value.artifact.path, encoding: "hex" },
        result: { ...value, bytecode: historicalBytecode },
        confidence: "inferred",
        rawResult: { original: true },
      },
    );
    const before = JSON.stringify(source);
    const inspect = vi.fn(() => {
      throw new Error("portable read must not rerun provider");
    });
    const harness = await createApplicationMcpHarness({
      serverOptions: { evmInterface: new EvmInterfaceService({ inspect }) },
    });
    onTestFinished(harness.close);
    const response = await harness.client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source: { kind: "inline", evidence: source },
        view: { kind: "summary" },
      },
    });
    if (scenario === "valid") {
      expect(response.isError).not.toBe(true);
      const derived = parseEvidence(response.structuredContent);
      const view = evmInterfaceSummaryViewResultSchema.parse(
        derived.normalized_result,
      );
      expect(view.parent_evidence_id).toBe(source.evidence_id);
      expect(view.summary.functions).toEqual([]);
      expect(view.summary.discovery_completeness).toBe("unknown");
      expect(view.summary.bytecode.metadata).toBeNull();
      expect(view.coverage).toMatchObject({
        total: 0,
        examined: 0,
        exhausted: true,
      });
      expect(derived.evidence_links).toEqual([source.evidence_id]);
      expect(derived.confidence).toBe("inferred");
    } else
      expect(parseMcpToolError(response).error.code).toBe("invalid_request");
    expect(inspect).not.toHaveBeenCalled();
    expect(JSON.stringify(source)).toBe(before);
  },
);

mcpTest(
  "rejects summary before provider work when retention is unavailable and preserves complete delivery",
  async ({ mcp, onTestFinished }) => {
    const value = evmInterfaceFixture();
    const inspect = vi.fn(() =>
      Promise.resolve(ok(evmInterfaceExecution(value))),
    );
    const session = createTestBinarySession(() => {
      throw new Error("deep provider must not start");
    });
    const server = createServer(
      { kind: "fixed", analysis: session },
      { evmInterface: new EvmInterfaceService({ inspect }) },
    );
    ownArtifactSession(session, onTestFinished);
    const client = await mcp.connect(server, {
      name: "evm-fixed-delivery",
      version: "1",
    });
    const summary = await client.callTool({
      name: "inspect_evm_interface",
      arguments: {
        path: value.artifact.path,
        encoding: "hex",
        detail: "summary",
      },
    });
    expect(parseMcpToolError(summary).error.code).toBe(
      "capability_unavailable",
    );
    expect(inspect).not.toHaveBeenCalled();
    const complete = await client.callTool({
      name: "inspect_evm_interface",
      arguments: { path: value.artifact.path, encoding: "hex" },
    });
    expect(complete.isError).not.toBe(true);
    expect(parseEvidence(complete.structuredContent).normalized_result).toEqual(
      value,
    );
  },
);
