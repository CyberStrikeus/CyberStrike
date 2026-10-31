import type { ManagedFieldConstant } from "../domain/managed/managedFieldConstant.js";
import { managedFailure } from "./ManagedReaderFailure.js";

type Scalar = ManagedFieldConstant["value"];
type ScalarReader = (bytes: Buffer, scope: string, offset: number) => Scalar;

const booleanValue: ScalarReader = (bytes, scope, offset) => {
  if (bytes[0] !== 0 && bytes[0] !== 1)
    throw managedFailure(
      "invalid-blob",
      scope,
      "Boolean Constant must encode zero or one.",
      offset,
    );
  return bytes[0] === 1;
};

const nullReference: ScalarReader = (bytes, scope, offset) => {
  if (bytes.readUInt32LE() !== 0)
    throw managedFailure(
      "invalid-blob",
      scope,
      "Class Constant must encode a four-byte null reference.",
      offset,
    );
  return null;
};

const jsonFloat = (value: number): number | string =>
  Object.is(value, -0) ? "-0" : Number.isFinite(value) ? value : String(value);

interface ConstantEncoding {
  readonly name: NonNullable<ManagedFieldConstant["element_type"]>;
  /** Null is a sequence of UTF-16 code units rather than a fixed-width scalar. */
  readonly bytes: number | null;
  readonly read: ScalarReader;
}

/** Each type owns its name, admitted width and decoder in one place. */
const CONSTANT_TYPES: Readonly<Record<number, ConstantEncoding>> = {
  0x02: { name: "boolean", bytes: 1, read: booleanValue },
  0x03: {
    name: "char",
    bytes: 2,
    read: (b) => String.fromCharCode(b.readUInt16LE()),
  },
  0x04: { name: "i1", bytes: 1, read: (b) => b.readInt8() },
  0x05: { name: "u1", bytes: 1, read: (b) => b.readUInt8() },
  0x06: { name: "i2", bytes: 2, read: (b) => b.readInt16LE() },
  0x07: { name: "u2", bytes: 2, read: (b) => b.readUInt16LE() },
  0x08: { name: "i4", bytes: 4, read: (b) => b.readInt32LE() },
  0x09: { name: "u4", bytes: 4, read: (b) => b.readUInt32LE() },
  0x0a: { name: "i8", bytes: 8, read: (b) => b.readBigInt64LE().toString() },
  0x0b: { name: "u8", bytes: 8, read: (b) => b.readBigUInt64LE().toString() },
  0x0c: { name: "r4", bytes: 4, read: (b) => jsonFloat(b.readFloatLE()) },
  0x0d: { name: "r8", bytes: 8, read: (b) => jsonFloat(b.readDoubleLE()) },
  0x0e: { name: "string", bytes: null, read: (b) => b.toString("utf16le") },
  0x12: { name: "class", bytes: 4, read: nullReference },
};

export const managedConstantType = (
  code: number,
): ManagedFieldConstant["element_type"] => CONSTANT_TYPES[code]?.name ?? null;

/** ECMA-335 II.22.9/II.23.1.16; preserve wide integers and float encodings exactly. */
export const decodeManagedConstantValue = (
  code: number,
  bytes: Buffer,
  scope: string,
  offset: number,
): Scalar => {
  const encoding = CONSTANT_TYPES[code];
  if (encoding === undefined)
    throw managedFailure(
      "unsupported-metadata",
      scope,
      `Unsupported Constant element type 0x${code.toString(16)}.`,
      offset,
    );
  if (
    encoding.bytes === null
      ? bytes.length % 2 !== 0
      : bytes.length !== encoding.bytes
  )
    throw managedFailure(
      "invalid-blob",
      scope,
      `Constant ${encoding.name} has an invalid encoded byte length.`,
      offset,
    );
  return encoding.read(bytes, scope, offset);
};
