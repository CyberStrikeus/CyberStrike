import {
  machoDependencyCommand,
  readMachoDylibCommandFacts,
} from "../domain/apple/machoDylibCommand.js";
import { readMachoSectionHeader } from "../domain/apple/machoSectionHeader.js";
import {
  admitMachoSegmentMapping,
  readMachoSegmentHeader,
} from "../domain/apple/machoSegmentHeader.js";
import {
  MachoLoadCommandCursor,
  readMachoLoadCommandDeclarations,
} from "../domain/apple/machoLoadCommands.js";
import { createHash } from "node:crypto";
import {
  BinaryFormatFailure,
  createFileMappingIndex,
  type ZeroFillMapping,
  type FileMapping,
} from "./metadata/BinaryContainer.js";

import type { FixupCommands } from "./AppleMachoFixups.js";
import { decodeMachoFixedName, decodeMachoName } from "./AppleMachoNames.js";
import {
  MACHO_ARCHITECTURE_POLICIES,
  machoSubtypeRank,
} from "./MachoArchitectureSelection.js";
import { machoCpuSubtypeBase } from "../domain/apple/machoCpuIdentity.js";
import {
  readFatSliceDeclarations,
  readFatHeaderPrefix,
  validateFatSlice,
  validateFatSliceIdentity,
  type FatSliceDeclaration,
} from "../domain/apple/machoContainer.js";

/** One mapped Mach-O segment with file-backed VA range. */
export interface Segment {
  address: bigint;
  size: bigint;
  offset: number;
  executable: boolean;
}

/** Named Mach-O section within a loaded segment. */
export interface Section {
  name: string;
  address: bigint;
  size: number;
}

/** Selected thin slice bounds inside a Mach-O or FAT container. */
export interface MachoSlice {
  slice: number;
  sliceEnd: number;
  /** FAT table identity, absent for a thin image. */
  fatDeclaration?: FatSliceDeclaration & { readonly tableEnd: number };
}

/** Parsed little-endian 64-bit Mach-O layout for the selected architecture slice. */
export interface MachoLayout {
  segments: Segment[];
  sections: Section[];
  /** CPU identity and exact byte range selected from this source artifact. */
  selectedImage: {
    readonly container: "thin" | "fat";
    readonly offset: number;
    readonly byteLength: number;
    readonly cpuType: number;
    readonly cpuSubtype: number;
    readonly containerTableSha256: string | null;
  };
  /** Fixup load commands and dependent dylibs of the selected slice. */
  fixups: FixupCommands;
  /** VM address of the segment that maps file offset 0 (the preferred load address). */
  baseAddress: bigint;
  /** Map a virtual address range onto a file offset within the selected slice. */
  offset(address: bigint, size?: number): number;
}

const hex = (value: bigint) => `0x${value.toString(16)}`;

/** Select the thin Mach-O slice for `architecture` inside a FAT or thin container. */
export const selectMachoSlice = (
  bytes: Buffer,
  architecture: string,
): MachoSlice => {
  const header = readFatHeaderPrefix(bytes);
  if (header.state === "unknown")
    throw new RangeError("Truncated Mach-O header");
  if (header.state === "not-fat") return { slice: 0, sliceEnd: bytes.length };
  const { littleEndian, wide } = header;
  const byteOrder = littleEndian ? "little-endian" : "big-endian";
  const malformed = (reason: string) =>
    new RangeError(`${reason} (FAT header byte order: ${byteOrder})`);
  const invalid = (reason: string) =>
    new TypeError(`${reason} (FAT header byte order: ${byteOrder})`);
  if (header.state === "incomplete")
    throw malformed("Malformed FAT architecture table");
  const { count, tableEnd: headerEnd } = header;
  if (count > 128 || headerEnd > bytes.length)
    throw malformed("Malformed FAT architecture table");
  const policy = MACHO_ARCHITECTURE_POLICIES[architecture];
  if (policy === undefined)
    throw invalid("Requested FAT architecture is absent");
  const declarations = readFatSliceDeclarations(bytes.subarray(8, headerEnd), {
    count,
    wide,
    littleEndian,
  });
  if (declarations.status !== "parsed") throw malformed(declarations.reason);
  let best: FatSliceDeclaration | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  let ambiguous = false;
  for (const declaration of declarations.slices) {
    const issue = validateFatSlice(declaration, bytes.length, headerEnd);
    if (issue !== null) throw malformed(issue);
    if (declaration.cpuType !== policy.cpuType) continue;
    const rank = machoSubtypeRank(policy, declaration.cpuSubtype);
    if (best !== undefined && rank >= bestRank) {
      // Equal ranks keep FAT table order unless the slices share a subtype.
      if (
        rank === bestRank &&
        machoCpuSubtypeBase(declaration.cpuSubtype) ===
          machoCpuSubtypeBase(best.cpuSubtype)
      )
        ambiguous = true;
      continue;
    }
    best = declaration;
    bestRank = rank;
    ambiguous = false;
  }
  if (best === undefined) throw invalid("Requested FAT architecture is absent");
  if (ambiguous) throw invalid("Ambiguous FAT architecture slice");
  const selected: MachoSlice = {
    slice: best.offset,
    sliceEnd: best.offset + best.size,
    fatDeclaration: { ...best, tableEnd: headerEnd },
  };
  return selected;
};

