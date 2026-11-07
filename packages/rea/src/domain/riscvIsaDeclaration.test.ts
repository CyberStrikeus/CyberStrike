import { describe, expect, it } from "vitest";
import {
  parseRiscvAttributes,
  riscvAbiName,
  riscvFloatAbi,
  riscvIsaDeclaration,
} from "./riscvIsaDeclaration.js";

const u32 = (value: number, little: boolean): number[] => {
  const bytes = Buffer.alloc(4);
  if (little) bytes.writeUInt32LE(value);
  else bytes.writeUInt32BE(value);
  return [...bytes];
};
const text = (value: string): number[] => [...Buffer.from(value, "latin1"), 0];

/** One vendor subsection holding one scoped list, as toolchains emit it. */
const section = (
  attributes: readonly number[],
  {
    little = true,
    vendor = "riscv",
    scope = 1,
  }: {
    readonly little?: boolean;
    readonly vendor?: string;
    readonly scope?: number;
  } = {},
): Buffer => {
  const scoped = [
    scope,
    ...u32(1 + 4 + attributes.length, little),
    ...attributes,
  ];
  const name = text(vendor);
  return Buffer.from([
    0x41,
    ...u32(4 + name.length + scoped.length, little),
    ...name,
    ...scoped,
  ]);
};

// Byte-for-byte the `.riscv.attributes` section LLVM 21 writes for
// `-march=rv32imc -mabi=ilp32`: stack_align 16, then the ISA string.
const LLVM_RV32IMC = Buffer.from(
  [
    "41350000",
    "00726973",
    "63760001",
    "2b000000",
    "04100572",
    "76333269",
    "3270315f",
    "6d327030",
    "5f633270",
    "305f7a6d",
    "6d756c31",
    "70305f7a",
    "63613170",
    "3000",
  ].join(""),
  "hex",
);

describe("RISC-V e_flags float ABI", () => {
  it.each([
    [0x0, "soft", "ilp32", "lp64"],
    [0x1, "soft", "ilp32", "lp64"],
    [0x2, "single", "ilp32f", "lp64f"],
    [0x3, "single", "ilp32f", "lp64f"],
    [0x4, "double", "ilp32d", "lp64d"],
    [0x5, "double", "ilp32d", "lp64d"],
    [0x6, "quad", null, "lp64q"],
    [0x1f, "quad", null, "lp64q"],
    [0x8000_0001, "soft", "ilp32", "lp64"],
  ] as const)(
    "flags 0x%s declare the %s ABI",
    (flags, floatAbi, rv32, rv64) => {
      expect(riscvFloatAbi(flags)).toBe(floatAbi);
      expect(riscvAbiName(32, floatAbi)).toBe(rv32);
      expect(riscvAbiName(64, floatAbi)).toBe(rv64);
    },
  );
});

