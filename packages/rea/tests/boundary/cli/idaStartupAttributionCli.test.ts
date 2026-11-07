import { createVerifierHttpServer } from "../../../scripts/lib/verifier-http-server.mjs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { expect } from "vitest";
import { z } from "zod";
import { workspaceCliTest } from "../../support/cli/workspaceCliFixture.js";
import { elf } from "../../../src/domain/binaryTarget.fixture.js";

const tools = [
  "idb_open",
  "idb_list",
  "idb_close",
  "server_health",
  "list_funcs",
  "lookup_funcs",
  "find_regex",
  "decompile",
  "disasm",
  "callees",
  "xrefs_to",
];
const requestSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z
    .object({
      protocolVersion: z.string().optional(),
      name: z.string().optional(),
      arguments: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

type StartupMode =
  | "missing-profile"
  | "connect-timeout"
  | "catalog-timeout"
  | "catalog-refused"
  | "headless-input-mismatch"
  | "unexpected-worker"
  | "success";

type StartupSupervisorState = {
  readonly mode: StartupMode;
  readonly calls: string[];
  database: string | undefined;
  input: string | undefined;
};
const handleStartupRequest = async (
  state: StartupSupervisorState,
  request: IncomingMessage,
  response: ServerResponse,
) => {
  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }
  let body = "";
  for await (const chunk of request) body += String(chunk);
  const rpc = requestSchema.parse(JSON.parse(body));
  if (rpc.id === undefined) {
    response.writeHead(202).end();
    return;
  }
  const send = (result: unknown) =>
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
  if (rpc.method === "initialize") {
    if (state.mode === "connect-timeout") return;
    send({
      protocolVersion: rpc.params?.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "ida-startup-fixture", version: "1" },
    });
    return;
  }
  if (rpc.method === "tools/list") {
    if (state.mode === "catalog-timeout") return;
    if (state.mode === "catalog-refused") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          error: { code: -32603, message: "fixture catalog refused" },
        }),
      );
      return;
    }
    send({
      tools: tools
        .filter(
          (name) => state.mode !== "missing-profile" || name !== "list_funcs",
        )
        .map((name) => ({
          name,
          inputSchema: { type: "object", properties: {} },
        })),
    });
    return;
  }
  const name = rpc.params?.name;
  const args = rpc.params?.arguments;
  if (name === undefined || args === undefined)
    throw new Error("Unexpected RPC");
  state.calls.push(name);
  let result: unknown;
  if (name === "idb_open") {
    state.database = z.string().parse(args.preferred_session_id);
    state.input = z.string().parse(args.input_path);
    result = {
      success: true,
      session: {
        session_id:
          state.mode === "unexpected-worker"
            ? "unexpected-worker"
            : state.database,
        input_path: state.input,
      },
    };
  } else if (name === "idb_list")
    result = {
      sessions:
        state.database === undefined
          ? []
          : [
              {
                session_id: state.database,
                input_path: state.input,
                owned: true,
                backend: "worker",
                is_active: true,
              },
            ],
    };
  else if (name === "idb_close") {
    result = {
      success: true,
      session_id: state.database,
      saved: null,
      owned: true,
      backend: "worker",
    };
    state.database = undefined;
  } else if (name === "server_health")
    result = {
      status: "ok",
      input_path:
        state.mode === "headless-input-mismatch"
          ? state.input + ".other"
          : state.input,
      idb_path: state.input + ".i64",
      module: "target.elf",
      imagebase: "0x1000",
      auto_analysis_ready: true,
    };
  else if (name === "lookup_funcs")
    result = z
      .array(z.string())
      .parse(args.queries)
      .map((query) => ({
        query,
        fn: { addr: "0x1000", name: "main", size: "0x20" },
        error: null,
      }));
  else if (name === "decompile")
    result = {
      code: "int main(void) { return 42; }",
      cursor: { done: true },
    };
  else throw new Error("Unexpected tool: " + name);
  send({ content: [{ type: "text", text: JSON.stringify(result) }] });
};

