import { parseEvidence } from "../../../src/domain/evidence.js";
import { digestCanonicalValue } from "../../../src/domain/canonicalDigest.js";
import { electronActiveObservationInputSchema } from "../../../src/domain/javascript/electronActiveObservation.js";
import { ok as resultOk, err } from "../../../src/domain/result.js";
import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createStrippedAsarAddon } from "../../fixtures/strippedAsarAddon.js";

import { createTestBinarySession } from "../../fixtures/binarySession.js";
import type { ElectronActiveObservationPort } from "../../../src/application/javascript/ElectronActiveObservationPort.js";
import type { ElectronObservationPort } from "../../../src/application/javascript/ElectronObservationPort.js";
import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";
import { CdpElectronProvider } from "../../../src/browser/CdpElectronProvider.js";
import { createServer } from "../../../src/server/createServer.js";
import { INLINE_EVIDENCE_MCP_ENVIRONMENT } from "../../../scripts/lib/mcp-verification-environment.mjs";
import { observed } from "../../fixtures/analysisExecution.js";
import {
  startFakeCdpBrowser,
  type FakeCdpBrowser,
} from "../../fixtures/fakeCdpBrowser.js";
import { writeElectronBoundaryFixture } from "../../fixtures/electronBoundaryApplication.js";
import { createElectronActiveObservationFixtureResult } from "../../../src/domain/javascript/electronActiveObservation.fixture.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { AsarArtifactReader } from "../../../src/artifacts/AsarArtifactReader.js";
import { toolAvailabilityInventory } from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { emptyElectronPageCoverage } from "../../../src/domain/javascript/electronPageInspection.fixture.js";
import type { ElectronPageInspection } from "../../../src/domain/javascript/electronObservation.js";

const browsers: FakeCdpBrowser[] = [];
const resources: Array<{ close(): Promise<unknown> }> = [];
const temporary: string[] = [];

it("retains failed JavaScript inventory cleanup through server shutdown retries", async () => {
  const { archive } = await createStrippedAsarAddon();
  const session = createTestBinarySession(() => ({
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(resultOk(null)),
  }));
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "javascript-cleanup-owner", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const originalClose = AsarArtifactReader.prototype.close;
  const owners = new Set<AsarArtifactReader>();
  let blocked = true;
  const close = vi
    .spyOn(AsarArtifactReader.prototype, "close")
    .mockImplementation(function (this: AsarArtifactReader) {
      owners.add(this);
      if (blocked) return Promise.reject(new Error("snapshot cleanup blocked"));
      return originalClose.call(this);
    });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const response = await client.callTool({
      name: "analyze_javascript_application",
      arguments: {
        input_path: archive,
        integrity_policy: "record-and-continue",
      },
    });
    expect(parseMcpToolError(response)).toMatchObject({
      error: {
        code: "cleanup_incomplete",
        details: {
          resources: [expect.stringContaining(archive)],
          partial_observation: { kind: "artifact-inventory" },
        },
      },
    });
    expect(owners.size).toBe(1);
    await expect(server.close()).rejects.toThrow();
    blocked = false;
    await server.close();
    expect(owners.size).toBe(1);
    expect(close.mock.calls.length).toBeGreaterThanOrEqual(3);
  } finally {
    blocked = false;
    await Promise.all([client.close(), server.close(), session.close()]);
    close.mockRestore();
  }
});

afterEach(async () => {
  await Promise.all(resources.splice(0).map(async (item) => item.close()));
  await Promise.all(browsers.splice(0).map(async (browser) => browser.close()));
  await Promise.all(
    temporary
      .splice(0)
      .map(async (path) => rm(path, { recursive: true, force: true })),
  );
});

