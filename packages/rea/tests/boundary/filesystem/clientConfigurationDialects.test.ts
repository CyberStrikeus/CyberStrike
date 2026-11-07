import { currentClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findNodeAtLocation,
  parse as parseJsonc,
  parseTree,
  type ParseError,
} from "jsonc-parser";

import { readClientRegistrationStatuses } from "../../../src/application/ClientRegistrationStatus.js";
import { configureClientConfiguration } from "../../../src/application/SetupClientConfiguration.js";
import { systemUninstallHost } from "../../../src/application/Uninstall.js";
import { supportedClients } from "../../../src/application/SupportedClients.js";
import { PRODUCT_IDENTITY } from "../../../src/identity.js";
import { classifyClientRegistrationCommand } from "../../../src/application/ClientRegistrationIdentity.js";
import {
  CURRENT_ENTRYPOINT_PATH,
  normalizeEntrypointPath,
} from "../../../src/process/CurrentEntrypointPath.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { clearClientLocationEnvironment } from "../../fixtures/clientEnvironment.js";

const command = currentClientRegistrationCommand();

beforeEach(clearClientLocationEnvironment);

afterEach(() => vi.unstubAllEnvs());

const getClients = (home: string) =>
  supportedClients(home).filter(({ name }) =>
    [
      "opencode",
      "antigravity",
      "copilot_cli",
      "commandcode",
      "vscode",
      "devin",
      "omp",
      "pi",
    ].includes(name),
  );

describe("additional client configuration dialects", () => {
  it("does not uninstall a Node registration whose relative script only matches this process cwd", async () => {
    if (CURRENT_ENTRYPOINT_PATH === undefined)
      throw new Error("test runner entrypoint is unavailable");
    const home = await createTestTempDirectory("rea-relative-uninstall-");
    const cursor = supportedClients(home).find(({ name }) => name === "cursor");
    if (cursor === undefined) throw new Error("missing Cursor client");
    await mkdir(cursor.markerPath ?? home, { recursive: true });
    const relativeScript = relative(process.cwd(), CURRENT_ENTRYPOINT_PATH);
    const registration = {
      command: process.execPath,
      args: [relativeScript, "mcp"],
    };
    await writeFile(
      cursor.configPath,
      JSON.stringify({ mcpServers: { rea: registration } }),
    );

    expect(
      await readClientRegistrationStatuses(home, CURRENT_ENTRYPOINT_PATH),
    ).toContainEqual(
      expect.objectContaining({
        client: "cursor",
        command: [process.execPath, relativeScript, "mcp"],
        state: "unknown",
      }),
    );
    await systemUninstallHost(home).removeClient(cursor);
    const after = parseJsonc(await readFile(cursor.configPath, "utf8")) as {
      readonly mcpServers: Readonly<Record<string, unknown>>;
    };
    expect(after.mcpServers.rea).toEqual(registration);
  });

  it("treats an empty XDG config home as unset for OpenCode setup", async () => {
    const home = await createTestTempDirectory("rea-opencode-empty-xdg-");
    const client = supportedClients(home, "linux", {
      XDG_CONFIG_HOME: "",
    }).find(({ name }) => name === "opencode");
    const expectedPath = join(home, ".config/opencode/opencode.json");
    if (client === undefined) throw new Error("missing opencode client");

    expect(client.configPath).toBe(expectedPath);
    expect(client.configPaths).toContain(expectedPath);
    expect(
      await configureClientConfiguration(client, {}, command),
    ).toMatchObject({ status: "configured" });
    expect(await readFile(expectedPath, "utf8")).toContain('"mcp"');
  });

  it.each([
    "opencode",
    "antigravity",
    "copilot_cli",
    "commandcode",
    "vscode",
    "devin",
    "omp",
    "pi",
  ] as const)("registers, reads back, and uninstalls %s", async (name) => {
    const home = await createTestTempDirectory("rea-client-dialect-");
    const client = getClients(home).find(
      (candidate) => candidate.name === name,
    );
    if (client === undefined) throw new Error(`missing ${name} client`);

    await mkdir(client.markerPath ?? home, { recursive: true });
    const configured = await configureClientConfiguration(client, {}, command);
    expect(configured.status).toBe("configured");
    expect(await configureClientConfiguration(client, {}, command)).toEqual({
      status: "unchanged",
    });

    const text = await readFile(client.configPath, "utf8");
    const document = parseJsonc(text) as Record<string, unknown>;
    const serversKey =
      name === "opencode"
        ? "mcp"
        : name === "vscode"
          ? "servers"
          : "mcpServers";
    const servers = document[serversKey] as Record<
      string,
      Record<string, unknown>
    >;
    const registration = servers[PRODUCT_IDENTITY.mcpServerKey];
    expect(registration).toBeDefined();
    if (name === "opencode")
      expect(registration).toMatchObject({
        type: "local",
        command,
        enabled: true,
      });
    if (name === "vscode" || name === "omp" || name === "pi")
      expect(registration).toMatchObject({
        type: "stdio",
        command: command[0],
        args: command.slice(1),
      });
    if (name === "copilot_cli")
      expect(registration).toMatchObject({ type: "stdio", tools: ["*"] });
    if (name === "commandcode")
      expect(registration).toMatchObject({
        transport: "stdio",
        enabled: true,
        command: command[0],
        args: command.slice(1),
      });

    const statuses = await readClientRegistrationStatuses(home);
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ client: name, state: "aligned", command }),
      ]),
    );

    const removed = await systemUninstallHost(home).removeClient(client);
    expect(removed.status).toBe("removed");
    const afterRemoval = parseJsonc(
      await readFile(client.configPath, "utf8"),
    ) as Record<string, unknown>;
    expect(
      (afterRemoval[serversKey] as Record<string, unknown>)[
        PRODUCT_IDENTITY.mcpServerKey
      ],
    ).toBeUndefined();
  });
});

