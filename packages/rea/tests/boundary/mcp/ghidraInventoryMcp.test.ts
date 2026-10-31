import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { nativeAotPeFixture } from "../../fixtures/nativeaotPe.js";
import { jsonValueSchema } from "../../../src/domain/jsonValue.js";
import { err, ok } from "../../../src/domain/result.js";
import { ghidraFunctionIdentity } from "../../../src/domain/ghidraValues.fixture.js";
import {
  connectGhidraMcp,
  ghidraInstallationHost,
  sessionEvidence,
} from "./ghidraMcpHarness.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { GhidraClient } from "../../../src/ghidra/GhidraClient.js";
import { GhidraProvider } from "../../../src/ghidra/GhidraProvider.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import { silentLogger } from "../../../src/logger.js";
import { composeBinarySession } from "../../../src/application/binary/BinarySessionComposition.js";
import { AnalysisProviderRegistry } from "../../../src/application/binary/AnalysisProviderRegistry.js";
import { createServer } from "../../../src/server/createServer.js";
import { waitForExit } from "../../support/process/processFixture.js";
import { GhidraSessionError } from "../../../src/ghidra/GhidraSessionError.js";

it("delivers a complete Ghidra inventory within the existing MCP response budget", async () => {
  const items = Array.from({ length: 30_000 }, (_, index) => ({
    address: `0x${(0x1000 + index).toString(16)}`,
    value: `procedure_${String(index).padStart(6, "0")}`,
    procedure: { external: false, thunk: false, thunk_target: null },
  }));
  const harness = await connectGhidraMcp(
    "inventory-response-budget",
    (operation) => {
      if (operation !== "list_procedures")
        throw new Error(`Unexpected operation: ${operation}`);
      return Promise.resolve(ok(items));
    },
  );
  try {
    const reply = await harness.mcp.callTool({
      name: "list_procedures",
      arguments: {},
    });
    if (reply.isError) throw new Error(JSON.stringify(reply));
    const evidence = sessionEvidence(harness.session, reply.structuredContent);
    expect(evidence.raw_result).toBeNull();
    expect(evidence.normalized_result).toEqual(items);
    expect(harness.calls).toEqual(["list_procedures"]);
  } finally {
    await harness.close();
  }
});

it("retains byte-search coverage and rejects malformed pages before creating Evidence", async () => {
  const page = {
    matches: [
      {
        address: "0x401000",
        segment: ".text",
        file_offset: null,
        procedure: null,
      },
    ],
    searched: {
      blocks: [
        { segment: ".text", start: "0x401000", end: "0x40100f", bytes: 16 },
      ],
      bytes: 16,
      skipped_uninitialized: [
        { segment: ".bss", start: "0x402000", end: "0x40200f", bytes: 16 },
      ],
      skipped_not_loaded: [
        { segment: ".symtab", start: "0x0", end: "0x17f", bytes: 384 },
      ],
    },
    complete: false,
    next_cursor: "continuation",
  };
  let output = jsonValueSchema.parse(page);
  const harness = await connectGhidraMcp("byte-search-projection", () =>
    Promise.resolve(ok(output)),
  );
  try {
    const first = await harness.mcp.callTool({
      name: "search_bytes",
      arguments: { pattern: "48 ??", limit: 1 },
    });
    expect(first.isError).not.toBe(true);
    expect(
      sessionEvidence(harness.session, first.structuredContent)
        .normalized_result,
    ).toEqual(page);
    output = jsonValueSchema.parse({
      ...page,
      matches: [],
      complete: true,
      next_cursor: null,
    });
    const last = await harness.mcp.callTool({
      name: "search_bytes",
      arguments: { pattern: "48 ??", cursor: "continuation" },
    });
    expect(last.isError).not.toBe(true);
    expect(
      sessionEvidence(harness.session, last.structuredContent)
        .normalized_result,
    ).toEqual(output);
    output = jsonValueSchema.parse({ ...page, complete: true });
    const malformed = await harness.mcp.callTool({
      name: "search_bytes",
      arguments: { pattern: "49 ??" },
    });
    expect(parseMcpToolError(malformed)).toMatchObject({
      error: { code: "unreadable_output" },
    });
    for (const block of [
      { segment: ".text", start: "0x1000", end: "0x1009", bytes: 1 },
      { segment: ".text", start: "0x1009", end: "0x1000", bytes: 1 },
      { segment: ".text", start: "overlay:0x1000", end: "0x1000", bytes: 1 },
      { segment: ".text", start: "invalid", end: "0x1000", bytes: 1 },
    ]) {
      output = jsonValueSchema.parse({
        ...page,
        searched: { ...page.searched, blocks: [block], bytes: block.bytes },
      });
      const invalidCoverage = await harness.mcp.callTool({
        name: "search_bytes",
        arguments: { pattern: "48 ??" },
      });
      expect(parseMcpToolError(invalidCoverage)).toMatchObject({
        error: { code: "unreadable_output" },
      });
      expect(invalidCoverage.structuredContent).toBeUndefined();
    }
    for (const [address, segment] of [
      ["0x402000", ".bss"],
      ["overlay:0x401000", ".text"],
      ["invalid", ".text"],
    ]) {
      output = jsonValueSchema.parse({
        ...page,
        matches: [{ ...page.matches[0], address, segment }],
      });
      const outsideCoverage = await harness.mcp.callTool({
        name: "search_bytes",
        arguments: { pattern: "48 ??" },
      });
      expect(parseMcpToolError(outsideCoverage)).toMatchObject({
        error: { code: "unreadable_output" },
      });
      expect(outsideCoverage.structuredContent).toBeUndefined();
    }
    const calls = harness.calls.length;
    for (const args of [{ pattern: "??" }, { pattern: "48", mask: "ffff" }]) {
      const invalid = await harness.mcp.callTool({
        name: "search_bytes",
        arguments: args,
      });
      expect(invalid.isError).toBe(true);
      expect(parseMcpToolError(invalid)).toMatchObject({
        error: {
          code: "invalid_request",
          recovery: {
            kind: "inspect_input_contract",
            operation: "search_bytes",
          },
        },
      });
    }
    expect(harness.calls).toHaveLength(calls);
  } finally {
    await harness.close();
  }
});

