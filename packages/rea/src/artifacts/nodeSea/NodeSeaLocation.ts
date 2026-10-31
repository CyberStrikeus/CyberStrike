import { readMachoSegmentHeader } from "../../domain/apple/machoSegmentHeader.js";
import { readMachoSectionHeader } from "../../domain/apple/machoSectionHeader.js";
import { readElfSectionHeader } from "../../domain/elfSectionHeader.js";
import { readElfProgramHeader } from "../../domain/elfProgramHeader.js";
import { readElfRawTableDeclarations } from "../../domain/elfRawTableDeclarations.js";
import { createHash } from "node:crypto";
import { parsePeResources } from "../../native/pe/PeResourceParser.js";
import {
  hasPeResourceName,
  readPeResourceLayout,
} from "../../native/pe/PeResourceLayout.js";
import {
  MAX_INSPECT_PE_FILE_BYTES,
  MAX_INSPECT_PE_DIRECTORY_ENTRIES,
} from "../../domain/native/peResources.js";
import type { FileHandle } from "node:fs/promises";

import { abortIfNeeded } from "../ArtifactHash.js";
import { ArtifactReaderFailure } from "../ArtifactReader.js";
import {
  readFatContainerHeader,
  readFatHeaderPrefix,
  readMachoHeaderPrefixFacts,
} from "../../domain/apple/machoContainer.js";
import { readElfFixedHeader } from "../../domain/elfFixedHeader.js";
import { readMachoLoadCommandTableHeader } from "../../domain/apple/machoLoadCommands.js";
import {
  elfNoteAlignment,
  elfNoteLayout,
  readElfNoteHeader,
} from "../../domain/native/elfNoteLayout.js";
import {
  NODE_SEA_BLOB_TOO_LARGE,
  NODE_SEA_DUPLICATE_BLOB,
  NODE_SEA_ELF_DESCRIPTOR_TRUNCATED,
  NODE_SEA_ELF_TABLE_TRUNCATED,
  NODE_SEA_MACHO_COMMANDS_TRUNCATED,
  NODE_SEA_MACHO_SEGMENT_TRUNCATED,
  NODE_SEA_MAX_BLOB_BYTES,
  NODE_SEA_TRUNCATED,
  observeNodeSeaFuseMatches,
  type NodeSeaFuseObservation,
} from "./NodeSeaBlob.js";

const LC_SEGMENT = 0x1;
const LC_SEGMENT_64 = 0x19;
const PT_NOTE = 4;
const SHT_NOTE = 7;
const RT_RCDATA = 10;
const RESOURCE_NAME = "NODE_SEA_BLOB";
const SEA_SECTION = "__NODE_SEA_BLOB";
const MAX_COMMAND_BYTES = 8 * 1024 * 1024;
const MAX_ELF_HEADERS = 4096;
const MAX_NOTE_NAME_BYTES = 4096;
const FUSE_LENGTH = "NODE_SEA_FUSE_".length + 32 + 2;
// PE header structures must fit this prefix for the bounded name probe.
const PE_HEADER_PROBE_BYTES = 64 * 1024;

/** One injected blob inside a native carrier. Offsets are carrier file offsets. */
export interface NodeSeaLocation {
  readonly carrier: "mach-o" | "elf" | "pe";
  readonly blobOffset: number;
  readonly blobLength: number;
}

interface BlobRange {
  readonly offset: number;
  readonly length: number;
}

interface Carrier {
  readonly handle: FileHandle;
  readonly fileSize: number;
  readonly signal: AbortSignal | undefined;
}

const formatFailure = (message: string): ArtifactReaderFailure =>
  new ArtifactReaderFailure("format", message);

const limitFailure = (message: string): ArtifactReaderFailure =>
  new ArtifactReaderFailure("limit", message, { boundary: "memory" });

/**
 * Find a postject `NODE_SEA_BLOB` slot. Mach-O accepts segment `NODE_SEA`
 * (the postject name) and `__NODE_SEA`. ELF matches the full note owner
 * `NODE_SEA_BLOB` in `PT_NOTE` and `SHT_NOTE`. PE matches RCDATA type 10
 * named `NODE_SEA_BLOB`. Tables that cannot be parsed before that name is
 * confirmed leave the carrier unrecognized. A confirmed slot that is
 * truncated, ambiguous, or declared twice fails closed.
 */
