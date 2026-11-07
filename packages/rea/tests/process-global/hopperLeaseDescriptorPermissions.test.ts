import { chmod, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

const replacement = vi.hoisted(() => ({
  selected: "",
  retained: "",
  handle: undefined as FileHandle | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      if (args[0] === replacement.selected) {
        replacement.handle = handle;
        try {
          await original.rename(replacement.selected, replacement.retained);
          await original.mkdir(replacement.selected);
          await original.chmod(replacement.selected, 0o755);
        } catch (cause) {
          await handle.close();
          throw cause;
        }
      }
      return handle;
    },
  };
});

import { acquireLinuxHopperApplicationLease } from "../../src/process/HopperLease.js";

afterEach(() => {
  replacement.selected = "";
  replacement.retained = "";
  replacement.handle = undefined;
});

it.skipIf(process.platform === "win32")(
  "secures only the admitted directory descriptor when its path is replaced",
  async () => {
    // macOS limits Unix-domain socket paths to 104 bytes. Keep the selected
    // directory path short enough for the production lease socket beneath it.
    const root = await mkdtemp("/tmp/r-");
    const selected = join(root, "selected");
    const retained = join(root, "retained");
    await mkdir(selected);
    await chmod(selected, 0o755);
    const before = await lstat(selected);
    replacement.selected = selected;
    replacement.retained = retained;
    const acquired = await acquireLinuxHopperApplicationLease({
      directory: selected,
      runId: "descriptor-permissions",
    });
    if (!acquired.acquired) {
      await rm(root, { recursive: true, force: true });
      throw new Error("Expected the fixture lease");
    }
    try {
      expect((await lstat(retained)).ino).toBe(before.ino);
      expect((await lstat(retained)).mode & 0o777).toBe(0o700);
      expect((await lstat(selected)).ino).not.toBe(before.ino);
      expect((await lstat(selected)).mode & 0o777).toBe(0o755);
      await expect(replacement.handle?.stat()).rejects.toMatchObject({
        code: "EBADF",
      });
    } finally {
      await acquired.lease.release();
      await rm(root, { recursive: true, force: true });
    }
    // This asserts descriptor permission ownership only. Later socket
    // operations still resolve the path, as the production comment states.
  },
);
