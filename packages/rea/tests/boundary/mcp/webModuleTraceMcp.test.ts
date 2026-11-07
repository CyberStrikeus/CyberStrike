import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { WebArtifactCleanup } from "../../../src/browser/WebArtifactCleanup.js";
import { LocalWebScriptArtifacts } from "../../../src/browser/assets/LocalWebScriptArtifacts.js";
import type { ExecutionOptions } from "../../../src/application/AnalysisProvider.js";
import { NativeModuleResolver } from "../../../src/browser/modules/NativeModuleResolver.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it, onTestFinished } from "vitest";
import { WebModuleTraceService } from "../../../src/application/WebModuleTraceService.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { ok } from "../../../src/domain/result.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import {
  webModuleArtifactsFixture,
  completedModuleResolverLauncher,
  webModuleResolverFixture,
} from "../../fixtures/webModuleTrace.js";

it("publishes valid SDK schemas and records the named module trace without a binary target", async () => {
  const artifacts = webModuleArtifactsFixture();
  const service = new WebModuleTraceService(
    { load: () => Promise.resolve(ok(artifacts)) },
    webModuleResolverFixture,
  );
  const session = createTestBinarySession(() => {
    throw new Error("binary provider must not start");
  });
  const server = createServer(
    { kind: "session", session },
    { webModuleTrace: service },
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
    (tool) => tool.name === "trace_web_module_imports",
  );
  if (advertised?.outputSchema === undefined)
    throw new Error("module trace must advertise both schemas");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const inputSchema: Record<string, unknown> = advertised.inputSchema;
  const outputSchema: Record<string, unknown> = advertised.outputSchema;
  const args = { manifest_path: "/analysis/manifest.json", script_index: 0 };
  expect(ajv.validate(inputSchema, args)).toBe(true);
  const response = await client.callTool({
    name: "trace_web_module_imports",
    arguments: args,
  });
  expect(response.isError).not.toBe(true);
  expect(
    ajv.validate(outputSchema, response.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const parsed = toolContract("trace_web_module_imports").outputSchema.parse(
    response.structuredContent,
  );
  const evidence = parseEvidence(parsed);
  expect(evidence.normalized_result).toMatchObject({
    importer: {
      url: artifacts.manifest.scripts[0]?.url,
      basis: "reported-source-url",
    },
    imports: [
      {
        resolution: { state: "resolved", url: "https://app.test/dep.js" },
        execution: "unknown",
      },
      {
        resolution: { state: "unknown", reason: "computed-specifier" },
        execution: "unknown",
      },
    ],
  });
  expect(session.evidenceById(evidence.evidence_id)).toEqual(evidence);
  const invalid = await client.callTool({
    name: "trace_web_module_imports",
    arguments: { ...args, manifest_path: "relative.json" },
  });
  expect(parseMcpToolError(invalid).error).toMatchObject({
    code: "invalid_request",
    details: {
      issues: [{ path: ["manifest_path"], reason: "invalid_format" }],
    },
  });
});

it("retains the module resolver cleanup owner across failed server shutdown", async () => {
  let closes = 0;
  const service = new WebModuleTraceService(
    { load: () => Promise.resolve(ok(webModuleArtifactsFixture())) },
    {
      ...webModuleResolverFixture,
      close: async () => {
        closes += 1;
        if (closes === 1) throw new Error("fixture browser close failed");
      },
    },
  );
  const session = createTestBinarySession(() => {
    throw new Error("binary provider must not start");
  });
  const server = createServer(
    { kind: "session", session },
    { webModuleTrace: service },
  );
  onTestFinished(async () => {
    await server.close();
    await session.close();
  });
  await expect(server.close()).rejects.toBeInstanceOf(AggregateError);
  await server.close();
  await server.close();
  expect(closes).toBe(2);
});

it.each(["opaque", "resolved-typed"] as const)(
  "keeps shutdown cleanup uncertain after an unowned %s rejection",
  async (kind) => {
    let allowClose = false;
    const resources = new ArtifactResourceScope();
    resources.addCloseHook(async () => {
      if (!allowClose) throw new Error("controlled artifact close refusal");
    });
    const artifactCleanup = new WebArtifactCleanup(
      "web-module-artifacts",
      resources,
      new LocalWebScriptArtifacts("trace_web_module_imports", resources),
    );
    const unowned =
      kind === "opaque"
        ? new Error("unattributed resolver close rejection")
        : new ProviderCleanupError(
            "fixture-resolver",
            [],
            { reason: "resolver rejected an already-resolved cleanup error" },
            { operation: "trace_web_module_imports" },
          ).resolveCleanup();
    const service = new WebModuleTraceService(
      {
        load: async () => ok(webModuleArtifactsFixture()),
        close: () => artifactCleanup.close(),
      },
      {
        ...webModuleResolverFixture,
        close: async () => {
          if (!allowClose) throw unowned;
        },
      },
    );
    const session = createTestBinarySession(() => {
      throw new Error("binary provider must not start");
    });
    const server = createServer(
      { kind: "session", session },
      { webModuleTrace: service },
    );
    onTestFinished(async () => {
      allowClose = true;
      await server.close();
      await session.close();
    });
    const shutdown = await server.close().catch((cause: unknown) => cause);
    const aggregate = moduleTraceShutdownFailure(shutdown);
    expect(aggregate).toBeInstanceOf(ProviderCleanupError);
    expect(aggregate).toMatchObject({
      operation: "close_web_workflow",
      cleanupIncomplete: true,
      cleanupResources: ["web module artifacts"],
    });
    const causes = aggregate.cause;
    if (!(causes instanceof AggregateError))
      throw new Error("expected both original close failures");
    expect(causes.errors).toHaveLength(2);
    expect(causes.errors[1]).toBe(unowned);
    const artifactFailure: unknown = causes.errors[0];
    if (!(artifactFailure instanceof AnalysisError))
      throw new Error("expected the canonical artifact cleanup owner");
    const historicalDiagnostics = structuredClone(aggregate.diagnostics);
    allowClose = true;
    await server.close();
    expect(artifactFailure).toMatchObject({
      cleanupIncomplete: false,
      cleanupResources: [],
    });
    expect(aggregate.cleanupIncomplete).toBe(true);
    expect(aggregate.diagnostics).toEqual(historicalDiagnostics);
  },
);

it.each([
  { cleanupFails: false, releaseFirst: null },
  { cleanupFails: true, releaseFirst: null },
  { cleanupFails: true, releaseFirst: "artifacts" },
  { cleanupFails: true, releaseFirst: "resolver" },
] as const)(
  "retains completed module Evidence over SDK MCP through final close cancellation (close fails: $cleanupFails; first release: $releaseFirst)",
  async ({ cleanupFails, releaseFirst }) => {
    const harness = await createModuleFinalizationHarness(
      cleanupFails
        ? releaseFirst === null
          ? ["resolver"]
          : ["artifacts", "resolver"]
        : [],
    );
    const { artifacts, reason, client, session, server } = harness;
    const response = await client.callTool({
      name: "trace_web_module_imports",
      arguments: {
        manifest_path: "/analysis/manifest.json",
        script_index: 0,
      },
    });
    expect(response.isError).toBe(true);
    const original = harness.failure;
    if (original === undefined) throw new Error("expected original failure");
    const evidence = parseEvidence(original.partialObservation);
    expect(parseMcpToolError(response)).toMatchObject({
      error: {
        code: cleanupFails ? "cleanup_incomplete" : "cancelled",
        details: {
          partial_observation: {
            kind: "retained-evidence",
            evidence_id: evidence.evidence_id,
          },
        },
      },
    });
    expect(evidence).toMatchObject({
      operation: "trace_web_module_imports",
      confidence: "derived",
      normalized_result: {
        source: artifacts.sourceFile,
        imports: [
          {
            resolution: { state: "resolved", url: "https://app.test/dep.js" },
            execution: "unknown",
          },
          {
            resolution: { state: "unknown", reason: "computed-specifier" },
            execution: "unknown",
          },
        ],
      },
    });
    expect(session.evidenceById(evidence.evidence_id)).toEqual(evidence);
    expect((original.cleanupPrimary ?? original).cause).toBe(reason);
    const retainedShutdownFailures: AnalysisError[] = [];
    let historicalDiagnostics: unknown;
    if (cleanupFails) {
      const firstShutdown = await server
        .close()
        .catch((cause: unknown) => cause);
      moduleTraceShutdownFailure(firstShutdown);
      expect(original.cleanupIncomplete).toBe(true);
      if (releaseFirst !== null) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const shutdown =
            attempt === 0
              ? firstShutdown
              : await server.close().catch((cause: unknown) => cause);
          const failure = moduleTraceShutdownFailure(shutdown);
          expect(failure).toBeInstanceOf(ProviderCleanupError);
          retainedShutdownFailures.push(failure);
          expect(failure).toMatchObject({
            operation: "close_web_workflow",
            cleanupIncomplete: true,
            cleanupResources: ["web module artifacts", "chromium-browser"],
          });
          expect(failure.cause).toBeInstanceOf(AggregateError);
        }
        historicalDiagnostics = structuredClone(
          retainedShutdownFailures[0]?.diagnostics,
        );
        if (releaseFirst === "artifacts") harness.releaseArtifacts();
        else harness.releaseResolver();
        const mixedShutdown = await server
          .close()
          .catch((cause: unknown) => cause);
        const remaining = moduleTraceShutdownFailure(mixedShutdown);
        const remainingResources = [
          releaseFirst === "artifacts"
            ? "chromium-browser"
            : "web module artifacts",
        ];
        expect(remaining.cleanupResources).toEqual(remainingResources);
        for (const failure of retainedShutdownFailures)
          expect(failure).toMatchObject({
            cleanupIncomplete: true,
            cleanupResources: remainingResources,
          });
        retainedShutdownFailures.push(remaining);
        expect(original.cleanupIncomplete).toBe(releaseFirst === "artifacts");
        harness.releaseArtifacts();
      }
      harness.releaseResolver();
    }
    await server.close();
    for (const failure of retainedShutdownFailures)
      expect(failure).toMatchObject({
        cleanupIncomplete: false,
        cleanupResources: [],
      });
    if (releaseFirst !== null) {
      expect(retainedShutdownFailures[0]?.diagnostics).toEqual(
        historicalDiagnostics,
      );
      expect(harness.artifactCloses).toBe(releaseFirst === "artifacts" ? 3 : 4);
    }
    expect(original.cleanupIncomplete).toBe(false);
    expect(original.cleanupResources).toEqual([]);
    expect(projectAnalysisError(original).code).toBe("cancelled");
    expect(harness.launches).toBe(1);
  },
);