it("projects cancelled byte searches as typed failures without successful partial Evidence", async () => {
  const harness = await connectGhidraMcp("byte-search-cancelled", () =>
    Promise.resolve(
      err(new GhidraSessionError("cancelled", "Search cancelled")),
    ),
  );
  try {
    const reply = await harness.mcp.callTool({
      name: "search_bytes",
      arguments: { pattern: "48 8b" },
    });
    expect(reply.isError).toBe(true);
    expect(parseMcpToolError(reply)).toMatchObject({
      error: { code: "cancelled" },
    });
    expect(reply.structuredContent).toBeUndefined();
  } finally {
    await harness.close();
  }
});

it("searches bytes through MCP and the socket bridge with pagination and skipped coverage", async () => {
  const config = parseConfig({ GHIDRA_INSTALL_DIR: "/fixture/ghidra" });
  if (!config.ok) throw config.error;
  const provider = new GhidraProvider(
    config.value,
    silentLogger,
    {},
    ghidraInstallationHost(),
    (options) =>
      new GhidraClient({
        ...options,
        platform: process.platform,
        startupTimeoutMs: 5000,
        launcher: {
          launch: async (launch) => {
            const projectRoot = join(launch.runtimeRoot, "project");
            await mkdir(projectRoot);
            const child = spawn(
              process.execPath,
              [
                fileURLToPath(
                  new URL("../../fixtures/fakeGhidra.mjs", import.meta.url),
                ),
              ],
              {
                stdio: ["ignore", "pipe", "pipe"],
                env: {
                  ...process.env,
                  REA_GHIDRA_FIXTURE_CONFIG: JSON.stringify({
                    endpointPath: launch.endpointPath,
                    token: launch.token,
                    runId: launch.runId,
                    providerVersion: launch.providerVersion,
                    profileDigest: launch.profileDigest,
                    targetSha256: launch.targetSha256,
                    transport: launch.transport,
                  }),
                },
              },
            );
            return ok({
              process: child,
              ownsProcessLifetime: true as const,
              projectRoot,
              ghidraLogPath: join(launch.runtimeRoot, "ghidra.log"),
              scriptLogPath: join(launch.runtimeRoot, "script.log"),
              cleanup: async () => {
                const signaled =
                  child.exitCode === null && child.signalCode === null;
                if (signaled) child.kill("SIGTERM");
                return (await waitForExit(child, 2000))
                  ? { cleaned: true as const, signaled }
                  : { cleaned: false as const, reason: "Fixture did not exit" };
              },
            });
          },
        },
      }),
  );
  const session = composeBinarySession(
    new AnalysisProviderRegistry([provider]),
  );
  const server = createServer(
    { kind: "session", session },
    { logger: silentLogger },
  );
  const client = new Client({ name: "byte-search", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path: process.execPath },
    });
    expect(opened.isError).not.toBe(true);
    const first = await client.callTool({
      name: "search_bytes",
      arguments: { pattern: "48 8b ?? ?? 89", limit: 1 },
    });
    expect(first.isError, JSON.stringify(first)).not.toBe(true);
    const firstEvidence = sessionEvidence(session, first.structuredContent);
    expect(firstEvidence.raw_result).toBeNull();
    expect(firstEvidence.normalized_result).toMatchObject({
      matches: [
        {
          address: "0x1000",
          segment: ".text",
          file_offset: 0,
          procedure: { name: "fixture_main" },
        },
      ],
      searched: {
        bytes: 10,
        skipped_uninitialized: [{ segment: ".bss", bytes: 16 }],
      },
      complete: false,
      next_cursor: "fixture-second-page",
    });
    const second = await client.callTool({
      name: "search_bytes",
      arguments: {
        pattern: "48 8b ?? ?? 89",
        limit: 1,
        cursor: "fixture-second-page",
      },
    });
    expect(second.isError).not.toBe(true);
    expect(
      sessionEvidence(session, second.structuredContent).normalized_result,
    ).toMatchObject({
      matches: [{ address: "0x1005", file_offset: 5 }],
      complete: true,
      next_cursor: null,
    });
    const invalid = await client.callTool({
      name: "search_bytes",
      arguments: { pattern: "??" },
    });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid.content)).toContain(
      "Pattern must constrain at least one bit",
    );
  } finally {
    await client.close();
    await server.close();
    const closed = await session.close();
    if (!closed.ok) throw closed.error;
  }
});

