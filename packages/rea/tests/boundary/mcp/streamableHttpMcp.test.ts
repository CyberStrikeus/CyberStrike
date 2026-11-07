import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { describe, expect, onTestFinished } from "vitest";

import { advertisedMcpToolSchemas } from "../../fixtures/advertisedMcpTool.js";
import { expectForeignHostRefused } from "../../support/http/rawRequest.js";
import { startMcpHttpProcess } from "../../support/mcp/streamableHttpProcess.js";
import { processTest } from "../../support/process/processFixture.js";
import { assertAdvertisedMcpContracts } from "./mcpContractHarness.js";

const HTTP_BOUNDARY_TIMEOUT_MS = 90_000;

const openSession = async (url: URL, name: string) => {
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client({ name, version: "1" });
  onTestFinished(() => client.close());
  await client.connect(transport);
  expect(transport.sessionId).toEqual(expect.any(String));
  const { toolDefinition } = await advertisedMcpToolSchemas(
    client,
    "binary_session",
  );
  assertAdvertisedMcpContracts(["binary_session"], [toolDefinition]);
  return { transport, client, toolDefinition };
};

/** The shared target answers with its identity only while its providers are still open. */
const expectIdentity = async ({
  client,
  toolDefinition,
}: Awaited<ReturnType<typeof openSession>>): Promise<void> => {
  const identity = await client.callTool(
    { name: "binary_session", arguments: {} },
    { toolDefinition },
  );
  expect(identity.isError).toBeFalsy();
  expect(identity.structuredContent).toMatchObject({
    result: {
      server_identity: { package: { version: expect.any(String) } },
    },
  });
};

describe("rea mcp --http", () => {
  processTest(
    "serves initialize, tools/list, a tool call and DELETE, then keeps serving later clients",
    async ({ processes }) => {
      const started = await startMcpHttpProcess(processes);
      expect(started.url.hostname).toBe("127.0.0.1");
      expect(started.url.pathname).toBe("/mcp");
      let stdout = "";
      started.child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      const first = await openSession(started.url, "streamable-http-boundary");
      expect(() =>
        assertAdvertisedMcpContracts(
          ["binary_session"],
          [first.toolDefinition, first.toolDefinition],
        ),
      ).toThrow();
      const { name } = first.toolDefinition;
      expect(() =>
        assertAdvertisedMcpContracts(["binary_session"], [{ name }]),
      ).toThrow();
      await expectIdentity(first);
      await first.transport.terminateSession();
      expect(first.transport.sessionId).toBeUndefined();
      await first.client.close();
      // DELETE ended the session, not the server: the next client's tools still work.
      const second = await openSession(started.url, "next-session");
      await expectIdentity(second);
      // A client that leaves without DELETE does not block the listener: the next initialize replaces it.
      const third = await openSession(started.url, "replacing-session");
      expect(third.transport.sessionId).not.toBe(second.transport.sessionId);
      await expectIdentity(third);
      await expect(expectIdentity(second)).rejects.toThrow("Session not found");
      await second.client.close();
      await third.transport.terminateSession();
      await third.client.close();
      expect(stdout).toBe("");
      expect(started.stderr()).toContain('"transport":"streamable-http"');
      expect(started.stderr()).toContain(
        "MCP HTTP session replaced by a new client",
      );
    },
    HTTP_BOUNDARY_TIMEOUT_MS,
  );

  processTest(
    "refuses a non-loopback Host header on the loopback bind",
    async ({ processes }) => {
      const { url } = await startMcpHttpProcess(processes);
      const refused = await expectForeignHostRefused(url);
      expect(refused.body).not.toContain("127.0.0.1");
    },
    HTTP_BOUNDARY_TIMEOUT_MS,
  );
});
