import { describe, expect, it } from "vitest";
import { parseExecutableHeader } from "./binaryTarget.js";

const header = (
  little: boolean,
  bits: 32 | 64 = 32,
  flags = 0x5,
  type = 2,
  machine = 243,
): Buffer => {
  const bytes = Buffer.alloc(bits === 32 ? 52 : 64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, bits === 32 ? 1 : 2, little ? 1 : 2, 1]);
  if (little) {
    bytes.writeUInt16LE(type, 16);
    bytes.writeUInt16LE(machine, 18);
    bytes.writeUInt32LE(1, 20);
    bytes.writeUInt16LE(bits === 32 ? 52 : 64, bits === 32 ? 40 : 52);
    bytes.writeUInt32LE(flags, bits === 32 ? 36 : 48);
  } else {
    bytes.writeUInt16BE(type, 16);
    bytes.writeUInt16BE(machine, 18);
    bytes.writeUInt32BE(1, 20);
    bytes.writeUInt16BE(bits === 32 ? 52 : 64, bits === 32 ? 40 : 52);
    bytes.writeUInt32BE(flags, bits === 32 ? 36 : 48);
  }
  return bytes;
};

describe("RISC-V ELF header boundaries", () => {
  it.each([
    [true, 32],
    [false, 32],
    [true, 64],
    [false, 64],
  ] as const)(
    "retains class, endian, e_type and e_flags (little=%s, class=%s)",
    (little, bits) => {
      const parsed = parseExecutableHeader(header(little, bits), "x64");
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parsed.value).toEqual({
        format: "elf",
        architecture: "riscv",
        availableArchitectures: ["riscv"],
        riscv: {
          elfClass: bits,
          byteOrder: little ? "little" : "big",
          type: 2,
          flags: 0x5,
        },
      });
    },
  );

  it("reads ELF64 flags at their own offset", () => {
    const bytes = header(true, 64);
    bytes.writeUInt32LE(0xdeadbeef, 36);
    bytes.writeUInt32LE(0x00000014, 48);
    const parsed = parseExecutableHeader(bytes, "x64");
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value).toMatchObject({
      architecture: "riscv",
      riscv: { elfClass: 64, flags: 0x14 },
    });
  });

  it("does not attach ELF metadata to a family that declares none", () => {
    const parsed = parseExecutableHeader(header(true, 64, 0x5, 2, 62), "x64");
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value).toEqual({
      format: "elf",
      architecture: "x86_64",
      availableArchitectures: ["x86_64"],
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

  it("does not turn invalid byte order into little-endian RISC-V", () => {
    const bytes = header(true);
    bytes[5] = 0;
    expect(parseExecutableHeader(bytes, "x64")).toEqual({
      ok: false,
      error: "unsupported ELF endianness",
    });
  });

  it("keeps an unknown e_machine outside the recognized family set", () => {
    expect(parseExecutableHeader(header(true, 32, 0x5, 2, 244), "x64")).toEqual(
      {
        ok: false,
        error: "unsupported ELF architecture: e_machine 244",
      },
    );
  });
});
