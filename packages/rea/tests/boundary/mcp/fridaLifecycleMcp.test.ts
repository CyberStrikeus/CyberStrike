import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type {
  Device,
  DeviceManager,
  FridaMessage,
  Script,
  Session,
} from "frida";
import { expect, it, onTestFinished, vi } from "vitest";

import { FridaScriptLoadCancelledError } from "../../../src/application/frida/FridaInstrumentationPort.js";
import type {
  FridaInstrumentationPort,
  FridaScriptObservation,
} from "../../../src/application/frida/FridaInstrumentationPort.js";
import type { EvidenceWriter } from "../../../src/application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import {
  expandToolAvailability,
  toolAvailabilityInventory,
} from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import type { AnalysisPartialObservation } from "../../../src/domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { EvidenceIntegrityError } from "../../../src/domain/evidenceErrors.js";
import { evidenceBundleSchema } from "../../../src/domain/evidenceBundle.js";
import { fridaSessionStatusSchema } from "../../../src/domain/fridaSessionStatus.js";
import type { Evidence } from "../../../src/domain/evidence.js";
import { jsonObjectSchema } from "../../../src/domain/jsonValue.js";
import { nativeCallPartialObservationSchema } from "../../../src/domain/native/nativeCallPartialObservation.js";
import { err, ok } from "../../../src/domain/result.js";
import { FridaInstrumentationManager } from "../../../src/frida/FridaInstrumentationManager.js";
import { silentLogger } from "../../../src/logger.js";
import { createServer } from "../../../src/server/createServer.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { registerFridaTools } from "../../../src/server/registerFridaTools.js";
import { ToolResultDelivery } from "../../../src/server/ToolResultDelivery.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const gate = () => {
  let markEntered = () => {};
  let release = () => {};
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    entered,
    release,
    async wait() {
      markEntered();
      await released;
    },
  };
};

const nativeFixture = () => {
  const created: string[] = [];
  const loaded: string[] = [];
  const unloaded: string[] = [];
  const scripts: Script[] = [];
  const scriptsAtResume: string[][] = [];
  const controls = {
    attach: async () => {},
    create: async () => {},
    load: async () => {},
    resume: async () => {},
    detach: async () => {},
    afterLoad: () => {},
    discover: async () => {},
    unloadFailures: 0,
    detachFailures: 0,
    detachCalls: 0,
    resumes: 0,
    remoteRemovals: 0,
    removalFailures: 0,
    message: undefined as FridaMessage | undefined,
  };
  let detached = false;
  let onDetached: (() => void) | undefined;
  const markDetached = () => {
    detached = true;
    onDetached?.();
  };
  const nativeSession: Session = {
    pid: 512,
    detached: {
      connect(listener) {
        onDetached = listener;
      },
      disconnect() {
        onDetached = undefined;
      },
    },
    isDetached: () => detached,
    async detach() {
      controls.detachCalls += 1;
      await controls.detach();
      if (controls.detachFailures > 0) {
        controls.detachFailures -= 1;
        throw new Error("transient detach failure");
      }
      markDetached();
    },
    async createScript(source) {
      created.push(source);
      await controls.create();
      let destroyed = false;
      let listener:
        | ((message: FridaMessage, data: Buffer | null) => void)
        | undefined;
      const script: Script = {
        get isDestroyed() {
          return destroyed;
        },
        message: {
          connect(handler) {
            listener = handler;
          },
          disconnect() {
            listener = undefined;
          },
        },
        async load() {
          await controls.load();
          loaded.push(source);
          listener?.(
            controls.message ?? { type: "send", payload: source },
            null,
          );
          controls.afterLoad();
        },
        async unload() {
          unloaded.push(source);
          if (controls.unloadFailures > 0) {
            controls.unloadFailures -= 1;
            throw new Error("transient unload failure");
          }
          destroyed = true;
        },
      };
      scripts.push(script);
      return script;
    },
  };
  const device: Device = {
    id: "local",
    name: "Local fixture",
    type: "local",
    async enumerateProcesses() {
      await controls.discover();
      return [{ pid: 512, name: "fixture" }];
    },
    async getProcessByPid() {
      return { pid: 512, name: "fixture" };
    },
    async spawn() {
      return 512;
    },
    async resume() {
      scriptsAtResume.push(
        created.filter((_, index) => scripts[index]?.isDestroyed === false),
      );
      controls.resumes += 1;
      await controls.resume();
    },
    async attach() {
      await controls.attach();
      return nativeSession;
    },
  };
  const deviceManager: DeviceManager = {
    async enumerateDevices() {
      return [device];
    },
    async getDeviceById() {
      return device;
    },
    async addRemoteDevice() {
      return device;
    },
    async removeRemoteDevice() {
      controls.remoteRemovals += 1;
      if (controls.removalFailures > 0) {
        controls.removalFailures -= 1;
        throw new Error("transient remote removal failure");
      }
    },
  };
  return {
    controls,
    created,
    loaded,
    unloaded,
    scripts,
    scriptsAtResume,
    deviceManager,
    markDetached,
  };
};

