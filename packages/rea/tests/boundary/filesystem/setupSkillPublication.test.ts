import { constants as fsConstants } from "node:fs";
import * as filesystem from "node:fs/promises";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { OwnedStagedOutput } from "../../../src/filesystem/OwnedStagedOutput.js";
import { SkillFilePublication } from "../../../src/application/SkillFilePublication.js";
import {
  canonicalSkillNeedsInstall,
  installCanonicalSkill,
  MANAGED_SKILL_FILES,
  skillDestinations,
  type SkillInstallFileOperations,
} from "../../../src/application/SetupSkill.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, link: vi.fn(original.link) };
});

const skillPublicationOperations: SkillInstallFileOperations = {
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  backup: (source, destination) =>
    copyFile(source, destination, fsConstants.COPYFILE_EXCL),
  prepare: SkillFilePublication.prepare,
};

describe("skill publication ownership", () => {
  it.each([
    { change: "edit", existing: true },
    { change: "replacement", existing: true },
    { change: "mode", existing: true },
    { change: "edit", existing: false },
    { change: "replacement", existing: false },
  ] as const)(
    "preserves a user $change after publication (existing: $existing)",
    async ({ change, existing }) => {
      if (change === "mode" && process.platform === "win32") return;
      const home = await createTestTempDirectory(
        "rea-skill-published-conflict-",
      );
      const manifest = join(skillDestinations(home, [])[0]!.path, "SKILL.md");
      await mkdir(dirname(manifest), { recursive: true });
      if (existing)
        await writeFile(manifest, "original instructions\n", { mode: 0o640 });
      let published: Buffer | undefined;
      const userBytes = Buffer.from("new user instructions\n");
      const result = await installCanonicalSkill(
        home,
        [],
        {},
        process.platform,
        {
          ...skillPublicationOperations,
          prepare: async (...args) => {
            const publication = await SkillFilePublication.prepare(...args);
            if (publication.path === manifest) {
              const publish = publication.publish.bind(publication);
              vi.spyOn(publication, "publish").mockImplementation(async () => {
                await publish();
                published = await readFile(manifest);
                if (change === "replacement") {
                  const replacement = `${manifest}.user`;
                  await writeFile(replacement, userBytes);
                  await rename(replacement, manifest);
                } else if (change === "mode") await chmod(manifest, 0o600);
                else await writeFile(manifest, userBytes);
                throw new Error("post-publication failure");
              });
            }
            return publication;
          },
        },
      );
      if (result.ok) throw new Error("Expected controlled publication failure");
      expect(result.error.stage).toBe("write");
      expect(result.error.reason).toBe("post-publication failure");
      expect(result.error.rollbackFailures).toEqual([
        expect.objectContaining({ path: manifest }),
      ]);
      const expected = change === "mode" ? published : userBytes;
      if (expected === undefined)
        throw new Error("Expected published skill bytes");
      expect(Buffer.compare(await readFile(manifest), expected)).toBe(0);
      if (existing)
        expect(await readFile(`${manifest}.rea.backup`, "utf8")).toBe(
          "original instructions\n",
        );
      else expect(result.error.recoveryBackupPaths).toEqual([]);
      expect(await result.error.retryCleanup()).toEqual([]);
      expect(Buffer.compare(await readFile(manifest), expected)).toBe(0);
    },
  );

  it("preserves a concurrently created first-install destination", async () => {
    const home = await createTestTempDirectory(
      "rea-skill-first-install-conflict-",
    );
    const manifest = join(skillDestinations(home, [])[0]!.path, "SKILL.md");
    const result = await installCanonicalSkill(home, [], {}, process.platform, {
      ...skillPublicationOperations,
      prepare: async (...args) => {
        const publication = await SkillFilePublication.prepare(...args);
        if (publication.path === manifest)
          await writeFile(manifest, "concurrent user file\n", { flag: "wx" });
        return publication;
      },
    });
    if (result.ok) throw new Error("Expected destination conflict");
    expect(result.error.reason).toContain(
      "Skill destination appeared or changed during installation",
    );
    expect(result.error.remediation).toContain(
      "Stop concurrent setup activity",
    );
    expect(result.error.remediation).not.toContain("Check permissions");
    expect(result.error.rollbackFailures).toEqual([]);
    expect(await readFile(manifest, "utf8")).toBe("concurrent user file\n");
    expect((await readdir(dirname(manifest))).sort()).toEqual([
      "SKILL.md",
      "references",
    ]);
  });

  it("reports a destination changed before readback without overwriting it", async () => {
    const home = await createTestTempDirectory("rea-skill-readback-conflict-");
    const manifest = join(skillDestinations(home, [])[0]!.path, "SKILL.md");
    const result = await installCanonicalSkill(home, [], {}, process.platform, {
      ...skillPublicationOperations,
      prepare: async (...args) => {
        const publication = await SkillFilePublication.prepare(...args);
        if (publication.path === manifest) {
          const publish = publication.publish.bind(publication);
          vi.spyOn(publication, "publish").mockImplementation(async () => {
            await publish();
            await writeFile(manifest, "concurrent edit\n");
          });
        }
        return publication;
      },
    });
    if (result.ok) throw new Error("Expected destination conflict");
    expect(result.error.stage).toBe("readback");
    expect(result.error.remediation).toContain(
      "Stop concurrent setup activity",
    );
    expect(await readFile(manifest, "utf8")).toBe("concurrent edit\n");
    expect(result.error.rollbackFailures).toContainEqual(
      expect.objectContaining({ path: manifest }),
    );
  });
});