describe("OpenCode JSONC registration edits", () => {
  it("preserves OpenCode JSONC comments and sibling registrations during update and removal", async () => {
    const home = await createTestTempDirectory("rea-opencode-jsonc-");
    const client = getClients(home).find(({ name }) => name === "opencode");
    if (client === undefined) throw new Error("missing OpenCode client");
    await mkdir(client.markerPath ?? home, { recursive: true });
    const original = `{
  // Client-wide preferences stay intact.
  "model": "provider/model",
  "mcp": {
    // An independently managed server.
    "other": { "type": "local", "command": ["node", "other.js"] },
  },
}\n`;
    await writeFile(client.configPath, original);

    expect(
      await configureClientConfiguration(client, {}, command),
    ).toMatchObject({
      status: "configured",
      backupPath: `${client.configPath}.rea.backup`,
    });
    const updated = await readFile(client.configPath, "utf8");
    const errors: ParseError[] = [];
    const parsed = parseJsonc(updated, errors, {
      allowTrailingComma: true,
    }) as Record<string, unknown>;
    expect(errors).toEqual([]);
    expect(updated).toContain("// Client-wide preferences stay intact.");
    expect(updated).toContain("// An independently managed server.");
    expect(parsed.model).toBe("provider/model");
    expect((parsed.mcp as Record<string, unknown>).other).toBeDefined();
    expect(await readFile(`${client.configPath}.rea.backup`, "utf8")).toBe(
      original,
    );

    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    const removedText = await readFile(client.configPath, "utf8");
    const removedErrors: ParseError[] = [];
    const removed = parseJsonc(removedText, removedErrors, {
      allowTrailingComma: true,
    }) as Record<string, unknown>;
    expect(removedErrors).toEqual([]);
    expect(removedText).toContain("// Client-wide preferences stay intact.");
    expect(removedText).toContain("// An independently managed server.");
    expect((removed.mcp as Record<string, unknown>).rea).toBeUndefined();
    expect((removed.mcp as Record<string, unknown>).other).toBeDefined();
  });

  it("rejects malformed OpenCode JSONC without creating a backup or changing bytes", async () => {
    const home = await createTestTempDirectory("rea-opencode-invalid-");
    const client = getClients(home).find(({ name }) => name === "opencode");
    if (client === undefined) throw new Error("missing OpenCode client");
    await mkdir(client.markerPath ?? home, { recursive: true });
    const invalid = '{ "mcp": { /* broken */ "rea": [ }';
    await writeFile(client.configPath, invalid);

    expect(await configureClientConfiguration(client, {}, command)).toEqual({
      status: "failed",
      reason: "readback",
    });
    expect(await readFile(client.configPath, "utf8")).toBe(invalid);
  });
});

