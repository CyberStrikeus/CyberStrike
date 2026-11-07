import {
  observeElfStringTableEntry,
  elfStringTableText,
} from "../../domain/elfStringTable.js";
import {
  mzWindowsHeaderLayoutLimitation,
  parseMzHeaderEvidence,
  withMzWindowsHeaderSignature,
} from "../../domain/dosMz.js";
import { readElfSectionHeader } from "../../domain/elfSectionHeader.js";
import { readElfProgramHeader } from "../../domain/elfProgramHeader.js";
import { readPeCoffHeader } from "../../domain/peCoffHeader.js";
import { readPeSectionHeader } from "../../domain/peSectionHeader.js";
import { readElfTableDeclarations } from "../../domain/elfDeclaredRanges.js";
import { readPeOptionalHeaderStructure } from "../../domain/peOptionalHeader.js";
import {
  BinaryFormatFailure,
  BinaryReader,
  BinaryResourceFailure,
  declaredFileRange,
  type ElfDynamicSegment,
} from "./BinaryContainer.js";
import { decodeElfSectionNameTable } from "./ElfSectionNameTable.js";

/** A borrowed positional source. Drivers own admission, cancellation and file identity. */
export interface NativeReadRequest {
  readonly offset: number;
  readonly size: number;
}
export interface NativeSection {
  readonly index: number;
  readonly name: string | null;
  readonly name_state: "known" | "unavailable" | "truncated";
  readonly header_offset: number;
  readonly offset: bigint;
  readonly size: bigint;
  readonly address: bigint;
  readonly type: number;
  readonly flags: bigint;
  readonly link: number;
  readonly info: number;
  readonly entry_size: bigint;
  readonly file_backed: boolean;
}
/** Raw relevant program declarations; consumers own load/dynamic admission. */
export type ElfProgramDeclaration =
  | {
      readonly type: 1;
      readonly flags: number;
      readonly file_offset: bigint;
      readonly file_size: bigint;
      readonly virtual_address: bigint;
      readonly memory_size: bigint;
    }
  | ({ readonly type: 2 } & ElfDynamicSegment);

export interface NativeSectionDirectory {
  readonly format: "elf" | "pe";
  readonly bits: 32 | 64;
  readonly little: boolean;
  readonly machine: number;
  readonly elf_os_abi: number | null;
  readonly flags: number;
  readonly section_names_limitation?: string;
  readonly programs: readonly ElfProgramDeclaration[];
  readonly sections: readonly NativeSection[];
}
type ElfSectionDirectory = NativeSectionDirectory & {
  readonly format: "elf";
  readonly elf_type: number;
};

const STRUCTURE_BYTES = 16 * 1024 * 1024;
const reject = (message: string): never => {
  throw new BinaryFormatFailure("malformed", message);
};
const exact = (value: bigint): number => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    reject("Native offset exceeds exact host precision");
  return Number(value);
};
const request = (
  fileSize: number,
  offset: bigint,
  size: bigint,
): NativeReadRequest => {
  if (
    offset < 0n ||
    size < 0n ||
    offset > BigInt(fileSize) ||
    size > BigInt(fileSize) - offset
  )
    reject("Native directory range is truncated or outside the file");
  if (size > BigInt(STRUCTURE_BYTES))
    throw new BinaryResourceFailure(
      "structure",
      STRUCTURE_BYTES,
      "Native directory exceeds the 16777216-byte (16 MiB) structural decoding budget. This release has no runtime override.",
    );
  return { offset: exact(offset), size: exact(size) };
};

