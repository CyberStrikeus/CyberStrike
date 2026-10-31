import { dosMz } from "../../../src/domain/binaryTarget.fixture.js";
import { lstat, symlink } from "node:fs/promises";
import { join } from "node:path";

/** Actual filesystem paths that fail before Go artifact acquisition begins. */
export const createGoBinaryPathFailureFixture = async (
  root: string,
  expectedErrno: "ELOOP" | "ENAMETOOLONG",
): Promise<{ path: string; errno: string }> => {
  let path = join(root, "a".repeat(256));
  if (expectedErrno === "ELOOP") {
    const loop = join(root, "loop");
    await symlink(loop, loop, "dir");
    path = join(loop, "application");
  }
  try {
    await lstat(path);
  } catch (cause: unknown) {
    if (
      !(cause instanceof Error) ||
      !("code" in cause) ||
      typeof cause.code !== "string"
    )
      throw cause;
    if (
      (expectedErrno === "ELOOP" || process.platform === "linux") &&
      cause.code !== expectedErrno
    )
      throw new Error(
        `Path fixture expected ${expectedErrno}, but native lstat returned ${cause.code}.`,
        { cause },
      );
    return { path, errno: cause.code };
  }
  throw new Error(`Expected native lstat to reject path fixture: ${path}`);
};

/** Producer-shaped Go metadata used for portable binary format regressions. */
export const GO_MODULE_TEXT =
  "path\texample.com/tool/cmd/tool\n" +
  "mod\texample.com/tool\t(devel)\t\n" +
  "dep\texample.com/dependency\tv1.2.3\th1:sample\n" +
  "=>\t../dependency\t\t\n" +
  "build\t-compiler=gc\n" +
  "build\tGOOS=linux\n" +
  'build\t-ldflags="-s -w"\n';

const MODULE_START = Buffer.from("3077af0c9274080241e1c107e6d618e6", "hex");
const MODULE_END = Buffer.from("f932433186182072008242104116d8f2", "hex");

/** Build an authored, file-backed ELF/PE/Mach-O image without executing code. */
export const createGoBinaryFixture = (
  options: {
    format?: "elf" | "pe" | "macho";
    bits?: 32 | 64;
    pointerSize?: 4 | 8;
    byteOrder?: "little" | "big";
    encoding?: "inline" | "pointer";
    sectionless?: boolean;
    goVersion?: string;
    moduleText?: string;
    omitBuildInfo?: boolean;
  } = {},
): {
  bytes: Buffer;
  headerOffset: number;
  versionOffset: number;
  moduleOffset: number;
  moduleBytes: Buffer;
} => {
  const format = options.format ?? "elf";
  const bits = options.bits ?? 64;
  const pointerSize = options.pointerSize ?? bits / 8;
  const little = (options.byteOrder ?? "little") === "little";
  const encoding = options.encoding ?? "inline";
  const bytes = Buffer.alloc(4096);
  const headerOffset = 1024;
  const base = 0x10000;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number, value: number) =>
    view.setUint16(offset, value, little);
  const u32 = (offset: number, value: number) =>
    view.setUint32(offset, value, little);
  const word = (offset: number, value: number) => {
    if (bits === 64) view.setBigUint64(offset, BigInt(value), little);
    else u32(offset, value);
  };
  const pointerWord = (offset: number, value: number) => {
    if (pointerSize === 8) view.setBigUint64(offset, BigInt(value), little);
    else u32(offset, value);
  };
  writeFixtureContainer(format, options.sectionless ?? false, {
    bytes,
    bits,
    little,
    base,
    headerOffset,
    u16,
    u32,
    word,
  });
  const version = Buffer.from(options.goVersion ?? "go1.26.0");
  const moduleBytes = Buffer.concat([
    MODULE_START,
    Buffer.from(options.moduleText ?? GO_MODULE_TEXT),
    MODULE_END,
  ]);
  let versionOffset: number;
  let moduleOffset: number;
  if (encoding === "inline") {
    const versionLength = encodeVarint(version.length);
    versionOffset = headerOffset + 32 + versionLength.length;
    const moduleLength = encodeVarint(moduleBytes.length);
    moduleOffset = versionOffset + version.length + moduleLength.length;
    versionLength.copy(bytes, headerOffset + 32);
    version.copy(bytes, versionOffset);
    moduleLength.copy(bytes, versionOffset + version.length);
    moduleBytes.copy(bytes, moduleOffset);
  } else {
    const width = pointerSize;
    pointerWord(headerOffset + 16, base + 1536);
    pointerWord(headerOffset + 16 + width, base + 1536 + width * 2);
    versionOffset = 2048;
    moduleOffset = 2304;
    pointerWord(1536, base + versionOffset);
    pointerWord(1536 + width, version.length);
    pointerWord(1536 + width * 2, base + moduleOffset);
    pointerWord(1536 + width * 3, moduleBytes.length);
    version.copy(bytes, versionOffset);
    moduleBytes.copy(bytes, moduleOffset);
  }
  if (!options.omitBuildInfo) {
    Buffer.from("ff20476f206275696c64696e663a", "hex").copy(
      bytes,
      headerOffset,
    );
    bytes[headerOffset + 14] = pointerSize;
    bytes[headerOffset + 15] =
      (little ? 0 : 1) | (encoding === "inline" ? 2 : 0);
  }
  return { bytes, headerOffset, versionOffset, moduleOffset, moduleBytes };
};

