import type { Segment } from "./AppleMachoSelection.js";
import { issue } from "./AppleDispatchDecodeFacts.js";
import type { DecodeIssue } from "./AppleDispatchDecodeFacts.js";
import { decodeMachoName, type MachoName } from "./AppleMachoNames.js";

/** Where a Mach-O stores pointer fixups, from its load commands. */
export interface FixupCommands {
  /** Absolute file range of `LC_DYLD_CHAINED_FIXUPS` data. */
  readonly chained: { readonly offset: number; readonly size: number } | null;
  /** Absolute file ranges of `LC_DYLD_INFO(_ONLY)` rebase streams. */
  readonly rebases: readonly {
    readonly offset: number;
    readonly size: number;
  }[];
  /** Absolute file ranges of `LC_DYLD_INFO(_ONLY)` bind streams. */
  readonly binds: readonly {
    readonly offset: number;
    readonly size: number;
    readonly stream: "bind" | "weak" | "lazy";
  }[];
  /** Lossless install names of dependent dylibs, in library-ordinal order. */
  readonly dylibs: readonly MachoName[];
}

/** One decoded pointer: a rebase to an in-image address or a bind to a symbol. */
export type DecodedPointer =
  | { readonly kind: "rebase"; readonly target: bigint }
  | {
      readonly kind: "bind";
      readonly symbol: string;
      /** Producer stream, which is part of lookup identity for weak binds. */
      readonly binding_source: "chained" | "bind" | "weak" | "lazy";
      /** Signed dyld library ordinal; 0 and negative values are special scopes. */
      readonly library_ordinal: number;
      readonly library: string | null;
      readonly weak: boolean;
      readonly addend: bigint;
    }
  | {
      readonly kind: "unsupported";
      readonly reason: string;
      /** Source bind facts survive when a byte name has no lossless text projection. */
      readonly binding?: Import;
    };

/** Pointer-slot outcome, including whether a rebase was actually applied. */
export type PointerResolution =
  | { readonly kind: "raw"; readonly target: bigint }
  | { readonly kind: "rebase"; readonly target: bigint }
  | Exclude<DecodedPointer, { readonly kind: "rebase" }>
  | {
      readonly kind: "unknown";
      /** Preserved on-disk word; not an authoritative in-image target. */
      readonly raw: bigint;
      readonly reason: string;
    };

/** Pointer decoding for one Mach-O slice. */
export interface PointerFixups {
  readonly kind: "chained" | "dyld-info" | "none";
  /** Chained pointer formats in use, such as `DYLD_CHAINED_PTR_64_OFFSET`. */
  readonly formats: readonly string[];
  readonly failures: readonly string[];
  readonly issues: readonly DecodeIssue[];
  /** Chained segments, legacy rebase streams, or bind streams this reader walked. */
  readonly examined: number;
  /** Chained segments without observed decode failures, plus structurally parsed
   * legacy opcode streams, in the same units as `examined`. Legacy location
   * coverage survives unavailable name text, which is qualified by `issues`.
   */
  readonly decoded: number;
  /** Declared legacy opcode streams examined by this owner. */
  readonly legacyRebaseStreams: number;
  readonly legacyBindStreams: number;
  /** Bytes in rebase streams that could not be completely decoded. */
  readonly unreadRebaseBytes: number;
  /** Unresolved legacy writes intersecting a scalar span, including incomplete
   * legacy applicability. Chained pointer values still require decode().
   */
  hasUnresolvedLegacyBytes(address: bigint, size: number): boolean;
  /** Decode the pointer stored at `address` whose raw 64-bit value is `raw`. */
  decode(address: bigint, raw: bigint): PointerResolution;
}

const POINTER_FORMATS: Readonly<Record<number, string>> = {
  1: "DYLD_CHAINED_PTR_ARM64E",
  2: "DYLD_CHAINED_PTR_64",
  6: "DYLD_CHAINED_PTR_64_OFFSET",
  9: "DYLD_CHAINED_PTR_ARM64E_USERLAND",
  12: "DYLD_CHAINED_PTR_ARM64E_USERLAND24",
};

const bits = (value: bigint, from: number, width: number): bigint =>
  (value >> BigInt(from)) & ((1n << BigInt(width)) - 1n);

const signed = (value: bigint, width: number): bigint =>
  value >= 1n << BigInt(width - 1) ? value - (1n << BigInt(width)) : value;

type SymbolName =
  | { readonly symbol: string }
  | { readonly symbol: null; readonly symbol_bytes_base64: string };

type LibraryName =
  | { readonly library: string | null; readonly library_bytes_base64?: never }
  | { readonly library: null; readonly library_bytes_base64: string };

type Import = SymbolName &
  LibraryName & {
    readonly binding_source: "chained" | "bind" | "weak" | "lazy";
    readonly library_ordinal: number;
    readonly weak: boolean;
    readonly addend: bigint;
  };

interface BindRun {
  readonly start: bigint;
  count: bigint;
  readonly stride: bigint;
  readonly binding:
    | {
        readonly kind: "bind";
        readonly value: Import & { readonly symbol: string };
      }
    | Extract<DecodedPointer, { readonly kind: "unsupported" }>;
}

interface BindFacts {
  readonly runs: readonly BindRun[];
  readonly failures: readonly string[];
  readonly issues: readonly DecodeIssue[];
  readonly examined: number;
  readonly decoded: number;
  /** All opcode locations are known, independently of name text availability. */
  readonly complete: boolean;
}

/** Resolve only valid dylib ordinals; preserve special scopes as raw ordinals. */
const libraryFacts = (
  ordinal: number,
  dylibs: FixupCommands["dylibs"],
): LibraryName => {
  if (!Number.isSafeInteger(ordinal) || ordinal < -3)
    throw new RangeError(`Unsupported dylib ordinal ${String(ordinal)}`);
  if (ordinal > 0) {
    const name = dylibs[ordinal - 1];
    if (name === undefined)
      throw new RangeError(
        `Dylib ordinal ${ordinal} exceeds the ${dylibs.length} declared dependencies`,
      );
    return typeof name === "string"
      ? { library: name }
      : { library: null, library_bytes_base64: name.bytes_base64 };
  }
  return { library: null };
};

