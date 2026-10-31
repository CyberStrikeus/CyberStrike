import { readElfSectionHeader } from "./elfSectionHeader.js";
import { readElfProgramHeader } from "./elfProgramHeader.js";
import { readElfRawTableDeclarations } from "./elfRawTableDeclarations.js";
import { readElfFixedHeader, type ElfFixedHeader } from "./elfFixedHeader.js";
import { err, ok, type Result } from "./result.js";

/** Positional source requests; the caller owns the descriptor and cancellation. */
export interface ElfDeclarationRead {
  readonly offset: number;
  readonly size: number;
}

interface ElfDeclaredTable {
  readonly offset: bigint;
  readonly count: number;
  readonly width: number;
}

export interface ElfTableDeclarations {
  readonly header: ElfFixedHeader;
  readonly programs: ElfDeclaredTable;
  readonly sections: ElfDeclaredTable & { readonly namesIndex: number };
}

/** Zero-sized/inactive declarations own no file bytes. Arithmetic stays exact. */
const rangeFailure = (
  label: string,
  offset: bigint,
  size: bigint,
  fileSize: number,
): string | undefined =>
  size !== 0n && (offset > BigInt(fileSize) || size > BigInt(fileSize) - offset)
    ? `truncated ELF ${label}: declared file range ${String(offset)}..${String(offset + size)} exceeds the ${String(fileSize)}-byte file`
    : undefined;

interface RawTableDeclaration {
  readonly offset: bigint;
  readonly count: bigint;
  readonly width: number;
}

const tableFailure = (
  kind: "program" | "section",
  table: RawTableDeclaration,
  header: ElfFixedHeader,
  fileSize: number,
): string | undefined => {
  if (table.count === 0n) return undefined;
  const wide = header.elfClass === 64;
  const minimumWidth = kind === "program" ? (wide ? 56 : 32) : wide ? 64 : 40;
  const label = `${kind} header table`;
  if (table.width < minimumWidth) return `invalid ELF ${label} entry width`;
  if (table.offset < BigInt(wide ? 64 : 52))
    return `ELF ${label} overlaps the fixed header`;
  return rangeFailure(
    label,
    table.offset,
    table.count * BigInt(table.width),
    fileSize,
  );
};

interface TableCounts {
  programCount: bigint;
  sectionCount: bigint;
  namesIndex: number;
}

const extendedCounts = (
  first: Buffer,
  header: ElfFixedHeader,
  initial: TableCounts,
): Result<TableCounts, string> => {
  const wide = header.elfClass === 64;
  if (first.length !== (wide ? 64 : 40))
    return err("truncated ELF extended section-zero header");
  const parsed = readElfSectionHeader(
    first,
    header.elfClass,
    header.byteOrder === "little",
  );
  if (!parsed.ok) return err(parsed.error.message);
  const zero = parsed.value;
  if (zero.type !== 0)
    return err(
      "ELF extended numbering requires an inactive SHT_NULL section zero",
    );
  const counts = { ...initial };
  if (counts.sectionCount === 0n) {
    counts.sectionCount = zero.size;
    if (counts.sectionCount < 0xff00n)
      return err("invalid ELF extended section count");
  }
  if (counts.namesIndex === 0xffff) {
    counts.namesIndex = zero.link;
    if (counts.namesIndex < 0xff00)
      return err("invalid ELF extended section-name index");
  }
  if (counts.programCount === 0xffffn) {
    counts.programCount = BigInt(zero.info);
    if (counts.programCount < 0xffffn)
      return err("invalid ELF extended program count");
  }
  return ok(counts);
};

/** A name index or extended count cannot refer to an absent section table. */
export const validateElfSectionTablePresence = (tables: {
  readonly programs: { readonly count: number };
  readonly sections: {
    readonly offset: bigint;
    readonly count: number;
    readonly namesIndex: number;
  };
}): Result<null, string> =>
  tables.sections.offset === 0n &&
  (tables.sections.count !== 0 ||
    tables.sections.namesIndex !== 0 ||
    tables.programs.count === 0xffff)
    ? err("ELF section table is missing")
    : ok(null);

