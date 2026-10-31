import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, onTestFinished } from "vitest";

import {
  DEFAULT_BUILD_TEMPLATE_RULES,
  buildEnvironment,
} from "../../../src/application/environment/environmentBuild.js";
import { evidenceFileBytes } from "../../../src/application/environment/environmentEvidenceBytes.js";
import { environmentExportFile } from "../../../src/application/environment/environmentExport.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import type { Evidence } from "../../../src/domain/evidence.js";
import { createServer } from "../../../src/server/createServer.js";
import { advertisedMcpToolSchemas } from "../../fixtures/advertisedMcpTool.js";
import {
  analysisViewCaptureEvidence,
  environmentManifestCaptureFixture,
  timedCaptureEvidence,
} from "../../fixtures/analysisView.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const TOOL = "export_environment_bundle";

const connect = async () => {
  const session = createTestBinarySession(() => {
    throw new Error("the bundle export must not start a deep provider");
  });
  const server = createServer(
    { kind: "session", session },
    {
      environment: { ...process.env, REA_MCP_INPUT_SCHEMA_PROFILE: "full" },
    },
  );
  const client = new Client({ name: "environment-bundle-mcp", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, session };
};

const listFiles = async (root: string): Promise<string[]> =>
  (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .split(sep)
        .join("/"),
    )
    .sort();

const loopbackCapture = (): Evidence =>
  analysisViewCaptureEvidence(
    JSON.parse(
      JSON.stringify(environmentManifestCaptureFixture()).replaceAll(
        /https?:\/\/grafana\.example/gu,
        "http://127.0.0.1:3000",
      ),
    ) as ReturnType<typeof environmentManifestCaptureFixture>,
  );

it("reports an unmodelled literal delete without claiming recorded reads are absent", async () => {
  const { client, session } = await connect();
  const capture = timedCaptureEvidence([
    ["GET", "/api/folders", [{ uid: "f1", title: "General" }]],
    ["GET", "/api/folders/f1", { uid: "f1", title: "General" }],
    ["DELETE", "/api/folders/f1", null, 204],
    ["GET", "/api/folders/f1", { message: "not found" }, 404],
    ["GET", "/api/folders", []],
  ]);
  expect(session.recordEvidence(capture).ok).toBe(true);
  const root = await createTestTempDirectory("rea-bundle-mcp-target-");
  const response = await client.callTool({
    name: TOOL,
    arguments: {
      source: { kind: "retained-evidence", evidence_id: capture.evidence_id },
      output_directory: join(root, "bundle"),
      dry_run: true,
    },
  });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  const report = toolContract(TOOL).outputSchema.parse(
    response.structuredContent,
  );
  if (report.coverage === null) throw new Error("Expected coverage");
  expect(report.coverage.writes.withheld).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        reason: "no-state-target",
        hint: expect.stringContaining(
          "could not be linked to a modelled state target",
        ),
      }),
    ]),
  );
});

it("writes the bundle environment-build writes from retained capture Evidence", async () => {
  const { client, session } = await connect();
  const { ajv, inputSchema, outputSchema } = await advertisedMcpToolSchemas(
    client,
    TOOL,
  );
  const capture = analysisViewCaptureEvidence(
    environmentManifestCaptureFixture(),
  );
  expect(session.recordEvidence(capture).ok).toBe(true);
  const root = await createTestTempDirectory("rea-bundle-mcp-");
  const input = {
    source: { kind: "retained-evidence", evidence_id: capture.evidence_id },
    output_directory: join(root, "grafana"),
  };
  expect(ajv.validate(inputSchema, input)).toBe(true);
  const response = await client.callTool({ name: TOOL, arguments: input });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  expect(
    ajv.validate(outputSchema, response.structuredContent),
    JSON.stringify(ajv.errors),
  ).toBe(true);
  const report = toolContract(TOOL).outputSchema.parse(
    response.structuredContent,
  );
  expect(report).toMatchObject({
    status: "built",
    name: "grafana-example",
    directory: input.output_directory,
    capture: { evidence_id: capture.evidence_id, input: "evidence" },
    manifest: { template_rules: [...DEFAULT_BUILD_TEMPLATE_RULES] },
  });
  const file = await environmentExportFile(
    "evidence",
    "capture.json",
    evidenceFileBytes(capture),
  );
  if (!file.ok) throw file.error;
  const reference = await buildEnvironment({
    capture: file.value,
    captureInput: "evidence",
    capturePath: "capture.json",
    templateRules: DEFAULT_BUILD_TEMPLATE_RULES,
    directory: join(root, "reference"),
    dryRun: false,
  });
  if (!reference.ok) throw reference.error;
  const files = await listFiles(input.output_directory);
  expect(files).toEqual(await listFiles(join(root, "reference")));
  for (const path of files)
    expect(
      Buffer.compare(
        await readFile(join(input.output_directory, path)),
        await readFile(join(root, "reference", path)),
      ),
      path,
    ).toBe(0);
  expect(report.coverage).toEqual(reference.value.coverage);
});

