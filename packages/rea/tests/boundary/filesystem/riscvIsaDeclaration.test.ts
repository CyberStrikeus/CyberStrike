import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import type { RiscvIsaDeclaration } from "../../../src/domain/binaryTargetTypes.js";
import { ghidraRiscvUnsupportedReason } from "../../../src/ghidra/GhidraRiscvProfile.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const SHT_RISCV_ATTRIBUTES = 0x70000003;
const SECTION_TABLE = 128;
// Deliberately outside BinaryTargetResolver's 4 KiB probe.
const PAYLOADS = 8192;

const attributes = (arch: string | null, vendor = "riscv"): Buffer => {
  const list = [
    4,
    16, // Tag_RISCV_stack_align
    ...(arch === null ? [] : [5, ...Buffer.from(`${arch}\0`, "latin1")]),
  ];
  const scoped = Buffer.alloc(5 + list.length);
  scoped[0] = 1; // Tag_File
  scoped.writeUInt32LE(scoped.length, 1);
  scoped.set(list, 5);
  const name = Buffer.from(`${vendor}\0`, "latin1");
  const header = Buffer.alloc(5);
  header[0] = 0x41;
  header.writeUInt32LE(4 + name.length + scoped.length, 1);
  return Buffer.concat([header, name, scoped]);
};

/** An ELF32 RISC-V soft-float image with one section header per payload. */
const elf = (
  sections: readonly { type: number; payload: Buffer }[],
): Buffer => {
  const payloadBytes = sections.reduce(
    (total, section) => total + section.payload.length,
    0,
  );
  const bytes = Buffer.alloc(PAYLOADS + payloadBytes);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1]);
  bytes.writeUInt16LE(2, 16); // ET_EXEC
  bytes.writeUInt16LE(243, 18); // EM_RISCV
  bytes.writeUInt32LE(1, 20);
  bytes.writeUInt32LE(SECTION_TABLE, 32);
  bytes.writeUInt32LE(0x1, 36); // RVC, soft-float ABI
  bytes.writeUInt16LE(52, 40);
  bytes.writeUInt16LE(32, 42);
  bytes.writeUInt16LE(40, 46);
  bytes.writeUInt16LE(1 + sections.length, 48);
  let offset = PAYLOADS;
  sections.forEach(({ type, payload }, index) => {
    const header = SECTION_TABLE + (1 + index) * 40;
    bytes.writeUInt32LE(type, header + 4);
    bytes.writeUInt32LE(offset, header + 16);
    bytes.writeUInt32LE(payload.length, header + 20);
    payload.copy(bytes, offset);
    offset += payload.length;
  });
  return bytes;
};

const resolveIsa = async (bytes: Buffer) => {
  const directory = await createTestTempDirectory("rea-riscv-isa-test-");
  const path = join(directory, "fixture.elf");
  await writeFile(path, bytes);
  const resolved = await parseBinaryTarget(path);
  if (!resolved.ok) throw resolved.error;
  if (
    resolved.value.kind !== "executable" ||
    resolved.value.architecture !== "riscv"
  )
    throw new Error("Expected a resolved RISC-V executable");
  return {
    isa: resolved.value.riscv.isa,
    refusal: ghidraRiscvUnsupportedReason(resolved.value),
  };
};

const C3_ARCH = "rv32i2p1_m2p0_c2p0_zicsr2p0_zifencei2p0_zmmul1p0";

describe("RISC-V ISA declarations at target resolution", () => {
  it("reads Tag_RISCV_arch beyond the header probe and admits the ilp32 lane", async () => {
    expect(
      await resolveIsa(
        elf([
          { type: 1, payload: Buffer.from([0x13, 0, 0, 0]) },
          { type: SHT_RISCV_ATTRIBUTES, payload: attributes(C3_ARCH) },
        ]),
      ),
    ).toEqual({
      isa: {
        status: "declared",
        arch: C3_ARCH,
        xlen: 32,
        base: "i",
        extensions: ["m", "c", "zicsr", "zifencei", "zmmul"],
      },
      refusal: null,
    });
  });

  it.each([
    ["no attribute section", [], { status: "absent" }, "declares none"],
    [
      "an attribute section without Tag_RISCV_arch",
      [{ type: SHT_RISCV_ATTRIBUTES, payload: attributes(null) }],
      { status: "absent" },
      "declares none",
    ],
    [
      "another vendor's attributes",
      [{ type: SHT_RISCV_ATTRIBUTES, payload: attributes(C3_ARCH, "gnu") }],
      {
        status: "unavailable",
        reason:
          "RISC-V ELF declares non-riscv vendor attributes that REA does not inspect",
      },
      "readable Tag_RISCV_arch declaration",
    ],
    [
      "two attribute sections",
      [
        { type: SHT_RISCV_ATTRIBUTES, payload: attributes(C3_ARCH) },
        { type: SHT_RISCV_ATTRIBUTES, payload: attributes(C3_ARCH) },
      ],
      {
        status: "unavailable",
        reason: "the image has more than one RISC-V attribute section",
      },
      "more than one RISC-V attribute section",
    ],
    [
      "an attribute section beyond the inspected bound",
      [{ type: SHT_RISCV_ATTRIBUTES, payload: Buffer.alloc(4097, 0x41) }],
      {
        status: "unavailable",
        reason:
          "RISC-V attribute section size 4097 is outside REA's inspected bound of 4096 bytes",
      },
      "inspected bound",
    ],
    [
      "an extension outside the decoded set",
      [
        {
          type: SHT_RISCV_ATTRIBUTES,
          payload: attributes(`${C3_ARCH}_zcmp1p0`),
        },
      ],
      {
        status: "declared",
        arch: `${C3_ARCH}_zcmp1p0`,
        xlen: 32,
        base: "i",
        extensions: ["m", "c", "zicsr", "zifencei", "zmmul", "zcmp"],
      },
      "outside the set this lane decodes: zcmp.",
    ],
  ] as const)(
    "keeps %s visible and refuses the ilp32 lane",
    async (_label, sections, isa: RiscvIsaDeclaration, refusal) => {
      const resolved = await resolveIsa(elf(sections));
      expect(resolved.isa).toEqual(isa);
      expect(resolved.refusal).toContain(refusal);
    },
  );
});
