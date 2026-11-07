import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import { resolveClientConfigTransactionPath } from "../../../src/application/ClientConfigPath.js";
import { readConfigurationFile } from "../../../src/application/ClientConfigurationFiles.js";
import {
  configureClientConfiguration,
  inspectClientConfiguration,
  clientConfigurationAligned,
} from "../../../src/application/SetupClientConfiguration.js";
import { resolveWindowsClaudeDesktopLocation } from "../../../src/application/ClaudeDesktopConfigLocation.js";
import { supportedClients } from "../../../src/application/SupportedClients.js";
import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";
import { failedConfigurationMessage } from "../../../src/application/SetupClients.js";
import { CURRENT_ENTRYPOINT_PATH } from "../../../src/process/CurrentEntrypointPath.js";

const registrationCommand = currentClientRegistrationCommand();

it.skipIf(process.platform === "win32")(
  "preserves an aligned caller launcher alias without writes or a backup",
  async () => {
    const home = await createTestTempDirectory(
      "rea-config-equivalent-launcher-",
    );
    const real = CURRENT_ENTRYPOINT_PATH;
    if (real === undefined) throw new Error("missing current entrypoint");
    const alias = join(home, "rea-alias");
    await symlink(real, alias);
    await mkdir(join(home, ".cursor"));
    const configPath = join(home, ".cursor", "mcp.json");
    const original = JSON.stringify({
      mcpServers: {
        rea: { command: alias, args: ["mcp"], future_policy: { retain: true } },
      },
    });
    await writeFile(configPath, original);
    const client = { name: "cursor", format: "json", configPath } as const;
    expect(await clientConfigurationAligned(client, {}, [real, "mcp"])).toBe(
      true,
    );
    expect(await inspectClientConfiguration(client, {}, [real, "mcp"])).toEqual(
      { status: "already_current" },
    );
    expect(
      await configureClientConfiguration(client, {}, [real, "mcp"]),
    ).toEqual({ status: "unchanged" });
    expect(await readFile(configPath, "utf8")).toBe(original);
    await expect(readFile(`${configPath}.rea.backup`)).rejects.toThrow();
    const other = join(home, "another-launcher");
    await writeFile(other, "different launcher\n");
    expect(
      await configureClientConfiguration(client, {}, [other, "mcp"]),
    ).toMatchObject({ status: "configured" });
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      mcpServers: { rea: { command: other, future_policy: { retain: true } } },
    });
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
  },
);