it.each([
  {
    name: "a sole registration without a trailing comma",
    hasBeforeSibling: false,
    hasAfterSibling: false,
    hasGapComment: false,
    afterRegistration: "",
    expectedComment: undefined,
  },
  {
    name: "a sole registration with a trailing comma",
    hasBeforeSibling: false,
    hasAfterSibling: false,
    hasGapComment: false,
    afterRegistration: ",",
    expectedComment: undefined,
  },
  {
    name: "a sole registration with a block comment before its trailing comma",
    hasBeforeSibling: false,
    hasAfterSibling: false,
    hasGapComment: false,
    afterRegistration: " /* Keep this note. */,",
    expectedComment: "/* Keep this note. */",
  },
  {
    name: "a sole registration with a line comment before its trailing comma",
    hasBeforeSibling: false,
    hasAfterSibling: false,
    hasGapComment: false,
    afterRegistration: " // Keep this note.\n  ,",
    expectedComment: "// Keep this note.",
  },
  {
    name: "a registration with a surviving sibling and block comment before its comma",
    hasBeforeSibling: true,
    hasAfterSibling: true,
    hasGapComment: true,
    afterRegistration:
      ' /* Keep this note. */,\n    "after": { "command": "after" }',
    expectedComment: "/* Keep this note. */",
  },
  {
    name: "a registration with a surviving sibling and line comment before its comma",
    hasBeforeSibling: true,
    hasAfterSibling: true,
    hasGapComment: true,
    afterRegistration:
      ' // Keep this note.\n  ,\n    "after": { "command": "after" }',
    expectedComment: "// Keep this note.",
  },
  {
    name: "a first registration with a surviving sibling and block comment before its comma",
    hasBeforeSibling: false,
    hasAfterSibling: true,
    hasGapComment: false,
    afterRegistration:
      ' /* Keep this note. */ ,\n    "after": { "command": "after" }',
    expectedComment: "/* Keep this note. */",
  },
] as const)(
  "Cursor removes $name and preserves surrounding configuration",
  async ({
    hasBeforeSibling,
    hasAfterSibling,
    hasGapComment,
    afterRegistration,
    expectedComment,
  }) => {
    const home = await createTestTempDirectory("rea-cursor-jsonc-remove-");
    const client = supportedClients(home).find(({ name }) => name === "cursor");
    if (client === undefined) throw new Error("missing Cursor client");
    await mkdir(client.markerPath ?? home, { recursive: true });

    const original = `{
  // Keep unrelated client preferences.
  "theme": "dark",
  "mcpServers": {
${hasBeforeSibling ? '    "before": { "command": "before" },\n' : ""}  }
}\n`;
    await writeFile(client.configPath, original);
    expect(
      await configureClientConfiguration(client, {}, command),
    ).toMatchObject({
      status: "configured",
      backupPath: `${client.configPath}.rea.backup`,
    });

    const configured = await readFile(client.configPath, "utf8");
    let edited = configured;
    if (hasGapComment) {
      const root = parseTree(edited, [], { allowTrailingComma: true });
      const registration =
        root === undefined
          ? undefined
          : findNodeAtLocation(root, [
              "mcpServers",
              PRODUCT_IDENTITY.mcpServerKey,
            ]);
      const property = registration?.parent;
      if (property === undefined)
        throw new Error("configured Cursor registration property is missing");
      edited =
        edited.slice(0, property.offset) +
        "// Keep the comment before the registration.\n    " +
        edited.slice(property.offset);
    }
    const root = parseTree(edited, [], { allowTrailingComma: true });
    const registration =
      root === undefined
        ? undefined
        : findNodeAtLocation(root, [
            "mcpServers",
            PRODUCT_IDENTITY.mcpServerKey,
          ]);
    if (registration === undefined)
      throw new Error("configured Cursor registration is missing");
    const registrationEnd = registration.offset + registration.length;
    edited =
      edited.slice(0, registrationEnd) +
      afterRegistration +
      edited.slice(registrationEnd);
    await writeFile(client.configPath, edited);

    const backup = await readFile(`${client.configPath}.rea.backup`, "utf8");
    const removed = await systemUninstallHost(home).removeClient(client);
    expect(removed.status).toBe("removed");
    const removedText = await readFile(client.configPath, "utf8");
    const errors: ParseError[] = [];
    const document = parseJsonc(removedText, errors, {
      allowTrailingComma: true,
    }) as Record<string, unknown>;
    expect(errors).toEqual([]);
    expect(document.theme).toBe("dark");
    expect(removedText).toContain("// Keep unrelated client preferences.");
    if (expectedComment !== undefined)
      expect(removedText).toContain(expectedComment);
    if (hasGapComment)
      expect(removedText).toContain(
        "// Keep the comment before the registration.",
      );
    expect(
      (document.mcpServers as Record<string, unknown>).rea,
    ).toBeUndefined();
    if (hasBeforeSibling)
      expect(document.mcpServers).toMatchObject({
        before: { command: "before" },
      });
    if (hasAfterSibling)
      expect(document.mcpServers).toMatchObject({
        after: { command: "after" },
      });
    if (!hasBeforeSibling && !hasAfterSibling)
      expect(document.mcpServers).toEqual({});
    expect(await readFile(`${client.configPath}.rea.backup`, "utf8")).toBe(
      backup,
    );

    const repeated = await systemUninstallHost(home).removeClient(client);
    expect(repeated.status).toBe("skipped");
    expect(await readFile(client.configPath, "utf8")).toBe(removedText);
    expect(await readFile(`${client.configPath}.rea.backup`, "utf8")).toBe(
      backup,
    );
  },
);

