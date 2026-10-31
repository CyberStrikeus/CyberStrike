import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import { classifyArtifactBytesAtPath } from "../../fixtures/artifactClassification.js";
import { ARTIFACT_CLASSIFICATION_PREFIX_BYTES } from "../../../src/artifacts/ArtifactClassificationProbe.js";
import {
  inventoryArtifact,
  scanCanonicalArtifactInventory,
} from "../../fixtures/artifactInventory.js";
import { artifactInventoryResultSchema } from "../../../src/domain/artifactGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe("MZ artifact classification", () => {
  it("rejects a Windows header pointer overlapping the DOS header", () => {
    expect(classifyArtifactBytesAtPath("invalid.exe", peFixture(32))).toEqual({
      kind: "unknown",
      format: "unknown",
    });
  });

  it("distinguishes DOS, observed PE, malformed MZ and unavailable prefix evidence", () => {
    const dos = dosFixture();
    expect(classifyArtifactBytesAtPath("LEGACY.EXE", dos)).toEqual({
      kind: "executable",
      format: "dos-mz",
    });
    expect(
      classifyArtifactBytesAtPath(
        "LEGACY.EXE",
        dos.subarray(0, 16),
        dos.length,
      ),
    ).toEqual({ kind: "unknown", format: "unknown" });
    expect(
      classifyArtifactBytesAtPath("bad.exe", Buffer.from("MZbroken")),
    ).toEqual({ kind: "unknown", format: "unknown" });
    const distantPe = peFixture(ARTIFACT_CLASSIFICATION_PREFIX_BYTES + 64);
    expect(
      classifyArtifactBytesAtPath(
        "NATIVE.EXE",
        distantPe.subarray(0, ARTIFACT_CLASSIFICATION_PREFIX_BYTES),
        distantPe.length,
      ),
    ).toEqual({ kind: "unknown", format: "unknown" });
    expect(classifyArtifactBytesAtPath("NATIVE.EXE", distantPe).format).toBe(
      "pe",
    );
    const distantRelocations = dosWithDistantRelocations();
    expect(
      classifyArtifactBytesAtPath("LEGACY.EXE", distantRelocations).format,
    ).toBe("dos-mz");
    expect(
      classifyArtifactBytesAtPath(
        "LEGACY.EXE",
        distantRelocations.subarray(0, ARTIFACT_CLASSIFICATION_PREFIX_BYTES),
        distantRelocations.length,
      ).format,
    ).toBe("unknown");
  });

  it("keeps standalone and embedded DOS identities through inventory", async () => {
    const directory = await createTestTempDirectory("rea-mz-inventory-");
    const dosPath = join(directory, "LEGACY.EXE");
    const pePath = join(directory, "NATIVE.EXE");
    await writeFile(dosPath, dosFixture());
    await writeFile(pePath, peFixture(128));
    const standalone = artifactInventoryResultSchema.parse(
      await scanCanonicalArtifactInventory(dosPath),
    );
    expect(standalone.manifest.root_format).toBe("dos-mz");
    expect(standalone.nodes).toContainEqual(
      expect.objectContaining({ format: "dos-mz" }),
    );

    const tree = join(directory, "tree");
    await mkdir(tree);
    await writeFile(join(tree, "LEGACY.EXE"), dosFixture());
    await writeFile(join(tree, "NATIVE.EXE"), peFixture(128));
    const inventory = artifactInventoryResultSchema.parse(
      await scanCanonicalArtifactInventory(tree),
    );
    expect(inventory.nodes.map(({ format }) => format)).toEqual(
      expect.arrayContaining(["dos-mz", "pe"]),
    );
  });

  it("retains a PE signature straddling the bounded prefix in ZIP member evidence", async () => {
    const root = await createTestTempDirectory("rea-mz-far-pe-");
    const bytes = peFixture(ARTIFACT_CLASSIFICATION_PREFIX_BYTES - 2);
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("native.exe", new Uint8ArrayReader(bytes), { level: 0 });
    const path = join(root, "fixture.zip");
    await writeFile(path, Buffer.from(await writer.close()));

    const inventory = await inventoryArtifact(path);
    const occurrence = inventory.occurrences.find(
      ({ logical_path }) => logical_path === "native.exe",
    );
    expect(occurrence).toMatchObject({
      artifact_format: "pe",
      hash_status: "verified",
    });
    expect(
      inventory.nodes.find(
        ({ artifact_id }) => artifact_id === occurrence?.artifact_id,
      ),
    ).toMatchObject({ format: "pe", size: bytes.length });
    expect(inventory.coverage.status).toBe("complete");
  });
});

const dosFixture = (): Buffer => {
  const bytes = Buffer.alloc(512);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt16LE(1, 4);
  bytes.writeUInt16LE(2, 8);
  bytes.writeUInt16LE(28, 24);
  return bytes;
};

const peFixture = (offset: number): Buffer => {
  const bytes = Buffer.alloc(Math.max(512, offset + 24));
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt16LE(4, 8);
  bytes.writeUInt16LE(64, 24);
  bytes.writeUInt32LE(offset, 60);
  bytes.set([0x50, 0x45, 0, 0], offset);
  return bytes;
};

const dosWithDistantRelocations = (): Buffer => {
  const bytes = Buffer.alloc(16_384);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt16LE(32, 4);
  bytes.writeUInt16LE(1, 6);
  bytes.writeUInt16LE(768, 8);
  bytes.writeUInt16LE(ARTIFACT_CLASSIFICATION_PREFIX_BYTES + 2, 24);
  return bytes;
};
