import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { INLINE_EVIDENCE_MCP_ENVIRONMENT } from "../../../scripts/lib/mcp-verification-environment.mjs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Client } from "@modelcontextprotocol/client";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { afterAll, expect } from "vitest";
import { mcpTest } from "../../support/mcp/mcpFixture.js";
import { ownArtifactSession } from "../../support/mcp/artifactSession.js";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";
import { z } from "zod";
import { keyedArchiveResultSchema } from "../../../src/domain/apple/keyedArchive.js";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import { createServer } from "../../../src/server/createServer.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../../src/domain/evidence.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { artifactInventoryResultSchema } from "../../../src/domain/artifactGraph.js";

import {
  analysisViewResultSchema,
  type AnalysisViewResult,
} from "../../../src/domain/analysisView/analysisView.js";

const schemaValidation = createMcpSchemaValidation();
afterAll(() => schemaValidation.clear());

const assertInventorySubjectValidation = async (
  client: Client,
  source: Evidence,
): Promise<void> => {
  const result =
    source.operation === "inspect_artifact"
      ? artifactInspectionResultSchema.parse(source.normalized_result)
          .substeps[0]?.evidence.normalized_result
      : source.normalized_result;
  const inventory = artifactInventoryResultSchema.parse(result);
  if (source.subject === null)
    throw new Error("Fixture requires a known subject");
  for (const target of [
    undefined,
    {
      path: source.subject.local_path,
      sha256: inventory.manifest.root_sha256,
      format: "file" as const,
    },
    {
      path: source.subject.local_path,
      sha256: "f".repeat(64),
      format: inventory.manifest.root_format,
    },
  ]) {
    const inconsistent = createEvidence(target, source.provider, {
      operation: source.operation,
      parameters: source.parameters,
      result: source.normalized_result,
    });
    for (const view of [
      { kind: "summary" },
      { kind: "inventory", collection: "nodes", offset: 0, limit: 1 },
    ]) {
      const reply = await client.callTool({
        name: "inspect_analysis_view",
        arguments: { source: { kind: "inline", evidence: inconsistent }, view },
      });
      expect(parseMcpToolError(reply)).toMatchObject({
        error: {
          code: "invalid_request",
          details: {
            issues: [
              {
                path: ["source"],
                reason: "invalid_value",
                message: expect.stringContaining("subject does not match"),
              },
            ],
          },
        },
      });
    }
  }
};

mcpTest(
  "preserves keyed archive identities and rejects inconsistent inventory carrier subjects",
  async ({ mcp, onTestFinished }) => {
    const directory = await createTestTempDirectory("rea-keyed-mcp-");
    const path = join(directory, "archive.plist");
    await writeFile(
      path,
      await readFile(
        new URL(
          "../../fixtures/golden/keyed-archive/foundation.xml",
          import.meta.url,
        ),
      ),
    );
    const session = createTestBinarySession(new ArtifactProvider(process.env));
    ownArtifactSession(session, onTestFinished);
    const client = await mcp.connect(
      createServer({ kind: "session", session }),
      { name: "keyed-mcp-test", version: "1" },
      schemaValidation,
    );
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path },
    });
    expect(opened.isError).not.toBe(true);
    const called = await client.callTool({
      name: "inspect_keyed_archive",
      arguments: {},
    });
    expect(called.isError, JSON.stringify(called.structuredContent)).not.toBe(
      true,
    );
    const graph = keyedArchiveResultSchema.parse(
      z
        .object({ normalized_result: z.unknown() })
        .parse(called.structuredContent).normalized_result,
    );
    expect(graph.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 2, target: 2, status: "resolved" }),
        expect.objectContaining({
          source: 1,
          target: 2,
          status: "resolved",
        }),
      ]),
    );
    const rejected = await client.callTool({
      name: "inspect_keyed_archive",
      arguments: { path: "other.plist" },
    });
    expect(rejected.isError).toBe(true);
    expect(parseMcpToolError(rejected)).toMatchObject({
      error: {
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["path"],
              reason: "invalid_value",
              expected: "archive.plist",
            },
          ],
        },
      },
    });
    const missingRoot = await client.callTool({
      name: "inspect_keyed_archive",
      arguments: { root: "missing" },
    });
    expect(missingRoot.isError).toBe(true);
    expect(parseMcpToolError(missingRoot)).toMatchObject({
      error: {
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["root"],
              reason: "invalid_value",
              message: expect.stringContaining("missing"),
              expected: Object.keys(graph.roots),
            },
          ],
        },
      },
    });
    const inspected = await client.callTool({
      name: "inspect_artifact",
      arguments: {},
    });
    expect(inspected.isError).not.toBe(true);
    const parent = parseEvidence(inspected.structuredContent);
    const inspection = artifactInspectionResultSchema.parse(
      parent.normalized_result,
    );
    const inventory = inspection.substeps[0]?.evidence;
    if (inventory === undefined) throw new Error("Missing inventory Evidence");
    await assertInventorySubjectValidation(client, inventory);
    await assertInventorySubjectValidation(client, parent);
  },
);

