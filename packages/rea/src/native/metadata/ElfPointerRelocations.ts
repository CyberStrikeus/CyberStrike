import { readElfDynamicEntry } from "../../domain/elfDynamicEntry.js";
import { readElfRelocationEntry } from "../../domain/elfRelocation.js";
import {
  BinaryMappingFailure,
  createFileMappingIndex,
  isZeroFilledSpan,
  type ElfDynamicSegment,
  type FileMapping,
  type ZeroFillMapping,
} from "./BinaryContainer.js";

/** Shared loader interpretation; language adapters choose their public errors. */
export class ElfPointerRelocationFailure extends Error {
  constructor(
    readonly reason:
      | "malformed-container"
      | "unsupported-container"
      | "unsupported-pointer-encoding"
      | "native-index-capacity",
    message: string,
  ) {
    super(message);
  }
}
export interface ElfPointerRelocationSource {
  readonly encoding: "rel" | "rela" | "relr";
  readonly record_file_offset: number;
  readonly kind: number | null;
}
export interface ElfPointerWrite {
  readonly address: bigint;
  readonly width: number;
  /** null: a symbolic/indirect relocation whose value is not established. */
  readonly value: bigint | null;
  readonly file_offset: number | null;
  readonly source: ElfPointerRelocationSource;
}
export interface ElfOverlayPointer {
  readonly value: bigint;
  readonly file_offset: number | null;
  readonly relocation: ElfPointerRelocationSource | null;
}
export interface ElfPointerOverlay {
  readonly writes: readonly ElfPointerWrite[];
  readonly unresolved: ReadonlyMap<bigint, number>;
  readonly issues: readonly string[];
  readonly dynamic_present: boolean;
  readonly pointer_coverage_known: boolean;
  readonly hasWrites: (address: bigint, size: number) => boolean;
  /** Unknown/partially overwritten words are undefined, never their stored zero. */
  readonly pointerAt: (address: bigint) => ElfOverlayPointer | undefined;
}
export interface ElfPointerRelocationInput {
  readonly bits: 32 | 64;
  readonly little: boolean;
  readonly machine: number;
  readonly dynamicSegments: readonly ElfDynamicSegment[];
  readonly mappings: readonly FileMapping[];
  readonly zeroFills: readonly ZeroFillMapping[];
}

// JNI sparse consumers retain per-write provenance; streaming materializers do not.
const MAX_RELOCATION_RECORDS = 65_536;
const DT_RELA = 7n,
  DT_RELASZ = 8n,
  DT_RELAENT = 9n;
const DT_REL = 17n,
  DT_RELSZ = 18n,
  DT_RELENT = 19n;
const DT_PLTRELSZ = 2n,
  DT_PLTREL = 20n,
  DT_JMPREL = 23n;
const DT_RELRSZ = 35n,
  DT_RELR = 36n,
  DT_RELRENT = 37n;