/** Session shutdown retains provider shutdown, which retains this workflow's failure. */
const moduleTraceShutdownFailure = (shutdown: unknown): AnalysisError => {
  if (!(shutdown instanceof AggregateError))
    throw new Error("expected session shutdown failure");
  expect(shutdown.message).toBe("REA session cleanup failed");
  expect(shutdown.errors).toHaveLength(1);
  const providers: unknown = shutdown.errors[0];
  if (!(providers instanceof AggregateError))
    throw new Error("expected provider shutdown failure");
  expect(providers.message).toBe("REA provider cleanup failed");
  expect(providers.errors).toHaveLength(1);
  const failure: unknown = providers.errors[0];
  if (!(failure instanceof AnalysisError))
    throw new Error("expected the typed web workflow cleanup failure");
  return failure;
};

/** Own the MCP session and each independently releasable finalization resource. */
const createModuleFinalizationHarness = async (
  failingOwners: readonly ("artifacts" | "resolver")[],
) => {
  const artifacts = webModuleArtifactsFixture();
  const importerUrl = artifacts.manifest.scripts[0]?.url;
  if (importerUrl === undefined) throw new Error("fixture source URL missing");
  const controller = new AbortController();
  const reason = { request: "controlled finalization cancellation" };
  let allowClose = !failingOwners.includes("resolver");
  let allowArtifactClose = !failingOwners.includes("artifacts");
  let artifactCloses = 0;
  const resources = new ArtifactResourceScope();
  resources.addCloseHook(async () => {
    artifactCloses += 1;
    if (!allowArtifactClose)
      throw new Error("controlled artifact close refusal");
  });
  const artifactCleanup = new WebArtifactCleanup(
    "web-module-artifacts",
    resources,
    new LocalWebScriptArtifacts("trace_web_module_imports", resources),
  );
  let launches = 0;
  const launcher = completedModuleResolverLauncher(
    { importerUrl, importMap: null, specifiers: ["./dep.js"] },
    async () => {
      controller.abort(reason);
      if (!allowClose) throw new Error("controlled close refusal");
    },
  );
  const resolver = new NativeModuleResolver(
    { REA_BROWSER_EXECUTABLE: "/browser" },
    (options) => {
      launches += 1;
      return launcher(options);
    },
  );
  let failure: AnalysisError | undefined;
  class ControlledCancellationService extends WebModuleTraceService {
    override async trace(input: unknown, options?: ExecutionOptions) {
      const result = await super.trace(input, {
        ...options,
        signal: controller.signal,
      });
      if (!result.ok) failure = result.error;
      return result;
    }
  }
  const service = new ControlledCancellationService(
    {
      load: async () => ok(artifacts),
      close: () => artifactCleanup.close(),
    },
    resolver,
  );
  const session = createTestBinarySession(() => {
    throw new Error("no binary acquisition");
  });
  const server = createServer(
    { kind: "session", session },
    { webModuleTrace: service },
  );
  const client = new Client({ name: "module-finalization", version: "1" });
  onTestFinished(async () => {
    allowClose = true;
    allowArtifactClose = true;
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    artifacts,
    reason,
    client,
    session,
    server,
    releaseArtifacts: () => {
      allowArtifactClose = true;
    },
    releaseResolver: () => {
      allowClose = true;
    },
    get failure() {
      return failure;
    },
    get artifactCloses() {
      return artifactCloses;
    },
    get launches() {
      return launches;
    },
  };
};
