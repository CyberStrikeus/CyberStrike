import { expect, it } from "vitest";
import { readElfFixedHeader, readElfHeaderFacts } from "./elfFixedHeader.js";
import { elf } from "./binaryTarget.fixture.js";

it.each([
  ["ELF32 little endian", 1, 1],
  ["ELF32 big endian", 1, 2],
  ["ELF64 little endian", 2, 1],
  ["ELF64 big endian", 2, 2],
] as const)(
  "reads common fixed header commitments for %s",
  (_name, cls, data) => {
    const bytes = elf(cls, data, cls === 1 ? 3 : 62);
    const flagsOffset = cls === 1 ? 36 : 48;
    if (data === 1) {
      bytes.writeUInt16LE(0xfe01, 16);
      bytes.writeUInt32LE(0x89abcdef, flagsOffset);
    } else {
      bytes.writeUInt16BE(0xfe01, 16);
      bytes.writeUInt32BE(0x89abcdef, flagsOffset);
    }
    expect(readElfFixedHeader(bytes)).toEqual({
      ok: true,
      value: {
        elfClass: cls === 1 ? 32 : 64,
        byteOrder: data === 1 ? "little" : "big",
        headerSize: cls === 1 ? 52 : 64,
        machine: cls === 1 ? 3 : 62,
        type: 0xfe01,
        flags: 0x89abcdef,
        osAbi: 0,
        architecture: cls === 1 ? "x86" : "x86_64",
      },
    });
  },
);

it.each([
  [
    "identification version",
    (bytes: Buffer) => {
      bytes[6] = 0;
    },
  ],
  [
    "header version",
    (bytes: Buffer) => {
      bytes.writeUInt32LE(0, 20);
    },
  ],
  [
    "undersized declared header",
    (bytes: Buffer) => {
      bytes.writeUInt16LE(51, 40);
    },
  ],
  [
    "declared header beyond file",
    (bytes: Buffer) => {
      bytes.writeUInt16LE(53, 40);
    },
  ],
])("rejects an invalid %s", (_name, corrupt) => {
  const bytes = elf(1, 1, 3);
  corrupt(bytes);
  expect(readElfFixedHeader(bytes)).toMatchObject({ ok: false });
});

it("checks declared header size against the whole file, not the prefix", () => {
  const bytes = elf(2, 1, 62);
  bytes.writeUInt16LE(128, 52);
  expect(readElfFixedHeader(bytes, 128)).toMatchObject({ ok: true });
  expect(readElfFixedHeader(bytes, 127)).toMatchObject({ ok: false });
});

it("preserves an unknown ELF machine as a fact without rejecting the header", () => {
  expect(readElfFixedHeader(elf(2, 2, 0xfffe))).toMatchObject({
    ok: true,
    value: { machine: 0xfffe, architecture: null },
  });
});

it("accepts NVIDIA's vendor ELF version only for the CUDA machine and OS ABI", () => {
  const bytes = elf(2, 1, 190);
  bytes.writeUInt32LE(0x81, 20);
  expect(readElfFixedHeader(bytes).ok).toBe(false);
  bytes[7] = 0x33;
  expect(readElfFixedHeader(bytes)).toMatchObject({
    ok: true,
    value: { machine: 190 },
  });
  bytes.writeUInt16LE(62, 18);
  expect(readElfFixedHeader(bytes).ok).toBe(false);
});

it.each([
  { cls: 1, data: 1 },
  { cls: 1, data: 2 },
  { cls: 2, data: 1 },
  { cls: 2, data: 2 },
] as const)(
  "preserves raw version, ABI and declared size facts ($cls/$data)",
  ({ cls, data }) => {
    const original = elf(cls, data, 0xfffe);
    const bytes = Buffer.concat([Buffer.alloc(7), original]).subarray(7);
    bytes[8] = 0xff;
    if (data === 1) {
      bytes.writeUInt32LE(0x89abcdef, 20);
      bytes.writeUInt16LE(0, cls === 1 ? 40 : 52);
    } else {
      bytes.writeUInt32BE(0x89abcdef, 20);
      bytes.writeUInt16BE(0, cls === 1 ? 40 : 52);
    }
    expect(readElfHeaderFacts(bytes)).toMatchObject({
      ok: true,
      value: {
        elfClass: cls === 1 ? 32 : 64,
        byteOrder: data === 1 ? "little" : "big",
        machine: 0xfffe,
        version: 0x89abcdef,
        abiVersion: 0xff,
        headerSize: 0,
      },
    });
    expect(readElfFixedHeader(bytes)).toEqual({
      ok: false,
      error: "unsupported ELF header version",
    });
  },
);

it("keeps framing failures ahead of version and declared-size admission", () => {
  const bytes = elf(2, 1, 62);
  bytes[6] = 0;
  bytes.writeUInt32LE(0, 20);
  bytes.writeUInt16LE(0, 52);
  expect(readElfFixedHeader(bytes.subarray(0, 16), 16)).toEqual({
    ok: false,
    error: "unsupported ELF identification version",
  });
  bytes[6] = 1;
  const truncated = readElfFixedHeader(bytes, 63);
  expect(truncated).toEqual(readElfHeaderFacts(bytes, 63));
  expect(truncated).toMatchObject({
    ok: false,
    error: expect.stringContaining("truncated ELF header"),
  });
  expect(readElfFixedHeader(bytes)).toEqual({
    ok: false,
    error: "unsupported ELF header version",
  });
  bytes.writeUInt32LE(1, 20);
  expect(readElfFixedHeader(bytes)).toEqual({
    ok: false,
    error: "invalid ELF header size",
  });
});
