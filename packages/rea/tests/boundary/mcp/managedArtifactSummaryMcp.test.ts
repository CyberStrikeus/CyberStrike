import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it, onTestFinished } from "vitest";
import { composeBinarySession } from "../../../src/application/binary/BinarySessionComposition.js";
import { AnalysisProviderRegistry } from "../../../src/application/binary/AnalysisProviderRegistry.js";
import { inspectAnalysisView } from "../../../src/application/analysisView/AnalysisViewService.js";
import { ManagedStaticProvider } from "../../../src/dotnet/ManagedStaticProvider.js";
import { buildManagedPeFixture } from "../../../src/dotnet/ManagedPe.fixture.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import {
  managedArtifactSummaryViewResultSchema,
  analysisViewResultSchema,
} from "../../../src/domain/analysisView/analysisView.js";
import { managedArtifactInspectionSchema } from "../../../src/domain/managed/managedArtifact.js";
import { createServer } from "../../../src/server/createServer.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { closeVerifierResources } from "../../../scripts/lib/verifier-cleanup.mjs";
import { createTestMcp } from "../../support/mcp/mcpFixture.js";

const createHarness = async () => {
  const session = composeBinarySession(new AnalysisProviderRegistry([]), [
    new ManagedStaticProvider(),
  ]);
  return createApplicationMcpHarness({ session });
};

it("returns a first-call overview and pages the unchanged source after its file disappears", async () => {
  const directory = await createTestTempDirectory("rea-managed-summary-");
  const path = join(directory, "fixture.dll");
  await writeFile(
    path,
    buildManagedPeFixture({
      references: ["mscorlib", "Another.Reference"],
      customAttributeRowCount: 3,
    }),
  );
  const { client, session } = await createHarness();
  const catalog = (await client.listTools()).tools;
  const definition = catalog.find((x) => x.name === "inspect_managed_artifact");
  if (definition?.outputSchema === undefined)
    throw new Error("Managed schemas are absent");
  const outputSchema: Record<string, unknown> = definition.outputSchema;
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(definition.inputSchema)).toBe(true);
  expect(ajv.validateSchema(outputSchema)).toBe(true);
  expect(
    ajv.validate(
      catalog.find((x) => x.name === "inspect_managed_native_boundaries")!
        .inputSchema,
      { path, detail: "summary" },
    ),
  ).toBe(false);
  const reply = await client.callTool({
    name: "inspect_managed_artifact",
    arguments: { path, detail: "summary" },
  });
  expect(reply.isError).not.toBe(true);
  expect(
    ajv.validate(outputSchema, reply.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const receipt = parseEvidence(reply.structuredContent);
  const view = managedArtifactSummaryViewResultSchema.parse(
    receipt.normalized_result,
  );
  const parent = session.evidenceById(view.parent_evidence_id);
  if (parent === undefined)
    throw new Error("Complete managed source was not retained");
  const report = managedArtifactInspectionSchema.parse(
    parent.normalized_result,
  );
  expect(parent.operation).toBe("inspect_managed_artifact");
  expect(parent.parameters).toEqual({ path });
  expect(receipt.evidence_id).not.toBe(parent.evidence_id);
  expect(receipt.evidence_links).toEqual([parent.evidence_id]);
  const { references, resources, attributes, ...identity } = report;
  expect(view.summary).toMatchObject(identity);
  expect(view.summary.reported_counts).toEqual({
    references: references.length,
    resources: resources.length,
    attributes: attributes.length,
  });
  expect(view.summary).not.toHaveProperty("attributes");
  for (const detail of [undefined, "complete"]) {
    const complete = parseEvidence(
      (
        await client.callTool({
          name: "inspect_managed_artifact",
          arguments: { path, ...(detail === undefined ? {} : { detail }) },
        })
      ).structuredContent,
    );
    expect(complete.operation).toBe("inspect_managed_artifact");
    expect(complete.evidence_id).toBe(parent.evidence_id);
  }
  const reused = await client.callTool({
    name: "inspect_managed_native_boundaries",
    arguments: {},
  });
  expect(reused.isError).not.toBe(true);
  expect(parseEvidence(reused.structuredContent).subject?.local_path).toBe(
    path,
  );
  const original = JSON.stringify(parent);
  await unlink(path);
  for (const collection of ["references", "resources", "attributes"] as const) {
    const result = await client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source: { kind: "retained-evidence", evidence_id: parent.evidence_id },
        view: { kind: "managed", collection, offset: 0, limit: 1 },
      },
    });
    expect(result.isError).not.toBe(true);
    const page = analysisViewResultSchema.parse(
      parseEvidence(result.structuredContent).normalized_result,
    );
    if (page.kind !== "managed") throw new Error("Unexpected page kind");
    expect(page.item).toEqual(report[collection].slice(0, 1));
    expect(page.identity_scope.requires_mvid).toBe(report.module?.mvid ?? null);
    expect(page.source_coverage).toEqual(report.coverage);
    expect(page.coverage.total).toBe(report[collection].length);
  }
  expect(JSON.stringify(session.evidenceById(parent.evidence_id))).toBe(
    original,
  );
  expect(
    session
      .exportEvidenceBundle()
      .records.find((x) => x.evidence_id === parent.evidence_id),
  ).toEqual(parent);
  const portable = await inspectAnalysisView({
    source: { kind: "inline", evidence: parent },
    view: { kind: "summary" },
  });
  if (!portable.ok) throw portable.error;
  expect(portable.value.normalized_result).toEqual(view);
}, 30000);

