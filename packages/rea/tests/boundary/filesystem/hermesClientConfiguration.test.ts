import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { userInfo } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";

import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";

import {
  configureClientConfiguration,
  inspectClientConfiguration,
} from "../../../src/application/SetupClientConfiguration.js";
import {
  clientSkillDirectories,
  supportedClients,
} from "../../../src/application/SupportedClients.js";
import {
  runUninstall,
  systemUninstallHost,
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

const hermesPath = (
  env: Parameters<typeof supportedClients>[2],
  platform: NodeJS.Platform = "linux",
) =>
  supportedClients(join("/home/a"), platform, env).find(
    ({ name }) => name === "hermes",
  );

describe("Hermes configuration paths", () => {
  it.skipIf(process.platform === "win32")(
    "configures the filesystem-selected Hermes home through symlink parent traversal",
    async () => {
      const home = await createTestTempDirectory("rea-hermes-path-selection-");
      await mkdir(join(home, "physical", "child"), { recursive: true });
      await symlink(join(home, "physical", "child"), join(home, "alias"));
      const selected = `${home}/alias/..`;
      const original = "model: selected-home\n";
      const decoy = "model: lexical-parent\n";
      await writeFile(join(home, "physical", "config.yaml"), original);
      await writeFile(join(home, "config.yaml"), decoy);
      const environment = { HERMES_HOME: selected };
      const client = supportedClients(home, process.platform, environment).find(
        ({ name }) => name === "hermes",
      );
      if (client === undefined) throw new Error("missing Hermes client");
      expect(client.markerPath).toBe(selected);
      expect(client.configPath).toBe(`${selected}/config.yaml`);
      expect(
        clientSkillDirectories(home, ["hermes"], environment).directories,
      ).toEqual([{ client: "hermes", directory: `${selected}/skills` }]);
      expect(
        await configureClientConfiguration(client, {}, command),
      ).toMatchObject({
        status: "configured",
      });
      expect(
        await readFile(join(home, "physical", "config.yaml"), "utf8"),
      ).toContain("mcp_servers:");
      expect(
        await readFile(
          join(home, "physical", "config.yaml.rea.backup"),
          "utf8",
        ),
      ).toBe(original);
      expect(await readFile(join(home, "config.yaml"), "utf8")).toBe(decoy);
    },
  );

  it("resolves config.yaml under the platform Hermes home", () => {
    expect(hermesPath({})).toEqual({
      name: "hermes",
      displayName: "Hermes",
      configPath: join("/home/a", ".hermes", "config.yaml"),
      markerPath: join("/home/a", ".hermes"),
      format: "hermes",
    });
    // Windows uses the native data directory, matching Hermes's own resolver.
    expect(
      hermesPath({ LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, "win32")
        ?.configPath,
    ).toBe(join("C:\\Users\\a\\AppData\\Local", "hermes", "config.yaml"));
  });

  it("expands and trims Hermes overrides without changing the suffix", () => {
    expect(hermesPath({ HERMES_HOME: "  ~/profile  " })?.markerPath).toBe(
      join("/home/a", "profile"),
    );
    expect(
      hermesPath({
        HERMES_HOME: "${PROFILE_ROOT}/agent",
        PROFILE_ROOT: "/custom",
      })?.markerPath,
    ).toBe(join("/custom", "agent"));
    expect(
      hermesPath({
        HERMES_HOME: "$PROFILE_ROOT/agent",
        PROFILE_ROOT: "/custom",
      })?.markerPath,
    ).toBe(join("/custom", "agent"));
    expect(hermesPath({ LOCALAPPDATA: "  " }, "win32")?.markerPath).toBe(
      join("/home/a", "AppData", "Local", "hermes"),
    );
  });

  it.skipIf(process.platform === "win32")(
    "expands the named OS account independently of the selected home",
    () => {
      const account = userInfo();
      for (const suffix of ["", "/rea-owned-profile", "//rea-owned-profile"]) {
        expect(
          hermesPath({ HERMES_HOME: `~${account.username}${suffix}` })
            ?.markerPath,
        ).toBe(join(account.homedir, suffix));
      }
      expect(
        hermesPath({
          HERMES_HOME: "$PROFILE",
          PROFILE: `~${account.username}/rea-owned-profile`,
        })?.markerPath,
      ).toBe(join(account.homedir, "rea-owned-profile"));
    },
  );

  it.each(["linux", "win32"] as const)(
    "keeps an unresolved named home diagnostic without exposing a write destination on %s",
    (platform) => {
      const requested = `~${userInfo().username}-other/rea-profile`;
      expect(hermesPath({ HERMES_HOME: requested }, platform)).toMatchObject({
        configPath: requested,
        configPathError: expect.stringContaining("absolute HERMES_HOME"),
      });
      expect(
        hermesPath({ HERMES_HOME: requested }, platform),
      ).not.toHaveProperty("markerPath");
    },
  );

  it("honours HERMES_HOME and Hermes's data-directory suffix", () => {
    expect(
      hermesPath({ HERMES_HOME: join("/srv", "hermes") })?.configPath,
    ).toBe(join("/srv", "hermes", "config.yaml"));
    // A blank override falls through to the platform default.
    expect(hermesPath({ HERMES_HOME: "  " })?.configPath).toBe(
      join("/home/a", ".hermes", "config.yaml"),
    );
    // Hermes appends the suffix to the literal directory name.
    expect(hermesPath({ HERMES_DATA_DIR_SUFFIX: "-dev" })?.configPath).toBe(
      join("/home/a", ".hermes-dev", "config.yaml"),
    );
    expect(
      hermesPath(
        {
          HERMES_DATA_DIR_SUFFIX: "-dev",
          LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local",
        },
        "win32",
      )?.configPath,
    ).toBe(join("C:\\Users\\a\\AppData\\Local", "hermes-dev", "config.yaml"));
  });
});

describe("Hermes unresolved home identity", () => {
  it.skipIf(process.platform === "win32")(
    "keeps a new custom home reached through a native-home symlink outside native sticky selection",
    async () => {
      const home = await createTestTempDirectory("rea-hermes-new-alias-");
      const native = join(home, ".hermes");
      const profile = join(native, "profiles", "coder");
      const external = join(home, "external");
      await mkdir(profile, { recursive: true });
      await mkdir(external);
      await writeFile(join(profile, "config.yaml"), "model: native-profile\n");
      await writeFile(join(native, "active_profile"), "coder\n");
      await symlink(external, join(native, "alias"));
      const selected = join(native, "alias", "new-home");
      const environment = { HERMES_HOME: selected };
      const client = supportedClients(home, process.platform, environment).find(
        ({ name }) => name === "hermes",
      );
      if (client === undefined) throw new Error("missing Hermes client");
      expect(client.markerPath).toBe(selected);
      expect(
        clientSkillDirectories(home, ["hermes"], environment).directories,
      ).toEqual([{ client: "hermes", directory: join(selected, "skills") }]);
      expect(
        await configureClientConfiguration(client, {}, command),
      ).toMatchObject({
        status: "configured",
      });
      expect(
        await readFile(join(external, "new-home", "config.yaml"), "utf8"),
      ).toContain("mcp_servers:");
      expect(await readFile(join(profile, "config.yaml"), "utf8")).toBe(
        "model: native-profile\n",
      );
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps a dangling home alias unresolved instead of selecting a native profile",
    async () => {
      const home = await createTestTempDirectory("rea-hermes-dangling-home-");
      const native = join(home, ".hermes");
      const profile = join(native, "profiles", "coder");
      await mkdir(profile, { recursive: true });
      await writeFile(join(profile, "config.yaml"), "model: native-profile\n");
      await writeFile(join(native, "active_profile"), "coder\n");
      await symlink(join(home, "missing-external"), join(native, "alias"));
      const selected = join(native, "alias", "new-home");
      const environment = { HERMES_HOME: selected };
      const client = supportedClients(home, process.platform, environment).find(
        ({ name }) => name === "hermes",
      );
      expect(client).toMatchObject({
        configPath: selected,
        configPathError: expect.stringContaining("Cannot resolve"),
      });
      expect(client).not.toHaveProperty("markerPath");
      expect(
        clientSkillDirectories(home, ["hermes"], environment),
      ).toMatchObject({
        directories: [],
        unresolved: [{ client: "hermes", path: selected }],
      });
      expect(await readFile(join(profile, "config.yaml"), "utf8")).toBe(
        "model: native-profile\n",
      );
    },
  );
});

const hermesClient = async () => {
  const home = await createTestTempDirectory("rea-hermes-");
  const client = supportedClients(home, process.platform, {}).find(
    ({ name }) => name === "hermes",
  );
  if (client?.markerPath === undefined)
    throw new Error("missing Hermes client");
  await mkdir(client.markerPath, { recursive: true });
  return { home, client };
};

describe("Hermes YAML shape diagnostics", () => {
  it.each(
    [
      "!!set {rea: null}",
      "!!omap [{rea: {command: rea, args: [mcp]}}]",
      "!!timestamp 2001-12-15",
      "!!binary cmVh",
    ]
      .flatMap((value) => [
        {
          original: `${value}\n`,
          problem: "The configuration root must be an object",
        },
        {
          original: `mcp_servers: ${value}\n`,
          problem: '"mcp_servers" must be an object',
        },
      ])
      .concat(
        // An explicit null root is a value, not an empty file.
        [
          "null\n",
          "~\n",
          "# Hermes configuration\nnull\n",
          "--- ~\n",
          "--- !!null\n",
          '!!null ""\n',
          "--- &empty\n",
        ].map((original) => ({
          original,
          problem: "The configuration root must be an object",
        })),
      ),
  )(
    "blocks setup and uninstall before changes for tagged or null non-record YAML: $original",
    async ({ original, problem }) => {
      const { home, client } = await hermesClient();
      const cursor = join(home, ".cursor", "mcp.json");
      const cursorOriginal =
        '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}}}';
      await mkdir(join(home, ".cursor"));
      await writeFile(cursor, cursorOriginal);
      await writeFile(client.configPath, original);
      expect(
        await inspectClientConfiguration(client, {}, command),
      ).toMatchObject({
        status: "invalid",
        remediation: `Configuration ${client.configPath} is malformed: ${problem}`,
      });
      expect(await configureClientConfiguration(client, {}, command)).toEqual({
        status: "failed",
        reason: "readback",
      });
      const result = await runUninstall(
        false,
        systemUninstallHost(home, undefined, {}),
      );
      expect(result.status).toBe("failed");
      expect(result.items).toContainEqual({
        name: "hermes",
        status: "failed",
        configuration_path: client.configPath,
        detail: `Configuration was not changed: ${problem}. Repair it, then rerun uninstall.`,
      });
      expect(await readFile(client.configPath, "utf8")).toBe(original);
      expect(await readFile(cursor, "utf8")).toBe(cursorOriginal);
      await expect(
        readFile(`${client.configPath}.rea.backup`, "utf8"),
      ).rejects.toThrow();
      await expect(readFile(`${cursor}.rea.backup`, "utf8")).rejects.toThrow();
    },
  );
});

describe("Hermes YAML registration", () => {
  it("writes mcp_servers, preserves comments, reads back, and uninstalls", async () => {
    const { home, client } = await hermesClient();
    await writeFile(
      client.configPath,
      `# Hermes configuration
display:
  language: en
mcp_servers:
  # An independently managed server.
  other:
    command: other-server
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("# Hermes configuration");
    expect(text).toContain("# An independently managed server.");
    expect(parseYaml(text)).toEqual({
      display: { language: "en" },
      mcp_servers: {
        other: { command: "other-server" },
        rea: { command: command[0], args: command.slice(1), enabled: true },
      },
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
      ).find(({ client: name }) => name === "hermes"),
    ).toMatchObject({ state: "aligned", command });

    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    expect(parseYaml(await readFile(client.configPath, "utf8"))).toEqual({
      display: { language: "en" },
      mcp_servers: { other: { command: "other-server" } },
    });
  });

  it("keeps unrelated long YAML scalars on their original lines", async () => {
    const { home, client } = await hermesClient();
    const prompt = "Keep this sentence on one line. ".repeat(8).trim();
    const original = `# Hermes configuration
model:
  personality: ${prompt}
mcp_servers:
  other:
    command: other-server
`;
    await writeFile(client.configPath, original);
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain(`  personality: ${prompt}\n`);
    expect(parseYaml(text)).toMatchObject({ model: { personality: prompt } });
    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    expect(await readFile(client.configPath, "utf8")).toBe(original);
  });

  it("keeps unrelated numbers as written, including Discord IDs", async () => {
    const { home, client } = await hermesClient();
    // Hermes reads these exactly: two IDs one apart, an octal mode, a float.
    const original = `discord:
  free_response_channels:
    - 1187654321098765432
  channel_prompts:
    1187654321098765433: Build questions.
    1187654321098765434: Release questions.
  mode: 0600
  min_score: 0.0000001
mcp_servers:
  other:
    command: other-server
`;
    await writeFile(client.configPath, original);
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text.startsWith(original)).toBe(true);
    expect(parseYaml(text, { intAsBigInt: true })).toMatchObject({
      mcp_servers: {
        rea: { command: command[0], args: command.slice(1), enabled: true },
      },
    });
    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    expect(await readFile(client.configPath, "utf8")).toBe(original);
  });

  it("creates config.yaml when Hermes has no configuration yet", async () => {
    const { client } = await hermesClient();
    const environment = { REA_MCP_OUTPUT_SCHEMA_PROFILE: "off" };
    expect(
      (await configureClientConfiguration(client, environment, command)).status,
    ).toBe("configured");
    expect(
      parseYaml(await readFile(client.configPath, "utf8"), { version: "1.1" }),
    ).toEqual({
      mcp_servers: {
        rea: {
          command: command[0],
          args: command.slice(1),
          env: environment,
          enabled: true,
        },
      },
    });
  });

  it.each(["off", "2026-10-14", "12:34:56"])(
    "refuses an environment value %s that Hermes parses as a non-string",
    async (value) => {
      const { home, client } = await hermesClient();
      const original = `mcp_servers:\n  rea:\n    command: rea\n    args: [mcp]\n    env:\n      CUSTOM_SETTING: ${value}\n`;
      await writeFile(client.configPath, original);
      expect(
        await inspectClientConfiguration(client, {}, command),
      ).toMatchObject({
        status: "invalid",
        remediation: expect.stringContaining("CUSTOM_SETTING"),
      });
      expect(
        await configureClientConfiguration(client, {}, command),
      ).toMatchObject({ status: "failed" });
      expect(
        (
          await readClientRegistrationStatuses(home, "rea", {
            environment: {},
          })
        ).find(({ client: name }) => name === "hermes"),
      ).toMatchObject({ state: "invalid" });
      expect(await readFile(client.configPath, "utf8")).toBe(original);
      await expect(
        readFile(`${client.configPath}.rea.backup`, "utf8"),
      ).rejects.toThrow();
    },
  );

  // Comments and a bare document marker parse to a null document, like an
  // empty file, and are kept ahead of the new registration.
});

describe("Hermes YAML empty configurations", () => {
  it("rejects multiple YAML documents before treating an empty first root as absent", async () => {
    const { client } = await hermesClient();
    const original =
      "---\n---\nmcp_servers:\n  rea:\n    command: rea\n    args: [mcp]\n";
    await writeFile(client.configPath, original);
    expect(await inspectClientConfiguration(client, {}, command)).toMatchObject(
      { status: "invalid" },
    );
    expect(await configureClientConfiguration(client, {}, command)).toEqual({
      status: "failed",
      reason: "readback",
    });
    expect(await readFile(client.configPath, "utf8")).toBe(original);
    await expect(
      readFile(`${client.configPath}.rea.backup`, "utf8"),
    ).rejects.toThrow();
  });

  it.each([
    "",
    "\n",
    "# Hermes configuration\n",
    "---\n",
    "---\n# Hermes configuration\n",
  ])(
    "configures an empty config.yaml %j as a new document",
    async (original) => {
      const { home, client } = await hermesClient();
      await writeFile(client.configPath, original);
      expect(
        (await configureClientConfiguration(client, {}, command)).status,
      ).toBe("configured");
      const text = await readFile(client.configPath, "utf8");
      const kept = original.trimEnd();
      expect(text.slice(0, kept.length)).toBe(kept);
      expect(parseYaml(text)).toEqual({
        mcp_servers: {
          rea: { command: command[0], args: command.slice(1), enabled: true },
        },
      });
      expect(
        (
          await readClientRegistrationStatuses(home, undefined, {
            platform: process.platform,
            environment: {},
          })
        ).find(({ client: name }) => name === "hermes"),
      ).toMatchObject({ state: "aligned", command });
    },
  );
});
