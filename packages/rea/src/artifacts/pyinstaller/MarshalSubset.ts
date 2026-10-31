import { err, ok, type Result } from "../../domain/result.js";
import { decodeMarshalUtf8 } from "../../domain/python/marshalUtf8.js";
import {
  pyInstallerFailure,
  type PyInstallerFailure,
} from "./PyInstallerFailure.js";

const MAX_DEPTH = 16;
const MAX_NODES = 100_000;
const MAX_SEQUENCE = 100_000;
const MAX_STRING_BYTES = 65_536;
const FLAG_REF = 0x80;

/** Values the PYZ table of contents is allowed to contain. */
export type MarshalValue =
  | number
  | string
  | Uint8Array
  | readonly MarshalValue[];

interface MarshalCursor {
  readonly bytes: Buffer;
  offset: number;
  readonly refs: Array<MarshalValue | undefined>;
  depth: number;
  nodes: number;
}

/**
 * Read one marshal value using only list, tuple, str, int, and bytes.
 * Container slots are reserved before their elements so later references match
 * CPython. Any other type fails the whole value.
 */
export const readMarshalSubset = (
  bytes: Buffer,
): Result<MarshalValue, PyInstallerFailure> => {
  const cursor: MarshalCursor = {
    bytes,
    offset: 0,
    refs: [],
    depth: 0,
    nodes: 0,
  };
  const value = readObject(cursor);
  if (!value.ok) return value;
  if (cursor.offset !== bytes.length)
    return err(
      pyInstallerFailure(
        "format",
        "PYZ marshal value did not consume its table of contents",
      ),
    );
  return value;
};

const readObject = (
  cursor: MarshalCursor,
): Result<MarshalValue, PyInstallerFailure> => {
  if (cursor.depth > MAX_DEPTH || cursor.nodes >= MAX_NODES)
    return err(
      pyInstallerFailure(
        "limit",
        "PYZ marshal value exceeds the depth or object bound",
      ),
    );
  cursor.nodes += 1;
  const code = readByte(cursor);
  if (!code.ok) return code;
  const flag = (code.value & FLAG_REF) !== 0;
  const type = code.value & ~FLAG_REF;
  if (type === 0x72) return readReference(cursor);
  if (type === 0x69) return storeScalar(cursor, flag, readInt32(cursor));
  if (type === 0x6c) return storeScalar(cursor, flag, readLong(cursor));
  if (type === 0x7a || type === 0x5a)
    return storeScalar(cursor, flag, readShortAscii(cursor));
  if (type === 0x61 || type === 0x41)
    return storeScalar(cursor, flag, readCountedAscii(cursor));
  if (type === 0x74 || type === 0x75)
    return storeScalar(cursor, flag, readUtf8(cursor));
  if (type === 0x73) return storeScalar(cursor, flag, readByteString(cursor));
  if (type === 0x28) return readSequence(cursor, flag, readInt32(cursor));
  if (type === 0x29) return readSequence(cursor, flag, readByte(cursor));
  if (type === 0x5b) return readSequence(cursor, flag, readInt32(cursor));
  return err(
    pyInstallerFailure(
      "format",
      "PYZ marshal value uses a type outside the supported subset",
    ),
  );
};

const storeScalar = (
  cursor: MarshalCursor,
  flag: boolean,
  value: Result<MarshalValue, PyInstallerFailure>,
): Result<MarshalValue, PyInstallerFailure> => {
  if (!value.ok) return value;
  if (flag) cursor.refs.push(value.value);
  return value;
};

const readSequence = (
  cursor: MarshalCursor,
  flag: boolean,
  count: Result<number, PyInstallerFailure>,
): Result<MarshalValue, PyInstallerFailure> => {
  if (!count.ok) return count;
  if (count.value < 0)
    return err(
      pyInstallerFailure("format", "PYZ marshal sequence has a negative count"),
    );
  if (count.value > MAX_SEQUENCE)
    return err(
      pyInstallerFailure(
        "limit",
        "PYZ marshal sequence exceeds the supported count",
      ),
    );
  const slot = flag ? cursor.refs.length : undefined;
  if (slot !== undefined) cursor.refs.push(undefined);
  const items: MarshalValue[] = [];
  cursor.depth += 1;
  for (let index = 0; index < count.value; index += 1) {
    const item = readObject(cursor);
    if (!item.ok) return item;
    items.push(item.value);
  }
  cursor.depth -= 1;
  if (slot !== undefined) cursor.refs[slot] = items;
  return ok(items);
};

const readReference = (
  cursor: MarshalCursor,
): Result<MarshalValue, PyInstallerFailure> => {
  const index = readInt32(cursor);
  if (!index.ok) return index;
  const value = cursor.refs[index.value];
  if (value === undefined)
    return err(
      pyInstallerFailure(
        "format",
        "PYZ marshal reference does not point at a completed value",
      ),
    );
  return ok(value);
};

