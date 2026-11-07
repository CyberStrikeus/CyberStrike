import { expect, it } from "vitest";
import { binaryPlistObjectTable } from "../../../tests/fixtures/binaryPlistObjectTable.js";
import { createPlistNumberProjection } from "../../domain/apple/plistNumbers.js";
import { projectPlistValue } from "../../domain/apple/plistValue.js";
import { scanBinaryPlistScalars } from "./PlistScalars.js";
import { plistUidValue } from "../../domain/apple/plistUid.js";
import { decodeBinaryPlistValue } from "./BinaryPlistMaterializer.js";
import { estimateBinaryPlistExpansion } from "./PropertyListDecodeBudget.js";
import { parseXmlPropertyList } from "../../domain/propertyListKeys.js";

const source = (objects: readonly Buffer[]): Buffer => {
  const table =
    8 + objects.reduce((length, object) => length + object.length, 0);
  const bytes = Buffer.alloc(table + objects.length + 32);
  let cursor = 8;
  const offsets = objects.map((object) => {
    const offset = cursor;
    object.copy(bytes, cursor);
    cursor += object.length;
    return offset;
  });
  return binaryPlistObjectTable(bytes, offsets, table);
};
const text = (value: string): Buffer =>
  Buffer.concat([Buffer.from([0x50 | value.length]), Buffer.from(value)]);
const decode = (bytes: Buffer) =>
  decodeBinaryPlistValue(
    bytes,
    estimateBinaryPlistExpansion(bytes, 1024 * 1024, {
      uidProjection: true,
      numberProjection: true,
    }),
  );

it("materializes own dictionary keys and keeps the last duplicate's source UID", () => {
  const bytes = source([
    Buffer.from([0xd3, 1, 2, 1, 3, 4, 5]),
    text("__proto__"),
    text("constructor"),
    Buffer.from([0x80, 1]),
    text("kept"),
    Buffer.from([0x80, 2]),
  ]);
  const value = decode(bytes) as Record<string, unknown>;
  expect(Object.keys(value)).toEqual(["__proto__", "constructor"]);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(plistUidValue(value["__proto__"])).toBe(2);
  expect(value.constructor).toBe("kept");
});

it("expands shared containers and nonprimitive scalar references independently", () => {
  const date = Buffer.alloc(9);
  date[0] = 0x33;
  date.writeDoubleBE(1, 1);
  const bytes = source([
    Buffer.from([0xa8, 1, 1, 2, 2, 3, 3, 4, 4]),
    Buffer.from([0xd1, 5, 6]),
    date,
    Buffer.from([0x42, 1, 2]),
    Buffer.from([0x80, 7]),
    text("nested"),
    text("kept"),
  ]);
  const value = decode(bytes) as unknown[];
  for (let index = 0; index < value.length; index += 2) {
    expect(value[index]).toEqual(value[index + 1]);
    expect(value[index]).not.toBe(value[index + 1]);
  }
  expect(plistUidValue(value[6])).toBe(7);
  expect(plistUidValue(value[7])).toBe(7);
});

it("keeps a source UID distinct from an ordinary UID-shaped dictionary", () => {
  const bytes = source([
    Buffer.from([0xa2, 1, 2]),
    Buffer.from([0x80, 7]),
    Buffer.from([0xd1, 3, 4]),
    text("UID"),
    Buffer.from([0x10, 7]),
  ]);
  const value = decode(bytes) as unknown[];
  expect(value[0]).toEqual({ UID: 7 });
  expect(value[1]).toEqual({ UID: 7 });
  expect(plistUidValue(value[0])).toBe(7);
  expect(plistUidValue(value[1])).toBeUndefined();
});

