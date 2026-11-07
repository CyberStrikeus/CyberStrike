import { deflateSync, zstdCompressSync } from "node:zlib";

/** zlib payload matching the embedded dependency JSON shape. */
export const rustDependencyPayload = (
  document: unknown = {
    packages: [
      { name: "itoa", version: "1.0.18", source: "crates.io" },
      {
        name: "sample",
        version: "0.1.0",
        source: "local",
        dependencies: [0],
        root: true,
      },
    ],
    format: 1,
  },
): Buffer => deflateSync(Buffer.from(JSON.stringify(document)));

/** Compress the ELF section-name table without changing other sections. */
export const compressRustElfSectionNames = (
  bytes: Buffer,
  compressionType = 1,
): Buffer => {
  const sectionOffset = Number(bytes.readBigUInt64LE(40));
  const sectionWidth = bytes.readUInt16LE(58);
  const namesIndex = bytes.readUInt16LE(62);
  const nameHeader = sectionOffset + namesIndex * sectionWidth;
  const namesOffset = Number(bytes.readBigUInt64LE(nameHeader + 24));
  const namesSize = Number(bytes.readBigUInt64LE(nameHeader + 32));
  const names = Buffer.from(
    bytes.subarray(namesOffset, namesOffset + namesSize),
  );
  const compressed =
    compressionType === 2 ? zstdCompressSync(names) : deflateSync(names);
  const compressionHeader = Buffer.alloc(24);
  compressionHeader.writeUInt32LE(compressionType, 0);
  compressionHeader.writeBigUInt64LE(BigInt(names.length), 8);
  compressionHeader.writeBigUInt64LE(1n, 16);
  compressionHeader.copy(bytes, namesOffset);
  compressed.copy(bytes, namesOffset + compressionHeader.length);
  bytes.writeBigUInt64LE(
    bytes.readBigUInt64LE(nameHeader + 8) | 0x800n,
    nameHeader + 8,
  );
  bytes.writeBigUInt64LE(
    BigInt(compressionHeader.length + compressed.length),
    nameHeader + 32,
  );
  return bytes;
};

export const RUSTC_HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const RUSTC_PATH = `/rustc/${RUSTC_HASH}/library/core`;

/** Synthetic ELF, PE, or thin Mach-O with an optional dependency section. */
export const createRustImage = (options: {
  readonly format: "elf" | "pe" | "macho";
  readonly payload?: Buffer;
  readonly omitSection?: boolean;
  readonly includeRustc?: boolean;
}): Buffer => {
  const payload = options.payload ?? rustDependencyPayload();
  const rustc = options.includeRustc === false ? null : Buffer.from(RUSTC_PATH);
  const bytes = Buffer.alloc(4096);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = (offset: number, value: number, width: 16 | 32 | 64) => {
    if (width === 16) view.setUint16(offset, value, true);
    else if (width === 32) view.setUint32(offset, value, true);
    else view.setBigUint64(offset, BigInt(value), true);
  };
  const image = {
    bytes,
    little,
    payload,
    omitSection: options.omitSection === true,
    rustc,
  };
  if (options.format === "elf") writeElf(image);
  else if (options.format === "pe") writePe(image);
  else writeMacho(image);
  return bytes;
};

/** Read-only ELF data stays independent of its section-name spelling or availability. */
export const rustElfSectionNameFixture = (
  name: "named" | "empty" | "unavailable",
): Buffer => {
  const bytes = createRustImage({ format: "elf", omitSection: true });
  // This fixture's read-only PROGBITS header is at 384. Its PT_LOAD is writable,
  // so compiler-path recovery must use the section rather than segment fallback.
  if (name === "empty") bytes.writeUInt32LE(0, 384);
  if (name === "unavailable") bytes.writeUInt16LE(0, 62);
  return bytes;
};

interface RustImageWrite {
  readonly bytes: Buffer;
  readonly little: (offset: number, value: number, width: 16 | 32 | 64) => void;
  readonly payload: Buffer;
  readonly omitSection: boolean;
  readonly rustc: Buffer | null;
}

