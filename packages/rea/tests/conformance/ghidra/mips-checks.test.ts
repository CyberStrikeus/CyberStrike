import { describe, expect, it } from "vitest";
import {
  assertMipsCarvedTargetRefusal,
  assertMipsGlobal,
  assertMipsLoadedImage,
  assertMipsProbe,
  assertMipsSoftFloatStorage,
  carveMipsElfBeforeSectionTable,
  parseMipsReadelf,
} from "./mips-checks.mjs";

// GNU readelf 2.44 output for the source-owned Clang 19 / LLD 19 fixture.
// This tests the reader boundary, not Ghidra; the real lane rebuilds both orders.
const readelf = `ELF Header:
  Magic:   7f 45 4c 46 01 01 01 00 00 00 00 00 00 00 00 00
  Class:                             ELF32
  Data:                              2's complement, little endian
  Version:                           1 (current)
  OS/ABI:                            UNIX - System V
  ABI Version:                       0
  Type:                              EXEC (Executable file)
  Machine:                           MIPS R3000
  Version:                           0x1
  Entry point address:               0x201b0
  Start of program headers:          52 (bytes into file)
  Start of section headers:          2624 (bytes into file)
  Flags:                             0x70001001, noreorder, o32, mips32r2
  Size of this header:               52 (bytes)
  Size of program headers:           32 (bytes)
  Number of program headers:         7
  Size of section headers:           40 (bytes)
  Number of section headers:         24
  Section header string table index: 22

Section Headers:
  [Nr] Name              Type            Addr     Off    Size   ES Flg Lk Inf Al
  [ 0]                   NULL            00000000 000000 000000 00      0   0  0
  [ 1] .MIPS.abiflags    MIPS_ABIFLAGS   00010118 000118 000018 18   A  0   0  8
  [ 2] .reginfo          MIPS_REGINFO    00010130 000130 000018 18   A  0   0  4
  [ 3] .rodata           PROGBITS        00010148 000148 00001e 00   A  0   0  1
  [ 4] .text             PROGBITS        00020170 000170 0000f0 00  AX  0   0 16
  [ 5] .data             PROGBITS        00030260 000260 000000 00  WA  0   0 16
  [ 6] .got              PROGBITS        00030260 000260 000008 00 WAp  0   0 16
  [ 7] .sdata            PROGBITS        00030268 000268 000004 00 WAp  0   0  4
  [ 8] .bss              NOBITS          00030270 00026c 000000 00  WA  0   0 16
  [ 9] .mdebug.abi32     PROGBITS        00000000 00026c 000000 00      0   0  1
  [10] .pdr              PROGBITS        00000000 00026c 000060 00      0   0  4
  [11] .debug_abbrev     MIPS_DWARF      00000000 0002cc 0000b3 00      0   0  1
  [12] .debug_info       MIPS_DWARF      00000000 00037f 00015e 00      0   0  1
  [13] .debug_str_offsets MIPS_DWARF      00000000 0004dd 000040 00      0   0  1
  [14] .debug_str        MIPS_DWARF      00000000 00051d 0000ef 01  MS  0   0  1
  [15] .debug_addr       MIPS_DWARF      00000000 00060c 000018 00      0   0  1
  [16] .comment          PROGBITS        00000000 000624 00003e 01  MS  0   0  1
  [17] .debug_frame      MIPS_DWARF      00000000 000664 00004c 00      0   0  4
  [18] .debug_line       MIPS_DWARF      00000000 0006b0 0000f8 00      0   0  1
  [19] .debug_line_str   MIPS_DWARF      00000000 0007a8 000098 01  MS  0   0  1
  [20] .debug_aranges    MIPS_DWARF      00000000 000840 000020 00      0   0  1
  [21] .symtab           SYMTAB          00000000 000860 000090 10     23   4  4
  [22] .shstrtab         STRTAB          00000000 0008f0 0000f0 00      0   0  1
  [23] .strtab           STRTAB          00000000 0009e0 00005f 00      0   0  1
Key to Flags:
  W (write), A (alloc), X (execute), M (merge), S (strings), I (info),
  L (link order), O (extra OS processing required), G (group), T (TLS),
  C (compressed), x (unknown), o (OS specific), E (exclude),
  D (mbind), p (processor specific)

Symbol table '.symtab' contains 9 entries:
   Num:    Value  Size Type    Bind   Vis      Ndx Name
     0: 00000000     0 NOTYPE  LOCAL  DEFAULT  UND
     1: 00000000     0 FILE    LOCAL  DEFAULT  ABS mips.c
     2: 00020254     0 NOTYPE  LOCAL  DEFAULT    4 .Lzero
     3: 00038250     0 NOTYPE  LOCAL  HIDDEN     6 _gp
     4: 00020170    64 FUNC    GLOBAL DEFAULT    4 rea_mips_leaf
     5: 00030268     4 OBJECT  GLOBAL DEFAULT    7 rea_mips_global
     6: 000201b0   136 FUNC    GLOBAL DEFAULT    4 rea_mips_entry
     7: 00010148    30 OBJECT  GLOBAL DEFAULT    3 rea_mips_marker
     8: 00020240    32 FUNC    GLOBAL DEFAULT    4 rea_mips_probe

MIPS ABI Flags Version: 0

ISA: MIPS32r2
GPR size: 32
CPR1 size: 32
CPR2 size: 0
FP ABI: Hard float (32-bit CPU, Any FPU)
ISA Extension: None
ASEs:
	None
FLAGS 1: 00000000
FLAGS 2: 00000000

Static GOT:
 Canonical gp value: 00038250

 Reserved entries:
   Address     Access    Value
  00030260 -32752(gp) 00000000
  00030264 -32748(gp) 80000000

`;
const sha256 = "a".repeat(64);
const image = {
  language_id: "MIPS:LE:32:default",
  compiler_spec_id: "default",
  source_files: [{ original_sha256: sha256, modified_sha256: sha256 }],
};
const move = {
  address: "0x20240",
  status: "decoded",
  architecture: "MIPS:LE:32:default",
  length: 4,
  bytes: "34128224",
  mnemonic: "addiu",
  operands: [
    { index: 2, components: [{ kind: "immediate", value: "0x1234" }] },
  ],
};
const branch = {
  address: "0x20244",
  status: "decoded",
  architecture: "MIPS:LE:32:default",
  length: 4,
  bytes: "03008010",
  mnemonic: "beqz",
  flow: {
    kind: "jump",
    conditional: true,
    computed: false,
    direct_destinations: ["0x20254"],
  },
};

