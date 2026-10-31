import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createTestTempDirectory } from "./temporaryDirectory.js";

const ascii = (value: string): Buffer => {
  const bytes = Buffer.from(value, "ascii");
  return bytes.length < 15
    ? Buffer.concat([Buffer.from([0x50 | bytes.length]), bytes])
    : Buffer.concat([Buffer.from([0x5f, 0x10, bytes.length]), bytes]);
};

const integer128 = (value: bigint): Buffer => {
  const bytes = Buffer.alloc(17);
  bytes[0] = 0x14;
  const encoded = BigInt.asUintN(128, value);
  bytes.writeBigUInt64BE(encoded >> 64n, 1);
  bytes.writeBigUInt64BE(BigInt.asUintN(64, encoded), 9);
  return bytes;
};

const integer64 = (value: bigint): Buffer => {
  const bytes = Buffer.alloc(9);
  bytes[0] = 0x13;
  bytes.writeBigInt64BE(value, 1);
  return bytes;
};

/**
 * Minimal valid NSKeyedArchiver whose object-table entries 10 and 11 both
 * point at one Int64 record, beside an unrelated Int64 sibling (entry 12).
 * The shared record is encoded once; only its offset is listed twice.
 */
const sharedEntryArchiveBytes = (): Buffer => {
  const objects = [
    Buffer.from([0xd3, 1, 3, 4, 2, 8, 5]), // root dict: three key/value pairs
    ascii("$archiver"),
    ascii("NSKeyedArchiver"),
    ascii("$objects"),
    ascii("$top"),
    Buffer.from([0xd1, 6, 7]), // $top.root -> UID 1
    ascii("root"),
    Buffer.from([0x80, 1]), // UID 1
    Buffer.from([0xa4, 9, 10, 11, 12]), // $objects refs
    ascii("$null"),
    integer64(9_007_199_254_740_993n),
    integer64(1_152_921_504_606_846_979n),
  ];
  const header = Buffer.from("bplist00", "ascii");
  const offsets: number[] = [];
  let position = header.length;
  for (const object of objects) {
    offsets.push(position);
    position += object.length;
  }
  // Entries 10 and 11 share the first Int64 record; entry 12 is the sibling.
  const [shared, sibling] = [offsets[10] ?? 0, offsets[11] ?? 0];
  offsets.splice(11, 1, shared, sibling);
  const trailer = Buffer.alloc(32);
  trailer[6] = 1;
  trailer[7] = 1;
  trailer.writeBigUInt64BE(BigInt(offsets.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(position), 24);
  return Buffer.concat([header, ...objects, Buffer.from(offsets), trailer]);
};

export const keyedArchiveSharedEntryFixture = async () => {
  const root = await createTestTempDirectory("rea-keyed-shared-entry-");
  const path = join(root, "archive.plist");
  const bytes = sharedEntryArchiveBytes();
  await writeFile(path, bytes);
  return {
    root,
    path,
    bytes,
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
};

/** Minimal valid NSKeyedArchiver with a 16-byte integer and an Int64 control. */
const archiveBytes = (): Buffer => {
  const objects = [
    Buffer.from([0xd3, 1, 3, 4, 2, 8, 5]), // root dict: three key/value pairs
    ascii("$archiver"),
    ascii("NSKeyedArchiver"),
    ascii("$objects"),
    ascii("$top"),
    Buffer.from([0xd1, 6, 7]), // $top.root -> UID 1
    ascii("root"),
    Buffer.from([0x80, 1]), // UID 1
    Buffer.from([0xa3, 9, 10, 11]), // $objects refs
    ascii("$null"),
    integer128(18_446_744_073_709_551_615n),
    integer64(9_223_372_036_854_775_807n),
  ];
  const header = Buffer.from("bplist00", "ascii");
  const offsets: number[] = [];
  let position = header.length;
  for (const object of objects) {
    offsets.push(position);
    position += object.length;
  }
  const offsetTable = Buffer.from(offsets);
  const trailer = Buffer.alloc(32);
  trailer[6] = 1;
  trailer[7] = 1;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(position), 24);
  return Buffer.concat([header, ...objects, offsetTable, trailer]);
};

export const keyedArchiveWideIntegerFixture = async () => {
  const root = await createTestTempDirectory("rea-keyed-wide-integers-");
  const path = join(root, "archive.bin");
  const bytes = archiveBytes();
  await writeFile(path, bytes);
  return {
    root,
    path,
    bytes,
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
};