it("copies a capture Evidence file byte for byte and plans without writing on a dry run", async () => {
  const { client } = await connect();
  const root = await createTestTempDirectory("rea-bundle-mcp-file-");
  const path = join(root, "grafana.capture.json");
  await writeFile(
    path,
    `${JSON.stringify(analysisViewCaptureEvidence(environmentManifestCaptureFixture()), null, 2)}\n`,
  );
  const planned = await client.callTool({
    name: TOOL,
    arguments: {
      source: { kind: "evidence-file", path },
      output_directory: join(root, "planned"),
      dry_run: true,
    },
  });
  expect(planned.isError).not.toBe(true);
  expect(planned.structuredContent).toMatchObject({ status: "planned" });
  await expect(access(join(root, "planned"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const built = await client.callTool({
    name: TOOL,
    arguments: {
      source: { kind: "evidence-file", path },
      output_directory: join(root, "built"),
    },
  });
  expect(built.isError).not.toBe(true);
  expect(
    Buffer.compare(
      await readFile(join(root, "built/envs/grafana-example/evidence.json")),
      await readFile(path),
    ),
  ).toBe(0);
});

it("attributes source file admission and JSON failures to source.path", async () => {
  const { client } = await connect();
  const root = await createTestTempDirectory("rea-bundle-source-errors-");
  await mkdir(join(root, "directory"));
  await writeFile(join(root, "invalid-utf8"), Buffer.from([0xff]));
  await writeFile(join(root, "invalid-json"), "{");
  for (const [name, reason] of [
    ["missing", "invalid_value"],
    ["directory", "invalid_value"],
    ["invalid-utf8", "invalid_format"],
    ["invalid-json", "invalid_format"],
  ] as const) {
    const output = join(root, `out-${name}`);
    const result = await client.callTool({
      name: TOOL,
      arguments: {
        source: { kind: "evidence-file", path: join(root, name) },
        output_directory: output,
        dry_run: true,
      },
    });
    const { error } = parseMcpToolError(result);
    expect(error).toMatchObject({
      code: "invalid_request",
      recovery: { kind: "inspect_input_contract", operation: TOOL },
      details: { issues: [{ path: ["source", "path"], reason }] },
    });
    expect(JSON.stringify(error)).not.toContain(
      "inline JSON cannot be exported",
    );
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  }
});

it("refuses an existing or parentless output directory and leaves it as it was", async () => {
  const { client, session } = await connect();
  const capture = analysisViewCaptureEvidence(
    environmentManifestCaptureFixture(),
  );
  expect(session.recordEvidence(capture).ok).toBe(true);
  const root = await createTestTempDirectory("rea-bundle-mcp-dirs-");
  const source = {
    kind: "retained-evidence",
    evidence_id: capture.evidence_id,
  };
  const empty = join(root, "empty");
  const busy = join(root, "busy");
  const regular = join(root, "regular");
  await mkdir(empty);
  await mkdir(busy);
  await writeFile(join(busy, "notes.md"), "keep");
  await writeFile(regular, "keep");
  for (const [output_directory, dry_run] of [
    [empty, false],
    [busy, true],
    [regular, true],
  ] as const) {
    const refused = await client.callTool({
      name: TOOL,
      arguments: { source, output_directory, dry_run },
    });
    expect(refused.isError).toBe(true);
    expect(parseMcpToolError(refused).error).toMatchObject({
      code: "invalid_request",
      message: "Output root already exists",
      details: {
        operation: TOOL,
        issues: [
          {
            path: ["output_directory"],
            reason: "invalid_value",
            message: "Output root already exists",
          },
        ],
      },
    });
  }
  expect(await readdir(empty)).toEqual([]);
  expect(await readdir(busy)).toEqual(["notes.md"]);
  expect(await readFile(regular, "utf8")).toBe("keep");
  const parentless = await client.callTool({
    name: TOOL,
    arguments: {
      source,
      output_directory: join(root, "missing", "env"),
      dry_run: true,
    },
  });
  expect(parentless.isError).toBe(true);
  expect(parseMcpToolError(parentless).error).toMatchObject({
    message: "Output parent is unavailable",
    details: {
      issues: [
        { path: ["output_directory"], message: "Output parent is unavailable" },
      ],
    },
  });
  await expect(access(join(root, "missing"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const relative = await client.callTool({
    name: TOOL,
    arguments: { source, output_directory: "relative/env" },
  });
  expect(parseMcpToolError(relative).error).toMatchObject({
    code: "invalid_request",
    details: { issues: [{ path: ["output_directory"] }] },
  });
});

it("refuses unknown, unnamed loopback and non-capture Evidence, and repeated rules", async () => {
  const { client, session } = await connect();
  const root = await createTestTempDirectory("rea-bundle-mcp-refuse-");
  const output_directory = join(root, "env");
  const unknown = await client.callTool({
    name: TOOL,
    arguments: {
      source: {
        kind: "retained-evidence",
        evidence_id: `ev_${"0".repeat(63)}9`,
      },
      output_directory,
    },
  });
  expect(unknown.isError).toBe(true);
  const loopback = loopbackCapture();
  expect(session.recordEvidence(loopback).ok).toBe(true);
  const unnamed = await client.callTool({
    name: TOOL,
    arguments: {
      source: { kind: "retained-evidence", evidence_id: loopback.evidence_id },
      output_directory,
    },
  });
  expect(parseMcpToolError(unnamed).error).toMatchObject({
    code: "invalid_request",
    details: { issues: [{ path: ["name"] }] },
  });
  const named = await client.callTool({
    name: TOOL,
    arguments: {
      source: { kind: "retained-evidence", evidence_id: loopback.evidence_id },
      output_directory,
      name: "grafana",
      dry_run: true,
    },
  });
  expect(named.structuredContent).toMatchObject({
    status: "planned",
    name: "grafana",
    warnings: [],
  });
  const repeated = await client.callTool({
    name: TOOL,
    arguments: {
      source: { kind: "retained-evidence", evidence_id: loopback.evidence_id },
      output_directory,
      name: "grafana",
      template_rules: ["opaque-token", "opaque-token"],
    },
  });
  expect(parseMcpToolError(repeated).error).toMatchObject({
    code: "invalid_request",
  });
  await expect(access(output_directory)).rejects.toMatchObject({
    code: "ENOENT",
  });
});