/** Legacy strings in declared PE header memory, with the record still in .data. */
export const createGoPeHeaderPointerFixture = (
  bits: 32 | 64,
  placement: "contents" | "descriptors",
) => {
  const fixture = createGoBinaryFixture({
    format: "pe",
    bits,
    encoding: "pointer",
  });
  const { bytes, headerOffset } = fixture;
  const width = bits / 8;
  const word = (offset: number, value: number) => {
    if (bits === 64) bytes.writeBigUInt64LE(BigInt(value), offset);
    else bytes.writeUInt32LE(value, offset);
  };
  const section = 152 + bytes.readUInt16LE(148);
  bytes.writeUInt16LE(0x22, 150);
  bytes.writeUInt32LE(4096, 184); // SectionAlignment.
  bytes.writeUInt32LE(512, 188); // FileAlignment.
  bytes.writeUInt32LE(8192, 208); // SizeOfImage.
  bytes.writeUInt32LE(1024, 212); // SizeOfHeaders.
  bytes.writeUInt32LE(4096, section + 12);
  const sectionAddress = (offset: number) => 0x11000 + offset - 1024;
  word(headerOffset + 16, sectionAddress(1536));
  word(headerOffset + 16 + width, sectionAddress(1536 + width * 2));
  word(1536, sectionAddress(fixture.versionOffset));
  word(1536 + width * 2, sectionAddress(fixture.moduleOffset));
  if (placement === "descriptors") {
    bytes.copy(bytes, 512, 1536, 1536 + width * 4);
    word(headerOffset + 16, 0x10200);
    word(headerOffset + 16 + width, 0x10200 + width * 2);
    return fixture;
  }
  const versionOffset = 512;
  const moduleOffset = 528;
  bytes.copy(
    bytes,
    versionOffset,
    fixture.versionOffset,
    fixture.versionOffset + 8,
  );
  fixture.moduleBytes.copy(bytes, moduleOffset);
  word(1536, 0x10000 + versionOffset);
  word(1536 + width * 2, 0x10000 + moduleOffset);
  return { ...fixture, versionOffset, moduleOffset };
};

