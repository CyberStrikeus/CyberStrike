import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeWindowsGhidraByteSearchFixture } from "./lib/ghidra-windows-byte-search.mjs";

import {
  WINDOWS_GHIDRA_FIXTURE_ARCHITECTURES,
  windowsGhidraFixtureOptions,
} from "./lib/ghidra-windows-fixture-options.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Source-owned static fixtures: no compiler, target loading or execution.
for (const architecture of WINDOWS_GHIDRA_FIXTURE_ARCHITECTURES) {
  for (const dll of [false, true]) {
    const x86 = architecture === "x86";
    const arm = architecture === "arm";
    const arm64 = architecture === "arm64";
    const fixture = windowsGhidraFixtureOptions([
      ...(architecture === "x86_64" ? [] : [`--${architecture}`]),
      ...(dll ? ["--dll"] : []),
    ]);
    const pe32 = fixture.pe32;
    const output = resolve(root, "build", "fixtures", fixture.filename);
    const bytes = Buffer.alloc(dll ? 1024 : 1536);
    const peOffset = 0x80;
    const optionalHeader = peOffset + 24;
    const optionalHeaderSize = pe32 ? 0xe0 : 0xf0;
    const sectionTable = optionalHeader + optionalHeaderSize;
    const directories = optionalHeader + (pe32 ? 96 : 112);

    bytes.write("MZ", 0, "ascii");
    bytes.writeUInt32LE(peOffset, 0x3c);
    bytes.write("PE\0\0", peOffset, "binary");
    // The fixture descriptor owns COFF machine, width and function coordinates.
    bytes.writeUInt16LE(fixture.machine, peOffset + 4);
    bytes.writeUInt16LE(dll ? 1 : 2, peOffset + 6);
    bytes.writeUInt16LE(optionalHeaderSize, peOffset + 20);
    bytes.writeUInt16LE(
      (pe32 ? 0x102 : 0x22) | (dll ? 0x2000 : 0),
      peOffset + 22,
    );

    // ARM64 PE uses the PE32+ optional header (magic 0x20b), like x86-64.
    bytes.writeUInt16LE(pe32 ? 0x10b : 0x20b, optionalHeader);
    bytes.writeUInt32LE(0x200, optionalHeader + 4);
    if (!dll) bytes.writeUInt32LE(0x200, optionalHeader + 8);
    bytes.writeUInt32LE(dll ? 0 : arm ? 0x1001 : 0x1000, optionalHeader + 16);
    bytes.writeUInt32LE(0x1000, optionalHeader + 20);
    if (pe32)
      bytes.writeUInt32LE(Number(fixture.imageBase), optionalHeader + 28);
    else bytes.writeBigUInt64LE(fixture.imageBase, optionalHeader + 24);
    bytes.writeUInt32LE(0x1000, optionalHeader + 32);
    bytes.writeUInt32LE(0x200, optionalHeader + 36);
    bytes.writeUInt16LE(6, optionalHeader + 40);
    bytes.writeUInt16LE(6, optionalHeader + 48);
    bytes.writeUInt32LE(dll ? 0x2000 : 0x3000, optionalHeader + 56);
    bytes.writeUInt32LE(0x200, optionalHeader + 60);
    bytes.writeUInt16LE(3, optionalHeader + 68);
    bytes.writeUInt16LE(pe32 ? 0x8140 : 0x8160, optionalHeader + 70);
    if (pe32) {
      bytes.writeUInt32LE(0x10_0000, optionalHeader + 72);
      bytes.writeUInt32LE(0x1000, optionalHeader + 76);
      bytes.writeUInt32LE(0x10_0000, optionalHeader + 80);
      bytes.writeUInt32LE(0x1000, optionalHeader + 84);
      bytes.writeUInt32LE(16, optionalHeader + 92);
    } else {
      bytes.writeBigUInt64LE(0x10_0000n, optionalHeader + 72);
      bytes.writeBigUInt64LE(0x1000n, optionalHeader + 80);
      bytes.writeBigUInt64LE(0x10_0000n, optionalHeader + 88);
      bytes.writeBigUInt64LE(0x1000n, optionalHeader + 96);
      bytes.writeUInt32LE(16, optionalHeader + 108);
    }

    bytes.write(".text", sectionTable, "ascii");
    bytes.writeUInt32LE(0x200, sectionTable + 8);
    bytes.writeUInt32LE(0x1000, sectionTable + 12);
    bytes.writeUInt32LE(0x200, sectionTable + 16);
    bytes.writeUInt32LE(0x200, sectionTable + 20);
    bytes.writeUInt32LE(0x6000_0020, sectionTable + 36);

    // EXE entry returns zero. DLL caller adds one to the callee's 42.
    if (arm) {
      // ARMNT uses Thumb instructions and low-bit-tagged PE entry/export RVAs.
      // PUSH keeps SP aligned and preserves LR across BL from 0x1002 to 0x1020.
      bytes.set(
        [
          0x10,
          0xb5,
          0x00,
          0xf0,
          0x0d,
          0xf8,
          dll ? 0x01 : 0x00,
          dll ? 0x30 : 0x20,
          0x10,
          0xbd,
        ],
        0x200,
      );
      bytes.set([0x2a, 0x20, 0x70, 0x47], 0x220);
    } else if (arm64) {
      // Preserve the caller's frame/link registers across BL. The callee
      // starts at RVA 0x1020, outside the five-instruction caller.
      const instructions = [
        0xa9bf7bfd, // STP X29, X30, [SP, #-16]!
        0x94000007, // BL +0x1c from RVA 0x1004 to RVA 0x1020
        dll ? 0x11000400 : 0x52800000, // ADD W0,W0,#1 / MOV W0,#0
        0xa8c17bfd, // LDP X29, X30, [SP], #16
        0xd65f03c0, // RET
      ];
      for (const [index, instruction] of instructions.entries())
        bytes.writeUInt32LE(instruction, 0x200 + index * 4);
      bytes.set([0x40, 0x05, 0x80, 0x52, 0xc0, 0x03, 0x5f, 0xd6], 0x220);
    } else {
      bytes.set(
        dll
          ? [0xe8, 0x0b, 0, 0, 0, 0x83, 0xc0, 1, 0xc3]
          : [0xe8, 0x0b, 0, 0, 0, 0xe8, 0x16, 0, 0, 0, 0x31, 0xc0, 0xc3],
        0x200,
      );
      bytes.set(
        x86 && !dll
          ? [0xb8, 0x2a, 0, 0, 0, 0xe8, 0x66, 0, 0, 0, 0xc3]
          : [0xb8, 0x2a, 0, 0, 0, 0xc3],
        0x210,
      );
    }

    if (x86 && !dll) {
      // A statically analyzed Borland-style SEH registration whose handler
      // entry is referenced but is not part of the registering function body.
      bytes.set(
        [
          0x55, // PUSH EBP
          0x89,
          0xe5, // MOV EBP, ESP
          0x68,
          0xc0,
          0x10,
          0x40,
          0x00, // PUSH 0x4010c0
          0x64,
          0xff,
          0x35,
          0,
          0,
          0,
          0, // PUSH DWORD PTR FS:[0]
          0x64,
          0x89,
          0x25,
          0,
          0,
          0,
          0, // MOV DWORD PTR FS:[0], ESP
          0x64,
          0x8f,
          0x05,
          0,
          0,
          0,
          0, // POP DWORD PTR FS:[0]
          0x83,
          0xc4,
          0x04, // ADD ESP, 4
          0x5d, // POP EBP
          0xc3, // RET
        ],
        0x280,
      );
      bytes.set([0xc3], 0x2c0);
    }

    if (!dll) {
      const dataSection = sectionTable + 40;
      bytes.write(".data", dataSection, "ascii");
      bytes.writeUInt32LE(0x20, dataSection + 8);
      bytes.writeUInt32LE(0x2000, dataSection + 12);
      bytes.writeUInt32LE(0x200, dataSection + 16);
      bytes.writeUInt32LE(0x400, dataSection + 20);
      bytes.writeUInt32LE(0xc000_0040, dataSection + 36);
      bytes.writeUInt32LE(0x1122_3344, 0x400);
      const referenceInstructions = x86
        ? [
            "ba00204000", // MOV EDX, address: DATA only.
            "a100204000", // MOV EAX, [address]: READ.
            "a304204000", // MOV [address], EAX: WRITE.
            "ba10204000", // Indexed base, unknown ECX.
            "85db", // TEST EBX, EBX: two candidate bases.
            "7405", // JZ over the alternate base.
            "ba18204000", // MOV EDX, alternate base.
            "c6040a01", // MOV byte [EDX + ECX], 1.
            "ffd7", // CALL EDI: unknown target.
            "c3",
          ]
        : arm
          ? ["7047"] // Thumb return; x86 reference-flow controls do not apply.
          : arm64
            ? [
                "010000b0", // ADRP X1, .data page (RVA 0x2000): DATA.
                "200040b9", // LDR W0, [X1]: READ.
                "200000b9", // STR W0, [X1]: WRITE.
                "c0035fd6", // RET.
              ]
            : [
                "488d15d90f0000", // LEA RDX, [RIP + displacement]: DATA.
                "8b05d30f0000", // MOV EAX, [RIP + displacement]: READ.
                "8905d10f0000", // MOV [RIP + displacement], EAX: WRITE.
                "488d15d60f0000", // Indexed base, unknown RCX.
                "85db", // TEST EBX, EBX: two candidate bases.
                "7407", // JZ over the alternate base.
                "488d15d30f0000", // LEA RDX, alternate base.
                "c6040a01", // MOV byte [RDX + RCX], 1.
                "41ffd0", // CALL R8: unknown target.
                "c3",
              ];
      bytes.set(
        Buffer.from(referenceInstructions.join(""), "hex"),
        arm || arm64 ? 0x230 : 0x220,
      );
    }

    if (dll) {
      // Export both functions; an entry-point-free library is discovered by exports.
      bytes.writeUInt32LE(0x1040, directories);
      bytes.writeUInt32LE(0x130, directories + 4);
      const exports = 0x240;
      bytes.writeUInt32LE(0x1100, exports + 12);
      bytes.writeUInt32LE(1, exports + 16);
      bytes.writeUInt32LE(2, exports + 20);
      bytes.writeUInt32LE(2, exports + 24);
      bytes.writeUInt32LE(0x1080, exports + 28);
      bytes.writeUInt32LE(0x1088, exports + 32);
      bytes.writeUInt32LE(0x1090, exports + 36);
      bytes.writeUInt32LE(arm ? 0x1001 : 0x1000, 0x280);
      bytes.writeUInt32LE(fixture.calleeRva + (arm ? 1 : 0), 0x284);
      bytes.writeUInt32LE(0x1120, 0x288);
      bytes.writeUInt32LE(0x1140, 0x28c);
      bytes.writeUInt16LE(0, 0x290);
      bytes.writeUInt16LE(1, 0x292);
      bytes.write("rea-fixture.dll\0", 0x300, "binary");
      bytes.write("fixture_caller\0", 0x320, "binary");
      bytes.write("fixture_return42\0", 0x340, "binary");
    }

    writeWindowsGhidraByteSearchFixture(bytes);

    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, bytes);
    if (architecture === "x86_64" && !dll) process.stdout.write(`${output}\n`);
  }
}
