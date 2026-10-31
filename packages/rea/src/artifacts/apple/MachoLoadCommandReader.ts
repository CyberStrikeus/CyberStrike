import {
  machoDependencyCommand,
  readMachoDylibCommandFacts,
} from "../../domain/apple/machoDylibCommand.js";
import { readMachoSegmentHeader } from "../../domain/apple/machoSegmentHeader.js";
import {
  MachoLoadCommandCursor,
  readMachoHeaderDeclarations,
  readMachoCommandStringBytes,
  type MachoCommandStringFailure,
} from "../../domain/apple/machoLoadCommands.js";
import {
  MAX_JVM_CLASS_IDENTITY_BYTES,
  JVM_CLASS_IDENTITY_LIMIT_REASON,
} from "../../domain/apple/jvmClassFile.js";
import type {
  MachoDependency,
  MachoImageFacts,
  MachoSlice,
} from "../../domain/apple/dylibResolution.js";
import {
  machoArchitectureName,
  machoCpuSubtypeBase,
} from "../../domain/apple/machoCpuIdentity.js";
import {
  legacyMachoPlatform,
  type MachoVersionMinPlatform,
} from "../../domain/apple/machoPlatform.js";
import {
  classifyFatContainerIdentity,
  findOverlappingFatSlices,
  hasMachoMagic,
  readFatContainerHeader,
  readFatHeaderPrefix,
  readFatSliceDeclarations,
  readMachoHeaderPrefixFacts,
  validateFatSlice,
  validateFatSliceIdentity,
  type FatContainerHeader,
  type FatSliceDeclaration,
  type FatSliceRangeIssue,
} from "../../domain/apple/machoContainer.js";

/** Read `length` bytes at `offset`; shorter results mean end of file. */
export type ReadAt = (offset: number, length: number) => Promise<Uint8Array>;

/** Load commands larger than this are refused instead of buffered. */
export const MAX_LOAD_COMMAND_BYTES = 16 * 1024 * 1024;
/**
 * Identical `LC_LAZY_LOAD_DYLIB_INFO` commands are 16 bytes, so the load-command
 * byte cap alone would retain about a million dependency results. Stop before
 * those results are kept or traced.
 */
export const MAX_LAZY_INFO_DEPENDENCIES = 1024;
/**
 * Symbol names are validated and then discarded. Distinct one-byte strings
 * stay under the 16 MiB byte budgets while retaining one cache entry per
 * offset, so stop before that map and those decodes grow.
 */
export const MAX_LAZY_INFO_SYMBOL_REFERENCES = 64 * 1024;

const LC_SEGMENT = 0x1;
const LC_SEGMENT_64 = 0x19;
const LC_ID_DYLIB = 0xd;
const LC_LAZY_LOAD_DYLIB_INFO = 0x3a;
const LC_RPATH = 0x8000001c;
const LC_DYLD_ENVIRONMENT = 0x27;
const LC_CODE_SIGNATURE = 0x1d;
const LC_BUILD_VERSION = 0x32;

const CPU_TYPE_ARM64 = 0x0100000c;

/** loader.h command codes and their device platform identities. */
const VERSION_MIN_PLATFORMS: ReadonlyMap<number, MachoVersionMinPlatform> =
  new Map([
    [0x24, 1], // LC_VERSION_MIN_MACOSX
    [0x25, 2], // LC_VERSION_MIN_IPHONEOS
    [0x2f, 3], // LC_VERSION_MIN_TVOS
    [0x30, 4], // LC_VERSION_MIN_WATCHOS
  ]);

const LAZY_INFO_HEADER_BYTES = 24;
/** ld64 may-be-missing bit: the lazy image is allowed to be absent. */
const LAZY_INFO_MAY_BE_MISSING = 0x1;
/**
 * dyld's linkedit image-offset checks start at one page, then grow to the
 * runtime end of every segment except `__LINKEDIT`.
 */
const LAZY_INFO_MIN_VM_OFFSET = 0x4000n;
const DYLIB_USE_WEAK_LINK = 0x1;
const DYLIB_USE_REEXPORT = 0x2;
const DYLIB_USE_UPWARD = 0x4;
const DYLIB_USE_DELAYED_INIT = 0x8;

/** Malformed or unsupported structure found while decoding one image. */
class MachoFormatIssue extends Error {
  constructor(
    readonly status: "malformed" | "unsupported",
    message: string,
  ) {
    super(message);
  }
}

/** A structural defect, and whether it is malformed or merely unsupported. */
export interface MachoReadIssue {
  readonly status: "malformed" | "unsupported";
  readonly reason: string;
}

/**
 * File-level identity. FAT range issues stay per slice so a tolerant reader
 * can still report the slices whose ranges are valid.
 */
export type MachoContainer =
  | { readonly kind: "not-mach-o" }
  | ({ readonly kind: "issue" } & MachoReadIssue)
  | { readonly kind: "thin"; readonly size: number }
  | {
      readonly kind: "fat";
      readonly header: ParsedFatContainerHeader;
      readonly hidden: HiddenFatRow | null;
    };

/**
 * Apple's hidden ARM64 row with its own range defect, or why its slot could
 * not be decoded. It stays outside the raw `nfat_arch` declarations.
 */
