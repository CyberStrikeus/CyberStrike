import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import { z } from "zod";

import { RequestTrackingMcpServer } from "./RequestTrackingMcpServer.js";

it.each([false, true])(
  "preserves context-only callbacks with HTTP tracking enabled=%s",
  async (tracking) => {
    const server = new RequestTrackingMcpServer({
      name: "context-only",
      version: "1",
    });
    if (tracking) server.enableRequestTracking();
    server.registerTool("context", {}, (context) => ({
      content: [{ type: "text", text: String(context.mcpReq.signal.aborted) }],
    }));
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "context-client", version: "1" });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      expect((await client.callTool({ name: "context" })).content).toEqual([
        { type: "text", text: "false" },
      ]);
      expect(await server.drainRequests(0)).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  },
);

it("never starts a tool whose asynchronous input validation finishes after transport cancellation", async () => {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const validating = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  const server = new RequestTrackingMcpServer({
    name: "validation-race",
    version: "1",
  });
  server.enableRequestTracking();
  server.registerTool(
    "slow_validation",
    {
      inputSchema: z.object({
        value: z.string().refine(async () => {
          entered();
          await gate;
          return true;
        }),
      }),
    },
    () => {
      calls += 1;
      return { content: [] };
    },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "validation-client", version: "1" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    void client
      .callTool({ name: "slow_validation", arguments: { value: "x" } })
      .catch(() => undefined);
    await validating;
    await server.close();
    expect(await server.drainRequests(0)).toBe(true);
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toBe(0);
    expect(await server.drainRequests(0)).toBe(true);
  } finally {
    release();
    await client.close();
    await server.close();
  }
});