it("preserves a destination created immediately before exclusive publication", async () => {
  const home = await createTestTempDirectory("rea-skill-link-conflict-");
  const manifest = join(skillDestinations(home, [])[0]!.path, "SKILL.md");
  const originalLink = (
    await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
  ).link;
  const link = vi
    .mocked(filesystem.link)
    .mockImplementation(async (from, to) => {
      if (to === manifest)
        await writeFile(manifest, "concurrent user file\n", { flag: "wx" });
      await originalLink(from, to);
    });
  try {
    const result = await installCanonicalSkill(home, [], {}, process.platform);
    if (result.ok) throw new Error("Expected destination conflict");
    expect(link).toHaveBeenCalled();
    expect(result.error.reason).toContain(
      "Skill destination appeared or changed",
    );
    expect(result.error.remediation).toContain(
      "Stop concurrent setup activity",
    );
    expect(result.error.rollbackFailures).toEqual([]);
    expect(await readFile(manifest, "utf8")).toBe("concurrent user file\n");
  } finally {
    link.mockRestore();
  }
});

describe("skill publication recovery", () => {
  it.each([
    Buffer.alloc(0),
    Buffer.from([0xff, 0xfe, 0x61, 0x00]),
    Buffer.from("\ufefforiginal BOM instructions\r\n"),
  ])(
    "restores byte-exact originals and mode after ambiguous readback",
    async (bytes) => {
      const home = await createTestTempDirectory(
        "rea-skill-readback-recovery-",
      );
      const manifest = join(skillDestinations(home, [])[0]!.path, "SKILL.md");
      await mkdir(dirname(manifest), { recursive: true });
      await writeFile(manifest, bytes, { mode: 0o640 });
      const result = await installCanonicalSkill(
        home,
        [],
        {},
        process.platform,
        {
          ...skillPublicationOperations,
          prepare: async (...args) => {
            const publication = await SkillFilePublication.prepare(...args);
            if (publication.path === manifest)
              vi.spyOn(publication, "assertCurrent").mockRejectedValueOnce(
                new Error("readback unavailable"),
              );
            return publication;
          },
        },
      );
      if (result.ok) throw new Error("Expected readback failure");
      expect(result.error.stage).toBe("readback");
      expect(result.error.reason).toBe("readback unavailable");
      expect(Buffer.compare(await readFile(manifest), bytes)).toBe(0);
      expect(
        Buffer.compare(await readFile(`${manifest}.rea.backup`), bytes),
      ).toBe(0);
      if (process.platform !== "win32")
        expect((await stat(manifest)).mode & 0o777).toBe(0o640);
      expect(
        result.error.rollbackFailures.every(({ reason }) =>
          reason.includes("First-install skill recovery"),
        ),
      ).toBe(true);
      expect(result.error.rollbackFailures).toHaveLength(
        MANAGED_SKILL_FILES.length - 1,
      );
    },
  );

  it("retains a first-install publication after failed verification", async () => {
    const home = await createTestTempDirectory(
      "rea-skill-first-install-readback-",
    );
    const manifest = join(skillDestinations(home, [])[0]!.path, "SKILL.md");
    const result = await installCanonicalSkill(home, [], {}, process.platform, {
      ...skillPublicationOperations,
      prepare: async (...args) => {
        const publication = await SkillFilePublication.prepare(...args);
        if (publication.path === manifest)
          vi.spyOn(publication, "assertCurrent").mockRejectedValueOnce(
            new Error("readback unavailable"),
          );
        return publication;
      },
    });
    if (result.ok) throw new Error("Expected readback failure");
    expect(result.error.rollbackFailures).toHaveLength(
      MANAGED_SKILL_FILES.length,
    );
    expect(
      result.error.rollbackFailures.every(({ reason }) =>
        reason.includes("manual removal"),
      ),
    ).toBe(true);
    expect(await canonicalSkillNeedsInstall(home)).toBe(false);
    expect(
      (await readdir(dirname(manifest))).some((name) =>
        name.startsWith(".rea-skill-"),
      ),
    ).toBe(false);
  });

  it.each([false, true])(
    "retains exact staging cleanup for retry (scope: %s)",
    async (scoped) => {
      const resources = scoped ? new ArtifactResourceScope() : undefined;
      const home = await createTestTempDirectory("rea-skill-cleanup-retry-");
      const manifest = join(skillDestinations(home, [])[0]!.path, "SKILL.md");
      let closeAttempts = 0;
      const result = await installCanonicalSkill(
        home,
        [],
        {},
        process.platform,
        {
          ...skillPublicationOperations,
          prepare: async (...args) => {
            const publication = await SkillFilePublication.prepare(...args);
            if (publication.path === manifest) {
              const close = publication.lease.release.bind(publication.lease);
              vi.spyOn(publication.lease, "release").mockImplementation(
                async () => {
                  if (++closeAttempts <= 2)
                    throw new Error("staging close denied");
                  await close();
                },
              );
            }
            return publication;
          },
        },
        resources,
      );
      if (result.ok) throw new Error("Expected cleanup failure");
      expect(result.error.reason).toContain("cleanup incomplete");
      expect(result.error.rollbackFailures).toEqual([
        {
          path: expect.stringContaining(".rea-skill-"),
          reason: "staging close denied",
        },
      ]);
      expect(await canonicalSkillNeedsInstall(home)).toBe(false);
      expect(resources?.hasPending).toBe(scoped ? true : undefined);
      if (resources !== undefined) {
        await resources.retryCleanup();
        expect(resources.hasPending).toBe(false);
      } else expect(await result.error.retryCleanup()).toEqual([]);
      expect(closeAttempts).toBe(3);
      expect(
        (await readdir(dirname(manifest))).some((name) =>
          name.startsWith(".rea-skill-"),
        ),
      ).toBe(false);
    },
  );
});

