import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isNode,
  isSeq,
  parseDocument,
  parse as parseYaml,
  stringify as stringifyYaml,
} from "yaml";

import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";

import {
  configureClientConfiguration,
  inspectClientConfiguration,
} from "../../../src/application/SetupClientConfiguration.js";
import {
  clientSkillDirectories,
  supportedClients,
} from "../../../src/application/SupportedClients.js";
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

const dshClient = (
  env: Parameters<typeof supportedClients>[2],
  platform: NodeJS.Platform = "linux",
) =>
  supportedClients(resolve("/home/a"), platform, env).find(
    ({ name }) => name === "dsh",
  );

describe("DeepSeek Harness configuration paths", () => {
  it.each([
    [undefined, ".dsh", ".agents", "shared"],
    ["", ".dsh", ".agents", "shared"],
    [" \t ", ".dsh", ".agents", "shared"],
    ["~", "", "", "dsh"],
    ["~/selected home", "selected home", "selected home", "dsh"],
    ["~\\selected home", "selected home", "selected home", "dsh"],
  ] as const)(
    "resolves Harness and agents roots for %j",
    (override, dshRoot, agentsRoot, client) => {
      const home = resolve("/home/a");
      const environment = { DSH_HOME: override, DSH_AGENTS_HOME: override };
      expect(
        supportedClients(home, process.platform, environment).find(
          ({ name }) => name === "dsh",
        ),
      ).toMatchObject({
        configPath: join(home, dshRoot, "cordis.patch.yml"),
        markerPath: join(home, dshRoot),
      });
      expect(
        clientSkillDirectories(home, ["dsh"], environment).directories,
      ).toEqual([{ client, directory: join(home, agentsRoot, "skills") }]);
    },
  );

  it.each(["relative home", "  literal home  ", "~someone"])(
    "resolves a literal root %j relative to cwd without trimming it",
    (override) => {
      const home = resolve("/home/a");
      const root = resolve(override);
      const environment = { DSH_HOME: override, DSH_AGENTS_HOME: override };
      expect(
        supportedClients(home, process.platform, environment).find(
          ({ name }) => name === "dsh",
        ),
      ).toMatchObject({
        configPath: join(root, "cordis.patch.yml"),
        markerPath: root,
      });
      expect(
        clientSkillDirectories(home, ["dsh"], environment).directories,
      ).toEqual([{ client: "dsh", directory: join(root, "skills") }]);
    },
  );

  it("resolves the home Cordis patch under the Harness home", () => {
    expect(dshClient({})).toEqual({
      name: "dsh",
      displayName: "DeepSeek Harness",
      configPath: resolve("/home/a", ".dsh", "cordis.patch.yml"),
      markerPath: resolve("/home/a", ".dsh"),
      format: "dsh",
    });
    // The home patch applies to every profile; DSH_HOME relocates it.
    expect(dshClient({ DSH_HOME: "/custom/harness" })?.configPath).toBe(
      resolve("/custom/harness", "cordis.patch.yml"),
    );
    expect(
      clientSkillDirectories(join("/home/a"), ["dsh"], {
        DSH_AGENTS_HOME: "/custom/agents",
      }).directories,
    ).toEqual([
      { client: "dsh", directory: resolve("/custom/agents", "skills") },
    ]);
  });
});

const harnessClient = async () => {
  const home = await createTestTempDirectory("rea-dsh-");
  const client = supportedClients(home, process.platform, {}).find(
    ({ name }) => name === "dsh",
  );
  if (client?.markerPath === undefined)
    throw new Error("missing DeepSeek Harness client");
  await mkdir(client.markerPath, { recursive: true });
  return { home, client };
};

describe("DeepSeek Harness Cordis patch registration", () => {
  it("appends the rea-mcp insert, preserves user patches, and reads back", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      `# Harness home patch
- insert:
    - id: user-tool
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: other
        transport: stdio
        command: other-server
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("# Harness home patch");
    expect(parseYaml(text)).toEqual([
      {
        insert: [
          {
            id: "user-tool",
            name: "@deepseek-ai/dsh-mcp-client",
            config: {
              serverName: "other",
              transport: "stdio",
              command: "other-server",
            },
          },
        ],
      },
      {
        insert: [
          {
            id: "rea-mcp",
            name: "@deepseek-ai/dsh-mcp-client",
            config: {
              serverName: "rea",
              transport: "stdio",
              command: command[0],
              args: command.slice(1),
            },
          },
        ],
      },
    ]);

    expect(await configureClientConfiguration(client, {}, command)).toEqual({
      status: "unchanged",
    });
    expect(
      (
        await readClientRegistrationStatuses(home, undefined, {
          platform: process.platform,
          environment: {},
        })
      ).find(({ client: name }) => name === "dsh"),
    ).toMatchObject({ state: "aligned", command });

    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    expect(parseYaml(await readFile(client.configPath, "utf8"))).toEqual([
      {
        insert: [
          {
            id: "user-tool",
            name: "@deepseek-ai/dsh-mcp-client",
            config: {
              serverName: "other",
              transport: "stdio",
              command: "other-server",
            },
          },
        ],
      },
    ]);
  });

  it("replaces an existing rea-mcp entry without duplicating it", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const patches = parseYaml(
      await readFile(client.configPath, "utf8"),
    ) as unknown[];
    expect(patches).toHaveLength(1);
    expect((patches[0] as { insert: unknown[] }).insert).toHaveLength(1);
    expect(textOf(await readFile(client.configPath, "utf8"))).not.toContain(
      "stale-launcher",
    );
  });

  it("rewrites a wrong-package rea-mcp entry into the canonical one", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert:
    - id: rea-mcp
      name: not-the-harness-client
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
        env:
          GHIDRA_INSTALL_DIR: /caller/nondefault/ghidra
`,
    );

    // The non-canonical entry reads back as stale, so setup rewrites it with
    // the canonical package name rather than reporting unchanged, and the
    // row's configured environment survives the identity repair.
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const patches = parseYaml(await readFile(client.configPath, "utf8")) as {
      insert: { id: string; name: string; config?: { env?: unknown } }[];
    }[];
    expect(patches).toHaveLength(1);
    expect(patches[0]?.insert).toHaveLength(1);
    expect(patches[0]?.insert[0]?.id).toBe("rea-mcp");
    expect(patches[0]?.insert[0]?.name).toBe("@deepseek-ai/dsh-mcp-client");
    expect(patches[0]?.insert[0]?.config?.env).toEqual({
      GHIDRA_INSTALL_DIR: "/caller/nondefault/ghidra",
    });
    expect(textOf(await readFile(client.configPath, "utf8"))).not.toContain(
      "not-the-harness-client",
    );
  });
});

