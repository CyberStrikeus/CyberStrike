import {
  advertisedMcpToolSchemas,
  assertRecordedMcpEvidence,
} from "../../fixtures/advertisedMcpTool.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterAll, expect, it, onTestFinished, vi } from "vitest";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { WasmArtifactService } from "../../../src/application/wasm/WasmArtifactService.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { wasmArtifactSummaryViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createServer } from "../../../src/server/createServer.js";
import { err, ok } from "../../../src/domain/result.js";
import { AnalysisInputError } from "../../../src/domain/analysisErrorCore.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  wasmArtifactFixture,
  wasmArtifactExecution,
} from "../../fixtures/wasm/artifact.js";

const schemaValidation = createMcpSchemaValidation();
afterAll(() => schemaValidation.clear());

const assertFirstSummaryDelivery = async (
  harness: Awaited<ReturnType<typeof createApplicationMcpHarness>>,
  value: ReturnType<typeof wasmArtifactFixture>,
  inspect: WasmArtifactService["provider"]["inspect"],
) => {
  const {
    ajv: wasmAjv,
    inputSchema,
    outputSchema,
  } = await advertisedMcpToolSchemas(
    harness.client,
    "inspect_wasm_artifact",
    schemaValidation.assertions,
  );
  const summaryInput = { path: value.artifact.path, detail: "summary" };
  expect(wasmAjv.validate(inputSchema, summaryInput)).toBe(true);
  const directSummary = await harness.client.callTool({
    name: "inspect_wasm_artifact",
    arguments: summaryInput,
  });
  expect(directSummary.isError).not.toBe(true);
  expect(
    wasmAjv.validate(outputSchema, directSummary.structuredContent),
    JSON.stringify(wasmAjv.errors),
  ).toBe(true);
  const summaryEvidence = parseEvidence(directSummary.structuredContent);
  const summary = wasmArtifactSummaryViewResultSchema.parse(
    summaryEvidence.normalized_result,
  );
  expect(summaryEvidence.confidence).toBe("derived");
  expect(summaryEvidence.evidence_links).toEqual([summary.parent_evidence_id]);
  expect(summary.summary.wat).toMatchObject({
    sha256: value.wat.sha256,
    code_units: value.wat.text.length,
  });
  expect(summary.summary.wat).not.toHaveProperty("text");
  expect(summary.summary).toMatchObject({
    debug_name_metadata: value.debug_name_metadata,
    custom_section_warnings: value.custom_section_warnings,
  });
  const retained = harness.session.evidenceById(summary.parent_evidence_id);
  if (retained === undefined) throw new Error("Summary lost original Evidence");
  expect(retained.normalized_result).toEqual(value);
  expect(retained.parameters).toEqual({
    path: value.artifact.path,
    glue_paths: [],
    candidate_paths: [],
  });
  expect(inspect).toHaveBeenCalledTimes(1);
  expect(inspect).toHaveBeenLastCalledWith(
    retained.parameters,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(
    wasmAjv.validate(outputSchema, {
      ...summaryEvidence,
      normalized_result: { ...summary, parent_operation: "inventory_artifact" },
    }),
  ).toBe(false);
  return { summary, retained };
};

it.each(["bin", "hop"])(
  "directs rejected native WASM opening (%s suffix) to the advertised static tool while preserving missing-WABT diagnostics",
  async (extension) => {
    const directory = await createTestTempDirectory("rea-wasm-recovery-");
    const path = join(
      await realpath(directory),
      process.platform === "win32"
        ? `module space.${extension}`
        : `module "quoted".${extension}`,
    );
    await writeFile(path, Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    const createClient = vi.fn(() => {
      throw new Error("native provider must not start for WASM");
    });
    const session = createTestBinarySession(createClient);
    const harness = await createApplicationMcpHarness({
      schemaValidator: schemaValidation,
      session,
      serverOptions: { environment: {} },
    });
    onTestFinished(harness.close);
    const { client } = harness;
    const { name, ajv, inputSchema } = await advertisedMcpToolSchemas(
      client,
      "inspect_wasm_artifact",
      schemaValidation.assertions,
    );
    const input = { path };
    const opening = await client.callTool({
      name: "open_binary",
      arguments: input,
    });
    expect(opening.isError).toBe(true);
    const failure = parseMcpToolError(opening);
    expect(failure).toMatchObject({
      error: {
        code: "target_unavailable",
        category: "unsupported_target",
        details: { constraint: "wasm_requires_static_inspection" },
      },
    });
    const [, recoveryName, serializedInput] =
      failure.error.remediation.action.match(
        /call (\w+) with (\{.*\}) or run/,
      ) ?? [];
    expect(recoveryName).toBe(name);
    const recoveryInput = z
      .object({ path: z.literal(path) })
      .strict()
      .parse(JSON.parse(serializedInput ?? "null"));
    expect(ajv.validate(inputSchema, recoveryInput)).toBe(true);
    const inspection = await client.callTool({
      name: recoveryName ?? "",
      arguments: recoveryInput,
    });
    expect(parseMcpToolError(inspection)).toMatchObject({
      error: {
        code: "capability_unavailable",
        details: {
          operation: "inspect_wasm_artifact",
          reason: "directory_not_absolute",
          diagnostics: {
            code: "directory_not_absolute",
            setting: "REA_WABT_BIN_DIRECTORY",
          },
        },
      },
    });
    const summary = await client.callTool({
      name,
      arguments: { ...input, detail: "summary" },
    });
    expect(parseMcpToolError(summary)).toMatchObject({
      error: {
        code: "capability_unavailable",
        details: {
          reason: "directory_not_absolute",
          diagnostics: {
            code: "directory_not_absolute",
            setting: "REA_WABT_BIN_DIRECTORY",
          },
        },
      },
    });
    await client.ping();
    expect(createClient).not.toHaveBeenCalled();
    expect(
      Buffer.compare(
        await readFile(path),
        Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
      ),
    ).toBe(0);
  },
);

it("records inline WASM evidence with compact inputs and canonical option checks", async () => {
  const value = wasmArtifactFixture();
  value.tool_profile.timeout_ms = 42_000;
  const close = vi.fn(() => Promise.resolve());
  const service = new WasmArtifactService({
    close,
    inspect: (input) => {
      expect(input.command_timeout_ms).toBe(42_000);
      return Promise.resolve(ok(wasmArtifactExecution(value)));
    },
  });
  const inspect = vi.spyOn(service.provider, "inspect");
  const session = createTestBinarySession(() => {
    throw new Error("deep provider must not start");
  });
  const harness = await createApplicationMcpHarness({
    schemaValidator: schemaValidation,
    session,
    serverOptions: { wasmArtifact: service },
  });
  onTestFinished(harness.close);
  const { client } = harness;
  const schemas = await advertisedMcpToolSchemas(
    client,
    "inspect_wasm_artifact",
    schemaValidation.assertions,
  );
  const { ajv, inputSchema } = schemas;
  expect(ajv.validate(inputSchema, { path: value.artifact.path })).toBe(true);
  for (const command_timeout_ms of [1, 42_000, 2_147_483_647])
    expect(
      ajv.validate(inputSchema, {
        path: value.artifact.path,
        command_timeout_ms,
      }),
    ).toBe(true);
  expect(
    ajv.validate(inputSchema, {
      path: value.artifact.path,

      approval: true,
    }),
  ).toBe(false);
  const response = await client.callTool({
    name: "inspect_wasm_artifact",
    arguments: { path: value.artifact.path, command_timeout_ms: 42_000 },
  });
  assertRecordedMcpEvidence(
    response,
    "inspect_wasm_artifact",
    schemas,
    session,
    value,
    "observed",
  );
  expect(inspect).toHaveBeenCalledTimes(1);
  const invalidDetail = await client.callTool({
    name: "inspect_wasm_artifact",
    arguments: { path: value.artifact.path, detail: "brief" },
  });
  expect(parseMcpToolError(invalidDetail).error.code).toBe("invalid_request");
  expect(inspect).toHaveBeenCalledTimes(1);
  for (const command_timeout_ms of [0, -1, 1.5, 2_147_483_648, "1000", null]) {
    const invalid = await client.callTool({
      name: "inspect_wasm_artifact",
      arguments: { path: value.artifact.path, command_timeout_ms },
    });
    expect(parseMcpToolError(invalid).error.code).toBe("invalid_request");
    expect(inspect).toHaveBeenCalledTimes(1);
  }
  const relative = await client.callTool({
    name: "inspect_wasm_artifact",
    arguments: { path: "relative.hex" },
  });
  expect(parseMcpToolError(relative).error.code).toBe("invalid_request");
  expect(inspect).toHaveBeenCalledTimes(1);
  await harness.close();
  expect(close).toHaveBeenCalled();
});

it.each([undefined, "summary"] as const)(
  "records complete WASM Evidence when an MCP request is cancelled during provider work (detail=%s)",
  async (detail) => {
    const value = wasmArtifactFixture();
    let releaseProvider: (() => void) | undefined;
    let providerStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let serverSignal: AbortSignal | undefined;
    const service = new WasmArtifactService({
      close: () => Promise.resolve(),
      inspect: async (_input, options) => {
        serverSignal = options?.signal;
        providerStarted?.();
        await providerGate;
        expect(options?.signal?.aborted).toBe(true);
        return ok(wasmArtifactExecution(value));
      },
    });
    const inspect = vi.spyOn(service, "inspect");
    const session = createTestBinarySession(() => {
      throw new Error("deep provider must not start");
    });
    const harness = await createApplicationMcpHarness({
      schemaValidator: schemaValidation,
      session,
      serverOptions: { wasmArtifact: service },
    });
    onTestFinished(harness.close);
    const controller = new AbortController();
    const cancellation = harness.client.callTool(
      {
        name: "inspect_wasm_artifact",
        arguments: {
          path: value.artifact.path,
          ...(detail === undefined ? {} : { detail }),
        },
      },
      { signal: controller.signal },
    );
    const rejected = expect(cancellation).rejects.toThrow();
    await started;
    controller.abort(new Error("cancel after provider work starts"));
    let serverReason: unknown;
    try {
      await harness.client.ping();
      serverReason = serverSignal?.reason;
    } finally {
      releaseProvider?.();
    }
    await rejected;
    expect(inspect).toHaveBeenCalledOnce();
    const result = await inspect.mock.results[0]?.value;
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        partialObservation: {
          operation: "inspect_wasm_artifact",
          normalized_result: value,
          confidence: "observed",
        },
      },
    });
    if (result === undefined || result.ok)
      throw new Error("Expected cancelled WASM Evidence");
    expect(serverSignal?.aborted).toBe(true);
    expect(result.error.cause).toBe(serverReason);
    const partial = parseEvidence(result.error.partialObservation);
    expect(partial.parameters).toEqual({
      path: value.artifact.path,
      glue_paths: [],
      candidate_paths: [],
    });
    await harness.client.ping();
    await vi.waitFor(() => {
      // Failed summary delivery retains the complete producer, without a derived view.
      expect(session.exportEvidenceBundle().records).toEqual([partial]);
    });
    expect(session.evidenceById(partial.evidence_id)).toEqual(partial);
  },
);

