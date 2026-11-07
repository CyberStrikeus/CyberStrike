import { writeFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Client } from "@modelcontextprotocol/client";
import { afterAll, expect, onTestFinished } from "vitest";
import { mcpTest as it } from "../../support/mcp/mcpFixture.js";
import { ownArtifactSession } from "../../support/mcp/artifactSession.js";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { buildGodotPck, buildGodotPck1 } from "../../fixtures/godotPck.js";
import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import { createServer } from "../../../src/server/createServer.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { artifactIdForContent } from "../../../src/domain/artifactIdentity.js";
import type { ArtifactOccurrence } from "../../../src/domain/artifactGraph.js";
import {
  artifactInventorySummaryViewResultSchema,
  analysisViewResultSchema,
} from "../../../src/domain/analysisView/analysisView.js";
import {
  canBorrowParsedJsonSnapshot,
  immutableJsonSnapshotMember,
} from "../../../src/domain/immutableJson.js";

const schemaValidation = createMcpSchemaValidation();
afterAll(() => schemaValidation.clear());

const viewValidators = async (client: Client) => {
  const catalog = await client.listTools();
  const contract = catalog.tools.find(
    (tool) => tool.name === "inspect_analysis_view",
  );
  if (contract?.outputSchema === undefined)
    throw new Error("Missing named view output contract");
  const ajv = schemaValidation.assertions;
  const inputSchema: Record<string, unknown> = contract.inputSchema;
  const outputSchema: Record<string, unknown> = contract.outputSchema;
  expect(ajv.validateSchema(inputSchema)).toBe(true);
  expect(ajv.validateSchema(outputSchema)).toBe(true);
  return { ajv, inputSchema, outputSchema };
};

const retainedInventoryView =
  (
    client: Client,
    evidenceId: string,
    validators: Awaited<ReturnType<typeof viewValidators>>,
  ) =>
  async (query: Record<string, unknown>) => {
    const arguments_ = {
      source: { kind: "retained-evidence", evidence_id: evidenceId },
      view: { kind: "inventory", ...query },
    };
    expect(
      validators.ajv.validate(validators.inputSchema, arguments_),
      JSON.stringify(validators.ajv.errors),
    ).toBe(true);
    const reply = await client.callTool({
      name: "inspect_analysis_view",
      arguments: arguments_,
    });
    expect(reply.isError, JSON.stringify(reply.structuredContent)).not.toBe(
      true,
    );
    expect(
      validators.ajv.validate(validators.outputSchema, reply.structuredContent),
      JSON.stringify(validators.ajv.errors),
    ).toBe(true);
    const evidence = parseEvidence(reply.structuredContent);
    expect(evidence.evidence_links).toContain(evidenceId);
    return analysisViewResultSchema.parse(evidence.normalized_result);
  };

const assertInvalidNodeField = async (
  client: Client,
  evidenceId: string,
  validators?: Awaited<ReturnType<typeof viewValidators>>,
) => {
  const arguments_ = {
    source: { kind: "retained-evidence", evidence_id: evidenceId },
    view: { kind: "inventory", collection: "nodes", fields: ["logical_path"] },
  };
  if (validators !== undefined)
    expect(validators.ajv.validate(validators.inputSchema, arguments_)).toBe(
      false,
    );
  const rejected = await client.callTool({
    name: "inspect_analysis_view",
    arguments: arguments_,
  });
  expect(parseMcpToolError(rejected)).toMatchObject({
    error: { code: "invalid_request", category: "invalid_input" },
  });
};

const expectedPckMembers = (
  members: readonly { path: string; data: string }[],
  occurrences: readonly ArtifactOccurrence[],
) => {
  const expected = members.map((member) => {
    const sha256 = createHash("sha256").update(member.data).digest("hex");
    return {
      logical_path: member.path.slice("res://".length),
      source_path: member.path,
      artifact_id: artifactIdForContent(sha256),
      sha256,
      size: Buffer.byteLength(member.data),
    };
  });
  expect(occurrences).toHaveLength(expected.length);
  expect(occurrences).toEqual(
    expect.arrayContaining(
      expected.map(({ logical_path, source_path, artifact_id }) =>
        expect.objectContaining({ logical_path, source_path, artifact_id }),
      ),
    ),
  );
  return expected;
};

