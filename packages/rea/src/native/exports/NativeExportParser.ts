import {
  BinaryFormatFailure,
  BinaryReader,
  BinaryResourceFailure,
  mappedFileOffset,
  imageFileMappings,
  readMappedCString,
} from "../metadata/BinaryContainer.js";
import { architectureForElfMachine } from "../metadata/ElfImage.js";
import { readElfStringBytes } from "../metadata/ElfStringTable.js";
import { readElfSymbol } from "../../domain/elfSymbol.js";
import {
  readElfDirectoryFromBuffer,
  type NativeSection,
} from "../metadata/NativeSectionDirectory.js";
import { readPeImage } from "../metadata/PeImage.js";
import {
  MAX_NATIVE_EXPORT_ROWS,
  decodeElfExportName,
  type ElfExport,
  type NativeExportIssue,
  type NativeExports,
  type PeExport,
} from "../../domain/native/nativeExports.js";

type Artifact = NativeExports["artifact"];

const SHT_STRTAB = 3;
const SHT_DYNSYM = 11;
const SHT_GNU_VERDEF = 0x6ffffffd;
const SHT_GNU_VERNEED = 0x6ffffffe;
const SHT_GNU_VERSYM = 0x6fffffff;
const PE_EXPORT_DIRECTORY = 0;
const PE_EXPORT_DIRECTORY_BYTES = 40;
const MAXIMUM_NAME_BYTES = 4096;
/** Text retained across all rows; names can repeat one long string table entry. */
const MAXIMUM_RETAINED_TEXT_BYTES = 16 * 1024 * 1024;

const retainedTextBytes = (...strings: readonly (string | null)[]): number =>
  strings.reduce(
    (bytes, value) =>
      bytes + (value === null ? 0 : Buffer.byteLength(value, "utf8")),
    0,
  );

const checkRetainedText = (bytes: number): void => {
  if (bytes > MAXIMUM_RETAINED_TEXT_BYTES)
    throw new BinaryResourceFailure(
      "structure",
      MAXIMUM_RETAINED_TEXT_BYTES,
      `Export names exceed the ${String(MAXIMUM_RETAINED_TEXT_BYTES)}-byte retained-text allowance`,
    );
};

/** Charge retained text and rows at their owning storage boundary. */
const createRetention = () => {
  let rows = 0;
  let text = 0;
  const retainText = (...strings: readonly (string | null)[]): void => {
    text += retainedTextBytes(...strings);
    checkRetainedText(text);
  };
  return {
    text: retainText,
    row: (...strings: readonly (string | null)[]): void => {
      rows++;
      rowBudget(rows, "Export inventory");
      retainText(...strings);
    },
  };
};

const hex = (value: bigint | number) => `0x${value.toString(16)}`;

const rowBudget = (count: number, label: string): void => {
  if (count > MAX_NATIVE_EXPORT_ROWS)
    throw new BinaryResourceFailure(
      "structure",
      MAX_NATIVE_EXPORT_ROWS,
      `${label} declares ${String(count)} entries, above the ${String(MAX_NATIVE_EXPORT_ROWS)}-entry export inventory allowance`,
    );
};

const coverage = (
  issues: readonly NativeExportIssue[],
  examined: number,
  exports: number,
): NativeExports["coverage"] =>
  issues.length === 0
    ? { status: "complete", reason: null, examined_entries: examined, exports }
    : {
        status: "partial",
        reason: `${String(issues.length)} export table issue(s) affect reported rows or metadata; see issues`,
        examined_entries: examined,
        exports,
      };

const failureMessage = (cause: unknown): string => {
  if (cause instanceof BinaryFormatFailure) return cause.message;
  throw cause;
};

const PE_LIMITATIONS = [
  "Rows reproduce the PE export directory; they do not establish that an export is reachable, safe to call or loaded at runtime.",
  "Forwarded exports resolve in another DLL, which is not opened; ordinal-only exports have no name in this image.",
];