/** A pointer string or its two-word descriptor crossing adjacent ELF PT_LOADs. */
export const createGoCrossLoadPointerFixture = (
  placement: "contents" | "descriptor",
) => {
  const fixture = createGoBinaryFixture({ encoding: "pointer" });
  const bytes = Buffer.alloc(8192);
  fixture.bytes.copy(bytes);
  bytes.writeUInt16LE(2, 56);
  bytes.writeBigUInt64LE(4096n, 160);
  bytes.writeBigUInt64LE(4096n, 168);
  bytes.writeBigUInt64LE(4096n, 176);
  bytes.writeUInt32LE(1, 184);
  bytes.writeUInt32LE(6, 188);
  bytes.writeBigUInt64LE(4096n, 192);
  bytes.writeBigUInt64LE(0x11000n, 200);
  bytes.writeBigUInt64LE(4096n, 216);
  bytes.writeBigUInt64LE(4096n, 224);
  bytes.writeBigUInt64LE(4096n, 232);
  bytes.writeBigUInt64LE(32n, 416); // Named discovery section contains only the record.
  const moduleOffset = 5000;
  fixture.moduleBytes.copy(bytes, moduleOffset);
  bytes.writeBigUInt64LE(0x10000n + BigInt(moduleOffset), 1552);
  if (placement === "descriptor") {
    bytes.copy(bytes, 4088, 1536, 1552);
    bytes.writeBigUInt64LE(0x10ff8n, fixture.headerOffset + 16);
    return { ...fixture, bytes, moduleOffset };
  }
  const versionOffset = 4092;
  bytes.copy(
    bytes,
    versionOffset,
    fixture.versionOffset,
    fixture.versionOffset + 8,
  );
  bytes.writeBigUInt64LE(0x10ffcn, 1536);
  return { ...fixture, bytes, versionOffset, moduleOffset };
};

/** Build an ELF inline record with a selected aggregate string-content size. */
export const createGoInlineAggregateFixture = (contentBytes: number) => {
  const fixture = createGoBinaryFixture({ moduleText: "" });
  const version = Buffer.from("v");
  const moduleBytes = Buffer.alloc(contentBytes - version.length, 0x78);
  if (moduleBytes.length < 33)
    throw new Error("Go module string must include its framing markers");
  MODULE_START.copy(moduleBytes);
  MODULE_END.copy(moduleBytes, moduleBytes.length - MODULE_END.length);
  moduleBytes[moduleBytes.length - MODULE_END.length - 1] = 0x0a;
  const versionLength = encodeVarint(version.length);
  const moduleLength = encodeVarint(moduleBytes.length);
  const versionOffset = fixture.headerOffset + 32 + versionLength.length;
  const modulePrefixOffset = versionOffset + version.length;
  const moduleOffset = modulePrefixOffset + moduleLength.length;
  const end = moduleOffset + moduleBytes.length;
  const bytes = Buffer.alloc(Math.ceil(Math.max(4096, end) / 16) * 16);
  fixture.bytes.copy(bytes);
  // Discovery names the header only; inline strings continue in PT_LOAD.
  bytes.writeBigUInt64LE(32n, 416);
  versionLength.copy(bytes, fixture.headerOffset + 32);
  version.copy(bytes, versionOffset);
  moduleLength.copy(bytes, modulePrefixOffset);
  moduleBytes.copy(bytes, moduleOffset);
  // ELF64 PT_LOAD p_filesz/p_memsz, matching this fixture's native identity.
  bytes.writeBigUInt64LE(BigInt(bytes.length), 160);
  bytes.writeBigUInt64LE(BigInt(bytes.length), 168);
  return {
    bytes,
    headerOffset: fixture.headerOffset,
    versionOffset,
    moduleOffset,
    moduleBytes,
  };
};

/** Shorten the ELF file-backed load mapping while retaining the file bytes. */
export const setGoElfLoadFileSize = (bytes: Buffer, size: number): void => {
  bytes.writeBigUInt64LE(BigInt(size), 160);
};

/** Set the Go Mach-O discovery section while leaving its segment unchanged. */
export const setGoMachOSectionSize = (bytes: Buffer, size: number): void => {
  bytes.writeBigUInt64LE(BigInt(size), 144);
};

/** Shorten a Mach-O segment's file-backed range while retaining the file bytes. */
export const setGoMachOSegmentFileSize = (
  bytes: Buffer,
  size: number,
): void => {
  bytes.writeBigUInt64LE(BigInt(size), 80);
};