/** dyld names are NUL-terminated bytes; text projection must never replace their identity. */
const symbolName = (bytes: Buffer): SymbolName => {
  const name = decodeMachoName(bytes);
  return typeof name === "string"
    ? { symbol: name }
    : { symbol: null, symbol_bytes_base64: name.bytes_base64 };
};

const cString = (bytes: Buffer, offset: number, end: number): SymbolName => {
  const stop = bytes.indexOf(0, offset);
  if (offset < 0 || offset >= end || stop < 0 || stop >= end)
    throw new RangeError("Fixup symbol name is outside the symbol pool");
  return symbolName(bytes.subarray(offset, stop));
};

const resolvedBind = (
  imported: Import,
  addend: bigint,
): Exclude<DecodedPointer, { readonly kind: "rebase" }> =>
  imported.symbol === null || imported.library_bytes_base64 !== undefined
    ? {
        kind: "unsupported",
        reason:
          imported.symbol === null
            ? "Fixup symbol bytes cannot be represented losslessly as UTF-8 text"
            : "Dylib install-name bytes cannot be represented losslessly as UTF-8 text",
        binding: { ...imported, addend: imported.addend + addend },
      }
    : { kind: "bind", ...imported, addend: imported.addend + addend };

const sameImport = (left: Import, right: Import): boolean =>
  left.symbol === right.symbol &&
  (left.symbol !== null ||
    right.symbol !== null ||
    left.symbol_bytes_base64 === right.symbol_bytes_base64) &&
  left.binding_source === right.binding_source &&
  left.library_ordinal === right.library_ordinal &&
  left.library === right.library &&
  left.library_bytes_base64 === right.library_bytes_base64 &&
  left.weak === right.weak &&
  left.addend === right.addend;

const readImport = (
  data: {
    readonly bytes: Buffer;
    readonly base: number;
    readonly end: number;
    readonly dylibs: FixupCommands["dylibs"];
  },
  header: {
    readonly offset: number;
    readonly count: number;
    readonly format: number;
    readonly symbols: number;
  },
  index: number,
): Import => {
  const { bytes, base, end, dylibs } = data;
  const size = header.format === 3 ? 16 : header.format === 2 ? 8 : 4;
  if (header.format < 1 || header.format > 3)
    throw new RangeError(`Unsupported chained import format ${header.format}`);
  if (
    !Number.isSafeInteger(header.count) ||
    base + header.offset + header.count * size > end
  )
    throw new RangeError("Chained import table exceeds the fixup data");
  if (index < 0 || index >= header.count)
    throw new RangeError("Chained import index is outside the table");
  const at = base + header.offset + index * size;
  if (header.format === 3) {
    const word = bytes.readBigUInt64LE(at);
    const encodedOrdinal = Number(bits(word, 0, 16));
    const ordinal =
      encodedOrdinal > 0xfff0 ? encodedOrdinal - 0x10000 : encodedOrdinal;
    return {
      ...cString(
        bytes,
        base + header.symbols + Number(bits(word, 32, 32)),
        end,
      ),
      binding_source: "chained",
      library_ordinal: ordinal,
      ...libraryFacts(ordinal, dylibs),
      weak: bits(word, 16, 1) === 1n,
      addend: bytes.readBigInt64LE(at + 8),
    };
  }
  const word = bytes.readUInt32LE(at);
  const encodedOrdinal = word & 0xff;
  const ordinal =
    encodedOrdinal > 0xf0 ? encodedOrdinal - 0x100 : encodedOrdinal;
  return {
    ...cString(bytes, base + header.symbols + (word >>> 9), end),
    binding_source: "chained",
    library_ordinal: ordinal,
    ...libraryFacts(ordinal, dylibs),
    weak: ((word >>> 8) & 1) === 1,
    addend: header.format === 2 ? BigInt(bytes.readInt32LE(at + 4)) : 0n,
  };
};

/** Decode one raw chained pointer for its segment's pointer format. */
export const decodeChainedPointer = (
  raw: bigint,
  format: number,
  baseAddress: bigint,
  imports: readonly Import[] | ((index: number) => Import),
): DecodedPointer => {
  const bind = (ordinal: bigint, addend: bigint): DecodedPointer => {
    const target =
      typeof imports === "function"
        ? imports(Number(ordinal))
        : imports[Number(ordinal)];
    if (target === undefined)
      throw new RangeError(`Chained bind ordinal ${ordinal} has no import`);
    return resolvedBind(target, addend);
  };
  if (format === 2 || format === 6) {
    if (bits(raw, 63, 1) === 1n)
      return bind(bits(raw, 0, 24), bits(raw, 24, 8));
    const target = bits(raw, 0, 36) | (bits(raw, 36, 8) << 56n);
    return {
      kind: "rebase",
      target: format === 6 ? target + baseAddress : target,
    };
  }
  if (format === 1 || format === 9 || format === 12) {
    const auth = bits(raw, 63, 1) === 1n;
    if (bits(raw, 62, 1) === 1n)
      return bind(
        bits(raw, 0, format === 12 ? 24 : 16),
        auth ? 0n : signed(bits(raw, 32, 19), 19),
      );
    if (auth) return { kind: "rebase", target: bits(raw, 0, 32) + baseAddress };
    const target = bits(raw, 0, 43) | (bits(raw, 43, 8) << 56n);
    return {
      kind: "rebase",
      target: format === 1 ? target : target + baseAddress,
    };
  }
  throw new RangeError(`Unsupported chained pointer format ${format}`);
};

/** The slice bytes and load-command facts that fixup decoding reads. */
interface FixupImage {
  readonly bytes: Buffer;
  readonly segments: readonly Segment[];
  readonly dylibs: FixupCommands["dylibs"];
  readonly baseAddress: bigint;
}

interface ChainedPage {
  /** One bit per byte offset, preserving even unaligned producer locations. */
  readonly locations: Uint8Array;
  readonly lastOffset: number | undefined;
  readonly failure: string | undefined;
}

interface ChainedSegment {
  readonly segment: Segment;
  readonly format: number;
  readonly pageSize: number;
  /** Compact producer-owned table coordinates, never one map per segment. */
  readonly pageCount: number;
  readonly pageStarts: number;
}

