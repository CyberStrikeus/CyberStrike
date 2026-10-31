import { expect, it, vi } from "vitest";
import type { PathLike } from "node:fs";

const race = vi.hoisted(() => ({
  path: "",
  beforeReadlink: undefined as (() => Promise<void>) | undefined,
  actualErrno: undefined as string | undefined,
  directory: "",
  afterDirectoryClose: undefined as (() => Promise<void>) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...filesystem,
    opendir: async (...args: Parameters<typeof filesystem.opendir>) => {
      const directory = await filesystem.opendir(...args);
      if (String(args[0]) === race.directory) {
        const closing: { close(): Promise<void> } = directory;
        const close = closing.close.bind(directory);
        vi.spyOn(closing, "close").mockImplementation(async () => {
          await close();
          const hook = race.afterDirectoryClose;
          race.afterDirectoryClose = undefined;
          await hook?.();
        });
      }
      return directory;
    },
    readlink: async (
      path: PathLike,
      ...args: Parameters<typeof filesystem.readlink> extends [
        PathLike,
        ...infer R,
      ]
        ? R
        : never
    ) => {
      if (String(path) === race.path && race.beforeReadlink !== undefined) {
        const beforeReadlink = race.beforeReadlink;
        race.beforeReadlink = undefined;
        await beforeReadlink();
      }
      try {
        return await filesystem.readlink(path, ...args);
      } catch (cause: unknown) {
        if (String(path) === race.path && cause instanceof Error)
          race.actualErrno = Reflect.get(cause, "code");
        throw cause;
      }
    },
  };
});

import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import { importReferenceSource } from "../../src/application/ReferenceSourceImport.js";
import { readReferenceSource } from "../../src/reference/ReferenceSourceReader.js";

it.skipIf(process.platform === "win32").each(["reader", "import"] as const)(
  "keeps sibling observations through %s when a symlink becomes a regular file before readlink",
  async (operation) => {
    const root = await createTestTempDirectory("rea-reference-symlink-race-");
    await mkdir(join(root, "nested"));
    const linkPath = join(root, "nested", "link");
    const siblingPath = join(root, "sibling.txt");
    await symlink("missing-target", linkPath);
    await writeFile(siblingPath, "sibling remains observable");
    race.path = linkPath;
    race.actualErrno = undefined;
    race.beforeReadlink = async () => {
      await unlink(linkPath);
      await writeFile(linkPath, "replacement regular file");
    };

    const resources = new ArtifactResourceScope();
    let read: Awaited<ReturnType<typeof readReferenceSource>> | undefined;
    let imported: Awaited<ReturnType<typeof importReferenceSource>> | undefined;
    let thrown: unknown;
    try {
      if (operation === "reader")
        read = await readReferenceSource(root, resources);
      else
        imported = await importReferenceSource(
          {
            root,
            caller: "symlink-replacement-test",
            policy: { secretPatterns: [] },
          },
          resources,
        );
    } catch (cause: unknown) {
      thrown = cause;
    } finally {
      race.path = "";
      race.beforeReadlink = undefined;
      await resources.close();
    }

    // The hook establishes scheduling; this assertion verifies the host's real
    // readlink syscall reports the replacement as EINVAL.
    expect(race.actualErrno).toBe("EINVAL");
    expect(thrown).toBeUndefined();
    expect(read?.ok ?? imported?.ok, JSON.stringify(imported)).toBe(true);
    if (imported?.ok) {
      expect(imported.value.inventory_state).toBe("partial");
      expect(imported.value.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "nested/link",
            kind: "symlink",
            target: null,
            target_state: "unreadable",
          }),
          expect.objectContaining({
            path: "sibling.txt",
            kind: "file",
            content_state: "hashed",
            sha256: expect.any(String),
          }),
        ]),
      );
      expect(
        imported.value.entries
          .find(({ path }) => path === "nested/link")
          ?.limitations.join(" "),
      ).toContain("Symbolic link changed");
    }
    if (!read?.ok) return;
    expect(read.value.rootFailure).toBeUndefined();
    expect(read.value.entries.some(({ path }) => path === ".")).toBe(false);
    expect(read.value.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          kind: "symlink",
          path: "nested/link",
          code: "changed",
        }),
        expect.objectContaining({
          status: "read",
          kind: "file",
          path: "sibling.txt",
        }),
      ]),
    );
  },
);

it.skipIf(process.platform === "win32").each(["contents", "root"] as const)(
  "retains observed entries when %s changes after its directory handle closes",
  async (changed) => {
    const parent = await createTestTempDirectory("rea-reference-root-race-");
    const root = join(parent, "observed");
    await mkdir(root);
    const source = join(root, "source.txt");
    await writeFile(source, "already observed source");
    race.directory = root;
    race.afterDirectoryClose = () =>
      changed === "contents"
        ? rename(source, join(root, "renamed.txt"))
        : rename(root, join(parent, "moved"));
    const resources = new ArtifactResourceScope();
    let imported: Awaited<ReturnType<typeof importReferenceSource>>;
    try {
      imported = await importReferenceSource(
        {
          root,
          caller: "root-revalidation-test",
          policy: { secretPatterns: [] },
        },
        resources,
      );
    } finally {
      race.directory = "";
      race.afterDirectoryClose = undefined;
      await resources.close();
    }
    const retainedPath =
      changed === "contents"
        ? join(root, "renamed.txt")
        : join(parent, "moved", "source.txt");
    expect(await readFile(retainedPath, "utf8")).toBe(
      "already observed source",
    );
    await expect(readFile(source)).rejects.toMatchObject({ code: "ENOENT" });
    if (changed === "root") {
      expect(imported).toMatchObject({
        ok: false,
        error: {
          code: "io",
          message: expect.stringContaining(
            "Directory identity could not be verified: ENOENT",
          ),
          partial: {
            entries: [{ status: "read", kind: "file", path: "source.txt" }],
            bytesRead: Buffer.byteLength("already observed source"),
          },
        },
      });
      return;
    }
    expect(imported.ok, JSON.stringify(imported)).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.inventory_state).toBe("partial");
    expect(imported.value.limitations).toContainEqual(
      expect.stringContaining(
        "Reference root enumeration is incomplete: Reference root changed",
      ),
    );
    expect(imported.value.entries).toEqual([
      expect.objectContaining({
        path: "source.txt",
        kind: "file",
        content_state: "hashed",
      }),
    ]);
  },
);
