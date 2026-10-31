import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { FULL_CATALOG_IDENTITY } from "../../../src/catalogIdentity.js";
import { TOOL_CONTRACTS } from "../../../src/contracts/toolContracts.js";
import {
  evidenceResultOf,
  expandToolAvailability,
  toolAvailabilitySummaryInventory,
} from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const mainPath = fileURLToPath(
  new URL("../../../dist/main.js", import.meta.url),
);
const fixturePath = fileURLToPath(
  new URL("../../fixtures/fakeLauncher.mjs", import.meta.url),
);

const expectAvailableToolInventory = async (
  client: Client,
  listed: Awaited<ReturnType<Client["listTools"]>>,
) => {
  const binarySession = listed.tools.find(
    ({ name }) => name === "binary_session",
  );
  if (binarySession === undefined)
    throw new Error("The compiled catalog omitted binary_session");
  const status = await client.callTool(
    { name: "binary_session", arguments: {} },
    { toolDefinition: binarySession },
  );
  expect(status.isError).not.toBe(true);
  const inventory = z
    .object({
      result: z.object({
        tool_availability: toolAvailabilitySummaryInventory,
      }),
    })
    .parse(status.structuredContent).result.tool_availability;
  const availability = expandToolAvailability(inventory);
  // This asserts the compiled entrypoint matches the source catalog. When it
  // fails, check that `dist/` is current (`npm run build:cached`) before
  // suspecting a registration bug -- a stale build is by far the likeliest
  // cause of a pure count mismatch here.
  expect(
    availability.length,
    "compiled tool inventory is stale; run npm run build:cached",
  ).toBe(FULL_CATALOG_IDENTITY.counts.mcp_tools);
  expect(new Set(listed.tools.map(({ name }) => name))).toEqual(
    new Set(TOOL_CONTRACTS.map(({ name }) => name)),
  );
  return status;
};

/**
 * Parses complete newline-delimited records, dropping any partial trailing
 * line so a chunk boundary cannot turn into a JSON parse error.
 */
const completeStderrRecords = (stderr: string): unknown[] =>
  stderr
    .split("\n")
    .slice(0, -1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line): unknown => JSON.parse(line));

const callCurrentDocument = async (
  target?: {
    readonly path: string;
    readonly kind?: "database";
  },
  inspectSession?: (client: Client) => Promise<void>,
) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mainPath],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      // The fixture exercises Hopper even when other providers are installed.
      REA_ANALYSIS_PROVIDER: "hopper",
      HOPPER_LAUNCHER_PATH: process.execPath,
      ...(target === undefined
        ? {}
        : {
            HOPPER_TARGET_PATH: target.path,
            ...(target.kind === undefined
              ? {}
              : { HOPPER_TARGET_KIND: target.kind }),
          }),
      HOPPER_LOADER_ARGS_JSON: JSON.stringify([fixturePath]),
    },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });
  const client = new Client({ name: "runtime-smoke", version: "1.0.0" });

  let result: Awaited<ReturnType<Client["callTool"]>>;
  try {
    await client.connect(transport);
    result = await client.callTool({
      name: "current_document",
      arguments: {},
    });
    await inspectSession?.(client);
  } finally {
    await client.close();
    await transport.close();
  }
  return { result, stderr, records: completeStderrRecords(stderr) };
};

