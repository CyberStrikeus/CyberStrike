import { setImmediate } from "node:timers/promises";
import { assertArtifactReadActive } from "../../artifacts/ArtifactFileOperation.js";
import {
  BinaryFormatFailure,
  BinaryMappingFailure,
  BinaryResourceFailure,
  createFileMappingIndex,
  imageFileMappings,
} from "../metadata/BinaryContainer.js";
import { readPeImage, type PeImage } from "../metadata/PeImage.js";
import {
  guardFlagRecord,
  loadConfigFieldCovered,
  loadConfigFieldLayout,
  PE_LOAD_CONFIG_LIMITATIONS,
  TLS_STRUCT_BYTES,
  tlsAlignment,
  type InspectPeLoadConfigInput,
  type PeLoadConfig,
  type PeLoadConfigCountField,
  type PeLoadConfigDirectory,
  type PeLoadConfigField,
  type PeLoadConfigLocated,
  type PeLoadConfigLocatedField,
  type PeLoadConfigNumberField,
  type PeLoadConfigRawField,
  type PeLoadConfigTls,
} from "../../domain/native/peLoadConfig.js";

const PE_TLS_DIRECTORY = 9;
const PE_LOAD_CONFIG_DIRECTORY = 10;
const PE_RVA_END = 0x100000000;
/** Callback slots decoded between event-loop yields and cancellation checks. */
const ENTRIES_PER_YIELD = 1024;

/** The parser-owned allowance an image exhausted. */
export type PeLoadConfigLimit = "callbacks";

/** Structured parser allowance refusal; consumers branch on `limit`, never on prose. */
export class PeLoadConfigLimitFailure extends BinaryResourceFailure {
  constructor(
    readonly limit: PeLoadConfigLimit,
    readonly allowance: number,
    message: string,
  ) {
    super("structure", allowance, message);
    this.name = "PeLoadConfigLimitFailure";
  }
}

const hex = (value: bigint | number): string => `0x${value.toString(16)}`;

const fitsRva = (rva: number, size: number): boolean =>
  Number.isSafeInteger(rva) &&
  rva >= 0 &&
  Number.isSafeInteger(size) &&
  size > 0 &&
  rva <= PE_RVA_END - size;

/** Append one consumed file span, merging it when the previous span abuts it. */
const consume = (
  spans: { offset: number; bytes: number }[],
  offset: number,
  bytes: number,
): void => {
  const last = spans.at(-1);
  if (last !== undefined && last.offset + last.bytes === offset)
    last.bytes += bytes;
  else spans.push({ offset, bytes });
};

type DirectorySpan = PeLoadConfigTls["directory"];

/** One run of RVAs with a constant set of owning sections. */
interface SectionSegment {
  readonly start: number;
  readonly owners: number;
  readonly name: string;
}

/**
 * Build the RVA-to-section-name lookup once per image. Section spans are split
 * into disjoint segments so each lookup is a binary search; an RVA owned by
 * more than one section still fails as ambiguous.
 */
const sectionNameIndex = (
  sections: PeImage["sections"],
): ((rva: number) => string | null) => {
  const events: { at: number; index: number; open: boolean }[] = [];
  sections.forEach((section, index) => {
    if (section.format !== "pe") return;
    const span =
      section.virtual_size === 0 ? section.raw_size : section.virtual_size;
    if (span <= 0) return;
    events.push(
      { at: section.virtual_address, index, open: true },
      { at: section.virtual_address + span, index, open: false },
    );
  });
  events.sort((left, right) => left.at - right.at);
  const segments: SectionSegment[] = [];
  const active = new Set<number>();
  for (let cursor = 0; cursor < events.length;) {
    const at = events[cursor]!.at;
    for (; cursor < events.length && events[cursor]!.at === at; cursor++) {
      const event = events[cursor]!;
      if (event.open) active.add(event.index);
      else active.delete(event.index);
    }
    const [only] = active;
    segments.push({
      start: at,
      owners: active.size,
      name: active.size === 1 ? (sections[only!]?.name ?? "") : "",
    });
  }
  return (rva) => {
    let low = 0;
    let high = segments.length - 1;
    let found: SectionSegment | undefined;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const segment = segments[middle]!;
      if (segment.start <= rva) {
        found = segment;
        low = middle + 1;
      } else high = middle - 1;
    }
    if (found === undefined || found.owners === 0) return null;
    if (found.owners > 1)
      throw new BinaryMappingFailure(
        "ambiguous",
        `PE RVA ${hex(rva)} belongs to multiple sections`,
      );
    return found.name.length === 0 ? null : found.name;
  };
};