it.skipIf(process.platform === "win32")(
  "repairs a Codex timeout without replacing an equivalent caller launcher alias",
  async () => {
    const home = await createTestTempDirectory(
      "rea-config-timeout-launcher-alias-",
    );
    const real = CURRENT_ENTRYPOINT_PATH;
    if (real === undefined) throw new Error("missing current entrypoint");
    const alias = join(home, "rea-alias");
    await symlink(real, alias);
    await mkdir(join(home, ".codex"));
    const configPath = join(home, ".codex", "config.toml");
    const original = [
      "[mcp_servers.rea]",
      `command = ${JSON.stringify(alias)}`,
      'args = ["mcp"]',
      "startup_timeout_sec = 0",
      "tool_timeout_sec = 450",
      "future_policy = { retain = true }",
      "",
      "[mcp_servers.rea.env]",
      'CALLER_SETTING = "keep exactly"',
      "",
    ].join("\n");
    await writeFile(configPath, original);
    const client = { name: "codex", format: "toml", configPath } as const;
    expect(
      await configureClientConfiguration(client, {}, [real, "mcp"]),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(parseToml(configured)).toMatchObject({
      mcp_servers: {
        rea: {
          command: alias,
          args: ["mcp"],
          startup_timeout_sec: 30,
          tool_timeout_sec: 450,
          future_policy: { retain: true },
          env: { CALLER_SETTING: "keep exactly" },
        },
      },
    });
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
    expect(
      await configureClientConfiguration(client, {}, [real, "mcp"]),
    ).toEqual({ status: "unchanged" });
    expect(await readFile(configPath, "utf8")).toBe(configured);
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
  },
);

it.skipIf(process.platform === "win32").each([false, true])(
  "preserves filesystem parent traversal when the configuration exists=%s",
  async (exists) => {
    const root = await createTestTempDirectory("rea-config-parent-traversal-");
    const selectedDirectory = join(root, "selected");
    await mkdir(join(selectedDirectory, "child"), { recursive: true });
    await symlink(join(selectedDirectory, "child"), join(root, "link"), "dir");
    const selected = join(selectedDirectory, "config.json");
    const unrelated = join(root, "config.json");
    const original = '{"theme":"keep"}\n';
    await writeFile(unrelated, original);
    if (exists) await writeFile(selected, original);
    const requested = `${root}/link/../config.json`;
    expect(await resolveClientConfigTransactionPath(requested)).toBe(selected);
    expect(
      await configureClientConfiguration({
        name: "cursor",
        format: "json",
        configPath: requested,
      }),
    ).toMatchObject({ status: "configured" });
    expect(JSON.parse(await readFile(selected, "utf8"))).toMatchObject({
      mcpServers: { rea: { command: registrationCommand[0] } },
    });
    expect(await readFile(unrelated, "utf8")).toBe(original);
    await expect(lstat(`${unrelated}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    if (exists)
      expect(await readFile(`${selected}.rea.backup`, "utf8")).toBe(original);
    expect(
      await resolveClientConfigTransactionPath(`${root}/absent/../config.json`),
    ).toBeUndefined();
  },
);

it
  .skipIf(process.platform === "win32")
  .each(
    ["/", "/."].flatMap((suffix) =>
      [false, true].map((relativePath) => ({ suffix, relativePath })),
    ),
  )(
  "rejects a missing configuration with directory suffix $suffix and relative=$relativePath",
  async ({ suffix, relativePath }) => {
    const root = await createTestTempDirectory("rea-config-directory-suffix-");
    const path = join(root, "config.json");
    const requested = `${relativePath ? relative(process.cwd(), path) : path}${suffix}`;
    expect(await resolveClientConfigTransactionPath(requested)).toBe(
      `${path}/`,
    );
    expect(
      await configureClientConfiguration({
        name: "cursor",
        format: "json",
        configPath: requested,
      }),
    ).toMatchObject({ status: "failed" });
    const selected = await lstat(path).catch((cause: unknown) => {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
        return undefined;
      throw cause;
    });
    expect(selected?.isFile() ?? false).toBe(false);
  },
);

describe("JSON client configuration transaction: writing configuration through safe paths", () => {
  it.skipIf(typeof process.getuid !== "function")(
    "rejects a symlink target not owned by the current user",
    async () => {
      const currentUid = process.getuid?.();
      if (currentUid === undefined)
        throw new Error("UID support is required by this test");
      let statCalls = 0;
      expect(
        await resolveClientConfigTransactionPath("/config", {
          lstat: () => {
            statCalls += 1;
            return Promise.resolve({
              uid: statCalls === 1 ? currentUid : currentUid + 1,
              isFile: () => statCalls > 1,
              isSymbolicLink: () => statCalls === 1,
            });
          },
          realpath: () => Promise.resolve("/target"),
        }),
      ).toBeUndefined();
    },
  );

  it.skipIf(process.platform === "win32")(
    "resolves a directory symlink and its real directory to one transaction path",
    async () => {
      const root = await createTestTempDirectory("rea-config-dir-alias-");
      const realDirectory = join(root, "real");
      const alias = join(root, "alias");
      await mkdir(realDirectory);
      await symlink(realDirectory, alias, "dir");
      const realPath = join(realDirectory, "config.json");
      const aliasPath = join(alias, "config.json");
      const nestedRealPath = join(realDirectory, "nested", "config.json");
      const nestedAliasPath = join(alias, "nested", "config.json");

      expect(await resolveClientConfigTransactionPath(aliasPath)).toBe(
        realPath,
      );
      expect(await resolveClientConfigTransactionPath(realPath)).toBe(realPath);
      expect(await resolveClientConfigTransactionPath(nestedAliasPath)).toBe(
        nestedRealPath,
      );
      expect(await resolveClientConfigTransactionPath(nestedRealPath)).toBe(
        nestedRealPath,
      );

      await writeFile(realPath, "{}\n");
      expect(await resolveClientConfigTransactionPath(aliasPath)).toBe(
        realPath,
      );
      expect(await resolveClientConfigTransactionPath(realPath)).toBe(realPath);
    },
  );

  it("preserves existing keys, creates a backup, and reads back the MCP entry", async () => {
    const directory = await createTestTempDirectory("rea-setup-");
    const configPath = join(directory, "mcp.json");
    const original =
      '{"theme":"dark","mcpServers":{"other":{"command":"other"}}}\n';
    await writeFile(configPath, original);
    const result = await configureClientConfiguration({
      name: "cursor",
      configPath,
      format: "json",
    });
    expect(result.status).toBe("configured");
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      theme: "dark",
      mcpServers: {
        other: { command: "other" },
        rea: {
          command: registrationCommand[0],
          args: registrationCommand.slice(1),
        },
      },
    });
  });

  it("updates a symlink target without replacing the JSON config symlink", async () => {
    const directory = await createTestTempDirectory("rea-setup-");
    const targetPath = join(directory, "managed.json");
    const configPath = join(directory, "mcp.json");
    const original = '{"theme":"dark"}\n';
    await writeFile(targetPath, original);
    await symlink(targetPath, configPath);

    expect(
      await configureClientConfiguration({
        name: "cursor",
        configPath,
        format: "json",
      }),
    ).toMatchObject({ status: "configured" });
    expect((await lstat(configPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
    expect(JSON.parse(await readFile(targetPath, "utf8"))).toMatchObject({
      theme: "dark",
      mcpServers: {
        rea: {
          command: registrationCommand[0],
          args: registrationCommand.slice(1),
        },
      },
    });
    expect(
      await configureClientConfiguration({
        name: "cursor",
        configPath,
        format: "json",
      }),
    ).toEqual({
      status: "unchanged",
    });
  });

  it("fails before mutation when a JSON config symlink is dangling", async () => {
    const directory = await createTestTempDirectory("rea-setup-");
    const configPath = join(directory, "mcp.json");
    await symlink(join(directory, "missing.json"), configPath);

    expect(
      await configureClientConfiguration({
        name: "cursor",
        configPath,
        format: "json",
      }),
    ).toEqual({
      status: "failed",
      reason: "path",
    });
    expect((await lstat(configPath)).isSymbolicLink()).toBe(true);
    await expect(
      readFile(`${configPath}.rea.backup`, "utf8"),
    ).rejects.toThrow();
  });
});

describe("JSON client configuration transaction: keeping matching configuration unchanged", () => {
  it("performs no write or second backup when configuration already matches", async () => {
    const directory = await createTestTempDirectory("rea-setup-");
    const configPath = join(directory, "mcp.json");
    await writeFile(
      configPath,
      `${JSON.stringify({ mcpServers: { rea: { command: registrationCommand[0], args: registrationCommand.slice(1) } } })}\n`,
    );
    expect(
      await configureClientConfiguration({
        name: "cursor",
        configPath,
        format: "json",
      }),
    ).toEqual({
      status: "unchanged",
    });
    await expect(
      readFile(`${configPath}.rea.backup`, "utf8"),
    ).rejects.toThrow();
  });

  it("does not rewrite an equivalent configuration with reordered environment keys", async () => {
    const directory = await createTestTempDirectory("rea-setup-");
    const configPath = join(directory, "mcp.json");
    await writeFile(
      configPath,
      `${JSON.stringify({
        mcpServers: {
          rea: {
            env: {
              JAVA_HOME: "/usr/lib/jvm/jdk-21",
              GHIDRA_INSTALL_DIR: "/opt/ghidra",
            },
            args: registrationCommand.slice(1),
            command: registrationCommand[0],
          },
        },
      })}\n`,
    );

    expect(
      await configureClientConfiguration(
        { name: "cursor", configPath, format: "json" },
        {
          GHIDRA_INSTALL_DIR: "/opt/ghidra",
          JAVA_HOME: "/usr/lib/jvm/jdk-21",
        },
      ),
    ).toEqual({ status: "unchanged" });
    await expect(
      readFile(`${configPath}.rea.backup`, "utf8"),
    ).rejects.toThrow();
  });
});

describe("JSON client configuration migration and provider paths", () => {
  it("migrates an unversioned npx registration and preserves sibling configuration", async () => {
    const directory = await createTestTempDirectory("rea-setup-");
    const configPath = join(directory, "mcp.json");
    const original =
      '{"theme":"dark","mcpServers":{"rea":{"command":"npx","args":["-y","rea-agents","mcp"]},"other":{"command":"other"}}}\n';
    await writeFile(configPath, original);

    expect(
      await configureClientConfiguration({
        name: "cursor",
        configPath,
        format: "json",
      }),
    ).toEqual(expect.objectContaining({ status: "configured" }));

    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      theme: "dark",
      mcpServers: {
        rea: {
          command: registrationCommand[0],
          args: registrationCommand.slice(1),
        },
        other: { command: "other" },
      },
    });
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
  });

  it("persists a custom Hopper launcher and remains idempotent", async () => {
    const directory = await createTestTempDirectory("rea-setup-");
    const configPath = join(directory, "mcp.json");
    const hopperPath = "/Applications/Hopper v6.app/Contents/MacOS/hopper";
    const client = { name: "cursor", configPath, format: "json" } as const;
    const original = "{}\n";
    await writeFile(configPath, original);
    expect(
      await configureClientConfiguration(client, {
        HOPPER_LAUNCHER_PATH: hopperPath,
      }),
    ).toMatchObject({
      status: "configured",
    });
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      mcpServers: {
        rea: {
          command: registrationCommand[0],
          args: registrationCommand.slice(1),
          env: { HOPPER_LAUNCHER_PATH: hopperPath },
        },
      },
    });
    expect(
      await configureClientConfiguration(client, {
        HOPPER_LAUNCHER_PATH: hopperPath,
      }),
    ).toEqual({
      status: "unchanged",
    });
    expect(
      await configureClientConfiguration(client, {
        HOPPER_LAUNCHER_PATH: "/opt/hopper/bin/Hopper",
      }),
    ).toMatchObject({ status: "configured" });
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
  });

  it("adds exact BYO Ghidra and Java paths without installing dependencies", async () => {
    const directory = await createTestTempDirectory("rea-setup-");
    const configPath = join(directory, "mcp.json");
    const client = { name: "cursor", configPath, format: "json" } as const;
    const environment = {
      GHIDRA_INSTALL_DIR: "/opt/ghidra_12.1.4_PUBLIC",
      JAVA_HOME: "/usr/lib/jvm/jdk-21",
    };

    expect(
      await configureClientConfiguration(client, environment),
    ).toMatchObject({
      status: "configured",
    });
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      mcpServers: {
        rea: {
          env: {
            GHIDRA_INSTALL_DIR: environment.GHIDRA_INSTALL_DIR,
            JAVA_HOME: environment.JAVA_HOME,
          },
        },
      },
    });
    expect(await configureClientConfiguration(client, environment)).toEqual({
      status: "unchanged",
    });
  });

  it("refuses malformed existing JSON without overwriting it", async () => {
    const directory = await createTestTempDirectory("rea-setup-");
    const configPath = join(directory, "mcp.json");
    await writeFile(configPath, "not-json");
    expect(
      await configureClientConfiguration({
        name: "cursor",
        configPath,
        format: "json",
      }),
    ).toEqual({
      status: "failed",
      reason: "readback",
    });
    expect(await readFile(configPath, "utf8")).toBe("not-json");
  });

  it("refuses a non-object JSON root without overwriting it", async () => {
    const original = "null";
    const directory = await createTestTempDirectory("rea-setup-");
    const configPath = join(directory, "mcp.json");
    await writeFile(configPath, original);
    expect(
      await configureClientConfiguration({
        name: "cursor",
        configPath,
        format: "json",
      }),
    ).toEqual({
      status: "failed",
      reason: "readback",
    });
    expect(await readFile(configPath, "utf8")).toBe(original);
    await expect(
      readFile(`${configPath}.rea.backup`, "utf8"),
    ).rejects.toThrow();
  });

  it("preserves a non-object mcpServers value", async () => {
    const servers = "[]";
    const directory = await createTestTempDirectory("rea-setup-");
    const configPath = join(directory, "mcp.json");
    const original = `{"mcpServers":${servers}}`;
    await writeFile(configPath, original);
    expect(
      await configureClientConfiguration({
        name: "cursor",
        configPath,
        format: "json",
      }),
    ).toEqual({
      status: "failed",
      reason: "readback",
    });
    expect(await readFile(configPath, "utf8")).toBe(original);
    await expect(
      readFile(`${configPath}.rea.backup`, "utf8"),
    ).rejects.toThrow();
  });
});

describe("JSON client configuration shape diagnostics", () => {
  it.each([
    {
      format: "json" as const,
      original:
        '{"__proto__":{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}}}}',
      serversKey: "mcpServers",
    },
    {
      format: "opencode" as const,
      original:
        '{"mcp":{"__proto__":{"servers":{"rea":{"type":"local","command":["rea","mcp"]}}}}}',
      serversKey: "mcp",
    },
  ])(
    "registers an own server instead of trusting inherited $format settings",
    async ({ format, original, serversKey }) => {
      const directory = await createTestTempDirectory("rea-setup-prototype-");
      const configPath = join(directory, "mcp.json");
      const client = {
        name: format === "json" ? "cursor" : "opencode",
        configPath,
        format,
      };
      await writeFile(configPath, original);
      expect(
        await inspectClientConfiguration(client, {}, ["rea", "mcp"]),
      ).toMatchObject({ status: "update" });
      expect(
        await configureClientConfiguration(client, {}, ["rea", "mcp"]),
      ).toMatchObject({ status: "configured" });
      const document = JSON.parse(await readFile(configPath, "utf8"));
      expect(Object.hasOwn(document, serversKey)).toBe(true);
      expect(Object.hasOwn(document[serversKey], "rea")).toBe(true);
      expect(document[serversKey].rea.command).toEqual(
        format === "json" ? "rea" : ["rea", "mcp"],
      );
      const originalDocument = JSON.parse(original);
      expect(
        format === "json" ? document.__proto__ : document[serversKey].__proto__,
      ).toEqual(
        format === "json"
          ? originalDocument.__proto__
          : originalDocument[serversKey].__proto__,
      );
      expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
      expect(
        await inspectClientConfiguration(client, {}, ["rea", "mcp"]),
      ).toMatchObject({ status: "already_current" });
    },
  );

  it.each([
    ['{"mcpServers":null,"keep":1}', '"mcpServers" must be an object'],
    ["[]", "The configuration root must be an object"],
    ['{"mcpServers":"x"}', '"mcpServers" must be an object'],
  ] as const)(
    "names structural shape problems in setup remediation: %s",
    async (original, problem) => {
      const directory = await createTestTempDirectory("rea-setup-shape-");
      const configPath = join(directory, "mcp.json");
      const client = {
        name: "cursor",
        configPath,
        format: "json" as const,
      };
      await writeFile(configPath, original);
      const read = await readConfigurationFile(configPath, "json");
      expect(read.ok).toBe(false);
      if (read.ok) throw new Error("expected malformed configuration");
      expect(read.error.detail).toBe(
        `Configuration ${configPath} is malformed: ${problem}`,
      );
      expect(
        await inspectClientConfiguration(client, {}, ["rea", "mcp"]),
      ).toEqual({
        status: "invalid",
        remediation: `Configuration ${configPath} is malformed: ${problem}`,
      });
      expect(await readFile(configPath, "utf8")).toBe(original);
    },
  );
});

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "preserves the private-path access diagnostic during the final MSIX target recheck",
  async () => {
    const home = await createTestTempDirectory("rea-msix-recheck-denied-");
    const configPath = join(home, "client.json");
    const locked = join(home, "private");
    const privateConfigPath = join(locked, "client.json");
    const original = '{"keep":true}\n';
    await writeFile(configPath, original);
    await mkdir(locked);
    await chmod(locked, 0);
    try {
      const result = await configureClientConfiguration({
        name: "claude_desktop",
        format: "json",
        configPath,
        msixPackage: {
          packageFamilyName: "Claude_pzs8sxrjxfjjc",
          appDataConfigPath: configPath,
          privateConfigPath,
          virtualizedRoots: [],
          processView: "direct",
        },
      });
      expect(result).toMatchObject({
        status: "failed",
        reason: "target_unavailable",
        failure: {
          kind: "inspect",
          path: privateConfigPath,
          detail: expect.stringContaining("EACCES"),
        },
      });
      if (result.status !== "failed")
        throw new Error("Expected inspection failure");
      expect(failedConfigurationMessage(result)).toContain(privateConfigPath);
      expect(failedConfigurationMessage(result)).not.toContain(
        "began reading a different",
      );
      expect(await readFile(configPath, "utf8")).toBe(original);
      expect((await readdir(home)).sort()).toEqual(["client.json", "private"]);
    } finally {
      await chmod(locked, 0o700);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "selects literal AppData directories with trailing spaces through native filesystem discovery",
  async () => {
    const home = await createTestTempDirectory("rea-appdata-literal-root-");
    const environment = {
      APPDATA: join(home, "Roaming "),
      LOCALAPPDATA: join(home, "Local "),
    };
    const appDataConfig = join(
      environment.APPDATA,
      "Claude",
      "claude_desktop_config.json",
    );
    await mkdir(join(environment.APPDATA, "Claude"), { recursive: true });
    await writeFile(appDataConfig, "{}");
    // The trimmed alternate root contains a different package identity and must not be selected.
    await mkdir(
      join(home, "Local", "Packages", "AnthropicPBC.Claude_fnn82j28hfe8t"),
      { recursive: true },
    );
    expect(resolveWindowsClaudeDesktopLocation(home, environment)).toEqual({
      ok: true,
      value: {
        configPath: appDataConfig,
        markerPath: join(environment.APPDATA, "Claude"),
      },
    });
    expect(await readFile(appDataConfig, "utf8")).toBe("{}");
  },
);

it("keeps setup and registration diagnostics blocked for an unrecognized Claude package deployment", async () => {
  const home = await createTestTempDirectory("rea-claude-deployment-unknown-");
  const environment = {
    APPDATA: join(home, "Roaming"),
    LOCALAPPDATA: join(home, "Local"),
  };
  await mkdir(
    join(
      environment.LOCALAPPDATA,
      "Packages",
      "AnthropicPBC.Claude_fnn82j28hfe8t",
    ),
    { recursive: true },
  );
  const config = join(
    environment.APPDATA,
    "Claude",
    "claude_desktop_config.json",
  );
  await mkdir(join(environment.APPDATA, "Claude"), { recursive: true });
  const original = '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}}}\n';
  await writeFile(config, original);
  const client = supportedClients(home, "win32", environment).find(
    (client) => client.name === "claude_desktop",
  );
  if (client === undefined) throw new Error("Claude client definition missing");
  expect(client.configPathError).toContain("unrecognized Claude Desktop");
  expect(await configureClientConfiguration(client)).toMatchObject({
    status: "failed",
    reason: "path",
  });
  expect(
    (
      await readClientRegistrationStatuses(home, "/current/rea", {
        platform: "win32",
        environment,
      })
    ).find((status) => status.client === "claude_desktop"),
  ).toMatchObject({
    state: "invalid",
    command: [],
    remediation: expect.stringContaining("does not fall back"),
  });
  expect(await readFile(config, "utf8")).toBe(original);
  expect(await readdir(join(environment.APPDATA, "Claude"))).toEqual([
    "claude_desktop_config.json",
  ]);
});
