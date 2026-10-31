import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { clientSkillDirectories } from "../../../src/application/SupportedClients.js";
import { resolveHermesClientHome } from "../../../src/application/HermesClientHome.js";
import {
  canonicalSkillNeedsInstall,
  readInstalledSkillIdentity,
  skillDestinations,
  validateCanonicalSkillDirectories,
} from "../../../src/application/SetupSkill.js";
import { PRODUCT_IDENTITY } from "../../../src/identity.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("uses the same Hermes root for sticky selection and named profile resolution", async () => {
  const home = await createTestTempDirectory("rea-hermes-nested-root-");
  const native = join(home, ".hermes");
  const nested = join(native, "nested");
  const profile = join(native, "profiles", "coder");
  await mkdir(profile, { recursive: true });
  await mkdir(nested);
  await writeFile(join(profile, "config.yaml"), "version: 1\n");
  await writeFile(join(native, "active_profile"), "coder\n");
  await writeFile(join(nested, "active_profile"), "other\n");
  expect(resolveHermesClientHome(home, "linux", { HERMES_HOME: nested })).toBe(
    profile,
  );
  expect(
    clientSkillDirectories(home, ["hermes"], { HERMES_HOME: nested })
      .directories,
  ).toEqual([{ client: "hermes", directory: join(profile, "skills") }]);
});

it("retains an explicitly selected missing Hermes profile as unresolved without writing elsewhere", async () => {
  const home = await createTestTempDirectory("rea-skill-profile-selection-");
  const root = join(home, ".hermes");
  await mkdir(root);
  await writeFile(join(root, "active_profile"), "missing-profile\n");
  const environment = { HERMES_HOME: root };
  const selection = clientSkillDirectories(home, ["hermes"], environment);
  expect(selection).toMatchObject({
    directories: [],
    unresolved: [
      {
        client: "hermes",
        path: join(root, "profiles", "missing-profile"),
      },
    ],
  });
  expect(() => skillDestinations(home, ["hermes"], environment)).toThrow(
    "missing",
  );
  expect(await canonicalSkillNeedsInstall(home, ["hermes"], environment)).toBe(
    true,
  );
  expect(
    await validateCanonicalSkillDirectories(home, ["hermes"], environment),
  ).toMatchObject({ ok: false });
  expect(
    await readInstalledSkillIdentity(home, ["hermes"], environment),
  ).toMatchObject({
    canonical: false,
    issues: [
      {
        client: "hermes",
        kind: "unresolved",
        path: join(root, "profiles", "missing-profile"),
      },
    ],
  });
  expect(await readdir(home)).toEqual([".hermes"]);
  expect(await readFile(join(root, "active_profile"), "utf8")).toBe(
    "missing-profile\n",
  );
});

it("retains freshness for each selected personal and shared skill copy", async () => {
  const home = await createTestTempDirectory("rea-skill-copy-selection-");
  const roots = [
    join(home, ".claude", "skills", PRODUCT_IDENTITY.skillName),
    join(home, ".agents", "skills", PRODUCT_IDENTITY.skillName),
  ];
  for (const root of roots) {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "SKILL.md"), "stale local copy\n");
  }
  const identity = await readInstalledSkillIdentity(home, [
    "claude_code",
    "shared",
  ]);
  expect(identity).toMatchObject({
    canonical: false,
    issues: expect.arrayContaining([
      expect.objectContaining({
        client: "claude_code",
        path: roots[0],
        kind: "stale",
      }),
      expect.objectContaining({
        client: "shared",
        path: roots[1],
        kind: "stale",
      }),
    ]),
  });
});