/** Set the first PE section's declared virtual content size in an authored fixture. */
export const setGoPeVirtualSize = (
  bytes: Buffer,
  virtualSize: number,
): void => {
  const pe = bytes.readUInt32LE(60);
  const section = pe + 24 + bytes.readUInt16LE(pe + 20);
  bytes.writeUInt32LE(virtualSize, section + 8);
};

/** Two writable ELF loads, as in a PIE whose build info is in the later load. */
export const createGoSplitElfFixture = (
  options: Parameters<typeof createGoBinaryFixture>[0] = {},
) => {
  const fixture = createGoBinaryFixture({ ...options, format: "elf" });
  const { bytes, headerOffset } = fixture;
  const wide = (options.bits ?? 64) === 64;
  const little = (options.byteOrder ?? "little") === "little";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (offset: number, value: number) => {
    if (wide) view.setBigUint64(offset, BigInt(value), little);
    else view.setUint32(offset, value, little);
  };
  const second = 128 + (wide ? 56 : 32);
  bytes.copy(bytes, second, 128, second);
  view.setUint16(wide ? 56 : 44, 2, little);
  word(128 + (wide ? 32 : 16), headerOffset);
  word(128 + (wide ? 40 : 20), headerOffset);
  word(second + (wide ? 8 : 4), headerOffset);
  word(second + (wide ? 16 : 8), 0x10000 + headerOffset);
  word(second + (wide ? 32 : 16), bytes.length - headerOffset);
  word(second + (wide ? 40 : 20), bytes.length - headerOffset);
  return fixture;
};

/** Many file-backed ELF loads sharing a small input, without any metadata marker. */
export const createGoOverlappingElfFixture = (duplicate = false): Buffer => {
  const count = 257;
  const size = 1024 * 1024;
  const dataStart = 65536;
  const bytes = Buffer.alloc(dataStart + size + count * 16);
  createGoBinaryFixture({ sectionless: true, omitBuildInfo: true }).bytes.copy(
    bytes,
    0,
    0,
    64,
  );
  bytes.writeUInt16LE(count, 56);
  for (let index = 0; index < count; index++) {
    const header = 128 + index * 56;
    const offset = dataStart + (duplicate ? 0 : index * 16);
    bytes.writeUInt32LE(1, header);
    bytes.writeUInt32LE(6, header + 4);
    bytes.writeBigUInt64LE(BigInt(offset), header + 8);
    bytes.writeBigUInt64LE(0x400000n + BigInt(offset), header + 16);
    bytes.writeBigUInt64LE(BigInt(size), header + 32);
    bytes.writeBigUInt64LE(BigInt(size), header + 40);
  }
  return bytes;
};

/** Embedded invalid UTF-8 alongside valid records, with exact independent byte expectations. */
export const createGoBinaryByteStringFixture = () => {
  const version = Buffer.from("xgo1.26.0");
  const invalidLine = Buffer.from("build\t-tags=x");
  const fixture = createGoBinaryFixture({
    goVersion: version.toString("utf8"),
    moduleText:
      "path\texample.com/tool/cmd/tool\n" +
      "mod\texample.com/tool\t(devel)\t\n" +
      "build\tGOARCH=amd64\n" +
      `${invalidLine.toString("utf8")}\n`,
  });
  version[0] = 0xff;
  version.copy(fixture.bytes, fixture.versionOffset);
  const lineOffset = fixture.moduleBytes.indexOf(invalidLine);
  fixture.moduleBytes[lineOffset + invalidLine.length - 1] = 0xff;
  invalidLine[invalidLine.length - 1] = 0xff;
  fixture.moduleBytes.copy(fixture.bytes, fixture.moduleOffset);
  return {
    bytes: fixture.bytes,
    expectedBuildInfo: {
      header_offset: fixture.headerOffset,
      encoding: "inline",
      go_version: null,
      go_version_bytes_base64: version.toString("base64"),
      module_text: null,
      module_bytes_base64: fixture.moduleBytes.toString("base64"),
      version_location: {
        offset: fixture.versionOffset,
        bytes: version.length,
      },
      module_location: {
        offset: fixture.moduleOffset,
        bytes: fixture.moduleBytes.length,
      },
      module: {
        path: "example.com/tool/cmd/tool",
        main: {
          path: "example.com/tool",
          version: "(devel)",
          sum: "",
          replacement: null,
        },
        dependencies: [],
        settings: [{ key: "GOARCH", value: "amd64" }],
        unparsed_lines: [],
        unparsed_line_bytes_base64: [invalidLine.toString("base64")],
        complete: false,
      },
    },
  };
};

