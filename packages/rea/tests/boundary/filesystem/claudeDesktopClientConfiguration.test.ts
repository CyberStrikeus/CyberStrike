import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLAUDE_DESKTOP_PACKAGE_FAMILY } from "../../../src/application/ClaudeDesktopConfigLocation.js";
import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";

import {
  configureClientConfiguration,
  inspectClientConfiguration,
} from "../../../src/application/SetupClientConfiguration.js";
import { detectClients } from "../../../src/application/SetupHost.js";
import { failedConfigurationMessage } from "../../../src/application/SetupClients.js";
import {
  supportedClients,
  type SetupClient,
} from "../../../src/application/SupportedClients.js";
import {
  runUninstall,
  systemUninstallHost,
} from "../../../src/application/Uninstall.js";
import { clearClientLocationEnvironment } from "../../fixtures/clientEnvironment.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

/** The Windows registration setup writes, independent of the test host. */
const command = currentClientRegistrationCommand({ platform: "win32" });
const CONFIG = "claude_desktop_config.json";

beforeEach(clearClientLocationEnvironment);
afterEach(() => vi.unstubAllEnvs());

/** A Windows profile with separate roaming and local AppData roots. */
const windowsProfile = async () => {
  const home = await createTestTempDirectory("rea-claude-desktop-");
  const env = {
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
  };
  const appDataConfig = join(env.APPDATA, "Claude", CONFIG);
  const container = join(
    env.LOCALAPPDATA,
    "Packages",
    CLAUDE_DESKTOP_PACKAGE_FAMILY,
  );
  const privateConfig = join(
    container,
    "LocalCache",
    "Roaming",
    "Claude",
    CONFIG,
  );
  return { home, env, appDataConfig, container, privateConfig };
};

const claudeDesktop = (
  home: string,
  env: Readonly<Record<string, string>>,
): SetupClient => {
  const client = supportedClients(home, "win32", env).find(
    ({ name }) => name === "claude_desktop",
  );
  if (client === undefined) throw new Error("claude_desktop is not supported");
  return client;
};

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

const reaEntry = { command: command[0], args: command.slice(1) };

