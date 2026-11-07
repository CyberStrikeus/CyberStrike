import { describe, expect, it } from "vitest";

import {
  parseExecutableHeader,
  peDebugDirectoryEntry,
  parsePeRecordFacts,
} from "./binaryTarget.js";
import { dosMz, elf, fat, pe, thinMach } from "./binaryTarget.fixture.js";

describe("executable header parsing", () => {
  it("recognizes a DOS MZ without interpreting load-module bytes as e_lfanew", () => {
    expect(parseExecutableHeader(dosMz(), "x64")).toEqual({
      ok: true,
      value: {
        format: "dos-mz",
        architecture: "x86",
        availableArchitectures: ["x86"],
      },
    });
  });
  it.each([
    [elf(1, 1, 62), "elf", "x86_64"],
    [elf(2, 2, 183), "elf", "arm64"],
    [elf(1, 1, 164), "elf", "hexagon"],
    [thinMach(0xfeedfacf, 0x0100000c), "mach-o", "arm64"],
    [thinMach(0xcefaedfe, 0x01000007), "mach-o", "x86_64"],
    [thinMach(0xcefaedfe, 0x0200000c), "mach-o", "arm64_32"],
    [pe(0x8664), "pe", "x86_64"],
    [pe(0xaa64), "pe", "arm64"],
  ] as const)("parses metadata for %s", (bytes, format, architecture) => {
    const result = parseExecutableHeader(bytes, "arm64");
    expect(result.ok && result.value).toMatchObject({ format, architecture });
  });

  it("retains ELF32 x86-64 identity for the x32 ABI", () => {
    expect(parseExecutableHeader(elf(1, 1, 62), "x64")).toMatchObject({
      ok: true,
      value: { format: "elf", architecture: "x86_64" },
    });
  });

  it("distinguishes native PE applications, DLLs, and managed assemblies", () => {
    const application = parseExecutableHeader(pe(0x8664), "x64");
    const library = parseExecutableHeader(pe(0x8664, 64, 0x2002), "x64");
    const managed = parseExecutableHeader(pe(0x8664, 64, 0x0002, true), "x64");
    const nonExecutable = parseExecutableHeader(pe(0x8664, 64, 0), "x64");

    expect(application.ok && application.value).toMatchObject({
      executableRole: "application",
      managed: false,
    });
    expect(library.ok && library.value).toMatchObject({
      executableRole: "shared-library",
      managed: false,
    });
    expect(managed.ok && managed.value).toMatchObject({
      executableRole: "application",
      managed: true,
    });
    expect(nonExecutable.ok && nonExecutable.value).toMatchObject({
      executableRole: "non-executable",
      managed: false,
    });
  });

  it.each([
    ["Linux x86_64", 0x8664 ^ 0x7b79, "x86_64"],
    ["Linux arm64", 0xaa64 ^ 0x7b79, "arm64"],
    ["Apple x86_64", 0x8664 ^ 0x4644, "x86_64"],
    ["Apple arm64", 0xaa64 ^ 0x4644, "arm64"],
    ["FreeBSD x86_64", 0x8664 ^ 0xadc4, "x86_64"],
    ["OpenBSD x86_64", 0x8664 ^ 0xadc5, "x86_64"],
    ["NetBSD x86_64", 0x8664 ^ 0x1993, "x86_64"],
    ["SunOS x86_64", 0x8664 ^ 0x1992, "x86_64"],
  ] as const)(
    "decodes the %s ReadyToRun OS-override machine on a managed image",
    (_label, machine, architecture) => {
      const result = parseExecutableHeader(
        pe(machine, 64, 0x2002, true),
        "x64",
      );
      expect(result.ok && result.value).toMatchObject({
        format: "pe",
        architecture,
        managed: true,
      });
    },
  );

  it.each([0x014c, 0x8664] as const)(
    "rejects optional-header width inconsistent with machine %s",
    (machine) => {
      const bytes = pe(machine);
      bytes.writeUInt16LE(machine === 0x014c ? 0x20b : 0x10b, 88);
      expect(parseExecutableHeader(bytes, "x64")).toEqual({
        ok: false,
        error: "PE optional-header magic does not match its architecture",
      });
    },
  );

  it("rejects an OS-override machine on a native image", () => {
    const result = parseExecutableHeader(
      pe(0x8664 ^ 0x7b79, 64, 0x2002),
      "x64",
    );
    expect(result).toEqual({
      ok: false,
      error: "unsupported PE architecture",
    });
  });

  it.each([
    Buffer.alloc(0),
    Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
    fat([], 2),
    // A FAT table declaring only unsupported CPU types has nothing to select.
    fat([0x00000012]),
    pe(0xffff),
  ])("rejects malformed, truncated, or unsupported metadata", (bytes) => {
    expect(parseExecutableHeader(bytes, "arm64").ok).toBe(false);
  });

  it("rejects malformed PE optional-header commitments", () => {
    const wrongMagic = pe(0x8664);
    wrongMagic.writeUInt16LE(0x10b, 64 + 24);
    const truncatedDirectories = pe(0x8664);
    truncatedDirectories.writeUInt16LE(112, 64 + 20);
    truncatedDirectories.writeUInt32LE(16, 64 + 24 + 108);

    expect(parseExecutableHeader(wrongMagic, "x64").ok).toBe(false);
    expect(parseExecutableHeader(truncatedDirectories, "x64").ok).toBe(false);
  });
});

