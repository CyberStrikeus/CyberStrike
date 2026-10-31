import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import type { DeviceManager } from "frida";
import { afterAll, expect, it, onTestFinished } from "vitest";

import type { FridaInstrumentationPort } from "../../../src/application/frida/FridaInstrumentationPort.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { expandToolAvailability } from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import { FridaInstrumentationManager } from "../../../src/frida/FridaInstrumentationManager.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { fridaSessionStatusSummaryViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import { fridaSessionStatusSchema } from "../../../src/domain/fridaSessionStatus.js";
import { evidenceBundleSummarySchema } from "../../../src/domain/evidenceRecordSummary.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { parseMcpEvidenceBundle } from "../../fixtures/mcpEvidenceBundle.js";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";

const schemaValidation = createMcpSchemaValidation();
afterAll(() => schemaValidation.clear());

it("retains the remote address, but not authentication, in discovery failures", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("unexpected binary provider");
  });
  const bindings = {
    addRemoteDevice: async () => {
      throw new Error("connection refused: synthetic-secret-token");
    },
  } as unknown as DeviceManager;
  const provider = new FridaInstrumentationManager({ deviceManager: bindings });
  const server = createServer(
    { kind: "session", session },
    { fridaInstrumentation: provider },
  );
  const client = await connectFridaTestClient(
    server,
    session,
    "frida-discovery-failure",
  );
  const result = await client.callTool({
    name: "list_frida_processes",
    arguments: {
      remote: { address: "127.0.0.1:27042", token: "synthetic-secret-token" },
    },
  });
  expect(result.isError).toBe(true);
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("Expected text failure");
  expect(JSON.parse(first.text)).toMatchObject({
    error: {
      code: "capability_unavailable",
      details: { diagnostics: { remote_address: "127.0.0.1:27042" } },
    },
  });
  expect(JSON.stringify(result)).not.toContain("synthetic-secret-token");
});

const createFridaTestProvider = (
  overrides: Partial<FridaInstrumentationPort> = {},
): FridaInstrumentationPort => ({
  async listDevices() {
    return {
      ok: true,
      value: {
        devices: [
          { deviceId: "remote-device", name: "target", type: "remote" },
        ],
        cleanupError: null,
      },
    };
  },
  async listProcesses() {
    return {
      ok: true,
      value: {
        deviceId: "remote-device",
        processes: [
          { pid: 0, name: "idle", identifier: null },
          { pid: 10, name: "target", identifier: "example.target" },
        ],
        cleanupError: "earlier endpoint cleanup diagnostic",
      },
    };
  },
  async startSession(input) {
    return {
      ok: true,
      value: {
        sessionId: "00000000-0000-4000-8000-000000000001",
        deviceId: "remote-device",
        target: String(input.mode),
        pid: 10,
        mode: input.mode,
        state: input.mode === "spawn" ? "paused" : "running",
      },
    };
  },
  async loadScript() {
    return {
      ok: true,
      value: {
        scriptId: "00000000-0000-4000-8000-000000000002",
        sourceKind: "inline",
        sourcePath: null,
        sourceSha256: "a".repeat(64),
        messages: [],
        messagesTruncated: false,
      },
    };
  },
  async resumeSession() {
    return { ok: true, value: null };
  },
  async unloadScript() {
    return { ok: true, value: null };
  },
  status(sessionId) {
    return {
      sessionId,
      deviceId: "remote-device",
      target: "fixture",
      pid: 10,
      mode: "attach",
      state: "running",
      targetResumeObserved: false,
      scripts: [],
      messages: [],
      messagesTruncated: false,
    };
  },
  async closeSession() {
    return { ok: true, value: { targetResumeObserved: false } };
  },
  async closeAll() {},
  ...overrides,
});

const connectFridaTestClient = async (
  server: ReturnType<typeof createServer>,
  session: ReturnType<typeof createTestBinarySession>,
  name: string,
): Promise<Client> => {
  const client = new Client(
    { name, version: "1" },
    { jsonSchemaValidator: schemaValidation },
  );
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
};

