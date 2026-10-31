import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { historicalSourceGraphSchema } from "../../../src/domain/referenceSourceGraph.js";
import { PRODUCT_IDENTITY } from "../../../src/identity.js";
import { execFileOutput } from "../../../src/process/ExecFileOutput.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "imports a legacy subtree of a Git checkout with its own source facts",
  async ({ cli }) => {
    const repository = await createTestTempDirectory("rea-reference-legacy-");
    const source = join(repository, "source");
    await mkdir(source);
    await Promise.all([
      // `.cjs` is CommonJS, so the strict-mode rule does not apply.
      writeFile(
        join(source, "legacy.cjs"),
        "var messages = {};\ndelete messages;\n",
      ),
      // Deleting a plain binding is valid only in a sloppy-mode script.
      writeFile(
        join(source, "legacy.js"),
        "var messages = {};\ndelete messages;\n",
      ),
      // An explicit module keeps the strict-mode error.
      writeFile(
        join(source, "module.mjs"),
        "var messages = {};\ndelete messages;\n",
      ),
      writeFile(join(source, "index.php"), "<?php echo 'legacy';\n"),
      writeFile(join(source, "Program.cs"), "class Program {}\n"),
    ]);
    const git = (...args: string[]) =>
      execFileOutput("git", args, { cwd: repository });
    await git("init", "--initial-branch=main");
    await git("add", ".");
    await git(
      "-c",
      "user.name=REA fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "fixture",
    );
    const head = (await git("rev-parse", "HEAD")).stdout.trim();

    const result = await cli.run({
      arguments: ["import-reference-source", source, "--json"],
      environment: {
        HOME: repository,
        XDG_CONFIG_HOME: repository,
        XDG_CACHE_HOME: repository,
      },
    });

    expect(result.exitCode).toBe(0);
    const graph = historicalSourceGraphSchema.parse(result.json);
    expect(graph.parse_failures).toEqual([
      {
        path: "module.mjs",
        parser: "babel",
        reason: "Deleting local variable in strict mode. (2:0)",
      },
    ]);
    // Outside `.mjs`/`.mts`/`.cjs` the mode stays unknown, not forced to script.
    const limitations = (path: string) =>
      graph.entries.find((entry) => entry.path === path)?.limitations;
    for (const path of ["legacy.js"])
      expect(limitations(path)).toEqual([
        "Strict-mode errors apply only if this file is an ES module: Deleting local variable in strict mode. (2:0)",
      ]);
    expect(limitations("legacy.cjs")).toEqual([]);
    expect(graph.languages).toEqual(["C#", "JavaScript", "PHP"]);
    for (const path of ["Program.cs", "index.php"])
      expect(
        graph.entries.find((entry) => entry.path === path)?.classifications,
      ).toContain("source");
    expect(graph.vcs).toEqual({ kind: "git", head, dirty: null });
    expect(graph.provenance.importer_version).toBe(
      PRODUCT_IDENTITY.packageVersion,
    );
  },
);
