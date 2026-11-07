import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";
import { ClientConfigurationPublication } from "../../../src/application/ClientConfigurationPublication.js";

import { configureClientConfiguration } from "../../../src/application/SetupClientConfiguration.js";
import { detectClients } from "../../../src/application/SetupHost.js";
import { skillDestinations } from "../../../src/application/SetupSkill.js";
import {
  clientEvidencePaths,
  clientOwnershipEvidencePaths,
  supportedClients,
} from "../../../src/application/SupportedClients.js";
import {
  runUninstall,
  systemUninstallHost,
  type UninstallFileSystem,
} from "../../../src/application/Uninstall.js";
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

const freebuffPath = (
  home: string,
  platform: NodeJS.Platform = "linux",
  env: Parameters<typeof supportedClients>[2] = {},
) =>
  supportedClients(home, platform, env).find(({ name }) => name === "freebuff");

describe("FreeBuff configuration paths", () => {
  it("resolves the shared user agents file and the profile marker directory", () => {
    expect(freebuffPath("/home/a")).toEqual({
      name: "freebuff",
      displayName: "FreeBuff",
      configPath: join("/home/a", ".agents", "mcp.json"),
      markerPath: join("/home/a", ".config", "freebuff-desktop"),
      discoveryPaths: [join("/home/a", ".config", "freebuff-desktop")],
      sharedRegistration: true,
      format: "json",
    });
    expect(freebuffPath("/Users/a", "darwin")?.markerPath).toBe(
      join("/Users/a", ".config", "freebuff-desktop"),
    );
    expect(freebuffPath("C:\\Users\\a", "win32")?.markerPath).toBe(
      join("C:\\Users\\a", ".config", "freebuff-desktop"),
    );
  });

  it("stays undetected when only the shared agents skill directory exists", async () => {
    const home = await createTestTempDirectory("rea-freebuff-shared-");
    // REA's own skill installs create this directory for every client.
    await mkdir(join(home, ".agents", "skills"), { recursive: true });
    await writeFile(
      join(home, ".agents", "mcp.json"),
      '{"mcpServers":{"other":{"command":"other-server"}}}',
    );
    expect((await detectClients(home)).map(({ name }) => name)).not.toContain(
      "freebuff",
    );
    expect(
      (
        await readClientRegistrationStatuses(home, undefined, {
          platform: process.platform,
          environment: {},
        })
      ).map(({ client }) => client),
    ).not.toContain("freebuff");

    await mkdir(join(home, ".config", "freebuff-desktop"), {
      recursive: true,
    });
    expect((await detectClients(home)).map(({ name }) => name)).toContain(
      "freebuff",
    );
  });

  it.skipIf(process.platform === "win32")(
    "ignores dangling profile links while preserving explicit and ownership reads",
    async () => {
      const home = await createTestTempDirectory("rea-freebuff-profile-link-");
      const profile = join(home, ".config", "freebuff-desktop");
      await mkdir(dirname(profile), { recursive: true });
      await symlink(join(home, "removed-profile"), profile, "dir");
      const statuses = (options = {}) =>
        readClientRegistrationStatuses(home, undefined, {
          environment: {},
          ...options,
        });
      expect((await detectClients(home)).map(({ name }) => name)).not.toContain(
        "freebuff",
      );
      expect((await statuses()).map(({ client }) => client)).not.toContain(
        "freebuff",
      );
      expect(
        await statuses({ selectedClientIds: ["freebuff"] }),
      ).toContainEqual(
        expect.objectContaining({ client: "freebuff", state: "missing" }),
      );
      const shared = join(home, ".agents", "mcp.json");
      await mkdir(dirname(shared), { recursive: true });
      await symlink(join(home, "removed-registration"), shared);
      expect(await statuses({ evidence: "ownership" })).toContainEqual(
        expect.objectContaining({ client: "freebuff", state: "missing" }),
      );
      await mkdir(join(home, "removed-profile"));
      expect(await statuses()).toContainEqual(
        expect.objectContaining({ client: "freebuff", state: "missing" }),
      );
    },
  );

  it("keeps shared registration storage out of applicability evidence", () => {
    for (const client of supportedClients("/home/a", "linux", {})) {
      if (client.sharedRegistration !== true) continue;
      expect(clientEvidencePaths(client)).not.toContain(client.configPath);
      expect(clientOwnershipEvidencePaths(client)).toContain(client.configPath);
    }
  });

  it("shares the user-scope file ZCode loads as its fallback", () => {
    const clients = supportedClients("/home/a", "linux", {});
    const freebuff = clients.find(({ name }) => name === "freebuff");
    const zcode = clients.find(({ name }) => name === "zcode");
    expect(freebuff?.configPath).toBe(zcode?.zcodeFallbackPath);
  });

  it("resolves the personal skills directory FreeBuff discovers", () => {
    expect(skillDestinations("/home/a", ["freebuff"])).toEqual([
      {
        client: "shared",
        path: join("/home/a", ".agents", "skills", "reverse-engineer-anything"),
      },
    ]);
  });
});

