import { access } from "node:fs/promises";

import { expect, it, vi } from "vitest";
import { z } from "zod";

import { AnalysisProviderRegistry } from "../../../src/application/binary/AnalysisProviderRegistry.js";
import { composeBinarySession } from "../../../src/application/binary/BinarySessionComposition.js";
import { runDirectAnalysis } from "../../../src/application/DirectAnalysis.js";
import type { DirectAnalysisDependencies } from "../../../src/application/DirectAnalysisDependencies.js";
import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import { analysisCliErrorEnvelopeSchema } from "../../../src/contracts/errorSchemas.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { GhidraClient } from "../../../src/ghidra/GhidraClient.js";
import { ghidraProfileInstallationHost } from "../../../src/ghidra/GhidraInstallation.fixture.js";
import { GhidraProvider } from "../../../src/ghidra/GhidraProvider.js";
import { silentLogger } from "../../../src/logger.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { GhidraFixtureLauncher } from "../providers/ghidra/ghidraClient.fixture.js";

// Only installation discovery and the Java bridge are simulated. The bridge
// fixture answers with the production address_to_file_offset codes; requests
// cross the real client socket, provider projection and public adapters.
const ghidraSession = (launcher: GhidraFixtureLauncher) => {
  const config = parseConfig({ GHIDRA_INSTALL_DIR: "/fixture/ghidra" });
  if (!config.ok) throw config.error;
  return composeBinarySession(
    new AnalysisProviderRegistry([
      new GhidraProvider(
        config.value,
        silentLogger,
        {},
        ghidraProfileInstallationHost,
        (options) =>
          new GhidraClient({
            ...options,
            platform: process.platform,
            launcher,
          }),
      ),
    ]),
  );
};

const expectReleased = async (launcher: GhidraFixtureLauncher) => {
  for (const root of launcher.runtimeRoots)
    await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
  for (const child of launcher.processes)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
};

const sessionStatus = z.object({
  result: z.object({
    analysis_run: z.object({ run_id: z.string() }),
    capabilities: z.array(
      z.object({
        groups: z.array(
          z.object({
            operations: z.array(z.string()),
            available: z.boolean(),
          }),
        ),
      }),
    ),
  }),
});

/** Open the process executable through the fixture bridge and public MCP. */
const connectFileOffsetMcp = async () => {
  const launcher = new GhidraFixtureLauncher();
  const harness = await createApplicationMcpHarness({
    session: ghidraSession(launcher),
    serverOptions: { logger: silentLogger },
    clientIdentity: { name: "ghidra-file-offset", version: "1" },
  });
  const tool = (name: string, arguments_: Record<string, string> = {}) =>
    harness.client.callTool({ name, arguments: arguments_ });
  const call = (address: string) => tool("address_to_file_offset", { address });
  const mapped = async (address: string) => {
    const reply = await call(address);
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    return parseEvidence(reply.structuredContent).normalized_result;
  };
  const refused = async (address: string) =>
    parseMcpToolError(await call(address)).error;
  // A per-address outcome must not mark the operation unavailable.
  const runId = async () => {
    const status = sessionStatus.parse(
      (await tool("binary_session")).structuredContent,
    ).result;
    expect(
      status.capabilities
        .flatMap(({ groups }) => groups)
        .filter(({ operations }) =>
          operations.includes("address_to_file_offset"),
        ),
    ).toEqual([expect.objectContaining({ available: true })]);
    return status.analysis_run.run_id;
  };
  const bridgeCalls = () =>
    launcher.requests.filter((method) => method === "address_to_file_offset");
  const close = async () => {
    await harness.close();
    await expectReleased(launcher);
  };
  try {
    const opened = await tool("open_binary", {
      path: process.execPath,
      provider_id: "ghidra",
    });
    expect(opened.isError).not.toBe(true);
  } catch (cause) {
    await close();
    throw cause;
  }
  return { launcher, tool, mapped, refused, runId, bridgeCalls, close };
};

const BSS_MESSAGE =
  "Address 0x2004 is in uninitialized Ghidra memory block .bss";

