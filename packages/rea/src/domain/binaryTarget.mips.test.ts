import { describe, expect, it } from "vitest";
import { parseExecutableHeader } from "./binaryTarget.js";

const header = (little: boolean, bits: 32 | 64 = 32): Buffer => {
  const bytes = Buffer.alloc(bits === 32 ? 52 : 64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, bits === 32 ? 1 : 2, little ? 1 : 2, 1]);
  if (little) {
    bytes.writeUInt16LE(2, 16);
    bytes.writeUInt16LE(8, 18);
    bytes.writeUInt32LE(1, 20);
    bytes.writeUInt16LE(bits === 32 ? 52 : 64, bits === 32 ? 40 : 52);
    bytes.writeUInt32LE(0x70001001, bits === 32 ? 36 : 48);
  } else {
    bytes.writeUInt16BE(2, 16);
    bytes.writeUInt16BE(8, 18);
    bytes.writeUInt32BE(1, 20);
    bytes.writeUInt16BE(bits === 32 ? 52 : 64, bits === 32 ? 40 : 52);
    bytes.writeUInt32BE(0x70001001, bits === 32 ? 36 : 48);
  }
  return bytes;
};

describe("MIPS ELF header boundaries", () => {
  it.each([true, false])(
    "retains source endian and ABI/ISA flags (little=%s)",
    (little) => {
      const parsed = parseExecutableHeader(header(little), "x64");
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parsed.value).toEqual({
        format: "elf",
        architecture: "mips",
        availableArchitectures: ["mips"],
        mips: {
          elfClass: 32,
          byteOrder: little ? "little" : "big",
          type: 2,
          flags: 0x70001001,
        },
      });
    },
  );

  it("reads ELF64 flags at their own offset without claiming o32 support", () => {
    const bytes = header(false, 64);
    bytes.writeUInt32BE(0xfeedface, 36);
    bytes.writeUInt32BE(0x80000001, 48);
    const parsed = parseExecutableHeader(bytes, "x64");
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value).toMatchObject({
      architecture: "mips",
      mips: { elfClass: 64, byteOrder: "big", flags: 0x80000001 },
    });
  });

  it("retains a PSP declaration without claiming Allegrex provider support", () => {
    const bytes = header(true);
    bytes.writeUInt32LE(0x10a23001, 36);
    const parsed = parseExecutableHeader(bytes, "x64");
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value).toMatchObject({
      architecture: "mips",
      mips: { flags: 0x10a23001 },
    });
  });

  it("rejects a truncated header before reading flags", () => {
    const parsed = parseExecutableHeader(header(true).subarray(0, 39), "x64");
    expect(parsed).toEqual({
      ok: false,
      error:
        "truncated ELF header: an ELF32 header needs 52 bytes; the file has 39",
    });
  });

  it("does not turn invalid byte order into little-endian MIPS", () => {
    const bytes = header(true);
    bytes[5] = 0;
    expect(parseExecutableHeader(bytes, "x64")).toEqual({
      ok: false,
      error: "unsupported ELF endianness",
    });
  });
});