interface ChainedPageSource {
  readonly offset: number;
  readonly size: number;
  readonly format: number;
  readonly start: number;
}

/** Parse one physical page; a failed tail retains established locations. */
const readChainedPage = (
  bytes: Buffer,
  source: ChainedPageSource,
): ChainedPage => {
  let locations = new Uint8Array(0);
  let lastOffset: number | undefined;
  let failure: string | undefined;
  try {
    if ((source.start & 0x8000) !== 0)
      throw new RangeError(
        "Multiple chained starts are not valid for 64-bit pointers",
      );
    if (source.start + 8 > source.size)
      throw new RangeError("Chained pointer leaves its file-backed page");
    // At most one eighth of this file-backed page, not one object per fixup.
    locations = new Uint8Array(Math.ceil(source.size / 8));
    const generic = source.format === 2 || source.format === 6;
    let at = source.start;
    while (true) {
      locations[at >>> 3] = (locations[at >>> 3] ?? 0) | (1 << (at & 7));
      lastOffset = at;
      const raw = bytes.readBigUInt64LE(source.offset + at);
      const next = Number(bits(raw, 51, generic ? 12 : 11)) * (generic ? 4 : 8);
      if (next === 0) break;
      if (at + next + 8 > source.size)
        throw new RangeError(
          "Chained pointer link leaves its file-backed page",
        );
      at += next;
    }
  } catch (cause: unknown) {
    failure = cause instanceof Error ? cause.message : String(cause);
  }
  return { locations, lastOffset, failure };
};

