import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const setup = ["setup", "--client", "claude_code", "--skill=false", "--json"];

cliTest(
  "setup preserves a replacement foreign registration and its original backup",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-setup-ownership-");
    const config = join(home, ".claude.json");
    const original = '{"mcpServers":{"peer":{"command":"peer"}}}\n';
    await writeFile(config, original);
    const run = (arguments_: readonly string[]) =>
      cli.run({
        arguments: arguments_,
        cwd: home,
        environment: { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: home },
      });
    expect((await run([...setup, "--yes"])).exitCode).toBe(0);
    const replacement =
      '{"mcpServers":{"rea":{"command":"peer-owned-server","args":["mcp"]},"peer":{"command":"peer-edited"}},"theme":"edited"}\n';
    await writeFile(config, replacement);
    for (const mode of ["--dry-run", "--yes"]) {
      const result = await run([...setup, mode]);
      expect(result.exitCode, result.stdout).toBe(1);
      expect(result.json).toMatchObject({
        status: "needs_human",
        plannedActions: [],
        appliedActions: [],
        remediation: expect.stringContaining("foreign ownership"),
      });
      expect(await readFile(config, "utf8")).toBe(replacement);
      expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
      expect(
        (await readdir(home)).filter((name) => name.includes(".recovery")),
      ).toEqual([]);
    }
    expect((await run(["uninstall", "--json"])).exitCode).toBe(0);
    expect(await readFile(config, "utf8")).toBe(replacement);
  },
);

