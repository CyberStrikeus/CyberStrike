import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect } from "vitest";

import { PRODUCT_IDENTITY } from "../../../src/identity.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "unqualified doctor checks the installed managed skill and preserves its files",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-unqualified-doctor-skill-");
    const skill = join(
      home,
      ".claude/skills/reverse-engineer-anything/SKILL.md",
    );
    const run = (arguments_: readonly string[]) =>
      cli.run({
        arguments: [...arguments_, "--json"],
        cwd: home,
        environment: { HOME: home, USERPROFILE: home },
      });

    const install = await run([
      "setup",
      "--skill-client",
      "claude_code",
      "--yes",
    ]);
    expect(install.exitCode, install.stdout).toBe(0);
    const original = await readFile(skill);

    const skillCheck = await run(["doctor", "--skill"]);
    expect(skillCheck.exitCode, skillCheck.stdout).toBe(0);
    expect(skillCheck.json).toMatchObject({
      healthy: true,
      identity: {
        skill: {
          state: "aligned",
          installed_version: PRODUCT_IDENTITY.skillVersion,
          installed_tool_count: expect.any(Number),
        },
      },
    });
    expect(Buffer.compare(await readFile(skill), original)).toBe(0);

    const audit = await run(["doctor"]);
    expect(audit.json).toMatchObject({
      identity: {
        skill: {
          state: "aligned",
          installed_version: PRODUCT_IDENTITY.skillVersion,
          installed_tool_count: expect.any(Number),
        },
      },
    });
    expect(Buffer.compare(await readFile(skill), original)).toBe(0);

    await mkdir(join(home, ".cursor"));
    const withMarker = await run(["doctor"]);
    expect(withMarker.json).toMatchObject({
      identity: {
        skill: {
          state: "aligned",
          installed_version: PRODUCT_IDENTITY.skillVersion,
          installed_tool_count: expect.any(Number),
        },
      },
    });
    expect(Buffer.compare(await readFile(skill), original)).toBe(0);

    await writeFile(
      skill,
      Buffer.concat([original, Buffer.from("\nlocal edit\n")]),
    );
    const changed = await run(["doctor", "--skill"]);
    expect(changed.exitCode).toBe(1);
    expect(changed.json).toMatchObject({
      healthy: false,
      identity: { skill: { state: "stale" } },
    });

    const reference = join(
      dirname(skill),
      "references/connection-and-recovery.md",
    );
    const retained = await readFile(reference);
    await rm(skill);
    for (const arguments_ of [
      ["doctor", "--skill"],
      ["doctor", "--client", "claude_code", "--skill"],
    ]) {
      const partial = await run(arguments_);
      expect(partial.exitCode, partial.stdout).toBe(1);
      expect(partial.json).toMatchObject({
        healthy: false,
        identity: {
          skill: {
            state: "stale",
            installed_version: null,
            installed_tool_count: null,
          },
        },
      });
      expect(Buffer.compare(await readFile(reference), retained)).toBe(0);
    }

    const emptyHome = await createTestTempDirectory(
      "rea-unqualified-doctor-empty-",
    );
    for (const arguments_ of [
      ["doctor", "--skill"],
      ["doctor", "--client", "claude_code", "--skill"],
    ]) {
      const empty = await cli.run({
        arguments: [...arguments_, "--json"],
        cwd: emptyHome,
        environment: { HOME: emptyHome, USERPROFILE: emptyHome },
      });
      expect(empty.exitCode).toBe(1);
      expect(empty.json).toMatchObject({
        healthy: false,
        identity: { skill: { state: "missing" } },
      });
    }

    const foreignHome = await createTestTempDirectory(
      "rea-unqualified-doctor-foreign-skill-",
    );
    const foreignSkill = join(
      foreignHome,
      ".claude/skills/reverse-engineer-anything/SKILL.md",
    );
    const foreignBytes = Buffer.from(
      "---\nname: another-skill\n---\nA caller-owned workflow.\n",
    );
    await mkdir(dirname(foreignSkill), { recursive: true });
    await writeFile(foreignSkill, foreignBytes);
    const foreign = await cli.run({
      arguments: ["doctor", "--skill", "--json"],
      cwd: foreignHome,
      environment: { HOME: foreignHome, USERPROFILE: foreignHome },
    });
    expect(foreign.exitCode).toBe(1);
    expect(foreign.json).toMatchObject({
      healthy: false,
      identity: { skill: { state: "stale", installed_version: null } },
    });
    expect(Buffer.compare(await readFile(foreignSkill), foreignBytes)).toBe(0);
  },
);
