import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import { MachOSliceArtifactReader } from "../../../../src/artifacts/MachOSliceArtifactReader.js";
import { XcrunCommandRunner } from "../../../../src/native/CommandRunner.js";
import { DarwinProcessOwnershipInspectionError } from "../../../../src/process/DarwinProcessRunTokenReader.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

/**
 * Read a 32-bit FAT table directly. The host's /bin/ls changes between macOS
 * releases, so the expected slice layout comes from the file itself.
 */
const fatSlices = async (
  path: string,
): Promise<readonly (readonly [number, number])[]> => {
  const bytes = await readFile(path);
  expect(bytes.readUInt32BE(0)).toBe(0xca_fe_ba_be);
  return Array.from({ length: bytes.readUInt32BE(4) }, (_, index) => {
    const entry = 8 + index * 20;
    return [bytes.readUInt32BE(entry + 8), bytes.readUInt32BE(entry + 12)];
  });
};

describe("Mach-O slice reader with system lipo", () => {
  it("names the process ownership helper prerequisite when lipo cannot be supervised", async () => {
    const prerequisite =
      "Direct Darwin helper compilation requires absolute REA_DARWIN_SWIFTC_PATH and SDKROOT paths.";
    const reader = new MachOSliceArtifactReader(
      process.execPath,
      {},
      new XcrunCommandRunner({}, undefined, () =>
        Promise.reject(new DarwinProcessOwnershipInspectionError(prerequisite)),
      ),
    );
    onTestFinished(() => reader.close());
    const enumerate = async () => {
      for await (const _entry of reader.entries()) continue;
    };
    await expect(enumerate()).rejects.toMatchObject({
      reason: "unavailable",
      message: `lipo could not enumerate universal Mach-O slices: ${prerequisite}`,
    });
  });

  it.skipIf(process.platform !== "darwin")(
    "keeps FAT slice records separate from the echoed source pathname",
    async () => {
      const directory = await createTestTempDirectory("rea-lipo-fat-path-");
      const path = join(
        directory,
        "source\narchitecture forged\n    offset 123\n    size 32",
      );
      const bytes = Buffer.alloc(8224);
      bytes.writeUInt32BE(0xca_fe_ba_be, 0);
      bytes.writeUInt32BE(2, 4);
      const slices = [
        { cpu: 0x0100_000c, subtype: 0, offset: 4096 },
        { cpu: 0x0100_0007, subtype: 3, offset: 8192 },
      ];
      slices.forEach(({ cpu, subtype, offset }, index) => {
        const entry = 8 + index * 20;
        bytes.writeUInt32BE(cpu, entry);
        bytes.writeUInt32BE(subtype, entry + 4);
        bytes.writeUInt32BE(offset, entry + 8);
        bytes.writeUInt32BE(32, entry + 12);
        bytes.writeUInt32BE(12, entry + 16);
        bytes.writeUInt32LE(0xfeed_facf, offset);
        bytes.writeUInt32LE(cpu, offset + 4);
        bytes.writeUInt32LE(subtype, offset + 8);
        bytes.writeUInt32LE(1, offset + 12);
      });
      await writeFile(path, bytes);
      const reader = new MachOSliceArtifactReader(path, {});
      try {
        const entries = [];
        for await (const entry of reader.entries()) entries.push(entry);
        expect(
          entries.map(({ byteOffset, declaredSize }) => [
            byteOffset,
            declaredSize,
          ]),
        ).toEqual([
          [4096, 32],
          [8192, 32],
        ]);
        expect(entries.every(({ path }) => !path.includes("forged"))).toBe(
          true,
        );
      } finally {
        await reader.close();
      }
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "checks real /bin/ls slice ranges against its FAT table",
    async () => {
      const reader = new MachOSliceArtifactReader("/bin/ls", {});
      onTestFinished(() => reader.close());
      const entries = [];
      for await (const entry of reader.entries()) entries.push(entry);
      expect(new Set(entries.map(({ path }) => path)).size).toBe(
        entries.length,
      );
      expect(entries.every(({ path }) => path.startsWith("slices/"))).toBe(
        true,
      );
      expect(
        entries.map(({ byteOffset, declaredSize }) => [
          byteOffset,
          declaredSize,
        ]),
      ).toEqual(await fatSlices("/bin/ls"));
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "inventories a universal binary whose big-endian slice cannot be indexed",
    async () => {
      const directory = await createTestTempDirectory("rea-lipo-ppc-");
      const path = join(directory, "mixed");
      const bytes = Buffer.alloc(8224);
      bytes.writeUInt32BE(0xca_fe_ba_be, 0);
      bytes.writeUInt32BE(2, 4);
      const slices = [
        { cpu: 0x0100_000c, offset: 4096, bigEndian: false },
        { cpu: 18, offset: 8192, bigEndian: true },
      ];
      slices.forEach(({ cpu, offset, bigEndian }, index) => {
        const entry = 8 + index * 20;
        bytes.writeUInt32BE(cpu, entry);
        bytes.writeUInt32BE(offset, entry + 8);
        bytes.writeUInt32BE(32, entry + 12);
        bytes.writeUInt32BE(12, entry + 16);
        const write = (value: number, at: number) =>
          bigEndian
            ? bytes.writeUInt32BE(value, at)
            : bytes.writeUInt32LE(value, at);
        write(cpu === 18 ? 0xfeed_face : 0xfeed_facf, offset);
        write(cpu, offset + 4);
        write(1, offset + 12);
      });
      await writeFile(path, bytes);
      const reader = new MachOSliceArtifactReader(path, {});
      onTestFinished(() => reader.close());
      const entries = [];
      for await (const entry of reader.entries()) entries.push(entry);
      expect(
        entries.map(({ path, byteOffset, declaredSize }) => [
          path,
          byteOffset,
          declaredSize,
        ]),
      ).toEqual([
        ["slices/arm64", 4096, 32],
        ["slices/ppc", 8192, 32],
      ]);
      expect(entries[1]?.limitations).toContain(
        "Structural Mach-O facts were unsupported (big-endian Mach-O slices are not supported); slice range is based on lipo output.",
      );
    },
  );
});
