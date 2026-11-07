import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import { IdaProvider } from "../../src/ida/IdaProvider.js";
import { createIdaTarget, RecordingIdaMcp } from "../fixtures/idaMcp.js";
import { createTestBinarySession } from "../fixtures/binarySession.js";
import { parseConfig } from "../../src/config/parseConfig.js";
import {
  createAnalysisSnapshotEntry,
  snapshotBinding,
  snapshotTarget,
} from "../../src/domain/analysisSnapshot.js";
import { createEvidence } from "../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../src/domain/evidenceBundle.js";
import { createAnalysisExecution } from "../../src/application/AnalysisProvider.js";
import { EnhancedTools } from "../../src/application/EnhancedTools.js";
import { IDA_PROVIDER_IDENTITY } from "../../src/ida/IdaProviderCapabilities.js";
import { parseBinaryTarget } from "../../src/application/BinaryTargetResolver.js";
import { fat } from "../../src/domain/binaryTarget.fixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { BinarySession } from "../../src/application/binary/BinarySession.js";
import { SessionProviderRouter } from "../../src/application/binary/SessionProviderRouter.js";
import { AnalysisProviderRegistry } from "../../src/application/binary/AnalysisProviderRegistry.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

const reobservesExternallyMutableState = async (): Promise<void> => {
  const { root, target } = await createIdaTarget();
  roots.push(root);
  const path = join(root, "registration.json");
  await writeFile(path, JSON.stringify({ command: "fixture" }));
  const config = parseConfig({ REA_IDA_MCP_CONFIG: path });
  if (!config.ok) throw config.error;
  const producer = new RecordingIdaMcp(target);
  const session = createTestBinarySession(
    new IdaProvider(config.value, {}, () => producer),
  );
  expect((await session.open(target.path)).ok).toBe(true);
  const query = { procedure: "main", document: target.path };
  const first = await session.execute("procedure_pseudo_code", query);
  expect(first.ok && first.value.result).toContain("42");
  const snapshot = session.exportAnalysisSnapshot();
  if (!snapshot.ok) throw snapshot.error;
  expect(snapshot.value.entries).toEqual([]);
  const profile = session.analysisProfile();
  if (profile === undefined) throw new Error("Missing profile");
  const cached = createAnalysisExecution(
    "stale output",
    IDA_PROVIDER_IDENTITY,
    {
      analysisProfile: profile,
      subject: {
        path: target.path,
        sha256: target.sha256,
        format: target.format,
        ...(target.architecture === undefined
          ? {}
          : { architecture: target.architecture }),
      },
    },
  );
  snapshot.value.entries.push(
    createAnalysisSnapshotEntry({
      target: snapshotTarget(target),
      binding: snapshotBinding(profile),
      operation: "procedure_pseudo_code",
      parameters: query,
      execution: cached,
    }),
  );
  snapshot.value.evidence_bundle = createEvidenceBundle([
    ...snapshot.value.evidence_bundle.records,
    createEvidence(target, IDA_PROVIDER_IDENTITY, {
      operation: "procedure_pseudo_code",
      parameters: query,
      result: cached.result,
      rawResult: cached.rawResult,
      analysisProfile: profile,
    }),
  ]);
  expect(session.importAnalysisSnapshot(snapshot.value).ok).toBe(true);
  expect(session.allowsSnapshotReplay("procedure_pseudo_code")).toBe(false);
  expect(session.allowsSnapshotReplay("binary_overview")).toBe(false);
  producer.pseudocode = "int main(void) { return 99; }";
  const second = await session.execute("procedure_pseudo_code", query);
  expect(second.ok && second.value.result).toContain("99");
  expect(
    producer.calls.filter(({ name }) => name === "decompile_function"),
  ).toHaveLength(2);
  await session.close();
  expect(producer.closes).toBe(1);
};

