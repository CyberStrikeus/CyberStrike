import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it, onTestFinished } from "vitest";
import { composeBinarySession } from "../../../src/application/binary/BinarySessionComposition.js";
import { AnalysisProviderRegistry } from "../../../src/application/binary/AnalysisProviderRegistry.js";
import { inspectAnalysisView } from "../../../src/application/analysisView/AnalysisViewService.js";
import { ManagedStaticProvider } from "../../../src/dotnet/ManagedStaticProvider.js";
import { buildManagedPeFixture } from "../../../src/dotnet/ManagedPe.fixture.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../../src/domain/evidence.js";
import {
  analysisViewResultSchema,
  managedMemberSummaryViewResultSchema,
} from "../../../src/domain/analysisView/analysisView.js";
import {
  managedMemberInspectionSchema,
  type ManagedMemberInspection,
} from "../../../src/domain/managed/managedArtifact.js";
import {
  createApplicationMcpHarness,
  type ApplicationMcpHarness,
} from "../../fixtures/applicationMcpHarness.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const COLLECTIONS = [
  "types",
  "exported_types",
  "fields",
  "methods",
  "member_refs",
  "call_edges",
  "field_accesses",
  "user_strings",
] as const;

const createHarness = async () => {
  const session = composeBinarySession(new AnalysisProviderRegistry([]), [
    new ManagedStaticProvider(),
  ]);
  const harness = await createApplicationMcpHarness({ session });
  onTestFinished(harness.close);
  return harness;
};

type ToolDefinition = Awaited<
  ReturnType<ApplicationMcpHarness["client"]["listTools"]>