describe("Windows Claude Desktop configuration location", () => {
  it("uses AppData when no MSIX package storage exists", async () => {
    const { home, env, appDataConfig } = await windowsProfile();
    await mkdir(
      join(env.LOCALAPPDATA, "Packages", "Contoso.App_8wekyb3d8bbwe"),
      {
        recursive: true,
      },
    );

    const client = claudeDesktop(home, env);

    expect(client.configPath).toBe(appDataConfig);
    expect(client.markerPath).toBe(dirname(appDataConfig));
    expect(client.msixPackage).toBeUndefined();
    expect(client.quitBeforeSetup).toBe(true);
  });

  it("uses the package-private copy that the MSIX package reads", async () => {
    const { home, env, appDataConfig, container, privateConfig } =
      await windowsProfile();
    await writeJson(privateConfig, { preferences: { theme: "dark" } });
    await writeJson(appDataConfig, { mcpServers: {} });

    const client = claudeDesktop(home, env);

    expect(client.configPath).toBe(privateConfig);
    expect(client.markerPath).toBe(container);
    expect(client.msixPackage).toEqual({
      packageFamilyName: CLAUDE_DESKTOP_PACKAGE_FAMILY,
      privateConfigPath: privateConfig,
      appDataConfigPath: appDataConfig,
      virtualizedRoots: [env.APPDATA, env.LOCALAPPDATA],
      processView: "direct",
    });
    expect(
      (await detectClients(home, "win32", env)).map(({ name }) => name),
    ).toContain("claude_desktop");
  });

  it("uses AppData but refuses to write while the package keeps no private roaming file", async () => {
    const { home, env, appDataConfig, container, privateConfig } =
      await windowsProfile();
    await mkdir(join(container, "LocalCache", "Roaming"), { recursive: true });
    await writeJson(appDataConfig, { preferences: {} });

    const client = claudeDesktop(home, env);

    expect(client.configPath).toBe(appDataConfig);
    expect(client.msixPackage).toMatchObject({
      privateConfigPath: privateConfig,
      processView: "unknown",
    });
    // No private file shows whether the running package started this process.
    const inspection = await inspectClientConfiguration(client, {}, command);
    expect(inspection.status).toBe("invalid");
    expect(inspection.status === "invalid" && inspection.remediation).toContain(
      `Add REA's entry to ${appDataConfig} by hand while Claude Desktop is fully quit`,
    );
  });

  it("creates the private copy when the MSIX package has no configuration", async () => {
    const { home, env, privateConfig } = await windowsProfile();
    await writeJson(join(dirname(privateConfig), "Local State"), {});

    const client = claudeDesktop(home, env);
    expect(client.configPath).toBe(privateConfig);
    expect(client.msixPackage?.processView).toBe("direct");
    await expect(
      inspectClientConfiguration(client, {}, command),
    ).resolves.toEqual({ status: "create" });
    await expect(
      configureClientConfiguration(client, {}, command),
    ).resolves.toEqual({ status: "configured" });
    expect(await readJson(privateConfig)).toEqual({
      mcpServers: { rea: reaEntry },
    });
  });

  it.each([
    "Claude_abcdefghjkmnp",
    "AnthropicPBC.Claude_fnn82j28hfe8t",
    "ANTHROPICPBC.CLAUDE_FNN82J28HFE8T",
  ])(
    "reports unresolved package %s consistently across the registration lifecycle",
    async (family) => {
      const { home, env, appDataConfig } = await windowsProfile();
      const foreign = join(env.LOCALAPPDATA, "Packages", family);
      await mkdir(foreign, { recursive: true });
      const appDataOriginal = { mcpServers: { rea: reaEntry } };
      const deploymentConfig = join(env.LOCALAPPDATA, "Claude-3p", CONFIG);
      const deploymentOriginal = {
        deploymentMode: "3p",
        mcpServers: { other: { command: "other" } },
      };
      await writeJson(appDataConfig, appDataOriginal);
      await writeJson(deploymentConfig, deploymentOriginal);

      const client = claudeDesktop(home, env);

      expect(client.configPath).toBe(foreign);
      expect(client.configPathError).toContain(
        "unrecognized Claude Desktop package identity or deployment",
      );
      expect(client.configPathError).toContain(CLAUDE_DESKTOP_PACKAGE_FAMILY);
      expect(
        (await detectClients(home, "win32", env)).map(({ name }) => name),
      ).not.toContain("claude_desktop");
      const status = (
        await readClientRegistrationStatuses(home, command[1], {
          platform: "win32",
          environment: env,
        })
      ).find(({ client: name }) => name === "claude_desktop");
      expect(status).toMatchObject({ state: "invalid", config_path: foreign });
      await expect(
        inspectClientConfiguration(client, {}, command),
      ).resolves.toMatchObject({ status: "invalid" });
      await expect(
        configureClientConfiguration(client, {}, command),
      ).resolves.toEqual({ status: "failed", reason: "path" });
      const uninstall = await runUninstall(
        false,
        systemUninstallHost(home, undefined, env, "win32"),
      );
      expect(uninstall.status).toBe("failed");
      expect(uninstall.items).toContainEqual(
        expect.objectContaining({ name: "claude_desktop", status: "failed" }),
      );
      expect(await readJson(appDataConfig)).toEqual(appDataOriginal);
      expect(await readJson(deploymentConfig)).toEqual(deploymentOriginal);
      expect(await readdir(dirname(appDataConfig))).toEqual([CONFIG]);
      expect(await readdir(dirname(deploymentConfig))).toEqual([CONFIG]);
    },
  );
});

