import {
  observeElfStringTableEntry,
  elfStringTableText,
} from "../domain/elfStringTable.js";
import { readElfDynamicEntry } from "../domain/elfDynamicEntry.js";
import { readElfSectionHeader } from "../domain/elfSectionHeader.js";
import { readElfProgramHeader } from "../domain/elfProgramHeader.js";
import { readElfSymbol } from "../domain/elfSymbol.js";
import { readElfRawTableDeclarations } from "../domain/elfRawTableDeclarations.js";
import { Buffer } from "node:buffer";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { createElfLoadMap } from "./ElfLoadMap.js";
import {
  SNAPSHOT_HASH_LENGTH,
  SNAPSHOT_HASH_OFFSET,
  SNAPSHOT_HASH_PATTERN,
} from "./FlutterPayloadScan.js";
import { readElfFixedHeader } from "../domain/elfFixedHeader.js";

/** Bounds-checked little-endian reader over one loaded buffer. */
class BoundedReader {
  constructor(private readonly bytes: Buffer) {}

  u8(offset: number): number | null {
    return offset < this.bytes.length ? this.bytes.readUInt8(offset) : null;
  }

  u32(offset: number): number | null {
    return offset + 4 <= this.bytes.length
      ? this.bytes.readUInt32LE(offset)
      : null;
  }

  u64(offset: number): number | null {
    const low = this.u32(offset);
    const high = this.u32(offset + 4);
    if (low === null || high === null || high > 0x001fffff) return null;
    return high * 0x1_0000_0000 + low;
  }

  cString(offset: number, tableEnd: number): string | null {
    if (tableEnd < 0 || tableEnd > this.bytes.length) return null;
    return elfStringTableText(
      observeElfStringTableEntry(this.bytes.subarray(0, tableEnd), offset, 257),
    );
  }
}

export interface ElfSymbol {
  readonly name: string;
  /** File offset mapped from the virtual address through PT_LOAD. */
  readonly offset: number;
  readonly size: number;
}

export interface ElfParseFailure {
  readonly reason: string;
}

const SHT_DYNSYM = 11;
const SHF_ALLOC = 2;
const PT_LOAD = 1;
const PT_DYNAMIC = 2;
/** Position-independent executable images carry PT_DYNAMIC. */
const ET_DYN = 3;
const DT_NULL = 0;
const DT_HASH = 4;
const DT_STRTAB = 5;
const DT_SYMTAB = 6;
const DT_STRSZ = 10;
const DT_SYMENT = 11;
const DT_GNU_HASH = 0x6ffffef5;

/** ELF32 needs 52 bytes, ELF64 needs 64; retain at most this prefix. */
export const ELF_HEADER_MAX_BYTES = 64;

/**
 * Decode the supported ELF header and validate its table extents against
 * the complete image size. The buffer may contain only the header prefix;
 * this does not validate table contents or symbol availability.
 */
export const readElfHeader = (
  bytes: Buffer,
  totalBytes: number = bytes.length,
) => {
  const fixedHeader = readElfFixedHeader(bytes, totalBytes);
  if (!fixedHeader.ok) return { failure: { reason: fixedHeader.error } };
  const is64 = fixedHeader.value.elfClass === 64;
  const headerBytes = is64 ? ELF_HEADER_MAX_BYTES : 52;
  if (fixedHeader.value.byteOrder !== "little")
    return { failure: { reason: "unsupported ELF byte order" } };
  if (fixedHeader.value.headerSize !== headerBytes)
    return { failure: { reason: "unsupported ELF header size" } };
  const e_type = fixedHeader.value.type;
  if (e_type !== 1 && e_type !== 2 && e_type !== ET_DYN)
    return { failure: { reason: "unsupported ELF type" } };
  const raw = readElfRawTableDeclarations(bytes, fixedHeader.value);
  if (!raw.ok) return { failure: { reason: raw.error.message } };
  const { programs, sections } = raw.value;
  const e_shoff =
    sections.offset <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(sections.offset)
      : null;
  const e_shentsize = sections.width;
  const e_shnum = sections.count;
  const e_phoff =
    programs.offset <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(programs.offset)
      : null;
  const e_phentsize = programs.width;
  const e_phnum = programs.count;
  const tableFits = (
    offset: number | null,
    width: number,
    count: number,
    minimumWidth: number,
  ): boolean =>
    offset !== null &&
    offset >= headerBytes &&
    offset <= totalBytes &&
    width >= minimumWidth &&
    count > 0 &&
    count <= Math.floor((totalBytes - offset) / width);
  const MIN_SHENT = is64 ? 64 : 40;
  // Section-stripped ET_DYN images may omit the section directory. This
  // describes header availability, not which symbol-table source is usable.
  // A nonzero shoff with shnum=0 uses extended numbering, which this
  // parser does not support; it must not masquerade as a stripped image.
  const sectionTableAbsent =
    e_type === ET_DYN && e_shoff === 0 && e_shnum === 0;
  if (
    e_shoff === null ||
    (!sectionTableAbsent &&
      !tableFits(e_shoff, e_shentsize, e_shnum, MIN_SHENT))
  )
    return {
      failure: {
        reason: "ELF section header table is missing or out of bounds",
      },
    };
  const MIN_PHENT = is64 ? 56 : 32;
  if (
    e_phoff === null ||
    e_phnum === 0xffff ||
    !tableFits(e_phoff, e_phentsize, e_phnum, MIN_PHENT)
  )
    return {
      failure: {
        reason: "ELF program header table is missing or out of bounds",
      },
    };

  return {
    header: {
      is64,
      sectionTableAbsent,
      e_shoff,
      e_shentsize,
      e_shnum,
      e_phoff,
      e_phentsize,
      e_phnum,
    },
  };
};