export const locateNodeSea = async (
  handle: FileHandle,
  fileSize: number,
  signal?: AbortSignal,
): Promise<NodeSeaLocation | undefined> => {
  if (!Number.isSafeInteger(fileSize) || fileSize < 4) return undefined;
  const carrier: Carrier = { handle, fileSize, signal };
  const prefix = await readExact(carrier, 0, Math.min(fileSize, 64));
  if (prefix === undefined || prefix.length < 4) return undefined;
  const thin = readMachoHeaderPrefixFacts(prefix).format;
  const fat = readFatHeaderPrefix(prefix);
  if (thin !== null || fat.state === "incomplete" || fat.state === "parsed") {
    const ranges =
      thin !== null
        ? await locateThinMachO(carrier, 0, fileSize)
        : await locateFatMachO(carrier, prefix);
    return collapseRanges(carrier, "mach-o", ranges);
  }
  if (prefix.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])))
    return collapseRanges(
      carrier,
      "elf",
      await locateElfNotes(carrier, prefix),
    );
  if (prefix[0] === 0x4d && prefix[1] === 0x5a)
    return collapseRanges(carrier, "pe", await locatePeResources(carrier));
  return undefined;
};

/** Read a located blob, refusing declarations above the in-memory cap. */
export const readNodeSeaBlob = async (
  handle: FileHandle,
  location: NodeSeaLocation,
  fileSize: number,
  signal?: AbortSignal,
): Promise<Buffer> => {
  if (location.blobLength > NODE_SEA_MAX_BLOB_BYTES)
    throw limitFailure(NODE_SEA_BLOB_TOO_LARGE);
  const bytes = await readExact(
    { handle, fileSize, signal },
    location.blobOffset,
    location.blobLength,
  );
  if (bytes === undefined) throw formatFailure(NODE_SEA_TRUNCATED);
  return bytes;
};

/**
 * Stream the carrier for `NODE_SEA_FUSE_<hash>:[01]`. The blob bytes are
 * included, so a script that embeds the sentinel text is observed too.
 */
export const scanNodeSeaFuse = async (
  handle: FileHandle,
  fileSize: number,
  signal?: AbortSignal,
): Promise<NodeSeaFuseObservation> => {
  const carrier: Carrier = { handle, fileSize, signal };
  const matches = new Set<string>();
  const overlap = FUSE_LENGTH - 1;
  let carry: Buffer = Buffer.alloc(0);
  let position = 0;
  while (position < fileSize) {
    const length = Math.min(64 * 1024, fileSize - position);
    const chunk = await readExact(carrier, position, length);
    if (chunk === undefined)
      throw new ArtifactReaderFailure(
        "integrity",
        "Node SEA carrier shrank during the fuse scan",
      );
    const window = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
    for (const match of window
      .toString("latin1")
      .matchAll(/NODE_SEA_FUSE_[0-9a-f]{32}:[01]/gu))
      if (match[0] !== undefined) {
        matches.add(match[0]);
        // Two distinct sentinels already establish conflict. The public fact
        // needs no unbounded set of all sentinel-like strings in asset bytes.
        if (matches.size > 1) return observeNodeSeaFuseMatches([...matches]);
      }
    carry = window.subarray(Math.max(0, window.length - overlap));
    position += length;
  }
  return observeNodeSeaFuseMatches([...matches]);
};

