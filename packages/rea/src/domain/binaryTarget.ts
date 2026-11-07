import type {
  BinaryArchitecture,
  ElfFamilyMetadata,
  HeaderArchitecture,
  MipsElfMetadata,
  PeCodeViewRecord,
  RiscvElfMetadata,
  UniversalMachOSlice,
  UniversalMachOSliceIdentity,
} from "./binaryTargetTypes.js";
import { err, ok, type Result } from "./result.js";
import {
  readPeOptionalHeaderFixedFields,
  readPeOptionalHeaderDirectory,
} from "./peOptionalHeader.js";
import type { PeOptionalHeaderFacts } from "./peMachine.js";
import { readPeCoffHeader } from "./peCoffHeader.js";
import { readPeSectionHeader } from "./peSectionHeader.js";
import { readElfFixedHeader } from "./elfFixedHeader.js";
import {
  mzWindowsHeaderLayoutLimitation,
  parseMzHeaderEvidence,
  type MzHeaderEvidence,
  type MzWindowsHeaderSignatureEvidence,
} from "./dosMz.js";
import { decodePeMachine, readPeOptionalHeader } from "./peMachine.js";
import {
  classifyFatContainerEvidence,
  readFatContainerHeader,
  readMachoHeaderPrefixFacts,
  validateFatSliceIdentity,
  type FatSliceHeaderEvidence,
} from "./apple/machoContainer.js";
import {
  MachoLoadCommandCursor,
  readMachoLoadCommandTableHeader,
} from "./apple/machoLoadCommands.js";

/** Format and architecture facts recovered from an executable header. */
export type ExecutableMetadata =
  | {
      readonly format: "elf";
      readonly architecture: "mips";
      readonly availableArchitectures: readonly "mips"[];
      readonly mips: MipsElfMetadata;
    }
  | {
      readonly format: "elf";
      readonly architecture: "riscv";
      readonly availableArchitectures: readonly "riscv"[];
      readonly riscv: RiscvElfMetadata;
    }
  | {
      readonly format: "elf";
      readonly architecture: "powerpc";
      readonly availableArchitectures: readonly "powerpc"[];
      readonly powerpc: ElfFamilyMetadata;
    }
  | {
      readonly format: "elf";
      readonly architecture: "hexagon";
      readonly availableArchitectures: readonly "hexagon"[];
    }
  | {
      readonly format: "mach-o";
      readonly architecture: "arm64_32";
      readonly availableArchitectures: readonly "arm64_32"[];
      readonly universalSlice?: never;
    }
  | {
      readonly format: "mach-o" | "elf" | "dos-mz" | "dos-com";
      readonly architecture: HeaderArchitecture;
      readonly availableArchitectures: readonly HeaderArchitecture[];
      readonly universalSlice?: never;
    }
  | {
      readonly format: "mach-o-universal";
      readonly architecture: HeaderArchitecture;
      readonly availableArchitectures: readonly HeaderArchitecture[];
      readonly universalSlice: UniversalMachOSlice;
      readonly universalSlices: readonly UniversalMachOSliceIdentity[];
    }
  | {
      readonly format: "pe";
      /** Original unsigned COFF machine, before CPU-family normalization. */
      readonly peMachine: number;
      readonly architecture: HeaderArchitecture;
      readonly availableArchitectures: readonly HeaderArchitecture[];
      readonly executableRole:
        | "application"
        | "shared-library"
        | "non-executable";
      readonly managed: boolean;
      readonly codeView?: PeCodeViewRecord;
    };

/**
 * Whether leading bytes begin an executable header family that
 * `parseExecutableHeader` interprets, whether or not that header is valid.
 */
export const claimsExecutableHeader = (
  bytes: Buffer,
  fileSize = bytes.length,
): boolean =>
  (bytes.length >= 4 &&
    (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      readMachoHeaderPrefixFacts(bytes).format !== null)) ||
  (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) ||
  readFatContainerHeader(bytes, fileSize).state !== "not-fat";

/**
 * Parse supported executable headers without I/O. The caller supplies the host
 * architecture that FAT Mach-O slice selection prefers; a container without a
 * host slice selects its first declared supported slice.
 */