describe("MIPS real-verifier independent expectations", () => {
  it("reads GNU header, ABI and defined symbols without a Ghidra-derived oracle", () => {
    const parsed = parseMipsReadelf(readelf, "little");
    expect(parsed.mips).toMatchObject({
      elfClass: 32,
      byteOrder: "little",
      flags: 0x70001001,
      gnuAttributes: null,
      abiFlags: {
        isaLevel: 32,
        isaRevision: 2,
        gprSize: 1,
        cpr1Size: 1,
        fpAbi: 5,
      },
    });
    expect(parsed.symbols.rea_mips_probe).toBe("0x20240");
    expect(
      parseMipsReadelf(readelf.replace("little endian", "big endian"), "big")
        .mips.byteOrder,
    ).toBe("big");
  });

  it.each([
    ["wrong class", "ELF32", "ELF64"],
    ["wrong byte order", "little endian", "big endian"],
    ["wrong machine", "MIPS R3000", "AArch64"],
    ["wrong object type", "EXEC (Executable file)", "DYN (Shared object file)"],
    ["wrong flags", "0x70001001", "0x60001001"],
    ["wrong ISA", "ISA: MIPS32r2", "ISA: MIPS32r6"],
    ["unknown FP ABI", "Hard float (32-bit CPU, Any FPU)", "unknown"],
    ["unknown register width", "GPR size: 32", "GPR size: 64"],
    ["missing symbol", "rea_mips_probe", "unrelated_probe"],
    ["missing ABI", "MIPS ABI Flags Version: 0", "ABI omitted"],
  ])(
    "rejects %s instead of returning a guessed fixture interpretation",
    (_name, from, to) => {
      expect(() =>
        parseMipsReadelf(readelf.replace(from, to), "little"),
      ).toThrow();
    },
  );

  it("rejects ambiguous producer fields", () => {
    expect(() =>
      parseMipsReadelf(`${readelf}\nClass: ELF32\n`, "little"),
    ).toThrow(/ambiguous/u);
  });

  it("checks the effective loaded image, not requested profile metadata", () => {
    assertMipsLoadedImage(image, "little", sha256);
    expect(() =>
      assertMipsLoadedImage(
        { ...image, language_id: "MIPS:BE:32:default" },
        "little",
        sha256,
      ),
    ).toThrow();
    expect(() =>
      assertMipsLoadedImage(
        { ...image, compiler_spec_id: "other" },
        "little",
        sha256,
      ),
    ).toThrow();
    expect(() =>
      assertMipsLoadedImage(
        {
          ...image,
          source_files: [
            { original_sha256: sha256, modified_sha256: "b".repeat(64) },
          ],
        },
        "little",
        sha256,
      ),
    ).toThrow();
  });

  it("checks exact probe bytes, immediate and conditional destination in both orders", () => {
    assertMipsProbe(move, branch, "little", "0x20240");
    assertMipsProbe(
      { ...move, architecture: "MIPS:BE:32:default", bytes: "24821234" },
      { ...branch, architecture: "MIPS:BE:32:default", bytes: "10800003" },
      "big",
      "0x20240",
    );
  });

  it("rejects plausible nonempty but incorrect instruction observations", () => {
    expect(() =>
      assertMipsProbe(
        { ...move, bytes: "35128224" },
        branch,
        "little",
        "0x20240",
      ),
    ).toThrow();
    expect(() =>
      assertMipsProbe({ ...move, length: 2 }, branch, "little", "0x20240"),
    ).toThrow();
    expect(() =>
      assertMipsProbe(
        {
          ...move,
          operands: [
            { index: 2, components: [{ kind: "immediate", value: "0x1235" }] },
          ],
        },
        branch,
        "little",
        "0x20240",
      ),
    ).toThrow();
    expect(() =>
      assertMipsProbe(
        move,
        {
          ...branch,
          flow: { ...branch.flow, direct_destinations: ["0x20250"] },
        },
        "little",
        "0x20240",
      ),
    ).toThrow();
    expect(() =>
      assertMipsProbe(
        move,
        { ...branch, flow: { ...branch.flow, conditional: false } },
        "little",
        "0x20240",
      ),
    ).toThrow();
  });

  it("checks all four global bytes in the declared order", () => {
    assertMipsGlobal("07000000", "little");
    assertMipsGlobal("00000007", "big");
    expect(() => assertMipsGlobal("00000007", "little")).toThrow();
    expect(() => assertMipsGlobal("0700", "little")).toThrow();
  });
});