const collapseRanges = async (
  carrier: Carrier,
  kind: NodeSeaLocation["carrier"],
  ranges: readonly BlobRange[],
): Promise<NodeSeaLocation | undefined> => {
  const unique: BlobRange[] = [];
  const seen = new Set<string>();
  for (const range of ranges) {
    const key = `${String(range.offset)}:${String(range.length)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(range);
  }
  const chosen = unique[0];
  if (chosen === undefined) return undefined;
  if (unique.length > 1) {
    const hashes = new Set<string>();
    for (const range of unique)
      hashes.add(await digestRange(carrier, range.offset, range.length));
    if (hashes.size !== 1) throw formatFailure(NODE_SEA_DUPLICATE_BLOB);
  }
  return {
    carrier: kind,
    blobOffset: chosen.offset,
    blobLength: chosen.length,
  };
};

const locateFatMachO = async (
  carrier: Carrier,
  prefix: Buffer,
): Promise<BlobRange[]> => {
  let bytes = prefix;
  let header = readFatContainerHeader(bytes, carrier.fileSize);
  if (header.state === "needs-data") {
    const required = await readExact(
      carrier,
      0,
      Math.min(carrier.fileSize, header.requiredBytes),
    );
    if (required === undefined || required.length < header.requiredBytes)
      return [];
    bytes = required;
    header = readFatContainerHeader(bytes, carrier.fileSize);
  }
  if (header.state !== "parsed") {
    if (readMachoHeaderPrefixFacts(bytes).format !== null)
      return locateThinMachO(carrier, 0, carrier.fileSize);
    return [];
  }
  const found: BlobRange[] = [];
  for (const [index, slice] of header.slices.entries()) {
    if (slice === undefined || header.rangeIssues[index] != null) continue;
    found.push(...(await locateThinMachO(carrier, slice.offset, slice.size)));
  }
  return found;
};

const locateThinMachO = async (
  carrier: Carrier,
  base: number,
  sliceSize: number,
): Promise<BlobRange[]> => {
  if (
    !Number.isSafeInteger(base) ||
    !Number.isSafeInteger(sliceSize) ||
    base < 0 ||
    sliceSize < 32 ||
    base > carrier.fileSize ||
    sliceSize > carrier.fileSize - base
  )
    return [];
  const header = await readExact(carrier, base, 32);
  if (header === undefined) return [];
  const framing = readMachoLoadCommandTableHeader(header, sliceSize);
  if (!framing.ok || framing.value === null) return [];
  const {
    headerSize,
    littleEndian: little,
    commandCount: ncmds,
    commandBytes: sizeofcmds,
  } = framing.value;
  if (sizeofcmds > MAX_COMMAND_BYTES) return [];
  const commands = await readExact(carrier, base + headerSize, sizeofcmds);
  if (commands === undefined) return [];
  const found: BlobRange[] = [];
  let offset = 0;
  let seen = 0;
  while (offset + 8 <= commands.length && seen < ncmds) {
    abortIfNeeded(carrier.signal);
    const cmd = readU32(commands, offset, little);
    const cmdsize = readU32(commands, offset + 4, little);
    if (cmdsize < 8 || offset + cmdsize > commands.length) {
      if (found.length > 0)
        throw formatFailure(NODE_SEA_MACHO_COMMANDS_TRUNCATED);
      return found;
    }
    if (cmd === LC_SEGMENT || cmd === LC_SEGMENT_64) {
      const segment64 = cmd === LC_SEGMENT_64;
      const sectionSize = segment64 ? 80 : 68;
      const parsedSegment = readMachoSegmentHeader(
        commands.subarray(offset, offset + cmdsize),
        segment64,
        little,
      );
      // Incomplete segments cannot establish a SEA carrier. Interpret names
      // and section framing only from the shared fixed-record observation.
      const segment = parsedSegment.ok ? parsedSegment.value : undefined;
      const name =
        segment === undefined ? undefined : cString(segment.nameBytes, 0, 16);
      if (
        segment !== undefined &&
        (name === "NODE_SEA" || name === "__NODE_SEA")
      ) {
        const segmentHeader = segment.headerSize;
        const nsects = segment.sectionCount;
        const table = offset + segmentHeader;
        if (
          nsects > Math.floor((cmdsize - segmentHeader) / sectionSize) ||
          table + nsects * sectionSize > offset + cmdsize
        )
          throw formatFailure(NODE_SEA_MACHO_SEGMENT_TRUNCATED);
        for (let index = 0; index < nsects; index += 1) {
          const section = table + index * sectionSize;
          const parsedSection = readMachoSectionHeader(
            commands.subarray(section, section + sectionSize),
            segment64,
            little,
          );
          if (!parsedSection.ok)
            throw formatFailure(NODE_SEA_MACHO_SEGMENT_TRUNCATED);
          const record = parsedSection.value;
          if (cString(record.nameBytes, 0, 16) !== SEA_SECTION) continue;
          const length = Number(record.size);
          const fileOffset = record.offset;
          if (!Number.isSafeInteger(length) || length > NODE_SEA_MAX_BLOB_BYTES)
            throw limitFailure(NODE_SEA_BLOB_TOO_LARGE);
          if (fileOffset > sliceSize || length > sliceSize - fileOffset)
            throw formatFailure(NODE_SEA_TRUNCATED);
          found.push({ offset: base + fileOffset, length });
        }
      }
    }
    offset += cmdsize;
    seen += 1;
  }
  if (found.length > 0 && (seen !== ncmds || offset !== commands.length))
    throw formatFailure(NODE_SEA_MACHO_COMMANDS_TRUNCATED);
  return found;
};

const locateElfNotes = async (
  carrier: Carrier,
  prefix: Buffer,
): Promise<BlobRange[]> => {
  const header = readElfFixedHeader(prefix, carrier.fileSize);
  if (!header.ok) return [];
  const little = header.value.byteOrder === "little";
  const elf64 = header.value.elfClass === 64;
  const fields = await readExact(
    carrier,
    0,
    Math.min(carrier.fileSize, header.value.headerSize),
  );
  if (fields === undefined) return [];
  const raw = readElfRawTableDeclarations(fields, header.value);
  if (!raw.ok) return [];
  const { programs: programDeclarations, sections: sectionDeclarations } =
    raw.value;
  const phoff =
    programDeclarations.offset <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(programDeclarations.offset)
      : undefined;
  const shoff =
    sectionDeclarations.offset <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(sectionDeclarations.offset)
      : undefined;
  const phentsize = programDeclarations.width;
  const phnum = programDeclarations.count;
  const shentsize = sectionDeclarations.width;
  const shnum = sectionDeclarations.count;
  const minimumProgram = elf64 ? 56 : 32;
  const minimumSection = elf64 ? 64 : 40;
  const found: BlobRange[] = [];
  let opaque = false;
  const programs = await readElfTables(carrier, {
    offset: phoff,
    count: phnum,
    entrySize: phentsize,
    minimumEntry: minimumProgram,
  });
  if (programs === undefined) opaque = phnum > 0;
  else
    for (const entry of programs) {
      const parsedProgram = readElfProgramHeader(
        entry,
        header.value.elfClass,
        little,
      );
      if (!parsedProgram.ok) continue;
      const program = parsedProgram.value;
      if (program.type !== PT_NOTE) continue;
      const note = {
        offset:
          program.offset <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(program.offset)
            : undefined,
        length:
          program.fileSize <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(program.fileSize)
            : undefined,
        align:
          program.alignment <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(program.alignment)
            : undefined,
      };
      const scanned = await scanElfNoteTable(
        carrier,
        note,
        little,
        found.length > 0,
      );
      if (scanned === undefined) opaque = true;
      else found.push(...scanned);
    }
  // The runtime locates the blob through PT_NOTE segments. Injectors can
  // leave stale or misaligned SHT_NOTE entries, so section notes are only a
  // fallback when no program-header table is readable.
  if (programs !== undefined && phnum > 0) {
    if (found.length > 0 && opaque)
      throw formatFailure(NODE_SEA_ELF_TABLE_TRUNCATED);
    return found;
  }
  const sections = await readElfTables(carrier, {
    offset: shoff,
    count: shnum,
    entrySize: shentsize,
    minimumEntry: minimumSection,
  });
  if (sections === undefined) opaque = opaque || shnum > 0;
  else
    for (const entry of sections) {
      const parsedSection = readElfSectionHeader(
        entry,
        header.value.elfClass,
        little,
      );
      if (!parsedSection.ok) continue;
      const section = parsedSection.value;
      if (section.type !== SHT_NOTE) continue;
      const note = {
        offset:
          section.offset <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(section.offset)
            : undefined,
        length:
          section.size <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(section.size)
            : undefined,
        align:
          section.alignment <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(section.alignment)
            : undefined,
      };
      const scanned = await scanElfNoteTable(
        carrier,
        note,
        little,
        found.length > 0,
      );
      if (scanned === undefined) opaque = true;
      else found.push(...scanned);
    }
  if (found.length > 0 && opaque)
    throw formatFailure(NODE_SEA_ELF_TABLE_TRUNCATED);
  return found;
};

const readElfTables = async (
  carrier: Carrier,
  table: {
    readonly offset: number | undefined;
    readonly count: number;
    readonly entrySize: number;
    readonly minimumEntry: number;
  },
): Promise<Buffer[] | undefined> => {
  if (table.count === 0) return [];
  if (
    table.offset === undefined ||
    table.count > MAX_ELF_HEADERS ||
    table.entrySize < table.minimumEntry ||
    table.entrySize > 1024 ||
    table.offset > carrier.fileSize
  )
    return undefined;
  const entries: Buffer[] = [];
  for (let index = 0; index < table.count; index += 1) {
    if (index % 128 === 0) abortIfNeeded(carrier.signal);
    const offset = table.offset + index * table.entrySize;
    if (
      offset > carrier.fileSize ||
      table.entrySize > carrier.fileSize - offset
    )
      return undefined;
    const entry = await readExact(carrier, offset, table.entrySize);
    if (entry === undefined) return undefined;
    entries.push(entry);
  }
  return entries;
};

const scanElfNoteTable = async (
  carrier: Carrier,
  note: {
    readonly offset: number | undefined;
    readonly length: number | undefined;
    readonly align: number | undefined;
  },
  little: boolean,
  alreadyFound: boolean,
): Promise<BlobRange[] | undefined> => {
  if (
    note.offset === undefined ||
    note.length === undefined ||
    note.offset > carrier.fileSize ||
    note.length > carrier.fileSize - note.offset
  )
    return undefined;
  const alignment = elfNoteAlignment(note.align === 8 ? 8 : 4);
  const found: BlobRange[] = [];
  let cursor = 0;
  while (cursor + 12 <= note.length) {
    abortIfNeeded(carrier.signal);
    const header = await readExact(carrier, note.offset + cursor, 12);
    if (header === undefined)
      return failNoteTable(alreadyFound || found.length > 0);
    const parsedHeader = readElfNoteHeader(header, little);
    if (!parsedHeader.ok)
      return failNoteTable(alreadyFound || found.length > 0);
    const { namesz, descsz } = parsedHeader.value;
    if (namesz > MAX_NOTE_NAME_BYTES)
      return failNoteTable(alreadyFound || found.length > 0);
    if (cursor > note.length - 12 || namesz > note.length - cursor - 12)
      return failNoteTable(alreadyFound || found.length > 0);
    let layout: ReturnType<typeof elfNoteLayout>;
    try {
      layout = elfNoteLayout(namesz, descsz, alignment);
    } catch {
      return failNoteTable(alreadyFound || found.length > 0);
    }
    if (
      !Number.isSafeInteger(layout.descriptor) ||
      !Number.isSafeInteger(layout.next) ||
      layout.next < 12
    )
      return failNoteTable(alreadyFound || found.length > 0);
    const name = await readExact(carrier, note.offset + cursor + 12, namesz);
    if (name === undefined)
      return failNoteTable(alreadyFound || found.length > 0);
    const owner = cString(name, 0, name.length);
    const descriptorFits =
      layout.descriptor <= note.length - cursor &&
      descsz <= note.length - cursor - layout.descriptor;
    if (owner === RESOURCE_NAME) {
      if (!descriptorFits)
        throw formatFailure(NODE_SEA_ELF_DESCRIPTOR_TRUNCATED);
      if (descsz > NODE_SEA_MAX_BLOB_BYTES)
        throw limitFailure(NODE_SEA_BLOB_TOO_LARGE);
      const blobOffset = note.offset + cursor + layout.descriptor;
      if (
        blobOffset > carrier.fileSize ||
        descsz > carrier.fileSize - blobOffset
      )
        throw formatFailure(NODE_SEA_ELF_DESCRIPTOR_TRUNCATED);
      found.push({ offset: blobOffset, length: descsz });
    }
    if (layout.next > note.length - cursor)
      return failNoteTable(
        alreadyFound || found.length > 0 || owner === RESOURCE_NAME,
      );
    cursor += layout.next;
  }
  return found;
};

const failNoteTable = (confirmed: boolean): undefined => {
  if (confirmed) throw formatFailure(NODE_SEA_ELF_TABLE_TRUNCATED);
  return undefined;
};

const locatePeResources = async (carrier: Carrier): Promise<BlobRange[]> => {
  // Probe for the NODE_SEA_BLOB name first so a malformed resource tree in an
  // ordinary PE stays a native-classification concern, not a SEA failure.
  const headers = await readExact(
    carrier,
    0,
    Math.min(carrier.fileSize, PE_HEADER_PROBE_BYTES),
  );
  if (
    headers === undefined ||
    !(await hasPeResourceName(
      headers,
      carrier.fileSize,
      (offset, length) => readExact(carrier, offset, length),
      RT_RCDATA,
      RESOURCE_NAME,
      MAX_INSPECT_PE_DIRECTORY_ENTRIES,
    ))
  )
    return [];
  if (carrier.fileSize > MAX_INSPECT_PE_FILE_BYTES) {
    throw limitFailure(
      "Node SEA PE inspection exceeds the 512 MiB PE parser input ceiling",
    );
  }
  const bytes = await readExact(carrier, 0, carrier.fileSize);
  if (bytes === undefined) throw formatFailure(NODE_SEA_TRUNCATED);
  // A native-looking file need not be an admitted PE image. Once the layout
  // is admitted, resource errors remain failures rather than inferred absence.
  let layout: ReturnType<typeof readPeResourceLayout>;
  try {
    layout = readPeResourceLayout(bytes);
  } catch (cause) {
    if (cause instanceof ArtifactReaderFailure && cause.reason === "format")
      return [];
    throw cause;
  }
  const resources = await parsePeResources(
    bytes,
    {
      path: "<admitted SEA carrier>",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    },
    {
      path: "/admitted-sea-carrier",
      max_file_bytes: MAX_INSPECT_PE_FILE_BYTES,
      max_entries: MAX_INSPECT_PE_DIRECTORY_ENTRIES,
    },
    carrier.signal,
    layout,
  );
  return resources.resources.flatMap((resource) => {
    if (
      resource.type.kind !== "id" ||
      resource.type.id !== RT_RCDATA ||
      resource.name.kind !== "name" ||
      resource.name.name !== RESOURCE_NAME
    )
      return [];
    const range = resource.payload.location;
    if (range.bytes > NODE_SEA_MAX_BLOB_BYTES)
      throw limitFailure(NODE_SEA_BLOB_TOO_LARGE);
    return [{ offset: range.offset, length: range.bytes }];
  });
};

const digestRange = async (
  carrier: Carrier,
  offset: number,
  length: number,
): Promise<string> => {
  const hash = createHash("sha256");
  let remaining = length;
  let position = offset;
  while (remaining > 0) {
    const chunkLength = Math.min(64 * 1024, remaining);
    const chunk = await readExact(carrier, position, chunkLength);
    if (chunk === undefined) throw formatFailure(NODE_SEA_TRUNCATED);
    hash.update(chunk);
    position += chunkLength;
    remaining -= chunkLength;
  }
  return hash.digest("hex");
};

const readExact = async (
  carrier: Carrier,
  offset: number,
  length: number,
): Promise<Buffer | undefined> => {
  abortIfNeeded(carrier.signal);
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > carrier.fileSize ||
    length > carrier.fileSize - offset
  )
    return undefined;
  if (length === 0) return Buffer.alloc(0);
  const bytes = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    abortIfNeeded(carrier.signal);
    const read = await carrier.handle.read(
      bytes,
      filled,
      length - filled,
      offset + filled,
    );
    abortIfNeeded(carrier.signal);
    if (read.bytesRead === 0) return undefined;
    filled += read.bytesRead;
  }
  return bytes;
};

const cString = (bytes: Buffer, offset: number, length: number): string => {
  let end = offset;
  const limit = Math.min(bytes.length, offset + length);
  while (end < limit && bytes[end] !== 0) end += 1;
  return bytes.toString("latin1", offset, end);
};

const readU32 = (bytes: Buffer, offset: number, little: boolean): number =>
  little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