/**
 * Read one PE TLS directory and load configuration without executing the image.
 * Yields to the event loop and honors cancellation every
 * `ENTRIES_PER_YIELD` callback slots.
 */
export const parsePeLoadConfig = async (
  bytes: Buffer,
  artifact: PeLoadConfig["artifact"],
  input: InspectPeLoadConfigInput,
  signal?: AbortSignal,
): Promise<PeLoadConfig> => {
  assertArtifactReadActive(signal);
  const image = readPeImage(bytes);
  const bits = image.bits;
  const base = image.image_base;
  const lookup = createFileMappingIndex(
    imageFileMappings(image),
    image.zero_fills,
  );
  const pointerWidth = bits === 64 ? 8 : 4;
  const readPointer = (offset: number): bigint =>
    bits === 64
      ? bytes.readBigUInt64LE(offset)
      : BigInt(bytes.readUInt32LE(offset));

  const dataDirectory = (index: number): DirectorySpan | null => {
    const entry = image.pe_data_directories[index];
    if (entry === undefined) return null;
    const { address: rva, size } = entry;
    if (rva === 0 && size === 0) return null;
    if (rva === 0 || size === 0)
      throw new BinaryFormatFailure(
        "malformed",
        `PE data directory ${String(index)} declares a zero RVA or size while the other field is nonzero`,
      );
    if (!fitsRva(rva, size))
      throw new BinaryFormatFailure(
        "malformed",
        `PE data directory ${String(index)} RVA ${hex(rva)} span of ${String(size)} bytes extends beyond the 32-bit RVA space`,
      );
    return {
      rva,
      size,
      file_offset: lookup.offset(base + BigInt(rva), size),
    };
  };

  const rvaOf = (va: bigint): number | null => {
    if (va < base) return null;
    const delta = va - base;
    return delta <= 0xffffffffn ? Number(delta) : null;
  };

  const sectionName = sectionNameIndex(image.sections);

  const locate = (va: bigint): PeLoadConfigLocated => {
    if (va === 0n)
      return { va: "0x0", rva: null, file_offset: null, section: null };
    const rva = rvaOf(va);
    let fileOffset: number | null = null;
    if (rva !== null) {
      try {
        fileOffset = lookup.offset(va, 1);
      } catch (cause) {
        if (
          !(cause instanceof BinaryMappingFailure) ||
          cause.reason !== "unmapped"
        )
          throw cause;
      }
    }
    return {
      va: hex(va),
      rva,
      file_offset: fileOffset,
      section: rva === null ? null : sectionName(rva),
    };
  };

  const tls = await readTls({
    bytes,
    bits,
    directory: dataDirectory(PE_TLS_DIRECTORY),
    pointerWidth,
    readPointer,
    locate,
    rvaOf,
    sectionName,
    lookup,
    maxCallbacks: input.max_callbacks,
    signal,
  });
  const loadConfig = readLoadConfig({
    bytes,
    bits,
    directory: dataDirectory(PE_LOAD_CONFIG_DIRECTORY),
    readPointer,
    locate,
    structOffset: (rva, size) => {
      if (!fitsRva(rva, size))
        throw new BinaryFormatFailure(
          "malformed",
          `Load configuration Size ${String(size)} extends beyond the 32-bit RVA space`,
        );
      try {
        return lookup.offset(base + BigInt(rva), size);
      } catch (cause) {
        if (cause instanceof BinaryMappingFailure)
          throw new BinaryFormatFailure(
            "malformed",
            `Load configuration Size ${String(size)} extends beyond its file-backed mapping`,
          );
        throw cause;
      }
    },
  });
  return {
    artifact,
    format: bits === 64 ? "pe32-plus" : "pe32",
    machine: image.pe_machine,
    bits,
    architecture: image.architecture,
    tls,
    load_config: loadConfig,
    examined_callbacks: tls?.callbacks.length ?? 0,
    limitations: [...PE_LOAD_CONFIG_LIMITATIONS],
  };
};

