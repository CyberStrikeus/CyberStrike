import type { Uf2Metadata } from "../artifactFormatMetadata.js";
import { err, ok, type Result } from "../result.js";
import { mergeArenaRuns, type RunConflict } from "./addressRuns.js";
import type { RegionDecodeFailure, RegionDecoder } from "./regionDecoder.js";
import { UF2_FAMILY_REGISTRY, uf2FamilyName } from "./uf2Families.js";

/** Every UF2 block is 512 bytes: a 32-byte header, 476 data bytes, an end magic. */
export const UF2_BLOCK_BYTES = 512;
const UF2_DATA_OFFSET = 32;
const UF2_DATA_BYTES = 476;
const UF2_MAGIC_START0 = 0x0a32_4655;
const UF2_MAGIC_START1 = 0x9e5d_5157;
const UF2_MAGIC_END = 0x0ab1_6f30;
const UF2_FLAG_NOT_MAIN_FLASH = 0x0000_0001;
const UF2_FLAG_FILE_CONTAINER = 0x0000_1000;
const UF2_FLAG_FAMILY_ID = 0x0000_2000;
const UF2_FLAG_MD5 = 0x0000_4000;
const UF2_FLAG_EXTENSION_TAGS = 0x0000_8000;
const ADDRESS_SPACE = 0x1_0000_0000;
/** Numbering groups named in one limitation before the rest are counted. */
const NAMED_GROUPS = 4;

/**
 * Fixed whole-file ceiling, as for Intel HEX; configurable ceilings are
 * tracked in #6176. Decoded bytes stay below 476/512 of it.
 */
export const UF2_MAX_FILE_BYTES = 128 * 1024 * 1024;
/** Regions retained as inventory entries, as for Intel HEX record runs. */
export const UF2_MAX_REGIONS = 65_536;

/** Decoded bytes for one family's address-contiguous range; `end` is inclusive. */
export interface Uf2Region {
  /** The declared familyID, or null when the block did not set flag 0x2000. */
  readonly familyId: number | null;
  /** The registry short name REA knows for `familyId`, or null. */
  readonly familyName: string | null;
  readonly start: number;
  readonly end: number;
  readonly bytes: Uint8Array;
  readonly blockCount: number;
  /** Zero-based positions of the contributing blocks in the file. */
  readonly firstFileBlock: number;
  readonly lastFileBlock: number;
}

export interface Uf2Image {
  readonly metadata: Uf2Metadata;
  /** Ordered by family, with undeclared families first, then by address. */
  readonly regions: readonly Uf2Region[];
  readonly complete: boolean;
  readonly limitations: readonly string[];
}

/** Consecutive main-flash blocks of one family whose addresses continue each other. */
interface BlockRun {
  readonly familyId: number | null;
  readonly address: number;
  readonly offset: number;
  length: number;
  blockCount: number;
  readonly firstFileBlock: number;
  lastFileBlock: number;
}

/**
 * Valid blocks sharing a familyID (or none) and a declared block count. A
 * number seen at several addresses belongs to several copies, as when esptool
 * numbers each merged file from 0; a repeat at one address is the same block.
 */
interface NumberingGroup {
  readonly familyId: number | null;
  readonly declared: number;
  /** The first target address seen for each block number. */
  readonly first: Map<number, number>;
  /** Further distinct target addresses, only for numbers that have them. */
  readonly further: Map<number, Set<number>>;
  previous: number;
}

/** What block numbering establishes about completeness. */
interface NumberingFacts {
  readonly missing: number;
  readonly absent: readonly string[];
  readonly ambiguous: readonly string[];
}

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)) >>>
  0;

const hex32 = (value: number): string =>
  `0x${value.toString(16).padStart(8, "0")}`;

const familyText = (familyId: number | null): string => {
  if (familyId === null) return "no familyID";
  const name = uf2FamilyName(familyId);
  return name === null
    ? `family ${hex32(familyId)}`
    : `family ${hex32(familyId)} (${name})`;
};

/** At most NAMED_GROUPS descriptions, then a count of the rest. */
const named = (items: readonly string[]): string =>
  `${items.slice(0, NAMED_GROUPS).join("; ")}${items.length > NAMED_GROUPS ? `; and ${String(items.length - NAMED_GROUPS)} more` : ""}`;

/** Recognize a file only by a complete first block with all three magic numbers. */
export const hasUf2Block = (prefix: Uint8Array): boolean =>
  prefix.length >= UF2_BLOCK_BYTES &&
  readUint32(prefix, 0) === UF2_MAGIC_START0 &&
  readUint32(prefix, 4) === UF2_MAGIC_START1 &&
  readUint32(prefix, UF2_BLOCK_BYTES - 4) === UF2_MAGIC_END;

