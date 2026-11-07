import type {
  MachoEncryptedRange,
  MachoEncryptionCommand,
  MachoEncryptionFacts,
  MachoSliceEncryption,
} from "../../domain/apple/machoEncryption.js";
import { validateFatSliceIdentity } from "../../domain/apple/machoContainer.js";
import { readMachoSectionHeader } from "../../domain/apple/machoSectionHeader.js";
import { readMachoSegmentHeader } from "../../domain/apple/machoSegmentHeader.js";
import {
  frameLoadCommands,
  readMachoContainer,
  readSliceCommandTable,
  type MachoLoadCommand,
  type MachoReadIssue,
  type MachoSliceHeader,
  type ReadAt,
} from "./MachoLoadCommandReader.js";

const LC_SEGMENT = 0x1;
const LC_SEGMENT_64 = 0x19;
const LC_ENCRYPTION_INFO = 0x21;
const LC_ENCRYPTION_INFO_64 = 0x2c;
// loader.h: encryption_info_command is five 32-bit words; the 64-bit form adds `pad`.
const ENCRYPTION_COMMAND_SIZE = { 32: 20, 64: 24 } as const;
// loader.h section types whose bytes occupy no file range.
const ZEROFILL_SECTION_TYPES = new Set([0x1, 0xc, 0x12]);
// A second encryption command already makes a slice malformed; later ones
// are counted, not retained.
const RETAINED_ENCRYPTION_COMMANDS = 2;

/** Segment and section records left for range mapping across every slice. */
interface MappingBudget {
  readonly maximum: number;
  remaining: number;
}

/**
 * Read each slice's `LC_ENCRYPTION_INFO(_64)` status from structural metadata.
 * The shared container recognizer owns the reads needed for JVM disambiguation.
 * One slice's defect never hides another slice's status. Range mapping in all
 * slices shares `maximumMappingRecords` segment and section records; a slice
 * past it keeps its status with an unknown mapping.
 */
export const readMachoEncryption = async (
  readAt: ReadAt,
  size: number,
  maximumMappingRecords: number,
): Promise<MachoEncryptionFacts> => {
  const budget: MappingBudget = {
    maximum: maximumMappingRecords,
    remaining: maximumMappingRecords,
  };
  const container = await readMachoContainer(readAt, size);
  if (container.kind === "not-mach-o") return { status: "not-mach-o" };
  if (container.kind === "issue")
    return { status: container.status, reason: container.reason };
  if (container.kind === "thin")
    return {
      status: "parsed",
      slices: [await readSlice(readAt, { offset: 0, size, fat: null }, budget)],
    };
  // Apple's hidden ARM64 slice is part of the file's coverage, so an
  // undecodable hidden row (a short read) leaves the slice set itself
  // unknown before any declared slice is read.
  const { hidden } = container;
  if (hidden !== null && hidden.status !== "declared")
    return { status: hidden.status, reason: hidden.reason };
  const slices: MachoSliceEncryption[] = [];
  for (const [index, declaration] of container.header.slices.entries()) {
    const rangeIssue = container.header.rangeIssues[index] ?? null;
    slices.push(
      rangeIssue === null
        ? await readSlice(
            readAt,
            {
              offset: declaration.offset,
              size: declaration.size,
              fat: declaration,
            },
            budget,
          )
        : unread(
            declaration,
            rangeIssue.category === "unsupported" ? "unknown" : "malformed",
            rangeIssue.reason,
          ),
    );
  }
  if (hidden !== null)
    slices.push(
      hidden.rangeIssue === null
        ? await readSlice(
            readAt,
            {
              offset: hidden.declaration.offset,
              size: hidden.declaration.size,
              fat: hidden.declaration,
            },
            budget,
          )
        : unread(hidden.declaration, "malformed", hidden.rangeIssue),
    );
  return { status: "parsed", slices };
};

type FatDeclaration = Parameters<typeof validateFatSliceIdentity>[0];

const unread = (
  declaration: FatDeclaration,
  status: "malformed" | "unknown",
  reason: string,
): MachoSliceEncryption => ({
  architecture: null,
  cpu_type: declaration.cpuType,
  cpu_subtype: declaration.cpuSubtype,
  container_file_offset: declaration.offset,
  size: declaration.size,
  status,
  reason,
  commands: [],
  range: null,
});

