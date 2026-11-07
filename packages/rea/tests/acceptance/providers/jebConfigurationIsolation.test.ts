import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { expect } from "vitest";

import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { workspaceCliTest as test } from "../../support/cli/workspaceCliFixture.js";
import type { TestWorkspace } from "../../support/workspace/workspaceFixture.js";

const isolatedEnvironment = (workspace: TestWorkspace) => ({
  // Discovery still needs the host's process-ownership prerequisites, such as ps.
  PATH: process.env.PATH ?? "",
  HOME: workspace.home,
  USERPROFILE: workspace.home,
  APPDATA: workspace.path("appdata"),
  LOCALAPPDATA: workspace.path("localappdata"),
  XDG_CONFIG_HOME: workspace.path("config"),
  XDG_CACHE_HOME: workspace.path("cache"),
  TEMP: workspace.root,
  TMP: workspace.root,
  ...(process.platform === "win32"
    ? { SystemRoot: process.env.SystemRoot ?? "" }
    : {}),
  HOPPER_LAUNCHER_PATH: workspace.path("missing-hopper"),
  REA_LOG_LEVEL: "silent",
  REA_JEB_MCP_TIMEOUT_MS: "1.5",
});

test("retains the selected endpoint when a direct JEB connection fails", async ({
  cli,
  workspace,
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing loopback listener address");
    const endpoint = `HTTP://127.0.0.1:0${address.port}/mcp`;
    const result = await cli.run({
      arguments: ["inspect-jeb-client", "--json"],
      environment: {
        ...isolatedEnvironment(workspace),
        REA_JEB_MCP_TIMEOUT_MS: "3000",
        REA_JEB_MCP_URL: endpoint,
      },
    });
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.json).toMatchObject({
      code: "capability_unavailable",
      details: {
        diagnostics: { endpoint },
        reason: expect.stringContaining("not found"),
      },
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("scripts/rea.mjs"), "mcp"],
      cwd: workspace.root,
      env: {
        ...isolatedEnvironment(workspace),
        REA_JEB_MCP_TIMEOUT_MS: "3000",
        REA_JEB_MCP_URL: endpoint,
      },
      stderr: "pipe",
    });
    const client = new Client({
      name: "jeb-endpoint-acceptance",
      version: "1",
    });
    try {
      await client.connect(transport);
      const definition = (await client.listTools()).tools.find(
        ({ name }) => name === "inspect_jeb_client",
      );
      if (definition === undefined) throw new Error("Missing JEB tool");
      const refusal = parseMcpToolError(
        await client.callTool(
          { name: "inspect_jeb_client", arguments: {} },
          { toolDefinition: definition },
        ),
      );
      expect(refusal.error).toMatchObject({
        code: "capability_unavailable",
        details: { diagnostics: { endpoint } },
      });
    } finally {
      await client.close();
      await transport.close();
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose, rejectClose) =>
      server.close((error) => (error ? rejectClose(error) : resolveClose())),
    );
  }
});

test("keeps compiled CLI discovery usable while JEB rejects its malformed timeout", async ({
  cli,
  workspace,
}) => {
  const environment = isolatedEnvironment(workspace);
  for (const command of ["capabilities", "providers"]) {
    const result = await cli.run({
      arguments: [command, "--json"],
      environment,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.json).toMatchObject({
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          provider: expect.objectContaining({ id: "rea-artifact-graph" }),
        }),
      ]),
    });
  }
  const refusal = await cli.run({
    arguments: ["inspect-jeb-client", "--json"],
    environment,
  });
  expect(refusal.exitCode, refusal.stderr).toBe(1);
  expect(refusal.json).toMatchObject({
    code: "configuration_invalid",
    details: { settings: [{ setting: "REA_JEB_MCP_TIMEOUT_MS" }] },
  });
});

test("starts production stdio MCP and retains peer requests around a JEB configuration refusal", async ({
  workspace,
}) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("scripts/rea.mjs"), "mcp"],
    cwd: workspace.root,
    env: isolatedEnvironment(workspace),
    stderr: "pipe",
  });
  const client = new Client({ name: "jeb-isolation-acceptance", version: "1" });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  try {
    await client.connect(transport);
    await client.ping();
    const definition = (await client.listTools()).tools.find(
      ({ name }) => name === "inspect_jeb_client",
    );
    if (definition === undefined)
      throw new Error(`Production MCP omitted inspect_jeb_client: ${stderr}`);
    const refusal = parseMcpToolError(
      await client.callTool(
        { name: "inspect_jeb_client", arguments: {} },
        { toolDefinition: definition },
      ),
    );
    expect(refusal.error).toMatchObject({
      code: "configuration_invalid",
      details: { settings: [{ setting: "REA_JEB_MCP_TIMEOUT_MS" }] },
    });
    await client.ping();
  } finally {
    await client.close();
    await transport.close();
  }
});