>["tools"][number];
const verifyProjection = async ({
  client,
  parent,
  report,
  advertised,
}: {
  readonly client: ApplicationMcpHarness["client"];
  readonly parent: Evidence;
  readonly report: ManagedMemberInspection;
  readonly advertised: readonly ToolDefinition[];
}) => {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const viewDefinition = advertised.find(
    (tool) => tool.name === "inspect_analysis_view",
  );
  if (viewDefinition?.outputSchema === undefined)
    throw new Error("View schema is absent");
  const viewInputSchema: Record<string, unknown> = viewDefinition.inputSchema;
  const viewOutputSchema: Record<string, unknown> = viewDefinition.outputSchema;
  for (const collection of COLLECTIONS) {
    const projectedReply = await client.callTool(
      {
        name: "inspect_analysis_view",
        arguments: {
          source: {
            kind: "retained-evidence",
            evidence_id: parent.evidence_id,
          },
          view: {
            kind: "managed-members",
            collection,
            fields: [],
            offset: 0,
            limit: 1,
          },
        },
      },
      { toolDefinition: viewDefinition },
    );
    expect(projectedReply.isError).not.toBe(true);
    const projected = analysisViewResultSchema.parse(
      parseEvidence(projectedReply.structuredContent).normalized_result,
    );
    if (projected.kind !== "managed-members") throw new Error("Wrong view");
    expect(projected.page.rows).toHaveLength(1);
    expect(projected.page.rows[0]).toMatchObject({ source_index: 0 });
    expect(projected.page.rows[0]).not.toHaveProperty("body");
    expect(projected.page.rows[0]).not.toHaveProperty("signature");
    expect(projected.page.rows[0]).not.toHaveProperty("target_identity_sha256");
    expect(projected.page.rows[0]).not.toHaveProperty("name_sha256");
  }
  const selectedRequest = {
    source: { kind: "retained-evidence", evidence_id: parent.evidence_id },
    view: {
      kind: "managed-members",
      collection: "methods",
      names: ["Main", "Main"],
      declaring_types: ["Fixture.Program"],
      fields: ["name", "signature"],
      offset: 1,
      limit: 1,
    },
  };
  expect(ajv.validateSchema(viewInputSchema)).toBe(true);
  expect(ajv.validateSchema(viewOutputSchema)).toBe(true);
  expect(
    ajv.validate(viewInputSchema, selectedRequest),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const selectedReply = await client.callTool(
    { name: "inspect_analysis_view", arguments: selectedRequest },
    { toolDefinition: viewDefinition },
  );
  expect(selectedReply.isError).not.toBe(true);
  const selectedEvidence = parseEvidence(selectedReply.structuredContent);
  const selectedView = analysisViewResultSchema.parse(
    selectedEvidence.normalized_result,
  );
  if (selectedView.kind !== "managed-members") throw new Error("Wrong view");
  expect(selectedEvidence.evidence_links).toEqual([parent.evidence_id]);
  expect(selectedView).toMatchObject({
    module: report.module,
    source_coverage: report.coverage,
    coverage: { total: 2, examined: 1, next_offset: null },
    page: {
      collection: "methods",
      source_count: 2,
      unresolved_filter_rows: 0,
      rows: [{ source_index: 1, token: "0x06000002", name: "Main" }],
    },
  });
  expect(selectedView.page.rows[0]).not.toHaveProperty("body");
  expect(selectedView.page.rows[0]).toMatchObject({
    signature: report.methods[1]?.signature,
  });
};

// ldarg.0; ldfld field; call member ref; ldstr "ok"; pop; ret
const SUMMARY_METHOD_BODY = Buffer.from([
  (18 << 2) | 2,
  0x02,
  0x7b,
  1,
  0,
  0,
  0x04,
  0x28,
  1,
  0,
  0,
  0x0a,
  0x72,
  1,
  0,
  0,
  0x70,
  0x26,
  0x2a,
]);

it("summarizes selected members and pages every original collection after the file disappears", async () => {
  const directory = await createTestTempDirectory("rea-member-summary-");
  const path = join(directory, "fixture.dll");
  await writeFile(
    path,
    buildManagedPeFixture({
      methodRowCount: 2,
      fieldSignature: Buffer.from([0x06, 0x12, 0x04]),
      methodSignature: Buffer.from([0x00, 0x00, 0x12, 0x04]),
      ilBody: SUMMARY_METHOD_BODY,
      userStringHeap: Buffer.from([0, 5, 0x6f, 0, 0x6b, 0, 0]),
      exportedTypes: [
        {
          namespace: "System",
          name: "Object",
          flags: 0x0020_0001,
          implementationRaw: (1 << 2) | 1,
        },
      ],
    }),
  );
  const { client, session } = await createHarness();
  const advertised = (await client.listTools()).tools;
  const definition = advertised.find(
    (x) => x.name === "inspect_managed_members",
  );
  if (definition?.outputSchema === undefined)
    throw new Error("Managed member schemas are absent");
  const outputSchema: Record<string, unknown> = definition.outputSchema;
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(definition.inputSchema)).toBe(true);
  expect(ajv.validateSchema(outputSchema)).toBe(true);
  const type_names = ["Fixture.Program", "Missing.Type"];
  expect(
    ajv.validate(definition.inputSchema, {
      path,
      type_names,
      detail: "summary",
    }),
  ).toBe(true);
  const reply = await client.callTool({
    name: "inspect_managed_members",
    arguments: { path, type_names, detail: "summary" },
  });
  expect(reply.isError).not.toBe(true);
  expect(
    ajv.validate(outputSchema, reply.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const receipt = parseEvidence(reply.structuredContent);
  const view = managedMemberSummaryViewResultSchema.parse(
    receipt.normalized_result,
  );
  const parent = session.evidenceById(view.parent_evidence_id);
  if (parent === undefined)
    throw new Error("Complete member source was not retained");
  expect(parent.operation).toBe("inspect_managed_members");
  expect(parent.parameters).toEqual({ path, type_names });
  expect(receipt.evidence_links).toEqual([parent.evidence_id]);
  const report = managedMemberInspectionSchema.parse(parent.normalized_result);
  expect(report.fields[0]?.signature.field_type).toBe(
    "class:4 (Fixture.Program)",
  );
  expect(view.summary.selection).toEqual({
    type_names,
    unmatched_type_names: ["Missing.Type"],
  });
  expect(view.summary.coverage).toEqual(report.coverage);
  expect(view.summary.method_rows).toEqual({ offset: 0, count: 2, total: 2 });
  expect(view.summary.signature_resolution).toBe("type-names-v2");
  expect(view.summary.identity_scope).toEqual(report.identity_scope);
  expect(view.summary).not.toHaveProperty("methods");
  for (const detail of [undefined, "complete"]) {
    const complete = parseEvidence(
      (
        await client.callTool({
          name: "inspect_managed_members",
          arguments: { path, type_names, ...(detail ? { detail } : {}) },
        })
      ).structuredContent,
    );
    expect(complete.operation).toBe("inspect_managed_members");
    expect(complete.evidence_id).toBe(parent.evidence_id);
  }
  const original = JSON.stringify(parent);
  await unlink(path);
  for (const collection of COLLECTIONS) {
    const rows =
      collection === "user_strings"
        ? report.user_strings?.literals
        : report[collection];
    if (rows == null) throw new Error(`${collection} was not examined`);
    // Empty collections would compare equal even if a row schema dropped facts.
    expect(rows.length, collection).toBeGreaterThan(0);
    expect(view.summary.reported_counts[collection]).toBe(rows.length);
    const paged: unknown[] = [];
    for (let offset: number | null = 0; offset !== null;) {
      const result = await client.callTool({
        name: "inspect_analysis_view",
        arguments: {
          source: {
            kind: "retained-evidence",
            evidence_id: parent.evidence_id,
          },
          view: { kind: "managed-members", collection, offset, limit: 1 },
        },
      });
      expect(result.isError).not.toBe(true);
      const page = analysisViewResultSchema.parse(
        parseEvidence(result.structuredContent).normalized_result,
      );
      if (page.kind !== "managed-members")
        throw new Error("Unexpected page kind");
      expect(page.page.collection).toBe(collection);
      expect(page.signature_resolution).toBe("type-names-v2");
      expect(page.selection).toEqual(report.selection);
      expect(page.coverage.total).toBe(rows.length);
      expect(page.method_rows).toEqual(report.method_rows);
      paged.push(...page.page.rows);
      offset = page.coverage.next_offset;
    }
    // Method rows carry body facts that a looser row schema would strip.
    expect(paged).toEqual(rows);
  }
  await verifyProjection({ client, parent, report, advertised });
  expect(JSON.stringify(session.evidenceById(parent.evidence_id))).toBe(
    original,
  );
  const portable = await inspectAnalysisView({
    source: { kind: "inline", evidence: parent },
    view: { kind: "summary" },
  });
  if (!portable.ok) throw portable.error;
  expect(portable.value.normalized_result).toEqual(view);
}, 30000);

it("keeps collections that historical member Evidence never examined unknown", async () => {
  const directory = await createTestTempDirectory("rea-member-historical-");
  const path = join(directory, "fixture.dll");
  await writeFile(path, buildManagedPeFixture());
  const { client } = await createHarness();
  const parent = parseEvidence(
    (
      await client.callTool({
        name: "inspect_managed_members",
        arguments: { path },
      })
    ).structuredContent,
  );
  const {
    exported_types: _exported,
    user_strings: _strings,
    selection: _selection,
    signature_resolution: _resolution,
    ...recorded
  } = managedMemberInspectionSchema.parse(parent.normalized_result);
  const historical = createEvidence(undefined, parent.provider, {
    operation: parent.operation,
    parameters: parent.parameters,
    result: recorded,
    limitations: parent.limitations,
    authority: parent.authority,
  });
  const summary = await inspectAnalysisView({
    source: { kind: "inline", evidence: historical },
    view: { kind: "summary" },
  });
  if (!summary.ok) throw summary.error;
  const view = managedMemberSummaryViewResultSchema.parse(
    summary.value.normalized_result,
  );
  expect(view.summary.reported_counts.exported_types).toBeNull();
  expect(view.summary.signature_resolution).toBeNull();
  expect(view.summary.reported_counts.user_strings).toBeNull();
  expect(view.summary.user_strings).toBeNull();
  expect(view.summary.selection).toBeNull();
  expect(view.unknowns.join(" ")).toContain("no recorded subject");
  for (const collection of ["exported_types", "user_strings"] as const)
    expect(
      await inspectAnalysisView({
        source: { kind: "inline", evidence: historical },
        view: { kind: "managed-members", collection, offset: 0, limit: 1 },
      }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
  expect(
    await inspectAnalysisView({
      source: { kind: "inline", evidence: historical },
      view: { kind: "managed", collection: "attributes", offset: 0, limit: 1 },
    }),
  ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
}, 30000);
