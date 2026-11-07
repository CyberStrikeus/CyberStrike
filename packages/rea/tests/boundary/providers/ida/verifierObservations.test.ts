import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import {
  jsonValueSchema,
  type JsonValue,
} from "../../../../src/domain/jsonValue.js";
import { nativeTools } from "../../../../src/ida/IdaNativeProtocol.js";
import {
  OwnedCommandFailure,
  runOwnedCommand,
} from "../../../../src/process/OwnedCommand.js";
import { createIdaTarget } from "../../../fixtures/idaMcp.js";

const requestSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z
    .object({
      protocolVersion: z.string().optional(),
      name: z.string().optional(),
      arguments: z.record(z.string(), jsonValueSchema).optional(),
    })
    .passthrough()
    .optional(),
});

const fn = (address: string) => ({
  addr: address,
  name: address === "0x1000" ? "main" : "helper",
  size: "0x20",
});
const observation = (
  name: string,
  args: Readonly<Record<string, JsonValue>>,
  scenario: { readonly empty: readonly string[]; readonly omitMore: boolean },
): JsonValue => {
  switch (name) {
    case "lookup_funcs":
      return z
        .array(z.string())
        .parse(args.queries)
        .map((query) => ({
          query,
          fn: fn(
            query === "helper" || query === "0x2000" ? "0x2000" : "0x1000",
          ),
          error: null,
        }));
    case "list_funcs":
      return [
        {
          data: scenario.empty.includes(name) ? [] : [fn("0x1000")],
          next_offset: null,
        },
      ];
    case "find_regex":
      return {
        matches: scenario.empty.includes(name)
          ? []
          : [{ addr: "0x3000", string: "a.b" }],
        cursor: { done: true },
      };
    case "decompile": {
      const addr = z.string().parse(args.addr);
      return {
        addr,
        ok: true,
        pseudocode:
          addr === "0x1000"
            ? "int main(void) { return 42; }"
            : "int helper(void) { return 55; }",
        lines: 1,
      };
    }
    case "disasm":
      return {
        asm: {
          name: "main",
          start_ea: "0x1000",
          lines: "main (.text @ 0x1000):\n1000  ret",
        },
        cursor: { done: true },
      };
    case "callees":
      return [
        {
          callees: [],
          error: null,
          ...(scenario.omitMore ? {} : { more: false }),
        },
      ];
    case "xrefs_to":
      return [
        {
          xrefs: scenario.empty.includes(name)
            ? []
            : [{ addr: "0x1004", type: "code", fn: null }],
          more: false,
          error: null,
        },
      ];
    default:
      throw new Error(`Unexpected fixture operation ${name}`);
  }
};

const fixture = async (empty: readonly string[], omitMore: boolean) => {
  const { root, target } = await createIdaTarget();
  const server = createServer(async (request, response) => {
    try {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const input = requestSchema.parse(JSON.parse(body));
      if (input.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const result =
        input.method === "initialize"
          ? {
              protocolVersion: input.params?.protocolVersion,
              capabilities: { tools: {}, resources: {} },
              serverInfo: { name: "native-verifier-fixture", version: "1" },
            }
          : input.method === "tools/list"
            ? {
                tools: nativeTools.map((name) => ({
                  name,
                  inputSchema: { type: "object" },
                })),
              }
            : input.method === "resources/read"
              ? {
                  contents: [
                    {
                      uri: "ida://idb/metadata",
                      mimeType: "application/json",
                      text: JSON.stringify({
                        path: `${target.path}.i64`,
                        sha256: target.sha256,
                        base: "0x1000",
                        module: "target.elf",
                      }),
                    },
                  ],
                }
              : {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify(
                        observation(
                          z.string().parse(input.params?.name),
                          input.params?.arguments ?? {},
                          { empty, omitMore },
                        ),
                      ),
                    },
                  ],
                };
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }));
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("No fixture address");
  const config = join(root, "native.json");
  await writeFile(
    config,
    JSON.stringify({
      url: `http://127.0.0.1:${address.port}/mcp`,
      protocol: "native",
      timeoutMs: 30000,
    }),
  );
  return {
    root,
    target,
    config,
    close: async (removeWorkspace: boolean) => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
      if (removeWorkspace) await rm(root, { recursive: true, force: true });
    },
  };
};