const createInventoryViewReader = async (
  client: Client,
  parent: Evidence,
  profile: "full" | "compact",
) => {
  const advertised = (await client.listTools()).tools.find(
    (tool) => tool.name === "inspect_analysis_view",
  );
  if (advertised?.outputSchema === undefined)
    throw new Error("Missing advertised view schemas");
  const ajv = schemaValidation.assertions;
  const inputSchema: Record<string, unknown> = advertised.inputSchema;
  const outputSchema: Record<string, unknown> = advertised.outputSchema;
  const malformed = {
    source: { kind: "retained-evidence", evidence_id: parent.evidence_id },
    view: { kind: "inventory", collection: "nodes", logical_paths: [] },
  };
  if (profile === "full")
    expect(ajv.validate(inputSchema, malformed)).toBe(false);
  const rejected = await client.callTool({
    name: "inspect_analysis_view",
    arguments: malformed,
  });
  expect(parseMcpToolError(rejected)).toMatchObject({
    error: { code: "invalid_request", category: "invalid_input" },
  });
  const readView = async (
    view: Record<string, unknown>,
    source = {
      kind: "retained-evidence",
      evidence_id: parent.evidence_id,
    },
  ) => {
    const arguments_ = { source, view };
    expect(
      ajv.validate(inputSchema, arguments_),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    const reply = await client.callTool({
      name: "inspect_analysis_view",
      arguments: arguments_,
    });
    if (reply.isError)
      throw new Error(JSON.stringify(parseMcpToolError(reply)));
    expect(
      ajv.validate(outputSchema, reply.structuredContent),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    const evidence = parseEvidence(reply.structuredContent);
    return {
      evidence,
      result: analysisViewResultSchema.parse(evidence.normalized_result),
    };
  };
  return readView;
};

const assertPortableRoundtrip = async (
  client: Client,
  directory: string,
  parent: Evidence,
  originalView: AnalysisViewResult,
) => {
  const saved = join(directory, "evidence.json");
  const exported = await client.callTool({
    name: "export_evidence_bundle",
    arguments: { path: saved },
  });
  if (exported.isError)
    throw new Error(JSON.stringify(parseMcpToolError(exported)));
  const closed = await client.callTool({
    name: "close_binary",
    arguments: {},
  });
  if (closed.isError)
    throw new Error(JSON.stringify(parseMcpToolError(closed)));
  const missing = await client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source: { kind: "retained-evidence", evidence_id: parent.evidence_id },
      view: { kind: "summary" },
    },
  });
  expect(parseMcpToolError(missing)).toMatchObject({
    error: { details: { reason: "missing" } },
  });
  const imported = await client.callTool({
    name: "import_evidence_bundle",
    arguments: { path: saved },
  });
  if (imported.isError)
    throw new Error(JSON.stringify(parseMcpToolError(imported)));
  const restored = await client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source: { kind: "retained-evidence", evidence_id: parent.evidence_id },
      view: { kind: "summary" },
    },
  });
  if (restored.isError)
    throw new Error(JSON.stringify(parseMcpToolError(restored)));
  expect(parseEvidence(restored.structuredContent).normalized_result).toEqual(
    originalView,
  );
};

