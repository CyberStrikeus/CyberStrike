import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseJsonc } from "jsonc-parser";

import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";
import { configureClientConfiguration } from "../../../src/application/SetupClientConfiguration.js";
import { systemSetupHost } from "../../../src/application/SetupHost.js";
import { MANAGED_SKILL_FILES } from "../../../src/application/SetupSkill.js";
import { supportedClients } from "../../../src/application/SupportedClients.js";
import { systemUninstallHost } from "../../../src/application/Uninstall.js";
import { PRODUCT_IDENTITY } from "../../../src/identity.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { clearClientLocationEnvironment } from "../../fixtures/clientEnvironment.js";

const command = currentClientRegistrationCommand();

beforeEach(clearClientLocationEnvironment);
afterEach(() => vi.unstubAllEnvs());

const qwenPath = (
  home: string,
  platform: NodeJS.Platform,
  env: Parameters<typeof supportedClients>[2] = {},
) =>
  supportedClients(home, platform, env).find(
    ({ name }) => name === "qwen_code",
  );

describe("Qwen Code configuration paths", () => {
  it("resolves the user settings file and marker directory", () => {
    expect(qwenPath("/home/a", "linux")).toEqual({
      name: "qwen_code",
      displayName: "Qwen Code",
      configPath: join("/home/a", ".qwen", "settings.json"),
      markerPath: join("/home/a", ".qwen"),
      format: "json",
    });
    expect(qwenPath("/Users/a", "darwin")?.configPath).toBe(
      join("/Users/a", ".qwen", "settings.json"),
    );
  });

  it.each([
    ["", join("/home/a", ".qwen")],
    ["~", "/home/a"],
    ["~/profiles/work", join("/home/a", "profiles", "work")],
    ["~\\profiles\\work", join("/home/a", "profiles", "work")],
    ["profiles/work", resolve("profiles/work")],
    [" profile ", resolve(" profile ")],
    ["$PROFILE", resolve("$PROFILE")],
  ])("matches Qwen's QWEN_HOME resolution for %j", (override, directory) => {
    vi.stubEnv("QWEN_HOME", override);
    const client = qwenPath("/home/a", process.platform, {
      QWEN_HOME: override,
    });
    expect(
      supportedClients("/home/a").find(({ name }) => name === "qwen_code"),
    ).toEqual(client);
    expect(client).toMatchObject({
      configPath: join(directory, "settings.json"),
      markerPath: directory,
    });
  });
});

describe("Qwen Code client lifecycle", () => {
  const qwenClient = async () => {
    const home = await createTestTempDirectory("rea-qwen-");
    const client = qwenPath(home, process.platform, {});
    if (client?.markerPath === undefined)
      throw new Error("missing Qwen Code client");
    await mkdir(client.markerPath, { recursive: true });
    return { home, client };
  };

  it("registers rea in mcpServers while preserving unrelated settings and comments", async () => {
    const { home, client } = await qwenClient();
    await writeFile(
      client.configPath,
      `{
  // Keep this note.
  "model": { "name": "qwen3-coder-plus" },
  "mcpServers": { "other": { "command": "other-server" } }
}
`,
    );
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("// Keep this note.");
    expect(parseJsonc(text)).toEqual({
      model: { name: "qwen3-coder-plus" },
      mcpServers: {
        other: { command: "other-server" },
        rea: { command: command[0], args: command.slice(1) },
      },
    });
    expect(await configureClientConfiguration(client, {}, command)).toEqual({
      status: "unchanged",
    });
    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    const removedText = await readFile(client.configPath, "utf8");
    const removed = parseJsonc(removedText);
    expect(removed).toEqual({
      model: { name: "qwen3-coder-plus" },
      mcpServers: { other: { command: "other-server" } },
    });
    expect(removedText).toContain("// Keep this note.");
  });

  it("reports the selected installation as aligned", async () => {
    const { home, client } = await qwenClient();
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const entry = command[1];
    const status = (
      await readClientRegistrationStatuses(home, entry, { environment: {} })
    ).find(({ client: name }) => name === "qwen_code");
    expect(status).toMatchObject({ state: "aligned" });
  });
});

describe("Qwen Code profile setup", () => {
  it.each([false, true])(
    "installs and removes the shared skill with a custom home: %s",
    async (customHome) => {
      const home = await createTestTempDirectory("rea-qwen-profile-");
      const profile = join(home, customHome ? "qwen-profile" : ".qwen");
      const environment = {
        HOME: home,
        USERPROFILE: home,
        ...(customHome ? { QWEN_HOME: profile } : {}),
      };
      await mkdir(profile);
      const setup = systemSetupHost(undefined, environment);
      const client = (await setup.detectedClients()).find(
        ({ name }) => name === "qwen_code",
      );
      if (client === undefined) throw new Error("missing Qwen Code client");
      expect(client.configPath).toBe(join(profile, "settings.json"));
      expect(await setup.configureClient(client, {}, command)).toEqual({
        status: "configured",
      });
      expect(await setup.installSkill([client.name])).toEqual({
        ok: true,
        value: "installed",
      });
      const skill = join(home, ".agents", "skills", PRODUCT_IDENTITY.skillName);
      await writeFile(join(skill, "user-notes.txt"), "user-authored");
      expect(await readFile(join(skill, "SKILL.md"), "utf8")).toContain(
        "reverse-engineer-anything",
      );
      expect(await setup.clientNeedsConfigure(client, {}, command)).toBe(false);
      expect(await setup.skillNeedsInstall([client.name])).toBe(false);
      expect(await setup.installSkill([client.name])).toEqual({
        ok: true,
        value: "unchanged",
      });
      expect(
        (
          await readClientRegistrationStatuses(home, command[1], {
            environment,
          })
        ).find(({ client: name }) => name === "qwen_code"),
      ).toMatchObject({ state: "aligned" });
      const uninstall = systemUninstallHost(home, undefined, environment);
      const registered = (await uninstall.clients()).find(
        ({ name }) => name === "qwen_code",
      );
      expect(registered).toEqual(client);
      expect((await uninstall.removeClient(client)).status).toBe("removed");
      expect((await uninstall.removeSkill()).status).toBe("removed");
      for (const relativePath of MANAGED_SKILL_FILES)
        await expect(access(join(skill, relativePath))).rejects.toMatchObject({
          code: "ENOENT",
        });
      expect(await readFile(join(skill, "user-notes.txt"), "utf8")).toBe(
        "user-authored",
      );
      if (customHome)
        await expect(access(join(home, ".qwen"))).rejects.toMatchObject({
          code: "ENOENT",
        });
    },
  );
});
