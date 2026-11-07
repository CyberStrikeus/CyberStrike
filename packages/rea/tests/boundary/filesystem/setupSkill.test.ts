import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import {
  canonicalSkillNeedsInstall,
  existingSkillDestinations,
  installCanonicalSkill,
  readSkillFile,
  readInstalledSkillIdentity,
  skillDestinations,
  type SkillInstallFileOperations,
} from "../../../src/application/SetupSkill.js";
import {
  runDoctor,
  systemDoctorHost,
} from "../../../src/application/Doctor.js";
import { createDoctorHostFixture } from "../../../src/application/Doctor.fixture.js";
import { TOOL_CONTRACTS } from "../../../src/contracts/toolContracts.js";
import { PRODUCT_IDENTITY } from "../../../src/identity.js";
import { SkillFilePublication } from "../../../src/application/SkillFilePublication.js";
import { z } from "zod";
import { skillReferenceIssues } from "../../../scripts/lib/docs-facts.mjs";

describe("managed skill file read boundary", () => {
  it("rejects linked and oversized managed guide files", async () => {
    const root = await createTestTempDirectory("rea-guidance-file-boundary-");
    const target = join(root, "guide.md");
    const link = join(root, "linked-guide.md");
    const oversized = join(root, "oversized-guide.md");
    await writeFile(target, "safe guide content");
    await symlink(target, link);
    await writeFile(oversized, "larger than limit");

    await expect(readSkillFile(link)).rejects.toThrow();
    await expect(readSkillFile(oversized, undefined, 4)).rejects.toThrow();
  });
});

const expectPermissionMode = async (
  path: string,
  expected: number,
): Promise<void> => {
  if (process.platform === "win32") return;
  expect((await stat(path)).mode & 0o777).toBe(expected);
};

describe("skill recovery backup selection", () => {
  it("reuses a verified existing backup without copying it again", async () => {
    const home = await createTestTempDirectory("rea-skill-matching-backup-");
    const [destination] = skillDestinations(home, []);
    if (destination === undefined) throw new Error("Missing shared skill root");
    const manifest = join(destination.path, "SKILL.md");
    const current = "currently installed instructions\n";
    await mkdir(dirname(manifest), { recursive: true });
    await writeFile(manifest, current);
    await writeFile(`${manifest}.rea.backup`, current);
    const result = await installCanonicalSkill(home, [], {}, process.platform, {
      mkdir: async (path) =>
        mkdir(path, { recursive: true }).then(() => undefined),
      backup: async () => {
        throw new Error("A matching backup must not be copied again");
      },
      prepare: SkillFilePublication.prepare,
    });

    expect(result).toEqual({ ok: true, value: "installed" });
    expect(await readFile(`${manifest}.rea.backup`, "utf8")).toBe(current);
    expect(await canonicalSkillNeedsInstall(home, [])).toBe(false);
  });

  it("advertises a current recovery snapshot when the first backup is historical", async () => {
    const home = await createTestTempDirectory("rea-skill-historical-backup-");
    const [destination] = skillDestinations(home, []);
    if (destination === undefined) throw new Error("Missing shared skill root");
    const manifest = join(destination.path, "SKILL.md");
    const current = "currently installed instructions V2\n";
    const oldSnapshot = "historical instructions V0\n";
    await mkdir(dirname(manifest), { recursive: true });
    await writeFile(manifest, current);
    await writeFile(`${manifest}.rea.backup`, oldSnapshot);
    const operations: SkillInstallFileOperations = {
      mkdir: async (path) =>
        mkdir(path, { recursive: true }).then(() => undefined),
      backup: async (source, target) =>
        copyFile(source, target, fsConstants.COPYFILE_EXCL),
      prepare: async (...args) => {
        const publication = await SkillFilePublication.prepare(...args);
        if (publication.path === manifest) {
          const publish = publication.publish.bind(publication);
          vi.spyOn(publication, "publish").mockImplementation(async () => {
            await publish();
            throw new Error("injected failure after publication");
          });
          vi.spyOn(publication, "restore").mockRejectedValue(
            new Error("injected rollback failure"),
          );
        }
        return publication;
      },
    };

    const result = await installCanonicalSkill(
      home,
      [],
      {},
      process.platform,
      operations,
    );

    if (result.ok) throw new Error("Expected the injected write failure");
    expect(result.error.rollbackFailures).toEqual([
      { path: manifest, reason: "injected rollback failure" },
    ]);
    const recovery = result.error.recoveryBackupPaths.find((path) =>
      path.startsWith(`${manifest}.rea.backup.`),
    );
    expect(recovery).toBeDefined();
    expect(await readFile(recovery!, "utf8")).toBe(current);
    expect(await readFile(`${manifest}.rea.backup`, "utf8")).toBe(oldSnapshot);
  });
});