describe("DeepSeek Harness registration identity", () => {
  it("applies a direct config patch before judging the registration", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: ${command[0]}
        args: [${command.slice(1).join(", ")}]
- id: rea-mcp
  config:
    serverName: rea
    transport: stdio
    command: redirected-launcher
    args: [mcp]
`,
    );

    // The later direct patch replaces the row's config, so the effective
    // command is the redirect and the registration is stale, not aligned.
    expect(
      (
        await readClientRegistrationStatuses(home, undefined, {
          platform: process.platform,
          environment: {},
        })
      ).find(({ client: name }) => name === "dsh"),
    ).toMatchObject({ state: "stale" });

    // Setup rewrites one canonical entry and drops the superseded direct op.
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).not.toContain("redirected-launcher");
    expect(text).not.toMatch(/^- id: rea-mcp$/mu);
    const patches = parseYaml(text) as unknown[];
    expect(patches).toHaveLength(1);
  });

  it("collapses duplicate rea entries into one canonical row", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: first-launcher
        args: [mcp]
- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: second-launcher
        args: [mcp]
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const patches = parseYaml(await readFile(client.configPath, "utf8")) as {
      insert: unknown[];
    }[];
    const reaRows = patches.flatMap(({ insert }) =>
      insert.filter(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as { id?: unknown }).id === "rea-mcp",
      ),
    );
    expect(reaRows).toHaveLength(1);
  });

  it("reports a foreign server name as stale instead of aligned", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: other
        transport: stdio
        command: ${command[0]}
        args: [${command.slice(1).join(", ")}]
`,
    );

    expect(
      (
        await readClientRegistrationStatuses(home, undefined, {
          platform: process.platform,
          environment: {},
        })
      ).find(({ client: name }) => name === "dsh"),
    ).toMatchObject({ state: "stale" });
  });

  it("creates the patch list for an absent file and empties it on uninstall", async () => {
    const { home, client } = await harnessClient();
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const created = parseYaml(
      await readFile(client.configPath, "utf8"),
    ) as unknown[];
    expect(created).toEqual([
      {
        insert: [
          {
            id: "rea-mcp",
            name: "@deepseek-ai/dsh-mcp-client",
            config: {
              serverName: "rea",
              transport: "stdio",
              command: command[0],
              args: command.slice(1),
            },
          },
        ],
      },
    ]);
    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    expect(await readFile(client.configPath, "utf8")).toBe("[]\n");
  });
});