/** Unsupported DOS/Windows carriers and damaged PE records for public diagnostics. */
export const createGoBinaryDiagnosticFixtures = () => {
  const unsupported = [
    { name: "dos-short", bytes: dosMz(16) },
    { name: "dos", bytes: dosMz() },
  ];
  for (const signature of ["NE", "LE", "LX"]) {
    const bytes = dosMz();
    bytes.writeUInt16LE(4, 8);
    bytes.writeUInt32LE(64, 60);
    bytes.write(signature, 64, "ascii");
    unsupported.push({ name: signature.toLowerCase(), bytes });
  }
  const damagedPe = createGoBinaryFixture({ format: "pe" }).bytes;
  damagedPe.write("NO", 128, "ascii");
  const highBitSignatures = ["NE", "LE", "LX", "PE"].map((signature) => {
    const bytes = createGoBinaryFixture({ format: "pe" }).bytes;
    bytes.set(
      [...Buffer.from(signature)].map((byte) => byte | 0x80),
      128,
    );
    return { name: `high-bit-${signature.toLowerCase()}`, bytes };
  });
  const unresolvedWindowsCandidates = [
    { name: "damaged-pe", bytes: damagedPe },
    ...highBitSignatures,
  ];
  const absentDirectories = createGoBinaryFixture({ format: "pe" }).bytes;
  absentDirectories.writeUInt32LE(1, 152 + 108);
  const shortOptionalHeaders = [0, 1].map((size) => {
    const bytes = createGoBinaryFixture({ format: "pe" }).bytes;
    bytes.writeUInt16LE(size, 148);
    // Bytes following the declared header must not supply its magic field.
    bytes.fill(0xff, 152 + size, 154);
    return { name: `optional-header-${String(size)}-bytes`, bytes };
  });
  return [
    ...unsupported.map((fixture) => ({
      ...fixture,
      code: "unsupported_target" as const,
      details: { operation: "inspect_go_binary" },
    })),
    ...unresolvedWindowsCandidates.map((fixture) => ({
      ...fixture,
      code: "unsupported_target" as const,
      details: { operation: "inspect_go_binary" },
    })),
    ...[
      { name: "absent-directories", bytes: absentDirectories },
      ...shortOptionalHeaders,
    ].map((fixture) => ({
      ...fixture,
      code: "invalid_request" as const,
      details: {
        operation: "inspect_go_binary",
        issues: [{ path: ["path"], reason: "invalid_format" }],
      },
    })),
  ];
};

const encodeVarint = (input: number): Buffer => {
  let value = BigInt(input);
  const bytes: number[] = [];
  while (value >= 128n) {
    bytes.push(Number(value & 127n) | 128);
    value >>= 7n;
  }
  bytes.push(Number(value));
  return Buffer.from(bytes);
};

