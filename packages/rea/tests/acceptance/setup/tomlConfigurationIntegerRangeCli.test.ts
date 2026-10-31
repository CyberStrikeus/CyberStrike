import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const environmentFor = (home: string) => ({
  HOME: home,
  USERPROFILE: home,
  CODEX_HOME: join(home, ".codex"),
  XDG_CONFIG_HOME: join(home, ".config"),
  TMPDIR: home,
});

const setupArguments = [
  "setup",
  "--client",
  "codex",
  "--skill=false",
  "--json",
] as const;

cliTest(
  "codex setup and uninstall preserve signed 64-bit TOML integers exactly",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-toml-int64-");
    const config = join(home, ".codex/config.toml");
    const original =
      "[history]\n" +
      "max_bytes = 9223372036854775807 # Int64 maximum\n" +
      "floor = -9223372036854775808\n" +
      "spelled = 0x7fff_ffff_ffff_ffff\n";
    await mkdir(dirname(config), { recursive: true });
    await writeFile(config, original);
    const run = (arguments_: readonly string[]) =>
      cli.run({
        arguments: arguments_,
        cwd: home,
        environment: environmentFor(home),
      });

    const preview = await run([...setupArguments, "--dry-run"]);
    expect(preview.exitCode, preview.stdout).toBe(0);
    expect(preview.json).toMatchObject({ status: "planned" });
    expect(await readFile(config, "utf8")).toBe(original);

    const applied = await run([...setupArguments, "--yes"]);
    expect(applied.exitCode, applied.stdout).toBe(0);
    expect(applied.json).toMatchObject({
      status: "ready",
      clients: { codex: { status: "configured" } },
    });
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
    const configured = await readFile(config, "utf8");
    expect(configured.startsWith(original)).toBe(true);
    expect(configured).toContain("[mcp_servers.rea]");

    const repeated = await run([...setupArguments, "--yes"]);
    expect(repeated.exitCode, repeated.stdout).toBe(0);
    expect(repeated.json).toMatchObject({
      status: "ready",
      appliedActions: [],
    });
    expect(await readFile(config, "utf8")).toBe(configured);

    const removed = await run(["uninstall", "--json"]);
    expect(removed.exitCode, removed.stdout).toBe(0);
    expect(removed.json).toMatchObject({ status: "complete" });
    expect(await readFile(config, "utf8")).toBe(original);
  },
);

cliTest(
  "codex setup keeps exact integers and a large REA timeout in an inline server table",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-toml-int64-inline-");
    const config = join(home, ".codex/config.toml");
    const original =
      "# retained comment\n" +
      'mcp_servers = { other = { command = "other", budget = 9007199254740993 }, ' +
      'rea = { command = "npx", args = ["-y", "rea-agents@6.1.0", "mcp"], tool_timeout_sec = 9223372036854775807 } }\n';
    await mkdir(dirname(config), { recursive: true });
    await writeFile(config, original);
    const applied = await cli.run({
      arguments: [...setupArguments, "--yes"],
      cwd: home,
      environment: environmentFor(home),
    });
    expect(applied.exitCode, applied.stdout).toBe(0);
    const configured = await readFile(config, "utf8");
    expect(configured.startsWith("# retained comment\n")).toBe(true);
    expect(configured).toContain("budget = 9007199254740993");
    expect(configured).toContain("tool_timeout_sec = 9223372036854775807");
    expect(configured).not.toContain("rea-agents@6.1.0");
  },
);

for (const value of ["9223372036854775808", "-9223372036854775809"])
  cliTest(
    `codex setup rejects ${value} outside Int64 before writing`,
    async ({ cli }) => {
      const home = await createTestTempDirectory("rea-toml-int64-range-");
      const config = join(home, ".codex/config.toml");
      const original = `[history]\nmax_bytes = ${value}\n`;
      await mkdir(dirname(config), { recursive: true });
      await writeFile(config, original);
      const applied = await cli.run({
        arguments: [...setupArguments, "--yes"],
        cwd: home,
        environment: environmentFor(home),
      });
      expect(applied.exitCode, applied.stdout).toBe(1);
      expect(applied.json).toMatchObject({ status: "needs_human" });
      expect(applied.stdout).toContain("outside the signed 64-bit range");
      expect(await readFile(config, "utf8")).toBe(original);
    },
  );
