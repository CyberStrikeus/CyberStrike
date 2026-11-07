import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { BinaryResourceFailure } from "../../../src/native/metadata/BinaryContainer.js";
import { readMachoLoadCommandTableHeader } from "../../../src/domain/apple/machoLoadCommands.js";
import { readBinaryContainer } from "../../../src/native/metadata/readBinaryContainer.js";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { parseExecutableHeader } from "../../../src/domain/binaryTarget.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { BinaryTargetError } from "../../../src/domain/configurationErrors.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  CPU,
  fatImage,
} from "../../../src/artifacts/apple/MachoImage.fixture.js";

const commandImage = (
  wide: boolean,
  littleEndian: boolean,
  sizes: readonly number[],
): Buffer => {
  const magic = wide
    ? littleEndian
      ? 0xcffaedfe
      : 0xfeedfacf
    : littleEndian
      ? 0xcefaedfe
      : 0xfeedface;
  const header = thinMach(magic, wide ? 0x0100000c : 7);
  const bytes = Buffer.alloc(
    header.length + sizes.reduce((total, size) => total + size, 0),
  );
  header.copy(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(16, sizes.length, littleEndian);
  view.setUint32(20, bytes.length - header.length, littleEndian);
  let offset = header.length;
  for (const size of sizes) {
    view.setUint32(offset, 0x7fffffff, littleEndian); // Unknown commands still have framing.
    view.setUint32(offset + 4, size, littleEndian);
    offset += size;
  }
  return bytes;
};

it.each([
  { label: "undersized", field: 36, value: 4 },
  { label: "unaligned", field: 36, value: 12 },
  { label: "outside table", field: 36, value: 0xffffffff },
  { label: "truncated declared table", field: 20, value: 24 },
  { label: "too many commands", field: 16, value: 2 },
  { label: "unclaimed table bytes", field: 16, value: 0 },
  { label: "trailing table bytes", field: 36, value: 8 },
])(
  "rejects $label thin command framing before provider admission",
  async ({ field, value }) => {
    const bytes = commandImage(true, true, [16]);
    bytes.writeUInt32LE(value, field);
    const path = join(
      await createTestTempDirectory("rea-macho-command-"),
      "image",
    );
    await writeFile(path, bytes);
    expect(parseExecutableHeader(bytes, "arm64").ok).toBe(false);
    expect(() => readBinaryContainer(bytes)).toThrow(/load command/iu);
    const resolved = await parseBinaryTarget(path);
    expect(resolved.ok).toBe(false);
    if (resolved.ok || !(resolved.error instanceof BinaryTargetError))
      throw new Error("Expected target format refusal");
    expect(projectAnalysisError(resolved.error)).toMatchObject({
      code: "target_unavailable",
      category: "unsupported_target",
    });
    expect(resolved.error.reason).toMatch(/load command/iu);
  },
);

it.each([
  { wide: false, littleEndian: false, size: 12 },
  { wide: false, littleEndian: true, size: 12 },
  { wide: true, littleEndian: false, size: 16 },
  { wide: true, littleEndian: true, size: 16 },
])(
  "retains width-specific alignment and endian controls ($wide/$littleEndian)",
  async ({ wide, littleEndian, size }) => {
    const bytes = commandImage(wide, littleEndian, [size]);
    const path = join(
      await createTestTempDirectory("rea-macho-command-control-"),
      "image",
    );
    await writeFile(path, bytes);
    expect(readBinaryContainer(bytes)).toMatchObject({
      format: "macho",
      bits: wide ? 64 : 32,
      byte_order: littleEndian ? "little" : "big",
    });
    expect(await parseBinaryTarget(path)).toMatchObject({
      ok: true,
      value: { format: "mach-o", architecture: wide ? "arm64" : "x86" },
    });
  },
);

it.each([false, true])(
  "walks command headers beyond the probe window (corrupt=%s)",
  async (corrupt) => {
    const bytes = commandImage(true, true, [4104, 16]);
    if (corrupt) bytes.writeUInt32LE(0xffffffff, 32 + 4104 + 4);
    const path = join(
      await createTestTempDirectory("rea-macho-command-window-"),
      "image",
    );
    await writeFile(path, bytes);
    const resolved = await parseBinaryTarget(path);
    expect(resolved.ok).toBe(!corrupt);
    if (!resolved.ok) {
      if (!(resolved.error instanceof BinaryTargetError)) throw resolved.error;
      expect(resolved.error.reason).toContain("load command 1");
    }
  },
);

it.each([null, 0, 1])(
  "checks every admitted FAT slice's framing (corrupt slice %s)",
  async (corruptIndex) => {
    const slices = [
      commandImage(true, true, [16]),
      commandImage(true, true, [16]),
    ];
    const x86 = slices[0]!;
    x86.writeUInt32LE(CPU.x86_64.type, 4);
    x86.writeUInt32LE(CPU.x86_64.subtype, 8);
    if (corruptIndex !== null)
      slices[corruptIndex]!.writeUInt32LE(0xffffffff, 36);
    const bytes = fatImage([
      { cpu: CPU.x86_64, bytes: x86 },
      { cpu: CPU.arm64, bytes: slices[1]! },
    ]);
    const path = join(
      await createTestTempDirectory("rea-fat-command-"),
      "image",
    );
    await writeFile(path, bytes);
    const resolved = await parseBinaryTarget(path, {
      hostArchitecture: "arm64",
    });
    expect(resolved.ok).toBe(corruptIndex === null);
    if (!resolved.ok) {
      if (!(resolved.error instanceof BinaryTargetError)) throw resolved.error;
      expect(resolved.error.reason).toContain("invalid cmdsize");
      expect(projectAnalysisError(resolved.error)).toMatchObject({
        code: "target_unavailable",
      });
    } else
      expect(resolved.value).toMatchObject({
        format: "mach-o-universal",
        architecture: "arm64",
      });
  },
);

it("preserves native capacity priority when the command table also exceeds the file", () => {
  const bytes = commandImage(true, true, [16]);
  bytes.writeUInt32LE(16 * 1024 * 1024 + 1, 20);
  expect(() => readBinaryContainer(bytes)).toThrow(BinaryResourceFailure);
  const bounded = readMachoLoadCommandTableHeader(bytes, bytes.length);
  expect(bounded).toMatchObject({
    ok: false,
    error: expect.stringContaining("truncated Mach-O load commands"),
  });
});