describe("skill staging preparation", () => {
  it("retains the primary failure and staging owner when preparation cleanup fails", async () => {
    const home = await createTestTempDirectory("rea-skill-prepare-cleanup-");
    const manifest = join(skillDestinations(home, [])[0]!.path, "SKILL.md");
    await mkdir(dirname(manifest), { recursive: true });
    await writeFile(manifest, "original instructions\n");
    const ready = vi
      .spyOn(OwnedStagedOutput.prototype, "assertReadyForPublication")
      .mockRejectedValueOnce(new Error("staging verification denied"));
    const close = vi
      .spyOn(OwnedStagedOutput.prototype, "close")
      .mockRejectedValueOnce(new Error("staging cleanup denied"))
      .mockRejectedValueOnce(new Error("staging cleanup still denied"));
    try {
      const result = await installCanonicalSkill(home);
      if (result.ok) throw new Error("Expected preparation failure");
      expect(result.error.reason).toContain("staging verification denied");
      expect(result.error.reason).toContain("staging cleanup denied");
      expect(result.error.rollbackFailures).toEqual([
        {
          path: expect.stringContaining(".rea-skill-"),
          reason: "staging cleanup still denied",
        },
      ]);
      expect(await readFile(manifest, "utf8")).toBe("original instructions\n");
      expect(await result.error.retryCleanup()).toEqual([]);
      expect(close).toHaveBeenCalledTimes(3);
      expect(
        (await readdir(dirname(manifest))).some((name) =>
          name.startsWith(".rea-skill-"),
        ),
      ).toBe(false);
    } finally {
      ready.mockRestore();
      close.mockRestore();
    }
  });
});
