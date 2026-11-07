import { expect, it } from "vitest";
import { readPeOptionalHeader } from "./peMachine.js";
import { readPeOptionalHeaderStructure } from "./peOptionalHeader.js";

const formats = [
  { format: "pe32", magic: 0x10b, bits: 32, directoryOffset: 96 },
  { format: "pe32-plus", magic: 0x20b, bits: 64, directoryOffset: 112 },
] as const;

const header = (
  format: (typeof formats)[number],
  directoryCount: number,
  byteLength = format.directoryOffset + directoryCount * 8,
): Buffer => {
  const bytes = Buffer.alloc(byteLength);
  bytes.writeUInt16LE(format.magic);
  if (format.bits === 64) bytes.writeBigUInt64LE(0xfedcba9876540000n, 24);
  else bytes.writeUInt32LE(0x87650000, 28);
  bytes.writeUInt32LE(0x1000, 32);
  bytes.writeUInt32LE(0x200, 36);
  bytes.writeUInt32LE(0x400, 60);
  bytes.writeUInt32LE(directoryCount, format.directoryOffset - 4);
  return bytes;
};

it.each(formats)(
  "copies $format declarations and raw directory addresses with their locations",
  (format) => {
    const bytes = header(format, 5);
    bytes.writeUInt32LE(0x2000, format.directoryOffset);
    bytes.writeUInt32LE(0x180, format.directoryOffset + 4);
    const securityOffset = format.directoryOffset + 4 * 8;
    bytes.writeUInt32LE(0x600, securityOffset);
    bytes.writeUInt32LE(0x80, securityOffset + 4);
    const result = readPeOptionalHeaderStructure(bytes);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({
      ...format,
      imageBase: format.bits === 64 ? 0xfedcba9876540000n : 0x87650000n,
      sectionAlignment: 0x1000,
      fileAlignment: 0x200,
      sizeOfHeaders: 0x400,
      directoryCount: 5,
    });
    expect(result.value.dataDirectories).toEqual([
      { address: 0x2000, size: 0x180, offset: format.directoryOffset },
      { address: 0, size: 0, offset: format.directoryOffset + 8 },
      { address: 0, size: 0, offset: format.directoryOffset + 16 },
      { address: 0, size: 0, offset: format.directoryOffset + 24 },
      { address: 0x600, size: 0x80, offset: securityOffset },
    ]);
  },
);

it.each(formats)(
  "keeps $format zero directories and SizeOfHeaders as declarations",
  (format) => {
    const bytes = header(format, 0);
    bytes.writeUInt32LE(0xffffffff, 60);
    expect(readPeOptionalHeaderStructure(bytes)).toEqual({
      ok: true,
      value: {
        ...format,
        imageBase: format.bits === 64 ? 0xfedcba9876540000n : 0x87650000n,
        sectionAlignment: 0x1000,
        fileAlignment: 0x200,
        sizeOfImage: 0,
        sizeOfHeaders: 0xffffffff,
        directoryCountOffset: format.directoryOffset - 4,
        directoryCount: 0,
        dataDirectories: [],
      },
    });
  },
);

it.each([
  {
    name: "missing magic",
    bytes: new Uint8Array(),
    kind: "malformed",
    reason: "truncated-magic",
  },
  {
    name: "one magic byte",
    bytes: new Uint8Array([0x0b]),
    kind: "malformed",
    reason: "truncated-magic",
  },
  {
    name: "unsupported magic before absent fixed fields",
    bytes: new Uint8Array([0, 0]),
    kind: "unsupported",
    reason: "unsupported-magic",
  },
  ...formats.map((format) => ({
    name: `truncated ${format.format} fixed fields`,
    bytes: header(format, 0).subarray(0, format.directoryOffset - 1),
    kind: "malformed",
    reason: "truncated-fixed-fields",
  })),
])("rejects $name with a structural failure tag", ({ bytes, kind, reason }) => {
  expect(readPeOptionalHeaderStructure(bytes)).toMatchObject({
    ok: false,
    error: { kind, reason, message: expect.any(String) },
  });
});

it.each(formats)("rejects a partial $format directory entry", (format) => {
  const bytes = header(format, 1).subarray(0, format.directoryOffset + 7);
  expect(readPeOptionalHeaderStructure(bytes)).toEqual({
    ok: false,
    error: {
      kind: "malformed",
      reason: "truncated-directory-table",
      message: "truncated PE data-directory table",
    },
  });
});

it.each(formats)(
  "refuses the maximum declared $format directory count without its bytes",
  (format) => {
    const bytes = header(format, 0);
    bytes.writeUInt32LE(0xffffffff, format.directoryOffset - 4);
    expect(readPeOptionalHeaderStructure(bytes)).toMatchObject({
      ok: false,
      error: { kind: "malformed", reason: "truncated-directory-table" },
    });
  },
);

it.each(formats)(
  "reads every $format directory that fits the maximum COFF optional-header extent",
  (format) => {
    const byteLength = 0xffff;
    const directoryCount = Math.floor(
      (byteLength - format.directoryOffset) / 8,
    );
    const bytes = header(format, directoryCount, byteLength);
    const offset = format.directoryOffset + (directoryCount - 1) * 8;
    bytes.writeUInt32LE(0xffffffff, offset);
    bytes.writeUInt32LE(0xfffffffe, offset + 4);
    const result = readPeOptionalHeaderStructure(bytes);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.directoryCount).toBe(directoryCount);
    expect(result.value.dataDirectories).toHaveLength(directoryCount);
    expect(result.value.dataDirectories.at(-1)).toEqual({
      address: 0xffffffff,
      size: 0xfffffffe,
      offset,
    });
  },
);

it("honors a Uint8Array window and detaches facts from later source changes", () => {
  const bytes = header(formats[1], 1);
  bytes.writeUInt32LE(0x12345678, 112);
  bytes.writeUInt32LE(0x90, 116);
  const backing = Buffer.alloc(bytes.length + 12, 0xcc);
  bytes.copy(backing, 5);
  const window = new Uint8Array(
    backing.buffer,
    backing.byteOffset + 5,
    bytes.length,
  );
  const result = readPeOptionalHeaderStructure(window);
  if (!result.ok) throw new Error(result.error.message);
  backing.fill(0);
  expect(result.value).toEqual({
    ...formats[1],
    imageBase: 0xfedcba9876540000n,
    sectionAlignment: 0x1000,
    fileAlignment: 0x200,
    sizeOfImage: 0,
    sizeOfHeaders: 0x400,
    directoryCountOffset: formats[1].directoryOffset - 4,
    directoryCount: 1,
    dataDirectories: [{ address: 0x12345678, size: 0x90, offset: 112 }],
  });
});

it("keeps structural refusal ahead of conflicting machine width", () => {
  const bytes = header(formats[0], 0);
  bytes.writeUInt32LE(1, 92);
  expect(readPeOptionalHeader(bytes, 0x8664)).toEqual({
    ok: false,
    error: { kind: "malformed", message: "truncated PE data-directory table" },
  });
  bytes.writeUInt32LE(0, 92);
  expect(readPeOptionalHeader(bytes, 0x8664)).toEqual({
    ok: false,
    error: {
      kind: "malformed",
      message: "PE optional-header magic does not match its architecture",
    },
  });
});
