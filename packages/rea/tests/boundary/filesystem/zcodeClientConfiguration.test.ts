import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";

import {
  configureClientConfiguration,
  inspectClientConfiguration,
} from "../../../src/application/SetupClientConfiguration.js";
import { skillDestinations } from "../../../src/application/SetupSkill.js";
import { supportedClients } from "../../../src/application/SupportedClients.js";
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

const zcodePath = (
  home: string,
  platform: NodeJS.Platform = "linux",
  env: Parameters<typeof supportedClients>[2] = {},
) => supportedClients(home, platform, env).find(({ name }) => name === "zcode");

describe("ZCode configuration paths", () => {
  it("resolves the user config file and marker directory", () => {
    expect(zcodePath("/home/a")).toEqual({
      name: "zcode",
      displayName: "ZCode",
      configPath: join("/home/a", ".zcode", "cli", "config.json"),
      markerPath: join("/home/a", ".zcode", "cli"),
      discoveryPaths: [join("/home/a", ".zcode", "cli")],
      format: "zcode",
      zcodeFallbackPath: join("/home/a", ".agents", "mcp.json"),
    });
    expect(zcodePath("/Users/a", "darwin")?.configPath).toBe(
      join("/Users/a", ".zcode", "cli", "config.json"),
    );
    expect(zcodePath("C:\\Users\\a", "win32")?.configPath).toBe(
      join("C:\\Users\\a", ".zcode", "cli", "config.json"),
    );
  });

  it("resolves the personal skills directory beside the config root", () => {
    expect(
      skillDestinations("/home/a", ["zcode"]).map(({ path }) => path),
    ).toEqual([
      join("/home/a", ".zcode", "skills", "reverse-engineer-anything"),
    ]);
  });
});

const zcodeClient = async () => {
  const home = await createTestTempDirectory("rea-zcode-");
  const client = zcodePath(home, process.platform);
  if (client?.markerPath === undefined) throw new Error("missing ZCode client");
  await mkdir(client.markerPath, { recursive: true });
  return { home, client };
};

