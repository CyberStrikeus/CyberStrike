import { readElfRelocationEntry } from "../domain/elfRelocation.js";
import { readElfDynamicEntry } from "../domain/elfDynamicEntry.js";
import type { ElfProgramHeader } from "../domain/elfProgramHeader.js";
import type { MipsElfMetadata } from "../domain/binaryTargetTypes.js";
import { err, ok, type Result } from "../domain/result.js";

type ReadRange = (
  offset: number,
  length: number,
  label: string,
) => Promise<Result<Buffer, string>>;

export interface MipsElfRelocationSection {
  readonly type: number;
  readonly offset: number;
  readonly size: number;
  readonly entrySize: number;
}
type SharedLoadFacts = Extract<
  NonNullable<MipsElfMetadata["sharedLoad"]>,
  { status: "complete" }
>;

/** Source ELF facts only; the provider owns interpretation and admission. */
export const readMipsElfSharedLoad = async (
  programHeaders: readonly ElfProgramHeader[],
  little: boolean,
  fileSize: number,
  read: ReadRange,
  checkCancelled: () => void,
  sections: readonly MipsElfRelocationSection[],
): Promise<Result<SharedLoadFacts, string>> => {
  const loads: {
    offset: number;
    address: number;
    size: number;
    memorySize: number;
  }[] = [];
  let dynamic: { offset: number; address: number; size: number } | undefined;
  for (const program of programHeaders) {
    checkCancelled();
    const { type } = program;
    const offset = Number(program.offset);
    const size = Number(program.fileSize);
    if (type === 1) {
      const address = Number(program.virtualAddress);
      const memorySize = Number(program.memorySize);
      if (
        offset > fileSize - size ||
        size > memorySize ||
        address + memorySize > 0x100000000
      )
        return err("invalid or incomplete MIPS PT_LOAD range");
      loads.push({ offset, address, size, memorySize });
    }
    if (type === 2) {
      if (dynamic !== undefined) return err("duplicate MIPS PT_DYNAMIC tables");
      dynamic = { offset, address: Number(program.virtualAddress), size };
    }
  }
  if (dynamic === undefined)
    return err("MIPS shared image has no PT_DYNAMIC table");
  if (dynamic.size === 0 || dynamic.size % 8 !== 0)
    return err("invalid MIPS ELF32 dynamic table size");
  if (dynamic.offset > fileSize - dynamic.size)
    return err("MIPS PT_DYNAMIC range extends beyond the file");
  const ranges = loads
    .filter((load) => load.memorySize > 0)
    .sort((left, right) => left.address - right.address);
  for (let i = 1; i < ranges.length; i += 1) {
    checkCancelled();
    const previous = ranges[i - 1]!;
    if (ranges[i]!.address < previous.address + previous.memorySize)
      return err(
        "overlapping MIPS PT_LOAD memory ranges require separate mapping verification",
      );
  }
  // One normalized index prevents relocation count * program-header count work.
  const mapped = (address: number, length: number, fileBacked: boolean) => {
    let low = 0;
    let high = ranges.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (ranges[middle]!.address <= address) low = middle + 1;
      else high = middle;
    }
    const range = ranges[low - 1];
    return range !== undefined &&
      address - range.address <=
        (fileBacked ? range.size : range.memorySize) - length
      ? range
      : undefined;
  };
  const dynamicMapping = mapped(dynamic.address, dynamic.size, true);
  if (
    dynamicMapping === undefined ||
    dynamicMapping.offset + dynamic.address - dynamicMapping.address !==
      dynamic.offset
  )
    return err(
      "MIPS PT_DYNAMIC has no unique matching file-backed PT_LOAD range",
    );

  // Bound temporary storage, not admitted artifact size. ELF32 records are
  // exact eight-byte structures; every declared record is examined or refused.
  const chunkBytes = 64 * 1024;
  const relevant = new Set([2, 7, 8, 9, 17, 18, 19, 20, 23, 35, 36, 37]);
  const tags = new Map<number, number>();
  let terminated = false;
  for (
    let offset = 0;
    offset < dynamic.size && !terminated;
    offset += chunkBytes
  ) {
    const chunk = await read(
      dynamic.offset + offset,
      Math.min(chunkBytes, dynamic.size - offset),
      "dynamic table",
    );
    if (!chunk.ok) return chunk;
    for (let position = 0; position < chunk.value.length; position += 8) {
      checkCancelled();
      const parsedEntry = readElfDynamicEntry(
        chunk.value.subarray(position, position + 8),
        32,
        little,
      );
      if (!parsedEntry.ok) return err(parsedEntry.error.message);
      const tag = Number(BigInt.asUintN(32, parsedEntry.value.tag));
      if (tag === 0) {
        terminated = true;
        break;
      }
      if (!relevant.has(tag)) continue;
      if (tags.has(tag)) return err(`duplicate MIPS dynamic tag ${tag}`);
      tags.set(tag, Number(parsedEntry.value.value));
    }
  }
  if (!terminated) return err("MIPS dynamic table has no DT_NULL terminator");
  if ([35, 36, 37].some((tag) => tags.has(tag)))
    return err(
      "MIPS shared RELR relocation declarations require separate verification",
    );
  if ([2, 7, 8, 9, 23].some((tag) => (tags.get(tag) ?? 0) !== 0))
    return err(
      "MIPS shared RELA or PLT relocation declarations require separate verification",
    );
  const address = tags.get(17);
  const size = tags.get(18);
  const stride = tags.get(19);
  const checkSections = (
    offset: number,
    length: number,
  ): string | undefined => {
    let observed = 0;
    for (const section of sections) {
      checkCancelled();
      if (section.size === 0) continue;
      if (
        section.type !== 9 ||
        section.entrySize !== 8 ||
        section.offset !== offset ||
        section.size !== length
      )
        return "MIPS section relocation declarations outside the dynamic REL table require separate verification";
      observed += 1;
    }
    return observed > 1
      ? "duplicate MIPS section relocation declarations require separate verification"
      : undefined;
  };
  const emptyRelocations = (): Result<SharedLoadFacts, string> => {
    const reason = checkSections(0, 0);
    return reason === undefined
      ? ok({
          status: "complete",
          relocationCount: 0,
          relocationTypes: [],
          symbolRelativeCount: 0,
        })
      : err(reason);
  };
  if (address === undefined && size === undefined && stride === undefined)
    return emptyRelocations();
  if (
    address === undefined ||
    size === undefined ||
    stride !== 8 ||
    size % 8 !== 0
  )
    return err(
      "incomplete or invalid MIPS DT_REL/DT_RELSZ/DT_RELENT declaration",
    );
  if (size === 0) return emptyRelocations();
  const mapping = mapped(address, size, true);
  if (mapping === undefined)
    return err(
      "MIPS DT_REL range has no unique complete file-backed PT_LOAD mapping",
    );
  const fileOffset = mapping.offset + address - mapping.address;
  const sectionReason = checkSections(fileOffset, size);
  if (sectionReason !== undefined) return err(sectionReason);
  let symbolRelativeCount = 0;
  const types = new Set<number>();
  for (let offset = 0; offset < size; offset += chunkBytes) {
    const chunk = await read(
      fileOffset + offset,
      Math.min(chunkBytes, size - offset),
      "dynamic REL records",
    );
    if (!chunk.ok) return chunk;
    for (let position = 0; position < chunk.value.length; position += 8) {
      checkCancelled();
      const parsedEntry = readElfRelocationEntry(
        chunk.value.subarray(position, position + 8),
        32,
        little,
        "rel",
      );
      if (!parsedEntry.ok) return err(parsedEntry.error.message);
      const { type, symbolIndex, offset: rawAddress } = parsedEntry.value;
      const relocationAddress = Number(rawAddress);
      if (type === 3 && mapped(relocationAddress, 4, false) === undefined)
        return err(
          "MIPS REL32 destination has no unique complete PT_LOAD memory range",
        );
      types.add(type);
      if (type === 3 && symbolIndex !== 0) symbolRelativeCount += 1;
    }
  }
  return ok({
    status: "complete",
    relocationCount: size / 8,
    relocationTypes: [...types].sort((left, right) => left - right),
    symbolRelativeCount,
  });
};