describe("FAT Mach-O slice selection", () => {
  it("selects the host architecture from a FAT table", () => {
    const bytes = fat([0x01000007, 0x0100000c]);
    const arm = parseExecutableHeader(bytes, "arm64");
    const intel = parseExecutableHeader(bytes, "x64");
    expect(arm.ok && arm.value).toMatchObject({
      format: "mach-o-universal",
      architecture: "arm64",
      availableArchitectures: ["x86_64", "arm64"],
    });
    expect(intel.ok && intel.value).toMatchObject({
      format: "mach-o-universal",
      architecture: "x86_64",
      availableArchitectures: ["x86_64", "arm64"],
    });
  });

  it("classifies even a one-slice FAT table as a universal container", () => {
    const result = parseExecutableHeader(fat([0x0100000c]), "arm64");

    expect(result).toMatchObject({
      ok: true,
      value: {
        format: "mach-o-universal",
        architecture: "arm64",
        availableArchitectures: ["arm64"],
      },
    });
  });

  it("selects the first valid declared slice when none matches the host", () => {
    const bytes = fat([0x01000007, 0x0100000c]);
    expect(parseExecutableHeader(fat([0x01000007]), "arm64")).toMatchObject({
      ok: true,
      value: {
        format: "mach-o-universal",
        architecture: "x86_64",
        availableArchitectures: ["x86_64"],
      },
    });
    expect(parseExecutableHeader(bytes, "riscv64")).toMatchObject({
      value: {
        architecture: "x86_64",
        availableArchitectures: ["x86_64", "arm64"],
      },
    });
    // A foreign family declared twice, such as arm64 and arm64e, has no
    // provider-neutral slice, whether or not one declaration is undersized.
    const subtypes = fat([0x0100000c, 0x0100000c]);
    expect(parseExecutableHeader(subtypes, "x64")).toMatchObject({
      ok: false,
      error:
        "FAT binary has no x64 slice and no foreign architecture declared exactly once",
    });
    subtypes.writeUInt32BE(31, 8 + 12);
    expect(parseExecutableHeader(subtypes, "x64").ok).toBe(false);
    // A unique foreign family is still selected beside an ambiguous one.
    expect(
      parseExecutableHeader(fat([0x0100000c, 0x0100000c, 0x01000007]), "arm"),
    ).toMatchObject({ value: { architecture: "x86_64" } });
  });
});