const readSlice = async (
  readAt: ReadAt,
  slice: {
    readonly offset: number;
    readonly size: number;
    readonly fat: FatDeclaration | null;
  },
  budget: MappingBudget,
): Promise<MachoSliceEncryption> => {
  const table = await readSliceCommandTable(readAt, slice.offset, slice.size);
  const base = {
    architecture: null,
    cpu_type: table.header?.cpuType ?? slice.fat?.cpuType ?? null,
    cpu_subtype: table.header?.cpuSubtype ?? slice.fat?.cpuSubtype ?? null,
    container_file_offset: slice.offset,
    size: slice.size,
  };
  // Only encryption and segment commands are retained; the rest are framed
  // and dropped so a large table of small commands stays one buffer.
  const commands: MachoEncryptionCommand[] = [];
  let encryptionCommands = 0;
  // Null once this slice's segments need more records than the shared
  // mapping budget has left; none are retained past that point.
  let segments: MachoLoadCommand[] | null = [];
  let segmentRecords = 0;
  // Commands seen before a failure stay as partial facts; an incomplete walk
  // can never prove the command is absent.
  const incomplete = ({
    status,
    reason,
  }: MachoReadIssue): MachoSliceEncryption => ({
    ...base,
    status: status === "unsupported" ? "unknown" : "malformed",
    reason,
    commands,
    range: null,
  });
  if (table.status !== "read") return incomplete(table);
  const { header } = table;
  const framed = frameLoadCommands(table, (command) => {
    if (isEncryptionCommand(command.command)) {
      encryptionCommands += 1;
      if (commands.length < RETAINED_ENCRYPTION_COMMANDS)
        commands.push(decodeEncryptionCommand(command));
    } else if (
      segments !== null &&
      (command.command === LC_SEGMENT || command.command === LC_SEGMENT_64)
    ) {
      segmentRecords += mappingRecords(command);
      if (segmentRecords > budget.remaining) segments = null;
      else segments.push(command);
    }
  });
  if (framed.status !== "framed") return incomplete(framed);
  const identityIssue =
    slice.fat === null
      ? null
      : validateFatSliceIdentity(slice.fat, {
          cpuType: header.cpuType,
          cpuSubtype: header.cpuSubtype,
        });
  if (identityIssue !== null)
    return {
      ...base,
      status: "malformed",
      reason: identityIssue,
      commands,
      range: null,
    };
  const outcome = classify(commands, encryptionCommands, header, slice.size);
  if (outcome.status !== "valid")
    return { ...base, ...outcome, commands, range: null };
  const range = encryptedRange(
    outcome.command,
    header,
    segments,
    slice.offset,
    budget.maximum,
  );
  // Framing caps transient decoding; only a completed mapping retains its
  // reservation. Failed mappings discard those records before the next slice.
  if (range.mapping.status === "mapped") budget.remaining -= segmentRecords;
  return {
    ...base,
    status: outcome.command.cryptid === 0 ? "not-encrypted" : "encrypted",
    reason: null,
    commands,
    range,
  };
};

const isEncryptionCommand = (command: number): boolean =>
  command === LC_ENCRYPTION_INFO || command === LC_ENCRYPTION_INFO_64;

const decodeEncryptionCommand = ({
  command,
  body,
  index,
}: MachoLoadCommand): MachoEncryptionCommand => {
  const view = viewOf(body);
  const word = (at: number): number | null =>
    body.byteLength >= at + 4 ? view.getUint32(at, true) : null;
  const wide = command === LC_ENCRYPTION_INFO_64;
  return {
    kind: wide ? "LC_ENCRYPTION_INFO_64" : "LC_ENCRYPTION_INFO",
    index,
    cmdsize: body.byteLength,
    cryptoff: word(8),
    cryptsize: word(12),
    cryptid: word(16),
    pad: wide ? word(20) : null,
  };
};

type Classification =
  | {
      readonly status: "valid";
      readonly command: MachoEncryptionCommand & {
        readonly cryptoff: number;
        readonly cryptsize: number;
        readonly cryptid: number;
      };
    }
  | { readonly status: "absent"; readonly reason: null }
  | { readonly status: "malformed"; readonly reason: string };