describe("production stdio runtime", () => {
  // The `test:acceptance` lane runs the real entrypoint on the current host;
  // these cases state each supported host's result in the test name and body.

  it("reports a missing target through MCP and structured logs", async () => {
    const { result, stderr, records } = await callCurrentDocument();
    expect(result.isError).toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("No app is open."),
        }),
      ]),
    );
    expect(records).toContainEqual(
      expect.objectContaining({
        application: "rea",
        mode: "mcp",
        layer: "server",
        tool: "current_document",
        status: "error",
      }),
    );
    expect(stderr).not.toContain("HOPPER_LOADER_ARGS_JSON");
    expect(stderr).not.toContain(fixturePath);
  }, 15_000);

  it.runIf(process.platform === "darwin")(
    "returns the selected document on macOS through MCP and structured logs",
    async () => {
      const { result, stderr, records } = await callCurrentDocument({
        path: process.execPath,
      });
      expect(result.isError).not.toBe(true);
      const observation = evidenceResultOf(z.literal("fixture")).parse(
        result.structuredContent,
      );
      const evidence = parseEvidence(observation);
      expect(evidence.operation).toBe("current_document");
      expect(evidence.provider.id).toBe("hopper");
      expect(evidence.normalized_result).toBe(observation.normalized_result);
      // Hopper's reply is the result; it is not repeated as raw_result.
      expect(evidence.raw_result).toBeNull();
      expect(records).toContainEqual(
        expect.objectContaining({
          application: "rea",
          mode: "mcp",
          layer: "server",
          tool: "current_document",
          status: "ok",
        }),
      );
      expect(stderr).not.toContain("HOPPER_LOADER_ARGS_JSON");
      expect(stderr).not.toContain(fixturePath);
    },
    15_000,
  );

  // Use the suite's bounded acceptance deadline, including its coverage allowance.
  // This cold-start workflow computes the growing catalog's schema digests; it
  // verifies catalog and lifecycle behavior, not a 15-second performance target.
  it("serves the compiled catalog without an initial target or fatal record", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [mainPath],
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH ?? "",
      },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    const client = new Client({ name: "catalog-runtime", version: "1.0.0" });

    try {
      await client.connect(transport);
      // Keep catalog parity independent of initial target/provider startup.
      // Validate each called tool against its advertised definition without
      // asking the SDK to compile every unrelated output schema in the catalog.
      const listed = await client.listTools();
      const status = await expectAvailableToolInventory(client, listed);
      expect(
        z
          .object({ result: z.object({ open: z.boolean() }) })
          .parse(status.structuredContent).result,
      ).toEqual({ open: false });
      // Closing the empty session produces a structured lifecycle record,
      // making the fatal-record check observable without launching a provider.
      const closeBinary = listed.tools.find(
        ({ name }) => name === "close_binary",
      );
      if (closeBinary === undefined)
        throw new Error("The compiled catalog omitted close_binary");
      const closed = await client.callTool(
        { name: "close_binary", arguments: {} },
        { toolDefinition: closeBinary },
      );
      expect(closed.isError).not.toBe(true);
    } finally {
      await client.close();
      await transport.close();
    }
    // The transport has closed, so the stderr pipe has ended and every record
    // the child wrote has been delivered. Reading while the child is still
    // running races the pipe and can observe an empty or partial buffer, which
    // would silently miss the fatal record this test exists to catch.
    const records = completeStderrRecords(stderr);
    expect(
      records.length,
      "no startup records were observed, so the fatal-record check is vacuous",
    ).toBeGreaterThan(0);
    expect(records).toContainEqual(
      expect.objectContaining({ tool: "close_binary", status: "ok" }),
    );
    const fatal = records.filter(
      (record): record is { level: number } =>
        typeof record === "object" &&
        record !== null &&
        "level" in record &&
        typeof record.level === "number" &&
        record.level >= 50,
    );
    expect(fatal).toEqual([]);
  });
});

describe("production stdio saved-database admission", () => {
  it.runIf(process.platform === "darwin")(
    "refuses database analysis on macOS while keeping the session usable without a fatal record",
    async () => {
      const path = fileURLToPath(import.meta.url);
      const { result, records } = await callCurrentDocument(
        { path, kind: "database" },
        async (client) => {
          const status = await expectAvailableToolInventory(
            client,
            await client.listTools(),
          );
          expect(status.structuredContent).toMatchObject({
            result: {
              open: true,
              path,
              kind: "database",
              format: "analysis-database",
              analysis_provider_binding: null,
            },
          });
        },
      );
      expect(parseMcpToolError(result)).toMatchObject({
        error: {
          code: "capability_unavailable",
          category: "unsupported_provider",
          retryable: false,
          details: {
            operation: "current_document",
            selection_reason: "target_unsupported",
            rejections: expect.arrayContaining([
              expect.objectContaining({
                provider_id: "hopper",
                code: "target_kind_unsupported",
                reason: expect.stringContaining(
                  "cannot start REA's analysis bridge",
                ),
                diagnostics: {
                  target_kind: "database",
                  target_format: "analysis-database",
                  architecture: null,
                },
              }),
            ]),
          },
        },
      });
      expect(records).toContainEqual(
        expect.objectContaining({
          tool: "current_document",
          status: "error",
          level: 40,
        }),
      );
      expect(
        records.some(
          (record) =>
            typeof record === "object" &&
            record !== null &&
            "level" in record &&
            typeof record.level === "number" &&
            record.level >= 50,
        ),
      ).toBe(false);
    },
    15_000,
  );
});