/** One ELF interpretation for in-memory images and bounded descriptor-backed inspections. */
export function* readElfSectionDirectory(
  fileSize: number,
): Generator<NativeReadRequest, ElfSectionDirectory, Buffer> {
  const prefix = yield request(fileSize, 0n, 16n);
  const headerSize = prefix[4] === 1 ? 52 : 64;
  const bytes = yield request(fileSize, 0n, BigInt(headerSize));
  const parsed = yield* readElfTableDeclarations(bytes, fileSize);
  if (!parsed.ok) return reject(parsed.error);
  const { header, programs, sections: sectionTable } = parsed.value;
  const { elfClass: bits, byteOrder, machine } = header;
  const little = byteOrder === "little";
  const {
    offset: program_offset,
    width: program_width,
    count: program_count,
  } = programs;
  const {
    offset: sectionOffset,
    width: sectionWidth,
    count,
    namesIndex,
  } = sectionTable;
  const programDeclarations: ElfProgramDeclaration[] = [];
  if (program_count !== 0) {
    const programBytes = yield request(
      fileSize,
      program_offset,
      BigInt(program_count) * BigInt(program_width),
    );
    // At most one record per table entry, bounded before allocation by the
    // existing 16 MiB table allowance and minimum 32/56-byte ELF record width.
    for (let index = 0; index < program_count; index++) {
      const at = index * program_width;
      const parsedProgram = readElfProgramHeader(
        programBytes.subarray(at, at + program_width),
        bits,
        little,
      );
      if (!parsedProgram.ok) return reject(parsedProgram.error.message);
      const program = parsedProgram.value;
      const { type } = program;
      if (type === 1)
        programDeclarations.push({
          type,
          flags: program.flags,
          file_offset: program.offset,
          virtual_address: program.virtualAddress,
          file_size: program.fileSize,
          memory_size: program.memorySize,
        });
      else if (type === 2)
        programDeclarations.push({
          type,
          offset: program.offset,
          size: program.fileSize,
        });
    }
  }
  const sections: NativeSection[] = [];
  let section_names_limitation: string | undefined;
  if (count !== 0) {
    const table = yield request(
      fileSize,
      sectionOffset,
      BigInt(count) * BigInt(sectionWidth),
    );
    let names: Buffer | null = null;
    if (namesIndex !== 0) {
      const h = namesIndex * sectionWidth;
      const parsedNames = readElfSectionHeader(
        table.subarray(h, h + sectionWidth),
        bits,
        little,
      );
      if (!parsedNames.ok) return reject(parsedNames.error.message);
      const namesSection = parsedNames.value;
      if (namesSection.type !== 3)
        reject("ELF section name table is not a string table");
      const rawNames = yield request(
        fileSize,
        namesSection.offset,
        namesSection.size,
      );
      const decoded = decodeElfSectionNameTable(
        rawNames,
        namesSection.flags,
        bits,
        little,
        Math.max(0, STRUCTURE_BYTES - rawNames.length),
      );
      if (decoded.state === "malformed") return reject(decoded.message);
      if (decoded.state === "limit")
        throw new BinaryResourceFailure(
          "structure",
          STRUCTURE_BYTES,
          `Decoded ELF section names require ${String(decoded.requiredBytes)} bytes, above the ${String(decoded.maximumBytes)}-byte remaining structural budget`,
        );
      if (decoded.state === "unsupported")
        section_names_limitation = `ELF section names are unavailable because compression type ${String(decoded.compressionType)} is unsupported`;
      else names = decoded.bytes;
    } else if (count > 1) {
      section_names_limitation =
        "ELF section names are unavailable because no section-name string table is declared";
    }
    const decodedNames = new Map<
      number,
      { name: string | null; state: NativeSection["name_state"] }
    >();
    let nameBytes = 0;
    for (let index = 0; index < count; index++) {
      const h = index * sectionWidth;
      const parsedSection = readElfSectionHeader(
        table.subarray(h, h + sectionWidth),
        bits,
        little,
      );
      if (!parsedSection.ok) return reject(parsedSection.error.message);
      const section = parsedSection.value;
      const nameOffset = section.nameOffset;
      let name: string | null = null;
      let name_state: NativeSection["name_state"] = "unavailable";
      if (names !== null) {
        let decoded = decodedNames.get(nameOffset);
        if (decoded === undefined) {
          const observed = observeElfStringTableEntry(names, nameOffset, 65536);
          nameBytes += observed.examinedBytes;
          if (nameBytes > STRUCTURE_BYTES)
            throw new BinaryResourceFailure(
              "structure",
              STRUCTURE_BYTES,
              "Decoded ELF section names exceed the 16 MiB structural budget",
            );
          decoded = {
            name: elfStringTableText(observed),
            state:
              observed.state === "terminated"
                ? "known"
                : observed.state === "outside"
                  ? "unavailable"
                  : "truncated",
          };
          if (observed.state === "outside")
            section_names_limitation ??=
              "ELF section names are incomplete because a name offset is outside its string table";
          else if (observed.state === "truncated")
            section_names_limitation ??=
              "ELF section names are unavailable because a name is not NUL-terminated";
          if (observed.state !== "outside")
            decodedNames.set(nameOffset, decoded);
        }
        name_state = decoded.state;
        name = decoded.name;
      }
      const { type, offset, size } = section;
      sections.push({
        index,
        name,
        name_state,
        header_offset: exact(sectionOffset) + h,
        offset,
        size,
        address: section.address,
        type,
        flags: section.flags,
        link: section.link,
        info: section.info,
        entry_size: section.entrySize,
        file_backed:
          type !== 8 && declaredFileRange(fileSize, offset, size).file_backed,
      });
    }
  }
  return {
    format: "elf",
    elf_os_abi: header.osAbi,
    elf_type: header.type,
    bits,
    little,
    machine,
    flags: header.flags,
    ...(section_names_limitation === undefined
      ? {}
      : { section_names_limitation }),
    programs: programDeclarations,
    sections,
  };
}