const connectedFixture = async () => {
  const native = nativeFixture();
  const manager = new FridaInstrumentationManager({
    deviceManager: native.deviceManager,
  });
  const session = createTestBinarySession(() => {
    throw new Error("Binary provider must not start");
  });
  const server = createServer(
    { kind: "session", session },
    { fridaInstrumentation: manager },
  );
  const client = new Client({ name: "frida-lifecycle", version: "1" });
  onTestFinished(async () => {
    native.controls.detachFailures = 0;
    native.controls.removalFailures = 0;
    await client.close();
    await server.close();
    await manager.closeAll();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const start = async () => {
    const result = await client.callTool({
      name: "start_frida_session",
      arguments: {
        mode: "spawn",
        program: "/fixture",
        device_id: "local",
      },
    });
    return toolContract("start_frida_session").outputSchema.parse(
      result.structuredContent,
    ).session_id;
  };
  const load = (sessionId: string, source: string, signal?: AbortSignal) =>
    client.callTool(
      {
        name: "load_frida_script",
        arguments: { session_id: sessionId, source_kind: "inline", source },
      },
      signal === undefined ? undefined : { signal },
    );
  return { ...native, manager, session, server, client, start, load };
};

it.each(["attached", "during-resume", "after-resume"] as const)(
  "preserves observed detachment through resume settlement: %s",
  async (timing) => {
    const fixture = await connectedFixture();
    const held = gate();
    onTestFinished(held.release);
    fixture.controls.resume = held.wait;
    const id = await fixture.start();
    const state = async () => {
      const result = await fixture.client.callTool({
        name: "frida_session_status",
        arguments: { session_id: id },
      });
      return fridaSessionStatusSchema.parse(
        toolContract("frida_session_status").outputSchema.parse(
          result.structuredContent,
        ).normalized_result,
      ).state;
    };
    const resuming = fixture.client.callTool({
      name: "resume_frida_session",
      arguments: { session_id: id },
    });
    await held.entered;
    if (timing === "during-resume") fixture.markDetached();
    expect(await state()).toBe(
      timing === "during-resume" ? "detached" : "paused",
    );
    held.release();
    const resumed = await resuming;
    expect(resumed.isError).not.toBe(true);
    expect(resumed.structuredContent).toEqual({ state: "running" });
    if (timing === "after-resume") fixture.markDetached();
    const expected = timing === "attached" ? "running" : "detached";
    expect(await state()).toBe(expected);
    expect(await state()).toBe(expected);
    expect(fixture.manager.status(id)?.targetResumeObserved).toBe(true);
  },
);

it("retains detached state and resume evidence when remote cleanup needs retry", async () => {
  const fixture = await connectedFixture();
  expect(
    (await fixture.client.listTools()).tools.find(
      (tool) => tool.name === "close_frida_session",
    )?.annotations?.destructiveHint,
  ).toBe(true);
  const inventory = await fixture.client.callTool({
    name: "binary_session",
    arguments: { detail: "complete" },
  });
  const availability = expandToolAvailability(
    toolAvailabilityInventory.parse(
      toolContract("binary_session").outputSchema.parse(
        inventory.structuredContent,
      ).result.tool_availability,
    ),
  );
  expect(
    availability.find((tool) => tool.name === "close_frida_session"),
  ).toMatchObject({
    effects: { executesForeignCode: true },
    annotations: { destructive: true },
  });
  const started = await fixture.client.callTool({
    name: "start_frida_session",
    arguments: {
      mode: "spawn",
      program: "/fixture",
      remote: { address: "127.0.0.1:27042" },
    },
  });
  const id = toolContract("start_frida_session").outputSchema.parse(
    started.structuredContent,
  ).session_id;
  fixture.controls.removalFailures = 1;
  const close = () =>
    fixture.client.callTool({
      name: "close_frida_session",
      arguments: { session_id: id },
    });
  expect((await close()).isError).toBe(true);
  const result = await fixture.client.callTool({
    name: "frida_session_status",
    arguments: { session_id: id },
  });
  expect(
    fridaSessionStatusSchema.parse(
      toolContract("frida_session_status").outputSchema.parse(
        result.structuredContent,
      ).normalized_result,
    ).state,
  ).toBe("detached");
  expect(fixture.manager.status(id)?.targetResumeObserved).toBe(true);
  expect(fixture.controls.detachCalls).toBe(1);
  expect(fixture.controls.resumes).toBe(1);
  expect((await close()).isError).not.toBe(true);
  expect(fixture.manager.status(id)).toBeUndefined();
  expect(fixture.controls.detachCalls).toBe(1);
  expect(fixture.controls.resumes).toBe(1);
  expect(fixture.controls.remoteRemovals).toBe(2);
});

it.each([
  { cancel: false, detachFails: false },
  { cancel: true, detachFails: false },
  { cancel: false, detachFails: true },
  { cancel: true, detachFails: true },
])(
  "classifies server completion after final detach (cancel=$cancel, detachFails=$detachFails)",
  async ({ cancel, detachFails }) => {
    const fixture = await connectedFixture();
    const held = gate();
    onTestFinished(held.release);
    fixture.controls.detach = held.wait;
    fixture.controls.detachFailures = detachFails ? 1 : 0;
    let serverSignal: AbortSignal | undefined;
    const load = fixture.manager.loadScript.bind(fixture.manager);
    const loadSpy = vi
      .spyOn(fixture.manager, "loadScript")
      .mockImplementation((id, source, signal) => {
        serverSignal = signal;
        return load(id, source, signal);
      });
    const success = vi.spyOn(
      ToolResultDelivery.prototype,
      "toEvidenceToolResult",
    );
    const partial = vi.spyOn(
      ToolResultDelivery.prototype,
      "toPartialErrorToolResult",
    );
    onTestFinished(() => {
      loadSpy.mockRestore();
      success.mockRestore();
      partial.mockRestore();
    });
    const controller = new AbortController();
    const pending = fixture.client
      .callTool(
        {
          name: "instrument_with_frida",
          arguments: {
            mode: "attach",
            pid: 512,
            device_id: "local",
            source_kind: "inline",
            source: "completed-before-detach",
            duration_ms: 0,
          },
        },
        { signal: controller.signal },
      )
      .then(
        (value) => ({ kind: "result" as const, value }),
        (cause: unknown) => ({ kind: "rejected" as const, cause }),
      );
    await held.entered;
    expect(fixture.unloaded).toEqual(["completed-before-detach"]);
    if (cancel) {
      controller.abort(new Error("cancel during final detach"));
      await fixture.client.ping();
    }
    expect(serverSignal?.aborted).toBe(cancel);
    const serverReason: unknown = serverSignal?.reason;
    held.release();
    const result = await pending;
    await vi.waitFor(() =>
      expect(success.mock.calls.length + partial.mock.calls.length).toBe(1),
    );
    expect(fixture.controls.detachCalls).toBe(1);
    expect(fixture.controls.resumes).toBe(0);
    const records = fixture.session
      .exportEvidenceBundle()
      .records.filter((record) => record.operation === "instrument_with_frida");
    expect(records).toHaveLength(1);
    const evidence = records[0];
    expect(evidence).toMatchObject({
      normalized_result: {
        messages: [{ type: "send", payload: "completed-before-detach" }],
        cleanup_error: detachFails
          ? expect.stringContaining("transient detach failure")
          : null,
      },
    });
    const sessionId = String(evidence?.parameters.session_id);
    expect(fixture.manager.status(sessionId) !== undefined).toBe(detachFails);
    if (cancel) {
      expect(result.kind).toBe("rejected");
      expect(success).not.toHaveBeenCalled();
      const error = partial.mock.calls[0]?.[0];
      expect(error).toBeInstanceOf(AnalysisCancelledError);
      expect(error?.cause).toBe(serverReason);
      if (detachFails)
        expect(error?.cleanup).toMatchObject({ resources: [sessionId] });
      else expect(error?.cleanup).toBeUndefined();
      expect(error?.partialObservation).toEqual(evidence);
      expect(evidence).toMatchObject({
        normalized_result: {
          instrumentation_cleanup: detachFails
            ? "incomplete_or_unknown"
            : "released",
          target_state_before_cleanup: "running",
          target_resume_observed: false,
          target_liveness_after_cleanup: "unknown",
        },
      });
    } else {
      expect(result.kind).toBe("result");
      if (result.kind !== "result") throw result.cause;
      expect(result.value.isError).not.toBe(true);
      expect(partial).not.toHaveBeenCalled();
      expect(success).toHaveBeenCalledOnce();
    }
    if (detachFails) {
      const retried = await fixture.client.callTool({
        name: "close_frida_session",
        arguments: { session_id: sessionId },
      });
      expect(retried.isError).not.toBe(true);
      expect(fixture.controls.detachCalls).toBe(2);
      expect(fixture.manager.status(sessionId)).toBeUndefined();
      expect(fixture.unloaded).toEqual(["completed-before-detach"]);
    }
  },
);

it.each([
  ["a trailing high surrogate", "x".repeat(32_765) + "\ud800"],
  ["repeated high surrogates", "\ud800".repeat(10_922)],
])(
  "retains bounded Frida error text through MCP for %s",
  async (_name, description) => {
    const { controls, client, start, load } = await connectedFixture();
    controls.message = { type: "error", description };
    const sessionId = await start();
    const response = await load(sessionId, "// inert fixture");
    expect(response.isError).not.toBe(true);
    const evidence = toolContract("load_frida_script").outputSchema.parse(
      response.structuredContent,
    );
    const result = evidence.normalized_result;
    expect(result.messages_truncated).toBe(false);
    const retained = jsonObjectSchema.parse(result.messages[0]);
    expect(retained.description_truncated).toBe(true);
    expect(
      Buffer.byteLength(JSON.stringify(retained.description)) - 2,
    ).toBeLessThanOrEqual(32_768);
    const status = await client.callTool({
      name: "frida_session_status",
      arguments: { session_id: sessionId },
    });
    expect(status.isError).not.toBe(true);
    expect(
      toolContract("frida_session_status").outputSchema.parse(
        status.structuredContent,
      ),
    ).toMatchObject({
      normalized_result: { messages: [retained], messages_truncated: false },
    });
  },
);

it("preserves the native resume failure after MCP cancellation reaches the server", async () => {
  const fixture = await connectedFixture();
  const held = gate();
  onTestFinished(held.release);
  fixture.controls.resume = async () => {
    await held.wait();
    fixture.controls.resume = async () => {};
    throw new Error("native resume rejected");
  };
  const delivery = vi.spyOn(ToolResultDelivery.prototype, "toErrorToolResult");
  onTestFinished(() => delivery.mockRestore());
  let serverSignal: AbortSignal | undefined;
  const resume = fixture.manager.resumeSession.bind(fixture.manager);
  const resumeSpy = vi
    .spyOn(fixture.manager, "resumeSession")
    .mockImplementation((id, signal) => {
      serverSignal = signal;
      return resume(id, signal);
    });
  onTestFinished(() => resumeSpy.mockRestore());
  const controller = new AbortController();
  const pending = fixture.client
    .callTool(
      {
        name: "instrument_with_frida",
        arguments: {
          mode: "spawn",
          program: "/fixture",
          device_id: "local",
          source_kind: "inline",
          source: "resume-failure",
          duration_ms: 0,
        },
      },
      { signal: controller.signal },
    )
    .catch((cause: unknown) => cause);
  await held.entered;
  controller.abort(new Error("cancel pending resume"));
  await fixture.client.ping();
  expect(serverSignal?.aborted).toBe(true);
  held.release();
  await pending;
  await vi.waitFor(() => expect(delivery).toHaveBeenCalledOnce());
  expect(delivery.mock.calls[0]?.[0]).toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    operation: "resume_frida_session",
    message: expect.stringContaining("native resume rejected"),
  });
  expect(fixture.controls.detachCalls).toBe(1);
  expect(fixture.unloaded).toEqual(["resume-failure"]);
  expect(
    fixture.session
      .exportEvidenceBundle()
      .records.filter((record) => record.operation === "instrument_with_frida"),
  ).toEqual([]);
});

