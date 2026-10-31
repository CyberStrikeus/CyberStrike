import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it, onTestFinished, vi } from "vitest";
import { AndroidAnalysisService } from "../../../src/application/android/AndroidAnalysisService.js";
import type { AndroidAnalysisPort } from "../../../src/application/android/AndroidAnalysisPort.js";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { inspectAndroidPackage } from "../../../src/application/android/AndroidPackageInspection.js";
import { inspectAnalysisView } from "../../../src/application/analysisView/AnalysisViewService.js";
import { androidResultSchemas } from "../../../src/domain/android/androidAnalysis.js";
import {
  androidPackageSummaryViewResultSchema,
  androidManifestViewResultSchema,
  androidComponentsViewResultSchema,
  androidComponentSummaryViewResultSchema,
  androidJniSummaryViewResultSchema,
  androidJniPageViewResultSchema,
  analysisViewResultSchema,
} from "../../../src/domain/analysisView/analysisView.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../../src/domain/evidence.js";
import { ok } from "../../../src/domain/result.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import { createServer } from "../../../src/server/createServer.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeOrderedZip } from "../../fixtures/artifactEntryOrder.js";
import {
  createJadxProtocolFixture,
  verifyJadxFixtureCleanup,
} from "../../fixtures/android/jadx.js";