const readTls = async ({
  bytes,
  bits,
  directory,
  pointerWidth,
  readPointer,
  locate,
  rvaOf,
  sectionName,
  lookup,
  maxCallbacks,
  signal,
}: {
  readonly bytes: Buffer;
  readonly bits: 32 | 64;
  readonly directory: DirectorySpan | null;
  readonly pointerWidth: number;
  readonly readPointer: (offset: number) => bigint;
  readonly locate: (va: bigint) => PeLoadConfigLocated;
  readonly rvaOf: (va: bigint) => number | null;
  readonly sectionName: (rva: number) => string | null;
  readonly lookup: { offset(address: bigint, size: number): number };
  readonly maxCallbacks: number;
  readonly signal: AbortSignal | undefined;
}): Promise<PeLoadConfigTls | null> => {
  if (directory === null) return null;
  const structBytes = TLS_STRUCT_BYTES[bits];
  if (directory.size < structBytes)
    throw new BinaryFormatFailure(
      "malformed",
      `TLS directory is ${String(directory.size)} bytes; PE${String(bits)} requires ${String(structBytes)}`,
    );
  const start = readPointer(directory.file_offset);
  const end = readPointer(directory.file_offset + pointerWidth);
  const index = readPointer(directory.file_offset + pointerWidth * 2);
  const callbacksVa = readPointer(directory.file_offset + pointerWidth * 3);
  const sizeOfZeroFill = bytes.readUInt32LE(
    directory.file_offset + pointerWidth * 4,
  );
  const characteristics = bytes.readUInt32LE(
    directory.file_offset + pointerWidth * 4 + 4,
  );
  if (end < start)
    throw new BinaryFormatFailure(
      "malformed",
      "TLS raw data end precedes its start",
    );
  const rawSizeBig = end - start;
  if (rawSizeBig > 0xffffffffn)
    throw new BinaryFormatFailure(
      "malformed",
      "TLS raw data size exceeds the 32-bit range",
    );
  const rawSize = Number(rawSizeBig);
  let rawFile: number | null = null;
  let rawSection: string | null = null;
  if (rawSize === 0) {
    const rva = rvaOf(start);
    rawSection = rva === null ? null : sectionName(rva);
  } else {
    rawFile = lookup.offset(start, rawSize);
    const startRva = rvaOf(start);
    const last = startRva === null ? null : startRva + rawSize - 1;
    if (startRva !== null && last !== null && last <= 0xffffffff) {
      const startName = sectionName(startRva);
      const endName = sectionName(last);
      rawSection =
        startName !== null && startName === endName ? startName : null;
    }
  }

  const callbacks: PeLoadConfigLocated[] = [];
  const callbackArrayLocations: { offset: number; bytes: number }[] = [];
  if (callbacksVa !== 0n) {
    let slot = callbacksVa;
    let entries = 0;
    for (;;) {
      entries += 1;
      if (entries % ENTRIES_PER_YIELD === 0) {
        await setImmediate();
        assertArtifactReadActive(signal);
      }
      const slotOffset = lookup.offset(slot, pointerWidth);
      const value = readPointer(slotOffset);
      consume(callbackArrayLocations, slotOffset, pointerWidth);
      if (value === 0n) break;
      if (callbacks.length >= maxCallbacks)
        throw new PeLoadConfigLimitFailure(
          "callbacks",
          maxCallbacks,
          `TLS callback array exceeds the ${String(maxCallbacks)}-entry callback allowance`,
        );
      callbacks.push(locate(value));
      slot += BigInt(pointerWidth);
    }
  }

  return {
    directory,
    start_address_of_raw_data: hex(start),
    end_address_of_raw_data: hex(end),
    raw_data_size: rawSize,
    raw_data_file_offset: rawFile,
    raw_data_section: rawSection,
    address_of_index: locate(index),
    address_of_callbacks: hex(callbacksVa),
    size_of_zero_fill: sizeOfZeroFill,
    characteristics,
    alignment: tlsAlignment(characteristics),
    callbacks,
    callback_array_locations: callbackArrayLocations,
  };
};