const parseOpenCode = (text: string): Record<string, unknown> => {
  const errors: ParseError[] = [];
  const document = parseJsonc(text, errors, {
    allowTrailingComma: true,
  }) as Record<string, unknown>;
  expect(errors).toEqual([]);
  return document;
};

const openCodeClient = async (prefix: string) => {
  const home = await createTestTempDirectory(prefix);
  const client = getClients(home).find(({ name }) => name === "opencode");
  if (client === undefined) throw new Error("missing OpenCode client");
  await mkdir(client.markerPath ?? home, { recursive: true });
  return { home, client };
};

const legacyEntry = JSON.stringify({ type: "local", command, enabled: true });

describe("OpenCode V2 native server table", () => {
  it("registers in mcp.servers, replaces REA's V1 entry, and uninstalls", async () => {
    const { home, client } = await openCodeClient("rea-opencode-v2-");
    await writeFile(
      client.configPath,
      `{
  "mcp": {
    // Default timeouts are not a server.
    "timeout": { "catalog": 30000 },
    "servers": {
      // An independently managed server.
      "other": { "type": "local", "command": ["node", "other.js"] },
    },
    "rea": ${legacyEntry},
  },
}\n`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    expect(await configureClientConfiguration(client, {}, command)).toEqual({
      status: "unchanged",
    });
    const text = await readFile(client.configPath, "utf8");
    expect(text).toContain("// Default timeouts are not a server.");
    expect(text).toContain("// An independently managed server.");
    expect(parseOpenCode(text).mcp).toEqual({
      timeout: { catalog: 30000 },
      servers: {
        other: { type: "local", command: ["node", "other.js"] },
        rea: { type: "local", command: [...command], disabled: false },
      },
    });
    expect(await readClientRegistrationStatuses(home)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          client: "opencode",
          state: "aligned",
          command,
        }),
      ]),
    );

    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    expect(
      parseOpenCode(await readFile(client.configPath, "utf8")).mcp,
    ).toEqual({
      timeout: { catalog: 30000 },
      servers: { other: { type: "local", command: ["node", "other.js"] } },
    });
  });

  it("updates and removes REA's entry after OpenCode migrates it to mcp.servers", async () => {
    const { home, client } = await openCodeClient("rea-opencode-migrated-");
    const stale = ["npx", "-y", `${PRODUCT_IDENTITY.packageName}@3.2.0`, "mcp"];
    await writeFile(
      client.configPath,
      `${JSON.stringify({ mcp: { servers: { rea: { type: "local", command: stale } } } })}\n`,
    );

    expect(await readClientRegistrationStatuses(home)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ client: "opencode", command: stale }),
      ]),
    );
    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    expect(
      parseOpenCode(await readFile(client.configPath, "utf8")).mcp,
    ).toEqual({
      servers: {
        rea: { type: "local", command: [...command], disabled: false },
      },
    });
    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    expect(
      parseOpenCode(await readFile(client.configPath, "utf8")).mcp,
    ).toEqual({
      servers: {},
    });
  });

  it("reports and removes a V1 entry that OpenCode still loads beside mcp.servers", async () => {
    const { home, client } = await openCodeClient("rea-opencode-mixed-");
    await writeFile(
      client.configPath,
      `{ "mcp": { "servers": {}, "rea": ${legacyEntry} } }\n`,
    );

    expect(await readClientRegistrationStatuses(home)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          client: "opencode",
          state: "aligned",
          command,
        }),
      ]),
    );
    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    expect(
      parseOpenCode(await readFile(client.configPath, "utf8")).mcp,
    ).toEqual({
      servers: {},
    });
  });

  it("treats a V2 table holding a server named type as native", async () => {
    const { home, client } = await openCodeClient("rea-opencode-type-server-");
    const typeServer = { type: "local", command: ["node", "type.js"] };
    await writeFile(
      client.configPath,
      `${JSON.stringify({ mcp: { servers: { type: typeServer, rea: { type: "local", command } } } })}\n`,
    );

    expect(await readClientRegistrationStatuses(home)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          client: "opencode",
          state: "aligned",
          command,
        }),
      ]),
    );
    expect((await systemUninstallHost(home).removeClient(client)).status).toBe(
      "removed",
    );
    expect(
      parseOpenCode(await readFile(client.configPath, "utf8")).mcp,
    ).toEqual({
      servers: { type: typeServer },
    });
  });

  it("keeps a V1 server named servers in the V1 table", async () => {
    const { client } = await openCodeClient("rea-opencode-v1-servers-");
    const servers = { type: "local", command: ["node", "servers.js"] };
    await writeFile(
      client.configPath,
      `${JSON.stringify({ mcp: { servers } })}\n`,
    );

    expect(
      (await configureClientConfiguration(client, {}, command)).status,
    ).toBe("configured");
    expect(
      parseOpenCode(await readFile(client.configPath, "utf8")).mcp,
    ).toEqual({
      servers,
      rea: { type: "local", command: [...command], enabled: true },
    });
  });
});

