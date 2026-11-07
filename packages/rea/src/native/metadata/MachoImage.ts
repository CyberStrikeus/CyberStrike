import { decodeMachoFixedName } from "../AppleMachoNames.js";
import {
  readMachoSectionHeader,
  type MachoSectionHeader,
} from "../../domain/apple/machoSectionHeader.js";
import {
  admitMachoSegmentMapping,
  readMachoSegmentHeader,
} from "../../domain/apple/machoSegmentHeader.js";
import {
  declaredFileRange,
  BinaryFormatFailure,
  BinaryReader,
  type BinaryContainer,
  type FileMapping,
  type ImageSection,
  type LoadRegion,
  type ZeroFillMapping,
} from "./BinaryContainer.js";
import {
  MachoLoadCommandCursor,
  readMachoLoadCommandDeclarations,
} from "../../domain/apple/machoLoadCommands.js";

/** Read thin Mach-O images, retaining the slice's exact file-backed mappings. */
export const readMachoImage = (bytes: Buffer): BinaryContainer => {
  const parsed = readMachoLoadCommandDeclarations(bytes, bytes.length);
  if (!parsed.ok) throw new BinaryFormatFailure("malformed", parsed.error);
  if (parsed.value === null)
    throw new BinaryFormatFailure("malformed", "Unrecognized Mach-O header");
  const table = parsed.value;
  const { headerSize, commandBytes, littleEndian: little } = table;
  const bits = table.wide ? 64 : 32;
  const reader = new BinaryReader(bytes, little);
  const commandStart = reader.table(
    BigInt(headerSize),
    commandBytes,
    1,
    "Mach-O load commands",
  );
  const mappings: FileMapping[] = [];
  const loadRegions: LoadRegion[] = [];
  const executableMappings: FileMapping[] = [];
  const zeroFills: ZeroFillMapping[] = [];
  const sections: ImageSection[] = [];
  let chainedFixups = false;
  const commands = new MachoLoadCommandCursor(table);
  while (commands.nextOffset !== null) {
    const offset = commandStart + commands.nextOffset;
    const frame = commands.read(bytes.subarray(offset, offset + 8));
    if (!frame.ok) throw new BinaryFormatFailure("malformed", frame.error);
    const { command, size } = frame.value;
    if (command === 0x80000034) chainedFixups = true;
    if (command === 1 || command === 0x19) {
      const wide = command === 0x19;
      if (wide !== (bits === 64))
        throw new BinaryFormatFailure(
          "malformed",
          "Mach-O segment command does not match the header width",
        );
      const sectionWidth = wide ? 80 : 68;
      const parsedSegment = readMachoSegmentHeader(
        bytes.subarray(offset, offset + size),
        wide,
        little,
      );
      if (!parsedSegment.ok)
        throw new BinaryFormatFailure(
          parsedSegment.error.kind,
          parsedSegment.error.message,
        );
      const {
        headerSize: segmentHeader,
        address,
        memorySize,
        fileOffset,
        fileSize,
        maxProtection,
        protection,
        sectionCount,
        nameBytes,
      } = parsedSegment.value;
      const admitted = admitMachoSegmentMapping(parsedSegment.value, bits);
      if (!admitted.ok)
        throw new BinaryFormatFailure(
          admitted.error.kind,
          admitted.error.message,
        );
      const { unmapped } = admitted.value;
      if (sectionCount > Math.floor((size - segmentHeader) / sectionWidth))
        throw new BinaryFormatFailure(
          "malformed",
          "Mach-O section table exceeds its segment command",
        );
      const fileRange =
        fileSize === 0n
          ? undefined
          : reader.fileRange(fileOffset, fileSize, "Mach-O segment");
      const mapping =
        unmapped || fileRange === undefined
          ? undefined
          : { ...fileRange, address };
      const name = decodeMachoFixedName(nameBytes);
      if (mapping !== undefined && name !== "__PAGEZERO") {
        mappings.push(mapping);
        loadRegions.push({
          mapping,
          memory_size: memorySize,
          read: (protection & 1) !== 0,
          write: (protection & 2) !== 0,
          execute: (protection & 4) !== 0,
          protection_masks: {
            current: protection,
            maximum: maxProtection,
          },
        });
        if ((protection & 4) !== 0) executableMappings.push(mapping);
      }
      if (memorySize > fileSize && name !== "__PAGEZERO")
        zeroFills.push({
          address: address + fileSize,
          size: memorySize - fileSize,
        });
      for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
        const section = offset + segmentHeader + sectionIndex * sectionWidth;
        const parsedSection = readMachoSectionHeader(
          bytes.subarray(section, section + sectionWidth),
          wide,
          little,
        );
        if (!parsedSection.ok)
          throw new BinaryFormatFailure(
            parsedSection.error.kind,
            parsedSection.error.message,
          );
        sections.push(
          machoImageSection({
            fileBytes: bytes.length,
            section: parsedSection.value,
            protection,
            segmentMapping: mapping ?? null,
            segmentUnmapped: unmapped,
            unmapped: unmapped || mapping === undefined,
            segmentAddress: address,
            segmentMemorySize: memorySize,
            segmentFileOffset: fileOffset,
            segmentFileSize: fileSize,
          }),
        );
      }
    }
  }
  const complete = commands.finish();
  if (!complete.ok) throw new BinaryFormatFailure("malformed", complete.error);
  const cpu = table.identity.cpuType;
  const names = new Map([
    [7, "386"],
    [0x01000007, "amd64"],
    [12, "arm"],
    [0x0100000c, "arm64"],
    [0x0200000c, "arm64_32"],
    [18, "ppc"],
    [0x01000012, "ppc64"],
  ]);
  return {
    format: "macho",
    macho_chained_fixups: chainedFixups,
    architecture: names.get(cpu) ?? `macho-cpu-${cpu}`,
    bits,
    byte_order: little ? "little" : "big",
    mappings,
    load_regions: loadRegions,
    executable_mappings: executableMappings,
    zero_fills: zeroFills,
    sections,
  };
};

