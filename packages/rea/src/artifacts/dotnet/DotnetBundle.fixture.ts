import { deflateRawSync } from "node:zlib";

/** Source-owned Microsoft bundle-layout fixture; no target executable is run. */
export const dotnetBundleFixture = (
  files: readonly {
    path: string;
    bytes: Buffer;
    compressed?: boolean;
    storedBytes?: Buffer;
    fileType?: number;
    declaredSize?: number;
    declaredOffset?: number;
  }[] = [
    {
      path: "App.dll",
      bytes: Buffer.from("owned assembly bytes"),
      fileType: 1,
    },
  ],
  majorVersion = 6,
): { bytes: Buffer; headerOffset: number; offsets: readonly number[] } => {
  const host = Buffer.alloc(1024);
  host.write("MZ");
  host.writeUInt32LE(128, 60);
  host.write("PE\0\0", 128);
  host.writeUInt16LE(0x8664, 132);
  host.writeUInt16LE(1, 134);
  host.writeUInt16LE(240, 148);
  host.writeUInt16LE(0x22, 150);
  const optional = 152;
  host.writeUInt16LE(0x20b, optional);
  host.writeUInt32LE(0x1000, optional + 16);
  host.writeBigUInt64LE(0x140000000n, optional + 24);
  host.writeUInt32LE(4096, optional + 32);
  host.writeUInt32LE(512, optional + 36);
  host.writeUInt32LE(8192, optional + 56);
  host.writeUInt32LE(512, optional + 60);
  host.writeUInt16LE(3, optional + 68);
  host.writeUInt32LE(16, optional + 108);
  host.write(".text", 392);
  host.writeUInt32LE(512, 400);
  host.writeUInt32LE(4096, 404);
  host.writeUInt32LE(512, 408);
  host.writeUInt32LE(512, 412);
  host.writeUInt32LE(0x60000020, 428);
  // Kept literal independently of the reader to pin Microsoft's apphost marker.
  Buffer.from(
    "8b1202b96a612038727b930214d7a03213f5b9e6efae3318ee3b2dce24b36aae",
    "hex",
  ).copy(host, 544);
  const payloads = files.map(
    (file) =>
      file.storedBytes ??
      (file.compressed ? deflateRawSync(file.bytes) : file.bytes),
  );
  let offset = host.length;
  const offsets = payloads.map((bytes) => {
    const at = offset;
    offset += bytes.length;
    return at;
  });
  const headerOffset = offset;
  host.writeBigUInt64LE(BigInt(headerOffset), 536);
  const header = [
    u32(majorVersion),
    u32(0),
    u32(files.length),
    text("owned-fixture"),
  ];
  if (majorVersion >= 2) header.push(Buffer.alloc(40));
  const table = files.flatMap((file, index) => [
    u64(file.declaredOffset ?? offsets[index]!),
    u64(file.declaredSize ?? file.bytes.length),
    ...(majorVersion === 6
      ? [u64(file.compressed ? payloads[index]!.length : 0)]
      : []),
    Buffer.from([file.fileType ?? 1]),
    text(file.path),
  ]);
  return {
    bytes: Buffer.concat([host, ...payloads, ...header, ...table]),
    headerOffset,
    offsets,
  };
};

const u32 = (value: number): Buffer => {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
};
const u64 = (value: number): Buffer => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
};
const text = (value: string): Buffer => {
  const bytes = Buffer.from(value);
  const length: number[] = [];
  let remaining = bytes.length;
  do {
    const part = remaining & 127;
    remaining >>>= 7;
    length.push(remaining ? part | 128 : part);
  } while (remaining);
  return Buffer.concat([Buffer.from(length), bytes]);
};