describe("MIPS real-verifier carved-copy expectations", () => {
  it.each(["little", "big"] as const)(
    "carves before the %s-endian section table only when every payload stays captured",
    (byteOrder) => {
      const bytes = Buffer.alloc(200);
      const u16 = (offset: number, value: number) =>
        byteOrder === "little"
          ? bytes.writeUInt16LE(value, offset)
          : bytes.writeUInt16BE(value, offset);
      const u32 = (offset: number, value: number) =>
        byteOrder === "little"
          ? bytes.writeUInt32LE(value, offset)
          : bytes.writeUInt32BE(value, offset);
      u32(28, 52);
      u32(32, 120);
      u16(42, 32);
      u16(44, 1);
      u16(46, 40);
      u16(48, 2);
      u32(56, 100); // PT payload ends at the last captured byte.
      u32(68, 19);
      const carve = carveMipsElfBeforeSectionTable(bytes, byteOrder);
      expect(carve.bytes.length).toBe(119);
      expect(carve.reason).toBe(
        "truncated ELF section header table: declared file range 120..200 exceeds the 119-byte file",
      );
      u32(68, 20);
      expect(() => carveMipsElfBeforeSectionTable(bytes, byteOrder)).toThrow();
    },
  );

  it("accepts only a target-opening refusal of the carved copy", () => {
    const path = "/work/little-hard-carved.elf";
    const reason =
      "truncated ELF section header table: declared file range 2620..3580 exceeds the 2619-byte file";
    const refusal = {
      code: "target_unavailable",
      details: { path, reason, constraint: "file_format_rejected" },
    };
    assertMipsCarvedTargetRefusal(refusal, path, reason);
    for (const observed of [
      // Superseded: a resolved copy refused later by Ghidra admission.
      {
        code: "capability_unavailable",
        details: {
          selection_reason: "target_unsupported",
          rejections: [
            {
              provider_id: "ghidra",
              code: "architecture_unsupported",
              reason: `MIPS ABI declaration inspection is incomplete. ${reason}`,
            },
          ],
        },
      },
      {
        ...refusal,
        details: { ...refusal.details, reason: reason.replace("2619", "2620") },
      },
      { ...refusal, details: { path, reason } },
    ])
      expect(() =>
        assertMipsCarvedTargetRefusal(observed, path, reason),
      ).toThrow();
  });
});

