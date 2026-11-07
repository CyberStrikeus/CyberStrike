import { access, mkdir, readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { parse } from "jsonc-parser";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "setup dry run resolves empty home values without writing to the cwd",
  async ({ cli }) => {
    const directory = await createTestTempDirectory("rea-empty-home-dry-run-");
    const workingDirectory = join(directory, "cwd");
    await mkdir(workingDirectory);
    const hostHome = userInfo().homedir;
    const result = await cli.run({
      arguments: [
        "setup",
        "--client",
        "cursor",
        "--skill=false",
        "--dry-run",
        "--json",
      ],
      cwd: workingDirectory,
      environment: {
        HOME: "",
        USERPROFILE: "",
        HOMEDRIVE: "",
        HOMEPATH: "",
        XDG_CONFIG_HOME: "",
      },
    });

    expect(result.exitCode, result.stdout).toBe(0);
    const output = result.json as {
      plannedActions?: Array<{ kind?: unknown; target?: unknown }>;
      status?: unknown;
    };
    expect(["planned", "ready"]).toContain(output.status);
    const configTargets = (output.plannedActions ?? [])
      .filter((action) => action.kind === "configure_client")
      .map((action) => action.target);
    for (const target of configTargets) {
      expect(typeof target).toBe("string");
      if (typeof target !== "string") continue;
      expect(isAbsolute(target)).toBe(true);
      const relativeTarget = relative(hostHome, target);
      expect(
        relativeTarget === "" ||
          (!relativeTarget.startsWith(`..${sep}`) && relativeTarget !== ".."),
      ).toBe(true);
    }
    expect(configTargets).not.toContain(
      join(workingDirectory, ".cursor", "mcp.json"),
    );
    await expect(
      access(join(workingDirectory, ".cursor", "mcp.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

cliTest.skipIf(process.platform === "win32")(
  "setup, doctor, and uninstall use the nonempty fallback home when HOME is empty",
  async ({ cli }) => {
    const directory = await createTestTempDirectory(
      "rea-empty-home-lifecycle-",
    );
    const home = join(directory, "fallback-home");
    const workingDirectory = join(directory, "cwd");
    await mkdir(home);
    await mkdir(workingDirectory);
    const environment = {
      HOME: "",
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
    };
    const run = (arguments_: readonly string[]) =>
      cli.run({
        arguments: arguments_,
        cwd: workingDirectory,
        environment,
      });

    const setup = await run(["setup", "--client", "cursor", "--yes", "--json"]);
    expect(setup.exitCode, setup.stderr).toBe(0);
    expect(setup.json).toMatchObject({ status: "ready" });
    await access(join(home, ".cursor", "mcp.json"));
    await access(
      join(home, ".agents", "skills", "reverse-engineer-anything", "SKILL.md"),
    );
    await expect(
      access(join(workingDirectory, ".cursor", "mcp.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      access(join(workingDirectory, ".agents", "skills")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const doctor = await run([
      "doctor",
      "--client",
      "cursor",
      "--skill",
      "--json",
    ]);
    expect(doctor.exitCode, doctor.stdout).toBe(0);
    expect(doctor.json).toMatchObject({ healthy: true });

    const uninstall = await run(["uninstall", "--json"]);
    expect(uninstall.exitCode, uninstall.stderr).toBe(0);
    expect(uninstall.json).toMatchObject({ status: "complete" });
    const remainingConfig = parse(
      await readFile(join(home, ".cursor", "mcp.json"), "utf8"),
    );
    expect(remainingConfig).not.toHaveProperty("mcpServers.rea");
    await expect(
      access(
        join(
          home,
          ".agents",
          "skills",
          "reverse-engineer-anything",
          "SKILL.md",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      access(join(workingDirectory, ".cursor", "mcp.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);
