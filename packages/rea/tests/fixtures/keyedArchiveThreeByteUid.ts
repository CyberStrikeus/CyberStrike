const ascii = (value: string): Buffer => {
  const bytes = Buffer.from(value, "ascii");
  return bytes.length < 15
    ? Buffer.concat([Buffer.from([0x50 | bytes.length]), bytes])
    : Buffer.concat([Buffer.from([0x5f, 0x10, bytes.length]), bytes]);
};

/** NSKeyedArchiver with a caller-sized UID for `$top.root`. */
export const keyedArchiveUidBytes = (
  width = 3,
  uidValue = 0x010203n,
): Buffer => {
  const uid = Buffer.alloc(width + 1);
  uid[0] = 0x80 | (width - 1);
  for (let byte = width - 1; byte >= 0; byte -= 1) {
    uid[byte + 1] = Number(uidValue & 0xffn);
    uidValue >>= 8n;
  }
  const objects = [
    Buffer.from([0xd3, 1, 3, 4, 2, 8, 5]),
    ascii("$archiver"),
    ascii("NSKeyedArchiver"),
    ascii("$objects"),
    ascii("$top"),
    Buffer.from([0xd1, 6, 7]),
    ascii("root"),
    uid,
    Buffer.from([0xa2, 9, 10]),
    ascii("$null"),
    ascii("payload"),
  ];
  const offsets: number[] = [];
  let position = Buffer.byteLength("bplist00", "ascii");
  for (const object of objects) {
    offsets.push(position);
    position += object.length;
  }
  const header = Buffer.from("bplist00", "ascii");
  const trailer = Buffer.alloc(32);
  trailer[6] = 1;
  trailer[7] = 1;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(position), 24);
  return Buffer.concat([header, ...objects, Buffer.from(offsets), trailer]);
};
