import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";
import { parseClientConfiguration } from "../../../src/application/ClientConfigurationDocument.js";
import {
  configureClientConfiguration,
  inspectClientConfiguration,
} from "../../../src/application/SetupClientConfiguration.js";
import { detectClients } from "../../../src/application/SetupHost.js";
import { supportedClients } from "../../../src/application/SupportedClients.js";
import { systemUninstallHost } from "../../../src/application/Uninstall.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { clearClientLocationEnvironment } from "../../fixtures/clientEnvironment.js";

beforeEach(clearClientLocationEnvironment);
afterEach(() => vi.unstubAllEnvs());

const piPath = (
  home: string,
  platform: NodeJS.Platform,
  env: Parameters<typeof supportedClients>[2],
) => supportedClients(home, platform, env).find(({ name }) => name === "pi");

// Catch fallback to OMP paths, loss of relative overrides, and normalization
// that differs from Pi's public getAgentDir()/normalizePath boundary.
const command = currentClientRegistrationCommand();

describe("Pi user configuration paths", () => {
  it.each([
    [undefined, "/home/a/.pi/agent"],
    ["", "/home/a/.pi/agent"],
    ["/custom/agent", "/custom/agent"],
    ["~", "/home/a"],
    ["~/custom/agent", "/home/a/custom/agent"],
    ["agent", "agent"],
    ["./agent", "./agent"],
    [" agent ", " agent "],
    ["~other/agent", "~other/agent"],
    ["file:///custom/agent%20dir", "/custom/agent dir"],
    ["/mnt/c/agent", "/mnt/c/agent"],
  ])(
    "uses Pi's agent directory for %s, independently of OMP",
    (override, expected) => {
      const client = piPath("/home/a", "linux", {
        PI_CODING_AGENT_DIR: override,
        OMP_PROFILE: "work",
        PI_PROFILE: "legacy",
        PI_CONFIG_DIR: ".omp-other",
      });
      expect(client?.markerPath).toBe(expected);
      expect(client?.configPath).toBe(join(expected, "mcp.json"));
    },
  );

  it.each([
    [undefined, "C:\\Users\\a\\.pi\\agent"],
    ["", "C:\\Users\\a\\.pi\\agent"],
    ["~", "C:\\Users\\a"],
    ["~/agent", "C:\\Users\\a\\agent"],
    ["~\\agent", "C:\\Users\\a\\agent"],
    ["C:\\custom\\agent", "C:\\custom\\agent"],
    ["/c/custom/agent", "C:\\custom\\agent"],
    ["/mnt/c/custom/agent", "C:\\custom\\agent"],
    ["/cygdrive/c/custom/agent", "C:\\custom\\agent"],
    ["/c", "C:\\"],
    ["//server/share/agent", "//server/share/agent"],
    ["\\\\server\\share\\agent", "\\\\server\\share\\agent"],
    ["agent", "agent"],
    ["file:///C:/custom/agent%20dir", "C:\\custom\\agent dir"],
    ["file://server/share/agent", "\\\\server\\share\\agent"],
  ])("normalizes Windows Pi override %s", (override, expected) => {
    const client = piPath("C:\\Users\\a", "win32", {
      PI_CODING_AGENT_DIR: override,
    });
    expect(client?.markerPath).toBe(expected);
    expect(client?.configPath).toBe(
      `${expected.replace(/[\\/]+$/u, "").replaceAll("/", "\\")}\\mcp.json`,
    );
  });

  it("reports malformed file URLs instead of silently choosing the default", async () => {
    const home = await createTestTempDirectory("rea-pi-invalid-path-");
    const client = piPath(home, "linux", {
      PI_CODING_AGENT_DIR: "file:///agent%2fdir",
    });
    expect(client).toMatchObject({
      configPath: "file:///agent%2fdir",
      configPathError: expect.stringContaining("PI_CODING_AGENT_DIR"),
    });
    if (client === undefined) throw new Error("missing Pi client");
    expect(await configureClientConfiguration(client)).toEqual({
      status: "failed",
      reason: "path",
    });
    expect(await systemUninstallHost(home).removeClient(client)).toMatchObject({
      status: "failed",
      detail: expect.stringContaining("PI_CODING_AGENT_DIR"),
    });
    expect(
      await detectClients(home, "linux", {
        PI_CODING_AGENT_DIR: "file:///agent%2fdir",
      }),
    ).toEqual([]);
  });

  it("detects the normalized override marker without needing mcp.json", async () => {
    const home = await createTestTempDirectory("rea-pi-detection-");
    await mkdir(join(home, "custom-agent"));
    const detected = await detectClients(home, process.platform, {
      PI_CODING_AGENT_DIR: "~/custom-agent",
    });
    expect(detected.find(({ name }) => name === "pi")?.configPath).toBe(
      join(home, "custom-agent", "mcp.json"),
    );
  });
});