const writeFixtureContainer = (
  format: "elf" | "pe" | "macho",
  sectionless: boolean,
  context: {
    bytes: Buffer;
    bits: 32 | 64;
    little: boolean;
    base: number;
    headerOffset: number;
    u16: (offset: number, value: number) => void;
    u32: (offset: number, value: number) => void;
    word: (offset: number, value: number) => void;
  },
): void => {
  const { bytes, bits, little, base, headerOffset, u16, u32, word } = context;
  if (format === "elf") {
    bytes.set([0x7f, 0x45, 0x4c, 0x46, bits === 64 ? 2 : 1, little ? 1 : 2, 1]);
    u16(16, 2);
    u16(18, bits === 64 ? 62 : 3);
    u32(20, 1);
    const wide = bits === 64;
    word(wide ? 32 : 28, 128);
    word(wide ? 40 : 32, sectionless ? 0 : 256);
    u16(wide ? 52 : 40, wide ? 64 : 52);
    u16(wide ? 54 : 42, wide ? 56 : 32);
    u16(wide ? 56 : 44, 1);
    u16(wide ? 58 : 46, wide ? 64 : 40);
    u16(wide ? 60 : 48, sectionless ? 0 : 3);
    u16(wide ? 62 : 50, sectionless ? 0 : 1);
    u32(128, 1);
    if (wide) {
      u32(132, 6);
      word(136, 0);
      word(144, base);
      word(160, bytes.length);
      word(168, bytes.length);
    } else {
      word(132, 0);
      word(136, base);
      word(144, bytes.length);
      word(148, bytes.length);
      u32(152, 6);
    }
    if (!sectionless) {
      const entrySize = wide ? 64 : 40;
      const strings = Buffer.from("\0.shstrtab\0.go.buildinfo\0");
      strings.copy(bytes, 768);
      const names = 256 + entrySize;
      u32(names, 1);
      u32(names + 4, 3);
      word(names + (wide ? 24 : 16), 768);
      word(names + (wide ? 32 : 20), strings.length);
      const info = 256 + entrySize * 2;
      u32(info, 11);
      u32(info + 4, 1);
      word(info + (wide ? 16 : 12), base + headerOffset);
      word(info + (wide ? 24 : 16), headerOffset);
      word(info + (wide ? 32 : 20), 2048);
    }
  } else if (format === "pe") {
    if (!little) throw new Error("PE fixtures are little endian");
    bytes.write("MZ", 0, "ascii");
    u32(60, 128);
    bytes.write("PE\0\0", 128, "ascii");
    u16(132, bits === 64 ? 0x8664 : 0x14c);
    u16(134, 1);
    const optionalSize = bits === 64 ? 112 : 96;
    u16(148, optionalSize);
    u16(152, bits === 64 ? 0x20b : 0x10b);
    word(152 + (bits === 64 ? 24 : 28), base);
    const section = 152 + optionalSize;
    bytes.write(".data", section, "ascii");
    u32(section + 8, 2048);
    u32(section + 12, headerOffset);
    u32(section + 16, 2048);
    u32(section + 20, headerOffset);
    u32(section + 36, 0xc0000040);
  } else {
    const wide = bits === 64;
    u32(0, wide ? 0xfeedfacf : 0xfeedface);
    u32(4, wide ? 0x01000007 : 7);
    u32(8, 3);
    u32(12, 2);
    u32(16, 1);
    const segmentSize = wide ? 72 : 56;
    const sectionSize = wide ? 80 : 68;
    const commandSize = segmentSize + (sectionless ? 0 : sectionSize);
    u32(20, commandSize);
    const command = wide ? 32 : 28;
    u32(command, wide ? 0x19 : 1);
    u32(command + 4, commandSize);
    bytes.write("__DATA", command + 8, "ascii");
    word(command + 24, base);
    word(command + (wide ? 32 : 28), bytes.length);
    word(command + (wide ? 40 : 32), 0);
    word(command + (wide ? 48 : 36), bytes.length);
    u32(command + (wide ? 56 : 40), 3);
    u32(command + (wide ? 60 : 44), 3);
    u32(command + (wide ? 64 : 48), sectionless ? 0 : 1);
    if (!sectionless) {
      const section = command + segmentSize;
      bytes.write("__go_buildinfo", section, "ascii");
      bytes.write("__DATA", section + 16, "ascii");
      word(section + 32, base + headerOffset);
      word(section + (wide ? 40 : 36), 2048);
      u32(section + (wide ? 48 : 40), headerOffset);
    }
  }
};
