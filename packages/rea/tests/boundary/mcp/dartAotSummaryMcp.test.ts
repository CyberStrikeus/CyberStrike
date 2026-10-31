import { unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it, onTestFinished, vi } from "vitest";
import { FlutterBuildAnalysisService } from "../../../src/application/flutter/FlutterBuildAnalysisService.js";
import { inspectDartAot } from "../../../src/application/flutter/DartAotInspection.js";
import { inspectAnalysisView } from "../../../src/application/analysisView/AnalysisViewService.js";
import { createFlutterBuildAnalysisProvider } from "../../../src/composition/flutter.js";
import {
  analysisViewResultSchema,
  dartAotSummaryViewResultSchema,
} from "../../../src/domain/analysisView/analysisView.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { flutterResultSchemas } from "../../../src/domain/flutter/flutterBuildAnalysis.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import {
  REFERENCE_HASH,
  appendElfRanges,
  aotFixtureImage,
  strippedAotFixtureImage,
} from "../../../src/flutter/FlutterBuild.fixture.js";
import { createFlutterApk } from "../../fixtures/flutterApk.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const dynamicSegmentOffset = (image: Buffer): number =>
  Number(image.readBigUInt64LE(64 + 56 + 8));

it("honors explicit ABI and old full requests, validates SDK schemas and reuses complete Evidence after APK removal", async () => {
  const path = await createFlutterApk("views.apk", [
    { path: "lib/arm64-v8a/libapp.so", bytes: aotFixtureImage() },
    { path: "lib/x86_64/libapp.so", bytes: aotFixtureImage("b".repeat(32)) },
  ]);
  const provider = createFlutterBuildAnalysisProvider();
  const execute = vi.spyOn(provider, "execute");
  const harness = await createApplicationMcpHarness({
    serverOptions: { flutterAnalysis: provider },
  });
  onTestFinished(harness.close);
  const { client, session } = harness;
  const catalog = (await client.listTools()).tools;
  const definition = catalog.find((tool) => tool.name === "inspect_dart_aot");
  if (definition?.outputSchema === undefined)
    throw new Error("Missing AOT output schema");
  const outputSchema: Record<string, unknown> = definition.outputSchema;
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(definition.inputSchema)).toBe(true);
  expect(ajv.validateSchema(outputSchema)).toBe(true);
  expect(
    ajv.validate(
      catalog.find((tool) => tool.name === "identify_flutter_build")!
        .inputSchema,
      { path, detail: "summary" },
    ),
  ).toBe(false);
  const reply = await client.callTool({
    name: "inspect_dart_aot",
    arguments: { path, abi: "x86_64", detail: "summary" },
  });
  expect(reply.isError).not.toBe(true);
  expect(
    ajv.validate(outputSchema, reply.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const receipt = parseEvidence(reply.structuredContent);
  const view = dartAotSummaryViewResultSchema.parse(receipt.normalized_result);
  const parent = session.evidenceById(view.parent_evidence_id);
  if (parent === undefined)
    throw new Error("Complete AOT source was not retained");
  const report = flutterResultSchemas.inspect_dart_aot.parse(
    parent.normalized_result,
  );
  expect(report.abi).toBe("x86_64");
  expect(report.libapp.snapshot_hash).toBe("b".repeat(32));
  expect(parent.parameters).toEqual({ path, abi: "x86_64" });
  expect(execute).toHaveBeenLastCalledWith(
    { operation: "inspect_dart_aot", input: { path, abi: "x86_64" } },
    expect.anything(),
  );
  expect(view.summary.libapp).toEqual(report.libapp);
  expect(view.summary.target).toEqual(report.target);
  expect(view.summary.coverage).toBe(report.coverage);
  expect(receipt.evidence_id).not.toBe(parent.evidence_id);
  expect(receipt.evidence_links).toEqual([parent.evidence_id]);
  for (const detail of [undefined, "complete"]) {
    const complete = parseEvidence(
      (
        await client.callTool({
          name: "inspect_dart_aot",
          arguments: {
            path,
            abi: "x86_64",
            ...(detail === undefined ? {} : { detail }),
          },
        })
      ).structuredContent,
    );
    expect(complete.operation).toBe("inspect_dart_aot");
    expect(complete.normalized_result).toEqual(parent.normalized_result);
    expect(complete.parameters).toEqual(parent.parameters);
  }
  const preferred = parseEvidence(
    (await client.callTool({ name: "inspect_dart_aot", arguments: { path } }))
      .structuredContent,
  );
  expect(
    flutterResultSchemas.inspect_dart_aot.parse(preferred.normalized_result)
      .abi,
  ).toBe("arm64-v8a");
  const original = JSON.stringify(parent);
  await unlink(path);
  const calls = execute.mock.calls.length;
  for (const collection of [
    "package_uris",
    "dart_uris",
    "class_like_tokens",
  ] as const) {
    const strings: string[] = [];
    let offset = 0;
    do {
      const reply = await client.callTool({
        name: "inspect_analysis_view",
        arguments: {
          source: {
            kind: "retained-evidence",
            evidence_id: parent.evidence_id,
          },
          view: { kind: "dart-aot", collection, offset, limit: 1 },
        },
      });
      expect(reply.isError).not.toBe(true);
      const page = analysisViewResultSchema.parse(
        parseEvidence(reply.structuredContent).normalized_result,
      );
      if (page.kind !== "dart-aot") throw new Error("Wrong pool page kind");
      strings.push(...page.items);
      expect(page.libapp).toEqual(report.libapp);
      expect(page.source_coverage).toBe(report.coverage);
      expect(page.string_pool.coverage).toBe(report.string_pool.coverage);
      offset =
        page.coverage.next_offset ?? report.string_pool[collection].length;
    } while (offset < report.string_pool[collection].length);
    expect(strings).toEqual(report.string_pool[collection]);
  }
  expect(execute).toHaveBeenCalledTimes(calls);
  expect(JSON.stringify(session.evidenceById(parent.evidence_id))).toBe(
    original,
  );
  expect(
    session
      .exportEvidenceBundle()
      .records.find((record) => record.evidence_id === parent.evidence_id),
  ).toEqual(parent);
  const portable = await inspectAnalysisView({
    source: { kind: "inline", evidence: parent },
    view: { kind: "summary" },
  });
  if (!portable.ok) throw portable.error;
  expect(portable.value.normalized_result).toEqual(view);
}, 30000);

it("preserves null snapshot facts and pool lower bounds after exhaustion, rejecting malformed and conflicting identities", async () => {
  const report = {
    target: { path: "/source.apk", bytes: 10, sha256: "a".repeat(64) },
    abi: "arm64-v8a",
    libapp: {
      coverage: "partial",
      bytes: 1,
      sha256: "b".repeat(64),
      snapshot_hash: null,
      snapshot_hash_candidates: [],
      snapshot_hash_sources: 0,
      sections: [],
    },
    string_pool: {
      coverage: "partial",
      package_uris: ["package:opaque/a.dart"],
      package_uri_count_at_least: 1000,
      dart_uris: [],
      dart_uri_count_at_least: 0,
      class_like_tokens: ["incidental"],
      class_like_token_count_at_least: 4000,
      printable_run_count: 12,
    },
    coverage: "partial",
  };
  const evidence = (
    result: JsonValue = report,
    sha: string | null = "a".repeat(64),
  ) =>
    createEvidence(
      sha === null
        ? undefined
        : { path: "/source.apk", sha256: sha, format: "apk" },
      { id: "flutter", name: "Flutter", version: null },
      {
        operation: "inspect_dart_aot",
        parameters: {},
        result,
        limitations: ["Original uncertainty"],
      },
    );
  for (const parent of [evidence(), evidence(report, null)]) {
    const summary = await inspectAnalysisView({
      source: { kind: "inline", evidence: parent },
      view: { kind: "summary" },
    });
    if (!summary.ok) throw summary.error;
    const result = dartAotSummaryViewResultSchema.parse(
      summary.value.normalized_result,
    );
    expect(result.summary.libapp.snapshot_hash).toBeNull();
    expect(result.summary.string_pool.package_uri_count_at_least).toBe(1000);
    expect(result.summary.string_pool.returned_counts.package_uris).toBe(1);
    expect(result.limitations).toEqual(parent.limitations);
    const page = await inspectAnalysisView({
      source: { kind: "inline", evidence: parent },
      view: {
        kind: "dart-aot",
        collection: "package_uris",
        offset: 0,
        limit: 10,
      },
    });
    if (!page.ok) throw page.error;
    expect(page.value.normalized_result).toMatchObject({
      kind: "dart-aot",
      items: report.string_pool.package_uris,
      source_coverage: "partial",
      string_pool: { coverage: "partial", package_uri_count_at_least: 1000 },
      coverage: { total: 1, exhausted: true },
    });
  }
  expect(
    await inspectAnalysisView({
      source: { kind: "inline", evidence: evidence(report, "c".repeat(64)) },
      view: { kind: "summary" },
    }),
  ).toMatchObject({ ok: false, error: { _tag: "EvidenceIntegrityError" } });
  expect(
    await inspectAnalysisView({
      source: {
        kind: "inline",
        evidence: evidence({
          ...report,
          string_pool: {
            ...report.string_pool,
            package_uri_count_at_least: -1,
          },
        }),
      },
      view: { kind: "summary" },
    }),
  ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
  expect(
    await inspectAnalysisView({
      source: { kind: "inline", evidence: evidence() },
      view: { kind: "android", facet: "manifest", offset: 0, limit: 1 },
    }),
  ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
});

it("rejects unavailable retention, invalid delivery and cancellation before producer work", async () => {
  const provider = createFlutterBuildAnalysisProvider();
  onTestFinished(() => provider.close());
  const execute = vi.spyOn(provider, "execute");
  const service = new FlutterBuildAnalysisService(provider);
  const retention = { recordEvidence: undefined, evidenceById: undefined };
  expect(
    await inspectDartAot(
      service,
      { path: "/missing.apk", abi: "x86_64", detail: "summary" },
      retention,
    ),
  ).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCapabilityUnavailableError" },
  });
  expect(
    await inspectDartAot(
      service,
      { path: "/missing.apk", detail: "other" },
      retention,
    ),
  ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
  const reason = Object.freeze({ requested: "dart-stop" });
  const cancelled = await inspectDartAot(
    service,
    { path: "/missing.apk", detail: "summary" },
    retention,
    { signal: AbortSignal.abort(reason) },
  );
  expect(cancelled).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(cancelled.ok ? undefined : cancelled.error.cause).toBe(reason);
  const executed = await service.execute(
    "inspect_dart_aot",
    { path: "/missing.apk", abi: "x86_64" },
    { signal: AbortSignal.abort(reason) },
  );
  expect(executed).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(executed.ok ? undefined : executed.error.cause).toBe(reason);
  expect(execute).not.toHaveBeenCalled();
});

it.each([
  { ignoredValue: 0n, retainedSections: false },
  { ignoredValue: 0xffffffffffffffffn, retainedSections: false },
  { ignoredValue: 0n, retainedSections: true },
])(
  "accepts bounded PT_DYNAMIC through MCP (ignored value: $ignoredValue, retained sections: $retainedSections)",
  async ({ ignoredValue, retainedSections }) => {
    const image = strippedAotFixtureImage();
    const dynamic = dynamicSegmentOffset(image);
    image.writeBigUInt64LE(ignoredValue, dynamic + 5 * 16 + 8);
    const selected = retainedSections
      ? appendElfRanges(image, "section", [
          { type: 1, offset: 0x1000, size: 52 },
          { type: 1, offset: 0x2000, size: 0x600 },
        ])
      : image;
    const path = await createFlutterApk("dt-null.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: selected },
    ]);
    const provider = createFlutterBuildAnalysisProvider();
    onTestFinished(() => provider.close());
    const harness = await createApplicationMcpHarness({
      serverOptions: { flutterAnalysis: provider },
    });
    onTestFinished(harness.close);
    const reply = await harness.client.callTool({
      name: "inspect_dart_aot",
      arguments: { path, detail: "complete" },
    });
    expect(reply.isError).not.toBe(true);
    const report = flutterResultSchemas.inspect_dart_aot.parse(
      parseEvidence(reply.structuredContent).normalized_result,
    );
    expect(report.libapp).toMatchObject({
      coverage: "complete",
      snapshot_hash: REFERENCE_HASH,
      snapshot_hash_sources: 2,
      sha256: createHash("sha256").update(selected).digest("hex"),
    });
    expect(report.libapp.sections).toHaveLength(4);
    expect(report.string_pool).toMatchObject({
      coverage: "complete",
      package_uris: ["package:example/main.dart"],
    });
  },
);

it.each([
  {
    label: "non-null unrepresentable value",
    truncate: false,
    reason: "Dynamic entry is not representable",
  },
  {
    label: "truncated terminator entry",
    truncate: true,
    reason: "Stripped ELF lacks a complete dynamic symbol-table description",
  },
])(
  "refuses unusable dynamic tables for $label",
  async ({ truncate, reason }) => {
    const image = strippedAotFixtureImage();
    const dynamic = dynamicSegmentOffset(image);
    if (truncate) {
      image.writeBigUInt64LE(5n * 16n + 15n, 64 + 56 + 0x20);
    } else {
      image.writeBigUInt64LE(0xffffffffffffffffn, dynamic + 16 + 8);
    }
    const path = await createFlutterApk("dt-null-invalid.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: image },
    ]);
    const provider = createFlutterBuildAnalysisProvider();
    onTestFinished(() => provider.close());
    const harness = await createApplicationMcpHarness({
      serverOptions: { flutterAnalysis: provider },
    });
    onTestFinished(harness.close);
    const reply = await harness.client.callTool({
      name: "inspect_dart_aot",
      arguments: { path, detail: "summary" },
    });
    expect(reply.isError, JSON.stringify(reply)).toBe(true);
    const error = parseMcpToolError(reply).error;
    expect(error).toMatchObject({
      code: "unsupported_target",
      details: {
        operation: "inspect_dart_aot",
        reason: expect.stringContaining(reason),
      },
    });
  },
);
