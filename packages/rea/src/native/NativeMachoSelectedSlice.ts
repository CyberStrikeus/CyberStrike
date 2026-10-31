import { machoCpuSubtypeBase } from "../domain/apple/machoCpuIdentity.js";
import {
  readFatHeaderPrefix,
  readFatSliceDeclarations,
  validateFatSlice,
  type FatSliceDeclaration,
} from "../domain/apple/machoContainer.js";
import {
  MachoBinaryFormatError,
  MachoCommandNamesLimitError,
  type MachoCommandNames,
} from "./MachoCommandNames.js";
import type { NativeMachoSource } from "./NativeMachoSource.js";
import type { LipoArchitecture } from "./parsers/lipo.js";

export interface ResolvedMachoSlice {
  readonly offset: number;
  readonly size: number;
  readonly declaration: FatSliceDeclaration;
  readonly tableEnd: number;
}

/** Resolve a unique FAT declaration without replacing observed lipo facts. */
export const resolveSelectedMachoSlice = async (
  source: NativeMachoSource,
  selected: LipoArchitecture,
  maximumRecords: number,
): Promise<ResolvedMachoSlice> => {
  if (
    selected.cpu_type_code === null &&
    (selected.file_offset === null || selected.size === null)
  )
    throw new MachoBinaryFormatError(
      "Selected Mach-O slice CPU identity is unavailable",
    );
  const prefix = readFatHeaderPrefix(
    await source.readSlice(0, source.bytes, 0, Math.min(8, source.bytes)),
  );
  if (prefix.state !== "parsed")
    throw new MachoBinaryFormatError(
      "Selected Mach-O universal header is unavailable",
    );
  const rows = prefix.count + (selected.hidden ? 1 : 0);
  if (rows > maximumRecords)
    throw new MachoCommandNamesLimitError(maximumRecords, "records");
  const entrySize = prefix.wide ? 32 : 20;
  const tableEnd = 8 + rows * entrySize;
  if (!Number.isSafeInteger(tableEnd) || tableEnd > source.bytes)
    throw new MachoBinaryFormatError(
      "Selected Mach-O universal table is truncated",
    );
  const matches: FatSliceDeclaration[] = [];
  const declarations: FatSliceDeclaration[] = [];
  for (let first = 0; first < rows; first += 256) {
    const count = Math.min(256, rows - first);
    const raw = await source.readSlice(
      0,
      source.bytes,
      8 + first * entrySize,
      count * entrySize,
    );
    const parsed = readFatSliceDeclarations(raw, {
      count,
      wide: prefix.wide,
      littleEndian: prefix.littleEndian,
    });
    if (parsed.status !== "parsed")
      throw new MachoBinaryFormatError(parsed.reason);
    for (const row of parsed.slices) {
      declarations.push(row);
      if (
        (selected.file_offset !== null &&
          row.offset !== selected.file_offset) ||
        (selected.size !== null && row.size !== selected.size) ||
        (selected.cpu_type_code !== null &&
          selected.cpu_type_code !== row.cpuType) ||
        (selected.cpu_subtype_code !== null &&
          selected.cpu_subtype_code !== row.cpuSubtype) ||
        (selected.cpu_subtype_base !== null &&
          selected.cpu_subtype_base !== machoCpuSubtypeBase(row.cpuSubtype)) ||
        (selected.alignment !== null &&
          selected.alignment !== 2 ** row.alignmentExponent)
      )
        continue;
      matches.push(row);
    }
  }
  if (matches.length !== 1)
    throw new MachoBinaryFormatError(
      "Selected lipo slice does not identify exactly one FAT entry",
    );
  const declaration = matches[0]!;
  if (
    declarations.some(
      (row) =>
        row !== declaration &&
        row.offset < declaration.offset + declaration.size &&
        declaration.offset < row.offset + row.size,
    )
  )
    throw new MachoBinaryFormatError(
      "Selected Mach-O slice overlaps another FAT entry",
    );
  return {
    offset: declaration.offset,
    size: declaration.size,
    declaration,
    tableEnd,
  };
};

/** Bind the selected FAT declaration to the admitted thin header. */
export const assertSelectedMachoSlice = (
  source: NativeMachoSource,
  selected: ResolvedMachoSlice,
  binary: MachoCommandNames,
): void => {
  const failure = validateFatSlice(
    selected.declaration,
    source.bytes,
    selected.tableEnd,
    binary.header,
  );
  if (failure !== null) throw new MachoBinaryFormatError(failure);
};