it("reports file-backed, uninitialized and unmapped addresses through MCP without schema repair", async () => {
  const mcp = await connectFileOffsetMcp();
  try {
    expect(await mcp.mapped("0x1005")).toEqual({
      address: "0x1005",
      file_offset: 5,
    });
    const run = await mcp.runId();

    // The caller's non-canonical spelling survives beside the canonical reason.
    const bss = await mcp.refused("0X2004");
    expect(bss).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      retryable: false,
      details: {
        operation: "address_to_file_offset",
        issues: [
          {
            path: ["address"],
            reason: "invalid_value",
            message: BSS_MESSAGE,
            observed: { address: "0X2004", file_mapping: "uninitialized" },
          },
        ],
        diagnostics: {
          diagnostic_scope: "request",
          remote_code: "address_uninitialized",
        },
      },
    });
    expect(bss.message.startsWith(`${BSS_MESSAGE}. `)).toBe(true);
    expect(bss).not.toHaveProperty("recovery");
    expect(bss.remediation.action).toContain("inspect_native_load_image");
    expect(bss.remediation.action).not.toContain("tools/list");
    expect(bss.details?.diagnostics).not.toHaveProperty("stdout");

    const unmapped = await mcp.refused("0x3000");
    expect(unmapped).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            message: "Address 0x3000 is outside every Ghidra memory block",
            observed: { address: "0x3000", file_mapping: "unmapped" },
          },
        ],
        diagnostics: { remote_code: "address_unmapped" },
      },
    });
    expect(unmapped).not.toHaveProperty("recovery");

    // Malformed syntax is still an input-contract violation.
    expect(await mcp.refused("not-an-address")).toMatchObject({
      code: "invalid_request",
      message: "Analysis input is invalid. Check the arguments and try again.",
      recovery: {
        kind: "inspect_input_contract",
        operation: "address_to_file_offset",
      },
      details: {
        issues: [{ path: ["address"], reason: "invalid_format" }],
      },
    });

    // Refusals keep the same provider session and operation availability.
    expect(await mcp.runId()).toBe(run);
    expect(await mcp.mapped("0x1000")).toEqual({
      address: "0x1000",
      file_offset: 0,
    });
    expect(mcp.launcher.processes).toHaveLength(1);
    // The malformed spelling never reached the bridge.
    await vi.waitFor(() => expect(mcp.bridgeCalls()).toHaveLength(4));
  } finally {
    await mcp.close();
  }
}, 30_000);

const segments = z.array(
  z.object({ name: z.string(), start: z.string(), end: z.string() }),
);
const skippedCoverage = z.object({
  searched: z.object({
    skipped_uninitialized: z.array(
      z.object({ segment: z.string(), start: z.string(), end: z.string() }),
    ),
  }),
});
const hex = (value: bigint) => `0x${value.toString(16)}`;

it("maps the last byte of a file-backed block and refuses the first address past each block", async () => {
  const mcp = await connectFileOffsetMcp();
  try {
    // Take block edges from the bridge's own replies: list_segments ends are
    // exclusive and byte-search coverage ends are inclusive.
    const text = segments
      .parse(
        parseEvidence((await mcp.tool("list_segments")).structuredContent)
          .normalized_result,
      )
      .find(({ name }) => name === ".text");
    const bss = skippedCoverage
      .parse(
        parseEvidence(
          (await mcp.tool("search_bytes", { pattern: "48 8b" }))
            .structuredContent,
        ).normalized_result,
      )
      .searched.skipped_uninitialized.find(({ segment }) => segment === ".bss");
    expect(text).toMatchObject({ start: "0x1000", end: "0x1100" });
    expect(bss).toMatchObject({ start: "0x2000", end: "0x200f" });
    if (text === undefined || bss === undefined)
      throw new Error("Fixture omitted its memory blocks");

    const lastText = BigInt(text.end) - 1n;
    expect(await mcp.mapped(hex(lastText))).toEqual({
      address: hex(lastText),
      file_offset: Number(lastText - BigInt(text.start)),
    });
    for (const [value, remoteCode, outcome] of [
      [BigInt(text.end), "address_unmapped", "unmapped"],
      [BigInt(bss.start), "address_uninitialized", "uninitialized"],
      [BigInt(bss.end), "address_uninitialized", "uninitialized"],
      [BigInt(bss.end) + 1n, "address_unmapped", "unmapped"],
    ] as const)
      expect(await mcp.refused(hex(value))).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [
            { observed: { address: hex(value), file_mapping: outcome } },
          ],
          diagnostics: { remote_code: remoteCode },
        },
      });
    await vi.waitFor(() => expect(mcp.bridgeCalls()).toHaveLength(5));
  } finally {
    await mcp.close();
  }
}, 30_000);

it("gives the CLI analysis path the same unbacked-address outcome as MCP", async () => {
  const launcher = new GhidraFixtureLauncher();
  const create = () => ghidraSession(launcher);
  const dependencies: DirectAnalysisDependencies = {
    readConfiguration: () =>
      parseConfig({ GHIDRA_INSTALL_DIR: "/fixture/ghidra" }),
    createBinarySession: create,
    createNativeDispatchBinarySession: create,
    createArtifactBinarySession: create,
    createNativeBinarySession: create,
    createManagedBinarySession: create,
  };
  try {
    const projected = analysisCliErrorEnvelopeSchema.parse(
      projectCliAnalysisResult(
        await runDirectAnalysis(
          dependencies,
          process.execPath,
          "address_to_file_offset",
          { address: "0X2004" },
          { providerId: "ghidra" },
        ),
      ),
    );
    expect(projected).toMatchObject({
      error: "Analysis failed",
      code: "invalid_request",
      category: "invalid_input",
      message: expect.stringMatching(/^Address 0x2004 is in uninitialized/u),
      remediation: {
        action: expect.stringContaining("inspect_native_load_image"),
      },
      details: {
        issues: [
          {
            path: ["address"],
            message: BSS_MESSAGE,
            observed: { address: "0X2004", file_mapping: "uninitialized" },
          },
        ],
        diagnostics: { remote_code: "address_uninitialized" },
      },
    });
    expect(projected).not.toHaveProperty("recovery");
  } finally {
    await expectReleased(launcher);
  }
}, 30_000);
