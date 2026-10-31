import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  importReferenceSource,
  readReferenceSource,
} from "../../support/referenceSourceResourceScope.js";

const importTree = (root: string) =>
  importReferenceSource({
    root,
    caller: "native-unreadable-directory-test",
    policy: { secretPatterns: [] },
  });

const permissionChecksUnavailable =
  process.platform === "win32" || process.getuid?.() === 0;

describe("reference source native unreadable directories", () => {
  it.skipIf(permissionChecksUnavailable)(
    "retains a root enumeration IO failure as an error and recovers after permission repair",
    async () => {
      const root = await createTestTempDirectory("rea-source-unreadable-root-");
      await writeFile(join(root, "main.txt"), "root bytes");
      await chmod(root, 0o100);
      try {
        const result = await importTree(root);
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: "io",
            message: expect.stringContaining("EACCES"),
            partial: { rootFailure: { code: "io" } },
          },
        });
        if (!result.ok) expect(result.error.message).toContain(root);
      } finally {
        await chmod(root, 0o700);
      }
      const recovered = await importTree(root);
      expect(recovered.ok && recovered.value.entries).toContainEqual(
        expect.objectContaining({ path: "main.txt", content_state: "hashed" }),
      );
    },
  );

  it.skipIf(permissionChecksUnavailable).each(["blocked", "src/blocked"])(
    "preserves a partial graph when %s cannot be enumerated",
    async (blocked) => {
      const root = await createTestTempDirectory("rea-source-unreadable-dir-");
      const deniedPath = join(root, blocked);
      await mkdir(deniedPath, { recursive: true });
      await writeFile(join(root, "main.ts"), "export const value = 1;\n");
      await chmod(deniedPath, 0);
      try {
        const read = await readReferenceSource(root);
        if (!read.ok) throw new Error(read.error.message);
        const directory = read.value.entries.filter(
          ({ path }) => path === blocked,
        );
        expect(directory).toHaveLength(1);
        expect(directory[0]).toMatchObject({
          status: "failed",
          kind: "directory",
          code: "io",
          message: expect.stringContaining("EACCES"),
        });
        const imported = await importTree(root);
        if (!imported.ok) throw new Error(imported.error.message);
        expect(imported.value.inventory_state).toBe("partial");
        expect(
          imported.value.entries.filter(({ path }) => path === blocked),
        ).toEqual([
          expect.objectContaining({
            kind: "directory",
            tree_state: "unreadable",
            limitations: [expect.any(String)],
          }),
        ]);
        expect(
          imported.value.entries.find(({ path }) => path === "main.ts"),
        ).toMatchObject({ content_state: "hashed" });
      } finally {
        await chmod(deniedPath, 0o700);
      }
    },
  );

  it.skipIf(permissionChecksUnavailable)(
    "keeps links into an unreadable subtree uncertain while preserving readable siblings",
    async () => {
      const root = await createTestTempDirectory("rea-source-unreadable-link-");
      const hidden = join(root, "hidden");
      await mkdir(hidden);
      await writeFile(join(root, "visible.txt"), "visible\n");
      await writeFile(join(hidden, "target.txt"), "target\n");
      await symlink("hidden/target.txt", join(root, "alias.txt"));
      await chmod(hidden, 0o111);
      try {
        const read = await readReferenceSource(root);
        if (!read.ok) throw new Error(read.error.message);
        expect(read.value.entries).toContainEqual(
          expect.objectContaining({
            status: "failed",
            kind: "directory",
            path: "hidden",
            code: "io",
          }),
        );
        expect(read.value.entries).toContainEqual(
          expect.objectContaining({
            status: "failed",
            kind: "symlink",
            path: "alias.txt",
            code: "io",
          }),
        );

        const imported = await importTree(root);
        if (!imported.ok) throw new Error(imported.error.message);
        expect(imported.value.inventory_state).toBe("partial");
        expect(imported.value.entries).toContainEqual(
          expect.objectContaining({
            path: "visible.txt",
            kind: "file",
            content_state: "hashed",
          }),
        );
        expect(imported.value.entries).toContainEqual(
          expect.objectContaining({
            path: "alias.txt",
            kind: "symlink",
            target: null,
            target_state: "unreadable",
            limitations: [expect.stringContaining('"hidden/target.txt"')],
          }),
        );
      } finally {
        await chmod(hidden, 0o700);
      }
    },
  );

  it("keeps readable and empty directories enumerated exactly once", async () => {
    const root = await createTestTempDirectory("rea-source-readable-dirs-");
    await mkdir(join(root, "src", "empty"), { recursive: true });
    await writeFile(join(root, "src", "main.ts"), "export const value = 1;\n");
    const imported = await importTree(root);
    if (!imported.ok) throw new Error(imported.error.message);
    for (const path of ["src", "src/empty"]) {
      expect(
        imported.value.entries.filter((entry) => entry.path === path),
      ).toEqual([
        expect.objectContaining({
          kind: "directory",
          tree_state: "enumerated",
          limitations: [],
        }),
      ]);
    }
  });
});
