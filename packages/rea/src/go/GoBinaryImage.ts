import {
  BinaryFormatFailure,
  BinaryResourceFailure,
  BinaryReader,
  mappedFileOffset,
  imageFileMappings,
  isZeroFilledSpan,
  type BinaryContainer,
  type FileMapping,
  type ZeroFillMapping,
} from "../native/metadata/BinaryContainer.js";
import { readBinaryContainer } from "../native/metadata/readBinaryContainer.js";
import type { GoModuleMetadata } from "../domain/go/goBinary.js";
import { parseGoModuleBytes } from "./GoModuleText.js";
import {
  goBuildInfoSearch,
  type GoBuildInfoSearchRange,
} from "./GoBuildInfoSearch.js";

const MAGIC = Buffer.from("ff20476f206275696c64696e663a", "hex");
const MODULE_START = Buffer.from("3077af0c9274080241e1c107e6d618e6", "hex");
const MODULE_END = Buffer.from("f932433186182072008242104116d8f2", "hex");
const MAX_BUILD_INFO_BYTES = 1024 * 1024;
const MAX_HEADER_SEARCH_BYTES = 256 * 1024 * 1024;

/** Exact file span of one embedded string's contents, excluding its length/header. */
export interface GoStringLocation {
  readonly offset: number;
  readonly bytes: number;
}

/** Observed compiler string and validated module body with its original framing bytes. */
export interface GoBuildInfo {
  readonly header_offset: number;
  readonly encoding: "inline" | "pointer";
  readonly go_version: string | null;
  readonly go_version_bytes_base64: string;
  readonly module_text: string | null;
  readonly module_bytes_base64: string;
  readonly version_location: GoStringLocation;
  readonly module_location: GoStringLocation;
  readonly module: GoModuleMetadata;
}

/** Native image identity and optional Go build information; absence is not a language verdict. */
export interface GoBinaryImage {
  readonly format: "elf" | "pe" | "macho";
  readonly architecture: string;
  readonly bits: 32 | 64;
  readonly byte_order: "little" | "big";
  readonly build_info: GoBuildInfo | null;
  /** Native section-name coverage, retained for discovery limitations. */
  readonly section_names_limitation?: string;
}

