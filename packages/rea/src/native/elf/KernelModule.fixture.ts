import { MODULE_SIGNATURE_MAGIC } from "../../domain/native/kernelModule.js";

const concat = (...parts: readonly Buffer[]): Buffer => Buffer.concat(parts);

const write16 = (
  bytes: Buffer,
  offset: number,
  value: number,
  little: boolean,
): void => {
  if (little) bytes.writeUInt16LE(value, offset);
  else bytes.writeUInt16BE(value, offset);
};

const write32 = (
  bytes: Buffer,
  offset: number,
  value: number,
  little: boolean,
): void => {
  if (little) bytes.writeUInt32LE(value, offset);
  else bytes.writeUInt32BE(value, offset);
};

const writeWord = (
  bytes: Buffer,
  offset: number,
  value: number,
  bits: 32 | 64,
  little: boolean,
): void => {
  if (bits === 64) {
    const wide = BigInt(value);
    if (little) bytes.writeBigUInt64LE(wide, offset);
    else bytes.writeBigUInt64BE(wide, offset);
    return;
  }
  write32(bytes, offset, value, little);
};

/** One `__versions` record: unsigned long CRC plus a fixed NUL-padded name. */
export const modversionEntry = (
  crc: number | bigint,
  name: string,
  bits: 32 | 64,
  little: boolean,
): Buffer => {
  const bytes = Buffer.alloc(64);
  const encoded = Buffer.from(name, "latin1");
  if (bits === 64) {
    const value = BigInt(crc);
    if (little) bytes.writeBigUInt64LE(value, 0);
    else bytes.writeBigUInt64BE(value, 0);
    if (encoded.length >= 56)
      throw new Error("ELF64 modversion name must fit in 56 bytes");
    encoded.copy(bytes, 8);
    return bytes;
  }
  if (little) bytes.writeUInt32LE(Number(crc), 0);
  else bytes.writeUInt32BE(Number(crc), 0);
  if (encoded.length >= 60)
    throw new Error("ELF32 modversion name must fit in 60 bytes");
  encoded.copy(bytes, 4);
  return bytes;
};

/**
 * Appended module signature trailer. `sigLen` defaults to the PKCS#7 length;
 * a larger value builds an inconsistent trailer.
 */
export const moduleSignatureTrailer = (
  pkcs7: Buffer,
  sigLen = pkcs7.length,
): Buffer => {
  const info = Buffer.alloc(12);
  info[2] = 2;
  info.writeUInt32BE(sigLen >>> 0, 8);
  return concat(pkcs7, info, Buffer.from(MODULE_SIGNATURE_MAGIC, "latin1"));
};

export interface KernelModuleFixtureOptions {
  readonly bits?: 32 | 64;
  readonly little?: boolean;
  readonly type?: number;
  readonly machine?: number;
  /** Null omits the section. Undefined uses the synthetic default. */
  readonly modinfo?: Buffer | null;
  readonly versions?: Buffer | null;
  readonly thisModule?: Buffer | null;
  readonly ksymtab?: Buffer | null;
  readonly initText?: Buffer | null;
  readonly exitText?: Buffer | null;
  /** Null omits the trailer. Undefined appends a consistent PKCS#7 trailer. */
  readonly signature?: Buffer | null;
  /** Declare a second `.modinfo` section with the same bytes. */
  readonly repeatModinfo?: boolean;
  /** Extra empty file-backed sections that share one name-table string. */
  readonly sharedNameSections?: {
    readonly name: string;
    readonly count: number;
  };
}

const defaultModinfo = (): Buffer =>
  Buffer.from(
    "license=GPL\0vermagic=5.15.0 SMP mod_unload\0alias=pci:v1\0alias=pci:v2\0name=demo\0depends=\0",
    "latin1",
  );

const defaultVersions = (bits: 32 | 64, little: boolean): Buffer =>
  concat(
    modversionEntry(0x12345678, "printk", bits, little),
    modversionEntry(0x90abcdef, "module_layout", bits, little),
  );

const defaultPkcs7 = (): Buffer => Buffer.from("fake-pkcs7-bytes", "latin1");

interface SectionBody {
  readonly name: string;
  readonly type: number;
  readonly body: Buffer;
}

