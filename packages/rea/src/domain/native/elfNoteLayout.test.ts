import { expect, it } from "vitest";
import { readElfNoteHeader } from "./elfNoteLayout.js";

it.each([false, true])(
  "preserves raw note sizes and type without admission (littleEndian=%s)",
  (littleEndian) => {
    const backing = Buffer.alloc(31, 0xa5);
    const bytes = backing.subarray(7, 19);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(0, 0xffffffff, littleEndian);
    view.setUint32(4, 0x80000001, littleEndian);
    view.setUint32(8, 0xfedcba98, littleEndian);
    const before = Buffer.from(backing);
    const parsed = readElfNoteHeader(backing.subarray(7), littleEndian);
    expect(backing.equals(before)).toBe(true);
    backing.fill(0);
    expect(parsed).toEqual({
      ok: true,
      value: { namesz: 0xffffffff, descsz: 0x80000001, type: 0xfedcba98 },
    });
  },
);

it.each([false, true])(
  "refuses incomplete note headers (littleEndian=%s)",
  (littleEndian) => {
    const bytes = Buffer.alloc(19);
    for (let observed = 0; observed < 12; observed++)
      expect(
        readElfNoteHeader(bytes.subarray(7, 7 + observed), littleEndian),
      ).toEqual({
        ok: false,
        error: { kind: "malformed", message: "ELF note header is truncated" },
      });
  },
);
