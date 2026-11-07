import { randomUUID } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { expect, it, onTestFinished } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { GdbSessionManager } from "../../../src/gdb/GdbSessionManager.js";
import { silentLogger } from "../../../src/logger.js";
import { registerGdbTools } from "../../../src/server/registerGdbTools.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";

it.skipIf(process.platform === "win32").each(["kill", "detach"])(
  "retains a valid GDB session through disposition refusal and explicit %s recovery",
  async (disposition) => {
    const directory = await createTestTempDirectory("rea-gdb-disposition-");
    const provider = join(directory, "fake-gdb.mjs");
    await writeFile(
      provider,
      `#!${process.execPath}
import { createInterface } from 'node:readline';
let live = false;
process.stdout.write('(gdb)\\n');
createInterface({ input: process.stdin }).on('line', line => {
  const token = /^(\\d+)/.exec(line)?.[1];
  if (!token) return;
  const command = line.slice(token.length);
  if (command === '-interpreter-exec console "run"') {
    live = true;
    process.stdout.write(token + '^running\\n*stopped,reason="breakpoint-hit",thread-id="1"\\n(gdb)\\n');
    return;
  }
  if (command === '-gdb-show mi-async') {
    process.stdout.write(token + '^done,value="off"\\n(gdb)\\n');
    return;
  }
  const disposition = command === '-interpreter-exec console "kill"' || command === '-interpreter-exec console "detach"';
  if (disposition) live = false;
  const result = command === '-list-thread-groups --recurse 1'
    ? (live ? 'done,groups=[{id="i1",type="process",pid="4242"}]' : 'done,groups=[]')
    : disposition || command === '-gdb-set auto-load off' || command === '-gdb-exit'
      ? 'done' : 'error,msg="Unmodeled fixture command"';
  process.stdout.write(token + '^' + result + '\\n(gdb)\\n', () => {
    if (line.includes('-gdb-exit')) process.exit(0);
  });
});
`,
    );
    await chmod(provider, 0o700);
    const manager = new GdbSessionManager({
      platform: "linux",
      environment: { REA_GDB_COMMAND: provider },
    });
    onTestFinished(() => manager.closeAll());
    const server = new McpServer({
      name: "gdb-disposition-test",
      version: "1",
    });
    onTestFinished(() => server.close());
    registerGdbTools(
      server,
      manager,
      silentLogger,
      createToolResultDelivery(undefined),
    );
    const client = new Client({ name: "gdb-disposition-test", version: "1" });
    onTestFinished(() => client.close());
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const started = await client.callTool({
      name: "start_gdb_session",
      arguments: {},
    });
    const sessionId = toolContract("start_gdb_session").outputSchema.parse(
      started.structuredContent,
    ).session_id;
    const running = await client.callTool({
      name: "gdb_console",
      arguments: { session_id: sessionId, command: "run" },
    });
    expect(running.isError).not.toBe(true);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const refusal = await client.callTool({
        name: "close_gdb_session",
        arguments: { session_id: sessionId },
      });
      expect(refusal.isError).toBe(true);
      expect(refusal.structuredContent).toMatchObject({
        error: {
          code: "capability_unavailable",
          category: "unavailable",
          retryable: true,
          remediation: { action: expect.stringContaining("gdb_console") },
          details: {
            provider_id: "gnu.gdb",
            operation: "close_gdb_session",
            reason: expect.stringContaining("inferior"),
          },
        },
      });
      expect(JSON.stringify(refusal.structuredContent)).not.toContain(
        "invalid_value",
      );
      expect(manager.status(sessionId)?.state).toBe("ready");
    }
    const disposed = await client.callTool({
      name: "gdb_console",
      arguments: { session_id: sessionId, command: disposition },
    });
    expect(disposed.isError).not.toBe(true);
    const closed = await client.callTool({
      name: "close_gdb_session",
      arguments: { session_id: sessionId },
    });
    expect(closed.isError).not.toBe(true);
    expect(closed.structuredContent).toMatchObject({
      target_state: "none_observed",
    });
    expect(manager.status(sessionId)).toBeUndefined();
    const unknown = await client.callTool({
      name: "close_gdb_session",
      arguments: { session_id: randomUUID() },
    });
    expect(unknown.structuredContent).toMatchObject({
      error: { code: "invalid_request", category: "invalid_input" },
    });
  },
);
