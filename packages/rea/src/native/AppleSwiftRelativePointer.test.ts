import { expect, it } from "vitest";

import { objcSwiftMetadataSchema } from "../domain/native/objcSwiftMetadata.js";
import {
  createSwiftRelativeReader,
  type DispatchRecordBudget,
} from "./AppleSwiftDispatchFacets.js";

const readers = (bytes: Buffer) => ({
  u32: (address: bigint) => bytes.readUInt32LE(Number(address)),
  pointer: (address: bigint) => bytes.readBigUInt64LE(Number(address)),
  resolvePointer: (address: bigint) => ({
    kind: "raw" as const,
    target: bytes.readBigUInt64LE(Number(address)),
  }),
  string: () => "fixture",
  location: (address: bigint) => ({
    address: `0x${address.toString(16)}`,
    file_offset: Number(address),
  }),
  targetLocation: (address: bigint) => ({
    address: `0x${address.toString(16)}`,
    file_offset: Number(address),
  }),
  evidence: (address: bigint, description: string) => [
    {
      kind: "binary_metadata" as const,
      description,
      location: {
        address: `0x${address.toString(16)}`,
        file_offset: Number(address),
      },
      artifact_path: "/fixture",
      artifact_sha256: "a".repeat(64),
    },
  ],
  offset: (address: bigint, size = 1) => {
    if (address < 0n || address + BigInt(size) > BigInt(bytes.length))
      throw new RangeError("outside fixture bytes");
    return Number(address);
  },
});

const budget = (): DispatchRecordBudget => ({
  truncated: false,
  isFull: () => false,
  markTruncated: () => undefined,
  admit: () => true,
});

it("keeps an encoded null distinct from a nonzero relative offset to address zero", () => {
  const bytes = Buffer.alloc(0x80);
  bytes.writeInt32LE(0, 0x20);
  bytes.writeInt32LE(-0x40, 0x40);
  bytes.writeInt32LE(0x25, 0x24);
  bytes.writeBigUInt64LE(0n, 0x48);
  bytes.writeInt32LE(0x25, 0x2c);
  bytes.writeBigUInt64LE(0x60n, 0x50);
  const result = objcSwiftMetadataSchema.parse({ db_save_result: null });
  const relative = createSwiftRelativeReader({
    bytes,
    readers: readers(bytes),
    budget: budget(),
    result,
  });

  expect(relative(0x20n, "methodImplementation")).toEqual({ kind: "null" });
  expect(relative(0x40n, "methodImplementation")).toEqual({
    kind: "target",
    target: 0n,
  });
  expect(relative(0x24n, "conformanceProtocol")).toEqual({ kind: "null" });
  expect(relative(0x2cn, "conformanceProtocol")).toEqual({
    kind: "target",
    target: 0x60n,
  });
  expect(result.relative_pointers).toMatchObject([
    { displacement: 0, target: { address: null, file_offset: null } },
    { displacement: -0x40, target: { address: "0x0", file_offset: 0 } },
    { displacement: 0x25, indirect: true, target: { address: null } },
    { displacement: 0x25, indirect: true, target: { address: "0x60" } },
  ]);
});

it("resolves zero offsets for nonnullable fields to their own field address", () => {
  const bytes = Buffer.alloc(0x80);
  bytes.writeInt32LE(0, 0x20);
  const result = objcSwiftMetadataSchema.parse({ db_save_result: null });
  const relative = createSwiftRelativeReader({
    bytes,
    readers: readers(bytes),
    budget: budget(),
    result,
  });

  for (const kind of [
    "conformanceRecord",
    "protocolName",
    "typeName",
    "typeMetadataRecord",
    "moduleName",
  ] as const) {
    expect(relative(0x20n, kind)).toEqual({ kind: "target", target: 0x20n });
  }
  expect(result.relative_pointers).toHaveLength(5);
  expect(result.relative_pointers).toMatchObject(
    Array.from({ length: 5 }, () => ({
      target: { address: "0x20", file_offset: 0x20 },
    })),
  );
});

it("accepts encoded zero only for nullable direct Swift fields", () => {
  const bytes = Buffer.alloc(0x80);
  const result = objcSwiftMetadataSchema.parse({ db_save_result: null });
  const relative = createSwiftRelativeReader({
    bytes,
    readers: readers(bytes),
    budget: budget(),
    result,
  });

  for (const kind of [
    "conformanceType",
    "witnessTablePattern",
    "methodImplementation",
  ] as const) {
    expect(relative(0x20n, kind)).toEqual({ kind: "null" });
  }
});

