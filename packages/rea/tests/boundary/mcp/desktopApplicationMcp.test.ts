import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createPackageWithOptions } from "@electron/asar";
import { expect, it, onTestFinished } from "vitest";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { advertisedMcpToolSchemas } from "../../fixtures/advertisedMcpTool.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { desktopApplicationSchema } from "../../../src/domain/desktopApplication.js";
import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { buildNativePeFixture } from "../../../src/dotnet/ManagedPe.fixture.js";
import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { artifactInventoryResultSchema } from "../../../src/domain/artifactGraph.js";

it.each([false, true])(
  "follows the ASAR selection probe with a previously active target: %s",
  async (previous) => {
    const root = await createTestTempDirectory("rea-desktop-asar-probe-");
    const source = join(root, "source");
    const installation = join(root, "installation");
    const resources = join(installation, "resources");
    await mkdir(source);
    await mkdir(resources, { recursive: true });
    await writeFile(
      join(source, "selected.js"),
      "export const selected = true;\n",
    );
    const archive = join(resources, "app.asar");
    await createPackageWithOptions(source, archive, {});
    const session = createTestBinarySession(new ArtifactProvider(process.env));
    const harness = await createApplicationMcpHarness({ session });
    onTestFinished(harness.close);
    if (previous) {
      const other = join(root, "previous");
      await mkdir(other);
      await writeFile(
        join(other, "previous.js"),
        "export const previous = true;\n",
      );
      const path = join(root, "previous.asar");
      await createPackageWithOptions(other, path, {});
      const opened = await harness.client.callTool({
        name: "open_binary",
        arguments: { path },
      });
      expect(opened.isError).not.toBe(true);
    }
    const result = await harness.client.callTool({
      name: "inspect_desktop_application",
      arguments: { path: installation, detail: "complete" },
    });
    expect(result.isError).not.toBe(true);
    const report = desktopApplicationSchema.parse(
      parseEvidence(result.structuredContent).normalized_result,
    );
    const archiveFile = report.files.find(
      (row) => row.path === "resources/app.asar",
    );
    if (archiveFile === undefined) throw new Error("Missing selected archive");
    const probe = report.next_probes.find(
      (row) =>
        row.file_id === archiveFile.file_id &&
        row.operation !== "analyze_javascript_application",
    );
    if (probe === undefined) throw new Error("Missing archive selection probe");
    expect(probe.operation).toBe("open_binary");
    const selected = await harness.client.callTool({
      name: probe.operation,
      arguments: { path: probe.path },
    });
    expect(selected.isError).not.toBe(true);
    const inspected = await harness.client.callTool({
      name: "inspect_artifact",
      arguments: {},
    });
    expect(inspected.isError).not.toBe(true);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.structuredContent).normalized_result,
    );
    const inventory = artifactInventoryResultSchema.parse(
      inspection.substeps[0]?.evidence.normalized_result,
    );
    expect(inventory.occurrences.map((row) => row.logical_path)).toContain(
      "selected.js",
    );
    expect(inventory.occurrences.map((row) => row.logical_path)).not.toContain(
      "previous.js",
    );
  },
);

