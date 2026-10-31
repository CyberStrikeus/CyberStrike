import {
  readUniversalMachoImage,
  readUniversalMachoSlice,
} from "../domain/apple/machoImageSelection.js";
import { binaryMetadataArchitecture } from "../domain/binaryMetadataArchitecture.js";
import {
  BinaryFormatFailure,
  BinaryResourceFailure,
  createFileMappingIndex,
  mappedFileOffset,
  isZeroFilledSpan,
  type BinaryContainer,
  type FileMappingIndex,
} from "../native/metadata/BinaryContainer.js";
import { readBinaryContainer } from "../native/metadata/readBinaryContainer.js";
import {
  parsePointerFixups,
  type PointerFixups,
} from "../native/AppleMachoFixups.js";
import {
  parseMachoLayout,
  UnsupportedMachoMetadataFormatError,
} from "../native/AppleMachoSelection.js";
import { applyElfRelativeRelocationsSteps } from "./ElfRelocations.js";
import { Il2cppBinaryFormatFailure } from "./Il2cppBinaryFormat.js";
const MACHO_CPU = new Map([
  [0x01000007, "amd64"],
  [0x0100000c, "arm64"],
]);

/** Select one thin image; a universal Mach-O needs the caller's architecture. */
const selectImage = (
  bytes: Buffer,
  architecture: string | undefined,
): Buffer => {
  const container = readUniversalMachoImage(bytes);
  if (!container.ok)
    throw new Il2cppBinaryFormatFailure(
      "malformed-container",
      container.error.message,
    );
  const fat = container.value;
  if (fat === null) {
    if (architecture !== undefined)
      throw new Il2cppBinaryFormatFailure(
        "slice-not-found",
        `architecture ${architecture} was requested but the binary is not a universal Mach-O`,
      );
    return bytes;
  }
  const available = fat.slices.map(
    (slice) => MACHO_CPU.get(slice.cpuType) ?? `macho-cpu-${slice.cpuType}`,
  );
  if (architecture === undefined)
    throw new Il2cppBinaryFormatFailure(
      "slice-selection-required",
      `universal Mach-O holds ${available.join(", ")}; select one architecture`,
    );
  if (available.filter((value) => value === architecture).length > 1)
    throw new Il2cppBinaryFormatFailure(
      "ambiguous-slice-selection",
      `multiple universal slices declare ${architecture}; no slice was selected`,
    );
  const index = available.indexOf(architecture);
  const slice = fat.slices[index];
  if (slice === undefined)
    throw new Il2cppBinaryFormatFailure(
      "slice-not-found",
      `universal Mach-O holds ${available.join(", ")}, not ${architecture}`,
    );
  const selected = readUniversalMachoSlice(bytes, fat, slice);
  if (!selected.ok)
    throw new Il2cppBinaryFormatFailure(
      "malformed-container",
      selected.error.message,
    );
  return selected.value;
};

export interface NativeImage {
  readonly bytes: Buffer;
  readonly container: BinaryContainer;
  /** One image's immutable load mappings, shared by stored and loader-aware reads. */
  readonly fileMappings: FileMappingIndex;
  readonly imageBase: bigint;
  readonly unresolvedPointerSlots: ReadonlyMap<bigint, number>;
  readonly zeroFillPointers: ReadonlyMap<bigint, bigint>;
  /** Mach-O loader fixups shared by every native pointer consumer. */
  readonly machoPointerFixups?: PointerFixups;
}