it("preserves binary dictionary identity through scalar and number projections", () => {
  const bytes = source([
    Buffer.from([0xa2, 1, 2]),
    Buffer.from([0x80, 7]),
    Buffer.from([0xd1, 3, 4]),
    text("CF$UID"),
    Buffer.from([0x10, 7]),
  ]);
  const metadata = scanBinaryPlistScalars(bytes);
  const numbers = createPlistNumberProjection(metadata.literals);
  const projected = numbers.project(projectPlistValue(decode(bytes)).value);
  if (!Array.isArray(projected)) throw new Error("Expected projected array");
  expect(projected).toEqual([{ UID: 7 }, { CF$UID: 7 }]);
  expect(plistUidValue(projected[0])).toBe(7);
  expect(plistUidValue(projected[1])).toBeUndefined();
  // Reprojection must keep the source dictionary distinct from XML's convention.
  const repeated = numbers.project(projected);
  if (!Array.isArray(repeated)) throw new Error("Expected projected array");
  expect(plistUidValue(repeated[1])).toBeUndefined();
});

it("retains XML's Foundation reference convention through number projection", () => {
  const decoded = parseXmlPropertyList(
    "<plist><dict><key>CF$UID</key><integer>7</integer></dict></plist>",
  );
  const numbers = createPlistNumberProjection(decoded.numberLiterals);
  const projected = numbers.project(projectPlistValue(decoded.value).value);
  expect(projected).toEqual({ CF$UID: 7 });
  expect(plistUidValue(projected)).toBe(7);
});

it("materializes normalized three-byte tables from a nonzero root without losing source numbers", () => {
  const tableOffset = 36;
  const bytes = Buffer.alloc(tableOffset + 9 + 32);
  bytes.write("bplist00");
  bytes[8] = 0x14;
  bytes.writeBigUInt64BE(1n, 9);
  bytes.writeBigUInt64BE(2n, 17);
  bytes[25] = 0xa2;
  bytes.writeUIntBE(0, 26, 3);
  bytes.writeUIntBE(2, 29, 3);
  bytes[32] = 0x82;
  bytes.writeUIntBE(0xabcdef, 33, 3);
  for (const [object, offset] of [8, 25, 32].entries())
    bytes.writeUIntBE(offset, tableOffset + object * 3, 3);
  const trailer = bytes.length - 32;
  bytes[trailer + 6] = 3;
  bytes[trailer + 7] = 3;
  bytes.writeBigUInt64BE(3n, trailer + 8);
  bytes.writeBigUInt64BE(1n, trailer + 16);
  bytes.writeBigUInt64BE(BigInt(tableOffset), trailer + 24);
  const original = Buffer.from(bytes);
  const plan = estimateBinaryPlistExpansion(bytes, 1024 * 1024, {
    numberProjection: true,
    uidProjection: true,
  });
  const metadata = scanBinaryPlistScalars(bytes, plan);
  expect(metadata.wideIntegers).toEqual([
    { offset: 8, value: 18446744073709551618n },
  ]);
  expect(metadata.literals.incomplete).toBe(false);
  const decoded = decodeBinaryPlistValue(bytes, plan, metadata) as unknown[];
  expect(
    createPlistNumberProjection(metadata.literals).project(
      projectPlistValue(decoded[0]).value,
    ),
  ).toEqual({
    $plist_type: "integer",
    decimal: "18446744073709551618",
  });
  expect(plistUidValue(decoded[1])).toBe(0xabcdef);
  expect(decoded).toHaveLength(2);
  expect(bytes.equals(original)).toBe(true);
});

it("keeps uint64 wrapping for nine-byte offset and reference declarations", () => {
  const bytes = Buffer.alloc(70);
  bytes.write("bplist00");
  bytes.set([0x10, 7, 0xa1], 8);
  bytes[11] = 0xff;
  bytes[20] = 0xff;
  bytes.writeBigUInt64BE(8n, 21);
  bytes[29] = 0xff;
  bytes.writeBigUInt64BE(10n, 30);
  const trailer = 38;
  bytes[trailer + 6] = 9;
  bytes[trailer + 7] = 9;
  bytes.writeBigUInt64BE(2n, trailer + 8);
  bytes.writeBigUInt64BE(1n, trailer + 16);
  bytes.writeBigUInt64BE(20n, trailer + 24);
  const original = Buffer.from(bytes);
  expect(decode(bytes)).toEqual([7]);
  expect(bytes.equals(original)).toBe(true);
});