/** Start a block decoder whose arena is bounded by the admitted file size. */
export const createUf2Decoder = (
  fileBytes: number,
): Result<RegionDecoder<Uf2Image>, RegionDecodeFailure> =>
  Number.isSafeInteger(fileBytes) &&
  fileBytes >= 0 &&
  fileBytes <= UF2_MAX_FILE_BYTES
    ? ok(new StreamingUf2Decoder(fileBytes))
    : err({
        kind: "limit",
        boundary: "file-size",
        message: `file is ${String(fileBytes)} bytes, exceeding the fixed ${String(UF2_MAX_FILE_BYTES)}-byte (128 MiB) ceiling`,
      });

/** Absent numbers, and groups whose numbers appear at unequal address counts. */
const numberingFacts = (groups: Iterable<NumberingGroup>): NumberingFacts => {
  let missing = 0;
  const absent: string[] = [];
  const ambiguous: string[] = [];
  for (const group of groups) {
    const seen = group.first.size;
    const name = `${familyText(group.familyId)} with ${String(group.declared)} numbered blocks`;
    if (seen < group.declared) {
      missing += group.declared - seen;
      absent.push(`${name} has ${String(seen)} of them`);
    }
    // Every seen number holds one address unless another copy was seen.
    let most = 1;
    let fewest = group.further.size < seen ? 1 : Number.MAX_SAFE_INTEGER;
    for (const further of group.further.values()) {
      most = Math.max(most, further.size + 1);
      fewest = Math.min(fewest, further.size + 1);
    }
    if (most !== fewest)
      ambiguous.push(
        `${name} has some numbers at ${String(fewest)} address(es) and others at ${String(most)}`,
      );
  }
  return { missing, absent, ambiguous };
};

class StreamingUf2Decoder implements RegionDecoder<Uf2Image> {
  readonly #block = new Uint8Array(UF2_BLOCK_BYTES);
  readonly #runs: BlockRun[] = [];
  readonly #groups = new Map<string, NumberingGroup>();
  readonly #families = new Set<number>();
  #arena: Uint8Array;
  #arenaUsed = 0;
  #blockLength = 0;
  #blockCount = 0;
  #invalid = 0;
  #firstInvalid:
    | { readonly block: number; readonly reason: string }
    | undefined;
  #flash = 0;
  #notMainFlash = 0;
  #notMainFlashBytes = 0;
  #fileContainer = 0;
  #md5 = 0;
  #extensionTags = 0;
  #repeated = 0;
  #outOfOrder = 0;
  #outOfRange = 0;

