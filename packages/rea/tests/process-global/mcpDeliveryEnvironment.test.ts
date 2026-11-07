import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAnalysisExecution } from "../../src/application/AnalysisProvider.js";
import { AnalysisInputError } from "../../src/domain/analysisErrorCore.js";
import { jsonObjectSchema } from "../../src/domain/jsonValue.js";
import { ok } from "../../src/domain/result.js";
import { run } from "../../src/main.js";
import { createServer } from "../../src/server/createServer.js";
import type { EvidenceMcpServer } from "../../src/server/EvidenceMcpServer.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";

const resources: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
  vi.unstubAllEnvs();
});

const connect = async (server: EvidenceMcpServer) => {
  const client = new Client({ name: "selected-delivery", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
};

it("keeps independent server budgets for successful results and oversized errors after environment mutation", async () => {
  const smallBudget = STDIO_DEFAULT_MAX_BUFFER_SIZE;
  const largeBudget = 2 * smallBudget;
  const smallEnvironment = { REA_MCP_MAX_RESPONSE_BYTES: String(smallBudget) };
  const largeEnvironment = { REA_MCP_MAX_RESPONSE_BYTES: String(largeBudget) };
  const payload = "x".repeat(3 * 1024 * 1024);
  const analysis = {
    execute: () =>
      Promise.resolve(
        ok(
          createAnalysisExecution(
            payload,
            {
              id: "fixture",
              name: "Fixture",
              version: "1",
            },
            { rawResult: payload },
          ),
        ),
      ),
  };

  vi.stubEnv("REA_MCP_MAX_RESPONSE_BYTES", String(largeBudget));
  const small = createServer(
    { kind: "fixed", analysis },
    {
      environment: smallEnvironment,
    },
  );
  vi.stubEnv("REA_MCP_MAX_RESPONSE_BYTES", String(smallBudget));
  const large = createServer(
    { kind: "fixed", analysis },
    {
      environment: largeEnvironment,
    },
  );
  smallEnvironment.REA_MCP_MAX_RESPONSE_BYTES = "invalid-after-selection";
  largeEnvironment.REA_MCP_MAX_RESPONSE_BYTES = String(smallBudget);
  vi.stubEnv("REA_MCP_MAX_RESPONSE_BYTES", "invalid-ambient-after-selection");

  // Error text alone exceeds the small budget and fits the large one.
  const diagnostic = "observed failure ".repeat(
    Math.ceil((smallBudget + 65536) / 17),
  );
  for (const server of [small, large])
    server.registerTool(
      "selected_failure",
      { inputSchema: z.object({}) },
      async () =>
        server.delivery.toErrorToolResult(
          new AnalysisInputError("fixture", undefined, [
            {
              path: ["procedure"],
              reason: "invalid_value",
              message: diagnostic,
            },
          ]),
          false,
        ),
    );

  const [smallClient, largeClient] = await Promise.all([
    connect(small),
    connect(large),
  ]);
  const [smallResult, largeResult] = await Promise.all(
    [smallClient, largeClient].map((client) =>
      client.callTool({
        name: "procedure_pseudo_code",
        arguments: { procedure: "main" },
      }),
    ),
  );
  if (smallResult === undefined || largeResult === undefined)
    throw new Error("Missing result from selected-budget server");
  expect(smallResult?.isError).toBe(true);
  expect(parseMcpToolError(smallResult)).toMatchObject({
    error: {
      code: "resource_constraint",
      details: {
        reported_limits: {
          result_budget_bytes: smallBudget - 1024,
        },
      },
    },
  });
  expect(largeResult?.isError).not.toBe(true);
  expect(
    jsonObjectSchema.parse(largeResult?.structuredContent).normalized_result,
  ).toBe(payload);

  const [smallFailure, largeFailure] = await Promise.all(
    [smallClient, largeClient].map((client) =>
      client.callTool({ name: "selected_failure", arguments: {} }),
    ),
  );
  if (smallFailure === undefined || largeFailure === undefined)
    throw new Error("Missing failure from selected-budget server");
  expect(parseMcpToolError(smallFailure)).toMatchObject({
    error: {
      code: "resource_constraint",
      details: {
        reported_limits: {
          result_budget_bytes: smallBudget - 1024,
          original_error_code: "invalid_request",
          retention: "unavailable",
        },
      },
    },
  });
  expect(parseMcpToolError(largeFailure)).toMatchObject({
    error: {
      code: "invalid_request",
      details: { issues: [{ message: diagnostic }] },
    },
  });
  expect(small.delivery.resultBudgetBytes).toBe(smallBudget - 1024);
  expect(large.delivery.resultBudgetBytes).toBe(largeBudget - 1024);
});

it("snapshots the runtime-selected environment before optional loading and reuses it for replacement servers", async () => {
  const selected = {
    REA_MCP_MAX_RESPONSE_BYTES: String(2 * STDIO_DEFAULT_MAX_BUFFER_SIZE),
    REA_BROWSER_EXECUTABLE: "/selected/browser",
    REA_LOG_LEVEL: "silent",
  };
  const observed: EvidenceMcpServer[] = [];
  let shutdown: (() => void) | undefined;
  let finishClose: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => {
    finishClose = resolve;
  });
  vi.stubEnv(
    "REA_MCP_MAX_RESPONSE_BYTES",
    String(STDIO_DEFAULT_MAX_BUFFER_SIZE),
  );
  const code = await run({
    env: selected,
    loadOptionalProviders: async () => {
      selected.REA_MCP_MAX_RESPONSE_BYTES = "invalid-after-start";
      selected.REA_BROWSER_EXECUTABLE = "/mutated/browser";
      return {};
    },
    createServer: (source, options) => {
      expect(options?.environment?.REA_BROWSER_EXECUTABLE).toBe(
        "/selected/browser",
      );
      expect(Object.isFrozen(options?.environment)).toBe(true);
      const server = createServer(source, options);
      observed.push(server);
      return server;
    },
    serve: (factory) => {
      expect(factory({ era: "modern" })).toBe(observed[0]);
      expect(factory({ era: "legacy" })).toBe(observed[1]);
      return {
        close: async () => {
          await Promise.all(observed.map((server) => server.close()));
          finishClose?.();
        },
      };
    },
    writeStderr: (message) => {
      throw new Error(message);
    },
    setExitCode: () => undefined,
    registerShutdown: (handler) => {
      shutdown = handler;
      return () => undefined;
    },
  });
  expect(code).toBe(0);
  expect(observed).toHaveLength(2);
  expect(observed[0]?.delivery).toBe(observed[1]?.delivery);
  expect(observed[0]?.delivery.resultBudgetBytes).toBe(
    2 * STDIO_DEFAULT_MAX_BUFFER_SIZE - 1024,
  );
  if (shutdown === undefined)
    throw new Error("Missing runtime shutdown handler");
  shutdown();
  await closed;
  await new Promise<void>((resolve) => setImmediate(resolve));
});