const machoImageSection = ({
  fileBytes,
  section,
  protection,
  segmentMapping,
  segmentUnmapped,
  unmapped,
  segmentAddress,
  segmentMemorySize,
  segmentFileOffset,
  segmentFileSize,
}: {
  readonly fileBytes: number;
  readonly section: MachoSectionHeader;
  readonly protection: number;
  readonly segmentMapping: FileMapping | null;
  readonly segmentUnmapped: boolean;
  readonly unmapped: boolean;
  readonly segmentAddress: bigint;
  readonly segmentMemorySize: bigint;
  readonly segmentFileOffset: bigint;
  readonly segmentFileSize: bigint;
}): ImageSection => {
  const { flags, address: sectionAddress, size: sectionSize } = section;
  const sectionOffset = BigInt(section.offset);
  const sectionName = decodeMachoFixedName(section.nameBytes);
  const name = `${decodeMachoFixedName(section.segmentNameBytes)},${sectionName}`;
  const zeroFill = [1, 0xc, 0x12].includes(flags & 0xff);
  const addressDelta = sectionAddress - segmentAddress;
  const fileDelta = sectionOffset - segmentFileOffset;
  const inSegmentMemory =
    addressDelta >= 0n &&
    addressDelta <= segmentMemorySize &&
    sectionSize <= segmentMemorySize - addressDelta;
  const inSegmentFile =
    fileDelta >= 0n &&
    fileDelta <= segmentFileSize &&
    sectionSize <= segmentFileSize - fileDelta;
  const range = unmapped
    ? { offset: 0, size: 0, file_backed: false }
    : declaredFileRange(fileBytes, sectionOffset, sectionSize);
  const fileBacked =
    range.file_backed && !zeroFill && inSegmentMemory && inSegmentFile;
  const readOnly =
    fileBacked &&
    (protection & 1) !== 0 &&
    (protection & 2) === 0 &&
    (flags & 0x80000400) === 0;
  return {
    format: "macho",
    name,
    section_name: sectionName,
    type: flags & 0xff,
    address: sectionAddress,
    declared_range: { offset: sectionOffset, size: sectionSize },
    segment_mapping: segmentMapping,
    segment_unmapped: segmentUnmapped,
    ...range,
    file_backed: fileBacked,
    read_only: readOnly,
    compressed: false,
  };
};