describe("skill recovery byte preservation", () => {
  it("backs up and restores the exact bytes of invalid UTF-8 before replacing a skill", async () => {
    const home = await createTestTempDirectory("rea-skill-damaged-bytes-");
    const [destination] = skillDestinations(home, []);
    if (destination === undefined) throw new Error("Missing shared skill root");
    const manifest = join(destination.path, "SKILL.md");
    const original = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0xff, 0x0a]);
    const firstBackup = `${manifest}.rea.backup`;
    const recovery = `${firstBackup}.${createHash("sha256").update(original).digest("hex")}.recovery`;
    await mkdir(dirname(manifest), { recursive: true });
    await writeFile(manifest, original);
    await writeFile(firstBackup, "historical instructions V0\n");
    const result = await installCanonicalSkill(home, [], {}, process.platform, {
      mkdir: async (path) =>
        mkdir(path, { recursive: true }).then(() => undefined),
      backup: async (source, target) =>
        copyFile(source, target, fsConstants.COPYFILE_EXCL),
      prepare: async (...args) => {
        const publication = await SkillFilePublication.prepare(...args);
        if (publication.path === manifest) {
          const publish = publication.publish.bind(publication);
          vi.spyOn(publication, "publish").mockImplementation(async () => {
            await publish();
            throw new Error("injected failure after publication");
          });
        }
        return publication;
      },
    });
    if (result.ok) throw new Error("Expected the injected write failure");
    expect(result.error.recoveryBackupPaths).toContain(recovery);
    expect(Buffer.compare(await readFile(recovery), original)).toBe(0);
    expect(Buffer.compare(await readFile(manifest), original)).toBe(0);
    expect(result.error.rollbackFailures).toEqual([]);
    expect(await readFile(firstBackup, "utf8")).toBe(
      "historical instructions V0\n",
    );
  });
});