async function assertAndroidPackageSelectedFacetContract(options: {
  client: Pick<Client, "callTool">;
  ajv: Ajv2020;
  outputSchema: Record<string, unknown>;
  apk: string;
  parent: Evidence;
  retained: (id: string) => Evidence | undefined;
  sourceStatus: string;
}): Promise<void> {
  const { client, ajv, outputSchema, apk, parent, retained, sourceStatus } =
    options;
  for (const facet of ["components", "component-summary"] as const) {
    const selected = await client.callTool({
      name: "inspect_android_package",
      arguments: {
        path: apk,
        detail: "summary",
        view: { kind: "android", facet },
      },
    });
    expect(selected.isError).not.toBe(true);
    expect(
      ajv.validate(outputSchema, selected.structuredContent),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    const result = parseEvidence(selected.structuredContent).normalized_result;
    const projected =
      facet === "components"
        ? androidComponentsViewResultSchema.parse(result)
        : androidComponentSummaryViewResultSchema.parse(result);
    // A fresh acquisition gets its own Evidence ID even when the engine is reused.
    const selectedParent = retained(projected.parent_evidence_id);
    expect(selectedParent?.operation).toBe("inspect_android_package");
    expect(selectedParent?.subject).toEqual(parent.subject);
    expect(selectedParent?.normalized_result).toEqual(parent.normalized_result);
    expect(projected.source_status).toBe(sourceStatus);
  }
}

const createJniSummaryContractFixture = async () => {
  const root = await createTestTempDirectory("rea-jni-default-summary-");
  const apk = join(root, "selected.apk");
  await writeOrderedZip(apk, ["AndroidManifest.xml", "classes.dex"]);
  const selection = {
    class_name: "fixture.Native",
    method_names: ["readNative"],
    abis: ["arm64-v8a"],
  };
  const raw = {
    diagnostic: "retained native producer bytes: " + "x".repeat(8192),
  };
  const declarations = ["fixture.Native", "fixture.Other"].map(
    (class_name, index) => ({
      declaration_id: `jni-declaration-${index}`,
      source_index: index,
      class_name,
      method_name: index === 0 ? "readNative" : "notSelected",
      descriptor: "(I)I",
      dex_entry: "classes.dex",
      dex_entry_index: 1,
      class_index: index,
      method_index: index,
    }),
  );
  const execute = vi.fn<AndroidAnalysisPort["execute"]>(
    async (target, request) => {
      expect(request).toEqual({
        operation: "inspect_android_jni_bindings",
        input: { path: apk, ...selection },
      });
      const result = androidResultSchemas.inspect_android_jni_bindings.parse({
        engine: {
          name: "contract fixture",
          version: "1",
          artifact_sha256: "b".repeat(64),
          source_revision: null,
          worker_count: 1,
          heap_limit_mib: null,
        },
        apk: { path: apk, sha256: target.sha256 },
        selection,
        native_inventory: {
          scope: "apk-root-dex-declarations",
          coverage: {
            status: "complete",
            dex_entries: 1,
            examined_dex_entries: 1,
            examined_classes: 2,
            examined_methods: 2,
          },
          unknowns: [],
        },
        library_inventory: {
          status: "complete",
          examined_entries: 2,
          selected_libraries: 0,
          unknowns: [],
        },
        declarations,
        selected_declaration_ids: [declarations[0]!.declaration_id],
        libraries: [],
        candidates: [],
        bindings: [
          {
            declaration_id: declarations[0]!.declaration_id,
            abi: "arm64-v8a",
            status: "unmatched",
            coverage: "complete",
            candidate_ids: [],
            unknowns: [],
          },
        ],
        unknowns: ["Static fixture facts do not establish runtime execution."],
      });
      return ok(
        createAnalysisExecution(
          result,
          {
            id: "jni-contract-fixture",
            name: "JNI contract fixture",
            version: "1",
          },
          { rawResult: raw },
        ),
      );
    },
  );
  const harness = await createApplicationMcpHarness({
    serverOptions: {
      androidAnalysis: {
        execute,
        close: async () => {},
        inspectAvailability: vi.fn(),
      },
      environment: { REA_MCP_TOOL_FAMILIES: "android,application,session" },
    },
  });
  return { ...harness, apk, selection, raw, declarations, execute };
};

it("defaults JNI MCP inspection to a retained summary while preserving explicit complete delivery and selectors", async () => {
  const { client, session, apk, selection, raw, declarations, execute } =
    await createJniSummaryContractFixture();
  const catalog = (await client.listTools()).tools;
  const definition = catalog.find(
    (tool) => tool.name === "inspect_android_jni_bindings",
  );
  if (definition?.outputSchema === undefined)
    throw new Error("Missing JNI output schema");
  const outputSchema: Record<string, unknown> = definition.outputSchema;
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const request = { path: apk, ...selection };
  expect(
    ajv.validate(definition.inputSchema, request),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const compact = await client.callTool({
    name: "inspect_android_jni_bindings",
    arguments: request,
  });
  expect(compact.isError).not.toBe(true);
  expect(
    ajv.validate(outputSchema, compact.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const summaryEvidence = parseEvidence(compact.structuredContent);
  const summary = androidJniSummaryViewResultSchema.parse(
    summaryEvidence.normalized_result,
  );
  expect(summary.summary.selection).toEqual(selection);
  expect(summary.summary.counts).toMatchObject({
    declarations: 2,
    selected_declarations: 1,
    bindings: 1,
    unmatched: 1,
  });
  expect(
    summary.summary.declarations.map((method) => method.class_name),
  ).toEqual(["fixture.Native"]);
  expect(summaryEvidence.raw_result).toBeNull();
  const parent = session.evidenceById(summary.parent_evidence_id);
  if (parent === undefined)
    throw new Error("Complete JNI parent Evidence was not retained");
  const fullReport = androidResultSchemas.inspect_android_jni_bindings.parse(
    parent.normalized_result,
  );
  expect(parent.raw_result).toEqual(raw);
  expect(fullReport.declarations).toEqual(declarations);
  expect(parent.parameters).toEqual(request);
  expect(summaryEvidence.evidence_links).toEqual([parent.evidence_id]);
  const complete = await client.callTool({
    name: "inspect_android_jni_bindings",
    arguments: { ...request, detail: "complete" },
  });
  expect(complete.isError).not.toBe(true);
  expect(
    ajv.validate(outputSchema, complete.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const completeEvidence = parseEvidence(complete.structuredContent);
  expect(completeEvidence.normalized_result).toEqual(fullReport);
  expect(completeEvidence.raw_result).toEqual(raw);
  expect(JSON.stringify(compact.structuredContent).length).toBeLessThan(
    JSON.stringify(complete.structuredContent).length,
  );
  expect(execute).toHaveBeenCalledTimes(2);
  await unlink(apk);
  const retained = await client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source: { kind: "retained-evidence", evidence_id: parent.evidence_id },
      view: {
        kind: "android-jni",
        collection: "declarations",
        indices: [1],
        fields: ["declaration_id", "class_name", "method_name"],
        limit: 1,
      },
    },
  });
  expect(retained.isError).not.toBe(true);
  const page = androidJniPageViewResultSchema.parse(
    parseEvidence(retained.structuredContent).normalized_result,
  );
  expect(page.parent_evidence_id).toBe(parent.evidence_id);
  expect(page.items).toEqual([
    {
      row_index: 1,
      declaration_id: declarations[1]!.declaration_id,
      class_name: "fixture.Other",
      method_name: "notSelected",
    },
  ]);
  expect(execute).toHaveBeenCalledTimes(2);
});

it.skipIf(process.platform === "win32")(
  "retains complete APK Evidence and reads exact manifest without its source or another engine launch",
  async () => {
    const { provider, apk, launches } =
      await createJadxProtocolFixture("large-manifest");
    const harness = await createApplicationMcpHarness({
      serverOptions: {
        androidAnalysis: provider,
        environment: { REA_MCP_TOOL_FAMILIES: "android,application,session" },
      },
    });
    onTestFinished(harness.close);
    const { client, session } = harness;
    const catalog = (await client.listTools()).tools;
    const definition = catalog.find(
      (tool) => tool.name === "inspect_android_package",
    );
    if (definition?.outputSchema === undefined)
      throw new Error("Missing APK schema");
    const outputSchema: Record<string, unknown> = definition.outputSchema;
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    expect(ajv.validateSchema(definition.inputSchema)).toBe(true);
    expect(ajv.validateSchema(outputSchema)).toBe(true);
    expect(
      ajv.validate(definition.inputSchema, { path: apk, detail: "summary" }),
    ).toBe(true);
    expect(
      ajv.validate(
        catalog.find((tool) => tool.name === "inspect_android_class")!
          .inputSchema,
        {
          path: apk,
          class_name: "fixture.Target",
          detail: "summary",
        },
      ),
    ).toBe(true);
    const reply = await client.callTool({
      name: "inspect_android_package",
      arguments: { path: apk, detail: "summary" },
    });
    expect(reply.isError).not.toBe(true);
    expect(
      ajv.validate(outputSchema, reply.structuredContent),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    const receipt = parseEvidence(reply.structuredContent);
    const view = androidPackageSummaryViewResultSchema.parse(
      receipt.normalized_result,
    );
    const parent = session.evidenceById(view.parent_evidence_id);
    if (parent === undefined)
      throw new Error("Complete package Evidence not retained");
    const report = androidResultSchemas.inspect_android_package.parse(
      parent.normalized_result,
    );
    expect(parent.operation).toBe("inspect_android_package");
    expect(parent.parameters).toEqual({ path: apk });
    expect(view.artifact.sha256).toBe(parent.subject?.digest.sha256);
    expect(view.artifact.sha256).not.toBe(report.engine.artifact_sha256);
    expect(receipt.evidence_id).not.toBe(parent.evidence_id);
    expect(receipt.evidence_links).toEqual([parent.evidence_id]);
    const { manifest, ...declarations } = report;
    expect(view.summary).toMatchObject(declarations);
    expect(view.summary.manifest).toEqual({
      status: manifest.status,
      reported_total_bytes: manifest.reported_total_bytes,
      text_code_units: manifest.text.length,
      text_included: false,
    });
    expect(receipt.raw_result).toBeNull();
    expect(parent.raw_result).not.toBeNull();
    for (const detail of [undefined, "complete"]) {
      const full = parseEvidence(
        (
          await client.callTool({
            name: "inspect_android_package",
            arguments: {
              path: apk,
              ...(detail === undefined ? {} : { detail }),
            },
          })
        ).structuredContent,
      );
      expect(full.operation).toBe("inspect_android_package");
      expect(full.normalized_result).toEqual(parent.normalized_result);
      expect(full.parameters).toEqual(parent.parameters);
      expect(full.raw_result).not.toBeNull();
    }
    await assertAndroidPackageSelectedFacetContract({
      client,
      ajv,
      outputSchema,
      apk,
      parent,
      retained: (id) => session.evidenceById(id),
      sourceStatus: report.components.status,
    });
    const before = JSON.stringify(parent);
    await unlink(apk);
    let text = "";
    let offset = 0;
    do {
      const paged = await client.callTool({
        name: "inspect_analysis_view",
        arguments: {
          source: {
            kind: "retained-evidence",
            evidence_id: parent.evidence_id,
          },
          view: { kind: "android", facet: "manifest", offset, limit: 700000 },
        },
      });
      expect(paged.isError).not.toBe(true);
      const page = androidManifestViewResultSchema.parse(
        parseEvidence(paged.structuredContent).normalized_result,
      );
      text += page.item.text;
      expect(page.item.source_status).toBe(manifest.status);
      expect(page.item.reported_total_bytes).toBe(
        manifest.reported_total_bytes,
      );
      offset = page.coverage.next_offset ?? manifest.text.length;
    } while (offset < manifest.text.length);
    expect(text).toBe(manifest.text);
    const portable = await inspectAnalysisView({
      source: { kind: "inline", evidence: parseEvidence(JSON.parse(before)) },
      view: { kind: "summary" },
    });
    if (!portable.ok) throw portable.error;
    expect(portable.value.normalized_result).toEqual(view);
    expect(JSON.stringify(session.evidenceById(parent.evidence_id))).toBe(
      before,
    );
    expect(
      session
        .exportEvidenceBundle()
        .records.find((record) => record.evidence_id === parent.evidence_id),
    ).toEqual(parent);
    expect(launches).toHaveLength(1);
    await harness.close();
    await verifyJadxFixtureCleanup(launches);
  },
  30000,
);

it("preserves partial/unknown declarations and Unicode text while rejecting missing APK identity and malformed source", async () => {
  const report = {
    engine: {
      name: "jadx",
      version: null,
      artifact_sha256: "b".repeat(64),
      source_revision: null,
      worker_count: 1,
      heap_limit_mib: null,
    },
    package_name: null,
    version_name: null,
    version_code: null,
    min_sdk: null,
    target_sdk: null,
    permissions: [],
    manifest: { status: "partial", text: "a😀b", reported_total_bytes: null },
    class_count: 0,
    resource_count: 0,
    signature_verification: "not_performed",
  };
  const evidence = (result: JsonValue = report, hasSubject = true) =>
    createEvidence(
      hasSubject
        ? { path: "/original.apk", sha256: "a".repeat(64), format: "apk" }
        : undefined,
      { id: "jadx", name: "JADX", version: "0.7.1" },
      {
        operation: "inspect_android_package",
        parameters: {},
        result,
        limitations: ["Original limit"],
      },
    );
  const parent = evidence();
  const source = { kind: "inline", evidence: parent };
  const summary = await inspectAnalysisView({
    source,
    view: { kind: "summary" },
  });
  if (!summary.ok) throw summary.error;
  const overview = androidPackageSummaryViewResultSchema.parse(
    summary.value.normalized_result,
  );
  expect(overview.summary.package_name).toBeNull();
  expect(overview.summary.manifest.status).toBe("partial");
  expect(overview.limitations).toEqual(parent.limitations);
  const page = await inspectAnalysisView({
    source,
    view: { kind: "android", facet: "manifest", offset: 0, limit: 4 },
  });
  if (!page.ok) throw page.error;
  const result = analysisViewResultSchema.parse(page.value.normalized_result);
  expect(result).toMatchObject({
    kind: "android",
    item: {
      text: "a😀b",
      source_status: "partial",
      reported_total_bytes: null,
    },
    coverage: { exhausted: true },
  });
  expect(result.unknowns.join(" ")).toContain("partial");
  for (const offset of [2])
    expect(
      await inspectAnalysisView({
        source,
        view: { kind: "android", facet: "manifest", offset, limit: 2 },
      }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
  for (const invalid of [
    evidence(report, false),
    evidence({ ...report, class_count: -1 }),
  ])
    expect(
      await inspectAnalysisView({
        source: { kind: "inline", evidence: invalid },
        view: { kind: "summary" },
      }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
});

it("rejects unavailable retention, invalid selectors and cancellation before provider execution", async () => {
  const execute = vi.fn();
  const provider = {
    execute,
    close: async () => {},
    inspectAvailability: vi.fn(),
  };
  const service = new AndroidAnalysisService(provider);
  const retention = { recordEvidence: undefined, evidenceById: undefined };
  expect(
    await inspectAndroidPackage(
      service,
      { path: "/missing.apk", detail: "summary" },
      retention,
    ),
  ).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCapabilityUnavailableError" },
  });
  expect(
    await inspectAndroidPackage(
      service,
      { path: "/missing.apk", detail: "other" },
      retention,
    ),
  ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
  const reason = { request: "cancel before Android admission" };
  const cancelled = await inspectAndroidPackage(
    service,
    { path: "/missing.apk", detail: "summary" },
    retention,
    { signal: AbortSignal.abort(reason) },
  );
  if (cancelled.ok) throw new Error("Expected Android admission cancellation");
  expect(cancelled.error._tag).toBe("AnalysisCancelledError");
  expect(cancelled.error.cause).toBe(reason);
  for (const detail of [undefined, "complete"]) {
    expect(
      await inspectAndroidPackage(
        service,
        {
          path: "/missing.apk",
          ...(detail === undefined ? {} : { detail }),
          view: { kind: "android", facet: "components" },
        },
        retention,
      ),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
  }
  expect(execute).not.toHaveBeenCalled();
  const session = createTestBinarySession(() => {
    throw new Error("Unexpected deep provider");
  });
  const server = createServer(
    { kind: "fixed", analysis: session },
    { androidAnalysis: provider },
  );
  const client = new Client({ name: "android-fixed-summary", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await session.close();
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  const reply = await client.callTool({
    name: "inspect_android_package",
    arguments: { path: "/missing.apk", detail: "summary" },
  });
  expect(parseMcpToolError(reply).error.code).toBe("capability_unavailable");
  expect(execute).not.toHaveBeenCalled();
});

it("delivers the selected retained page in one analysis and reads it later without a provider or source APK", async () => {
  const parent = createEvidence(
    { path: "/never-reopened.apk", sha256: "a".repeat(64), format: "apk" },
    { id: "jadx", name: "JADX", version: "0.7.1" },
    {
      operation: "inspect_android_package",
      parameters: { path: "/never-reopened.apk" },
      result: {
        engine: {
          name: "jadx",
          version: null,
          artifact_sha256: "b".repeat(64),
          source_revision: null,
          worker_count: 1,
          heap_limit_mib: null,
        },
        package_name: "example",
        version_name: null,
        version_code: null,
        min_sdk: null,
        target_sdk: "35",
        permissions: [],
        manifest: {
          status: "complete",
          text: "<manifest/>",
          reported_total_bytes: 11,
        },
        components: {
          status: "complete",
          limitations: [],
          items: [
            {
              kind: "activity",
              declared_name: ".Main",
              name: "example.Main",
              exported: true,
              exported_default: null,
              permission: null,
              permission_source: "none",
              intent_filter_count: 1,
              actions: ["VIEW"],
              categories: [],
              foreground_service_type: null,
              authorities: null,
              target_activity: null,
            },
          ],
        },
        class_count: 1,
        resource_count: 0,
        signature_verification: "not_performed",
      },
    },
  );
  const provider = {
    execute: vi.fn(),
    close: async () => {},
    inspectAvailability: vi.fn(),
  };
  const service = new AndroidAnalysisService(provider);
  const execute = vi.spyOn(service, "execute").mockResolvedValue(ok(parent));
  const session = createTestBinarySession(() => {
    throw new Error("Unexpected deep provider");
  });
  onTestFinished(async () => {
    const closed = await session.close();
    expect(closed.ok).toBe(true);
  });
  const view = {
    kind: "android",
    facet: "components",
    actions: ["VIEW"],
    fields: ["name"],
    limit: 1,
  };
  const selected = await inspectAndroidPackage(
    service,
    { path: "/never-reopened.apk", detail: "summary", view },
    {
      recordEvidence: session.recordEvidence.bind(session),
      evidenceById: session.evidenceById.bind(session),
    },
  );
  if (!selected.ok) throw selected.error;
  const first = androidComponentsViewResultSchema.parse(
    selected.value.normalized_result,
  );
  expect(first.items).toEqual([
    { source_index: 0, name: "example.Main", declaration_coverage: "unknown" },
  ]);
  expect(
    session.evidenceById(first.parent_evidence_id)?.normalized_result,
  ).toEqual(parent.normalized_result);
  const later = await inspectAnalysisView(
    {
      source: {
        kind: "retained-evidence",
        evidence_id: first.parent_evidence_id,
      },
      view,
    },
    session.evidenceById.bind(session),
  );
  if (!later.ok) throw later.error;
  expect(later.value.normalized_result).toEqual(first);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(provider.execute).not.toHaveBeenCalled();
});