it("delivers Frida status summaries with complete retained Evidence for both truncation states", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const messages = [
    {
      type: "send",
      payload: { token: "caller-selected-nonsecret", rows: [1, 2] },
    },
  ];
  let reads = 0;
  let statusTruncated = false;
  const session = createTestBinarySession(() => {
    throw new Error("No binary provider");
  });
  const server = createServer(
    { kind: "session", session },
    {
      fridaInstrumentation: createFridaTestProvider({
        status(sessionId) {
          reads++;
          return {
            sessionId,
            deviceId: "local",
            target: "fixture",
            pid: 10,
            mode: "attach",
            state: "running",
            targetResumeObserved: false,
            scripts: [],
            messages,
            messagesTruncated: statusTruncated,
          };
        },
      }),
    },
  );
  const client = await connectFridaTestClient(
    server,
    session,
    "frida-status-summary",
  );
  const tools = (await client.listTools()).tools;
  const tool = tools.find((t) => t.name === "frida_session_status");
  if (!tool?.outputSchema) throw new Error("Missing Frida status schema");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(tool.inputSchema)).toBe(true);
  const outputSchema: Record<string, unknown> = tool.outputSchema;
  expect(ajv.validateSchema(outputSchema)).toBe(true);
  for (const truncated of [false, true]) {
    statusTruncated = truncated;
    const readsBefore = reads;
    const complete = await client.callTool({
      name: tool.name,
      arguments: { session_id: id },
    });
    expect(complete.isError).not.toBe(true);
    const parent = parseEvidence(
      toolContract("frida_session_status").outputSchema.parse(
        complete.structuredContent,
      ),
    );
    expect(
      fridaSessionStatusSchema.parse(parent.normalized_result).messages,
    ).toEqual(messages);
    const explicit = await client.callTool({
      name: tool.name,
      arguments: { session_id: id, detail: "complete" },
    });
    expect(explicit.structuredContent).toEqual(parent);
    const summary = await client.callTool({
      name: tool.name,
      arguments: { session_id: id, detail: "summary" },
    });
    expect(summary.isError).not.toBe(true);
    expect(ajv.validate(outputSchema, summary.structuredContent)).toBe(true);
    const evidence = toolContract("frida_session_status").outputSchema.parse(
      summary.structuredContent,
    );
    const view = fridaSessionStatusSummaryViewResultSchema.parse(
      evidence.normalized_result,
    );
    expect(view).toMatchObject({
      parent_evidence_id: parent.evidence_id,
      source_provider: parent.provider,
      source_parameters: parent.parameters,
      artifact: null,
      summary: {
        session_id: id,
        state: "running",
        scripts: [],
        messages_retained: 1,
        messages_truncated: truncated,
      },
    });
    expect(evidence.authority).toBe("external-service");
    expect(JSON.stringify(view)).not.toContain("caller-selected-nonsecret");
    const retained = await client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source: { kind: "retained-evidence", evidence_id: parent.evidence_id },
        view: { kind: "summary" },
      },
    });
    expect(retained.structuredContent).toEqual(evidence);
    expect(reads - readsBefore).toBe(3);
    const discovered = await client.callTool({
      name: "get_evidence_bundle",
      arguments: {
        detail: "summary",
        filters: { evidence_id: parent.evidence_id },
      },
    });
    expect(discovered.isError).not.toBe(true);
    const discovery = evidenceBundleSummarySchema.parse(
      toolContract("get_evidence_bundle").outputSchema.parse(
        discovered.structuredContent,
      ).result,
    );
    expect(discovery.matching_records).toBe(1);
    expect(discovery.records.map((record) => record.evidence_id)).toEqual([
      parent.evidence_id,
    ]);
    expect(JSON.stringify(discovered.structuredContent)).not.toContain(
      "caller-selected-nonsecret",
    );
    const bundle = await client.callTool({
      name: "get_evidence_bundle",
      arguments: {},
    });
    expect(bundle.isError).not.toBe(true);
    expect(parseMcpEvidenceBundle(bundle).records).toContainEqual(parent);
    expect(session.evidenceById(parent.evidence_id)).toEqual(parent);
    // Inline/file projection validates the owning result and exact source selection.
    const malformed = createEvidence(undefined, parent.provider ?? undefined, {
      operation: parent.operation,
      parameters: { session_id: "00000000-0000-4000-8000-000000000099" },
      result: parent.normalized_result,
    });
    const rejected = await client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source: { kind: "inline", evidence: malformed },
        view: { kind: "summary" },
      },
    });
    expect(rejected.isError).toBe(true);
  }
});