export function* openImageSteps(
  bytes: Buffer,
  architecture: string | undefined,
): Generator<void, NativeImage> {
  let image = selectImage(bytes, architecture);
  let container: BinaryContainer;
  try {
    container = readBinaryContainer(image);
  } catch (cause) {
    if (cause instanceof BinaryResourceFailure)
      throw new Il2cppBinaryFormatFailure(
        "native-index-capacity",
        cause.message,
      );
    if (cause instanceof BinaryFormatFailure)
      throw new Il2cppBinaryFormatFailure(
        cause.kind === "unsupported"
          ? "unsupported-container"
          : "malformed-container",
        cause.message,
      );
    throw cause;
  }
  if (container.bits !== 64 || container.byte_order !== "little")
    throw new Il2cppBinaryFormatFailure(
      "unsupported-container",
      `only 64-bit little-endian images are supported, not ${container.bits}-bit ${container.byte_order}-endian`,
    );
  let relocated:
    | {
        bytes: Buffer;
        unresolved: ReadonlyMap<bigint, number>;
        zeroFillPointers: ReadonlyMap<bigint, bigint>;
      }
    | undefined;
  try {
    if (container.format === "elf")
      relocated = yield* applyElfRelativeRelocationsSteps(
        image,
        container.elf,
        container.mappings,
        container.zero_fills,
      );
  } catch (cause) {
    if (cause instanceof BinaryFormatFailure)
      throw new Il2cppBinaryFormatFailure("malformed-container", cause.message);
    throw cause;
  }
  if (relocated !== undefined) image = relocated.bytes;
  if (container.format === "macho" && container.macho_chained_fixups === true)
    throw new Il2cppBinaryFormatFailure(
      "unsupported-pointer-encoding",
      "Mach-O chained fixups are not decoded",
    );
  let machoPointerFixups: PointerFixups | undefined;
  if (container.format === "macho") {
    try {
      const layout = parseMachoLayout(
        image,
        binaryMetadataArchitecture(container.architecture) ??
          container.architecture,
      );
      machoPointerFixups = parsePointerFixups(
        image,
        layout.fixups,
        layout.segments,
        layout.baseAddress,
      );
    } catch (cause) {
      if (cause instanceof UnsupportedMachoMetadataFormatError)
        throw new Il2cppBinaryFormatFailure(
          "unsupported-container",
          cause.message,
        );
      if (cause instanceof RangeError || cause instanceof TypeError)
        throw new Il2cppBinaryFormatFailure(
          "malformed-container",
          cause.message,
        );
      throw cause;
    }
  }
  if (container.format === "pe" && container.image_base === undefined)
    throw new Il2cppBinaryFormatFailure(
      "malformed-container",
      "PE image base was not observed",
    );
  const imageBase =
    container.image_base ??
    container.mappings.find((mapping) => mapping.offset === 0)?.address ??
    container.mappings.reduce<bigint | undefined>(
      (lowest, mapping) =>
        lowest === undefined || mapping.address < lowest
          ? mapping.address
          : lowest,
      undefined,
    ) ??
    0n;
  return {
    bytes: image,
    container,
    fileMappings: createFileMappingIndex(
      container.mappings,
      container.zero_fills,
    ),
    imageBase,
    unresolvedPointerSlots: relocated?.unresolved ?? new Map<bigint, number>(),
    zeroFillPointers: relocated?.zeroFillPointers ?? new Map<bigint, bigint>(),
    ...(machoPointerFixups === undefined ? {} : { machoPointerFixups }),
  };
}

/** Stored bytes only; loader interpretation belongs to readSlot. */
const readStoredWord = (image: NativeImage, address: bigint): bigint | null => {
  try {
    const offset = image.fileMappings.offset(address, 8);
    return image.bytes.readBigUInt64LE(offset);
  } catch (cause) {
    if (cause instanceof BinaryFormatFailure) return null;
    throw cause;
  }
};

/** A UInt32 field owns four bytes; reading a pointer would also require unrelated padding. */
export const readUInt32 = (
  image: NativeImage,
  address: bigint,
): number | "unknown" | null => {
  if (
    hasUnresolvedElfBytes(image, address, 4) ||
    image.machoPointerFixups?.hasUnresolvedLegacyBytes(address, 4) === true
  )
    return "unknown";
  const virtual = image.zeroFillPointers.get(address);
  if (virtual !== undefined) return Number(virtual & 0xffffffffn);
  try {
    return image.bytes.readUInt32LE(image.fileMappings.offset(address, 4));
  } catch (cause) {
    if (cause instanceof BinaryFormatFailure) return null;
    throw cause;
  }
};

/** Exact lowercase hexadecimal form of an address in reports and issues. */
export const hexAddress = (value: bigint) => `0x${value.toString(16)}`;

