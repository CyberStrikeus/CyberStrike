import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

const droidPath = (
  home: string,
  platform: NodeJS.Platform = "linux",
  env: Parameters<typeof supportedClients>[2] = {},
) => supportedClients(home, platform, env).find(({ name }) => name === "droid");

describe("Factory Droid configuration paths", () => {
  it("resolves the user MCP config file and marker directory", () => {
    expect(droidPath("/home/a")).toEqual({
      name: "droid",
      displayName: "Factory Droid",
      configPath: join("/home/a", ".factory", "mcp.json"),
      markerPath: join("/home/a", ".factory"),
      format: "json",
    });
    expect(droidPath("/Users/a", "darwin")?.configPath).toBe(
      join("/Users/a", ".factory", "mcp.json"),
    );
    expect(droidPath("C:\\Users\\a", "win32")?.configPath).toBe(
      join("C:\\Users\\a", ".factory", "mcp.json"),
    );
  });

  it("resolves the personal skills directory beside the config root", () => {
    expect(
      skillDestinations("/home/a", ["droid"]).map(({ path }) => path),
    ).toEqual([
      join("/home/a", ".factory", "skills", "reverse-engineer-anything"),
    ]);
  });

  it("uses Droid's selected home for configuration, discovery, and personal skills", () => {
    const environment = { FACTORY_HOME_OVERRIDE: "/selected/home" };
    expect(droidPath("/home/a", "darwin", environment)).toMatchObject({
      configPath: join("/selected/home", ".factory", "mcp.json"),
      markerPath: join("/selected/home", ".factory"),
    });
    expect(
      skillDestinations("/home/a", ["droid"], environment).map(
        ({ path }) => path,
      ),
    ).toEqual([
      join("/selected/home", ".factory", "skills", "reverse-engineer-anything"),
    ]);
    expect(
      droidPath("/home/a", "darwin", { FACTORY_HOME_OVERRIDE: "" }),
    ).toEqual(droidPath("/home/a", "darwin"));
  });
});

describe("Factory Droid JSON registration", () => {
  const droidClient = async () => {
    const home = await createTestTempDirectory("rea-droid-");
    const client = droidPath(home, process.platform);
    if (client?.markerPath === undefined)
      throw new Error("missing Factory Droid client");
    await mkdir(client.markerPath, { recursive: true });
    return { home, client };
  };

  it("upserts rea into mcpServers while preserving unrelated servers and permissions", async () => {
    const { home, client } = await droidClient();
    await writeFile(
      client.configPath,
      `{
  "mcpServers": {
    "other": {
      "type": "stdio",
      "command": "other",
      "args": [],
      "disabled": false
    }
  },
  "persistentPermissions": {
    "servers": {
      "other": { "approvedAt": "2026-01-01T00:00:00.000Z" }
    }
  }
}`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
    expect(parsed.mcpServers.other).toEqual({
      type: "stdio",
      command: "other",
      args: [],
      disabled: false,
    });
    expect(parsed.persistentPermissions).toEqual({
      servers: { other: { approvedAt: "2026-01-01T00:00:00.000Z" } },
    });
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
      ).find(({ client }) => client === "droid"),
    ).toMatchObject({ state: "aligned", command });
  });

  it("creates the mcpServers table in an existing config file without servers", async () => {
    const { client } = await droidClient();
    await writeFile(
      client.configPath,
      JSON.stringify({ persistentPermissions: { servers: {} } }, null, 2),
    );
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
    expect(parsed.persistentPermissions).toEqual({ servers: {} });
    expect(parsed.mcpServers.rea).toEqual({
      command: command[0],
      args: command.slice(1),
    });
  });

  it("registers into an empty config file", async () => {
    const { client } = await droidClient();
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
    const { home, client } = await droidClient();
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
