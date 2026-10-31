import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { expect } from "vitest";
import { z } from "zod";

import {
  MANAGED_SKILL_FILES,
  existingSkillDestinations,
  validateCanonicalSkillDirectories,
} from "../../../src/application/SetupSkill.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for(["ancestor", "selected-root"] as const)(
  "explains a non-directory skill %s and recovers after preserving the blocker",
  async (kind, { cli }) => {
    const home = await createTestTempDirectory("rea-skill-path-recovery-");
    const selected = join(home, ".agents/skills/reverse-engineer-anything");
    const blocker = kind === "ancestor" ? join(home, ".agents") : selected;
    await mkdir(dirname(blocker), { recursive: true });
    await writeFile(blocker, "caller-owned blocker\n");
    const run = (
      arguments_: readonly string[] = ["setup", "--yes", "--skill", "--json"],
    ) =>
      cli.run({
        arguments: arguments_,
        cwd: home,
        environment: { HOME: home, USERPROFILE: home },
      });
    expect(await validateCanonicalSkillDirectories(home, [])).toMatchObject({
      ok: false,
      error: {
        stage: "prepare",
        cause: [{ path: selected, kind: "not_directory" }],
      },
    });
    expect(await existingSkillDestinations(home)).toEqual({
      destinations: [],
      issues: [],
    });
    const refused = await run();
    expect(refused.exitCode, refused.stderr).toBe(1);
    expect(refused.json).toMatchObject({
      status: "needs_human",
      code: "skill_install_failed",
      appliedActions: [],
    });
    const { remediation } = z
      .object({ remediation: z.string() })
      .parse(refused.json);
    expect(remediation).toContain("not a directory");
    expect(remediation).toContain("Use a regular skill directory");
    expect(remediation).toContain("--skill=false");
    expect(remediation).not.toMatch(/permissions/iu);
    expect(remediation.split(selected)).toHaveLength(2);
    if (kind === "ancestor") expect(remediation).toContain("ENOTDIR");
    expect(await readFile(blocker, "utf8")).toBe("caller-owned blocker\n");

    const doctor = await run(["doctor", "--skill", "--json"]);
    expect(doctor.exitCode, doctor.stderr).toBe(1);
    expect(doctor.json).toMatchObject({
      healthy: false,
      identity: { skill: { state: "unmanaged" } },
    });
    expect(doctor.stdout).toContain(selected);

    const saved = `${blocker}.saved`;
    await rename(blocker, saved);
    await mkdir(blocker);
    for (let attempt = 0; attempt < 2; attempt++) {
      const installed = await run();
      expect(installed.exitCode, installed.stderr).toBe(0);
      expect(installed.json).toMatchObject({ status: "ready" });
      for (const file of MANAGED_SKILL_FILES)
        expect(
          (await readFile(join(selected, file))).equals(
            await readFile(resolve("skills/reverse-engineer-anything", file)),
          ),
          file,
        ).toBe(true);
      expect(await readFile(saved, "utf8")).toBe("caller-owned blocker\n");
    }
  },
);