it("declares non-destructive session mutation when status retains Evidence", async () => {
  const { client, start } = await connectedFixture();
  const id = await start();
  const bundle = async () => {
    const response = await client.callTool({
      name: "get_evidence_bundle",
      arguments: {},
    });
    expect(response.isError).not.toBe(true);
    return evidenceBundleSchema.parse(
      toolContract("get_evidence_bundle").outputSchema.parse(
        response.structuredContent,
      ).result,
    );
  };
  expect((await bundle()).records).toHaveLength(0);
  const response = await client.callTool({
    name: "frida_session_status",
    arguments: { session_id: id },
  });
  expect(response.isError).not.toBe(true);
  const evidence = toolContract("frida_session_status").outputSchema.parse(
    response.structuredContent,
  );
  expect(evidence).toMatchObject({
    operation: "frida_session_status",
    parameters: { session_id: id },
    normalized_result: {
      session_id: id,
      state: "paused",
      mode: "spawn",
      scripts: [],
      messages: [],
      messages_truncated: false,
    },
  });
  expect((await bundle()).records).toEqual([evidence]);

  const tools = (await client.listTools()).tools;
  expect(
    tools.find((tool) => tool.name === "frida_session_status")?.annotations,
  ).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  const inventory = await client.callTool({
    name: "binary_session",
    arguments: { detail: "complete" },
  });
  expect(inventory.isError).not.toBe(true);
  const available = expandToolAvailability(
    toolAvailabilityInventory.parse(
      toolContract("binary_session").outputSchema.parse(
        inventory.structuredContent,
      ).result.tool_availability,
    ),
  );
  expect(
    available.find((tool) => tool.name === "frida_session_status"),
  ).toMatchObject({
    effects: {
      mutatesSession: true,
      mutatesTarget: false,
      executesForeignCode: false,
      mayDiscardData: false,
    },
    annotations: { read_only: false, destructive: false },
  });

  const missing = await client.callTool({
    name: "frida_session_status",
    arguments: { session_id: "00000000-0000-4000-8000-000000000000" },
  });
  expect(parseMcpToolError(missing)).toMatchObject({
    error: { code: "invalid_request" },
  });
  expect((await bundle()).records).toEqual([evidence]);
});