const expectFridaToolsAvailable = async (client: Client) => {
  const inventory = await client.callTool({
    name: "binary_session",
    arguments: {},
  });
  const parsedInventory = toolContract("binary_session").outputSchema.safeParse(
    inventory.structuredContent,
  );
  if (!parsedInventory.success)
    throw new Error("Invalid binary session output");
  const toolAvailability = expandToolAvailability(
    parsedInventory.data.result.tool_availability,
  );
  expect(toolAvailability).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "list_frida_devices",
        available: true,
        reason: "available",
      }),
      expect.objectContaining({
        name: "instrument_with_frida",
        available: true,
        reason: "available",
      }),
    ]),
  );
};

const expectFridaProcessDiscovery = async (client: Client) => {
  const processes = await client.callTool({
    name: "list_frida_processes",
    arguments: { device_id: "remote-device" },
  });
  expect(processes.isError).not.toBe(true);
  expect(
    toolContract("list_frida_processes").outputSchema.parse(
      processes.structuredContent,
    ),
  ).toEqual({
    device_id: "remote-device",
    processes: [
      { pid: 0, name: "idle", identifier: null },
      { pid: 10, name: "target", identifier: "example.target" },
    ],
    cleanup_error: "earlier endpoint cleanup diagnostic",
  });
};

