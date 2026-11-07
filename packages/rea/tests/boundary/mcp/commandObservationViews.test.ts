import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import pino from "pino";
import { expect, it, onTestFinished, vi } from "vitest";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import {
  registerGdbTools,
  type GdbToolManager,
} from "../../../src/server/registerGdbTools.js";
import { registerReverseEngineeringTools } from "../../../src/server/registerReverseEngineeringTools.js";
import { registerAnalysisViewTool } from "../../../src/server/registerAnalysisViewTool.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../../src/domain/evidence.js";
import { ok } from "../../../src/domain/result.js";
import { inspectAnalysisView } from "../../../src/application/analysisView/AnalysisViewService.js";
import { TestReverseEngineeringService } from "../../support/reverseEngineeringService.js";
import { advertisedMcpToolSchemas } from "../../fixtures/advertisedMcpTool.js";

const sessionId = "00000000-0000-4000-8000-000000000001";
const capture = {
  command: "show architecture",
  mi: "7^done",
  records: [
    '~"architecture\\n"',
    '=thread-created,id="1"',
    "unrecognized 🧪 record",
    "7^done",
  ],
  console: '~"architecture\\n"',
  target: "",
  log: "",
  process_exit_observed: false,
  process_exit_code: null,
  process_exit_signal: null,
  output_truncated: true,
  output_invalid_utf8: true as const,
  completion_status: "unknown" as const,
};
const gdbEvidence = (
  parameters = { session_id: sessionId, command: capture.command },
) =>
  createEvidence(
    undefined,
    { id: "gdb", name: "GDB", version: null },
    {
      operation: "gdb_console",
      parameters,
      result: capture,
      rawResult: capture,
      limitations: ["Capture is partial."],
    },
  );

const connect = async (retain = true) => {
  const ledger = new Map<string, Evidence>();
  const record = (evidence: Evidence) => {
    ledger.set(evidence.evidence_id, evidence);
    return ok("added" as const);
  };
  const lookup = (id: string) => ledger.get(id);
  const delivery = createToolResultDelivery(2 * 1024 * 1024);
  const server = new EvidenceMcpServer(
    { name: "command-views", version: "1" },
    {},
    retain ? record : undefined,
    delivery,
  );
  const execute = vi.fn(async () =>
    ok({ result: capture, evidence: gdbEvidence() }),
  );
  const manager: GdbToolManager = {
    start: async () =>
      ok({ session_id: sessionId, mi_version: "mi3" as const }),
    execute,
    status: () => undefined,
    close: async () => ok({ target_state: "none_observed" as const }),
    retryCleanupFailures: async () => ok(null),
  };
  const run = vi.fn(async () => ({
    stdout: "BFD advertised targets\n",
    stderr: "diagnostic\n",
  }));
  const service = new TestReverseEngineeringService({ run });
  const logger = pino({ enabled: false });
  registerGdbTools(
    server,
    manager,
    logger,
    delivery,
    retain ? record : undefined,
    undefined,
    retain ? lookup : undefined,
  );
  registerReverseEngineeringTools(
    server,
    service,
    logger,
    delivery,
    retain ? record : undefined,
    undefined,
    undefined,
    undefined,
    retain ? lookup : undefined,
  );
  registerAnalysisViewTool(
    server,
    logger,
    retain ? lookup : undefined,
    retain ? record : undefined,
  );
  const client = new Client({ name: "command-view-client", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await service.close();
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  return { client, ledger, execute, run };
};

it("delivers ordered GDB records once and queries their retained parent after close through advertised SDK schemas", async () => {
  const { client, ledger } = await connect();
  const schemas = await advertisedMcpToolSchemas(client, "gdb_console");
  const viewSchemas = await advertisedMcpToolSchemas(
    client,
    "inspect_analysis_view",
  );
  const input = { session_id: sessionId, command: capture.command };
  const full = await client.callTool({ name: "gdb_console", arguments: input });
  const summary = await client.callTool({
    name: "gdb_console",
    arguments: { ...input, detail: "summary" },
  });
  for (const reply of [full, summary]) {
    expect(reply.isError).not.toBe(true);
    expect(
      schemas.ajv.validate(schemas.outputSchema, reply.structuredContent),
      JSON.stringify(schemas.ajv.errors),
    ).toBe(true);
  }
  expect(parseEvidence(full.structuredContent)).toEqual(gdbEvidence());
  const selected = parseEvidence(summary.structuredContent);
  expect(selected.raw_result).toBeNull();
  expect(selected.subject).toBeNull();
  expect(selected.normalized_result).toMatchObject({
    parent_evidence_id: gdbEvidence().evidence_id,
    artifact: null,
    source_provider: gdbEvidence().provider,
    source_parameters: gdbEvidence().parameters,
    summary: {
      records: capture.records,
      mi: capture.mi,
      completion_status: "unknown",
      output_truncated: true,
      output_invalid_utf8: true,
      process_exit_code: null,
      available_counts: {
        records: 4,
        console_utf16_units: capture.console.length,
        target_utf16_units: 0,
        log_utf16_units: 0,
      },
    },
  });
  expect(selected.normalized_result).not.toHaveProperty("summary.console");
  expect(selected.normalized_result).not.toHaveProperty("summary.target");
  expect(selected.normalized_result).not.toHaveProperty("summary.log");
  await client.callTool({
    name: "close_gdb_session",
    arguments: { session_id: sessionId },
  });
  const queried = await client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source: {
        kind: "retained-evidence",
        evidence_id: gdbEvidence().evidence_id,
      },
      view: { kind: "summary" },
    },
  });
  expect(
    viewSchemas.ajv.validate(
      viewSchemas.outputSchema,
      queried.structuredContent,
    ),
    JSON.stringify(viewSchemas.ajv.errors),
  ).toBe(true);
  expect(parseEvidence(queried.structuredContent)).toEqual(selected);
  expect(ledger.get(gdbEvidence().evidence_id)).toEqual(gdbEvidence());
});