describe("DeepSeek Harness repair boundaries", () => {
  it("repairs a direct-only registration by appending the insert", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- id: rea-mcp
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: rea
    transport: stdio
    command: stale-launcher
    args: [mcp]
`,
    );

    // An incomplete manual registration has no insertion to rewrite, so the
    // repair appends one canonical row instead of leaving the entry absent.
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    expect(parseYaml(await readFile(client.configPath, "utf8"))).toEqual([
      {
        insert: [
          {
            id: "rea-mcp",
            name: "@deepseek-ai/dsh-mcp-client",
            config: {
              serverName: "rea",
              transport: "stdio",
              command: command[0],
              args: command.slice(1),
            },
          },
        ],
      },
    ]);
  });

  it("keeps group-targeted ownership for uninstall while setup rejects unknown activity", async () => {
    const { home, client } = await harnessClient();
    const initial = stringifyYaml([
      {
        id: "tools",
        insert: [
          canonicalEntry(),
          { id: "foreign-peer", name: "caller-plugin", config: { keep: true } },
        ],
      },
    ]);
    await writeFile(client.configPath, initial);
    expect(await inspectClientConfiguration(client, {}, command)).toMatchObject(
      {
        status: "invalid",
        remediation: expect.stringContaining("targets a group"),
      },
    );
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("failed");
    expect(await dshStatus(home)).toMatchObject({
      state: "stale",
      command: [...command],
    });
    expect(await readFile(client.configPath, "utf8")).toBe(initial);
    const host = systemUninstallHost(home);
    expect(await host.inspectClient(client)).toBeUndefined();
    expect((await host.removeClient(client)).status).toBe("removed");
    expect(parseYaml(await readFile(client.configPath, "utf8"))).toEqual([
      {
        id: "tools",
        insert: [
          { id: "foreign-peer", name: "caller-plugin", config: { keep: true } },
        ],
      },
    ]);
    expect(await readFile(`${client.configPath}.rea.backup`, "utf8")).toBe(
      initial,
    );
  });

  it("blocks malformed literal patches but still uninstalls a known owned sibling", async () => {
    const { home, client } = await harnessClient();
    const initial = stringifyYaml([
      { insert: [canonicalEntry()] },
      "foreign-invalid-row",
    ]);
    await writeFile(client.configPath, initial);

    expect(await inspectClientConfiguration(client, {}, command)).toMatchObject(
      {
        status: "invalid",
        remediation: expect.stringContaining("Malformed Cordis patches"),
      },
    );
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("failed");
    expect(await readFile(client.configPath, "utf8")).toBe(initial);

    const host = systemUninstallHost(home);
    expect(await host.inspectClient(client)).toBeUndefined();
    expect((await host.removeClient(client)).status).toBe("removed");
    expect(parseYaml(await readFile(client.configPath, "utf8"))).toEqual([
      "foreign-invalid-row",
    ]);
  });

  it.each(["{ id: rea-mcp }", "7", "false", "''", "[null]"])(
    "blocks a non-list literal insert value %s before setup edits the file",
    async (insert) => {
      const { client } = await harnessClient();
      const initial = `- insert: ${insert}\n`;
      await writeFile(client.configPath, initial);

      expect(
        await inspectClientConfiguration(client, {}, command),
      ).toMatchObject({
        status: "invalid",
        remediation: expect.stringContaining("Malformed Cordis patches"),
      });
      expect(
        (await configureClientConfiguration(client, {}, command)).status,
      ).toBe("failed");
      expect(await readFile(client.configPath, "utf8")).toBe(initial);
    },
  );

  it("keeps Harness's null insert no-op editable", async () => {
    const { client } = await harnessClient();
    await writeFile(client.configPath, "- insert: null\n");

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
  });
});

describe("DeepSeek Harness expression-backed structure", () => {
  it.each([
    `- !!js process.env.DSH_PATCH\n`,
    `- insert: !!js process.env.DSH_ROWS\n`,
    `- insert: [!!js process.env.DSH_ROW]\n`,
  ])(
    "retains dynamic insertion structure without appending or removing rows: %s",
    async (initial) => {
      const { home, client } = await harnessClient();
      await writeFile(client.configPath, initial);
      expect(await dshStatus(home)).toMatchObject({ state: "invalid" });
      expect(
        await inspectClientConfiguration(client, {}, command),
      ).toMatchObject({
        status: "invalid",
        remediation: expect.stringContaining("unknown structure"),
      });
      expect(
        (await configureClientConfiguration(client, {}, command)).status,
      ).toBe("failed");
      expect(await readFile(client.configPath, "utf8")).toBe(initial);
      const host = systemUninstallHost(home);
      expect((await host.removeClient(client)).status).toBe("retained");
      expect(await readFile(client.configPath, "utf8")).toBe(initial);
      await expect(
        readFile(`${client.configPath}.rea.backup`, "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
});

describe("DeepSeek Harness registration state", () => {
  it("diagnoses a disabled entry as stale and re-enables it on repair", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      disabled: true
      config:
        serverName: rea
        transport: stdio
        command: ${command[0]}
        args: [${command.slice(1).join(", ")}]
`,
    );

    // The command matches, but Cordis never activates a disabled row, so the
    // registration reads as stale rather than aligned.
    expect(
      (
        await readClientRegistrationStatuses(home, undefined, {
          platform: process.platform,
          environment: {},
        })
      ).find(({ client: name }) => name === "dsh"),
    ).toMatchObject({ state: "stale" });

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const patches = parseYaml(await readFile(client.configPath, "utf8")) as {
      insert: { disabled?: unknown }[];
    }[];
    expect(patches[0]?.insert[0]?.disabled).toBeUndefined();
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
  });

  it("retains the existing registration environment across a repair", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
        env:
          GHIDRA_INSTALL_DIR: /caller/nondefault/ghidra
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const patches = parseYaml(await readFile(client.configPath, "utf8")) as {
      insert: { config: { env?: Record<string, string> } }[];
    }[];
    expect(patches[0]?.insert[0]?.config.env).toEqual({
      GHIDRA_INSTALL_DIR: "/caller/nondefault/ghidra",
    });
  });

  it("treats a direct-only registration as absent even when its config matches", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- id: rea-mcp
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: rea
    transport: stdio
    command: ${command[0]}
    args: [${command.slice(1).join(", ")}]
`,
    );

    // A direct patch needs an inserted row to target; with none, Harness has
    // no entry, so the registration is absent rather than aligned.
    expect(
      (
        await readClientRegistrationStatuses(home, undefined, {
          platform: process.platform,
          environment: {},
        })
      ).find(({ client: name }) => name === "dsh"),
    ).toMatchObject({ state: "missing" });

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const patches = parseYaml(await readFile(client.configPath, "utf8")) as {
      insert: unknown[];
    }[];
    expect(patches).toHaveLength(1);
    expect(patches[0]?.insert).toHaveLength(1);
  });

  it("keeps caller-owned config fields across a refresh", async () => {
    const { client } = await harnessClient();
    const withCwd = (text: string): string =>
      text.replace("args: [mcp]", "args: [mcp]\n        cwd: /custom/workdir");
    await writeFile(
      client.configPath,
      withCwd(`- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
`),
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const patches = parseYaml(await readFile(client.configPath, "utf8")) as {
      insert: { config: { cwd?: unknown; command?: unknown } }[];
    }[];
    expect(patches[0]?.insert[0]?.config.cwd).toBe("/custom/workdir");
    expect(patches[0]?.insert[0]?.config.command).toBe(command[0]);

    // An otherwise-matching row with caller fields is current, not stale.
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
  });
});

describe("DeepSeek Harness canonical row repair", () => {
  it("normalizes two aligned insertions instead of reporting unchanged", async () => {
    const { home, client } = await harnessClient();
    const row = `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: ${command[0]}
        args: [${command.slice(1).join(", ")}]
`;
    await writeFile(client.configPath, `${row}${row}`);

    // Both rows already match, but Cordis still has two insertions. Doctor
    // and setup must normalize to the single owned row.
    const registration = async () =>
      (
        await readClientRegistrationStatuses(home, undefined, {
          platform: process.platform,
          environment: {},
        })
      ).find(({ client: name }) => name === "dsh");
    expect(await registration()).toMatchObject({ state: "stale" });
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const patches = parseYaml(await readFile(client.configPath, "utf8")) as {
      insert: unknown[];
    }[];
    const reaRows = patches.flatMap(({ insert }) =>
      insert.filter(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as { id?: unknown }).id === "rea-mcp",
      ),
    );
    expect(reaRows).toHaveLength(1);
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
    expect(await registration()).toMatchObject({ state: "aligned" });
  });

  it("keeps Cordis expression tags on caller-owned config fields", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
        cwd: !!js process.cwd() # caller launch directory
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("!!js process.cwd()");
    expect(text).toContain("# caller launch directory");
    expect(text).not.toContain("stale-launcher");
    const patches = parseYaml(text, { logLevel: "error" }) as {
      insert: { config: { cwd?: unknown; command?: unknown } }[];
    }[];
    expect(patches[0]?.insert[0]?.config.command).toBe(command[0]);
    expect(patches[0]?.insert[0]?.config.cwd).toBe("process.cwd()");

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
    expect(await readFile(client.configPath, "utf8")).toContain(
      "!!js process.cwd()",
    );
  });

  it("keeps a Cordis tag from the direct patch that owns the effective config", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: first-launcher
        args: [mcp]
- id: rea-mcp
  config:
    serverName: rea
    transport: stdio
    command: stale-launcher
    args: [mcp]
    cwd: !!js process.cwd()
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("!!js process.cwd()");
    expect(text).not.toContain("stale-launcher");
    expect(text).not.toContain("first-launcher");
    expect(text).not.toMatch(/^- id: rea-mcp$/mu);
    const patches = parseYaml(text, { logLevel: "error" }) as {
      insert?: { config?: { cwd?: unknown } }[];
    }[];
    expect(patches).toHaveLength(1);
    expect(patches[0]?.insert?.[0]?.config?.cwd).toBe("process.cwd()");
  });
});

describe("DeepSeek Harness document edges", () => {
  it("keeps Cordis tags on environment values that were not overridden", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
        env:
          OTHER: !!js process.env.OTHER
          TOKEN: !!js process.env.TOKEN # caller token
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("!!js process.env.TOKEN");
    expect(text).toContain("# caller token");
    expect(text).toContain("!!js process.env.OTHER");
    expect(text).not.toContain("stale-launcher");
    const patches = parseYaml(text, { logLevel: "error" }) as {
      insert: { config: { env?: Record<string, string>; command?: string } }[];
    }[];
    expect(patches[0]?.insert[0]?.config.command).toBe(command[0]);
    expect(patches[0]?.insert[0]?.config.env).toEqual({
      OTHER: "process.env.OTHER",
      TOKEN: "process.env.TOKEN",
    });

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
    expect(await readFile(client.configPath, "utf8")).toContain(
      "!!js process.env.TOKEN",
    );
  });

  it("replaces only the environment entry a caller overrode", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
        env:
          OTHER: !!js process.env.OTHER
          TOKEN: !!js process.env.TOKEN
`,
    );

    expect(
      (
        await configureClientConfiguration(
          client,
          { TOKEN: "literal-override" },
          command,
        )
      ).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("!!js process.env.OTHER");
    expect(text).not.toContain("!!js process.env.TOKEN");
    expect(text).toContain("literal-override");
    const patches = parseYaml(text, { logLevel: "error" }) as {
      insert: { config: { env?: Record<string, string> } }[];
    }[];
    expect(patches[0]?.insert[0]?.config.env).toEqual({
      OTHER: "process.env.OTHER",
      TOKEN: "literal-override",
    });
  });

  it("appends a registration to a comment-only patch file", async () => {
    const { home, client } = await harnessClient();
    const notes = "# harness notes\n# keep me\n";
    await writeFile(client.configPath, notes);

    expect(
      (
        await readClientRegistrationStatuses(home, undefined, {
          platform: process.platform,
          environment: {},
        })
      ).find(({ client: name }) => name === "dsh"),
    ).toMatchObject({ state: "missing" });
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("# harness notes");
    expect(text).toContain("# keep me");
    expect(text).toContain("id: rea-mcp");
    expect(text).not.toMatch(/^null$/mu);

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    const removed = await readFile(client.configPath, "utf8");
    expect(removed).toContain("# harness notes");
    expect(removed).toContain("# keep me");
    expect(removed).not.toContain("rea-mcp");
    expect(removed).not.toMatch(/^null$/mu);
  });
});