/** Read the PE export directory: every used address-table slot and its names. */
const parsePeExports = (bytes: Buffer, artifact: Artifact): NativeExports => {
  const image = readPeImage(bytes);
  const base = image.image_base ?? 0n;
  const directory = image.pe_data_directories?.[PE_EXPORT_DIRECTORY];
  const result = {
    artifact,
    format: "pe" as const,
    architecture: image.architecture,
    bits: image.bits,
  };
  if (directory === undefined || directory.address === 0)
    return {
      ...result,
      export_directory: null,
      exports: [],
      coverage: coverage([], 0, 0),
      issues: [],
      limitations: [
        "The image declares no export directory, so it exports nothing by name or ordinal.",
        ...PE_LIMITATIONS,
      ],
    };
  const reader = new BinaryReader(bytes, true);
  const mappings = imageFileMappings(image);
  const map = (rva: number, size: number): number =>
    mappedFileOffset(mappings, base + BigInt(rva), size, image.zero_fills);
  const cStringBytes = (
    rva: number,
    maximumBytes = MAXIMUM_NAME_BYTES,
  ): Buffer => {
    const value = readMappedCString(
      bytes,
      image,
      base + BigInt(rva),
      maximumBytes,
    );
    if (value.length === 0)
      throw new BinaryFormatFailure(
        "malformed",
        `Export name at RVA ${hex(rva)} is empty`,
      );
    return value;
  };

  const header = map(directory.address, PE_EXPORT_DIRECTORY_BYTES);
  const ordinalBase = reader.u32(header + 16);
  const functionCount = reader.u32(header + 20);
  const nameCount = reader.u32(header + 24);
  rowBudget(functionCount, "PE export address table");
  rowBudget(nameCount, "PE export name table");
  const functions =
    functionCount === 0 ? 0 : map(reader.u32(header + 28), functionCount * 4);
  const names =
    nameCount === 0 ? 0 : map(reader.u32(header + 32), nameCount * 4);
  const ordinals =
    nameCount === 0 ? 0 : map(reader.u32(header + 36), nameCount * 2);
  const issues: NativeExportIssue[] = [];
  let dllName: string | null = null;
  try {
    dllName = cStringBytes(reader.u32(header + 12)).toString("latin1");
  } catch (cause) {
    issues.push({
      code: "name_unreadable",
      location: hex(reader.u32(header + 12)),
      message: `Export directory DLL name: ${failureMessage(cause)}`,
    });
  }

  const retain = createRetention();
  const namesByFunction = new Map<number, string[]>();
  const namedFunctions = new Set<number>();
  for (let index = 0; index < nameCount; index++) {
    const functionIndex = reader.u16(ordinals + index * 2);
    const nameRva = reader.u32(names + index * 4);
    if (functionIndex >= functionCount) {
      issues.push({
        code: "malformed_entry",
        location: hex(nameRva),
        message: `Export name ${String(index)} selects address-table slot ${String(functionIndex)}, outside its ${String(functionCount)} slots`,
      });
      continue;
    }
    namedFunctions.add(functionIndex);
    try {
      const nameBytes = cStringBytes(nameRva);
      // Validate unused slots too, but retain names only for populated slots.
      if (reader.u32(functions + functionIndex * 4) === 0) continue;
      const name = nameBytes.toString("latin1");
      retain.text(name);
      const list = namesByFunction.get(functionIndex) ?? [];
      list.push(name);
      namesByFunction.set(functionIndex, list);
    } catch (cause) {
      issues.push({
        code: "name_unreadable",
        location: hex(nameRva),
        message: failureMessage(cause),
      });
    }
  }

  const forwarderEnd = directory.address + directory.size;
  const exports: PeExport[] = [];
  for (let index = 0; index < functionCount; index++) {
    const rva = reader.u32(functions + index * 4);
    // A zero slot is an unused ordinal, not an export.
    if (rva === 0) continue;
    const ordinal = ordinalBase + index;
    let target: Pick<PeExport, "address" | "forwarder">;
    if (rva >= directory.address && rva < forwarderEnd) {
      try {
        target = {
          address: null,
          // PE forwarder strings, including their NUL, must fit within the
          // export data directory. Ordinary export names have no such bound.
          forwarder: cStringBytes(
            rva,
            Math.min(MAXIMUM_NAME_BYTES, forwarderEnd - rva - 1),
          ).toString("latin1"),
        };
      } catch (cause) {
        issues.push({
          code: "malformed_entry",
          location: hex(rva),
          message: `Forwarder of ordinal ${String(ordinal)}: ${failureMessage(cause)}`,
        });
        continue;
      }
    } else target = { address: hex(base + BigInt(rva)), forwarder: null };
    const exportNames = namesByFunction.get(index);
    if (exportNames !== undefined)
      for (const name of exportNames) {
        retain.row(target.forwarder);
        exports.push({ name, ordinal, ...target });
      }
    // A slot whose only name was unreadable is reported through its issue.
    else if (!namedFunctions.has(index)) {
      retain.row(target.forwarder);
      exports.push({ name: null, ordinal, ...target });
    }
  }
  return {
    ...result,
    export_directory: {
      rva: directory.address,
      size: directory.size,
      dll_name: dllName,
      ordinal_base: ordinalBase,
      timestamp: reader.u32(header + 4),
    },
    exports,
    coverage: coverage(issues, functionCount, exports.length),
    issues,
    limitations: PE_LIMITATIONS,
  };
};

