import {
  legacyMachoPlatform,
  type MachoVersionMinPlatform,
} from "../domain/apple/machoPlatform.js";
import type { MachoCommandNames } from "./MachoCommandNames.js";

/** The binary is the sole owner of command framing and decoded facts. */
const COMMAND_NAMES = new Map<number, string>([
  [1, "LC_SEGMENT"],
  [2, "LC_SYMTAB"],
  [3, "LC_SYMSEG"],
  [4, "LC_THREAD"],
  [5, "LC_UNIXTHREAD"],
  [6, "LC_LOADFVMLIB"],
  [7, "LC_IDFVMLIB"],
  [8, "LC_IDENT"],
  [9, "LC_FVMFILE"],
  [0xa, "LC_PREPAGE"],
  [0xb, "LC_DYSYMTAB"],
  [0xc, "LC_LOAD_DYLIB"],
  [0xd, "LC_ID_DYLIB"],
  [0xe, "LC_LOAD_DYLINKER"],
  [0xf, "LC_ID_DYLINKER"],
  [0x10, "LC_PREBOUND_DYLIB"],
  [0x11, "LC_ROUTINES"],
  [0x12, "LC_SUB_FRAMEWORK"],
  [0x13, "LC_SUB_UMBRELLA"],
  [0x14, "LC_SUB_CLIENT"],
  [0x15, "LC_SUB_LIBRARY"],
  [0x16, "LC_TWOLEVEL_HINTS"],
  [0x17, "LC_PREBIND_CKSUM"],
  [0x80000018, "LC_LOAD_WEAK_DYLIB"],
  [0x19, "LC_SEGMENT_64"],
  [0x1a, "LC_ROUTINES_64"],
  [0x1b, "LC_UUID"],
  [0x8000001c, "LC_RPATH"],
  [0x1d, "LC_CODE_SIGNATURE"],
  [0x1e, "LC_SEGMENT_SPLIT_INFO"],
  [0x8000001f, "LC_REEXPORT_DYLIB"],
  [0x20, "LC_LAZY_LOAD_DYLIB"],
  [0x21, "LC_ENCRYPTION_INFO"],
  [0x22, "LC_DYLD_INFO"],
  [0x80000022, "LC_DYLD_INFO_ONLY"],
  [0x80000023, "LC_LOAD_UPWARD_DYLIB"],
  [0x24, "LC_VERSION_MIN_MACOSX"],
  [0x25, "LC_VERSION_MIN_IPHONEOS"],
  [0x26, "LC_FUNCTION_STARTS"],
  [0x27, "LC_DYLD_ENVIRONMENT"],
  [0x80000028, "LC_MAIN"],
  [0x29, "LC_DATA_IN_CODE"],
  [0x2a, "LC_SOURCE_VERSION"],
  [0x2b, "LC_DYLIB_CODE_SIGN_DRS"],
  [0x2c, "LC_ENCRYPTION_INFO_64"],
  [0x2d, "LC_LINKER_OPTION"],
  [0x2e, "LC_LINKER_OPTIMIZATION_HINT"],
  [0x2f, "LC_VERSION_MIN_TVOS"],
  [0x30, "LC_VERSION_MIN_WATCHOS"],
  [0x31, "LC_NOTE"],
  [0x32, "LC_BUILD_VERSION"],
  [0x80000033, "LC_DYLD_EXPORTS_TRIE"],
  [0x80000034, "LC_DYLD_CHAINED_FIXUPS"],
  [0x80000035, "LC_FILESET_ENTRY"],
  [0x36, "LC_ATOM_INFO"],
  [0x37, "LC_FUNCTION_VARIANTS"],
  [0x38, "LC_FUNCTION_VARIANT_FIXUPS"],
  [0x39, "LC_TARGET_TRIPLE"],
  [0x3a, "LC_LAZY_LOAD_DYLIB_INFO"],
]);
const PLATFORM_NAMES = new Map<number, string>([
  [1, "MACOS"],
  [2, "IOS"],
  [3, "TVOS"],
  [4, "WATCHOS"],
  [5, "BRIDGEOS"],
  [6, "MACCATALYST"],
  [7, "IOSSIMULATOR"],
  [8, "TVOSSIMULATOR"],
  [9, "WATCHOSSIMULATOR"],
  [10, "DRIVERKIT"],
  [11, "VISIONOS"],
  [12, "VISIONOSSIMULATOR"],
  [13, "FIRMWARE"],
  [14, "SEPOS"],
  [15, "MACOS_EXCLAVECORE"],
  [16, "MACOS_EXCLAVEKIT"],
  [17, "IOS_EXCLAVECORE"],
  [18, "IOS_EXCLAVEKIT"],
  [19, "TVOS_EXCLAVECORE"],
  [20, "TVOS_EXCLAVEKIT"],
  [21, "WATCHOS_EXCLAVECORE"],
  [22, "WATCHOS_EXCLAVEKIT"],
  [23, "VISIONOS_EXCLAVECORE"],
  [24, "VISIONOS_EXCLAVEKIT"],
]);
const TOOL_NAMES = new Map<number, string>([
  [1, "CLANG"],
  [2, "SWIFT"],
  [3, "LD"],
  [4, "LLD"],
  [1024, "METAL"],
  [1025, "AIRLLD"],
  [1026, "AIRNT"],
  [1027, "AIRNT_PLUGIN"],
  [1028, "AIRPACK"],
  [1031, "GPUARCHIVER"],
  [1032, "METAL_FRAMEWORK"],
]);
const DYLIBS = new Set([
  "LC_LOAD_DYLIB",
  "LC_LOAD_WEAK_DYLIB",
  "LC_REEXPORT_DYLIB",
  "LC_LAZY_LOAD_DYLIB",
  "LC_LOAD_UPWARD_DYLIB",
  "LC_LOADFVMLIB",
  "LC_PREBOUND_DYLIB",
]);
const STRING_FIELDS = new Map<number, string>([
  [0x6, "name"],
  [0x7, "name"],
  [0x9, "name"],
  [0x10, "name"],
  [0xc, "name"],
  [0xd, "name"],
  [0x80000018, "name"],
  [0x8000001f, "name"],
  [0x20, "name"],
  [0x80000023, "name"],
  [0xe, "name"],
  [0xf, "name"],
  [0x12, "umbrella"],
  [0x13, "sub_umbrella"],
  [0x14, "client"],
  [0x15, "sub_library"],
  [0x8000001c, "path"],
  [0x27, "name"],
  [0x39, "triple"],
]);

