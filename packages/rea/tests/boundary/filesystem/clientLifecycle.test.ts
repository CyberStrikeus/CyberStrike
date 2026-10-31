import { constants as fsConstants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { ClientConfigurationPublication } from "../../../src/application/ClientConfigurationPublication.js";
import { clearClientLocationEnvironment } from "../../fixtures/clientEnvironment.js";
import { supportedClients } from "../../../src/application/SupportedClients.js";
import { PRODUCT_IDENTITY } from "../../../src/identity.js";

import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";
import { configureClientConfiguration } from "../../../src/application/SetupClientConfiguration.js";
import { readConfigurationFile } from "../../../src/application/ClientConfigurationFiles.js";
import {
  detectClients,
  systemSetupHost,
} from "../../../src/application/SetupHost.js";
import {
  runUninstall,
  systemUninstallHost,
  type UninstallFileSystem,
} from "../../../src/application/Uninstall.js";

const ownedSkillManifest = `---\nname: ${PRODUCT_IDENTITY.skillName}\n---\n# REA\n`;
beforeEach(clearClientLocationEnvironment);
afterEach(() => vi.unstubAllEnvs());

describe("client configuration filesystem lifecycle", () => {
  it("detects every supported client and skips absent clients", async () => {
    const home = await createTestTempDirectory("rea-detect-");
    for (const client of supportedClients(home))
      if (client.markerPath !== undefined)
        await mkdir(client.markerPath, { recursive: true });
    const detected = await detectClients(home);
    expect(detected.map(({ name }) => name)).toEqual([
      "claude_code",
      "claude_desktop",
      "codex",
      "cursor",
      "gemini_cli",
      "windsurf",
      "devin",
      "opencode",
      "antigravity",
      "copilot_cli",
      "commandcode",
      "qwen_code",
      "kimi",
      "vscode",
      "trae",
      "workbuddy",
      "grok_build",
      "omp",
      "pi",
      "hermes",
      "qoder",
      "droid",
      "zcode",
      "dsh",
      "freebuff",
      "grok_bot",
    ]);
    expect(
      detected.find(({ name }) => name === "claude_code")?.configPath,
    ).toBe(join(home, ".claude.json"));
    expect(detected.find(({ name }) => name === "devin")?.format).toBe("json");
    const emptyHome = await createTestTempDirectory("rea-empty-");
    expect(await detectClients(emptyHome)).toEqual([]);
  });

  it("preserves unrelated Codex TOML and supports an installed command", async () => {
    const home = await createTestTempDirectory("rea-toml-");
    const configPath = join(home, ".codex/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      'model = "gpt-5"\n[mcp_servers.other]\ncommand = "other"\n',
    );
    expect(
      await configureClientConfiguration(
        { name: "codex", configPath, format: "toml" },
        {
          HOPPER_LAUNCHER_PATH: "/Hopper Path",
          GHIDRA_INSTALL_DIR: "/opt/ghidra",
          JAVA_HOME: "/opt/jdk-21",
        },
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured).toContain('model = "gpt-5"');
    expect(configured).toContain("[mcp_servers.rea]");
    expect(configured).toContain('command = "rea"');
    expect(configured).toContain("startup_timeout_sec = 30");
    expect(configured).toContain("tool_timeout_sec = 450");
    expect(configured).toContain('GHIDRA_INSTALL_DIR = "/opt/ghidra"');
    expect(configured).toContain('JAVA_HOME = "/opt/jdk-21"');
    expect(
      await configureClientConfiguration(
        { name: "codex", configPath, format: "toml" },
        {
          HOPPER_LAUNCHER_PATH: "/Hopper Path",
          GHIDRA_INSTALL_DIR: "/opt/ghidra",
          JAVA_HOME: "/opt/jdk-21",
        },
        ["rea", "mcp"],
      ),
    ).toEqual({ status: "unchanged" });
  });

  it("does not rewrite an equivalent Codex registration with reordered environment keys", async () => {
    const home = await createTestTempDirectory("rea-toml-");
    const configPath = join(home, ".codex/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      `[mcp_servers.rea]\ncommand = "rea"\nargs = ["mcp"]\nstartup_timeout_sec = 30\ntool_timeout_sec = 450\n\n[mcp_servers.rea.env]\nJAVA_HOME = "/opt/jdk-21"\nHOPPER_LAUNCHER_PATH = "/Hopper Path"\nGHIDRA_INSTALL_DIR = "/opt/ghidra"\n`,
    );

    const original = await readFile(configPath, "utf8");
    expect(
      await configureClientConfiguration(
        { name: "codex", configPath, format: "toml" },
        {
          HOPPER_LAUNCHER_PATH: "/Hopper Path",
          GHIDRA_INSTALL_DIR: "/opt/ghidra",
          JAVA_HOME: "/opt/jdk-21",
        },
        ["rea", "mcp"],
      ),
    ).toEqual({ status: "unchanged" });
    expect(await readFile(configPath, "utf8")).toBe(original);
    await expect(
      readFile(`${configPath}.rea.backup`, "utf8"),
    ).rejects.toThrow();
  });
});

describe("Codex MCP tool deadlines", () => {
  it("derives the Codex tool deadline from an explicit Ghidra startup allowance", async () => {
    const home = await createTestTempDirectory("rea-codex-long-timeout-");
    const configPath = join(home, ".codex/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    expect(
      await configureClientConfiguration(
        { name: "codex", configPath, format: "toml" },
        { REA_GHIDRA_STARTUP_TIMEOUT_MS: "2700001" },
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    expect(await readFile(configPath, "utf8")).toContain(
      "tool_timeout_sec = 2821",
    );
    expect(await readFile(configPath, "utf8")).toContain(
      'REA_GHIDRA_STARTUP_TIMEOUT_MS = "2700001"',
    );
  });

  it("preserves positive caller-selected Codex startup and tool deadlines", async () => {
    const home = await createTestTempDirectory("rea-codex-custom-timeout-");
    const configPath = join(home, ".codex/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      '[mcp_servers.rea]\ncommand = "npx"\nargs = ["-y", "rea-agents@6.1.0", "mcp"]\nstartup_timeout_sec = 5\ntool_timeout_sec = 10\n',
    );
    expect(
      await configureClientConfiguration(
        { name: "codex", configPath, format: "toml" },
        {},
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured).toContain("startup_timeout_sec = 5");
    expect(configured).toContain("tool_timeout_sec = 10");
  });
});

describe("client configuration filesystem lifecycle", () => {
  it("updates a symlink target without replacing the TOML config symlink", async () => {
    const home = await createTestTempDirectory("rea-toml-symlink-");
    const configPath = join(home, ".codex/config.toml");
    const targetPath = join(home, "managed-config.toml");
    const original = 'model = "gpt-5"\n';
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(targetPath, original);
    await symlink(targetPath, configPath);

    expect(
      await configureClientConfiguration(
        { name: "codex", configPath, format: "toml" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    expect((await lstat(configPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
    expect(await readFile(targetPath, "utf8")).toContain("[mcp_servers.rea]");
  });

  it("fails before mutation when a TOML config symlink is dangling", async () => {
    const home = await createTestTempDirectory("rea-toml-symlink-");
    const configPath = join(home, ".codex/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await symlink(join(home, "missing-config.toml"), configPath);

    expect(
      await configureClientConfiguration({
        name: "codex",
        configPath,
        format: "toml",
      }),
    ).toEqual({ status: "failed", reason: "path" });
    expect((await lstat(configPath)).isSymbolicLink()).toBe(true);
    await expect(
      readFile(`${configPath}.rea.backup`, "utf8"),
    ).rejects.toThrow();
  });
});

describe("Grok Build server table edits", () => {
  it("edits only the Grok Build REA tables and removes them on uninstall", async () => {
    const home = await createTestTempDirectory("rea-grok-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    const original = [
      "# keep this comment",
      'disabled_mcp_servers = ["xapi"]',
      "",
      "[cli]",
      'default_model = "grok-4"',
      "",
      "[mcp_servers.blender]",
      'command = "blender"',
      'args = ["--mcp"]',
      "",
      "# about rea",
      "[mcp_servers.rea]",
      'command = "npx"',
      'args = ["-y", "rea-agents@6.1.0", "mcp"]',
      "",
      "# rea environment",
      "[mcp_servers.rea.env]",
      'OLD = "1"',
      "",
      "[[marketplace.sources]]",
      'name = "official"',
      'url = "https://example.test/market"',
      "",
      "[privacy]",
      "share = false",
      "",
      "# trailing note",
      "",
    ].join("\r\n");
    await writeFile(configPath, original);
    const environment = {
      HOPPER_LAUNCHER_PATH: "/Hopper Path",
      GHIDRA_INSTALL_DIR: "/opt/ghidra",
      JAVA_HOME: "/opt/jdk-21",
    };
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        environment,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured).toContain("\r\n");
    expect(configured.replaceAll("\r\n", "")).not.toContain("\n");
    for (const comment of [
      "# keep this comment",
      "# about rea",
      "# rea environment",
      "# trailing note",
    ])
      expect(configured).toContain(`${comment}\r\n`);
    expect(configured).toContain('disabled_mcp_servers = ["xapi"]');
    expect(configured).toContain('default_model = "grok-4"');
    expect(configured).toContain("[mcp_servers.blender]");
    expect(configured).toContain('command = "blender"');
    expect(configured).toContain("[[marketplace.sources]]");
    expect(configured).toContain('name = "official"');
    expect(configured).toContain('url = "https://example.test/market"');
    expect(configured).toContain("[privacy]");
    expect(configured).toContain("share = false");
    expect(configured).toContain("[mcp_servers.rea]");
    expect(configured).toContain("startup_timeout_sec = 30");
    expect(configured).toContain('OLD = "1"');
    expect(configured).not.toContain("rea-agents@6.1.0");
    expect(parseToml(configured)).toMatchObject({
      mcp_servers: {
        blender: { command: "blender", args: ["--mcp"] },
        rea: {
          command: "rea",
          args: ["mcp"],
          startup_timeout_sec: 30,
          env: {
            OLD: "1",
            JAVA_HOME: "/opt/jdk-21",
            HOPPER_LAUNCHER_PATH: "/Hopper Path",
            GHIDRA_INSTALL_DIR: "/opt/ghidra",
          },
        },
      },
      marketplace: { sources: [{ name: "official" }] },
      privacy: { share: false },
    });
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        environment,
        ["rea", "mcp"],
      ),
    ).toEqual({ status: "unchanged" });
    expect(await readFile(configPath, "utf8")).toBe(configured);

    expect((await runUninstall(false, systemUninstallHost(home))).status).toBe(
      "complete",
    );
    const removed = await readFile(configPath, "utf8");
    for (const comment of [
      "# keep this comment",
      "# about rea",
      "# rea environment",
      "# trailing note",
    ])
      expect(removed).toContain(`${comment}\r\n`);
    expect(removed).toContain("[mcp_servers.blender]");
    expect(removed).toContain("[[marketplace.sources]]");
    expect(removed).toContain('url = "https://example.test/market"');
    expect(removed).toContain("[privacy]");
    expect(removed).not.toContain("[mcp_servers.rea]");
    expect(removed).not.toContain("startup_timeout_sec");
    expect(removed).not.toContain("JAVA_HOME");
  });
});

describe("Grok Build disabled server list", () => {
  it("removes rea from disabled_mcp_servers and leaves other names", async () => {
    const home = await createTestTempDirectory("rea-grok-disabled-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      [
        "disabled_mcp_servers = [",
        '  "other",',
        '  "r\\u0065a",',
        '  "rea", # was off',
        '  "github",',
        "]",
        "[mcp_servers.rea]",
        "enabled = false",
        'command = "rea"',
        'args = ["mcp"]',
        "startup_timeout_sec = 30",
      ].join("\n"),
    );
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured).toContain("# was off");
    expect(configured).not.toContain("enabled");
    expect(parseToml(configured)).toMatchObject({
      disabled_mcp_servers: ["other", "github"],
      mcp_servers: {
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 30 },
      },
    });
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toEqual({ status: "unchanged" });
    await writeFile(configPath, 'disabled_mcp_servers = ["rea"] # note\n');
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const created = await readFile(configPath, "utf8");
    expect(created).toContain("# note");
    expect(created).not.toContain("disabled_mcp_servers");
    expect(parseToml(created)).toMatchObject({
      mcp_servers: { rea: { command: "rea", args: ["mcp"] } },
    });
  });

  it("removes multiline rea entries from disabled_mcp_servers", async () => {
    const home = await createTestTempDirectory("rea-grok-disabled-multiline-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      [
        "disabled_mcp_servers = [",
        '  """rea""",',
        "  '''rea''',",
        '  """',
        'rea""",',
        '  """rea',
        '""",',
        '  "github",',
        "]",
      ].join("\n"),
    );
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(parseToml(configured)).toMatchObject({
      disabled_mcp_servers: ["rea\n", "github"],
      mcp_servers: { rea: { command: "rea", args: ["mcp"] } },
    });
    await writeFile(configPath, 'disabled_mcp_servers = ["""rea"""] # note\n');
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const created = await readFile(configPath, "utf8");
    expect(created).toContain("# note");
    expect(created).not.toContain("disabled_mcp_servers");
  });
});

describe("Grok Build text that resembles a server table", () => {
  it("preserves Grok text that only looks like an REA table", async () => {
    const home = await createTestTempDirectory("rea-grok-preserve-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    const original = [
      "banner = '''",
      "welcome",
      "[mcp_servers.rea]",
      "keep this text",
      "[privacy]",
      "'''",
      "",
      "[mcp_servers.rea]",
      'command = "npx"',
      'args = ["-y", "rea-agents@6.1.0", "mcp"]',
      "",
      "# Production server: preserve this configuration",
      '[mcp_servers."rea.env"]',
      'command = "other"',
      'args = ["serve"]',
      "",
      '[mcp_servers."other[prod]"]',
      'command = "other"',
      'args = ["serve"]',
      "",
      '[[marketplace."sources[prod]"]]',
      'name = "official"',
      "",
    ].join("\n");
    await writeFile(configPath, original);
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured).toContain("keep this text");
    expect(configured).toContain(
      "# Production server: preserve this configuration",
    );
    expect(configured).toContain('[mcp_servers."rea.env"]');
    expect(configured).toContain('[mcp_servers."other[prod]"]');
    expect(configured).toContain('[[marketplace."sources[prod]"]]');
    expect(configured).not.toContain("rea-agents@6.1.0");
    expect(parseToml(configured)).toMatchObject({
      banner: "welcome\n[mcp_servers.rea]\nkeep this text\n[privacy]\n",
      mcp_servers: {
        "rea.env": { command: "other", args: ["serve"] },
        "other[prod]": { command: "other", args: ["serve"] },
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 30 },
      },
      marketplace: { "sources[prod]": [{ name: "official" }] },
    });
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toEqual({ status: "unchanged" });

    expect((await runUninstall(false, systemUninstallHost(home))).status).toBe(
      "complete",
    );
    const removed = await readFile(configPath, "utf8");
    expect(removed).toContain("keep this text");
    expect(removed).toContain(
      "# Production server: preserve this configuration",
    );
    expect(removed).toContain('[mcp_servers."other[prod]"]');
    expect(parseToml(removed)).toMatchObject({
      mcp_servers: {
        "rea.env": { command: "other" },
        "other[prod]": { command: "other" },
      },
    });
    expect(parseToml(removed)).not.toHaveProperty("mcp_servers.rea");
  });

  it("replaces spaced and escaped Grok REA headers without duplicating them", async () => {
    const home = await createTestTempDirectory("rea-grok-alias-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      [
        "[ mcp_servers . rea ]",
        'command = "npx"',
        'args = ["-y", "rea-agents@6.1.0", "mcp"]',
        "",
        '[mcp_servers."\\u0072ea".env]',
        'OLD = "1"',
        "",
      ].join("\n"),
    );
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured).not.toContain("mcp_servers . rea");
    expect(configured).not.toContain("\\u0072ea");
    expect(configured).toContain('OLD = "1"');
    expect(
      configured
        .split("\n")
        .filter((line) => line.trim() === "[mcp_servers.rea]"),
    ).toHaveLength(1);
    expect(parseToml(configured)).toMatchObject({
      mcp_servers: {
        rea: {
          command: "rea",
          args: ["mcp"],
          startup_timeout_sec: 30,
          env: { OLD: "1" },
        },
      },
    });
  });
});

describe("Grok Build multiline and escaped headers", () => {
  it("preserves a multiline string opened on the line that closed the previous one", async () => {
    const home = await createTestTempDirectory("rea-grok-multiline-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      [
        'banner = ["""',
        "first",
        '""", """',
        "[mcp_servers.rea]",
        'command = "keep this text"',
        "[privacy]",
        "keep this too",
        '"""]',
        "",
        "marker = ['''",
        "first",
        "''', '''",
        "[mcp_servers.rea]",
        'command = "keep literal"',
        "''']",
        "",
      ].join("\n"),
    );
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured).toContain('command = "keep this text"');
    expect(configured).toContain("keep this too");
    expect(configured).toContain('command = "keep literal"');
    expect(parseToml(configured)).toMatchObject({
      banner: [
        "first\n",
        '[mcp_servers.rea]\ncommand = "keep this text"\n[privacy]\nkeep this too\n',
      ],
      marker: ["first\n", '[mcp_servers.rea]\ncommand = "keep literal"\n'],
      mcp_servers: {
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 30 },
      },
    });
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toEqual({ status: "unchanged" });
  });

  it("replaces a hex-escaped Grok REA header and keeps a hex-escaped foreign name", async () => {
    const home = await createTestTempDirectory("rea-grok-hex-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    const original = [
      '[mcp_servers."\\x72ea"]',
      'command = "rea"',
      'args = ["mcp"]',
      "",
      '[mcp_servers."rea\\x2Eenv"]',
      'command = "other"',
      'args = ["serve"]',
      "",
    ].join("\n");
    await writeFile(configPath, original);
    expect((await runUninstall(false, systemUninstallHost(home))).status).toBe(
      "complete",
    );
    const removed = await readFile(configPath, "utf8");
    expect(removed).toContain('[mcp_servers."rea\\x2Eenv"]');
    expect(removed).not.toContain("\\x72");
    expect(parseToml(removed)).toMatchObject({
      mcp_servers: { "rea.env": { command: "other", args: ["serve"] } },
    });
    expect(parseToml(removed)).not.toHaveProperty("mcp_servers.rea");

    await writeFile(configPath, original);
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured).not.toContain("\\x72");
    expect(configured).toContain('[mcp_servers."rea\\x2Eenv"]');
    expect(
      configured
        .split("\n")
        .filter((line) => line.trim() === "[mcp_servers.rea]"),
    ).toHaveLength(1);
    expect(parseToml(configured)).toMatchObject({
      mcp_servers: {
        "rea.env": { command: "other", args: ["serve"] },
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 30 },
      },
    });
  });
});