const writeElf = ({
  bytes,
  little,
  payload,
  omitSection,
  rustc,
}: RustImageWrite): void => {
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  little(16, 2, 16);
  little(18, 62, 16);
  little(20, 1, 32);
  little(32, 128, 64);
  little(40, 256, 64);
  little(52, 64, 16);
  little(54, 56, 16);
  little(56, 1, 16);
  little(58, 64, 16);
  const names = omitSection
    ? Buffer.from("\0.shstrtab\0.rodata\0")
    : Buffer.from("\0.shstrtab\0.dep-v0\0.rodata\0");
  little(60, rustc === null && omitSection ? 0 : omitSection ? 3 : 4, 16);
  little(62, rustc === null && omitSection ? 0 : 1, 16);
  little(128, 1, 32);
  little(132, 6, 32);
  little(144, 0x400000, 64);
  little(160, bytes.length, 64);
  little(168, bytes.length, 64);
  if (rustc === null && omitSection) return;
  names.copy(bytes, 768);
  const shstr = 320;
  little(shstr, 1, 32);
  little(shstr + 4, 3, 32);
  little(shstr + 24, 768, 64);
  little(shstr + 32, names.length, 64);
  let next = 384;
  if (!omitSection) {
    little(next, 11, 32);
    little(next + 4, 1, 32);
    little(next + 24, 1024, 64);
    little(next + 32, payload.length, 64);
    payload.copy(bytes, 1024);
    next += 64;
  }
  if (rustc !== null) {
    const name = omitSection ? 11 : 19;
    little(next, name, 32);
    little(next + 4, 1, 32);
    little(next + 8, 2, 64);
    little(next + 16, 0x400000 + 2048, 64);
    little(next + 24, 2048, 64);
    little(next + 32, rustc.length, 64);
    rustc.copy(bytes, 2048);
  }
};

const writePe = ({
  bytes,
  little,
  payload,
  omitSection,
  rustc,
}: RustImageWrite): void => {
  bytes.write("MZ", 0, "ascii");
  little(60, 128, 32);
  bytes.write("PE\0\0", 128, "ascii");
  little(132, 0x8664, 16);
  const count = Number(!omitSection) + Number(rustc !== null);
  little(134, count, 16);
  little(148, 112, 16);
  little(152, 0x20b, 16);
  little(176, 0x140000000, 64);
  const writeSection = (section: {
    readonly entry: number;
    readonly name: string;
    readonly offset: number;
    readonly body: Buffer;
    readonly address: number;
  }) => {
    bytes.write(section.name, section.entry, "ascii");
    little(section.entry + 8, section.body.length, 32);
    little(section.entry + 12, section.address, 32);
    little(section.entry + 16, section.body.length, 32);
    little(section.entry + 20, section.offset, 32);
    little(section.entry + 36, 0x40000040, 32);
    section.body.copy(bytes, section.offset);
  };
  let entry = 264;
  if (!omitSection) {
    writeSection({
      entry,
      name: ".dep-v0",
      offset: 1024,
      body: payload,
      address: 0x1000,
    });
    entry += 40;
  }
  if (rustc !== null)
    writeSection({
      entry,
      name: ".rdata",
      offset: 2048,
      body: rustc,
      address: 0x2000,
    });
};

const writeMacho = ({
  bytes,
  little,
  payload,
  omitSection,
  rustc,
}: RustImageWrite): void => {
  const commands = Number(rustc !== null) + Number(!omitSection);
  little(0, 0xfeedfacf, 32);
  little(4, 0x0100000c, 32);
  little(12, 2, 32);
  little(16, commands, 32);
  little(20, commands * 152, 32);
  let command = 32;
  if (rustc !== null) {
    writeMachoSegment({
      bytes,
      little,
      command,
      segment: "__TEXT",
      section: "__cstring",
      body: rustc,
      fileOffset: 2048,
      protection: 5,
      flags: 2,
    });
    command += 152;
  }
  if (!omitSection)
    writeMachoSegment({
      bytes,
      little,
      command,
      segment: "__DATA",
      section: ".dep-v0",
      body: payload,
      fileOffset: 1024,
      protection: 3,
      flags: 0,
    });
};

