import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "registers Droid in its selected home and preserves peers and backups",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-droid-home-");
    const selected = join(home, "selected");
    const config = join(selected, ".factory", "mcp.json");
    const original = JSON.stringify({
      mcpServers: { peer: { command: "peer" } },
    });
    await mkdir(join(selected, ".factory"), { recursive: true });
    await writeFile(config, original);
    const run = () =>
      cli.run({
        arguments: [
          "setup",
          "--client",
          "droid",
          "--skill=false",
          "--yes",
          "--json",
        ],
        cwd: home,
        environment: {
          HOME: home,
          USERPROFILE: home,
          FACTORY_HOME_OVERRIDE: selected,
          HOPPER_LAUNCHER_PATH: join(home, "missing-hopper"),
          GHIDRA_INSTALL_DIR: join(home, "missing-ghidra"),
          JAVA_HOME: join(home, "missing-java"),
        },
      });
    const first = await run();
    expect(first.exitCode, first.stdout).toBe(0);
    const configured = await readFile(config, "utf8");
    expect(JSON.parse(configured)).toMatchObject({
      mcpServers: {
        peer: { command: "peer" },
        rea: { args: expect.arrayContaining(["mcp"]) },
      },
    });
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
    await expect(
      access(join(home, ".factory", "mcp.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const second = await run();
    expect(second.exitCode, second.stdout).toBe(0);
    expect(await readFile(config, "utf8")).toBe(configured);
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
  },
);
