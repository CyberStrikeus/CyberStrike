import { readFile, symlink } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    constants: { ...original.constants, O_NOFOLLOW: 0 },
  };
});

import { openRegularFile } from "../../src/filesystem/RegularFile.js";
import { ZipArtifactReader } from "../../src/artifacts/ZipArtifactReader.js";
import { writeOrderedZip } from "../fixtures/artifactEntryOrder.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

it("rejects a symlink when O_NOFOLLOW is unavailable and still follows when requested", async () => {
  const root = await createTestTempDirectory("rea-no-nofollow-");
  const target = join(root, "target.zip");
  const link = join(root, "selected.zip");
  await writeOrderedZip(target, ["member.bin"]);
  await symlink(target, link);

  const reader = new ZipArtifactReader(target, "zip");
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    expect(entries.map(({ path }) => path)).toEqual(["member.bin"]);
  } finally {
    await reader.close();
  }

  const linkedReader = new ZipArtifactReader(link, "zip");
  try {
    await expect(async () => {
      for await (const _entry of linkedReader.entries()) {
        // Consume through the public reader boundary.
      }
    }).rejects.toMatchObject({
      name: "ArtifactReaderFailure",
      reason: "format",
    });
  } finally {
    await linkedReader.close();
  }

  const { handle: followed } = await openRegularFile(link, {
    symlinks: "follow",
  });
  try {
    expect(
      Buffer.compare(await readFile(followed), await readFile(target)),
    ).toBe(0);
  } finally {
    await followed.close();
  }
});