export type HiddenFatRow =
  | {
      readonly status: "declared";
      readonly declaration: FatSliceDeclaration;
      readonly rangeIssue: string | null;
    }
  | MachoReadIssue;

type ParsedFatContainerHeader = Extract<
  FatContainerHeader,
  { readonly state: "parsed" }
>;

/** Classify a file as thin, FAT or not Mach-O without decoding any slice. */
export const readMachoContainer = async (
  readAt: ReadAt,
  size: number,
): Promise<MachoContainer> => {
  const head = await readAt(0, Math.min(size, 8));
  if (head.byteLength < 8)
    // A recognized magic with no room for a header is a truncated image.
    return hasMachoMagic(head)
      ? {
          kind: "issue",
          status: "malformed",
          reason: "Mach-O header is truncated",
        }
      : { kind: "not-mach-o" };
  const fatPrefix = readFatHeaderPrefix(head);
  const mayBeJvmClass =
    fatPrefix.state === "parsed" && !fatPrefix.wide && !fatPrefix.littleEndian;
  let header: FatContainerHeader;
  if (mayBeJvmClass && size <= MAX_JVM_CLASS_IDENTITY_BYTES) {
    const complete = await readAt(0, size);
    header =
      complete.byteLength === size
        ? readFatContainerHeader(complete, size)
        : readFatContainerHeader(head, size);
  } else header = readFatContainerHeader(head, size);
  if (header.state !== "not-fat") {
    if (header.state === "needs-data") {
      header = readFatContainerHeader(
        await readAt(0, header.requiredBytes),
        size,
      );
    }
    if (header.state === "not-fat") return { kind: "not-mach-o" };
    if (header.state === "needs-data")
      return {
        kind: "issue",
        status: "malformed",
        reason: "FAT table is truncated",
      };
    if (header.state === "malformed")
      return { kind: "issue", status: "malformed", reason: header.reason };
    let identity = classifyFatContainerIdentity(header, () => undefined);
    if (identity.state === "needs-slice-header") {
      const sliceHeaders = new Map<number, number | null>();
      for (const offset of identity.offsets)
        sliceHeaders.set(offset, await readSliceMagic(readAt, offset));
      identity = classifyFatContainerIdentity(header, (offset) =>
        sliceHeaders.get(offset),
      );
    }
    if (
      identity.state === "not-mach-o" ||
      identity.state === "needs-slice-header"
    )
      return { kind: "not-mach-o" };
    // A large CAFEBABE input whose bounded prefix resembles an invalid
    // known-CPU FAT table remains unknown until its JVM identity can be
    // checked; do not turn the resource limit into a malformed claim. A slice
    // with a valid range that starts with a Mach-O header settles identity,
    // and its siblings' range faults then stay their own.
    if (
      identity.state === "malformed" &&
      mayBeJvmClass &&
      size > MAX_JVM_CLASS_IDENTITY_BYTES &&
      !(await observesMachoSlice(readAt, header))
    )
      return {
        kind: "issue",
        status: "unsupported",
        reason: JVM_CLASS_IDENTITY_LIMIT_REASON,
      };
    // Aliased declarations are rejected at the declaration owner before any
    // slice payload is parsed. A declaration whose own range is already
    // defective keeps that fault; it does not turn its neighbours into aliases.
    const overlap = findOverlappingFatSlices(rangeValidSlices(header));
    if (overlap !== null)
      return {
        kind: "issue",
        status: "malformed",
        reason: overlapReason(overlap),
      };
    // Identity is only malformed through a slice range issue, which the
    // returned rangeIssues retain.
    return {
      kind: "fat",
      header,
      hidden: await readAppleHiddenArm64Row(readAt, size, header),
    };
  }
  const thin = readMachoHeaderPrefixFacts(head).format;
  if (thin?.littleEndian === true) return { kind: "thin", size };
  if (thin !== null)
    return {
      kind: "issue",
      status: "unsupported",
      reason: "big-endian Mach-O images are not supported",
    };
  return { kind: "not-mach-o" };
};

/** A slice's first word read big-endian, or null when it is truncated. */
const readSliceMagic = async (
  readAt: ReadAt,
  offset: number,
): Promise<number | null> => {
  const bytes = await readAt(offset, 4);
  return bytes.byteLength < 4 ? null : viewOf(bytes).getUint32(0, false);
};

const observesMachoSlice = async (
  readAt: ReadAt,
  header: ParsedFatContainerHeader,
): Promise<boolean> => {
  for (const [index, slice] of header.slices.entries())
    if (
      header.rangeIssues[index] === null &&
      readMachoHeaderPrefixFacts(await readAt(slice.offset, 4)).format !== null
    )
      return true;
  return false;
};