/** Synthetic ET_REL image with kernel-module sections and an optional trailer. */
export const kernelModuleFixture = (
  options: KernelModuleFixtureOptions = {},
): Buffer => {
  const bits = options.bits ?? 64;
  const little = options.little ?? true;
  const chosen = (
    value: Buffer | null | undefined,
    fallback: () => Buffer,
  ): Buffer | null =>
    value === null ? null : value === undefined ? fallback() : value;
  const bodies: SectionBody[] = [];
  const add = (name: string, body: Buffer | null): void => {
    if (body !== null) bodies.push({ name, type: 1, body });
  };
  add(".modinfo", chosen(options.modinfo, defaultModinfo));
  if (options.repeatModinfo === true) {
    const first = bodies.find((section) => section.name === ".modinfo");
    if (first !== undefined)
      bodies.push({ ...first, body: Buffer.from(first.body) });
  }
  add(
    "__versions",
    chosen(options.versions, () => defaultVersions(bits, little)),
  );
  add(
    ".gnu.linkonce.this_module",
    chosen(options.thisModule, () => Buffer.alloc(8, 0x11)),
  );
  add(
    "__ksymtab",
    chosen(options.ksymtab, () => Buffer.alloc(8, 0x22)),
  );
  add(
    ".init.text",
    chosen(options.initText, () => Buffer.from([0x90, 0x90, 0x90, 0x90])),
  );
  add(
    ".exit.text",
    chosen(options.exitText, () => Buffer.from([0xc3])),
  );
  const shared = options.sharedNameSections;
  if (shared !== undefined)
    for (let index = 0; index < shared.count; index++)
      bodies.push({ name: shared.name, type: 1, body: Buffer.alloc(0) });
  const labels = [
    ...new Set([...bodies.map((section) => section.name), ".shstrtab"]),
  ];
  const nameOffsets = new Map<string, number>();
  const nameParts: Buffer[] = [Buffer.from([0])];
  for (const label of labels) {
    nameOffsets.set(
      label,
      nameParts.reduce((sum, part) => sum + part.length, 0),
    );
    nameParts.push(Buffer.from(`${label}\0`, "latin1"));
  }
  const names = concat(...nameParts);
  const headerSize = bits === 64 ? 64 : 52;
  const shentsize = bits === 64 ? 64 : 40;
  const shnum = bodies.length + 2;
  const shoff = headerSize;
  let cursor = shoff + shnum * shentsize;
  const placed = bodies.map((section) => {
    const offset = cursor;
    cursor += section.body.length;
    return { ...section, offset };
  });
  const namesOffset = cursor;
  cursor += names.length;
  const signature =
    options.signature === null
      ? Buffer.alloc(0)
      : (options.signature ?? moduleSignatureTrailer(defaultPkcs7()));
  const bytes = Buffer.alloc(cursor + signature.length);
  bytes.writeUInt32LE(0x464c457f, 0);
  bytes[4] = bits === 64 ? 2 : 1;
  bytes[5] = little ? 1 : 2;
  bytes[6] = 1;
  write16(bytes, 16, options.type ?? 1, little);
  write16(bytes, 18, options.machine ?? (bits === 64 ? 62 : 20), little);
  write32(bytes, 20, 1, little);
  write16(bytes, bits === 64 ? 52 : 40, headerSize, little);
  write16(bytes, bits === 64 ? 54 : 42, bits === 64 ? 56 : 32, little);
  writeWord(bytes, bits === 64 ? 40 : 32, shoff, bits, little);
  write16(bytes, bits === 64 ? 58 : 46, shentsize, little);
  write16(bytes, bits === 64 ? 60 : 48, shnum, little);
  write16(bytes, bits === 64 ? 62 : 50, shnum - 1, little);
  const writeSection = (
    index: number,
    name: string,
    type: number,
    offset: number,
    size: number,
  ): void => {
    const at = shoff + index * shentsize;
    write32(bytes, at, nameOffsets.get(name) ?? 0, little);
    write32(bytes, at + 4, type, little);
    writeWord(bytes, at + (bits === 64 ? 24 : 16), offset, bits, little);
    writeWord(bytes, at + (bits === 64 ? 32 : 20), size, bits, little);
    writeWord(bytes, at + (bits === 64 ? 48 : 32), 1, bits, little);
  };
  placed.forEach((section, index) => {
    writeSection(
      index + 1,
      section.name,
      section.type,
      section.offset,
      section.body.length,
    );
    section.body.copy(bytes, section.offset);
  });
  writeSection(shnum - 1, ".shstrtab", 3, namesOffset, names.length);
  names.copy(bytes, namesOffset);
  signature.copy(bytes, cursor);
  return bytes;
};

/** Whole-file compression magics this operation recognizes and does not decode. */
export const compressedKernelModuleContainer = (
  codec: "gzip" | "xz" | "zstd",
): Buffer => {
  switch (codec) {
    case "gzip":
      return Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
    case "xz":
      return Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00, 0x00]);
    case "zstd":
      return Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00]);
  }
};
