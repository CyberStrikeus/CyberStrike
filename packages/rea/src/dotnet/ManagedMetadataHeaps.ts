import type { ManagedParseIssue } from "../domain/managed/managedArtifact.js";
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../domain/result.js";

import { managedDecodeBudget } from "./ManagedDecodeBudget.js";

import {
  metadataRowOffset,
  type ManagedMetadataLayout,
} from "./ManagedMetadataLayout.js";
import { managedFailure } from "./ManagedReaderFailure.js";

/** Cursor for checked fixed-width metadata row decoding. */
export class MetadataRowCursor {
  #offset: number;

  constructor(
    private readonly bytes: Buffer,
    readonly start: number,
    private readonly end: number,
    private readonly scope: string,
  ) {
    this.#offset = start;
  }

  get offset(): number {
    return this.#offset;
  }

  readUInt16(): number {
    this.require(2);
    const value = this.bytes.readUInt16LE(this.#offset);
    this.#offset += 2;
    return value;
  }

  readUInt32(): number {
    this.require(4);
    const value = this.bytes.readUInt32LE(this.#offset);
    this.#offset += 4;
    return value;
  }

  readIndex(size: 2 | 4): number {
    return size === 2 ? this.readUInt16() : this.readUInt32();
  }

  private require(length: number): void {
    if (this.#offset < this.start || this.#offset > this.end - length)
      throw managedFailure(
        "invalid-row",
        this.scope,
        `${this.scope} row ended before all declared columns`,
        this.#offset,
      );
  }
}

interface ManagedCompressedUnsigned {
  readonly value: number;
  readonly width: 1 | 2 | 4;
  readonly minimal: boolean;
}

type ManagedCompressedUnsignedFailure =
  | { readonly kind: "truncated"; readonly width: 1 | 2 | 4 }
  | { readonly kind: "reserved" };

/** ECMA-335 unsigned encoding facts, without heap or signature admission policy. */
export const readManagedCompressedUnsigned = (
  bytes: Buffer,
  offset: number,
): Result<ManagedCompressedUnsigned, ManagedCompressedUnsignedFailure> => {
  const first = bytes[offset];
  if (first === undefined) return err({ kind: "truncated", width: 1 });
  if ((first & 0x80) === 0)
    return ok({ value: first, width: 1, minimal: true });
  const width =
    (first & 0xc0) === 0x80 ? 2 : (first & 0xe0) === 0xc0 ? 4 : null;
  if (width === null) return err({ kind: "reserved" });
  if (offset > bytes.length - width) return err({ kind: "truncated", width });
  const value =
    width === 2
      ? ((first & 0x3f) << 8) | (bytes[offset + 1] ?? 0)
      : (first & 0x1f) * 0x01_00_00_00 +
        (bytes[offset + 1] ?? 0) * 0x01_00_00 +
        (bytes[offset + 2] ?? 0) * 0x0100 +
        (bytes[offset + 3] ?? 0);
  return ok({ value, width, minimal: value >= (width === 2 ? 0x80 : 0x4000) });
};

// Issue code and label for the heap item a compressed length prefixes.
const PREFIXED_ITEMS = {
  blob: { code: "invalid-blob", label: "Metadata blob" },
  userString: { code: "invalid-string", label: "User string" },
} as const;

const compressedLength = (
  bytes: Buffer,
  offset: number,
  scope: string,
  item: keyof typeof PREFIXED_ITEMS,
): {
  readonly length: number;
  readonly prefix: number;
  /** Whether ECMA-335 II.23.2 assigns this width to the value. */
  readonly minimal: boolean;
} => {
  const { code, label } = PREFIXED_ITEMS[item];
  const decoded = readManagedCompressedUnsigned(bytes, offset);
  if (!decoded.ok)
    throw managedFailure(
      code,
      scope,
      decoded.error.kind === "truncated"
        ? `${label} length prefix leaves the artifact byte range`
        : `${label} uses a reserved compressed-length prefix`,
      offset >= 0 ? offset : null,
    );
  return {
    length: decoded.value.value,
    prefix: decoded.value.width,
    minimal: decoded.value.minimal,
  };
};

/** Read one UTF-8 value from #Strings within its PE/CLI stream extent. */
export const readMetadataString = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  index: number,
  heapExtent: number,
): string => {
  if (index === 0) return "";
  if (index < 0 || index >= layout.strings.size)
    throw managedFailure(
      "invalid-heap-index",
      "metadata.#Strings",
      "String heap index is outside #Strings",
      layout.strings.offset + Math.max(index, 0),
    );
  const start = layout.strings.offset + index;
  const cached = managedDecodeBudget(layout).cachedString(index);
  if (cached !== undefined && cached.encodedBytes <= heapExtent) {
    return cached.value;
  }
  const maximum = Math.min(
    layout.strings.offset + layout.strings.size,
    start + heapExtent + 1,
  );
  let end = start;
  while (end < maximum && bytes[end] !== 0) end += 1;
  if (end === maximum)
    throw managedFailure(
      "invalid-string",
      "metadata.#Strings",
      "String heap item has no terminator within #Strings",
      start,
    );
  managedDecodeBudget(layout).reserveString(end - start, start);
  try {
    const value = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes.subarray(start, end));
    managedDecodeBudget(layout).cacheString(index, value, end - start);
    return value;
  } catch (cause: unknown) {
    void cause;
    throw managedFailure(
      "invalid-string",
      "metadata.#Strings",
      "String heap item is not valid UTF-8",
      start,
    );
  }
};

/** Read one #Blob item while validating its encoded extent against the heap. */
export const readMetadataBlob = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  index: number,
  heapExtent: number,
): Buffer => {
  if (index === 0) return Buffer.alloc(0);
  if (index < 0)
    throw managedFailure(
      "invalid-heap-index",
      "metadata.#Blob",
      "Blob heap index is negative",
      null,
    );
  const heap = layout.blob;
  if (heap === null)
    throw managedFailure(
      "missing-stream",
      "metadata.#Blob",
      `Blob index ${String(index)} references an absent #Blob stream`,
      null,
    );
  if (index >= heap.size)
    throw managedFailure(
      "invalid-heap-index",
      "metadata.#Blob",
      "Blob heap index is outside #Blob",
      heap.offset + Math.max(index, 0),
    );
  const start = heap.offset + index;
  const decoded = compressedLength(bytes, start, "metadata.#Blob", "blob");
  if (decoded.length > heapExtent)
    throw managedFailure(
      "invalid-blob",
      "metadata.#Blob",
      "Blob length exceeds the admitted heap extent",
      start,
    );
  const content = start + decoded.prefix;
  if (content > heap.offset + heap.size - decoded.length)
    throw managedFailure(
      "invalid-blob",
      "metadata.#Blob",
      "Blob heap item leaves #Blob",
      start,
    );
  return bytes.subarray(content, content + decoded.length);
};