  constructor(fileBytes: number) {
    this.#arena = new Uint8Array(
      Math.floor(fileBytes / UF2_BLOCK_BYTES) * UF2_DATA_BYTES,
    );
  }

  write(chunk: Uint8Array): Result<void, RegionDecodeFailure> {
    let from = 0;
    while (from < chunk.length) {
      const count = Math.min(
        UF2_BLOCK_BYTES - this.#blockLength,
        chunk.length - from,
      );
      this.#block.set(chunk.subarray(from, from + count), this.#blockLength);
      this.#blockLength += count;
      from += count;
      if (this.#blockLength < UF2_BLOCK_BYTES) break;
      this.#blockLength = 0;
      const decoded = this.#decodeBlock(this.#block);
      if (!decoded.ok) return decoded;
    }
    return ok(undefined);
  }

  finish(): Result<Uf2Image, RegionDecodeFailure> {
    const merged = mergeRuns(this.#runs, this.#arena);
    this.#arena = new Uint8Array(0);
    if (!merged.ok) return merged;
    const { regions, duplicateBytes } = merged.value;
    if (regions.length > UF2_MAX_REGIONS)
      return err({
        kind: "limit",
        boundary: "capacity",
        message: `payloads form ${String(regions.length)} address-discontiguous regions, more than the ${String(UF2_MAX_REGIONS)} retained as entries`,
      });
    const numbering = numberingFacts(this.#groups.values());
    const limitations = this.#limitations(numbering);
    return ok({
      metadata: this.#metadata(regions, duplicateBytes, numbering),
      regions,
      complete: limitations.unknown.length === 0,
      limitations: [...limitations.unknown, ...limitations.known],
    });
  }

  #decodeBlock(block: Uint8Array): Result<void, RegionDecodeFailure> {
    const index = this.#blockCount;
    this.#blockCount += 1;
    const flags = readUint32(block, 8);
    const address = readUint32(block, 12);
    const size = readUint32(block, 16);
    const fault =
      readUint32(block, 0) !== UF2_MAGIC_START0 ||
      readUint32(block, 4) !== UF2_MAGIC_START1
        ? "start magic numbers do not match"
        : readUint32(block, UF2_BLOCK_BYTES - 4) !== UF2_MAGIC_END
          ? "end magic number does not match"
          : size > UF2_DATA_BYTES
            ? `payload size ${String(size)} exceeds the ${String(UF2_DATA_BYTES)}-byte data area`
            : address + size > ADDRESS_SPACE
              ? `payload at ${hex32(address)} with ${String(size)} bytes wraps past 0xffffffff`
              : undefined;
    if (fault !== undefined) {
      this.#invalid += 1;
      this.#firstInvalid ??= { block: index, reason: fault };
      return ok(undefined);
    }
    const familyId =
      (flags & UF2_FLAG_FAMILY_ID) !== 0 ? readUint32(block, 28) : null;
    if ((flags & UF2_FLAG_MD5) !== 0) this.#md5 += 1;
    if ((flags & UF2_FLAG_EXTENSION_TAGS) !== 0) this.#extensionTags += 1;
    this.#number(
      familyId,
      readUint32(block, 24),
      readUint32(block, 20),
      address,
    );
    // The file-container flag overrides not-main-flash: such blocks hold files.
    if ((flags & UF2_FLAG_FILE_CONTAINER) !== 0) {
      this.#fileContainer += 1;
      return ok(undefined);
    }
    if ((flags & UF2_FLAG_NOT_MAIN_FLASH) !== 0) {
      this.#notMainFlash += 1;
      this.#notMainFlashBytes += size;
      return ok(undefined);
    }
    this.#flash += 1;
    if (familyId !== null) this.#families.add(familyId);
    return this.#addData(
      index,
      familyId,
      address,
      block.subarray(UF2_DATA_OFFSET, UF2_DATA_OFFSET + size),
    );
  }

  /** Numbering is per familyID and block count, as bootloaders ignore other families. */
  #number(
    familyId: number | null,
    declared: number,
    blockNo: number,
    address: number,
  ): void {
    if (declared === 0 || blockNo >= declared) {
      this.#outOfRange += 1;
      return;
    }
    const key = `${familyId === null ? "none" : String(familyId)}:${String(declared)}`;
    let group = this.#groups.get(key);
    if (group === undefined) {
      group = {
        familyId,
        declared,
        first: new Map(),
        further: new Map(),
        previous: -1,
      };
      this.#groups.set(key, group);
    }
    const first = group.first.get(blockNo);
    if (first === undefined) group.first.set(blockNo, address);
    else {
      this.#repeated += 1;
      if (first !== address) {
        let further = group.further.get(blockNo);
        if (further === undefined) {
          further = new Set();
          group.further.set(blockNo, further);
        }
        further.add(address);
      }
    }
    if (blockNo <= group.previous) this.#outOfOrder += 1;
    group.previous = blockNo;
  }

  #addData(
    block: number,
    familyId: number | null,
    address: number,
    data: Uint8Array,
  ): Result<void, RegionDecodeFailure> {
    if (data.length === 0) return ok(undefined);
    if (this.#arenaUsed + data.length > this.#arena.length)
      return err({
        kind: "limit",
        boundary: "file-size",
        message: `block ${String(block)}: payload bytes exceed ${String(UF2_DATA_BYTES)} per complete block of the admitted file size`,
      });
    const run = this.#runs.at(-1);
    if (
      run !== undefined &&
      run.familyId === familyId &&
      run.address + run.length === address
    ) {
      run.length += data.length;
      run.blockCount += 1;
      run.lastFileBlock = block;
    } else
      this.#runs.push({
        familyId,
        address,
        offset: this.#arenaUsed,
        length: data.length,
        blockCount: 1,
        firstFileBlock: block,
        lastFileBlock: block,
      });
    this.#arena.set(data, this.#arenaUsed);
    this.#arenaUsed += data.length;
    return ok(undefined);
  }

  /** Limitations that leave coverage unknown, then facts that do not. */
  #limitations(numbering: NumberingFacts): {
    readonly unknown: string[];
    readonly known: string[];
  } {
    const unknown: string[] = [];
    const known: string[] = [];
    if (this.#blockLength > 0)
      unknown.push(
        `UF2 file ends with ${String(this.#blockLength)} bytes after its last complete 512-byte block; the file may be truncated.`,
      );
    if (this.#firstInvalid !== undefined)
      unknown.push(
        `${String(this.#invalid)} UF2 block(s) are invalid and were excluded; the first is block ${String(this.#firstInvalid.block)} at byte offset ${String(this.#firstInvalid.block * UF2_BLOCK_BYTES)}: ${this.#firstInvalid.reason}.`,
      );
    if (numbering.missing > 0)
      unknown.push(
        `UF2 numbering declares ${String(numbering.missing)} block(s) that are absent: ${named(numbering.absent)}.`,
      );
    if (numbering.ambiguous.length > 0)
      unknown.push(
        `UF2 numbering cannot show that every copy of a block sequence is complete: ${named(numbering.ambiguous)}.`,
      );
    if (this.#outOfRange > 0)
      unknown.push(
        `${String(this.#outOfRange)} UF2 block(s) have a block number at or above their block count, so their numbering cannot establish completeness.`,
      );
    if (this.#fileContainer > 0)
      unknown.push(
        `${String(this.#fileContainer)} UF2 block(s) belong to file containers (flag 0x1000); their files were not reconstructed.`,
      );
    if (this.#notMainFlash > 0)
      known.push(
        `${String(this.#notMainFlash)} UF2 block(s) are flagged not main flash (flag 0x1); their ${String(this.#notMainFlashBytes)} payload bytes are in no region.`,
      );
    if (this.#md5 > 0 || this.#extensionTags > 0)
      known.push(
        `${String(this.#md5)} UF2 block(s) declare an MD5 flash region (flag 0x4000) and ${String(this.#extensionTags)} declare extension tags (flag 0x8000); both are counted, not decoded or verified.`,
      );
    return { unknown, known };
  }

  #metadata(
    regions: readonly Uf2Region[],
    duplicateBytes: number,
    numbering: NumberingFacts,
  ): Uf2Metadata {
    return {
      kind: "uf2",
      block_count: this.#blockCount,
      trailing_bytes: this.#blockLength,
      invalid_block_count: this.#invalid,
      flash_block_count: this.#flash,
      not_main_flash_block_count: this.#notMainFlash,
      file_container_block_count: this.#fileContainer,
      md5_block_count: this.#md5,
      extension_tag_block_count: this.#extensionTags,
      family_count: this.#families.size,
      family_name_registry: UF2_FAMILY_REGISTRY,
      numbering_group_count: this.#groups.size,
      missing_block_count: numbering.missing,
      ambiguous_numbering_group_count: numbering.ambiguous.length,
      repeated_block_count: this.#repeated,
      out_of_order_block_count: this.#outOfOrder,
      block_number_out_of_range_count: this.#outOfRange,
      region_count: regions.length,
      data_bytes: regions.reduce((sum, region) => sum + region.bytes.length, 0),
      duplicate_bytes: duplicateBytes,
    };
  }
}

const blockSpan = (run: BlockRun): string =>
  run.firstFileBlock === run.lastFileBlock
    ? `block ${String(run.firstFileBlock)}`
    : `blocks ${String(run.firstFileBlock)}-${String(run.lastFileBlock)}`;

/** Merge each family's runs by address; overlaps must repeat the same bytes. */
const mergeRuns = (
  runs: readonly BlockRun[],
  arena: Uint8Array,
): Result<
  { readonly regions: Uf2Region[]; readonly duplicateBytes: number },
  RegionDecodeFailure
> => {
  // Undeclared families sort first; other families never merge with them.
  const merged = mergeArenaRuns(runs, arena, (run) => run.familyId ?? -1);
  if (!merged.ok) return err(conflict(merged.error));
  return ok({
    regions: merged.value.ranges.map(({ start, bytes, runs: group }) => {
      const familyId = group[0]?.familyId ?? null;
      return {
        familyId,
        familyName: familyId === null ? null : uf2FamilyName(familyId),
        start,
        end: start + bytes.length - 1,
        bytes,
        blockCount: group.reduce((sum, run) => sum + run.blockCount, 0),
        firstFileBlock: group.reduce(
          (block, run) => Math.min(block, run.firstFileBlock),
          Number.MAX_SAFE_INTEGER,
        ),
        lastFileBlock: group.reduce(
          (block, run) => Math.max(block, run.lastFileBlock),
          0,
        ),
      };
    }),
    duplicateBytes: merged.value.duplicateBytes,
  });
};

const conflict = ({
  address,
  writer,
  run,
  existing,
  incoming,
}: RunConflict<BlockRun>): RegionDecodeFailure => ({
  kind: "format",
  message: `${familyText(run.familyId)} address ${hex32(address)} is written with different values by ${blockSpan(writer)} (0x${existing.toString(16).padStart(2, "0")}) and ${blockSpan(run)} (0x${incoming.toString(16).padStart(2, "0")})`,
});