export const parseExecutableHeader = (
  bytes: Buffer,
  hostArchitecture: NodeJS.Architecture,
  fileSize = bytes.length,
  mzWindowsHeaderSignature?: MzWindowsHeaderSignatureEvidence,
  fatEvidence?: FatSliceHeaderEvidence,
): Result<ExecutableMetadata, string> => {
  if (
    bytes.length >= 4 &&
    bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  )
    return parseElf(bytes, fileSize);
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a)
    return parseMzExecutableMetadata(
      bytes,
      parseMzHeaderEvidence(bytes, fileSize, mzWindowsHeaderSignature),
    );
  if (bytes.length < 8) return err("truncated or unsupported binary header");
  if (readMachoHeaderPrefixFacts(bytes).format !== null)
    return parseThinMachO(bytes, fileSize);
  const fatHeader =
    fatEvidence?.header ?? readFatContainerHeader(bytes, fileSize);
  if (fatHeader.state !== "not-fat")
    return parseFatMachO(bytes, hostArchitecture, fatHeader, fatEvidence);
  return err("unsupported binary format");
};

/** CPU_TYPE_ARM64_32: AArch64 instructions with 32-bit pointers (watchOS). */
const CPU_TYPE_ARM64_32 = 0x0200000c;

const parseThinMachO = (
  bytes: Buffer,
  fileSize: number,
): Result<ExecutableMetadata, string> => {
  const table = readMachoLoadCommandTableHeader(bytes, fileSize);
  if (!table.ok) return table;
  if (table.value === null) return err("unsupported binary format");
  const { identity } = table.value;
  const architecture =
    identity.cpuType === CPU_TYPE_ARM64_32
      ? "arm64_32"
      : machArchitecture(identity.cpuType);
  if (architecture === undefined) return err("unsupported Mach-O architecture");
  const commands = new MachoLoadCommandCursor(table.value);
  while (commands.nextOffset !== null) {
    const offset = table.value.headerSize + commands.nextOffset;
    // Header-only callers may retain a prefix. File-backed admission walks
    // every remaining command header through its bounded reader.
    if (
      offset + 8 > bytes.length &&
      commands.nextOffset + 8 <= table.value.commandBytes
    )
      break;
    const frame = commands.read(bytes.subarray(offset, offset + 8));
    if (!frame.ok) return frame;
  }
  if (commands.nextOffset === null) {
    const complete = commands.finish();
    if (!complete.ok) return complete;
  }
  if (architecture === "arm64_32")
    return ok({
      format: "mach-o",
      architecture,
      availableArchitectures: [architecture],
    });
  return ok({
    format: "mach-o",
    architecture,
    availableArchitectures: [architecture],
  });
};

/** One FAT declaration whose CPU type is a supported Mach-O family. */
interface FatDeclaration {
  readonly architecture: HeaderArchitecture;
  readonly offset: number;
  readonly size: number;
}

/** Validate a FAT table and its slice identities without selecting a slice. */
const validatedFatDeclarations = (
  bytes: Buffer,
  header: Exclude<
    ReturnType<typeof readFatContainerHeader>,
    { state: "not-fat" }
  >,
  fatEvidence?: FatSliceHeaderEvidence,
): Result<readonly FatDeclaration[], string> => {
  if (header.state === "needs-data")
    return err("truncated or invalid FAT architecture table");
  if (header.state === "malformed") return err(header.reason);
  const identityError = fatIdentityError(
    bytes,
    header,
    fatEvidence?.sliceHeadersByOffset,
  );
  if (identityError !== null) return err(identityError);
  const sliceIdentityError = fatSliceIdentityError(
    bytes,
    header,
    fatEvidence?.sliceHeadersByOffset,
  );
  if (sliceIdentityError !== null) return err(sliceIdentityError);
  return ok(
    header.slices.flatMap((declaration) => {
      const architecture = machArchitecture(declaration.cpuType);
      return architecture === undefined
        ? []
        : [
            {
              architecture,
              offset: declaration.offset,
              size: declaration.size,
            },
          ];
    }),
  );
};

const declaredFamilies = (
  declarations: readonly FatDeclaration[],
): HeaderArchitecture[] => [
  ...new Set(declarations.map(({ architecture }) => architecture)),
];

/**
 * The supported CPU families a validated FAT Mach-O table declares, or null for
 * a non-FAT input. Unlike header parsing, it selects no slice, so it can show
 * that a table excludes a host even when no slice is selectable.
 */
