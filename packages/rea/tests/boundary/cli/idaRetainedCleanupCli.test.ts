import { describe, expect } from "vitest";

import { workspaceCliTest } from "../../support/cli/workspaceCliFixture.js";

import { elf } from "../../../src/domain/binaryTarget.fixture.js";

/**
 * A headless IDA supervisor that completes the MCP handshake and then leaves
 * every tool call unanswered, as an `idb_open` still running auto-analysis
 * would. It exits when REA closes its input.
 */
const UNRESPONSIVE_SUPERVISOR = `import { createInterface } from "node:readline";
const tools = ["idb_open", "idb_list", "idb_close", "server_health", "list_funcs",
  "lookup_funcs", "find_regex", "decompile", "disasm", "callees", "xrefs_to"];
const send = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.method === "initialize")
    send({ id: request.id, result: {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "unresponsive-ida-fixture", version: "1" },
    } });
  else if (request.method === "tools/list")
    send({ id: request.id, result: {
      tools: tools.map((name) => ({ name, inputSchema: { type: "object" } })),
    } });
}
`;

describe("headless IDA timeout through the one-shot CLI", () => {
  workspaceCliTest(
    "exits after a retained-cleanup failure instead of waiting on the supervisor",
    async ({ cli, workspace }) => {
      const supervisor = await workspace.write(
        "supervisor.mjs",
        UNRESPONSIVE_SUPERVISOR,
      );
      const workspaceRoot = await workspace.mkdir("ida-workspaces");
      const registration = await workspace.write(
        "ida-mcp.json",
        JSON.stringify({
          command: process.execPath,
          args: [supervisor],
          mode: "headless",
          timeoutMs: 500,
          workspaceRoot,
        }),
      );
      const target = await workspace.write("target.elf", elf(2, 1, 62));

      const result = await cli.run({
        arguments: ["decompile", target, "main", "--json"],
        environment: {
          ...workspace.environment,
          REA_ANALYSIS_PROVIDER: "ida",
          REA_IDA_MCP_CONFIG: registration,
          REA_LOG_LEVEL: "silent",
        },
        timeoutMs: 30_000,
      });

      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "cleanup_incomplete",
        details: {
          cleanup: "incomplete",
          execution_failure: "provider_timeout",
          operation: "procedure_pseudo_code",
          diagnostics: {
            startup_operation: "idb_open",
          },
          timeout_ms: 500,
          resources: [expect.stringContaining(workspaceRoot)],
          cleanup_error: {
            code: "cleanup_incomplete",
            details: {
              provider_id: "ida",
              operation: "close",
              diagnostics: {
                upstream_sessions: {
                  state: "unverified",
                  sessions: [
                    {
                      session_id: expect.stringMatching(/^rea-/),
                      backend: "worker",
                      owned: null,
                      input_path: null,
                      is_active: null,
                    },
                  ],
                },
              },
            },
          },
        },
      });
    },
  );
});
