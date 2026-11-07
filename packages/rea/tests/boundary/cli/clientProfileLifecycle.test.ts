import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { PRODUCT_IDENTITY } from "../../../src/identity.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "uninstall refuses a foreign OpenCode fallback across configuration layers",
  async ({ cli }) => {
    const home = await createTestTempDirectory(
      "rea-uninstall-layered-fallback-cli-",
    );
    const directory = join(home, "opencode");
    await mkdir(directory, { recursive: true });
    const lower = join(directory, "opencode.json");
    const upper = join(directory, "opencode.jsonc");
    const claude = join(home, ".claude.json");
    const legacy = JSON.stringify({
      mcp: {
        rea: { type: "local", command: ["/usr/bin/false"], enabled: true },
      },
    });
    const native = JSON.stringify({
      mcp: {
        servers: {
          rea: {
            type: "local",
            command: [PRODUCT_IDENTITY.cliBinary, "mcp"],
            disabled: false,
          },
        },
      },
    });
    await writeFile(lower, legacy);
    await writeFile(upper, native);
    const claudeOriginal = JSON.stringify({
      mcpServers: {
        rea: { command: PRODUCT_IDENTITY.cliBinary, args: ["mcp"] },
      },
    });
    await writeFile(claude, claudeOriginal);
    const run = () =>
      cli.run({
        arguments: ["uninstall", "--json"],
        cwd: home,
        environment: {
          HOME: home,
          USERPROFILE: home,
          OPENCODE_CONFIG_DIR: directory,
        },
      });
    const refused = await run();
    expect(refused.exitCode, refused.stderr).toBe(1);
    expect(refused.json).toMatchObject({
      status: "failed",
      items: expect.arrayContaining([
        expect.objectContaining({
          name: "opencode",
          status: "failed",
          detail: expect.stringContaining("V1"),
        }),
      ]),
    });
    expect(await readFile(lower, "utf8")).toBe(legacy);
    expect(await readFile(upper, "utf8")).toBe(native);
    expect(await readFile(claude, "utf8")).toBe(claudeOriginal);
    await expect(access(`${claude}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(`${upper}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    // A foreign later fragment can inherit fields from an owned V1 entry.
    const ownedLegacy = JSON.stringify({
      mcp: {
        servers: {},
        rea: {
          type: "local",
          command: [PRODUCT_IDENTITY.cliBinary, "mcp"],
          enabled: true,
        },
      },
    });
    const foreignPartial = JSON.stringify({
      mcp: { servers: { rea: { command: ["/usr/bin/false"] } } },
    });
    await writeFile(lower, ownedLegacy);
    await writeFile(upper, foreignPartial);
    const legacyRefusal = await run();
    expect(legacyRefusal.exitCode, legacyRefusal.stderr).toBe(1);
    expect(legacyRefusal.json).toMatchObject({ status: "failed" });
    expect(await readFile(lower, "utf8")).toBe(ownedLegacy);
    expect(await readFile(upper, "utf8")).toBe(foreignPartial);
    expect(await readFile(claude, "utf8")).toBe(claudeOriginal);
    await expect(access(`${lower}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });

    await writeFile(lower, "{}\n");
    await writeFile(upper, native);
    const removed = await run();
    expect(removed.exitCode, removed.stderr).toBe(0);
    expect(removed.json).toMatchObject({ status: "complete" });
    expect(await readFile(upper, "utf8")).not.toContain('"rea"');
  },
);

cliTest(
  "uninstall reports completed file removals beside a later OpenCode failure and recovers",
  async ({ cli }) => {
    const home = await createTestTempDirectory(
      "rea-uninstall-layered-failure-",
    );
    const directory = join(home, "opencode");
    await mkdir(directory, { recursive: true });
    const first = join(directory, "opencode.json");
    const second = join(directory, "opencode.jsonc");
    const original = JSON.stringify({
      mcp: {
        rea: {
          type: "local",
          command: ["npx", "-y", "rea-agents@6.7.0", "mcp"],
        },
      },
      unrelated: "keep",
    });
    await writeFile(first, original);
    await writeFile(second, original);
    await mkdir(`${second}.rea.backup`);
    const run = () =>
      cli.run({
        arguments: ["uninstall", "--json"],
        cwd: home,
        environment: {
          HOME: home,
          USERPROFILE: home,
          OPENCODE_CONFIG_DIR: directory,
        },
      });

    const failed = await run();
    expect(failed.exitCode, failed.stderr).toBe(1);
    expect(failed.json).toMatchObject({
      status: "failed",
      items: expect.arrayContaining([
        expect.objectContaining({
          name: "opencode",
          status: "failed",
          detail: expect.stringContaining("Removed registration"),
          actions: expect.arrayContaining([
            expect.objectContaining({
              configuration_path: first,
              status: "removed",
            }),
            expect.objectContaining({
              configuration_path: second,
              status: "failed",
            }),
          ]),
        }),
      ]),
    });
    expect(failed.json).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          name: "opencode",
          detail: expect.stringContaining("could not be backed up"),
        }),
      ]),
    });
    expect(JSON.parse(await readFile(first, "utf8"))).toEqual({
      mcp: {},
      unrelated: "keep",
    });
    expect(await readFile(`${first}.rea.backup`, "utf8")).toBe(original);
    expect(await readFile(second, "utf8")).toBe(original);

    await rm(`${second}.rea.backup`, { recursive: true });
    const recovered = await run();
    expect(recovered.exitCode, recovered.stderr).toBe(0);
    expect(recovered.json).toMatchObject({ status: "complete" });
    expect(JSON.parse(await readFile(second, "utf8"))).toEqual({
      mcp: {},
      unrelated: "keep",
    });
    expect(await readFile(`${first}.rea.backup`, "utf8")).toBe(original);
    expect(await readFile(`${second}.rea.backup`, "utf8")).toBe(original);
  },
);

const cases = [
  {
    client: "gemini_cli",
    env: { GEMINI_CLI_HOME: "profile" },
    config: "profile/.gemini/settings.json",
    skill: "profile/.agents/skills",
  },
  {
    client: "opencode",
    env: { OPENCODE_CONFIG_DIR: "profile" },
    config: "profile/opencode.json",
    skill: ".agents/skills",
  },
  {
    client: "codex",
    env: { CODEX_HOME: "" },
    config: ".codex/config.toml",
    skill: ".agents/skills",
  },
  {
    client: "grok_build",
    env: { GROK_HOME: "" },
    config: ".grok/config.toml",
    skill: ".agents/skills",
  },
  {
    client: "copilot_cli",
    env: { COPILOT_HOME: "" },
    config: ".copilot/mcp-config.json",
    skill: ".agents/skills",
  },
  {
    client: "omp",
    env: { PI_CODING_AGENT_DIR: "profile" },
    config: "profile/mcp.json",
    skill: ".agents/skills",
  },
  {
    client: "antigravity",
    env: {},
    config: ".gemini/config/mcp_config.json",
    skill: ".gemini/config/skills",
  },
];
const groups = [
  {
    name: "selected client profiles",
    cases,
  },
  ...(process.platform === "win32"
    ? []
    : [
        {
          // XDG also changes OpenCode's global config layers. Exercise this
          // override independently of either OpenCode scenario.
          name: "Devin XDG profile",
          cases: [
            {
              client: "devin",
              env: { XDG_CONFIG_HOME: "profile" },
              config: "profile/devin/mcp_config.json",
              skill: ".agents/skills",
            },
          ],
        },
      ]),
  {
    // Devin's XDG override changes OpenCode's default root, so keep this
    // empty-override scenario in its own home and environment.
    name: "default OpenCode profile",
    cases: [
      {
        client: "opencode",
        env: { OPENCODE_CONFIG_DIR: "" },
        config: ".config/opencode/opencode.json",
        skill: ".agents/skills",
      },
    ],
  },
];

cliTest(
  "uninstall purge retains unrelated data behind a managed-root symlink",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-uninstall-root-link-");
    const home = join(root, "home");
    const unrelated = join(root, "unrelated-application");
    await mkdir(home);
    for (const name of ["cache", "state"]) {
      await mkdir(join(unrelated, name), { recursive: true });
      await writeFile(join(unrelated, name, "keep.txt"), `unrelated ${name}`);
    }
    const managedRoot = join(home, ".rea");
    await symlink(
      unrelated,
      managedRoot,
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = await cli.run({
      arguments: ["uninstall", "--purge-data", "--json"],
      cwd: home,
      environment: {
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: join(root, "xdg-config"),
        XDG_CACHE_HOME: join(root, "xdg-cache"),
      },
      timeoutMs: 20_000,
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect.soft(result.json).toMatchObject({
      status: "complete",
      items: expect.arrayContaining([
        expect.objectContaining({ name: "cache", status: "retained" }),
        expect.objectContaining({ name: "state", status: "retained" }),
      ]),
    });
    expect((await lstat(managedRoot)).isSymbolicLink()).toBe(true);
    expect(await realpath(managedRoot)).toBe(await realpath(unrelated));
    for (const name of ["cache", "state"])
      await expect
        .soft(readFile(join(unrelated, name, "keep.txt"), "utf8"))
        .resolves.toBe(`unrelated ${name}`);
  },
);

for (const group of groups) {
  cliTest(
    `${group.name} lifecycle follows the selected roots`,
    async ({ cli }) => {
      const home = await createTestTempDirectory("rea-client-profile-");
      const environment: NodeJS.ProcessEnv = { HOME: home, USERPROFILE: home };
      for (const testCase of group.cases)
        for (const [key, value] of Object.entries(testCase.env))
          environment[key] = value === "profile" ? join(home, value) : value;
      // OMP's relative override is relative to the caller, not silently ignored.
      if (group.cases.some(({ client }) => client === "omp"))
        environment.PI_CODING_AGENT_DIR = "profile";
      const profiles = group.cases.map((testCase) => ({
        ...testCase,
        config: join(home, testCase.config),
        skillDirectory: join(home, testCase.skill, "reverse-engineer-anything"),
      }));
      const clientArguments = profiles.flatMap(({ client }) => [
        "--client",
        client,
      ]);
      const run = (arguments_: readonly string[]) =>
        cli.run({
          arguments: arguments_,
          cwd: home,
          environment,
          timeoutMs: 20_000,
        });
      const planned = await run([
        "setup",
        ...clientArguments,
        "--dry-run",
        "--json",
      ]);
      expect(planned.exitCode, planned.stderr).toBe(0);
      expect(planned.json).toMatchObject({
        status: "planned",
        plannedActions: expect.arrayContaining([
          ...profiles.map(({ client, config }) =>
            expect.objectContaining({
              id: `configure_client:${client}`,
              target: config,
            }),
          ),
          ...[
            ...new Set(profiles.map(({ skillDirectory }) => skillDirectory)),
          ].map((target) => expect.objectContaining({ target })),
        ]),
      });
      for (const { config, skillDirectory } of profiles) {
        await expect(access(config)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(access(skillDirectory)).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
      const setup = await run(["setup", ...clientArguments, "--yes", "--json"]);
      expect(setup.exitCode).toBe(0);
      expect(setup.json).toMatchObject({ status: "ready" });
      for (const { config, skillDirectory } of profiles) {
        await expect(access(config)).resolves.toBeUndefined();
        expect(
          await readFile(join(skillDirectory, "SKILL.md"), "utf8"),
        ).toContain("reverse-engineer-anything");
      }
      await expect(access(join(home, "config.toml"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      for (const { client, config } of profiles) {
        const doctor = await run([
          "doctor",
          "--client",
          client,
          "--skill",
          "--json",
        ]);
        expect(doctor.exitCode, client).toBe(0);
        expect(doctor.json, client).toMatchObject({
          healthy: true,
          scope: { mode: "explicit", clients: [client], skill: true },
          identity: {
            skill: { state: "aligned" },
            registrations: expect.arrayContaining([
              expect.objectContaining({
                client,
                config_path: config,
                state: "aligned",
              }),
            ]),
          },
        });
        if (client === "grok_build") {
          const original = await readFile(config, "utf8");
          const disabled = original.replace(
            "[mcp_servers.rea]",
            "[mcp_servers.rea]\ndisabled = true",
          );
          expect(disabled).not.toBe(original);
          await writeFile(config, disabled);
          expect(
            (await run(["doctor", "--client", "grok_build", "--json"]))
              .exitCode,
          ).toBe(0);
          await writeFile(config, original);
        }
      }
      const repeat = await run([
        "setup",
        ...clientArguments,
        "--yes",
        "--json",
      ]);
      expect(repeat.exitCode).toBe(0);
      expect(repeat.json).toMatchObject({
        status: "ready",
        appliedActions: [],
      });
      const uninstall = await run(["uninstall", "--json"]);
      expect(uninstall.exitCode).toBe(0);
      expect(uninstall.json).toMatchObject({ status: "complete" });
      for (const { skillDirectory } of profiles)
        await expect(
          access(join(skillDirectory, "SKILL.md")),
        ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
}

cliTest("uninstall names each retained skill directory", async ({ cli }) => {
  const home = await createTestTempDirectory("rea-uninstall-skill-paths-");
  const shared = join(home, ".agents", "skills", PRODUCT_IDENTITY.skillName);
  const claude = join(home, ".claude", "skills", PRODUCT_IDENTITY.skillName);
  for (const directory of [shared, claude]) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "SKILL.md"), "---\nname: unrelated\n---\n");
  }

  const result = await cli.run({
    arguments: ["uninstall", "--json"],
    cwd: home,
    environment: {
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
    },
    timeoutMs: 20_000,
  });

  expect(result.exitCode, result.stderr).toBe(0);
  const report = result.json as {
    items?: readonly { name: string; status: string; detail: string }[];
  };
  const skill = report.items?.find(({ name }) => name === "skill");
  expect(skill?.status).toBe("retained");
  for (const [client, directory] of [
    ["shared", shared],
    ["claude_code", claude],
  ] as const) {
    expect(skill?.detail).toContain(
      `${client} (${directory}): retained (Skill manifest is not REA-owned.)`,
    );
    expect(await readFile(join(directory, "SKILL.md"), "utf8")).toBe(
      "---\nname: unrelated\n---\n",
    );
  }
});