/**
 * Read the #US literal named by a `0x70` user-string token: a compressed byte
 * length, UTF-16LE code units, then one ECMA-335 terminal flag byte. Code units
 * are kept as stored, including unpaired surrogates. `parseUserStrings` owns
 * which `ldstr` operands are user-string tokens.
 */
export const readMetadataUserString = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  reference: Pick<MetadataTokenFact, "token" | "row">,
): {
  readonly offset: number;
  readonly value: string;
  /** Conformance differences observed beside the readable literal. */
  readonly issues: readonly ManagedParseIssue[];
} => {
  const { token, row: index } = reference;
  const heap = layout.userStrings;
  const scope = `metadata.#US:${token}`;
  if (heap === null)
    throw managedFailure(
      "missing-stream",
      scope,
      "ldstr references #US, but the metadata has no #US stream",
    );
  if (index >= heap.size)
    throw managedFailure(
      "invalid-heap-index",
      scope,
      "ldstr operand does not name an item inside #US",
      heap.offset + index,
    );
  const start = heap.offset + index;
  const decoded = compressedLength(bytes, start, scope, "userString");
  const content = start + decoded.prefix;
  if (content > heap.offset + heap.size - decoded.length)
    throw managedFailure(
      "invalid-string",
      scope,
      "User string leaves #US",
      start,
    );
  const budget = managedDecodeBudget(layout);
  // A wider length prefix than the value needs still reads unambiguously, so
  // it is reported like the flag rather than discarding the literal. It is
  // admitted only on paths that return the literal, so a fatal item leaves
  // no budget behind.
  const conformance = (): ManagedParseIssue[] => {
    if (decoded.minimal) return [];
    budget.reserve(512, start);
    return [
      {
        code: "invalid-string",
        scope,
        offset: start,
        detail: `User string length ${String(decoded.length)} uses a ${String(decoded.prefix)}-byte prefix wider than ECMA-335 II.23.2 assigns; readable UTF-16 is preserved and runtime acceptance is not assessed`,
      },
    ];
  };
  // ECMA-335 II.24.2.4: offset 0 is the heap's empty entry, a zero length
  // with no terminal flag byte; every other item carries the flag.
  if (index === 0) {
    if (decoded.length === 0)
      return { offset: start, value: "", issues: conformance() };
    throw managedFailure(
      "invalid-string",
      scope,
      `#US offset 0 is the reserved empty entry, but it encodes ${String(decoded.length)} byte(s)`,
      start,
    );
  }
  if (decoded.length % 2 !== 1)
    throw managedFailure(
      "invalid-string",
      scope,
      "User string length is not UTF-16 code units plus one terminal flag byte",
      start,
    );
  const units = (decoded.length - 1) / 2;
  // Admit the literal before scanning it: JSON spends at most six bytes per
  // UTF-16 code unit.
  budget.reserveString(units, start);
  // Check the serialized flag independently of literal decoding. A difference
  // from ECMA-335 is observable metadata, not proof of runtime rejection.
  let expectedFlag = 0;
  for (let unitIndex = 0; unitIndex < units; unitIndex++) {
    const unit = bytes.readUInt16LE(content + unitIndex * 2);
    if (
      unit > 0xff ||
      (unit >= 0x01 && unit <= 0x08) ||
      (unit >= 0x0e && unit <= 0x1f) ||
      unit === 0x27 ||
      unit === 0x2d ||
      unit === 0x7f
    ) {
      expectedFlag = 1;
      break;
    }
  }
  const flagOffset = content + units * 2;
  const actualFlag = bytes[flagOffset];
  const issues = conformance();
  if (actualFlag !== expectedFlag) {
    budget.reserve(512, flagOffset);
    issues.push({
      code: "invalid-string",
      scope,
      offset: flagOffset,
      detail: `User string terminal flag ${String(actualFlag)} differs from ECMA-335 II.24.2.4 value ${String(expectedFlag)}; readable UTF-16 is preserved and runtime acceptance is not assessed`,
    });
  }
  return {
    offset: start,
    value: bytes.subarray(content, flagOffset).toString("utf16le"),
    issues,
  };
};