it("retains missing PDB coverage in empty PE name-search Evidence and snapshot replay", async () => {
  const root = await createTestTempDirectory("rea-pdb-evidence-");
  const targetPath = join(root, "fixture.exe");
  await writeFile(targetPath, nativeAotPeFixture());
  // Synthetic post-analysis facts at the real provider boundary; no engine is simulated as verified.
  const pdb = {
    file: "C:\\build\\fixture.pdb",
    guid: "01234567-89AB-CDEF-0123-456789ABCDEF",
    age: "a",
    signature: null,
    version: "RSDS",
    loaded: false,
  };
  const harness = await connectGhidraMcp(
    "ghidra-pdb-coverage",
    (operation) =>
      Promise.resolve(
        ok(
          operation === "procedure_pseudo_code"
            ? {
                value: "int FUN_140001000(void) { return 0; }",
                limitations: [],
              }
            : [],
        ),
      ),
    {
      targetPath,
      pdb,
    },
  );
  try {
    const reply = await harness.mcp.callTool({
      name: "search_procedures",
      arguments: { pattern: "add_numbers" },
    });
    expect(reply.isError).not.toBe(true);
    const evidence = sessionEvidence(harness.session, reply.structuredContent);
    expect(evidence.normalized_result).toEqual([]);
    expect(evidence.analysis_profile?.parameters.pdb_observations).toBe(
      "program-info-v5",
    );
    const limitation = evidence.limitations.find((value) =>
      value.includes(pdb.file),
    );
    expect(limitation).toContain(pdb.guid);
    expect(limitation).toContain("age (hex) a");
    expect(limitation).toContain("not loaded");
    const decompiled = await harness.mcp.callTool({
      name: "procedure_pseudo_code",
      arguments: { procedure: "0x140001000", document: "fixture" },
    });
    expect(decompiled.isError).not.toBe(true);
    const functionEvidence = sessionEvidence(
      harness.session,
      decompiled.structuredContent,
    );
    expect(functionEvidence.limitations).toContain(limitation);
    const replay = await harness.session.execute(
      "procedure_pseudo_code",
      functionEvidence.parameters,
    );
    if (!replay.ok) throw replay.error;
    expect(replay.value.limitations).toContain(limitation);
    expect(replay.value.limitations).toContainEqual(
      expect.stringContaining("Loaded from a local REA analysis snapshot"),
    );
  } finally {
    await harness.close();
  }
});

