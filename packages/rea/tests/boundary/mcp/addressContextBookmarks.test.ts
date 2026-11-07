import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { AnalysisProtocolError } from "../../../src/domain/analysisErrorCore.js";
import { err, ok } from "../../../src/domain/result.js";
import { createServer } from "../../../src/server/createServer.js";

it.each([
  ["resolved padded", true, "0x00401000", "0x401000", "available"],
  ["provider padded", true, "0x401000", "0x00401000", "available"],
  ["failed padded", false, "0x00401000", "0x401000", "available"],
  ["failed canonical", false, "0x401000", "0x401000", "available"],
  ["unknown identity", false, "entry", "0x401000", "unavailable"],
  ["unknown default space", false, "0x401000", "ram:0x401000", "unavailable"],
  [
    "different named spaces",
    false,
    "rom:0x401000",
    "ram:0x401000",
    "unavailable",
  ],
] as const)(
  "preserves bookmark identity: %s",
  async (_label, resolves, address, bookmarkAddress, state) => {
    const identity = {
      id: "fixture",
      name: "Fixture analysis provider",
      version: "1",
    };
    const bookmark = { address: bookmarkAddress, name: "review" };
    const directory = await createTestTempDirectory("rea-address-bookmark-");
    const target = join(directory, "fixture.com");
    await writeFile(target, Buffer.from([0xb8, 0x00, 0x4c, 0xcd, 0x21]));
    const session = createTestBinarySession(() => ({
      execute: async (operation) => {
        if (operation === "resolve_containing_procedure" && !resolves)
          return err(new AnalysisProtocolError("containment read failed"));
        const value =
          operation === "resolve_containing_procedure"
            ? {
                query_address: "0x401000",
                found: false,
                procedure: null,
                reason: "not_in_procedure",
              }
            : operation === "list_bookmarks"
              ? [bookmark, { address: "0x402000", name: "other" }]
              : operation === "address_name"
                ? "entry"
                : null;
        return ok(createAnalysisExecution(value, identity));
      },
      close: async () => ok(null),
    }));
    const server = createServer({ kind: "session", session });
    const client = new Client({ name: "bookmark-verifier", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const opened = await client.callTool({
        name: "open_binary",
        arguments: { path: target, format: "dos-com" },
      });
      expect(opened.isError).not.toBe(true);
      const response = await client.callTool({
        name: "inspect_address_context",
        arguments: { address, document: "fixture" },
      });
      expect(response.isError).not.toBe(true);
      const body = response.structuredContent as {
        result: { bookmarks: { state: string; value?: unknown } };
      };
      expect(body.result.bookmarks.state).toBe(state);
      if (state === "available")
        expect(body.result.bookmarks.value).toEqual([bookmark]);
    } finally {
      await client.close();
      await server.close();
    }
  },
);
