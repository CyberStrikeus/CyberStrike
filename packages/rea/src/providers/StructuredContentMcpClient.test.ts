import { InMemoryTransport, type Tool } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { z } from "zod";
import { StructuredContentMcpClient } from "./StructuredContentMcpClient.js";

/** Raw peer replies pass through the actual SDK protocol and era validator. */
const exchange = async (
  reply: Record<string, unknown>,
  run: (client: StructuredContentMcpClient) => Promise<void>,
) => {
  const client = new StructuredContentMcpClient({
    name: "structured-content-test",
    version: "1",
  });
  const [local, peer] = InMemoryTransport.createLinkedPair();
  peer.onmessage = async (message) => {
    if (
      !("method" in message) ||
      !("id" in message) ||
      message.id === undefined
    )
      return;
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "raw-peer", version: "1" },
          }
        : message.method === "tools/list"
          ? { tools: [] }
          : message.method === "ping"
            ? {}
            : reply;
    await peer.send({ jsonrpc: "2.0", id: message.id, result });
  };
  try {
    await peer.start();
    await client.connect(local);
    await run(client);
  } finally {
    await client.close();
    await peer.close();
  }
};

it("preserves structured own properties while retaining legacy default content", async () => {
  const structuredContent: unknown = JSON.parse(
    '{"__proto__":{"observed":true},"result":"field"}',
  );
  await exchange({ structuredContent }, async (client) => {
    const result = await client.callTool({ name: "observed", arguments: {} });
    expect(result.content).toEqual([]);
    expect(Object.hasOwn(result.structuredContent as object, "__proto__")).toBe(
      true,
    );
    expect(JSON.stringify(result.structuredContent)).toBe(
      JSON.stringify(structuredContent),
    );
  });
});

it.each(["task", "inputRequests", "requestState"])(
  "retains the SDK's legacy contentless foreign-family rejection for %s",
  async (key) => {
    await exchange({ [key]: {} }, async (client) => {
      await expect(
        client.callTool({ name: "foreign", arguments: {} }),
      ).rejects.toThrow(/content is required/u);
    });
  },
);

it("retains inherited callTool output-schema validation", async () => {
  const tool: Tool = {
    name: "typed",
    inputSchema: { type: "object" },
    outputSchema: {
      type: "object",
      properties: { count: { type: "integer" } },
      required: ["count"],
    },
  };
  await exchange(
    { content: [], structuredContent: { count: "wrong" } },
    async (client) => {
      await expect(
        client.callTool(
          { name: tool.name, arguments: {} },
          { toolDefinition: tool },
        ),
      ).rejects.toThrow(/does not match the tool's output schema/u);
    },
  );
});

it("delegates explicitly supplied result schemas and other method requests unchanged", async () => {
  const reply = { observed: "custom result" };
  const schema = z
    .strictObject({ observed: z.string() })
    .transform(({ observed }) => observed);
  await exchange(reply, async (client) => {
    expect(
      await client.request(
        { method: "tools/call", params: { name: "custom", arguments: {} } },
        schema,
      ),
    ).toBe("custom result");
    expect(await client.ping()).toEqual({});
  });
});
