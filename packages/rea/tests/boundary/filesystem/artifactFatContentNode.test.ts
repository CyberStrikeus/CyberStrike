import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect, it } from "vitest";

import { inventoryArtifact } from "../../fixtures/artifactInventory.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { buildGodotPck } from "../../fixtures/godotPck.js";

const fatMachO = (sliceOffset: number): Buffer => {
  const thin = Buffer.alloc(48);
  thin.writeUInt32LE(0xfeedfacf, 0);
  thin.writeUInt32LE(0x0100000c, 4);
  thin.writeUInt32LE(0, 8);
  thin.writeUInt32LE(2, 12);

  const bytes = Buffer.alloc(sliceOffset + thin.length);
  bytes.writeUInt32BE(0xcafebabe, 0);
  bytes.writeUInt32BE(1, 4);
  bytes.writeUInt32BE(0x0100000c, 8);
  bytes.writeUInt32BE(0, 12);
  bytes.writeUInt32BE(sliceOffset, 16);
  bytes.writeUInt32BE(thin.length, 20);
  bytes.writeUInt32BE(Math.log2(sliceOffset), 24);
  thin.copy(bytes, sliceOffset);
  return bytes;
};

const zipWithMember = async (bytes: Buffer): Promise<Buffer> => {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("native.fat", new Uint8ArrayReader(bytes), { level: 0 });
  return Buffer.from(await writer.close());
};

for (const sliceOffset of [4_096, 16_384]) {
  for (const container of ["zip", "pck"] as const) {
    it(`retains a FAT slice header at offset ${sliceOffset} in ${container} member nodes`, async () => {
      const root = await createTestTempDirectory("rea-fat-member-node-");
      const bytes = fatMachO(sliceOffset);
      const directPath = join(root, "direct.fat");
      await writeFile(directPath, bytes);
      const direct = await inventoryArtifact(directPath);
      const directNode = direct.nodes.find(
        ({ artifact_id }) => artifact_id === direct.manifest.root_artifact_id,
      );
      expect(directNode?.format).toBe("mach-o-universal");

      const containerPath = join(root, `fixture.${container}`);
      await writeFile(
        containerPath,
        container === "zip"
          ? await zipWithMember(bytes)
          : buildGodotPck(3, [{ path: "native.fat", data: bytes }]),
      );
      const inventory = await inventoryArtifact(containerPath);
      const occurrence = inventory.occurrences.find(
        ({ logical_path }) => logical_path === "native.fat",
      );
      expect(occurrence).toMatchObject({
        artifact_format: "mach-o-universal",
        hash_status: "verified",
        artifact_id: direct.manifest.root_artifact_id,
      });
      const node = inventory.nodes.find(
        ({ artifact_id }) => artifact_id === occurrence?.artifact_id,
      );
      expect(node).toMatchObject({
        artifact_id: direct.manifest.root_artifact_id,
        sha256: direct.manifest.root_sha256,
        format: "mach-o-universal",
      });
      expect(inventory.coverage).toEqual({
        scope: "container-entries",
        status: "complete",
      });
    });
  }
}
