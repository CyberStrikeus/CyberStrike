import { crc32, zstdCompressSync } from "node:zlib";

/** One non-Zip64 member, independently framed from the PKWARE APPNOTE records. */
export const zstandardZipFixture = (
  content: Buffer,
  options: {
    readonly method?: number;
    readonly crc?: number;
    readonly declaredSize?: number;
    readonly compressed?: Buffer;
  } = {},
): Buffer => {
  const name = Buffer.from("member.txt");
  const compressed = options.compressed ?? zstdCompressSync(content);
  const method = options.method ?? 93;
  const checksum = options.crc ?? crc32(content);
  const declaredSize = options.declaredSize ?? content.length;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(63, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(0x5021, 12); // 2020-01-01, DOS date.
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(declaredSize, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(63, 4);
  central.writeUInt16LE(63, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(0x5021, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(declaredSize, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + compressed.length, 16);
  return Buffer.concat([local, name, compressed, central, name, end]);
};
