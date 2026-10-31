import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, expect, it } from "vitest";

import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import type {
  AnalysisClient,
  AnalysisProvider,
  CapabilityDescriptor,
} from "../../../src/application/AnalysisProvider.js";
import { AnalysisCapabilityUnavailableError } from "../../../src/domain/analysisErrorCore.js";
import { err, ok as resultOk } from "../../../src/domain/result.js";
import { observed as ok } from "../../fixtures/analysisExecution.js";
import { createServer } from "../../../src/server/createServer.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import {
  createEvidenceBundle,
  parseEvidenceBundle,
} from "../../../src/domain/evidenceBundle.js";
import {
  createResidualUnknown,
  updateResidualUnknown,
} from "../../../src/domain/residualUnknown.js";
import { EMPTY_PROCESS_CAPTURE_EXAMPLE } from "../../../src/domain/process/processCaptureExample.js";

import { PROCESS_PROVIDER } from "../../../src/domain/process/processEvidenceProvider.js";

import { processCaptureSchema } from "../../../src/domain/process/processCapture.js";
const resources: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(
    resources.splice(0).map(async (resource) => resource.close()),
  );
});

const providerWithCapabilities = (
  operations: readonly CapabilityDescriptor["operation"][],
): AnalysisProvider => {
  const identity = { id: "fixture", name: "Fixture", version: "1" };
  const capabilities: readonly CapabilityDescriptor[] = operations.map(
    (operation) => ({
      provider: identity,
      operation,
      available: true,
      reason: null,
      pagination: "none",
      exhaustive: true,
      effects: {
        mutatesArtifact: false,
        launchesProcess: false,
        mayShowUi: false,
        mayAccessNetwork: false,
        mayWriteFilesystem: false,
        changesPermissions: false,
        requiresRoot: false,
      },
      limits: {
        maxResults: null,
        maxPayloadBytes: null,
        timeoutMs: null,
      },
      limitations: [],
    }),
  );
  return {
    identity: () => identity,
    capabilities: () => capabilities,
    createClient: () => ({
      execute: (operation) => {
        return Promise.resolve(
          err(
            new AnalysisCapabilityUnavailableError(
              "fixture",
              operation,
              "Decompiler is not installed.",
            ),
          ),
        );
      },
      close: () => Promise.resolve(resultOk(null)),
    }),
  };
};

const structured = (result: CallToolResult): Record<string, unknown> => {
  if (result.isError === true) return parseMcpToolError(result);
  if (
    typeof result.structuredContent !== "object" ||
    result.structuredContent === null
  )
    throw new Error("missing structured result");
  return Object.fromEntries(Object.entries(result.structuredContent));
};