/** A recognized Mach-O class outside this metadata reader's supported formats. */
export class UnsupportedMachoMetadataFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedMachoMetadataFormatError";
  }
}

/** Parse segments/sections for a little-endian 64-bit Mach-O architecture slice. */
export const parseMachoLayout = (
  bytes: Buffer,
  architecture: string,
): MachoLayout => {
  if (bytes.length < 4) throw new RangeError("Truncated Mach-O header");
  const selection = selectMachoSlice(bytes, architecture);
  const { slice, sliceEnd } = selection;
  if (slice + 4 > sliceEnd) throw new RangeError("Truncated Mach-O header");
  const selectedBytes = bytes.subarray(slice, sliceEnd);
  const declarations = readMachoLoadCommandDeclarations(
    selectedBytes,
    selectedBytes.length,
  );
  if (!declarations.ok) throw new RangeError("Truncated Mach-O header");
  if (declarations.value === null) {
    if (selectedBytes.length < 32)
      throw new RangeError("Truncated Mach-O header");
    throw new TypeError(
      "Only little-endian 64-bit Mach-O metadata is supported",
    );
  }
  const table = declarations.value;
  const { cpuType, cpuSubtype } = table.identity;
  const fat = selection.fatDeclaration;
  if (fat !== undefined) {
    const issue = validateFatSliceIdentity(fat, {
      cpuType,
      cpuSubtype,
    });
    if (issue !== null) throw new TypeError(issue);
  }
  if (table.wide && !table.littleEndian) {
    if (cpuType !== 0x01000012)
      throw new BinaryFormatFailure(
        "unsupported",
        "Unsupported big-endian Mach-O CPU type",
      );
    throw new UnsupportedMachoMetadataFormatError(
      "Unsupported big-endian 64-bit PowerPC Mach-O metadata",
    );
  }
  // A thin image has no FAT declaration to bind the requested CPU family.
  // Admit its parsed header before consumers attach the caller's architecture.
  if (MACHO_ARCHITECTURE_POLICIES[architecture]?.cpuType !== cpuType)
    throw new TypeError(
      `Mach-O CPU type does not match requested architecture ${architecture}`,
    );
  if (!table.wide)
    throw new UnsupportedMachoMetadataFormatError(
      `Unsupported 32-bit Mach-O metadata for requested CPU type ${architecture}`,
    );
  const commandEnd = slice + table.headerSize + table.commandBytes;
  if (commandEnd > sliceEnd)
    throw new RangeError("Malformed Mach-O command bounds");
  const state: LayoutState = {
    slice,
    sliceEnd,
    segments: [],
    mappings: [],
    zeroFills: [],
    sections: [],
    dylibs: [],
    binds: [],
    rebases: [],
    chained: null,
    baseAddress: undefined,
  };
  const framing = new MachoLoadCommandCursor(table);
  while (framing.nextOffset !== null) {
    const cursor = slice + table.headerSize + framing.nextOffset;
    const frame = framing.read(bytes.subarray(cursor, cursor + 8));
    if (!frame.ok) throw new RangeError(frame.error);
    const command = {
      cursor,
      kind: frame.value.command,
      size: frame.value.size,
    };
    if (command.kind === 0x19) collectSegment(bytes, command, state);
    else collectFixupCommand(bytes, command, state);
  }
  const complete = framing.finish();
  if (!complete.ok) throw new RangeError(complete.error);
  const { segments, sections, chained, binds, rebases, dylibs } = state;
  const mappings = createFileMappingIndex(state.mappings, state.zeroFills);
  const offset = (address: bigint, size = 1): number => {
    try {
      return mappings.offset(address, size);
    } catch (cause) {
      // Metadata consumers use RangeError to retain partial facts when a
      // pointer is unavailable. Mapping interpretation belongs to the shared
      // image reader, including aliases that only overlap part of the span.
      if (!(cause instanceof BinaryFormatFailure)) throw cause;
      throw new RangeError(
        `Unmapped or ambiguous metadata pointer ${hex(address)}`,
        { cause },
      );
    }
  };
  return {
    segments,
    sections,
    selectedImage: {
      container: fat === undefined ? "thin" : "fat",
      offset: slice,
      byteLength: sliceEnd - slice,
      cpuType,
      cpuSubtype,
      containerTableSha256:
        fat === undefined
          ? null
          : createHash("sha256")
              .update(bytes.subarray(0, fat.tableEnd))
              .digest("hex"),
    },
    offset,
    fixups: { chained, binds, rebases, dylibs },
    baseAddress: state.baseAddress ?? 0n,
  };
};

