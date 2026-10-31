import { AndroidAnalysisService } from "../../../src/application/android/AndroidAnalysisService.js";
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it as test } from "vitest";
import { closeVerifierResources } from "../../../scripts/lib/verifier-cleanup.mjs";
import { z } from "zod";
import { access } from "node:fs/promises";
import { ANDROID_TOOL_CONTRACTS } from "../../../src/contracts/android/androidToolContracts.js";
import { JADX_BRIDGE_IDENTITY } from "../../../src/android/JadxRelease.js";
import { androidPartialObservationSchema } from "../../../src/domain/android/androidPartialObservation.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { createServer } from "../../../src/server/createServer.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { startMcpTransport } from "../../../src/main/transport.js";
import type { RuntimeDependencies } from "../../../src/main/types.js";
import type { AndroidAnalysisPort } from "../../../src/application/android/AndroidAnalysisPort.js";
import { silentLogger } from "../../../src/logger.js";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  createJadxProtocolFixture,
  verifyJadxFixtureCleanup,
} from "../../fixtures/android/jadx.js";

test("preserves Android caller field constraints before target or provider access", async () => {
  let calls = 0;
  const service = new AndroidAnalysisService({
    inspectAvailability: () => Promise.reject(new Error("unused")),
    close: () => Promise.resolve(),
    execute: () => {
      calls++;
      return Promise.reject(new Error("provider must not run"));
    },
  });
  const result = await service.execute("inspect_android_method", {
    path: "",
    class_name: "",
    method_name: "",
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "invalid_request",
    details: {
      issues: [
        { path: ["path"], reason: "out_of_range", minimum: 1 },
        { path: ["class_name"], reason: "out_of_range", minimum: 1 },
        { path: ["method_name"], reason: "out_of_range", minimum: 1 },
      ],
    },
  });
  expect(calls).toBe(0);
});

const it = test.skipIf(process.platform === "win32");

it("keeps a replacement server usable after the SDK discards its discovery probe", async () => {
  const { apk } = await createJadxProtocolFixture();
  const session = createTestBinarySession(() => {
    throw new Error("Unexpected deep provider");
  });
  const factories: Parameters<RuntimeDependencies["serve"]>[0][] = [];
  const providers: AndroidAnalysisPort[] = [];
  const runtime: RuntimeDependencies = {
    env: {},
    serve: (factory) => {
      factories.push(factory);
      return { close: async () => undefined };
    },
    createServer: (source, options) => {
      if (options?.androidAnalysis === undefined)
        throw new Error("Expected owned Android provider");
      providers.push(options.androidAnalysis);
      return createServer(source, options);
    },
    writeStderr: () => undefined,
    setExitCode: () => undefined,
    registerShutdown: () => () => undefined,
  };
  const transport = await startMcpTransport(runtime, session, {
    logger: silentLogger,
    serverLogger: silentLogger,
    environment: runtime.env,
    delivery: createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE),
    loadOptionalProviders: async () => ({}),
  });
  if (!transport.ok) throw new Error("Transport failed");
  const factory = factories[0];
  if (factory === undefined) throw new Error("Missing SDK server factory");
  const probe = await factory({ era: "modern" });
  await probe.close();
  const replacement = await factory({ era: "legacy" });
  const provider = providers[1];
  if (provider === undefined) throw new Error("Missing replacement provider");
  const target = await parseBinaryTarget(apk);
  if (!target.ok) throw target.error;
  try {
    expect(
      await provider.execute(target.value, {
        operation: "inspect_android_package",
        input: { path: apk },
      }),
    ).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCapabilityUnavailableError" },
    });
  } finally {
    await closeVerifierResources([
      () => replacement.close(),
      () => transport.closeAndroid(),
      async () => {
        const closed = await session.close();
        if (!closed.ok) throw closed.error;
      },
    ]);
  }
});

it("publishes and executes all APK contracts with inline Evidence and no active binary", async () => {
  const { provider, apk, launches } = await createJadxProtocolFixture();
  const session = createTestBinarySession(() => {
    throw new Error("APK analysis must not acquire a deep binary provider");
  });
  const { client, close } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "android-contract-regression", version: "1" },
    serverOptions: { androidAnalysis: provider },
  });
  const advertised = await client.listTools();
  const wireTools = new Map(advertised.tools.map((tool) => [tool.name, tool]));
  for (const contract of ANDROID_TOOL_CONTRACTS) {
    const wire = wireTools.get(contract.name);
    if (wire === undefined || wire.outputSchema === undefined)
      throw new Error(`Missing advertised output schema for ${contract.name}`);
    const validateOutput = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile(z.record(z.string(), z.unknown()).parse(wire.outputSchema));
    expect(wire?.annotations).toMatchObject(contract.annotations);
    expect(contract.effects).toMatchObject({
      mutatesTarget: false,
      launchesProcess: true,
      writesFilesystem: true,
      accessesNetwork: false,
    });
    const input = {
      path: apk,
      // Inline Evidence opts out of any contract's summary delivery default.
      ...(Object.hasOwn(contract.inputSchema.shape, "detail")
        ? { detail: "complete" }
        : {}),
      ...(contract.name === "search_android_classes"
        ? { query: "Target" }
        : {}),
      ...(contract.name === "inspect_android_class" ||
      contract.name === "inspect_android_method" ||
      contract.name === "trace_android_references"
        ? { class_name: "fixture.Target" }
        : {}),
      ...(contract.name === "inspect_android_method"
        ? { method_name: "onCreate" }
        : {}),
    };
    const response = await client.callTool({
      name: contract.name,
      arguments: input,
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expect(validateOutput(response.structuredContent)).toBe(true);
    const result = contract.outputSchema.parse(response.structuredContent);
    const evidence = parseEvidence(result);
    expect(evidence.operation).toBe(contract.name);
    expect(evidence.raw_result).not.toBeNull();
  }
  expect(launches).toHaveLength(1);
  await close();
  await verifyJadxFixtureCleanup(launches);
});

