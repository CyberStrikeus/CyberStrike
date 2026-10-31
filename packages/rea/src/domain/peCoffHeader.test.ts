import { expect, it } from "vitest";
import { readPeCoffHeader } from "./peCoffHeader.js";

it("retains raw COFF declarations from a borrowed record without admission policy", () => {
  const source = Buffer.alloc(39, 0xa5);
  const record = source.subarray(7, 27);
  record.writeUInt16LE(0xffff, 0);
  record.writeUInt16LE(0x1234, 2);
  record.writeUInt16LE(0xfedc, 16);
  record.writeUInt16LE(0x89ab, 18);
  const before = Buffer.from(source);
  expect(readPeCoffHeader(source.subarray(7))).toEqual({
    ok: true,
    value: {
      machine: 0xffff,
      sectionCount: 0x1234,
      optionalHeaderSize: 0xfedc,
      characteristics: 0x89ab,
    },
  });
  expect(source.equals(before)).toBe(true);
});

it.each(Array.from({ length: 20 }, (_, length) => length))(
  "reports a truncated %i-byte COFF record without reading outside it",
  (length) => {
    const source = Buffer.alloc(40, 0xff);
    expect(readPeCoffHeader(source.subarray(7, 7 + length))).toEqual({
      ok: false,
      error: { kind: "malformed", message: "PE COFF header is truncated" },
    });
  },
);