const chainedFixups = (
  image: FixupImage,
  range: { readonly offset: number; readonly size: number },
  rebases: RebaseFacts,
  binds: BindFacts,
): PointerFixups => {
  const { bytes, segments, dylibs, baseAddress } = image;
  const base = range.offset;
  const end = range.offset + range.size;
  if (
    !Number.isSafeInteger(base) ||
    base < 0 ||
    !Number.isSafeInteger(range.size) ||
    range.size < 28 ||
    end > bytes.length
  )
    throw new RangeError("Chained fixup header exceeds the target");
  if (bytes.readUInt32LE(base) !== 0)
    throw new RangeError("Unsupported chained fixup header version");
  const startsOffset = bytes.readUInt32LE(base + 4);
  const importHeader = {
    offset: bytes.readUInt32LE(base + 8),
    symbols: bytes.readUInt32LE(base + 12),
    count: bytes.readUInt32LE(base + 16),
    format: bytes.readUInt32LE(base + 20),
  };
  const importSize =
    importHeader.format === 3 ? 16 : importHeader.format === 2 ? 8 : 4;
  const importTableEnd =
    base + importHeader.offset + importHeader.count * importSize;
  if (importHeader.format < 1 || importHeader.format > 3)
    throw new RangeError(
      `Unsupported chained import format ${importHeader.format}`,
    );
  if (
    importHeader.offset < 28 ||
    importHeader.symbols < importHeader.offset ||
    importTableEnd > base + importHeader.symbols ||
    base + importHeader.symbols > end
  )
    throw new RangeError("Chained import table exceeds the fixup data");
  const imports = (index: number) =>
    readImport({ bytes, base, end, dylibs }, importHeader, index);
  if (bytes.readUInt32LE(base + 24) !== 0)
    throw new RangeError(
      "Compressed chained-fixup symbol names are not supported",
    );
  const starts = base + startsOffset;
  const startsEnd = base + importHeader.offset;
  const requireStartsRange = (at: number, size: number): void => {
    if (at < base + 28 || at > startsEnd - size)
      throw new RangeError("Chained starts table exceeds its fixup data");
  };
  requireStartsRange(starts, 4);
  const segmentCount = bytes.readUInt32LE(starts);
  if (segmentCount > segments.length)
    throw new RangeError(
      "Chained starts segment count exceeds the Mach-O layout",
    );
  requireStartsRange(starts, 4 + segmentCount * 4);
  const ranges: ChainedSegment[] = [];
  // A non-overlapping file view has at most file-size/minimum-page-size
  // pages plus two partial pages per segment. Keep both metadata entries and
  // bitmap bytes within that format-derived working set. Aliased/exhausted
  // views remain readable by transient recomputation, not input rejection.
  const maximumCachedPages =
    Math.ceil(bytes.length / 0x1000) + 2 * segmentCount;
  let remainingLocationBytes = Math.ceil(bytes.length / 8);
  const cachedPages = new Map<string, ChainedPage>();
  const pageFacts = (
    chain: ChainedSegment,
    page: number,
    start: number,
  ): ChainedPage => {
    const pageOffset = page * chain.pageSize;
    const source = {
      offset: chain.segment.offset + pageOffset,
      size: Math.min(
        chain.pageSize,
        Number(chain.segment.size) - pageOffset,
        bytes.length - chain.segment.offset - pageOffset,
      ),
      format: chain.format,
      start,
    };
    const key = `${source.offset}:${source.size}:${source.format}:${source.start}`;
    const cached = cachedPages.get(key);
    if (cached !== undefined) return cached;
    // Decide retention before allocating the page facts. An exhausted cache
    // uses only one transient, format-bounded page, preserving decode behavior.
    const retain =
      cachedPages.size < maximumCachedPages &&
      Math.ceil(Math.max(source.size, 0) / 8) <= remainingLocationBytes;
    const facts = readChainedPage(bytes, source);
    if (retain) {
      remainingLocationBytes -= facts.locations.byteLength;
      cachedPages.set(key, facts);
    }
    return facts;
  };
  for (let index = 0; index < segmentCount; index++) {
    const infoOffset = bytes.readUInt32LE(starts + 4 + index * 4);
    if (infoOffset === 0) continue;
    const segment = segments[index];
    if (segment === undefined)
      throw new RangeError("Chained fixup segment table is out of range");
    const info = starts + infoOffset;
    requireStartsRange(info, 22);
    const infoSize = bytes.readUInt32LE(info);
    const pageSize = bytes.readUInt16LE(info + 4);
    const pageCount = bytes.readUInt16LE(info + 20);
    if (infoSize < 22 + pageCount * 2)
      throw new RangeError("Chained page starts exceed the segment table size");
    requireStartsRange(info, infoSize);
    if (pageSize !== 0x1000 && pageSize !== 0x4000)
      throw new RangeError("Chained page size must be 4096 or 16384 bytes");
    if (bytes.readBigUInt64LE(info + 8) !== segment.address - baseAddress)
      throw new RangeError(
        "Chained segment offset disagrees with its Mach-O layout",
      );
    ranges.push({
      segment,
      format: bytes.readUInt16LE(info + 6),
      pageSize,
      pageCount,
      pageStarts: info + 22,
    });
  }
  const formats = [
    ...new Set(
      ranges.map(({ format }) => POINTER_FORMATS[format] ?? `format-${format}`),
    ),
  ];
  const issues = [
    ...rebases.issues,
    ...binds.issues,
    ...ranges.flatMap(({ format, segment }) =>
      POINTER_FORMATS[format] === undefined
        ? [
            issue(
              "pointer_fixups",
              "unsupported_pointer_format",
              `Unsupported chained pointer format ${format}`,
              `0x${segment.address.toString(16)}`,
            ),
          ]
        : [],
    ),
  ];
  const examinedViews = new Map<string, boolean>();
  const decodedRanges = new Set<number>();
  for (const [chainIndex, chain] of ranges.entries()) {
    // Unknown formats retain their compact starts table; only a queried page
    // needs its NONE/presence value. Do not expand unsupported declarations.
    if (POINTER_FORMATS[chain.format] === undefined) continue;
    const view = `${chain.pageStarts}:${chain.segment.offset}:${chain.segment.size}:${chain.segment.address}:${chain.format}:${chain.pageSize}:${chain.pageCount}`;
    const prior = examinedViews.get(view);
    if (prior !== undefined) {
      if (prior) decodedRanges.add(chainIndex);
      continue;
    }
    let complete = true;
    for (let page = 0; page < chain.pageCount; page++) {
      const start = bytes.readUInt16LE(chain.pageStarts + page * 2);
      if (start === 0xffff) continue;
      const facts = pageFacts(chain, page, start);
      if (facts.failure !== undefined) {
        complete = false;
        issues.push(
          issue(
            "pointer_fixups",
            "chained_pointer_walk_failed",
            facts.failure,
            `0x${(chain.segment.address + BigInt(page * chain.pageSize)).toString(16)}`,
          ),
        );
        // Coverage is partial after this failure, not exhaustive. Keep the
        // unexpanded descriptor: later pages are still independently readable
        // through pageFacts when metadata requests them.
        break;
      }
    }
    examinedViews.set(view, complete);
    if (complete) decodedRanges.add(chainIndex);
  }
  const failures = issues.map(({ message }) => message);
  const applicabilityFailures = [...rebases.failures, ...binds.failures];
  const applicabilityComplete = rebases.complete && binds.complete;
  const recordPointerFailure = (
    reason: string,
    address: bigint,
    chainIndex: number,
  ): void => {
    const location = `0x${address.toString(16)}`;
    if (
      !issues.some(
        (entry) =>
          entry.code === "chained_pointer_decode_failed" &&
          entry.location === location,
      )
    ) {
      issues.push(
        issue(
          "pointer_fixups",
          "chained_pointer_decode_failed",
          reason,
          location,
        ),
      );
      failures.push(reason);
    }
    decodedRanges.delete(chainIndex);
  };
  return {
    kind: "chained",
    formats,
    failures,
    issues,
    examined: Math.max(ranges.length, 1) + rebases.examined + binds.examined,
    get decoded() {
      return (
        (ranges.length === 0 ? 1 : decodedRanges.size) +
        rebases.decoded +
        binds.decoded
      );
    },
    legacyRebaseStreams: rebases.examined,
    legacyBindStreams: binds.examined,
    unreadRebaseBytes: rebases.unreadBytes,
    hasUnresolvedLegacyBytes: (address, size) =>
      hasUnresolvedLegacyBytes(segments, rebases, binds, address, size),
    decode(address, raw) {
      const rawPointer = (): PointerResolution =>
        applicabilityComplete
          ? { kind: "raw", target: raw }
          : {
              kind: "unknown",
              raw,
              reason: `LC_DYLD_INFO pointer-fixup applicability was not completely decoded: ${applicabilityFailures.join("; ")}`,
            };
      const legacyBind = resolveLegacyBind(binds.runs, address);
      const legacyRebase = resolveLegacyRebase(
        segments,
        rebases.membership,
        address,
        raw,
      );
      if (legacyBind?.kind === "unsupported") return legacyBind;
      if (legacyBind !== undefined && legacyRebase !== undefined)
        return {
          kind: "unsupported",
          reason: `Both bind and rebase records target pointer location 0x${address.toString(16)}`,
        };
      if (legacyBind !== undefined && !rebases.complete)
        return {
          kind: "unknown",
          raw,
          reason: `Legacy rebase opcodes could overlap this bind location: ${rebases.failures.join("; ")}`,
        };
      if (legacyRebase !== undefined && !binds.complete)
        return {
          kind: "unknown",
          raw,
          reason: `Legacy bind opcodes could overlap this rebase location: ${binds.failures.join("; ")}`,
        };
      const chainIndex = ranges.findIndex(
        ({ segment }) =>
          address >= segment.address &&
          address < segment.address + segment.size,
      );
      const chain = ranges[chainIndex];
      // Pointers outside fixup segments, such as in __TEXT, are stored plainly.
      if (chain === undefined)
        return legacyBind ?? legacyRebase ?? rawPointer();
      const within = Number(address - chain.segment.address);
      const page = Math.floor(within / chain.pageSize);
      if (page >= chain.pageCount)
        return legacyBind ?? legacyRebase ?? rawPointer();
      const start = bytes.readUInt16LE(chain.pageStarts + page * 2);
      if (start === 0xffff) return legacyBind ?? legacyRebase ?? rawPointer();
      if (POINTER_FORMATS[chain.format] === undefined)
        return {
          kind: "unsupported",
          reason: `Unsupported chained pointer format ${chain.format}`,
        };
      try {
        const facts = pageFacts(chain, page, start);
        const at = within % chain.pageSize;
        const locations = facts.locations;
        if (((locations[at >>> 3] ?? 0) & (1 << (at & 7))) !== 0) {
          if (
            legacyBind !== undefined ||
            legacyRebase !== undefined ||
            !applicabilityComplete
          ) {
            if (legacyBind !== undefined || legacyRebase !== undefined)
              return {
                kind: "unsupported",
                reason: `Both chained and legacy fixup records target pointer location 0x${address.toString(16)}`,
              };
            return {
              kind: "unknown",
              raw,
              reason: `Incomplete legacy fixup streams could overlap chained pointer location 0x${address.toString(16)}: ${applicabilityFailures.join("; ")}`,
            };
          }
          const decoded = decodeChainedPointer(
            raw,
            chain.format,
            baseAddress,
            imports,
          );
          if (decoded.kind === "unsupported")
            recordPointerFailure(decoded.reason, address, chainIndex);
          return decoded;
        }
        if (
          facts.failure !== undefined &&
          (facts.lastOffset === undefined || at > facts.lastOffset)
        )
          throw new RangeError(facts.failure);
        return legacyBind ?? legacyRebase ?? rawPointer();
      } catch (cause: unknown) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        recordPointerFailure(reason, address, chainIndex);
        return { kind: "unsupported", reason };
      }
    },
  };
};