const expectFridaSelectorGuidance = async (
  client: Client,
  tools: Awaited<ReturnType<Client["listTools"]>>["tools"],
) => {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const processTool = tools.find(
    (tool) => tool.name === "list_frida_processes",
  );
  if (processTool === undefined) throw new Error("Missing Frida process tool");
  expect(processTool.inputSchema.description).toMatch(
    /exactly one of device_id or remote/u,
  );
  expect(ajv.validateSchema(processTool.inputSchema)).toBe(true);
  for (const args of [
    { device_id: "local" },
    { remote: { address: "127.0.0.1:27042" } },
  ]) {
    expect(ajv.validate(processTool.inputSchema, args)).toBe(true);
    expect(
      (await client.callTool({ name: "list_frida_processes", arguments: args }))
        .isError,
    ).not.toBe(true);
  }
  // Runtime refinements enforce the choice that advertisement describes.
  for (const { args, reason } of [
    { args: {}, reason: "Select a device_id or a remote endpoint" },
    {
      args: { device_id: "local", remote: { address: "127.0.0.1:27042" } },
      reason: "Choose either device_id or remote, not both",
    },
  ]) {
    const rejected = await client.callTool({
      name: "list_frida_processes",
      arguments: args,
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.content).toContainEqual({
      type: "text",
      text: expect.stringContaining(reason),
    });
  }
};

it("advertises Frida MCP schemas and keeps remote credentials out of results", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Binary provider must not start");
  });
  const server = createServer(
    { kind: "session", session },
    {
      fridaInstrumentation: createFridaTestProvider(),
    },
  );
  const client = await connectFridaTestClient(
    server,
    session,
    "frida-contract",
  );

  const tools = (await client.listTools()).tools;
  const advertised = tools.find((tool) => tool.name === "list_frida_devices");
  if (
    advertised?.inputSchema === undefined ||
    advertised.outputSchema === undefined
  )
    throw new Error("Missing advertised Frida schemas");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const inputSchema: Record<string, unknown> = advertised.inputSchema;
  const outputSchema: Record<string, unknown> = advertised.outputSchema;
  expect(ajv.validateSchema(inputSchema)).toBe(true);
  expect(ajv.validateSchema(outputSchema)).toBe(true);
  const response = await client.callTool({
    name: "list_frida_devices",
    arguments: {
      remote: { address: "127.0.0.1:27042", token: "synthetic-secret-token" },
    },
  });
  expect(response.isError).not.toBe(true);
  expect(JSON.stringify(response.structuredContent)).not.toContain(
    "synthetic-secret-token",
  );
  expect(ajv.validate(outputSchema, response.structuredContent)).toBe(true);
  expect(
    toolContract("list_frida_devices").outputSchema.parse(
      response.structuredContent,
    ),
  ).toEqual({
    devices: [{ device_id: "remote-device", name: "target", type: "remote" }],
    cleanup_error: null,
  });
  expect(toolContract("start_frida_session").effects.mutatesTarget).toBe(true);

  await expectFridaSelectorGuidance(client, tools);

  await expectFridaProcessDiscovery(client);

  const started = await client.callTool({
    name: "start_frida_session",
    arguments: {
      mode: "attach",
      pid: 10,
      remote: { address: "127.0.0.1:27042", token: "synthetic-secret-token" },
    },
  });
  expect(started.isError).not.toBe(true);
  expect(JSON.stringify(started.structuredContent)).not.toContain(
    "synthetic-secret-token",
  );
  const loaded = await client.callTool({
    name: "load_frida_script",
    arguments: {
      session_id: "00000000-0000-4000-8000-000000000001",
      source_kind: "inline",
      source: "send('loaded');",
    },
  });
  expect(loaded.isError).not.toBe(true);
  expect(JSON.stringify(loaded.structuredContent)).not.toContain(
    "synthetic-secret-token",
  );
  const loadedValue = loaded.structuredContent;
  if (
    loadedValue === undefined ||
    typeof loadedValue !== "object" ||
    loadedValue === null ||
    !("evidence_id" in loadedValue) ||
    typeof loadedValue.evidence_id !== "string"
  )
    throw new Error("Expected inline Frida Evidence");
  const retainedEvidence = session.evidenceById(loadedValue.evidence_id);
  expect(JSON.stringify(retainedEvidence)).not.toContain(
    "synthetic-secret-token",
  );

  for (const [name, args] of [
    [
      "resume_frida_session",
      { session_id: "00000000-0000-4000-8000-000000000001" },
    ],
    [
      "unload_frida_script",
      {
        session_id: "00000000-0000-4000-8000-000000000001",
        script_id: "00000000-0000-4000-8000-000000000002",
      },
    ],
    [
      "frida_session_status",
      { session_id: "00000000-0000-4000-8000-000000000001" },
    ],
    [
      "close_frida_session",
      { session_id: "00000000-0000-4000-8000-000000000001" },
    ],
  ] as const) {
    const result = await client.callTool({ name, arguments: args });
    expect(
      result.isError,
      `${name}: ${JSON.stringify(result.structuredContent)}`,
    ).not.toBe(true);
  }

  const invalidAddress = await client.callTool({
    name: "list_frida_devices",
    arguments: {
      remote: { address: "tcp://127.0.0.1:27042?token=synthetic-secret-token" },
    },
  });
  expect(invalidAddress.isError).toBe(true);

  const oneShot = await client.callTool({
    name: "instrument_with_frida",
    arguments: {
      mode: "attach",
      pid: 10,
      source_kind: "inline",
      source: "send('one-shot');",
      duration_ms: 0,
    },
  });
  expect(oneShot.isError).not.toBe(true);
  const oneShotContract = tools.find(
    (tool) => tool.name === "instrument_with_frida",
  );
  if (oneShotContract?.outputSchema === undefined)
    throw new Error("Missing one-shot Frida output schema");
  const validateOneShot = ajv.compile(
    oneShotContract.outputSchema as AnySchema,
  );
  expect(validateOneShot(oneShot.structuredContent)).toBe(true);

  await expectFridaToolsAvailable(client);
});

