import { describe, expect, it } from "vitest";
import { parseExecutableHeader } from "./binaryTarget.js";

const header = (little: boolean, bits: 32 | 64 = 32, machine = 20): Buffer => {
  const bytes = Buffer.alloc(bits === 32 ? 52 : 64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, bits === 32 ? 1 : 2, little ? 1 : 2, 1]);
  if (little) {
    bytes.writeUInt16LE(2, 16);
    bytes.writeUInt16LE(machine, 18);
    bytes.writeUInt32LE(1, 20);
    bytes.writeUInt16LE(bytes.length, bits === 32 ? 40 : 52);
  } else {
    bytes.writeUInt16BE(2, 16);
    bytes.writeUInt16BE(machine, 18);
    bytes.writeUInt32BE(1, 20);
    bytes.writeUInt16BE(bytes.length, bits === 32 ? 40 : 52);
  }
  return bytes;
};

describe("PowerPC ELF header boundaries", () => {
  it.each([false, true])(
    "retains source endian and flags (little=%s)",
    (little) => {
      const parsed = parseExecutableHeader(header(little), "x64");
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parsed.value).toEqual({
        format: "elf",
        architecture: "powerpc",
        availableArchitectures: ["powerpc"],
        powerpc: {
          elfClass: 32,
          byteOrder: little ? "little" : "big",
          type: 2,
          flags: 0,
        },
      });
    },
  );

  it("reads ELF64 flags at their own offset without claiming support", () => {
    const bytes = header(false, 64);
    bytes.writeUInt32BE(0x80000000, 48);
    const parsed = parseExecutableHeader(bytes, "x64");
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value).toMatchObject({
      architecture: "powerpc",
      powerpc: { elfClass: 64, byteOrder: "big", flags: 0x80000000 },
    });
  });

  it("does not recognize EM_PPC64 as the 32-bit family", () => {
    expect(parseExecutableHeader(header(false, 64, 21), "x64")).toEqual({
      ok: false,
      error: "unsupported ELF architecture: e_machine 21",
    });
  });
});
