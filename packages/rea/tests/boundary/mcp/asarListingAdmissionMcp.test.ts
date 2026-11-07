import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";

import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import { createServer } from "../../../src/server/createServer.js";
import { nestedAsarHeader } from "../../fixtures/asarHeader.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("reports expanded ASAR admission failure through MCP and permits a valid retry", async () => {
  const root = await createTestTempDirectory("rea-asar-listing-mcp-");
  const path = join(root, "app.asar");
  const bytes = nestedAsarHeader(64, "d".repeat(256), 4000);
  await writeFile(path, bytes);
  const session = createTestBinarySession(new ArtifactProvider(process.env));
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "asar-listing-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect(
      (await client.callTool({ name: "open_binary", arguments: { path } }))
        .isError,
    ).not.toBe(true);
    const result = await client.callTool({
      name: "inspect_artifact",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(parseMcpToolError(result)).toMatchObject({
      error: {
        code: "truncated",
        category: "truncated",
      },
    });
    expect(result.structuredContent).toBeUndefined();
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    const valid = join(root, "valid.asar");
    await writeFile(valid, nestedAsarHeader(1, "lib", 1));
    expect(
      (
        await client.callTool({
          name: "open_binary",
          arguments: { path: valid },
        })
      ).isError,
    ).not.toBe(true);
    expect(
      (await client.callTool({ name: "inspect_artifact", arguments: {} }))
        .isError,
    ).not.toBe(true);
  } finally {
    await Promise.allSettled([client.close(), server.close(), session.close()]);
  }
});