it("records completed Electron facts after final detach as server Evidence", async () => {
  const inspection: ElectronPageInspection = {
    browser: {
      product: "Chromium",
      protocol_version: "1.3",
      revision: "123",
      user_agent: "fixture",
      js_version: "V8",
    },
    target: {
      target_id: "target-1",
      type: "page",
      title: "fixture",
      file_path: "/tmp/index.html",
      attached: true,
    },
    ...emptyElectronPageCoverage(1),
  };
  const provider: ElectronObservationPort = {
    identity: () => ({
      id: "test-electron-observation",
      name: "Test Electron observation provider",
      version: "1",
    }),
    listTargets: async () => {
      throw new Error("unexpected target listing");
    },
    inspectPage: async () =>
      err(
        new AnalysisCancelledError("inspect_electron_page", {
          partialObservation: {
            kind: "electron-page-observation",
            inspection,
            cleanup: "transport-closed",
          },
        }),
      ),
  };
  const session = createTestBinarySession(() => ({
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(resultOk(null)),
  }));
  const server = createServer(
    { kind: "session", session },
    {
      electronObservation: provider,
    },
  );
  const client = new Client({ name: "electron-final-detach", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server, session);
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const response = await client.callTool({
    name: "inspect_electron_page",
    arguments: {
      cdp_endpoint: "http://127.0.0.1:9222",
      target_id: "target-1",
      observation_ms: 0,
      include_script_sources: false,
    },
  });
  const { error } = parseMcpToolError(response);
  expect(error.details).toMatchObject({
    partial_observation: { kind: "retained-evidence" },
  });
  const reference = z
    .object({
      partial_observation: z.object({
        kind: z.literal("retained-evidence"),
        evidence_id: z.string(),
      }),
    })
    .parse(error.details).partial_observation;
  expect(session.evidenceById(reference.evidence_id)).toMatchObject({
    operation: "inspect_electron_page",
    normalized_result: { target: { target_id: "target-1" } },
    limitations: expect.arrayContaining([
      expect.stringContaining("closed its CDP transport"),
    ]),
  });
  await expect(client.ping()).resolves.toEqual({});
});

it("lets MCP JavaScript analysis continue only with recorded untrusted ASAR bytes", async () => {
  const { archive, addon } = await createStrippedAsarAddon();
  const session = createTestBinarySession(() => ({
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(resultOk(null)),
  }));
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "asar-integrity-policy", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server, session);
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const rejected = await client.callTool({
    name: "analyze_javascript_application",
    arguments: { input_path: archive },
  });
  expect(parseMcpToolError(rejected)).toMatchObject({
    error: {
      code: "artifact_integrity_mismatch",
      remediation: {
        action: expect.stringContaining("integrity_policy=record-and-continue"),
      },
    },
  });

  const continued = await client.callTool({
    name: "analyze_javascript_application",
    arguments: {
      input_path: archive,
      integrity_policy: "record-and-continue",
    },
  });
  expect(continued.isError).not.toBe(true);
  expect(continued.structuredContent).toMatchObject({
    parameters: { integrity_policy: "record-and-continue" },
    normalized_result: {
      integrity_contradictions: [
        { logical_path: addon, trust: "observed-untrusted" },
      ],
      graph: { coverage: { status: "partial" } },
    },
  });
});