it("attributes rejected WASM paths to their selected fields before provider work", async () => {
  const value = wasmArtifactFixture();
  value.glue = [
    {
      artifact: { path: "/glue.js", sha256: "b".repeat(64), bytes: 0 },
      parse_status: "complete",
      references: [],
    },
  ];
  value.candidates.push({
    path: "/other.wasm",
    sha256: "c".repeat(64),
    bytes: 8,
  });
  const validInput = {
    path: value.artifact.path,
    glue_paths: ["/glue.js"],
    candidate_paths: ["/other.wasm"],
  };
  const inspect = vi.fn(() =>
    Promise.resolve(ok(wasmArtifactExecution(value))),
  );
  const harness = await createApplicationMcpHarness({
    schemaValidator: schemaValidation,
    serverOptions: {
      wasmArtifact: new WasmArtifactService({
        close: () => Promise.resolve(),
        inspect,
      }),
    },
  });
  onTestFinished(harness.close);
  for (const [input, paths] of [
    [{ path: "relative.wasm" }, [["path"]]],
    [
      { path: value.artifact.path, glue_paths: ["relative.js"] },
      [["glue_paths", 0]],
    ],
    [
      { path: value.artifact.path, candidate_paths: ["relative.wasm"] },
      [["candidate_paths", 0]],
    ],
    [
      {
        path: value.artifact.path,
        glue_paths: ["/glue.js", "relative.js"],
        candidate_paths: ["/other.wasm", "relative.wasm"],
      },
      [
        ["glue_paths", 1],
        ["candidate_paths", 1],
      ],
    ],
    [
      {
        path: "relative.wasm",
        glue_paths: ["relative.js"],
        candidate_paths: ["relative-candidate.wasm"],
      },
      [["path"], ["glue_paths", 0], ["candidate_paths", 0]],
    ],
  ] as const) {
    const response = await harness.client.callTool({
      name: "inspect_wasm_artifact",
      arguments: input,
    });
    const failure = parseMcpToolError(response).error;
    expect(failure.code).toBe("invalid_request");
    const { issues } = z
      .object({ issues: z.array(z.unknown()) })
      .parse(failure.details);
    expect(issues).toEqual(
      paths.map((path) => ({
        path,
        reason: "invalid_format",
        expected: "regex",
        message: "must be an absolute local filesystem path",
      })),
    );
  }
  expect(inspect).not.toHaveBeenCalled();
  const valid = await harness.client.callTool({
    name: "inspect_wasm_artifact",
    arguments: validInput,
  });
  expect(valid.isError).not.toBe(true);
  expect(inspect).toHaveBeenCalledExactlyOnceWith(
    validInput,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  await harness.client.ping();
});

it("rejects a WASM provider response with a non-file subject before recording Evidence", async () => {
  const value = wasmArtifactFixture();
  const execution = wasmArtifactExecution(value);
  const malformed = {
    ...execution,
    subject: { ...execution.subject, format: "elf" },
  } as unknown as typeof execution;
  const harness = await createApplicationMcpHarness({
    schemaValidator: schemaValidation,
    serverOptions: {
      wasmArtifact: new WasmArtifactService({
        close: () => Promise.resolve(),
        inspect: () => Promise.resolve(ok(malformed)),
      }),
    },
  });
  onTestFinished(harness.close);
  const before = harness.session.exportEvidenceBundle().records.length;
  const response = await harness.client.callTool({
    name: "inspect_wasm_artifact",
    arguments: { path: value.artifact.path },
  });
  expect(parseMcpToolError(response).error.code).toBe("unreadable_output");
  expect(harness.session.exportEvidenceBundle().records).toHaveLength(before);
});

it("reads an oversized completed WASM result through its reported retained reference", async () => {
  const text = "(module)\n" + ";;😀\n" + " ".repeat(6 * 1024 * 1024);
  const value = {
    ...wasmArtifactFixture(),
    imports: ['(import "env" "memory.with punctuation" (memory 1))'],
    exports: ['(export "first" (func 0))', '(export "second" (func 1))'],
    debug_name_metadata: "uninterpretable" as const,
    custom_section_warnings: [
      {
        tool: "wasm-validate" as const,
        text: "0000011: warning: invalid sub-section size: extends past end\n",
      },
    ],
    wat: {
      text,
      sha256: createHash("sha256").update(text, "utf8").digest("hex"),
      representation: "decoded-wat" as const,
    },
  };
  const inspect = vi.fn(() =>
    Promise.resolve(ok(wasmArtifactExecution(value))),
  );
  const service = new WasmArtifactService({
    close: () => Promise.resolve(),
    inspect,
  });
  const harness = await createApplicationMcpHarness({
    schemaValidator: schemaValidation,
    serverOptions: { wasmArtifact: service },
  });
  onTestFinished(harness.close);
  const { summary, retained } = await assertFirstSummaryDelivery(
    harness,
    value,
    inspect,
  );
  const reply = await harness.client.callTool({
    name: "inspect_wasm_artifact",
    arguments: { path: value.artifact.path },
  });
  const reference = z
    .object({
      details: z.object({
        reported_limits: z.object({
          evidence_reference: z.object({
            kind: z.literal("retained-evidence"),
            evidence_id: z.string(),
          }),
        }),
      }),
    })
    .parse(parseMcpToolError(reply).error).details
    .reported_limits.evidence_reference;
  expect(reference.evidence_id).toBe(summary.parent_evidence_id);
  const explicitComplete = await harness.client.callTool({
    name: "inspect_wasm_artifact",
    arguments: { path: value.artifact.path, detail: "complete" },
  });
  expect(parseMcpToolError(explicitComplete)).toMatchObject({
    error: {
      code: "resource_constraint",
      details: { reported_limits: { evidence_reference: reference } },
    },
  });
  const catalog = await harness.client.listTools();
  const advertised = catalog.tools.find(
    (tool) => tool.name === "inspect_analysis_view",
  );
  if (advertised?.outputSchema === undefined)
    throw new Error("Missing WASM view schemas");
  const ajv = schemaValidation.assertions;
  const input: Record<string, unknown> = advertised.inputSchema;
  const output: Record<string, unknown> = advertised.outputSchema;
  for (const [view, expected] of [
    [
      { kind: "summary" },
      {
        summary: {
          validation: "valid",
          available_counts: { imports: 1, exports: 2 },
          runtime_execution: "not-performed",
          network_fetch: "not-performed",
          wat: { sha256: value.wat.sha256, code_units: text.length },
        },
      },
    ],
    [
      { kind: "wasm", facet: "exports", offset: 1, limit: 1 },
      {
        item: [value.exports[1]],
        coverage: { total: 2, next_offset: null, exhausted: true },
      },
    ],
    [{ kind: "wasm", facet: "imports" }, { item: value.imports }],
    [
      { kind: "wasm", facet: "wat", offset: 0, limit: 16 },
      {
        item: { text: text.slice(0, 16), unit: "utf16-code-units" },
        coverage: { total: text.length, next_offset: 16, exhausted: false },
      },
    ],
  ] as const) {
    const args = { source: reference, view };
    expect(ajv.validate(input, args), JSON.stringify(ajv.errors)).toBe(true);
    const selected = await harness.client.callTool({
      name: "inspect_analysis_view",
      arguments: args,
    });
    expect(
      selected.isError,
      JSON.stringify(selected.structuredContent),
    ).not.toBe(true);
    expect(
      ajv.validate(output, selected.structuredContent),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    const evidence = parseEvidence(selected.structuredContent);
    expect(evidence.confidence).toBe("derived");
    expect(evidence.evidence_links).toEqual([reference.evidence_id]);
    expect(evidence.normalized_result).toMatchObject({
      parent_evidence_id: reference.evidence_id,
      ...expected,
    });
  }
  const original = harness.session.evidenceById(reference.evidence_id);
  expect(original?.normalized_result).toEqual(value);
  expect(original).toEqual(retained);
  expect(inspect).toHaveBeenCalledTimes(3);
  await harness.client.ping();
});

it("rejects inconsistent decoded-WAT digests in portable Evidence without a provider run", async () => {
  const value = wasmArtifactFixture();
  const harness = await createApplicationMcpHarness({
    schemaValidator: schemaValidation,
    serverOptions: { environment: {} },
  });
  onTestFinished(harness.close);
  const inconsistent = createEvidence(
    {
      path: value.artifact.path,
      sha256: value.artifact.sha256,
      format: "file",
    },
    { id: "historical-wabt", name: "Historical WABT", version: "1" },
    {
      operation: "inspect_wasm_artifact",
      parameters: {},
      result: { ...value, wat: { ...value.wat, sha256: "f".repeat(64) } },
    },
  );
  const invalid = await harness.client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source: { kind: "inline", evidence: inconsistent },
      view: { kind: "summary" },
    },
  });
  expect(parseMcpToolError(invalid)).toMatchObject({
    error: {
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["source", "normalized_result", "wat", "sha256"],
            reason: "invalid_value",
          },
        ],
      },
    },
  });
  await harness.client.ping();
});