it("keeps malformed metadata, empty returned rows and historical null subjects explicit", async () => {
  const directory = await createTestTempDirectory(
    "rea-managed-unavailable-view-",
  );
  const path = join(directory, "malformed.dll");
  await writeFile(
    path,
    buildManagedPeFixture({ corruptMetadataSignature: true }),
  );
  const { client } = await createHarness();
  const completeReply = await client.callTool({
    name: "inspect_managed_artifact",
    arguments: { path },
  });
  expect(completeReply.isError).not.toBe(true);
  const parent = parseEvidence(completeReply.structuredContent);
  const report = managedArtifactInspectionSchema.parse(
    parent.normalized_result,
  );
  expect(report.metadata.status).toBe("malformed");
  const historical = createEvidence(undefined, parent.provider, {
    operation: parent.operation,
    parameters: parent.parameters,
    result: parent.normalized_result,
    limitations: parent.limitations,
    authority: parent.authority,
  });
  const original = JSON.stringify(historical);
  for (const view of [
    { kind: "summary" },
    { kind: "managed", collection: "attributes", offset: 0, limit: 3 },
  ]) {
    const result = await inspectAnalysisView({
      source: { kind: "inline", evidence: historical },
      view,
    });
    if (!result.ok) throw result.error;
    expect(result.value.subject).toBeNull();
    const projected = analysisViewResultSchema.parse(
      result.value.normalized_result,
    );
    expect(projected.unknowns.join(" ")).toContain("no recorded subject");
    if (projected.kind === "managed") {
      expect(projected.item).toEqual(report.attributes);
      expect(projected.source_coverage).toEqual(report.coverage);
      expect(projected.source_metadata_status).toBe("malformed");
      expect(projected.identity_scope.requires_mvid).toBeNull();
    } else if (projected.kind === "summary") {
      const summary =
        managedArtifactSummaryViewResultSchema.parse(projected).summary;
      expect(summary.classification).toEqual(report.classification);
      expect(summary.coverage).toEqual(report.coverage);
      expect(summary.metadata).toEqual(report.metadata);
    } else throw new Error("Unexpected view");
  }
  expect(JSON.stringify(historical)).toBe(original);
  const incompatible = createEvidence(
    { path, format: "pe", sha256: "b".repeat(64) },
    parent.provider,
    {
      operation: parent.operation,
      parameters: parent.parameters,
      result: parent.normalized_result,
    },
  );
  expect(
    await inspectAnalysisView({
      source: { kind: "inline", evidence: incompatible },
      view: { kind: "summary" },
    }),
  ).toMatchObject({
    ok: false,
    error: { _tag: "EvidenceIntegrityError" },
  });
}, 30000);

it("refuses selected delivery before file access when the server cannot retain Evidence", async () => {
  const directory = await createTestTempDirectory("rea-managed-fixed-view-");
  const path = join(directory, "fixture.dll");
  await writeFile(path, buildManagedPeFixture());
  const analysis = createTestBinarySession(() => {
    throw new Error("Deep provider must not start");
  });
  const server = createServer({ kind: "fixed", analysis });
  const mcp = createTestMcp();
  onTestFinished(() =>
    closeVerifierResources([
      () => mcp.close(),
      async () => {
        const result = await analysis.close();
        if (!result.ok) throw result.error;
      },
    ]),
  );
  const client = await mcp.connect(server, {
    name: "managed-fixed-delivery",
    version: "1",
  });
  for (const name of ["inspect_managed_artifact", "inspect_managed_members"]) {
    const rejected = await client.callTool({
      name,
      arguments: { path: join(directory, "absent.dll"), detail: "summary" },
    });
    expect(parseMcpToolError(rejected).error.code).toBe(
      "capability_unavailable",
    );
  }
  const complete = await client.callTool({
    name: "inspect_managed_artifact",
    arguments: { path },
  });
  expect(complete.isError).not.toBe(true);
  expect(
    toolContract("inspect_managed_artifact").outputSchema.safeParse(
      complete.structuredContent,
    ).success,
  ).toBe(true);
}, 30000);