describe("Claude Desktop MSIX process view without its own private folder (#4278)", () => {
  it("decides the process view from another private roaming folder when Claude Desktop keeps none", async () => {
    const { home, env, appDataConfig, container } = await windowsProfile();
    // The app writes the real %APPDATA%\Claude; the package redirected other roaming writes.
    await writeJson(
      join(container, "LocalCache", "Roaming", "turborepo", "telemetry.json"),
      {},
    );
    await writeJson(appDataConfig, { preferences: {} });

    const client = claudeDesktop(home, env);

    expect(client.configPath).toBe(appDataConfig);
    expect(client.msixPackage).toMatchObject({ processView: "direct" });
    await expect(
      configureClientConfiguration(client, {}, command),
    ).resolves.toMatchObject({ status: "configured" });
    expect(await readJson(appDataConfig)).toMatchObject({
      preferences: {},
      mcpServers: { rea: reaEntry },
    });
  });

  it("refuses to write when another private roaming folder shows a redirected view", async () => {
    const { home, env, appDataConfig, container } = await windowsProfile();
    const privateFolder = join(container, "LocalCache", "Roaming", "turborepo");
    await writeJson(join(privateFolder, "telemetry.json"), {});
    await writeJson(appDataConfig, { preferences: {} });
    // A process the package started sees that private folder at its AppData path.
    // A junction needs no symlink privilege on Windows; POSIX ignores the type.
    await symlink(privateFolder, join(env.APPDATA, "turborepo"), "junction");

    const client = claudeDesktop(home, env);

    expect(client.msixPackage).toMatchObject({ processView: "redirected" });
    const inspection = await inspectClientConfiguration(client, {}, command);
    expect(inspection.status).toBe("invalid");
    expect(await readJson(appDataConfig)).toEqual({ preferences: {} });
  });
});

it("preserves explicit AppData root whitespace throughout setup, doctor and uninstall", async () => {
  const { home, env, appDataConfig: otherConfig } = await windowsProfile();
  const selected = {
    APPDATA: `${env.APPDATA} `,
    LOCALAPPDATA: `${env.LOCALAPPDATA} `,
  };
  const appDataConfig = join(selected.APPDATA, "Claude", CONFIG);
  const privateConfig = join(
    selected.LOCALAPPDATA,
    "Packages",
    CLAUDE_DESKTOP_PACKAGE_FAMILY,
    "LocalCache",
    "Roaming",
    "Claude",
    CONFIG,
  );
  const original = { mcpServers: { other: { command: "other-server" } } };
  const otherOriginal = {
    mcpServers: { rea: reaEntry },
    preferences: { preserve: true },
  };
  await writeJson(otherConfig, otherOriginal);
  await writeJson(appDataConfig, original);
  let client = claudeDesktop(home, selected);
  expect(client.configPath).toBe(appDataConfig);
  await expect(
    configureClientConfiguration(client, {}, command),
  ).resolves.toEqual({
    status: "configured",
    backupPath: `${appDataConfig}.rea.backup`,
  });
  await writeJson(privateConfig, original);
  client = claudeDesktop(home, selected);
  expect(client.configPath).toBe(privateConfig);
  expect(client.msixPackage?.virtualizedRoots).toEqual([
    selected.APPDATA,
    selected.LOCALAPPDATA,
  ]);
  await expect(
    configureClientConfiguration(client, {}, command),
  ).resolves.toEqual({
    status: "configured",
    backupPath: `${privateConfig}.rea.backup`,
  });
  const status = (
    await readClientRegistrationStatuses(home, command[1], {
      platform: "win32",
      environment: selected,
    })
  ).find(({ client: name }) => name === "claude_desktop");
  expect(status).toMatchObject({
    state: "aligned",
    config_path: privateConfig,
  });
  const uninstall = await runUninstall(
    false,
    systemUninstallHost(home, undefined, selected, "win32"),
  );
  expect(uninstall.status).toBe("complete");
  expect(await readJson(appDataConfig)).toEqual(original);
  expect(await readJson(privateConfig)).toEqual(original);
  expect(await readJson(otherConfig)).toEqual(otherOriginal);
  expect(await readJson(`${appDataConfig}.rea.backup`)).toEqual(original);
  expect(await readJson(`${privateConfig}.rea.backup`)).toEqual(original);
});