describe("FreeBuff JSON registration", () => {
  const freebuffClient = async () => {
    const home = await createTestTempDirectory("rea-freebuff-");
    const client = freebuffPath(home, process.platform);
    if (client === undefined) throw new Error("missing FreeBuff client");
    await mkdir(dirname(client.configPath), { recursive: true });
    await mkdir(client.markerPath!, { recursive: true });
    return { home, client };
  };

  it("upserts rea into mcpServers while preserving unrelated settings", async () => {
    const { home, client } = await freebuffClient();
    await writeFile(
      client.configPath,
      `{
  "mcpServers": {
    "other": { "command": "other-server" }
  },
  "agents": { "discoverSkills": true }
}`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
    expect(parsed.mcpServers.other).toEqual({ command: "other-server" });
    expect(parsed.agents).toEqual({ discoverSkills: true });
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
      ).find(({ client }) => client === "freebuff"),
    ).toMatchObject({ state: "aligned", command });
  });

  it("preserves a shared-row enable:false while repairing FreeBuff", async () => {
    // The shared file doubles as ZCode's fallback: its `enable: false` binds
    // every reader, so a FreeBuff repair must not silently re-enable the row
    // it does not own. Doctor reports the disabled row as stale for FreeBuff;
    // the repair rewrites the registration but keeps the activation fact.
    const { client } = await freebuffClient();
    await writeFile(
      client.configPath,
      JSON.stringify(
        {
          mcpServers: {
            rea: { command: command[0], args: command.slice(1), enable: false },
          },
        },
        null,
        2,
      ),
    );
    expect(["configured", "unchanged"]).toContain(
      (await configureClientConfiguration(client, {}, command)).status,
    );
    const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
    expect(parsed.mcpServers.rea).toMatchObject({
      command: command[0],
      args: command.slice(1),
      enable: false,
    });
  });

  it("reports a preserved shared disable as a manual conflict, not a setup repair", async () => {
    // The shared row's `enable: false` survives repair, so a stale doctor
    // result must not point at an endlessly ineffective setup run: the
    // remediation names the manual conflict instead.
    const { home, client } = await freebuffClient();
    await writeFile(
      client.configPath,
      JSON.stringify(
        {
          mcpServers: {
            rea: { command: command[0], args: command.slice(1), enable: false },
          },
        },
        null,
        2,
      ),
    );
    const status = (
      await readClientRegistrationStatuses(home, undefined, {
        platform: process.platform,
        environment: {},
      })
    ).find(({ client }) => client === "freebuff");
    expect(status).toMatchObject({ state: "stale" });
    expect(status?.remediation).toEqual(
      expect.stringContaining("enable: false"),
    );
    expect(status?.remediation).toEqual(
      expect.stringContaining("will not change"),
    );
  });

  it("creates the mcpServers table in an existing file without servers", async () => {
    const { client } = await freebuffClient();
    await writeFile(
      client.configPath,
      JSON.stringify({ agents: { discoverSkills: true } }, null, 2),
    );
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
    expect(parsed.agents).toEqual({ discoverSkills: true });
    expect(parsed.mcpServers.rea).toEqual({
      command: command[0],
      args: command.slice(1),
    });
  });

  it("registers into an empty settings file", async () => {
    const { client } = await freebuffClient();
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
    const { home, client } = await freebuffClient();
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

describe("uninstall applicability for shared FreeBuff storage", () => {
  it("retains malformed shared settings without blocking unrelated REA removal", async () => {
    const home = await createTestTempDirectory("rea-freebuff-absent-");
    const client = freebuffPath(home, process.platform)!;
    await mkdir(dirname(client.configPath), { recursive: true });
    await writeFile(client.configPath, "{unrelated malformed shared data");
    const codex = supportedClients(home, process.platform, {}).find(
      ({ name }) => name === "codex",
    )!;
    await mkdir(dirname(codex.configPath), { recursive: true });
    await writeFile(codex.configPath, "");
    await configureClientConfiguration(codex, {}, command);
    await mkdir(join(home, ".rea", "cache"), { recursive: true });
    await writeFile(join(home, ".rea", "cache", "owned"), "owned");
    const result = await runUninstall(
      true,
      systemUninstallHost(home, undefined, {}),
    );
    expect(result.status).toBe("complete");
    expect(result.items.find(({ name }) => name === "freebuff")).toMatchObject({
      status: "retained",
    });
    expect(result.items.find(({ name }) => name === "codex")).toMatchObject({
      status: "removed",
    });
    expect(result.items.find(({ name }) => name === "cache")).toMatchObject({
      status: "removed",
    });
    expect(await readFile(client.configPath, "utf8")).toBe(
      "{unrelated malformed shared data",
    );
  });

  it("fails closed when a denied product profile leaves a client config unreadable", async () => {
    // ZCode reads product-local storage, so an unreadable profile directory
    // leaves an unknown registration state rather than an absent one.
    const home = await createTestTempDirectory("rea-zcode-denied-");
    const zcode = supportedClients(home, process.platform, {}).find(
      ({ name }) => name === "zcode",
    )!;
    await mkdir(dirname(zcode.configPath), { recursive: true });
    await writeFile(zcode.configPath, JSON.stringify({ mcpServers: {} }));
    await configureClientConfiguration(zcode, {}, command);
    const shared = join(home, ".agents", "mcp.json");
    await mkdir(dirname(shared), { recursive: true });
    await writeFile(shared, "{malformed shared data");
    const discovery = zcode.discoveryPaths![0];
    const denied = () => Object.assign(new Error("denied"), { code: "EACCES" });
    const fileSystem: UninstallFileSystem = {
      readText: (path) =>
        path === zcode.configPath
          ? Promise.reject(denied())
          : readFile(path, "utf8"),
      copy: (source, destination) =>
        copyFile(source, destination, fsConstants.COPYFILE_EXCL),
      publishConfiguration: (path, contents, original) =>
        ClientConfigurationPublication.write(path, contents, original),
      stat: (path) =>
        path === discovery ? Promise.reject(denied()) : lstat(path),
      remove: (path) => rm(path, { recursive: true }),
    };

    const result = await runUninstall(
      false,
      systemUninstallHost(home, fileSystem),
    );

    expect(result.status).toBe("failed");
    const zcodeItem = result.items.find(({ name }) => name === "zcode");
    expect(zcodeItem).toMatchObject({ status: "failed" });
    // The denied product-local read stays blocking, and the shared fallback
    // is now inspected fail-closed too, so its malformed data is reported
    // beside the denied read in the same collapsed item.
    expect(zcodeItem?.detail).toContain(
      "Configuration could not be read. Check file permissions, then rerun uninstall.",
    );
    expect(zcodeItem?.detail).toContain(
      "Configuration is not valid JSON and was not changed. Repair it, then rerun uninstall.",
    );
  });

  it("removes a recognizable owned shared row even without a FreeBuff profile", async () => {
    const home = await createTestTempDirectory("rea-freebuff-owned-row-");
    const client = freebuffPath(home, process.platform)!;
    await mkdir(dirname(client.configPath), { recursive: true });
    await writeFile(
      client.configPath,
      JSON.stringify({ mcpServers: { other: { command: "other-server" } } }),
    );
    await configureClientConfiguration(client, {}, command);
    const result = await runUninstall(
      false,
      systemUninstallHost(home, undefined, {}),
    );
    expect(result.status).toBe("complete");
    expect(result.items.find(({ name }) => name === "freebuff")).toMatchObject({
      status: "removed",
    });
    expect(
      JSON.parse(await readFile(client.configPath, "utf8")).mcpServers,
    ).toEqual({ other: { command: "other-server" } });
  });

  it("keeps an unresolved profile probe from softening shared failures", async () => {
    // A denied profile probe is not absence: when the shared file also
    // cannot be read, uninstall must block instead of treating applicability
    // as unproven and purging data while an installed FreeBuff may still hold
    // an active REA registration.
    const home = await createTestTempDirectory("rea-freebuff-denied-probe-");
    const client = freebuffPath(home, process.platform)!;
    const profile = client.discoveryPaths?.[0];
    if (profile === undefined)
      throw new Error("freebuff discovery path missing");
    await mkdir(profile, { recursive: true });
    await configureClientConfiguration(client, {}, command);
    const state = join(home, ".rea", "state.json");
    await mkdir(dirname(state), { recursive: true });
    await writeFile(state, "{}\n");
    const denied = () => Object.assign(new Error("denied"), { code: "EACCES" });
    const fileSystem: UninstallFileSystem = {
      readText: (path) =>
        path === client.configPath
          ? Promise.reject(denied())
          : readFile(path, "utf8"),
      copy: (source, destination) =>
        copyFile(source, destination, fsConstants.COPYFILE_EXCL),
      publishConfiguration: (path, contents, original) =>
        ClientConfigurationPublication.write(path, contents, original),
      stat: (path) =>
        path === profile ? Promise.reject(denied()) : lstat(path),
      remove: (path) => rm(path, { recursive: true }),
    };

    const result = await runUninstall(
      true,
      systemUninstallHost(home, fileSystem),
    );

    expect(result.status).toBe("failed");
    expect(result.items).toContainEqual(
      expect.objectContaining({ name: "freebuff", status: "failed" }),
    );
    expect(result.items).toContainEqual(
      expect.objectContaining({
        name: "uninstall",
        status: "skipped",
        detail: expect.stringContaining(
          "No REA registration, skill, or data was removed",
        ),
      }),
    );
    await expect(readFile(state, "utf8")).resolves.toBe("{}\n");
  });
});