/** Decode every slice's dylib-loading load commands without reading code. */
export const readMachoImage = async (
  readAt: ReadAt,
  size: number,
): Promise<MachoImageFacts> => {
  try {
    const container = await readMachoContainer(readAt, size);
    if (container.kind === "not-mach-o") return { status: "not-mach-o" };
    if (container.kind === "issue")
      return { status: container.status, reason: container.reason };
    if (container.kind === "thin")
      return { status: "parsed", slices: [await readSlice(readAt, 0, size)] };
    const { header } = container;
    const rangeIssue = header.rangeIssues.find(
      (issue): issue is FatSliceRangeIssue => issue !== null,
    );
    if (rangeIssue !== undefined)
      return { status: rangeIssue.category, reason: rangeIssue.reason };
    const hiddenSlice = await readHiddenSlice(readAt, container.hidden);
    return {
      status: "parsed",
      slices: await readFatSlices(readAt, header.slices),
      ...(hiddenSlice === null ? {} : { hiddenSlices: [hiddenSlice] }),
    };
  } catch (cause: unknown) {
    if (cause instanceof MachoFormatIssue)
      return { status: cause.status, reason: cause.message };
    throw cause;
  }
};

const rangeValidSlices = (
  header: ParsedFatContainerHeader,
): FatSliceDeclaration[] =>
  header.slices.filter((_, index) => header.rangeIssues[index] === null);

const overlapReason = (
  overlap: NonNullable<ReturnType<typeof findOverlappingFatSlices>>,
): string =>
  `Mach-O slices ${overlap[0].index} and ${overlap[1].index} overlap.`;

/**
 * Apple lipo stores one hidden ARM64 row after the declared 32-bit FAT table.
 * It is only admitted from the single table-to-first-slice slot cctools
 * recognizes.
 */
const readAppleHiddenArm64Row = async (
  readAt: ReadAt,
  fileSize: number,
  header: ParsedFatContainerHeader,
): Promise<HiddenFatRow | null> => {
  if (header.wide) return null;
  const firstOffset = Math.min(...header.slices.map(({ offset }) => offset));
  const end = header.tableEnd + 20;
  if (end > fileSize || end > firstOffset) return null;
  const bytes = await readAt(header.tableEnd, 20);
  if (bytes.byteLength < 20)
    return { status: "malformed", reason: "Hidden ARM64 FAT row is truncated" };
  const row = readFatSliceDeclarations(bytes, {
    count: 1,
    wide: false,
    littleEndian: header.littleEndian,
  });
  if (row.status !== "parsed")
    return { status: "malformed", reason: row.reason };
  const declaration = { ...row.slices[0]!, index: header.count };
  if (declaration.cpuType !== CPU_TYPE_ARM64) return null;
  const overlap = findOverlappingFatSlices([
    ...rangeValidSlices(header),
    declaration,
  ]);
  return {
    status: "declared",
    declaration,
    rangeIssue:
      overlap === null
        ? validateFatSlice(declaration, fileSize, end)
        : overlapReason(overlap),
  };
};

const readHiddenSlice = async (
  readAt: ReadAt,
  row: HiddenFatRow | null,
): Promise<MachoSlice | null> => {
  if (row === null) return null;
  if (row.status !== "declared")
    throw new MachoFormatIssue(row.status, row.reason);
  const { declaration, rangeIssue } = row;
  if (rangeIssue !== null) throw new MachoFormatIssue("malformed", rangeIssue);
  const slice = await readSlice(readAt, declaration.offset, declaration.size, {
    fatCpuType: declaration.cpuType,
    fatCpuSubtype: declaration.cpuSubtype,
    alignmentExponent: declaration.alignmentExponent,
  });
  const identityIssue = validateFatSliceIdentity(declaration, {
    cpuType: slice.cpu_type,
    cpuSubtype: slice.cpu_subtype,
  });
  if (identityIssue !== null)
    throw new MachoFormatIssue("malformed", identityIssue);
  return { ...slice, hidden: true };
};

const readFatSlices = async (
  readAt: ReadAt,
  declarations: readonly FatSliceDeclaration[],
): Promise<MachoSlice[]> => {
  const slices: MachoSlice[] = [];
  // Keep validating after an unsupported slice so a later malformed slice is
  // reported as malformed whatever the slice order.
  let unsupported: MachoFormatIssue | undefined;
  for (const declaration of declarations) {
    const { offset, size: length, cpuType, cpuSubtype } = declaration;
    let slice: MachoSlice;
    try {
      slice = await readSlice(readAt, offset, length, {
        fatCpuType: cpuType,
        fatCpuSubtype: cpuSubtype,
        alignmentExponent: declaration.alignmentExponent,
      });
    } catch (cause: unknown) {
      if (
        !(cause instanceof MachoFormatIssue) ||
        cause.status !== "unsupported"
      )
        throw cause;
      unsupported ??= cause;
      continue;
    }
    const identityIssue = validateFatSliceIdentity(declaration, {
      cpuType: slice.cpu_type,
      cpuSubtype: slice.cpu_subtype,
    });
    if (identityIssue !== null)
      throw new MachoFormatIssue("malformed", identityIssue);
    slices.push(slice);
  }
  if (unsupported !== undefined) throw unsupported;
  return slices;
};

/** Little-endian `mach_header(_64)` fields that frame one slice's commands. */
export interface MachoSliceHeader {
  /** True for `MH_MAGIC_64`; the magic, not the CPU type, sets the width. */
  readonly wide: boolean;
  readonly headerSize: number;
  readonly cpuType: number;
  readonly cpuSubtype: number;
  readonly fileType: number;
  readonly commandCount: number;
  readonly commandBytes: number;
}