describe("MIPS real-verifier GNU attribute coverage", () => {
  it.each(["exec", "rel"] as const)(
    "reports verified GNU attribute absence for both byte orders of %s fixtures",
    (objectType) => {
      for (const byteOrder of ["little", "big"]) {
        const text = readelf
          .replace("little endian", `${byteOrder} endian`)
          .replace(
            "EXEC (Executable file)",
            objectType === "rel"
              ? "REL (Relocatable file)"
              : "EXEC (Executable file)",
          );
        expect(
          parseMipsReadelf(text, byteOrder, "hard", objectType).mips
            .gnuAttributes,
        ).toBeNull();
      }
    },
  );

  it("rejects GNU attribute sections even when their name is unrelated", () => {
    expect(() =>
      parseMipsReadelf(
        readelf.replace(
          ".comment          PROGBITS",
          ".comment          GNU_ATTRIBUTES",
        ),
        "little",
      ),
    ).toThrow(/GNU attributes/u);
  });

  it("uses the section type rather than its name to establish absence", () => {
    expect(
      parseMipsReadelf(
        readelf.replace(
          ".comment          PROGBITS",
          ".gnu.attributes  PROGBITS",
        ),
        "little",
      ).mips.gnuAttributes,
    ).toBeNull();
  });

  it.each([
    [
      "missing table",
      readelf.replace(
        /Section Headers:[\s\S]*?Key to Flags:/u,
        "Key to Flags:",
      ),
    ],
    ["missing entry", readelf.replace(/^.*\[ 5\].*\n/gmu, "")],
    ["duplicate index", readelf.replace("[ 5]", "[ 4]")],
    ["malformed entry", readelf.replace(/^.*\[ 5\].*$/gmu, "  [ 5] malformed")],
  ])("refuses GNU attribute absence from a %s", (_name, text) => {
    expect(() => parseMipsReadelf(text, "little")).toThrow(/section/u);
  });
});

