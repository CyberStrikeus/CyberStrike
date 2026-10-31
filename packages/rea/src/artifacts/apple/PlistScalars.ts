import {
  readBinaryPlistLayout,
  readBinaryPlistUnsigned64,
  type BinaryPlistLayout,
} from "./BinaryPlistLayout.js";
import {
  createPlistNumberCollector,
  type PlistNumberLiterals,
} from "../../domain/apple/plistNumbers.js";
import { hasBinaryPlistSignature } from "../../domain/apple/appleArchiveFormat.js";

export interface BinaryPlistScalarMetadata {
  readonly literals: PlistNumberLiterals;
  /** 16-byte integers the pinned plist decoder cannot decode correctly. */
  readonly wideIntegers: readonly { offset: number; value: bigint }[];
  /** Valid date objects, retaining their exact source seconds before Date conversion. */
  readonly dates: readonly {
    readonly offset: number;
    readonly payloadOffset: number;
    readonly secondsSince2001: number;
  }[];
}

const containsSortedOffset = (
  offsets: readonly number[],
  target: number,
): boolean => {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const value = offsets[middle];
    if (value === target) return true;
    if (value === undefined || value < target) low = middle + 1;
    else high = middle;
  }
  return false;
};

export interface BinaryPlistScalarDecodePlan {
  readonly reachableDateOffsets: readonly number[];
  readonly overlappingDateOffsets: readonly number[];
  readonly reachableWideIntegerOffsets: readonly number[];
  readonly overlappingWideIntegerOffsets: readonly number[];
  readonly reachableNumericOffsets: readonly number[];
  /** Reachable UID records whose encoded width plist@5 cannot read. */
  readonly uidOffsetsToNormalize: readonly { offset: number; width: number }[];
  readonly containersToNormalize?: readonly {
    readonly offset: number;
    readonly headerLength: number;
    readonly references: readonly number[];
  }[];
  readonly normalizedOffsetSize?: number;
  readonly normalizedReferenceSize?: number;
}

/** A binary-plist UID cannot be projected to plist@5's numeric UID value exactly. */
export class UnsupportedBinaryPlistUidError extends TypeError {
  readonly _tag = "UnsupportedBinaryPlistUidError";

  constructor(
    readonly decimalValue: string,
    readonly sourceWidth: number,
  ) {
    super(
      `binary plist UID value ${decimalValue} in ${sourceWidth}-byte encoding exceeds the exact supported range`,
    );
    this.name = "UnsupportedBinaryPlistUidError";
  }
}

const readBinaryPlistUidValue = (
  bytes: Buffer,
  offset: number,
  width: number,
): bigint => {
  let value = 0n;
  for (let index = 0; index < width; index += 1)
    value = (value << 8n) | BigInt(bytes[offset + 1 + index] ?? 0);
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new UnsupportedBinaryPlistUidError(value.toString(), width);
  return value;
};

const normalizedUidWidth = (value: bigint): number =>
  value <= 0xffn ? 1 : value <= 0xffffn ? 2 : value <= 0xffffffffn ? 4 : 8;

/** Return a supported parser width when the source UID uses another width. */
export const binaryPlistUidNormalizationWidth = (
  bytes: Buffer,
  offset: number,
): number | undefined => {
  const marker = bytes[offset];
  if (marker === undefined || marker >> 4 !== 8) return undefined;
  const sourceWidth = (marker & 0x0f) + 1;
  const value = readBinaryPlistUidValue(bytes, offset, sourceWidth);
  if ([1, 2, 4, 8].includes(sourceWidth)) return undefined;
  const targetWidth = normalizedUidWidth(value);
  return targetWidth === sourceWidth ? undefined : targetWidth;
};

const binaryPlistUidRecord = (
  bytes: Buffer,
  offset: number,
  targetWidth?: number,
): Buffer => {
  const sourceWidth = (bytes[offset]! & 0x0f) + 1;
  let value = readBinaryPlistUidValue(bytes, offset, sourceWidth);
  const width = targetWidth ?? normalizedUidWidth(value);
  const record = Buffer.alloc(width + 1);
  record[0] = 0x80 | (width - 1);
  for (let byte = width - 1; byte >= 0; byte -= 1) {
    record[byte + 1] = Number(value & 0xffn);
    value >>= 8n;
  }
  return record;
};

