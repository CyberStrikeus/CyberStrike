import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

import { elf } from "../../../../src/domain/binaryTarget.fixture.js";
import type { BinaryTarget } from "../../../../src/domain/binaryTargetTypes.js";
import { createIdaMcpConnection } from "../../../../src/ida/IdaMcpConnection.js";
import { IdaSessionClient } from "../../../../src/ida/IdaSessionClient.js";

/**
 * A headless IDA supervisor over real stdio that answers the session
 * lifecycle, but rejects the first inventory after a close so cleanup fails
 * once and must be retried through the retained connection.
 */
const FLAKY_INVENTORY_SUPERVISOR = `import { createInterface } from "node:readline";
const tools = ["idb_open", "idb_list", "idb_close", "server_health", "list_funcs",
  "lookup_funcs", "find_regex", "decompile", "disasm", "callees", "xrefs_to"];
let session;
let inputPath;
let closed = false;
let inventoryFailed = false;
const send = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
const result = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value,
});
const call = ({ name, arguments: args }) => {
  if (name === "idb_open") {
    session = args.preferred_session_id;
    inputPath = args.input_path;
    return result({ success: true, session: { session_id: session, input_path: inputPath } });
  }
  if (name === "server_health")
    return result({ status: "ok", input_path: inputPath, idb_path: inputPath + ".i64",
      module: "target.elf", imagebase: "0x1000", auto_analysis_ready: true });
  if (name === "idb_close") {
    closed = true;
    return result({ success: true, session_id: session, saved: null, owned: true, backend: "worker" });
  }
  if (name === "idb_list") {
    if (closed && !inventoryFailed) {
      inventoryFailed = true;
      return { isError: true, content: [{ type: "text", text: "inventory unavailable" }] };
    }
    return result({ sessions: closed ? [] : [{ session_id: session, input_path: inputPath,
      owned: true, backend: "worker", is_active: true }] });
  }
  return { isError: true, content: [{ type: "text", text: "unsupported " + name }] };
};
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.method === "initialize")
    send({ id: request.id, result: {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "flaky-inventory-ida-fixture", version: "1" },
    } });
  else if (request.method === "tools/list")
    send({ id: request.id, result: {
      tools: tools.map((name) => ({ name, inputSchema: { type: "object" } })),
    } });
  else if (request.method === "tools/call")
    send({ id: request.id, result: call(request.params) });
}
`;

describe("retained headless IDA connection in a long-lived host", () => {
  it("retries cleanup through the detached stdio connection", async () => {
    const root = await createTestTempDirectory("rea-ida-retry-");
    const supervisor = join(root, "supervisor.mjs");
    await writeFile(supervisor, FLAKY_INVENTORY_SUPERVISOR);
    const workspaceRoot = join(root, "workspaces");
    await mkdir(workspaceRoot);
    const bytes = elf(2, 1, 62);
    const targetPath = join(root, "target.elf");
    await writeFile(targetPath, bytes);
    const target: BinaryTarget = {
      path: targetPath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      kind: "executable",
      format: "elf",
      architecture: "x86_64",
      availableArchitectures: ["x86_64"],
    };
    const config = {
      command: process.execPath,
      args: [supervisor],
      env: {},
      mode: "headless" as const,
      timeoutMs: 5000,
      workspaceRoot,
    };
    const connection = createIdaMcpConnection(config, process.env);
    // Close the supervisor even when an assertion fails before cleanup does.
    onTestFinished(() => connection.close().catch(() => undefined));
    const client = new IdaSessionClient(config, target, connection);

    expect((await client.execute("health", {})).ok).toBe(true);
    const failed = await client.close();
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.cleanupIncomplete).toBe(true);
    expect(await readdir(workspaceRoot)).toHaveLength(1);

    // The connection was detached when cleanup failed; it must still serve
    // the retry that confirms release and removes the private workspace.
    expect((await client.close()).ok).toBe(true);
    expect(await readdir(workspaceRoot)).toEqual([]);
  });
});
