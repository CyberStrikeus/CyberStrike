import { createHash } from "node:crypto";
import { deflateSync, zstdCompressSync } from "node:zlib";
import { encode } from "@msgpack/msgpack";
export const ptxFixture = `// Producer-shaped static PTX; portable tests do not invoke a GPU compiler.
.version 8.8
.target sm_80
.address_size 64
.visible .entry add_one(.param .u64 output, .param .u32 value) {
.reg .b32 %r<9>;
.reg .b64 %rd<5>;
.shared .align 4 .b8 scratch[32];
ret;
}
`;
export interface ElfFixtureSection {
  name: string;
  type?: number;
  flags?: bigint;
  bytes?: Buffer;
  size?: number;
  info?: number;
  link?: number;
  entrySize?: number;
}
/** Format boundary fixtures, including numeric records checked against nvcc 12.9 cuobjdump. */
export const elfFixture = (
  machine: number,
  sections: ElfFixtureSection[],
  version = 1,
): Buffer => {
  const names = Buffer.from(
    `\0.shstrtab\0${sections.map((row) => row.name).join("\0")}\0`,
  );
  const rows = [
    { name: "", type: 0, bytes: Buffer.alloc(0) },
    { name: ".shstrtab", type: 3, bytes: names },
    ...sections,
  ];
  const extendedSectionCount = rows.length >= 0xff00;
  let position = 64;
  const entries = rows.map((row) => {
    position = Math.ceil(position / 8) * 8;
    const offset = position;
    if (row.type !== 8) position += row.bytes?.length ?? 0;
    return { row, offset };
  });
  const table = Math.ceil(position / 8) * 8;
  const result = Buffer.alloc(table + rows.length * 64);
  result.set([
    0x7f,
    0x45,
    0x4c,
    0x46,
    2,
    1,
    1,
    machine === 190 ? 0x33 : machine === 224 ? 0x40 : 0,
  ]);
  result.writeUInt16LE(2, 16);
  result.writeUInt16LE(machine, 18);
  result.writeUInt32LE(version, 20);
  result.writeBigUInt64LE(BigInt(table), 40);
  result.writeUInt32LE(machine === 190 ? 0x500550 : 0x12c, 48);
  result.writeUInt16LE(64, 52);
  result.writeUInt16LE(64, 58);
  result.writeUInt16LE(extendedSectionCount ? 0 : rows.length, 60);
  result.writeUInt16LE(1, 62);
  if (extendedSectionCount)
    result.writeBigUInt64LE(BigInt(rows.length), table + 32);
  for (let index = 1; index < entries.length; index++) {
    const { row, offset } = entries[index]!,
      h = table + index * 64;
    result.writeUInt32LE(names.indexOf(Buffer.from(`${row.name}\0`)), h);
    result.writeUInt32LE(row.type ?? 1, h + 4);
    result.writeBigUInt64LE(row.flags ?? 0n, h + 8);
    result.writeBigUInt64LE(BigInt(offset), h + 24);
    result.writeBigUInt64LE(BigInt(row.size ?? row.bytes?.length ?? 0), h + 32);
    result.writeUInt32LE(row.link ?? 0, h + 40);
    result.writeUInt32LE(row.info ?? 0, h + 44);
    result.writeBigUInt64LE(BigInt(row.entrySize ?? 0), h + 56);
    if (row.type !== 8) row.bytes?.copy(result, offset);
  }
  return result;
};
export const cubinFixture = (
  options: {
    shared?: number;
    textRegisters?: number;
    globalRegisters?: number;
    name?: string;
    globalRecords?: number;
    globalAliases?: number;
    architecture?: number;
    osAbi?: number;
    flags?: number;
    extendedSectionIndex?: boolean;
    v2ParameterSize?: number;
  } = {},
): Buffer => {
  const name = options.name ?? "add_one";
  const symbols = Buffer.alloc(48);
  symbols.writeUInt32LE(1, 24);
  symbols[28] = 0x12;
  symbols[29] = 0x10;
  symbols.writeUInt16LE(options.extendedSectionIndex ? 0xffff : 4, 30);
  symbols.writeBigUInt64LE(16n, 40);
  const record = Buffer.from("042f0800010000000a000000", "hex");
  record.writeUInt32LE(options.globalRegisters ?? 10, 8);
  const global = Buffer.alloc(record.length * (options.globalRecords ?? 1));
  for (let offset = 0; offset < global.length; offset += record.length)
    record.copy(global, offset);
  const info =
    options.v2ParameterSize === undefined
      ? Buffer.from(
          "03190c0004170c00000000000100080000f0110004170c00000000000000000000f02100",
          "hex",
        )
      : (() => {
          const byteCount = Buffer.alloc(4);
          byteCount[0] = 3;
          byteCount[1] = 0x19;
          byteCount.writeUInt16LE(options.v2ParameterSize!, 2);
          const v2 = Buffer.alloc(16);
          v2[0] = 4;
          v2[1] = 0x45;
          v2.writeUInt16LE(12, 2);
          v2.writeUInt32LE(options.v2ParameterSize!, 12);
          return Buffer.concat([byteCount, v2]);
        })();
  const paddingSections = options.extendedSectionIndex
    ? Array.from({ length: 65531 }, (_, index) => ({
        name: `.padding.${index}`,
      }))
    : [];
  const textSectionIndex = options.extendedSectionIndex ? 65535 : 4;
  const extendedIndices = Buffer.alloc(8);
  extendedIndices.writeUInt32LE(textSectionIndex, 4);
  const result = elfFixture(
    190,
    [
      { name: ".strtab", type: 3, bytes: Buffer.from(`\0${name}\0`) },
      { name: ".symtab", type: 2, link: 2, entrySize: 24, bytes: symbols },
      ...paddingSections,
      {
        name: `.text.${name}`,
        flags: 0x100006n,
        info: ((options.textRegisters ?? 0) << 24) | 1,
        bytes: Buffer.alloc(16),
      },
      { name: ".nv.info", type: 0x70000000, link: 3, bytes: global },
      {
        name: `.nv.info.${name}`,
        type: 0x70000000,
        link: 3,
        info: textSectionIndex,
        bytes: info,
      },
      {
        name: `.nv.shared.${name}`,
        type: 8,
        info: textSectionIndex,
        size: options.shared ?? 1056,
      },
      ...(options.extendedSectionIndex
        ? [
            {
              name: ".symtab_shndx",
              type: 18,
              link: 3,
              entrySize: 4,
              bytes: extendedIndices,
            },
          ]
        : []),
      ...Array.from({ length: (options.globalAliases ?? 1) - 1 }, () => ({
        name: ".nv.info",
        type: 0x70000000,
        link: 3,
        bytes: Buffer.alloc(0),
      })),
    ],
    0x81,
  );
  if (options.architecture !== undefined)
    result.writeUInt32LE(
      (result.readUInt32LE(48) & ~0xff) | options.architecture,
      48,
    );
  const table = Number(result.readBigUInt64LE(40));
  const sectionCount =
    result.readUInt16LE(60) === 0
      ? Number(result.readBigUInt64LE(table + 32))
      : result.readUInt16LE(60);
  if (options.osAbi !== undefined) {
    result[7] = options.osAbi;
    result.writeUInt32LE(1, 20);
  }
  if (options.flags !== undefined) result.writeUInt32LE(options.flags, 48);
  for (
    let index =
      8 + paddingSections.length + (options.extendedSectionIndex ? 1 : 0);
    index < sectionCount;
    index++
  ) {
    result.writeBigUInt64LE(
      result.readBigUInt64LE(table + 5 * 64 + 24),
      table + index * 64 + 24,
    );
    result.writeBigUInt64LE(BigInt(global.length), table + index * 64 + 32);
  }
  return result;
};
/** One producer-shaped AMDGPU MessagePack note, composable with later notes. */
export const amdNoteFixture = (
  hidden = false,
  target: string | number | null = "amdgcn-amd-amdhsa--gfx900",
): Buffer => {
  const args = [
    { ".offset": 0, ".size": 8, ".value_kind": "global_buffer" },
    {
      ".offset": 8,
      ".size": 4,
      ".value_kind": hidden ? "hidden_global_offset_x" : "by_value",
    },
  ];
  const metadata = Buffer.from(
    encode({
      ...(target === null ? {} : { "amdhsa.target": target }),
      "amdhsa.version": [1, 1],
      "amdhsa.kernels": [
        {
          ".name": "add_one",
          ".symbol": "add_one.kd",
          ".args": args,
          ".kernarg_segment_size": 12,
          ".group_segment_fixed_size": 0,
          ".private_segment_fixed_size": 0,
          ".sgpr_count": 6,
          ".vgpr_count": 2,
        },
      ],
    }),
  );
  const note = Buffer.alloc(20 + Math.ceil(metadata.length / 4) * 4);
  note.writeUInt32LE(7, 0);
  note.writeUInt32LE(metadata.length, 4);
  note.writeUInt32LE(32, 8);
  note.write("AMDGPU\0", 12);
  metadata.copy(note, 20);
  return note;
};
export const amdFixture = (
  hidden = false,
  trailingNote?: Buffer,
  target: string | number | null = "amdgcn-amd-amdhsa--gfx900",
): Buffer => {
  const note = amdNoteFixture(hidden, target);
  return elfFixture(224, [
    {
      name: ".note",
      type: 7,
      bytes:
        trailingNote === undefined ? note : Buffer.concat([note, trailingNote]),
    },
  ]);
};
export const cudaFixture = (
  compression: "none" | "zstd" | "legacy" = "none",
  entries: { kind: number; target: number; bytes: Buffer; flags?: number }[] = [
    { kind: 1, target: 80, bytes: Buffer.from(ptxFixture) },
    { kind: 2, target: 90, bytes: cubinFixture({ architecture: 90 }) },
  ],
): Buffer => {
  const records = entries.map(({ kind, target, bytes, flags: entryFlags }) => {
    const compressed = compression !== "none",
      data =
        compression === "zstd"
          ? zstdCompressSync(bytes)
          : compression === "legacy"
            ? deflateSync(bytes)
            : bytes,
      compressionFlag =
        compression === "zstd"
          ? 0x8000n
          : compression === "legacy"
            ? 0x1000n
            : 0n;
    const result = Buffer.alloc(64 + Math.ceil(data.length / 8) * 8);
    result.writeUInt16LE(kind, 0);
    result.writeUInt16LE(0x101, 2);
    result.writeUInt32LE(64, 4);
    result.writeBigUInt64LE(BigInt(result.length - 64), 8);
    result.writeUInt32LE(compressed ? data.length : 0, 16);
    result.writeUInt32LE(target, 28);
    result.writeBigUInt64LE(
      0x11n | compressionFlag | BigInt(entryFlags ?? 0),
      40,
    );
    result.writeBigUInt64LE(compressed ? BigInt(bytes.length) : 0n, 56);
    data.copy(result, 64);
    return result;
  });
  const header = Buffer.alloc(16);
  header.writeUInt32LE(0xba55ed50);
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(16, 6);
  header.writeBigUInt64LE(
    BigInt(records.reduce((n, row) => n + row.length, 0)),
    8,
  );
  return Buffer.concat([header, ...records]);
};
export const hipFixture = (
  payload = amdFixture(),
  targetId = "hipv4-amdgcn-amd-amdhsa--gfx900",
): Buffer => {
  const ids = ["host-x86_64-unknown-linux", targetId];
  const headers = ids.map((id) => Buffer.alloc(24 + Buffer.byteLength(id)));
  const start = 32 + headers.reduce((total, row) => total + row.length, 0);
  for (let index = 0; index < headers.length; index++) {
    const row = headers[index]!;
    row.writeBigUInt64LE(BigInt(start));
    row.writeBigUInt64LE(index === 0 ? 0n : BigInt(payload.length), 8);
    row.writeBigUInt64LE(BigInt(Buffer.byteLength(ids[index]!)), 16);
    row.write(ids[index]!, 24);
  }
  const head = Buffer.alloc(32);
  head.write("__CLANG_OFFLOAD_BUNDLE__");
  head.writeBigUInt64LE(2n, 24);
  return Buffer.concat([head, ...headers, payload]);
};
/** Representation recognition only; these bytes do not establish valid LLVM IR. */
export const llvmBitcodeFixture = (wrapped = false): Buffer => {
  const raw = Buffer.from([0x42, 0x43, 0xc0, 0xde, 0, 0, 0, 0]);
  if (!wrapped) return raw;
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x0b17c0de, 0);
  header.writeUInt32LE(20, 8);
  header.writeUInt32LE(raw.length, 12);
  return Buffer.concat([header, raw]);
};
export const ccobFixture = (
  version: 1 | 2 | 3 = 2,
  method: "zlib" | "zstd" = "zstd",
  bundle = hipFixture(),
): Buffer => {
  const compressed =
    method === "zstd" ? zstdCompressSync(bundle) : deflateSync(bundle);
  const width = version === 1 ? 20 : version === 2 ? 24 : 32,
    head = Buffer.alloc(width);
  head.write("CCOB");
  head.writeUInt16LE(version, 4);
  head.writeUInt16LE(method === "zstd" ? 1 : 0, 6);
  if (version === 3) {
    head.writeBigUInt64LE(BigInt(width + compressed.length), 8);
    head.writeBigUInt64LE(BigInt(bundle.length), 16);
  } else if (version === 2) {
    head.writeUInt32LE(width + compressed.length, 8);
    head.writeUInt32LE(bundle.length, 12);
  } else head.writeUInt32LE(bundle.length, 8);
  createHash("md5")
    .update(bundle)
    .digest()
    .copy(head, width - 8, 0, 8);
  return Buffer.concat([head, compressed]);
};
export const peGpuFixture = (payload = cudaFixture()): Buffer => {
  const result = Buffer.alloc(512 + payload.length),
    pe = 64,
    optionalSize = 240,
    section = pe + 24 + optionalSize;
  result.write("MZ");
  result.writeUInt32LE(pe, 60);
  result.write("PE\0\0", pe);
  result.writeUInt16LE(0x8664, pe + 4);
  result.writeUInt16LE(1, pe + 6);
  result.writeUInt16LE(optionalSize, pe + 20);
  result.writeUInt16LE(0x20b, pe + 24);
  result.write(".nv_fatb", section);
  result.writeUInt32LE(payload.length, section + 8);
  result.writeUInt32LE(payload.length, section + 16);
  result.writeUInt32LE(512, section + 20);
  payload.copy(result, 512);
  return result;
};