/** One framed load command; `offset` is relative to the end of the header. */
export interface MachoLoadCommand {
  readonly index: number;
  readonly command: number;
  readonly offset: number;
  readonly body: Uint8Array;
}

/** One slice's header and raw load-command table, or why it was not read. */
export type MachoSliceCommandTable =
  | {
      readonly status: "read";
      readonly header: MachoSliceHeader;
      readonly bytes: Uint8Array;
    }
  | (MachoReadIssue & { readonly header: MachoSliceHeader | null });

/** Read one slice's header and load-command bytes without framing them. */
export const readSliceCommandTable = async (
  readAt: ReadAt,
  base: number,
  length: number,
): Promise<MachoSliceCommandTable> => {
  const headerBytes = await readAt(base, 28);
  const parsed = readMachoHeaderDeclarations(headerBytes, length);
  if (!parsed.ok)
    return failed("malformed", "Mach-O header is truncated", null);
  if (parsed.value === null)
    return failed(
      "malformed",
      `slice at offset ${base} has no Mach-O header`,
      null,
    );
  if (!parsed.value.littleEndian)
    return failed(
      "unsupported",
      "big-endian Mach-O slices are not supported",
      null,
    );
  const { wide, headerSize, commandCount, commandBytes, fileType, identity } =
    parsed.value;
  const header: MachoSliceHeader = {
    wide,
    headerSize,
    cpuType: identity.cpuType,
    cpuSubtype: identity.cpuSubtype,
    fileType,
    commandCount,
    commandBytes,
  };
  if (header.commandBytes > MAX_LOAD_COMMAND_BYTES)
    return failed(
      "unsupported",
      `load commands occupy ${header.commandBytes} bytes, above the ${MAX_LOAD_COMMAND_BYTES}-byte limit`,
      header,
    );
  if (header.headerSize + header.commandBytes > length)
    return failed(
      "malformed",
      "load commands extend beyond the Mach-O slice",
      header,
    );
  const bytes = await readAt(base + header.headerSize, header.commandBytes);
  if (bytes.byteLength < header.commandBytes)
    return failed("malformed", "load commands is truncated", header);
  return { status: "read", header, bytes };
};

const failed = (
  status: MachoReadIssue["status"],
  reason: string,
  header: MachoSliceHeader | null,
): MachoSliceCommandTable => ({ status, reason, header });

/**
 * Hand each load command to `visit` in order without retaining it. A framing
 * failure is returned after every command before the failing one was visited.
 */
export const frameLoadCommands = (
  {
    header,
    bytes,
  }: { readonly header: MachoSliceHeader; readonly bytes: Uint8Array },
  visit: (command: MachoLoadCommand) => void,
): { readonly status: "framed" } | MachoReadIssue => {
  const cursor = new MachoLoadCommandCursor({
    wide: header.wide,
    littleEndian: true,
    commandCount: header.commandCount,
    commandBytes: bytes.byteLength,
  });
  while (cursor.nextOffset !== null) {
    const frame = cursor.read(
      bytes.subarray(cursor.nextOffset, cursor.nextOffset + 8),
    );
    if (!frame.ok) return { status: "malformed", reason: frame.error };
    const { index, command, offset, size } = frame.value;
    visit({
      index,
      command,
      offset,
      body: bytes.subarray(offset, offset + size),
    });
  }
  const complete = cursor.finish();
  if (!complete.ok) return { status: "malformed", reason: complete.error };
  return { status: "framed" };
};

const readSlice = async (
  readAt: ReadAt,
  base: number,
  length: number,
  fat: {
    readonly fatCpuType: number;
    readonly fatCpuSubtype: number;
    readonly alignmentExponent: number;
  } | null = null,
): Promise<MachoSlice> => {
  const table = await readSliceCommandTable(readAt, base, length);
  if (table.status !== "read")
    throw new MachoFormatIssue(table.status, table.reason);
  const { header } = table;
  const slice: MachoSlice = {
    architecture: machoArchitectureName(header.cpuType, header.cpuSubtype),
    slice_offset: base,
    slice_size: length,
    cpu_type: header.cpuType,
    cpu_subtype: header.cpuSubtype,
    fat_cpu_type: fat?.fatCpuType ?? null,
    fat_cpu_subtype: fat?.fatCpuSubtype ?? null,
    fat_alignment_exponent: fat?.alignmentExponent ?? null,
    file_type: fileTypeName(header.fileType),
    file_type_code: header.fileType,
    platform: null,
    platforms: [],
    install_name: null,
    dependencies: [],
    rpaths: [],
    dyld_environment: [],
    code_signature_present: false,
  };
  const dependencies: Array<
    | { readonly kind: "parsed"; readonly value: MachoDependency }
    | LazyLoadDylibInfoCommand
  > = [];
  const segments: SegmentSpan[] = [];
  let unreadableSegment: number | undefined;
  let lazyInfoCount = 0;
  // Each command decodes as it is framed, so a defect in an earlier command
  // keeps precedence over a later framing defect.
  const framed = frameLoadCommands(table, ({ command, body, index }) => {
    if (command === LC_SEGMENT || command === LC_SEGMENT_64) {
      const span = readSegmentSpan(body, command === LC_SEGMENT_64);
      if (span === undefined) unreadableSegment ??= index;
      else segments.push(span);
    }
    if (command === LC_LAZY_LOAD_DYLIB_INFO) {
      lazyInfoCount += 1;
      if (lazyInfoCount > MAX_LAZY_INFO_DEPENDENCIES)
        throw new MachoFormatIssue(
          "unsupported",
          `LC_LAZY_LOAD_DYLIB_INFO commands exceed the ${MAX_LAZY_INFO_DEPENDENCIES}-dependency limit`,
        );
    }
    const decoded = decodeCommand(command, body, index, slice);
    if (decoded !== undefined) dependencies.push(decoded);
  });
  if (framed.status !== "framed")
    throw new MachoFormatIssue(framed.status, framed.reason);
  if (lazyInfoCount > 0 && unreadableSegment !== undefined)
    throw new MachoFormatIssue(
      "malformed",
      `load command ${unreadableSegment} is too short to establish the slice VM range for LC_LAZY_LOAD_DYLIB_INFO`,
    );
  await appendDependencies(
    slice,
    dependencies,
    readAt,
    base,
    length,
    maximumVmOffset(segments),
  );
  const distinctPlatforms = [...new Set(slice.platforms)];
  slice.platform =
    distinctPlatforms.length === 1 ? (distinctPlatforms[0] ?? null) : null;
  return slice;
};

