import { createHash } from "node:crypto";
import { cp, mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPackageWithOptions } from "@electron/asar";
import { expect, it, vi } from "vitest";

import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import { artifactInventoryResultSchema } from "../../../src/domain/artifactGraph.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32")(
  "reopens ASAR clients for another selected companion but reuses the same selection",
  async () => {
    const root = await createTestTempDirectory("rea-session-asar-alias-");
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "payload.bin"), "first");
    const archive = join(root, "canonical.asar");
    const first = join(root, "first.asar");
    const second = join(root, "second.asar");
    await createPackageWithOptions(source, archive, { unpack: "*.bin" });
    await Promise.all([symlink(archive, first), symlink(archive, second)]);
    await cp(`${archive}.unpacked`, `${first}.unpacked`, { recursive: true });
    await cp(`${archive}.unpacked`, `${second}.unpacked`, { recursive: true });
    await writeFile(join(`${second}.unpacked`, "payload.bin"), "other");
    const provider = new ArtifactProvider({});
    const created = vi.spyOn(provider, "createClient");
    const session = createTestBinarySession(provider);
    const inventory = async (selectedPath: string) => {
      const result = await session.execute("inventory_artifact", {
        integrity_policy: "record-and-continue",
      });
      if (!result.ok) throw result.error;
      expect(result.value.subject?.path).toBe(selectedPath);
      return artifactInventoryResultSchema.parse(result.value.result);
    };
    try {
      expect((await session.open(first)).ok).toBe(true);
      const firstInventory = await inventory(first);
      expect((await session.open(first)).ok).toBe(true);
      expect(created).toHaveBeenCalledTimes(1);
      expect((await session.open(second)).ok).toBe(true);
      expect(created).toHaveBeenCalledTimes(2);
      const secondInventory = await inventory(second);
      const payloadDigest = (observed: typeof firstInventory) => {
        const occurrence = observed.occurrences.find(
          ({ logical_path }) => logical_path === "payload.bin",
        );
        return observed.nodes.find(
          ({ artifact_id }) => artifact_id === occurrence?.artifact_id,
        )?.sha256;
      };
      expect(payloadDigest(firstInventory)).toBe(
        createHash("sha256").update("first").digest("hex"),
      );
      expect(payloadDigest(secondInventory)).toBe(
        createHash("sha256").update("other").digest("hex"),
      );
      expect(secondInventory.integrity_contradictions).toHaveLength(1);
      const replacement = join(root, "replacement.asar");
      await writeFile(join(source, "packed.txt"), "different archive");
      await createPackageWithOptions(source, replacement, { unpack: "*.bin" });
      await unlink(second);
      await symlink(replacement, second);
      const retargeted = await session.execute("inventory_artifact", {});
      expect(retargeted.ok).toBe(false);
      if (!retargeted.ok)
        expect(retargeted.error).toMatchObject({
          _tag: "ArtifactOperationError",
          reason: "integrity",
          detail: expect.stringContaining(
            "no longer resolves to its admitted source",
          ),
        });
    } finally {
      await session.close();
      created.mockRestore();
    }
  },
);
