import { deflateSync, zstdCompressSync } from "node:zlib";

const concat = (...parts: Buffer[]): Buffer => Buffer.concat(parts);

const alignTo = (value: number, alignment: number): number =>
  Math.ceil(value / alignment) * alignment;

/** Effective namesz/descsz padding: 8 stays 8; 0, 1, 4, and other values use 4. */
const notePadding = (declared: number): number => (declared === 8 ? 8 : 4);

const writeWord = (
  bytes: Buffer,
  offset: number,
  value: number,
  bits: 32 | 64,
  little: boolean,
): void => {
  if (bits === 64) {
    if (little) bytes.writeBigUInt64LE(BigInt(value), offset);
    else bytes.writeBigUInt64BE(BigInt(value), offset);
    return;
  }
  if (little) bytes.writeUInt32LE(value, offset);
  else bytes.writeUInt32BE(value, offset);
};

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

/** Encode one ELF note, padding name/descriptor to the table alignment. */
export const elfNote = (
  owner: string,
  type: number,
  descriptor: Buffer,
  little = true,
  alignment = 4,
): Buffer => {
  const name = Buffer.from(`${owner}\0`, "latin1");
  const pad = notePadding(alignment);
  const descOff = alignTo(12 + name.length, pad);
  const bytes = Buffer.alloc(alignTo(descOff + descriptor.length, pad));
  write32(bytes, 0, name.length, little);
  write32(bytes, 4, descriptor.length, little);
  write32(bytes, 8, type, little);
  name.copy(bytes, 12);
  descriptor.copy(bytes, descOff);
  return bytes;
};

/** GNU NT_GNU_BUILD_ID note with a 20-byte descriptor. */
export const gnuBuildIdNote = (
  hex = "0123456789abcdef0123456789abcdef01234567",
  little = true,
): Buffer => elfNote("GNU", 3, Buffer.from(hex, "hex"), little);

/** GNU NT_GNU_ABI_TAG note: Linux 3.2.0. */
export const gnuAbiTagNote = (little = true): Buffer => {
  const descriptor = Buffer.alloc(16);
  write32(descriptor, 0, 0, little);
  write32(descriptor, 4, 3, little);
  write32(descriptor, 8, 2, little);
  write32(descriptor, 12, 0, little);
  return elfNote("GNU", 1, descriptor, little);
};

/** GNU NT_GNU_PROPERTY_TYPE_0 note with 8-byte table padding. */
export const gnuPropertyNote = (little = true): Buffer => {
  const descriptor = Buffer.alloc(32);
  write32(descriptor, 0, 0xc0000002, little);
  write32(descriptor, 4, 4, little);
  write32(descriptor, 8, 3, little);
  write32(descriptor, 16, 0xc0008002, little);
  write32(descriptor, 20, 4, little);
  write32(descriptor, 24, 1, little);
  return elfNote("GNU", 5, descriptor, little, 8);
};

export interface ElfNoteImageOptions {
  readonly bits?: 32 | 64;
  readonly little?: boolean;
  readonly notes?: Buffer;
  readonly ownership?: "program" | "section" | "both" | "none";
  readonly machine?: number;
  readonly type?: number;
  readonly alignment?: number;
  readonly sectionName?: string;
}