interface LazyLoadDylibInfoCommand {
  readonly kind: "lazy-info";
  readonly index: number;
  readonly dataOffset: number;
  readonly dataSize: number;
}

interface SegmentSpan {
  readonly name: string;
  readonly vmaddr: bigint;
  readonly vmsize: bigint;
}

/** Runtime end of the mapped image, excluding `__LINKEDIT`, floored at one page. */
const maximumVmOffset = (segments: readonly SegmentSpan[]): bigint => {
  let textVmAddr = 0n;
  for (const segment of segments) {
    if (segment.name === "__TEXT") {
      textVmAddr = segment.vmaddr;
      break;
    }
  }
  let max = LAZY_INFO_MIN_VM_OFFSET;
  for (const segment of segments) {
    if (segment.name === "__LINKEDIT") continue;
    const end = segment.vmaddr - textVmAddr + segment.vmsize;
    if (end > max) max = end;
  }
  return max;
};

const readSegmentSpan = (
  body: Uint8Array,
  wide: boolean,
): SegmentSpan | undefined => {
  const parsed = readMachoSegmentHeader(body, wide, true);
  if (!parsed.ok) return undefined;
  const { nameBytes, address: vmaddr, memorySize: vmsize } = parsed.value;
  const end = nameBytes.indexOf(0);
  return {
    // Segment names are fixed-width Mach-O data; a leading BOM is literal name bytes.
    name: new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(
      end < 0 ? nameBytes : nameBytes.subarray(0, end),
    ),
    vmaddr,
    vmsize,
  };
};

interface CachedLazyString {
  readonly text: string;
  /** Absolute file offset of the terminating NUL. */
  readonly end: number;
}

interface LazyPayloadWork {
  readonly dependencies: Map<string, MachoDependency>;
  readonly reads: { fileOffset: number; bytes: Uint8Array }[];
  readonly strings: Map<number, CachedLazyString>;
  payloadBytes: number;
  /** Scanned string bytes. Repeats and overlaps each count in full. */
  stringBytes: number;
  /** Symbol-string references. Repeats each count. */
  symbolReferences: number;
  rangeChecks: number;
}

const containedPayload = (
  reads: readonly { fileOffset: number; bytes: Uint8Array }[],
  fileOffset: number,
  size: number,
  work: LazyPayloadWork,
): Uint8Array | undefined => {
  for (const read of reads) {
    work.rangeChecks += 1;
    if (work.rangeChecks > MAX_LOAD_COMMAND_BYTES)
      throw new MachoFormatIssue(
        "unsupported",
        `LC_LAZY_LOAD_DYLIB_INFO payload range lookup exceeds the ${MAX_LOAD_COMMAND_BYTES}-check limit`,
      );
    const start = fileOffset - read.fileOffset;
    if (
      start >= 0 &&
      Number.isSafeInteger(start) &&
      start + size <= read.bytes.byteLength
    )
      return read.bytes.subarray(start, start + size);
  }
  return undefined;
};

const appendDependencies = async (
  slice: MachoSlice,
  dependencies: readonly (
    | { readonly kind: "parsed"; readonly value: MachoDependency }
    | LazyLoadDylibInfoCommand
  )[],
  readAt: ReadAt,
  base: number,
  length: number,
  maxVmOffset: bigint,
): Promise<void> => {
  const work: LazyPayloadWork = {
    dependencies: new Map(),
    reads: [],
    strings: new Map(),
    payloadBytes: 0,
    stringBytes: 0,
    symbolReferences: 0,
    rangeChecks: 0,
  };
  for (const dependency of dependencies) {
    if (dependency.kind === "parsed") {
      slice.dependencies.push(dependency.value);
      continue;
    }
    const key = `${dependency.dataOffset}:${dependency.dataSize}`;
    const cached = work.dependencies.get(key);
    if (cached !== undefined) {
      slice.dependencies.push(cached);
      continue;
    }
    const value = await readLazyLoadDylibInfo(
      readAt,
      base,
      length,
      dependency,
      maxVmOffset,
      work,
    );
    work.dependencies.set(key, value);
    slice.dependencies.push(value);
  }
};