const piClient = async () => {
  const home = await createTestTempDirectory("rea-pi-config-");
  const client = piPath(home, process.platform, {});
  if (client?.markerPath === undefined) throw new Error("missing Pi client");
  await mkdir(client.markerPath, { recursive: true });
  return { home, client };
};

describe("Pi registration semantics", () => {
  it("preserves unrelated content and OMP-only lists during setup, repeat, and uninstall", async () => {
    const { home, client } = await piClient();
    // Pi loads mcp.json with strict JSON, so the retained unrelated settings
    // are valid strict JSON rather than the commented JSONC fixture.
    const original = `{"autoEnableCodemode": false,
  "mcpServers": { "other": { "command": "other-server" } },
  "enabledServers": ["other"],
  "disabledServers": ["rea", "other"]
}\n`;
    await writeFile(client.configPath, original);
    expect(
      await configureClientConfiguration(client, {}, command),
    ).toMatchObject({ status: "configured" });
    expect(await readFile(`${client.configPath}.rea.backup`, "utf8")).toBe(
      original,
    );
    const configured = await readFile(client.configPath, "utf8");
    expect(JSON.parse(configured)).toEqual({
      autoEnableCodemode: false,
      mcpServers: {
        other: { command: "other-server" },
        rea: {
          type: "stdio",
          command: command[0],
          args: command.slice(1),
        },
      },
      enabledServers: ["other"],
      disabledServers: ["rea", "other"],
    });
    expect(await configureClientConfiguration(client, {}, command)).toEqual({
      status: "unchanged",
    });
    expect(await readFile(client.configPath, "utf8")).toBe(configured);
    expect(
      (
        await readClientRegistrationStatuses(home, undefined, {
          environment: {},
        })
      ).find(({ client: name }) => name === "pi"),
    ).toMatchObject({ state: "aligned" });
    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    expect(JSON.parse(await readFile(client.configPath, "utf8"))).toEqual(
      JSON.parse(original),
    );
    expect(await readFile(`${client.configPath}.rea.backup`, "utf8")).toBe(
      original,
    );
  });

  it.each([
    [undefined, true, "aligned"],
    ["stdio", true, "aligned"],
    ["http", true, "invalid"],
    ["streamable-http", true, "invalid"],
    ["sse", true, "invalid"],
    [undefined, false, "stale"],
    ["stdio", false, "stale"],
  ])(
    "doctor handles type %s and enabled %s without OMP allowlist overrides",
    async (type, enabled, state) => {
      const { home, client } = await piClient();
      await writeFile(
        client.configPath,
        JSON.stringify({
          mcpServers: {
            rea: {
              command: command[0],
              args: command.slice(1),
              type,
              enabled,
            },
          },
          enabledServers: ["rea"],
        }),
      );
      const statuses = await readClientRegistrationStatuses(home, undefined, {
        environment: {},
      });
      expect(statuses.find(({ client: name }) => name === "pi")).toMatchObject({
        state,
      });
    },
  );
});

