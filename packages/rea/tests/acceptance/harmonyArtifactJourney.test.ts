import { artifactMcpCall } from "../../scripts/lib/artifact-e2e.mjs";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect } from "vitest";

import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import { digestCanonicalValue } from "../../src/domain/canonicalDigest.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import {
  harmonyApplicationProjectionResultSchema,
  type HarmonyApplicationProjectionResult,
} from "../../src/domain/harmony/harmonyApplication.js";
import { workspaceCliTest as test } from "../support/cli/workspaceCliFixture.js";

const expectProjectionParity = (
  graph: HarmonyApplicationProjectionResult,
  cliReply: unknown,
  sources: { readonly mcp: string; readonly cli: string },
) => {
  const cliGraph = harmonyApplicationProjectionResultSchema.parse(
    parseEvidence(cliReply).normalized_result,
  );
  expect(graph.source_evidence_ids).toEqual([sources.mcp]);
  expect(cliGraph.source_evidence_ids).toEqual([sources.cli]);
  // Projection identity includes the selected source Evidence. Bind each
  // adapter's identity before comparing its otherwise identical semantics.
  for (const projection of [graph, cliGraph]) {
    const { projection_id, ...content } = projection;
    expect(projection_id).toBe(
      `hmp_${digestCanonicalValue(content, "HarmonyOS application projection")}`,
    );
  }
  const mappedGraph = {
    ...graph,
    source_evidence_ids: [sources.cli],
  };
  const { projection_id: _mcpProjectionId, ...mappedContent } = mappedGraph;
  expect(cliGraph).toEqual({
    ...mappedContent,
    projection_id: `hmp_${digestCanonicalValue(mappedContent, "HarmonyOS application projection")}`,
  });
};

const harmonyFixture = async () => {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(
    "module.json",
    new TextReader('{"module":{"name":"fixture"}}'),
  );
  await writer.add(
    "ets/modules.abc",
    new TextReader("opaque bytecode fixture"),
  );
  await writer.add("ets/current", new TextReader("modules.abc"), {
    unixMode: 0o120777,
  });
  const javascriptPaths = ["cts", "jsx", "mts", "ts", "tsx"].map(
    (extension) => `assets/js/index.${extension}`,
  );
  for (const path of javascriptPaths)
    await writer.add(path, new TextReader("export const value = 1;"));
  return { bytes: await writer.close(), javascriptPaths };
};

test("preserves Harmony archive formats through the public CLI/MCP lifecycle", async ({
  cli,
  workspace,
}) => {
  const { bytes, javascriptPaths } = await harmonyFixture();
  const environment = {
    PATH: process.env.PATH ?? "",
    HOME: workspace.root,
    USERPROFILE: workspace.root,
    XDG_CONFIG_HOME: workspace.path("config"),
    XDG_CACHE_HOME: workspace.path("cache"),
    XDG_STATE_HOME: workspace.path("state"),
    NODE_OPTIONS: "--max-old-space-size=512",
    REA_LOG_LEVEL: "silent",
  };
  const client = new Client({ name: "rea-harmony-acceptance", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("scripts/rea.mjs"), "mcp"],
    env: environment,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    await client.listTools();
    for (const { suffix, format } of [
      { suffix: "hap", format: "hap" },
      { suffix: "hsp", format: "hsp" },
      { suffix: "app", format: "app-pack" },
    ]) {
      const path = workspace.path(`fixture.${suffix}`);
      await writeFile(path, bytes);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const cliReply = await cli.run({
        arguments: ["inspect-artifact", path, "--format", "json"],
        environment,
      });
      expect(cliReply.exitCode, cliReply.stderr).toBe(0);
      const cliEvidence = parseEvidence(cliReply.json);
      const cliInventory = artifactInspectionResultSchema.parse(
        cliEvidence.normalized_result,
      );
      expect(
        cliInventory.substeps[0]?.evidence.normalized_result.occurrences,
      ).toContainEqual(
        expect.objectContaining({
          logical_path: "ets/current",
          entry_kind: "symlink",
        }),
      );
      expect(cliInventory.subject).toMatchObject({
        root_format: format,
        root_sha256: sha256,
      });
      const opened = await artifactMcpCall(client, {
        name: "open_binary",
        arguments: { path },
      });
      expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
      expect(opened.structuredContent).toMatchObject({
        result: { kind: "archive", format, sha256 },
      });
      const status = await artifactMcpCall(client, {
        name: "binary_session",
        arguments: {},
      });
      expect(status.isError, JSON.stringify(status)).not.toBe(true);
      expect(status.structuredContent).toMatchObject({
        result: { open: true, kind: "archive", format, sha256 },
      });
      const inspected = await artifactMcpCall(client, {
        name: "inspect_artifact",
        arguments: {},
      });
      expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
      const inventoryEvidence = parseEvidence(inspected.structuredContent);
      expect(
        artifactInspectionResultSchema.parse(
          inventoryEvidence.normalized_result,
        ),
      ).toEqual(cliInventory);

      const projected = await artifactMcpCall(client, {
        name: "project_harmony_application_graph",
        arguments: { inventory_evidence: [inventoryEvidence] },
      });
      expect(projected.isError, JSON.stringify(projected)).not.toBe(true);
      const graph = harmonyApplicationProjectionResultSchema.parse(
        parseEvidence(projected.structuredContent).normalized_result,
      );
      expect(graph).toMatchObject({
        root_format: format,
        root_sha256: sha256,
        coverage: { status: "complete-within-inventory" },
        unavailable_components: [],
      });
      expect(
        graph.components.manifests.map(({ path: member }) => member),
      ).toEqual(["module.json"]);
      expect(
        graph.components.bytecode.map(({ path: member }) => member),
      ).toEqual(["ets/modules.abc"]);
      expect(
        graph.components.javascript.map(({ path: member }) => member),
      ).toEqual(javascriptPaths);
      expect(graph.runtime_families).toEqual(["ark", "javascript"]);
      const projectionInput = workspace.path("projection-input.json");
      await writeFile(
        projectionInput,
        JSON.stringify({ inventory_evidence: [cliEvidence] }),
      );
      const cliProjection = await cli.run({
        arguments: [
          "project-harmony-application-graph",
          projectionInput,
          "--format",
          "json",
        ],
        environment,
      });
      expect(cliProjection.exitCode, cliProjection.stderr).toBe(0);
      expectProjectionParity(graph, cliProjection.json, {
        mcp: inventoryEvidence.evidence_id,
        cli: cliEvidence.evidence_id,
      });
      const closed = await artifactMcpCall(client, {
        name: "close_binary",
        arguments: {},
      });
      expect(closed.isError, JSON.stringify(closed)).not.toBe(true);
      const empty = await artifactMcpCall(client, {
        name: "binary_session",
        arguments: {},
      });
      expect(empty.isError, JSON.stringify(empty)).not.toBe(true);
      expect(empty.structuredContent).toMatchObject({
        result: { open: false },
      });
      expect(Buffer.compare(await readFile(path), Buffer.from(bytes))).toBe(0);
    }
  } finally {
    await client.close();
  }
}, 120_000);