it("rejects divergent imported histories without suggesting an unchanged retry", async () => {
  const root = await createTestTempDirectory("rea-unknown-divergent-");
  const provider = { id: "fixture", name: "Fixture", version: "1" };
  const records = ["create", "left", "right"].map((operation) =>
    createEvidence(undefined, provider, {
      operation,
      parameters: {},
      result: {},
    }),
  );
  const [created, left, right] = records;
  if (created === undefined || left === undefined || right === undefined)
    throw new Error("Missing fixture records");
  const fields = {
    question: "Does this branch conflict?",
    domain: "fixture",
    severity: "medium" as const,
    required_authority: null,
    required_confidence: "observed" as const,
    required_environment: null,
    recommended_probes: [],
    relationships: [],
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
  };
  const initial = createResidualUnknown(fields, created.evidence_id, null);
  const update = {
    ...fields,
    unknown_id: initial.unknown_id,
    expected_revision: 1,
    status: "investigating" as const,
    resolution: null,
  };
  const first = createEvidenceBundle(records, [
    initial,
    updateResidualUnknown(initial, update, left.evidence_id),
  ]);
  const second = createEvidenceBundle(records, [
    initial,
    updateResidualUnknown(
      initial,
      { ...update, status: "blocked" },
      right.evidence_id,
    ),
  ]);
  const paths = [join(root, "first.json"), join(root, "second.json")];
  await Promise.all([
    writeFile(paths[0]!, JSON.stringify(first)),
    writeFile(paths[1]!, JSON.stringify(second)),
  ]);
  const session = createTestBinarySession(() => {
    throw new Error("no target");
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "conflicting-history", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const emptyExport = await client.callTool({
    name: "export_evidence_bundle",
    arguments: { path: join(root, "empty-export.json") },
  });
  expect(emptyExport.isError).not.toBe(true);
  expect(emptyExport.structuredContent).toMatchObject({
    result: { records: 0, unknowns: 0 },
  });
  const imported = await client.callTool({
    name: "import_evidence_bundle",
    arguments: { path: paths[0]! },
  });
  expect(imported.isError).not.toBe(true);
  const exportResult = await client.callTool({
    name: "export_evidence_bundle",
    arguments: { path: join(root, "revisions-export.json") },
  });
  expect(exportResult.isError).not.toBe(true);
  expect(exportResult.structuredContent).toMatchObject({
    result: { records: records.length, unknowns: 2 },
  });
  const before = await client.callTool({
    name: "get_evidence_bundle",
    arguments: {},
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const conflict = await client.callTool({
      name: "import_evidence_bundle",
      arguments: { path: paths[1]! },
    });
    expect(conflict.isError).toBe(true);
    expect(parseMcpToolError(conflict).error).toMatchObject({
      code: "evidence_integrity_mismatch",
      retryable: false,
      remediation: { action: expect.stringContaining("cannot reconcile") },
      details: { diagnostics: { unknown_id: initial.unknown_id, revision: 2 } },
    });
    const after = await client.callTool({
      name: "get_evidence_bundle",
      arguments: {},
    });
    expect(after.structuredContent).toEqual(before.structuredContent);
  }
});

it("does not record capability unavailability without supporting Evidence", async () => {
  const session = createTestBinarySession(
    providerWithCapabilities(["procedure_pseudo_code"]),
  );
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "unavailable-unknown", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  await client.callTool({
    name: "open_binary",
    arguments: { path: process.execPath },
  });

  const unavailable = await client.callTool({
    name: "procedure_pseudo_code",
    arguments: {
      procedure: "main",
    },
  });
  expect(unavailable.isError).toBe(true);
  expect(structured(unavailable)).toMatchObject({
    error: {
      category: "unavailable",
    },
  });
  expect(
    structured(await client.callTool({ name: "list_unknowns", arguments: {} })),
  ).toMatchObject({
    result: {
      items: [],
    },
  });
});

it("records capture disagreement as a contradicted unknown", async () => {
  const session = createTestBinarySession(
    () =>
      ({
        execute: () => Promise.resolve(ok(null)),
        close: () => Promise.resolve(resultOk(null)),
      }) satisfies AnalysisClient,
  );
  const left = processCaptureSchema.parse(EMPTY_PROCESS_CAPTURE_EXAMPLE);
  const right = processCaptureSchema.parse({
    ...EMPTY_PROCESS_CAPTURE_EXAMPLE,
    interaction_events: [
      {
        sequence: 0,
        scheduled_at_ms: 0,
        dispatched_at_ms: 0,
        type: "input",
        data: "fixture",
        outcome: "dispatched",
      },
    ],
  });
  const captureEvidence = (capture: typeof left) =>
    createEvidence(undefined, PROCESS_PROVIDER, {
      predicateType: "rea.process-capture",
      operation: "capture_process_scenario",
      parameters: {},
      result: capture,
      confidence: "observed",
      authority: "controlled-replay",
    });
  const leftEvidence = captureEvidence(left);
  const rightEvidence = captureEvidence(right);
  expect(session.recordEvidence(leftEvidence).ok).toBe(true);
  expect(session.recordEvidence(rightEvidence).ok).toBe(true);
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "comparison-unknown", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const mismatched = await client.callTool({
    name: "compare_process_captures",
    arguments: {
      left: {
        ...leftEvidence,
        normalized_result: rightEvidence.normalized_result,
      },
      right: rightEvidence,
    },
  });
  expect(mismatched.isError).toBe(true);

  const compared = await client.callTool({
    name: "compare_process_captures",
    arguments: {
      left: leftEvidence,
      right: rightEvidence,
    },
  });
  expect(compared.isError).not.toBe(true);
  const firstEvidence = parseEvidence(structured(compared));
  expect(
    structured(await client.callTool({ name: "list_unknowns", arguments: {} })),
  ).toMatchObject({
    result: {
      items: [
        {
          status: "contradicted",
          domain: "process-comparison",
          question: `Process captures disagree across: interaction (comparison ${firstEvidence.evidence_id})`,
          contradicting_evidence_ids: [rightEvidence.evidence_id],
        },
      ],
    },
  });
  const repeatedCapture = captureEvidence(
    processCaptureSchema.parse({
      ...right,
      interaction_events: right.interaction_events.map((event) => ({
        ...event,
        data: "second observation",
      })),
    }),
  );
  expect(session.recordEvidence(repeatedCapture).ok).toBe(true);
  const secondComparison = await client.callTool({
    name: "compare_process_captures",
    arguments: { left: leftEvidence, right: repeatedCapture },
  });
  expect(secondComparison.isError, JSON.stringify(secondComparison)).not.toBe(
    true,
  );
  const secondEvidence = parseEvidence(structured(secondComparison));
  expect(secondEvidence.normalized_result).toMatchObject({
    status: "changed",
    interaction: "added",
  });
  expect(secondEvidence.evidence_id).not.toBe(firstEvidence.evidence_id);

  const unknowns = session.listUnknowns({ domain: "process-comparison" });
  expect(unknowns).toHaveLength(2);
  expect(unknowns.map((unknown) => unknown.contradicting_evidence_ids)).toEqual(
    expect.arrayContaining([
      [rightEvidence.evidence_id],
      [repeatedCapture.evidence_id],
    ]),
  );
  const beforeRepeat = parseEvidenceBundle(
    structured(await client.callTool({ name: "get_evidence_bundle" })).result,
  );
  const repeatedComparison = await client.callTool({
    name: "compare_process_captures",
    arguments: { left: leftEvidence, right: repeatedCapture },
  });
  expect(repeatedComparison.isError).not.toBe(true);
  expect(parseEvidence(structured(repeatedComparison))).toEqual(secondEvidence);
  expect(
    parseEvidenceBundle(
      structured(await client.callTool({ name: "get_evidence_bundle" })).result,
    ),
  ).toEqual(beforeRepeat);
});

it("pages filtered unknown heads through the public MCP contract", async () => {
  const session = createTestBinarySession(providerWithCapabilities([]));
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "unknown-pagination", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const created = [
    ["matching c", "high", "pagination"],
    ["matching a", "high", "pagination"],
    ["matching b", "high", "pagination"],
    ["filtered severity", "medium", "pagination"],
    ["filtered domain", "high", "other"],
  ] as const;
  for (const [question, severity, domain] of created) {
    const result = session.recordUnknown({
      question,
      severity,
      domain,
      required_authority: "analyst-inference",
      required_confidence: "observed",
      required_environment: null,
      recommended_probes: [],
      relationships: [],
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
    });
    if (!result.ok) throw result.error;
  }

  const defaultPage = structured(
    await client.callTool({ name: "list_unknowns", arguments: {} }),
  ).result as {
    items: { unknown_id: string }[];
    total: number;
    offset: number;
    next_offset: number | null;
  };
  expect(defaultPage.items.map(({ unknown_id }) => unknown_id)).toEqual(
    defaultPage.items.map(({ unknown_id }) => unknown_id).sort(),
  );
  expect(defaultPage).toMatchObject({ total: 5, offset: 0, next_offset: null });

  const detached = session.listUnknownsPage({ limit: 1 });
  const detachedHead = detached.items[0];
  if (detachedHead === undefined) throw new Error("Expected one unknown head");
  const originalQuestion = detachedHead.question;
  Reflect.set(detachedHead, "question", "changed outside the ledger");
  expect(
    session
      .listUnknowns()
      .find(({ unknown_id }) => unknown_id === detachedHead.unknown_id)
      ?.question,
  ).toBe(originalQuestion);

  const offsetWithoutLimit = structured(
    await client.callTool({
      name: "list_unknowns",
      arguments: { domain: "pagination", offset: 1 },
    }),
  ).result as typeof defaultPage;
  expect(offsetWithoutLimit).toMatchObject({
    total: 4,
    offset: 1,
    next_offset: null,
  });
  expect(offsetWithoutLimit.items).toHaveLength(3);

  const noMatches = structured(
    await client.callTool({
      name: "list_unknowns",
      arguments: { domain: "no-such-domain", limit: 2 },
    }),
  ).result as typeof defaultPage;
  expect(noMatches).toMatchObject({
    items: [],
    total: 0,
    offset: 0,
    next_offset: null,
  });

  const beyondEnd = structured(
    await client.callTool({
      name: "list_unknowns",
      arguments: { domain: "pagination", offset: 100, limit: 2 },
    }),
  ).result as typeof defaultPage;
  expect(beyondEnd).toMatchObject({
    total: 4,
    offset: 100,
    next_offset: null,
  });
  expect(beyondEnd.items).toEqual([]);

  const maximumSafePage = structured(
    await client.callTool({
      name: "list_unknowns",
      arguments: {
        offset: Number.MAX_SAFE_INTEGER,
        limit: Number.MAX_SAFE_INTEGER,
      },
    }),
  ).result as typeof defaultPage;
  expect(maximumSafePage).toMatchObject({
    total: 5,
    offset: Number.MAX_SAFE_INTEGER,
    next_offset: null,
  });
  expect(maximumSafePage.items).toEqual([]);

  const request = {
    name: "list_unknowns",
    arguments: { domain: "pagination", severity: "high", limit: 2 },
  } as const;
  const first = structured(await client.callTool(request))
    .result as typeof defaultPage;
  expect(first).toMatchObject({ total: 3, offset: 0, next_offset: 2 });
  expect(first.items).toHaveLength(2);
  const secondResponse = await client.callTool({
    ...request,
    arguments: { ...request.arguments, offset: first.next_offset ?? 0 },
  });
  const second = structured(secondResponse).result as typeof defaultPage;
  expect(second).toMatchObject({ total: 3, offset: 2, next_offset: null });
  expect(second.items).toHaveLength(1);
  expect(
    [...first.items, ...second.items].map(({ unknown_id }) => unknown_id),
  ).toEqual(
    session
      .listUnknowns({ domain: "pagination", severity: "high" })
      .map(({ unknown_id }) => unknown_id),
  );
  expect(
    toolContract("list_unknowns").outputSchema.safeParse(
      secondResponse.structuredContent,
    ).success,
  ).toBe(true);

  for (const arguments_ of [
    { limit: 0 },
    { offset: -1 },
    { offset: Number.MAX_SAFE_INTEGER + 1 },
    { unexpected: true },
  ]) {
    expect(
      (await client.callTool({ name: "list_unknowns", arguments: arguments_ }))
        .isError,
    ).toBe(true);
  }
});

it("reports contradictory unknown input as a correctable request", async () => {
  const session = createTestBinarySession(providerWithCapabilities([]));
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "unknown-input", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const fields = {
    severity: "medium",
    required_authority: "analyst-inference",
    required_confidence: "observed",
    required_environment: null,
    recommended_probes: [],
    relationships: [],
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
  };
  const created = structured(
    await client.callTool({
      name: "record_unknown",
      arguments: {
        ...fields,
        question: "Does the result apply?",
        domain: "input",
      },
    }),
  ).result as {
    unknown_id: string;
    revision: number;
    mutation_evidence_ids: string[];
  };
  const duplicate = parseMcpToolError(
    await client.callTool({
      name: "record_unknown",
      arguments: {
        ...fields,
        question: "Does the result apply?",
        domain: "input",
      },
    }),
  ).error;
  expect(duplicate).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    retryable: false,
    details: { reason: "already-exists" },
    remediation: {
      action: expect.stringContaining("do not repeat record_unknown"),
    },
  });
  const evidenceId = created.mutation_evidence_ids[0];

  const overlap = parseMcpToolError(
    await client.callTool({
      name: "record_unknown",
      arguments: {
        ...fields,
        question: "Can one observation both support and contradict?",
        domain: "input",
        supporting_evidence_ids: [evidenceId],
        contradicting_evidence_ids: [evidenceId],
      },
    }),
  ).error;
  expect(overlap).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    retryable: false,
    details: {
      issues: [
        expect.objectContaining({
          message: "Evidence cannot simultaneously support and contradict",
        }),
      ],
    },
  });

  const update = {
    ...fields,
    unknown_id: created.unknown_id,
    expected_revision: created.revision,
  };
  const unresolved = parseMcpToolError(
    await client.callTool({
      name: "update_unknown",
      arguments: { ...update, status: "resolved", resolution: null },
    }),
  ).error;
  expect(unresolved).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    retryable: false,
    details: {
      issues: [expect.objectContaining({ path: ["resolution"] })],
    },
  });
  expect(session.listUnknowns()).toMatchObject([{ revision: 1 }]);

  const stale = parseMcpToolError(
    await client.callTool({
      name: "update_unknown",
      arguments: {
        ...update,
        expected_revision: 2,
        status: "open",
        resolution: null,
      },
    }),
  ).error;
  expect(stale).toMatchObject({ code: "revision_conflict" });
});