for (const [identity, entry] of [
  ["foreign", { command: "other-server", args: ["mcp"] }],
  [
    "unknown",
    {
      command: process.execPath,
      args: ["/missing/old-rea/scripts/rea.mjs", "mcp"],
    },
  ],
] as const)
  cliTest(
    `setup blocks ${identity} ownership before any backup or skill writes`,
    async ({ cli }) => {
      const home = await createTestTempDirectory("rea-setup-ownership-");
      const config = join(home, ".claude.json");
      const original = JSON.stringify({ mcpServers: { rea: entry } });
      await writeFile(config, original);
      const result = await cli.run({
        arguments: ["setup", "--client", "claude_code", "--yes", "--json"],
        cwd: home,
        environment: { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: home },
      });
      expect(result.exitCode, result.stdout).toBe(1);
      expect(result.json).toMatchObject({
        status: "needs_human",
        plannedActions: [],
        appliedActions: [],
        remediation: expect.stringContaining(`${identity} ownership`),
      });
      expect(await readFile(config, "utf8")).toBe(original);
      const doctor = await cli.run({
        arguments: [
          "doctor",
          "--client",
          "claude_code",
          "--skill=false",
          "--json",
        ],
        cwd: home,
        environment: { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: home },
      });
      expect(doctor.exitCode, doctor.stdout).toBe(1);
      expect(doctor.json).toMatchObject({
        identity: {
          registrations: expect.arrayContaining([
            expect.objectContaining({
              client: "claude_code",
              state: identity === "unknown" ? "unknown" : "stale",
              remediation: expect.stringContaining("manually rename or remove"),
            }),
          ]),
        },
      });
      expect(await readdir(home)).not.toContain(".claude.json.rea.backup");
      await expect(
        readFile(
          join(
            home,
            ".claude",
            "skills",
            "reverse-engineer-anything",
            "SKILL.md",
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

cliTest(
  "setup refreshes a proven owned stale launcher and preserves peer settings",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-setup-owned-refresh-");
    const config = join(home, ".claude.json");
    const original = JSON.stringify({
      mcpServers: {
        rea: {
          command: "npx",
          args: ["-y", "rea-agents@6.6.0", "mcp"],
          env: { CUSTOM: "keep" },
        },
        peer: { command: "peer" },
      },
    });
    await writeFile(config, original);
    const result = await cli.run({
      arguments: [...setup, "--yes"],
      cwd: home,
      environment: { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: home },
    });
    expect(result.exitCode, result.stdout).toBe(0);
    expect(JSON.parse(await readFile(config, "utf8"))).toMatchObject({
      mcpServers: {
        rea: { command: process.execPath, env: { CUSTOM: "keep" } },
        peer: { command: "peer" },
      },
    });
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
  },
);

for (const repeated of [false, true])
  cliTest(
    `OpenCode setup preserves foreign legacy fallback (shadowed=${repeated})`,
    async ({ cli }) => {
      const home = await createTestTempDirectory("rea-setup-legacy-ownership-");
      const config = join(home, ".config", "opencode", "opencode.json");
      await mkdir(dirname(config), { recursive: true });
      const foreign = '"rea":{"type":"local","command":["other"]}';
      const owned = '"rea":{"type":"local","command":["rea","mcp"]}';
      const original = `{"mcp":{${foreign},${repeated ? `${owned},` : ""}"servers":{${owned}}}}`;
      await writeFile(config, original);
      const result = await cli.run({
        arguments: [
          "setup",
          "--client",
          "opencode",
          "--skill=false",
          "--yes",
          "--json",
        ],
        cwd: home,
        environment: {
          HOME: home,
          USERPROFILE: home,
          XDG_CONFIG_HOME: join(home, ".config"),
        },
      });
      expect(result.exitCode, result.stdout).toBe(1);
      expect(result.json).toMatchObject({
        status: "needs_human",
        remediation: expect.stringContaining("foreign ownership"),
      });
      expect(await readFile(config, "utf8")).toBe(original);
      await expect(readFile(`${config}.rea.backup`)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

cliTest(
  "ZCode setup preserves an unrelated fallback registration before its first native entry",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-setup-zcode-ownership-");
    const fallback = join(home, ".agents", "mcp.json");
    await mkdir(dirname(fallback), { recursive: true });
    const original =
      '{"mcpServers":{"rea":{"command":"other"},"peer":{"command":"peer"}}}';
    await writeFile(fallback, original);
    const result = await cli.run({
      arguments: [
        "setup",
        "--client",
        "zcode",
        "--skill=false",
        "--yes",
        "--json",
      ],
      cwd: home,
      environment: { HOME: home, USERPROFILE: home },
    });
    expect(result.exitCode, result.stdout).toBe(1);
    expect(result.json).toMatchObject({
      status: "needs_human",
      plannedActions: [],
      remediation: expect.stringContaining(fallback),
    });
    expect(await readFile(fallback, "utf8")).toBe(original);
    await expect(
      readFile(join(home, ".zcode", "cli", "config.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(`${fallback}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

cliTest(
  "OpenCode setup preserves an inherited foreign registration instead of shadowing it",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-setup-layered-ownership-");
    const directory = join(home, ".config", "opencode");
    await mkdir(directory, { recursive: true });
    const lower = join(directory, "config.json");
    const upper = join(directory, "opencode.json");
    const originalLower =
      '{"mcp":{"rea":{"type":"local","command":["other"]}}}';
    const originalUpper = "{}";
    await writeFile(lower, originalLower);
    await writeFile(upper, originalUpper);
    const result = await cli.run({
      arguments: [
        "setup",
        "--client",
        "opencode",
        "--skill=false",
        "--yes",
        "--json",
      ],
      cwd: home,
      environment: {
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: join(home, ".config"),
      },
    });
    expect(result.exitCode, result.stdout).toBe(1);
    expect(result.json).toMatchObject({
      status: "needs_human",
      plannedActions: [],
      remediation: expect.stringContaining("foreign ownership"),
    });
    expect(await readFile(lower, "utf8")).toBe(originalLower);
    expect(await readFile(upper, "utf8")).toBe(originalUpper);
    await expect(readFile(`${upper}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

cliTest(
  "OpenCode setup refreshes an owned inherited launcher through a policy fragment",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-setup-owned-layer-");
    const directory = join(home, ".config", "opencode");
    await mkdir(directory, { recursive: true });
    const lower = join(directory, "config.json");
    const upper = join(directory, "opencode.json");
    const originalLower = JSON.stringify({
      mcp: { rea: { type: "local", command: ["rea", "mcp"] } },
    });
    const originalUpper = JSON.stringify({
      mcp: { rea: { environment: { CUSTOM: "keep" } } },
    });
    await writeFile(lower, originalLower);
    await writeFile(upper, originalUpper);
    const result = await cli.run({
      arguments: [
        "setup",
        "--client",
        "opencode",
        "--skill=false",
        "--yes",
        "--json",
      ],
      cwd: home,
      environment: {
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: join(home, ".config"),
      },
    });
    expect(result.exitCode, result.stdout).toBe(0);
    expect(await readFile(lower, "utf8")).toBe(originalLower);
    expect(await readFile(`${upper}.rea.backup`, "utf8")).toBe(originalUpper);
    expect(JSON.parse(await readFile(upper, "utf8"))).toMatchObject({
      mcp: { rea: { type: "local", environment: { CUSTOM: "keep" } } },
    });
    const foreignFragment = JSON.stringify({
      mcp: { rea: { command: ["other", "mcp"] } },
    });
    await writeFile(upper, foreignFragment);
    const blocked = await cli.run({
      arguments: [
        "setup",
        "--client",
        "opencode",
        "--skill=false",
        "--yes",
        "--json",
      ],
      cwd: home,
      environment: {
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: join(home, ".config"),
      },
    });
    expect(blocked.exitCode, blocked.stdout).toBe(1);
    expect(blocked.json).toMatchObject({
      status: "needs_human",
      remediation: expect.stringContaining("foreign ownership"),
    });
    expect(await readFile(upper, "utf8")).toBe(foreignFragment);
    expect(await readFile(`${upper}.rea.backup`, "utf8")).toBe(originalUpper);
  },
);
