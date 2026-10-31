import { readFile } from "node:fs/promises";

import { expect } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const packageSchema = z.object({ version: z.string() });

// Node's Windows home lookup throws for an empty USERPROFILE, so a dependency
// that resolves the home during import used to stop every command there.
cliTest("starts when the selected home is empty", async ({ cli }) => {
  const { version } = packageSchema.parse(
    JSON.parse(await readFile("package.json", "utf8")),
  );
  const cwd = await createTestTempDirectory("rea-empty-home-startup-");
  const environment = { HOME: "", USERPROFILE: "" };

  const reported = await cli.run({
    arguments: ["--version"],
    cwd,
    environment,
  });
  expect(reported.stderr).toBe("");
  expect(reported.exitCode).toBe(0);
  expect(reported.stdout.trim()).toBe(version);

  const help = await cli.run({ arguments: ["--help"], cwd, environment });
  expect(help.stderr).not.toContain("uv_os_homedir");
  expect(help.exitCode).toBe(0);
});