it("returns exact committed unknown receipts when creation and update replies overflow", async () => {
  const session = createTestBinarySession(providerWithCapabilities([]));
  const server = createServer(
    { kind: "session", session },
    { delivery: createToolResultDelivery(8 * 1024) },
  );
  const client = new Client({ name: "unknown-overflow-receipt", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  resources.push(client, server);
  await server.connect(st);
  await client.connect(ct);
  const fields = {
    severity: "medium",
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
    required_authority: null,
    required_confidence: "observed",
    required_environment: null,
    recommended_probes: [],
    relationships: [],
  };
  const created = await client.callTool({
    name: "record_unknown",
    arguments: { ...fields, question: "x".repeat(10_000), domain: "overflow" },
  });
  expect(created.isError).toBe(true);
  const first = session.listUnknowns()[0]!;
  const checkReceipt = (response: CallToolResult, unknown: typeof first) => {
    expect(parseMcpToolError(response)).toMatchObject({
      error: {
        code: "resource_constraint",
        details: {
          reported_limits: {
            committed_unknown: {
              unknown_id: unknown.unknown_id,
              revision: unknown.revision,
              mutation_evidence_ids: unknown.mutation_evidence_ids,
            },
            evidence_reference: {
              kind: "retained-evidence",
              evidence_id: unknown.mutation_evidence_ids[0],
            },
          },
        },
        remediation: {
          action: expect.stringContaining(
            "Do not repeat the completed mutation",
          ),
        },
      },
    });
    const recovery = parseMcpToolError(response).error.remediation.action;
    expect(recovery).toContain("export_evidence_bundle");
    expect(recovery).not.toContain("or page list_unknowns");
    expect(recovery).toContain("may be too large");
    for (const id of unknown.mutation_evidence_ids)
      expect(session.evidenceById(id)).toBeDefined();
  };
  checkReceipt(created, first);
  const singlePage = await client.callTool({
    name: "list_unknowns",
    arguments: { offset: 0, limit: 1 },
  });
  expect(singlePage.isError).toBe(true);
  expect(parseMcpToolError(singlePage).error.remediation.action).toContain(
    "export_evidence_bundle",
  );
  const directory = await createTestTempDirectory("rea-unknown-overflow-");
  const path = join(directory, "bundle.json");
  const exported = await client.callTool({
    name: "export_evidence_bundle",
    arguments: { path },
  });
  expect(exported.isError).not.toBe(true);
  const bundle = parseEvidenceBundle(JSON.parse(await readFile(path, "utf8")));
  expect(bundle.unknowns[0]?.question).toBe("x".repeat(10_000));
  const updated = await client.callTool({
    name: "update_unknown",
    arguments: {
      ...fields,
      unknown_id: first.unknown_id,
      expected_revision: first.revision,
      status: "investigating",
      resolution: null,
    },
  });
  expect(updated.isError).toBe(true);
  const latest = session.listUnknowns()[0]!;
  expect(latest.revision).toBe(2);
  checkReceipt(updated, latest);
  expect(session.exportEvidenceBundle().unknowns).toHaveLength(2);
});

it("preserves graph constraint facts and rejects atomically until input is corrected", async () => {
  const session = createTestBinarySession(providerWithCapabilities([]));
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "unknown-constraint", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const fields = {
    severity: "medium",
    required_authority: "controlled-replay",
    required_confidence: "observed",
    required_environment: null,
    recommended_probes: [],
    relationships: [],
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
  };
  const good = async (name: string, args: Record<string, unknown> = {}) => {
    const reply = await client.callTool({ name, arguments: args });
    expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true);
    return structured(reply).result;
  };
  const missingEvidence = `ev_${"0".repeat(64)}`;
  const missingUnknown = `unk_${"0".repeat(64)}`;
  const empty = await good("get_evidence_bundle");
  const request = {
    ...fields,
    question: "Can this reference be used?",
    domain: "reference",
  };
  for (const [args, constraint] of [
    [
      { supporting_evidence_ids: [missingEvidence] },
      { kind: "missing_evidence", evidence_id: missingEvidence },
    ],
    [
      { relationships: [{ type: "related-to", unknown_id: missingUnknown }] },
      { kind: "missing_unknown", related_unknown_id: missingUnknown },
    ],
  ] as const) {
    const error = parseMcpToolError(
      await client.callTool({
        name: "record_unknown",
        arguments: { ...request, ...args },
      }),
    ).error;
    expect(error).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      retryable: false,
      details: { reason: "constraint", constraint },
      remediation: {
        action: expect.stringContaining("Do not repeat the unchanged call"),
      },
    });
    expect(await good("get_evidence_bundle")).toEqual(empty);
  }
  const head = (await good("record_unknown", request)) as {
    unknown_id: string;
    revision: number;
    mutation_evidence_ids: string[];
  };
  const id = head.mutation_evidence_ids[0];
  const before = await good("get_evidence_bundle");
  const update = {
    ...fields,
    unknown_id: head.unknown_id,
    expected_revision: head.revision,
    status: "resolved",
    supporting_evidence_ids: [id],
    resolution: {
      disposition: "verified",
      rationale: "Mutation alone does not prove this claim.",
      evidence_ids: [id],
    },
  };
  const error = parseMcpToolError(
    await client.callTool({ name: "update_unknown", arguments: update }),
  ).error;
  expect(error).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    retryable: false,
    details: {
      reason: "constraint",
      constraint: { kind: "resolution_unproven", unknown_id: head.unknown_id },
    },
  });
  expect(error.message).toContain("no qualifying resolution evidence");
  expect(await good("get_evidence_bundle")).toEqual(before);
  expect(
    await good("record_unknown", {
      ...request,
      question: "Does the corrected reference work?",
      supporting_evidence_ids: [id],
    }),
  ).toMatchObject({ revision: 1 });
  expect(
    await good("update_unknown", {
      ...update,
      resolution: {
        disposition: "withdrawn",
        rationale: "Withdraw unsupported claim.",
        evidence_ids: [],
      },
    }),
  ).toMatchObject({ revision: 2 });
  const conflict = parseMcpToolError(
    await client.callTool({ name: "update_unknown", arguments: update }),
  ).error;
  expect(conflict).toMatchObject({
    code: "revision_conflict",
    retryable: true,
  });
});