const uleb = (
  bytes: Buffer,
  cursor: { at: number },
  end: number,
  stream: "bind" | "rebase" = "bind",
  rebaseWork?: { workRemaining: number },
): bigint => {
  let value = 0n;
  let shift = 0;
  for (;;) {
    if (cursor.at >= end)
      throw new RangeError(`Truncated ${stream} opcode operand`);
    if (rebaseWork !== undefined) {
      if (rebaseWork.workRemaining === 0)
        throw new RangeError(
          "Legacy rebase parsing exceeded the source-derived work budget",
        );
      rebaseWork.workRemaining--;
    }
    const byte = bytes[cursor.at++] ?? 0;
    const slice = byte & 0x7f;
    if ((shift === 63 && slice > 1) || (shift === 64 && slice !== 0))
      throw new RangeError(`Oversized ${stream} opcode operand`);
    if (shift < 64) value |= BigInt(slice) << BigInt(shift);
    // Padding may extend the encoding, but never the represented integer.
    shift = Math.min(64, shift + 7);
    if ((byte & 0x80) === 0) return value;
  }
};

interface RebaseFacts {
  /** Two-bit state per source byte; allocated lazily only for emitted rebases. */
  readonly membership: Uint8Array | null;
  readonly failures: readonly string[];
  readonly issues: readonly DecodeIssue[];
  readonly examined: number;
  readonly decoded: number;
  readonly unreadBytes: number;
  readonly complete: boolean;
}

const REBASE_POINTER_SIZE = 8n;
const REBASE_POINTER = 1;
const REBASE_NON_POINTER = 2;
const REBASE_CONFLICT = 3;

const markRebaseLocation = (
  index: { bitmap: Uint8Array | null; workRemaining: number },
  fileOffset: number,
  type: number,
  fileBytes: number,
): void => {
  index.bitmap ??= new Uint8Array(Math.ceil(fileBytes / 4));
  const at = Math.floor(fileOffset / 4);
  const shift = (fileOffset % 4) * 2;
  const previous = ((index.bitmap[at] ?? 0) >> shift) & 3;
  const next = previous === 0 || previous === type ? type : REBASE_CONFLICT;
  index.bitmap[at] =
    ((index.bitmap[at] ?? 0) & ~(3 << shift)) | (next << shift);
};

/** Interpret one bounded LC_DYLD_INFO rebase stream into file-backed membership. */
const readRebaseStream = (
  image: FixupImage,
  range: FixupCommands["rebases"][number],
  index: { bitmap: Uint8Array | null; workRemaining: number },
): void => {
  const { bytes, segments } = image;
  const end = range.offset + range.size;
  if (
    !Number.isSafeInteger(range.offset) ||
    !Number.isSafeInteger(range.size) ||
    range.offset < 0 ||
    range.size < 0 ||
    !Number.isSafeInteger(end) ||
    end > bytes.length
  )
    throw new RangeError("Rebase opcodes exceed the target");
  const cursor = { at: range.offset };
  let segmentIndex = -1;
  let segmentOffset = 0n;
  let type = 0;
  const addRun = (count: bigint, skip: bigint): void => {
    if (count === 0n) return;
    if (type === 0 || type > 3)
      throw new RangeError(`Unsupported legacy rebase type ${type}`);
    const segment = segments[segmentIndex];
    if (segment === undefined)
      throw new RangeError("Rebase location has no selected segment");
    const stride = REBASE_POINTER_SIZE + skip;
    const lastOffset = segmentOffset + (count - 1n) * stride;
    if (segmentOffset < 0n || lastOffset + REBASE_POINTER_SIZE > segment.size)
      throw new RangeError("Rebase expansion leaves its file-backed segment");
    if (!Number.isSafeInteger(segment.offset) || segment.offset < 0)
      throw new RangeError("Rebase segment file offset is invalid");
    const firstFileOffset = BigInt(segment.offset) + segmentOffset;
    if (
      firstFileOffset < 0n ||
      lastOffset + BigInt(segment.offset) + REBASE_POINTER_SIZE >
        BigInt(bytes.length)
    )
      throw new RangeError("Rebase location exceeds the source file");
    const fact = type === 1 ? REBASE_POINTER : REBASE_NON_POINTER;
    const admitted =
      count < BigInt(index.workRemaining) ? count : BigInt(index.workRemaining);
    for (let indexOffset = 0n; indexOffset < admitted; indexOffset++) {
      const fileOffset = Number(firstFileOffset + indexOffset * stride);
      markRebaseLocation(index, fileOffset, fact, bytes.length);
    }
    index.workRemaining -= Number(admitted);
    if (admitted < count)
      throw new RangeError(
        "Legacy rebase opcode and expansion work exceeded the source-derived budget",
      );
    // dyld advances after the final record too; that cursor may legally be
    // one past the segment because it is only bounds-checked on the next emit.
    segmentOffset += count * stride;
  };
  while (cursor.at < end) {
    if (index.workRemaining === 0)
      throw new RangeError(
        "Legacy rebase parsing exceeded the source-derived work budget",
      );
    index.workRemaining--;
    const byte = bytes[cursor.at++] ?? 0;
    const immediate = byte & 0x0f;
    switch (byte & 0xf0) {
      case 0x00: // REBASE_OPCODE_DONE; up to 15 trailing bytes are alignment.
        if (end - cursor.at > 15)
          throw new RangeError(
            "Rebase opcodes terminated before the stream end",
          );
        cursor.at = end;
        break;
      case 0x10: // REBASE_OPCODE_SET_TYPE_IMM
        type = immediate;
        break;
      case 0x20: {
        // REBASE_OPCODE_SET_SEGMENT_AND_OFFSET_ULEB
        if (segments[immediate] === undefined)
          throw new RangeError("Rebase segment index is out of range");
        segmentIndex = immediate;
        segmentOffset = uleb(bytes, cursor, end, "rebase", index);
        break;
      }
      case 0x30: // REBASE_OPCODE_ADD_ADDR_ULEB
        segmentOffset += uleb(bytes, cursor, end, "rebase", index);
        break;
      case 0x40: // REBASE_OPCODE_ADD_ADDR_IMM_SCALED
        segmentOffset += BigInt(immediate) * REBASE_POINTER_SIZE;
        break;
      case 0x50: // REBASE_OPCODE_DO_REBASE_IMM_TIMES
        addRun(BigInt(immediate), 0n);
        break;
      case 0x60: {
        // REBASE_OPCODE_DO_REBASE_ULEB_TIMES
        const count = uleb(bytes, cursor, end, "rebase", index);
        addRun(count, 0n);
        break;
      }
      case 0x70: {
        // REBASE_OPCODE_DO_REBASE_ADD_ADDR_ULEB
        addRun(1n, 0n);
        segmentOffset += uleb(bytes, cursor, end, "rebase", index);
        break;
      }
      case 0x80: {
        // REBASE_OPCODE_DO_REBASE_ULEB_TIMES_SKIPPING_ULEB
        const count = uleb(bytes, cursor, end, "rebase", index);
        const skip = uleb(bytes, cursor, end, "rebase", index);
        addRun(count, skip);
        break;
      }
      default:
        throw new RangeError(
          `Unsupported rebase opcode 0x${byte.toString(16)}`,
        );
    }
  }
};