const bytesText = (input: Uint8Array, fixed = false) => {
  const end = fixed ? input.indexOf(0) : -1;
  const bytes = end < 0 ? input : input.subarray(0, end);
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
      ),
      bytesHex: null,
    };
  } catch {
    return { text: null, bytesHex: Buffer.from(bytes).toString("hex") };
  }
};
const numberOrNull = (value: bigint): number | null =>
  value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
const rawNumber = (value: bigint, width: number): number | string =>
  numberOrNull(value) ?? `0x${value.toString(16).padStart(width, "0")}`;
const address = (value: bigint) => `0x${value.toString(16)}`;
const version = (value: number, includePatch = false) => {
  const major = value >>> 16;
  const minor = (value >>> 8) & 0xff;
  const patch = value & 0xff;
  return `${major}.${minor}${includePatch || patch !== 0 ? `.${patch}` : ""}`;
};
const permissions = (value: number) => ({
  read: (value & 1) !== 0,
  write: (value & 2) !== 0,
  execute: (value & 4) !== 0,
  raw: String(value),
});
const uuidText = (bytes: Uint8Array) => {
  const hex = Buffer.from(bytes).toString("hex").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

type Section = {
  segment: string | null;
  segment_bytes_hex?: string;
  name: string | null;
  name_bytes_hex?: string;
  address: string;
  size: number | null;
  size_hex?: string;
  file_offset: number;
  alignment: number | null;
  alignment_exponent?: number;
  flags: string[];
};
type Segment = {
  name: string | null;
  name_bytes_hex?: string;
  vm_address: string;
  vm_size: number | null;
  vm_size_hex?: string;
  file_offset: number | null;
  file_offset_hex?: string;
  file_size: number | null;
  file_size_hex?: string;
  maximum_permissions: ReturnType<typeof permissions>;
  initial_permissions: ReturnType<typeof permissions>;
  sections: Section[];
};
type Dependency = {
  path: string | null;
  path_bytes_hex?: string;
  kind: string;
  current_version: string | null;
  compatibility_version: string | null;
};
export interface BinaryMachoProjection {
  readonly wordSize: 32 | 64;
  readonly endian: "little" | "big";
  readonly fileType: string;
  readonly flags: string[];
  readonly commands: {
    index: number;
    kind: string;
    fields: Record<string, string | number | null>;
  }[];
  readonly segments: Segment[];
  readonly dependencies: Dependency[];
  readonly entrypoints: { file_offset: number }[];
  readonly builds: {
    platform: string | null;
    minimum_os: string | null;
    sdk: string | null;
    tools: { name: string; version: string }[];
  }[];
  readonly commandLimitations: string[];
  readonly segmentLimitations: string[];
  readonly dependencyLimitations: string[];
  readonly entrypointLimitations: string[];
  readonly buildLimitations: string[];
}

/** Project only observed binary fields; unmodeled command payloads are explicit. */
export const projectMachoBinary = (
  binary: MachoCommandNames,
): BinaryMachoProjection => {
  const commands: BinaryMachoProjection["commands"] = [];
  const segments: Segment[] = [];
  const dependencies: Dependency[] = [];
  const entrypoints: BinaryMachoProjection["entrypoints"] = [];
  const builds: BinaryMachoProjection["builds"] = [];
  const commandLimitations = new Set<string>();
  const segmentLimitations = new Set<string>();
  const dependencyLimitations = new Set<string>();
  const entrypointLimitations = new Set<string>();
  const buildLimitations = new Set<string>();
  const wordWidth = binary.header.wide ? 16 : 8;
  const textFact = (
    bytes: Uint8Array,
    fixed: boolean,
    limitations: Set<string>,
  ) => {
    const fact = bytesText(bytes, fixed);
    if (fact.text === null)
      limitations.add(
        "A Mach-O name is not valid UTF-8; its exact bytes are retained as hexadecimal and its text is unknown.",
      );
    return fact;
  };
  for (const row of binary.commands) {
    const kind =
      COMMAND_NAMES.get(row.command) ??
      `LC_UNKNOWN_0x${row.command.toString(16)}`;
    const fields: Record<string, string | number | null> = {
      cmd: kind,
      cmdsize: row.size,
      ...row.fixedFields,
    };
    let decoded = row.fixedFields !== undefined;
    if (
      row.segment !== undefined &&
      row.segmentName !== undefined &&
      row.sections !== undefined
    ) {
      decoded = true;
      const name = textFact(row.segmentName, true, segmentLimitations);
      if (name.text === null)
        commandLimitations.add(
          "A Mach-O name is not valid UTF-8; its exact bytes are retained as hexadecimal and its text is unknown.",
        );
      const repeated = (key: string, index: number, count: number) =>
        count > 1 ? `${key} #${index + 1}` : key;
      fields[repeated("segname", 0, row.sections.length + 1)] = name.text;
      fields[`${repeated("segname", 0, row.sections.length + 1)}_storage_hex`] =
        Buffer.from(row.segmentName).toString("hex");
      if (name.bytesHex !== null)
        fields[`${repeated("segname", 0, row.sections.length + 1)}_bytes_hex`] =
          name.bytesHex;
      fields.vmaddr = rawNumber(row.segment.address, wordWidth);
      fields.vmsize = rawNumber(row.segment.memorySize, wordWidth);
      fields.fileoff = rawNumber(row.segment.fileOffset, wordWidth);
      fields.filesize = rawNumber(row.segment.fileSize, wordWidth);
      fields.maxprot = row.segment.maxProtection;
      fields.initprot = row.segment.protection;
      fields.nsects = row.sections.length;
      fields[repeated("flags", 0, row.sections.length + 1)] = row.segment.flags;
      const vmSize = numberOrNull(row.segment.memorySize);
      const fileOffset = numberOrNull(row.segment.fileOffset);
      const fileSize = numberOrNull(row.segment.fileSize);
      if (vmSize === null || fileOffset === null || fileSize === null)
        segmentLimitations.add(
          "A segment size or file offset exceeds the safe integer range; its exact hexadecimal value remains in the load command.",
        );
      const sections = row.sections.map((section, index): Section => {
        const sectionName = textFact(section.name, true, segmentLimitations);
        const sectionOwner = textFact(
          section.segmentName,
          true,
          segmentLimitations,
        );
        const size = numberOrNull(section.size);
        const sectionNameKey = repeated(
          "sectname",
          index,
          row.sections!.length,
        );
        const segmentNameKey = repeated(
          "segname",
          index + 1,
          row.sections!.length + 1,
        );
        fields[sectionNameKey] = sectionName.text;
        fields[segmentNameKey] = sectionOwner.text;
        fields[`${sectionNameKey}_storage_hex`] = Buffer.from(
          section.name,
        ).toString("hex");
        fields[`${segmentNameKey}_storage_hex`] = Buffer.from(
          section.segmentName,
        ).toString("hex");
        if (sectionName.bytesHex !== null)
          fields[`${sectionNameKey}_bytes_hex`] = sectionName.bytesHex;
        if (sectionOwner.bytesHex !== null)
          fields[`${segmentNameKey}_bytes_hex`] = sectionOwner.bytesHex;
        if (sectionName.text === null || sectionOwner.text === null)
          commandLimitations.add(
            "A Mach-O name is not valid UTF-8; its exact bytes are retained as hexadecimal and its text is unknown.",
          );
        const count = row.sections!.length;
        fields[repeated("addr", index, count)] = rawNumber(
          section.address,
          wordWidth,
        );
        fields[repeated("size", index, count)] = rawNumber(
          section.size,
          wordWidth,
        );
        fields[repeated("offset", index, count)] = section.fileOffset;
        fields[repeated("align", index, count)] = section.alignmentExponent;
        fields[repeated("reloff", index, count)] = section.relocationOffset;
        fields[repeated("nreloc", index, count)] = section.relocationCount;
        fields[repeated("flags", index + 1, count + 1)] = section.flags;
        fields[repeated("reserved1", index, count)] = section.reserved1;
        fields[repeated("reserved2", index, count)] = section.reserved2;
        if (section.reserved3 !== undefined)
          fields[repeated("reserved3", index, count)] = section.reserved3;
        const alignment =
          section.alignmentExponent > 52
            ? null
            : 2 ** section.alignmentExponent;
        if (size === null || alignment === null)
          segmentLimitations.add(
            "A section size or alignment exceeds the safe integer range and is unknown in the segment view.",
          );
        return {
          segment: sectionOwner.text,
          ...(sectionOwner.bytesHex === null
            ? {}
            : { segment_bytes_hex: sectionOwner.bytesHex }),
          name: sectionName.text,
          ...(sectionName.bytesHex === null
            ? {}
            : { name_bytes_hex: sectionName.bytesHex }),
          address: address(section.address),
          size,
          ...(size === null ? { size_hex: address(section.size) } : {}),
          file_offset: section.fileOffset,
          alignment,
          ...(alignment === null
            ? { alignment_exponent: section.alignmentExponent }
            : {}),
          flags: [`0x${section.flags.toString(16)}`],
        };
      });
      segments.push({
        name: name.text,
        ...(name.bytesHex === null ? {} : { name_bytes_hex: name.bytesHex }),
        vm_address: address(row.segment.address),
        vm_size: vmSize,
        ...(vmSize === null
          ? { vm_size_hex: address(row.segment.memorySize) }
          : {}),
        file_offset: fileOffset,
        ...(fileOffset === null
          ? { file_offset_hex: address(row.segment.fileOffset) }
          : {}),
        file_size: fileSize,
        ...(fileSize === null
          ? { file_size_hex: address(row.segment.fileSize) }
          : {}),
        maximum_permissions: permissions(row.segment.maxProtection),
        initial_permissions: permissions(row.segment.protection),
        sections,
      });
    }
    if (row.commandString !== undefined) {
      decoded = ![0x6, 0x7, 0x9, 0x10].includes(row.command);
      const name = textFact(row.commandString, false, commandLimitations);
      const field = STRING_FIELDS.get(row.command) ?? "name";
      fields[field] =
        name.text === null
          ? null
          : `${name.text} (offset ${String(row.commandStringOffset)})`;
      if (name.bytesHex !== null) fields[`${field}_bytes_hex`] = name.bytesHex;
      if (row.dylib !== undefined) {
        fields["current version"] = version(row.dylib.currentVersion, true);
        fields["compatibility version"] = version(
          row.dylib.compatibilityVersion,
          true,
        );
        if (row.dylib.encoding.kind === "timestamp")
          fields["time stamp"] = row.dylib.encoding.timestamp;
        else fields.options = row.dylib.encoding.flags;
      }
      if (DYLIBS.has(kind)) {
        if (name.text === null)
          dependencyLimitations.add(
            "A dependency path is not valid UTF-8; its exact bytes are retained as hexadecimal and its text is unknown.",
          );
        dependencies.push({
          path: name.text,
          ...(name.bytesHex === null ? {} : { path_bytes_hex: name.bytesHex }),
          kind,
          current_version:
            row.dylib === undefined
              ? null
              : version(row.dylib.currentVersion, true),
          compatibility_version:
            row.dylib === undefined
              ? null
              : version(row.dylib.compatibilityVersion, true),
        });
      }
    }
    if (row.fvmlib !== undefined) {
      decoded = true;
      fields["minor version"] = row.fvmlib.minorVersion;
      fields["header addr"] = row.fvmlib.headerAddress;
    }
    if (row.fvmfile !== undefined) {
      decoded = true;
      fields["header addr"] = row.fvmfile.headerAddress;
    }
    if (row.prebound !== undefined) {
      decoded = true;
      fields.nmodules = row.prebound.moduleCount;
      fields.linked_modules_offset = row.prebound.linkedModulesOffset;
      fields.linked_modules_bytes_hex = Buffer.from(
        row.prebound.linkedModules,
      ).toString("hex");
    }
    if (row.uuid !== undefined) {
      decoded = true;
      fields.uuid = uuidText(row.uuid);
    }
    if (row.entrypoint !== undefined) {
      decoded = true;
      fields.entryoff = rawNumber(row.entrypoint.offset, 16);
      fields.stacksize = rawNumber(row.entrypoint.stackSize, 16);
      const offset = numberOrNull(row.entrypoint.offset);
      if (offset === null)
        entrypointLimitations.add(
          "An entrypoint offset exceeds the safe integer range; its exact value remains in the load command.",
        );
      else entrypoints.push({ file_offset: offset });
    }
    if (row.build !== undefined) {
      decoded = true;
      fields.platform = row.build.platform;
      fields.minos = version(row.build.minimumOs);
      fields.sdk = version(row.build.sdk);
      fields.ntools = row.build.tools.length;
      const tools = row.build.tools.map((tool, index) => {
        const suffix = row.build!.tools.length > 1 ? ` #${index + 1}` : "";
        fields[`tool${suffix}`] = tool.tool;
        fields[`version${suffix}`] = version(tool.version);
        return {
          name: TOOL_NAMES.get(tool.tool) ?? String(tool.tool),
          version: version(tool.version),
        };
      });
      builds.push({
        platform:
          PLATFORM_NAMES.get(row.build.platform) ?? String(row.build.platform),
        minimum_os: version(row.build.minimumOs),
        sdk: version(row.build.sdk),
        tools,
      });
    }
    if (row.legacyBuild !== undefined) {
      decoded = true;
      fields.version = version(row.legacyBuild.version);
      fields.sdk = version(row.legacyBuild.sdk);
      const platform = ([0x24, 0x25, 0x2f, 0x30].indexOf(row.command) +
        1) as MachoVersionMinPlatform;
      const effective = legacyMachoPlatform(platform, binary.header.cpuType);
      builds.push({
        platform:
          effective === platform
            ? (["MACOSX", "IPHONEOS", "TVOS", "WATCHOS"][platform - 1] ?? null)
            : (PLATFORM_NAMES.get(effective) ?? String(effective)),
        minimum_os: version(row.legacyBuild.version),
        sdk: version(row.legacyBuild.sdk),
        tools: [],
      });
    }
    if (row.linkerOptions !== undefined) {
      decoded = true;
      fields.count = row.linkerOptions.length;
      row.linkerOptions.forEach((option, index) => {
        const fact = textFact(option, false, commandLimitations);
        const label = `string #${index + 1}`;
        fields[label] = fact.text;
        if (fact.bytesHex !== null)
          fields[`${label}_bytes_hex`] = fact.bytesHex;
      });
    }
    if (row.note !== undefined) {
      decoded = true;
      const owner = textFact(row.note.owner, true, commandLimitations);
      fields.data_owner = owner.text;
      if (owner.bytesHex !== null) fields.data_owner_bytes_hex = owner.bytesHex;
      fields.offset = rawNumber(row.note.offset, 16);
      fields.size = rawNumber(row.note.size, 16);
    }
    if (row.fileset !== undefined) {
      decoded = true;
      const id = textFact(row.fileset.entryId, false, commandLimitations);
      fields.vmaddr = rawNumber(row.fileset.address, 16);
      fields.fileoff = rawNumber(row.fileset.fileOffset, 16);
      fields.entry_id = id.text;
      if (id.bytesHex !== null) fields.entry_id_bytes_hex = id.bytesHex;
      fields.reserved = row.fileset.reserved;
    }
    if (!row.fullyDecoded || !decoded || !COMMAND_NAMES.has(row.command)) {
      fields.command_code = row.command;
      fields.command_offset = (binary.header.wide ? 32 : 28) + row.offset;
      fields.command_sha256 = row.rawSha256;
      commandLimitations.add(
        "Some load-command payload fields are not decoded; command codes, positions and sizes remain observed, but the payload bytes are not retained. A whole-command SHA-256 is included when it fit the read allowance.",
      );
      if (!COMMAND_NAMES.has(row.command)) {
        dependencyLimitations.add(
          "An unknown load command may contain dependency facts that were not decoded.",
        );
        entrypointLimitations.add(
          "An unknown load command may contain entrypoint facts that were not decoded.",
        );
        buildLimitations.add(
          "An unknown load command may contain build facts that were not decoded.",
        );
      }
      if (kind === "LC_THREAD" || kind === "LC_UNIXTHREAD")
        entrypointLimitations.add("Thread-state entrypoints are not decoded.");
      if (kind === "LC_LAZY_LOAD_DYLIB_INFO")
        dependencyLimitations.add(
          "The linkedit dependency payload is not decoded.",
        );
      if (kind.startsWith("LC_VERSION_MIN_") || kind === "LC_BUILD_VERSION")
        buildLimitations.add(`The ${kind} payload is not decoded.`);
    }
    commands.push({ index: row.index, kind, fields });
  }
  return {
    wordSize: binary.header.wide ? 64 : 32,
    endian: binary.header.littleEndian ? "little" : "big",
    fileType: String(binary.header.fileType),
    flags: [`0x${binary.header.flags.toString(16).padStart(8, "0")}`],
    commands,
    segments,
    dependencies,
    entrypoints,
    builds,
    commandLimitations: [...commandLimitations],
    segmentLimitations: [...segmentLimitations],
    dependencyLimitations: [...dependencyLimitations],
    entrypointLimitations: [...entrypointLimitations],
    buildLimitations: [...buildLimitations],
  };
};