/** Canonical table declarations, including extended counts in inactive section zero. */
export function* readElfTableDeclarations(
  bytes: Buffer,
  fileSize: number,
): Generator<ElfDeclarationRead, Result<ElfTableDeclarations, string>, Buffer> {
  const fixed = readElfFixedHeader(bytes, fileSize);
  if (!fixed.ok) return fixed;
  const header = fixed.value;
  const raw = readElfRawTableDeclarations(bytes, header);
  if (!raw.ok) return err(raw.error.message);
  const { programs, sections } = raw.value;
  const programOffset = programs.offset;
  const sectionOffset = sections.offset;
  const programWidth = programs.width;
  const sectionWidth = sections.width;
  let programCount = BigInt(programs.count);
  let sectionCount = BigInt(sections.count);
  let namesIndex = sections.namesIndex;
  const presence = validateElfSectionTablePresence(raw.value);
  if (!presence.ok) return presence;
  if (
    sectionOffset !== 0n &&
    (sectionCount === 0n || namesIndex === 0xffff || programCount === 0xffffn)
  ) {
    const failure = tableFailure(
      "section",
      { offset: sectionOffset, count: 1n, width: sectionWidth },
      header,
      fileSize,
    );
    if (failure !== undefined) return err(failure);
    const first = yield {
      offset: Number(sectionOffset),
      size: header.elfClass === 64 ? 64 : 40,
    };
    const counts = extendedCounts(first, header, {
      programCount,
      sectionCount,
      namesIndex,
    });
    if (!counts.ok) return counts;
    ({ programCount, sectionCount, namesIndex } = counts.value);
  }
  for (const [kind, offset, count, width] of [
    ["program", programOffset, programCount, programWidth],
    ["section", sectionOffset, sectionCount, sectionWidth],
  ] as const) {
    const failure = tableFailure(
      kind,
      { offset, count, width },
      header,
      fileSize,
    );
    if (failure !== undefined) return err(failure);
  }
  if (sectionCount !== 0n && BigInt(namesIndex) >= sectionCount)
    return err(
      "ELF section-name index lies outside the declared section table",
    );
  // A validated table fits the host-sized file, so its record count is exact.
  return ok({
    header,
    programs: {
      offset: programOffset,
      count: Number(programCount),
      width: programWidth,
    },
    sections: {
      offset: sectionOffset,
      count: Number(sectionCount),
      width: sectionWidth,
      namesIndex,
    },
  });
}

/** Examine only header records; referenced payloads are range-checked, never copied. */
function* inspectTableRanges(
  kind: "program" | "section",
  table: ElfDeclaredTable,
  header: ElfFixedHeader,
  fileSize: number,
): Generator<ElfDeclarationRead, Result<null, string>, Buffer> {
  const perRead = Math.max(1, Math.floor((64 * 1024) / table.width));
  for (let index = 0; index < table.count; index += perRead) {
    const count = Math.min(perRead, table.count - index);
    const size = count * table.width;
    const bytes = yield {
      offset: Number(table.offset) + index * table.width,
      size,
    };
    if (bytes.length !== size) return err(`truncated ELF ${kind} header table`);
    for (let item = 0; item < count; item++) {
      const at = item * table.width;
      const parsed =
        kind === "program"
          ? readElfProgramHeader(
              bytes.subarray(at, at + table.width),
              header.elfClass,
              header.byteOrder === "little",
            )
          : readElfSectionHeader(
              bytes.subarray(at, at + table.width),
              header.elfClass,
              header.byteOrder === "little",
            );
      if (!parsed.ok) return err(parsed.error.message);
      const facts = parsed.value;
      if (facts.type === 0 || (kind === "section" && facts.type === 8))
        continue;
      const offset = facts.offset;
      const length = "fileSize" in facts ? facts.fileSize : facts.size;
      const failure = rangeFailure(
        `${kind} ${String(index + item)}`,
        offset,
        length,
        fileSize,
      );
      if (failure !== undefined) return err(failure);
    }
  }
  return ok(null);
}

/** Physical extent admission, independent of section names, CPU lanes and decoder budgets. */
export function* validateElfDeclaredRanges(
  prefix: Buffer,
  fileSize: number,
): Generator<ElfDeclarationRead, Result<null, string>, Buffer> {
  const declarations = yield* readElfTableDeclarations(prefix, fileSize);
  if (!declarations.ok) return declarations;
  const { header, programs, sections } = declarations.value;
  for (const [kind, table] of [
    ["program", programs],
    ["section", sections],
  ] as const) {
    if (table.count === 0) continue;
    const inspected = yield* inspectTableRanges(kind, table, header, fileSize);
    if (!inspected.ok) return inspected;
  }
  return ok(null);
}