describe("platform-aware client config paths", () => {
  it.each([
    [
      "darwin",
      "/home/a",
      {},
      "/home/a/Library/Application Support/Code/User/mcp.json",
    ],
    ["linux", "/home/a", {}, "/home/a/.config/Code/User/mcp.json"],
    [
      "win32",
      "C:/Users/a",
      {},
      "C:/Users/a/AppData/Roaming/Code/User/mcp.json",
    ],
    [
      "linux",
      "/home/a",
      { XDG_CONFIG_HOME: "/config" },
      "/config/Code/User/mcp.json",
    ],
  ] as const)(
    "resolves VS Code user MCP path for %s",
    (platform, home, env, expected) => {
      expect(
        supportedClients(home, platform, env).find(
          ({ name }) => name === "vscode",
        )?.configPath,
      ).toBe(expected);
    },
  );

  it("honors Grok Build and Grok Bot configuration roots", () => {
    expect(
      supportedClients("/home/a", "linux", {
        GROK_HOME: "/custom/grok",
        SAND_DATA_ROOT: "/custom/grokbot",
      }).filter(({ name }) => name === "grok_build" || name === "grok_bot"),
    ).toEqual([
      expect.objectContaining({
        name: "grok_build",
        displayName: "Grok Build",
        configPath: "/custom/grok/config.toml",
        markerPath: "/custom/grok",
        format: "grok",
      }),
      expect.objectContaining({
        name: "grok_bot",
        displayName: "Grok Bot",
        configPath: "/custom/grokbot",
        markerPath: "/custom/grokbot",
        format: "unsupported",
      }),
    ]);
    expect(
      supportedClients("/home/a", "linux", {
        SAND_DATA_ROOT: "relative/sand",
      }).find(({ name }) => name === "grok_bot")?.configPath,
    ).toBe("/home/a/.grokbot");
    expect(
      supportedClients("/home/a", "darwin", {}).find(
        ({ name }) => name === "grok_build",
      )?.configPath,
    ).toBe("/home/a/.grok/config.toml");
  });

  it("honors Copilot CLI and Devin platform configuration roots", () => {
    expect(
      supportedClients("/home/a", "linux", {
        COPILOT_HOME: "/custom/copilot",
        XDG_CONFIG_HOME: "/custom/config",
      }).find(({ name }) => name === "copilot_cli")?.configPath,
    ).toBe("/custom/copilot/mcp-config.json");
    expect(
      supportedClients("C:/Users/a", "win32", {
        APPDATA: "D:/Profile/Roaming",
      }).find(({ name }) => name === "devin")?.configPath,
    ).toBe("D:/Profile/Roaming/devin/mcp_config.json");
  });

  it("prefers an existing OpenCode JSONC file and honors explicit harness roots", async () => {
    const home = await createTestTempDirectory("rea-config-overrides-");
    const opencodeDirectory = join(home, ".config/opencode");
    await mkdir(opencodeDirectory, { recursive: true });
    await writeFile(join(opencodeDirectory, "opencode.jsonc"), "{}\n");
    const clients = supportedClients(home, "linux", {});
    expect(clients.find(({ name }) => name === "opencode")?.configPath).toBe(
      join(opencodeDirectory, "opencode.jsonc"),
    );
    expect(
      supportedClients(home, "linux", {
        OPENCODE_CONFIG: "/custom/open-code.jsonc",
        CLAUDE_CONFIG_DIR: "/custom/claude",
        CODEX_HOME: "/custom/codex",
      }).filter(({ name }) =>
        ["opencode", "claude_code", "codex"].includes(name),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "opencode",
          configPath: "/custom/open-code.jsonc",
        }),
        expect.objectContaining({
          name: "claude_code",
          configPath: "/custom/claude/.claude.json",
        }),
        expect.objectContaining({
          name: "codex",
          configPath: "/custom/codex/config.toml",
        }),
      ]),
    );
  });
});