const ELF_LIMITATIONS = [
  "Rows list defined default- or protected-visibility global, weak and unique dynamic symbols; local, hidden, internal and undefined symbols are not exports.",
  "A hidden symbol version is not the default version that a by-name dlsym lookup selects.",
  "Rows reproduce the dynamic symbol table; they do not establish that a symbol is reachable, safe to call or loaded at runtime.",
];

const ELF_TYPES: Readonly<Record<number, ElfExport["type"]>> = {
  1: "object",
  2: "function",
  6: "tls",
  10: "ifunc",
};
const ELF_BINDINGS: Readonly<Record<number, ElfExport["binding"]>> = {
  1: "global",
  2: "weak",
  10: "unique",
};

const versionSectionData = (
  reader: BinaryReader,
  sections: readonly NativeSection[],
  section: NativeSection,
  label: string,
): {
  table: { readonly offset: number; readonly size: number };
  names: Buffer;
} => {
  const strings = sections[section.link];
  if (strings?.type !== SHT_STRTAB)
    throw new BinaryFormatFailure(
      "malformed",
      `${label} do not link to a string table`,
    );
  const stringRange = reader.fileRange(
    strings.offset,
    strings.size,
    `${label} strings`,
  );
  const table = reader.fileRange(section.offset, section.size, label);
  return {
    table,
    names: reader.bytes.subarray(
      stringRange.offset,
      stringRange.offset + stringRange.size,
    ),
  };
};

/** Version names by index, read from `.gnu.version_d` and `.gnu.version_r`. */
type DecodedElfString = ReturnType<typeof decodeElfExportName>;

class ElfVersionWorkFailure extends BinaryResourceFailure {}

/** Charge both headers and auxiliary visits, including aliased record replays. */
const versionRecordStep = (size: number, width: number): (() => boolean) => {
  const allowance = Math.min(Math.floor(size / width), MAX_NATIVE_EXPORT_ROWS);
  let visited = 0;
  return () => {
    if (++visited > allowance)
      throw new ElfVersionWorkFailure(
        "structure",
        size,
        `ELF version traversal work allowance of ${String(allowance)} record visits was exhausted; remaining version names are unknown`,
      );
    return visited % 1024 === 0;
  };
};

/** One format owner decodes each selected string-table offset at most once. */
const createVersionNameReader = () => {
  const decodedNames = new Map<
    string,
    | { readonly value: DecodedElfString | null }
    | { readonly failure: BinaryFormatFailure }
  >();
  let cacheBytes = 0;
  const chargeCache = (bytes: number): void => {
    if (cacheBytes + bytes > MAXIMUM_RETAINED_TEXT_BYTES)
      throw new ElfVersionWorkFailure(
        "structure",
        MAXIMUM_RETAINED_TEXT_BYTES,
        "ELF version name decoding exceeds its 16 MiB cache allowance; remaining version names are unknown",
      );
    cacheBytes += bytes;
  };
  const readName = (names: Buffer, offset: number): DecodedElfString | null => {
    const key = `${String(names.byteOffset)}:${String(names.length)}:${String(offset)}`;
    const cached = decodedNames.get(key);
    if (cached !== undefined) {
      if ("failure" in cached) throw cached.failure;
      return cached.value;
    }
    let raw: Buffer;
    try {
      raw = readElfStringBytes(names, offset);
    } catch (cause) {
      if (!(cause instanceof BinaryFormatFailure)) throw cause;
      // Invalid offsets/unterminated aliases must not repeatedly scan strings
      // either. Account for the cached error and its stack conservatively.
      chargeCache(4096);
      decodedNames.set(key, { failure: cause });
      throw cause;
    }
    chargeCache(512 + raw.length * 6);
    const value = raw.length === 0 ? null : decodeElfExportName(raw);
    decodedNames.set(key, { value });
    return value;
  };
  return readName;
};