export interface ElfSymbolInventory {
  readonly symbols: readonly ElfSymbol[];
  readonly failures: readonly ElfParseFailure[];
}

/** Decode the ELF tables once and resolve only the requested definitions. */
export const readElfSymbols = async (
  bytes: Buffer,
  symbolNames: readonly string[],
  signal?: AbortSignal,
): Promise<ElfSymbolInventory> => {
  signal?.throwIfAborted();
  const failure = (reason: string): ElfSymbolInventory => ({
    symbols: [],
    failures: [{ reason }],
  });
  const parsed = readElfHeader(bytes);
  if (parsed.failure !== undefined) return failure(parsed.failure.reason);
  const {
    is64,
    sectionTableAbsent,
    e_shoff,
    e_shentsize,
    e_shnum,
    e_phoff,
    e_phentsize,
    e_phnum,
  } = parsed.header;
  const reader = new BoundedReader(bytes);
  const entrySize = is64 ? 24 : 16;
  const segments: { vaddr: number; offset: number; filesz: number }[] = [];
  let dynamicSegment: { offset: number; filesz: number } | null = null;
  for (let index = 0; index < e_phnum; index += 1) {
    if (index % 4096 === 0) {
      await yieldToEventLoop();
      signal?.throwIfAborted();
    }
    const base = e_phoff + index * e_phentsize;
    const parsedProgram = readElfProgramHeader(
      bytes.subarray(base, base + e_phentsize),
      is64 ? 64 : 32,
      true,
    );
    if (!parsedProgram.ok) return failure(parsedProgram.error.message);
    const program = parsedProgram.value;
    const { type } = program;
    if (type !== PT_LOAD && type !== PT_DYNAMIC) continue;
    if (
      program.virtualAddress > BigInt(Number.MAX_SAFE_INTEGER) ||
      program.offset > BigInt(Number.MAX_SAFE_INTEGER) ||
      program.fileSize > BigInt(Number.MAX_SAFE_INTEGER)
    )
      return failure(`ELF segment ${String(index)} is not file-backed`);
    const vaddr = Number(program.virtualAddress);
    const offset = Number(program.offset);
    const filesz = Number(program.fileSize);
    if (
      !Number.isSafeInteger(vaddr + filesz) ||
      offset > bytes.length ||
      filesz > bytes.length - offset
    )
      return failure(`ELF segment ${String(index)} is not file-backed`);
    if (type === PT_LOAD) segments.push({ vaddr, offset, filesz });
    else if (dynamicSegment !== null)
      return failure("Multiple PT_DYNAMIC segments are ambiguous");
    else dynamicSegment = { offset, filesz };
  }
  const toOffset = await createElfLoadMap(segments, signal);
  if (segments.length === 0)
    return failure("ELF image has no PT_LOAD segments");
  const tables: {
    source: "section" | "dynamic-segment";
    offset: number;
    count: number;
    stringOffset: number;
    stringSize: number;
  }[] = [];
  /**
   * The loader reads an allocated section through PT_LOAD, so its section
   * offset must be the single file interpretation of its address range.
   */
  const sectionMappingFailure = (
    section: { readonly flags: bigint; readonly address: bigint },
    offset: number,
    size: number,
  ): string | undefined => {
    const flags = Number(section.flags);
    const address = Number(section.address);
    if (!Number.isSafeInteger(flags) || !Number.isSafeInteger(address))
      return "has an unrepresentable section header";
    if ((flags & SHF_ALLOC) === 0) return undefined;
    const mapped = toOffset(address, size);
    if (!mapped.ok) return mapped.error.reason;
    return mapped.value === offset
      ? undefined
      : "section offset disagrees with its PT_LOAD mapping";
  };
  if (!sectionTableAbsent) {
    for (let index = 0; index < e_shnum; index += 1) {
      if (index % 4096 === 0) {
        await yieldToEventLoop();
        signal?.throwIfAborted();
      }
      const header = e_shoff + index * e_shentsize;
      const parsedSection = readElfSectionHeader(
        bytes.subarray(header, header + e_shentsize),
        is64 ? 64 : 32,
        true,
      );
      if (!parsedSection.ok) return failure(parsedSection.error.message);
      const section = parsedSection.value;
      if (section.type !== SHT_DYNSYM) continue;
      const offset = Number(section.offset);
      const size = Number(section.size);
      const link = section.link;
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(size) ||
        section.entrySize !== BigInt(entrySize) ||
        offset > bytes.length ||
        size > bytes.length - offset ||
        size % entrySize !== 0
      )
        return failure("Dynamic symbol table is malformed");
      if (link >= e_shnum)
        return failure("Dynamic symbol string section link is invalid");
      const stringHeader = e_shoff + link * e_shentsize;
      const parsedStrings = readElfSectionHeader(
        bytes.subarray(stringHeader, stringHeader + e_shentsize),
        is64 ? 64 : 32,
        true,
      );
      if (!parsedStrings.ok) return failure(parsedStrings.error.message);
      const strings = parsedStrings.value;
      const stringOffset = Number(strings.offset);
      const stringSize = Number(strings.size);
      if (
        strings.type !== 3 ||
        !Number.isSafeInteger(stringOffset) ||
        !Number.isSafeInteger(stringSize) ||
        stringOffset > bytes.length ||
        stringSize > bytes.length - stringOffset
      )
        return failure(
          "Dynamic symbol strings are out of bounds or not a string table",
        );
      const symbolMapping = sectionMappingFailure(section, offset, size);
      if (symbolMapping !== undefined)
        return failure(`Dynamic symbol table ${symbolMapping}`);
      const stringMapping = sectionMappingFailure(
        strings,
        stringOffset,
        stringSize,
      );
      if (stringMapping !== undefined)
        return failure(`Dynamic symbol string table ${stringMapping}`);
      tables.push({
        source: "section",
        offset,
        count: size / entrySize,
        stringOffset,
        stringSize,
      });
    }
  }
  // A retained section directory may omit SHT_DYNSYM while PT_DYNAMIC still
  // describes the runtime symbols. A malformed present section already failed
  // above; it must not be bypassed by an alternative interpretation.
  if (tables.length === 0 && dynamicSegment !== null) {
    const tags = new Map<number, number>();
    const dynamicEntrySize = is64 ? 16 : 8;
    let terminated = false;
    for (
      let base = dynamicSegment.offset;
      base + dynamicEntrySize <= dynamicSegment.offset + dynamicSegment.filesz;
      base += dynamicEntrySize
    ) {
      if ((base - dynamicSegment.offset) % (4096 * dynamicEntrySize) === 0) {
        await yieldToEventLoop();
        signal?.throwIfAborted();
      }
      const parsedEntry = readElfDynamicEntry(
        bytes.subarray(base, base + dynamicEntrySize),
        is64 ? 64 : 32,
        true,
      );
      if (!parsedEntry.ok) return failure(parsedEntry.error.message);
      // This reader historically admits tag identities as unsigned, safe numbers.
      const tagBits = BigInt.asUintN(is64 ? 64 : 32, parsedEntry.value.tag);
      if (tagBits > BigInt(Number.MAX_SAFE_INTEGER))
        return failure("Dynamic entry is not representable");
      const tag = Number(tagBits);
      // ELF defines d_un as ignored for DT_NULL; validate the complete entry
      // above, but do not interpret a value that has no meaning.
      if (tag === DT_NULL) {
        terminated = true;
        break;
      }
      // Interpret d_un only for the symbol-table description consumed here.
      // In particular, DT_SYMBOLIC, DT_TEXTREL and DT_BIND_NOW have ignored
      // payloads under the ELF ABI; their arbitrary bits are not numeric bounds.
      if (
        ![
          DT_SYMTAB,
          DT_STRTAB,
          DT_STRSZ,
          DT_SYMENT,
          DT_HASH,
          DT_GNU_HASH,
        ].includes(tag)
      )
        continue;
      if (parsedEntry.value.value > BigInt(Number.MAX_SAFE_INTEGER))
        return failure("Dynamic entry is not representable");
      const value = Number(parsedEntry.value.value);
      if (tags.has(tag) && tags.get(tag) !== value)
        return failure("Conflicting dynamic table tags");
      tags.set(tag, value);
    }
    const sym = tags.get(DT_SYMTAB);
    const str = tags.get(DT_STRTAB);
    const stringSize = tags.get(DT_STRSZ);
    if (
      !terminated ||
      sym === undefined ||
      str === undefined ||
      stringSize === undefined ||
      tags.get(DT_SYMENT) !== entrySize
    )
      return failure(
        "Stripped ELF lacks a complete dynamic symbol-table description",
      );
    // DT_HASH's nchain is the dynsym count. GNU hash instead records the
    // first hashed index and bounded buckets/chains. No payload-to-EOF walk.
    let count: number;
    const sysv = tags.get(DT_HASH);
    const gnu = tags.get(DT_GNU_HASH);
    if (sysv !== undefined) {
      const at = toOffset(sysv, 8);
      if (!at.ok) return failure(`DT_HASH header ${at.error.reason}`);
      const buckets = reader.u32(at.value)!;
      count = reader.u32(at.value + 4)!;
      const table = toOffset(sysv, 8 + 4 * (buckets + count));
      if (!table.ok) return failure(`DT_HASH table ${table.error.reason}`);
    } else if (gnu !== undefined) {
      const at = toOffset(gnu, 16);
      if (!at.ok) return failure(`DT_GNU_HASH header ${at.error.reason}`);
      const buckets = reader.u32(at.value)!;
      const firstSymbol = reader.u32(at.value + 4)!;
      const bloomWords = reader.u32(at.value + 8)!;
      const prefixBytes = 16 + bloomWords * (is64 ? 8 : 4) + buckets * 4;
      if (buckets === 0 || bloomWords === 0)
        return failure("DT_GNU_HASH buckets are malformed");
      const prefix = toOffset(gnu, prefixBytes);
      if (!prefix.ok)
        return failure(`DT_GNU_HASH buckets ${prefix.error.reason}`);
      let last = 0;
      const bucketsAt = at.value + 16 + bloomWords * (is64 ? 8 : 4);
      for (let index = 0; index < buckets; index += 1) {
        if (index % 4096 === 0) {
          await yieldToEventLoop();
          signal?.throwIfAborted();
        }
        const value = reader.u32(bucketsAt + index * 4)!;
        if (value !== 0 && value < firstSymbol)
          return failure("DT_GNU_HASH bucket precedes its first symbol");
        last = Math.max(last, value);
      }
      count = firstSymbol;
      if (last !== 0) {
        let index = last;
        while (true) {
          if ((index - last) % 4096 === 0) {
            await yieldToEventLoop();
            signal?.throwIfAborted();
          }
          const span = prefixBytes + (index - firstSymbol + 1) * 4;
          const range = toOffset(gnu, span);
          if (!range.ok)
            return failure(`DT_GNU_HASH chain ${range.error.reason}`);
          const chain = reader.u32(at.value + span - 4)!;
          index += 1;
          if ((chain & 1) !== 0) {
            count = index;
            break;
          }
        }
      }
    } else
      return failure("Stripped ELF has no DT_HASH or DT_GNU_HASH symbol count");
    const offset = toOffset(sym, count * entrySize);
    const stringOffset = toOffset(str, stringSize);
    if (!offset.ok)
      return failure(`Dynamic symbol table ${offset.error.reason}`);
    if (!stringOffset.ok)
      return failure(`Dynamic string table ${stringOffset.error.reason}`);
    tables.push({
      source: "dynamic-segment",
      offset: offset.value,
      count,
      stringOffset: stringOffset.value,
      stringSize,
    });
  }
  const wanted = new Set(symbolNames);
  const symbols = new Map<string, ElfSymbol>();
  const ambiguous = new Set<string>();
  const unresolved = new Set<string>();
  const failures = new Set<string>();
  for (const table of tables) {
    for (let index = 0; index < table.count; index += 1) {
      if (index % 4096 === 0) {
        await yieldToEventLoop();
        signal?.throwIfAborted();
      }
      const base = table.offset + index * entrySize;
      const parsedSymbol = readElfSymbol(
        bytes.subarray(base, base + entrySize),
        is64 ? 64 : 32,
        true,
      );
      if (!parsedSymbol.ok) return failure(parsedSymbol.error.message);
      const symbol = parsedSymbol.value;
      const nameOffset = symbol.name_offset;
      const sectionIndex = symbol.section_index;
      const defined =
        sectionIndex === 0xfff1 ||
        (sectionIndex > 0 &&
          sectionIndex < 0xff00 &&
          (table.source === "dynamic-segment" || sectionIndex < e_shnum));
      if (!defined || nameOffset >= table.stringSize) continue;
      const name = reader.cString(
        table.stringOffset + nameOffset,
        table.stringOffset + table.stringSize,
      );
      if (name === null || !wanted.has(name)) continue;
      if (
        symbol.value > BigInt(Number.MAX_SAFE_INTEGER) ||
        symbol.size > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        failures.add(`Symbol ${name} has unrepresentable bounds`);
        unresolved.add(name);
        continue;
      }
      const value = Number(symbol.value);
      const size = Number(symbol.size);
      const offset = toOffset(value, size);
      if (!offset.ok) {
        failures.add(`Symbol ${name} ${offset.error.reason}`);
        unresolved.add(name);
        continue;
      }
      const previous = symbols.get(name);
      if (
        previous !== undefined &&
        (previous.offset !== offset.value || previous.size !== size)
      )
        ambiguous.add(name);
      else symbols.set(name, { name, offset: offset.value, size });
    }
  }
  for (const name of ambiguous) {
    symbols.delete(name);
    failures.add(`Symbol ${name} has conflicting definitions`);
  }
  for (const name of unresolved) symbols.delete(name);
  for (const name of wanted)
    if (!symbols.has(name) && !ambiguous.has(name) && !unresolved.has(name))
      failures.add(`symbol ${name} is not in the dynamic symbol table`);
  return {
    symbols: [...symbols.values()],
    failures: [...failures].map((reason) => ({ reason })),
  };
};