it("retains defined-string coverage in empty and matching search Evidence", async () => {
  let output = jsonValueSchema.parse([]);
  const harness = await connectGhidraMcp("ghidra-string-coverage", () =>
    Promise.resolve(ok(output)),
  );
  try {
    for (const request of [
      { name: "list_strings", arguments: {} },
      { name: "search_strings", arguments: { pattern: "projection" } },
      {
        name: "search_strings",
        arguments: { pattern: "projection.*", mode: "regex" },
      },
    ]) {
      const reply = await harness.mcp.callTool(request);
      expect(reply.isError).not.toBe(true);
      const evidence = sessionEvidence(
        harness.session,
        reply.structuredContent,
      );
      expect(evidence.normalized_result).toEqual([]);
      expect(evidence.analysis_profile?.parameters).toMatchObject({
        string_inventory_evidence: "defined-data-coverage-v1",
      });
      expect(evidence.limitations).toContainEqual(
        expect.stringMatching(
          /Only Ghidra-defined string Data.*empty search does not establish/u,
        ),
      );
    }
    output = jsonValueSchema.parse([
      { address: "0x401000", value: "projection cache ignored" },
    ]);
    const matched = await harness.mcp.callTool({
      name: "search_strings",
      arguments: { pattern: "projection" },
    });
    const evidence = sessionEvidence(
      harness.session,
      matched.structuredContent,
    );
    expect(evidence.normalized_result).toEqual(output);
    expect(evidence.limitations).toContainEqual(
      expect.stringContaining("Completeness applies to that inventory"),
    );
    output = jsonValueSchema.parse([]);
    const procedures = await harness.mcp.callTool({
      name: "search_procedures",
      arguments: { pattern: "projection" },
    });
    expect(
      sessionEvidence(harness.session, procedures.structuredContent)
        .limitations,
    ).not.toContainEqual(expect.stringContaining("Ghidra-defined string Data"));
  } finally {
    await harness.close();
  }
});

it("rejects contradictory provider output before emitting MCP Evidence", async () => {
  const bytes = {
    address: "0x401000",
    requested_bytes: 4,
    returned_bytes: 2,
    bytes_hex: "0410",
    complete: false,
  };
  let output = jsonValueSchema.parse(bytes);
  const harness = await connectGhidraMcp("ghidra-invalid-inventory", () =>
    Promise.resolve(ok(output)),
  );
  try {
    const accepted = await harness.mcp.callTool({
      name: "read_bytes",
      arguments: { address: bytes.address, length: 4 },
    });
    expect(accepted.isError).not.toBe(true);
    expect(accepted.structuredContent).toMatchObject({
      normalized_result: bytes,
    });
    const cases = [
      ...[
        { complete: true },
        { returned_bytes: 4 },
        { bytes_hex: "04" },
        { requested_bytes: 1 },
      ].map((change, index) => ({
        name: "read_bytes",
        arguments: {
          address: `0x${(0x401004 + index * 4).toString(16)}`,
          length: 4,
        },
        output: { ...bytes, ...change },
      })),
      {
        name: "address_to_file_offset",
        arguments: { address: bytes.address },
        output: { address: bytes.address, file_offset: -1 },
      },
      {
        name: "list_procedures",
        arguments: {},
        output: [
          {
            address: "00401000",
            value: "main",
            procedure: { external: false, thunk: false, thunk_target: null },
          },
        ],
      },
      {
        name: "search_strings",
        arguments: { pattern: "needle" },
        output: [{ address: "0x401000" }],
      },
      {
        name: "read_function_instructions",
        arguments: { procedure: "fixture_main" },
        output: {
          procedure: { ...ghidraFunctionIdentity(), address: "0X401000" },
          instructions: ["0x401000: push rbp"],
          limitations: ["Ghidra-specific instruction text."],
        },
      },
      {
        name: "resolve_containing_procedure",
        arguments: { address: "EXTERNAL:0x2" },
        output: {
          query_address: "EXTERNAL:0x2",
          found: true,
          procedure: {
            ...ghidraFunctionIdentity(),
            address: "EXTERNAL:0x1",
            classification: {
              ...ghidraFunctionIdentity().classification,
              external: true,
            },
            body: {
              ...ghidraFunctionIdentity().body,
              ranges: [],
              total_bytes: 0,
              span_bytes: 0,
              contains_entry: false,
            },
          },
        },
      },
    ];
    for (const probe of cases) {
      output = jsonValueSchema.parse(probe.output);
      const rejected = await harness.mcp.callTool({
        name: probe.name,
        arguments: probe.arguments,
      });
      expect(rejected.isError, probe.name).toBe(true);
      expect(parseMcpToolError(rejected)).toMatchObject({
        error: { code: "unreadable_output" },
      });
      expect(parseMcpToolError(rejected)).not.toHaveProperty("evidence_id");
      expect(parseMcpToolError(rejected)).not.toHaveProperty("result");
    }
  } finally {
    await harness.close();
  }
});