const assertSummaryDelivery = async (
  client: Client,
  session: ReturnType<typeof createTestBinarySession>,
  complete: Evidence,
) => {
  expect(complete.parameters).not.toHaveProperty("detail");
  const reply = await client.callTool({
    name: "inspect_artifact",
    arguments: { detail: "summary" },
  });
  expect(reply.isError, JSON.stringify(reply.structuredContent)).not.toBe(true);
  const projected = parseEvidence(reply.structuredContent);
  const view = analysisViewResultSchema.parse(projected.normalized_result);
  expect(projected.operation).toBe("inspect_analysis_view");
  expect(view.kind).toBe("summary");
  const retained = session.evidenceById(view.parent_evidence_id);
  if (retained === undefined) throw new Error("Missing complete inspection");
  expect(retained.operation).toBe("inspect_artifact");
  expect(retained.parameters).toMatchObject({ detail: "summary" });
  expect(retained.normalized_result).toEqual(complete.normalized_result);
  expect(retained.evidence_id).not.toBe(projected.evidence_id);
  const inspection = artifactInspectionResultSchema.parse(
    retained.normalized_result,
  );
  expect(
    session.evidenceById(inspection.substeps[0]?.evidence_id ?? ""),
  ).toEqual(inspection.substeps[0]?.evidence);
  const explicit = await client.callTool({
    name: "inspect_artifact",
    arguments: { detail: "complete" },
  });
  expect(explicit.isError).not.toBe(true);
  expect(parseEvidence(explicit.structuredContent).normalized_result).toEqual(
    complete.normalized_result,
  );
};

const assertOccurrencePages = async (
  readView: Awaited<ReturnType<typeof createInventoryViewReader>>,
  occurrences: z.output<typeof artifactInventoryResultSchema>["occurrences"],
) => {
  const paths = ["files/0.txt", "files/519.txt", "missing.txt"];
  const matched = occurrences.filter((row) => paths.includes(row.logical_path));
  expect(matched.map((row) => row.logical_path)).toEqual(paths.slice(0, 2));
  const selected = await readView({
    kind: "inventory",
    collection: "occurrences",
    logical_paths: paths,
    offset: 0,
    limit: 1,
  });
  expect(selected.result).toMatchObject({
    kind: "inventory",
    source_complete: true,
    items: matched.slice(0, 1),
    coverage: { examined: 1, total: 2, next_offset: 1, exhausted: false },
  });
  const next = await readView({
    kind: "inventory",
    collection: "occurrences",
    logical_paths: paths,
    offset: 1,
    limit: 1,
  });
  expect(next.result).toMatchObject({
    items: matched.slice(1, 2),
    coverage: { examined: 1, next_offset: null, exhausted: true },
  });
  const none = await readView({
    kind: "inventory",
    collection: "occurrences",
    logical_paths: [],
  });
  expect(none.result).toMatchObject({
    items: [],
    coverage: { total: 0, exhausted: true },
  });
};