describe("skill directory admission", () => {
  it("excludes a linked references directory from update maintenance", async () => {
    const directory = await createTestTempDirectory(
      "rea-skill-linked-maintenance-",
    );
    const installed = await installCanonicalSkill(directory, ["claude_code"]);
    expect(installed.ok).toBe(true);
    const [selected] = skillDestinations(directory, ["claude_code"]);
    if (selected === undefined) throw new Error("Missing skill destination");
    const references = join(selected.path, "references");
    const retained = join(directory, "retained-references");
    await rename(references, retained);
    await symlink(
      retained,
      references,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(await existingSkillDestinations(directory)).toEqual({
      destinations: [],
      issues: [],
    });
    expect((await lstat(references)).isSymbolicLink()).toBe(true);
    await access(join(retained, "native-and-artifacts.md"));
  });

  it
    .skipIf(process.platform === "win32" || process.getuid?.() === 0)
    .each(["aligned", "stale", "missing"] as const)(
    "reports every unreadable reference with a %s manifest",
    async (manifestState) => {
      const directory = await createTestTempDirectory(
        "rea-skill-unreadable-reference-",
      );
      expect((await installCanonicalSkill(directory, ["claude_code"])).ok).toBe(
        true,
      );
      const [selected] = skillDestinations(directory, ["claude_code"]);
      if (selected === undefined) throw new Error("Missing skill destination");
      const manifest = join(selected.path, "SKILL.md");
      if (manifestState === "stale")
        await writeFile(manifest, "\nlocal changes\n", { flag: "a" });
      if (manifestState === "missing") await rm(manifest);
      const references = [
        "references/connection-and-recovery.md",
        "references/evidence-workflows.md",
      ].map((relative) => join(selected.path, relative));
      for (const reference of references) await chmod(reference, 0o000);
      try {
        const identity = await readInstalledSkillIdentity(directory, [
          "claude_code",
        ]);
        const issues = references.map((path) =>
          expect.objectContaining({
            path,
            kind: "unreadable",
            detail: expect.stringContaining("EACCES"),
          }),
        );
        expect(identity).toMatchObject({
          canonical: false,
          version:
            manifestState === "missing" ? null : PRODUCT_IDENTITY.skillVersion,
          issues,
        });
        const report = await runDoctor(
          undefined,
          createDoctorHostFixture({
            installedSkillIdentity: () => Promise.resolve(identity),
          }),
        );
        expect(report.identity?.skill).toMatchObject({
          state: "unknown",
          issues,
          remediation: expect.stringContaining("evidence-workflows.md"),
        });
      } finally {
        for (const reference of references) await chmod(reference, 0o600);
      }
    },
  );

  it.each(["root", "references"] as const)(
    "refuses a linked skill %s before changing any selected destination",
    async (linkedDirectory) => {
      const home = await createTestTempDirectory("rea-skill-linked-root-");
      const destinations = skillDestinations(home, ["shared", "claude_code"]);
      const selected = destinations.find(
        ({ client }) => client === "claude_code",
      );
      if (selected === undefined)
        throw new Error("Missing Claude Code skill root");
      const managed = join(home, "user-managed");
      await mkdir(managed);
      const original = "user-owned instructions\n";
      await writeFile(join(managed, "SKILL.md"), original);
      const linked =
        linkedDirectory === "root"
          ? selected.path
          : join(selected.path, "references");
      await mkdir(dirname(linked), { recursive: true });
      await symlink(
        managed,
        linked,
        process.platform === "win32" ? "junction" : "dir",
      );

      const result = await installCanonicalSkill(home, [
        "shared",
        "claude_code",
      ]);
      if (result.ok) throw new Error("Expected linked directory refusal");
      expect(result.error.stage).toBe("prepare");
      expect(result.error.path).toBe(linked);
      expect(result.error.reason).toContain("symbolic link");
      expect(result.error.rollbackFailures).toEqual([]);
      expect((await lstat(linked)).isSymbolicLink()).toBe(true);
      expect(await readFile(join(managed, "SKILL.md"), "utf8")).toBe(original);
      expect(await readdir(managed)).toEqual(["SKILL.md"]);
      const shared = destinations.find(({ client }) => client === "shared");
      if (shared === undefined) throw new Error("Missing shared skill root");
      await expect(access(shared.path)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
});

describe("canonical skill transaction", () => {
  it("does not roll back files when backup preparation fails", async () => {
    const home = await createTestTempDirectory("rea-skill-backup-failure-");
    const root = join(home, ".agents/skills/reverse-engineer-anything");
    const manifest = join(root, "SKILL.md");
    const connection = join(root, "references/connection-and-recovery.md");
    const original = "operator-owned manifest bytes\n";
    const secondOriginal = "operator-owned reference bytes\n";
    await mkdir(dirname(connection), { recursive: true });
    await writeFile(manifest, original, { mode: 0o640 });
    await writeFile(connection, secondOriginal, { mode: 0o644 });
    const writes: string[] = [];
    let backups = 0;
    const operations: SkillInstallFileOperations = {
      mkdir: async (path) => {
        await mkdir(path, { recursive: true });
      },
      backup: async (source, target) => {
        backups += 1;
        if (backups === 2) throw new Error("injected backup failure");
        await copyFile(source, target, fsConstants.COPYFILE_EXCL);
      },
      prepare: async (...args) => {
        writes.push(args[0]);
        return SkillFilePublication.prepare(...args);
      },
    };

    const result = await installCanonicalSkill(
      home,
      [],
      {},
      process.platform,
      operations,
    );

    if (result.ok) throw new Error("Expected backup failure");
    expect(result.error.stage).toBe("backup");
    expect(result.error.rollbackFailures).toEqual([]);
    expect(writes).toEqual([]);
    expect(await readFile(manifest, "utf8")).toBe(original);
    expect(await readFile(connection, "utf8")).toBe(secondOriginal);
    expect(await readFile(`${manifest}.rea.backup`, "utf8")).toBe(original);
    await expect(
      readFile(`${connection}.rea.backup`, "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expectPermissionMode(manifest, 0o640);
    await expectPermissionMode(connection, 0o644);
  });

  it("rolls back attempted writes independently and preserves original modes", async () => {
    const home = await createTestTempDirectory("rea-skill-rollback-failure-");
    const [destination] = skillDestinations(home, []);
    if (destination === undefined) throw new Error("Missing shared skill root");
    const root = destination.path;
    const manifest = join(root, "SKILL.md");
    const connection = join(root, "references/connection-and-recovery.md");
    const native = join(root, "references/native-and-artifacts.md");
    await mkdir(dirname(native), { recursive: true });
    await writeFile(manifest, "old manifest\n", { mode: 0o640 });
    await writeFile(connection, "old connection\n", { mode: 0o644 });
    await writeFile(native, "old native\n", { mode: 0o600 });
    const operations: SkillInstallFileOperations = {
      mkdir: async (path) => {
        await mkdir(path, { recursive: true });
      },
      backup: async (source, target) =>
        copyFile(source, target, fsConstants.COPYFILE_EXCL),
      prepare: async (...args) => {
        const publication = await SkillFilePublication.prepare(...args);
        if (publication.path === native) {
          const publish = publication.publish.bind(publication);
          vi.spyOn(publication, "publish").mockImplementation(async () => {
            await publish();
            throw new Error("injected ambiguous publication failure");
          });
          vi.spyOn(publication, "restore").mockRejectedValue(
            new Error("injected rollback failure"),
          );
        }
        return publication;
      },
    };

    const result = await installCanonicalSkill(
      home,
      [],
      {},
      process.platform,
      operations,
    );

    if (result.ok) throw new Error("Expected write failure");
    expect(result.error.stage).toBe("write");
    expect(result.error.path).toBe(native);
    expect(result.error.rollbackFailures).toEqual([
      { path: native, reason: "injected rollback failure" },
    ]);
    expect(result.error.recoveryBackupPaths).toEqual([
      `${manifest}.rea.backup`,
      `${connection}.rea.backup`,
      `${native}.rea.backup`,
    ]);
    expect(result.error.message).toContain(
      `${native} (injected rollback failure)`,
    );
    expect(await readFile(manifest, "utf8")).toBe("old manifest\n");
    expect(await readFile(connection, "utf8")).toBe("old connection\n");
    await expectPermissionMode(manifest, 0o640);
    await expectPermissionMode(connection, 0o644);
    expect(await readFile(native, "utf8")).not.toBe("old native\n");
    expect(await readFile(`${native}.rea.backup`, "utf8")).toBe("old native\n");
    expect(result.error.message).toContain(
      `Existing-file backups remain at ${manifest}.rea.backup`,
    );
  });
});

describe("canonical skill discovery", () => {
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "preserves an unreadable existing skill instead of treating it as absent",
    async () => {
      const home = await createTestTempDirectory("rea-skill-unreadable-");
      const destination = join(
        home,
        ".agents/skills/reverse-engineer-anything/SKILL.md",
      );
      const original = "existing private skill bytes\n";
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, original, { mode: 0o200 });
      try {
        await chmod(destination, 0o200);
        const result = await installCanonicalSkill(home);
        if (result.ok) throw new Error("Expected unreadable skill failure");
        expect(result.error.stage).toBe("prepare");
      } finally {
        await chmod(destination, 0o600);
      }
      expect(await readFile(destination, "utf8")).toBe(original);
      await expect(
        readFile(`${destination}.rea.backup`, "utf8"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("installs only the selected Claude Code personal skill", async () => {
    const home = await createTestTempDirectory("rea-claude-skill-");
    const configDirectory = join(home, "claude-config");
    const skillsDirectory = join(configDirectory, "skills");
    const claudeSkill = join(
      skillsDirectory,
      "reverse-engineer-anything/SKILL.md",
    );
    await mkdir(configDirectory, { recursive: true });
    await writeFile(
      join(configDirectory, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          rea: {
            command: "npx",
            args: ["-y", PRODUCT_IDENTITY.registrationPackageSpecifier, "mcp"],
          },
        },
      }),
    );
    const host = systemDoctorHost({
      environment: {
        HOME: home,
        USERPROFILE: home,
        CLAUDE_CONFIG_DIR: configDirectory,
      },
    });

    expect(
      await canonicalSkillNeedsInstall(home, ["claude_code"], {
        CLAUDE_CONFIG_DIR: dirname(skillsDirectory),
      }),
    ).toBe(true);
    expect(
      await installCanonicalSkill(home, ["claude_code"], {
        CLAUDE_CONFIG_DIR: dirname(skillsDirectory),
      }),
    ).toMatchObject({ ok: true, value: "installed" });
    expect(
      await canonicalSkillNeedsInstall(home, ["claude_code"], {
        CLAUDE_CONFIG_DIR: dirname(skillsDirectory),
      }),
    ).toBe(false);
    await expect(access(claudeSkill)).resolves.toBeUndefined();
    await expect(
      access(join(home, ".agents/skills/reverse-engineer-anything")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (
        await runDoctor(undefined, host, {
          clients: ["claude_code"],
          skill: true,
        })
      ).identity?.skill.state,
    ).toBe("aligned");
  });

  it("checks selected skill locations for independent drift", async () => {
    const home = await createTestTempDirectory("rea-mixed-skill-");
    const sharedSkill = join(
      home,
      ".agents/skills/reverse-engineer-anything/SKILL.md",
    );
    const claudeSkills = join(home, ".claude", "skills");
    const claudeSkill = join(
      claudeSkills,
      "reverse-engineer-anything/SKILL.md",
    );
    const host = systemDoctorHost({
      environment: { HOME: home, USERPROFILE: home },
    });
    const doctorScope = { clients: ["claude_code", "codex"], skill: true };

    expect(
      await installCanonicalSkill(home, ["claude_code", "codex"]),
    ).toMatchObject({ ok: true, value: "installed" });
    await rm(sharedSkill);
    expect(
      (await runDoctor(undefined, host, doctorScope)).identity?.skill.state,
    ).toBe("stale");
    expect(
      await installCanonicalSkill(home, ["claude_code", "codex"]),
    ).toMatchObject({ ok: true, value: "installed" });
    for (const skill of [sharedSkill, claudeSkill]) {
      await writeFile(skill, "selected copy changed\n");
      expect(
        (await runDoctor(undefined, host, doctorScope)).identity?.skill.state,
      ).toBe("stale");
      expect(
        await installCanonicalSkill(home, ["claude_code", "codex"]),
      ).toMatchObject({ ok: true, value: "installed" });
      expect(
        (await runDoctor(undefined, host, doctorScope)).identity?.skill.state,
      ).toBe("aligned");
    }
  });
});

describe("canonical skill transaction", () => {
  it("backs up and upgrades a stale managed skill without touching siblings", async () => {
    const home = await createTestTempDirectory("rea-skill-test-");
    const destination = join(
      home,
      ".agents/skills/reverse-engineer-anything/SKILL.md",
    );
    const sibling = join(home, ".agents/skills/unrelated/SKILL.md");
    const nativeGuide = join(
      dirname(destination),
      "references/native-and-artifacts.md",
    );
    await mkdir(dirname(destination), { recursive: true });
    await mkdir(dirname(nativeGuide), { recursive: true });
    await mkdir(dirname(sibling), { recursive: true });
    await writeFile(destination, "stale managed skill\n", { mode: 0o640 });
    await writeFile(nativeGuide, "stale filesystem-write permission grant\n");
    await writeFile(sibling, "unrelated skill\n");

    expect(await canonicalSkillNeedsInstall(home)).toBe(true);
    expect(await installCanonicalSkill(home)).toMatchObject({
      ok: true,
      value: "installed",
    });
    expect(await readFile(`${destination}.rea.backup`, "utf8")).toBe(
      "stale managed skill\n",
    );
    const installedSkill = await readFile(destination, "utf8");
    expect(installedSkill).toBe(
      await readFile(
        new URL(
          "../../../skills/reverse-engineer-anything/SKILL.md",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(installedSkill).toContain(
      `version: "${PRODUCT_IDENTITY.skillVersion}"`,
    );
    await expectPermissionMode(destination, 0o640);
    expect(await readFile(`${nativeGuide}.rea.backup`, "utf8")).toBe(
      "stale filesystem-write permission grant\n",
    );
    for (const reference of [
      "connection-and-recovery.md",
      "native-and-artifacts.md",
      "javascript-applications.md",
      "android-applications.md",
      "runtime-observation.md",
      "evidence-workflows.md",
    ]) {
      const installed = await readFile(
        join(dirname(destination), "references", reference),
        "utf8",
      );
      expect(installed).toBe(
        await readFile(
          new URL(
            `../../../skills/reverse-engineer-anything/references/${reference}`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
      expect(installed).not.toMatch(
        /filesystem-write permission grant|native_mount_approved|only with explicit approval|Obtain the per-call/u,
      );
    }
    expect(installedSkill).toContain(
      "use normal repository tools and do not run REA",
    );
    expect(installedSkill).toContain(
      `tool_count: ${String(TOOL_CONTRACTS.length)}`,
    );
    expect(await readFile(sibling, "utf8")).toBe("unrelated skill\n");
    expect(
      await readFile(
        join(
          home,
          ".agents/skills/reverse-engineer-anything/references/javascript-applications.md",
        ),
        "utf8",
      ),
    ).toContain("analyze_javascript_application");
    expect(await canonicalSkillNeedsInstall(home)).toBe(false);
    expect(await installCanonicalSkill(home)).toMatchObject({
      ok: true,
      value: "unchanged",
    });
    expect(await skillReferenceIssues(dirname(destination))).toEqual([]);
  });

  it("binds portable conformance to the generated skill bytes that setup installs", async () => {
    const home = await createTestTempDirectory("rea-skill-commitment-");
    expect(await installCanonicalSkill(home)).toMatchObject({
      ok: true,
      value: "installed",
    });
    const paths = [
      "SKILL.md",
      "references/android-applications.md",
      "references/connection-and-recovery.md",
      "references/environments.md",
      "references/evidence-workflows.md",
      "references/javascript-applications.md",
      "references/native-and-artifacts.md",
      "references/runtime-observation.md",
    ];
    const records = await Promise.all(
      paths.map(async (path) => {
        const bytes = await readFile(
          join(home, ".agents/skills/reverse-engineer-anything", path),
        );
        return `${path}\0${createHash("sha256").update(bytes).digest("hex")}\n`;
      }),
    );
    const manifest = z
      .object({
        skill_digests: z.array(
          z.object({ skill_id: z.string(), sha256: z.string() }),
        ),
      })
      .parse(
        JSON.parse(
          await readFile(
            "docs/verification/managed-conformance-manifest.json",
            "utf8",
          ),
        ),
      );
    expect(manifest.skill_digests).toContainEqual({
      skill_id: "reverse-engineer-anything",
      sha256: createHash("sha256").update(records.join("")).digest("hex"),
    });
  });
});

it("doctor verifies installed instructions and references even when metadata is current", async () => {
  const home = await createTestTempDirectory("rea-skill-doctor-");
  const destination = join(
    home,
    ".agents/skills/reverse-engineer-anything/SKILL.md",
  );
  const reference = join(
    dirname(destination),
    "references/evidence-workflows.md",
  );
  const system = systemDoctorHost({
    environment: { HOME: home, USERPROFILE: home },
  });
  const host = createDoctorHostFixture({
    installedSkillIdentity: (registrations) =>
      system.installedSkillIdentity?.(registrations) ??
      Promise.resolve(undefined),
  });
  expect((await runDoctor(undefined, host)).identity?.skill.state).toBe(
    "missing",
  );
  expect(await installCanonicalSkill(home)).toMatchObject({
    ok: true,
    value: "installed",
  });
  expect((await runDoctor(undefined, host)).identity?.skill).toMatchObject({
    state: "aligned",
  });
  for (const [path, remove] of [
    [destination, false],
    [reference, false],
    [reference, true],
  ] as const) {
    if (remove) await rm(path);
    else await writeFile(path, "Locally changed instructions.\n");
    expect((await runDoctor(undefined, host)).identity?.skill.state).toBe(
      "stale",
    );
    expect(await installCanonicalSkill(home)).toMatchObject({
      ok: true,
      value: "installed",
    });
    expect((await runDoctor(undefined, host)).identity?.skill.state).toBe(
      "aligned",
    );
  }
});

it("reads installed frontmatter metadata without treating body examples as identity", async () => {
  const home = await createTestTempDirectory("rea-installed-metadata-");
  const installed = await installCanonicalSkill(home, ["claude_code"]);
  expect(installed.ok).toBe(true);
  const destination = skillDestinations(home, ["claude_code"])[0];
  if (destination === undefined) throw new Error("Missing skill destination");
  const manifest = join(destination.path, "SKILL.md");
  await writeFile(
    manifest,
    "---\nname: reverse-engineer-anything\nmetadata:\n  version: '49'\n  tool_count: -1\n---\n\n```yaml\nmetadata:\n  version: \"counterfeit\"\n  tool_count: 42\n```\n",
  );
  expect(await readInstalledSkillIdentity(home, ["claude_code"])).toMatchObject(
    { version: "49", toolCount: null, canonical: false },
  );
  await writeFile(
    manifest,
    '---\nname: reverse-engineer-anything\n---\n\n```yaml\nmetadata:\n  version: "counterfeit"\n  tool_count: 42\n```\n',
  );
  expect(await readInstalledSkillIdentity(home, ["claude_code"])).toMatchObject(
    { version: null, toolCount: null, canonical: false },
  );
});