type PartialRecording = "acknowledged" | "failed" | "unavailable";
type PartialObservation = "evidence" | "non-evidence" | "unavailable";

const unusedFridaPortMethod = (): never => {
  throw new Error("Unused Frida test port method");
};

const nonEvidencePartialObservation = (): AnalysisPartialObservation =>
  nativeCallPartialObservationSchema.parse({
    kind: "native-call-observation",
    target: {
      path: "/fixture/target",
      sha256: "b".repeat(64),
      architecture: "arm64",
      arguments: [],
      environment: {},
      working_directory: null,
    },
    process: {
      pid: null,
      stdout: null,
      stderr: null,
      other_stops: [],
    },
    debugger: { version: null },
    events: [],
    coverage: { status: "partial", reason: "cancelled" },
    limitations: [],
  });

const callPartialFridaLoadError = async (
  recording: PartialRecording,
  partial: PartialObservation,
) => {
  const script: FridaScriptObservation = {
    scriptId: "00000000-0000-4000-8000-000000000002",
    sourceKind: "inline",
    sourcePath: null,
    sourceSha256: "a".repeat(64),
    messages: [{ type: "send", payload: "partial" }],
    messagesTruncated: false,
  };
  const failure =
    partial === "evidence"
      ? new FridaScriptLoadCancelledError(script)
      : new AnalysisCancelledError(
          "load_frida_script",
          partial === "non-evidence"
            ? { partialObservation: nonEvidencePartialObservation() }
            : {},
        );
  const provider: FridaInstrumentationPort = {
    async listDevices() {
      return unusedFridaPortMethod();
    },
    async listProcesses() {
      return unusedFridaPortMethod();
    },
    async startSession() {
      return unusedFridaPortMethod();
    },
    async loadScript() {
      return err(failure);
    },
    async resumeSession() {
      return unusedFridaPortMethod();
    },
    async unloadScript() {
      return unusedFridaPortMethod();
    },
    status() {
      return unusedFridaPortMethod();
    },
    async closeSession() {
      return unusedFridaPortMethod();
    },
    async closeAll() {
      return unusedFridaPortMethod();
    },
  };
  const attempts: Evidence[] = [];
  const recordEvidence: EvidenceWriter["recordEvidence"] | undefined =
    recording === "unavailable"
      ? undefined
      : (evidence) => {
          attempts.push(evidence);
          return recording === "acknowledged"
            ? ok("added" as const)
            : err(new EvidenceIntegrityError("sentinel record failure"));
        };
  const delivery = createToolResultDelivery(1024 * 1024);
  const server = new EvidenceMcpServer(
    { name: "frida-partial-probe", version: "1" },
    { capabilities: {} },
    recordEvidence,
    delivery,
  );
  registerFridaTools(server, provider, silentLogger, delivery, recordEvidence);
  const client = new Client({
    name: "frida-partial-probe-client",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const response = await client.callTool({
      name: "load_frida_script",
      arguments: {
        session_id: "00000000-0000-4000-8000-000000000001",
        source_kind: "inline",
        source: "send('partial');",
      },
    });
    return {
      response,
      error: parseMcpToolError(response).error,
      attempts,
    };
  } finally {
    await client.close();
    await server.close();
  }
};

it("projects acknowledged Frida partial Evidence as a retained reference", async () => {
  const { response, error, attempts } = await callPartialFridaLoadError(
    "acknowledged",
    "evidence",
  );
  expect(response.isError).toBe(true);
  expect(response.structuredContent).toBeUndefined();
  expect(attempts).toHaveLength(1);
  const details = jsonObjectSchema.parse(error.details);
  expect(details.partial_observation).toEqual({
    kind: "retained-evidence",
    evidence_id: attempts[0]?.evidence_id,
  });
});

it("preserves inline Frida partial Evidence when its writer rejects it", async () => {
  const { response, error, attempts } = await callPartialFridaLoadError(
    "failed",
    "evidence",
  );
  expect(response.isError).toBe(true);
  expect(response.structuredContent).toBeUndefined();
  expect(attempts).toHaveLength(1);
  expect(error.code).toBe("cancelled");
  const details = jsonObjectSchema.parse(error.details);
  expect(details.partial_observation).toEqual(attempts[0]);
});

it.each([
  ["unavailable writer", "unavailable", "evidence"],
  ["non-Evidence partial", "acknowledged", "non-evidence"],
  ["missing partial", "acknowledged", "unavailable"],
] as const)(
  "preserves Frida error projection for %s",
  async (_, recording, partial) => {
    const { response, error, attempts } = await callPartialFridaLoadError(
      recording,
      partial,
    );
    expect(response.isError).toBe(true);
    expect(response.structuredContent).toBeUndefined();
    const details = jsonObjectSchema.parse(error.details);
    if (partial === "evidence") {
      expect(details.partial_observation).toMatchObject({
        operation: "load_frida_script",
        normalized_result: {
          script_id: "00000000-0000-4000-8000-000000000002",
        },
      });
    } else if (partial === "non-evidence") {
      expect(details.partial_observation).toEqual(
        nonEvidencePartialObservation(),
      );
    } else {
      expect(details).not.toHaveProperty("partial_observation");
    }
    expect(attempts).toHaveLength(
      partial === "evidence" && recording !== "unavailable" ? 1 : 0,
    );
  },
);

const scriptLoadFixture = async (stage: "create" | "load" = "load") => {
  const fixture = await connectedFixture();
  const id = await fixture.start();
  const original = await fixture.load(id, "original");
  const held = gate();
  onTestFinished(held.release);
  fixture.controls[stage] = held.wait;
  return { fixture, id, original, held };
};

const pendingShutdown = async (server: { close(): Promise<void> }) => {
  let closed = false;
  const closing = server
    .close()
    .then(
      () => undefined,
      (cause: unknown) => cause,
    )
    .finally(() => {
      closed = true;
    });
  await setImmediate();
  expect(closed).toBe(false);
  return { closing };
};

const retryCancelledScriptUnload = async (
  fixture: Awaited<ReturnType<typeof connectedFixture>>,
  sessionId: string,
  scriptId = fixture.manager.status(sessionId)?.scripts[1]?.scriptId,
) => {
  if (scriptId === undefined)
    throw new Error("Cancelled script was not retained");
  const retry = await fixture.client.callTool({
    name: "unload_frida_script",
    arguments: {
      session_id: sessionId,
      script_id: scriptId,
    },
  });
  expect(retry.isError).not.toBe(true);
};

const retainedScriptObservation = async (
  fixture: Awaited<ReturnType<typeof connectedFixture>>,
  sessionId: string,
  source: string,
) => {
  const response = await fixture.client.callTool({
    name: "get_evidence_bundle",
    arguments: {},
  });
  const bundle = evidenceBundleSchema.parse(
    toolContract("get_evidence_bundle").outputSchema.parse(
      response.structuredContent,
    ).result,
  );
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  const records = bundle.records.filter((record) => {
    const result = record.normalized_result;
    return (
      record.operation === "load_frida_script" &&
      result !== null &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      result.source_sha256 === sourceSha256
    );
  });
  expect(records).toHaveLength(1);
  expect(records[0]?.parameters).toEqual({ session_id: sessionId });
  const observation = records[0]?.normalized_result;
  if (
    observation === undefined ||
    observation === null ||
    typeof observation !== "object" ||
    Array.isArray(observation)
  )
    throw new Error("Missing retained script observation");
  expect(observation).toMatchObject({
    script_id: expect.any(String),
    source_kind: "inline",
    source_path: null,
    source_sha256: sourceSha256,
    messages_truncated: false,
  });
  return observation;
};

it.each(["load", "resume", "unload"] as const)(
  "finishes an earlier MCP %s request before closing its Frida session",
  async (operation) => {
    const fixture = await connectedFixture();
    const id = await fixture.start();
    const original = await fixture.load(id, "original");
    const scriptId = toolContract("load_frida_script").outputSchema.parse(
      original.structuredContent,
    ).normalized_result.script_id;
    const pending = fixture.client.callTool({
      name: {
        load: "load_frida_script",
        resume: "resume_frida_session",
        unload: "unload_frida_script",
      }[operation],
      arguments: {
        session_id: id,
        ...(operation === "load"
          ? { source_kind: "inline", source: "last-script" }
          : {}),
        ...(operation === "unload" ? { script_id: scriptId } : {}),
      },
    });
    const closing = fixture.client.callTool({
      name: "close_frida_session",
      arguments: { session_id: id },
    });
    expect((await pending).isError).not.toBe(true);
    expect((await closing).isError).not.toBe(true);
    expect(fixture.loaded).toEqual(
      operation === "load" ? ["original", "last-script"] : ["original"],
    );
    expect(fixture.unloaded).toEqual(fixture.loaded);
    expect(fixture.controls.detachCalls).toBe(1);
    expect(fixture.controls.resumes).toBe(1);
    expect(fixture.manager.status(id)).toBeUndefined();
  },
);

it.each(["load", "resume", "unload"] as const)(
  "does not dispatch a cancelled queued Frida %s through MCP",
  async (operation) => {
    const { fixture, id, original, held } = await scriptLoadFixture();
    const scriptId = toolContract("load_frida_script").outputSchema.parse(
      original.structuredContent,
    ).normalized_result.script_id;
    const first = fixture.load(id, "blocking");
    await held.entered;
    const controller = new AbortController();
    const cancelled =
      operation === "load"
        ? fixture.load(id, "cancelled", controller.signal)
        : fixture.client.callTool(
            {
              name:
                operation === "resume"
                  ? "resume_frida_session"
                  : "unload_frida_script",
              arguments: {
                session_id: id,
                ...(operation === "unload" ? { script_id: scriptId } : {}),
              },
            },
            { signal: controller.signal },
          );
    const rejected = expect(cancelled).rejects.toThrow(
      "cancel queued operation",
    );
    await fixture.client.ping();
    controller.abort(new Error("cancel queued operation"));
    await fixture.client.ping();
    await rejected;
    held.release();
    await first;
    await fixture.load(id, "barrier");
    expect(fixture.created).toEqual(["original", "blocking", "barrier"]);
    expect(fixture.unloaded).toEqual([]);
    expect(fixture.controls.resumes).toBe(0);
    expect(fixture.manager.status(id)?.scripts).toHaveLength(3);
  },
);

it.each(["create", "load"] as const)(
  "releases only the new script when MCP cancellation arrives during native %s",
  async (stage) => {
    const { fixture, id, held } = await scriptLoadFixture(stage);
    const controller = new AbortController();
    const cancelled = fixture.load(id, "cancelled-native", controller.signal);
    const rejected = expect(cancelled).rejects.toThrow(
      "cancel native operation",
    );
    await held.entered;
    controller.abort(new Error("cancel native operation"));
    await fixture.client.ping();
    await rejected;
    held.release();
    await fixture.load(id, "barrier");
    await fixture.client.ping();
    expect(fixture.unloaded).toEqual(["cancelled-native"]);
    expect(fixture.loaded).toEqual(
      stage === "create"
        ? ["original", "barrier"]
        : ["original", "cancelled-native", "barrier"],
    );
    expect(fixture.controls.detachCalls).toBe(0);
    expect(fixture.controls.resumes).toBe(0);
    expect(fixture.manager.status(id)?.scripts).toHaveLength(2);
    const observation = await retainedScriptObservation(
      fixture,
      id,
      "cancelled-native",
    );
    expect(observation).toMatchObject({
      messages:
        stage === "create"
          ? []
          : [expect.objectContaining({ payload: "cancelled-native" })],
      script_cleanup: "released",
      cleanup_error: null,
    });
  },
);

it("retains cancellation source facts without claiming native creation when no script handle returns", async () => {
  const { fixture, id, held } = await scriptLoadFixture("create");
  fixture.controls.create = async () => {
    await held.wait();
    throw new Error("native create rejected");
  };
  const controller = new AbortController();
  const loading = fixture
    .load(id, "no-returned-handle", controller.signal)
    .catch((cause: unknown) => cause);
  await held.entered;
  controller.abort(new Error("cancel while creating"));
  await fixture.client.ping();
  held.release();
  await loading;
  fixture.controls.create = async () => {};
  await fixture.load(id, "barrier");
  await fixture.client.ping();
  const observation = await retainedScriptObservation(
    fixture,
    id,
    "no-returned-handle",
  );
  expect(observation).toMatchObject({
    messages: [],
    script_cleanup: "no_handle",
    cleanup_error: null,
  });
  expect(fixture.unloaded).toEqual([]);
  expect(fixture.scripts).toHaveLength(2);
  expect(fixture.controls.detachCalls).toBe(0);
  expect(fixture.controls.resumes).toBe(0);
});

it("retains original malformed file identity and decoded representation through a rejected cancelled MCP load", async () => {
  const { fixture, id, held } = await scriptLoadFixture();
  const directory = await mkdtemp(join(tmpdir(), "rea-frida-file-cancel-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "script.js");
  const bytes = Buffer.from([0x2f, 0x2f, 0xff, 0x0a]);
  await writeFile(path, bytes);
  const decodedSource = bytes.toString("utf8");
  fixture.controls.afterLoad = () => {
    if (fixture.loaded.at(-1) === decodedSource)
      throw new Error("native rejection after message");
  };
  const controller = new AbortController();
  const loading = fixture.client
    .callTool(
      {
        name: "load_frida_script",
        arguments: { session_id: id, source_kind: "file", path },
      },
      { signal: controller.signal },
    )
    .catch((cause: unknown) => cause);
  await held.entered;
  controller.abort(new Error("cancel file load"));
  await fixture.client.ping();
  held.release();
  await loading;
  await fixture.load(id, "barrier");
  await fixture.client.ping();
  const response = await fixture.client.callTool({
    name: "get_evidence_bundle",
    arguments: {},
  });
  const bundle = evidenceBundleSchema.parse(
    toolContract("get_evidence_bundle").outputSchema.parse(
      response.structuredContent,
    ).result,
  );
  const records = bundle.records.filter(
    (record) =>
      record.operation === "load_frida_script" &&
      JSON.stringify(record.normalized_result).includes(path),
  );
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    normalized_result: {
      source_kind: "file",
      source_path: path,
      source_sha256: createHash("sha256").update(bytes).digest("hex"),
      messages: [expect.objectContaining({ payload: decodedSource })],
      script_cleanup: "released",
      cleanup_error: null,
    },
    raw_result: {
      source_representation: {
        encoding: "utf8",
        decoding: "replacement",
        loaded_source_sha256: createHash("sha256")
          .update(decodedSource)
          .digest("hex"),
      },
    },
    limitations: expect.arrayContaining([
      expect.stringContaining("Invalid UTF-8"),
    ]),
  });
  expect(fixture.scripts[0]?.isDestroyed).toBe(false);
  expect(fixture.scripts[1]?.isDestroyed).toBe(true);
  expect(fixture.controls.detachCalls).toBe(0);
});

it.each([
  { cancel: true, unloadFailures: 0 },
  { cancel: true, unloadFailures: 1 },
  { cancel: false, unloadFailures: 0 },
])(
  "retains rejected native-load observations through cancellation=$cancel and unload failures=$unloadFailures",
  async ({ cancel, unloadFailures }) => {
    const { fixture, id, held } = await scriptLoadFixture();
    const source = "rejecting-native";
    fixture.controls.afterLoad = () => {
      if (fixture.loaded.at(-1) === source)
        throw new Error("native load rejected after its message");
    };
    fixture.controls.unloadFailures = unloadFailures;
    const controller = new AbortController();
    const loading = fixture.load(id, source, controller.signal);
    const outcome = loading.then(
      (value) => ({ kind: "result" as const, value }),
      (cause: unknown) => ({ kind: "rejected" as const, cause }),
    );
    await held.entered;
    if (cancel) {
      controller.abort(new Error("cancel before native rejection"));
      await fixture.client.ping();
    }
    held.release();
    const result = await outcome;
    await fixture.load(id, "barrier");
    await fixture.client.ping();
    expect(fixture.controls.detachCalls).toBe(0);
    expect(fixture.controls.resumes).toBe(0);
    expect(fixture.scripts[0]?.isDestroyed).toBe(false);
    expect(fixture.scripts[1]?.isDestroyed).toBe(unloadFailures === 0);
    if (!cancel) {
      expect(result.kind).toBe("result");
      if (result.kind !== "result") throw result.cause;
      expect(parseMcpToolError(result.value).error.code).toBe(
        "capability_unavailable",
      );
      expect(
        fixture.session
          .exportEvidenceBundle()
          .records.filter(
            (record) =>
              record.operation === "load_frida_script" &&
              JSON.stringify(record.normalized_result).includes(source),
          ),
      ).toEqual([]);
      return;
    }
    expect(result.kind).toBe("rejected");
    const observation = await retainedScriptObservation(fixture, id, source);
    expect(observation).toMatchObject({
      messages: [expect.objectContaining({ payload: source })],
      script_cleanup:
        unloadFailures === 0 ? "released" : "incomplete_or_unknown",
      cleanup_error:
        unloadFailures === 0 ? null : expect.stringContaining("unload"),
    });
    if (unloadFailures > 0) {
      if (typeof observation.script_id !== "string")
        throw new Error("Missing candidate script identity");
      await retryCancelledScriptUnload(fixture, id, observation.script_id);
    }
    expect(fixture.scripts[1]?.isDestroyed).toBe(true);
    expect(fixture.manager.status(id)?.scripts).toHaveLength(2);
    expect(
      (
        await fixture.client.callTool({
          name: "frida_session_status",
          arguments: { session_id: id },
        })
      ).isError,
    ).not.toBe(true);
  },
);

it("awaits an admitted attach on server shutdown and retries failed native cleanup", async () => {
  const fixture = await connectedFixture();
  const held = gate();
  onTestFinished(held.release);
  fixture.controls.attach = held.wait;
  fixture.controls.detachFailures = 1;
  const starting = fixture.client
    .callTool({
      name: "start_frida_session",
      arguments: {
        mode: "attach",
        pid: 512,
        device_id: "local",
      },
    })
    .catch(() => undefined);
  await held.entered;
  const { closing } = await pendingShutdown(fixture.server);
  expect(fixture.controls.detachCalls).toBe(0);
  held.release();
  expect(await closing).toBeInstanceOf(AggregateError);
  await starting;
  expect(fixture.controls.detachCalls).toBe(1);
  await fixture.server.close();
  expect(fixture.controls.detachCalls).toBe(2);
  await fixture.server.close();
  expect(fixture.controls.detachCalls).toBe(2);
  const afterClose = await fixture.manager.startSession({
    mode: "attach",
    pid: 512,
  });
  expect(afterClose).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCapabilityUnavailableError" },
  });
});

