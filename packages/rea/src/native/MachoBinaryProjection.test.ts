import { expect, it } from "vitest";
import { projectMachoBinary } from "./MachoBinaryProjection.js";
import type { MachoCommandNames } from "./MachoCommandNames.js";
import { readMachoCommandNames } from "./MachoCommandNames.js";
import {
  machoImage,
  readerOf,
  segmentCommand,
} from "../artifacts/apple/MachoImage.fixture.js";

const multilineBinary: MachoCommandNames = {
  sliceSize: 4096,
  header: {
    wide: true,
    littleEndian: true,
    cpuType: 0x0100000c,
    cpuSubtype: 0,
    fileType: 2,
    flags: 0x200085,
  },
  commands: [
    {
      index: 0,
      rawSha256: null,
      command: 0x19,
      offset: 0,
      size: 152,
      segmentName: Buffer.from("__DATA\0"),
      segment: {
        address: 0x1000n,
        memorySize: 0x200n,
        fileOffset: 0n,
        fileSize: 0x100n,
        maxProtection: 7,
        protection: 3,
        flags: 0,
      },
      sections: [
        {
          name: Buffer.from("x\naddr 0x1\0"),
          segmentName: Buffer.from("__DATA\0"),
          address: 0x1010n,
          size: 16n,
          fileOffset: 16,
          alignmentExponent: 2,
          flags: 0x80000400,
          relocationOffset: 7,
          relocationCount: 2,
          reserved1: 3,
          reserved2: 4,
          reserved3: 5,
        },
      ],
    },
    {
      index: 1,
      rawSha256: null,
      command: 0xc,
      offset: 152,
      size: 40,
      commandString: Buffer.from("lib\nLoad command 2"),
      commandStringOffset: 24,
      dylib: {
        nameOffset: 24,
        currentVersion: 0x00010203,
        compatibilityVersion: 0x00010000,
        encoding: { kind: "timestamp", timestamp: 0 },
      },
    },
    {
      index: 2,
      rawSha256: null,
      command: 0x80000028,
      offset: 192,
      size: 24,
      entrypoint: { offset: 123n, stackSize: 0n },
    },
    {
      index: 3,
      rawSha256: null,
      command: 0x32,
      offset: 216,
      size: 32,
      build: {
        platform: 1,
        minimumOs: 0x000d0102,
        sdk: 0x000f0000,
        tools: [{ tool: 3, version: 0x01020300 }],
      },
    },
    {
      index: 4,
      rawSha256: null,
      command: 2,
      offset: 248,
      size: 24,
      fixedFields: { symoff: 128, nsyms: 2, stroff: 256, strsize: 20 },
    },
  ],
};

it("projects exact multiline names and numeric command facts from the binary owner", () => {
  const result = projectMachoBinary(multilineBinary);
  expect(result).toMatchObject({
    wordSize: 64,
    endian: "little",
    fileType: "2",
    flags: ["0x00200085"],
    segments: [
      {
        name: "__DATA",
        sections: [
          {
            name: "x\naddr 0x1",
            segment: "__DATA",
            address: "0x1010",
            alignment: 4,
            flags: ["0x80000400"],
          },
        ],
      },
    ],
    dependencies: [
      {
        kind: "LC_LOAD_DYLIB",
        path: "lib\nLoad command 2",
        current_version: "1.2.3",
        compatibility_version: "1.0.0",
      },
    ],
    entrypoints: [{ file_offset: 123 }],
    builds: [
      {
        platform: "MACOS",
        minimum_os: "13.1.2",
        sdk: "15.0",
        tools: [{ name: "LD", version: "258.3" }],
      },
    ],
    commands: [
      {
        kind: "LC_SEGMENT_64",
        fields: {
          "segname #1": "__DATA",
          "segname #2": "__DATA",
          sectname: "x\naddr 0x1",
          nsects: 1,
          reloff: 7,
          nreloc: 2,
          reserved1: 3,
          reserved2: 4,
          reserved3: 5,
        },
      },
      {
        kind: "LC_LOAD_DYLIB",
        fields: { name: "lib\nLoad command 2 (offset 24)", "time stamp": 0 },
      },
      { kind: "LC_MAIN", fields: { entryoff: 123, stacksize: 0 } },
      { kind: "LC_BUILD_VERSION", fields: { platform: 1, ntools: 1 } },
      {
        kind: "LC_SYMTAB",
        fields: { symoff: 128, nsyms: 2, stroff: 256, strsize: 20 },
      },
    ],
    segmentLimitations: [],
    dependencyLimitations: [],
  });
});

