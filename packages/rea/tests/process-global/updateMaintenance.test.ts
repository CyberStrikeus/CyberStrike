import {
  UpdateCommandRunner,
  UPDATE_COMMAND_OUTPUT_BYTES,
} from "../../src/application/UpdateCommandRunner.js";
import { mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "../../src/domain/result.js";
import { runUpdate, type UpdateResult } from "../../src/application/Update.js";
import { PRODUCT_IDENTITY } from "../../src/identity.js";
import { supportedClients } from "../../src/application/SupportedClients.js";
import { readClientRegistrationInspections } from "../../src/application/ClientRegistrationStatus.js";
import {
  existingMaintenanceScope,
  planIntegrationMaintenance,
} from "../../src/application/UpdateMaintenance.js";
import { systemUpdateHost } from "../../src/application/UpdateRuntime.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

const entryPoint = resolve("scripts/rea.mjs");
let home: string;

beforeEach(async () => {
  home = await createTestTempDirectory("rea-update-maintenance-");
  for (const [name, value] of Object.entries({
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    CLAUDE_CONFIG_DIR: home,
    CODEX_HOME: join(home, ".codex"),
    COPILOT_HOME: join(home, ".copilot"),
    GROK_HOME: join(home, ".grok"),
    SAND_DATA_ROOT: join(home, ".grokbot"),
    XDG_CONFIG_HOME: join(home, ".config"),
    OPENCODE_CONFIG: join(home, ".config", "opencode", "opencode.jsonc"),
    OMP_PROFILE: undefined,
    PI_CODING_AGENT_DIR: undefined,
    PI_CONFIG_DIR: undefined,
    PI_PROFILE: undefined,
  }))
    vi.stubEnv(name, value);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

const writeClient = async (id: string, content: string): Promise<string> => {
  const client = supportedClients(home).find(({ name }) => name === id);
  if (client === undefined) throw new Error(`Unknown test client ${id}`);
  await mkdir(dirname(client.configPath), { recursive: true });
  await writeFile(client.configPath, content);
  return client.configPath;
};

const writeSkill = async (content: string): Promise<string> => {
  const path = join(
    home,
    ".agents",
    "skills",
    PRODUCT_IDENTITY.skillName,
    "SKILL.md",
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
};

const staleCodex =
  '[mcp_servers.rea]\ncommand = "npx"\nargs = ["-y", "rea-agents@0.1.0", "mcp"]\n';
const action = {
  id: "configure_client:codex",
  kind: "configure_client",
  label: "Codex",
  target: "/test/.codex/config.toml",
  detail: "Refresh the pinned REA version",
  external: false,
  operation: "update",
  backupPath: "/test/.codex/config.toml.rea.backup",
  commands: ["rea mcp"],
};

describe("OMP integration maintenance", () => {
  it("refreshes an OMP entry that enabledServers forces on", async () => {
    const entry = { type: "stdio", command: entryPoint, args: ["mcp"] };
    await writeClient(
      "omp",
      JSON.stringify({ mcpServers: { rea: { ...entry, enabled: false } } }),
    );
    await expect(
      existingMaintenanceScope(home, entryPoint, process.env),
    ).resolves.toMatchObject({ clients: [] });
    await writeClient(
      "omp",
      JSON.stringify({
        mcpServers: { rea: { ...entry, enabled: false } },
        enabledServers: ["rea"],
      }),
    );
    await expect(
      existingMaintenanceScope(home, entryPoint, process.env),
    ).resolves.toMatchObject({ clients: ["omp"] });
  });

  it("preserves Grok Build disabled_mcp_servers during maintenance planning", async () => {
    // Strict identity: a user-disabled integration must never be selected
    // for maintenance, even with a healthy owned entry underneath.
    const registration = `[mcp_servers.rea]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(entryPoint)}, "mcp"]\nstartup_timeout_sec = 30\n`;
    const configPath = await writeClient(
      "grok_build",
      `disabled_mcp_servers = ["rea", "other"]\n${registration}`,
    );
    await expect(
      existingMaintenanceScope(home, entryPoint, process.env),
    ).resolves.toMatchObject({ clients: [] });
    expect(await readFile(configPath, "utf8")).toContain(
      'disabled_mcp_servers = ["rea", "other"]',
    );
    await writeFile(
      configPath,
      `disabled_mcp_servers = ["other"]\n${registration}`,
    );
    await expect(
      existingMaintenanceScope(home, entryPoint, process.env),
    ).resolves.toMatchObject({ clients: ["grok_build"] });
  });
});

describe("maintenance activation and layered configuration", () => {
  it("keeps unresolved registrations out of writes without calling them current", async () => {
    await writeClient("codex", staleCodex);
    const cursor = await writeClient(
      "cursor",
      JSON.stringify({
        mcpServers: {
          rea: { command: join(home, "removed-release", "rea"), args: ["mcp"] },
        },
      }),
    );
    const before = await readFile(cursor, "utf8");
    const result = await planIntegrationMaintenance(
      home,
      entryPoint,
      process.env,
      () => {
        throw new Error("An unresolved maintenance scope must not be executed");
      },
    );
    expect(result).toMatchObject({
      status: "unavailable",
      scope: {
        clients: ["codex"],
        unresolved: [
          expect.objectContaining({
            client: "cursor",
            state: "unknown",
            config_path: cursor,
          }),
        ],
      },
      remediation: expect.stringContaining("cursor"),
    });
    expect(await readFile(cursor, "utf8")).toBe(before);
  });

  it("leaves an inherited disabled OpenCode V2 registration outside maintenance", async () => {
    const upper = await writeClient(
      "opencode",
      JSON.stringify({ mcp: { servers: {} }, theme: "user-selected" }),
    );
    const lower = join(home, ".config", "opencode", "config.json");
    const originalLower = JSON.stringify({
      mcp: {
        servers: {
          rea: { type: "local", command: [entryPoint, "mcp"], disabled: true },
        },
      },
    });
    await writeFile(lower, originalLower);
    const originalUpper = await readFile(upper, "utf8");
    await expect(
      existingMaintenanceScope(home, entryPoint, process.env),
    ).resolves.toMatchObject({ clients: [] });
    expect(await readFile(lower, "utf8")).toBe(originalLower);
    expect(await readFile(upper, "utf8")).toBe(originalUpper);
  });

  it("leaves a natively disabled ZCode registration outside maintenance", async () => {
    const configPath = await writeClient(
      "zcode",
      JSON.stringify({
        mcp: {
          servers: {
            rea: { command: entryPoint, args: ["mcp"], enable: false },
          },
        },
      }),
    );
    const original = await readFile(configPath, "utf8");
    await expect(
      existingMaintenanceScope(home, entryPoint, process.env),
    ).resolves.toMatchObject({ clients: [] });
    expect(await readFile(configPath, "utf8")).toBe(original);
  });

  it("selects a ZCode registration loaded from the same-scope fallback", async () => {
    await writeClient("zcode", JSON.stringify({ mcp: { servers: {} } }));
    const fallbackPath = join(home, ".agents", "mcp.json");
    await mkdir(join(home, ".agents"), { recursive: true });
    await writeFile(
      fallbackPath,
      JSON.stringify({
        mcpServers: { rea: { command: entryPoint, args: ["mcp"] } },
      }),
    );

    // The fallback row is also FreeBuff's registration, and FreeBuff is the
    // setup action that rewrites it, so both views stay in maintenance scope.
    await expect(
      existingMaintenanceScope(home, entryPoint, process.env),
    ).resolves.toMatchObject({ clients: ["freebuff", "zcode"] });
  });

  it("selects an enabled registration inherited through layered OpenCode files", async () => {
    const directory = join(home, ".config", "opencode");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "opencode.json"),
      JSON.stringify({
        mcp: { rea: { type: "local", command: [entryPoint, "mcp"] } },
      }),
    );
    await writeClient("opencode", JSON.stringify({ theme: "user-selected" }));
    await expect(
      existingMaintenanceScope(home, entryPoint, process.env),
    ).resolves.toMatchObject({ clients: ["opencode"] });
  });
});

describe("registration ownership in maintenance", () => {
  it("selects owned registrations while preserving unconfigured, foreign, and disabled choices", async () => {
    await writeClient("codex", staleCodex);
    await writeClient("claude_code", '{"mcpServers":{}}');
    await writeClient(
      "cursor",
      '{"mcpServers":{"rea":{"command":"foreign-server","args":[]}}}',
    );
    await writeClient(
      "opencode",
      '{"mcp":{"rea":{"type":"local","command":["npx","-y","rea-agents@0.1.0","mcp"],"enabled":false}}}',
    );
    await writeClient(
      "vscode",
      JSON.stringify({
        servers: { rea: { type: "stdio", command: entryPoint, args: ["mcp"] } },
      }),
    );
    expect(
      await readClientRegistrationInspections(home, entryPoint, {
        environment: process.env,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: expect.objectContaining({ client: "codex", state: "stale" }),
          activation: "enabled",
          commandIdentity: "owned",
        }),
        expect.objectContaining({
          status: expect.objectContaining({ client: "cursor", state: "stale" }),
          activation: "enabled",
          commandIdentity: "foreign",
        }),
        expect.objectContaining({
          status: expect.objectContaining({
            client: "opencode",
            state: "stale",
          }),
          activation: "disabled",
          commandIdentity: "owned",
        }),
        expect.objectContaining({
          status: expect.objectContaining({
            client: "claude_code",
            state: "missing",
          }),
          activation: "unknown",
          commandIdentity: "unknown",
        }),
      ]),
    );
    await expect(
      existingMaintenanceScope(home, entryPoint, process.env),
    ).resolves.toEqual({
      clients: ["codex", "vscode"],
      skill: false,
      skillDestinations: [],
    });
  });
});