describe("IDA provider composition", () => {
  it("discovers without launching and commits adapter semantics without persisting credentials", async () => {
    const { root, target } = await createIdaTarget();
    roots.push(root);
    const path = join(root, "registration.json");
    await writeFile(
      path,
      JSON.stringify({
        url: "http://127.0.0.1:8745/mcp",
        headers: { Authorization: "Bearer private-fixture-token" },
        mode: "headless",
      }),
    );
    const config = parseConfig({ REA_IDA_MCP_CONFIG: path });
    if (!config.ok) throw config.error;
    const producer = new RecordingIdaMcp(target, "headless");
    const provider = new IdaProvider(config.value, {}, () => producer);
    expect(await provider.inspectAvailability()).toMatchObject({
      status: "available",
      diagnostics: { live_connection_probed: false },
    });
    const resolution = await provider.resolveAnalysisProfile(target);
    if (!resolution.ok) throw resolution.error;
    expect(resolution.value.profile.parameters).toMatchObject({
      engine_version: null,
      upstream_distribution_version: null,
      cache_policy: "live",
      version_scope: "rea-ida-adapter",
    });
    expect(JSON.stringify(resolution)).not.toContain("private-fixture-token");
    expect(producer.connects).toBe(0);
    expect(
      (await provider.inspectReadinessSnapshot()).capabilities.find(
        ({ operation }) => operation === "procedure_callers",
      )?.available,
    ).toBe(false);
  });
  it(
    "re-observes externally mutable state even when a document is explicit and a snapshot is imported",
    reobservesExternallyMutableState,
  );
  it("rejects unsupported target kinds and reports incomplete upstream profiles on first analysis", async () => {
    const { root, target } = await createIdaTarget();
    roots.push(root);
    const path = join(root, "registration.json");
    await writeFile(
      path,
      JSON.stringify({
        command: "fixture",
        mode: "headless",
        workspaceRoot: root,
      }),
    );
    const config = parseConfig({ REA_IDA_MCP_CONFIG: path });
    if (!config.ok) throw config.error;
    const producer = new RecordingIdaMcp(target);
    const provider = new IdaProvider(config.value, {}, () => producer);
    expect(
      provider.inspectTargetSupport({
        path: target.path,
        sha256: target.sha256,
        kind: "database",
        format: "analysis-database",
      }),
    ).toMatchObject({ status: "unsupported", code: "target_kind_unsupported" });
    const session = createTestBinarySession(provider);
    expect((await session.open(target.path)).ok).toBe(true);
    expect(producer.connects).toBe(0);
    const analyzed = await session.execute("procedure_pseudo_code", {
      procedure: "main",
    });
    expect(analyzed).toMatchObject({
      ok: false,
      error: {
        _tag: "ProviderAdapterError",
        userMessage: expect.stringContaining(
          "headless compatibility profile is missing tools: idb_open",
        ),
      },
    });
    if (analyzed.ok) throw new Error("Expected incompatible IDA profile");
    expect(projectAnalysisError(analyzed.error).details).toMatchObject({
      provider_id: "ida",
      diagnostics: {
        mode: "headless",
        expected_profile: "database-supervisor",
        missing_tools: expect.arrayContaining(["idb_open"]),
      },
    });
    expect(producer.connects).toBe(1);
    expect((await session.close()).ok).toBe(true);
    expect(producer.closes).toBe(1);
  });
});

describe("IDA provider selection cancellation", () => {
  it("restores a cancelled replacement through the prior selected registration binding", async () => {
    const first = await createIdaTarget();
    const second = await createIdaTarget();
    roots.push(first.root, second.root);
    const path = join(first.root, "registration.json");
    await writeFile(path, JSON.stringify({ command: "first-server" }));
    const config = parseConfig({ REA_IDA_MCP_CONFIG: path });
    if (!config.ok) throw config.error;
    const factorySelections: string[] = [];
    const controller = new AbortController();
    const cancellationReason = new Error(
      "cancel after retiring previous IDA client",
    );
    let cancelWhenPreviousCloses = false;
    const provider = new IdaProvider(config.value, {}, (registration) => {
      const command =
        "command" in registration ? registration.command : registration.url;
      factorySelections.push(command);
      const producer = new RecordingIdaMcp(first.target, "attached");
      if (factorySelections.length === 1) {
        const close = producer.close.bind(producer);
        producer.close = async () => {
          await close();
          if (cancelWhenPreviousCloses) controller.abort(cancellationReason);
        };
      }
      return producer;
    });
    const session = createTestBinarySession(provider);
    expect((await session.open(first.target.path)).ok).toBe(true);
    expect(
      (await session.execute("procedure_pseudo_code", { procedure: "main" }))
        .ok,
    ).toBe(true);
    await writeFile(path, JSON.stringify({ command: "replacement-server" }));
    cancelWhenPreviousCloses = true;
    const replacement = await session.open(second.target.path, {
      signal: controller.signal,
    });
    expect(replacement.ok).toBe(false);
    expect(replacement).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError", cause: cancellationReason },
    });
    expect(session.activeTarget()?.sha256).toBe(first.target.sha256);
    expect(
      (await session.execute("procedure_pseudo_code", { procedure: "main" }))
        .ok,
    ).toBe(true);
    expect(factorySelections).toEqual(["first-server", "first-server"]);
    expect((await session.close()).ok).toBe(true);
  });
  it("preserves an already-aborted profile signal without reading registration", async () => {
    const { root, target } = await createIdaTarget();
    roots.push(root);
    const config = parseConfig({
      REA_IDA_MCP_CONFIG: join(root, "registration-that-must-not-be-read.json"),
    });
    if (!config.ok) throw config.error;
    const reason = new Error("cancel before IDA profile inspection");
    const controller = new AbortController();
    controller.abort(reason);
    let runCalls = 0;
    const profile = await new IdaProvider(
      config.value,
      {},
    ).resolveAnalysisProfile(target, {
      signal: controller.signal,
      resourceScope: {
        retain: () => undefined,
        run: async (operation) => {
          runCalls += 1;
          return operation();
        },
      },
    });
    expect(profile).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError", cause: reason },
    });
    expect(runCalls).toBe(0);
  });
});

