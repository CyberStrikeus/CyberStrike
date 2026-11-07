import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { elf } from "../../../src/domain/binaryTarget.fixture.js";
import { expectBinaryTargetError } from "../../fixtures/binaryTargetAdmission.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const image = (bits: 32 | 64, little: boolean) => {
  const bytes = Buffer.alloc(368);
  const header = elf(bits === 32 ? 1 : 2, little ? 1 : 2, bits === 32 ? 3 : 62);
  header.copy(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number, value: number) =>
    view.setUint16(offset, value, little);
  const u32 = (offset: number, value: number) =>
    view.setUint32(offset, value, little);
  const word = (offset: number, value: bigint) =>
    bits === 32
      ? u32(offset, Number(value))
      : view.setBigUint64(offset, value, little);
  const wide = bits === 64;
  const program = wide ? 64 : 52;
  const programWidth = wide ? 56 : 32;
  const sectionWidth = wide ? 64 : 40;
  u16(16, 2);
  word(wide ? 32 : 28, BigInt(program));
  word(wide ? 40 : 32, 128n);
  u16(wide ? 54 : 42, programWidth);
  u16(wide ? 56 : 44, 1);
  u16(wide ? 58 : 46, sectionWidth);
  u16(wide ? 60 : 48, 2);
  u32(program, 1); // PT_LOAD
  word(program + (wide ? 8 : 4), 320n);
  word(program + (wide ? 32 : 16), 16n);
  word(program + (wide ? 40 : 20), 16n);
  const section = 128 + sectionWidth;
  u32(section + 4, 1); // SHT_PROGBITS
  word(section + (wide ? 24 : 16), 352n);
  word(section + (wide ? 32 : 20), 16n);
  return {
    bytes,
    word,
    u16,
    u32,
    program,
    section,
    programWidth,
    sectionWidth,
  };
};

const admit = async (bytes: Buffer) => {
  const directory = await createTestTempDirectory("rea-elf-declared-ranges-");
  const path = join(directory, "image.elf");
  await writeFile(path, bytes);
  const result = await parseBinaryTarget(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  expect(
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
  ).toBe(digest);
  if (result.ok) expect(result.value.sha256).toBe(digest);
  return result;
};

for (const bits of [32, 64] as const) {
  for (const little of [true, false]) {
    it(`refuses declared table and payload truncation before provider admission (ELF${bits} ${little ? "LE" : "BE"})`, async () => {
      const fixture = image(bits, little);
      expect((await admit(fixture.bytes)).ok).toBe(true);
      for (const [length, declaration] of [
        [fixture.program, "program header table"],
        [fixture.program + fixture.programWidth - 1, "program header table"],
        [128 + fixture.sectionWidth * 2 - 1, "section header table"],
        [335, "program 0"],
        [367, "section 1"],
      ] as const) {
        const result = await admit(fixture.bytes.subarray(0, length));
        expect(result).toMatchObject({
          ok: false,
          error: {
            constraint: "file_format_rejected",
            reason: expect.stringContaining(`truncated ELF ${declaration}`),
          },
        });
        expect(expectBinaryTargetError(result).reason).toContain(
          `${length}-byte file`,
        );
      }
    });

    it(`preserves absent tables and memory-only declarations (ELF${bits} ${little ? "LE" : "BE"})`, async () => {
      expect(
        (
          await admit(
            elf(bits === 32 ? 1 : 2, little ? 1 : 2, bits === 32 ? 3 : 62),
          )
        ).ok,
      ).toBe(true);
      const fixture = image(bits, little);
      const wide = bits === 64;
      const outside = wide ? 0xffffffffffffffffn : 0xffffffffn;
      fixture.u32(fixture.section + 4, 8); // SHT_NOBITS owns memory, not file bytes.
      fixture.word(fixture.section + (wide ? 24 : 16), outside);
      fixture.word(fixture.section + (wide ? 32 : 20), outside);
      fixture.word(fixture.program + (wide ? 8 : 4), outside);
      fixture.word(fixture.program + (wide ? 32 : 16), 0n);
      fixture.word(128 + (wide ? 24 : 16), outside); // Inactive section-zero fields.
      fixture.word(128 + (wide ? 32 : 20), outside);
      expect((await admit(fixture.bytes)).ok).toBe(true);
    });

    it(`keeps declared offsets exact when their sum exceeds host precision (ELF${bits} ${little ? "LE" : "BE"})`, async () => {
      const fixture = image(bits, little);
      const maximum = bits === 64 ? 0xffffffffffffffffn : 0xffffffffn;
      fixture.word(fixture.program + (bits === 64 ? 8 : 4), maximum);
      const result = await admit(fixture.bytes);
      expect(result).toMatchObject({ ok: false });
      expect(expectBinaryTargetError(result).reason).toContain(
        `${maximum}..${maximum + 16n}`,
      );
    });
  }
}

it.each(["sections", "programs", "section names"] as const)(
  "resolves valid extended %s numbering from bounded section zero",
  async (kind) => {
    const count =
      kind === "programs" ? 0xffff : kind === "section names" ? 0xff01 : 0xff00;
    const width = kind === "programs" ? 56 : 64;
    const sectionAt = kind === "programs" ? 64 + count * width : 64;
    const bytes = Buffer.alloc(
      kind === "programs" ? sectionAt + 64 : sectionAt + count * width,
    );
    elf(2, 1, 62).copy(bytes);
    bytes.writeBigUInt64LE(BigInt(sectionAt), 40);
    bytes.writeUInt16LE(64, 58);
    if (kind !== "programs") {
      bytes.writeBigUInt64LE(BigInt(count), sectionAt + 32);
      if (kind === "section names") {
        bytes.writeUInt16LE(0xffff, 62);
        bytes.writeUInt32LE(0xff00, sectionAt + 40);
        bytes.writeUInt32LE(3, sectionAt + 0xff00 * width + 4);
      }
    } else {
      bytes.writeBigUInt64LE(64n, 32);
      bytes.writeUInt16LE(56, 54);
      bytes.writeUInt16LE(0xffff, 56);
      bytes.writeUInt16LE(1, 60);
      bytes.writeUInt32LE(count, sectionAt + 44);
    }
    expect((await admit(bytes)).ok).toBe(true);
    const truncated = await admit(bytes.subarray(0, bytes.length - 1));
    expect(truncated).toMatchObject({ ok: false });
    expect(expectBinaryTargetError(truncated).reason).toContain(
      "truncated ELF",
    );
  },
);
