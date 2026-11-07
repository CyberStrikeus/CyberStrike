import { scanBinaryPlistScalars } from "../../src/artifacts/apple/PlistScalars.js";
import {
  readBinaryPlistObjectOffset,
  readBinaryPlistObjectTableLayout,
  writeBinaryPlistObjectOffset,
} from "./binaryPlistObjectTable.js";

/** Place a reachable date object inside a 16-byte data object's payload. */
export const embedSubmillisecondDateInWideIntegerPayload = (
  source: Buffer,
  targetDateSeconds?: number,
): { readonly bytes: Buffer; readonly integerDecimal: string } => {
  const bytes = Buffer.from(source);
  const dates = scanBinaryPlistScalars(bytes).dates;
  const date =
    targetDateSeconds === undefined
      ? dates[0]
      : dates.find(
          ({ secondsSince2001 }) => secondsSince2001 === targetDateSeconds,
        );
  if (date === undefined) throw new Error("binary plist fixture lost its date");
  const objectTable = readBinaryPlistObjectTableLayout(bytes);
  let dataOffset: number | undefined;
  let dateObjectId: number | undefined;
  for (let objectId = 0; objectId < objectTable.objectCount; objectId += 1) {
    const offset = readBinaryPlistObjectOffset(bytes, objectTable, objectId);
    if (offset === date.offset) dateObjectId = objectId;
    if (bytes[offset] === 0x4f) dataOffset = offset;
  }
  if (dataOffset === undefined || dateObjectId === undefined)
    throw new Error(
      "binary plist fixture lost its wide integer or date object",
    );

  const dateOffset = dataOffset + 4;
  bytes[dataOffset] = 0x14;
  bytes.fill(0, dataOffset + 1, dataOffset + 17);
  bytes[dateOffset] = 0x33;
  bytes.writeDoubleBE(0.1005, dateOffset + 1);
  writeBinaryPlistObjectOffset(bytes, objectTable, dateObjectId, dateOffset);
  const integer = BigInt.asIntN(
    128,
    (bytes.readBigUInt64BE(dataOffset + 1) << 64n) |
      bytes.readBigUInt64BE(dataOffset + 9),
  );
  return { bytes, integerDecimal: integer.toString() };
};