export const readFatArchitectureFamilies = (
  bytes: Buffer,
  fileSize = bytes.length,
): Result<readonly HeaderArchitecture[], string> | null => {
  const header = readFatContainerHeader(bytes, fileSize);
  if (header.state === "not-fat") return null;
  const declarations = validatedFatDeclarations(bytes, header);
  return declarations.ok
    ? ok(declaredFamilies(declarations.value))
    : declarations;
};

const parseFatMachO = (
  bytes: Buffer,
  host: NodeJS.Architecture,
  header: Exclude<
    ReturnType<typeof readFatContainerHeader>,
    { state: "not-fat" }
  >,
  fatEvidence?: FatSliceHeaderEvidence,
): Result<ExecutableMetadata, string> => {
  const validated = validatedFatDeclarations(bytes, header, fatEvidence);
  if (!validated.ok) return validated;
  const declarations = validated.value;
  // Prefer the slice the host would load; a malformed host slice is an error.
  // A container without one still declares its images, so select the first
  // that can hold its Mach-O header, as a thin foreign image would be. A
  // family declared more than once, such as arm64 and arm64e, has no
  // provider-neutral choice and is not selected.
  const preferred = fatHostArchitecture(host);
  const hostSlice = declarations.find(
    ({ architecture }) => architecture === preferred,
  );
  const unambiguous = declarations.filter(
    ({ architecture }) =>
      declarations.filter((other) => other.architecture === architecture)
        .length === 1,
  );
  const candidates = hostSlice === undefined ? unambiguous : [hostSlice];
  const selected = candidates.find(
    ({ architecture, size }) =>
      size >= (architecture === "arm64" || architecture === "x86_64" ? 32 : 28),
  );
  if (selected === undefined) {
    const first = candidates[0];
    if (first !== undefined)
      return err(
        `FAT slice for ${first.architecture} is shorter than its Mach-O header`,
      );
    return err(
      declarations.length === 0
        ? "FAT binary declares no supported Mach-O architecture"
        : `FAT binary has no ${host} slice and no foreign architecture declared exactly once`,
    );
  }
  return ok({
    format: "mach-o-universal",
    architecture: selected.architecture,
    availableArchitectures: declaredFamilies(declarations),
    universalSlice: { offset: selected.offset, size: selected.size },
    universalSlices:
      header.state === "parsed"
        ? header.slices.map(({ offset, size, cpuType, cpuSubtype }) => ({
            offset,
            size,
            cpuType,
            cpuSubtype,
          }))
        : [],
  });
};

const fatSliceIdentityError = (
  bytes: Buffer,
  header: Extract<
    ReturnType<typeof readFatContainerHeader>,
    { state: "parsed" }
  >,
  sliceHeadersByOffset?: ReadonlyMap<
    number,
    ReturnType<typeof readMachoHeaderPrefixFacts>
  >,
): string | null => {
  for (let index = 0; index < header.slices.length; index += 1) {
    const declaration = header.slices[index];
    if (declaration === undefined || header.rangeIssues[index] !== null)
      continue;
    let facts: ReturnType<typeof readMachoHeaderPrefixFacts> | undefined;
    if (sliceHeadersByOffset?.has(declaration.offset)) {
      facts = sliceHeadersByOffset.get(declaration.offset);
    } else if (
      declaration.size >= 12 &&
      declaration.offset <= bytes.length - 12
    ) {
      facts = readMachoHeaderPrefixFacts(
        bytes.subarray(declaration.offset, declaration.offset + 12),
      );
    }
    const identity = facts?.identity;
    if (identity === null || identity === undefined)
      return `FAT architecture ${declaration.index} thin Mach-O CPU identity is outside the bounded header`;
    const identityError = validateFatSliceIdentity(declaration, identity);
    if (identityError !== null) return identityError;
  }
  return null;
};

const fatHostArchitecture = (
  host: NodeJS.Architecture,
): HeaderArchitecture | undefined => {
  switch (host) {
    case "arm64":
      return "arm64";
    case "x64":
      return "x86_64";
    case "ia32":
      return "x86";
    case "arm":
      return "arm";
    default:
      return undefined;
  }
};