describe("MIPS soft-float real-verifier expectations", () => {
  const softReadelf = readelf
    .replace("CPR1 size: 32", "CPR1 size: 0")
    .replace("Hard float (32-bit CPU, Any FPU)", "Soft float")
    .replace(
      "     8: 00020240    32 FUNC    GLOBAL DEFAULT    4 rea_mips_probe\n",
      [
        "     8: 00020240    32 FUNC    GLOBAL DEFAULT    4 rea_mips_probe",
        "     9: 00020300    64 FUNC    GLOBAL DEFAULT    4 rea_mips_soft_pick",
        "    10: 00020340    64 FUNC    GLOBAL DEFAULT    4 rea_mips_soft_wide",
        "    11: 00020380    96 FUNC    GLOBAL DEFAULT    4 rea_mips_soft_mixed",
        "    12: 000203e0    96 FUNC    GLOBAL DEFAULT    4 rea_mips_soft_struct",
        "    13: 00020440   160 FUNC    GLOBAL DEFAULT    4 rea_mips_soft_caller",
        "",
      ].join("\n"),
    );

  it("reads the soft-float ABI record and its fixture symbols", () => {
    const parsed = parseMipsReadelf(softReadelf, "little", "soft");
    expect(parsed.mips.abiFlags).toMatchObject({ cpr1Size: 0, fpAbi: 3 });
    expect(parsed.mips.gnuAttributes).toBeNull();
    expect(parsed.symbols.rea_mips_soft_mixed).toBe("0x20380");
  });

  it("rejects a float ABI that differs from the build intent", () => {
    expect(() => parseMipsReadelf(softReadelf, "little", "hard")).toThrow(
      /build intent/u,
    );
    expect(() => parseMipsReadelf(readelf, "little", "soft")).toThrow(
      /build intent/u,
    );
  });

  const boundaries = (byteOrder: "little" | "big") => {
    const pair = (low: string, high: string) =>
      byteOrder === "little" ? `${high}:4,${low}:4` : `${low}:4,${high}:4`;
    const item = (
      ordinal: number,
      name: string,
      dataType: string,
      storage: string,
    ) => ({ ordinal, name, data_type: dataType, storage });
    return {
      rea_mips_soft_pick: {
        return_type: { data_type: "float", storage: "v0:4" },
        parameters: [
          item(2, "sel", "int", "a2:4"),
          item(0, "a", "float", "a0:4"),
          item(1, "b", "float", "a1:4"),
        ],
      },
      rea_mips_soft_wide: {
        return_type: { data_type: "double", storage: pair("v0", "v1") },
        parameters: [
          item(0, "a", "double", pair("a0", "a1")),
          item(1, "sel", "int", "a2:4"),
        ],
      },
      rea_mips_soft_mixed: {
        return_type: { data_type: "double", storage: pair("v0", "v1") },
        parameters: [
          item(0, "i", "int", "a0:4"),
          item(1, "d", "double", pair("a2", "a3")),
          item(2, "f", "float", "Stack[0x10]:4"),
          item(3, "e", "double", "Stack[0x18]:8"),
        ],
      },
      rea_mips_soft_struct: {
        return_type: { data_type: "rea_mips_soft_pair *", storage: "v0:4" },
        parameters: [
          item(
            0,
            "__return_storage_ptr__",
            "rea_mips_soft_pair *",
            "a0:4 (auto)",
          ),
          item(1, "scale", "float", "a1:4"),
          item(2, "sel", "int", "a2:4"),
        ],
      },
    };
  };

  it("checks soft-float o32 storage, including pair order, alignment and spill", () => {
    assertMipsSoftFloatStorage(boundaries("little"), "little");
    assertMipsSoftFloatStorage(boundaries("big"), "big");
    expect(() =>
      assertMipsSoftFloatStorage(boundaries("big"), "little"),
    ).toThrow();
    const hardFloat = boundaries("little");
    const pickA = hardFloat.rea_mips_soft_pick.parameters.find(
      (item) => item.ordinal === 0,
    );
    if (pickA === undefined) throw new Error("fixture lacks pick parameter a");
    pickA.storage = "f12:4";
    expect(() => assertMipsSoftFloatStorage(hardFloat, "little")).toThrow();
    const unaligned = boundaries("little");
    const mixedD = unaligned.rea_mips_soft_mixed.parameters.find(
      (item) => item.ordinal === 1,
    );
    if (mixedD === undefined)
      throw new Error("fixture lacks mixed parameter d");
    mixedD.storage = "a2:4,a1:4";
    expect(() => assertMipsSoftFloatStorage(unaligned, "little")).toThrow();
    const lostHiddenReturn = boundaries("little");
    lostHiddenReturn.rea_mips_soft_struct.parameters = [
      { ordinal: 0, name: "scale", data_type: "float", storage: "a0:4" },
      { ordinal: 1, name: "sel", data_type: "int", storage: "a1:4" },
    ];
    expect(() =>
      assertMipsSoftFloatStorage(lostHiddenReturn, "little"),
    ).toThrow();
  });
});