const writeMachoSegment = ({
  bytes,
  little,
  command,
  segment,
  section,
  body,
  fileOffset,
  protection,
  flags,
}: {
  readonly bytes: Buffer;
  readonly little: RustImageWrite["little"];
  readonly command: number;
  readonly segment: string;
  readonly section: string;
  readonly body: Buffer;
  readonly fileOffset: number;
  readonly protection: number;
  readonly flags: number;
}): void => {
  little(command, 0x19, 32);
  little(command + 4, 152, 32);
  bytes.write(segment, command + 8, "ascii");
  little(command + 24, 0x100000000, 64);
  little(command + 32, 0x2000, 64);
  little(command + 40, fileOffset, 64);
  little(command + 48, body.length, 64);
  little(command + 56, protection, 32);
  little(command + 60, protection, 32);
  little(command + 64, 1, 32);
  const header = command + 72;
  bytes.write(section, header, "ascii");
  bytes.write(segment, header + 16, "ascii");
  little(header + 32, 0x100000000, 64);
  little(header + 40, body.length, 64);
  little(header + 48, fileOffset, 32);
  little(header + 64, flags, 32);
  body.copy(bytes, fileOffset);
};

/** Read-only ELF data exceeding the distinct rustc-hash retention capacity. */
export const createRustHashOverflowImage = (): Buffer => {
  const bytes = createRustImage({ format: "elf", omitSection: true });
  // Without .dep-v0 the read-only section header is the second one, at 384.
  // Section names end before byte 800, so the hash block starts there.
  bytes.writeBigUInt64LE(800n, 384 + 24);
  bytes.writeBigUInt64LE(3296n, 384 + 32);
  bytes.fill(0, 800);
  for (let index = 0; index < 65; index += 1) {
    const hash = index.toString(16).padStart(40, "0");
    bytes.write(`/rustc/${hash}/`, 800 + index * 48, "latin1");
  }
  return bytes;
};

/** Valid Rust evidence beside an independently invalid Go metadata section. */
export const createRustImageWithGoSection = (
  format: "elf" | "macho",
  fault:
    | "compressed"
    | "unmapped"
    | "zero-fill"
    | "duplicate"
    | "out-of-file"
    | "zero-address",
): Buffer => {
  const bytes = createRustImage({ format });
  const count = fault === "duplicate" ? 2 : 1;
  if (format === "elf") {
    const nameOffset = Number(bytes.readBigUInt64LE(320 + 32));
    const name = Buffer.from(".go.buildinfo\0");
    name.copy(bytes, 768 + nameOffset);
    bytes.writeBigUInt64LE(BigInt(nameOffset + name.length), 320 + 32);
    bytes.writeUInt16LE(4 + count, 60);
    for (let index = 0; index < count; index++) {
      const header = 512 + index * 64;
      bytes.writeUInt32LE(nameOffset, header);
      bytes.writeUInt32LE(fault === "zero-fill" ? 8 : 1, header + 4);
      bytes.writeBigUInt64LE(fault === "compressed" ? 0x800n : 0n, header + 8);
      bytes.writeBigUInt64LE(
        fault === "zero-address"
          ? 0n
          : fault === "unmapped"
            ? 0x600000n
            : 0x400c00n,
        header + 16,
      );
      bytes.writeBigUInt64LE(
        fault === "out-of-file" ? 4088n : 3072n,
        header + 24,
      );
      bytes.writeBigUInt64LE(fault === "zero-address" ? 16n : 32n, header + 32);
      if (fault === "zero-address")
        Buffer.from("additional data\0", "ascii").copy(bytes, 3072);
    }
  } else {
    if (fault === "compressed") throw new Error("Not a Mach-O section flag");
    if (fault === "zero-address") throw new Error("Not an ELF section address");
    bytes.writeUInt32LE(2 + count, 16);
    bytes.writeUInt32LE((2 + count) * 152, 20);
    for (let index = 0; index < count; index++) {
      const command = 336 + index * 152;
      const little: RustImageWrite["little"] = (offset, value, width) => {
        if (width === 16) bytes.writeUInt16LE(value, offset);
        else if (width === 32) bytes.writeUInt32LE(value, offset);
        else bytes.writeBigUInt64LE(BigInt(value), offset);
      };
      writeMachoSegment({
        bytes,
        little,
        command,
        segment: "__EXTRA",
        section: "__go_buildinfo",
        body: Buffer.alloc(32),
        fileOffset: 3072,
        protection: fault === "unmapped" ? 0 : 3,
        flags: fault === "zero-fill" ? 1 : 0,
      });
      if (fault === "out-of-file") bytes.writeUInt32LE(4088, command + 72 + 48);
      bytes.writeBigUInt64LE(0x200000000n, command + 24);
      bytes.writeBigUInt64LE(0x200000000n, command + 72 + 32);
      if (fault === "unmapped") bytes.writeBigUInt64LE(0n, command + 32);
    }
  }
  return bytes;
};