it("recovers an oversized list with same-session paging or export", async () => {
  const session = createTestBinarySession(providerWithCapabilities([]));
  const server = createServer(
    { kind: "session", session },
    { delivery: createToolResultDelivery(8 * 1024) },
  );
  const client = new Client({ name: "unknown-list-recovery", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  resources.push(client, server);
  await server.connect(st);
  await client.connect(ct);
  const fields = {
    severity: "medium",
    domain: "overflow-list",
    required_authority: null,
    required_confidence: "observed",
    required_environment: null,
    recommended_probes: [],
    relationships: [],
  };
  for (let i = 0; i < 3; i += 1) {
    const result = await client.callTool({
      name: "record_unknown",
      arguments: { ...fields, question: `${i}-${"q".repeat(1800)}` },
    });
    expect(result.isError).not.toBe(true);
  }
  const overflow = parseMcpToolError(
    await client.callTool({
      name: "list_unknowns",
      arguments: { domain: "overflow-list" },
    }),
  ).error;
  expect(overflow.code).toBe("resource_constraint");
  expect(overflow.remediation.action).toContain("same connection");
  expect(overflow.remediation.action).toContain("smaller limit");
  expect(overflow.remediation.action).toContain("export_evidence_bundle");
  expect(overflow.remediation.action).not.toContain("CLI JSON");
  const first = await client.callTool({
    name: "list_unknowns",
    arguments: { domain: "overflow-list", offset: 0, limit: 1 },
  });
  expect(first.isError).not.toBe(true);
  expect(session.exportEvidenceBundle().unknowns).toHaveLength(3);
});
