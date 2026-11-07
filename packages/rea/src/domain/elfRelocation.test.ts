import { expect, it } from "vitest";
import { readElfRelocationEntry } from "./elfRelocation.js";

const formats = [
  { bits: 32, littleEndian: false },
  { bits: 32, littleEndian: true },
  { bits: 64, littleEndian: false },
  { bits: 64, littleEndian: true },
] as const;

it.each(formats)(
  "preserves standard ELF$bits REL/RELA fields (littleEndian=$littleEndian)",
  ({ bits, littleEndian }) => {
    const wide = bits === 64;
    const wordBytes = wide ? 8 : 4;
    const backing = Buffer.alloc(wordBytes * 3 + 19, 0xa5);
    const bytes = backing.subarray(7, 7 + wordBytes * 3);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const offset = wide ? 0xffffffffffffffffn : 0xffffffffn;
    const symbolIndex = wide ? 0xfedcba98 : 0xabcdef;
    const type = wide ? 0x89abcdef : 0x80;
    const info = (BigInt(symbolIndex) << (wide ? 32n : 8n)) | BigInt(type);
    const addend = wide ? -0x8000000000000000n : -0x80000000n;
    if (wide) {
      view.setBigUint64(0, offset, littleEndian);
      view.setBigUint64(8, info, littleEndian);
      view.setBigInt64(16, addend, littleEndian);
    } else {
      view.setUint32(0, Number(offset), littleEndian);
      view.setUint32(4, Number(info), littleEndian);
      view.setInt32(8, Number(addend), littleEndian);
    }
    const before = Buffer.from(backing);
    const rel = readElfRelocationEntry(
      backing.subarray(7),
      bits,
      littleEndian,
      "rel",
    );
    const rela = readElfRelocationEntry(
      backing.subarray(7),
      bits,
      littleEndian,
      "rela",
    );
    expect(backing.equals(before)).toBe(true);
    backing.fill(0);
    expect(rel).toEqual({
      ok: true,
      value: { offset, type, symbolIndex },
    });
    expect(rela).toEqual({
      ok: true,
      value: { offset, type, symbolIndex, addend },
    });
  },
);

it.each(formats)(
  "refuses every incomplete ELF$bits REL/RELA entry (littleEndian=$littleEndian)",
  ({ bits, littleEndian }) => {
    const wordBytes = bits === 64 ? 8 : 4;
    const bytes = Buffer.alloc(wordBytes * 3 + 7);
    for (let observed = 0; observed < wordBytes * 3; observed++) {
      const input = bytes.subarray(7, 7 + observed);
      const failure = {
        ok: false,
        error: {
          kind: "malformed",
          message: "ELF relocation entry is truncated",
        },
      };
      expect(readElfRelocationEntry(input, bits, littleEndian, "rela")).toEqual(
        failure,
      );
      if (observed < wordBytes * 2)
        expect(
          readElfRelocationEntry(input, bits, littleEndian, "rel"),
        ).toEqual(failure);
    }
  },
);
