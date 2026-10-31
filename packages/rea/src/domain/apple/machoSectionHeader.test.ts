import { expect, it } from "vitest";
import { readMachoSectionHeader } from "./machoSectionHeader.js";

const formats = [
  { wide: false, littleEndian: false, headerSize: 68 },
  { wide: false, littleEndian: true, headerSize: 68 },
  { wide: true, littleEndian: false, headerSize: 80 },
  { wide: true, littleEndian: true, headerSize: 80 },
] as const;

it.each(formats)(
  "preserves raw section facts (wide=$wide, littleEndian=$littleEndian)",
  ({ wide, littleEndian, headerSize }) => {
    const backing = Buffer.alloc(headerSize + 19, 0xa5);
    const bytes = backing.subarray(7, 7 + headerSize);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const names = Buffer.from([
      0x5f, 0x80, 0xff, 0, 0xe9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    names.copy(bytes, 0);
    const segmentNames = Buffer.from("__DATA\0trailing!", "latin1");
    segmentNames.copy(bytes, 16);
    const address = wide ? 0xfedcba9876543210n : 0xfedcba98n;
    const size = wide ? 0xffffffffffffffffn : 0xffffffffn;
    if (wide) {
      view.setBigUint64(32, address, littleEndian);
      view.setBigUint64(40, size, littleEndian);
    } else {
      view.setUint32(32, Number(address), littleEndian);
      view.setUint32(36, Number(size), littleEndian);
    }
    view.setUint32(wide ? 48 : 40, 0xffffffff, littleEndian);
    view.setUint32(wide ? 64 : 56, 0x89abcdef, littleEndian);
    const expectedSegmentName = Buffer.from(bytes.subarray(16, 32));
    const before = Buffer.from(backing);
    const parsed = readMachoSectionHeader(
      backing.subarray(7),
      wide,
      littleEndian,
    );
    expect(backing.equals(before)).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error.message);
    backing.fill(0);
    const { nameBytes, segmentNameBytes, ...facts } = parsed.value;
    expect(nameBytes.equals(names)).toBe(true);
    expect(segmentNameBytes.equals(expectedSegmentName)).toBe(true);
    expect(facts).toEqual({
      address,
      size,
      offset: 0xffffffff,
      flags: 0x89abcdef,
    });
  },
);

it.each(formats)(
  "refuses each truncated fixed section record (wide=$wide, littleEndian=$littleEndian)",
  ({ wide, littleEndian, headerSize }) => {
    const backing = Buffer.alloc(headerSize + 7, 0xff);
    for (let length = 0; length < headerSize; length++)
      expect(
        readMachoSectionHeader(
          backing.subarray(7, 7 + length),
          wide,
          littleEndian,
        ),
      ).toEqual({
        ok: false,
        error: {
          kind: "malformed",
          message: "Mach-O section header is truncated",
        },
      });
  },
);
