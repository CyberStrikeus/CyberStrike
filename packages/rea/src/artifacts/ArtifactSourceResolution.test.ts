import { lstat, mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { openRegularFile } from "../filesystem/RegularFile.js";
import { assertArtifactFileSelectedSource } from "./ArtifactFileSource.js";
import { assertArtifactSelectedSource } from "./ArtifactSelectedSource.js";
import { readStableArtifact } from "./readStableArtifact.js";
import { DirectoryArtifactReader } from "./DirectoryArtifactReader.js";

it.skipIf(process.platform === "win32")(
  "admits a caller-selected directory symlink without changing its target identity",
  async () => {
    const root = await createTestTempDirectory("rea-directory-selection-");
    const directory = join(root, "directory");
    const selected = join(root, "selected");
    await mkdir(directory);
    await symlink(directory, selected);
    const reader = new DirectoryArtifactReader(selected);
    try {
      const metadata = await lstat(directory, { bigint: true });
      await expect(reader.rootObservation()).resolves.toMatchObject({
        identity: { dev: metadata.dev, ino: metadata.ino },
      });
    } finally {
      await reader.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "rejects a directory selection that traverses through a regular file",
  async () => {
    const root = await createTestTempDirectory("rea-directory-resolution-");
    await writeFile(join(root, "file"), "carrier");
    const reader = new DirectoryArtifactReader(`${root}/file/..`);
    try {
      await expect(reader.rootObservation()).rejects.toMatchObject({
        reason: "io",
        cause: { code: "ENOTDIR" },
      });
    } finally {
      await reader.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "reports a replaced ancestor symlink loop as a changed admitted source",
  async () => {
    const root = await createTestTempDirectory("rea-source-resolution-");
    const parent = join(root, "selected");
    await mkdir(parent);
    const path = join(parent, "carrier.bin");
    await writeFile(path, "carrier");
    const source = await openRegularFile(path, { symlinks: "reject" });
    try {
      await rename(parent, join(root, "original"));
      await symlink("selected", parent);
      await expect(
        assertArtifactFileSelectedSource(path, source, "Carrier"),
      ).rejects.toMatchObject({
        reason: "integrity",
        cause: { code: "ELOOP" },
      });
    } finally {
      await source.handle.close();
    }
  },
);

it.skipIf(process.platform !== "linux" && process.platform !== "darwin")(
  "retains a name-too-long resolution failure as an invalidated selection",
  async () => {
    const path = join("/", "x".repeat(16384));
    await expect(
      assertArtifactSelectedSource("/admitted", path),
    ).rejects.toMatchObject({
      reason: "integrity",
      cause: { code: "ENAMETOOLONG" },
    });
  },
);

it.each(["ENOENT", "ENOTDIR", "ELOOP", "ENAMETOOLONG", "EACCES", "EIO"])(
  "preserves %s meaning when a stable snapshot cannot open its admitted name",
  async (code) => {
    const root = await createTestTempDirectory("rea-stable-resolution-");
    const path = join(root, "carrier.bin");
    await writeFile(path, "carrier");
    const failure = Object.assign(new Error("injected open failure"), { code });
    const result = readStableArtifact(path, 1024, undefined, {
      lstat: (selected) => lstat(selected, { bigint: true }),
      open: async () => {
        throw failure;
      },
    });
    if (code === "EACCES" || code === "EIO")
      await expect(result).rejects.toBe(failure);
    else
      await expect(result).rejects.toMatchObject({
        reason: "integrity",
        cause: failure,
      });
  },
);