function* readVersionNames(
  reader: BinaryReader,
  sections: readonly NativeSection[],
  issues: NativeExportIssue[],
): Generator<void, Map<number, DecodedElfString | null>> {
  const namesByIndex = new Map<number, DecodedElfString | null>();
  const readName = createVersionNameReader();
  // This intermediate map owns its storage independently of repeated text in
  // output rows. Replacing an index releases its previous decoded name.
  let textBytes = 0;
  const addName = (index: number, decoded: DecodedElfString | null): void => {
    const previous = namesByIndex.get(index);
    // Replayed offsets reuse the exact parsed fact, including its accounted text.
    if (previous === decoded) return;
    const nextTextBytes =
      textBytes -
      retainedTextBytes(
        previous?.name ?? null,
        previous?.name_bytes_base64 ?? null,
      ) +
      retainedTextBytes(
        decoded?.name ?? null,
        decoded?.name_bytes_base64 ?? null,
      );
    checkRetainedText(nextTextBytes);
    namesByIndex.set(index, decoded);
    textBytes = nextTextBytes;
  };
  const verneed = sections.find(({ type }) => type === SHT_GNU_VERNEED);
  if (verneed !== undefined) {
    try {
      const { table, names } = versionSectionData(
        reader,
        sections,
        verneed,
        "Version requirements",
      );
      const visit = versionRecordStep(table.size, 16);
      let offset = 0;
      for (let record = 0; record < verneed.info; record++) {
        if (offset + 16 > table.size)
          throw new BinaryFormatFailure(
            "malformed",
            "Version requirement chain leaves its section",
          );
        if (visit()) yield;
        const at = table.offset + offset;
        const auxiliaryCount = reader.u16(at + 2);
        const auxiliaryOffset = reader.u32(at + 8);
        const next = reader.u32(at + 12);
        if (auxiliaryCount > 0 && auxiliaryOffset < 16)
          throw new BinaryFormatFailure(
            "malformed",
            "Version requirement auxiliary chain starts inside its header",
          );
        let auxiliary = offset + auxiliaryOffset;
        for (let item = 0; item < auxiliaryCount; item++) {
          if (auxiliary + 16 > table.size)
            throw new BinaryFormatFailure(
              "malformed",
              "Version requirement auxiliary chain leaves its section",
            );
          if (visit()) yield;
          const auxAt = table.offset + auxiliary;
          const versionIndex = reader.u16(auxAt + 6) & 0x7fff;
          const auxiliaryNext = reader.u32(auxAt + 12);
          try {
            addName(versionIndex, readName(names, reader.u32(auxAt + 8)));
          } catch (cause) {
            if (cause instanceof ElfVersionWorkFailure) throw cause;
            issues.push({
              code: "version_unresolved",
              location: hex(verneed.offset + BigInt(auxiliary)),
              message: `Version requirement name: ${failureMessage(cause)}`,
            });
          }
          if (item + 1 < auxiliaryCount) {
            if (auxiliaryNext < 16)
              throw new BinaryFormatFailure(
                "malformed",
                "Version requirement auxiliary chain ends before its declared count",
              );
            auxiliary += auxiliaryNext;
          }
        }
        if (record + 1 < verneed.info) {
          if (next < 16)
            throw new BinaryFormatFailure(
              "malformed",
              "Version requirement chain ends before its declared count",
            );
          offset += next;
        }
      }
    } catch (cause) {
      // Unvisited records may redefine an index seen in the prefix. Do not
      // promote an interrupted name lookup to a complete version identity.
      if (cause instanceof ElfVersionWorkFailure) namesByIndex.clear();
      issues.push({
        code: "version_unresolved",
        location: hex(verneed.offset),
        message: `Version requirements: ${cause instanceof ElfVersionWorkFailure ? cause.message : failureMessage(cause)}`,
      });
    }
  }
  // GNU lookup installs requirement names first, then definition names.
  const verdef = sections.find(({ type }) => type === SHT_GNU_VERDEF);
  if (verdef !== undefined) {
    try {
      const { table, names } = versionSectionData(
        reader,
        sections,
        verdef,
        "Version definitions",
      );
      const visit = versionRecordStep(table.size, 8);
      let offset = 0;
      for (let index = 0; index < verdef.info; index++) {
        if (offset + 20 > table.size)
          throw new BinaryFormatFailure(
            "malformed",
            "Version definition chain leaves its section",
          );
        if (visit()) yield;
        const at = table.offset + offset;
        const versionIndex = reader.u16(at + 4) & 0x7fff;
        const aux = reader.u32(at + 12);
        const next = reader.u32(at + 16);
        const auxiliaryCount = reader.u16(at + 6);
        if (auxiliaryCount === 0 || aux < 20 || offset + aux + 8 > table.size)
          throw new BinaryFormatFailure(
            "malformed",
            "Version definition name entry leaves its section",
          );
        let auxiliary = offset + aux;
        const versionName = readName(
          names,
          reader.u32(table.offset + auxiliary),
        );
        addName(versionIndex, versionName);
        for (let item = 0; item < auxiliaryCount; item++) {
          if (auxiliary + 8 > table.size)
            throw new BinaryFormatFailure(
              "malformed",
              "Version definition auxiliary chain leaves its section",
            );
          if (visit()) yield;
          if (item + 1 < auxiliaryCount) {
            const auxiliaryNext = reader.u32(table.offset + auxiliary + 4);
            if (auxiliaryNext < 8)
              throw new BinaryFormatFailure(
                "malformed",
                "Version definition auxiliary chain ends before its declared count",
              );
            auxiliary += auxiliaryNext;
          }
        }
        if (index + 1 < verdef.info) {
          if (next < 20)
            throw new BinaryFormatFailure(
              "malformed",
              "Version definition chain ends before its declared count",
            );
          offset += next;
        }
      }
    } catch (cause) {
      if (cause instanceof ElfVersionWorkFailure) namesByIndex.clear();
      issues.push({
        code: "version_unresolved",
        location: hex(verdef.offset),
        message: `Version definitions: ${cause instanceof ElfVersionWorkFailure ? cause.message : failureMessage(cause)}`,
      });
    }
  }

  return namesByIndex;
}