it("masks only the verified direct type metadata tag and keeps other tags unsupported", () => {
  const bytes = Buffer.alloc(0x80);
  bytes.writeInt32LE(0x24, 0x20);
  bytes.writeInt32LE(0x25, 0x28);
  bytes.writeInt32LE(0x26, 0x2c);
  bytes.writeInt32LE(0x27, 0x30);
  const result = objcSwiftMetadataSchema.parse({ db_save_result: null });
  const relative = createSwiftRelativeReader({
    bytes,
    readers: readers(bytes),
    budget: budget(),
    result,
  });

  expect(relative(0x20n, "typeMetadataRecord")).toEqual({
    kind: "target",
    target: 0x44n,
  });
  for (const [field, tag] of [
    [0x28n, 1],
    [0x2cn, 2],
    [0x30n, 3],
  ] as const) {
    expect(relative(field, "typeMetadataRecord")).toEqual({
      kind: "unknown",
      reason: `Unsupported Swift type metadata record tag ${tag}`,
    });
  }
  expect(result.relative_pointers.slice(-4)).toMatchObject([
    { displacement: 0x24, encoding_tag: 0, target: { address: "0x44" } },
    {
      displacement: 0x25,
      encoding_tag: 1,
      decode: { status: "unsupported" },
    },
    {
      displacement: 0x26,
      encoding_tag: 2,
      decode: { status: "unsupported" },
    },
    {
      displacement: 0x27,
      encoding_tag: 3,
      decode: { status: "unsupported" },
    },
  ]);
});

it("treats a zero pointer loaded through a nullable indirect field as null", () => {
  const bytes = Buffer.alloc(0x80);
  bytes.writeInt32LE(-0x23, 0x24); // odd-tagged displacement to cell address 0
  const result = objcSwiftMetadataSchema.parse({ db_save_result: null });
  const relative = createSwiftRelativeReader({
    bytes,
    readers: readers(bytes),
    budget: budget(),
    result,
  });

  expect(relative(0x24n, "conformanceProtocol")).toEqual({ kind: "null" });
  expect(result.relative_pointers[0]).toMatchObject({
    indirect: true,
    target: { address: null, file_offset: null },
  });
});

it("keeps a fixup rebase to VM address zero as an address, not null", () => {
  const bytes = Buffer.alloc(0x80);
  bytes.writeInt32LE(-0x23, 0x24);
  const result = objcSwiftMetadataSchema.parse({ db_save_result: null });
  const relative = createSwiftRelativeReader({
    bytes,
    readers: {
      ...readers(bytes),
      resolvePointer: () => ({ kind: "rebase", target: 0n }),
      offset: (address, size = 1) => {
        if (address === 0n) throw new RangeError("unmapped target address");
        return readers(bytes).offset(address, size);
      },
    },
    budget: budget(),
    result,
  });

  expect(relative(0x24n, "conformanceProtocol")).toEqual({
    kind: "target",
    target: 0n,
  });
  expect(result.relative_pointers[0]).toMatchObject({
    target: { address: "0x0", file_offset: null },
    decode: { status: "partial", reason: "unmapped target address" },
  });
});

it("preserves an indirect import binding instead of reading VM address zero", () => {
  const bytes = Buffer.alloc(0x80);
  bytes.writeInt32LE(-0x23, 0x24);
  const result = objcSwiftMetadataSchema.parse({ db_save_result: null });
  const relative = createSwiftRelativeReader({
    bytes,
    readers: {
      ...readers(bytes),
      resolvePointer: () => ({
        kind: "bind",
        symbol: "_$sSQMp",
        binding_source: "chained",
        library_ordinal: 1,
        library: "/System/Library/libswiftCore.dylib",
        weak: false,
        addend: 0n,
      }),
    },
    budget: budget(),
    result,
  });

  expect(relative(0x24n, "conformanceProtocol")).toMatchObject({
    kind: "binding",
    binding: { symbol: "_$sSQMp" },
  });
  expect(result.relative_pointers[0]).toMatchObject({
    target: { address: null, file_offset: null },
    binding: { symbol: "_$sSQMp", requested_address: "0x0" },
    decode: { status: "partial" },
  });
});

it("retains unsafe target addresses as partial decode facts", () => {
  const bytes = Buffer.alloc(0x80);
  bytes.writeInt32LE(0x100, 0x20);
  const result = objcSwiftMetadataSchema.parse({ db_save_result: null });
  const relative = createSwiftRelativeReader({
    bytes,
    readers: readers(bytes),
    budget: budget(),
    result,
  });

  expect(relative(0x20n, "protocolName")).toEqual({
    kind: "target",
    target: 0x120n,
  });
  expect(result.relative_pointers[0]).toMatchObject({
    target: { address: "0x120", file_offset: null },
    decode: { status: "partial", reason: "outside fixture bytes" },
  });
});