it("preserves invalid name bytes, unsafe values and unknown command locations without inventing text", () => {
  const result = projectMachoBinary({
    sliceSize: 4096,
    header: {
      wide: true,
      littleEndian: true,
      cpuType: 0x0100000c,
      cpuSubtype: 0,
      fileType: 2,
      flags: 0,
    },
    commands: [
      {
        index: 0,
        rawSha256: null,
        command: 0x19,
        offset: 0,
        size: 152,
        segmentName: Uint8Array.of(0xff, 0),
        segment: {
          address: 0n,
          memorySize: 0x20000000000000n,
          fileOffset: 0n,
          fileSize: 0n,
          maxProtection: 0,
          protection: 0,
          flags: 0,
        },
        sections: [
          {
            name: Uint8Array.of(0xfe, 0),
            segmentName: Uint8Array.of(0xff, 0),
            address: 1n,
            size: 0x20000000000000n,
            fileOffset: 0,
            alignmentExponent: 53,
            flags: 0,
            relocationOffset: 0,
            relocationCount: 0,
            reserved1: 0,
            reserved2: 0,
            reserved3: 0,
          },
        ],
      },
      {
        index: 1,
        rawSha256: null,
        command: 0xc,
        offset: 152,
        size: 32,
        commandString: Uint8Array.of(0xfd),
        commandStringOffset: 24,
        dylib: {
          nameOffset: 24,
          currentVersion: 0,
          compatibilityVersion: 0,
          encoding: { kind: "timestamp", timestamp: 0 },
        },
      },
      {
        index: 2,
        command: 0x7fff,
        offset: 184,
        size: 8,
        rawSha256: "a".repeat(64),
      },
    ],
  });
  expect(result.segments[0]).toMatchObject({
    name: null,
    name_bytes_hex: "ff",
    vm_size: null,
    vm_size_hex: "0x20000000000000",
    sections: [
      {
        name: null,
        name_bytes_hex: "fe",
        segment: null,
        segment_bytes_hex: "ff",
        size: null,
        size_hex: "0x20000000000000",
        alignment: null,
        alignment_exponent: 53,
      },
    ],
  });
  expect(result.dependencies[0]).toMatchObject({
    path: null,
    path_bytes_hex: "fd",
  });
  expect(result.commands[2]).toMatchObject({
    kind: "LC_UNKNOWN_0x7fff",
    fields: { command_code: 0x7fff, command_offset: 216, cmdsize: 8 },
  });
  expect(result.segmentLimitations.length).toBeGreaterThan(0);
  expect(result.dependencyLimitations.length).toBeGreaterThan(0);
  expect(result.commands[2]?.fields.command_sha256).toBe("a".repeat(64));
  expect(result.entrypointLimitations).toEqual(
    expect.arrayContaining([expect.stringContaining("unknown load command")]),
  );
  expect(result.buildLimitations).toEqual(
    expect.arrayContaining([expect.stringContaining("unknown load command")]),
  );
  expect(result.commandLimitations).toEqual(
    expect.arrayContaining([
      expect.stringContaining("payload fields are not decoded"),
    ]),
  );
});

it("retains legacy command metadata and derives simulator platform from CPU", () => {
  const result = projectMachoBinary({
    sliceSize: 4096,
    header: {
      wide: true,
      littleEndian: true,
      cpuType: 0x01000007,
      cpuSubtype: 3,
      fileType: 1,
      flags: 0,
    },
    commands: [
      {
        index: 0,
        command: 6,
        offset: 0,
        size: 32,
        rawSha256: null,
        commandString: Buffer.from("legacy\nname"),
        commandStringOffset: 20,
        fvmlib: { minorVersion: 7, headerAddress: 0x1200 },
      },
      {
        index: 1,
        command: 0x10,
        offset: 32,
        size: 32,
        rawSha256: null,
        commandString: Buffer.from("old.dylib"),
        commandStringOffset: 20,
        prebound: {
          moduleCount: 2,
          linkedModulesOffset: 28,
          linkedModules: Uint8Array.of(1),
        },
      },
      {
        index: 2,
        command: 0x25,
        offset: 64,
        size: 16,
        rawSha256: null,
        legacyBuild: { version: 0x000e0200, sdk: 0x000f0000 },
      },
    ],
  });
  expect(result.commands).toMatchObject([
    {
      kind: "LC_LOADFVMLIB",
      fields: {
        name: "legacy\nname (offset 20)",
        "minor version": 7,
        "header addr": 0x1200,
      },
    },
    {
      kind: "LC_PREBOUND_DYLIB",
      fields: {
        name: "old.dylib (offset 20)",
        nmodules: 2,
        linked_modules_offset: 28,
        linked_modules_bytes_hex: "01",
      },
    },
    {
      kind: "LC_VERSION_MIN_IPHONEOS",
      fields: { version: "14.2", sdk: "15.0" },
    },
  ]);
  expect(result.builds).toEqual([
    { platform: "IOSSIMULATOR", minimum_os: "14.2", sdk: "15.0", tools: [] },
  ]);
  expect(result.dependencies).toMatchObject([
    { kind: "LC_LOADFVMLIB", path: "legacy\nname" },
    { kind: "LC_PREBOUND_DYLIB", path: "old.dylib" },
  ]);
  expect(result.commandLimitations).toEqual([
    expect.stringContaining("payload fields are not decoded"),
  ]);
  expect(result.commands[0]?.fields).toMatchObject({
    command_code: 6,
    command_offset: 32,
    command_sha256: null,
  });
});