/** Read loader-owned membership without interpreting a stored pointer word. */
const legacyRebaseState = (
  segments: readonly Segment[],
  membership: Uint8Array | null,
  address: bigint,
): number | Extract<PointerResolution, { readonly kind: "unsupported" }> => {
  if (membership === null) return 0;
  let fileOffset: number | undefined;
  for (const segment of segments) {
    const relative = address - segment.address;
    if (relative < 0n || relative + REBASE_POINTER_SIZE > segment.size)
      continue;
    if (fileOffset !== undefined)
      return {
        kind: "unsupported",
        reason: `Ambiguous segments map legacy rebase pointer location 0x${address.toString(16)}`,
      };
    const mapped = BigInt(segment.offset) + relative;
    if (mapped < 0n || mapped > BigInt(Number.MAX_SAFE_INTEGER))
      return {
        kind: "unsupported",
        reason: "Legacy rebase file offset exceeds the safe integer range",
      };
    fileOffset = Number(mapped);
  }
  if (fileOffset === undefined) return 0;
  const at = Math.floor(fileOffset / 4);
  const shift = (fileOffset % 4) * 2;
  return ((membership[at] ?? 0) >> shift) & 3;
};

const resolveLegacyRebase = (
  segments: readonly Segment[],
  membership: Uint8Array | null,
  address: bigint,
  raw: bigint,
): PointerResolution | undefined => {
  const state = legacyRebaseState(segments, membership, address);
  if (typeof state !== "number") return state;
  if (state === 0) return undefined;
  if (state === REBASE_POINTER) return { kind: "rebase", target: raw };
  return {
    kind: "unsupported",
    reason:
      state === REBASE_CONFLICT
        ? `Conflicting legacy rebase kinds target pointer location 0x${address.toString(16)}`
        : "Legacy non-pointer rebase is not a 64-bit metadata pointer",
  };
};