describe("executable header completeness", () => {
  const reason = (bytes: Buffer, fileSize = bytes.length) => {
    const result = parseExecutableHeader(bytes, "arm64", fileSize);
    return result.ok ? null : result.error;
  };

  it.each([
    [
      thinMach(0xcffaedfe, 0x0100000c).subarray(0, 12),
      "a 64-bit header needs 32 bytes",
    ],
    [
      thinMach(0xcefaedfe, 0x01000007).subarray(0, 27),
      "a 32-bit header needs 28 bytes",
    ],
    [elf(1, 1, 62).subarray(0, 51), "an ELF32 header needs 52 bytes"],
    [elf(2, 1, 183).subarray(0, 63), "an ELF64 header needs 64 bytes"],
  ])(
    "rejects a header shorter than its fixed size (%#)",
    (bytes, constraint) => {
      expect(reason(bytes)).toContain(constraint);
    },
  );

  it("rejects Mach-O load commands that extend past the file", () => {
    const header = thinMach(0xcffaedfe, 0x0100000c);
    header.writeUInt32LE(1, 16);
    header.writeUInt32LE(100, 20);

    expect(reason(header)).toBe(
      "truncated Mach-O load commands: the header declares 100 bytes after its 32-byte header; the file has 32",
    );
    // The resolver probes a prefix; commitments are checked against the file.
    expect(reason(header, 132)).toBeNull();
  });

  it("rejects an invalid FAT slice even when another host slice is valid", () => {
    const bytes = fat([0x01000007, 0x0100000c]);
    bytes.writeUInt32BE(4096, 8 + 20 + 8);
    bytes.writeUInt32BE(64, 8 + 20 + 12);

    expect(reason(bytes, 4100)).toBe(
      "FAT architecture 1 slice range extends beyond the file",
    );
    expect(reason(bytes, 4160)).toBe(
      "FAT slice identity is outside the bounded prefix",
    );
    expect(parseExecutableHeader(bytes, "x64", 4100)).toMatchObject({
      ok: false,
      error: "FAT architecture 1 slice range extends beyond the file",
    });
  });

  it.each([
    {
      label: "empty range",
      corruptRange: (bytes: Buffer, wide: boolean, littleEndian: boolean) =>
        setFatSliceRange(bytes, {
          wide,
          littleEndian,
          field: "size",
          value: 0n,
        }),
      error: "FAT architecture 1 has an invalid slice range",
    },
    {
      label: "table overlap",
      corruptRange: (bytes: Buffer, wide: boolean, littleEndian: boolean) =>
        setFatSliceRange(bytes, {
          wide,
          littleEndian,
          field: "offset",
          value: BigInt(8 + 2 * (wide ? 32 : 20) - 1),
        }),
      error: "FAT architecture 1 has an invalid slice range",
    },
    {
      label: "undersized 64-bit header",
      corruptRange: (bytes: Buffer, wide: boolean, littleEndian: boolean) =>
        setFatSliceRange(bytes, {
          wide,
          littleEndian,
          field: "size",
          value: 31n,
        }),
      error: "FAT slice for arm64 is shorter than its Mach-O header",
    },
  ])("rejects a selected FAT slice with $label", ({ corruptRange, error }) => {
    for (const [wide, little] of [
      [false, false],
      [true, false],
      [true, true],
    ] as const) {
      const bytes = wide
        ? fat64([0x01000007, 0x0100000c], little)
        : fat([0x01000007, 0x0100000c]);
      expect(parseExecutableHeader(bytes, "arm64").ok).toBe(true);
      corruptRange(bytes, wide, little);
      expect(parseExecutableHeader(bytes, "arm64")).toMatchObject({
        ok: false,
        error,
      });
    }
  });

  it("uses a 28-byte minimum for a selected 32-bit Mach-O header", () => {
    const exactHeader = fat([7]);
    setFatSliceRange(exactHeader, {
      wide: false,
      littleEndian: false,
      field: "size",
      value: 28n,
      index: 0,
    });
    expect(parseExecutableHeader(exactHeader, "ia32").ok).toBe(true);

    const undersizedHeader = Buffer.from(exactHeader);
    setFatSliceRange(undersizedHeader, {
      wide: false,
      littleEndian: false,
      field: "size",
      value: 27n,
      index: 0,
    });

    expect(parseExecutableHeader(undersizedHeader, "ia32")).toMatchObject({
      ok: false,
      error: "FAT slice for x86 is shorter than its Mach-O header",
    });
  });
});