describe("RISC-V .riscv.attributes", () => {
  it("reads the ISA string LLVM writes", () => {
    expect(parseRiscvAttributes(LLVM_RV32IMC, true)).toEqual({
      ok: true,
      value: "rv32i2p1_m2p0_c2p0_zmmul1p0_zca1p0",
    });
  });

  it.each([true, false])(
    "reads lengths in the image's byte order (little=%s)",
    (little) => {
      expect(
        parseRiscvAttributes(
          section([5, ...text("rv32i2p1_c2p0")], { little }),
          little,
        ),
      ).toEqual({ ok: true, value: "rv32i2p1_c2p0" });
    },
  );

  it("skips tags it does not use by the psABI's odd-string, even-integer rule", () => {
    expect(
      parseRiscvAttributes(
        section([
          4,
          16, // Tag_RISCV_stack_align
          6,
          1, // Tag_RISCV_unaligned_access
          8,
          0x80,
          0x01, // two-byte ULEB128
          5,
          ...text("rv32i2p1"),
          7,
          ...text("future string tag"),
          14,
          3, // Tag_RISCV_atomic_abi
        ]),
        true,
      ),
    ).toEqual({ ok: true, value: "rv32i2p1" });
  });

  it("reports a section without an ISA string as null", () => {
    expect(parseRiscvAttributes(section([4, 16]), true)).toEqual({
      ok: true,
      value: null,
    });
    expect(parseRiscvAttributes(Buffer.from([0x41]), true)).toEqual({
      ok: true,
      value: null,
    });
  });

  it.each([
    ["an empty section", Buffer.alloc(0), "format version"],
    ["another format version", Buffer.from([0x42]), "format version"],
    [
      "a truncated subsection length",
      Buffer.from([0x41, 0x05, 0x00]),
      "truncated RISC-V attribute subsection length",
    ],
    [
      "a subsection longer than the section",
      Buffer.from([0x41, 0xff, 0, 0, 0]),
      "does not fit the section",
    ],
    [
      "another vendor",
      section([5, ...text("rv32i2p1")], { vendor: "gnu" }),
      "non-riscv vendor",
    ],
    [
      "a section-scoped list",
      section([5, ...text("rv32i2p1")], { scope: 2 }),
      "scoped to sections or symbols",
    ],
    [
      "a symbol-scoped list",
      section([5, ...text("rv32i2p1")], { scope: 3 }),
      "scoped to sections or symbols",
    ],
    [
      "two ISA strings",
      section([5, ...text("rv32i2p1"), 5, ...text("rv32e2p0")]),
      "duplicate RISC-V Tag_RISCV_arch",
    ],
    [
      "an unterminated string",
      section([5, ...Buffer.from("rv32i")]),
      "unterminated string value",
    ],
    ["an unterminated integer", section([4, 0x80]), "malformed integer value"],
    [
      "an integer beyond 32 bits",
      section([4, 0xff, 0xff, 0xff, 0xff, 0x7f]),
      "malformed integer value",
    ],
  ] as const)("refuses %s", (_label, bytes, reason) => {
    const parsed = parseRiscvAttributes(bytes, true);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain(reason);
  });

  it("refuses a second riscv subsection", () => {
    const one = section([5, ...text("rv32i2p1")]);
    expect(
      parseRiscvAttributes(Buffer.concat([one, one.subarray(1)]), true),
    ).toEqual({
      ok: false,
      error: "duplicate riscv vendor attribute subsections",
    });
  });

  it("refuses a scope length that leaves its subsection", () => {
    const bytes = section([5, ...text("rv32i2p1")]);
    bytes.writeUInt32LE(0xff, 4 + 1 + 6 + 1);
    expect(parseRiscvAttributes(bytes, true)).toEqual({
      ok: false,
      error: "RISC-V attribute scope length does not fit its subsection",
    });
  });
});

describe("RISC-V Tag_RISCV_arch", () => {
  it.each([
    // LLVM 21 for the lane's soft-float fixture.
    [
      "rv32i2p1_m2p0_c2p0_zicsr2p0_zifencei2p0_zmmul1p0_zca1p0",
      32,
      "i",
      ["m", "c", "zicsr", "zifencei", "zmmul", "zca"],
    ],
    // GCC 14 for ESP-IDF's ESP32-C6 base string.
    [
      "rv32i2p1_m2p0_a2p1_c2p0_zicsr2p0_zifencei2p0_zaamo1p0_zalrsc1p0_zmmul1p0_zca1p0",
      32,
      "i",
      ["m", "a", "c", "zicsr", "zifencei", "zaamo", "zalrsc", "zmmul", "zca"],
    ],
    // ESP32-P4 with Espressif's vendor extensions and versions on them.
    [
      "rv32i2p1_m2p0_a2p1_f2p2_c2p0_zicsr2p0_xesploop1p0_xespv2p1",
      32,
      "i",
      ["m", "a", "f", "c", "zicsr", "xesploop", "xespv"],
    ],
    ["rv64i2p1_m2p0_a2p1_f2p2_d2p2_c2p0", 64, "i", ["m", "a", "f", "d", "c"]],
    ["rv32e2p0_c2p0", 32, "e", ["c"]],
    ["rv32i", 32, "i", []],
    // Digits inside a name are not a version.
    ["rv64i2p1_zve32x1p0_zvl128b1p0", 64, "i", ["zve32x", "zvl128b"]],
  ] as const)("reads %s", (arch, xlen, base, extensions) => {
    expect(riscvIsaDeclaration(arch)).toEqual({
      status: "declared",
      arch,
      xlen,
      base,
      extensions,
    });
  });

  it.each([
    ["", "canonical rv32/rv64"],
    ["rv128i2p0", "canonical rv32/rv64"],
    ["RV32I2P1", "canonical rv32/rv64"],
    ["rv32imac", "canonical rv32/rv64"],
    ["rv32i2p1__m2p0", 'non-canonical extension token ""'],
    ["rv32i2p1_M2p0", 'non-canonical extension token "M2p0"'],
    ["rv32i2p1_m2p0_m2p0", "declares extension m twice"],
  ])("keeps %j unavailable with its raw value", (arch, reason) => {
    const declaration = riscvIsaDeclaration(arch);
    expect(declaration).toMatchObject({ status: "unavailable", arch });
    if (declaration.status !== "unavailable") return;
    expect(declaration.reason).toContain(reason);
  });
});
