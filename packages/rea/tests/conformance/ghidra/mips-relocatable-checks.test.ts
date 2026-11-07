import { describe, expect, it } from "vitest";
import {
  assertMipsRelocations,
  parseMipsRelocatableReadelf,
} from "./mips-relocatable-checks.mjs";

// GNU readelf excerpt for a tiny ET_REL object; tests the reader boundary.
const readelf = `Section Headers:
  [Nr] Name              Type            Addr     Off    Size   ES Flg Lk Inf Al
  [ 0]                   NULL            00000000 000000 000000 00      0   0  0
  [ 1] .text             PROGBITS        00000000 000040 000010 00  AX  0   0 16
  [ 2] .rel.text         REL             00000000 000100 000018 08   I  5   1  4
  [ 3] .data             PROGBITS        00000000 000050 008010 00  WA  0   0 16
  [ 4] .rel.data         REL             00000000 000118 000010 08   I  5   3  4
  [ 5] .symtab           SYMTAB          00000000 000128 000040 10      1   1  4

Relocation section '.rel.text' at offset 0x100 contains 3 entries:
 Offset     Info    Type                Sym. Value  Symbol's Name
00000000  00000205 R_MIPS_HI16            00008000   far_data
00000004  00000206 R_MIPS_LO16            00008000   far_data
00000008  00000104 R_MIPS_26              00000000   func

Relocation section '.rel.data' at offset 0x118 contains 2 entries:
 Offset     Info    Type                Sym. Value  Symbol's Name
00000000  00000102 R_MIPS_32              00000000   func
00000004  00000302 R_MIPS_32              00000000   ext_data

Symbol table '.symtab' contains 4 entries:
   Num:    Value  Size Type    Bind   Vis      Ndx Name
     0: 00000000     0 NOTYPE  LOCAL  DEFAULT  UND
     1: 00000000    16 FUNC    GLOBAL DEFAULT    1 func
     2: 00008000     4 OBJECT  GLOBAL DEFAULT    3 far_data
     3: 00000000     0 NOTYPE  GLOBAL DEFAULT  UND ext_data
`;

// Ghidra placement: .text 0x10000, .data 0x10010, EXTERNAL 0x19000. far_data
// is at 0x18010, so its LO16 is 0x8010 and the HI16 must carry to 2.
const fileBytes = Buffer.alloc(0x50 + 0x8010);
fileBytes.writeUInt32LE(0x3c010000, 0x40); // lui $1, 0
fileBytes.writeUInt32LE(0x8c220000, 0x44); // lw $2, 0($1)
fileBytes.writeUInt32LE(0x0c000000, 0x48); // jal 0
const segments = [
  { name: ".text", start: "0x10000", end: "0x10010" },
  { name: ".data", start: "0x10010", end: "0x18020" },
  { name: "EXTERNAL", start: "0x19000", end: "0x19004" },
];
const mappings = [
  { block: ".text", start: "0x10000", length: 0x10, file_offset: 0x40 },
  { block: ".data", start: "0x10010", length: 0x8010, file_offset: 0x50 },
];
const names = [
  {
    address: "0x19000",
    value: "ext_data",
    symbol: { external: false, type: "label" },
  },
];
const relocations = () => [
  { address: "0x10000", type: 5, status: "PARTIAL" },
  { address: "0x10004", type: 6, status: "APPLIED" },
  { address: "0x10008", type: 4, status: "APPLIED" },
  { address: "0x10010", type: 2, status: "APPLIED" },
  { address: "0x10014", type: 2, status: "APPLIED" },
  { address: ".pdr:0x0", type: 2, status: "APPLIED" },
];
const words = () =>
  new Map([
    [0x10000n, 0x3c010002],
    [0x10004n, 0x8c228010],
    [0x10008n, 0x0c004000],
    [0x10010n, 0x10000],
    [0x10014n, 0x19000],
  ]);
const check = (
  overrides: Partial<Parameters<typeof assertMipsRelocations>[0]> = {},
) =>
  assertMipsRelocations({
    facts: parseMipsRelocatableReadelf(readelf),
    fileBytes,
    segments,
    mappings,
    ghidraRelocations: relocations(),
    words: words(),
    names,
    byteOrder: "little",
    ...overrides,
  });