it("checks WASM semantic identity while preserving rebound display paths", async () => {
  const value = wasmArtifactFixture();
  const harness = await createApplicationMcpHarness({
    schemaValidator: schemaValidation,
    serverOptions: { environment: {} },
  });
  onTestFinished(harness.close);
  const views = [
    { kind: "summary" },
    { kind: "wasm", facet: "exports", offset: 0, limit: 1 },
  ] as const;
  for (const target of [
    undefined,
    {
      path: value.artifact.path,
      sha256: "f".repeat(64),
      format: "file" as const,
    },
    {
      path: value.artifact.path,
      sha256: value.artifact.sha256,
      format: "elf" as const,
    },
  ]) {
    const source = createEvidence(
      target,
      { id: "historical-wabt", name: "Historical WABT", version: "1" },
      { operation: "inspect_wasm_artifact", parameters: {}, result: value },
    );
    for (const view of views) {
      const reply = await harness.client.callTool({
        name: "inspect_analysis_view",
        arguments: { source: { kind: "inline", evidence: source }, view },
      });
      expect(parseMcpToolError(reply)).toMatchObject({
        error: {
          code: "invalid_request",
          details: {
            issues: [{ path: ["source", "subject"], reason: "invalid_value" }],
          },
        },
      });
    }
  }
  const rebound = createEvidence(
    {
      path: `${value.artifact.path}.other`,
      sha256: value.artifact.sha256,
      format: "file",
    },
    { id: "historical-wabt", name: "Historical WABT", version: "1" },
    { operation: "inspect_wasm_artifact", parameters: {}, result: value },
  );
  for (const view of views) {
    const reply = await harness.client.callTool({
      name: "inspect_analysis_view",
      arguments: { source: { kind: "inline", evidence: rebound }, view },
    });
    expect(reply.isError, JSON.stringify(reply.structuredContent)).not.toBe(
      true,
    );
    const projected = parseEvidence(reply.structuredContent);
    expect(projected.subject).toEqual(rebound.subject);
    expect(projected.evidence_links).toEqual([rebound.evidence_id]);
    expect(projected.normalized_result).toMatchObject({
      artifact: { path: value.artifact.path, sha256: value.artifact.sha256 },
    });
  }
  await harness.client.ping();
});
it("rejects malformed paths, refuses WASM summary delivery before provider work when retention is unavailable, and keeps fixed-server complete delivery", async () => {
  const value = wasmArtifactFixture();
  const inspect = vi.fn<WasmArtifactService["provider"]["inspect"]>(() =>
    Promise.resolve(ok(wasmArtifactExecution(value))),
  );
  const service = new WasmArtifactService({
    close: () => Promise.resolve(),
    inspect,
  });
  const session = createTestBinarySession(() => {
    throw new Error("No deep provider");
  });
  const server = createServer(
    { kind: "fixed", analysis: session },
    { wasmArtifact: service },
  );
  const client = new Client({ name: "wasm-fixed-delivery", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b);
    await client.connect(a);
    const summaryInput = { path: value.artifact.path, detail: "summary" };
    const summary = await client.callTool({
      name: "inspect_wasm_artifact",
      arguments: summaryInput,
    });
    expect(parseMcpToolError(summary)).toMatchObject({
      error: {
        code: "capability_unavailable",
        message: expect.stringContaining("does not retain Evidence"),
      },
    });
    expect(inspect).not.toHaveBeenCalled();
    const malformed = await client.callTool({
      name: "inspect_wasm_artifact",
      arguments: {
        path: "relative.wasm",
        glue_paths: ["relative.js"],
        detail: "summary",
      },
    });
    const rejected = parseMcpToolError(malformed).error;
    expect(rejected.code).toBe("invalid_request");
    expect(
      z.object({ issues: z.array(z.unknown()) }).parse(rejected.details).issues,
    ).toEqual(
      [["path"], ["glue_paths", 0]].map((path) => ({
        path,
        reason: "invalid_format",
        expected: "regex",
        message: "must be an absolute local filesystem path",
      })),
    );
    expect(inspect).not.toHaveBeenCalled();
    for (const input of [
      { path: value.artifact.path },
      { path: value.artifact.path, detail: "complete" },
    ]) {
      const complete = await client.callTool({
        name: "inspect_wasm_artifact",
        arguments: input,
      });
      expect(complete.isError).not.toBe(true);
      expect(
        parseEvidence(complete.structuredContent).normalized_result,
      ).toEqual(value);
    }
    expect(inspect).toHaveBeenCalledTimes(2);
    inspect.mockImplementation(() =>
      Promise.resolve(err(new AnalysisInputError("inspect_wasm_artifact"))),
    );
    const refused = await client.callTool({
      name: "inspect_wasm_artifact",
      arguments: summaryInput,
    });
    expect(parseMcpToolError(refused)).toMatchObject({
      error: {
        code: "capability_unavailable",
        message: expect.stringContaining("Select detail complete"),
      },
    });
    expect(inspect).toHaveBeenCalledTimes(2);
    await client.ping();
  } finally {
    await client.close();
    await server.close();
    await session.close();
  }
});