describe("DeepSeek Harness entry ownership", () => {
  const registration = async (home: string) =>
    (
      await readClientRegistrationStatuses(home, undefined, {
        platform: process.platform,
        environment: {},
      })
    ).find(({ client: name }) => name === "dsh");

  it("removes a stale launcher and a direct-only row by entry id", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert:
    - id: other-tool
      name: other
      config:
        command: keep-me
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
`,
    );

    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    const removed = await readFile(client.configPath, "utf8");
    expect(removed).toContain("other-tool");
    expect(removed).not.toContain("rea-mcp");
    expect(removed).not.toContain("stale-launcher");

    await writeFile(
      client.configPath,
      `- id: other-tool
  config:
    command: keep-me
- id: rea-mcp
  name: "@deepseek-ai/dsh-mcp-client"
  config: {}
`,
    );
    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    const direct = await readFile(client.configPath, "utf8");
    expect(direct).toContain("other-tool");
    expect(direct).not.toContain("rea-mcp");
  });

  it("treats an expression disabled state as stale and clears it", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      disabled: !!js process.env.DISABLE_REA === "1"
      config:
        serverName: rea
        transport: stdio
        command: ${command[0]}
        args: [${command.slice(1).join(", ")}]
`,
    );

    expect(await registration(home)).toMatchObject({ state: "stale" });
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).not.toContain("DISABLE_REA");
    expect(text).not.toContain("disabled:");
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
    expect(await registration(home)).toMatchObject({ state: "aligned" });
  });

  it("keeps a Cordis expression on a known environment setting", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
        env:
          GHIDRA_INSTALL_DIR: !!js process.env.GHIDRA_INSTALL_DIR
`,
    );

    // The expression is not a literal path, so doctor can still classify the
    // row instead of rejecting the file.
    expect(await registration(home)).toMatchObject({ state: "stale" });
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("!!js process.env.GHIDRA_INSTALL_DIR");
    expect(text).not.toContain("stale-launcher");
    const patches = parseYaml(text, { logLevel: "error" }) as {
      insert: { config: { env?: Record<string, string> } }[];
    }[];
    expect(patches[0]?.insert[0]?.config.env).toEqual({
      GHIDRA_INSTALL_DIR: "process.env.GHIDRA_INSTALL_DIR",
    });
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
    expect(await readFile(client.configPath, "utf8")).toContain(
      "!!js process.env.GHIDRA_INSTALL_DIR",
    );
  });
});

describe("DeepSeek Harness alias collapse", () => {
  it("collapses an aliased insertion and keeps an unrelated alias", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- &other
  insert:
    - id: other-tool
      name: other
      config:
        command: keep-me
- *other
- &row
  insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
- *row
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("*other");
    expect(text).not.toContain("*row");
    expect(text).not.toContain("stale-launcher");
    const patches = parseYaml(text) as { insert?: { id?: string }[] }[];
    const reaRows = patches.flatMap(({ insert }) =>
      (insert ?? []).filter((entry) => entry.id === "rea-mcp"),
    );
    expect(reaRows).toHaveLength(1);
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
  });

  it("collapses an aliased entry inside one insertion", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert:
    - &entry
      id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
    - *entry
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).not.toContain("*entry");
    const patches = parseYaml(text) as { insert?: { id?: string }[] }[];
    expect(
      patches.flatMap(({ insert }) =>
        (insert ?? []).filter((entry) => entry.id === "rea-mcp"),
      ),
    ).toHaveLength(1);
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
  });
});

describe("DeepSeek Harness alias targets", () => {
  it("collapses an alias of the insert list", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- holder: &rows
    - id: other-tool
      name: other
      config:
        command: keep-me
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
- insert: *rows
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("other-tool");
    expect(text).not.toContain("*rows");
    expect(text).toContain("stale-launcher");
    const patches = parseYaml(text) as { insert?: { id?: string }[] }[];
    expect(
      patches.flatMap(({ insert }) =>
        (insert ?? []).filter((entry) => entry.id === "rea-mcp"),
      ),
    ).toHaveLength(1);
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
  });

  it("keeps a Cordis tag when the config map is an alias", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- &cfg
  cwd: !!js process.cwd() # caller launch directory
  serverName: rea
  transport: stdio
  command: stale-launcher
  args: [mcp]
- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config: *cfg
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("!!js process.cwd()");
    expect(text).toContain("# caller launch directory");
    const patches = parseYaml(text, { logLevel: "error" }) as {
      insert?: { config?: { cwd?: unknown; command?: unknown } }[];
    }[];
    const row = patches.find((patch) => patch.insert !== undefined);
    expect(row?.insert?.[0]?.config?.cwd).toBe("process.cwd()");
    expect(row?.insert?.[0]?.config?.command).toBe(command[0]);
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
  });
});

describe("DeepSeek Harness alias identity", () => {
  it("keeps unrelated rows when a valid insertion list is aliased", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- holder: &rows
  - id: other-tool
    name: other
    config:
      command: keep-me
  - id: rea-mcp
    name: "@deepseek-ai/dsh-mcp-client"
    config:
      serverName: rea
      transport: stdio
      command: stale-launcher
      args: [mcp]
- insert: *rows
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const patches = parseYaml(await readFile(client.configPath, "utf8")) as {
      insert?: { id?: string; config?: { command?: string } }[];
    }[];
    const inserted = patches.flatMap((patch) => patch.insert ?? []);
    expect(inserted.filter((entry) => entry.id === "other-tool")).toHaveLength(
      1,
    );
    expect(inserted.filter((entry) => entry.id === "rea-mcp")).toEqual([
      expect.objectContaining({
        config: expect.objectContaining({ command: command[0] }),
      }),
    ]);
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
  });

  it("keeps an aliased Cordis tag on an environment value", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert: []
  callerExpression: &expr !!js process.env.TOKEN
- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
        env:
          TOKEN: *expr
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("!!js process.env.TOKEN");
    expect(text).toContain("*expr");
    expect(text).not.toContain("stale-launcher");
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
  });

  it("recognizes an aliased entry id", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert: []
  holder: &entryId rea-mcp
- insert:
    - id: *entryId
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const patches = parseYaml(await readFile(client.configPath, "utf8")) as {
      insert?: { id?: string }[];
    }[];
    expect(
      patches.flatMap((patch) =>
        (patch.insert ?? []).filter((entry) => entry.id === "rea-mcp"),
      ),
    ).toHaveLength(1);
    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    expect(await readFile(client.configPath, "utf8")).not.toContain("*entryId");
  });
});

describe("DeepSeek Harness alias cleanup", () => {
  it("keeps tags when the environment map is an alias", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- &reaEnv
  TOKEN: !!js process.env.TOKEN
- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
        env: *reaEnv
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("!!js process.env.TOKEN");
    expect(text).not.toContain("stale-launcher");
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
  });

  it("does not validate an aliased Cordis path expression as a literal", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert: []
  callerExpression: &expr !!js process.env.GHIDRA_INSTALL_DIR
- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
        env:
          GHIDRA_INSTALL_DIR: *expr
`,
    );

    expect(
      (
        await readClientRegistrationStatuses(home, undefined, {
          platform: process.platform,
          environment: {},
        })
      ).find(({ client: name }) => name === "dsh"),
    ).toMatchObject({ state: "stale" });
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    expect(await readFile(client.configPath, "utf8")).toContain(
      "!!js process.env.GHIDRA_INSTALL_DIR",
    );
  });

  it("removes an aliased insert list on uninstall", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert: &rows
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: ${command[0]}
        args: [${command.slice(1).join(", ")}]
- insert: *rows
`,
    );

    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    const text = await readFile(client.configPath, "utf8");
    expect(text).not.toContain("rea-mcp");
    expect(text).not.toContain("*rows");
  });
});

describe("DeepSeek Harness root aliases", () => {
  it("uses a direct patch replayed by a root alias as the winning config", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: first-launcher
        args: [mcp]
        env:
          GHIDRA_INSTALL_DIR: /absolute/ghidra
- &patch
  id: rea-mcp
  config:
    serverName: rea
    transport: stdio
    command: stale-launcher
    args: [mcp]
    env:
      GHIDRA_INSTALL_DIR: !!js process.env.GHIDRA_INSTALL_DIR
- *patch
`,
    );

    expect(
      (
        await readClientRegistrationStatuses(home, undefined, {
          platform: process.platform,
          environment: {},
        })
      ).find(({ client: name }) => name === "dsh"),
    ).toMatchObject({ state: "stale" });
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    expect(await readFile(client.configPath, "utf8")).toContain(
      "!!js process.env.GHIDRA_INSTALL_DIR",
    );
  });

  it("removes a root alias of the owned insertion on uninstall", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- &row
  insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: ${command[0]}
        args: [${command.slice(1).join(", ")}]
- *row
`,
    );

    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    const text = await readFile(client.configPath, "utf8");
    expect(text).not.toContain("rea-mcp");
    expect(text).not.toContain("*row");
  });

  it("keeps a Cordis tag when the only owned row is an alias", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- &entry
  id: rea-mcp
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: rea
    transport: stdio
    command: stale-launcher
    args: [mcp]
    cwd: !!js process.cwd()
- insert:
    - *entry
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("!!js process.cwd()");
    expect(text).not.toContain("stale-launcher");
    const patches = parseYaml(text, { logLevel: "error" }) as {
      insert?: { config?: { cwd?: unknown; command?: unknown } }[];
    }[];
    const row = patches.find((patch) => patch.insert !== undefined);
    expect(row?.insert?.[0]?.config?.cwd).toBe("process.cwd()");
    expect(row?.insert?.[0]?.config?.command).toBe(command[0]);
  });
});

const loadedInserts = (
  text: string,
): { id?: string; config?: { command?: string } }[] => {
  const patches = parseYaml(text) as {
    insert?: { id?: string; config?: { command?: string } }[];
  }[];
  return patches.flatMap((patch) => patch.insert ?? []);
};

describe("DeepSeek Harness inert anchors", () => {
  it("keeps unrelated rows when the only active insertion is a root alias", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- holder: &op
    insert:
      - id: other-tool
        name: other
        config:
          command: keep-me
      - id: rea-mcp
        name: "@deepseek-ai/dsh-mcp-client"
        config:
          serverName: rea
          transport: stdio
          command: stale-launcher
          args: [mcp]
- *op
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const inserted = loadedInserts(await readFile(client.configPath, "utf8"));
    expect(inserted.filter((entry) => entry.id === "other-tool")).toHaveLength(
      1,
    );
    expect(inserted.filter((entry) => entry.id === "rea-mcp")).toEqual([
      expect.objectContaining({
        config: expect.objectContaining({ command: command[0] }),
      }),
    ]);
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
  });

  it("keeps unrelated rows when uninstall removes that root alias", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- holder: &op
    insert:
      - id: other-tool
        name: other
        config:
          command: keep-me
      - id: rea-mcp
        name: "@deepseek-ai/dsh-mcp-client"
        config:
          serverName: rea
          transport: stdio
          command: ${command[0]}
          args: [${command.slice(1).join(", ")}]
- *op
`,
    );

    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    const text = await readFile(client.configPath, "utf8");
    expect(parseYaml(text)).toBeTruthy();
    const inserted = loadedInserts(text);
    expect(inserted.filter((entry) => entry.id === "other-tool")).toHaveLength(
      1,
    );
    expect(inserted.filter((entry) => entry.id === "rea-mcp")).toHaveLength(0);
  });
});