const setFatSliceRange = (
  bytes: Buffer,
  options: {
    readonly wide: boolean;
    readonly littleEndian: boolean;
    readonly field: "offset" | "size";
    readonly value: bigint;
    readonly index?: number;
  },
): void => {
  const { wide, littleEndian, field, value } = options;
  const index = options.index ?? 1;
  const entry = 8 + index * (wide ? 32 : 20);
  const fieldOffset = entry + (field === "offset" ? 8 : wide ? 16 : 12);
  if (wide) {
    if (littleEndian) bytes.writeBigUInt64LE(value, fieldOffset);
    else bytes.writeBigUInt64BE(value, fieldOffset);
  } else {
    const numeric = Number(value);
    if (littleEndian) bytes.writeUInt32LE(numeric, fieldOffset);
    else bytes.writeUInt32BE(numeric, fieldOffset);
  }
};

const fat64 = (cpus: readonly number[], littleEndian: boolean): Buffer => {
  const tableEnd = 8 + cpus.length * 32;
  const sliceStart = Math.ceil(tableEnd / 16) * 16;
  const bytes = Buffer.alloc(sliceStart + cpus.length * 32);
  if (littleEndian) {
    bytes.writeUInt32LE(0xcafebabf, 0);
    bytes.writeUInt32LE(cpus.length, 4);
  } else {
    bytes.writeUInt32BE(0xcafebabf, 0);
    bytes.writeUInt32BE(cpus.length, 4);
  }
  cpus.forEach((cpu, index) => {
    const entry = 8 + index * 32;
    const sliceOffset = BigInt(sliceStart + index * 32);
    if (littleEndian) {
      bytes.writeUInt32LE(cpu, entry);
      bytes.writeBigUInt64LE(sliceOffset, entry + 8);
      bytes.writeBigUInt64LE(32n, entry + 16);
      bytes.writeUInt32LE(4, entry + 24);
    } else {
      bytes.writeUInt32BE(cpu, entry);
      bytes.writeBigUInt64BE(sliceOffset, entry + 8);
      bytes.writeBigUInt64BE(32n, entry + 16);
      bytes.writeUInt32BE(4, entry + 24);
    }
    thinMach(0xfeedfacf, cpu).copy(bytes, Number(sliceOffset));
  });
  return bytes;
};

it.each([
  { magic: 0x10b, directoryOffset: 96 },
  { magic: 0x20b, directoryOffset: 112 },
])(
  "retains a complete debug entry when later declared directories are unavailable ($magic)",
  ({ magic, directoryOffset }) => {
    const optional = Buffer.alloc(directoryOffset + 7 * 8);
    optional.writeUInt16LE(magic);
    optional.writeUInt32LE(0x400, 60);
    optional.writeUInt32LE(0xffffffff, directoryOffset - 4);
    optional.writeUInt32LE(0x2400, directoryOffset + 6 * 8);
    optional.writeUInt32LE(28, directoryOffset + 6 * 8 + 4);
    expect(peDebugDirectoryEntry(optional)).toEqual({
      debugRva: 0x2400,
      debugSize: 28,
      sizeOfHeaders: 0x400,
    });
    expect(
      peDebugDirectoryEntry(optional.subarray(0, optional.length - 1)),
    ).toBeUndefined();
    optional.writeUInt32LE(6, directoryOffset - 4);
    expect(peDebugDirectoryEntry(optional)).toBeUndefined();
  },
);

it("keeps validated optional-header facts separate from executable metadata", () => {
  const bytes = pe(0x8664);
  const record = bytes.subarray(bytes.readUInt32LE(0x3c));
  const parsed = parsePeRecordFacts(record, undefined);
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.value.optionalHeader).toMatchObject({ magic: 0x20b, bits: 64 });
  expect(parsed.value.metadata).toEqual({
    format: "pe",
    peMachine: 0x8664,
    architecture: "x86_64",
    availableArchitectures: ["x86_64"],
    executableRole: "application",
    managed: false,
  });
});
