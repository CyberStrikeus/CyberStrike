import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect, it } from "vitest";

import { writeOrderedZip } from "../../fixtures/artifactEntryOrder.js";
import { inventoryArtifact } from "../../fixtures/artifactInventory.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import type { ArtifactEntry } from "../../../src/artifacts/ArtifactReader.js";
import { ZipArtifactReader } from "../../../src/artifacts/ZipArtifactReader.js";

it("retains distinct occurrences when ZIP paths normalize to the same child", async () => {
  const root = await createTestTempDirectory("rea-zip-relative-duplicates-");
  const path = join(root, "duplicates.zip");
  await writeOrderedZip(path, ["./data.txt", "data.txt"]);

  const inventory = await inventoryArtifact(path);
  const occurrences = inventory.occurrences.filter(
    ({ logical_path }) => logical_path === "data.txt",
  );
  expect(occurrences).toHaveLength(2);
  expect(
    new Set(occurrences.map(({ occurrence_id }) => occurrence_id)).size,
  ).toBe(2);
  expect(occurrences).toContainEqual(
    expect.objectContaining({
      logical_path: "data.txt",
      limitations: [
        'ZIP member name "./data.txt" has a leading current-directory prefix omitted from its logical path.',
      ],
    }),
  );
});

it.each([".", "././."])(
  "rejects a non-directory ZIP entry spelled %s instead of skipping it as a root marker",
  async (name) => {
    const root = await createTestTempDirectory("rea-zip-root-file-");
    const path = join(root, "root-file.zip");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add(name, new TextReader("not a directory"));
    await writeFile(path, await writer.close());

    await expect(inventoryArtifact(path)).rejects.toMatchObject({
      name: "ArtifactReaderFailure",
      reason: "path",
    });
  },
);

it.each([
  { sourcePath: ".", path: "." },
  { sourcePath: "./", path: "" },
])(
  "does not skip a ZIP symlink spelled $sourcePath",
  async ({ sourcePath, path: logicalPath }) => {
    const root = await createTestTempDirectory("rea-zip-root-symlink-");
    const path = join(root, "root-symlink.zip");
    // Retain the Unix symlink mode even when the filename has a directory slash.
    const writer = new ZipWriter(new Uint8ArrayWriter(), {
      msDosCompatible: false,
      versionMadeBy: 0x0314,
      externalFileAttributes: 0o120777 * 0x10000,
    });
    await writer.add(sourcePath, new TextReader("target"));
    await writeFile(path, await writer.close());

    const reader = new ZipArtifactReader(path, "zip");
    try {
      const entries: ArtifactEntry[] = [];
      for await (const entry of reader.entries()) entries.push(entry);
      expect(entries).toMatchObject([
        { path: logicalPath, kind: "symlink", declaredSize: 6 },
      ]);
    } finally {
      await reader.close();
    }
  },
);

it("rejects traversal after removing harmless leading current-directory prefixes", async () => {
  const root = await createTestTempDirectory("rea-zip-relative-traversal-");
  const path = join(root, "traversal.zip");
  await writeOrderedZip(path, ["./../escape.txt"]);

  await expect(inventoryArtifact(path)).rejects.toMatchObject({
    name: "ArtifactReaderFailure",
    reason: "path",
    message: 'Artifact path is not normalized: "../escape.txt"',
  });
});