const fatIdentityError = (
  bytes: Buffer,
  header: Extract<
    ReturnType<typeof readFatContainerHeader>,
    { state: "parsed" }
  >,
  sliceHeadersByOffset?: ReadonlyMap<
    number,
    ReturnType<typeof readMachoHeaderPrefixFacts>
  >,
): string | null => {
  const identity = classifyFatContainerEvidence(
    header,
    bytes,
    sliceHeadersByOffset,
  );
  if (identity.state === "needs-slice-header")
    return "FAT slice identity is outside the bounded prefix";
  if (identity.state === "not-mach-o") return "unsupported binary format";
  if (identity.state === "malformed") return identity.reason;
  return null;
};

const parseElf = (
  bytes: Buffer,
  fileSize: number,
): Result<ExecutableMetadata, string> => {
  const fixedHeader = readElfFixedHeader(bytes, fileSize);
  if (!fixedHeader.ok) return fixedHeader;
  const { elfClass, byteOrder, architecture, machine, type, flags } =
    fixedHeader.value;
  if (architecture === null)
    return err(`unsupported ELF architecture: e_machine ${String(machine)}`);
  if (
    architecture === "mips" ||
    architecture === "riscv" ||
    architecture === "powerpc"
  ) {
    const metadata: ElfFamilyMetadata = {
      elfClass,
      byteOrder,
      type,
      flags,
    };
    if (architecture === "powerpc")
      return ok({
        format: "elf",
        architecture,
        availableArchitectures: [architecture],
        powerpc: metadata,
      });
    return architecture === "mips"
      ? ok({
          format: "elf",
          architecture,
          availableArchitectures: [architecture],
          mips: metadata,
        })
      : ok({
          format: "elf",
          architecture,
          availableArchitectures: [architecture],
          riscv: metadata,
        });
  }
  if (architecture === "hexagon")
    return ok({
      format: "elf",
      architecture,
      availableArchitectures: [architecture],
    });
  return ok({
    format: "elf",
    architecture,
    availableArchitectures: [architecture],
  });
};

/** Select executable metadata from the reader's completed MZ observations. */
export const parseMzExecutableMetadata = (
  bytes: Buffer,
  evidence: MzHeaderEvidence,
): Result<ExecutableMetadata, string> => {
  const { windowsHeader } = evidence;
  if (
    windowsHeader.state === "header-needed" ||
    windowsHeader.state === "signature-needed"
  )
    return err(
      "Windows new-header pointer or signature is outside the bounded prefix",
    );
  if (windowsHeader.state === "candidate")
    return err("MZ Windows new-header candidate is unresolved");
  if (windowsHeader.state === "declared") {
    const { offset } = windowsHeader;
    const limitation = mzWindowsHeaderLayoutLimitation(windowsHeader);
    if (limitation !== undefined) return err(limitation);
    if (offset > bytes.length - 24)
      return err("invalid or truncated Windows executable header in MZ image");
    if (["NE", "LE", "LX"].includes(windowsHeader.signature))
      return err(
        `unsupported ${windowsHeader.signature} executable in MZ image`,
      );
    if (windowsHeader.signature !== "PE")
      return err("invalid or truncated Windows executable header in MZ image");
    const codeView = parsePeCodeViewFromBuffer(bytes, offset);
    const parsed = parsePeRecordFacts(bytes.subarray(offset), codeView);
    return parsed.ok ? ok(parsed.value.metadata) : parsed;
  }
  const parsed = evidence.dos;
  return parsed.ok
    ? ok({
        format: "dos-mz",
        architecture: "x86",
        availableArchitectures: ["x86"],
      })
    : parsed;
};

/** Parse a bounded PE signature, COFF record, and optional header without I/O. */
export const parsePeRecordFacts = (
  record: Buffer,
  codeView: PeCodeViewRecord | undefined,
): Result<
  {
    readonly metadata: ExecutableMetadata;
    readonly optionalHeader: PeOptionalHeaderFacts;
  },
  string