describe("MIPS relocatable real-verifier expectations", () => {
  it("reads sections, symbols and REL entries from r_info", () => {
    const facts = parseMipsRelocatableReadelf(readelf);
    expect(facts.sections.get(3)).toMatchObject({
      name: ".data",
      offset: 0x50,
      allocated: true,
    });
    expect(facts.symbols.get(3)).toMatchObject({
      ndx: "UND",
      name: "ext_data",
    });
    expect(facts.relocations).toEqual([
      expect.objectContaining({ section: ".text", type: 5, symbolIndex: 2 }),
      expect.objectContaining({ section: ".text", type: 6, symbolIndex: 2 }),
      expect.objectContaining({ section: ".text", type: 4, symbolIndex: 1 }),
      expect.objectContaining({ section: ".data", type: 2, symbolIndex: 1 }),
      expect.objectContaining({ section: ".data", type: 2, symbolIndex: 3 }),
    ]);
  });

  it("rejects a REL table whose entry count disagrees with its header", () => {
    expect(() =>
      parseMipsRelocatableReadelf(
        readelf.replace("contains 2 entries", "contains 3 entries"),
      ),
    ).toThrow(/entry count/u);
  });

  it("accepts relocations that encode S + A, including a HI16 carry", () => {
    expect(check()).toMatchObject({
      lo16_carry: true,
      external_data: true,
      types: { R_MIPS_HI16: 1, R_MIPS_LO16: 1, R_MIPS_26: 1, R_MIPS_32: 2 },
    });
  });

  it.each([
    ["a HI16 without the signed-low carry", 0x10000n, 0x3c010001],
    ["a jump to the wrong target", 0x10008n, 0x0c004001],
    ["a rewritten opcode", 0x10004n, 0x8c238010],
    ["an unrelocated external word", 0x10014n, 0],
  ])("rejects %s", (_label, address, value) => {
    const changed = words();
    changed.set(address, value);
    expect(() => check({ words: changed })).toThrow();
  });

  it("rejects a failed or missing Ghidra relocation", () => {
    const failed = relocations().map((item, index) =>
      index === 2 ? { ...item, status: "FAILURE" } : item,
    );
    expect(() => check({ ghidraRelocations: failed })).toThrow(/FAILURE/u);
    expect(() => check({ ghidraRelocations: relocations().slice(1) })).toThrow(
      /relocation count/u,
    );
  });

  it("rejects a section Ghidra placed from different file bytes", () => {
    expect(() =>
      check({
        mappings: mappings.map((item) =>
          item.block === ".data" ? { ...item, file_offset: 0x60 } : item,
        ),
      }),
    ).toThrow(/\.data offset/u);
  });

  it("counts a relocation against an empty section as unplaced, not verified", () => {
    const withEmpty = readelf
      .replace(
        "  [ 5] .symtab",
        "  [ 6] .sbss             NOBITS          00000000 008060 000000 00 WAp  0   0  4\n  [ 5] .symtab",
      )
      .replace("contains 2 entries", "contains 3 entries")
      .replace(
        "00000004  00000302 R_MIPS_32              00000000   ext_data\n",
        "00000004  00000302 R_MIPS_32              00000000   ext_data\n00000008  00000402 R_MIPS_32              00000000   .sbss\n",
      )
      .replace(
        "     3: 00000000     0 NOTYPE  GLOBAL DEFAULT  UND ext_data\n",
        "     3: 00000000     0 NOTYPE  GLOBAL DEFAULT  UND ext_data\n     4: 00000000     0 SECTION LOCAL  DEFAULT    6 .sbss\n",
      );
    const loaded = words();
    loaded.set(0x10018n, 0x12345678);
    expect(
      check({
        facts: parseMipsRelocatableReadelf(withEmpty),
        ghidraRelocations: [
          ...relocations(),
          { address: "0x10018", type: 2, status: "APPLIED" },
        ],
        words: loaded,
      }).unplaced,
    ).toBe(1);
  });
});

describe("MIPS relocatable HI16 entries resolved by one LO16", () => {
  // lui $1; lui $3; jal (unrelated R_MIPS_26); lw: both HI16s pair with the LO16.
  const multi = readelf.replace(
    /Relocation section '\.rel\.text'[^]*?\n\n/u,
    [
      "Relocation section '.rel.text' at offset 0x100 contains 4 entries:",
      " Offset     Info    Type                Sym. Value  Symbol's Name",
      "00000000  00000205 R_MIPS_HI16            00008000   far_data",
      "00000004  00000205 R_MIPS_HI16            00008000   far_data",
      "00000008  00000104 R_MIPS_26              00000000   func",
      "0000000c  00000206 R_MIPS_LO16            00008000   far_data",
      "",
      "",
    ].join("\n"),
  );
  const bytes = Buffer.from(fileBytes);
  bytes.writeUInt32LE(0x3c010000, 0x40); // lui $1, 0
  bytes.writeUInt32LE(0x3c030000, 0x44); // lui $3, 0
  bytes.writeUInt32LE(0x0c000000, 0x48); // jal 0
  bytes.writeUInt32LE(0x8c220000, 0x4c); // lw $2, 0($1)
  const ghidra = () => [
    { address: "0x10000", type: 5, status: "PARTIAL" },
    { address: "0x10004", type: 5, status: "PARTIAL" },
    { address: "0x10008", type: 4, status: "APPLIED" },
    { address: "0x1000c", type: 6, status: "APPLIED" },
    { address: "0x10010", type: 2, status: "APPLIED" },
    { address: "0x10014", type: 2, status: "APPLIED" },
  ];
  const loaded = () =>
    new Map([
      [0x10000n, 0x3c010002],
      [0x10004n, 0x3c030002],
      [0x10008n, 0x0c004000],
      [0x1000cn, 0x8c228010],
      [0x10010n, 0x10000],
      [0x10014n, 0x19000],
    ]);
  const checkMulti = (
    overrides: Partial<Parameters<typeof assertMipsRelocations>[0]> = {},
  ) =>
    check({
      facts: parseMipsRelocatableReadelf(multi),
      fileBytes: bytes,
      ghidraRelocations: ghidra(),
      words: loaded(),
      ...overrides,
    });

  it("checks every HI16 against the LO16, across unrelated relocations", () => {
    expect(checkMulti()).toMatchObject({
      multiple_hi16: true,
      lo16_carry: true,
    });
  });

  it("rejects a bad earlier HI16 that a later HI16 would have hidden", () => {
    const words = loaded();
    words.set(0x10000n, 0x3c010001);
    expect(() => checkMulti({ words })).toThrow(/HI16 at 0x10000 /u);
  });

  it("rejects a HI16 that no LO16 resolves", () => {
    const unmatched = multi
      .replace("contains 4 entries", "contains 3 entries")
      .replace(
        "0000000c  00000206 R_MIPS_LO16            00008000   far_data\n",
        "",
      );
    expect(() =>
      checkMulti({
        facts: parseMipsRelocatableReadelf(unmatched),
        ghidraRelocations: ghidra().filter(
          (item) => item.address !== "0x1000c",
        ),
      }),
    ).toThrow(/without a following LO16/u);
  });
});
