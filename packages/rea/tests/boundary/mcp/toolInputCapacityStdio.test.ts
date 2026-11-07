import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { join, resolve } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("applies the selected input allowance through the public deferred stdio entry point", async () => {
  const root = await createTestTempDirectory("rea-input-capacity-stdio-");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("scripts/rea.mjs"), "mcp"],
    env: {
      PATH: process.env.PATH ?? "",
      HOME: root,
      USERPROFILE: root,
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_DATA_HOME: join(root, "data"),
      HOPPER_LAUNCHER_PATH: "/rea-unconfigured-deep-provider/hopper",
      NODE_OPTIONS: "--max-old-space-size=3072",
      REA_LOG_LEVEL: "silent",
      REA_MCP_MAX_INPUT_ELEMENTS: "8192",
    },
    stderr: "pipe",
  });
  transport.stderr?.on("data", () => undefined);
  const client = new Client({ name: "input-capacity-stdio", version: "1" });
  onTestFinished(async () => {
    try {
      await client.close();
    } finally {
      await transport.close();
    }
  });
  await client.connect(transport);
  const result = await client.callTool({
    name: "compare_bundles",
    arguments: {
      left_bundle_path: join(root, "absent-left"),
      right_bundle_path: join(root, "absent-right"),
      record_pairs: Array.from({ length: 8192 }, () => 0),
    },
  });
  const { error } = parseMcpToolError(result);
  expect(error.code).toBe("resource_constraint");
  expect(error.details).toMatchObject({
    resource: "transport",
    reported_limits: { max_input_elements: 8192 },
  });
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(4096);
  await client.ping();
  const healthy = await client.callTool({
    name: "inspect_analysis_settings",
    arguments: {},
  });
  expect(healthy.isError).not.toBe(true);
}, 90_000);
