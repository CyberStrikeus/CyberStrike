import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect } from "vitest";

import { artifactFixedLimitFailure } from "../../src/artifacts/ArtifactReader.js";
import { dotnetBundleFixture } from "../../src/artifacts/dotnet/DotnetBundle.fixture.js";
import { cArchiveExecutable } from "../../src/artifacts/pyinstaller/CArchive.fixture.js";
import { artifactExtractionResultSchema } from "../../src/domain/artifactGraph.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import {
  analysisViewResultSchema,
  artifactInventorySummaryViewResultSchema,
} from "../../src/domain/analysisView/analysisView.js";
import { workspaceCliTest as test } from "../support/cli/workspaceCliFixture.js";

const checkProjectedMember = async (
  client: Client,
  expectedHostHash: string,
  memberPath: string,
  expectedHash: string,
) => {
  const reply = await client.callTool({
    name: "inspect_artifact",
    arguments: { detail: "summary" },
  });
  expect(reply.isError).not.toBe(true);
  const summary = artifactInventorySummaryViewResultSchema.parse(
    parseEvidence(reply.structuredContent).normalized_result,
  );
  expect(summary.summary.manifest.root_sha256).toBe(expectedHostHash);
  const parentId = summary.parent_evidence_id;
  expect(parseEvidence(reply.structuredContent).evidence_links).toContain(
    parentId,
  );
  expect(summary.summary.source_complete).toBe(true);
  const source = { kind: "retained-evidence", evidence_id: parentId };
  const read = async (view: Record<string, unknown>) => {
    const result = await client.callTool({
      name: "inspect_analysis_view",
      arguments: { source, view },
    });
    expect(result.isError).not.toBe(true);
    const page = analysisViewResultSchema.parse(
      parseEvidence(result.structuredContent).normalized_result,
    );
    if (page.kind !== "inventory") throw new Error("Unexpected view kind");
    return page;
  };
  const occurrences = await read({
    kind: "inventory",
    collection: "occurrences",
    logical_paths: [memberPath],
    fields: ["logical_path", "format_metadata", "source_location"],
    limit: 1,
  });
  expect(occurrences.parent_evidence_id).toBe(parentId);
  expect(occurrences.items).toHaveLength(1);
  const member = occurrences.items[0];
  if (
    member === undefined ||
    !("occurrence_id" in member) ||
    !("artifact_id" in member)
  )
    throw new Error("Expected a projected occurrence");
  expect(member).toMatchObject({
    logical_path: memberPath,
    format_metadata: { kind: "dotnet-bundle-entry", major_version: 6 },
  });
  expect(member).not.toHaveProperty("limitations");
  const nodes = await read({
    kind: "inventory",
    collection: "nodes",
    artifact_ids: [member.artifact_id],
    fields: ["sha256"],
    limit: 1,
  });
  expect(nodes.items).toEqual([
    { artifact_id: member.artifact_id, sha256: expectedHash },
  ]);
};