describe("Pi strict JSON parsing", () => {
  it.each([
    [
      "a comment",
      `{ // Pi loads strict JSON only\n"mcpServers": { "other": { "command": "other" } }\n}\n`,
    ],
    [
      "a trailing comma",
      `{"mcpServers": { "other": { "command": "other" }, },}\n`,
    ],
    [
      "a BOM before valid JSON",
      `\uFEFF{"mcpServers": { "other": { "command": "other" } }}\n`,
    ],
    ["empty text", ""],
    ["whitespace only", "\n \t\r\n"],
    ["a BOM only", "\uFEFF"],
  ])(
    "rejects an existing Pi configuration with %s before any mutation",
    async (_description, original) => {
      const { home, client } = await piClient();
      await writeFile(client.configPath, original);
      expect(() => parseClientConfiguration(original, "pi")).toThrow();
      expect(
        await inspectClientConfiguration(client, {}, command),
      ).toMatchObject({ status: "invalid" });
      expect(await configureClientConfiguration(client, {})).toEqual({
        status: "failed",
        reason: "readback",
      });
      expect(await readFile(client.configPath, "utf8")).toBe(original);
      await expect(
        readFile(`${client.configPath}.rea.backup`),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        (
          await readClientRegistrationStatuses(home, undefined, {
            environment: {},
          })
        ).find(({ client: name }) => name === "pi"),
      ).toMatchObject({ state: "invalid" });
      expect(
        await systemUninstallHost(home).removeClient(client),
      ).toMatchObject({
        name: "pi",
        status: "failed",
        detail: expect.stringContaining("not valid JSON"),
      });
      expect(await readFile(client.configPath, "utf8")).toBe(original);
      await expect(
        readFile(`${client.configPath}.rea.backup`),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("initializes a missing Pi configuration as valid strict JSON without a backup", async () => {
    const { home, client } = await piClient();
    await expect(readFile(client.configPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await inspectClientConfiguration(client, {}, command)).toEqual({
      status: "create",
    });
    expect(
      await configureClientConfiguration(client, {}, command),
    ).toMatchObject({ status: "configured" });
    const created = await readFile(client.configPath, "utf8");
    expect(() => JSON.parse(created)).not.toThrow();
    expect(JSON.parse(created)).toEqual({
      mcpServers: {
        rea: {
          type: "stdio",
          command: command[0],
          args: command.slice(1),
        },
      },
    });
    await expect(
      readFile(`${client.configPath}.rea.backup`),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await configureClientConfiguration(client, {}, command)).toEqual({
      status: "unchanged",
    });
    expect(await readFile(client.configPath, "utf8")).toBe(created);
    expect(
      (
        await readClientRegistrationStatuses(home, undefined, {
          environment: {},
        })
      ).find(({ client: name }) => name === "pi"),
    ).toMatchObject({ state: "aligned" });
    expect(await systemUninstallHost(home).removeClient(client)).toMatchObject({
      name: "pi",
      status: "removed",
    });
    expect(JSON.parse(await readFile(client.configPath, "utf8"))).toEqual({
      mcpServers: {},
    });
  });

  it("keeps JSONC tolerance for other dialects while Pi rejects the same text", () => {
    const jsonc = `\uFEFF{\n  // A comment Pi rejects but OpenCode keeps.\n  "mcp": { "other": { "type": "local" }, },\n}\n`;
    expect(parseClientConfiguration(jsonc, "opencode").servers).toEqual({
      other: { type: "local" },
    });
    expect(parseClientConfiguration("", "opencode").document).toEqual({});
    expect(parseClientConfiguration("\uFEFF", "opencode").document).toEqual({});
    expect(() => parseClientConfiguration(jsonc, "pi")).toThrow();
    expect(() => parseClientConfiguration("", "pi")).toThrow();
    expect(() => parseClientConfiguration("\uFEFF", "pi")).toThrow();
  });
});
