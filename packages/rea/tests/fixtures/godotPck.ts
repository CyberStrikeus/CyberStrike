import { createHash } from "node:crypto";

export interface GodotPckMember {
  readonly path: string;
  readonly data: string | Uint8Array;
  readonly flags?: number;
  readonly md5?: Buffer;
  readonly size?: bigint;
  readonly offset?: bigint;
}

export const pckU32 = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
};
export const pckU64 = (value: bigint | number): Buffer => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
};
const pad4 = (bytes: Buffer): Buffer =>
  Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);

/** Godot 3.5 exporter layout: 84-byte header, no flags, absolute member offsets. */
export const buildGodotPck1 = (
  members: readonly GodotPckMember[],
  options: { carrierBytes?: number; fileCount?: number } = {},
): Buffer => {
  const header = Buffer.alloc(84);
  header.write("GDPC");
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(3, 8);
  header.writeUInt32LE(5, 12);
  const paths = members.map((member) => pad4(Buffer.from(member.path)));
  const directoryEnd =
    header.length +
    4 +
    paths.reduce((bytes, path) => bytes + 36 + path.length, 0);
  const directoryFileEnd = (options.carrierBytes ?? 0) + directoryEnd;
  const padding = (16 - (directoryFileEnd % 16)) % 16;
  let dataOffset = directoryFileEnd + padding;
  const data: Buffer[] = [];
  const directory = members.flatMap((member, index) => {
    const bytes = Buffer.from(member.data);
    const path = paths[index]!;
    const row = [
      pckU32(path.length),
      path,
      pckU64(member.offset ?? BigInt(dataOffset)),
      pckU64(member.size ?? BigInt(bytes.length)),
      member.md5 ?? createHash("md5").update(bytes).digest(),
    ];
    const stored = Buffer.concat([
      bytes,
      Buffer.alloc((16 - (bytes.length % 16)) % 16),
    ]);
    data.push(stored);
    dataOffset += stored.length;
    return row;
  });
  return Buffer.concat([
    header,
    pckU32(options.fileCount ?? members.length),
    ...directory,
    Buffer.alloc(padding),
    ...data,
  ]);
};

/**
 * Build a pack with the layout Godot's exporter writes (and GDRE Tools
 * reproduces): format 2 places the directory after a 96-byte header and
 * members after it; format 3 stores members first and a pack-relative
 * directory offset.
 */
export const buildGodotPck = (
  version: 2 | 3 | 4,
  members: readonly GodotPckMember[],
  options: { packFlags?: number; fileCount?: number } = {},
): Buffer => {
  const data: Buffer[] = [];
  const offsets: number[] = [];
  const memberBytes: Buffer[] = [];
  let dataBytes = 0;
  for (const member of members) {
    offsets.push(dataBytes);
    const bytes = pad4(Buffer.from(member.data));
    memberBytes.push(Buffer.from(member.data));
    data.push(bytes);
    dataBytes += bytes.length;
  }
  const directory = Buffer.concat([
    pckU32(options.fileCount ?? members.length),
    ...members.flatMap((member, index) => {
      const path = pad4(Buffer.from(member.path));
      return [
        pckU32(path.length),
        path,
        pckU64(member.offset ?? BigInt(offsets[index] ?? 0)),
        pckU64(member.size ?? BigInt(memberBytes[index]?.length ?? 0)),
        member.md5 ??
          createHash("md5")
            .update(memberBytes[index] ?? "")
            .digest(),
        pckU32(member.flags ?? 0),
      ];
    }),
  ]);
  const headerBytes = 96;
  const fileBase = version === 2 ? headerBytes + directory.length : headerBytes;
  const header = Buffer.concat([
    Buffer.from("GDPC"),
    pckU32(version),
    pckU32(4),
    pckU32(6),
    pckU32(1),
    pckU32(options.packFlags ?? (version >= 3 ? 2 : 0)),
    pckU64(fileBase),
    pckU64(version >= 3 ? headerBytes + dataBytes : 0),
  ]);
  const paddedHeader = Buffer.concat([
    header,
    Buffer.alloc(headerBytes - header.length),
  ]);
  return version === 2
    ? Buffer.concat([paddedHeader, directory, ...data])
    : Buffer.concat([paddedHeader, ...data, directory]);
};

export const embedGodotPck = (pack: Buffer): Buffer =>
  Buffer.concat([
    Buffer.from("\x7fELF fake engine bytes"),
    pack,
    pckU64(pack.length),
    Buffer.from("GDPC"),
  ]);

/** Repeated physical ranges are valid aliases but multiply plaintext I/O per path. */
export const buildAliasedGodotPck = (
  version: 2 | 3 | 4,
  count: number,
  entryBytes = 256 * 1024,
  flags = 0,
): Buffer =>
  buildGodotPck(
    version,
    Array.from({ length: count }, (_, index) => ({
      path: `res://aliases/${String(index)}.bin`,
      data: index === 0 ? "x".repeat(entryBytes) : "",
      offset: 0n,
      size: BigInt(entryBytes),
      md5: Buffer.alloc(16),
      flags,
    })),
  );