const readShortAscii = (
  cursor: MarshalCursor,
): Result<string, PyInstallerFailure> => {
  const length = readByte(cursor);
  if (!length.ok) return length;
  return readAsciiBytes(cursor, length.value);
};

const readCountedAscii = (
  cursor: MarshalCursor,
): Result<string, PyInstallerFailure> => {
  const length = readInt32(cursor);
  if (!length.ok) return length;
  return readAsciiBytes(cursor, length.value);
};

const readAsciiBytes = (
  cursor: MarshalCursor,
  length: number,
): Result<string, PyInstallerFailure> => {
  const bytes = readBytes(cursor, length);
  if (!bytes.ok) return bytes;
  if (bytes.value.some((byte) => byte > 0x7f))
    return err(
      pyInstallerFailure(
        "format",
        "PYZ marshal ASCII string contains a non-ASCII byte",
      ),
    );
  return ok(bytes.value.toString("ascii"));
};

const readUtf8 = (
  cursor: MarshalCursor,
): Result<string, PyInstallerFailure> => {
  const length = readInt32(cursor);
  if (!length.ok) return length;
  const bytes = readBytes(cursor, length.value);
  if (!bytes.ok) return bytes;
  const value = decodeMarshalUtf8(bytes.value);
  if (!value.ok)
    return err(
      pyInstallerFailure("format", "PYZ marshal string is not valid UTF-8"),
    );
  return ok(value.value.text);
};

const readByteString = (
  cursor: MarshalCursor,
): Result<Uint8Array, PyInstallerFailure> => {
  const length = readInt32(cursor);
  if (!length.ok) return length;
  const bytes = readBytes(cursor, length.value);
  if (!bytes.ok) return bytes;
  return ok(bytes.value);
};

const readLong = (
  cursor: MarshalCursor,
): Result<number, PyInstallerFailure> => {
  const digits = readInt32(cursor);
  if (!digits.ok) return digits;
  const count = Math.abs(digits.value);
  if (count > 8)
    return err(
      pyInstallerFailure("limit", "PYZ marshal integer exceeds the safe range"),
    );
  let magnitude = 0n;
  let mostSignificantDigit = 0;
  for (let index = 0; index < count; index += 1) {
    const digit = readUint16(cursor);
    if (!digit.ok) return digit;
    if (digit.value > 0x7fff)
      return err(
        pyInstallerFailure("format", "PYZ marshal long digit is out of range"),
      );
    mostSignificantDigit = digit.value;
    magnitude += BigInt(digit.value) << BigInt(15 * index);
  }
  if (count > 0 && mostSignificantDigit === 0)
    return err(
      pyInstallerFailure("format", "PYZ marshal long is not normalized"),
    );
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER))
    return err(
      pyInstallerFailure("limit", "PYZ marshal integer exceeds the safe range"),
    );
  const signed = digits.value < 0 ? -Number(magnitude) : Number(magnitude);
  return ok(signed);
};

const readBytes = (
  cursor: MarshalCursor,
  length: number,
): Result<Buffer, PyInstallerFailure> => {
  if (length < 0)
    return err(
      pyInstallerFailure("format", "PYZ marshal string has a negative length"),
    );
  if (!Number.isSafeInteger(length) || length > MAX_STRING_BYTES)
    return err(
      pyInstallerFailure(
        "limit",
        "PYZ marshal string exceeds the supported length",
      ),
    );
  const end = cursor.offset + length;
  if (end > cursor.bytes.length)
    return err(pyInstallerFailure("format", "PYZ marshal value is truncated"));
  const bytes = cursor.bytes.subarray(cursor.offset, end);
  cursor.offset = end;
  return ok(bytes);
};

const readByte = (
  cursor: MarshalCursor,
): Result<number, PyInstallerFailure> => {
  if (cursor.offset >= cursor.bytes.length)
    return err(pyInstallerFailure("format", "PYZ marshal value is truncated"));
  const value = cursor.bytes[cursor.offset] ?? 0;
  cursor.offset += 1;
  return ok(value);
};

const readInt32 = (
  cursor: MarshalCursor,
): Result<number, PyInstallerFailure> => {
  if (cursor.offset + 4 > cursor.bytes.length)
    return err(pyInstallerFailure("format", "PYZ marshal value is truncated"));
  const value = cursor.bytes.readInt32LE(cursor.offset);
  cursor.offset += 4;
  return ok(value);
};

const readUint16 = (
  cursor: MarshalCursor,
): Result<number, PyInstallerFailure> => {
  if (cursor.offset + 2 > cursor.bytes.length)
    return err(pyInstallerFailure("format", "PYZ marshal value is truncated"));
  const value = cursor.bytes.readUInt16LE(cursor.offset);
  cursor.offset += 2;
  return ok(value);
};