const decodeCommand = (
  command: number,
  body: Uint8Array,
  index: number,
  slice: MachoSlice,
):
  | { readonly kind: "parsed"; readonly value: MachoDependency }
  | LazyLoadDylibInfoCommand
  | undefined => {
  if (command === LC_ID_DYLIB) {
    slice.install_name = commandString(body, 24, index);
    return;
  }
  if (command === LC_RPATH) {
    slice.rpaths.push(commandString(body, 12, index));
    return;
  }
  if (command === LC_DYLD_ENVIRONMENT) {
    slice.dyld_environment.push(commandString(body, 12, index));
    return;
  }
  if (command === LC_CODE_SIGNATURE) {
    // linkedit_data_command: cmd, cmdsize, dataoff, datasize.
    if (body.byteLength < 16)
      throw new MachoFormatIssue(
        "malformed",
        `load command ${index} is too short for LC_CODE_SIGNATURE`,
      );
    slice.code_signature_present = true;
    return;
  }
  if (command === LC_BUILD_VERSION) {
    if (body.byteLength < 24)
      throw new MachoFormatIssue(
        "malformed",
        `load command ${index} is too short for LC_BUILD_VERSION`,
      );
    const view = viewOf(body);
    const toolCount = view.getUint32(20, true);
    if (toolCount > Math.floor((body.byteLength - 24) / 8))
      throw new MachoFormatIssue(
        "malformed",
        `load command ${index} LC_BUILD_VERSION tool records exceed cmdsize`,
      );
    const platform = view.getUint32(8, true);
    slice.platforms.push(platform);
    return;
  }
  const legacyPlatform = VERSION_MIN_PLATFORMS.get(command);
  if (legacyPlatform !== undefined) {
    if (body.byteLength < 16)
      throw new MachoFormatIssue(
        "malformed",
        `load command ${index} is too short for a version-min command`,
      );
    slice.platforms.push(legacyMachoPlatform(legacyPlatform, slice.cpu_type));
    return;
  }
  if (command === LC_LAZY_LOAD_DYLIB_INFO)
    return decodeLazyLoadDylibInfoCommand(body, index);
  const name = machoDependencyCommand(command);
  if (name !== null)
    return { kind: "parsed", value: decodeDependency(name, body, index) };
  return undefined;
};

/**
 * `LC_LAZY_LOAD_DYLIB_INFO` is a linkedit-data command. The install name is
 * not in the command; it is a NUL-terminated string in the payload.
 */
const decodeLazyLoadDylibInfoCommand = (
  body: Uint8Array,
  index: number,
): LazyLoadDylibInfoCommand => {
  if (body.byteLength < 16)
    throw new MachoFormatIssue(
      "malformed",
      `load command ${index} is too short for LC_LAZY_LOAD_DYLIB_INFO`,
    );
  const view = viewOf(body);
  const dataOffset = view.getUint32(8, true);
  const dataSize = view.getUint32(12, true);
  if (dataSize < LAZY_INFO_HEADER_BYTES)
    throw new MachoFormatIssue(
      "malformed",
      `load command ${index} LC_LAZY_LOAD_DYLIB_INFO payload is shorter than its 24-byte header`,
    );
  if (dataSize > MAX_LOAD_COMMAND_BYTES)
    throw new MachoFormatIssue(
      "unsupported",
      `LC_LAZY_LOAD_DYLIB_INFO payload occupies ${dataSize} bytes, above the ${MAX_LOAD_COMMAND_BYTES}-byte limit`,
    );
  return { kind: "lazy-info", index, dataOffset, dataSize };
};

const readLazyPayloadBytes = async (
  readAt: ReadAt,
  fileOffset: number,
  size: number,
  index: number,
  work: LazyPayloadWork,
): Promise<Uint8Array> => {
  const covered = containedPayload(work.reads, fileOffset, size, work);
  if (covered !== undefined) return covered;
  work.payloadBytes += size;
  if (work.payloadBytes > MAX_LOAD_COMMAND_BYTES)
    throw new MachoFormatIssue(
      "unsupported",
      `LC_LAZY_LOAD_DYLIB_INFO payloads occupy ${work.payloadBytes} bytes, above the ${MAX_LOAD_COMMAND_BYTES}-byte aggregate limit`,
    );
  const payload = await readExact(
    readAt,
    fileOffset,
    size,
    `load command ${index} LC_LAZY_LOAD_DYLIB_INFO payload`,
  );
  work.reads.push({ fileOffset, bytes: payload });
  return payload;
};

