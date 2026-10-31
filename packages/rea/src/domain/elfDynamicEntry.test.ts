import { expect, it } from "vitest";
import { readElfDynamicEntry } from "./elfDynamicEntry.js";

const formats = [
  { bits: 32, littleEndian: false },
  { bits: 32, littleEndian: true },
  { bits: 64, littleEndian: false },
  { bits: 64, littleEndian: true },
] as const;

it.each(formats)(
  "preserves signed ELF$bits tags and unsigned values (littleEndian=$littleEndian)",
  ({ bits, littleEndian }) => {
    const wide = bits === 64;
    const length = wide ? 16 : 8;
    const backing = Buffer.alloc(length + 19, 0xa5);
    const bytes = backing.subarray(7, 7 + length);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = wide ? -0x8000000000000000n : -0x80000000n;
    const value = wide ? 0xffffffffffffffffn : 0xffffffffn;
    if (wide) {
      view.setBigInt64(0, tag, littleEndian);
      view.setBigUint64(8, value, littleEndian);
    } else {
      view.setInt32(0, Number(tag), littleEndian);
      view.setUint32(4, Number(value), littleEndian);
    }
    const before = Buffer.from(backing);
    const parsed = readElfDynamicEntry(backing.subarray(7), bits, littleEndian);
    expect(backing.equals(before)).toBe(true);
    backing.fill(0);
    expect(parsed).toEqual({ ok: true, value: { tag, value } });
    expect(readElfDynamicEntry(bytes, bits, littleEndian)).toEqual({
      ok: true,
      value: { tag: 0n, value: 0n },
    });
  },
);

it.each(formats)(
  "refuses incomplete ELF$bits dynamic entries (littleEndian=$littleEndian)",
  ({ bits, littleEndian }) => {
    const length = bits === 64 ? 16 : 8;
    const backing = Buffer.alloc(length + 7);
    for (let observed = 0; observed < length; observed++)
      expect(
        readElfDynamicEntry(
          backing.subarray(7, 7 + observed),
          bits,
          littleEndian,
        ),
      ).toEqual({
        ok: false,
        error: { kind: "malformed", message: "ELF dynamic entry is truncated" },
      });
  },
);
