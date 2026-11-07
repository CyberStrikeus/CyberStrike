import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import { createServer } from "../../../src/server/createServer.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { artifactInventorySummaryViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import {
  bunModuleGraphPayload,
  elfAppendedBunPayload,
} from "../../../src/artifacts/bun/BunStandalone.fixture.js";

it("exposes Bun graph metadata through the existing MCP artifact tool", async () => {
  const root = await createTestTempDirectory("rea-bun-mcp-");
  const path = join(root, "app");
  await writeFile(
    path,
    elfAppendedBunPayload(
      bunModuleGraphPayload({
        modules: [
          { name: "/$bunfs/root/main.js", contents: Buffer.from("hello") },
        ],
      }),
    ),
  );
  const session = createTestBinarySession(new ArtifactProvider({}));
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "bun-contract-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect(
      (await client.callTool({ name: "open_binary", arguments: { path } }))
        .isError,
    ).not.toBe(true);
    const reply = await client.callTool({
      name: "inspect_artifact",
      arguments: { detail: "summary" },
    });
    expect(reply.isError).not.toBe(true);
    const summary = artifactInventorySummaryViewResultSchema.parse(
      parseEvidence(reply.structuredContent).normalized_result,
    );
    expect(summary.summary.root_format_metadata).toMatchObject({
      kind: "bun-standalone",
      module_count: 1,
      entry_point_source_name: "/$bunfs/root/main.js",
    });
  } finally {
    await client.close();
    await server.close();
    await session.close();
  }
});