const createStartupSupervisor = async (mode: StartupMode) => {
  const state: StartupSupervisorState = {
    mode,
    calls: [],
    database: undefined,
    input: undefined,
  };
  const { server, close } = createVerifierHttpServer((request, response) =>
    handleStartupRequest(state, request, response),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    calls: state.calls,
    get database() {
      return state.database;
    },
    close,
  };
};

workspaceCliTest.for([
  "missing-profile",
  "connect-timeout",
  "catalog-timeout",
  "catalog-refused",
  "headless-input-mismatch",
  "unexpected-worker",
  "success",
] as const)(
  "attributes selected IDA startup to the public analysis: %s",
  async (mode, { cli, workspace }) => {
    const supervisor = await createStartupSupervisor(mode);
    const { server, calls } = supervisor;
    try {
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("Missing server address");
      const workspaceRoot = await workspace.mkdir("ida-workspaces");
      const registration = await workspace.write(
        "ida.json",
        JSON.stringify({
          url: `http://127.0.0.1:${address.port}/mcp`,
          mode: "headless",
          timeoutMs: 500,
          workspaceRoot,
        }),
      );
      const target = await workspace.write("target.elf", elf(2, 1, 62));
      const result = await cli.run({
        arguments: ["decompile", target, "main", "--provider", "ida", "--json"],
        environment: {
          ...workspace.environment,
          REA_IDA_MCP_CONFIG: registration,
          REA_LOG_LEVEL: "silent",
        },
        timeoutMs: 15000,
      });
      expect(result.stderr).toBe("");
      expect(supervisor.database).toBeUndefined();
      if (mode === "success") {
        expect(result.exitCode).toBe(0);
        expect(result.json).toMatchObject({
          operation: "procedure_pseudo_code",
          normalized_result: "int main(void) { return 42; }",
        });
        expect(calls).toContain("decompile");
        expect(calls).toContain("idb_close");
        return;
      }
      expect(result.exitCode).toBe(1);
      if (mode === "headless-input-mismatch" || mode === "unexpected-worker") {
        expect(calls).not.toContain("decompile");
        expect(calls).toContain("idb_close");
        expect(result.json).toMatchObject({
          code: "unreadable_output",
          retryable: false,
          message: expect.stringContaining(
            mode === "headless-input-mismatch"
              ? "input identity changed"
              : "unexpected session",
          ),
          remediation: {
            action: expect.stringContaining(
              mode === "headless-input-mismatch" ? "reopen" : "session ID",
            ),
          },
          details: {
            operation: "procedure_pseudo_code",
            diagnostics: {
              identity_check:
                mode === "headless-input-mismatch"
                  ? "headless_input"
                  : "worker_session",
              reason: expect.any(String),
              recovery: expect.any(String),
            },
          },
        });
        return;
      }
      expect(calls).toEqual([]);
      expect(result.json).toMatchObject({
        code: mode.endsWith("timeout")
          ? "provider_timeout"
          : "execution_failure",
        details: { operation: "procedure_pseudo_code" },
      });
      if (mode === "catalog-refused")
        expect(result.json).toMatchObject({
          details: { diagnostics: { reason: "fixture catalog refused" } },
        });
      if (mode === "missing-profile")
        expect(result.json).toMatchObject({
          details: {
            diagnostics: {
              missing_tools: ["list_funcs"],
              startup_operation: "initialize",
            },
          },
        });
      if (mode.endsWith("timeout"))
        expect(result.json).toMatchObject({
          retryable: true,
          details: {
            timeout_ms: 500,
            captured_output: { stdout: "", stderr: "", truncated: false },
            diagnostics: {
              startup_operation:
                mode === "connect-timeout"
                  ? "ida_mcp_connect"
                  : "ida_mcp_catalog",
            },
          },
        });
    } finally {
      await supervisor.close();
    }
  },
);