const readLazyLoadDylibInfo = async (
  readAt: ReadAt,
  base: number,
  length: number,
  command: LazyLoadDylibInfoCommand,
  maxVmOffset: bigint,
  work: LazyPayloadWork,
): Promise<MachoDependency> => {
  if (
    command.dataOffset > length ||
    command.dataSize > length - command.dataOffset
  )
    throw new MachoFormatIssue(
      "malformed",
      `load command ${command.index} LC_LAZY_LOAD_DYLIB_INFO payload extends beyond the Mach-O slice`,
    );
  const fileOffset = base + command.dataOffset;
  if (!Number.isSafeInteger(fileOffset))
    throw new MachoFormatIssue(
      "malformed",
      `load command ${command.index} LC_LAZY_LOAD_DYLIB_INFO payload offset is not a safe integer`,
    );
  const payload = await readLazyPayloadBytes(
    readAt,
    fileOffset,
    command.dataSize,
    command.index,
    work,
  );
  return decodeLazyLoadDylibInfoPayload(
    payload,
    command.index,
    fileOffset,
    maxVmOffset,
    work,
  );
};

const decodeLazyLoadDylibInfoPayload = (
  payload: Uint8Array,
  index: number,
  fileOffset: number,
  maxVmOffset: bigint,
  work: LazyPayloadWork,
): MachoDependency => {
  const view = viewOf(payload);
  const pathOffset = view.getUint32(0, true);
  const flagImageOffset = view.getUint32(4, true);
  const flags = view.getUint16(8, true);
  const chainStartImageOffset = view.getUint32(12, true);
  const symbolCount = view.getUint32(16, true);
  const symbolArrayOffset = view.getUint32(20, true);
  if (BigInt(flagImageOffset) > maxVmOffset)
    throw new MachoFormatIssue(
      "malformed",
      `load command ${index} LC_LAZY_LOAD_DYLIB_INFO flag image offset 0x${flagImageOffset.toString(16)} is beyond the slice VM range 0x${maxVmOffset.toString(16)}`,
    );
  if (BigInt(chainStartImageOffset) > maxVmOffset)
    throw new MachoFormatIssue(
      "malformed",
      `load command ${index} LC_LAZY_LOAD_DYLIB_INFO chain start image offset 0x${chainStartImageOffset.toString(16)} is beyond the slice VM range 0x${maxVmOffset.toString(16)}`,
    );
  if ((flags & ~LAZY_INFO_MAY_BE_MISSING) !== 0)
    throw new MachoFormatIssue(
      "unsupported",
      `load command ${index} LC_LAZY_LOAD_DYLIB_INFO flags 0x${flags.toString(16)} include unrecognized bits`,
    );
  if (
    symbolArrayOffset > payload.byteLength ||
    symbolCount > (payload.byteLength - symbolArrayOffset) / 4
  )
    throw new MachoFormatIssue(
      "malformed",
      `load command ${index} LC_LAZY_LOAD_DYLIB_INFO symbol table extends beyond the payload`,
    );
  const installName = payloadString(
    payload,
    pathOffset,
    fileOffset,
    index,
    "load path",
    work,
    true,
  );
  const symbolReferences = work.symbolReferences + symbolCount;
  if (symbolReferences > MAX_LAZY_INFO_SYMBOL_REFERENCES)
    throw new MachoFormatIssue(
      "unsupported",
      `LC_LAZY_LOAD_DYLIB_INFO symbol validation exceeds the ${MAX_LAZY_INFO_SYMBOL_REFERENCES}-reference limit`,
    );
  work.symbolReferences = symbolReferences;
  for (let symbol = 0; symbol < symbolCount; symbol += 1) {
    const offset = view.getUint32(symbolArrayOffset + symbol * 4, true);
    payloadString(
      payload,
      offset,
      fileOffset,
      index,
      `symbol ${symbol}`,
      work,
      false,
    );
  }
  return {
    command: "LC_LAZY_LOAD_DYLIB_INFO",
    encoding: "lazy_load_dylib_info",
    install_name: installName,
    weak: (flags & LAZY_INFO_MAY_BE_MISSING) !== 0,
    upward: false,
    reexport: false,
    delayed_init: false,
    current_version: null,
    compatibility_version: null,
  };
};

const chargeLazyString = (work: LazyPayloadWork, examined: number): void => {
  const occupied = work.stringBytes + examined;
  if (occupied > MAX_LOAD_COMMAND_BYTES)
    throw new MachoFormatIssue(
      "unsupported",
      `LC_LAZY_LOAD_DYLIB_INFO string validation occupies ${occupied} bytes, above the ${MAX_LOAD_COMMAND_BYTES}-byte limit`,
    );
  work.stringBytes = occupied;
};

/**
 * NUL-terminated UTF-8 string after the fixed payload header.
 * dyld's load-path scan stops before the payload's final byte, so a NUL
 * in that byte does not terminate the path.
 */