/** Minimal ELF32/ELF64 image declaring PT_NOTE and/or SHT_NOTE. */
export const elfNoteFixture = (options: ElfNoteImageOptions = {}): Buffer => {
  const bits = options.bits ?? 64;
  const little = options.little ?? true;
  const ownership = options.ownership ?? "both";
  const notes =
    options.notes ??
    concat(gnuBuildIdNote(undefined, little), gnuAbiTagNote(little));
  const declaredAlign = options.alignment ?? 4;
  const pad = notePadding(declaredAlign);
  const header = bits === 64 ? 64 : 52;
  const phent = bits === 64 ? 56 : 32;
  const shent = bits === 64 ? 64 : 40;
  const program = ownership === "program" || ownership === "both";
  const section = ownership === "section" || ownership === "both";
  const phnum = program ? 1 : 0;
  const sectionName = options.sectionName ?? ".note.gnu.build-id";
  const shstrtab = Buffer.from(`\0${sectionName}\0.shstrtab\0`, "latin1");
  const shnum = section ? 3 : 0;
  const phoff = header;
  const shoff = phoff + phnum * phent;
  const noteOff = alignTo(shoff + shnum * shent, pad);
  const strOff = noteOff + notes.length;
  const bytes = Buffer.alloc(strOff + (section ? shstrtab.length : 0));
  bytes.writeUInt32LE(0x464c457f, 0);
  bytes[4] = bits === 64 ? 2 : 1;
  bytes[5] = little ? 1 : 2;
  bytes[6] = 1;
  write16(bytes, 0x10, options.type ?? 3, little);
  write16(bytes, 0x12, options.machine ?? 62, little);
  write32(bytes, 0x14, 1, little);
  write16(bytes, bits === 64 ? 0x34 : 0x28, header, little);
  writeWord(
    bytes,
    bits === 64 ? 0x20 : 0x1c,
    phnum === 0 ? 0 : phoff,
    bits,
    little,
  );
  write16(bytes, bits === 64 ? 0x36 : 0x2a, phent, little);
  write16(bytes, bits === 64 ? 0x38 : 0x2c, phnum, little);
  writeWord(
    bytes,
    bits === 64 ? 0x28 : 0x20,
    shnum === 0 ? 0 : shoff,
    bits,
    little,
  );
  write16(bytes, bits === 64 ? 0x3a : 0x2e, shent, little);
  write16(bytes, bits === 64 ? 0x3c : 0x30, shnum, little);
  write16(bytes, bits === 64 ? 0x3e : 0x32, section ? 2 : 0, little);
  if (program) {
    const ph = phoff;
    write32(bytes, ph, 4, little);
    if (bits === 64) {
      write32(bytes, ph + 4, 4, little);
      writeWord(bytes, ph + 8, noteOff, bits, little);
      writeWord(bytes, ph + 32, notes.length, bits, little);
      writeWord(bytes, ph + 40, notes.length, bits, little);
      writeWord(bytes, ph + 48, declaredAlign, bits, little);
    } else {
      writeWord(bytes, ph + 4, noteOff, bits, little);
      writeWord(bytes, ph + 16, notes.length, bits, little);
      writeWord(bytes, ph + 20, notes.length, bits, little);
      write32(bytes, ph + 24, 4, little);
      writeWord(bytes, ph + 28, declaredAlign, bits, little);
    }
  }
  if (section) {
    const noteName = 1;
    const strName = `${sectionName}\0`.length + 1;
    const noteSh = shoff + shent;
    const strSh = shoff + 2 * shent;
    write32(bytes, noteSh, noteName, little);
    write32(bytes, noteSh + 4, 7, little);
    writeWord(bytes, noteSh + (bits === 64 ? 24 : 16), noteOff, bits, little);
    writeWord(
      bytes,
      noteSh + (bits === 64 ? 32 : 20),
      notes.length,
      bits,
      little,
    );
    writeWord(
      bytes,
      noteSh + (bits === 64 ? 48 : 32),
      declaredAlign,
      bits,
      little,
    );
    write32(bytes, strSh, strName, little);
    write32(bytes, strSh + 4, 3, little);
    writeWord(bytes, strSh + (bits === 64 ? 24 : 16), strOff, bits, little);
    writeWord(
      bytes,
      strSh + (bits === 64 ? 32 : 20),
      shstrtab.length,
      bits,
      little,
    );
    shstrtab.copy(bytes, strOff);
  }
  notes.copy(bytes, noteOff);
  return bytes;
};