it("reports Frida tools as unavailable after the optional binding fails to load", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Binary provider must not start");
  });
  const provider = new FridaInstrumentationManager({
    deviceManagerLoader: async () => {
      throw new Error("Cannot find package 'frida'");
    },
  });
  const server = createServer(
    { kind: "session", session },
    { fridaInstrumentation: provider },
  );
  const client = new Client(
    { name: "frida-optional-binding", version: "1" },
    { jsonSchemaValidator: schemaValidation },
  );
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const missing = await client.callTool({
    name: "list_frida_devices",
    arguments: {},
  });
  expect(missing.isError).toBe(true);

  const inventory = await client.callTool({
    name: "binary_session",
    arguments: {},
  });
  const parsedInventory = toolContract("binary_session").outputSchema.safeParse(
    inventory.structuredContent,
  );
  if (!parsedInventory.success)
    throw new Error("Invalid binary session output");
  expect(
    expandToolAvailability(parsedInventory.data.result.tool_availability),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "list_frida_devices",
        available: false,
        reason: "provider_unavailable",
        remediation: expect.stringContaining("Cannot find package 'frida'"),
      }),
    ]),
  );
});

it("retains cancellation Evidence after the MCP client stops waiting", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Binary provider must not start");
  });
  let finishLoad: (() => void) | undefined;
  const loadGate = new Promise<void>((resolve) => {
    finishLoad = resolve;
  });
  let markLoadStarted: (() => void) | undefined;
  const loadStarted = new Promise<void>((resolve) => {
    markLoadStarted = resolve;
  });
  let markSessionClosed: (() => void) | undefined;
  const sessionClosed = new Promise<void>((resolve) => {
    markSessionClosed = resolve;
  });
  const provider = createFridaTestProvider({
    async loadScript() {
      markLoadStarted?.();
      await loadGate;
      return {
        ok: true,
        value: {
          scriptId: "00000000-0000-4000-8000-000000000002",
          sourceKind: "inline",
          sourcePath: null,
          sourceSha256: "a".repeat(64),
          messages: [{ type: "send", payload: "cancel-observed" }],
          messagesTruncated: false,
        },
      };
    },
    status(sessionId) {
      return {
        sessionId,
        deviceId: "remote-device",
        target: "fixture",
        pid: 10,
        mode: "attach",
        state: "running",
        targetResumeObserved: false,
        scripts: [],
        messages: [{ type: "send", payload: "cancel-observed" }],
        messagesTruncated: false,
      };
    },
    async closeSession() {
      markSessionClosed?.();
      return { ok: true, value: { targetResumeObserved: false } };
    },
  });
  const server = createServer(
    { kind: "session", session },
    { fridaInstrumentation: provider },
  );
  const client = new Client(
    { name: "frida-cancellation", version: "1" },
    { jsonSchemaValidator: schemaValidation },
  );
  const controller = new AbortController();
  onTestFinished(async () => {
    finishLoad?.();
    controller.abort();
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const call = client.callTool(
    {
      name: "instrument_with_frida",
      arguments: {
        mode: "attach",
        pid: 10,
        source_kind: "inline",
        source: "send('cancel-observed');",
        duration_ms: 1_000,
      },
    },
    { signal: controller.signal },
  );
  await loadStarted;
  controller.abort(new Error("cancel Frida observation"));
  finishLoad?.();
  await expect(call).rejects.toThrow("cancel Frida observation");
  await sessionClosed;
  await client.ping();

  const bundle = await client.callTool({
    name: "get_evidence_bundle",
    arguments: {},
  });
  expect(bundle.isError).not.toBe(true);
  expect(parseMcpEvidenceBundle(bundle).records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        operation: "instrument_with_frida",
        normalized_result: expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ payload: "cancel-observed" }),
          ]),
        }),
      }),
    ]),
  );
});
