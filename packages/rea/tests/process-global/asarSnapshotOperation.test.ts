import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";

import { createPackage } from "@electron/asar";
import { afterEach, expect, it, vi } from "vitest";

import { AsarArtifactReader } from "../../src/artifacts/AsarArtifactReader.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("serializes concurrent ASAR snapshot preparation and cleans its single owned root", async () => {
  const root = await createTestTempDirectory("rea-asar-snapshot-owner-");
  vi.stubEnv("TMPDIR", root);
  vi.stubEnv("TMP", root);
  vi.stubEnv("TEMP", root);

  const source = join(root, "source");
  const archive = join(root, "app.asar");
  await mkdir(source);
  await writeFile(join(source, "main.js"), "module.exports = 42;\n");
  await createPackage(source, archive);

  const reader = new AsarArtifactReader(archive);
  const iterator = reader.entries()[Symbol.asyncIterator]();
  try {
    const expectedDigest = createHash("sha256")
      .update(await readFile(archive))
      .digest("hex");
    const openingContainer = reader.openContainer();
    const readingEntry = iterator.next();
    const preparingSnapshot = reader.prepareContainer(expectedDigest);
    const [snapshot, firstEntry] = await Promise.all([
      openingContainer,
      readingEntry,
      preparingSnapshot,
    ]);
    if (firstEntry.done) throw new Error("Expected an ASAR member");
    expect(
      Buffer.compare(await buffer(snapshot), await readFile(archive)),
    ).toBe(0);

    const mismatch = reader.prepareContainer("0".repeat(64));
    const matching = reader.prepareContainer(expectedDigest);
    await expect(mismatch).rejects.toMatchObject({ reason: "integrity" });
    await expect(matching).resolves.toBeUndefined();

    const snapshotRoots = async (): Promise<string[]> =>
      (await readdir(root)).filter((name) =>
        name.startsWith("rea-asar-snapshot-"),
      );
    expect(await snapshotRoots()).toHaveLength(1);
    await reader.close();
    expect(await snapshotRoots()).toEqual([]);
  } finally {
    try {
      await iterator.return?.();
    } finally {
      await reader.close();
    }
  }
});