const parseLegacyRebases = (
  image: FixupImage,
  streams: FixupCommands["rebases"],
): RebaseFacts => {
  // Dyld does not require pointer alignment here, so up to one starting byte
  // per source byte is possible. Bound opcode scanning plus slot visits by 2N.
  const workBudget = Math.min(Number.MAX_SAFE_INTEGER, image.bytes.length * 2);
  const index: { bitmap: Uint8Array | null; workRemaining: number } = {
    bitmap: null,
    workRemaining: workBudget,
  };
  const failures: string[] = [];
  let decoded = 0;
  let unreadBytes = 0;
  for (const stream of streams) {
    try {
      readRebaseStream(image, stream, index);
      decoded++;
    } catch (cause: unknown) {
      failures.push(
        `rebase opcodes: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      unreadBytes += stream.size;
    }
  }
  return {
    membership: index.bitmap,
    failures,
    issues: failures.map((message) =>
      issue("pointer_fixups", "rebase_stream_decode_failed", message),
    ),
    examined: streams.length,
    decoded,
    unreadBytes,
    complete: failures.length === 0,
  };
};

const sleb = (bytes: Buffer, cursor: { at: number }, end: number): bigint => {
  let value = 0n;
  let shift = 0;
  let byte = 0;
  do {
    if (cursor.at >= end) throw new RangeError("Truncated bind opcode operand");
    byte = bytes[cursor.at++] ?? 0;
    const slice = byte & 0x7f;
    if (
      (shift === 63 && slice !== 0 && slice !== 0x7f) ||
      (shift === 64 && slice !== (value < 0n ? 0x7f : 0))
    )
      throw new RangeError("Oversized bind opcode operand");
    if (shift < 64)
      value = BigInt.asIntN(64, value | (BigInt(slice) << BigInt(shift)));
    shift = Math.min(64, shift + 7);
  } while ((byte & 0x80) !== 0);
  return shift < 64 && (byte & 0x40) !== 0
    ? value - (1n << BigInt(shift))
    : value;
};

/** Registers of the `LC_DYLD_INFO` bind state machine. */
interface BindState {
  ordinal: number;
  ordinalFailure: string | null;
  segmentIndex: number;
  symbol: SymbolName;
  weak: boolean;
  addend: bigint;
  address: bigint;
}

/** Apply a bind opcode that sets a register; false when the opcode is not one. */
const setBindRegister = (
  image: FixupImage,
  stream: { readonly cursor: { at: number }; readonly end: number },
  state: BindState,
  byte: number,
): boolean => {
  const { bytes } = image;
  const { cursor, end } = stream;
  const immediate = byte & 0x0f;
  switch (byte & 0xf0) {
    case 0x10:
      state.ordinal = immediate;
      state.ordinalFailure = null;
      return true;
    case 0x20:
      {
        const ordinal = uleb(bytes, cursor, end);
        if (ordinal > BigInt(Number.MAX_SAFE_INTEGER)) {
          state.ordinal = 0;
          state.ordinalFailure = `Dylib ordinal ${ordinal} exceeds the safe integer range`;
        } else {
          state.ordinal = Number(ordinal);
          state.ordinalFailure = null;
        }
      }
      return true;
    case 0x30:
      state.ordinal = immediate === 0 ? 0 : immediate - 16;
      state.ordinalFailure = null;
      return true;
    case 0x40: {
      const stop = bytes.indexOf(0, cursor.at);
      if (stop < 0 || stop >= end)
        throw new RangeError("Unterminated bind symbol");
      state.symbol = symbolName(bytes.subarray(cursor.at, stop));
      state.weak = (immediate & 0x1) !== 0;
      cursor.at = stop + 1;
      return true;
    }
    case 0x50:
      return true;
    case 0x60:
      state.addend = sleb(bytes, cursor, end);
      return true;
    case 0x70: {
      const segment = image.segments[immediate];
      if (segment === undefined)
        throw new RangeError("Bind segment index is out of range");
      state.segmentIndex = immediate;
      state.address = segment.address + uleb(bytes, cursor, end);
      return true;
    }
    case 0x80:
      // ULEB deltas wrap at 64 bits to encode negative steps.
      state.address =
        (state.address + uleb(bytes, cursor, end)) & 0xffffffffffffffffn;
      return true;
    default:
      return false;
  }
};

/** Interpret one `LC_DYLD_INFO` bind opcode stream into address -> import. */
const readBindStream = (
  image: FixupImage,
  range: FixupCommands["binds"][number],
  binds: BindRun[],
): void => {
  const { bytes } = image;
  const end = range.offset + range.size;
  if (end > bytes.length)
    throw new RangeError("Bind opcodes exceed the target");
  const cursor = { at: range.offset };
  const state: BindState = {
    ordinal: 0,
    ordinalFailure: null,
    segmentIndex: -1,
    symbol: { symbol: "" },
    weak: false,
    addend: 0n,
    address: 0n,
  };
  const preflightRun = (count: bigint, skip: bigint): void => {
    if (count === 0n) return;
    const segment = image.segments[state.segmentIndex];
    if (segment === undefined)
      throw new RangeError("Bind location has no selected segment");
    const stride = 8n + skip;
    const end = state.address + (count - 1n) * stride + 8n;
    if (state.address < segment.address || end > segment.address + segment.size)
      throw new RangeError("Bind expansion leaves its file-backed segment");
  };
  const bind = (count: bigint, skip: bigint): void => {
    if (count === 0n) return;
    preflightRun(count, skip);
    const stride = 8n + skip;
    let binding: BindRun["binding"];
    try {
      if (state.ordinalFailure !== null)
        throw new RangeError(state.ordinalFailure);
      const resolvedLibrary = libraryFacts(state.ordinal, image.dylibs);
      const decoded = resolvedBind(
        {
          ...state.symbol,
          binding_source: range.stream,
          library_ordinal: state.ordinal,
          ...(range.stream === "weak" ? { library: null } : resolvedLibrary),
          weak: state.weak,
          addend: state.addend,
        },
        0n,
      );
      binding =
        decoded.kind === "bind" ? { kind: "bind", value: decoded } : decoded;
    } catch (cause: unknown) {
      binding = {
        kind: "unsupported",
        reason: cause instanceof Error ? cause.message : String(cause),
      };
    }
    const previous = binds.at(-1);
    const sameBinding = (
      left: BindRun["binding"],
      right: BindRun["binding"],
    ) =>
      left.kind === "unsupported" && right.kind === "unsupported"
        ? left.reason === right.reason &&
          (left.binding === undefined || right.binding === undefined
            ? left.binding === right.binding
            : sameImport(left.binding, right.binding))
        : left.kind === "bind" && right.kind === "bind"
          ? sameImport(left.value, right.value)
          : false;
    if (
      previous !== undefined &&
      previous.stride === stride &&
      previous.start + previous.count * stride === state.address &&
      sameBinding(previous.binding, binding)
    ) {
      previous.count += count;
    } else {
      binds.push({ start: state.address, count, stride, binding });
    }
    // The dyld bind stream advances addresses modulo 64 bits; ld uses -8 to
    // bind the current pointer slot again with DO_BIND_ADD_ADDR_ULEB.
    state.address = (state.address + count * stride) & 0xffffffffffffffffn;
  };
  while (cursor.at < end) {
    const byte = bytes[cursor.at++] ?? 0;
    if (setBindRegister(image, { cursor, end }, state, byte)) continue;
    switch (byte & 0xf0) {
      case 0x00:
        // DONE separates lazy-bind entries; other streams end here.
        if (range.stream !== "lazy") return;
        break;
      case 0x90:
        bind(1n, 0n);
        break;
      case 0xa0:
        bind(1n, uleb(bytes, cursor, end));
        break;
      case 0xb0:
        bind(1n, BigInt(byte & 0x0f) * 8n);
        break;
      case 0xc0: {
        if (range.stream === "lazy")
          throw new RangeError(
            "Lazy bind streams do not support repeated bind opcodes",
          );
        const count = uleb(bytes, cursor, end);
        const skip = uleb(bytes, cursor, end);
        bind(count, skip);
        break;
      }
      default:
        throw new RangeError(`Unsupported bind opcode 0x${byte.toString(16)}`);
    }
  }
};

const resolveLegacyBind = (
  runs: readonly BindRun[],
  address: bigint,
): PointerResolution | undefined => {
  let match: BindRun | undefined;
  for (const run of runs) {
    const distance = address - run.start;
    if (
      distance >= 0n &&
      distance % run.stride === 0n &&
      distance / run.stride < run.count
    ) {
      if (match !== undefined)
        return {
          kind: "unsupported",
          reason: `Ambiguous bind records target pointer location 0x${address.toString(16)}`,
        };
      match = run;
    }
  }
  return match === undefined
    ? undefined
    : match.binding.kind === "unsupported"
      ? match.binding
      : { kind: "bind", ...match.binding.value };
};

const parseLegacyBinds = (
  image: FixupImage,
  streams: FixupCommands["binds"],
): BindFacts => {
  const runs: BindRun[] = [];
  const failures: string[] = [];
  let decoded = 0;
  for (const stream of streams) {
    try {
      readBindStream(image, stream, runs);
      decoded++;
    } catch (cause: unknown) {
      failures.push(
        `${stream.stream} bind opcodes: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
  const complete = failures.length === 0;
  const issues = failures.map((message) =>
    issue("pointer_fixups", "bind_stream_decode_failed", message),
  );
  for (const run of runs) {
    if (run.binding.kind !== "unsupported" || run.binding.binding === undefined)
      continue;
    issues.push(
      issue(
        "pointer_fixups",
        run.binding.binding.symbol === null
          ? "bind_symbol_text_unavailable"
          : "bind_library_text_unavailable",
        run.binding.reason,
        `0x${run.start.toString(16)}`,
      ),
    );
    failures.push(run.binding.reason);
  }
  return {
    runs,
    failures,
    issues,
    examined: streams.length,
    decoded,
    complete,
  };
};

/** Query retained legacy facts; never expand bind runs or read scalar padding. */
const hasUnresolvedLegacyBytes = (
  segments: readonly Segment[],
  rebases: RebaseFacts,
  binds: BindFacts,
  address: bigint,
  size: number,
): boolean => {
  if (size <= 0) return false;
  if (!rebases.complete || !binds.complete) return true;
  const first = address - 7n;
  const end = address + BigInt(size);
  for (const run of binds.runs) {
    // An eight-byte bind overlaps [address,end) exactly when its start is
    // in [address-7,end). Find the first such member without expanding it.
    const index =
      first <= run.start
        ? 0n
        : (first - run.start + run.stride - 1n) / run.stride;
    if (index < run.count && run.start + index * run.stride < end) return true;
  }
  if (rebases.membership !== null)
    for (let slot = first; slot < end; slot++) {
      const state = legacyRebaseState(segments, rebases.membership, slot);
      // Text rebases own four bytes; conflicting kinds may include a pointer.
      if (
        typeof state !== "number" ||
        state === REBASE_CONFLICT ||
        (state === REBASE_NON_POINTER && slot + 4n > address)
      )
        return true;
    }
  return false;
};

/** Build pointer decoding for one slice from its fixup load commands. */
export const parsePointerFixups = (
  bytes: Buffer,
  commands: FixupCommands,
  segments: readonly Segment[],
  baseAddress: bigint,
): PointerFixups => {
  const image = { bytes, segments, dylibs: commands.dylibs, baseAddress };
  const rebases = parseLegacyRebases(image, commands.rebases);
  const binds = parseLegacyBinds(image, commands.binds);
  if (commands.chained !== null) {
    return chainedFixups(image, commands.chained, rebases, binds);
  }
  const applicabilityFailures = [...rebases.failures, ...binds.failures];
  const applicabilityComplete = rebases.complete && binds.complete;
  const rawPointer = (raw: bigint): PointerResolution =>
    applicabilityComplete
      ? { kind: "raw", target: raw }
      : {
          kind: "unknown",
          raw,
          reason: `LC_DYLD_INFO pointer-fixup applicability was not completely decoded: ${applicabilityFailures.join("; ")}`,
        };
  if (commands.binds.length === 0 && commands.rebases.length === 0)
    return {
      kind: "none",
      formats: [],
      failures: [],
      issues: [],
      examined: 0,
      decoded: 0,
      legacyRebaseStreams: 0,
      legacyBindStreams: 0,
      unreadRebaseBytes: 0,
      hasUnresolvedLegacyBytes: () => false,
      decode: (_address, raw) => rawPointer(raw),
    };
  const failures = [...rebases.failures, ...binds.failures];
  const issues = [...rebases.issues, ...binds.issues];
  return {
    kind: "dyld-info",
    formats: [],
    failures,
    issues,
    examined: binds.examined + rebases.examined,
    decoded: binds.decoded + rebases.decoded,
    legacyRebaseStreams: rebases.examined,
    legacyBindStreams: binds.examined,
    unreadRebaseBytes: rebases.unreadBytes,
    hasUnresolvedLegacyBytes: (address, size) =>
      hasUnresolvedLegacyBytes(segments, rebases, binds, address, size),
    decode(address, raw) {
      const match = resolveLegacyBind(binds.runs, address);
      const rebase = resolveLegacyRebase(
        segments,
        rebases.membership,
        address,
        raw,
      );
      if (match?.kind === "unsupported") return match;
      if (match !== undefined && rebase !== undefined)
        return {
          kind: "unsupported",
          reason: `Both bind and rebase records target pointer location 0x${address.toString(16)}`,
        };
      if (match !== undefined && !rebases.complete)
        return {
          kind: "unknown",
          raw,
          reason: `Legacy rebase opcodes could overlap this bind location: ${rebases.failures.join("; ")}`,
        };
      if (match !== undefined) return match;
      if (rebase !== undefined && !binds.complete)
        return {
          kind: "unknown",
          raw,
          reason: `Legacy bind opcodes could overlap this rebase location: ${binds.failures.join("; ")}`,
        };
      return rebase ?? rawPointer(raw);
    },
  };
};