it.each([
  { empty: [], omitMore: false, oracles: true, passed: true },
  { empty: ["list_funcs"], omitMore: false, oracles: true, passed: false },
  { empty: ["find_regex"], omitMore: false, oracles: true, passed: false },
  { empty: ["xrefs_to"], omitMore: false, oracles: true, passed: false },
  { empty: [], omitMore: true, oracles: true, passed: false },
  {
    empty: ["find_regex", "xrefs_to"],
    omitMore: false,
    oracles: false,
    passed: true,
  },
])(
  "checks real-verifier values for $empty / omitted more=$omitMore / oracles=$oracles",
  async ({ empty, omitMore, oracles, passed }) => {
    const upstream = await fixture(empty, omitMore);
    let cleanupConfirmed = false;
    try {
      const reportPath = join(upstream.root, "report.json");
      const result = await runOwnedCommand(
        {
          command: process.execPath,
          arguments: [
            "scripts/verify-real-ida.mjs",
            "--target",
            upstream.target.path,
            "--procedure",
            "main",
            "--second-procedure",
            "helper",
            "--second-marker",
            "55",
            "--report",
            reportPath,
            ...(oracles
              ? ["--expected-string", "a.b", "--expected-xref", "0x1004"]
              : []),
          ],
          runId: `rea-ida-verifier-${randomUUID()}`,
          cwd: process.cwd(),
          env: {
            REA_IDA_MCP_CONFIG: upstream.config,
            NODE_OPTIONS: "--max-old-space-size=1024",
          },
        },
        { timeoutMs: 90000, diagnosticBytes: 16384, acceptNonZeroExit: true },
      );
      cleanupConfirmed = true;
      const report = z
        .object({
          passed: z.boolean(),
          unverified: z.array(z.string()),
          failure: z
            .object({ phase: z.string(), message: z.string() })
            .optional(),
          failed_cli: z.object({ stdout: z.string() }).optional(),
        })
        .parse(JSON.parse(await readFile(reportPath, "utf8")));
      expect(report.passed, result.stdout.text + result.stderr.text).toBe(
        passed,
      );
      expect(result.exitCode).toBe(passed ? 0 : 1);
      if (empty.includes("list_funcs"))
        expect(report.failure).toEqual({
          phase: "production MCP list_procedures",
          message: "list_procedures omitted the resolved procedure.",
        });
      else if (oracles && empty.includes("find_regex"))
        expect(report.failure).toEqual({
          phase: "production MCP list_strings",
          message: "list_strings omitted the expected literal.",
        });
      else if (oracles && empty.includes("xrefs_to"))
        expect(report.failure).toEqual({
          phase: "production MCP xrefs",
          message: "xrefs omitted the expected source address.",
        });
      else if (omitMore) {
        expect(report.failure?.phase).toBe("production CLI function analysis");
        expect(JSON.parse(report.failed_cli!.stdout)).toMatchObject({
          code: "unreadable_output",
          details: {
            partial_observation: {
              normalized_result: {
                target_binding: {
                  reason:
                    "Native IDA callees omitted an explicit truncation marker.",
                },
              },
            },
          },
        });
      } else expect(report.failure).toBeUndefined();
      if (!oracles)
        expect(report.unverified).toEqual([
          "String inventory/search correctness: no independent expected literal supplied.",
          "Xref correctness: no independent expected source address supplied.",
        ]);
      else expect(report.unverified).toEqual([]);
    } catch (cause) {
      if (cause instanceof OwnedCommandFailure && cause.cleanupFailure === null)
        cleanupConfirmed = true;
      throw cause;
    } finally {
      await upstream.close(cleanupConfirmed);
    }
  },
  120000,
);
