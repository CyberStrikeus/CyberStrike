import { err, ok, type Result } from "../result.js";

/** ":" + count + address + type + 255 data bytes + checksum, excluding EOL. */
export const INTEL_HEX_MAX_LINE_CHARS = 521;
/** "S" + type + count + 255 counted bytes, excluding EOL. */
export const SREC_MAX_LINE_CHARS = 514;

export type HexRecordEncoding = "intel-hex" | "srec";

/** One checksum-valid record; `type` is "00".."05" or "S0".."S9". */
export interface HexRecord {
  readonly type: string;
  readonly address: number;
  readonly data: Uint8Array;
}

export const LF = 0x0a;
export const CR = 0x0d;
export const COLON = 0x3a;
export const LETTER_S = 0x53;
const INTEL_FIXED_DATA_BYTES: readonly (number | undefined)[] = [
  undefined,
  0,
  2,
  4,
  2,
  4,
];
const SREC_ADDRESS_BYTES: readonly (number | undefined)[] = [
  2,
  2,
  3,
  4,
  undefined,
  2,
  3,
  4,
  3,
  2,
];
/** Highest address each S-record data type can reach. */
export const SREC_DATA_LIMITS: Readonly<Record<string, number>> = {
  S1: 0xffff,
  S2: 0xff_ffff,
  S3: 0xffff_ffff,
};
/** File variant implied by each data and termination record type. */
export const SREC_WIDTH_OF: Readonly<Record<string, string>> = {
  S1: "S19",
  S2: "S28",
  S3: "S37",
  S9: "S19",
  S8: "S28",
  S7: "S37",
};
const HEX_VALUES = ((): Int8Array => {
  const table = new Int8Array(256).fill(-1);
  for (const [value, digit] of [..."0123456789abcdef"].entries()) {
    table[digit.charCodeAt(0)] = value;
    table[digit.toUpperCase().charCodeAt(0)] = value;
  }
  return table;
})();

export const hex = (value: number, digits: number): string =>
  value.toString(16).padStart(digits, "0");

export const readBigEndian = (bytes: Uint8Array): number =>
  bytes.reduce((value, byte) => value * 256 + byte, 0);

export const maxLineChars = (encoding: HexRecordEncoding): number =>
  encoding === "intel-hex" ? INTEL_HEX_MAX_LINE_CHARS : SREC_MAX_LINE_CHARS;

export const trimTrailingBlanks = (
  line: Uint8Array,
  length: number,
): number => {
  let end = length;
  while (end > 0 && (line[end - 1] === 0x20 || line[end - 1] === 0x09))
    end -= 1;
  return end;
};

const decodeHexDigits = (
  line: Uint8Array,
  from: number,
): Result<Uint8Array, string> => {
  for (let column = from; column < line.length; column += 1)
    if (HEX_VALUES[line[column] ?? 0] === -1)
      return err(
        `invalid character 0x${hex(line[column] ?? 0, 2)} at column ${String(column + 1)}`,
      );
  if ((line.length - from) % 2 !== 0)
    return err(`odd number of hex digits (${String(line.length - from)})`);
  const bytes = new Uint8Array((line.length - from) / 2);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] =
      (HEX_VALUES[line[from + index * 2] ?? 0] ?? 0) * 16 +
      (HEX_VALUES[line[from + index * 2 + 1] ?? 0] ?? 0);
  return ok(bytes);
};

const byteSum = (bytes: Uint8Array): number =>
  bytes.reduce((sum, byte) => sum + byte, 0);

const startCharacterFailure = (line: Uint8Array, expected: string): string =>
  `invalid character 0x${hex(line[0] ?? 0, 2)} at column 1; a record starts with '${expected}'`;

const parseIntelRecord = (line: Uint8Array): Result<HexRecord, string> => {
  if (line[0] !== COLON) return err(startCharacterFailure(line, ":"));
  const decoded = decodeHexDigits(line, 1);
  if (!decoded.ok) return decoded;
  const bytes = decoded.value;
  if (bytes.length < 5)
    return err(
      `record holds ${String(bytes.length)} bytes; count, address, type and checksum need 5`,
    );
  const count = bytes[0] ?? 0;
  const typeCode = bytes[3] ?? 0;
  const type = hex(typeCode, 2);
  if (bytes.length !== count + 5)
    return err(
      `record type ${type} byte count 0x${hex(count, 2)} declares ${String(count)} data bytes, but the line holds ${String(bytes.length - 5)}`,
    );
  const declared = bytes[bytes.length - 1] ?? 0;
  const computed = -byteSum(bytes.subarray(0, -1)) & 0xff;
  if (declared !== computed)
    return err(
      `record type ${type} checksum 0x${hex(declared, 2)} does not match computed 0x${hex(computed, 2)}`,
    );
  if (typeCode > 5) return err(`unknown record type ${type}`);
  const fixed = INTEL_FIXED_DATA_BYTES[typeCode];
  if (fixed !== undefined && count !== fixed)
    return err(
      `record type ${type} requires ${String(fixed)} data bytes, found ${String(count)}`,
    );
  const address = readBigEndian(bytes.subarray(1, 3));
  // Extended/start address records reserve this field; their values are in data.
  if (typeCode >= 2 && address !== 0)
    return err(
      `record type ${type} requires address 0x0000, found 0x${hex(address, 4)}`,
    );
  return ok({
    type,
    address,
    data: bytes.subarray(4, 4 + count),
  });
};

const parseSrecRecord = (line: Uint8Array): Result<HexRecord, string> => {
  if (line[0] !== LETTER_S) return err(startCharacterFailure(line, "S"));
  if (line.length < 2) return err("record has no type character");
  const digit = (line[1] ?? 0) - 0x30;
  if (digit < 0 || digit > 9)
    return err(
      `invalid record type character 0x${hex(line[1] ?? 0, 2)} at column 2`,
    );
  const type = `S${String(digit)}`;
  const decoded = decodeHexDigits(line, 2);
  if (!decoded.ok) return decoded;
  const bytes = decoded.value;
  const count = bytes[0] ?? 0;
  if (bytes.length === 0 || bytes.length !== count + 1)
    return err(
      `record type ${type} byte count 0x${hex(count, 2)} declares ${String(count)} bytes after the count, but the line holds ${String(Math.max(bytes.length - 1, 0))}`,
    );
  const declared = bytes[bytes.length - 1] ?? 0;
  const computed = ~byteSum(bytes.subarray(0, -1)) & 0xff;
  if (declared !== computed)
    return err(
      `record type ${type} checksum 0x${hex(declared, 2)} does not match computed 0x${hex(computed, 2)}`,
    );
  const addressBytes = SREC_ADDRESS_BYTES[digit];
  if (addressBytes === undefined) return err(`reserved record type ${type}`);
  if (count < addressBytes + 1 || (digit >= 5 && count !== addressBytes + 1))
    return err(
      `record type ${type} byte count 0x${hex(count, 2)} does not fit its ${String(addressBytes)}-byte address and checksum`,
    );
  return ok({
    type,
    address: readBigEndian(bytes.subarray(1, 1 + addressBytes)),
    data: bytes.subarray(1 + addressBytes, -1),
  });
};

export const parseRecord = (
  encoding: HexRecordEncoding,
  line: Uint8Array,
): Result<HexRecord, string> =>
  encoding === "intel-hex" ? parseIntelRecord(line) : parseSrecRecord(line);
