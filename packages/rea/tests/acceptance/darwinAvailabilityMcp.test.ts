import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect } from "vitest";
import { z } from "incur";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest.skipIf(process.platform !== "darwin")(
  "target-free MCP discovery survives an unavailable macOS compiler",
  async () => {
    const root = await createTestTempDirectory("rea-darwin-unavailable-");
    const tmp = join(root, "tmp");
    await mkdir(tmp);
    const apktool = join(root, "apktool");
    await writeFile(apktool, "#!/bin/sh\necho 2.9.3\n", { mode: 0o755 });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("scripts/rea.mjs"), "mcp"],
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: root,
        TMPDIR: tmp,
        DEVELOPER_DIR: join(root, "missing-developer"),
        REA_LOG_LEVEL: "silent",
        REA_APKTOOL_COMMAND: apktool,
      },
      stderr: "pipe",
    });
    transport.stderr?.on("data", () => undefined);
    const client = new Client({ name: "darwin-availability", version: "1" });
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "binary_session",
        arguments: {},
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(result.structuredContent).toBeDefined();
      const discovery = z
        .object({
          result: z.object({
            tool_availability: z.object({
              groups: z.array(
                z.object({
                  names: z.array(z.string()),
                  available: z.boolean(),
                  reason: z.string(),
                  remediation: z.string().nullable(),
                }),
              ),
            }),
          }),
        })
        .parse(result.structuredContent);
      const apktoolGroup = discovery.result.tool_availability.groups.find(
        ({ names }) => names.includes("inspect_apktool_client"),
      );
      expect(apktoolGroup).toMatchObject({
        available: false,
        reason: "provider_unavailable",
        remediation: expect.stringContaining(
          "macOS process ownership helper compilation failed",
        ),
      });
      expect(apktoolGroup?.remediation).toContain("missing-developer");
    } finally {
      await client.close();
      await transport.close();
    }
  },
);