export function* readPeSectionDirectory(
  fileSize: number,
): Generator<NativeReadRequest, NativeSectionDirectory, Buffer> {
  const dos = new BinaryReader(yield request(fileSize, 0n, 64n), true);
  if (dos.u16(0) !== 0x5a4d) reject("Missing DOS MZ header");
  const evidence = parseMzHeaderEvidence(dos.bytes, fileSize);
  const observed = evidence.windowsHeader;
  if (observed.state === "absent" || observed.state === "header-needed")
    return reject("MZ header does not declare a PE image");
  // A signature already observed in the DOS prefix establishes the layout
  // limitation even when the later COFF record is truncated.
  if (observed.state === "declared" && observed.signature === "PE") {
    const limitation = mzWindowsHeaderLayoutLimitation(observed);
    if (limitation !== undefined)
      throw new BinaryFormatFailure("unsupported", limitation);
  }
  const pe = observed.offset;
  const coff = new BinaryReader(yield request(fileSize, BigInt(pe), 24n), true);
  const confirmed = withMzWindowsHeaderSignature(
    dos.bytes,
    fileSize,
    evidence,
    { offset: pe, bytes: coff.bytes },
  ).windowsHeader;
  if (confirmed.state !== "declared" || confirmed.signature !== "PE")
    return reject("PE signature is invalid");
  const limitation = mzWindowsHeaderLayoutLimitation(confirmed);
  if (limitation !== undefined)
    throw new BinaryFormatFailure("unsupported", limitation);
  const parsedCoff = readPeCoffHeader(coff.bytes.subarray(4, 24));
  if (!parsedCoff.ok) return reject(parsedCoff.error.message);
  const {
    sectionCount: count,
    optionalHeaderSize: optionalSize,
    machine,
    characteristics,
  } = parsedCoff.value;
  const optional = readPeOptionalHeaderStructure(
    yield request(fileSize, BigInt(pe + 24), BigInt(optionalSize)),
  );
  if (!optional.ok) {
    switch (optional.error.reason) {
      case "truncated-magic":
        return reject("16-bit field range is truncated or outside the file");
      case "unsupported-magic":
        throw new BinaryFormatFailure(
          "unsupported",
          "Only PE32/PE32+ images are supported",
        );
      case "truncated-fixed-fields":
      case "truncated-directory-table":
        return reject("PE optional header or data directories are truncated");
    }
  }
  const { bits } = optional.value;
  const start = pe + 24 + optionalSize;
  const table = yield request(fileSize, BigInt(start), BigInt(count) * 40n);
  const sections: NativeSection[] = [];
  for (let index = 0; index < count; index++) {
    const parsed = readPeSectionHeader(
      table.subarray(index * 40, (index + 1) * 40),
    );
    if (!parsed.ok) return reject(parsed.error.message);
    const row = parsed.value;
    sections.push({
      index,
      name: row.name,
      name_state: "known",
      header_offset: start + index * 40,
      offset: BigInt(row.offset),
      size: BigInt(row.size),
      address: BigInt(row.virtual_address),
      type: 0,
      flags: BigInt(row.characteristics),
      link: 0,
      info: 0,
      entry_size: 0n,
      file_backed: declaredFileRange(
        fileSize,
        BigInt(row.offset),
        BigInt(row.size),
      ).file_backed,
    });
  }
  return {
    format: "pe",
    elf_os_abi: null,
    bits,
    little: true,
    machine,
    flags: characteristics,
    programs: [],
    sections,
  };
}

/** Borrow ELF bytes; file drivers satisfy the identical requests without loading payloads. */
export const readElfDirectoryFromBuffer = (
  bytes: Buffer,
): ElfSectionDirectory => {
  const steps = readElfSectionDirectory(bytes.length);
  let next = steps.next();
  while (!next.done) {
    const { offset, size } = next.value;
    next = steps.next(bytes.subarray(offset, offset + size));
  }
  return next.value;
};
