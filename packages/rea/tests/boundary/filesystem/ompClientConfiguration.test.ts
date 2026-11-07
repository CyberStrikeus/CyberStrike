import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseJsonc } from "jsonc-parser";

import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";
import { configureClientConfiguration } from "../../../src/application/SetupClientConfiguration.js";
import { supportedClients } from "../../../src/application/SupportedClients.js";
import { systemUninstallHost } from "../../../src/application/Uninstall.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { clearClientLocationEnvironment } from "../../fixtures/clientEnvironment.js";

const command = currentClientRegistrationCommand();

beforeEach(clearClientLocationEnvironment);
afterEach(() => vi.unstubAllEnvs());

const ompPath = (env: Parameters<typeof supportedClients>[2]) =>
  supportedClients("/home/a", "linux", env).find(({ name }) => name === "omp");

describe("OMP configuration paths", () => {
  it("uses the default agent directory and OMP's environment overrides", () => {
    expect(ompPath({})).toEqual({
      name: "omp",
      displayName: "OMP",
      configPath: "/home/a/.omp/agent/mcp.json",
      markerPath: "/home/a/.omp/agent",
      format: "omp",
    });
    // OMP joins PI_CONFIG_DIR to the home directory.
    expect(ompPath({ PI_CONFIG_DIR: ".pi" })?.configPath).toBe(
      "/home/a/.pi/agent/mcp.json",
    );
    expect(ompPath({ PI_CODING_AGENT_DIR: "/custom/agent" })?.configPath).toBe(
      "/custom/agent/mcp.json",
    );
    // Match OMP by resolving the override against the caller working directory.
    expect(ompPath({ PI_CODING_AGENT_DIR: "agent" })?.configPath).toBe(
      resolve("agent", "mcp.json"),
    );
  });

  it("follows the active named profile like OMP", () => {
    expect(
      ompPath({ OMP_PROFILE: "work", PI_CODING_AGENT_DIR: "/custom/agent" })
        ?.configPath,
    ).toBe("/home/a/.omp/profiles/work/agent/mcp.json");
    expect(ompPath({ PI_PROFILE: "legacy" })?.configPath).toBe(
      "/home/a/.omp/profiles/legacy/agent/mcp.json",
    );
    // An explicitly empty OMP_PROFILE selects the default over PI_PROFILE.
    expect(ompPath({ OMP_PROFILE: "", PI_PROFILE: "legacy" })?.configPath).toBe(
      "/home/a/.omp/agent/mcp.json",
    );
    for (const profile of ["default", " "])
      expect(ompPath({ OMP_PROFILE: profile })?.configPath).toBe(
        "/home/a/.omp/agent/mcp.json",
      );
  });
});

describe("OMP disabledServers denylist", () => {
  const ompClient = async () => {
    const home = await createTestTempDirectory("rea-omp-");
    const client = supportedClients(home, process.platform, {}).find(
      ({ name }) => name === "omp",
    );
    if (client?.markerPath === undefined) throw new Error("missing OMP client");
    await mkdir(client.markerPath, { recursive: true });
    return { home, client };
  };

  it("removes rea from disabledServers while keeping other names and comments", async () => {
    const { home, client } = await ompClient();
    await writeFile(
      client.configPath,
      `{
  // Keep this note.
  "mcpServers": { "other": { "command": "other-server" } },
  "disabledServers": ["other", "rea"]
}
`,
    );
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("// Keep this note.");
    expect(parseJsonc(text)).toEqual({
      mcpServers: {
        other: { command: "other-server" },
        rea: { type: "stdio", command: command[0], args: command.slice(1) },
      },
      disabledServers: ["other"],
    });
    expect(await configureClientConfiguration(client, {}, command)).toEqual({
      status: "unchanged",
    });
    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    expect(parseJsonc(await readFile(client.configPath, "utf8"))).toEqual({
      mcpServers: { other: { command: "other-server" } },
      disabledServers: ["other"],
    });
  });

  it("reports a registration hidden by disabledServers as stale", async () => {
    const { home, client } = await ompClient();
    const entry = command[1];
    const registration = {
      command: process.execPath,
      args: [entry, "mcp"],
    };
    await writeFile(
      client.configPath,
      JSON.stringify({
        mcpServers: { rea: registration },
        disabledServers: ["rea"],
      }),
    );
    const status = async () =>
      (
        await readClientRegistrationStatuses(home, entry, { environment: {} })
      ).find(({ client: name }) => name === "omp");
    expect(await status()).toMatchObject({ state: "stale" });
    // The enabledServers allowlist forces an `enabled: false` entry on, but
    // the disabledServers denylist still wins over it.
    const disabledEntry = { ...registration, enabled: false };
    await writeFile(
      client.configPath,
      JSON.stringify({ mcpServers: { rea: disabledEntry } }),
    );
    expect(await status()).toMatchObject({ state: "stale" });
    await writeFile(
      client.configPath,
      JSON.stringify({
        mcpServers: { rea: disabledEntry },
        enabledServers: ["rea"],
      }),
    );
    expect(await status()).toMatchObject({ state: "aligned" });
    await writeFile(
      client.configPath,
      JSON.stringify({
        mcpServers: { rea: disabledEntry },
        enabledServers: ["rea"],
        disabledServers: ["rea"],
      }),
    );
    expect(await status()).toMatchObject({ state: "stale" });
    // OMP infers stdio for a command entry without an explicit type.
    await writeFile(
      client.configPath,
      JSON.stringify({ mcpServers: { rea: registration } }),
    );
    expect(await status()).toMatchObject({ state: "aligned" });
    await writeFile(
      client.configPath,
      JSON.stringify({
        mcpServers: { rea: { ...registration, type: "http" } },
      }),
    );
    expect(await status()).toMatchObject({ state: "invalid" });
    expect(join(home, ".omp", "agent", "mcp.json")).toBe(client.configPath);
  });
});