describe("Grok Build inline and dotted assignments", () => {
  it("updates and removes inline and dotted Grok REA assignments", async () => {
    const home = await createTestTempDirectory("rea-grok-assign-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    const inline = [
      "[mcp_servers]",
      'rea = """',
      "[mcp_servers.rea]",
      'command = "keep? no, this is the old value"',
      '"""',
      'other = { command = "other" }',
      "",
      "# next table",
      "[privacy]",
      "share = false",
      "",
    ].join("\n");
    await writeFile(configPath, inline);
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "failed", reason: "registration_ownership" });
    expect(await readFile(configPath, "utf8")).toBe(inline);
    await expect(readFile(`${configPath}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await writeFile(
      configPath,
      [
        "[mcp_servers]",
        'rea = { command = "npx", args = ["-y", "rea-agents@6.1.0", "mcp"] }',
        'other = { command = "other" }',
        "",
        "# next table",
        "[privacy]",
        "share = false",
        "",
      ].join("\n"),
    );
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configuredInline = await readFile(configPath, "utf8");
    expect(configuredInline).not.toContain("rea-agents@6.1.0");
    expect(configuredInline).toContain('other = { command = "other" }');
    expect(configuredInline).toContain("# next table");
    expect(configuredInline).toContain("[privacy]");
    expect(parseToml(configuredInline)).toMatchObject({
      mcp_servers: {
        other: { command: "other" },
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 30 },
      },
      privacy: { share: false },
    });
    expect(configuredInline).not.toContain("enabled");
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toEqual({ status: "unchanged" });
    expect((await runUninstall(false, systemUninstallHost(home))).status).toBe(
      "complete",
    );
    const removedInline = await readFile(configPath, "utf8");
    expect(removedInline).toContain('other = { command = "other" }');
    expect(removedInline).toContain("# next table");
    expect(parseToml(removedInline)).not.toHaveProperty("mcp_servers.rea");

    const dotted = [
      'mcp_servers.rea = { command = "rea", args = ["mcp"] }',
      'mcp_servers.other.command = "other"',
      "",
      "# next table",
      "[privacy]",
      "share = false",
      "",
    ].join("\n");
    await writeFile(configPath, dotted);
    expect((await runUninstall(false, systemUninstallHost(home))).status).toBe(
      "complete",
    );
    const removedDotted = await readFile(configPath, "utf8");
    expect(removedDotted).toContain('mcp_servers.other.command = "other"');
    expect(removedDotted).toContain("# next table");
    expect(parseToml(removedDotted)).toMatchObject({
      mcp_servers: { other: { command: "other" } },
      privacy: { share: false },
    });
    expect(parseToml(removedDotted)).not.toHaveProperty("mcp_servers.rea");

    await writeFile(
      configPath,
      [
        "[mcp_servers]",
        'rea.command = "npx"',
        'rea.args = ["-y", "rea-agents@6.1.0", "mcp"]',
        'other.command = "other"',
        "",
      ].join("\n"),
    );
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configuredDotted = await readFile(configPath, "utf8");
    expect(configuredDotted).toContain('other.command = "other"');
    expect(configuredDotted).not.toContain("rea-agents@6.1.0");
    expect(parseToml(configuredDotted)).toMatchObject({
      mcp_servers: {
        other: { command: "other" },
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 30 },
      },
    });
  });
});

describe("Grok Build closed inline tables", () => {
  it("splices REA into a closed mcp_servers inline table", async () => {
    const home = await createTestTempDirectory("rea-grok-inline-table-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    const original = [
      "# preamble",
      'mcp_servers = { other = { command = "other" }, "\\x72ea" = { command = "npx", args = ["-y", "rea-agents@6.1.0", "mcp"] } }',
      "",
      "# next table",
      "[privacy]",
      "share = false",
      "",
    ].join("\n");
    await writeFile(configPath, original);
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured).toContain("# preamble");
    expect(configured).toContain("# next table");
    expect(configured).toContain("[privacy]");
    expect(configured).toContain("mcp_servers =");
    expect(configured).not.toMatch(/^\[mcp_servers\.rea\]$/mu);
    expect(configured).not.toContain("\\x72");
    expect(parseToml(configured)).toMatchObject({
      mcp_servers: {
        other: { command: "other" },
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 30 },
      },
      privacy: { share: false },
    });
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toEqual({ status: "unchanged" });

    await writeFile(
      configPath,
      [
        'mcp_servers = { other = { command = "other" }, rea = { command = "rea", args = ["mcp"] } }',
        "",
      ].join("\n"),
    );
    expect((await runUninstall(false, systemUninstallHost(home))).status).toBe(
      "complete",
    );
    const removed = await readFile(configPath, "utf8");
    expect(removed).toContain('other = { command = "other" }');
    expect(removed).toContain("mcp_servers =");
    expect(parseToml(removed)).toMatchObject({
      mcp_servers: { other: { command: "other" } },
    });
    expect(parseToml(removed)).not.toHaveProperty("mcp_servers.rea");

    await writeFile(configPath, "mcp_servers = { }\n");
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const created = await readFile(configPath, "utf8");
    expect(created).toContain("mcp_servers =");
    expect(created).not.toMatch(/^\[mcp_servers\.rea\]$/mu);
    expect(parseToml(created)).toMatchObject({
      mcp_servers: {
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 30 },
      },
    });
  });

  it("keeps a quote that belongs to a multiline string closer", async () => {
    const home = await createTestTempDirectory("rea-grok-quotes-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      [
        'banner = ["""keep""""]',
        "marker = ['''keep'''']",
        "[mcp_servers.rea]",
        'command = "rea"',
        'args = ["mcp"]',
        "",
      ].join("\n"),
    );
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(parseToml(configured)).toMatchObject({
      banner: ['keep"'],
      marker: ["keep'"],
      mcp_servers: {
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 30 },
      },
    });
    expect(
      configured
        .split("\n")
        .filter((line) => line.trim() === "[mcp_servers.rea]"),
    ).toHaveLength(1);
  });
});

describe("Grok Build scalar and nested values", () => {
  it("preserves a basic string that uses the escape smol-toml accepts", async () => {
    const home = await createTestTempDirectory("rea-grok-escape-e-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      [
        'banner = "\\e[31m"',
        "[mcp_servers.rea]",
        'command = "rea"',
        'args = ["mcp"]',
        "",
      ].join("\n"),
    );
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured).toContain('banner = "\\e[31m"');
    expect(parseToml(configured)).toMatchObject({
      banner: "\u001b[31m",
      mcp_servers: {
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 30 },
      },
    });
  });

  it("updates a closed inline table whose last value is a scalar", async () => {
    const home = await createTestTempDirectory("rea-grok-scalar-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      'mcp_servers = { rea.command = "npx", rea.args = ["-y", "rea-agents@6.1.0", "mcp"], rea.startup_timeout_sec = 10 }\n',
    );
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured).not.toMatch(/^\[mcp_servers\.rea\]$/mu);
    expect(parseToml(configured)).toMatchObject({
      mcp_servers: {
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 10 },
      },
    });
  });

  it("removes a nested array inside a Grok REA table", async () => {
    const home = await createTestTempDirectory("rea-grok-nested-array-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    const original = [
      "[mcp_servers.rea]",
      'command = "rea"',
      'args = ["mcp"]',
      "extra = [",
      "  [1, 2],",
      "]",
      "",
      "[privacy]",
      "share = false",
      "",
    ].join("\n");
    await writeFile(configPath, original);
    expect((await runUninstall(false, systemUninstallHost(home))).status).toBe(
      "complete",
    );
    const removed = await readFile(configPath, "utf8");
    expect(removed).toContain("[privacy]");
    expect(removed).not.toContain("[1, 2]");
    expect(parseToml(removed)).toMatchObject({ privacy: { share: false } });
    expect(parseToml(removed)).not.toHaveProperty("mcp_servers.rea");

    await writeFile(configPath, original);
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured).toContain("[privacy]");
    expect(configured).not.toContain("[1, 2]");
    expect(parseToml(configured)).toMatchObject({
      privacy: { share: false },
      mcp_servers: {
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 30 },
      },
    });
  });
});

describe("Grok Build newlines and leading marks", () => {
  it("edits a BOM-prefixed Grok document without losing the first table", async () => {
    const home = await createTestTempDirectory("rea-grok-bom-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      '\uFEFF[profile]\nmcp_servers.rea = "keep this setting"\n',
    );
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured.startsWith("\uFEFF")).toBe(true);
    expect(configured).toContain('mcp_servers.rea = "keep this setting"');
    expect(parseToml(configured)).toMatchObject({
      profile: { mcp_servers: { rea: "keep this setting" } },
      mcp_servers: {
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 30 },
      },
    });

    await writeFile(
      configPath,
      '\uFEFF[mcp_servers.rea]\ncommand = "rea"\nargs = ["mcp"]\n',
    );
    expect((await runUninstall(false, systemUninstallHost(home))).status).toBe(
      "complete",
    );
    const removed = await readFile(configPath, "utf8");
    expect(removed.startsWith("\uFEFF")).toBe(true);
    expect(parseToml(removed)).not.toHaveProperty("mcp_servers.rea");
  });

  it("keeps CRLF string values in a Grok file that also uses LF", async () => {
    const home = await createTestTempDirectory("rea-grok-crlf-string-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    const original =
      'banner = """a\r\nb"""\n[mcp_servers.rea]\ncommand = "rea"\nargs = ["mcp"]\n';
    await writeFile(configPath, original);
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    expect(parseToml(await readFile(configPath, "utf8"))).toMatchObject({
      banner: "a\r\nb",
      mcp_servers: {
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 30 },
      },
    });

    await writeFile(configPath, original);
    expect((await runUninstall(false, systemUninstallHost(home))).status).toBe(
      "complete",
    );
    const removed = await readFile(configPath, "utf8");
    expect(parseToml(removed)).toMatchObject({ banner: "a\r\nb" });
    expect(parseToml(removed)).not.toHaveProperty("mcp_servers.rea");
  });

  it("keeps LF string values in a Grok file that also uses CRLF", async () => {
    const home = await createTestTempDirectory("rea-grok-mixed-newline-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      'banner = """keep\nthis LF"""\n[mcp_servers.rea]\r\ncommand = "rea"\r\nargs = ["mcp"]\r\n',
    );
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    expect(parseToml(await readFile(configPath, "utf8"))).toMatchObject({
      banner: "keep\nthis LF",
      mcp_servers: {
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 30 },
      },
    });
  });
});

describe("Grok Build inline comments", () => {
  it("keeps comments on dotted Grok fields without repeating a comma", async () => {
    const home = await createTestTempDirectory("rea-grok-dotted-comment-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    const original = [
      'mcp_servers = { other = {command="other"}, # keep other note',
      '  rea.command = "rea", # command note',
      '  rea.args = ["mcp"] }',
      "",
    ].join("\n");
    await writeFile(configPath, original);
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured).toContain("# keep other note");
    expect(configured).toContain("# command note");
    expect(parseToml(configured)).toMatchObject({
      mcp_servers: {
        other: { command: "other" },
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 30 },
      },
    });

    await writeFile(configPath, original);
    expect((await runUninstall(false, systemUninstallHost(home))).status).toBe(
      "complete",
    );
    const removed = await readFile(configPath, "utf8");
    expect(removed).toContain("# keep other note");
    expect(removed).toContain("# command note");
    expect(parseToml(removed)).toMatchObject({
      mcp_servers: { other: { command: "other" } },
    });
    expect(parseToml(removed)).not.toHaveProperty("mcp_servers.rea");
  });

  it("keeps an inline comment that sits before the Grok REA pair", async () => {
    const home = await createTestTempDirectory("rea-grok-inline-before-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    const original =
      'mcp_servers = { other = {command="other"}, # important other-server note\n  rea = {command="rea",args=["mcp"]} }\n';
    await writeFile(configPath, original);
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        undefined,
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured).toContain("# important other-server note");
    expect(parseToml(configured)).toMatchObject({
      mcp_servers: {
        other: { command: "other" },
        rea: { command: "rea", args: ["mcp"], startup_timeout_sec: 30 },
      },
    });

    await writeFile(configPath, original);
    expect((await runUninstall(false, systemUninstallHost(home))).status).toBe(
      "complete",
    );
    const removed = await readFile(configPath, "utf8");
    expect(removed).toContain("# important other-server note");
    expect(parseToml(removed)).toMatchObject({
      mcp_servers: { other: { command: "other" } },
    });
    expect(parseToml(removed)).not.toHaveProperty("mcp_servers.rea");
  });

  it("keeps inline-table comments and encodes a DEL in an inline value", async () => {
    const home = await createTestTempDirectory("rea-grok-inline-comment-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      'mcp_servers = { rea = {command="rea",args=["mcp"]}, # other: one, two\n  other = {command="other"} }\n',
    );
    expect(
      await configureClientConfiguration(
        { name: "grok_build", configPath, format: "grok" },
        { HOPPER_LAUNCHER_PATH: "/tmp/path\u007fwith-del" },
        ["rea", "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured).toContain("# other: one, two");
    expect(parseToml(configured)).toMatchObject({
      mcp_servers: {
        other: { command: "other" },
        rea: {
          command: "rea",
          args: ["mcp"],
          startup_timeout_sec: 30,
          env: { HOPPER_LAUNCHER_PATH: "/tmp/path\u007fwith-del" },
        },
      },
    });
  });

  it("keeps comments when uninstall removes the only inline Grok server", async () => {
    const home = await createTestTempDirectory("rea-grok-inline-empty-");
    const configPath = join(home, ".grok/config.toml");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      'mcp_servers = { # policy\n  rea = { command = "rea", args = ["mcp"] } # owned\n}\n',
    );
    expect((await runUninstall(false, systemUninstallHost(home))).status).toBe(
      "complete",
    );
    const removed = await readFile(configPath, "utf8");
    expect(removed).toContain("# policy");
    expect(removed).toContain("# owned");
    expect(parseToml(removed)).not.toHaveProperty("mcp_servers.rea");
  });
});

describe("JSON client configuration comments", () => {
  it("keeps a same-line JSONC comment when uninstall removes Cursor", async () => {
    const home = await createTestTempDirectory("rea-cursor-jsonc-comment-");
    const configPath = join(home, ".cursor/mcp.json");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      '{\n  "mcpServers": {\n    "other": {"command":"other"}, // important other-server note\n    "rea": {"command":"rea","args":["mcp"]}\n  }\n}\n',
    );
    expect((await runUninstall(false, systemUninstallHost(home))).status).toBe(
      "complete",
    );
    const removed = await readFile(configPath, "utf8");
    expect(removed).toContain("// important other-server note");
    const errors: ParseError[] = [];
    const document = parseJsonc(removed, errors, { allowTrailingComma: true });
    expect(errors).toEqual([]);
    expect(document).toEqual({
      mcpServers: { other: { command: "other" } },
    });
  });

  it("keeps a JSONC comment when a block comment precedes the comma", async () => {
    const home = await createTestTempDirectory("rea-cursor-jsonc-block-");
    const configPath = join(home, ".cursor/mcp.json");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      '{"mcpServers":{\n  "other":{"command":"other"}, // keep other note\n  "rea":{"command":"rea","args":["mcp"]} /**/,\n  "keep":{"command":"keep"}\n}}\n',
    );
    expect((await runUninstall(false, systemUninstallHost(home))).status).toBe(
      "complete",
    );
    const removed = await readFile(configPath, "utf8");
    expect(removed).toContain("// keep other note");
    const errors: ParseError[] = [];
    const document = parseJsonc(removed, errors, { allowTrailingComma: true });
    expect(errors).toEqual([]);
    expect(document).toEqual({
      mcpServers: {
        other: { command: "other" },
        keep: { command: "keep" },
      },
    });
  });

  it("keeps a JSONC comment without swallowing the next server or closers", async () => {
    const home = await createTestTempDirectory("rea-cursor-jsonc-next-");
    const configPath = join(home, ".cursor/mcp.json");
    await mkdir(dirname(configPath), { recursive: true });
    const files = [
      '{\n  "mcpServers": {\n    "other": {"command":"other"}, // important other-server note\n    "rea": {"command":"rea","args":["mcp"]}, "keep": {"command":"keep"}\n  }\n}\n',
      '{\n  "mcpServers": {\n    "other": {"command":"other"}, // important other-server note\n    "rea": {"command":"rea","args":["mcp"]}}}\n',
    ];
    for (const original of files) {
      await writeFile(configPath, original);
      expect(
        (await runUninstall(false, systemUninstallHost(home))).status,
      ).toBe("complete");
      const removed = await readFile(configPath, "utf8");
      expect(removed).toContain("// important other-server note");
      const errors: ParseError[] = [];
      const document = parseJsonc(removed, errors, {
        allowTrailingComma: true,
      });
      expect(errors).toEqual([]);
      expect(document).toMatchObject({
        mcpServers: { other: { command: "other" } },
      });
      if (original.includes('"keep"'))
        expect(document).toMatchObject({
          mcpServers: { keep: { command: "keep" } },
        });
    }
  });
});

describe("Grok Bot registration", () => {
  it("does not write or align a data-directory mcp.json", async () => {
    const home = await createTestTempDirectory("rea-grokbot-");
    const directory = join(home, ".grokbot");
    const configPath = join(directory, "mcp.json");
    await mkdir(directory, { recursive: true });
    const original =
      '{"mcpServers":{"other":{"command":"other"},"rea":{"command":"rea","args":["mcp"]}}}\n';
    await writeFile(configPath, original);
    const client = supportedClients(home).find(
      ({ name }) => name === "grok_bot",
    );
    if (client === undefined) throw new Error("missing grok_bot");
    expect(client.format).toBe("unsupported");
    expect(client.configPath).toBe(directory);
    expect(
      await systemSetupHost().configureClient(client, {}, ["rea", "mcp"]),
    ).toEqual({ status: "skipped" });
    expect(await readFile(configPath, "utf8")).toBe(original);
    expect(
      await readClientRegistrationStatuses(home, "/current/rea", {
        environment: {},
      }),
    ).toEqual([
      expect.objectContaining({
        client: "grok_bot",
        config_path: directory,
        state: "manual",
        command: [],
      }),
    ]);
    const removed = await runUninstall(false, systemUninstallHost(home));
    expect(removed.status).toBe("complete");
    expect(removed.items).toContainEqual(
      expect.objectContaining({ name: "grok_bot", status: "skipped" }),
    );
    expect(await readFile(configPath, "utf8")).toBe(original);
  });
});

describe("Codex configuration comments", () => {
  it("keeps Codex comments and value spelling through setup and uninstall", async () => {
    const home = await createTestTempDirectory("rea-toml-comments-");
    const configPath = join(home, ".codex/config.toml");
    const original =
      '# Keep this explanation.\nnotify = ["a", "b"]\nliteral = \'C:\\demo\\path\'\n';
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, original);

    expect(
      await configureClientConfiguration(
        { name: "codex", configPath, format: "toml" },
        {},
        [PRODUCT_IDENTITY.cliBinary, "mcp"],
      ),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(configPath, "utf8");
    expect(configured.startsWith(original)).toBe(true);
    expect(configured).toContain("[mcp_servers.rea]");

    const removed = await runUninstall(false, systemUninstallHost(home));
    expect(removed.items).toContainEqual(
      expect.objectContaining({ name: "codex", status: "removed" }),
    );
    expect(await readFile(configPath, "utf8")).toBe(original);
  });
});

describe("managed data purge root validation", () => {
  it.each(["existing", "dangling"] as const)(
    "retains cache and state when the managed-root symlink is %s",
    async (targetState) => {
      const root = await createTestTempDirectory("rea-uninstall-data-root-");
      const home = join(root, "home");
      const outside = join(root, "unrelated-application");
      await mkdir(home);
      if (targetState === "existing")
        for (const name of ["cache", "state"]) {
          await mkdir(join(outside, name), { recursive: true });
          await writeFile(join(outside, name, "keep.txt"), "unrelated data");
        }
      const managedRoot = join(home, ".rea");
      await symlink(
        outside,
        managedRoot,
        process.platform === "win32" ? "junction" : "dir",
      );

      const result = await runUninstall(
        true,
        systemUninstallHost(home, undefined, {}),
      );

      expect(result.status).toBe("complete");
      expect((await lstat(managedRoot)).isSymbolicLink()).toBe(true);
      for (const name of ["cache", "state"])
        expect(result.items).toContainEqual(
          expect.objectContaining({ name, status: "retained" }),
        );
      if (targetState === "existing")
        for (const name of ["cache", "state"])
          expect(await readFile(join(outside, name, "keep.txt"), "utf8")).toBe(
            "unrelated data",
          );
      else
        await expect(lstat(outside)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("retains a managed data root that is not a directory", async () => {
    const home = await createTestTempDirectory("rea-uninstall-data-file-");
    const managedRoot = join(home, ".rea");
    await writeFile(managedRoot, "unrelated file");

    const result = await runUninstall(
      true,
      systemUninstallHost(home, undefined, {}),
    );

    expect(result.status).toBe("complete");
    for (const name of ["cache", "state"])
      expect(result.items).toContainEqual(
        expect.objectContaining({ name, status: "retained" }),
      );
    expect(await readFile(managedRoot, "utf8")).toBe("unrelated file");
  });

  it("purges ordinary managed data through a legitimate home directory link", async () => {
    const root = await createTestTempDirectory("rea-uninstall-home-link-");
    const home = join(root, "actual-home");
    const linkedHome = join(root, "linked-home");
    const managedRoot = join(home, ".rea");
    for (const name of ["cache", "state"]) {
      await mkdir(join(managedRoot, name), { recursive: true });
      await writeFile(join(managedRoot, name, "data.txt"), "managed data");
    }
    await writeFile(join(managedRoot, "keep.txt"), "other data");
    await symlink(
      home,
      linkedHome,
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = await runUninstall(
      true,
      systemUninstallHost(linkedHome, undefined, {}),
    );

    expect(result.status).toBe("complete");
    for (const name of ["cache", "state"]) {
      expect(result.items).toContainEqual(
        expect.objectContaining({ name, status: "removed" }),
      );
      await expect(lstat(join(managedRoot, name))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
    expect((await lstat(linkedHome)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(managedRoot, "keep.txt"), "utf8")).toBe(
      "other data",
    );
  });

  it("reports root inspection failure without removing managed data", async () => {
    const home = await createTestTempDirectory("rea-uninstall-data-denied-");
    const managedRoot = join(home, ".rea");
    for (const name of ["cache", "state"]) {
      await mkdir(join(managedRoot, name), { recursive: true });
      await writeFile(join(managedRoot, name, "keep.txt"), "managed data");
    }
    const remove = vi.fn(testFileSystem.remove);
    const result = await runUninstall(
      true,
      systemUninstallHost(
        home,
        {
          ...testFileSystem,
          stat: (path) =>
            path === managedRoot
              ? Promise.reject(
                  Object.assign(new Error("root inspection denied"), {
                    code: "EACCES",
                  }),
                )
              : lstat(path),
          remove,
        },
        {},
      ),
    );

    expect(result.status).toBe("failed");
    expect(remove).not.toHaveBeenCalled();
    for (const name of ["cache", "state"]) {
      expect(result.items).toContainEqual(
        expect.objectContaining({ name, status: "failed" }),
      );
      expect(await readFile(join(managedRoot, name, "keep.txt"), "utf8")).toBe(
        "managed data",
      );
    }
  });
});

describe("client configuration filesystem removal", () => {
  it("uninstalls only owned entries and refuses purge symlinks", async () => {
    const home = await createTestTempDirectory("rea-uninstall-");
    const cursor = join(home, ".cursor/mcp.json");
    const skill = join(
      home,
      ".agents/skills/reverse-engineer-anything/SKILL.md",
    );
    await mkdir(dirname(cursor), { recursive: true });
    await mkdir(dirname(skill), { recursive: true });
    await writeFile(
      cursor,
      JSON.stringify({
        mcpServers: {
          rea: { command: PRODUCT_IDENTITY.cliBinary, args: ["mcp"] },
          other: { command: "other" },
        },
      }),
    );
    await writeFile(skill, ownedSkillManifest);
    await mkdir(join(home, ".rea"), { recursive: true });
    await import("node:fs/promises").then(({ symlink }) =>
      symlink(home, join(home, ".rea/cache")),
    );
    const first = await runUninstall(true, systemUninstallHost(home));
    expect(first.status).toBe("complete");
    expect(JSON.parse(await readFile(cursor, "utf8"))).toEqual({
      mcpServers: { other: { command: "other" } },
    });
    await expect(readFile(skill, "utf8")).rejects.toThrow();
    expect(first.items).toContainEqual(
      expect.objectContaining({
        name: "cache",
        status: "retained",
        detail:
          "REA did not remove this item because its managed path is a symbolic link. Verify the link target before removing it manually.",
      }),
    );
    expect((await runUninstall(true, systemUninstallHost(home))).status).toBe(
      "complete",
    );
  });

  it("removes emptied skill directories and keeps ones with user files", async () => {
    const home = await createTestTempDirectory("rea-uninstall-skill-dirs-");
    const shared = join(home, ".agents/skills/reverse-engineer-anything");
    const claude = join(home, ".claude/skills/reverse-engineer-anything");
    for (const root of [shared, claude]) {
      await mkdir(join(root, "references"), { recursive: true });
      await writeFile(join(root, "SKILL.md"), ownedSkillManifest);
      await writeFile(
        join(root, "references/evidence-workflows.md"),
        "managed",
      );
    }
    await writeFile(join(claude, "notes.md"), "user");

    const result = await runUninstall(
      false,
      systemUninstallHost(home, undefined, {
        HOME: home,
        CLAUDE_CONFIG_DIR: join(home, ".claude"),
      }),
    );

    expect(result.status).toBe("complete");
    await expect(lstat(shared)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(claude, "references"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(join(claude, "notes.md"), "utf8")).toBe("user");
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports an emptied skill directory that cannot be removed",
    async () => {
      const home = await createTestTempDirectory("rea-uninstall-skill-perm-");
      const parent = join(home, ".agents/skills");
      const root = join(parent, "reverse-engineer-anything");
      await mkdir(join(root, "references"), { recursive: true });
      await writeFile(join(root, "SKILL.md"), ownedSkillManifest);
      await chmod(parent, 0o555);
      try {
        const result = await runUninstall(
          false,
          systemUninstallHost(home, undefined, { HOME: home }),
        );
        expect(result.status).toBe("failed");
        expect(result.items).toContainEqual(
          expect.objectContaining({
            name: "skill",
            status: "failed",
            detail: expect.stringContaining(
              `Managed skill directory could not be removed: ${root}.`,
            ),
          }),
        );
      } finally {
        await chmod(parent, 0o755);
      }
    },
  );
});

describe("uninstall configuration symlink ownership", () => {
  it("removes an owned entry through a symlink without replacing it", async () => {
    const home = await createTestTempDirectory("rea-uninstall-symlink-");
    const configPath = join(home, ".cursor/mcp.json");
    const targetPath = join(home, "managed-mcp.json");
    const original = JSON.stringify({
      mcpServers: {
        rea: { command: "rea", args: ["mcp"] },
        other: { command: "other" },
      },
    });
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(targetPath, original);
    await symlink(targetPath, configPath);

    const result = await runUninstall(false, systemUninstallHost(home));
    expect(result.status).toBe("complete");
    expect(result.items).toContainEqual(
      expect.objectContaining({
        name: "cursor",
        status: "removed",
        configuration_path: configPath,
      }),
    );
    expect((await lstat(configPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(`${configPath}.rea.backup`, "utf8")).toBe(original);
    expect(JSON.parse(await readFile(targetPath, "utf8"))).toEqual({
      mcpServers: { other: { command: "other" } },
    });
  });

  it("fails before mutation when an uninstall config symlink is dangling", async () => {
    const home = await createTestTempDirectory("rea-uninstall-symlink-");
    const configPath = join(home, ".cursor/mcp.json");
    await mkdir(dirname(configPath), { recursive: true });
    await symlink(join(home, "missing-mcp.json"), configPath);

    const result = await runUninstall(false, systemUninstallHost(home));
    expect(result.status).toBe("failed");
    expect(result.items).toContainEqual({
      name: "cursor",
      status: "failed",
      configuration_path: configPath,
      detail:
        "Configuration path could not be safely verified. Check its permissions and, if it is a symbolic link, verify that the link resolves to a regular file owned by the current user, then rerun uninstall.",
    });
    expect((await lstat(configPath)).isSymbolicLink()).toBe(true);
    await expect(
      readFile(`${configPath}.rea.backup`, "utf8"),
    ).rejects.toThrow();
  });
});

describe("uninstall registration ownership preflight", () => {
  it("removes repeated owned registrations from the table the client reads", async () => {
    const home = await createTestTempDirectory("rea-uninstall-repeated-owned-");
    const config = join(home, ".claude.json");
    await mkdir(dirname(config), { recursive: true });
    const owned = {
      command: PRODUCT_IDENTITY.cliBinary,
      args: ["mcp"],
    };
    const original =
      `{"mcpServers":{"rea":${JSON.stringify(owned)},` +
      `"peer":{"command":"peer"},` +
      `"rea":${JSON.stringify(owned)}}}\n`;
    await writeFile(config, original);

    const result = await runUninstall(false, systemUninstallHost(home));

    expect(result.status).toBe("complete");
    expect(result.items).toContainEqual(
      expect.objectContaining({ name: "claude_code", status: "removed" }),
    );
    expect(JSON.parse(await readFile(config, "utf8"))).toEqual({
      mcpServers: { peer: { command: "peer" } },
    });
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
  });

  it("refuses an unowned repeat before changing any client or making backups", async () => {
    const home = await createTestTempDirectory(
      "rea-uninstall-repeated-foreign-",
    );
    const claude = join(home, ".claude.json");
    const cursor = join(home, ".cursor/mcp.json");
    await mkdir(dirname(claude), { recursive: true });
    await mkdir(dirname(cursor), { recursive: true });
    const owned = {
      command: PRODUCT_IDENTITY.cliBinary,
      args: ["mcp"],
    };
    const claudeOriginal = JSON.stringify({ mcpServers: { rea: owned } });
    const cursorOriginal = `{"mcpServers":{"rea":null,"rea":${JSON.stringify(owned)}}}`;
    await writeFile(claude, claudeOriginal);
    await writeFile(cursor, cursorOriginal);

    const result = await runUninstall(false, systemUninstallHost(home));

    expect(result.status).toBe("failed");
    expect(result.items).toContainEqual(
      expect.objectContaining({ name: "cursor", status: "failed" }),
    );
    expect(result.items).toContainEqual(
      expect.objectContaining({ name: "uninstall", status: "skipped" }),
    );
    expect(await readFile(claude, "utf8")).toBe(claudeOriginal);
    expect(await readFile(cursor, "utf8")).toBe(cursorOriginal);
    await expect(
      readFile(`${claude}.rea.backup`, "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(`${cursor}.rea.backup`, "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps an owned OpenCode V2 registration when its V1 fallback is foreign", async () => {
    const home = await createTestTempDirectory(
      "rea-uninstall-opencode-fallback-",
    );
    const config = join(home, ".config/opencode/opencode.json");
    await mkdir(dirname(config), { recursive: true });
    const original = JSON.stringify({
      mcp: {
        servers: {
          rea: {
            type: "local",
            command: [PRODUCT_IDENTITY.cliBinary, "mcp"],
            enabled: true,
          },
        },
        rea: { type: "local", command: ["/usr/bin/false"] },
      },
    });
    await writeFile(config, original);

    const result = await runUninstall(false, systemUninstallHost(home));

    expect(result.status).toBe("failed");
    expect(result.items).toContainEqual(
      expect.objectContaining({ name: "opencode", status: "failed" }),
    );
    expect(await readFile(config, "utf8")).toBe(original);
    await expect(
      readFile(`${config}.rea.backup`, "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("layered uninstall outcomes", () => {
  it("reports an earlier layered OpenCode removal when a later backup is blocked", async () => {
    const home = await createTestTempDirectory(
      "rea-uninstall-opencode-layers-",
    );
    const directory = join(home, ".config/opencode");
    const json = join(directory, "opencode.json");
    const jsonc = join(directory, "opencode.jsonc");
    const blocker = `${jsonc}.rea.backup`;
    await mkdir(directory, { recursive: true });
    const registration = {
      type: "local",
      command: [PRODUCT_IDENTITY.cliBinary, "mcp"],
      enabled: true,
    };
    const jsonOriginal = JSON.stringify({
      mcp: { servers: { rea: registration } },
    });
    const jsoncOriginal = `// OpenCode's later JSONC layer\n${JSON.stringify({
      mcp: { servers: { rea: registration } },
    })}\n`;
    await writeFile(json, jsonOriginal);
    await writeFile(jsonc, jsoncOriginal);
    await mkdir(blocker);

    const host = systemUninstallHost(home);
    const blocked = await runUninstall(false, {
      ...host,
      close: async () => {
        await host.close?.();
        return "Controlled final cleanup diagnostic.";
      },
    });

    expect(blocked.status).toBe("failed");
    expect(await readFile(json, "utf8")).not.toContain('"rea"');
    expect(await readFile(jsonc, "utf8")).toBe(jsoncOriginal);
    const client = blocked.items.find(({ name }) => name === "opencode");
    expect(client?.status).toBe("failed");
    expect(client?.detail).toContain(`Removed registration from ${json}.`);
    expect(client?.detail).toContain("Configuration could not be backed up");
    expect(client?.detail).toContain("Check file permissions");
    expect(client?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          configuration_path: json,
          status: "removed",
        }),
        expect.objectContaining({
          configuration_path: jsonc,
          status: "failed",
        }),
      ]),
    );
    expect(
      client?.actions?.filter(
        ({ configuration_path }) => configuration_path === json,
      ),
    ).toHaveLength(1);
    expect(blocked.items).toContainEqual({
      name: "uninstall_cleanup",
      status: "failed",
      detail: "Controlled final cleanup diagnostic.",
    });

    await rm(blocker, { recursive: true });
    const recovered = await runUninstall(false, systemUninstallHost(home));

    expect(recovered.status).toBe("complete");
    expect(recovered.items).toContainEqual(
      expect.objectContaining({ name: "opencode", status: "removed" }),
    );
    expect(parseJsonc(await readFile(jsonc, "utf8"))).toEqual({
      mcp: { servers: {} },
    });
  });
});

describe("uninstall configuration preflight", () => {
  it("fails closed on malformed client configuration", async () => {
    const home = await createTestTempDirectory("rea-uninstall-bad-");
    const config = join(home, ".cursor/mcp.json");
    await mkdir(dirname(config), { recursive: true });
    await writeFile(config, "not-json");
    const result = await runUninstall(false, systemUninstallHost(home));
    expect(result.status).toBe("failed");
    expect(result.items).toContainEqual(
      expect.objectContaining({
        name: "cursor",
        status: "failed",
        detail:
          "Configuration is not valid JSON and was not changed. Repair it, then rerun uninstall.",
      }),
    );
    expect(await readFile(config, "utf8")).toBe("not-json");
  });

  it.each([
    ['{"mcpServers":null,"keep":1}', '"mcpServers" must be an object'],
    ["[]", "The configuration root must be an object"],
    ['{"mcpServers":"x"}', '"mcpServers" must be an object'],
  ])(
    "names the structural problem in valid JSON %s",
    async (content, problem) => {
      const home = await createTestTempDirectory("rea-uninstall-shape-");
      const config = join(home, ".cursor/mcp.json");
      await mkdir(dirname(config), { recursive: true });
      await writeFile(config, content);
      expect(await readConfigurationFile(config, "json")).toMatchObject({
        ok: false,
        error: {
          kind: "malformed",
          detail: `Configuration ${config} is malformed: ${problem}`,
        },
      });
      const result = await runUninstall(false, systemUninstallHost(home));
      expect(result.status).toBe("failed");
      expect(result.items).toContainEqual({
        name: "cursor",
        status: "failed",
        configuration_path: config,
        detail: `Configuration was not changed: ${problem}. Repair it, then rerun uninstall.`,
      });
      expect(await readFile(config, "utf8")).toBe(content);
      await expect(readFile(`${config}.rea.backup`, "utf8")).rejects.toThrow();
    },
  );

  it("stops before any removal when one client configuration is malformed", async () => {
    const home = await createTestTempDirectory("rea-uninstall-stop-");
    const codex = join(home, ".codex/config.toml");
    const cursor = join(home, ".cursor/mcp.json");
    const skillMarker = join(
      home,
      ".agents/skills/reverse-engineer-anything/marker.txt",
    );
    const managed = [
      skillMarker,
      join(home, ".rea/cache/marker.txt"),
      join(home, ".rea/state/marker.txt"),
    ];
    const cursorConfig = JSON.stringify({
      mcpServers: {
        rea: { command: "npx", args: ["-y", "rea-agents@6.1.0", "mcp"] },
        other: { command: "echo", args: ["hello"] },
      },
    });
    for (const path of [codex, cursor, ...managed])
      await mkdir(dirname(path), { recursive: true });
    await writeFile(codex, "[mcp_servers.rea]\ncommand = [broken\n");
    await writeFile(cursor, cursorConfig);
    for (const path of managed) await writeFile(path, "marker");
    const manifest = join(dirname(skillMarker), "SKILL.md");
    await writeFile(manifest, ownedSkillManifest);

    const stopped = await runUninstall(true, systemUninstallHost(home));

    expect(stopped.status).toBe("failed");
    expect(stopped.items.map(({ name, status }) => [name, status])).toEqual([
      ["codex", "failed"],
      ["uninstall", "skipped"],
      ["analysis_engine", "retained"],
    ]);
    expect(await readFile(codex, "utf8")).toBe(
      "[mcp_servers.rea]\ncommand = [broken\n",
    );
    expect(await readFile(cursor, "utf8")).toBe(cursorConfig);
    for (const path of managed)
      expect(await readFile(path, "utf8")).toBe("marker");
    expect(await readFile(manifest, "utf8")).toBe(ownedSkillManifest);

    await writeFile(codex, "");
    const repaired = await runUninstall(true, systemUninstallHost(home));
    expect(repaired.status).toBe("complete");
    expect(JSON.parse(await readFile(cursor, "utf8"))).toEqual({
      mcpServers: { other: { command: "echo", args: ["hello"] } },
    });
    // Uninstall removes only the managed bundle, never arbitrary skill files.
    expect(await readFile(skillMarker, "utf8")).toBe("marker");
    await expect(readFile(manifest, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    for (const path of managed.slice(1))
      await expect(readFile(path, "utf8")).rejects.toThrow();
  });
});

describe("client configuration changed during uninstall", () => {
  it("rechecks duplicate ownership after preflight and keeps the changed source", async () => {
    const home = await createTestTempDirectory("rea-uninstall-repeat-race-");
    const cursor = join(home, ".cursor/mcp.json");
    await mkdir(dirname(cursor), { recursive: true });
    const owned = {
      command: PRODUCT_IDENTITY.cliBinary,
      args: ["mcp"],
    };
    const original = JSON.stringify({ mcpServers: { rea: owned } });
    const changed = `{"mcpServers":{"rea":null,"rea":${JSON.stringify(owned)}}}`;
    await writeFile(cursor, original);
    let reads = 0;
    const fileSystem: UninstallFileSystem = {
      ...testFileSystem,
      readText: async (path) => {
        if (path !== cursor) return readFile(path, "utf8");
        reads += 1;
        if (reads === 2) await writeFile(cursor, changed);
        return readFile(path, "utf8");
      },
    };

    const result = await runUninstall(
      false,
      systemUninstallHost(home, fileSystem),
    );

    expect(reads).toBe(2);
    expect(result.status).toBe("failed");
    expect(result.items).toContainEqual(
      expect.objectContaining({ name: "cursor", status: "failed" }),
    );
    expect(await readFile(cursor, "utf8")).toBe(changed);
    await expect(
      readFile(`${cursor}.rea.backup`, "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stops the remaining removals when a configuration fails after preflight", async () => {
    const home = await createTestTempDirectory("rea-uninstall-race-");
    const codex = join(home, ".codex/config.toml");
    const cursor = join(home, ".cursor/mcp.json");
    const skill = join(
      home,
      ".agents/skills/reverse-engineer-anything/SKILL.md",
    );
    const cursorConfig = JSON.stringify({
      mcpServers: { rea: { command: "rea", args: ["mcp"] } },
    });
    for (const path of [codex, cursor, skill])
      await mkdir(dirname(path), { recursive: true });
    await writeFile(
      codex,
      '[mcp_servers.rea]\ncommand = "rea"\nargs = ["mcp"]\n',
    );
    await writeFile(cursor, cursorConfig);
    await writeFile(skill, "managed");
    let codexReads = 0;
    const fileSystem: UninstallFileSystem = {
      ...testFileSystem,
      // The preflight read succeeds; the removal reread finds a broken file.
      readText: (path) => {
        if (path !== codex) return readFile(path, "utf8");
        codexReads += 1;
        return codexReads === 1
          ? readFile(path, "utf8")
          : Promise.resolve("[mcp_servers.rea]\ncommand = [broken\n");
      },
    };

    const result = await runUninstall(
      false,
      systemUninstallHost(home, fileSystem),
    );

    expect(result.status).toBe("failed");
    // Clients ordered before Codex have no configuration in this home.
    expect(
      result.items
        .filter(({ status }) => status !== "skipped")
        .map(({ name, status }) => [name, status]),
    ).toEqual([
      ["codex", "failed"],
      ["analysis_engine", "retained"],
    ]);
    expect(result.items.map(({ name }) => name)).not.toContain("cursor");
    expect(result.items.at(-2)).toMatchObject({
      name: "uninstall",
      status: "skipped",
    });
    expect(await readFile(cursor, "utf8")).toBe(cursorConfig);
    expect(await readFile(skill, "utf8")).toBe("managed");
  });
});

describe("client configuration filesystem failure reporting", () => {
  it.each([
    [
      "read",
      () =>
        "Configuration could not be read. Check file permissions, then rerun uninstall.",
    ],
    [
      "backup",
      () =>
        "Configuration could not be backed up, so no change was made. Check file permissions, then rerun uninstall.",
    ],
    [
      "update",
      (config: string) =>
        `Configuration could not be updated. The original was restored and its backup at ${config}.rea.backup was retained. Repair the configuration or restore that backup, then rerun uninstall.`,
    ],
    [
      "publication",
      (config: string) =>
        `Configuration could not be updated or restored. Restore the backup at ${config}.rea.backup manually, then rerun uninstall.`,
    ],
    [
      "restore",
      (config: string) =>
        `Configuration could not be updated or restored. Restore the backup at ${config}.rea.backup manually, then rerun uninstall.`,
    ],
  ] as const)(
    "reports an actionable client %s failure",
    async (failure, expectedDetail) => {
      const { home, config } = await uninstallFixture();
      const detail = expectedDetail(config);
      const fileSystem: UninstallFileSystem = {
        ...testFileSystem,
        readText: (path) =>
          failure === "read" && path === config
            ? Promise.reject(new Error("SECRET read failure"))
            : readFile(path, "utf8"),
        copy: (source, destination) =>
          failure === "backup"
            ? Promise.reject(new Error("SECRET backup failure"))
            : copyFile(source, destination, fsConstants.COPYFILE_EXCL),
        publishConfiguration: async (path, contents, original) => {
          if (failure === "publication")
            throw new Error("SECRET publication failure");
          const publication = await ClientConfigurationPublication.write(
            path,
            contents,
            original,
          );
          if (failure === "update" || failure === "restore")
            publication.assertCurrent = async () => {
              throw new Error("SECRET verification failure");
            };
          if (failure === "restore")
            publication.restore = async () => {
              throw new Error("SECRET restore failure");
            };
          return publication;
        },
      };
      const result = await runUninstall(
        false,
        systemUninstallHost(home, fileSystem),
      );
      expect(result.status).toBe("failed");
      expect(result.items).toContainEqual(
        expect.objectContaining({ name: "cursor", status: "failed", detail }),
      );
      expect(JSON.stringify(result)).not.toContain("SECRET");
    },
  );

  it("restores the current configuration without replacing its initial backup", async () => {
    const { home, config } = await uninstallFixture();
    const current = await readFile(config, "utf8");
    const initial = '{"existing":true}\n';
    await writeFile(`${config}.rea.backup`, initial);
    const result = await systemUninstallHost(home, {
      ...testFileSystem,
      publishConfiguration: async (path, contents, original) => {
        const publication = await ClientConfigurationPublication.write(
          path,
          contents,
          original,
        );
        publication.assertCurrent = async () => {
          throw new Error("verification failed after writing");
        };
        return publication;
      },
    }).removeClient({ name: "cursor", format: "json", configPath: config });
    expect(result.status).toBe("failed");
    expect(await readFile(config, "utf8")).toBe(current);
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(initial);
  });

  it("reports a managed-path removal failure", async () => {
    const home = await createTestTempDirectory("rea-uninstall-remove-");
    const skillRoot = join(home, ".agents/skills/reverse-engineer-anything");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), ownedSkillManifest);
    const result = await runUninstall(
      false,
      systemUninstallHost(home, {
        ...testFileSystem,
        remove: () => Promise.reject(new Error("SECRET removal failure")),
      }),
    );
    const skillItem = result.items.find(({ name }) => name === "skill");
    expect(skillItem?.status).toBe("failed");
    expect(skillItem?.detail).toContain(`shared (${skillRoot}): failed (`);
    expect(skillItem?.detail).toContain(
      `Managed file could not be removed: ${join(skillRoot, "SKILL.md")}`,
    );
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(await readFile(join(skillRoot, "SKILL.md"), "utf8")).toBe(
      ownedSkillManifest,
    );
  });

  it("uninstalls all managed skill roots, including a custom Claude Code directory", async () => {
    const home = await createTestTempDirectory("rea-uninstall-skills-");
    const customClaudeDirectory = join(home, "claude-config");
    const rootsToRemove = [
      join(home, ".agents/skills/reverse-engineer-anything"),
      join(customClaudeDirectory, "skills/reverse-engineer-anything"),
    ];
    await Promise.all(
      rootsToRemove.map(async (path) => {
        await mkdir(path, { recursive: true });
        await writeFile(join(path, "SKILL.md"), ownedSkillManifest);
        await writeFile(join(path, "user-notes.txt"), "user-authored");
      }),
    );

    const result = await systemUninstallHost(home, testFileSystem, {
      CLAUDE_CONFIG_DIR: customClaudeDirectory,
    }).removeSkill();

    expect(result).toMatchObject({ status: "removed" });
    await Promise.all(
      rootsToRemove.map(async (path) => {
        await expect(
          readFile(join(path, "SKILL.md"), "utf8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
        expect(await readFile(join(path, "user-notes.txt"), "utf8")).toBe(
          "user-authored",
        );
      }),
    );
  });
});

describe("skill root client identifier labels", () => {
  it("labels each retained or removed skill root by its client identifier", async () => {
    const home = await createTestTempDirectory("rea-uninstall-skill-labels-");
    const customClaudeDirectory = join(home, "claude-config");
    const sharedRoot = join(home, ".agents/skills/reverse-engineer-anything");
    const claudeRoot = join(
      customClaudeDirectory,
      "skills/reverse-engineer-anything",
    );
    await mkdir(sharedRoot, { recursive: true });
    await mkdir(claudeRoot, { recursive: true });
    await writeFile(
      join(sharedRoot, "SKILL.md"),
      "---\nname: another-skill\n---\n# Not REA-owned\n",
    );
    await writeFile(join(claudeRoot, "SKILL.md"), ownedSkillManifest);

    const skillItem = await systemUninstallHost(home, testFileSystem, {
      CLAUDE_CONFIG_DIR: customClaudeDirectory,
    }).removeSkill();

    expect(skillItem.name).toBe("skill");
    expect(skillItem.detail).toContain(`shared (${sharedRoot}): retained (`);
    expect(skillItem.detail).toContain(
      `claude_code (${claudeRoot}): removed (`,
    );
    await expect(
      readFile(join(claudeRoot, "SKILL.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(sharedRoot, "SKILL.md"), "utf8")).toContain(
      "another-skill",
    );
  });
});

const testFileSystem: UninstallFileSystem = {
  readText: (path) => readFile(path, "utf8"),
  copy: (source, destination) =>
    copyFile(source, destination, fsConstants.COPYFILE_EXCL),
  publishConfiguration: (path, contents, original) =>
    ClientConfigurationPublication.write(path, contents, original),
  stat: (path) => lstat(path),
  realpath: (path) => realpath(path),
  remove: (path) => rm(path, { recursive: true }),
};

const uninstallFixture = async (): Promise<{
  readonly home: string;
  readonly config: string;
}> => {
  const home = await createTestTempDirectory("rea-uninstall-failure-");
  const config = join(home, ".cursor/mcp.json");
  await mkdir(dirname(config), { recursive: true });
  await writeFile(
    config,
    JSON.stringify({ mcpServers: { rea: { command: "rea", args: ["mcp"] } } }),
  );
  return { home, config };
};
