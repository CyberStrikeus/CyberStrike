import { fstatSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  symlink,
  lstat,
  open,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { hashFile } from "./FilesystemSnapshot.js";
import { ProcessCaptureReadFailure } from "./ProcessCaptureRead.js";

const countOpenDescriptorsFor = async (path: string): Promise<number> => {
  const directory = process.platform === "linux" ? "/proc/self/fd" : "/dev/fd";
  const expected = await lstat(path);
  const descriptors = await readdir(directory);
  const matches = await Promise.all(
    descriptors.map(async (descriptor) => {
      if (!/^\d+$/u.test(descriptor)) return false;
      try {
        const stats = fstatSync(Number(descriptor));
        return stats.dev === expected.dev && stats.ino === expected.ino;
      } catch (cause: unknown) {
        if (cause instanceof Error && "code" in cause && cause.code === "EBADF")
          return false;
        throw cause;
      }
    }),
  );
  return matches.filter(Boolean).length;
};

it.skipIf(process.platform === "win32")(
  "omits a captured regular file replaced by a symlink",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "rea-snapshot-symlink-"));
    const selected = join(directory, "selected");
    const replacement = join(directory, "replacement");
    try {
      await writeFile(selected, "captured bytes");
      await writeFile(replacement, "unselected bytes");
      const expected = await lstat(selected);
      await rm(selected);
      await symlink(replacement, selected);
      const outcome = await hashFile(selected, expected, 1_000);
      expect(outcome.state).toBe("omitted");
      expect(outcome).not.toHaveProperty("sha256");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it("does not hash a replacement file using the earlier path metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-snapshot-identity-"));
  const path = join(directory, "observed-file");
  try {
    await writeFile(path, "captured file\n");
    const expected = await lstat(path);
    await rm(path);
    await writeFile(path, "replacement with a different identity and size\n");

    await expect(hashFile(path, expected, 1_000)).resolves.toEqual({
      state: "omitted",
      reason: "file_changed_or_short_read",
      system_code: null,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects a same-size rewrite even when its modification time is restored", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-snapshot-ctime-"));
  const path = join(directory, "observed-file");
  try {
    const fixedMtime = new Date("2020-01-02T03:04:05.000Z");
    await writeFile(path, "before\n");
    await utimes(path, fixedMtime, fixedMtime);
    const expected = await lstat(path);
    await expect
      .poll(async () => {
        await writeFile(path, "after!\n");
        await utimes(path, fixedMtime, fixedMtime);
        return (await lstat(path)).ctimeMs;
      })
      .not.toBe(expected.ctimeMs);
    const rewritten = await lstat(path);

    expect(rewritten).toMatchObject({
      dev: expected.dev,
      ino: expected.ino,
      mode: expected.mode,
      size: expected.size,
      mtimeMs: expected.mtimeMs,
    });
    expect(rewritten.ctimeMs).not.toBe(expected.ctimeMs);

    await expect(hashFile(path, expected, 1_000)).resolves.toMatchObject({
      state: "omitted",
      reason: "file_changed_or_short_read",
      system_code: null,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("reports a file removed between metadata observation and open", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-snapshot-open-race-"));
  const path = join(directory, "observed-file");
  try {
    await writeFile(path, "captured file\n");
    const expected = await lstat(path);
    await rm(path);

    await expect(hashFile(path, expected, 1_000)).resolves.toEqual({
      state: "omitted",
      reason: "file_unavailable",
      system_code: "ENOENT",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects cancellation for an empty file before returning its digest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-snapshot-empty-cancel-"));
  const path = join(directory, "observed-file");
  try {
    await writeFile(path, "");
    const expected = await lstat(path);
    const controller = new AbortController();
    controller.abort();

    await expect(
      hashFile(path, expected, 1_000, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")(
  "closes the opened file when cancellation arrives during open",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "rea-snapshot-cancel-"));
    const path = join(directory, "observed-file");
    try {
      await writeFile(path, "captured file\n");
      const expected = await lstat(path);
      const controller = new AbortController();
      const held = await open(path, "r");
      expect(await countOpenDescriptorsFor(path)).toBe(1);
      await held.close();
      expect(await countOpenDescriptorsFor(path)).toBe(0);
      const hashing = hashFile(path, expected, 1_000, controller.signal);
      // hashFile reaches `open` synchronously before its first suspension, so
      // this abort is observed after the descriptor is acquired and is handled
      // by the `finally` close path.
      const reason = Object.assign(new Error("cancelled while opening"), {
        code: "EACCES",
      });
      controller.abort(reason);

      let failure: unknown;
      try {
        await hashing;
      } catch (cause: unknown) {
        failure = cause;
      }
      expect(failure).toBeInstanceOf(ProcessCaptureReadFailure);
      expect(failure).toMatchObject({
        cause: reason,
        userCategory: "cancelled",
        outcome: { kind: "failed" },
      });
      expect(await countOpenDescriptorsFor(path)).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

for (const variant of [
  "unchanged",
  "case-alias",
  "ancestor-junction",
  "replaced-junction",
] as const) {
  it.runIf(process.platform === "win32")(
    `hashes only the captured Windows file through ${variant}`,
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "rea-snapshot-windows-"));
      try {
        const original = join(directory, "original");
        const replacement = join(directory, "replacement");
        await mkdir(original);
        await mkdir(replacement);
        await writeFile(join(original, "TestFile.txt"), "captured bytes");
        await writeFile(join(replacement, "TestFile.txt"), "replaced bytes");
        const alias = join(directory, "alias");
        if (variant === "ancestor-junction" || variant === "replaced-junction")
          await symlink(original, alias, "junction");
        const path = join(
          variant.includes("junction") ? alias : original,
          variant === "case-alias" ? "testfile.txt" : "TestFile.txt",
        );
        const expected = await lstat(path);
        if (variant === "replaced-junction") {
          await rm(alias);
          await symlink(replacement, alias, "junction");
        }
        const result = await hashFile(path, expected, 1_000);
        expect(result.state).toBe(
          variant === "replaced-junction" ? "omitted" : "hashed",
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