const payloadString = (
  payload: Uint8Array,
  offset: number,
  fileOffset: number,
  index: number,
  label: string,
  work: LazyPayloadWork,
  excludeFinalByte: boolean,
): string => {
  if (offset < LAZY_INFO_HEADER_BYTES)
    throw new MachoFormatIssue(
      "malformed",
      `load command ${index} LC_LAZY_LOAD_DYLIB_INFO ${label} offset ${offset} is inside the payload header`,
    );
  if (offset >= payload.byteLength)
    throw new MachoFormatIssue(
      "malformed",
      `load command ${index} LC_LAZY_LOAD_DYLIB_INFO ${label} offset ${offset} is outside the payload`,
    );
  const absolute = Number.isSafeInteger(fileOffset + offset)
    ? fileOffset + offset
    : undefined;
  const cached =
    absolute === undefined ? undefined : work.strings.get(absolute);
  const terminatorLimit = excludeFinalByte
    ? payload.byteLength - 1
    : payload.byteLength;
  if (cached !== undefined && absolute !== undefined) {
    const end = cached.end - fileOffset;
    if (end < offset || end >= terminatorLimit)
      throw new MachoFormatIssue(
        "malformed",
        `load command ${index} LC_LAZY_LOAD_DYLIB_INFO ${label} is unterminated`,
      );
    chargeLazyString(work, cached.end - absolute + 1);
    return cached.text;
  }
  if (offset >= terminatorLimit)
    throw new MachoFormatIssue(
      "malformed",
      `load command ${index} LC_LAZY_LOAD_DYLIB_INFO ${label} is unterminated`,
    );
  const remaining = MAX_LOAD_COMMAND_BYTES - work.stringBytes;
  const windowEnd = Math.min(terminatorLimit, offset + remaining);
  const end = payload.subarray(0, windowEnd).indexOf(0, offset);
  if (end < 0) {
    if (windowEnd < terminatorLimit)
      throw new MachoFormatIssue(
        "unsupported",
        `LC_LAZY_LOAD_DYLIB_INFO string validation occupies ${work.stringBytes + (windowEnd - offset) + 1} bytes, above the ${MAX_LOAD_COMMAND_BYTES}-byte limit`,
      );
    throw new MachoFormatIssue(
      "malformed",
      `load command ${index} LC_LAZY_LOAD_DYLIB_INFO ${label} is unterminated`,
    );
  }
  chargeLazyString(work, end - offset + 1);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      payload.subarray(offset, end),
    );
  } catch {
    throw new MachoFormatIssue(
      "malformed",
      `load command ${index} LC_LAZY_LOAD_DYLIB_INFO ${label} is not UTF-8`,
    );
  }
  if (absolute !== undefined && Number.isSafeInteger(fileOffset + end))
    work.strings.set(absolute, { text, end: fileOffset + end });
  return text;
};

const decodeDependency = (
  command: MachoDependency["command"],
  body: Uint8Array,
  index: number,
): MachoDependency => {
  const parsed = readMachoDylibCommandFacts(body, true);
  if (!parsed.ok) {
    if (parsed.error._tag === "InvalidMachoDylibCommand")
      throw new MachoFormatIssue(
        "malformed",
        `load command ${index} is too short for a dylib command`,
      );
    return throwCommandStringIssue(parsed.error, index);
  }
  const facts = parsed.value;
  const flags = facts.flags ?? 0;
  return {
    command,
    encoding: facts.encoding,
    install_name: decodeCommandString(facts.nameBytes, index),
    weak:
      command === "LC_LOAD_WEAK_DYLIB" || (flags & DYLIB_USE_WEAK_LINK) !== 0,
    upward:
      command === "LC_LOAD_UPWARD_DYLIB" || (flags & DYLIB_USE_UPWARD) !== 0,
    reexport:
      command === "LC_REEXPORT_DYLIB" || (flags & DYLIB_USE_REEXPORT) !== 0,
    delayed_init: (flags & DYLIB_USE_DELAYED_INIT) !== 0,
    current_version: version(facts.currentVersion),
    compatibility_version: version(facts.compatibilityVersion),
  };
};

/** NUL-terminated UTF-8 string at a `lc_str` offset inside one command. */
const commandString = (
  body: Uint8Array,
  minimumOffset: number,
  index: number,
): string => {
  const parsed = readMachoCommandStringBytes(body, minimumOffset, true);
  if (!parsed.ok) return throwCommandStringIssue(parsed.error, index);
  return decodeCommandString(parsed.value.bytes, index);
};

const throwCommandStringIssue = (
  failure: MachoCommandStringFailure,
  index: number,
): never => {
  const reason =
    failure.reason === "truncated-offset"
      ? `load command ${index} is too short to hold a string offset`
      : failure.reason === "invalid-offset"
        ? `load command ${index} has string offset ${failure.offset} outside the command`
        : `load command ${index} has an unterminated string`;
  throw new MachoFormatIssue("malformed", reason);
};

const decodeCommandString = (bytes: Uint8Array, index: number): string => {
  try {
    // lc_str contains name/path data, so a leading U+FEFF is part of its identity.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new MachoFormatIssue(
      "malformed",
      `load command ${index} has a string that is not UTF-8`,
    );
  }
};

const readExact = async (
  readAt: ReadAt,
  offset: number,
  length: number,
  label: string,
): Promise<Uint8Array> => {
  const bytes = await readAt(offset, length);
  if (bytes.byteLength < length)
    throw new MachoFormatIssue("malformed", `${label} is truncated`);
  return bytes;
};

const fileTypeName = (fileType: number): MachoSlice["file_type"] =>
  fileType === 2
    ? "execute"
    : fileType === 6
      ? "dylib"
      : fileType === 8
        ? "bundle"
        : "other";

const version = (value: number): string =>
  `${value >>> 16}.${(value >>> 8) & 0xff}.${value & 0xff}`;

const viewOf = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