/** Read one Dart snapshot section header from its file offset. */
export const readSnapshotHeader = (
  bytes: Buffer,
  offset: number,
): {
  magicValid: boolean;
  kind: number | null;
  headerLength: number | null;
  hash: string | null;
  complete: boolean;
} => {
  const reader = new BoundedReader(bytes);
  // The Dart magic bytes f5 f5 dc dc read little-endian. Kind and length
  // fields are only meaningful in data-section headers; sections without
  // the magic (instructions carry a different layout) report nulls.
  const magic = reader.u32(offset);
  if (magic !== 0xdcdcf5f5)
    return {
      magicValid: false,
      kind: null,
      headerLength: null,
      hash: null,
      complete: false,
    };
  const headerLength = reader.u64(offset + 4);
  const kind = reader.u64(offset + 12);
  const candidate = bytes
    .subarray(
      offset + SNAPSHOT_HASH_OFFSET,
      offset + SNAPSHOT_HASH_OFFSET + SNAPSHOT_HASH_LENGTH,
    )
    .toString("latin1");
  const hash = SNAPSHOT_HASH_PATTERN.test(candidate) ? candidate : null;
  // Dart's stored length excludes the four magic bytes and includes the
  // 20-byte fixed header and the version hash. Aligned data may follow it
  // inside the exported symbol, but the serialized snapshot must fit.
  // Kind 3 is FullAOT in the supported Dart 2.14 layout; enum values change
  // across SDK versions, so other kinds remain uninterpreted observations.
  const complete =
    headerLength !== null &&
    headerLength >= SNAPSHOT_HASH_OFFSET + SNAPSHOT_HASH_LENGTH - 4 &&
    headerLength <= bytes.length - offset - 4 &&
    kind === 3 &&
    hash !== null;
  return { magicValid: true, kind, headerLength, hash, complete };
};