describe("IDA universal Mach-O target identity", () => {
  const openUniversal = async (registration: Record<string, unknown>) => {
    const root = await createTestTempDirectory("rea-ida-universal-");
    const input = join(root, "universal");
    // x86_64 and arm64 slices share one whole-file digest.
    await writeFile(input, fat([0x01000007, 0x0100000c]));
    const resolved = await parseBinaryTarget(input);
    if (!resolved.ok) throw resolved.error;
    const path = join(root, "registration.json");
    await writeFile(
      path,
      JSON.stringify({ ...registration, workspaceRoot: root }),
    );
    const config = parseConfig({ REA_IDA_MCP_CONFIG: path });
    if (!config.ok) throw config.error;
    const producer = new RecordingIdaMcp(
      resolved.value,
      registration.mode === "headless" ? "headless" : "attached",
    );
    // The production registry consults IDA's own target admission.
    const session = new BinarySession(
      SessionProviderRouter.selectable(
        new AnalysisProviderRegistry([
          new IdaProvider(config.value, {}, () => producer),
        ]),
        [],
      ),
    );
    return {
      producer,
      session,
      opened: await session.open(input, { providerId: "ida" }),
    };
  };

  it.each([
    { profile: "legacy attached", registration: { command: "fixture" } },
    {
      profile: "native attached",
      registration: {
        url: "http://127.0.0.1:13337/mcp",
        mode: "attached",
        protocol: "native",
      },
    },
  ])(
    "refuses $profile analysis whose recorded whole-file digest cannot identify the loaded slice",
    async ({ registration }) => {
      const { producer, session, opened } = await openUniversal(registration);
      expect(opened).toMatchObject({
        ok: false,
        error: {
          _tag: "ProviderSelectionError",
          reason: "target_unsupported",
          rejections: [
            {
              providerId: "ida",
              code: "target_format_unsupported",
              reason: expect.stringContaining("lipo -thin"),
            },
          ],
        },
      });
      expect(producer.connects).toBe(0);
      expect((await session.close()).ok).toBe(true);
    },
  );

  it("keeps admitting headless analysis, which thins the selected slice", async () => {
    const { session, opened } = await openUniversal({
      command: "fixture",
      mode: "headless",
    });
    expect(opened.ok).toBe(true);
    expect((await session.close()).ok).toBe(true);
  });
});

describe("IDA binary_overview execution", () => {
  it("uses the bound IDA document and omits unsupported segment coverage", async () => {
    const { root, target } = await createIdaTarget();
    roots.push(root);
    const path = join(root, "registration.json");
    await writeFile(path, JSON.stringify({ command: "fixture" }));
    const config = parseConfig({ REA_IDA_MCP_CONFIG: path });
    if (!config.ok) throw config.error;
    const producer = new RecordingIdaMcp(target);
    const session = createTestBinarySession(
      new IdaProvider(config.value, {}, () => producer),
    );
    expect((await session.open(target.path)).ok).toBe(true);
    const tools = new EnhancedTools(session);
    const overview = await tools.execute("binary_overview", {});
    expect(overview.ok).toBe(true);
    if (overview.ok) {
      expect(overview.value).toMatchObject({
        document: target.path,
        procedure_count: 1,
        string_count: 1,
      });
      expect(overview.value).not.toHaveProperty("segments");
      expect(overview.value).not.toHaveProperty("segment_count");
    }
    const procedures = await session.execute("list_procedures", {});
    expect(procedures.ok).toBe(true);
    expect((await session.close()).ok).toBe(true);
  });
});
