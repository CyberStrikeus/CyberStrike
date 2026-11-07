import { expect, it } from "vitest";
import {
  assertSelectedMachoSlice,
  resolveSelectedMachoSlice,
} from "./NativeMachoSelectedSlice.js";
import { parseLipoOutput } from "./parsers/lipo.js";
import type { MachoCommandNames } from "./MachoCommandNames.js";

it("binds the lipo row to one FAT entry and its selected thin header", async () => {
  const bytes = Buffer.alloc(256);
  bytes.writeUInt32BE(0xcafebabe, 0);
  bytes.writeUInt32BE(2, 4);
  for (const [index, subtype, offset] of [
    [0, 1, 64],
    [1, 0, 128],
  ] as const) {
    const at = 8 + index * 20;
    bytes.writeUInt32BE(0x0100000c, at);
    bytes.writeUInt32BE(subtype, at + 4);
    bytes.writeUInt32BE(offset, at + 8);
    bytes.writeUInt32BE(64, at + 12);
    bytes.writeUInt32BE(4, at + 16);
  }
  const lipo = parseLipoOutput(
    `Fat header in: /fixture\nfat_magic 0xcafebabe\nnfat_arch 2\narchitecture arm64v8\ncputype CPU_TYPE_ARM64\ncpusubtype CPU_SUBTYPE_ARM64_V8\noffset 64\nsize 64\nalign 2^4\narchitecture arm64\ncputype CPU_TYPE_ARM64\ncpusubtype CPU_SUBTYPE_ARM64_ALL\noffset 128\nsize 64\nalign 2^4\n`,
    "/fixture",
  );
  const source = {
    bytes: bytes.length,
    readSlice: async (
      _start: number,
      _size: number,
      offset: number,
      length: number,
    ) => bytes.subarray(offset, offset + length),
  };
  const binary: MachoCommandNames = {
    sliceSize: 64,
    header: {
      wide: true,
      littleEndian: true,
      cpuType: 0x0100000c,
      cpuSubtype: 0,
      fileType: 2,
      flags: 0,
    },
    commands: [],
  };
  const selected = lipo.architectures[1]!;
  const resolved = await resolveSelectedMachoSlice(source, selected, 2);
  expect(() =>
    assertSelectedMachoSlice(source, resolved, binary),
  ).not.toThrow();
  expect(() =>
    assertSelectedMachoSlice(source, resolved, {
      ...binary,
      header: { ...binary.header, cpuSubtype: 1 },
    }),
  ).toThrow("disagrees");
  await expect(resolveSelectedMachoSlice(source, selected, 1)).rejects.toThrow(
    "records exceed",
  );
  const missingRange = { ...selected, file_offset: null, size: null };
  await expect(
    resolveSelectedMachoSlice(source, missingRange, 2),
  ).resolves.toMatchObject({ offset: 128, size: 64 });
  await expect(
    resolveSelectedMachoSlice(source, { ...missingRange, file_offset: 64 }, 2),
  ).rejects.toThrow("exactly one FAT entry");
  await expect(
    resolveSelectedMachoSlice(
      source,
      { ...missingRange, cpu_type_code: null },
      2,
    ),
  ).rejects.toThrow("CPU identity is unavailable");
  bytes.writeUInt32BE(0, 12);
  await expect(
    resolveSelectedMachoSlice(source, missingRange, 2),
  ).rejects.toThrow("exactly one FAT entry");
  bytes.writeUInt32BE(1, 12);
  bytes.writeUInt32BE(128, 16);
  await expect(
    resolveSelectedMachoSlice(source, selected, 2),
  ).rejects.toThrow();
});