/** Inspect bounded executable bytes using native mappings, without loading or executing code. */
export const readGoBinaryImage = (bytes: Buffer): GoBinaryImage => {
  const container = readBinaryContainer(bytes);
  const { format, architecture, bits, byte_order } = container;
  let selected: { search: GoBuildInfoSearchRange; header: number } | null =
    null;
  const searched = new Set<string>();
  let remainingSearchBytes = MAX_HEADER_SEARCH_BYTES;
  const sectionNamesLimitation = container.section_names_limitation;
  for (const search of goBuildInfoSearch(bytes, container)) {
    // Identical file spans and alignment inspect the same candidate bytes.
    // Partially overlapping spans still consume a cumulative work budget.
    const identity = `${search.offset}:${search.size}:${search.address % 16n}`;
    if (searched.has(identity)) continue;
    searched.add(identity);
    if (search.size > remainingSearchBytes)
      throw new BinaryResourceFailure(
        "search",
        MAX_HEADER_SEARCH_BYTES,
        "Go build-info discovery exceeds the cumulative 256 MiB header-search budget",
      );
    remainingSearchBytes -= search.size;
    const header = findHeader(bytes, search);
    if (header !== null) {
      selected = { search, header };
      break;
    }
  }
  if (selected === null)
    return {
      format,
      architecture,
      bits,
      byte_order,
      build_info: null,
      ...(sectionNamesLimitation === undefined
        ? {}
        : { section_names_limitation: sectionNamesLimitation }),
    };
  const { search, header } = selected;
  const mappings = imageFileMappings(container);
  const verifyMapping = (size: number): void => {
    const address = search.address + BigInt(header - search.offset);
    if (
      mappedFileOffset(mappings, address, size, container.zero_fills) !== header
    )
      throw new BinaryFormatFailure(
        "malformed",
        "Go build-info bytes disagree with their virtual mapping",
      );
  };
  verifyMapping(32);
  const reader = new BinaryReader(bytes, byte_order === "little");
  const ptrSize = bytes[header + 14];
  const flags = bytes[header + 15] ?? 0;
  if ((flags & ~3) !== 0)
    throw new BinaryFormatFailure(
      "unsupported",
      "Go build-info flags contain an unsupported format bit",
    );
  if ((flags & 2) === 0 && (flags & 1) !== (byte_order === "big" ? 1 : 0))
    throw new BinaryFormatFailure(
      "malformed",
      "Go build-info byte order disagrees with the image",
    );
  const encoding = (flags & 2) !== 0 ? "inline" : "pointer";
  let version: LocatedString;
  let module: LocatedString;
  if (encoding === "inline") {
    const sourceEnd = inlineDataEnd(header, search, container);
    const versionExtent = readInlineExtent(
      reader,
      header + 32,
      sourceEnd - header - 32,
    );
    const moduleExtent = readInlineExtent(
      reader,
      versionExtent.next,
      sourceEnd - versionExtent.next,
    );
    verifyMapping(moduleExtent.next - header);
    assertAggregateContentLimit(versionExtent.location, moduleExtent.location);
    version = {
      location: versionExtent.location,
      bytes: reader.range(
        versionExtent.location.offset,
        versionExtent.location.bytes,
        "Go build-info string",
      ),
    };
    module = {
      location: moduleExtent.location,
      bytes: reader.range(
        moduleExtent.location.offset,
        moduleExtent.location.bytes,
        "Go build-info string",
      ),
    };
  } else {
    if (ptrSize !== 4 && ptrSize !== 8)
      throw new BinaryFormatFailure(
        "malformed",
        "Go build-info pointer width must be 4 or 8",
      );
    const pointerBits = ptrSize === 4 ? 32 : 64;
    version = readPointerString(
      reader,
      mappings,
      container.zero_fills,
      reader.word(header + 16, pointerBits),
      pointerBits,
    );
    const moduleField = header + 16 + ptrSize;
    module = readOptionalModuleString(
      reader,
      mappings,
      container.zero_fills,
      reader.word(moduleField, pointerBits),
      moduleField,
      pointerBits,
    );
    assertAggregateContentLimit(version.location, module.location);
  }
  if (version.bytes.length === 0)
    throw new BinaryFormatFailure(
      "malformed",
      "Go build-info compiler version is empty",
    );
  const goVersion = observedText(version.bytes);
  let moduleText: string | null = "";
  let moduleBody = module.bytes;
  if (module.bytes.length !== 0) {
    if (
      module.bytes.length < 33 ||
      !module.bytes.subarray(0, 16).equals(MODULE_START) ||
      !module.bytes.subarray(-16).equals(MODULE_END) ||
      module.bytes[module.bytes.length - 17] !== 10
    )
      throw new BinaryFormatFailure(
        "malformed",
        "Go module string framing is invalid",
      );
    moduleBody = module.bytes.subarray(16, -16);
    moduleText = observedText(moduleBody);
  }
  return {
    format,
    architecture,
    bits,
    byte_order,
    build_info: {
      header_offset: header,
      encoding,
      go_version: goVersion,
      go_version_bytes_base64: version.bytes.toString("base64"),
      module_text: moduleText,
      module_bytes_base64: module.bytes.toString("base64"),
      version_location: version.location,
      module_location: module.location,
      module: parseGoModuleBytes(moduleBody),
    },
    ...(sectionNamesLimitation === undefined
      ? {}
      : { section_names_limitation: sectionNamesLimitation }),
  };
};

/** Inline strings follow the header in its mapped Go data, even when the named
 * ELF or Mach-O discovery section ends immediately after the header.
 */
const inlineDataEnd = (
  header: number,
  search: GoBuildInfoSearchRange,
  container: BinaryContainer,
): number => {
  if (container.format === "pe") return search.offset + search.size;
  const address = search.address + BigInt(header - search.offset);
  let end = search.offset + search.size;
  if (search.inline_mapping !== undefined) {
    const delta = address - search.inline_mapping.address;
    if (
      delta >= 0n &&
      delta < BigInt(search.inline_mapping.size) &&
      search.inline_mapping.offset + Number(delta) === header
    )
      return Math.max(
        end,
        search.inline_mapping.offset + search.inline_mapping.size,
      );
    return end;
  }
  for (const { mapping } of container.load_regions ?? []) {
    const delta = address - mapping.address;
    if (
      delta >= 0n &&
      delta < BigInt(mapping.size) &&
      mapping.offset + Number(delta) === header
    )
      end = Math.max(end, mapping.offset + mapping.size);
  }
  return end;
};