describe("MSIX Claude Desktop registration lifecycle", () => {
  it("registers in the private copy and reports an AppData-only entry as missing", async () => {
    const { home, env, appDataConfig, privateConfig } = await windowsProfile();
    const privateOriginal = {
      coworkUserFilesPath: "C:\\Users\\a\\Claude",
      preferences: { menuBarEnabled: false },
      mcpServers: { other: { command: "other", args: ["serve"] } },
    };
    await writeJson(privateConfig, privateOriginal);
    // Earlier setups wrote AppData, which the package never reads.
    await writeJson(appDataConfig, { mcpServers: { rea: reaEntry } });
    const appDataOriginal = await readFile(appDataConfig, "utf8");
    const status = async () =>
      (
        await readClientRegistrationStatuses(home, command[1], {
          platform: "win32",
          environment: env,
        })
      ).find(({ client }) => client === "claude_desktop");

    expect(await status()).toMatchObject({
      state: "missing",
      config_path: privateConfig,
    });
    expect((await status())?.remediation).toContain(
      "Quit Claude Desktop fully",
    );

    const client = claudeDesktop(home, env);
    await expect(
      inspectClientConfiguration(client, {}, command),
    ).resolves.toEqual({
      status: "update",
      backupPath: `${privateConfig}.rea.backup`,
    });
    await expect(
      configureClientConfiguration(client, {}, command),
    ).resolves.toEqual({
      status: "configured",
      backupPath: `${privateConfig}.rea.backup`,
    });

    expect(await readJson(privateConfig)).toEqual({
      ...privateOriginal,
      mcpServers: {
        ...privateOriginal.mcpServers,
        rea: reaEntry,
      },
    });
    expect(await readJson(`${privateConfig}.rea.backup`)).toEqual(
      privateOriginal,
    );
    expect(await readFile(appDataConfig, "utf8")).toBe(appDataOriginal);
    expect(await status()).toMatchObject({
      state: "aligned",
      config_path: privateConfig,
    });
    await expect(
      configureClientConfiguration(client, {}, command),
    ).resolves.toEqual({ status: "unchanged" });
  });

  it("refuses to write from a process the running package started", async () => {
    const { home, env, privateConfig } = await windowsProfile();
    await writeJson(privateConfig, { preferences: {} });
    const resolved = claudeDesktop(home, env);
    if (resolved.msixPackage === undefined)
      throw new Error("expected MSIX package storage");
    // Only a packaged process sees AppData redirected; model that observation.
    const client: SetupClient = {
      ...resolved,
      msixPackage: { ...resolved.msixPackage, processView: "redirected" },
    };

    const inspection = await inspectClientConfiguration(client, {}, command);

    expect(inspection.status).toBe("invalid");
    expect(inspection.status === "invalid" && inspection.remediation).toContain(
      "Quit Claude Desktop fully, then rerun setup from a terminal that Claude Desktop did not start",
    );
    expect(await readJson(privateConfig)).toEqual({ preferences: {} });

    await configureClientConfiguration(resolved, {}, command);
    await expect(
      inspectClientConfiguration(client, {}, command),
    ).resolves.toEqual({ status: "already_current" });
  });

  it("refuses a write once the package reads a newer private copy", async () => {
    const { home, env, appDataConfig, privateConfig } = await windowsProfile();
    await writeJson(join(dirname(privateConfig), "Preferences"), {});
    await writeJson(appDataConfig, { preferences: {} });
    const client = claudeDesktop(home, env);
    expect(client.configPath).toBe(appDataConfig);
    // Quitting the app after the plan was shown can save its private copy.
    await writeJson(privateConfig, { preferences: {} });

    await expect(
      configureClientConfiguration(client, {}, command),
    ).resolves.toEqual({ status: "failed", reason: "target_changed" });
    expect(await readJson(appDataConfig)).toEqual({ preferences: {} });
    expect(await readJson(privateConfig)).toEqual({ preferences: {} });
  });

  it("registers in AppData while the package has no private copy", async () => {
    const { home, env, appDataConfig, privateConfig } = await windowsProfile();
    await writeJson(join(dirname(privateConfig), "Preferences"), {});
    await writeJson(appDataConfig, { preferences: { theme: "light" } });

    const client = claudeDesktop(home, env);
    expect(client.configPath).toBe(appDataConfig);
    expect(client.msixPackage?.processView).toBe("direct");
    await expect(
      configureClientConfiguration(client, {}, command),
    ).resolves.toMatchObject({ status: "configured" });

    expect(await readJson(appDataConfig)).toEqual({
      preferences: { theme: "light" },
      mcpServers: { rea: reaEntry },
    });
    await expect(access(privateConfig)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "keeps an inaccessible private-copy recheck unknown and blocks backup and write",
    async () => {
      const { home, env, appDataConfig, privateConfig } =
        await windowsProfile();
      const privateDirectory = dirname(privateConfig);
      await writeJson(join(privateDirectory, "Preferences"), {});
      await writeJson(appDataConfig, { preferences: { theme: "light" } });
      const original = await readFile(appDataConfig);
      const client = claudeDesktop(home, env);
      expect(client.configPath).toBe(appDataConfig);
      expect(client.msixPackage?.processView).toBe("direct");
      expect(
        await inspectClientConfiguration(client, {}, command),
      ).toMatchObject({ status: "update" });
      const mode = (await stat(privateDirectory)).mode & 0o777;
      await chmod(privateDirectory, 0);
      try {
        const result = await configureClientConfiguration(client, {}, command);
        expect(result).toMatchObject({
          status: "failed",
          reason: "target_unavailable",
          failure: {
            kind: "inspect",
            path: privateConfig,
            detail: expect.stringContaining("EACCES"),
          },
        });
        if (result.status !== "failed")
          throw new Error("Expected a blocked update");
        expect(failedConfigurationMessage(result)).toContain(privateConfig);
        expect(failedConfigurationMessage(result)).toContain("Repair access");
        expect(Buffer.compare(await readFile(appDataConfig), original)).toBe(0);
        expect(await readdir(dirname(appDataConfig))).toEqual([CONFIG]);
      } finally {
        await chmod(privateDirectory, mode);
      }
    },
  );
});

describe("MSIX Claude Desktop uninstall", () => {
  it("refuses uninstall when the package view is unknown", async () => {
    const { home, env, appDataConfig, container, privateConfig } =
      await windowsProfile();
    await mkdir(container, { recursive: true });
    await writeJson(appDataConfig, { mcpServers: { rea: reaEntry } });

    const result = await runUninstall(
      false,
      systemUninstallHost(home, undefined, env, "win32"),
    );

    expect(result.status).toBe("failed");
    expect(result.items).toContainEqual(
      expect.objectContaining({
        name: "claude_desktop",
        status: "failed",
        detail: expect.stringContaining(
          `Remove REA's entry by hand from each of ${privateConfig} and ${appDataConfig} that has one`,
        ),
      }),
    );
    expect(await readJson(appDataConfig)).toEqual({
      mcpServers: { rea: reaEntry },
    });
  });

  it("retains an unrelated rea-named entry when the package view is unknown", async () => {
    const { home, env, appDataConfig, container } = await windowsProfile();
    await mkdir(container, { recursive: true });
    const unrelated = { mcpServers: { rea: { command: "unrelated-server" } } };
    await writeJson(appDataConfig, unrelated);
    const result = await runUninstall(
      false,
      systemUninstallHost(home, undefined, env, "win32"),
    );
    expect(result.status).toBe("complete");
    expect(await readJson(appDataConfig)).toEqual(unrelated);
  });

  it("removes REA from both the private copy and AppData on uninstall", async () => {
    const { home, env, appDataConfig, privateConfig } = await windowsProfile();
    await writeJson(privateConfig, {
      preferences: {},
      mcpServers: { other: { command: "other" }, rea: reaEntry },
    });
    await writeJson(appDataConfig, { mcpServers: { rea: reaEntry } });

    const result = await runUninstall(
      false,
      systemUninstallHost(home, undefined, env, "win32"),
    );

    expect(result.status).toBe("complete");
    expect(await readJson(privateConfig)).toEqual({
      preferences: {},
      mcpServers: { other: { command: "other" } },
    });
    expect(await readJson(appDataConfig)).toEqual({ mcpServers: {} });
  });
});