const classify = (
  commands: readonly MachoEncryptionCommand[],
  count: number,
  header: MachoSliceHeader,
  sliceSize: number,
): Classification => {
  if (count === 0) return { status: "absent", reason: null };
  const [command] = commands;
  if (command === undefined || count > 1)
    return {
      status: "malformed",
      reason: `slice has ${count} encryption load commands`,
    };
  const width = header.wide ? 64 : 32;
  const expectedKind = header.wide
    ? "LC_ENCRYPTION_INFO_64"
    : "LC_ENCRYPTION_INFO";
  if (command.kind !== expectedKind)
    return {
      status: "malformed",
      reason: `load command ${command.index} ${command.kind} appears in a ${width}-bit image`,
    };
  const expectedSize = ENCRYPTION_COMMAND_SIZE[width];
  const { cryptoff, cryptsize, cryptid } = command;
  if (
    command.cmdsize !== expectedSize ||
    cryptoff === null ||
    cryptsize === null ||
    cryptid === null
  )
    return {
      status: "malformed",
      reason: `load command ${command.index} ${command.kind} has cmdsize ${command.cmdsize}, expected ${expectedSize}`,
    };
  // Both fields are 32-bit, so their sum is a safe integer.
  if (cryptoff + cryptsize > sliceSize)
    return {
      status: "malformed",
      reason: `load command ${command.index} encrypted range ends at ${cryptoff + cryptsize}, beyond the ${sliceSize}-byte slice`,
    };
  return {
    status: "valid",
    command: { ...command, cryptoff, cryptsize, cryptid },
  };
};

const encryptedRange = (
  command: {
    readonly cryptoff: number;
    readonly cryptsize: number;
    readonly cryptid: number;
  },
  header: MachoSliceHeader,
  segmentCommands: readonly MachoLoadCommand[] | null,
  containerOffset: number,
  maximumMappingRecords: number,
): MachoEncryptedRange => {
  const start = command.cryptoff;
  const end = command.cryptoff + command.cryptsize;
  return {
    content: command.cryptid === 0 ? "plaintext" : "ciphertext",
    slice_start: start,
    slice_end: end,
    container_start: containerOffset + start,
    container_end: containerOffset + end,
    mapping:
      segmentCommands === null
        ? {
            status: "unknown",
            reason: `mapping needs more than the ${maximumMappingRecords} segment and section records shared by all slices`,
          }
        : mapRange(start, end, header, segmentCommands),
  };
};

interface SegmentFacts {
  readonly index: number;
  readonly name: string;
  readonly vmAddress: bigint;
  readonly vmSize: bigint;
  readonly fileOffset: number;
  readonly fileSize: number;
  readonly sections: readonly {
    readonly name: string;
    readonly offset: number;
    readonly size: number;
    readonly zerofill: boolean;
  }[];
}

const mapRange = (
  start: number,
  end: number,
  header: MachoSliceHeader,
  segmentCommands: readonly MachoLoadCommand[],
): MachoEncryptedRange["mapping"] => {
  const segments: SegmentFacts[] = [];
  for (const command of segmentCommands) {
    if ((command.command === LC_SEGMENT_64) !== header.wide)
      return {
        status: "unknown",
        reason: `load command ${command.index} ${command.command === LC_SEGMENT_64 ? "LC_SEGMENT_64" : "LC_SEGMENT"} appears in a ${header.wide ? 64 : 32}-bit image`,
      };
    const segment = decodeSegment(command);
    if (typeof segment === "string")
      return { status: "unknown", reason: segment };
    // dyld maps only `vmsize` bytes, so file bytes past it have no address.
    if (segment.vmSize > 0n && BigInt(segment.fileSize) > segment.vmSize)
      return {
        status: "unknown",
        reason: `load command ${segment.index} segment ${segment.name} file size ${segment.fileSize} exceeds its VM size ${segment.vmSize}`,
      };
    if (
      segment.vmAddress + segment.vmSize >
      (header.wide ? 2n ** 64n : 2n ** 32n)
    )
      return {
        status: "unknown",
        reason: `load command ${segment.index} segment ${segment.name} VM range exceeds the ${header.wide ? 64 : 32}-bit address space`,
      };
    segments.push(segment);
  }
  const fileBacked = segments
    .filter(({ fileSize }) => fileSize > 0)
    .sort((left, right) => left.fileOffset - right.fileOffset);
  const fragments: Extract<
    MachoEncryptedRange["mapping"],
    { status: "mapped" }
  >["fragments"] = [];
  let cursor = start;
  for (const segment of fileBacked) {
    // Overlapping segments never report the same byte twice.
    const from = Math.max(cursor, segment.fileOffset);
    const to = Math.min(end, segment.fileOffset + segment.fileSize);
    if (from >= to) continue;
    if (from > cursor) fragments.push(unmapped(cursor, from));
    // A segment with no VM size keeps file-only bytes that are never mapped.
    const mapped = segment.vmSize > 0n;
    fragments.push({
      slice_start: from,
      slice_end: to,
      segment: segment.name,
      vm_start: mapped
        ? hex(segment.vmAddress + BigInt(from - segment.fileOffset))
        : null,
      vm_end: mapped
        ? hex(segment.vmAddress + BigInt(to - segment.fileOffset))
        : null,
    });
    cursor = Math.max(cursor, to);
  }
  if (cursor < end) fragments.push(unmapped(cursor, end));
  // A section counts only where the range, the section and its segment's
  // file-backed bytes all overlap, so names agree with the fragments.
  const sections = fileBacked.flatMap((segment) =>
    segment.sections
      .filter(
        ({ zerofill, size, offset }) =>
          !zerofill &&
          Math.max(start, offset, segment.fileOffset) <
            Math.min(end, offset + size, segment.fileOffset + segment.fileSize),
      )
      .map(({ name }) => ({ segment: segment.name, section: name })),
  );
  return { status: "mapped", fragments, sections };
};