describe("DeepSeek Harness alias anchors", () => {
  it("rewrites an entry id alias before removing its anchor", async () => {
    const { client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- id: &entryId rea-mcp
  config:
    serverName: rea
    transport: stdio
    command: stale-launcher
    args: [mcp]
- insert:
    - id: *entryId
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: stale-launcher
        args: [mcp]
`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).not.toContain("*entryId");
    expect(
      loadedInserts(text).filter((entry) => entry.id === "rea-mcp"),
    ).toHaveLength(1);
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
  });

  it("drops a replayed root alias after its insert alias is emptied", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      `- holder: &rows
  - id: rea-mcp
    name: "@deepseek-ai/dsh-mcp-client"
    config:
      serverName: rea
      transport: stdio
      command: ${command[0]}
      args: [${command.slice(1).join(", ")}]
- &op
  insert: *rows
- *op
`,
    );

    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    const text = await readFile(client.configPath, "utf8");
    expect(text).not.toContain("*op");
    expect(() => parseYaml(text)).not.toThrow();
  });
});

const textOf = (value: unknown): string => String(value);

/** Same tagged expression representation as Harness's entry-list schema. */
const cordisPatches = (text: string) =>
  parseYaml(text, {
    customTags: [
      {
        tag: "tag:yaml.org,2002:js",
        resolve: (source: string) => ({ __jsExpr: source }),
      },
    ],
  }) as { insert?: { id?: string; config?: Record<string, unknown> }[] }[];

const canonicalEntry = () => ({
  id: "rea-mcp",
  name: "@deepseek-ai/dsh-mcp-client",
  config: {
    serverName: "rea",
    transport: "stdio",
    command: command[0],
    args: command.slice(1),
  },
});

const dshStatus = async (home: string) =>
  (
    await readClientRegistrationStatuses(home, undefined, {
      platform: process.platform,
      environment: {},
    })
  ).find(({ client }) => client === "dsh");

describe("DeepSeek Harness runtime environment validation", () => {
  it.each([
    ["HOPPER_LOADER_ARGS_JSON", "{"],
    ["REA_REFERENCE_SECRET_PATTERNS_JSON", '[""]'],
    ["REA_GHIDRA_COMPILER_SPEC_ID", "borlandcpp"],
  ])("refuses invalid literal %s before writing", async (setting, value) => {
    const { home, client } = await harnessClient();
    const entry = canonicalEntry();
    const original = stringifyYaml([
      {
        insert: [
          { ...entry, config: { ...entry.config, env: { [setting]: value } } },
        ],
      },
    ]);
    await writeFile(client.configPath, original);
    expect(await inspectClientConfiguration(client, {}, command)).toMatchObject(
      { status: "invalid", remediation: expect.stringContaining(setting) },
    );
    expect(await dshStatus(home)).toMatchObject({
      state: "invalid",
      remediation: expect.stringContaining(setting),
    });
    expect(
      await configureClientConfiguration(client, {}, command),
    ).toMatchObject({ status: "failed" });
    expect(await readFile(client.configPath, "utf8")).toBe(original);
    await expect(
      access(`${client.configPath}.rea.backup`),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps an expression-backed companion unknown until a literal override replaces it", async () => {
    const { home, client } = await harnessClient();
    const entry = canonicalEntry();
    const document = parseDocument(
      stringifyYaml([
        {
          insert: [
            {
              ...entry,
              config: {
                ...entry.config,
                command: "stale",
                env: {
                  REA_GHIDRA_COMPILER_SPEC_ID: "borlandcpp",
                  CALLER_SETTING: "keep",
                },
              },
            },
          ],
        },
      ]),
    );
    for (const setting of [
      "REA_GHIDRA_LANGUAGE_ID",
      "HOPPER_LOADER_ARGS_JSON",
    ]) {
      const expression = document.createNode(`process.env.${setting}`);
      expression.tag = "tag:yaml.org,2002:js";
      document.setIn([0, "insert", 0, "config", "env", setting], expression);
    }
    const original = document.toString();
    await writeFile(client.configPath, original);
    expect(await inspectClientConfiguration(client, {}, command)).toMatchObject(
      { status: "update" },
    );
    expect(
      await configureClientConfiguration(client, {}, command),
    ).toMatchObject({ status: "configured" });
    const configured = await readFile(client.configPath, "utf8");
    expect(configured).toContain("!!js process.env.REA_GHIDRA_LANGUAGE_ID");
    expect(configured).toContain("!!js process.env.HOPPER_LOADER_ARGS_JSON");
    expect(configured).toContain("CALLER_SETTING: keep");
    expect(await dshStatus(home)).toMatchObject({ state: "aligned" });
    expect(
      await configureClientConfiguration(client, {}, command),
    ).toMatchObject({ status: "unchanged" });
    await expect(
      inspectClientConfiguration(
        client,
        { HOPPER_LOADER_ARGS_JSON: "{" },
        command,
      ),
    ).resolves.toMatchObject({
      status: "invalid",
      remediation: expect.stringContaining("HOPPER_LOADER_ARGS_JSON"),
    });
    await expect(
      inspectClientConfiguration(
        client,
        { REA_GHIDRA_LANGUAGE_ID: "" },
        command,
      ),
    ).resolves.toMatchObject({
      status: "invalid",
      remediation: expect.stringContaining("REA_GHIDRA_LANGUAGE_ID"),
    });
    expect(
      await inspectClientConfiguration(
        client,
        {
          REA_GHIDRA_LANGUAGE_ID: "x86:LE:32:default",
          HOPPER_LOADER_ARGS_JSON: '[""]',
        },
        command,
      ),
    ).toMatchObject({ status: "update" });
    expect(await readFile(client.configPath, "utf8")).toBe(configured);
    expect(await readFile(`${client.configPath}.rea.backup`, "utf8")).toBe(
      original,
    );
  });
});

describe("DeepSeek Harness source ownership", () => {
  it.each(["setup", "uninstall"])(
    "preserves unrelated rows in a later externally anchored operation during %s",
    async (operation) => {
      const { home, client } = await harnessClient();
      const initial = `${stringifyYaml([{ insert: [canonicalEntry()] }])}- holder: &op
    insert:
      - id: other-tool
        name: other
        config: {command: keep-me}
      - id: rea-mcp
        name: '@deepseek-ai/dsh-mcp-client'
        config: {serverName: rea, transport: stdio, command: stale, args: [mcp]}
- *op
`;
      await writeFile(client.configPath, initial);
      const result =
        operation === "setup"
          ? await configureClientConfiguration(client, {}, command)
          : await systemUninstallHost(home).removeClient(client);
      expect(result.status).toBe(
        operation === "setup" ? "configured" : "removed",
      );
      const entries = loadedInserts(await readFile(client.configPath, "utf8"));
      expect(entries.filter(({ id }) => id === "other-tool")).toEqual([
        { id: "other-tool", name: "other", config: { command: "keep-me" } },
      ]);
      expect(entries.filter(({ id }) => id === "rea-mcp")).toHaveLength(
        operation === "setup" ? 1 : 0,
      );
      expect(await readFile(`${client.configPath}.rea.backup`, "utf8")).toBe(
        initial,
      );
    },
  );

  it.each(["inline", "aliased config"])(
    "snapshots environment aliases before replacing their anchor in %s",
    async (shape) => {
      const { client } = await harnessClient();
      const config = `serverName: rea
      transport: stdio
      command: stale-launcher
      args: [mcp]
      env:
        A: &expr !!js process.env.TOKEN # caller expression
        B: *expr
`;
      const initial =
        shape === "inline"
          ? `- insert:\n    - id: rea-mcp\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        ${config.replaceAll("\n", "\n  ").trimEnd()}\n`
          : `- holder: &cfg\n      ${config}- insert:\n    - id: rea-mcp\n      name: '@deepseek-ai/dsh-mcp-client'\n      config: *cfg\n`;
      await writeFile(client.configPath, initial);
      expect(
        (
          await configureClientConfiguration(
            client,
            { A: "literal-override" },
            command,
          )
        ).status,
      ).toBe("configured");
      const text = await readFile(client.configPath, "utf8");
      const row = cordisPatches(text)
        .flatMap((op) => op.insert ?? [])
        .find(({ id }) => id === "rea-mcp");
      expect(row?.config?.env).toEqual({
        A: "literal-override",
        B: { __jsExpr: "process.env.TOKEN" },
      });
      expect(text).toContain("# caller expression");
      expect(
        (
          await configureClientConfiguration(
            client,
            { A: "literal-override" },
            command,
          )
        ).status,
      ).toBe("unchanged");
    },
  );

  it("keeps expression aliases used by unrelated rows when removing their source entry", async () => {
    const { home, client } = await harnessClient();
    const initial = `- insert:
    - id: rea-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        command: stale
        cwd: &cwd !!js process.cwd()
    - id: other-tool
      name: other
      config:
        cwd: *cwd
`;
    await writeFile(client.configPath, initial);
    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    expect(cordisPatches(await readFile(client.configPath, "utf8"))).toEqual([
      {
        insert: [
          {
            id: "other-tool",
            name: "other",
            config: { cwd: { __jsExpr: "process.cwd()" } },
          },
        ],
      },
    ]);
  });
});

describe("DeepSeek Harness registration applicability", () => {
  it("preserves literal scalar keys in unrelated and caller-owned config", async () => {
    const { client } = await harnessClient();
    const initial = `- insert:
    - id: other
      name: caller-plugin
      config: {1: one, true: yes}
    - id: rea-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config: {command: stale, extra: {2: two}}
`;
    await writeFile(client.configPath, initial);
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const rows = cordisPatches(await readFile(client.configPath, "utf8"))[0]
      ?.insert;
    expect(rows?.[0]?.config).toEqual({ "1": "one", true: "yes" });
    expect(rows?.[1]?.config?.extra).toEqual({ "2": "two" });
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
  });

  it("uses direct-patch names as selectors and preserves the actual effective config", async () => {
    const { home, client } = await harnessClient();
    const entry = canonicalEntry();
    const initial = stringifyYaml([
      {
        insert: [
          {
            ...entry,
            name: "other-package",
            config: { ...entry.config, env: { FROM_INSERT: "keep-me" } },
          },
        ],
      },
      {
        id: "rea-mcp",
        name: entry.name,
        config: { ...entry.config, env: { FROM_SKIPPED_PATCH: "discard-me" } },
      },
    ]);
    await writeFile(client.configPath, initial);
    expect(await dshStatus(home)).toMatchObject({ state: "stale" });
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    expect(
      cordisPatches(await readFile(client.configPath, "utf8"))[0]?.insert?.[0]
        ?.config?.env,
    ).toEqual({ FROM_INSERT: "keep-me" });
    expect(await dshStatus(home)).toMatchObject({ state: "aligned" });
  });

  it.each(["serverName", "transport", "command", "args"] as const)(
    "distinguishes expression-backed %s from literal launcher values",
    async (key) => {
      const { home, client } = await harnessClient();
      const entry = canonicalEntry();
      const doc = stringifyYaml([{ insert: [entry] }]);
      const { parseDocument } = await import("yaml");
      const yaml = parseDocument(doc);
      const expression = yaml.createNode(
        key === "args" ? "[]" : String(entry.config[key]),
      );
      expression.tag = "tag:yaml.org,2002:js";
      yaml.setIn([0, "insert", 0, "config", key], expression);
      await writeFile(client.configPath, yaml.toString());
      expect((await dshStatus(home))?.state).not.toBe("aligned");
      expect(
        (await configureClientConfiguration(client, {}, command)).status,
      ).toBe("configured");
      expect(cordisPatches(await readFile(client.configPath, "utf8"))).toEqual([
        { insert: [entry] },
      ]);
      expect(await dshStatus(home)).toMatchObject({ state: "aligned" });
    },
  );

  it("keeps caller config separate from package, duplicate and activation diagnostics", async () => {
    const { home, client } = await harnessClient();
    const entry = canonicalEntry();
    const initial = stringifyYaml([
      {
        insert: [
          {
            ...entry,
            config: {
              ...entry.config,
              package: "caller-package",
              duplicate: "caller-state",
              disabled: "caller-value",
              enabled: false,
            },
          },
        ],
      },
    ]);
    await writeFile(client.configPath, initial);
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("unchanged");
    expect(await dshStatus(home)).toMatchObject({ state: "aligned" });
    expect(await readFile(client.configPath, "utf8")).toBe(initial);
  });

  it.each([
    "- &cycle {holder: *cycle}\n",
    "- insert: [\n",
    "- insert: *missing\n",
    [
      "- holder: &a [value, value]",
      "- holder: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]",
      "- holder: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]",
      "- insert: [{id: rea-mcp, config: {extra: *c}}]",
    ].join("\n"),
    "- insert: [{id: rea-mcp, name: '@deepseek-ai/dsh-mcp-client', config: !!js process.env.CONFIG}]\n",
  ])("refuses unsafe YAML without mutation: %s", async (initial) => {
    const { client } = await harnessClient();
    await writeFile(client.configPath, initial);
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("failed");
    expect(await readFile(client.configPath, "utf8")).toBe(initial);
    await expect(
      readFile(`${client.configPath}.rea.backup`),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("DeepSeek Harness ownership and editability", () => {
  it.each([
    `- insert: [{id: !!js '"rea-mcp"', name: caller-plugin}]\n`,
    `- id: !!js '"rea-mcp"'\n  config: {command: caller-launcher}\n`,
    `- holder: &id !!js '"rea-mcp"'\n- insert: [{id: *id}]\n`,
  ])("retains registrations with unknown ID ownership: %s", async (initial) => {
    const { home, client } = await harnessClient();
    await writeFile(client.configPath, initial);
    expect(await dshStatus(home)).toMatchObject({ state: "invalid" });
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("failed");
    const host = systemUninstallHost(home);
    expect(await host.inspectClient(client)).toMatchObject({
      status: "failed",
      detail: expect.stringContaining(
        "Expression-backed Cordis IDs have unknown ownership; use literal IDs",
      ),
    });
    expect(await host.removeClient(client)).toMatchObject({
      status: "failed",
      detail: expect.stringContaining(
        "Expression-backed Cordis IDs have unknown ownership; use literal IDs",
      ),
    });
    expect(await readFile(client.configPath, "utf8")).toBe(initial);
    await expect(
      readFile(`${client.configPath}.rea.backup`),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each(["selector", "insertion"] as const)(
    "preserves unknown %s name applicability while allowing owned removal",
    async (expressionPosition) => {
      const { home, client } = await harnessClient();
      const { parseDocument } = await import("yaml");
      const yaml = parseDocument(
        stringifyYaml([
          { insert: [canonicalEntry()] },
          {
            id: "rea-mcp",
            name: "@deepseek-ai/dsh-mcp-client",
            config: { command: "patched-launcher" },
          },
        ]),
      );
      const expression = yaml.createNode('"@deepseek-ai/dsh-mcp-client"');
      expression.tag = "tag:yaml.org,2002:js";
      yaml.setIn(
        expressionPosition === "selector"
          ? [1, "name"]
          : [0, "insert", 0, "name"],
        expression,
      );
      const initial = yaml.toString();
      await writeFile(client.configPath, initial);
      expect(await dshStatus(home)).toMatchObject({ state: "stale" });
      expect(
        (await configureClientConfiguration(client, {}, command)).status,
      ).toBe("failed");
      expect(await readFile(client.configPath, "utf8")).toBe(initial);
      const host = systemUninstallHost(home);
      expect(await host.inspectClient(client)).toBeUndefined();
      expect((await host.removeClient(client)).status).toBe("removed");
      expect(parseYaml(await readFile(client.configPath, "utf8"))).toEqual([]);
      expect(await readFile(`${client.configPath}.rea.backup`, "utf8")).toBe(
        initial,
      );
    },
  );
});

describe("DeepSeek Harness aliased mapping keys", () => {
  it.each(["setup", "uninstall"])(
    "resolves owned fields and preserves caller config during %s",
    async (operation) => {
      const { home, client } = await harnessClient();
      const initial = `- holder: &insertKey insert
- holder: &idKey id
- holder: &configKey config
- holder: &envKey env
- ? *insertKey
  : - ? *idKey
      : rea-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      ? *configKey
      : command: stale
        ? *envKey
        : TOKEN: keep-me
    - id: other
      name: caller-plugin
`;
      await writeFile(client.configPath, initial);
      const result =
        operation === "setup"
          ? await configureClientConfiguration(client, {}, command)
          : await systemUninstallHost(home).removeClient(client);
      expect(result.status).toBe(
        operation === "setup" ? "configured" : "removed",
      );
      const entries = loadedInserts(await readFile(client.configPath, "utf8"));
      expect(entries.filter(({ id }) => id === "other")).toEqual([
        { id: "other", name: "caller-plugin" },
      ]);
      const owned = entries.filter(({ id }) => id === "rea-mcp");
      expect(owned).toHaveLength(operation === "setup" ? 1 : 0);
      if (operation === "setup") {
        expect(owned[0]?.config).toMatchObject({ env: { TOKEN: "keep-me" } });
        expect(await dshStatus(home)).toMatchObject({ state: "aligned" });
        expect(
          (await configureClientConfiguration(client, {}, command)).status,
        ).toBe("unchanged");
      }
      expect(await readFile(`${client.configPath}.rea.backup`, "utf8")).toBe(
        initial,
      );
    },
  );
});

describe("DeepSeek Harness ordered selector applicability", () => {
  it.each(["before insertion", "before replacement"])(
    "discards selector uncertainty %s",
    async (position) => {
      const { home, client } = await harnessClient();
      const selector = `- id: rea-mcp
  name: !!js '"@deepseek-ai/dsh-mcp-client"'
  config: {command: ignored-launcher, env: {IGNORED: discarded}}
`;
      const insertion = stringifyYaml([{ insert: [canonicalEntry()] }]);
      const initial =
        position === "before insertion"
          ? selector + insertion
          : insertion + selector + insertion;
      await writeFile(client.configPath, initial);
      expect((await dshStatus(home))?.state).toBe(
        position === "before insertion" ? "aligned" : "stale",
      );
      expect(
        (await configureClientConfiguration(client, {}, command)).status,
      ).toBe(position === "before insertion" ? "unchanged" : "configured");
      expect(await dshStatus(home)).toMatchObject({ state: "aligned" });
      const text = await readFile(client.configPath, "utf8");
      expect(
        cordisPatches(text)
          .flatMap((patch) => patch.insert ?? [])
          .filter(({ id }) => id === "rea-mcp"),
      ).toEqual([canonicalEntry()]);
      if (position === "before insertion") expect(text).toBe(initial);
      expect(
        (await systemUninstallHost(home).removeClient(client)).status,
      ).toBe("removed");
      expect(loadedInserts(await readFile(client.configPath, "utf8"))).toEqual(
        [],
      );
    },
  );
});

describe("DeepSeek Harness caller node metadata", () => {
  it.each(["environment", "launcher", "arguments"])(
    "preserves scalar and argument comments during %s repairs",
    async (repair) => {
      const { home, client } = await harnessClient();
      const entry = canonicalEntry();
      const yaml = parseDocument(
        stringifyYaml([
          {
            insert: [
              {
                ...entry,
                config: {
                  ...entry.config,
                  ...(repair === "launcher" ? { command: "stale" } : {}),
                  ...(repair === "arguments"
                    ? { command: "stale", args: ["mcp", "--legacy"] }
                    : {}),
                  env: { TOKEN: "original" },
                },
              },
            ],
          },
        ]),
      );
      for (const path of [
        [0, "insert", 0, "id"],
        [0, "insert", 0, "name"],
        ...["serverName", "transport", "command", "args"].map((key) => [
          0,
          "insert",
          0,
          "config",
          key,
        ]),
        [0, "insert", 0, "config", "env", "TOKEN"],
      ]) {
        const node = yaml.getIn(path, true);
        if (!isNode(node)) throw new Error("missing caller node");
        node.comment = ` caller ${path.at(-1)}`;
        node.commentBefore = ` before ${path.at(-1)}`;
      }
      const args = yaml.getIn([0, "insert", 0, "config", "args"], true);
      if (!isSeq(args) || !isNode(args.items[0]))
        throw new Error("missing launcher arguments");
      args.items[0].comment = " caller argument";
      if (repair === "arguments") {
        if (!isNode(args.items[1])) throw new Error("missing old argument");
        args.items[1].comment = " removed argument explanation";
      }
      const initial = yaml.toString();
      await writeFile(client.configPath, initial);
      expect(
        (
          await configureClientConfiguration(
            client,
            { TOKEN: "updated" },
            command,
          )
        ).status,
      ).toBe("configured");
      const text = await readFile(client.configPath, "utf8");
      for (const key of [
        "id",
        "name",
        "serverName",
        "transport",
        "command",
        "args",
        "TOKEN",
      ]) {
        expect(text).toContain(`# caller ${key}`);
        expect(text).toContain(`# before ${key}`);
      }
      expect(text).toContain("# caller argument");
      if (repair === "arguments") {
        expect(text).toContain("# removed argument explanation");
        const updatedArgs = parseDocument(text).getIn(
          [0, "insert", 0, "config", "args"],
          true,
        );
        if (!isSeq(updatedArgs)) throw new Error("missing updated arguments");
        expect(updatedArgs.commentBefore).toContain(
          "removed argument explanation",
        );
        const mcp = updatedArgs.items.find(
          (item) => isNode(item) && "value" in item && item.value === "mcp",
        );
        expect(isNode(mcp) ? mcp.comment : undefined).toContain(
          "caller argument",
        );
      }
      expect(loadedInserts(text)).toEqual([
        {
          ...entry,
          config: { ...entry.config, env: { TOKEN: "updated" } },
        },
      ]);
      expect(await dshStatus(home)).toMatchObject({ state: "aligned" });
      expect(
        (
          await configureClientConfiguration(
            client,
            { TOKEN: "updated" },
            command,
          )
        ).status,
      ).toBe("unchanged");
      expect(await readFile(client.configPath, "utf8")).toBe(text);
      expect(await readFile(`${client.configPath}.rea.backup`, "utf8")).toBe(
        initial,
      );
    },
  );
});