it("advertises owned JavaScript analysis effects without foreign target execution", async () => {
  const session = createTestBinarySession(() => ({
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(resultOk(null)),
  }));
  const server = createServer({ kind: "session", session });
  const client = new Client({
    name: "javascript-analysis-effects",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server, session);
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const status = await client.callTool({
    name: "binary_session",
    arguments: { detail: "complete" },
  });
  expect(status.isError).not.toBe(true);
  const { result } = z
    .object({
      result: z.object({ tool_availability: toolAvailabilityInventory }),
    })
    .parse(status.structuredContent);
  const analysisAvailability = result.tool_availability.groups.find(
    ({ names }) => names.includes("analyze_javascript_application"),
  );
  expect(analysisAvailability?.effects.toSorted()).toEqual([
    "idempotent",
    "launchesProcess",
    "mutatesSession",
    "writesFilesystem",
  ]);
  expect(analysisAvailability?.annotations.toSorted()).toEqual([
    "idempotent",
    "open_world",
  ]);
});

it("exposes endpoint-scoped Electron discovery and inspection as Evidence", async () => {
  const root = await createTestTempDirectory("rea-electron-mcp-");
  temporary.push(root);
  await writeFile(join(root, "index.html"), "<script src='app.js'></script>");
  await writeFile(
    join(root, "app.js"),
    "export const observed = 'source-secret';",
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "runtime-fixture", renderer: "index.html" }),
  );
  await writeFile(join(root, "worker.js"), "self.onmessage = () => {};\n");
  const browser = await startFakeCdpBrowser({
    electronFileUrl: `${pathToFileURL(join(root, "index.html")).href}?next=%2Fsettings#%5Csettings`,
    commandEvents: ({ method }) =>
      method === "Debugger.enable"
        ? [
            {
              method: "Debugger.scriptParsed",
              sessionId: "session-1",
              params: {
                scriptId: "partial-script",
                url: pathToFileURL(join(root, "app.js")).href,
                executionContextId: 1,
              },
            },
          ]
        : undefined,
  });
  browsers.push(browser);
  const session = createTestBinarySession(() => ({
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(resultOk(null)),
  }));
  const server = createServer(
    { kind: "session", session },
    {
      electronObservation: new CdpElectronProvider(),
      environment: { ...process.env, ...INLINE_EVIDENCE_MCP_ENVIRONMENT },
      availabilityPolicy: () => ({
        processCaptureEnabled: false,
        investigationInputRoots: 1,
      }),
    },
  );
  const client = new Client({ name: "electron-mcp-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server, session);
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const listed = await client.callTool({
    name: "list_electron_targets",
    arguments: {
      cdp_endpoint: browser.endpoint,
    },
  });
  expect(listed.isError).not.toBe(true);
  expect(listed.structuredContent).toMatchObject({
    environment: {
      id: expect.any(String),
      platform: "unknown",
      architecture: "unknown",
      isolation: "none",
    },
    limitations: expect.arrayContaining([
      "Browser host platform and architecture were not observed.",
    ]),
    normalized_result: {
      targets: [{ target_id: "electron-page" }],
    },
  });
  await expectPaddedElectronTargetRejected(client, browser);
  const inspected = await client.callTool({
    name: "inspect_electron_page",
    arguments: {
      cdp_endpoint: browser.endpoint,
      target_id: "electron-page",
      observation_ms: 0,
      include_script_sources: true,
    },
  });
  expect(inspected.isError).not.toBe(true);
  expect(parseEvidence(inspected.structuredContent).environment).toEqual(
    parseEvidence(listed.structuredContent).environment,
  );
  const analyzed = await client.callTool({
    name: "analyze_javascript_application",
    arguments: { input_path: root },
  });
  expect(analyzed.isError).not.toBe(true);
  expect(analyzed.structuredContent).toMatchObject({
    normalized_result: {
      graph: { nodes: expect.any(Array), edges: expect.any(Array) },
    },
  });
  const analysisText = analyzed.content.find(({ type }) => type === "text");
  expect(analysisText).toBeDefined();
  if (analysisText?.type !== "text")
    throw new TypeError("Missing JavaScript analysis text projection");
  expect(analysisText.text).toContain('"nodes":[');
  const reconciled = await client.callTool({
    name: "reconcile_javascript_runtime",
    arguments: {
      static_layers: [
        {
          role: "application",
          analysis: evidenceFor(analyzed.structuredContent),
        },
      ],
      runtime_observations: [evidenceFor(inspected.structuredContent)],
    },
  });
  expect(reconciled.isError).not.toBe(true);
  expect(reconciled.structuredContent).toMatchObject({
    normalized_result: {
      summary: { runtime_scripts: 1, matched: expect.any(Number) },
      source_map_authority: { used_for_primary_matching: false },
    },
  });
  expect(inspected.isError).not.toBe(true);
  expect(inspected.structuredContent).toMatchObject({
    normalized_result: {
      target: { file_path: join(root, "index.html") },
      scripts: {
        items: [
          expect.objectContaining({
            frame_id: "frame-main",
            file_path: join(root, "app.js"),
            cdp_hash: null,
            length: null,
            is_module: null,
          }),
        ],
      },
      workers: [
        expect.objectContaining({
          target_id: "electron-worker",
          opener_target_id: "electron-page",
          file_path: join(root, "worker.js"),
        }),
      ],
    },
  });
}, 20_000);

/** Create the selected-path aliases and retained IPC-gap capture for the public workflow. */
const activeElectronScenarioFixture = async () => {
  const root = await createTestTempDirectory("rea-electron-active-mcp-");
  temporary.push(root);
  const applicationPath = join(root, "main.js");
  await writeFile(applicationPath, "module.exports = {};\n");
  const aliasedRoot = join(root, "..", `${basename(root)}-alias`);
  // A junction needs no symlink privilege on Windows.
  await symlink(
    root,
    aliasedRoot,
    process.platform === "win32" ? "junction" : "dir",
  );
  temporary.push(aliasedRoot);
  const workingDirectory = await createTestTempDirectory(
    "rea-electron-working-directory-",
  );
  temporary.push(workingDirectory);
  const activeResult =
    createElectronActiveObservationFixtureResult(applicationPath);
  const capturedEvent = activeResult.timeline.events[0];
  if (capturedEvent === undefined) throw new Error("IPC fixture was empty");
  const gaps = ["custom-apply", "listener-chain"].map((event, index) => ({
    ...capturedEvent,
    sequence: index + 2,
    kind: "ipc-observation-gap" as const,
    event,
    channel: event === "custom-apply" ? "custom" : "opaque-chain",
    direction: null,
    receiver: null,
    target: "ipcMain.on",
    argument_shapes: [],
    result_shape: null,
  }));
  activeResult.timeline.events.push(...gaps);
  activeResult.timeline.observed = 3;
  activeResult.retention.retained = 3;
  activeResult.retention.estimated_retained_bytes = 1_536;
  activeResult.retention.observed_runtime = 2;
  activeResult.coverage.observed_event_families.push("ipc-observation-gap");
  return { root, applicationPath, aliasedRoot, workingDirectory, activeResult };
};

it("runs active Electron scenarios with selected paths and inferred working directory", async () => {
  const { root, applicationPath, aliasedRoot, workingDirectory, activeResult } =
    await activeElectronScenarioFixture();
  const capturedInputs: unknown[] = [];
  const provider: ElectronActiveObservationPort = {
    identity: () => ({
      id: "test-electron-active",
      name: "Test Electron active provider",
      version: "1",
    }),
    capture: async (input) => {
      capturedInputs.push(input);
      return { ok: true, value: activeResult };
    },
  };
  const session = createTestBinarySession(() => ({
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(resultOk(null)),
  }));
  const server = createServer(
    { kind: "session", session },
    {
      electronActiveObservation: provider,
      availabilityPolicy: () => ({
        processCaptureEnabled: false,
        investigationInputRoots: 0,
      }),
    },
  );
  const client = new Client({ name: "electron-active-mcp-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server, session);
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const advertised = (await client.listTools()).tools.find(
    ({ name }) => name === "capture_electron_scenario",
  );
  if (advertised?.outputSchema === undefined)
    throw new Error("Active Electron output schema was not advertised");
  const validateOutput = new Ajv2020({
    strict: false,
    validateFormats: false,
  }).compile(z.record(z.string(), z.unknown()).parse(advertised.outputSchema));
  const captured = await client.callTool({
    name: "capture_electron_scenario",
    arguments: {
      executable_path: process.execPath,
      application_path: join(aliasedRoot, "main.js"),
      application_root: workingDirectory,
      args: ["--token", "super-secret"],
      actions: [
        { step_id: "submit", kind: "click", selector: "#submit-secret" },
      ],
    },
  });
  expect(captured.isError, JSON.stringify(captured)).not.toBe(true);
  expect(
    validateOutput(captured.structuredContent),
    JSON.stringify(validateOutput.errors),
  ).toBe(true);
  expect(captured.structuredContent).toMatchObject({
    normalized_result: {
      application: { process_ownership: "provider-owned" },
      ipc: { events: [{ channel: "readiness:echo" }] },
      timeline: {
        events: [
          { kind: "main-handler-invocation" },
          { kind: "ipc-observation-gap", channel: "custom" },
          { kind: "ipc-observation-gap", channel: "opaque-chain" },
        ],
      },
      coverage: {
        status: "partial_attach",
        pre_capture_activity: "unavailable",
      },
    },
  });
  expect(capturedInputs).toHaveLength(1);
  expect(capturedInputs[0]).toMatchObject({
    application_path: applicationPath,
    application_root: workingDirectory,
  });
  const capturedEvidence = parseEvidence(captured.structuredContent);
  expect(capturedEvidence.parameters).toMatchObject({
    executable_path: process.execPath,
    application_path: join(aliasedRoot, "main.js"),
    application_root: workingDirectory,
  });
  expect(capturedEvidence.normalized_result).toMatchObject({
    application: { application_path: applicationPath },
  });
  const { scenario_sha256, resolved_paths, ...selectedScenario } =
    capturedEvidence.parameters;
  expect(resolved_paths).toMatchObject({
    application_path: applicationPath,
    application_root: workingDirectory,
  });
  expect(scenario_sha256).toBe(
    digestCanonicalValue(selectedScenario, "Electron scenario"),
  );
  const inferredRoot = await client.callTool({
    name: "capture_electron_scenario",
    arguments: {
      executable_path: process.execPath,
      application_path: applicationPath,
      actions: [],
    },
  });
  expect(inferredRoot.isError, JSON.stringify(inferredRoot)).not.toBe(true);
  expect(capturedInputs[1]).toMatchObject({
    application_path: applicationPath,
    application_root: root,
  });
  const inferredEvidence = parseEvidence(inferredRoot.structuredContent);
  expect(inferredEvidence.parameters).not.toHaveProperty("application_root");
  expect(inferredEvidence.parameters.scenario_sha256).toBe(
    digestCanonicalValue(
      electronActiveObservationInputSchema.parse({
        executable_path: process.execPath,
        application_path: applicationPath,
        actions: [],
      }),
      "Electron scenario",
    ),
  );
  expect(JSON.stringify(captured.structuredContent)).toContain("submit-secret");
  expect(JSON.stringify(captured.structuredContent)).toContain("super-secret");
  expect(captured.structuredContent).toMatchObject({
    predicate_type: "rea.electron-active-scenario",
    operation: "capture_electron_scenario",
    parameters: {
      args: ["--token", "super-secret"],
      actions: [
        {
          step_id: "submit",
          kind: "click",
          selector: "#submit-secret",
          window_index: 0,
        },
      ],
    },
  });
}, 20_000);

it("exposes the target-free static JavaScript application workflow", async () => {
  const root = await createTestTempDirectory("rea-electron-static-mcp-");
  temporary.push(root);
  await writeElectronBoundaryFixture(root);
  const session = createTestBinarySession(() => ({
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(resultOk(null)),
  }));
  const server = createServer(
    { kind: "session", session },
    {
      availabilityPolicy: () => ({
        processCaptureEnabled: false,
        investigationInputRoots: 1,
      }),
    },
  );
  const client = new Client({
    name: "electron-static-mcp-test",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server, session);
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const progress: number[] = [];
  const analyzed = await client.callTool(
    {
      name: "analyze_javascript_application",
      arguments: { input_path: root },
    },
    { onprogress: (update) => progress.push(update.progress) },
  );

  expect(analyzed.isError).not.toBe(true);
  expect(progress[0]).toBe(1);
  expect(progress.at(-1)).toBeGreaterThan(1);
  progress.forEach((value, index) => {
    expect(value).toBeGreaterThan(progress[index - 1] ?? 0);
  });
  const projected = z
    .object({
      evidence_id: z.string(),
      normalized_result: z.object({
        input_path: z.string(),
        summary: z.object({
          browser_windows: z.number(),
          context_bridge_apis: z.number(),
          ipc: z.object({
            paired_renderer_transmissions: z.number(),
            ambiguous_renderer_transmissions: z.number(),
            unpaired_literal_renderer_transmissions: z.number(),
          }),
        }),
        graph: z.object({
          graph_id: z.string(),
          nodes: z.array(z.unknown()),
          edges: z.array(z.unknown()),
        }),
        semantic_graph: z.object({
          graph_id: z.string(),
          nodes: z.array(z.unknown()),
          relations: z.array(z.unknown()),
        }),
      }),
      operation: z.literal("analyze_javascript_application"),
      parameters: z.object({ format: z.string() }),
    })
    .parse(analyzed.structuredContent);
  expect(projected.normalized_result).toMatchObject({
    input_path: root,
    summary: {
      browser_windows: 3,
      context_bridge_apis: 2,
      ipc: {
        paired_renderer_transmissions: 0,
        ambiguous_renderer_transmissions: 7,
        unpaired_literal_renderer_transmissions: 0,
      },
    },
  });
  expect(projected.normalized_result.graph.nodes.length).toBeGreaterThan(0);
  expect(
    projected.normalized_result.semantic_graph.nodes.length,
  ).toBeGreaterThan(0);
  expect(projected.operation).toBe("analyze_javascript_application");
  const direct = await analyzeJavaScriptApplication({ input_path: root });
  if (!direct.ok) throw direct.error;
  expect(projected.evidence_id).toBe(direct.value.evidence_id);
});

const evidenceFor = (value: unknown) => {
  return parseEvidence(value);
};

it.skipIf(process.platform === "win32")(
  "admits the selected application source before canonicalizing its path through MCP",
  async () => {
    const root = await realpath(
      await createTestTempDirectory("rea-application-source-admission-"),
    );
    await mkdir(join(root, "app"));
    await mkdir(join(root, "selected/app"), { recursive: true });
    await mkdir(join(root, "selected/child"));
    await writeFile(join(root, "file"), "not a directory");
    await writeFile(join(root, "app/package.json"), '{"name":"sibling"}');
    await writeFile(
      join(root, "selected/app/package.json"),
      '{"name":"selected"}',
    );
    await symlink("selected/child", join(root, "link"));
    const session = createTestBinarySession(() => {
      throw new Error(
        "Static application analysis must not start a deep provider",
      );
    });
    const server = createServer({ kind: "session", session });
    const client = new Client({
      name: "application-source-admission",
      version: "1",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    resources.push(client, server, session);
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const initial = await client.callTool({
      name: "analyze_javascript_application",
      arguments: { input_path: join(root, "app") },
    });
    expect(initial.isError, JSON.stringify(initial)).not.toBe(true);
    const initialEvidence = parseEvidence(initial.structuredContent);
    const refused = await client.callTool({
      name: "analyze_javascript_application",
      arguments: { input_path: `${root}/file/../app` },
    });
    expect(refused.isError).toBe(true);
    expect(parseMcpToolError(refused)).toMatchObject({
      error: {
        code: "invalid_request",
        details: { issues: [{ path: ["input_path"] }] },
      },
    });
    const selected = `${root}/link/../app`;
    const admitted = await client.callTool({
      name: "analyze_javascript_application",
      arguments: { input_path: selected },
    });
    expect(admitted.isError, JSON.stringify(admitted)).not.toBe(true);
    const evidence = parseEvidence(admitted.structuredContent);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      evidence.normalized_result,
    );
    expect(evidence.parameters.input_path).toBe(selected);
    expect(evidence.subject?.local_path).toBe(join(root, "selected/app"));
    expect(result.input_path).toBe(join(root, "selected/app"));
    expect(result.root_artifact_sha256).not.toBe(
      javascriptApplicationAnalysisResultSchema.parse(
        initialEvidence.normalized_result,
      ).root_artifact_sha256,
    );
    expect(initialEvidence.subject?.local_path).toBe(join(root, "app"));
    await client.ping();
  },
);

const activePathAdmissionClient = async (
  capture: ElectronActiveObservationPort["capture"],
): Promise<Client> => {
  const session = createTestBinarySession(() => {
    throw new Error("must not start");
  });
  const server = createServer(
    { kind: "session", session },
    {
      electronActiveObservation: {
        capture,
        identity: () => ({ id: "test", name: "test", version: "1" }),
      },
    },
  );
  const client = new Client({ name: "electron-path-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server, session);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
};

it("reports every unresolved Electron path without starting a provider", async () => {
  const root = await createTestTempDirectory("rea-electron-invalid-paths-");
  const capture = vi.fn();
  const client = await activePathAdmissionClient(capture);
  const fields = ["executable_path", "application_path", "application_root"];
  const result = await client.callTool({
    name: "capture_electron_scenario",
    arguments: {
      ...Object.fromEntries(fields.map((field) => [field, join(root, field)])),
      actions: [],
    },
  });
  expect(result.isError).toBe(true);
  expect(parseMcpToolError(result)).toMatchObject({
    error: {
      code: "invalid_request",
      details: {
        issues: fields.map((field) => ({
          path: [field],
          reason: "invalid_value",
          message: expect.stringContaining("ENOENT"),
        })),
      },
    },
  });
  expect(capture).not.toHaveBeenCalled();
  await client.ping();
});

it.skipIf(process.platform === "win32")(
  "refuses obstructed Electron selections and admits native symlink traversal through MCP",
  async () => {
    const root = await realpath(
      await createTestTempDirectory("rea-electron-obstructed-paths-"),
    );
    await mkdir(join(root, "application/child"), { recursive: true });
    await writeFile(join(root, "file"), "not a directory");
    await writeFile(join(root, "electron"), "#!/bin/sh\n", { mode: 0o755 });
    await writeFile(join(root, "main.js"), "module.exports = {};\n");
    await writeFile(
      join(root, "application/main.js"),
      "module.exports = {};\n",
    );
    await symlink("application/child", join(root, "link"));
    const capture = vi.fn<ElectronActiveObservationPort["capture"]>(
      async (input) =>
        resultOk(
          createElectronActiveObservationFixtureResult(input.application_path),
        ),
    );
    const client = await activePathAdmissionClient(capture);
    const selected = {
      executable_path: join(root, "electron"),
      application_path: join(root, "main.js"),
      application_root: join(root, "application"),
    };
    for (const field of [
      "executable_path",
      "application_path",
      "application_root",
    ] as const) {
      const refused = await client.callTool({
        name: "capture_electron_scenario",
        arguments: {
          ...selected,
          [field]: `${root}/file/../${basename(selected[field])}`,
        },
      });
      expect(refused.isError).toBe(true);
      expect(parseMcpToolError(refused)).toMatchObject({
        error: {
          code: "invalid_request",
          details: { issues: [{ path: [field] }] },
        },
      });
      expect(capture).not.toHaveBeenCalled();
    }
    const admitted = await client.callTool({
      name: "capture_electron_scenario",
      arguments: {
        ...selected,
        application_path: `${root}/link/../main.js`,
        application_root: `${root}/link/..`,
      },
    });
    expect(admitted.isError, JSON.stringify(admitted)).not.toBe(true);
    expect(capture).toHaveBeenCalledOnce();
    expect(capture.mock.calls[0]?.[0]).toMatchObject({
      application_path: join(root, "application/main.js"),
      application_root: join(root, "application"),
    });
  },
);

const expectPaddedElectronTargetRejected = async (
  client: Client,
  browser: FakeCdpBrowser,
): Promise<void> => {
  const commandsBeforeRejectedInspection = browser.commands.length;
  const rejectedInspection = await client.callTool({
    name: "inspect_electron_page",
    arguments: {
      cdp_endpoint: browser.endpoint,
      target_id: " electron-page ",
      observation_ms: 0,
    },
  });
  expect(parseMcpToolError(rejectedInspection)).toMatchObject({
    error: { details: { reason: "target_not_found" } },
  });
  expect(browser.commands).toHaveLength(commandsBeforeRejectedInspection);
};
