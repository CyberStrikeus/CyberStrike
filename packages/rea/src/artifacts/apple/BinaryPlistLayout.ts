import { err, ok, type Result } from "../../domain/result.js";

/**
 * Preserve REA's source integer interpretation, including uint64
 * wrapping for unusual widths. Callers own byte-range and safe-number admission.
 */
export const readBinaryPlistUnsigned64 = (
  bytes: Uint8Array,
  offset: number,
  width: number,
): bigint => {
  let value = 0n;
  for (let index = 0; index < width; index += 1)
    value = BigInt.asUintN(
      64,
      (value << 8n) | BigInt(bytes[offset + index] ?? 0),
    );
  return value;
};

/** Raw declarations tied to one source or decoder-copy byte representation. */
export interface BinaryPlistLayout {
  readonly trailerOffset: number;
  readonly offsetWidth: number;
  readonly referenceWidth: number;
  readonly objectCount: bigint;
  readonly topObject: bigint;
  readonly offsetTable: bigint;
  readonly objectOffset: (object: number) => bigint;
  readonly objectOffsets: () => Generator<bigint>;
}

/** Observe declarations only; signature, bounds, capacities and reachability remain caller policy. */
export const readBinaryPlistLayout = (
  bytes: Uint8Array,
): Result<
  BinaryPlistLayout,
  { readonly _tag: "InvalidBinaryPlistLayout"; readonly reason: "truncated" }
> => {
  if (bytes.byteLength < 32)
    return err({ _tag: "InvalidBinaryPlistLayout", reason: "truncated" });
  const trailerOffset = bytes.byteLength - 32;
  const offsetWidth = bytes[trailerOffset + 6]!;
  const referenceWidth = bytes[trailerOffset + 7]!;
  const objectCount = readBinaryPlistUnsigned64(bytes, trailerOffset + 8, 8);
  const offsetTable = readBinaryPlistUnsigned64(bytes, trailerOffset + 24, 8);
  const objectOffset = (object: number): bigint =>
    readBinaryPlistUnsigned64(
      bytes,
      Number(offsetTable) + object * offsetWidth,
      offsetWidth,
    );
  return ok({
    trailerOffset,
    offsetWidth,
    referenceWidth,
    objectCount,
    topObject: readBinaryPlistUnsigned64(bytes, trailerOffset + 16, 8),
    offsetTable,
    objectOffset,
    *objectOffsets() {
      for (let object = 0; object < Number(objectCount); object += 1)
        yield objectOffset(object);
    },
  });
};