const readLoadConfig = ({
  bytes,
  bits,
  directory,
  readPointer,
  locate,
  structOffset,
}: {
  readonly bytes: Buffer;
  readonly bits: 32 | 64;
  readonly directory: DirectorySpan | null;
  readonly readPointer: (offset: number) => bigint;
  readonly locate: (va: bigint) => PeLoadConfigLocated;
  readonly structOffset: (rva: number, size: number) => number;
}): PeLoadConfigDirectory | null => {
  if (directory === null) return null;
  if (directory.size < 4)
    throw new BinaryFormatFailure(
      "malformed",
      "Load configuration directory is shorter than its Size field",
    );
  const size = bytes.readUInt32LE(directory.file_offset);
  if (size < 4)
    throw new BinaryFormatFailure(
      "malformed",
      `Load configuration Size ${String(size)} is shorter than its Size field`,
    );
  // x86 images declare a 64-byte data directory for compatibility while the
  // structure's own Size gives its real length; the loader reads Size bytes.
  // Accept the larger Size only when those bytes are file-backed in one run.
  if (
    size > directory.size &&
    structOffset(directory.rva, size) !== directory.file_offset
  )
    throw new BinaryFormatFailure(
      "malformed",
      `Load configuration Size ${String(size)} is not contiguously file-backed`,
    );
  const readField = (name: PeLoadConfigField): bigint | null => {
    if (!loadConfigFieldCovered(bits, size, name)) return null;
    const field = loadConfigFieldLayout(bits, name);
    return readUnsignedField(
      bytes,
      directory.file_offset + field.offset,
      field.width,
      readPointer,
    );
  };
  const located = (
    name: PeLoadConfigLocatedField,
  ): PeLoadConfigLocated | null => {
    const value = readField(name);
    return value === null ? null : locate(value);
  };
  const number = (
    name: PeLoadConfigCountField | PeLoadConfigNumberField,
  ): number | null => {
    const value = readField(name);
    if (value === null) return null;
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new BinaryFormatFailure(
        "malformed",
        `Load configuration ${name} exceeds the safe integer range`,
      );
    return Number(value);
  };
  const raw = (name: PeLoadConfigRawField): string | null => {
    const value = readField(name);
    return value === null ? null : hex(value);
  };
  const flags = readField("guard_flags");
  const decoded = flags === null ? null : guardFlagRecord(Number(flags));
  return {
    directory,
    size,
    structure_location: { offset: directory.file_offset, bytes: size },
    security_cookie: located("security_cookie"),
    se_handler_table: located("se_handler_table"),
    se_handler_count: number("se_handler_count"),
    guard_cf_check_function_pointer: located("guard_cf_check_function_pointer"),
    guard_cf_dispatch_function_pointer: located(
      "guard_cf_dispatch_function_pointer",
    ),
    guard_cf_function_table: located("guard_cf_function_table"),
    guard_cf_function_count: number("guard_cf_function_count"),
    guard_flags:
      decoded === null
        ? null
        : {
            raw: Number(flags),
            flags: decoded.flags,
            unrecognized: decoded.unrecognized,
            cf_function_table_stride: decoded.cf_function_table_stride,
          },
    guard_address_taken_iat_entry_table: located(
      "guard_address_taken_iat_entry_table",
    ),
    guard_address_taken_iat_entry_count: number(
      "guard_address_taken_iat_entry_count",
    ),
    guard_long_jump_target_table: located("guard_long_jump_target_table"),
    guard_long_jump_target_count: number("guard_long_jump_target_count"),
    dynamic_value_reloc_table: raw("dynamic_value_reloc_table"),
    chpe_metadata_pointer: raw("chpe_metadata_pointer"),
    dynamic_value_reloc_table_offset: number(
      "dynamic_value_reloc_table_offset",
    ),
    dynamic_value_reloc_table_section: number(
      "dynamic_value_reloc_table_section",
    ),
    guard_eh_continuation_table: located("guard_eh_continuation_table"),
    guard_eh_continuation_count: number("guard_eh_continuation_count"),
    guard_xfg_check_function_pointer: located(
      "guard_xfg_check_function_pointer",
    ),
    inferences: decoded?.inferences ?? [],
  };
};

const readUnsignedField = (
  bytes: Buffer,
  offset: number,
  width: 2 | 4 | 8,
  readPointer: (offset: number) => bigint,
): bigint =>
  width === 8
    ? readPointer(offset)
    : BigInt(
        width === 4 ? bytes.readUInt32LE(offset) : bytes.readUInt16LE(offset),
      );