const observedText = (bytes: Buffer): string | null => {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch (cause) {
    if (cause instanceof TypeError) return null;
    throw cause;
  }
};

interface LocatedString {
  readonly bytes: Buffer;
  readonly location: GoStringLocation;
}

const assertAggregateContentLimit = (
  version: GoStringLocation,
  module: GoStringLocation,
): void => {
  if (version.bytes + module.bytes > MAX_BUILD_INFO_BYTES)
    throw new BinaryResourceFailure(
      "build-info",
      MAX_BUILD_INFO_BYTES,
      "Go build-info strings exceed the aggregate 1 MiB limit",
    );
};

const findHeader = (bytes: Buffer, search: FileMapping): number | null => {
  if (search.size === 0) return null;
  const end = search.offset + search.size;
  const selected = bytes.subarray(search.offset, end);
  let offset = Number((16n - (search.address % 16n)) % 16n);
  while (offset < selected.length) {
    const match = selected.indexOf(MAGIC, offset);
    if (match < 0) return null;
    const candidate = search.offset + match;
    const address = search.address + BigInt(candidate - search.offset);
    if (address % 16n === 0n) {
      if (end - candidate < 32)
        throw new BinaryFormatFailure(
          "malformed",
          "Go build-info header is truncated",
        );
      return candidate;
    }
    offset = match + 1;
  }
  return null;
};

const readInlineExtent = (
  reader: BinaryReader,
  offset: number,
  remaining: number,
): { readonly location: GoStringLocation; readonly next: number } => {
  let length = 0n;
  for (let index = 0; index < 10; index++) {
    if (index >= remaining)
      throw new BinaryFormatFailure(
        "malformed",
        "Go build-info varint is truncated",
      );
    const byte = reader.bytes[offset + index] ?? 0;
    if (index === 9 && byte > 1)
      throw new BinaryFormatFailure(
        "malformed",
        "Go build-info varint overflows 64 bits",
      );
    length |= BigInt(byte & 127) << BigInt(index * 7);
    if ((byte & 128) === 0) {
      if (length > BigInt(MAX_BUILD_INFO_BYTES))
        throw new BinaryResourceFailure(
          "build-info",
          MAX_BUILD_INFO_BYTES,
          "Go build-info string length exceeds the 1 MiB limit",
        );
      const size = Number(length);
      if (size > remaining - index - 1)
        throw new BinaryFormatFailure(
          "malformed",
          "Go build-info string range is truncated",
        );
      const start = offset + index + 1;
      return {
        location: { offset: start, bytes: size },
        next: start + size,
      };
    }
  }
  throw new BinaryFormatFailure(
    "malformed",
    "Go build-info varint is unterminated",
  );
};

const readPointerString = (
  reader: BinaryReader,
  mappings: readonly FileMapping[],
  zeroFills: readonly ZeroFillMapping[],
  address: bigint,
  pointerBits: 32 | 64,
): LocatedString => {
  const width = pointerBits / 8;
  const header = mappedFileOffset(mappings, address, width * 2, zeroFills);
  const valueAddress = reader.word(header, pointerBits);
  const length = reader.word(header + width, pointerBits);
  if (length > BigInt(MAX_BUILD_INFO_BYTES))
    throw new BinaryResourceFailure(
      "build-info",
      MAX_BUILD_INFO_BYTES,
      "Go build-info pointer string length exceeds the 1 MiB limit",
    );
  const size = Number(length);
  // Zero-length Go strings may carry a zero data pointer.
  const offset =
    size === 0 && valueAddress === 0n
      ? header
      : mappedFileOffset(mappings, valueAddress, size, zeroFills);
  return {
    bytes: reader.range(offset, size, "Go build-info pointer string"),
    location: { offset, bytes: size },
  };
};

const readOptionalModuleString = (
  reader: BinaryReader,
  mappings: readonly FileMapping[],
  zeroFills: readonly ZeroFillMapping[],
  address: bigint,
  pointerField: number,
  pointerBits: 32 | 64,
): LocatedString =>
  isZeroFilledSpan(mappings, zeroFills, address, (pointerBits / 8) * 2)
    ? { bytes: Buffer.alloc(0), location: { offset: pointerField, bytes: 0 } }
    : readPointerString(reader, mappings, zeroFills, address, pointerBits);