describe("DeepSeek Harness uninstall of a shared operation", () => {
  it("keeps a group patch's own fields and comment when its only row was REA's", async () => {
    const { home, client } = await harnessClient();
    const entry = canonicalEntry();
    await writeFile(
      client.configPath,
      `- insert:
    - id: user-a
      name: plugin-a
# caller group patch
- id: tools
  config:
    sandbox: strict
  insert:
    - id: rea-mcp
      name: "${entry.name}"
      config:
        serverName: rea
        transport: stdio
        command: ${entry.config.command}
        args: ${JSON.stringify(entry.config.args)}
`,
    );

    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    const text = await readFile(client.configPath, "utf8");
    expect(parseYaml(text)).toEqual([
      { insert: [{ id: "user-a", name: "plugin-a" }] },
      { id: "tools", config: { sandbox: "strict" } },
    ]);
    expect(text).toContain("# caller group patch");
  });

  it("keeps an operation's own fields when setup removes a second REA row from it", async () => {
    // Setup refuses a REA row in a group patch, so the setup path meets the
    // keep rule only on an operation without a selector.
    const { home, client } = await harnessClient();
    const entry = canonicalEntry();
    const row = (launcher: string) => `    - id: rea-mcp
      name: "${entry.name}"
      config:
        serverName: rea
        transport: stdio
        command: ${launcher}
        args: [mcp]
`;
    await writeFile(
      client.configPath,
      `- insert:
${row("first-launcher")}# caller operation
- disabled: false
  insert:
${row("second-launcher")}`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("# caller operation");
    expect(loadedInserts(text)).toHaveLength(1);
    expect((parseYaml(text) as unknown[]).at(-1)).toEqual({ disabled: false });
    expect(await dshStatus(home)).toMatchObject({ state: "aligned" });
  });

  it("drops an emptied operation that targets REA's own row", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      stringifyYaml([
        { insert: [{ id: "user-a", name: "plugin-a" }] },
        {
          id: "rea-mcp",
          config: { serverName: "rea" },
          insert: [canonicalEntry()],
        },
      ]),
    );

    const host = systemUninstallHost(home);
    expect((await host.removeClient(client)).status).toBe("removed");
    expect(parseYaml(await readFile(client.configPath, "utf8"))).toEqual([
      { insert: [{ id: "user-a", name: "plugin-a" }] },
    ]);
  });

  it.each([
    { selector: { id: "tools" } },
    { selector: { name: "tools" } },
    { selector: { id: "tools", name: "tools" } },
  ])(
    "drops an emptied operation left with only its target selector $selector",
    async ({ selector }) => {
      const { home, client } = await harnessClient();
      await writeFile(
        client.configPath,
        stringifyYaml([
          { insert: [{ id: "user-a", name: "plugin-a" }] },
          { ...selector, insert: [canonicalEntry()] },
        ]),
      );

      expect(
        (await systemUninstallHost(home).removeClient(client)).status,
      ).toBe("removed");
      expect(parseYaml(await readFile(client.configPath, "utf8"))).toEqual([
        { insert: [{ id: "user-a", name: "plugin-a" }] },
      ]);
    },
  );

  it("still drops an insert-only operation that REA's row emptied", async () => {
    const { home, client } = await harnessClient();
    await writeFile(
      client.configPath,
      stringifyYaml([
        { insert: [{ id: "user-a", name: "plugin-a" }] },
        { insert: [canonicalEntry()] },
      ]),
    );

    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    expect(parseYaml(await readFile(client.configPath, "utf8"))).toEqual([
      { insert: [{ id: "user-a", name: "plugin-a" }] },
    ]);
  });
});

it("keeps Cordis YAML syntax failures distinct from unresolved ID ownership", async () => {
  const { home, client } = await harnessClient();
  const initial = "- insert: [{id: [unterminated\n";
  await writeFile(client.configPath, initial);
  const host = systemUninstallHost(home);
  try {
    const inspected = await host.inspectClient(client);
    expect(inspected).toMatchObject({
      status: "failed",
      detail: expect.stringContaining("Invalid or unsupported Cordis YAML"),
    });
    expect(inspected?.detail).not.toContain("unknown ownership");
    expect(await readFile(client.configPath, "utf8")).toBe(initial);
    await expect(
      readFile(`${client.configPath}.rea.backup`),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await host.close?.();
  }
});
