import { describe, expect, it } from "vitest";
import {
  assertPowerPcGlobal,
  assertPowerPcLoadedImage,
  assertPowerPcProbe,
  parsePowerPcReadelf,
} from "./ppc-checks.mjs";

// GNU readelf 2.47 output for the source-owned Clang 23 / LLD fixture.
// This tests the reader boundary, not Ghidra; the real lane rebuilds it.
const readelf = `ELF Header:
  Magic:   7f 45 4c 46 01 02 01 00 00 00 00 00 00 00 00 00
  Class:                             ELF32
  Data:                              2's complement, big endian
  Version:                           1 (current)
  OS/ABI:                            UNIX - System V
  ABI Version:                       0
  Type:                              EXEC (Executable file)
  Machine:                           PowerPC
  Version:                           0x1
  Entry point address:               0x100101b0
  Start of program headers:          52 (bytes into file)
  Start of section headers:          2188 (bytes into file)
  Flags:                             0x0
  Size of this header:               52 (bytes)
  Size of program headers:           32 (bytes)
  Number of program headers:         6
  Size of section headers:           40 (bytes)
  Number of section headers:         18
  Section header string table index: 16

Symbol table '.symtab' contains 7 entries:
   Num:    Value  Size Type    Bind   Vis      Ndx Name
     0: 00000000     0 NOTYPE  LOCAL  DEFAULT  UND
     1: 00000000     0 FILE    LOCAL  DEFAULT  ABS ppc.c
     2: 10010180    48 FUNC    GLOBAL DEFAULT    4 rea_ppc_leaf
     3: 1002023c     4 OBJECT  GLOBAL DEFAULT    5 rea_ppc_global
     4: 100101b0   116 FUNC    GLOBAL DEFAULT    4 rea_ppc_entry
     5: 100000f4    29 OBJECT  GLOBAL DEFAULT    1 rea_ppc_marker
     6: 10010224    24 FUNC    GLOBAL DEFAULT    4 rea_ppc_probe
`;
const sha256 = "a".repeat(64);
const image = {
  language_id: "PowerPC:BE:32:default",
  compiler_spec_id: "default",
  source_files: [{ original_sha256: sha256, modified_sha256: sha256 }],
};
const move = {
  address: "0x10010224",
  status: "decoded",
  architecture: "PowerPC:BE:32:default",
  length: 4,
  bytes: "38641234",
  mnemonic: "addi",
  operands: [
    { index: 2, components: [{ kind: "immediate", value: "0x1234" }] },
  ],
};
const branch = {
  address: "0x1001022c",
  status: "decoded",
  architecture: "PowerPC:BE:32:default",
  length: 4,
  bytes: "41820008",
  mnemonic: "beq",
  flow: {
    kind: "jump",
    conditional: true,
    computed: false,
    direct_destinations: ["0x10010234"],
  },
};

describe("PowerPC real-verifier independent expectations", () => {
  it("reads GNU header and defined symbols without a Ghidra-derived oracle", () => {
    const parsed = parsePowerPcReadelf(readelf);
    expect(parsed.powerpc).toEqual({
      elfClass: 32,
      byteOrder: "big",
      type: 2,
      flags: 0,
    });
    expect(parsed.symbols.rea_ppc_probe).toBe("0x10010224");
  });

  it.each([
    ["wrong class", "ELF32", "ELF64"],
    ["wrong byte order", "big endian", "little endian"],
    [
      "wrong machine",
      "Machine:                           PowerPC",
      "Machine: PowerPC64",
    ],
    ["wrong object type", "EXEC (Executable file)", "DYN (Shared object file)"],
    [
      "wrong flags",
      "Flags:                             0x0",
      "Flags: 0x80000000",
    ],
    ["missing symbol", "rea_ppc_probe", "unrelated_probe"],
  ])(
    "rejects %s instead of returning a guessed fixture interpretation",
    (_name, from, to) => {
      expect(() => parsePowerPcReadelf(readelf.replace(from, to))).toThrow();
    },
  );

  it("rejects ambiguous producer fields", () => {
    expect(() => parsePowerPcReadelf(`${readelf}\nClass: ELF32\n`)).toThrow(
      /ambiguous/u,
    );
  });

  it("checks the effective loaded image, including Ghidra's e500 default", () => {
    assertPowerPcLoadedImage(image, sha256);
    expect(() =>
      assertPowerPcLoadedImage(
        { ...image, language_id: "PowerPC:BE:32:e500" },
        sha256,
      ),
    ).toThrow();
    expect(() =>
      assertPowerPcLoadedImage(
        { ...image, compiler_spec_id: "macosx" },
        sha256,
      ),
    ).toThrow();
    expect(() =>
      assertPowerPcLoadedImage(
        {
          ...image,
          source_files: [
            { original_sha256: sha256, modified_sha256: "b".repeat(64) },
          ],
        },
        sha256,
      ),
    ).toThrow();
  });

  it("checks exact probe bytes, immediate and conditional destination", () => {
    assertPowerPcProbe(move, branch, "0x10010224");
  });

  it("rejects plausible nonempty but incorrect instruction observations", () => {
    expect(() =>
      assertPowerPcProbe({ ...move, bytes: "38641235" }, branch, "0x10010224"),
    ).toThrow();
    expect(() =>
      assertPowerPcProbe({ ...move, length: 2 }, branch, "0x10010224"),
    ).toThrow();
    expect(() =>
      assertPowerPcProbe(
        {
          ...move,
          operands: [
            { index: 2, components: [{ kind: "immediate", value: "0x1235" }] },
          ],
        },
        branch,
        "0x10010224",
      ),
    ).toThrow();
    expect(() =>
      assertPowerPcProbe(
        move,
        {
          ...branch,
          flow: { ...branch.flow, direct_destinations: ["0x10010230"] },
        },
        "0x10010224",
      ),
    ).toThrow();
    expect(() =>
      assertPowerPcProbe(
        move,
        { ...branch, flow: { ...branch.flow, conditional: false } },
        "0x10010224",
      ),
    ).toThrow();
  });

  it("checks the big-endian global word", () => {
    assertPowerPcGlobal("00000007");
    expect(() => assertPowerPcGlobal("07000000")).toThrow();
  });
});