const profiles = ["full", "compact"] as const;
const members = [
  { path: "res://a.txt", data: "a" },
  { path: "res://b.txt", data: "b" },
];
const inventoryCases = profiles.flatMap((profile) => [
  { profile, version: 1 as const },
  { profile, version: 4 as const },
]);
it.for(inventoryCases)(
  "retains PCK ($profile/v$version)",
  async (input, { mcp }) => {
    const { profile, version } = input;
    const root = await createTestTempDirectory("rea-pck-mcp-");
    const path = join(root, "game.pck");
    await writeFile(
      path,
      version === 1 ? buildGodotPck1(members) : buildGodotPck(4, members),
    );
    const session = createTestBinarySession(new ArtifactProvider({}));
    ownArtifactSession(session, onTestFinished);
    const server = createServer(
      { kind: "session", session },
      {
        environment: { ...process.env, REA_MCP_INPUT_SCHEMA_PROFILE: profile },
      },
    );
    const client = await mcp.connect(
      server,
      { name: "pck-contract-test", version: "1" },
      schemaValidation,
    );
    const validators = await viewValidators(client);
    expect(
      (await client.callTool({ name: "open_binary", arguments: { path } }))
        .isError,
    ).not.toBe(true);
    const inspected = await client.callTool({
      name: "inspect_artifact",
      arguments: { detail: "summary" },
    });
    expect(inspected.isError).not.toBe(true);
    const summaryEvidence = parseEvidence(inspected.structuredContent);
    const summary = artifactInventorySummaryViewResultSchema.parse(
      summaryEvidence.normalized_result,
    );
    expect(summary.summary.root_format_metadata).toMatchObject({
      kind: "godot-pck",
      format_version: version,
      declared_file_count: 2,
    });
    const parent = session.evidenceForAnalysis(summary.parent_evidence_id);
    if (parent === undefined)
      throw new Error("Missing retained complete inspection");
    immutableJsonSnapshotMember(parent, "normalized_result");
    const parsed = artifactInspectionResultSchema.parse(
      parent.normalized_result,
    );
    if (!canBorrowParsedJsonSnapshot(parent.normalized_result, parsed))
      throw new Error("Expected an owned parse-equivalent inspection");
    const inspection = parent.normalized_result;
    const nested = inspection.substeps[0]!.evidence;
    expect(
      session.evidenceForAnalysis(nested.evidence_id)?.normalized_result,
    ).toBe(nested.normalized_result);
    const graph = nested.normalized_result;
    const view = retainedInventoryView(client, parent.evidence_id, validators);
    await assertInvalidNodeField(
      client,
      parent.evidence_id,
      profile === "full" ? validators : undefined,
    );
    const wanted = graph.occurrences.filter((row) => row.logical_path !== ".");
    const expectedMembers = expectedPckMembers(members, wanted);
    const occurrences = await view({
      collection: "occurrences",
      logical_paths: expectedMembers.map((member) => member.logical_path),
      fields: [
        "logical_path",
        "source_path",
        "declared_integrity",
        "format_metadata",
      ],
    });
    expect(occurrences.kind).toBe("inventory");
    if (occurrences.kind !== "inventory")
      throw new Error("Expected inventory view");
    expect(occurrences.items).toEqual(
      wanted.map((row) => ({
        occurrence_id: row.occurrence_id,
        artifact_id: row.artifact_id,
        parent_occurrence_id: row.parent_occurrence_id,
        logical_path: row.logical_path,
        source_path: row.source_path,
        declared_integrity: row.declared_integrity,
        format_metadata: row.format_metadata,
      })),
    );
    expect(occurrences.items).toEqual(
      expect.arrayContaining(
        expectedMembers.map(({ logical_path, source_path, artifact_id }) =>
          expect.objectContaining({ logical_path, source_path, artifact_id }),
        ),
      ),
    );
    const ids = expectedMembers.map((member) => member.artifact_id);
    const nodes = await view({
      collection: "nodes",
      artifact_ids: ids,
      fields: ["sha256", "size"],
    });
    if (nodes.kind !== "inventory") throw new Error("Expected inventory nodes");
    expect(nodes.items).toEqual(
      graph.nodes
        .filter((row) => ids.includes(row.artifact_id))
        .map((row) => ({
          artifact_id: row.artifact_id,
          sha256: row.sha256,
          size: row.size,
        })),
    );
    expect(nodes.items).toHaveLength(expectedMembers.length);
    expect(nodes.items).toEqual(
      expect.arrayContaining(
        expectedMembers.map(({ artifact_id, sha256, size }) => ({
          artifact_id,
          sha256,
          size,
        })),
      ),
    );
    await unlink(path);
    const historical = await view({
      collection: "occurrences",
      occurrence_ids: wanted.map((row) => row.occurrence_id),
      fields: [],
    });
    if (historical.kind !== "inventory")
      throw new Error("Expected historical inventory");
    expect(historical.source_coverage).toEqual({
      scope: "container-entries",
      status: "complete",
    });
    expect(historical.items).toEqual(
      wanted.map((row) => ({
        occurrence_id: row.occurrence_id,
        artifact_id: row.artifact_id,
        parent_occurrence_id: row.parent_occurrence_id,
      })),
    );
  },
);

it("carries unknown encrypted-directory coverage through compact MCP delivery", async ({
  mcp,
}) => {
  const root = await createTestTempDirectory("rea-pck-encrypted-mcp-");
  const path = join(root, "game.pck");
  await writeFile(
    path,
    buildGodotPck(4, [{ path: "res://secret.gd", data: "x" }], {
      packFlags: 3,
    }),
  );
  const session = createTestBinarySession(new ArtifactProvider({}));
  ownArtifactSession(session, onTestFinished);
  const server = createServer(
    { kind: "session", session },
    {
      environment: { ...process.env, REA_MCP_INPUT_SCHEMA_PROFILE: "compact" },
    },
  );
  const client = await mcp.connect(server, {
    name: "pck-unknown-test",
    version: "1",
  });
  const opened = await client.callTool({
    name: "open_binary",
    arguments: { path },
  });
  expect(opened.isError, JSON.stringify(opened.content)).not.toBe(true);
  const reply = await client.callTool({
    name: "inspect_artifact",
    arguments: { detail: "summary" },
  });
  expect(reply.isError, JSON.stringify(reply.structuredContent)).not.toBe(true);
  const summary = artifactInventorySummaryViewResultSchema.parse(
    parseEvidence(reply.structuredContent).normalized_result,
  );
  expect(summary.summary.source_coverage).toEqual({
    scope: "container-entries",
    status: "unknown",
  });
  expect(summary.summary.root_format_metadata).toMatchObject({
    directory_status: "encrypted",
    declared_file_count: 1,
  });
  expect(summary.summary.available_counts.occurrences).toBe(1);
  expect(summary.unknowns.join(" ")).toContain(
    "missing matches do not prove source absence",
  );
});
