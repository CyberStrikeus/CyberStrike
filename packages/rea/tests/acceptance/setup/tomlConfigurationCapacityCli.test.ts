import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

for (const scenario of [
  { client: "codex", path: ".codex/config.toml", line: "\n" },
  { client: "grok_build", path: ".grok/config.toml", line: "# retained\n" },
] as const)
  cliTest(
    `${scenario.client} setup and uninstall preserve large valid TOML documents`,
    async ({ cli }) => {
      const home = await createTestTempDirectory("rea-toml-capacity-");
      const config = join(home, scenario.path);
      const original =
        'model = "local-control"\n' +
        scenario.line.repeat(140_000) +
        '[mcp_servers.other]\ncommand = "other-local-control"\n';
      await mkdir(dirname(config), { recursive: true });
      await writeFile(config, original);
      const environment = {
        HOME: home,
        USERPROFILE: home,
        CODEX_HOME: join(home, ".codex"),
        GROK_HOME: join(home, ".grok"),
        XDG_CONFIG_HOME: join(home, ".config"),
        TMPDIR: home,
      };
      const setupArguments = [
        "setup",
        "--client",
        scenario.client,
        "--skill=false",
        "--json",
      ];
      const run = (arguments_: readonly string[]) =>
        cli.run({ arguments: arguments_, cwd: home, environment });

      const preview = await run([...setupArguments, "--dry-run"]);
      expect(preview.exitCode, preview.stdout).toBe(0);
      expect(preview.json).toMatchObject({ status: "planned" });
      expect(await readFile(config, "utf8")).toBe(original);

      const applied = await run([...setupArguments, "--yes"]);
      expect(applied.exitCode, applied.stdout).toBe(0);
      expect(applied.json).toMatchObject({
        status: "ready",
        clients: { [scenario.client]: { status: "configured" } },
      });
      expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
      const configured = await readFile(config, "utf8");
      expect(configured.startsWith(original.trimEnd())).toBe(true);
      expect(parseToml(configured)).toMatchObject({
        mcp_servers: { other: { command: "other-local-control" }, rea: {} },
      });

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
      const remaining = await readFile(config, "utf8");
      expect(remaining.startsWith(original.trimEnd())).toBe(true);
      expect(parseToml(remaining)).toEqual(parseToml(original));
      expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
    },
  );
