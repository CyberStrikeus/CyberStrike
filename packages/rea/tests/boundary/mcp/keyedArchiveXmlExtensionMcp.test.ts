import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { build } from "plist";
import { expect } from "vitest";
import { z } from "zod";

import { createBinarySession } from "../../../src/composition/binary.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import { keyedArchiveResultSchema } from "../../../src/domain/apple/keyedArchive.js";
import { artifactInventoryResultSchema } from "../../../src/domain/artifactGraph.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { silentLogger } from "../../../src/logger.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";

mcpTest(
  "MCP inspects an XML keyed archive with a non-plist suffix",
  async ({ mcp, onTestFinished }) => {
    const root = await createTestTempDirectory("rea-keyed-xml-extension-mcp-");
    const path = join(root, "Model.archive");
    await writeFile(
      path,
      build({
        $archiver: "NSKeyedArchiver",
        $version: 100000,
        $objects: ["$null", "leaf"],
        $top: { root: { UID: 1 } },
      }).replace("?>", `?><?audit run?>${" ".repeat(8192)}`),
    );
    const configured = parseConfig({ REA_ANALYSIS_PROVIDER: "auto" });
    if (!configured.ok) throw configured.error;
    const session = createBinarySession(
      configured.value,
      silentLogger,
      process.env,
    );
    onTestFinished(async () => {
      await session.close();
    });
    const client = await mcp.connect(
      createServer({ kind: "session", session }),
    );
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path },
    });
    expect(opened.isError, JSON.stringify(opened.content)).not.toBe(true);
    const inventoryReply = await client.callTool({
      name: "inspect_artifact",
      arguments: {},
    });
    expect(
      inventoryReply.isError,
      JSON.stringify(inventoryReply.content),
    ).not.toBe(true);
    const inspectionEvidence = parseEvidence(inventoryReply.structuredContent);
    const inspection = artifactInspectionResultSchema.parse(
      inspectionEvidence.normalized_result,
    );
    const inventory = artifactInventoryResultSchema.parse(
      inspection.substeps[0]?.evidence.normalized_result,
    );
    expect(inventory.manifest.root_format).toBe("plist");
    expect(inventory.occurrences[0]?.artifact_format).toBe("plist");

    const result = await client.callTool({
      name: "inspect_keyed_archive",
      arguments: {},
    });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expect(
      z
        .object({ normalized_result: keyedArchiveResultSchema })
        .parse(result.structuredContent).normalized_result,
    ).toMatchObject({
      archive_path: "Model.archive",
      archive_format: "xml-plist",
      objects: expect.arrayContaining([
        expect.objectContaining({ value: "leaf" }),
      ]),
    });
  },
);