it("compares caller-owned complete inline WASM sources on a fixed server without a recorder", async () => {
  const leftReport = wasmArtifactFixture("/artifacts/left.wasm");
  leftReport.interface = { state: "complete", issues: [], entries: [] };
  const rightReport = wasmArtifactFixture("/artifacts/right.wasm");
  rightReport.interface = {
    state: "complete",
    issues: [],
    entries: [
      {
        direction: "export",
        module: null,
        name: "new_export",
        kind: "func",
        index: 0,
        signature: { kind: "func", params: [], results: [] },
        wat_form: '(export "new_export" (func 0))',
        issue: null,
      },
    ],
  };
  const source = (report: ReturnType<typeof wasmArtifactFixture>) =>
    createEvidence(
      {
        path: report.artifact.path,
        sha256: report.artifact.sha256,
        format: "file",
      },
      { id: "fixture-wabt", name: "Source-owned WABT seam", version: "1" },
      {
        operation: "inspect_wasm_artifact",
        parameters: { path: report.artifact.path },
        result: report,
        confidence: "observed",
      },
    );
  const left = source(leftReport);
  const right = source(rightReport);
  const inspect = vi.fn<WasmArtifactService["provider"]["inspect"]>(() => {
    throw new Error(
      "Comparison must reuse caller Evidence without provider work",
    );
  });
  const service = new WasmArtifactService({
    close: () => Promise.resolve(),
    inspect,
  });
  const session = createTestBinarySession(() => {
    throw new Error("Comparison must not start a deep provider");
  });
  const server = createServer(
    { kind: "fixed", analysis: session },
    { wasmArtifact: service },
  );
  const client = new Client({ name: "wasm-fixed-comparison", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const reply = await client.callTool({
      name: "compare_wasm_interfaces",
      arguments: { left, right, scope: "both" },
    });
    expect(reply.isError, JSON.stringify(reply.structuredContent)).not.toBe(
      true,
    );
    const comparison = parseEvidence(reply.structuredContent);
    expect(comparison.operation).toBe("compare_wasm_interfaces");
    expect(comparison.evidence_links).toEqual([
      left.evidence_id,
      right.evidence_id,
    ]);
    expect(comparison.normalized_result).toMatchObject({
      coverage: "complete-within-inputs",
      summary: { added: 1, changed: 0, removed: 0, unchanged: 0, unknown: 0 },
      changes: [{ name: "new_export", state: "added" }],
    });
    expect(inspect).not.toHaveBeenCalled();
    expect(session.exportEvidenceBundle().records).toEqual([]);
  } finally {
    await client.close();
    await server.close();
    await session.close();
  }
});

it("retries cleanup of the injected WASM module after server shutdown fails", async () => {
  const close = vi
    .fn()
    .mockRejectedValueOnce(new Error("retained WASM workspace"))
    .mockResolvedValue(undefined);
  const service = new WasmArtifactService({
    close,
    inspect: () => Promise.resolve(ok(wasmArtifactExecution())),
  });
  const session = createTestBinarySession(() => {
    throw new Error("No deep provider");
  });
  const server = createServer(
    { kind: "session", session },
    { wasmArtifact: service },
  );
  const client = new Client({ name: "wasm-cleanup-retry", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b);
    await client.connect(a);
    await expect(server.close()).rejects.toThrow("REA session cleanup failed");
    await server.close();
    expect(close).toHaveBeenCalledTimes(2);
  } finally {
    await client.close();
    await server.close();
    await session.close();
  }
});