it("drains remote discovery before shutdown and retains failed connection cleanup", async () => {
  const fixture = await connectedFixture();
  const held = gate();
  onTestFinished(held.release);
  fixture.controls.discover = held.wait;
  fixture.controls.removalFailures = 2;
  const discovering = fixture.client
    .callTool({
      name: "list_frida_processes",
      arguments: {
        remote: { address: "127.0.0.1:27042" },
      },
    })
    .catch(() => undefined);
  await held.entered;
  const { closing } = await pendingShutdown(fixture.server);
  held.release();
  expect(await closing).toBeInstanceOf(AggregateError);
  await discovering;
  expect(fixture.controls.remoteRemovals).toBe(2);
  await fixture.server.close();
  expect(fixture.controls.remoteRemovals).toBe(3);
});

it.each(["create", "load"] as const)(
  "retains the identity of a cancelled native %s for an explicit MCP unload retry",
  async (stage) => {
    const { fixture, id, held } = await scriptLoadFixture(stage);
    fixture.controls.unloadFailures = 1;
    const controller = new AbortController();
    const cancelled = fixture.load(id, "cancelled-native", controller.signal);
    const rejected = expect(cancelled).rejects.toThrow(
      "cancel retained script",
    );
    await held.entered;
    controller.abort(new Error("cancel retained script"));
    await fixture.client.ping();
    await rejected;
    held.release();
    await fixture.load(id, "barrier");
    await fixture.client.ping();
    expect(fixture.manager.status(id)?.scripts).toHaveLength(3);
    const observation = await retainedScriptObservation(
      fixture,
      id,
      "cancelled-native",
    );
    expect(observation).toMatchObject({
      messages:
        stage === "create"
          ? []
          : [expect.objectContaining({ payload: "cancelled-native" })],
      script_cleanup: "incomplete_or_unknown",
      cleanup_error: expect.stringContaining("transient unload failure"),
    });
    const scriptId = observation.script_id;
    if (typeof scriptId !== "string")
      throw new Error("Missing cancelled script identity");
    expect(fixture.manager.status(id)?.scripts[1]?.scriptId).toBe(scriptId);
    const resuming = await fixture.client.callTool({
      name: "resume_frida_session",
      arguments: { session_id: id },
    });
    expect(resuming.isError).toBe(true);
    expect(fixture.controls.resumes).toBe(0);
    await retryCancelledScriptUnload(fixture, id, scriptId);
    expect(fixture.unloaded).toEqual(["cancelled-native", "cancelled-native"]);
    expect(fixture.loaded).toEqual(
      stage === "create"
        ? ["original", "barrier"]
        : ["original", "cancelled-native", "barrier"],
    );
    expect(fixture.manager.status(id)?.scripts).toHaveLength(2);
    expect(fixture.controls.detachCalls).toBe(0);
  },
);

