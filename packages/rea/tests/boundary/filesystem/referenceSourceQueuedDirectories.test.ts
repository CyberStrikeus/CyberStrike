import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { importReferenceSource } from "../../support/referenceSourceResourceScope.js";

const injectedReadFailure = vi.hoisted(() => ({
  path: undefined as string | undefined,
  error: undefined as Error | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    opendir: async (...args: Parameters<typeof actual.opendir>) => {
      const handle = await actual.opendir(...args);
      const [path] = args;
      const { path: failingPath, error } = injectedReadFailure;
      if (path !== failingPath || error === undefined) return handle;

      const read = handle.read.bind(handle);
      let failureInjected = false;
      Object.defineProperty(handle, "read", {
        configurable: true,
        value: async () => {
          const entry = await read();
          if (entry === null && !failureInjected) {
            failureInjected = true;
            throw error;
          }
          return entry;
        },
      });
      return handle;
    },
  };
});

it.skipIf(process.platform === "win32")(
  "traverses directories lstat-observed before their parent enumeration failed",
  async ({ onTestFinished }) => {
    const root = await createTestTempDirectory(
      "rea-queued-source-directories-",
    );
    const container = join(root, "container");
    const hidden = join(container, "hidden");
    await mkdir(hidden, { recursive: true });
    await writeFile(join(container, "visible.txt"), "visible\n");
    await writeFile(join(hidden, "target.txt"), "target\n");
    await symlink("hidden/target.txt", join(container, "alias-file.txt"));
    await symlink("hidden", join(container, "alias-directory"));

    const readFailure = Object.assign(
      new Error("injected directory read failure"),
      { code: "EIO" },
    );
    injectedReadFailure.path = container;
    injectedReadFailure.error = readFailure;
    onTestFinished(() => {
      injectedReadFailure.path = undefined;
      injectedReadFailure.error = undefined;
    });

    const imported = await importReferenceSource({
      root,
      caller: "queued-directory-read-failure-test",
      policy: { secretPatterns: [] },
    });
    if (!imported.ok) throw new Error(imported.error.message);
    expect(imported.value.inventory_state).toBe("partial");
    expect(imported.value.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "container",
          kind: "directory",
          tree_state: "unreadable",
          limitations: [
            expect.stringContaining("This directory could not be read"),
          ],
          local_diagnostics: [expect.stringContaining(readFailure.message)],
        }),
        expect.objectContaining({
          path: "container/hidden",
          kind: "directory",
          tree_state: "enumerated",
        }),
        expect.objectContaining({
          path: "container/visible.txt",
          kind: "file",
          content_state: "hashed",
        }),
        expect.objectContaining({
          path: "container/hidden/target.txt",
          kind: "file",
          content_state: "hashed",
        }),
        expect.objectContaining({
          path: "container/alias-file.txt",
          kind: "symlink",
          target: "hidden/target.txt",
          target_state: "internal",
        }),
        expect.objectContaining({
          path: "container/alias-directory",
          kind: "symlink",
          target: "hidden",
          target_state: "internal",
        }),
      ]),
    );
  },
);