const binaryPlistContainerRecord = (
  bytes: Buffer,
  container: {
    readonly offset: number;
    readonly headerLength: number;
    readonly references: readonly number[];
  },
  targetWidth: number,
): Buffer => {
  const record = Buffer.alloc(
    container.headerLength + container.references.length * targetWidth,
  );
  bytes.copy(
    record,
    0,
    container.offset,
    container.offset + container.headerLength,
  );
  for (let index = 0; index < container.references.length; index += 1) {
    let value = BigInt(container.references[index] ?? 0);
    for (let byte = targetWidth - 1; byte >= 0; byte -= 1) {
      record[container.headerLength + index * targetWidth + byte] = Number(
        value & 0xffn,
      );
      value >>= 8n;
    }
  }
  return record;
};

/** Select a width that can address the appended clone records and table. */
export const binaryPlistCloneOffsetWidth = (
  currentWidth: number,
  firstCloneOffset: number,
  cloneRecordLengths: readonly number[],
): number | undefined => {
  const tableOffset =
    firstCloneOffset +
    cloneRecordLengths.reduce((sum, length) => sum + length, 0);
  const widths = [1, 2, 4, 8];
  if (
    widths.includes(currentWidth) &&
    (currentWidth === 8 || tableOffset < 2 ** (currentWidth * 8))
  )
    return currentWidth;
  return widths.find((width) =>
    width === 8
      ? tableOffset <= Number.MAX_SAFE_INTEGER
      : tableOffset < 2 ** (width * 8),
  );
};

const APPLE_EPOCH_MILLISECONDS = 978_307_200_000;

/** Whether Date's millisecond projection would lose finite, in-range source seconds. */
export const binaryDateRequiresExactSeconds = (
  secondsSince2001: number,
): boolean => {
  if (!Number.isFinite(secondsSince2001)) return false;
  const date = new Date(secondsSince2001 * 1000 + APPLE_EPOCH_MILLISECONDS);
  return (
    Number.isFinite(date.getTime()) &&
    (date.getTime() - APPLE_EPOCH_MILLISECONDS) / 1000 !== secondsSince2001
  );
};