for (const format of ["dotnet-bundle", "pyinstaller"] as const) {
  test(`inspects and extracts ${format} through public CLI and stdio MCP`, async ({
    cli,
    workspace,
  }) => {
    const member =
      format === "dotnet-bundle"
        ? Buffer.from("source-owned compressed resource ".repeat(1024))
        : dotnetBundleFixture().bytes;
    const memberPath =
      format === "dotnet-bundle" ? "data/resource.txt" : "helper.exe";
    const bytes =
      format === "dotnet-bundle"
        ? dotnetBundleFixture([
            { path: memberPath, bytes: member, compressed: true, fileType: 0 },
          ]).bytes
        : cArchiveExecutable({
            layout: "2.1",
            pythonVersion: 313,
            members: [
              {
                name: memberPath,
                typeCode: "b",
                payload: member,
                compress: false,
              },
            ],
          });
    const path = workspace.path("renamed.bin");
    await writeFile(path, bytes);
    const environment = {
      PATH: process.env.PATH ?? "",
      HOME: workspace.root,
      USERPROFILE: workspace.root,
      XDG_CONFIG_HOME: workspace.path("config"),
      XDG_CACHE_HOME: workspace.path("cache"),
      XDG_STATE_HOME: workspace.path("state"),
      REA_LOG_LEVEL: "silent",
      HOPPER_LAUNCHER_PATH: workspace.path("unavailable-hopper"),
      GHIDRA_INSTALL_DIR: workspace.path("unavailable-ghidra"),
    };
    const outputs: string[] = [];
    const client = new Client({
      name: "rea-dotnet-bundle-acceptance",
      version: "1",
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("scripts/rea.mjs"), "mcp"],
      env: environment,
      stderr: "pipe",
    });
    const checkExtraction = async (value: unknown) => {
      const extraction = artifactExtractionResultSchema.parse(
        parseEvidence(value).normalized_result,
      );
      outputs.push(extraction.output_root);
      expect(extraction.containment_verified).toBe(true);
      expect(
        (await readFile(join(extraction.output_root, memberPath))).equals(
          member,
        ),
      ).toBe(true);
    };
    try {
      const inspected = await cli.run({
        arguments: ["inspect-artifact", path, "--json"],
        environment,
      });
      expect(inspected.exitCode, inspected.stderr).toBe(0);
      const inventory = artifactInspectionResultSchema.parse(
        parseEvidence(inspected.json).normalized_result,
      );
      expect(inventory.subject).toMatchObject({
        root_format: format,
        root_sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      if (format === "dotnet-bundle") {
        expect(inventory.next_probes).toHaveLength(1);
        expect(inventory.next_probes[0]).toMatchObject({
          operation: "extract_artifact",
          authority: "artifact-bytes",
        });
      }
      expect(
        inventory.unexplored_branches.map(({ next_probe }) => next_probe),
      ).toEqual(inventory.next_probes);
      const extracted = await cli.run({
        arguments: ["extract-artifact", path, "--json"],
        environment,
      });
      expect(extracted.exitCode, extracted.stderr).toBe(0);
      await checkExtraction(extracted.json);

      await client.connect(transport);
      await client.listTools();
      const opened = await client.callTool({
        name: "open_binary",
        arguments: { path },
      });
      expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
      const observed = await client.callTool({
        name: "inspect_artifact",
        arguments: {},
      });
      expect(observed.isError, JSON.stringify(observed)).not.toBe(true);
      expect(
        artifactInspectionResultSchema.parse(
          parseEvidence(observed.structuredContent).normalized_result,
        ),
      ).toEqual(inventory);
      if (format === "dotnet-bundle")
        await checkProjectedMember(
          client,
          inventory.subject.root_sha256,
          memberPath,
          createHash("sha256").update(member).digest("hex"),
        );
      const materialized = await client.callTool({
        name: "extract_artifact",
        arguments: {},
      });
      expect(materialized.isError, JSON.stringify(materialized)).not.toBe(true);
      await checkExtraction(materialized.structuredContent);
      const closed = await client.callTool({
        name: "close_binary",
        arguments: {},
      });
      expect(closed.isError, JSON.stringify(closed)).not.toBe(true);
      expect((await readFile(path)).equals(bytes)).toBe(true);
    } finally {
      await client.close();
      await Promise.all(
        outputs.map((output) => rm(output, { recursive: true, force: true })),
      );
    }
  }, 120_000);
}

test("reports excessive bundle path depth as a public CLI limit", async ({
  cli,
  workspace,
}) => {
  const path = workspace.path("deep-host.exe");
  await writeFile(
    path,
    dotnetBundleFixture([
      { path: `${"a/".repeat(256)}file`, bytes: Buffer.alloc(0) },
    ]).bytes,
  );

  const result = await cli.run({
    arguments: ["inspect-artifact", path, "--json"],
    environment: { REA_LOG_LEVEL: "silent" },
  });
  expect(result.exitCode, result.stderr).toBe(1);
  const failure = artifactFixedLimitFailure(
    "Artifact path depth",
    256,
    "path parts",
  );
  expect(result.json).toMatchObject({
    message: failure.message,
    details: { boundary: "capacity", detail: failure.message },
  });
  expect(result.json).toMatchObject({
    code: "truncated",
    category: "truncated",
    details: { reason: "limit", truncated: true },
  });
});
