import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect } from "vitest";
import { z } from "zod";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { byteEntropySchema } from "../../../src/domain/native/byteEntropy.js";
import { workspaceCliTest } from "../../support/cli/workspaceCliFixture.js";

workspaceCliTest.for([
  { mode: "deferred", profile: "full" },
  { mode: "eager", profile: "off" },
])(
  "reports frame validation while the $mode stdio connection remains usable",
  async ({ profile }, { workspace }) => {
    const path = workspace.path("fixture.bin");
    const bytes = Buffer.from("fixture");
    await writeFile(path, bytes);
    const home = workspace.path("home");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("scripts/rea.mjs"), "mcp"],
      env: {
        PATH: process.env.PATH ?? "",
        HOME: home,
        REA_LOG_LEVEL: "error",
        REA_MCP_OUTPUT_SCHEMA_PROFILE: profile,
      },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const client = new Client(
      { name: "frame-diagnostic-regression", version: "1" },
      { versionNegotiation: { mode: "legacy" } },
    );
    try {
      await client.connect(transport);
      // Bypass the client's request-ID allocator, but keep the real SDK wire.
      // A valid ping is the processing barrier; rejected IDs need no timeout.
      for (const id of [Number.MAX_SAFE_INTEGER + 1, 1.5])
        await transport.send({ jsonrpc: "2.0", id, method: "ping" });
      await client.ping();

      const definition = (await client.listTools()).tools.find(
        ({ name }) => name === "inspect_byte_entropy",
      );
      if (definition === undefined) throw new Error("Missing entropy tool");
      const reply = await client.callTool(
        { name: definition.name, arguments: { path } },
        { toolDefinition: definition },
      );
      expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true);
      const evidence = parseEvidence(reply.structuredContent);
      expect(byteEntropySchema.parse(evidence.normalized_result)).toMatchObject(
        {
          artifact: {
            path,
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        },
      );
      // Deferred materialization must not replace the outer diagnostic owner.
      await transport.send({ jsonrpc: "2.0", id: 2.5, method: "ping" });
      await client.ping();
    } finally {
      await client.close();
      await transport.close();
    }
    const lines = stderr.trim().split("\n").filter(Boolean);
    const records = lines
      .filter((line) => line.startsWith("{"))
      .map((line) =>
        z
          .object({ kind: z.literal("validation_error"), msg: z.string() })
          .parse(JSON.parse(line)),
      );
    expect(records).toHaveLength(3);
    expect(lines.filter((line) => !line.startsWith("{"))).toEqual(
      records.map(({ msg }) => msg),
    );
  },
);