describe("existing REA integration maintenance", () => {
  it("does not install a missing skill or overwrite an unrelated skill", async () => {
    await expect(
      existingMaintenanceScope(home, entryPoint, process.env),
    ).resolves.toEqual({
      clients: [],
      skill: false,
      skillDestinations: [],
    });
    await writeSkill("---\nname: another-skill\n---\nUser-authored content\n");
    await expect(
      existingMaintenanceScope(home, entryPoint, process.env),
    ).resolves.toEqual({
      clients: [],
      skill: false,
      skillDestinations: [],
    });
  });

  it("includes an existing REA skill and leaves files untouched", async () => {
    const path = await writeSkill(
      `---\nname: ${PRODUCT_IDENTITY.skillName}\nmetadata:\n  version: "1"\n---\n# REA\n`,
    );
    const original = await readFile(path, "utf8");
    await expect(
      existingMaintenanceScope(home, entryPoint, process.env),
    ).resolves.toEqual({
      clients: [],
      skill: true,
      skillDestinations: [
        {
          client: "shared",
          path: join(home, ".agents", "skills", PRODUCT_IDENTITY.skillName),
        },
      ],
    });
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("skips setup entirely when there is no existing integration", async () => {
    let invoked = false;
    const result = await planIntegrationMaintenance(
      home,
      entryPoint,
      process.env,
      async () => {
        invoked = true;
        return err("Unexpected setup");
      },
    );
    expect(result).toEqual({ status: "current", plannedActions: [] });
    expect(invoked).toBe(false);
  });

  it("returns exact backup and command evidence with a scoped unapplied setup command", async () => {
    await writeClient("codex", staleCodex);
    const recorded: string[][] = [];
    const result = await planIntegrationMaintenance(
      home,
      entryPoint,
      process.env,
      async (command) => {
        recorded.push([...command]);
        return ok(
          JSON.stringify({ status: "planned", plannedActions: [action] }),
        );
      },
    );
    expect(recorded).toEqual([
      [
        process.execPath,
        entryPoint,
        "setup",
        "--client",
        "codex",
        "--skill=false",
        "--dry-run",
        "--json",
      ],
    ]);
    expect(result).toEqual({
      status: "planned",
      scope: { clients: ["codex"], skill: false, skillDestinations: [] },
      command: recorded[0]?.slice(0, -2),
      plannedActions: [action],
    });
  });

  it.each([
    "{broken",
    JSON.stringify({ status: "ready", plannedActions: [action] }),
    JSON.stringify({
      status: "planned",
      plannedActions: [{ ...action, kind: "install_hopper", external: true }],
    }),
    JSON.stringify({
      status: "planned",
      plannedActions: [{ ...action, id: "configure_client:cursor" }],
    }),
  ])("rejects malformed or out-of-scope subprocess plans", async (output) => {
    await writeClient("codex", staleCodex);
    expect(
      await planIntegrationMaintenance(
        home,
        entryPoint,
        process.env,
        async () => ok(output),
      ),
    ).toMatchObject({ status: "unavailable" });
  });

  it("preserves actual setup failure diagnostics", async () => {
    await writeClient("codex", staleCodex);
    expect(
      await planIntegrationMaintenance(
        home,
        entryPoint,
        process.env,
        async () => err("EACCES /test/.codex/config.toml"),
      ),
    ).toEqual({
      status: "unavailable",
      remediation: "EACCES /test/.codex/config.toml",
    });
  });
});

describe("shared registration maintenance", () => {
  it("refreshes an owned shared registration without its product profile", async () => {
    // FreeBuff's registration lives in the shared user agents file. The row is
    // owned, so maintenance must refresh it even though no FreeBuff profile
    // exists to establish product applicability.
    await writeClient(
      "freebuff",
      JSON.stringify({
        mcpServers: {
          other: { command: "other-server" },
          rea: { command: entryPoint, args: ["mcp"] },
        },
      }),
    );
    await expect(
      existingMaintenanceScope(home, entryPoint, process.env),
    ).resolves.toEqual({
      clients: ["freebuff"],
      skill: false,
      skillDestinations: [],
    });
  });

  it("retains FreeBuff when ZCode reads the shared fallback", async () => {
    // Both products load the one shared row, but their setup actions write
    // different files: ZCode writes ~/.zcode/cli/config.json and deliberately
    // leaves ~/.agents/mcp.json untouched (docs/client-configuration.md), so
    // its fallback view cannot cover FreeBuff's registration. The shared row
    // would stay pinned to the old version without FreeBuff's own action.
    await writeClient("zcode", JSON.stringify({ mcp: { servers: {} } }));
    await mkdir(join(home, ".config", "freebuff-desktop"), {
      recursive: true,
    });
    await writeClient(
      "freebuff",
      JSON.stringify({
        mcpServers: {
          rea: { command: "npx", args: ["-y", "rea-agents@0.1.0", "mcp"] },
        },
      }),
    );

    await expect(
      existingMaintenanceScope(home, entryPoint, process.env),
    ).resolves.toMatchObject({ clients: ["freebuff", "zcode"] });
  });

  it("leaves a foreign shared registration out of maintenance", async () => {
    await writeClient(
      "freebuff",
      JSON.stringify({
        mcpServers: { rea: { command: "foreign-server", args: [] } },
      }),
    );
    await expect(
      existingMaintenanceScope(home, entryPoint, process.env),
    ).resolves.toEqual({
      clients: [],
      skill: false,
      skillDestinations: [],
    });
  });

  it("leaves a ZCode-disabled shared row out of maintenance", async () => {
    // The shared file doubles as ZCode's fallback, where `enable: false`
    // disables the registration. Ownership evidence must not let maintenance
    // rewrite the row as a FreeBuff registration and drop that flag.
    const configPath = await writeClient(
      "freebuff",
      JSON.stringify({
        mcpServers: {
          rea: { command: entryPoint, args: ["mcp"], enable: false },
        },
      }),
    );
    const original = await readFile(configPath, "utf8");
    await expect(
      existingMaintenanceScope(home, entryPoint, process.env),
    ).resolves.toEqual({
      clients: [],
      skill: false,
      skillDestinations: [],
    });
    expect(await readFile(configPath, "utf8")).toBe(original);
  });
});

describe("updated executable maintenance planning", () => {
  it("runs real setup as a noninteractive dry run and creates no new integrations or backups", async () => {
    const configPath = await writeClient("codex", staleCodex);
    const untouched = await writeClient("claude_code", '{"mcpServers":{}}');
    const skillContent = `---\nname: ${PRODUCT_IDENTITY.skillName}\nmetadata:\n  version: "1"\n---\n# REA\n`;
    const skillPath = await writeSkill(skillContent);
    vi.stubEnv("npm_command", "exec");
    const result = await planIntegrationMaintenance(
      home,
      entryPoint,
      process.env,
      async (command) => {
        const result = await updateCommands.runProbe(command, process.env);
        return result.ok ? result : err(result.error.detail);
      },
    );
    expect(result).toMatchObject({
      status: "planned",
      scope: {
        clients: ["codex"],
        skill: true,
        skillDestinations: [{ client: "shared", path: dirname(skillPath) }],
      },
    });
    if (result.status !== "planned") throw new Error(JSON.stringify(result));
    expect(result.plannedActions).toEqual([
      expect.objectContaining({
        id: "configure_client:codex",
        kind: "configure_client",
      }),
      expect.objectContaining({
        id: "install_skill",
        kind: "install_skill",
        target: dirname(skillPath),
      }),
    ]);
    expect(await readFile(configPath, "utf8")).toBe(staleCodex);
    expect(await readFile(untouched, "utf8")).toBe('{"mcpServers":{}}');
    expect(await readFile(skillPath, "utf8")).toBe(skillContent);
    await expect(access(`${configPath}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(`${skillPath}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      access(join(home, ".claude", "skills", PRODUCT_IDENTITY.skillName)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("update subprocess boundaries", () => {
  cliTest(
    "exposes update in CLI help",
    async ({ cli }) => {
      const help = await cli.run({
        arguments: ["--help"],
        environment: process.env,
      });
      expect(help.exitCode, help.stderr).toBe(0);
      expect(help.stdout).toMatch(/^\s{2}update\s/mu);
      expect(help.stdout).not.toMatch(/^\s{2}upgrade\s/mu);
    },
    60_000,
  );

  cliTest("rejects the removed upgrade CLI command", async ({ cli }) => {
    const removed = await cli.run({
      arguments: ["upgrade", "--json"],
      environment: process.env,
    });
    expect(removed.exitCode, removed.stderr).toBe(1);
    expect(removed.json).toMatchObject({ code: "COMMAND_NOT_FOUND" });
  });
  it("captures output through stream closure and keeps arguments literal", async () => {
    const literal = 'space and $(echo bad); & | "quotes"';
    const result = await updateCommands.runProbe(
      [
        process.execPath,
        "-e",
        'process.stdout.write("x".repeat(1024 * 1024) + process.argv[1])',
        literal,
      ],
      process.env,
    );
    expect(result).toEqual(ok(`${"x".repeat(1024 * 1024)}${literal}`));
  });

  it("reports actual stderr and launch failures", async () => {
    await expect(
      updateCommands.runProbe(
        [
          process.execPath,
          "-e",
          'process.stderr.write("EACCES /test/install"); process.exitCode = 2',
        ],
        process.env,
      ),
    ).resolves.toEqual(
      err({ kind: "execution", detail: "EACCES /test/install" }),
    );
    const missing = await updateCommands.runProbe(
      [join(home, "missing-executable")],
      process.env,
    );
    expect(missing).toMatchObject({ ok: false });
    if (!missing.ok)
      expect(missing.error).toMatchObject({
        kind: "launch",
        detail: expect.stringContaining("ENOENT"),
      });
  });

  it("verifies the requested package entry rather than PATH's rea", async () => {
    const packageRoot = join(home, "package");
    const script = join(packageRoot, "scripts", "rea.mjs");
    await mkdir(dirname(script), { recursive: true });
    await writeFile(script, 'process.stdout.write("3.3.0\\n")');
    await expect(
      systemUpdateHost(packageRoot, home).installedVersion({
        manager: "npm",
        prefix: home,
        packageRoot,
      }),
    ).resolves.toEqual(ok("3.3.0"));
  });
});

const createBunUpdateFixture = async (
  root: string,
  bunVersion: string,
  installOutputBytes: number,
  installExitCode: number,
) => {
  const globalDirectory = join(root, "bun", "install", "global");
  const packageRoot = join(
    globalDirectory,
    "node_modules",
    PRODUCT_IDENTITY.packageName,
  );
  const versionPath = join(root, "installed-version");
  const logPath = join(root, "bun-invocations.jsonl");
  await mkdir(join(packageRoot, "scripts"), { recursive: true });
  await writeFile(
    join(globalDirectory, "package.json"),
    '{"dependencies":{"rea-agents":"3.2.1"}}\n',
  );
  await writeFile(versionPath, "3.2.1");
  await writeFile(
    join(packageRoot, "scripts", "rea.mjs"),
    `import { readFileSync } from "node:fs";\nprocess.stdout.write(readFileSync(${JSON.stringify(versionPath)}, "utf8") + "\\n");\n`,
  );
  const binDirectory = join(root, "bin");
  const recorder = join(binDirectory, "record-bun.mjs");
  await mkdir(binDirectory);
  await writeFile(
    recorder,
    [
      'import { appendFileSync, writeFileSync } from "node:fs";',
      "const args = process.argv.slice(2);",
      `appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args, cwd: process.cwd(), globalDirectory: process.env.BUN_INSTALL_GLOBAL_DIR }) + "\\n");`,
      `if (JSON.stringify(args) === '["--version"]') console.log(${JSON.stringify(bunVersion)});`,
      `else if (JSON.stringify(args) === ${JSON.stringify(JSON.stringify(["info", PRODUCT_IDENTITY.packageName, "dist-tags.latest", "--json"]))}) process.stdout.write('"3.3.0"\\n');`,
      `else if (JSON.stringify(args) === ${JSON.stringify(JSON.stringify(["add", "--global", "--ignore-scripts", `${PRODUCT_IDENTITY.packageName}@3.3.0`]))}) process.stderr.write('x'.repeat(${installOutputBytes}), () => { ${installExitCode === 0 ? `writeFileSync(${JSON.stringify(versionPath)}, "3.3.0");` : "process.exitCode = 2;"} });`,
      "else process.exitCode = 2;",
      "",
    ].join("\n"),
  );
  if (process.platform === "win32") {
    await writeFile(
      join(binDirectory, "bun.cmd"),
      `@"${process.execPath}" "${recorder}" %*\r\n`,
    );
  } else {
    await writeFile(
      join(binDirectory, "bun"),
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(recorder)} "$@"\n`,
      { mode: 0o755 },
    );
  }
  return { globalDirectory, packageRoot, versionPath, logPath, binDirectory };
};

it.skipIf(process.platform === "win32")(
  "distinguishes a missing npm metadata launcher from a started registry probe",
  async () => {
    const root = await createTestTempDirectory("rea-npm-probe-failure-");
    const bin = join(root, "bin");
    await mkdir(bin);
    const host = systemUpdateHost(root, home, { ...process.env, PATH: bin });
    const installation = {
      manager: "npm" as const,
      prefix: root,
      packageRoot: root,
    };
    try {
      expect(await host.latestVersion(installation)).toMatchObject({
        ok: false,
        error: {
          kind: "package-manager-unavailable",
          manager: "npm",
          detail: expect.stringContaining("ENOENT"),
        },
      });
      await writeFile(
        join(bin, "npm"),
        "#!/bin/sh\nprintf 'registry fixture failed\\n' >&2\nexit 7\n",
        { mode: 0o755 },
      );
      expect(await host.latestVersion(installation)).toEqual(
        err({ kind: "unavailable", detail: "registry fixture failed" }),
      );
    } finally {
      await host.close?.();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "reports a Bun metadata launcher lost after a successful version probe",
  async () => {
    const root = await createTestTempDirectory("rea-bun-metadata-launch-");
    const fixture = await createBunUpdateFixture(root, "1.4.2", 0, 0);
    await writeFile(
      join(fixture.binDirectory, "bun"),
      "#!/bin/sh\n/bin/rm \"$0\"\nprintf '1.4.2\\n'\n",
      { mode: 0o755 },
    );
    const host = systemUpdateHost(fixture.packageRoot, home, {
      ...process.env,
      PATH: fixture.binDirectory,
      BUN_INSTALL_GLOBAL_DIR: fixture.globalDirectory,
    });
    try {
      expect(
        await host.latestVersion({
          manager: "bun",
          globalDirectory: fixture.globalDirectory,
          packageRoot: fixture.packageRoot,
        }),
      ).toMatchObject({
        ok: false,
        error: {
          kind: "package-manager-unavailable",
          manager: "bun",
          detail: expect.stringContaining("ENOENT"),
        },
      });
    } finally {
      await host.close?.();
    }
  },
);

it.skipIf(process.platform === "win32").each(["failed", "missing"] as const)(
  "reports a %s local Bun probe without attempting release lookup",
  async (mode) => {
    const root = await createTestTempDirectory("rea-bun-probe-failure-");
    const fixture = await createBunUpdateFixture(root, "1.4.2", 0, 0);
    const executable = join(fixture.binDirectory, "bun");
    if (mode === "missing") await rm(executable);
    else
      await writeFile(
        executable,
        `#!/bin/sh\nprintf 'probe\\n' > ${JSON.stringify(fixture.logPath)}\nprintf 'fixture: bun cannot start\\n' >&2\nexit 7\n`,
        { mode: 0o755 },
      );
    const result = await runUpdate(
      "3.2.1",
      systemUpdateHost(fixture.packageRoot, home, {
        ...process.env,
        PATH: fixture.binDirectory,
        BUN_INSTALL_GLOBAL_DIR: fixture.globalDirectory,
      }),
      "structured",
    );
    expect(result).toMatchObject({
      status: "failed",
      reason: "version-check",
      latestVersion: null,
      remediation: expect.stringContaining(
        mode === "failed" ? "fixture: bun cannot start" : "ENOENT",
      ),
    });
    expect(result).toHaveProperty(
      "remediation",
      expect.stringContaining("repair its launcher"),
    );
    expect(result).toHaveProperty(
      "remediation",
      expect.not.stringContaining("registry access"),
    );
    if (mode === "failed")
      expect(await readFile(fixture.logPath, "utf8")).toBe("probe\n");
    else
      await expect(access(fixture.logPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    expect(await readFile(fixture.versionPath, "utf8")).toBe("3.2.1");
  },
);

describe("Bun global installation update", () => {
  it.each([
    ["1.4.2", "updated", "absolute", UPDATE_COMMAND_OUTPUT_BYTES + 1, 0],
    ["1.4.2", "install-failed", "absolute", UPDATE_COMMAND_OUTPUT_BYTES + 1, 2],
    ["1.2.17", "updated", "absolute", 0, 0],
    ["1.2.17", "updated", "relative", 0, 0],
    ["1.2.14", "failed", "absolute", 0, 0],
    ["1.2.17-canary.1", "failed", "absolute", 0, 0],
    ["unknown", "failed", "absolute", 0, 0],
  ] as const)(
    "handles Bun %s with outcome %s using %s global-directory configuration",
    async (
      bunVersion,
      status,
      directoryMode,
      installOutputBytes,
      installExitCode,
    ) => {
      // A recording `bun` on PATH crosses the real subprocess boundary without registry access.
      const root = await createTestTempDirectory("rea-update-bun-");
      const {
        globalDirectory,
        packageRoot,
        versionPath,
        logPath,
        binDirectory,
      } = await createBunUpdateFixture(
        root,
        bunVersion,
        installOutputBytes,
        installExitCode,
      );
      const pathKey =
        Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ??
        "PATH";
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        [pathKey]: `${binDirectory}${delimiter}${process.env[pathKey] ?? ""}`,
        BUN_INSTALL: join(root, "bun"),
      };
      delete environment.BUN_INSTALL_GLOBAL_DIR;
      if (directoryMode === "relative")
        environment.BUN_INSTALL_GLOBAL_DIR = relative(root, globalDirectory);

      const callerDirectory = process.cwd();
      let result: UpdateResult;
      try {
        process.chdir(root);
        result = await runUpdate(
          "3.2.1",
          systemUpdateHost(packageRoot, home, environment),
          "structured",
        );
      } finally {
        process.chdir(callerDirectory);
      }

      const invocations = (await readFile(logPath, "utf8"))
        .trim()
        .split("\n")
        .map((line): unknown => JSON.parse(line));
      const versionInvocation = {
        args: ["--version"],
        cwd: globalDirectory,
        globalDirectory,
      };
      if (status === "failed") {
        expect(result).toEqual({
          status: "failed",
          currentVersion: "3.2.1",
          latestVersion: null,
          reason: "version-check",
          remediation: `REA updates for Bun global installations require Bun 1.2.17 or later; bun --version returned ${JSON.stringify(bunVersion)}. Upgrade Bun manually, then rerun rea update.`,
        });
        expect(invocations).toEqual([versionInvocation]);
        expect(await readFile(versionPath, "utf8")).toBe("3.2.1");
        return;
      }

      if (status === "install-failed") {
        expect(result).toMatchObject({
          status: "failed",
          reason: "install",
          remediation: expect.stringContaining("diagnostics truncated"),
        });
        expect(await readFile(versionPath, "utf8")).toBe("3.2.1");
      } else
        expect(result).toMatchObject({
          status: "updated",
          installMethod: "bun",
          installedVersion: "3.3.0",
          command: [
            "bun",
            "add",
            "--global",
            "--ignore-scripts",
            `${PRODUCT_IDENTITY.packageName}@3.3.0`,
          ],
        });
      // `bun info` needs a project in its working directory, and the caller's
      // directory must never be selected, so all commands run in the owner.
      expect(invocations).toEqual([
        versionInvocation,
        {
          args: [
            "info",
            PRODUCT_IDENTITY.packageName,
            "dist-tags.latest",
            "--json",
          ],
          cwd: globalDirectory,
          globalDirectory,
        },
        {
          args: [
            "add",
            "--global",
            "--ignore-scripts",
            `${PRODUCT_IDENTITY.packageName}@3.3.0`,
          ],
          cwd: globalDirectory,
          globalDirectory,
        },
      ]);
    },
  );
});

let updateCommands: UpdateCommandRunner;
beforeEach(() => {
  updateCommands = new UpdateCommandRunner();
});
afterEach(async () => {
  await updateCommands.close();
});
