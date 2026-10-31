import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { open, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import {
  assertMipsCarvedTargetRefusal,
  carveMipsElfBeforeSectionTable,
} from "../../conformance/ghidra/mips-checks.mjs";
import { jsonObjectSchema } from "../../../src/domain/jsonValue.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { expectBinaryTargetError } from "../../fixtures/binaryTargetAdmission.js";
import type { MipsElfMetadata } from "../../../src/domain/binaryTargetTypes.js";
import {
  readMipsElfMetadata,
  type MipsElfInspection,
} from "../../../src/application/MipsElfMetadata.js";
import { ok } from "../../../src/domain/result.js";
import {
  ghidraMipsProfileParameters,
  ghidraMipsUnsupportedReason,
} from "../../../src/ghidra/GhidraMipsProfile.js";

const metadata = (little = true): MipsElfMetadata => ({
  elfClass: 32,
  byteOrder: little ? "little" : "big",
  type: 2,
  flags: 0x70001001,
});
const abiOffset = 8192; // Deliberately outside BinaryTargetResolver's 4 KiB probe.
const fixture = (little = true): Buffer => {
  const bytes = Buffer.alloc(abiOffset + 48);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 1, little ? 1 : 2, 1]);
  const u16 = (value: number, offset: number) =>
    little
      ? bytes.writeUInt16LE(value, offset)
      : bytes.writeUInt16BE(value, offset);
  const u32 = (value: number, offset: number) =>
    little
      ? bytes.writeUInt32LE(value, offset)
      : bytes.writeUInt32BE(value, offset);
  u16(2, 16);
  u16(8, 18);
  u32(1, 20);
  u32(52, 28);
  u32(128, 32);
  u32(0x70001001, 36);
  u16(52, 40);
  u16(32, 42);
  u16(1, 44);
  u16(40, 46);
  u16(2, 48);
  u32(0x70000003, 52);
  u32(abiOffset, 56);
  u32(24, 68);
  u32(24, 72);
  u32(0x7000002a, 172);
  u32(abiOffset, 184);
  u32(24, 188);
  bytes.set([0, 0, 32, 2, 1, 1, 0, 5], abiOffset);
  return bytes;
};
const attributeSection = (
  attributes: readonly number[],
  little = true,
): Buffer => {
  const subsectionLength = 1 + 4 + attributes.length;
  const vendor = Buffer.from("gnu\0", "latin1");
  const sectionLength = 4 + vendor.length + subsectionLength;
  const bytes = Buffer.alloc(1 + sectionLength);
  bytes[0] = 0x41;
  if (little) {
    bytes.writeUInt32LE(sectionLength, 1);
    bytes.writeUInt32LE(subsectionLength, 1 + 4 + vendor.length + 1);
  } else {
    bytes.writeUInt32BE(sectionLength, 1);
    bytes.writeUInt32BE(subsectionLength, 1 + 4 + vendor.length + 1);
  }
  vendor.copy(bytes, 5);
  bytes[9] = 1; // Tag_File scope.
  bytes.set(attributes, 14);
  return bytes;
};
const withGnuAttributes = (
  source: Buffer,
  payloads: readonly Buffer[],
  little = true,
): Buffer => {
  const payloadStart = abiOffset + 24;
  const payloadBytes = payloads.reduce(
    (total, payload) => total + payload.length,
    0,
  );
  const bytes = Buffer.alloc(
    Math.max(source.length, payloadStart + payloadBytes),
  );
  source.copy(bytes);
  let payloadOffset = payloadStart;
  const write16 = (value: number, offset: number) =>
    little
      ? bytes.writeUInt16LE(value, offset)
      : bytes.writeUInt16BE(value, offset);
  const write32 = (value: number, offset: number) =>
    little
      ? bytes.writeUInt32LE(value, offset)
      : bytes.writeUInt32BE(value, offset);
  write16(2 + payloads.length, 48);
  write16(0, 50); // Section names are not needed for numeric-type detection.
  payloads.forEach((payload, index) => {
    const header = 128 + (2 + index) * 40;
    write32(0x6ffffff5, header + 4);
    write32(payloadOffset, header + 16);
    write32(payload.length, header + 20);
    payload.copy(bytes, payloadOffset);
    payloadOffset += payload.length;
  });
  return bytes;
};
const writeFixture = async (bytes: Buffer): Promise<string> => {
  const directory = await createTestTempDirectory("rea-mips-abi-test-");
  const path = join(directory, "fixture.elf");
  await writeFile(path, bytes);
  return path;
};
const resolveFixture = async (bytes: Buffer) => {
  const path = await writeFixture(bytes);
  const result = await parseBinaryTarget(path);
  if (!result.ok) throw result.error;
  if (
    result.value.kind !== "executable" ||
    result.value.architecture !== "mips"
  )
    throw new Error("Expected a resolved MIPS executable");
  assert.equal(result.value.format, "elf");
  assert.equal(result.value.path, path);
  assert.equal(
    result.value.sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.deepEqual(await readFile(path), bytes);
  return result.value;
};
const refuseFixture = async (bytes: Buffer, reason: string) => {
  const path = await writeFixture(bytes);
  const error = expectBinaryTargetError(await parseBinaryTarget(path));
  assert.equal(error.constraint, "file_format_rejected");
  assert.equal(error.reason, reason);
  assert.deepEqual(await readFile(path), bytes);
};
const withoutSectionTable = (source: Buffer, little = true): Buffer => {
  const bytes = Buffer.from(source);
  if (little) {
    bytes.writeUInt32LE(0, 32);
    bytes.writeUInt16LE(0, 48);
    bytes.writeUInt16LE(0, 50);
  } else {
    bytes.writeUInt32BE(0, 32);
    bytes.writeUInt16BE(0, 48);
    bytes.writeUInt16BE(0, 50);
  }
  return bytes;
};
const inspectDeclarations = async (
  bytes: Buffer,
  little = true,
  checkCancelled: () => void = () => {},
) => {
  const path = await writeFixture(bytes);
  const handle = await open(path, "r");
  try {
    const result = await readMipsElfMetadata(
      handle,
      metadata(little),
      checkCancelled,
    );
    return result;
  } finally {
    await handle.close();
  }
};
const inspect = async (
  bytes: Buffer,
  little = true,
  checkCancelled: () => void = () => {},
) => {
  const result = await inspectDeclarations(bytes, little, checkCancelled);
  return result.ok ? ok(result.value.abiFlags) : result;
};
const target = (mips: MipsElfMetadata) => ({
  path: "/fixture.elf",
  sha256: "a".repeat(64),
  kind: "executable" as const,
  format: "elf" as const,
  architecture: "mips" as const,
  availableArchitectures: ["mips"] as const,
  mips: { gnuAttributes: null, ...mips },
});
const inspectedTarget = (
  header: MipsElfMetadata,
  observed: MipsElfInspection,
) =>
  target({
    ...header,
    abiFlags: observed.abiFlags,
    gnuAttributes: observed.gnuAttributes,
    limitations: observed.limitations,
    ...(observed.sharedLoad === undefined
      ? {}
      : { sharedLoad: observed.sharedLoad }),
  });

for (const little of [true, false]) {
  it(`reads a remote ABI record through both ELF tables (${little ? "LE" : "BE"})`, async () => {
    const bytes = fixture(little);
    const result = await inspect(bytes, little);
    assert.ok(result.ok);
    assert.deepEqual(result.value, {
      version: 0,
      isaLevel: 32,
      isaRevision: 2,
      gprSize: 1,
      cpr1Size: 1,
      cpr2Size: 0,
      fpAbi: 5,
      isaExtension: 0,
      ases: 0,
      flags1: 0,
      flags2: 0,
    });
    const resolved = target({ ...metadata(little), abiFlags: result.value });
    assert.equal(ghidraMipsUnsupportedReason(resolved), null);
    const before = ghidraMipsProfileParameters(resolved);
    bytes[abiOffset + 5] = 2;
    bytes[abiOffset + 7] = 6;
    const fp64 = await inspect(bytes, little);
    assert.ok(fp64.ok);
    const changed = target({ ...metadata(little), abiFlags: fp64.value });
    assert.equal(fp64.value?.cpr1Size, 2);
    assert.equal(fp64.value?.fpAbi, 6);
    assert.match(ghidraMipsUnsupportedReason(changed) ?? "", /FP64/u);
    assert.notDeepEqual(ghidraMipsProfileParameters(changed), before);
  });
}

for (const little of [true, false]) {
  it(`admits a ${little ? "LE" : "BE"} ELF with no section table using PT_MIPS_ABIFLAGS`, async () => {
    const bytes = withoutSectionTable(fixture(little), little);
    const resolved = await resolveFixture(bytes);
    assert.equal(resolved.mips.abiFlags?.fpAbi, 5);
    assert.equal(resolved.mips.limitations, undefined);
    assert.equal(ghidraMipsUnsupportedReason(resolved), null);
  });
  for (const availableBytes of [0, 7, 47]) {
    it(`refuses a carved ${little ? "LE" : "BE"} ELF retaining a truncated section table with ${availableBytes} captured bytes`, async () => {
      const original = fixture(little);
      const bytes = Buffer.concat([original, Buffer.alloc(availableBytes)]);
      const sectionOffset = original.length + (availableBytes === 0 ? 1 : 0);
      if (little) bytes.writeUInt32LE(sectionOffset, 32);
      else bytes.writeUInt32BE(sectionOffset, 32);
      await refuseFixture(
        bytes,
        `truncated ELF section header table: declared file range ${sectionOffset}..${sectionOffset + 80} exceeds the ${bytes.length}-byte file`,
      );
      // The specialized evidence reader may still inspect captured ABI facts.
      // Its partial facts do not authorize opening this damaged target.
      const declarations = await inspectDeclarations(bytes, little);
      assert.ok(declarations.ok);
      assert.equal(declarations.value.abiFlags?.fpAbi, 5);
      const partial = inspectedTarget(metadata(little), declarations.value);
      assert.match(
        ghidraMipsUnsupportedReason(partial) ?? "",
        /ABI declaration inspection is incomplete/u,
      );
      assert.match(
        declarations.value.limitations.join(" "),
        new RegExp(
          `section header table.*examined ${Math.floor(availableBytes / 40)} of 2 complete headers`,
          "u",
        ),
      );
    });
  }
}
it("refuses uncaptured section declarations while retaining unknown ABI evidence and admitting an explicit no-table recordless control", async () => {
  const bytes = fixture();
  bytes.writeUInt32LE(bytes.length + 1, 32);
  bytes.writeUInt32LE(0, 52);
  await refuseFixture(
    bytes,
    `truncated ELF section header table: declared file range ${bytes.length + 1}..${bytes.length + 81} exceeds the ${bytes.length}-byte file`,
  );
  const declarations = await inspectDeclarations(bytes);
  assert.ok(declarations.ok);
  assert.equal(declarations.value.abiFlags, null);
  assert.match(
    ghidraMipsUnsupportedReason(
      inspectedTarget(metadata(), declarations.value),
    ) ?? "",
    /ABI declaration inspection is incomplete.*unavailable headers remain unknown/u,
  );
  const recordless = withoutSectionTable(bytes);
  recordless.writeUInt32LE(0, 28);
  recordless.writeUInt16LE(0, 44);
  recordless.writeUInt32LE(0x50000001, 36); // Explicit legacy MIPS32 lane.
  const resolved = await resolveFixture(recordless);
  assert.equal(resolved.mips.abiFlags, null);
  assert.equal(resolved.mips.limitations, undefined);
  assert.equal(ghidraMipsUnsupportedReason(resolved), null);
});
for (const little of [true, false]) {
  it(`matches the real MIPS lane's carved-copy refusal (${little ? "LE" : "BE"})`, async () => {
    // Linker layout puts the section table last, so the lane's carve keeps
    // every program header and payload while dropping the whole table.
    const original = fixture(little);
    const linked = Buffer.concat([original, original.subarray(128, 208)]);
    if (little) linked.writeUInt32LE(original.length, 32);
    else linked.writeUInt32BE(original.length, 32);
    const carve = carveMipsElfBeforeSectionTable(
      linked,
      little ? "little" : "big",
    );
    const path = await writeFixture(carve.bytes);
    const error = expectBinaryTargetError(await parseBinaryTarget(path));
    // The real lane applies the same check to MCP and CLI error projections.
    assertMipsCarvedTargetRefusal(
      projectAnalysisError(error),
      await realpath(path),
      carve.reason,
    );
    assert.deepEqual(await readFile(path), carve.bytes);
  });
}
for (const failure of ["conflicting", "outside", "duplicate"]) {
  it(`retains ${failure} ABI errors in a partly captured section table`, async () => {
    const original = fixture();
    const count = failure === "duplicate" ? 2 : 1;
    const bytes = Buffer.concat([original, Buffer.alloc(count * 40 + 7)]);
    bytes.writeUInt32LE(original.length, 32);
    bytes.writeUInt16LE(count + 1, 48);
    original.copy(bytes, abiOffset + 24, abiOffset, abiOffset + 24);
    bytes[abiOffset + 24 + 7] = 6;
    for (let i = 0; i < count; i += 1) {
      const position = original.length + i * 40;
      bytes.writeUInt32LE(0x7000002a, position + 4);
      bytes.writeUInt32LE(
        failure === "outside"
          ? 0xfffffff0
          : failure === "conflicting"
            ? abiOffset + 24
            : abiOffset,
        position + 16,
      );
      bytes.writeUInt32LE(24, position + 20);
    }
    const result = await inspect(bytes);
    assert.ok(!result.ok);
    assert.match(result.error, new RegExp(failure, "u"));
  });
}
it("supports a section-only ABI record without assuming its name", async () => {
  const bytes = fixture();
  bytes.writeUInt32LE(0, 28);
  bytes.writeUInt16LE(0, 44);
  const result = await inspect(bytes);
  assert.ok(result.ok);
  assert.equal(result.value?.fpAbi, 5);
});
it("keeps absent ABI declarations unknown and refuses provider admission", async () => {
  const bytes = fixture();
  bytes.writeUInt32LE(0, 52);
  bytes.writeUInt32LE(0, 172);
  const result = await inspect(bytes);
  assert.ok(result.ok);
  assert.equal(result.value, null);
  assert.match(
    ghidraMipsUnsupportedReason(target({ ...metadata(), abiFlags: null })) ??
      "",
    /inspected ABI/u,
  );
  assert.match(
    ghidraMipsUnsupportedReason(target(metadata())) ?? "",
    /inspected ABI/u,
  );
});
it("rejects contradictory program and section ABI declarations", async () => {
  const bytes = fixture();
  bytes.copy(bytes, abiOffset + 24, abiOffset, abiOffset + 24);
  bytes[abiOffset + 24 + 7] = 6;
  bytes.writeUInt32LE(abiOffset + 24, 184);
  const result = await inspect(bytes);
  assert.ok(!result.ok);
  assert.match(result.error, /conflicting/u);
});
it("rejects duplicate ABI declarations in one table", async () => {
  const bytes = fixture();
  bytes.copy(bytes, 84, 52, 84);
  bytes.writeUInt16LE(2, 44);
  const result = await inspect(bytes);
  assert.ok(!result.ok);
  assert.match(result.error, /duplicate/u);
});
const malformed: [string, (bytes: Buffer) => void, RegExp][] = [
  ["record outside file", (b) => b.writeUInt32LE(0xfffffff0, 56), /outside/u],
  ["table outside file", (b) => b.writeUInt32LE(0xfffffff0, 28), /outside/u],
  ["short record", (b) => b.writeUInt32LE(23, 68), /record size/u],
  ["oversized record", (b) => b.writeUInt32LE(0xffffffff, 68), /record size/u],
  ["invalid table stride", (b) => b.writeUInt16LE(31, 42), /entry size/u],
  ["extended program count", (b) => b.writeUInt16LE(0xffff, 44), /numbering/u],
  ["extended section count", (b) => b.writeUInt16LE(0, 48), /extended/u],
  ["changed identity", (b) => b.writeUInt32LE(0x60001001, 36), /identity/u],
  ["invalid ELF version", (b) => b.writeUInt32LE(0, 20), /version/u],
];
for (const [name, change, reason] of malformed) {
  it(`rejects ${name} instead of using a guessed ABI`, async () => {
    const bytes = fixture();
    change(bytes);
    const result = await inspect(bytes);
    assert.ok(!result.ok);
    assert.match(result.error, reason);
  });
}
const unsupported: [string, (bytes: Buffer) => void, RegExp][] = [
  ["new record version", (b) => b.writeUInt16LE(1, abiOffset), /version 0/u],
  [
    "conflicting ISA",
    (b) => {
      b[abiOffset + 3] = 6;
    },
    /MIPS32r2/u,
  ],
  [
    "soft-float with declared CPR1",
    (b) => {
      b[abiOffset + 7] = 3;
    },
    /soft-float without CPR1/u,
  ],
  [
    "unspecified FP ABI",
    (b) => {
      b[abiOffset + 7] = 0;
    },
    /unspecified/u,
  ],
  ["ISA extension", (b) => b.writeUInt32LE(1, abiOffset + 8), /extension/u],
  ["ASE", (b) => b.writeUInt32LE(0x800, abiOffset + 12), /ASE/u],
  [
    "reserved flags",
    (b) => b.writeUInt32LE(2, abiOffset + 16),
    /general flags/u,
  ],
];
for (const [name, change, reason] of unsupported) {
  it(`retains ${name} while rejecting its unverified provider interpretation`, async () => {
    const bytes = fixture();
    change(bytes);
    const result = await inspect(bytes);
    assert.ok(result.ok);
    assert.ok(result.value !== null);
    assert.match(
      ghidraMipsUnsupportedReason(
        target({ ...metadata(), abiFlags: result.value }),
      ) ?? "",
      reason,
    );
  });
}
it.each([true, false])(
  "resolves soft-float ABI metadata and commits its integer-register storage policy (little endian: %s)",
  async (little) => {
    const bytes = fixture(little);
    bytes[abiOffset + 5] = 0;
    bytes[abiOffset + 7] = 3;
    const resolved = await resolveFixture(bytes);
    assert.equal(resolved.mips.abiFlags?.cpr1Size, 0);
    assert.equal(resolved.mips.abiFlags?.fpAbi, 3);
    assert.equal(ghidraMipsUnsupportedReason(resolved), null);
    assert.equal(
      ghidraMipsProfileParameters(resolved).mips_soft_float_storage,
      "o32-soft-float-prototype-v1",
    );
  },
);
it("preserves the caller's cancellation error during table inspection", async () => {
  const cancelled = new Error("caller cancellation sentinel");
  let checks = 0;
  await assert.rejects(
    inspect(fixture(), true, () => {
      checks += 1;
      if (checks === 12) throw cancelled;
    }),
    (error) => error === cancelled,
  );
});

for (const little of [true, false]) {
  it(`resolves full-file MIPS ABI identity before provider selection (${little ? "LE" : "BE"})`, async () => {
    const bytes = fixture(little);
    const resolved = await resolveFixture(bytes);
    assert.equal(resolved.mips.byteOrder, little ? "little" : "big");
    assert.equal(resolved.mips.abiFlags?.fpAbi, 5);
    assert.equal(ghidraMipsUnsupportedReason(resolved), null);
  });
}

it("keeps missing ABI data unknown through the public target resolver", async () => {
  const bytes = fixture();
  bytes.writeUInt32LE(0, 52);
  bytes.writeUInt32LE(0, 172);
  const resolved = await resolveFixture(bytes);
  assert.equal(resolved.mips.abiFlags, null);
  assert.match(ghidraMipsUnsupportedReason(resolved) ?? "", /inspected ABI/u);
});

it("refuses a declared out-of-file ABI payload before specialized ABI inspection", async () => {
  const bytes = fixture();
  bytes.writeUInt32LE(0xfffffff0, 56);
  await refuseFixture(
    bytes,
    `truncated ELF program 0: declared file range 4294967280..4294967304 exceeds the ${bytes.length}-byte file`,
  );
  const specialized = await inspect(bytes);
  assert.ok(!specialized.ok);
  assert.match(specialized.error, /ABI record lies outside the file/u);
});

for (const little of [true, false]) {
  it(`reads bounded GNU FP/MSA attributes through the full target resolver (${little ? "LE" : "BE"})`, async () => {
    const bytes = withGnuAttributes(
      fixture(little),
      [attributeSection([4, 5, 8, 0], little)],
      little,
    );
    const result = await inspectDeclarations(bytes, little);
    assert.ok(result.ok);
    assert.deepEqual(result.value.gnuAttributes, { fpAbi: 5, msa: 0 });
    const resolved = await resolveFixture(bytes);
    assert.deepEqual(resolved.mips.gnuAttributes, { fpAbi: 5, msa: 0 });
    assert.equal(ghidraMipsUnsupportedReason(resolved), null);
    const profileParameters = jsonObjectSchema.parse(
      ghidraMipsProfileParameters(resolved),
    );
    expect(profileParameters.mips_elf).toMatchObject({
      gnu_attributes: { fp_abi: 5, msa: 0 },
    });
  });
}

it("reconciles FP tags with ABI flags while treating FP ANY as no requirement", async () => {
  const any = withGnuAttributes(fixture(), [attributeSection([4, 0])]);
  const accepted = await inspectDeclarations(any);
  assert.ok(accepted.ok);
  assert.equal(accepted.value.gnuAttributes?.fpAbi, 0);

  const conflict = withGnuAttributes(fixture(), [attributeSection([4, 1])]);
  const rejected = await inspectDeclarations(conflict);
  assert.ok(!rejected.ok);
  assert.match(
    rejected.error,
    /conflicting MIPS ABI flags and GNU floating-point ABI/u,
  );
});

it("retains unsupported MSA declarations but refuses provider selection", async () => {
  const bytes = withGnuAttributes(fixture(), [attributeSection([8, 1])]);
  const resolved = await resolveFixture(bytes);
  assert.deepEqual(resolved.mips.gnuAttributes, { fpAbi: null, msa: 1 });
  assert.match(
    ghidraMipsUnsupportedReason(resolved) ?? "",
    /MSA ABI attribute declares an unsupported/u,
  );
});

it.each([
  [0, null],
  [1, null],
  [5, null],
  [2, /GNU floating-point ABI attribute/u],
  [3, /GNU floating-point ABI attribute/u],
] as const)(
  "applies recordless admission to GNU FP value %i",
  async (fpAbi, reason) => {
    const bytes = fixture();
    bytes.writeUInt32LE(0x50000001, 36); // Recordless MIPS32 legacy header.
    bytes.writeUInt32LE(0, 52); // No PT_MIPS_ABIFLAGS.
    bytes.writeUInt32LE(0, 172); // No SHT_MIPS_ABIFLAGS.
    const withAttributes = withGnuAttributes(bytes, [
      attributeSection([4, fpAbi]),
    ]);
    const resolved = await resolveFixture(withAttributes);
    const unsupported = ghidraMipsUnsupportedReason(resolved);
    if (reason === null) assert.equal(unsupported, null);
    else assert.match(unsupported ?? "", reason);
  },
);

it.each([
  ["an unknown attribute tag", [6, 1], /tag 6/u],
  [
    "a duplicate attribute section",
    [4, 5],
    /duplicate MIPS GNU attribute sections/u,
  ],
] as const)(
  "refuses %s while inspecting section contents",
  async (label, attr, reason) => {
    const payload = attributeSection(attr);
    const bytes = withGnuAttributes(
      fixture(),
      label === "a duplicate attribute section"
        ? [payload, payload]
        : [payload],
    );
    const result = await inspectDeclarations(bytes);
    assert.ok(!result.ok);
    assert.match(result.error, reason);
  },
);

it("checks the GNU attribute size bound before attempting its file read", async () => {
  const bytes = withGnuAttributes(fixture(), [attributeSection([4, 5])]);
  bytes.writeUInt32LE(0xfffffff0, 224);
  bytes.writeUInt32LE(4097, 228);
  const result = await inspectDeclarations(bytes);
  assert.ok(!result.ok);
  assert.match(result.error, /outside REA's inspected bound of 4096 bytes/u);
});

it("uses section type and bounds the GNU attribute payload extent", async () => {
  const bytes = withGnuAttributes(fixture(), [attributeSection([4, 5])]);
  bytes.writeUInt32LE(0xffffffff, 208); // Unknown name; type remains authoritative.
  bytes.writeUInt16LE(0, 50); // No section-name string table is required.
  bytes.writeUInt32LE(bytes.length + 1, 224);
  const result = await inspectDeclarations(bytes);
  assert.ok(!result.ok);
  assert.match(result.error, /GNU attribute section lies outside the file/u);
});

it("preserves cancellation instead of turning it into malformed target data", async () => {
  const directory = await createTestTempDirectory("rea-mips-resolution-");
  const path = join(directory, "fixture.elf");
  await writeFile(path, fixture());
  const controller = new AbortController();
  controller.abort();
  const result = await parseBinaryTarget(path, { signal: controller.signal });
  if (result.ok) throw new Error("Cancelled target resolution succeeded");
  assert.ok(result.error instanceof AnalysisCancelledError);
});