> => {
  if (
    record.length < 24 ||
    record.toString("binary", 0, 4) !== "PE\u0000\u0000"
  )
    return err("invalid or truncated PE header");
  const coff = readPeCoffHeader(record.subarray(4, 24));
  if (!coff.ok) return err("invalid or truncated PE header");
  const {
    machine: machineType,
    optionalHeaderSize,
    characteristics,
  } = coff.value;
  const machine = decodePeMachine(machineType);
  if (machine === undefined)
    return err(
      `unsupported PE architecture (COFF machine 0x${machineType.toString(16).padStart(4, "0")})`,
    );
  if (optionalHeaderSize > 4096 || record.length < 24 + optionalHeaderSize)
    return err("invalid or truncated PE optional header");
  const optionalHeader = record.subarray(24, 24 + optionalHeaderSize);
  const facts = readPeOptionalHeader(optionalHeader, machineType);
  if (!facts.ok) return err(facts.error.message);
  if (facts.value.machine === null) return err("unsupported PE architecture");
  const { architecture } = facts.value.machine;
  return ok({
    optionalHeader: facts.value,
    metadata: {
      format: "pe",
      peMachine: machineType,
      architecture,
      availableArchitectures: [architecture],
      executableRole:
        (characteristics & 0x0002) === 0
          ? "non-executable"
          : (characteristics & 0x2000) === 0
            ? "application"
            : "shared-library",
      managed: facts.value.managed,
      ...(codeView !== undefined ? { codeView } : {}),
    },
  });
};

/** Parse CodeView record data (RSDS or NB10) from raw data bytes. */
export const parseCodeViewData = (
  buffer: Buffer,
  sizeOfData: number,
): PeCodeViewRecord | undefined => {
  if (sizeOfData < 16 || buffer.length < 16) return undefined;
  const magic = buffer.subarray(0, 4).toString("binary");
  const pathOffset = magic === "RSDS" ? 24 : magic === "NB10" ? 16 : undefined;
  if (
    pathOffset === undefined ||
    sizeOfData <= pathOffset ||
    buffer.length <= pathOffset
  )
    return undefined;
  const end = buffer.indexOf(0, pathOffset);
  if (end <= pathOffset || end >= sizeOfData) return undefined;
  const pdbPath = buffer.toString("utf8", pathOffset, end);
  const pdbFileName = pdbPath.split(/[/\\]/u).pop() ?? pdbPath;
  if (magic === "RSDS" && sizeOfData >= 24 && buffer.length >= 24) {
    const part1 = buffer.readUInt32LE(4).toString(16).padStart(8, "0");
    const part2 = buffer.readUInt16LE(8).toString(16).padStart(4, "0");
    const part3 = buffer.readUInt16LE(10).toString(16).padStart(4, "0");
    const part4 = buffer.subarray(12, 14).toString("hex");
    const part5 = buffer.subarray(14, 20).toString("hex");
    const guid = `${part1}-${part2}-${part3}-${part4}-${part5}`;
    const age = buffer.readUInt32LE(20);
    return { pdbPath, pdbFileName, guid, age };
  }
  if (magic === "NB10") {
    const age = buffer.readUInt32LE(12);
    return { pdbPath, pdbFileName, guid: null, age };
  }
  return undefined;
};

/** Locate the debug directory RVA and size from a PE optional header. */
export const peDebugDirectoryEntry = (
  optionalHeader: Buffer,
):
  | {
      readonly debugRva: number;
      readonly debugSize: number;
      readonly sizeOfHeaders: number;
    }
  | undefined => {
  const fixed = readPeOptionalHeaderFixedFields(optionalHeader);
  if (!fixed.ok) return undefined;
  const observed = readPeOptionalHeaderDirectory(
    optionalHeader,
    fixed.value,
    6,
  );
  if (observed.state !== "present") return undefined;
  const { address: debugRva, size: debugSize } = observed.directory;
  if (debugRva === 0 || debugSize < 28) return undefined;
  return { debugRva, debugSize, sizeOfHeaders: fixed.value.sizeOfHeaders };
};

/** Translate an RVA to an absolute file offset using the PE section table. */
export const peRvaToFileOffset = (
  rva: number,
  sectionTable: Buffer,
  numberOfSections: number,
  sizeOfHeaders: number,
  size = 1,
): number | undefined => {
  if (rva < sizeOfHeaders && size <= sizeOfHeaders - rva) return rva;
  for (let i = 0; i < numberOfSections; i++) {
    const offset = i * 40;
    const parsed = readPeSectionHeader(
      sectionTable.subarray(offset, offset + 40),
    );
    if (!parsed.ok) break;
    const {
      virtual_address: virtualAddress,
      raw_size: sizeOfRawData,
      offset: pointerToRawData,
    } = parsed.value;
    if (
      pointerToRawData > 0 &&
      rva >= virtualAddress &&
      rva - virtualAddress < sizeOfRawData &&
      size <= sizeOfRawData - (rva - virtualAddress)
    ) {
      return pointerToRawData + (rva - virtualAddress);
    }
  }
  return undefined;
};