it.each([0, 1])(
  "settles cancelled native-load cleanup before a queued resume (unload failures: %i)",
  async (unloadFailures) => {
    const { fixture, id, held } = await scriptLoadFixture();
    fixture.controls.unloadFailures = unloadFailures;
    const controller = new AbortController();
    const loading = fixture.load(id, "cancelled-native", controller.signal);
    const rejected = expect(loading).rejects.toThrow(
      "cancel before queued resume",
    );
    await held.entered;
    const resume = () =>
      fixture.client.callTool({
        name: "resume_frida_session",
        arguments: { session_id: id },
      });
    const resuming = resume();
    await fixture.client.ping();
    controller.abort(new Error("cancel before queued resume"));
    await fixture.client.ping();
    await rejected;
    held.release();
    const resumed = await resuming;
    await fixture.client.ping();
    expect(fixture.unloaded).toEqual(["cancelled-native"]);
    expect(fixture.scriptsAtResume).toEqual(
      unloadFailures === 0 ? [["original"]] : [],
    );
    expect(fixture.controls.detachCalls).toBe(0);
    expect(fixture.session.exportEvidenceBundle().records).toContainEqual(
      expect.objectContaining({
        operation: "load_frida_script",
        normalized_result: expect.objectContaining({
          messages: [expect.objectContaining({ payload: "cancelled-native" })],
          script_cleanup:
            unloadFailures === 0 ? "released" : "incomplete_or_unknown",
        }),
      }),
    );
    if (unloadFailures === 0) {
      expect(resumed.isError).not.toBe(true);
      expect(fixture.manager.status(id)?.scripts).toHaveLength(1);
      return;
    }
    expect(resumed.isError).toBe(true);
    expect(fixture.manager.status(id)?.state).toBe("paused");
    expect((await resume()).isError).toBe(true);
    await retryCancelledScriptUnload(fixture, id);
    expect((await resume()).isError).not.toBe(true);
    expect(fixture.scriptsAtResume).toEqual([["original"]]);
  },
);