it("advertises exact schemas and retains a compact directory answer with typed selected pages", async () => {
  const root = await createTestTempDirectory("rea-desktop-mcp-");
  await mkdir(join(root, "resources"));
  await writeFile(join(root, "resources/app.asar"), "path marker only");
  const session = createTestBinarySession(() => {
    throw new Error("Directory inspection must not acquire a deep provider");
  });
  const { client } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "desktop-directory-test", version: "1" },
    serverOptions: {
      environment: {
        ...process.env,
        REA_MCP_MAX_INPUT_ELEMENTS: process.env.REA_MCP_MAX_INPUT_ELEMENTS,
      },
    },
  });
  const schemas = await advertisedMcpToolSchemas(
    client,
    "inspect_desktop_application",
  );
  const views = await advertisedMcpToolSchemas(client, "inspect_analysis_view");
  expect(schemas.ajv.validate(schemas.inputSchema, { path: root })).toBe(true);
  expect(
    schemas.ajv.validate(schemas.inputSchema, { path: root, execute: true }),
  ).toBe(false);
  const result = await client.callTool({
    name: "inspect_desktop_application",
    arguments: { path: root },
  });
  expect(result.isError).not.toBe(true);
  expect(
    schemas.ajv.validate(schemas.outputSchema, result.structuredContent),
    JSON.stringify(schemas.ajv.errors),
  ).toBe(true);
  const summary = parseEvidence(result.structuredContent);
  const view = analysisViewResultSchema.parse(summary.normalized_result);
  expect(view.kind).toBe("summary");
  const retained = session.evidenceById(view.parent_evidence_id);
  expect(retained).toBeDefined();
  const full = desktopApplicationSchema.parse(retained?.normalized_result);
  expect(full.candidates.map((candidate) => candidate.family)).toEqual([
    "electron",
  ]);
  const archive = full.files.find((file) => file.path === "resources/app.asar");
  if (archive === undefined)
    throw new Error("Missing retained ASAR convention");
  const selected = await client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source: {
        kind: "retained-evidence",
        evidence_id: view.parent_evidence_id,
      },
      view: {
        kind: "desktop-application",
        collection: "files",
        file_ids: [archive.file_id],
        fields: ["path", "read_status"],
        limit: 1,
      },
    },
  });
  expect(selected.isError).not.toBe(true);
  expect(
    views.ajv.validate(views.outputSchema, selected.structuredContent),
    JSON.stringify(views.ajv.errors),
  ).toBe(true);
  const page = parseEvidence(selected.structuredContent);
  expect(page.evidence_links).toEqual([view.parent_evidence_id]);
  expect(page.normalized_result).toMatchObject({
    items: [
      {
        file_id: expect.any(String),
        path: "resources/app.asar",
        read_status: "not-selected",
      },
    ],
    source_coverage: { status: "complete-within-scan" },
    coverage: { total: 1, exhausted: true },
  });
  const complete = await client.callTool({
    name: "inspect_desktop_application",
    arguments: { path: root, detail: "complete" },
  });
  expect(complete.isError).not.toBe(true);
  expect(parseEvidence(complete.structuredContent).evidence_id).toBe(
    view.parent_evidence_id,
  );
});

it("surfaces unavailable probes and filters their complete retained diagnostics through MCP", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Directory inspection must not acquire a deep provider");
  });
  const harness = await createApplicationMcpHarness({ session });
  onTestFinished(harness.close);
  const client = harness.client;
  const schemas = await advertisedMcpToolSchemas(
    client,
    "inspect_desktop_application",
  );
  const views = await advertisedMcpToolSchemas(client, "inspect_analysis_view");
  const partialRoot = await createTestTempDirectory(
    "rea-desktop-probe-issues-mcp-",
  );
  await mkdir(join(partialRoot, "clean"));
  for (let index = 0; index < 20; index++)
    await writeFile(
      join(partialRoot, `probe${String(index).padStart(2, "0")}.exe`),
      buildNativePeFixture(),
    );
  const partial = await client.callTool({
    name: "inspect_desktop_application",
    arguments: { path: partialRoot, max_probe_bytes: 4096 },
  });
  expect(partial.isError).not.toBe(true);
  expect(
    schemas.ajv.validate(schemas.outputSchema, partial.structuredContent),
  ).toBe(true);
  const partialEvidence = parseEvidence(partial.structuredContent);
  const partialView = analysisViewResultSchema.parse(
    partialEvidence.normalized_result,
  );
  expect(partialView).toMatchObject({
    kind: "summary",
    summary: {
      probe_issues: {
        file_count: expect.any(Number),
        issue_count: expect.any(Number),
        preview_truncated: true,
      },
    },
  });
  const partialSource = session.evidenceById(partialView.parent_evidence_id);
  const partialReport = desktopApplicationSchema.parse(
    partialSource?.normalized_result,
  );
  const failed = partialReport.files.filter((file) => file.issues.length > 0);
  expect(failed.length).toBeGreaterThan(2);
  expect(
    failed.every((file) =>
      file.issues.some((reason) => /budget/iu.test(reason)),
    ),
  ).toBe(true);
  expect(partialView).toMatchObject({
    summary: {
      source_coverage: { status: "partial", bytes_read: expect.any(Number) },
      probe_issues: {
        file_count: failed.length,
        issue_count: failed.reduce((sum, file) => sum + file.issues.length, 0),
        preview: failed.slice(0, 2).map((file) => ({
          file_id: file.file_id,
          path_preview: file.path,
          read_status: file.read_status,
          issue_count: file.issues.length,
          first_issue_preview: file.issues[0],
          text_truncated: false,
        })),
      },
    },
  });
  for (const [hasIssues, offset, paths, total] of [
    [true, 0, failed.slice(0, 2).map((file) => file.path), failed.length],
    [true, failed.length - 1, [failed.at(-1)!.path], failed.length],
    [false, 0, ["clean"], 1],
  ] as const) {
    const args = {
      source: {
        kind: "retained-evidence",
        evidence_id: partialView.parent_evidence_id,
      },
      view: {
        kind: "desktop-application",
        collection: "files",
        has_issues: hasIssues,
        ...(hasIssues ? {} : { paths: ["clean"] }),
        fields: ["path", "read_status", "issues"],
        offset,
        limit: 2,
      },
    };
    expect(views.ajv.validate(views.inputSchema, args)).toBe(true);
    const response = await client.callTool({
      name: "inspect_analysis_view",
      arguments: args,
    });
    expect(response.isError).not.toBe(true);
    expect(
      views.ajv.validate(views.outputSchema, response.structuredContent),
    ).toBe(true);
    const evidence = parseEvidence(response.structuredContent);
    expect(evidence.evidence_links).toEqual([partialView.parent_evidence_id]);
    expect(evidence.normalized_result).toMatchObject({
      items: paths.map((path) => {
        const file = partialReport.files.find((row) => row.path === path)!;
        return {
          file_id: file.file_id,
          path,
          read_status: file.read_status,
          issues: file.issues,
        };
      }),
      source_coverage: { status: "partial" },
      coverage: { total, exhausted: offset + paths.length === total },
    });
  }
});

