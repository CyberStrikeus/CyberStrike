import { expect, it } from "vitest";
import { readElfRawTableDeclarations } from "./elfRawTableDeclarations.js";

const formats = [
  { elfClass: 32, byteOrder: "little" },
  { elfClass: 32, byteOrder: "big" },
  { elfClass: 64, byteOrder: "little" },
  { elfClass: 64, byteOrder: "big" },
] as const;

it.each(formats)(
  "preserves unresolved raw ELF$elfClass $byteOrder declarations",
  (format) => {
    const wide = format.elfClass === 64;
    const little = format.byteOrder === "little";
    const length = wide ? 64 : 52;
    const backing = Buffer.alloc(length + 17, 0xa5);
    const bytes = backing.subarray(7, 7 + length);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const programOffset = wide ? 0xfedcba9876543210n : 0xfedcba98n;
    const sectionOffset = wide ? 0xffffffffffffffffn : 0xffffffffn;
    if (wide) {
      view.setBigUint64(32, programOffset, little);
      view.setBigUint64(40, sectionOffset, little);
    } else {
      view.setUint32(28, Number(programOffset), little);
      view.setUint32(32, Number(sectionOffset), little);
    }
    [1, 0xffff, 2, 0, 0xffff].forEach((value, index) =>
      view.setUint16((wide ? 54 : 42) + index * 2, value, little),
    );
    const before = Buffer.from(backing);
    const parsed = readElfRawTableDeclarations(backing.subarray(7), format);
    expect(backing.equals(before)).toBe(true);
    backing.fill(0);
    expect(parsed).toEqual({
      ok: true,
      value: {
        programs: { offset: programOffset, width: 1, count: 0xffff },
        sections: {
          offset: sectionOffset,
          width: 2,
          count: 0,
          namesIndex: 0xffff,
        },
      },
    });
    // Format identity and whether these unresolved declarations are admissible belong to callers.
  },
);

it.each(formats)(
  "refuses truncated ELF$elfClass $byteOrder declaration records",
  (format) => {
    const length = format.elfClass === 64 ? 64 : 52;
    const backing = Buffer.alloc(length + 7);
    for (let observed = 0; observed < length; observed++)
      expect(
        readElfRawTableDeclarations(backing.subarray(7, 7 + observed), format),
      ).toEqual({
        ok: false,
        error: {
          kind: "malformed",
          message: "ELF table declarations are truncated",
        },
      });
  },
);