/** Read defined exported entries of `.dynsym` with their symbol versions. */
function* parseElfExports(
  bytes: Buffer,
  artifact: Artifact,
): Generator<void, NativeExports> {
  const directory = readElfDirectoryFromBuffer(bytes);
  const reader = new BinaryReader(bytes, directory.little);
  const result = {
    artifact,
    format: "elf" as const,
    architecture: architectureForElfMachine(directory.machine),
    bits: directory.bits,
    byte_order: directory.little ? ("little" as const) : ("big" as const),
  };
  const { sections } = directory;
  const dynsym = sections.find(({ type }) => type === SHT_DYNSYM);
  if (
    sections.length === 0 ||
    (dynsym === undefined && directory.programs.some(({ type }) => type === 2))
  )
    return {
      ...result,
      exports: [],
      coverage: {
        status: "unsupported",
        reason:
          sections.length === 0
            ? "The ELF has no section headers; enumerating dynamic symbols from the dynamic segment is not implemented"
            : "The ELF declares a dynamic segment but has no dynamic symbol section; enumerating dynamic symbols from the dynamic segment is not implemented",
        examined_entries: 0,
        exports: 0,
      },
      issues: [],
      limitations: ELF_LIMITATIONS,
    };
  if (dynsym === undefined)
    return {
      ...result,
      exports: [],
      coverage: coverage([], 0, 0),
      issues: [],
      limitations: [
        "The ELF has no dynamic symbol table, so it exports no dynamic symbols.",
        ...ELF_LIMITATIONS,
      ],
    };
  const width = directory.bits === 64 ? 24 : 16;
  const strings = sections[dynsym.link];
  if (
    dynsym.entry_size !== BigInt(width) ||
    dynsym.size % BigInt(width) !== 0n ||
    // The table must hold at least its mandatory null symbol.
    dynsym.size < BigInt(width) ||
    strings?.type !== SHT_STRTAB
  )
    throw new BinaryFormatFailure(
      "malformed",
      "ELF dynamic symbol table entry size, length, null entry or string-table link is invalid",
    );
  const count = Number(dynsym.size / BigInt(width));
  rowBudget(count, "ELF dynamic symbol table");
  const table = reader.table(
    dynsym.offset,
    count,
    width,
    "ELF dynamic symbols",
  );
  const nameRange = reader.fileRange(
    strings.offset,
    strings.size,
    "ELF dynamic strings",
  );
  const names = bytes.subarray(
    nameRange.offset,
    nameRange.offset + nameRange.size,
  );
  const issues: NativeExportIssue[] = [];
  const versym = sections.find(
    ({ type, link }) => type === SHT_GNU_VERSYM && link === dynsym.index,
  );
  let versions: number | null = null;
  if (versym !== undefined) {
    try {
      if (versym.size !== BigInt(count * 2))
        throw new BinaryFormatFailure(
          "malformed",
          `Symbol version table has ${String(versym.size)} bytes for ${String(count)} symbols`,
        );
      versions = reader.table(versym.offset, count, 2, "ELF symbol versions");
    } catch (cause) {
      // Keep every export; their versions become unknown.
      issues.push({
        code: "version_unresolved",
        location: hex(versym.offset),
        message: failureMessage(cause),
      });
    }
  }
  const versionNames = yield* readVersionNames(reader, sections, issues);
  const unresolvedVersions = new Set<number>();
  const retain = createRetention();
  const exports: ElfExport[] = [];
  for (let index = 1; index < count; index++) {
    if (index % 1024 === 0) yield;
    const at = table + index * width;
    const parsedSymbol = readElfSymbol(
      bytes.subarray(at, at + width),
      directory.bits,
      directory.little,
    );
    if (!parsedSymbol.ok)
      throw new BinaryFormatFailure(
        parsedSymbol.error.kind,
        parsedSymbol.error.message,
      );
    const symbol = parsedSymbol.value;
    const binding = ELF_BINDINGS[symbol.binding];
    const visibility = symbol.other & 3;
    // Undefined, local and hidden/internal symbols are not exports.
    if (
      binding === undefined ||
      symbol.section_index === 0 ||
      (visibility !== 0 && visibility !== 3)
    )
      continue;
    let version: ElfExport["version"] = null;
    if (versym !== undefined && versions === null) version = "unknown";
    else if (versions !== null) {
      const raw = reader.u16(versions + index * 2);
      const versionIndex = raw & 0x7fff;
      if (versionIndex === 0) continue;
      if (versionIndex >= 2) {
        const decodedName = versionNames.get(versionIndex) ?? null;
        if (decodedName === null && !unresolvedVersions.has(versionIndex)) {
          unresolvedVersions.add(versionIndex);
          issues.push({
            code: "version_unresolved",
            location: hex(symbol.value),
            message: `Version index ${String(versionIndex)}, first used by symbol ${String(index)}, has no unambiguous version name`,
          });
        }
        version = {
          index: versionIndex,
          name: decodedName?.name ?? null,
          name_bytes_base64: decodedName?.name_bytes_base64 ?? null,
          name_utf8_decodable: decodedName?.name_utf8_decodable ?? null,
          hidden: (raw & 0x8000) !== 0,
        };
      }
    }
    let name: string;
    let nameUtf8Decodable: boolean;
    let rawNameBase64: string | null;
    try {
      const rawName = readElfStringBytes(names, symbol.name_offset);
      const decodedName = decodeElfExportName(rawName);
      nameUtf8Decodable = decodedName.name_utf8_decodable;
      name = decodedName.name;
      rawNameBase64 = decodedName.name_bytes_base64;
    } catch (cause) {
      issues.push({
        code: "name_unreadable",
        location: hex(symbol.value),
        message: `Dynamic symbol ${String(index)}: ${failureMessage(cause)}`,
      });
      continue;
    }
    if (name === "") {
      issues.push({
        code: "name_unreadable",
        location: hex(symbol.value),
        message: `Defined global dynamic symbol ${String(index)} has an empty name`,
      });
      continue;
    }
    retain.row(
      name,
      typeof version === "object" ? (version?.name ?? null) : null,
      rawNameBase64,
      typeof version === "object" ? (version?.name_bytes_base64 ?? null) : null,
    );
    exports.push({
      name,
      name_bytes_base64: rawNameBase64,
      name_utf8_decodable: nameUtf8Decodable,
      value: hex(symbol.value),
      size: symbol.size.toString(),
      type: ELF_TYPES[symbol.type] ?? "other",
      binding,
      version,
    });
  }
  return {
    ...result,
    exports,
    coverage: coverage(issues, count - 1, exports.length),
    issues,
    limitations: ELF_LIMITATIONS,
  };
}

/** Shared bounded checkpoints; consumers may yield/cancel without another parser. */
export function* parseNativeExportsSteps(
  bytes: Buffer,
  artifact: Artifact,
): Generator<void, NativeExports> {
  yield;
  if (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])))
    return yield* parseElfExports(bytes, artifact);
  if (bytes.subarray(0, 2).equals(Buffer.from("MZ")))
    return parsePeExports(bytes, artifact);
  throw new BinaryFormatFailure(
    "unsupported",
    "Only PE and ELF images are supported; inspect Mach-O exports with inspect_macho",
  );
}

/** Synchronous callers use exactly the same parsed facts and resource bounds. */
export const parseNativeExports = (
  bytes: Buffer,
  artifact: Artifact,
): NativeExports => {
  const steps = parseNativeExportsSteps(bytes, artifact);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
};