describe("client registration command ownership", () => {
  it.skipIf(process.platform === "win32").each([
    ["rea", "rea-agents"],
    ["rea-agents", "rea"],
  ])(
    "recognizes %s through its %s launcher alias",
    async (registered, current) => {
      const root = await createTestTempDirectory("rea-launcher-alias-");
      const script = join(root, "entry.mjs");
      await writeFile(script, "// owned dispatcher\n");
      await symlink(script, join(root, registered));
      await symlink(script, join(root, current));
      for (const command of [
        [join(root, registered), "mcp"],
        [process.execPath, join(root, registered), "mcp"],
      ]) {
        expect(
          classifyClientRegistrationCommand(command, join(root, current)),
        ).toBe("owned");
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "distinguishes a confirmed different script from an unresolved alias",
    async () => {
      const root = await createTestTempDirectory("rea-launcher-foreign-");
      const owned = join(root, "entry.mjs");
      const foreign = join(root, "other.mjs");
      await writeFile(owned, "// owned\n");
      await writeFile(foreign, "// foreign\n");
      await symlink(owned, join(root, "rea"));
      await symlink(foreign, join(root, "rea-agents"));
      await symlink(join(root, "missing.mjs"), join(root, "missing"));
      for (const candidate of ["rea-agents", "missing"]) {
        const command = [join(root, candidate), "mcp"];
        expect(
          classifyClientRegistrationCommand(command, join(root, "rea")),
        ).toBe(candidate === "missing" ? "unknown" : "foreign");
      }
    },
  );

  it
    .skipIf(process.platform === "win32")
    .each(["registered", "current"] as const)(
    "preserves unknown identity when the %s alias cannot resolve",
    async (unresolved) => {
      const root = await createTestTempDirectory("rea-launcher-unresolved-");
      const script = join(root, "entry.mjs");
      await writeFile(script, "// current dispatcher\n");
      await symlink(join(root, "removed-release.mjs"), join(root, "dangling"));
      await symlink(join(root, "cycle-b"), join(root, "cycle-a"));
      await symlink(join(root, "cycle-a"), join(root, "cycle-b"));
      for (const alias of ["dangling", "cycle-a"]) {
        const registered =
          unresolved === "registered" ? join(root, alias) : script;
        const current = unresolved === "current" ? join(root, alias) : script;
        for (const command of [
          [registered, "mcp"],
          [process.execPath, registered, "mcp"],
        ])
          expect(classifyClientRegistrationCommand(command, current)).toBe(
            "unknown",
          );
      }
    },
  );
});

describe("client launcher traversal semantics", () => {
  it.skipIf(process.platform === "win32")(
    "distinguishes native executable traversal from Node script argument selection",
    async () => {
      const root = await createTestTempDirectory(
        "rea-launcher-parent-segment-",
      );
      const current = join(root, "entry.mjs");
      const foreign = join(root, "other", "entry.mjs");
      await mkdir(join(root, "other", "child"), { recursive: true });
      await writeFile(current, "// current dispatcher\n");
      await writeFile(foreign, "// foreign dispatcher\n");
      await symlink(join(root, "other", "child"), join(root, "link"));
      const candidate = `${root}/link/../entry.mjs`;
      expect(await readFile(candidate, "utf8")).toBe("// foreign dispatcher\n");
      expect(
        await readFile(normalizeEntrypointPath(candidate, "node")!, "utf8"),
      ).toBe("// current dispatcher\n");
      expect(
        await readFile(normalizeEntrypointPath(candidate, "bun")!, "utf8"),
      ).toBe("// foreign dispatcher\n");
      expect(
        classifyClientRegistrationCommand([candidate, "mcp"], current),
      ).toBe("unknown");
      expect(
        classifyClientRegistrationCommand([candidate, "mcp"], foreign),
      ).toBe("unknown");
      expect(
        classifyClientRegistrationCommand(
          [process.execPath, candidate, "mcp"],
          current,
        ),
      ).toBe("owned");
      const unresolvable = `${root}/missing/../entry.mjs`;
      await expect(
        readFile(normalizeEntrypointPath(unresolvable, "bun")!, "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        classifyClientRegistrationCommand([unresolvable, "mcp"], current),
      ).toBe("unknown");
      expect(
        classifyClientRegistrationCommand([current, "mcp"], unresolvable),
      ).toBe("unknown");
      expect(
        classifyClientRegistrationCommand(
          [process.execPath, unresolvable, "mcp"],
          current,
        ),
      ).toBe("owned");
      const nodeAlias = join(root, "node-alias");
      await symlink(process.execPath, nodeAlias);
      expect(
        classifyClientRegistrationCommand([nodeAlias, current, "mcp"], current),
      ).toBe("owned");
    },
  );

  it("recognizes prior exact REA releases while rejecting foreign package commands", () => {
    expect(classifyClientRegistrationCommand(["rea", "mcp"], undefined)).toBe(
      "owned",
    );
    const cwdMatchingEntry = resolve("./rea");
    expect(
      classifyClientRegistrationCommand(["./rea", "mcp"], cwdMatchingEntry),
    ).toBe("unknown");
    expect(
      classifyClientRegistrationCommand(
        ["npx", "-y", `${PRODUCT_IDENTITY.packageName}@3.2.0`, "mcp"],
        undefined,
      ),
    ).toBe("owned");
    expect(
      classifyClientRegistrationCommand(
        ["npx", "-y", "another-package", "mcp"],
        undefined,
      ),
    ).toBe("foreign");
    expect(
      classifyClientRegistrationCommand(
        ["bunx", `${PRODUCT_IDENTITY.packageName}@3.2.0`, "mcp"],
        undefined,
      ),
    ).toBe("owned");
    expect(
      classifyClientRegistrationCommand(
        ["bunx", "another-package", "mcp"],
        undefined,
      ),
    ).toBe("foreign");
    expect(
      classifyClientRegistrationCommand(
        [process.execPath, "/packaged/rea.mjs", "mcp"],
        "/packaged/rea.mjs",
      ),
    ).toBe("owned");
    expect(
      classifyClientRegistrationCommand(
        [process.execPath, resolve("unknown"), "mcp"],
        normalizeEntrypointPath(""),
      ),
    ).toBe("unknown");
    expect(
      classifyClientRegistrationCommand(
        ["node", "/packaged/other-agent.mjs", "mcp"],
        "/packaged/rea.mjs",
      ),
    ).toBe("unknown");
  });
});