test.each([
  {
    scenario: "failed upstream reply",
    mode: "tool-error",
    errorCode: "execution_failure",
    serverName: "rea-jadx-bridge",
    serverVersion: JADX_BRIDGE_IDENTITY.version,
    engineVersion: "0.7.1",
    calls: [
      { operation: "rea_jvm_status" },
      { operation: "load_apk" },
      { operation: "get_app_info" },
      {
        operation: "get_android_manifest",
        response: { isError: true },
      },
    ],
    containsAmbientEnvironment: false,
  },
  {
    scenario: "transport error after successful replies",
    mode: "rpc-disconnect",
    errorCode: "execution_failure",
    serverName: "rea-jadx-bridge",
    serverVersion: JADX_BRIDGE_IDENTITY.version,
    engineVersion: "0.7.1",
    calls: [{ operation: "rea_jvm_status" }, { operation: "load_apk" }],
    containsAmbientEnvironment: true,
  },
  {
    scenario: "empty handshake identity mismatch",
    mode: "empty-server-identity",
    errorCode: "capability_unavailable",
    serverName: "",
    serverVersion: "",
    engineVersion: null,
    calls: [],
    containsAmbientEnvironment: true,
  },
])(
  "retains Android partial observations for $scenario through MCP",
  async ({
    mode,
    errorCode,
    serverName,
    serverVersion,
    engineVersion,
    calls,
    containsAmbientEnvironment,
  }) => {
    const { provider, apk, launches } = await createJadxProtocolFixture(mode);
    const session = createTestBinarySession(() => {
      throw new Error("Unexpected native provider acquisition");
    });
    const { client, close } = await createApplicationMcpHarness({
      session,
      clientIdentity: {
        name: "android-partial-observation-regression",
        version: "1",
      },
      serverOptions: { androidAnalysis: provider },
    });

    const response = await client.callTool({
      name: "inspect_android_package",
      arguments: { path: apk },
    });
    const projected = parseMcpToolError(response).error;
    expect(projected.code).toBe(errorCode);
    const details = z.record(z.string(), z.unknown()).parse(projected.details);
    const partial = androidPartialObservationSchema.parse(
      details.partial_observation,
    );
    expect(partial).toMatchObject({
      provider_id: "jadx",
      operation: "inspect_android_package",
      target: { selected_path: apk, path: apk, format: "apk" },
      provider_facts: {
        bridge_name: "rea-jadx-bridge",
        bridge_version: JADX_BRIDGE_IDENTITY.version,
        server_name: serverName,
        server_version: serverVersion,
        engine_version: engineVersion,
      },
      calls,
    });
    if (!containsAmbientEnvironment)
      expect(JSON.stringify(partial)).not.toContain("JAVA_HOME");
    await close();
    await verifyJadxFixtureCleanup(launches);
  },
);

it("retains partial JADX replies when owned cleanup also fails", async () => {
  const { service, apk } = await createJadxProtocolFixture("cleanup-failure");
  const result = await service.execute("inspect_android_package", {
    path: apk,
  });
  if (result.ok) throw new Error("Expected the fixture tool to fail");

  const projected = projectAnalysisError(result.error);
  expect(projected.code).toBe("cleanup_incomplete");
  expect(projected.details).toMatchObject({
    cleanup: "incomplete",
    execution_failure: "execution_failure",
    partial_observation: {
      provider_id: "jadx",
      operation: "inspect_android_package",
      calls: [
        { operation: "rea_jvm_status" },
        { operation: "load_apk" },
        { operation: "get_app_info" },
        {
          operation: "get_android_manifest",
          response: { isError: true },
        },
      ],
    },
  });
});

it("cleans an active engine when the MCP client disconnects", async () => {
  const { provider, apk, launches } = await createJadxProtocolFixture("stall");
  const session = createTestBinarySession(() => {
    throw new Error("Unexpected native provider acquisition");
  });
  const { client, close } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "android-disconnect-regression", version: "1" },
    serverOptions: { androidAnalysis: provider },
  });
  const pending = client
    .callTool({ name: "inspect_android_package", arguments: { path: apk } })
    .catch(() => undefined);
  await expect.poll(() => launches.length, { timeout: 10_000 }).toBe(1);
  await client.close();
  await pending;
  await expect
    .poll(async () => {
      const workspace = launches[0]?.cwd;
      if (workspace === undefined) return false;
      try {
        await access(workspace);
        return false;
      } catch (cause) {
        return (
          cause instanceof Error && "code" in cause && cause.code === "ENOENT"
        );
      }
    })
    .toBe(true);
  await close();
  await verifyJadxFixtureCleanup(launches);
});