const PACKED_TAGS = [0x6000000fn, 0x60000010n, 0x60000011n, 0x60000012n];
const ANDROID_RELR_TAGS = [0x6fffe000n, 0x6fffe001n, 0x6fffe003n];
const UNIQUE_TAGS = new Set([
  DT_RELA,
  DT_RELASZ,
  DT_RELAENT,
  DT_REL,
  DT_RELSZ,
  DT_RELENT,
  DT_RELR,
  DT_RELRSZ,
  DT_RELRENT,
  DT_JMPREL,
  DT_PLTRELSZ,
  DT_PLTREL,
  ...PACKED_TAGS,
  ...ANDROID_RELR_TAGS,
]);
const malformed = (message: string): never => {
  throw new ElfPointerRelocationFailure("malformed-container", message);
};
const RELOCATION_KINDS = new Map([
  [
    183,
    {
      bits: 64,
      relative: 1027,
      widths: new Map([
        [257, 8],
        [258, 4],
        [259, 2],
        [260, 8],
        [261, 4],
        [262, 2],
        [1025, 8],
        [1026, 8],
        [1028, 8],
        [1029, 8],
        [1030, 8],
        [1032, 8],
      ]),
    },
  ],
  [
    62,
    {
      bits: 64,
      relative: 8,
      widths: new Map([
        [1, 8],
        [2, 4],
        [6, 8],
        [7, 8],
        [10, 4],
        [11, 4],
        [16, 8],
        [17, 8],
        [18, 8],
        [24, 8],
        [37, 8],
      ]),
    },
  ],
  [
    40,
    {
      bits: 32,
      relative: 23,
      widths: new Map([
        [2, 4],
        [3, 4],
        [17, 4],
        [18, 4],
        [19, 4],
        [21, 4],
        [22, 4],
        [160, 4],
      ]),
    },
  ],
  [
    3,
    {
      bits: 32,
      relative: 8,
      widths: new Map([
        [1, 4],
        [2, 4],
        [3, 4],
        [4, 4],
        [6, 4],
        [7, 4],
        [9, 4],
        [10, 4],
        [11, 4],
        [14, 4],
        [15, 4],
        [16, 4],
        [17, 4],
        [18, 4],
        [19, 4],
        [20, 2],
        [21, 2],
        [22, 1],
        [23, 1],
        [35, 4],
        [36, 4],
        [37, 4],
        [38, 4],
        [42, 4],
        [43, 4],
      ]),
    },
  ],
]);

function* dynamicTags(
  bytes: Buffer,
  input: ElfPointerRelocationInput,
): Generator<undefined, Map<bigint, bigint>> {
  yield;
  if (input.dynamicSegments.length > 1)
    malformed("multiple PT_DYNAMIC segments");
  const declaration = input.dynamicSegments[0];
  if (declaration === undefined) return new Map();
  const width = input.bits / 4;
  if (declaration.size > 16n * 1024n * 1024n)
    throw new ElfPointerRelocationFailure(
      "native-index-capacity",
      "ELF dynamic directory exceeds the 16 MiB structural allowance",
    );
  if (
    declaration.size % BigInt(width) !== 0n ||
    declaration.offset > BigInt(bytes.length) ||
    declaration.size > BigInt(bytes.length) - declaration.offset
  )
    malformed("PT_DYNAMIC is truncated or outside the file");
  const tags = new Map<bigint, bigint>();
  const start = Number(declaration.offset),
    end = start + Number(declaration.size);
  for (let at = start; at < end; at += width) {
    if ((at - start) % 65_536 === 0) yield;
    const parsed = readElfDynamicEntry(
      bytes.subarray(at, at + width),
      input.bits,
      input.little,
    );
    if (!parsed.ok) return malformed(parsed.error.message);
    const { tag, value } = parsed.value;
    if (tag === 0n) return tags;
    if (UNIQUE_TAGS.has(tag) && tags.has(tag))
      malformed(`duplicate dynamic tag ${tag}`);
    if (UNIQUE_TAGS.has(tag)) tags.set(tag, value);
  }
  return malformed("PT_DYNAMIC has no DT_NULL terminator");
}

export interface ElfRelocationStreamResult {
  readonly issues: readonly string[];
  readonly dynamic_present: boolean;
  readonly pointer_coverage_known: boolean;
  readonly originalPointerAt: (
    address: bigint,
  ) => ElfOverlayPointer | undefined;
}
type RelocationOptions = {
  readonly unsupported?: "reject" | "record";
  readonly requireDynamic?: boolean;
};