/** A valid GNU note whose SHT_NOTE section-name lookup cannot be completed. */
export const elfNoteWithUnreadableSectionNameFixture = (
  reason: "outside" | "unterminated",
): Buffer => {
  const bytes = elfNoteFixture({
    ownership: "section",
    notes: gnuBuildIdNote(),
  });
  const noteSection = 64 + 64;
  const namesSection = 64 + 2 * 64;
  const namesOffset = Number(bytes.readBigUInt64LE(namesSection + 24));
  const namesSize = Number(bytes.readBigUInt64LE(namesSection + 32));
  if (reason === "outside") bytes.writeUInt32LE(namesSize, noteSection);
  else bytes.fill(0x41, namesOffset + 1, namesOffset + namesSize);
  return bytes;
};

/** A non-allocated SHT_NOTE whose stored bytes include an ELF compression header. */
export const compressedElfNoteSectionFixture = (
  bits: 32 | 64 = 64,
  little = true,
): Buffer => {
  const notes = concat(
    gnuBuildIdNote(undefined, little),
    gnuAbiTagNote(little),
  );
  const header = Buffer.alloc(bits === 64 ? 24 : 12);
  write32(header, 0, 1, little); // ELFCOMPRESS_ZLIB
  writeWord(header, bits === 64 ? 8 : 4, notes.length, bits, little);
  writeWord(header, bits === 64 ? 16 : 8, 4, bits, little);
  const bytes = elfNoteFixture({
    bits,
    little,
    type: 1,
    ownership: "section",
    sectionName: ".debug.notes",
    alignment: bits === 64 ? 8 : 4,
    notes: concat(header, deflateSync(notes)),
  });
  const noteSection = (bits === 64 ? 64 : 52) + (bits === 64 ? 64 : 40);
  writeWord(bytes, noteSection + 8, 0x800, bits, little);
  return bytes;
};