describe("ZCode JSON registration", () => {
  it("upserts rea into mcp.servers while preserving unrelated settings", async () => {
    const { home, client } = await zcodeClient();
    await writeFile(
      client.configPath,
      `{
  "mcp": {
    "rea": { "unrelated": true },
    "servers": {
      "other": { "command": "other-server" }
    }
  }
}`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
    expect(parsed.mcp.rea).toEqual({ unrelated: true });
    expect(parsed.mcp.servers.other).toEqual({ command: "other-server" });
    expect(parsed.mcp.servers.rea).toEqual({
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
      ).find(({ client }) => client === "zcode"),
    ).toMatchObject({ state: "aligned", command });
  });

  it("creates the mcp.servers table in an existing config without servers", async () => {
    const { client } = await zcodeClient();
    await writeFile(
      client.configPath,
      JSON.stringify({ ui: { theme: "dark" } }, null, 2),
    );
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
    expect(parsed.ui).toEqual({ theme: "dark" });
    expect(parsed.mcp.servers.rea).toEqual({
      command: command[0],
      args: command.slice(1),
    });
  });

  it("registers into an empty config file", async () => {
    const { client } = await zcodeClient();
    await writeFile(client.configPath, "");
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
    expect(parsed.mcp.servers.rea).toEqual({
      command: command[0],
      args: command.slice(1),
    });
  });

  it("removes only the rea entry on uninstall", async () => {
    const { home, client } = await zcodeClient();
    await writeFile(
      client.configPath,
      JSON.stringify(
        { mcp: { servers: { other: { command: "other-server" } } } },
        null,
        2,
      ),
    );
    await configureClientConfiguration(client, {}, command);

    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
    expect(parsed.mcp.servers.other).toEqual({ command: "other-server" });
    expect(parsed.mcp.servers.rea).toBeUndefined();
  });
});

const fallbackPath = (home: string) => join(home, ".agents", "mcp.json");

describe("ZCode .agents fallback preservation", () => {
  it.each([undefined, '{"ui":{"theme":"dark"}}\n', '{"mcp":{"servers":{}}}\n'])(
    "migrates fallback servers with native config %s",
    async (original) => {
      const { home, client } = await zcodeClient();
      if (original !== undefined) await writeFile(client.configPath, original);
      await mkdir(join(home, ".agents"), { recursive: true });
      await writeFile(
        fallbackPath(home),
        JSON.stringify(
          {
            mcpServers: {
              other: { command: "other-server", env: { TOKEN: "x" } },
              rea: {
                command: "rea",
                args: ["mcp"],
                env: {
                  REA_MCP_INPUT_SCHEMA_PROFILE: "compact",
                  GHIDRA_INSTALL_DIR: "/caller/ghidra",
                  CALLER_CHOICE: "keep-me",
                },
              },
            },
          },
          null,
          2,
        ),
      );

      expect(
        (await configureClientConfiguration(client, {}, command)).status,
      ).toBe("configured");
      const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
      expect(parsed.mcp.servers.other).toEqual({
        command: "other-server",
        env: { TOKEN: "x" },
      });
      expect(parsed.mcp.servers.rea).toEqual({
        command: command[0],
        args: command.slice(1),
        env: {
          REA_MCP_INPUT_SCHEMA_PROFILE: "compact",
          GHIDRA_INSTALL_DIR: "/caller/ghidra",
          CALLER_CHOICE: "keep-me",
        },
      });
      if (original !== undefined) {
        expect(await readFile(`${client.configPath}.rea.backup`, "utf8")).toBe(
          original,
        );
        if (JSON.parse(original).ui !== undefined)
          expect(parsed.ui).toEqual({ theme: "dark" });
      }
      // The fallback file stays in place; ZCode ignores it from now on.
      expect(
        JSON.parse(await readFile(fallbackPath(home), "utf8")).mcpServers.other,
      ).toEqual({ command: "other-server", env: { TOKEN: "x" } });
      expect(await configureClientConfiguration(client, {}, command)).toEqual({
        status: "unchanged",
      });
    },
  );

  it("leaves an existing native table alone instead of merging the fallback", async () => {
    const { home, client } = await zcodeClient();
    await mkdir(join(home, ".agents"), { recursive: true });
    await writeFile(
      fallbackPath(home),
      JSON.stringify(
        { mcpServers: { shared: { command: "fallback-server" } } },
        null,
        2,
      ),
    );
    await writeFile(
      client.configPath,
      JSON.stringify(
        { mcp: { servers: { existing: { command: "existing-server" } } } },
        null,
        2,
      ),
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const parsed = JSON.parse(await readFile(client.configPath, "utf8"));
    expect(parsed.mcp.servers.existing).toEqual({
      command: "existing-server",
    });
    expect(parsed.mcp.servers.rea).toEqual({
      command: command[0],
      args: command.slice(1),
    });
    expect(parsed.mcp.servers.shared).toBeUndefined();
  });
});

describe("ZCode fallback uninstall", () => {
  const owned = { command: command[0], args: command.slice(1) };
  const writeFallback = async (home: string, servers: object) => {
    await mkdir(join(home, ".agents"), { recursive: true });
    const text = `${JSON.stringify({ ui: { keep: true }, mcpServers: servers }, null, 2)}\n`;
    await writeFile(fallbackPath(home), text);
    return text;
  };

  it.each(["comment", "trailing-comma", "bom"])(
    "edits the owner's dialect instead of ZCode's strict fallback syntax: %s",
    async (mode) => {
      // ~/.agents/mcp.json is FreeBuff's own configuration, so FreeBuff's
      // dialect decides whether it is editable. ZCode's stricter fallback view
      // must not block a removal the file's owner can perform.
      const { home } = await zcodeClient();
      const valid = await writeFallback(home, {
        rea: owned,
        other: { command: "other-server" },
      });
      const original =
        mode === "comment"
          ? `// unsupported comment\n${valid}`
          : mode === "bom"
            ? `\uFEFF${valid}`
            : valid.replace(/\}\s*$/u, ",}");
      await writeFile(fallbackPath(home), original);
      const result = await runUninstall(false, systemUninstallHost(home));
      expect(result.status).toBe("complete");
      // The shared file is removed once and both of its clients report that.
      expect(result.items).toContainEqual(
        expect.objectContaining({ name: "freebuff", status: "removed" }),
      );
      expect(
        result.items
          .find(({ name }) => name === "zcode")
          ?.actions?.map(({ status }) => status),
      ).toContain("removed");
      const edited = await readFile(fallbackPath(home), "utf8");
      expect(edited).not.toContain('"rea"');
      expect(edited).toContain("other-server");
      expect(await readFile(`${fallbackPath(home)}.rea.backup`, "utf8")).toBe(
        original,
      );
    },
  );

  it("removes the REA-owned fallback entry with the native registration", async () => {
    const { home, client } = await zcodeClient();
    await writeFile(
      client.configPath,
      JSON.stringify({ mcp: { servers: { rea: owned } } }),
    );
    const original = await writeFallback(home, {
      rea: owned,
    });

    const result = await runUninstall(false, systemUninstallHost(home));

    expect(result.status).toBe("complete");
    expect(result.items.find(({ name }) => name === "zcode")?.status).toBe(
      "removed",
    );
    const native = JSON.parse(await readFile(client.configPath, "utf8"));
    expect(native.mcp.servers).toEqual({});
    const fallback = JSON.parse(await readFile(fallbackPath(home), "utf8"));
    expect(fallback).toEqual({
      ui: { keep: true },
      mcpServers: {},
    });
    expect(await readFile(`${fallbackPath(home)}.rea.backup`, "utf8")).toBe(
      original,
    );
  });

  it.each([
    { rea: { command: "/usr/bin/false" } },
    { rea: owned, other: { command: "other-server" } },
  ])("refuses to activate retained fallback servers: %j", async (servers) => {
    const { home, client } = await zcodeClient();
    const native = JSON.stringify({ mcp: { servers: { rea: owned } } });
    await writeFile(client.configPath, native);
    const fallback = await writeFallback(home, servers);
    const cursor = supportedClients(home).find(({ name }) => name === "cursor");
    if (cursor === undefined) throw new Error("missing Cursor client");
    await mkdir(dirname(cursor.configPath), { recursive: true });
    const otherClient = JSON.stringify({ mcpServers: { rea: owned } });
    await writeFile(cursor.configPath, otherClient);
    const result = await runUninstall(false, systemUninstallHost(home));
    expect(result.status).toBe("failed");
    expect(await readFile(client.configPath, "utf8")).toBe(native);
    expect(await readFile(fallbackPath(home), "utf8")).toBe(fallback);
    expect(await readFile(cursor.configPath, "utf8")).toBe(otherClient);
    await expect(
      readFile(`${client.configPath}.rea.backup`),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(`${cursor.configPath}.rea.backup`),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses last-native removal when the fallback cannot be interpreted", async () => {
    const { home, client } = await zcodeClient();
    const native = JSON.stringify({ mcp: { servers: { rea: owned } } });
    await writeFile(client.configPath, native);
    await mkdir(join(home, ".agents"), { recursive: true });
    await writeFile(fallbackPath(home), "{invalid");
    const result = await runUninstall(false, systemUninstallHost(home));
    expect(result.status).toBe("failed");
    expect(await readFile(client.configPath, "utf8")).toBe(native);
    expect(await readFile(fallbackPath(home), "utf8")).toBe("{invalid");
  });

  it("removes the owned server when another native server keeps the fallback inactive", async () => {
    const { home, client } = await zcodeClient();
    await writeFile(
      client.configPath,
      JSON.stringify({
        mcp: { servers: { rea: owned, other: { command: "other-server" } } },
      }),
    );
    const fallback = await writeFallback(home, {
      rea: { command: "/usr/bin/false" },
    });
    const result = await runUninstall(false, systemUninstallHost(home));
    expect(result.status).toBe("complete");
    expect(
      JSON.parse(await readFile(client.configPath, "utf8")).mcp.servers,
    ).toEqual({
      other: { command: "other-server" },
    });
    expect(await readFile(fallbackPath(home), "utf8")).toBe(fallback);
  });

  it("removes a fallback-only REA entry and keeps a foreign rea entry", async () => {
    for (const [servers, expected] of [
      [{ rea: owned }, {}],
      [
        { rea: { command: "someone-else" } },
        { rea: { command: "someone-else" } },
      ],
    ] as const) {
      const { home } = await zcodeClient();
      await writeFallback(home, servers);

      expect(
        (await runUninstall(false, systemUninstallHost(home))).status,
      ).toBe("complete");
      expect(
        JSON.parse(await readFile(fallbackPath(home), "utf8")).mcpServers,
      ).toEqual(expected);
    }
  });
});

describe("ZCode fallback admission", () => {
  it.each([{ PORT: 123 }, { REA_MCP_INPUT_SCHEMA_PROFILE: "unknown" }])(
    "refuses malformed fallback REA environment %j before native writes",
    async (env) => {
      const { home, client } = await zcodeClient();
      await mkdir(join(home, ".agents"), { recursive: true });
      const original = JSON.stringify({
        mcpServers: { rea: { command: "rea", args: ["mcp"], env } },
      });
      await writeFile(fallbackPath(home), original);
      expect(
        await inspectClientConfiguration(client, {}, command),
      ).toMatchObject({
        status: "invalid",
        remediation: expect.stringContaining(
          Object.keys(env)[0] ?? "environment",
        ),
      });
      expect(await configureClientConfiguration(client, {}, command)).toEqual({
        status: "failed",
        reason: "readback",
      });
      await expect(readFile(client.configPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readFile(fallbackPath(home), "utf8")).toBe(original);
    },
  );

  it("fails closed when the fallback configuration is malformed", async () => {
    const { home, client } = await zcodeClient();
    await mkdir(join(home, ".agents"), { recursive: true });
    await writeFile(fallbackPath(home), "{ not json");

    expect(await configureClientConfiguration(client, {}, command)).toEqual({
      status: "failed",
      reason: "readback",
    });
    await expect(readFile(client.configPath, "utf8")).rejects.toThrow();
    expect(await inspectClientConfiguration(client, {}, command)).toMatchObject(
      { status: "invalid" },
    );
  });

  it("fails closed when the fallback path is not a regular file", async () => {
    const { home, client } = await zcodeClient();
    await mkdir(fallbackPath(home), { recursive: true });

    expect(await configureClientConfiguration(client, {}, command)).toEqual({
      status: "failed",
      reason: "readback",
    });
    await expect(readFile(client.configPath, "utf8")).rejects.toThrow();
    expect(await inspectClientConfiguration(client, {}, command)).toMatchObject(
      { status: "invalid" },
    );
  });

  it.skipIf(process.platform === "win32")(
    "rejects a FIFO fallback without blocking on it",
    async () => {
      const { home, client } = await zcodeClient();
      await mkdir(join(home, ".agents"), { recursive: true });
      await promisify(execFile)("mkfifo", [fallbackPath(home)]);

      expect(await configureClientConfiguration(client, {}, command)).toEqual({
        status: "failed",
        reason: "readback",
      });
      await expect(readFile(client.configPath, "utf8")).rejects.toThrow();
      expect(
        await inspectClientConfiguration(client, {}, command),
      ).toMatchObject({ status: "invalid" });
    },
  );
});

describe("ZCode disabled registrations", () => {
  it("reports enable: false as stale and repairs it on setup", async () => {
    const { home, client } = await zcodeClient();
    await writeFile(
      client.configPath,
      JSON.stringify(
        {
          mcp: {
            servers: {
              rea: {
                command: command[0],
                args: command.slice(1),
                enable: false,
              },
            },
          },
        },
        null,
        2,
      ),
    );
    const statusFor = async () =>
      (
        await readClientRegistrationStatuses(home, undefined, {
          platform: process.platform,
          environment: {},
        })
      ).find(({ client }) => client === "zcode");
    // Native ZCode storage has a single reader, so setup drops the flag
    // and is the working repair; doctor must keep recommending it.
    expect(await statusFor()).toMatchObject({
      state: "stale",
      remediation: expect.stringContaining("rea setup"),
    });
    expect((await statusFor())?.remediation).not.toContain("enable: false");

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    expect(await statusFor()).toMatchObject({ state: "aligned", command });
  });

  it("reports the effective same-scope fallback registration and source path", async () => {
    const { home, client } = await zcodeClient();
    const fallback = client.zcodeFallbackPath;
    if (fallback === undefined) throw new Error("missing ZCode fallback path");
    await mkdir(join(home, ".agents"), { recursive: true });
    await writeFile(
      fallback,
      JSON.stringify({
        mcpServers: {
          rea: { command: command[0], args: command.slice(1) },
        },
      }),
    );

    expect(
      (
        await readClientRegistrationStatuses(home, undefined, {
          platform: process.platform,
          environment: {},
        })
      ).find(({ client }) => client === "zcode"),
    ).toMatchObject({
      config_path: fallback,
      command,
      state: "aligned",
    });
  });

  it("reports a selected fallback parse failure as invalid at its source path", async () => {
    const { home, client } = await zcodeClient();
    const fallback = client.zcodeFallbackPath;
    if (fallback === undefined) throw new Error("missing ZCode fallback path");
    await mkdir(join(home, ".agents"), { recursive: true });
    await writeFile(fallback, "{ malformed");

    expect(
      (
        await readClientRegistrationStatuses(home, undefined, {
          platform: process.platform,
          environment: {},
        })
      ).find(({ client }) => client === "zcode"),
    ).toMatchObject({ config_path: fallback, state: "invalid" });
  });

  it("reports disabled fallback registrations as stale at the fallback path", async () => {
    const { home, client } = await zcodeClient();
    const fallback = client.zcodeFallbackPath;
    if (fallback === undefined) throw new Error("missing ZCode fallback path");
    await mkdir(join(home, ".agents"), { recursive: true });
    await writeFile(
      fallback,
      JSON.stringify({
        mcpServers: {
          rea: { command: command[0], args: command.slice(1), enable: false },
        },
      }),
    );

    expect(
      (
        await readClientRegistrationStatuses(home, undefined, {
          platform: process.platform,
          environment: {},
        })
      ).find(({ client }) => client === "zcode"),
    ).toMatchObject({
      config_path: fallback,
      command,
      state: "stale",
      // The fallback view of shared storage is preserved by setup, so its
      // disable is the manual conflict rather than a setup repair.
      remediation: expect.stringContaining("enable: false"),
    });
  });

  it("prefers a nonempty native server table over the fallback", async () => {
    const { home, client } = await zcodeClient();
    const fallback = client.zcodeFallbackPath;
    if (fallback === undefined) throw new Error("missing ZCode fallback path");
    await mkdir(join(home, ".agents"), { recursive: true });
    await writeFile(
      fallback,
      JSON.stringify({
        mcpServers: {
          rea: { command: "fallback-command", args: ["mcp"] },
        },
      }),
    );
    await writeFile(
      client.configPath,
      JSON.stringify({
        mcp: {
          servers: { rea: { command: command[0], args: command.slice(1) } },
        },
      }),
    );

    expect(
      (
        await readClientRegistrationStatuses(home, undefined, {
          platform: process.platform,
          environment: {},
        })
      ).find(({ client }) => client === "zcode"),
    ).toMatchObject({
      config_path: client.configPath,
      command,
      state: "aligned",
    });
  });
});

describe("ZCode strict native JSON", () => {
  it.each(['{ // comment\n "mcp": {}}', '{"mcp":{},}', "\uFEFF{}"])(
    "rejects unreadable native syntax without modifying %s",
    async (original) => {
      const { home, client } = await zcodeClient();
      await writeFile(client.configPath, original);
      expect(
        await inspectClientConfiguration(client, {}, command),
      ).toMatchObject({ status: "invalid" });
      expect(await configureClientConfiguration(client, {}, command)).toEqual({
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
            platform: process.platform,
            environment: {},
          })
        ).find(({ client }) => client === "zcode"),
      ).toMatchObject({ state: "invalid" });
    },
  );
});