it("distinguishes exact fixed command extents from unmodeled trailing bytes", async () => {
  const command = (size: number) => {
    const bytes = Buffer.alloc(size);
    bytes.writeUInt32LE(2, 0);
    bytes.writeUInt32LE(size, 4);
    return bytes;
  };
  const image = machoImage({ commands: [command(24), command(32)] });
  const binary = await readMachoCommandNames(
    readerOf(image),
    image.length,
    1024,
    8,
  );
  expect(binary.commands.map((row) => row.fullyDecoded)).toEqual([true, false]);
  expect(binary.commands[0]?.rawSha256).toBeNull();
  expect(binary.commands[1]?.rawSha256).toMatch(/^[a-f0-9]{64}$/u);
  const projection = projectMachoBinary(binary);
  expect(projection.commands[0]?.fields).not.toHaveProperty("command_sha256");
  expect(projection.commands[1]?.fields.command_sha256).toBe(
    binary.commands[1]?.rawSha256,
  );
  expect(projection.commandLimitations).toEqual([
    expect.stringContaining("payload fields are not decoded"),
  ]);
});

it("preserves leading UTF-8 BOM characters in names and dependency paths", () => {
  const marker = "\uFEFF";
  const commands = multilineBinary.commands.map((row) => ({
    ...row,
    ...(row.segmentName ? { segmentName: Buffer.from(`${marker}seg\0`) } : {}),
    ...(row.sections
      ? {
          sections: row.sections.map((section) => ({
            ...section,
            name: Buffer.from(`${marker}name\0`),
            segmentName: Buffer.from(`${marker}seg\0`),
          })),
        }
      : {}),
    ...(row.commandString
      ? { commandString: Buffer.from(`${marker}lib.dylib`) }
      : {}),
  }));
  const result = projectMachoBinary({ ...multilineBinary, commands });
  expect(result.segments[0]).toMatchObject({
    name: `${marker}seg`,
    sections: [{ name: `${marker}name`, segment: `${marker}seg` }],
  });
  expect(result.dependencies[0]).toMatchObject({ path: `${marker}lib.dylib` });
});

it("retains fixed-name storage bytes for a fully decoded segment", async () => {
  const segment = segmentCommand({ name: "__TEXT", vmaddr: 0n, vmsize: 0n });
  segment[15] = 0xff;
  const image = machoImage({ commands: [segment] });
  const binary = await readMachoCommandNames(
    readerOf(image),
    image.length,
    1024,
    8,
  );
  const projection = projectMachoBinary(binary);
  expect(binary.commands[0]?.fullyDecoded).toBe(true);
  expect(projection.commands[0]?.fields.segname).toBe("__TEXT");
  expect(projection.commands[0]?.fields.segname_storage_hex).toBe(
    Buffer.from(segment.subarray(8, 24)).toString("hex"),
  );
  expect(projection.commandLimitations).toEqual([]);
});

it("reports undecoded lazy dependency payloads and unsafe entrypoint offsets", () => {
  const result = projectMachoBinary({
    sliceSize: 4096,
    header: {
      wide: true,
      littleEndian: true,
      cpuType: 0x0100000c,
      cpuSubtype: 0,
      fileType: 2,
      flags: 0,
    },
    commands: [
      { index: 0, command: 0x3a, offset: 0, size: 16, rawSha256: null },
      {
        index: 1,
        command: 0x80000028,
        offset: 16,
        size: 24,
        rawSha256: null,
        entrypoint: { offset: 0x20000000000000n, stackSize: 0n },
      },
    ],
  });
  expect(result.commands[0]?.kind).toBe("LC_LAZY_LOAD_DYLIB_INFO");
  expect(result.dependencyLimitations).toEqual([
    "The linkedit dependency payload is not decoded.",
  ]);
  expect(result.entrypoints).toEqual([]);
  expect(result.entrypointLimitations).toEqual([
    expect.stringContaining("exceeds the safe integer range"),
  ]);
  expect(result.commands[1]?.fields.entryoff).toBe("0x0020000000000000");
});