export const isMapped = (image: NativeImage, address: bigint, size: number) => {
  try {
    image.fileMappings.offset(address, size);
    return true;
  } catch (cause) {
    if (cause instanceof BinaryFormatFailure) return false;
    throw cause;
  }
};

// An array of slots that all lack a body can sit wholly in zero-fill (.bss):
// an iOS-only assembly in an Android build has its pointers there.
export const isZeroFilled = (
  image: NativeImage,
  address: bigint,
  size: number,
) =>
  isZeroFilledSpan(
    image.container.mappings,
    image.container.zero_fills,
    address,
    size,
  );

/** Admit readable slots across loader ranges without walking every pointer.
 * Each chunk uses the format owner's alias checks; a gap or split slot is refused.
 */
export const hasPointerArrayCoverage = (
  image: NativeImage,
  address: bigint,
  count: number,
): boolean => {
  const end = address + BigInt(count) * 8n;
  let cursor = address;
  while (cursor < end) {
    let fileEnd = cursor;
    for (const range of image.container.mappings)
      if (
        range.address <= cursor &&
        range.address + BigInt(range.size) > fileEnd
      )
        fileEnd = range.address + BigInt(range.size);
    let coveredEnd = fileEnd;
    if (fileEnd === cursor)
      for (const range of image.container.zero_fills)
        if (range.address <= cursor && range.address + range.size > coveredEnd)
          coveredEnd = range.address + range.size;
    const stop = coveredEnd < end ? coveredEnd : end;
    const size = Number(((stop - cursor) / 8n) * 8n);
    if (size <= 0) return false;
    try {
      if (fileEnd === cursor) {
        if (!isZeroFilled(image, cursor, size)) return false;
      } else {
        image.fileMappings.offset(cursor, size);
      }
    } catch (cause) {
      if (cause instanceof BinaryFormatFailure) return false;
      throw cause;
    }
    cursor += BigInt(size);
  }
  return true;
};

/** Both executable coverage and the unique full loader mapping must agree. */
export const isExecutable = (image: NativeImage, address: bigint): boolean => {
  try {
    const offset = image.fileMappings.offset(address, 1);
    return (
      offset ===
      mappedFileOffset(image.container.executable_mappings ?? [], address, 1)
    );
  } catch (cause) {
    if (cause instanceof BinaryFormatFailure) return false;
    throw cause;
  }
};

const hasUnresolvedElfBytes = (
  image: NativeImage,
  address: bigint,
  size = 8,
): boolean => {
  if (image.unresolvedPointerSlots.size === 0) return false;
  for (let delta = -7; delta < size; delta++) {
    const width = image.unresolvedPointerSlots.get(address + BigInt(delta));
    if (width !== undefined && delta + width > 0) return true;
  }
  return false;
};

export const readSlot = (
  image: NativeImage,
  address: bigint,
): bigint | "unknown" | null => {
  if (hasUnresolvedElfBytes(image, address)) return "unknown";
  try {
    const virtual = image.zeroFillPointers.get(address);
    let raw: bigint | null;
    if (virtual !== undefined) raw = virtual;
    else {
      // A successful indexed read already excludes zero-fill aliases. Only a
      // non-file-backed slot needs the zero-fill ownership walk.
      raw = readStoredWord(image, address);
      if (raw === null && isZeroFilled(image, address, 8)) raw = 0n;
    }
    if (raw === null) return null;
    if (image.machoPointerFixups !== undefined) {
      const resolution = image.machoPointerFixups.decode(address, raw);
      if (resolution.kind === "bind" || resolution.kind === "unknown")
        return "unknown";
      if (resolution.kind === "unsupported")
        throw new Il2cppBinaryFormatFailure(
          "unsupported-pointer-encoding",
          resolution.reason,
        );
      return resolution.target;
    }
    return raw;
  } catch (cause) {
    if (cause instanceof BinaryFormatFailure)
      throw new Il2cppBinaryFormatFailure("malformed-container", cause.message);
    throw cause;
  }
};

/** Require an observed resolved pointer; unknown and unmapped slots stay null. */
export const readPointer = (
  image: NativeImage,
  address: bigint,
): bigint | null => {
  const value = readSlot(image, address);
  return typeof value === "bigint" ? value : null;
};