it.each([0, 1, 2, 3, 4, 8])(
  "keeps MCP load Evidence consistent with queued resume across settlement timing %i",
  async (microtasks) => {
    const { fixture, id, held } = await scriptLoadFixture();
    const controller = new AbortController();
    fixture.controls.afterLoad = () => {
      let remaining = microtasks;
      const abort = () => {
        if (remaining-- > 0) queueMicrotask(abort);
        else controller.abort(new Error("cancel around load completion"));
      };
      abort();
    };
    const loading = fixture.load(id, "settling-native", controller.signal);
    const observed = loading.catch(() => undefined);
    await held.entered;
    const resuming = fixture.client.callTool({
      name: "resume_frida_session",
      arguments: { session_id: id },
    });
    await fixture.client.ping();
    held.release();
    await observed;
    expect((await resuming).isError).not.toBe(true);
    fixture.controls.afterLoad = () => {};
    await fixture.load(id, "barrier");
    await fixture.client.ping();
    const records = fixture.session
      .exportEvidenceBundle()
      .records.filter(
        (record) =>
          record.operation === "load_frida_script" &&
          JSON.stringify(record.normalized_result).includes("settling-native"),
      );
    expect(records).toHaveLength(1);
    const recorded = records[0]?.normalized_result;
    if (
      recorded === null ||
      typeof recorded !== "object" ||
      Array.isArray(recorded)
    )
      throw new Error("Missing script load Evidence");
    if (recorded.script_cleanup === "released") {
      expect(fixture.scriptsAtResume).toEqual([["original"]]);
      expect(fixture.unloaded).toEqual(["settling-native"]);
    } else {
      expect(recorded.script_cleanup).toBeUndefined();
      expect(fixture.scriptsAtResume).toEqual([
        ["original", "settling-native"],
      ]);
      expect(fixture.unloaded).toEqual([]);
    }
  },
);

it.each(["attached", "resumed"] as const)(
  "reports %s Frida resume refusal as selected session input",
  async (state) => {
    const fixture = await connectedFixture();
    const started =
      state === "attached"
        ? await fixture.manager.startSession({ mode: "attach", pid: 512 })
        : await fixture.manager.startSession({
            mode: "spawn",
            program: "/fixture",
          });
    if (!started.ok) throw started.error;
    const id = started.value.sessionId;
    if (state === "resumed")
      expect((await fixture.manager.resumeSession(id)).ok).toBe(true);
    const result = await fixture.client.callTool({
      name: "resume_frida_session",
      arguments: { session_id: id },
    });
    expect(result.isError).toBe(true);
    expect(parseMcpToolError(result)).toMatchObject({
      error: {
        code: "invalid_request",
        details: {
          issues: [{ path: ["session_id"], reason: "invalid_value" }],
        },
      },
    });
    expect(fixture.controls.resumes).toBe(state === "resumed" ? 1 : 0);
  },
);