const unmapped = (from: number, to: number) => ({
  slice_start: from,
  slice_end: to,
  segment: null,
  vm_start: null,
  vm_end: null,
});

/**
 * Mapping records a segment command can produce: at most two fragments, and
 * each section record that fits in its `cmdsize`, decoded and reported once.
 */
const mappingRecords = ({ command, body }: MachoLoadCommand): number => {
  const wide = command === LC_SEGMENT_64;
  return (
    2 +
    Math.max(
      0,
      Math.floor((body.byteLength - (wide ? 72 : 56)) / (wide ? 80 : 68)),
    )
  );
};

/** Decode one segment command, or say why its file mapping is unknown. */
const decodeSegment = ({
  command,
  body,
  index,
}: MachoLoadCommand): SegmentFacts | string => {
  const wide = command === LC_SEGMENT_64;
  const parsed = readMachoSegmentHeader(body, wide, true);
  if (!parsed.ok)
    return `load command ${index} is too short for a segment command`;
  const segment = parsed.value;
  const fileOffset = Number(segment.fileOffset);
  const fileSize = Number(segment.fileSize);
  if (!Number.isSafeInteger(fileOffset + fileSize))
    return `load command ${index} segment file range exceeds the safe range`;
  const sectionSize = wide ? 80 : 68;
  if (
    segment.sectionCount >
    (body.byteLength - segment.headerSize) / sectionSize
  )
    return `load command ${index} section records exceed cmdsize`;
  const sections: SegmentFacts["sections"][number][] = [];
  for (let section = 0; section < segment.sectionCount; section += 1) {
    const at = segment.headerSize + section * sectionSize;
    const header = readMachoSectionHeader(
      body.subarray(at, at + sectionSize),
      wide,
      true,
    );
    if (!header.ok)
      return `load command ${index} section records exceed cmdsize`;
    sections.push({
      name: fixedName(header.value.nameBytes),
      offset: header.value.offset,
      size: Number(header.value.size),
      zerofill: ZEROFILL_SECTION_TYPES.has(header.value.flags & 0xff),
    });
  }
  return {
    index,
    name: fixedName(segment.nameBytes),
    vmAddress: segment.address,
    vmSize: segment.memorySize,
    fileOffset,
    fileSize,
    sections,
  };
};

/** A 16-byte NUL-padded loader.h name, decoded byte for byte. */
const fixedName = (bytes: Uint8Array): string => {
  const end = bytes.indexOf(0);
  // Node's latin1 maps every byte to one code point; WHATWG "latin1" is
  // windows-1252 and would rewrite 0x80-0x9f.
  return Buffer.from(end < 0 ? bytes : bytes.subarray(0, end)).toString(
    "latin1",
  );
};

const hex = (value: bigint): string => `0x${value.toString(16)}`;

const viewOf = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