/** Valid ELF64 section count stored in section header zero per the gABI. */
export const elfExtendedSectionCountFixture = (): Buffer => {
  const count = 0xff00;
  const sectionOffset = 0x200;
  const noteOffset = 0x100;
  const namesOffset = 0x180;
  const note = gnuBuildIdNote("12345678");
  const names = Buffer.from("\0.note.gnu.build-id\0.shstrtab\0", "latin1");
  const bytes = Buffer.alloc(sectionOffset + count * 64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  bytes.writeUInt16LE(1, 16);
  bytes.writeUInt16LE(62, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeBigUInt64LE(BigInt(sectionOffset), 40);
  bytes.writeUInt16LE(64, 52);
  bytes.writeUInt16LE(56, 54);
  bytes.writeUInt16LE(64, 58);
  bytes.writeUInt16LE(0, 60);
  bytes.writeUInt16LE(2, 62);
  bytes.writeBigUInt64LE(BigInt(count), sectionOffset + 32);

  const noteSection = sectionOffset + 64;
  bytes.writeUInt32LE(1, noteSection);
  bytes.writeUInt32LE(7, noteSection + 4);
  bytes.writeBigUInt64LE(BigInt(noteOffset), noteSection + 24);
  bytes.writeBigUInt64LE(BigInt(note.length), noteSection + 32);
  bytes.writeBigUInt64LE(4n, noteSection + 48);

  const namesSection = sectionOffset + 2 * 64;
  bytes.writeUInt32LE(20, namesSection);
  bytes.writeUInt32LE(3, namesSection + 4);
  bytes.writeBigUInt64LE(BigInt(namesOffset), namesSection + 24);
  bytes.writeBigUInt64LE(BigInt(names.length), namesSection + 32);
  bytes.writeBigUInt64LE(1n, namesSection + 48);

  note.copy(bytes, noteOffset);
  names.copy(bytes, namesOffset);
  return bytes;
};

/** ELF note fixture with a compressed section-name string table. */
export const compressedElfNoteFixture = (
  bits: 32 | 64 = 64,
  little = true,
  compressionType = 1,
  sectionName = ".note.gnu.build-id",
): Buffer => {
  const image = elfNoteFixture({
    bits,
    little,
    ownership: "section",
    sectionName,
  });
  const wide = bits === 64;
  const u16 = (offset: number) =>
    little ? image.readUInt16LE(offset) : image.readUInt16BE(offset);
  const word = (offset: number) =>
    wide
      ? Number(
          little
            ? image.readBigUInt64LE(offset)
            : image.readBigUInt64BE(offset),
        )
      : little
        ? image.readUInt32LE(offset)
        : image.readUInt32BE(offset);
  const shoff = word(wide ? 40 : 32);
  const shentsize = u16(wide ? 58 : 46);
  const namesIndex = u16(wide ? 62 : 50);
  const namesHeader = shoff + namesIndex * shentsize;
  const namesOffset = word(namesHeader + (wide ? 24 : 16));
  const namesSize = word(namesHeader + (wide ? 32 : 20));
  const names = image.subarray(namesOffset, namesOffset + namesSize);
  const compressed =
    compressionType === 2 ? zstdCompressSync(names) : deflateSync(names);
  const compressionHeaderBytes = wide ? 24 : 12;
  const replacement = Buffer.alloc(compressionHeaderBytes);
  if (little) replacement.writeUInt32LE(compressionType, 0);
  else replacement.writeUInt32BE(compressionType, 0);
  if (wide) {
    if (little) {
      replacement.writeBigUInt64LE(BigInt(names.length), 8);
      replacement.writeBigUInt64LE(1n, 16);
    } else {
      replacement.writeBigUInt64BE(BigInt(names.length), 8);
      replacement.writeBigUInt64BE(1n, 16);
    }
  } else {
    if (little) {
      replacement.writeUInt32LE(names.length, 4);
      replacement.writeUInt32LE(1, 8);
    } else {
      replacement.writeUInt32BE(names.length, 4);
      replacement.writeUInt32BE(1, 8);
    }
  }
  const result = concat(
    image.subarray(0, namesOffset),
    replacement,
    compressed,
    image.subarray(namesOffset + namesSize),
  );
  const writeWord = (offset: number, value: number) => {
    if (wide) {
      if (little) result.writeBigUInt64LE(BigInt(value), offset);
      else result.writeBigUInt64BE(BigInt(value), offset);
    } else if (little) result.writeUInt32LE(value, offset);
    else result.writeUInt32BE(value, offset);
  };
  const flagsAt = namesHeader + 8;
  writeWord(flagsAt, word(flagsAt) | 0x800);
  writeWord(
    namesHeader + (wide ? 32 : 20),
    compressionHeaderBytes + compressed.length,
  );
  writeWord(namesHeader + (wide ? 48 : 32), 1);
  return result;
};

/**
 * ELF64 whose only PT_NOTE declares 20 bytes. The file holds the 12-byte
 * header, 4-byte name, and 1-byte descriptor; the 3 alignment bytes are absent.
 */
export const elfNoteTablePastEnd = (): Buffer => {
  const note = Buffer.alloc(17);
  write32(note, 0, 4, true);
  write32(note, 4, 1, true);
  write32(note, 8, 1, true);
  note.write("GNU\0", 12, "latin1");
  note[16] = 0x2a;
  const header = Buffer.alloc(64);
  header.writeUInt32LE(0x464c457f, 0);
  header[4] = 2;
  header[5] = 1;
  header[6] = 1;
  write16(header, 0x10, 3, true);
  write16(header, 0x12, 62, true);
  write32(header, 0x14, 1, true);
  write16(header, 0x34, 64, true);
  writeWord(header, 0x20, 64, 64, true);
  write16(header, 0x36, 56, true);
  write16(header, 0x38, 1, true);
  const program = Buffer.alloc(56);
  write32(program, 0, 4, true);
  writeWord(program, 8, 120, 64, true);
  writeWord(program, 32, 20, 64, true);
  writeWord(program, 48, 4, 64, true);
  return concat(header, program, note);
};
