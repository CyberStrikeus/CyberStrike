import { access } from "node:fs/promises";

import { expect, it, vi } from "vitest";

import { AnalysisProviderRegistry } from "../../../src/application/binary/AnalysisProviderRegistry.js";
import { composeBinarySession } from "../../../src/application/binary/BinarySessionComposition.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import { GhidraClient } from "../../../src/ghidra/GhidraClient.js";
import { ghidraProfileInstallationHost } from "../../../src/ghidra/GhidraInstallation.fixture.js";
import { GhidraProvider } from "../../../src/ghidra/GhidraProvider.js";
import type { GhidraProviderClientFactory } from "../../../src/ghidra/GhidraProviderClient.js";
import { silentLogger } from "../../../src/logger.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { GhidraFixtureLauncher } from "../providers/ghidra/ghidraClient.fixture.js";

it("reports local Ghidra admission through SDK MCP without dispatching or losing the warm session", async () => {
  const launcher = new GhidraFixtureLauncher();
  let raw: GhidraClient | undefined;
  const factory: GhidraProviderClientFactory = (options) => {
    raw = new GhidraClient({
      ...options,
      platform: process.platform,
      transport: "authenticated-loopback-tcp",
      launcher,
    });
    return raw;
  };
  const config = parseConfig({
    GHIDRA_INSTALL_DIR: "/fixture/ghidra",
    REA_GHIDRA_STARTUP_TIMEOUT_MS: "10000",
    REA_BRIDGE_MAX_REQUEST_BYTES: "8192",
  });
  if (!config.ok) throw config.error;
  const provider = new GhidraProvider(
    config.value,
    silentLogger,
    {},
    ghidraProfileInstallationHost,
    factory,
  );
  const session = composeBinarySession(
    new AnalysisProviderRegistry([provider]),
  );
  const harness = await createApplicationMcpHarness({
    session,
    serverOptions: { logger: silentLogger },
    clientIdentity: { name: "ghidra-request-ceiling", version: "1" },
  });
  try {
    const opened = await harness.client.callTool({
      name: "open_binary",
      arguments: { path: process.execPath, provider_id: "ghidra" },
    });
    expect(opened.isError).not.toBe(true);
    const first = await harness.client.callTool({
      name: "list_strings",
      arguments: {},
    });
    expect(first.isError).not.toBe(true);
    const refused = await harness.client.callTool({
      name: "search_strings",
      arguments: { pattern: "\u0000".repeat(1500) },
    });
    expect(refused.isError).toBe(true);
    const projected = parseMcpToolError(refused);
    expect(projected).toMatchObject({
      error: {
        code: "resource_constraint",
        details: {
          operation: "search_strings",
          resource: "transport",
          reported_limits: { max_request_bytes: 8192 },
          diagnostics: { failure_kind: "admission" },
        },
        remediation: {
          action: expect.stringContaining("REA_BRIDGE_MAX_REQUEST_BYTES"),
        },
      },
    });
    expect(projected.error.remediation?.action).toContain(
      "only the REA client applies",
    );
    expect(
      projected.error.remediation?.action.includes("Restart Hopper or Cutter"),
    ).toBe(false);
    expect(raw?.isReady()).toBe(true);
    const after = await harness.client.callTool({
      name: "list_strings",
      arguments: {},
    });
    expect(after.isError).not.toBe(true);
    await vi.waitFor(() =>
      expect(
        launcher.requests.filter((method) => method === "list_strings"),
      ).toHaveLength(2),
    );
    expect(
      launcher.requests.filter((method) => method === "search_strings"),
    ).toHaveLength(0);
    expect(launcher.processes).toHaveLength(1);
    for (const token of launcher.tokens)
      expect(JSON.stringify(refused).includes(token)).toBe(false);
  } finally {
    await harness.close();
    for (const root of launcher.runtimeRoots)
      await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
    for (const child of launcher.processes)
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  }
}, 30_000);