mcpTest.for(["full", "compact"] as const)(
  "keeps complete ZIP output and reads retained inventory views after the source is removed (%s)",
  async (profile, { mcp, onTestFinished }) => {
    const directory = await createTestTempDirectory("rea-artifact-inline-");
    const archive = join(directory, "many.zip");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    const fileCount = 520;
    for (let index = 0; index < fileCount; index += 1)
      await writer.add(
        `files/${String(index)}.txt`,
        new TextReader(`file-${String(index)}`),
      );
    await writeFile(archive, await writer.close());

    const session = createTestBinarySession(new ArtifactProvider(process.env));
    ownArtifactSession(session, onTestFinished);
    const client = await mcp.connect(
      createServer(
        { kind: "session", session },
        {
          environment: {
            ...process.env,
            ...INLINE_EVIDENCE_MCP_ENVIRONMENT,
            REA_MCP_INPUT_SCHEMA_PROFILE: profile,
          },
        },
      ),
      { name: "artifact-inline-test", version: "1" },
      schemaValidation,
    );
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path: archive },
    });
    expect(opened.isError).not.toBe(true);
    const result = await client.callTool({
      name: "inspect_artifact",
      arguments: {},
    });
    expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(
      true,
    );
    const parent = parseEvidence(result.structuredContent);
    await assertSummaryDelivery(client, session, parent);
    const parsedInspection = artifactInspectionResultSchema.parse(
      parent.normalized_result,
    );
    const inventoryEvidence = parsedInspection.substeps[0]?.evidence;
    if (inventoryEvidence === undefined)
      throw new Error("Missing inventory Evidence");
    const graph = artifactInventoryResultSchema.parse(
      inventoryEvidence.normalized_result,
    );
    expect(graph).toMatchObject({
      integrity_contradictions: [],
      coverage: { scope: "container-entries", status: "complete" },
    });
    expect(graph.occurrences).toHaveLength(fileCount + 1);
    // Follow-ups must use retained source facts, not reopen this archive.
    await unlink(archive);
    const readView = await createInventoryViewReader(client, parent, profile);
    const summary = await readView({ kind: "summary" });
    expect(summary.result).toMatchObject({
      kind: "summary",
      parent_evidence_id: parent.evidence_id,
      artifact: { path: archive, sha256: graph.manifest.root_sha256 },
      summary: {
        manifest: graph.manifest,
        source_complete: true,
        available_counts: { occurrences: fileCount + 1 },
        observed_entry_kind_counts: { file: fileCount + 1 },
        inventory_evidence_ids: [inventoryEvidence.evidence_id],
      },
    });
    expect(summary.evidence.evidence_links).toEqual([parent.evidence_id]);
    await assertOccurrencePages(readView, graph.occurrences);

    const partial = createEvidence(
      { path: archive, sha256: graph.manifest.root_sha256, format: "zip" },
      inventoryEvidence.provider,
      {
        operation: "inventory_artifact",
        parameters: {},
        result: {
          ...graph,
          occurrences: graph.occurrences.slice(0, 1),
        },
      },
    );
    const partialReply = await client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source: { kind: "inline", evidence: partial },
        view: {
          kind: "inventory",
          collection: "occurrences",
          logical_paths: ["missing.txt"],
        },
      },
    });
    expect(
      parseEvidence(partialReply.structuredContent).normalized_result,
    ).toMatchObject({
      source_complete: false,
      items: [],
      unknowns: expect.arrayContaining([
        expect.stringContaining("Missing matches do not establish absence"),
      ]),
    });

    await assertPortableRoundtrip(client, directory, parent, summary.result);
  },
);

mcpTest(
  "refuses summary delivery without a retained Evidence owner and preserves complete delivery",
  async ({ mcp, onTestFinished }) => {
    const directory = await createTestTempDirectory("rea-inventory-fixed-");
    const archive = join(directory, "fixture.zip");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("main.js", new TextReader("console.log('fixed');\n"));
    await writeFile(archive, await writer.close());
    const session = createTestBinarySession(new ArtifactProvider(process.env));
    ownArtifactSession(session, onTestFinished);
    const opened = await session.open(archive);
    if (!opened.ok) throw opened.error;
    const client = await mcp.connect(
      createServer({ kind: "fixed", analysis: session }),
      { name: "artifact-fixed-test", version: "1" },
      schemaValidation,
    );
    const summary = await client.callTool({
      name: "inspect_artifact",
      arguments: { detail: "summary" },
    });
    expect(parseMcpToolError(summary)).toMatchObject({
      error: {
        code: "capability_unavailable",
        message: expect.stringContaining("does not retain Evidence"),
      },
    });
    const complete = await client.callTool({
      name: "inspect_artifact",
      arguments: {},
    });
    expect(complete.isError).not.toBe(true);
    expect(
      parseEvidence(complete.structuredContent).normalized_result,
    ).toMatchObject({
      substeps: [expect.objectContaining({ operation: "inventory_artifact" })],
    });
  },
);