/** Decode once from immutable bytes; consumers choose streaming or sparse retention. */
export function* readElfRelocationWritesSteps(
  bytes: Buffer,
  input: ElfPointerRelocationInput,
  options: RelocationOptions = {},
): Generator<ElfPointerWrite | undefined, ElfRelocationStreamResult> {
  const kinds = RELOCATION_KINDS.get(input.machine);
  if (kinds === undefined || kinds.bits !== input.bits)
    throw new ElfPointerRelocationFailure(
      "unsupported-container",
      "ELF relative pointers require a matching AArch64, x86-64, ARM or i386 image",
    );
  const relative = kinds.relative;
  const unknownWidths = kinds.widths;
  if (options.requireDynamic === true && input.dynamicSegments.length === 0)
    throw new ElfPointerRelocationFailure(
      "unsupported-container",
      "ELF image has no PT_DYNAMIC segment",
    );
  const tags = yield* dynamicTags(bytes, input);
  const word = input.bits / 8;
  const index = createFileMappingIndex(input.mappings, input.zeroFills);
  const fileOffset = (address: bigint, width: number): number | null => {
    try {
      return index.offset(address, width);
    } catch (cause) {
      if (cause instanceof BinaryMappingFailure && cause.reason === "unmapped")
        return null;
      throw cause;
    }
  };
  const rawWord = (offset: number): bigint =>
    input.bits === 64
      ? input.little
        ? bytes.readBigUInt64LE(offset)
        : bytes.readBigUInt64BE(offset)
      : BigInt(
          input.little
            ? bytes.readUInt32LE(offset)
            : bytes.readUInt32BE(offset),
        );
  const target = (address: bigint, width: number): number | null => {
    const at = fileOffset(address, width);
    if (
      at === null &&
      !isZeroFilledSpan(input.mappings, input.zeroFills, address, width)
    )
      malformed(
        "RELATIVE relocation target is outside unambiguous loaded memory",
      );
    return at;
  };
  const issues = new Set<string>();
  let known = true;
  const unsupported = (message: string) => {
    if (options.unsupported !== "record")
      throw new ElfPointerRelocationFailure(
        "unsupported-pointer-encoding",
        message,
      );
    if (issues.size < 16) issues.add(message);
    else
      issues.add(
        "Additional unsupported relocation encodings were not individually listed",
      );
    known = false;
  };
  const write = (
    address: bigint,
    width: number,
    value: bigint | null,
    source: ElfPointerRelocationSource,
  ): ElfPointerWrite => ({
    address,
    width,
    value,
    file_offset:
      value === null ? fileOffset(address, width) : target(address, width),
    source,
  });
  if (PACKED_TAGS.some((tag) => tags.has(tag)))
    unsupported(
      "Android packed APS2 relocation write locations and addends are not decoded",
    );
  if (ANDROID_RELR_TAGS.some((tag) => tags.has(tag)))
    unsupported("Android-specific RELR dynamic tags are not decoded");

  function* standardTable(
    address: bigint,
    size: bigint | undefined,
    entry: bigint,
    encoding: "rel" | "rela",
  ): Generator<ElfPointerWrite | undefined> {
    const width = word * (encoding === "rela" ? 3 : 2);
    if (
      size === undefined ||
      size < 0n ||
      entry !== BigInt(width) ||
      size % entry !== 0n ||
      size > BigInt(bytes.length)
    )
      return malformed(
        `invalid DT_${encoding.toUpperCase()}SZ or DT_${encoding.toUpperCase()}ENT`,
      );
    if (size === 0n) return;
    const start = fileOffset(address, Number(size));
    if (start === null)
      return malformed(`${encoding.toUpperCase()} table is not file-backed`);
    for (let at = start; at < start + Number(size); at += width) {
      if ((at - start) % (width * 4096) === 0) yield;
      const parsed =
        encoding === "rela"
          ? readElfRelocationEntry(
              bytes.subarray(at, at + width),
              input.bits,
              input.little,
              "rela",
            )
          : readElfRelocationEntry(
              bytes.subarray(at, at + width),
              input.bits,
              input.little,
              "rel",
            );
      if (!parsed.ok) return malformed(parsed.error.message);
      const { type: kind, offset: destination, symbolIndex } = parsed.value;
      if (kind === 0) continue;
      const source = { encoding, record_file_offset: at, kind };
      if (kind !== relative || symbolIndex !== 0) {
        const width = unknownWidths.get(kind);
        if (width === undefined) {
          unsupported(`ELF relocation kind ${kind} is not decoded`);
          continue;
        }
        yield write(destination, width, null, source);
        continue;
      }
      const slot = target(destination, word);
      const explicitAddend =
        "addend" in parsed.value && typeof parsed.value.addend === "bigint"
          ? parsed.value.addend
          : undefined;
      if (encoding === "rela" && explicitAddend === undefined)
        return malformed("RELA relocation has no decoded addend");
      const addend = explicitAddend ?? (slot === null ? 0n : rawWord(slot));
      yield write(
        destination,
        word,
        BigInt.asUintN(input.bits, addend),
        source,
      );
    }
  }
  for (const [addressTag, sizeTag, entryTag, encoding] of [
    [DT_RELA, DT_RELASZ, DT_RELAENT, "rela"],
    [DT_REL, DT_RELSZ, DT_RELENT, "rel"],
  ] as const) {
    const address = tags.get(addressTag);
    if (address !== undefined)
      yield* standardTable(
        address,
        tags.get(sizeTag),
        tags.get(entryTag) ?? BigInt(word * (encoding === "rela" ? 3 : 2)),
        encoding,
      );
    else if ((tags.get(sizeTag) ?? 0n) !== 0n)
      malformed(
        `DT_${encoding.toUpperCase()}SZ has no DT_${encoding.toUpperCase()}`,
      );
  }
  const plt = tags.get(DT_JMPREL);
  if (plt !== undefined) {
    const encoding =
      tags.get(DT_PLTREL) === DT_RELA
        ? "rela"
        : tags.get(DT_PLTREL) === DT_REL
          ? "rel"
          : undefined;
    if (encoding === undefined)
      unsupported("PLT relocations require a declared REL or RELA encoding");
    else
      yield* standardTable(
        plt,
        tags.get(DT_PLTRELSZ),
        BigInt(word * (encoding === "rela" ? 3 : 2)),
        encoding,
      );
  } else if ((tags.get(DT_PLTRELSZ) ?? 0n) !== 0n)
    malformed("DT_PLTRELSZ has no DT_JMPREL");

  const relr = tags.get(DT_RELR),
    relrSize = tags.get(DT_RELRSZ) ?? 0n;
  if (relr === undefined) {
    if (relrSize !== 0n) malformed("DT_RELRSZ has no DT_RELR");
  } else {
    if (
      relrSize % BigInt(word) !== 0n ||
      relrSize > BigInt(bytes.length) ||
      (tags.get(DT_RELRENT) ?? BigInt(word)) !== BigInt(word)
    )
      malformed("invalid DT_RELRSZ or DT_RELRENT");
    const start = relrSize === 0n ? 0 : fileOffset(relr, Number(relrSize));
    if (start === null) return malformed("RELR table is not file-backed");
    let next: bigint | undefined;
    for (let at = start; at < start + Number(relrSize); at += word) {
      if ((at - start) % (word * 4096) === 0) yield;
      const entry = rawWord(at);
      const add = (address: bigint) => {
        if (address > (1n << BigInt(input.bits)) - BigInt(word))
          malformed("RELR destination overflows the ELF address space");
        const slot = target(address, word);
        return write(address, word, slot === null ? 0n : rawWord(slot), {
          encoding: "relr",
          record_file_offset: at,
          kind: null,
        });
      };
      if ((entry & 1n) === 0n) {
        yield add(entry);
        next = entry + BigInt(word);
      } else {
        if (next === undefined)
          return malformed("RELR bitmap has no preceding address");
        for (let bit = 1; bit < input.bits; bit++)
          if ((entry & (1n << BigInt(bit))) !== 0n)
            yield add(next + BigInt((bit - 1) * word));
        next += BigInt((input.bits - 1) * word);
        if (next > 1n << BigInt(input.bits))
          malformed("RELR bitmap overflows the ELF address space");
      }
    }
  }

  return {
    issues: [...issues],
    dynamic_present: input.dynamicSegments.length !== 0,
    pointer_coverage_known: known,
    originalPointerAt: (address) => {
      const at = fileOffset(address, word);
      return at === null
        ? undefined
        : { value: rawWord(at), file_offset: at, relocation: null };
    },
  };
}

