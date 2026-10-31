import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, win32 } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";

import { configureClientConfiguration } from "../../../src/application/SetupClientConfiguration.js";
import { skillDestinations } from "../../../src/application/SetupSkill.js";
import { supportedClients } from "../../../src/application/SupportedClients.js";
import { systemUninstallHost } from "../../../src/application/Uninstall.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { clearClientLocationEnvironment } from "../../fixtures/clientEnvironment.js";

/**
 * The registration command setup writes on the host running the tests. Windows
 * wraps it in `cmd.exe /d /c`, so the expected entry follows the host too.
 */
const command = currentClientRegistrationCommand({
  platform: process.platform,
});

beforeEach(clearClientLocationEnvironment);
afterEach(() => vi.unstubAllEnvs());

const traePath = (
  home: string,
  platform: NodeJS.Platform = "linux",
  env: Parameters<typeof supportedClients>[2] = {},
) => supportedClients(home, platform, env).find(({ name }) => name === "trae");

describe("Trae configuration paths", () => {
  it("resolves the VS Code-style user directory per platform", () => {
    expect(traePath("/home/a", "linux", {})?.configPath).toBe(
      join("/home/a", ".config", "Trae", "User", "mcp.json"),
    );
    expect(
      traePath("/home/a", "linux", { XDG_CONFIG_HOME: "/xdg" })?.configPath,
    ).toBe(join("/xdg", "Trae", "User", "mcp.json"));
    expect(traePath("/Users/a", "darwin")?.configPath).toBe(
      join(
        "/Users/a",
        "Library",
        "Application Support",
        "Trae",
        "User",
        "mcp.json",
      ),
    );
    expect(
      traePath("C:\\Users\\a", "win32", {
        APPDATA: "C:\\Users\\a\\AppData\\Roaming",
      })?.configPath,
    ).toBe(join("C:\\Users\\a\\AppData\\Roaming", "Trae", "User", "mcp.json"));
    expect(
      traePath("C:\\Users\\a", "win32", {
        APPDATA: "C:\\Users\\a\\AppData\\Roaming",
      })?.markerPath,
    ).toBe(join("C:\\Users\\a\\AppData\\Roaming", "Trae", "User"));
  });

  it("resolves the registration format as the plain mcpServers JSON dialect", () => {
    expect(traePath("/home/a")?.format).toBe("json");
  });

  it("resolves the personal skills directory under the home root", () => {
    expect(
      skillDestinations("/home/a", ["trae"]).map(({ path }) => path),
    ).toEqual([
      join("/home/a", ".trae", "skills", "reverse-engineer-anything"),
    ]);
    expect(
      skillDestinations("C:\\Users\\a", ["trae"], {}, "win32").map(
        ({ path }) => path,
      ),
    ).toEqual([
      win32.join(
        "C:\\Users\\a",
        ".trae",
        "skills",
        "reverse-engineer-anything",
      ),
    ]);
  });
});

describe("Trae JSON registration", () => {
  const traeClient = async () => {
    const home = await createTestTempDirectory("rea-trae-");
    const client = traePath(home, process.platform);
    if (client?.markerPath === undefined)
      throw new Error("missing Trae client");
    await mkdir(client.markerPath, { recursive: true });
    return { home, client };
  };

  it("upserts rea into mcpServers while preserving unrelated settings", async () => {
    const { home, client } = await traeClient();
    await writeFile(
      client.configPath,
      `{
  "mcpServers": {
    "other": { "command": "other-server" }
  }
}`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
    expect(parsed.mcpServers.other).toEqual({ command: "other-server" });
    expect(parsed.mcpServers.rea).toEqual({
      command: command[0],
      args: command.slice(1),
    });

    expect(await configureClientConfiguration(client, {}, command)).toEqual({
      status: "unchanged",
    });
    expect(
      (
        await readClientRegistrationStatuses(home, undefined, {
          platform: process.platform,
          environment: {},
        })
      ).find(({ client }) => client === "trae"),
    ).toMatchObject({ state: "aligned", command });
  });

  it("creates the mcpServers table in an existing mcp.json without servers", async () => {
    const { client } = await traeClient();
    await writeFile(
      client.configPath,
      JSON.stringify({ unrelated: { setting: true } }, null, 2),
    );
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
    expect(parsed.unrelated).toEqual({ setting: true });
    expect(parsed.mcpServers.rea).toEqual({
      command: command[0],
      args: command.slice(1),
    });
  });

  it("registers into an empty mcp.json", async () => {
    const { client } = await traeClient();
    await writeFile(client.configPath, "");
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
    expect(parsed.mcpServers.rea).toEqual({
      command: command[0],
      args: command.slice(1),
    });
  });

  it("removes only the rea entry on uninstall", async () => {
    const { home, client } = await traeClient();
    await writeFile(
      client.configPath,
      JSON.stringify(
        { mcpServers: { other: { command: "other-server" } } },
        null,
        2,
      ),
    );
    await configureClientConfiguration(client, {}, command);

    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
    expect(parsed.mcpServers.other).toEqual({ command: "other-server" });
    expect(parsed.mcpServers.rea).toBeUndefined();
  });
});
