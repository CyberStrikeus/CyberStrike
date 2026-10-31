import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, onTestFinished } from "vitest";

import type { AnalysisOperationPort } from "../../../src/application/AnalysisProvider.js";
import { runDirectAnalysis } from "../../../src/application/DirectAnalysis.js";
import { functionDossierSchema } from "../../../src/domain/native/functionDossier.js";
import { ghidraFunctionDossier } from "../../../src/domain/ghidraValues.fixture.js";
import {
  jsonValueSchema,
  type JsonValue,
} from "../../../src/domain/jsonValue.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { ok } from "../../../src/domain/result.js";
import { createServer } from "../../../src/server/createServer.js";
import { observed } from "../../fixtures/analysisExecution.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  createBinarySessionTargets,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";

const connect = async (analysis: AnalysisOperationPort) => {
  const server = createServer({ kind: "fixed", analysis });
  const client = new Client({ name: "argument-parity", version: "1.0.0" });
  onTestFinished(async () => {
    await client.close();
    await server.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
};

const invalidArguments = [
  [
    "list_procedures",
    { document: null },
    { path: ["document"], reason: "invalid_type", expected: "string" },
  ],
  [
    "procedure_pseudo_code",
    { procedure: "main", document: 3 },
    { path: ["document"], reason: "invalid_type", expected: "string" },
  ],
  [
    "search_strings",
    { pattern: "entry", case_sensitive: null },
    {
      path: ["case_sensitive"],
      reason: "invalid_type",
      expected: "boolean",
    },
  ],
  [
    "search_bytes",
    { pattern: "??" },
    { path: ["pattern"], reason: "invalid_value" },
  ],
  [
    "search_bytes",
    { pattern: "48 8B", mask: "ff" },
    { path: ["mask"], reason: "invalid_value" },
  ],
  [
    "search_bytes",
    { pattern: "4?" },
    { path: ["pattern"], reason: "invalid_value" },
  ],
  [
    "search_bytes",
    { pattern: "48", limit: 1001 },
    { path: ["limit"], reason: "out_of_range", maximum: 1000 },
  ],
  [
    "search_bytes",
    { pattern: "48", cursor: null },
    { path: ["cursor"], reason: "invalid_type", expected: "string" },
  ],
] as const;

describe("official operation arguments", () => {
  it("dispatches equivalent CLI and MCP arguments while retaining omissions and defaults", async () => {
    const [path] = await createBinarySessionTargets();
    const calls: Array<{
      name: string;
      parameters: Readonly<Record<string, JsonValue>>;
    }> = [];
    const execute: AnalysisOperationPort["execute"] = (name, parameters) => {
      calls.push({ name, parameters });
      return Promise.resolve(
        observed(
          name === "search_bytes"
            ? {
                matches: [],
                searched: {
                  blocks: [],
                  bytes: 0,
                  skipped_uninitialized: [],
                  skipped_not_loaded: [],
                },
                complete: true,
                next_cursor: null,
              }
            : name === "search_strings"
              ? []
              : "int main() {}",
        ),
      );
    };
    const createSession = () =>
      createTestBinarySession(() => ({
        execute,
        close: () => Promise.resolve(ok(null)),
      }));
    const dependencies = {
      readConfiguration: () => parseConfig({}),
      createBinarySession: createSession,
      createArtifactBinarySession: createSession,
      createNativeDispatchBinarySession: createSession,
      createNativeBinarySession: createSession,
      createManagedBinarySession: createSession,
    };
    const client = await connect({ execute });
    for (const [name, mcpParameters, cliParameters] of [
      ["procedure_pseudo_code", { procedure: "main" }, { procedure: "main" }],
      ["search_bytes", { pattern: "48 ??" }, { pattern: "48 ??", limit: 100 }],
      [
        "search_strings",
        { pattern: "entry" },
        { pattern: "entry", mode: "literal", case_sensitive: false },
      ],
    ] as const) {
      const cli = parseEvidence(
        await runDirectAnalysis(dependencies, path, name, cliParameters).then(
          projectCliAnalysisResult,
        ),
      );
      const mcp = await client.callTool({ name, arguments: mcpParameters });
      expect(mcp.isError).not.toBe(true);
      expect(calls.slice(-2)).toEqual([
        { name, parameters: cliParameters },
        { name, parameters: cliParameters },
      ]);
      expect(mcp.structuredContent).toMatchObject({
        parameters: cli.parameters,
      });
      expect(cli.parameters).not.toHaveProperty("document");
    }
  });

  it("rejects explicit null and malformed optional values before dispatch", async () => {
    const calls: string[] = [];
    const client = await connect({
      execute: (name) => {
        calls.push(name);
        return Promise.resolve(observed([]));
      },
    });
    for (const [name, parameters, issue] of invalidArguments) {
      const result = await client.callTool({ name, arguments: parameters });
      expect(parseMcpToolError(result)).toMatchObject({
        error: {
          code: "invalid_request",
          category: "invalid_input",
          retryable: false,
          recovery: { kind: "inspect_input_contract", operation: name },
          details: { operation: name, issues: [issue] },
        },
      });
    }
    expect(calls).toEqual([]);
    const valid = await client.callTool({
      name: "list_procedures",
      arguments: {},
    });
    expect(valid.isError).not.toBe(true);
    expect(calls).toEqual(["list_procedures"]);
  });
});

describe("official operation arguments", () => {
  it("preserves existing annotations when updates omit them and keeps empty clearing text", async () => {
    const dossier = functionDossierSchema.parse(ghidraFunctionDossier());
    const annotations = {
      address: dossier.procedure.address,
      name: dossier.procedure.name,
      comment: "existing finding",
      inline_comment: "existing inline finding",
    };
    const parameters: Readonly<Record<string, JsonValue>>[] = [];
    const client = await connect({
      execute: (_name, input) => {
        parameters.push(input);
        if (typeof input.comment === "string")
          annotations.comment = input.comment;
        if (typeof input.inline_comment === "string")
          annotations.inline_comment = input.inline_comment;
        return Promise.resolve(
          observed(
            jsonValueSchema.parse({
              annotations,
              dossier,
              effects: {
                scope: "session-analysis-database",
                source_bytes_modified: false,
                persists_after_close: false,
              },
            }),
          ),
        );
      },
    });
    const reply = await client.callTool({
      name: "annotate_native_function",
      arguments: { procedure: annotations.address, inline_comment: "" },
    });
    expect(reply.isError).not.toBe(true);
    expect(parameters).toEqual([
      { procedure: annotations.address, inline_comment: "" },
    ]);
    expect(reply.structuredContent).toMatchObject({
      normalized_result: {
        annotations: {
          name: annotations.name,
          comment: "existing finding",
          inline_comment: "",
        },
      },
    });
    const rejected = await client.callTool({
      name: "annotate_native_function",
      arguments: { procedure: annotations.address, comment: null },
    });
    expect(rejected.isError).toBe(true);
    expect(parameters).toHaveLength(1);
  });
});