/** Retain bounded sparse pointer facts for consumers that query the original image. */
export function* readElfPointerRelocationsSteps(
  bytes: Buffer,
  input: ElfPointerRelocationInput,
  options: RelocationOptions = {},
): Generator<void, ElfPointerOverlay> {
  const word = input.bits / 8;
  const writes: ElfPointerWrite[] = [];
  const unresolved = new Map<bigint, number>();
  const values = new Map<bigint, ElfPointerWrite>();
  const widths = new Map<bigint, number>();
  const steps = readElfRelocationWritesSteps(bytes, input, options);
  let next = steps.next();
  while (!next.done) {
    const write = next.value;
    if (write === undefined) yield;
    else {
      if (writes.length >= MAX_RELOCATION_RECORDS)
        throw new ElfPointerRelocationFailure(
          "native-index-capacity",
          `ELF sparse relocation index exceeds ${MAX_RELOCATION_RECORDS} retained writes`,
        );
      writes.push(write);
      const { address, width, value } = write;
      widths.set(address, Math.max(widths.get(address) ?? 0, width));
      if (value === null)
        unresolved.set(address, Math.max(unresolved.get(address) ?? 0, width));
      else {
        const previous = values.get(address);
        if (previous !== undefined && previous.value !== value)
          unresolved.set(
            address,
            Math.max(unresolved.get(address) ?? 0, width),
          );
        values.set(address, write);
      }
    }
    next = steps.next();
  }
  const {
    issues,
    dynamic_present,
    pointer_coverage_known: known,
    originalPointerAt,
  } = next.value;
  // Index one span per destination. Reads cannot mistake bytes changed by a
  // partial or unresolved relocation for an original valid pointer.
  const ranges = [...widths]
    .map(([address, width]) => ({ address, end: address + BigInt(width) }))
    .sort((a, b) =>
      a.address < b.address ? -1 : a.address > b.address ? 1 : 0,
    );
  const reach: bigint[] = [];
  for (const range of ranges)
    reach.push(
      range.end > (reach.at(-1) ?? 0n) ? range.end : (reach.at(-1) ?? 0n),
    );
  const pointerAt = (address: bigint): ElfOverlayPointer | undefined => {
    if (!known) return undefined;
    const end = address + BigInt(word);
    let low = 0,
      high = ranges.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((ranges[mid]?.address ?? end) < end) low = mid + 1;
      else high = mid;
    }
    for (let at = low - 1; at >= 0 && (reach[at] ?? 0n) > address; at--) {
      const range = ranges[at];
      if (
        range !== undefined &&
        range.end > address &&
        (range.address !== address ||
          unresolved.has(range.address) ||
          range.end !== end)
      )
        return undefined;
    }
    const relocated = values.get(address);
    if (relocated?.value !== undefined && relocated.value !== null)
      return {
        value: relocated.value,
        file_offset: relocated.file_offset,
        relocation: relocated.source,
      };
    return originalPointerAt(address);
  };
  const hasWrites = (address: bigint, size: number): boolean => {
    const end = address + BigInt(size);
    let low = 0,
      high = ranges.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((ranges[mid]?.address ?? end) < end) low = mid + 1;
      else high = mid;
    }
    return low > 0 && (reach[low - 1] ?? 0n) > address;
  };
  return {
    writes,
    unresolved,
    issues,
    dynamic_present,
    pointer_coverage_known: known,
    pointerAt,
    hasWrites,
  };
}
