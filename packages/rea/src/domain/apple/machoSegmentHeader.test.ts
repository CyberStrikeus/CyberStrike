import { expect, it } from "vitest";
import { readMachoSegmentHeader } from "./machoSegmentHeader.js";

const formats = [
  { wide: false, littleEndian: false, headerSize: 56 },
  { wide: false, littleEndian: true, headerSize: 56 },
  { wide: true, littleEndian: false, headerSize: 72 },
  { wide: true, littleEndian: true, headerSize: 72 },
] as const;

it.each(formats)(
  "retains exact raw segment facts (wide=$wide, littleEndian=$littleEndian)",
  ({ wide, littleEndian, headerSize }) => {
    const backing = Buffer.alloc(headerSize + 19, 0xa5);
    const bytes = backing.subarray(7, 7 + headerSize);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const names = Buffer.from([
      0x5f, 0x80, 0xff, 0, 0xe9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    names.copy(bytes, 8);
    const values = wide
      ? [
          0xfedcba9876543210n,
          0x8000000000000001n,
          0xffffffffffffffffn,
          0x123456789abcdef0n,
        ]
      : [0xfedcba98n, 0x80000001n, 0xffffffffn, 0x12345678n];
    values.forEach((value, index) => {
      if (wide) view.setBigUint64(24 + index * 8, value, littleEndian);
      else view.setUint32(24 + index * 4, Number(value), littleEndian);
    });
    const protections = wide ? 56 : 40;
    [0x80000001, 0xfedcba98, 0xffffffff].forEach((value, index) =>
      view.setUint32(protections + index * 4, value, littleEndian),
    );
    const before = Buffer.from(backing);
    // A borrowed window may include following command bytes; only fixed fields belong here.
    const parsed = readMachoSegmentHeader(
      backing.subarray(7),
      wide,
      littleEndian,
    );
    expect(backing.equals(before)).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error.message);
    backing.fill(0);
    const { nameBytes, ...facts } = parsed.value;
    expect(nameBytes.equals(names)).toBe(true);
    expect(facts).toEqual({
      headerSize,
      address: values[0],
      memorySize: values[1],
      fileOffset: values[2],
      fileSize: values[3],
      maxProtection: 0x80000001,
      protection: 0xfedcba98,
      sectionCount: 0xffffffff,
    });
  },
);

it.each(formats)(
  "refuses every incomplete fixed segment record (wide=$wide, littleEndian=$littleEndian)",
  ({ wide, littleEndian, headerSize }) => {
    const backing = Buffer.alloc(headerSize + 7, 0xff);
    for (let length = 0; length < headerSize; length++)
      expect(
        readMachoSegmentHeader(
          backing.subarray(7, 7 + length),
          wide,
          littleEndian,
        ),
      ).toEqual({
        ok: false,
        error: {
          kind: "malformed",
          message: "Mach-O segment header is truncated",
        },
      });
  },
);