/** Return the encoded end of one bounded binary-plist object, if recognized. */
export const binaryPlistObjectEnd = (
  bytes: Buffer,
  offset: number,
  objectEnd: number,
  referenceWidth: number,
): number | undefined => {
  const marker = bytes[offset];
  if (marker === undefined) return undefined;
  const type = marker >> 4;
  let length = marker & 0x0f;
  let cursor = offset + 1;
  if (length === 0x0f && type !== 0 && type !== 8) {
    const extendedMarker = bytes[cursor];
    if (extendedMarker === undefined || extendedMarker >> 4 !== 1)
      return undefined;
    const width = 1 << (extendedMarker & 0x0f);
    if (width > 8 || cursor + 1 + width > objectEnd) return undefined;
    cursor += 1;
    const extendedLength = readBinaryPlistUnsigned64(bytes, cursor, width);
    if (extendedLength > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    length = Number(extendedLength);
    cursor += width;
  }
  let payloadLength: number;
  if (type === 0) payloadLength = 0;
  else if (type === 1 || type === 2) {
    if ((marker & 0x0f) > 4) return undefined;
    payloadLength = 1 << (marker & 0x0f);
  } else if (type === 3) {
    // Apple's date scalar is exactly type 3, info 3, followed by Float64.
    if (marker !== 0x33) return undefined;
    payloadLength = 8;
  } else if (type === 4 || type === 5 || type === 7) {
    payloadLength = length;
  } else if (type === 6) {
    payloadLength = length * 2;
  } else if (type === 8) {
    payloadLength = (marker & 0x0f) + 1;
  } else if (type === 10 || type === 11 || type === 12) {
    payloadLength = length * referenceWidth;
  } else if (type === 13) {
    payloadLength = length * 2 * referenceWidth;
  } else return undefined;
  const end = cursor + payloadLength;
  return Number.isSafeInteger(end) && end <= objectEnd ? end : undefined;
};

/** Observe bounded binary scalar markers before parser conversion loses source facts. */
export const scanBinaryPlistScalars = (
  bytes: Buffer,
  scalarPlan?: BinaryPlistScalarDecodePlan,
): BinaryPlistScalarMetadata => {
  const output = createPlistNumberCollector();
  const wideIntegers: { offset: number; value: bigint }[] = [];
  const dates: {
    offset: number;
    payloadOffset: number;
    secondsSince2001: number;
  }[] = [];
  const result = (incomplete: boolean): BinaryPlistScalarMetadata => ({
    literals: output.result(incomplete),
    wideIntegers,
    dates,
  });
  if (bytes.length < 40 || !hasBinaryPlistSignature(bytes)) return result(true);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sourceLayoutResult = readBinaryPlistLayout(bytes);
  if (!sourceLayoutResult.ok) return result(true);
  const sourceLayout = sourceLayoutResult.value;
  const {
    trailerOffset: trailer,
    offsetWidth,
    referenceWidth,
    objectCount: countRaw,
    offsetTable: tableRaw,
  } = sourceLayout;
  if (offsetWidth < 1) return result(true);
  const safeMaximum = BigInt(Number.MAX_SAFE_INTEGER);
  if (countRaw === 0n || countRaw > safeMaximum || tableRaw > safeMaximum)
    return result(true);
  if (tableRaw < 8n || tableRaw >= BigInt(trailer)) return result(true);
  const offsetTable = Number(tableRaw);
  const capacity = Math.floor((trailer - offsetTable) / offsetWidth);
  if (countRaw > BigInt(capacity)) return result(true);
  const count = Number(countRaw);
  if (referenceWidth < 1) return result(true);
  const objectOffsets: number[] = [];
  let incomplete = false;
  for (let index = 0; index < count; index += 1) {
    const rawOffset = sourceLayout.objectOffset(index);
    const offset = rawOffset > safeMaximum ? undefined : Number(rawOffset);
    if (offset === undefined || offset < 8 || offset >= offsetTable) {
      incomplete = true;
      continue;
    }
    objectOffsets.push(offset);
  }
  const sortedOffsets = [...new Set(objectOffsets)].sort((a, b) => a - b);
  const validOffsets = new Set<number>();
  for (const offset of sortedOffsets) {
    const encodedEnd = binaryPlistObjectEnd(
      bytes,
      offset,
      trailer,
      referenceWidth,
    );
    if (encodedEnd === undefined) {
      incomplete = true;
      continue;
    }
    validOffsets.add(offset);
  }
  const visitedOffsets = new Set<number>();
  for (const offset of objectOffsets) {
    if (!visitedOffsets.has(offset)) {
      const marker = bytes[offset] ?? 0;
      if (
        marker === 0x33 &&
        offset + 9 <= offsetTable &&
        (scalarPlan === undefined ||
          containsSortedOffset(scalarPlan.reachableDateOffsets, offset))
      ) {
        const payloadOffset = offset + 1;
        dates.push({
          offset,
          payloadOffset,
          secondsSince2001: view.getFloat64(payloadOffset),
        });
      }
    }
    if (!validOffsets.has(offset)) {
      incomplete = true;
      continue;
    }
    // Several table entries may share one record. Its source facts are
    // identical for every entry, so observe them once.
    if (visitedOffsets.has(offset)) continue;
    visitedOffsets.add(offset);
    const marker = bytes[offset] ?? 0;
    const type = marker >> 4;
    if (type === 3 && marker === 0x33) {
      continue;
    }
    if (type !== 1 && type !== 2) continue;
    const width = 2 ** (marker & 0xf);
    if (offset + 1 + width > offsetTable) incomplete = true;
    if (offset + 1 + width > offsetTable) continue;
    const isReachable =
      scalarPlan === undefined ||
      containsSortedOffset(scalarPlan.reachableNumericOffsets, offset);
    if (type === 1 && width === 8) {
      const value = view.getBigInt64(offset + 1);
      if (isReachable) output.integer(value);
    } else if (type === 1 && width === 16) {
      const value = BigInt.asIntN(
        128,
        (view.getBigUint64(offset + 1) << 64n) | view.getBigUint64(offset + 9),
      );
      if (isReachable) {
        output.integer(value);
        if (
          scalarPlan === undefined ||
          containsSortedOffset(scalarPlan.reachableWideIntegerOffsets, offset)
        )
          wideIntegers.push({ offset, value });
      }
    } else if (type === 1 && width > 4) {
      incomplete = true;
    } else if (type === 2 && width === 4) {
      const value = view.getFloat32(offset + 1);
      if (isReachable) output.real(value);
    } else if (type === 2 && width === 8) {
      const value = view.getFloat64(offset + 1);
      if (isReachable) output.real(value);
    } else if (type === 2) {
      incomplete = true;
    }
  }
  return result(incomplete);
};

/** Preserve source scalars through plist@5's lossy Number and Date parser. */
export const decodeBinaryPlistScalars = (
  bytes: Buffer,
  metadata: BinaryPlistScalarMetadata,
  scalarPlan: BinaryPlistScalarDecodePlan,
): Buffer => {
  const reachableDateOffsets = new Set(scalarPlan.reachableDateOffsets);
  const overlappingDateOffsets = new Set(scalarPlan.overlappingDateOffsets);
  const reachableWideIntegerOffsets = new Set(
    scalarPlan.reachableWideIntegerOffsets,
  );
  const overlappingWideIntegerOffsets = new Set(
    scalarPlan.overlappingWideIntegerOffsets,
  );
  const unrepresentableDates = metadata.dates.filter(
    ({ offset, secondsSince2001 }) =>
      reachableDateOffsets.has(offset) &&
      binaryDateRequiresExactSeconds(secondsSince2001),
  );
  const reachableWideIntegers = metadata.wideIntegers.filter(({ offset }) =>
    reachableWideIntegerOffsets.has(offset),
  );
  const replacements = new Map<number, Buffer>();
  for (const { offset, width } of scalarPlan.uidOffsetsToNormalize)
    replacements.set(offset, binaryPlistUidRecord(bytes, offset, width));
  for (const { offset } of unrepresentableDates)
    if (overlappingDateOffsets.has(offset)) {
      const replacement = Buffer.from(bytes.subarray(offset, offset + 9));
      replacement.writeDoubleBE(Number.NaN, 1);
      replacements.set(offset, replacement);
    }
  for (const { offset, value } of reachableWideIntegers)
    if (overlappingWideIntegerOffsets.has(offset)) {
      const replacement = Buffer.alloc(9);
      replacement[0] = 0x23;
      replacement.writeDoubleBE(Number(value), 1);
      replacements.set(offset, replacement);
    }
  const sourceLayoutResult = readBinaryPlistLayout(bytes);
  if (!sourceLayoutResult.ok)
    throw new RangeError("binary plist trailer is truncated");
  const sourceLayout = sourceLayoutResult.value;
  const sourceReferenceSize = sourceLayout.referenceWidth;
  const normalizedReferenceSize =
    scalarPlan.normalizedReferenceSize ?? sourceReferenceSize;
  for (const container of scalarPlan.containersToNormalize ?? [])
    replacements.set(
      container.offset,
      binaryPlistContainerRecord(bytes, container, normalizedReferenceSize),
    );
  const needsTableNormalization =
    (scalarPlan.normalizedOffsetSize ?? sourceLayout.offsetWidth) !==
      sourceLayout.offsetWidth ||
    normalizedReferenceSize !== sourceReferenceSize;
  if (
    reachableWideIntegers.length === 0 &&
    unrepresentableDates.length === 0 &&
    replacements.size === 0 &&
    !needsTableNormalization
  )
    return bytes;
  const compatible =
    replacements.size === 0 && !needsTableNormalization
      ? Buffer.from(bytes)
      : cloneBinaryPlistObjects(
          bytes,
          sourceLayout,
          replacements,
          scalarPlan.normalizedOffsetSize ?? sourceLayout.offsetWidth,
          normalizedReferenceSize,
        );
  for (const { offset, value } of reachableWideIntegers) {
    if (overlappingWideIntegerOffsets.has(offset)) continue;
    // Convert only the decoder's input copy to a double. Exact integer metadata
    // from the original bytes restores decimal text after the structural parse.
    compatible[offset] = 0x23;
    compatible.writeDoubleBE(Number(value), offset + 1);
  }
  // NaN becomes the existing explicit unknown-date projection. Only the private
  // decode copy changes; scanner metadata retains the original Float64 seconds.
  for (const { offset, payloadOffset } of unrepresentableDates) {
    if (!overlappingDateOffsets.has(offset))
      compatible.writeDoubleBE(Number.NaN, payloadOffset);
  }
  return compatible;
};

const cloneBinaryPlistObjects = (
  bytes: Buffer,
  sourceLayout: BinaryPlistLayout,
  replacements: ReadonlyMap<number, Buffer>,
  normalizedOffsetSize?: number,
  normalizedReferenceSize?: number,
): Buffer => {
  const trailerOffset = sourceLayout.trailerOffset;
  const offsetSize = sourceLayout.offsetWidth;
  const objectCount = Number(sourceLayout.objectCount);
  const offsets = [...sourceLayout.objectOffsets()];
  const cloneEntries = [...replacements.entries()];
  const replacementLengths = cloneEntries.map(([, record]) => record.length);
  const newOffsetSize =
    normalizedOffsetSize ??
    binaryPlistCloneOffsetWidth(offsetSize, trailerOffset, replacementLengths);
  if (newOffsetSize === undefined)
    throw new RangeError(
      "binary plist cloned scalar offset exceeds supported width",
    );
  // Preserve every source offset, including objects after the old table. The
  // decoder copy keeps the old table as inert bytes and appends a new one.
  const cloneStart = trailerOffset;
  const cloneBytes = replacementLengths.reduce(
    (sum, length) => sum + length,
    0,
  );
  const newTableOffset = cloneStart + cloneBytes;
  const newLength = bytes.length + cloneBytes + objectCount * newOffsetSize;
  if (!Number.isSafeInteger(newLength))
    throw new RangeError(
      "binary plist cloned scalar representation is too large",
    );
  const compatible = Buffer.alloc(newLength);
  bytes.copy(compatible, 0, 0, trailerOffset);
  const cloneOffsetBySource = new Map<number, bigint>();
  let cloneCursor = cloneStart;
  cloneEntries.forEach(([sourceOffset, replacement]) => {
    const cloneOffset = cloneCursor;
    cloneOffsetBySource.set(sourceOffset, BigInt(cloneOffset));
    replacement.copy(compatible, cloneOffset);
    cloneCursor += replacement.length;
  });
  const tableStart = newTableOffset;
  const tableEnd = tableStart + objectCount * newOffsetSize;
  offsets.forEach((sourceOffset, index) => {
    const sourceNumber =
      sourceOffset <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(sourceOffset)
        : undefined;
    let value =
      sourceNumber === undefined
        ? sourceOffset
        : (cloneOffsetBySource.get(sourceNumber) ?? sourceOffset);
    for (let byte = newOffsetSize - 1; byte >= 0; byte -= 1) {
      compatible[tableStart + index * newOffsetSize + byte] = Number(
        value & 0xffn,
      );
      value >>= 8n;
    }
  });
  const trailer = Buffer.from(bytes.subarray(trailerOffset));
  trailer[6] = newOffsetSize;
  if (normalizedReferenceSize !== undefined)
    trailer[7] = normalizedReferenceSize;
  trailer.writeBigUInt64BE(BigInt(newTableOffset), 24);
  trailer.copy(compatible, tableEnd);
  return compatible;
};
