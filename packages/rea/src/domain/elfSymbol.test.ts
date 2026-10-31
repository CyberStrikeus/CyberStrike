import { expect, it } from "vitest";
import { readElfSymbol } from "./elfSymbol.js";

const formats = [
  { bits: 32, littleEndian: false },
  { bits: 32, littleEndian: true },
  { bits: 64, littleEndian: false },
  { bits: 64, littleEndian: true },
] as const;

it.each(formats)(
  "preserves raw ELF$bits symbols (littleEndian=$littleEndian)",
  ({ bits, littleEndian }) => {
    const wide = bits === 64;
    const length = wide ? 24 : 16;
    const backing = Buffer.alloc(length + 19, 0xa5);
    const bytes = backing.subarray(7, 7 + length);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const value = wide ? 0xfedcba9876543210n : 0xfedcba98n;
    const size = wide ? 0xffffffffffffffffn : 0xffffffffn;
    view.setUint32(0, 0x89abcdef, littleEndian);
    view.setUint8(wide ? 4 : 12, 0xf3);
    view.setUint8(wide ? 5 : 13, 0xee);
    view.setUint16(wide ? 6 : 14, 0xffff, littleEndian);
    if (wide) {
      view.setBigUint64(8, value, littleEndian);
      view.setBigUint64(16, size, littleEndian);
    } else {
      view.setUint32(4, Number(value), littleEndian);
      view.setUint32(8, Number(size), littleEndian);
    }
    const before = Buffer.from(backing);
    const parsed = readElfSymbol(backing.subarray(7), bits, littleEndian);
    expect(backing.equals(before)).toBe(true);
    backing.fill(0);
    expect(parsed).toEqual({
      ok: true,
      value: {
        name_offset: 0x89abcdef,
        binding: 15,
        type: 3,
        other: 0xee,
        section_index: 0xffff,
        value,
        size,
      },
    });
  },
);

it.each(formats)(
  "refuses each incomplete ELF$bits symbol (littleEndian=$littleEndian)",
  ({ bits, littleEndian }) => {
    const length = bits === 64 ? 24 : 16;
    const backing = Buffer.alloc(length + 7, 0xff);
    for (let observed = 0; observed < length; observed++)
      expect(
        readElfSymbol(backing.subarray(7, 7 + observed), bits, littleEndian),
      ).toEqual({
        ok: false,
        error: { kind: "malformed", message: "ELF symbol record is truncated" },
      });
  },
);