it("keeps pathless objdump observations subjectless and preserves the default complete capture", async () => {
  const { client, ledger } = await connect();
  const schemas = await advertisedMcpToolSchemas(
    client,
    "inspect_with_objdump",
  );
  expect(
    schemas.ajv.validate(schemas.inputSchema, {
      operation: "architectures",
      detail: "summary",
    }),
  ).toBe(true);
  const full = await client.callTool({
    name: "inspect_with_objdump",
    arguments: { operation: "architectures" },
  });
  const selected = await client.callTool({
    name: "inspect_with_objdump",
    arguments: { operation: "architectures", detail: "summary" },
  });
  for (const reply of [full, selected])
    expect(
      schemas.ajv.validate(schemas.outputSchema, reply.structuredContent),
      JSON.stringify(schemas.ajv.errors),
    ).toBe(true);
  const parent = parseEvidence(full.structuredContent);
  const summary = parseEvidence(selected.structuredContent);
  expect(summary.normalized_result).toMatchObject({
    parent_evidence_id: parent.evidence_id,
    artifact: null,
    source_parameters: { operation: "architectures" },
    summary: parent.normalized_result,
  });
  expect(summary.raw_result).toBeNull();
  expect(summary.subject).toBeNull();
  expect(ledger.get(parent.evidence_id)).toEqual(parent);
});

it("rejects summary without retention before executing either native command", async () => {
  const { client, execute, run } = await connect(false);
  for (const input of [
    {
      name: "gdb_console",
      arguments: {
        session_id: sessionId,
        command: capture.command,
        detail: "summary",
      },
    },
    {
      name: "inspect_with_objdump",
      arguments: { operation: "architectures", detail: "summary" },
    },
  ])
    expect((await client.callTool(input)).isError).toBe(true);
  expect(execute).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

it("rejects malformed historical GDB facts and conflicting source commands", async () => {
  const source = gdbEvidence({
    session_id: sessionId,
    command: "a different command",
  });
  expect(
    (
      await inspectAnalysisView({
        source: { kind: "inline", evidence: source },
        view: { kind: "summary" },
      })
    ).ok,
  ).toBe(false);
  const malformed = createEvidence(undefined, source.provider, {
    operation: "gdb_console",
    parameters: {},
    result: { ...capture, records: [123] },
  });
  expect(
    (
      await inspectAnalysisView({
        source: { kind: "inline", evidence: malformed },
        view: { kind: "summary" },
      })
    ).ok,
  ).toBe(false);
});

it.each([true, false, null])(
  "preserves opaque objdump capture and unknown/change facts (%s)",
  async (changed) => {
    const report = {
      stdout: "opaque output 🧪\n",
      stderr: "diagnostic",
      exit_code: "ETIMEDOUT",
      signal: "SIGTERM",
      output_truncated: true,
      completion_status: "unknown",
      artifact_sha256_after:
        changed === null ? null : (changed ? "b" : "a").repeat(64),
      artifact_changed: changed,
    };
    const parent = createEvidence(
      {
        path: "/artifacts/input",
        sha256: "a".repeat(64),
        format: "elf",
        architecture: "x86_64",
      },
      { id: "gnu.objdump", name: "GNU objdump", version: null },
      {
        operation: "inspect_with_objdump",
        parameters: { path: "/artifacts/input", operation: "symbols" },
        result: report,
        rawResult: report,
      },
    );
    const selected = await inspectAnalysisView({
      source: { kind: "inline", evidence: parent },
      view: { kind: "summary" },
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) throw selected.error;
    expect(selected.value.normalized_result).toMatchObject({ summary: report });
    if (changed !== null) {
      const conflicting = createEvidence(
        {
          path: "/artifacts/input",
          sha256: "a".repeat(64),
          format: "elf",
          architecture: "x86_64",
        },
        parent.provider,
        {
          operation: parent.operation,
          parameters: parent.parameters,
          result: { ...report, artifact_changed: !changed },
        },
      );
      expect(
        (
          await inspectAnalysisView({
            source: { kind: "inline", evidence: conflicting },
            view: { kind: "summary" },
          })
        ).ok,
      ).toBe(false);
    }
  },
);
