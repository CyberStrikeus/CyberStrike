import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ElectronFuseService } from "../application/electron/ElectronFuseService.js";
import { electronFuseReportSchema } from "../domain/electron/electronFuses.js";
import { ElectronFuseProvider } from "./ElectronFuseProvider.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import {
  elfHeaderFuseImage,
  peHeaderFuseImage,
  OBSIDIAN_FUSE_BYTES,
} from "../../tests/fixtures/electron/fuseImage.js";

it.each([
  [3, 32, "x86"],
  [62, 64, "x86_64"],
  [40, 32, "arm"],
  [183, 64, "arm64"],
  [8, 32, "mips"],
  [8, 64, "mips"],
  [20, 32, "powerpc"],
  [243, 64, "riscv"],
  [0xfffe, 64, null],
] as const)(
  "preserves ELF machine %i (%i-bit) and its fuse bytes in both byte orders",
  async (machine, bits, architecture) => {
    for (const byteOrder of ["little", "big"] as const) {
      const image = elfHeaderFuseImage(machine, OBSIDIAN_FUSE_BYTES, {
        bits,
        byteOrder,
      });
      await assertArchitecture(image, architecture);
    }
  },
);

it.each([
  [0x14c, "x86"],
  [0x8664, "x86_64"],
  [0x1c0, "arm"],
  [0x1c2, "arm"],
  [0x1c4, "arm"],
  [0xaa64, "arm64"],
  [0x01f0, null],
  [0x8664 ^ 0x7b79, null],
] as const)(
  "preserves PE machine %i without assuming managed OS overrides",
  async (machine, architecture) => {
    await assertArchitecture(
      peHeaderFuseImage(machine, OBSIDIAN_FUSE_BYTES),
      architecture,
    );
  },
);

it("keeps an invalid ELF fixed header unknown without dropping fuse observations", async () => {
  const image = elfHeaderFuseImage(62, OBSIDIAN_FUSE_BYTES);
  image.bytes[6] = 0;
  await assertArchitecture(image, null);
});

it("keeps a truncated COFF header unknown without refusing a recognized PE container", async () => {
  const image = peHeaderFuseImage(0x8664, OBSIDIAN_FUSE_BYTES);
  const bytes = image.bytes.subarray(0, 0x80 + 6);
  const root = await createTestTempDirectory("rea-fuse-coff-truncated-");
  const path = join(root, "selected");
  await writeFile(path, bytes);
  const result = await new ElectronFuseService(
    new ElectronFuseProvider(),
  ).inspect({ path });
  expect(result).toMatchObject({
    ok: true,
    value: {
      subject: { architecture: null },
      normalized_result: {
        slices: [{ architecture: null, sentinel_count: 0 }],
      },
    },
  });
});

it("reads PE machine facts independently of optional-header validity", async () => {
  const image = peHeaderFuseImage(0x8664, OBSIDIAN_FUSE_BYTES);
  image.bytes.writeUInt16LE(0, 0x80 + 24);
  await assertArchitecture(image, "x86_64");
});

const assertArchitecture = async (
  image: { readonly bytes: Buffer; readonly sentinelOffset: number },
  architecture: string | null,
): Promise<void> => {
  const root = await createTestTempDirectory("rea-fuse-architecture-");
  const path = join(root, "selected");
  await writeFile(path, image.bytes);
  const result = await new ElectronFuseService(
    new ElectronFuseProvider(),
  ).inspect({ path });
  if (!result.ok) throw result.error;
  expect(result.value.subject?.architecture).toBe(architecture);
  expect(result.value.subject?.digest.sha256).toBe(
    createHash("sha256").update(image.bytes).digest("hex"),
  );
  expect(result.value.normalized_result).toMatchObject({
    slices: [
      {
        architecture,
        sentinel_count: 1,
        sentinels: [{ sentinel_offset: image.sentinelOffset, complete: true }],
      },
    ],
  });
  const report = electronFuseReportSchema.parse(result.value.normalized_result);
  expect(
    report.slices[0]?.sentinels[0]?.fuses.map((fuse) => fuse.raw_byte),
  ).toEqual(OBSIDIAN_FUSE_BYTES);
  expect(Buffer.compare(await readFile(path), image.bytes)).toBe(0);
};