it.skipIf(process.platform === "win32")(
  "retains special-entry facts and advertises batched omission selections through MCP",
  async () => {
    const root = await createTestTempDirectory("rea-desktop-omissions-mcp-");
    execFileSync("mkfifo", [join(root, "b"), join(root, "a")], {
      timeout: 10_000,
    });
    const harness = await createApplicationMcpHarness();
    onTestFinished(harness.close);
    const schemas = await advertisedMcpToolSchemas(
      harness.client,
      "inspect_analysis_view",
    );
    const inspected = await harness.client.callTool({
      name: "inspect_desktop_application",
      arguments: { path: root },
    });
    expect(inspected.isError).not.toBe(true);
    const summary = analysisViewResultSchema.parse(
      parseEvidence(inspected.structuredContent).normalized_result,
    );
    expect(summary).toMatchObject({
      summary: { available_counts: { omissions: 2 } },
    });
    const source = {
      kind: "retained-evidence",
      evidence_id: summary.parent_evidence_id,
    };
    const listed = await harness.client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source,
        view: {
          kind: "desktop-application",
          collection: "omissions",
          limit: 2,
        },
      },
    });
    expect(listed.isError).not.toBe(true);
    expect(
      schemas.ajv.validate(schemas.outputSchema, listed.structuredContent),
    ).toBe(true);
    const page = analysisViewResultSchema.parse(
      parseEvidence(listed.structuredContent).normalized_result,
    );
    if (page.kind !== "desktop-application") throw new Error("Expected rows");
    const ids = page.items.map((row) => {
      if (!("omission_id" in row) || typeof row.omission_id !== "string")
        throw new Error("Missing stable omission identity");
      return row.omission_id;
    });
    expect(page.items).toMatchObject([
      { path: "a", kind: "fifo" },
      { path: "b", kind: "fifo" },
    ]);
    for (const selection of [ids, []]) {
      const args = {
        source,
        view: {
          kind: "desktop-application",
          collection: "omissions",
          omission_ids: selection,
          fields: ["kind"],
          limit: 2,
        },
      };
      expect(schemas.ajv.validate(schemas.inputSchema, args)).toBe(true);
      const selected = await harness.client.callTool({
        name: "inspect_analysis_view",
        arguments: args,
      });
      expect(selected.isError).not.toBe(true);
      expect(
        schemas.ajv.validate(schemas.outputSchema, selected.structuredContent),
      ).toBe(true);
      const evidence = parseEvidence(selected.structuredContent);
      expect(evidence.evidence_links).toEqual([summary.parent_evidence_id]);
      expect(evidence.normalized_result).toHaveProperty(
        "items",
        selection.map((omission_id) => ({ omission_id, kind: "fifo" })),
      );
      expect(evidence.normalized_result).toMatchObject({
        source_coverage: { status: "partial" },
      });
    }
  },
);
