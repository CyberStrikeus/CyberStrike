import { createVerifierHttpServer } from "../../../scripts/lib/verifier-http-server.mjs";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import type { IncomingMessage, ServerResponse } from "node:http";

import { expect, it } from "vitest";
import { z } from "zod";

import { createStreamableHttpJebMcpConnection } from "../../../src/jeb/JebMcpConnection.js";
import { AnalysisTimeoutError } from "../../../src/domain/analysisErrorCore.js";

const requestSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.object({ cursor: z.string().optional() }).passthrough().optional(),
});

const createCatalogServer = async () => {
  const controls = {
    includeOpen: true,
    repeatedCursor: false,
    infinitePages: false,
    pageCount: 0,
  };
  const cursors: (string | undefined)[] = [];
  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ) => {
    if (request.method !== "POST") {
      request.resume();
      response.writeHead(request.method === "DELETE" ? 200 : 405).end();
      return;
    }
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const message = requestSchema.parse(JSON.parse(body));
    if (message.id === undefined) {
      if (
        message.method !== "notifications/initialized" &&
        message.method !== "notifications/cancelled"
      )
        throw new Error(`Unexpected JEB notification: ${message.method}`);
      response.writeHead(202).end();
      return;
    }
    let result: unknown;
    if (message.method === "initialize") {
      result = {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "jeb-catalog-fixture", version: "1" },
      };
    } else if (message.method === "tools/list") {
      const cursor = message.params?.cursor;
      controls.pageCount += 1;
      if (!controls.infinitePages) cursors.push(cursor);
      const names =
        cursor === undefined
          ? ["get_client_information"]
          : controls.includeOpen
            ? ["open_project"]
            : ["list_units"];
      result = {
        tools: [...names, "unused_extension"].map((name) => ({
          name,
          inputSchema: { type: "object" },
        })),
        ...(controls.infinitePages
          ? { nextCursor: `fresh-page-${controls.pageCount}` }
          : cursor === undefined || controls.repeatedCursor
            ? { nextCursor: "second-page" }
            : {}),
      };
    } else {
      throw new Error(`Unexpected JEB request: ${message.method}`);
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  };
  const { server, close } = createVerifierHttpServer(handleRequest);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected an ephemeral TCP listener");

  return {
    controls,
    cursors,
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    close,
  };
};

it("reads every JEB catalog page and refreshes the connected engine catalog", async () => {
  const { controls, cursors, endpoint, close } = await createCatalogServer();
  const connection = createStreamableHttpJebMcpConnection(new URL(endpoint), {
    discoveryTimeoutMs: 1_000,
  });
  try {
    expect(await connection.listTools()).toEqual([
      "get_client_information",
      "open_project",
    ]);
    controls.includeOpen = false;
    expect(await connection.listTools()).toEqual([
      "get_client_information",
      "list_units",
    ]);
    expect(cursors).toEqual([
      undefined,
      "second-page",
      undefined,
      "second-page",
    ]);
    controls.infinitePages = true;
    const before = controls.pageCount;
    await expect(connection.listTools()).rejects.toBeInstanceOf(
      AnalysisTimeoutError,
    );
    expect(controls.pageCount - before).toBeGreaterThan(2);
    controls.infinitePages = false;
    expect(await connection.listTools()).toEqual([
      "get_client_information",
      "list_units",
    ]);

    // Shared initial acquisition also owns a finite deadline and can recover.
    const acquiring = createStreamableHttpJebMcpConnection(new URL(endpoint), {
      discoveryTimeoutMs: 1_000,
    });
    try {
      controls.infinitePages = true;
      await expect(acquiring.listTools()).rejects.toBeInstanceOf(
        AnalysisTimeoutError,
      );
      controls.infinitePages = false;
      expect(await acquiring.listTools()).toEqual([
        "get_client_information",
        "list_units",
      ]);
    } finally {
      await acquiring.close();
    }
    controls.repeatedCursor = true;
    await expect(connection.listTools()).rejects.toThrow(
      "repeated a tool catalog cursor",
    );
    controls.repeatedCursor = false;
    expect(await connection.listTools()).toEqual([
      "get_client_information",
      "list_units",
    ]);
  } finally {
    await withVerifierCleanup(() => connection.close(), [close]);
  }
});