/** Load commands and fixup ranges collected while walking one slice. */
interface LayoutState {
  readonly slice: number;
  readonly sliceEnd: number;
  readonly segments: Segment[];
  readonly mappings: FileMapping[];
  readonly zeroFills: ZeroFillMapping[];
  readonly sections: Section[];
  readonly dylibs: FixupCommands["dylibs"][number][];
  readonly binds: FixupCommands["binds"][number][];
  readonly rebases: FixupCommands["rebases"][number][];
  chained: FixupCommands["chained"];
  baseAddress: bigint | undefined;
}

/** One load command header inside the selected slice. */
interface LoadCommand {
  readonly cursor: number;
  readonly kind: number;
  readonly size: number;
}

/** Record an `LC_SEGMENT_64` and its section table. */
const collectSegment = (
  bytes: Buffer,
  { cursor, size }: LoadCommand,
  state: LayoutState,
): void => {
  const parsed = readMachoSegmentHeader(
    bytes.subarray(cursor, cursor + size),
    true,
    true,
  );
  if (!parsed.ok) throw new RangeError("Truncated segment command");
  const {
    address,
    memorySize,
    nameBytes,
    fileSize,
    fileOffset,
    protection,
    sectionCount: count,
    headerSize,
  } = parsed.value;
  const admitted = admitMachoSegmentMapping(parsed.value, 64);
  if (!admitted.ok) throw new RangeError(admitted.error.message);
  if (fileOffset + fileSize > BigInt(state.sliceEnd - state.slice))
    throw new RangeError("Segment file range exceeds target bytes");
  const name = decodeMachoFixedName(nameBytes);
  state.segments.push({
    address,
    size: fileSize,
    offset: state.slice + Number(fileOffset),
    executable: (protection & 4) !== 0,
  });
  if (!admitted.value.unmapped && name !== "__PAGEZERO")
    state.mappings.push({
      address,
      size: Number(fileSize),
      offset: state.slice + Number(fileOffset),
    });
  if (memorySize > fileSize && name !== "__PAGEZERO")
    state.zeroFills.push({
      address: address + fileSize,
      size: memorySize - fileSize,
    });
  if (
    !admitted.value.unmapped &&
    name !== "__PAGEZERO" &&
    fileOffset === 0n &&
    fileSize > 0n
  )
    state.baseAddress ??= address;
  if (headerSize + count * 80 > size)
    throw new RangeError("Truncated section table");
  for (let section = 0; section < count; section++) {
    const position = cursor + headerSize + section * 80;
    const parsedSection = readMachoSectionHeader(
      bytes.subarray(position, position + 80),
      true,
      true,
    );
    if (!parsedSection.ok) throw new RangeError("Truncated section table");
    const { nameBytes, address, size: sectionSize } = parsedSection.value;
    if (sectionSize > BigInt(Number.MAX_SAFE_INTEGER))
      throw new RangeError("Section size exceeds exact numeric range");
    state.sections.push({
      name: decodeMachoFixedName(nameBytes),
      address,
      size: Number(sectionSize),
    });
  }
};

const LC_DYLD_INFO = 0x22;
const LC_DYLD_INFO_ONLY = 0x80000022;
const LC_DYLD_CHAINED_FIXUPS = 0x80000034;

/** Record fixup data ranges and dylib install names from one load command. */
const collectFixupCommand = (
  bytes: Buffer,
  { cursor, kind, size }: LoadCommand,
  state: LayoutState,
): void => {
  const range = (at: number): { offset: number; size: number } => {
    const offset = state.slice + bytes.readUInt32LE(at);
    const length = bytes.readUInt32LE(at + 4);
    if (offset + length > state.sliceEnd)
      throw new RangeError("Fixup data exceeds the Mach-O slice");
    return { offset, size: length };
  };
  if (kind === LC_DYLD_CHAINED_FIXUPS) {
    if (size < 16) throw new RangeError("Truncated chained-fixups command");
    state.chained = range(cursor + 8);
  } else if (kind === LC_DYLD_INFO || kind === LC_DYLD_INFO_ONLY) {
    if (size < 48) throw new RangeError("Truncated dyld-info command");
    const rebase = range(cursor + 8);
    if (rebase.size > 0) state.rebases.push(rebase);
    for (const [at, stream] of [
      [cursor + 16, "bind"],
      [cursor + 24, "weak"],
      [cursor + 32, "lazy"],
    ] as const) {
      const bound = range(at);
      if (bound.size > 0) state.binds.push({ ...bound, stream });
    }
  } else if (machoDependencyCommand(kind) !== null) {
    const parsed = readMachoDylibCommandFacts(
      bytes.subarray(cursor, cursor + size),
      true,
    );
    if (!parsed.ok) {
      if (parsed.error._tag === "InvalidMachoDylibCommand")
        throw new RangeError("Truncated dylib command");
      if (parsed.error.reason === "unterminated")
        throw new RangeError("Unterminated dylib install name");
      throw new RangeError("Dylib install name is outside its load command");
    }
    const { nameBytes } = parsed.value;
    state.dylibs.push(
      decodeMachoName(
        Buffer.from(
          nameBytes.buffer,
          nameBytes.byteOffset,
          nameBytes.byteLength,
        ),
      ),
    );
  }
};