/** Read one conventional GUID value from the one-based #GUID heap. */
export const readMetadataGuid = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  index: number,
): string | null => {
  if (index === 0) return null;
  const relative = (index - 1) * 16;
  if (relative < 0 || relative > layout.guid.size - 16)
    throw managedFailure(
      "invalid-guid",
      "metadata.#GUID",
      "GUID heap index is outside #GUID",
      layout.guid.offset + Math.max(relative, 0),
    );
  const offset = layout.guid.offset + relative;
  const part1 = bytes.readUInt32LE(offset).toString(16).padStart(8, "0");
  const part2 = bytes
    .readUInt16LE(offset + 4)
    .toString(16)
    .padStart(4, "0");
  const part3 = bytes
    .readUInt16LE(offset + 6)
    .toString(16)
    .padStart(4, "0");
  const part4 = bytes.subarray(offset + 8, offset + 10).toString("hex");
  const part5 = bytes.subarray(offset + 10, offset + 16).toString("hex");
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
};

/** Format one metadata table/row pair as an exact build-local token. */
export const metadataToken = (table: number, row: number): string =>
  `0x${(table * 0x01_00_00_00 + row).toString(16).padStart(8, "0")}`;

/** Full-token coordinates do not establish that a table row or heap item exists. */
export interface MetadataTokenFact {
  readonly raw: number;
  readonly table: number;
  readonly row: number;
  readonly token: string;
}

export const metadataTokenFact = (raw: number): MetadataTokenFact => {
  const table = raw >>> 24;
  const row = raw & 0x00ff_ffff;
  return { raw, table, row, token: metadataToken(table, row) };
};

/** Hash bytes without exposing their contents. */
export const sha256Bytes = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Create a cursor bounded to one admitted metadata table row. */
export const metadataRowCursor = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  table: number,
  row: number,
): MetadataRowCursor => {
  const descriptor = layout.table(table);
  const start = metadataRowOffset(layout, table, row);
  if (descriptor === undefined)
    throw managedFailure(
      "invalid-row",
      `metadata.${String(table)}`,
      "Metadata table is absent",
      start,
    );
  // Temporary cursors may revisit a row while resolving owners or references.
  // Bind fixed retained bookkeeping to that row's identity, not each lookup.
  managedDecodeBudget(layout).reserveRow(table, row, start);
  return new MetadataRowCursor(
    bytes,
    start,
    start + descriptor.rowSize,
    `metadata.${descriptor.name}`,
  );
};

/** Format coordinates do not establish that the selected metadata row exists. */
export interface MetadataCodedIndexCoordinate {
  readonly table: number | undefined;
  readonly row: number;
}

export const metadataCodedIndexCoordinate = (
  raw: number,
  bits: number,
  tables: readonly (number | undefined)[],
): MetadataCodedIndexCoordinate & { readonly tag: number } => {
  const tag = raw & (2 ** bits - 1);
  return { tag, table: tables[tag], row: Math.floor(raw / 2 ** bits) };
};

export type ManagedCodedIndex =
  | { readonly kind: "null" }
  | {
      readonly kind: "valid";
      readonly token: string;
      readonly table: number;
      readonly row: number;
    }
  | {
      readonly kind: "invalid";
      readonly reason: string;
      readonly table: number | undefined;
      readonly row: number;
    };

/** Decode and validate a metadata coded index without signed row coercion. */
export const decodeMetadataCodedIndex = (
  raw: number,
  bits: number,
  tables: readonly (number | undefined)[],
  rowCounts: readonly number[],
): ManagedCodedIndex => {
  if (raw === 0) return { kind: "null" };
  const { tag, table, row } = metadataCodedIndexCoordinate(raw, bits, tables);
  if (table === undefined)
    return {
      kind: "invalid",
      reason: `coded index tag ${tag} is not defined`,
      table,
      row,
    };
  if (row === 0)
    return {
      kind: "invalid",
      reason: `coded index selects row zero in table ${table}`,
      table,
      row,
    };
  const count = rowCounts[table] ?? 0;
  if (row > count)
    return {
      kind: "invalid",
      reason: `coded index selects row ${row} in table ${table}, which has ${count} rows`,
      table,
      row,
    };
  return { kind: "valid", token: metadataToken(table, row), table, row };
};