/** CodeView RVA admission uses the same bounded prefix as target file reads. */
const PE_CODEVIEW_MAPPING_BYTES = 4096;

/** Interpret complete debug entries once; callers own directory and payload read bounds. */
export function* peCodeViewDataRanges(
  directory: Buffer,
  sectionTable: Buffer,
  numberOfSections: number,
  sizeOfHeaders: number,
): Generator<{ readonly fileOffset: number; readonly declaredSize: number }> {
  for (let offset = 0; offset + 28 <= directory.length; offset += 28) {
    if (directory.readUInt32LE(offset + 12) !== 2) continue;
    const declaredSize = directory.readUInt32LE(offset + 16);
    if (declaredSize < 16) continue;
    const rawPointer = directory.readUInt32LE(offset + 24);
    const fileOffset =
      rawPointer !== 0
        ? rawPointer
        : peRvaToFileOffset(
            directory.readUInt32LE(offset + 20),
            sectionTable,
            numberOfSections,
            sizeOfHeaders,
            Math.min(declaredSize, PE_CODEVIEW_MAPPING_BYTES),
          );
    if (fileOffset !== undefined) yield { fileOffset, declaredSize };
  }
}

/** Parse CodeView metadata from a bounded in-memory PE image buffer. */
export const parsePeCodeViewFromBuffer = (
  fileBytes: Buffer,
  peOffset: number,
): PeCodeViewRecord | undefined => {
  if (fileBytes.length < peOffset + 24) return undefined;
  const coff = readPeCoffHeader(
    fileBytes.subarray(peOffset + 4, peOffset + 24),
  );
  if (!coff.ok) return undefined;
  const { sectionCount: numberOfSections, optionalHeaderSize } = coff.value;
  if (
    optionalHeaderSize > 4096 ||
    fileBytes.length < peOffset + 24 + optionalHeaderSize
  )
    return undefined;
  const optionalHeader = fileBytes.subarray(
    peOffset + 24,
    peOffset + 24 + optionalHeaderSize,
  );
  const debugDir = peDebugDirectoryEntry(optionalHeader);
  if (debugDir === undefined) return undefined;
  const sectionTableOffset = peOffset + 24 + optionalHeaderSize;
  const sectionTableSize = numberOfSections * 40;
  if (fileBytes.length < sectionTableOffset + sectionTableSize)
    return undefined;
  const sectionTable = fileBytes.subarray(
    sectionTableOffset,
    sectionTableOffset + sectionTableSize,
  );
  const debugFileOffset = peRvaToFileOffset(
    debugDir.debugRva,
    sectionTable,
    numberOfSections,
    debugDir.sizeOfHeaders,
    Math.min(debugDir.debugSize, 4096),
  );
  if (debugFileOffset === undefined || fileBytes.length < debugFileOffset + 28)
    return undefined;
  const maxDebugBytes = Math.min(
    debugDir.debugSize,
    fileBytes.length - debugFileOffset,
  );
  for (const {
    fileOffset: pointerToRawData,
    declaredSize: sizeOfData,
  } of peCodeViewDataRanges(
    fileBytes.subarray(debugFileOffset, debugFileOffset + maxDebugBytes),
    sectionTable,
    numberOfSections,
    debugDir.sizeOfHeaders,
  )) {
    if (fileBytes.length < pointerToRawData + Math.min(sizeOfData, 24))
      continue;
    const codeViewData = fileBytes.subarray(
      pointerToRawData,
      Math.min(fileBytes.length, pointerToRawData + sizeOfData),
    );
    const parsed = parseCodeViewData(codeViewData, sizeOfData);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
};

const machArchitecture = (cpu: number): HeaderArchitecture | undefined => {
  switch (cpu) {
    case 7:
      return "x86";
    case 0x01000007:
      return "x86_64";
    case 12:
      return "arm";
    case 0x0100000c:
      return "arm64";
  }
  return undefined;
};
