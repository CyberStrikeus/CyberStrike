import { expect, it } from "vitest";
import { readElfProgramHeader } from "./elfProgramHeader.js";

const formats = [
  { bits: 32, littleEndian: false },
  { bits: 32, littleEndian: true },
  { bits: 64, littleEndian: false },
  { bits: 64, littleEndian: true },
] as const;

it.each(formats)(
  "preserves exact ELF$bits raw program fields (littleEndian=$littleEndian)",
  ({ bits, littleEndian }) => {
    const wide = bits === 64;
    const length = wide ? 56 : 32;
    const backing = Buffer.alloc(length + 19, 0xa5);
    const bytes = backing.subarray(7, 7 + length);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const values = wide
      ? [
          0xffffffffffffffffn,
          0xfedcba9876543210n,
          0x8000000000000001n,
          0x123456789abcdef0n,
          0x8888888888888888n,
          0x7777777777777777n,
        ]
      : [
          0xffffffffn,
          0xfedcba98n,
          0x80000001n,
          0x12345678n,
          0x88888888n,
          0x77777777n,
        ];
    view.setUint32(0, 0xfedcba98, littleEndian);
    view.setUint32(wide ? 4 : 24, 0x89abcdef, littleEndian);
    const offsets = wide ? [8, 16, 24, 32, 40, 48] : [4, 8, 12, 16, 20, 28];
    values.forEach((value, index) => {
      if (wide) view.setBigUint64(offsets[index]!, value, littleEndian);
      else view.setUint32(offsets[index]!, Number(value), littleEndian);
    });
    const before = Buffer.from(backing);
    const parsed = readElfProgramHeader(
      backing.subarray(7),
      bits,
      littleEndian,
    );
    expect(backing.equals(before)).toBe(true);
    backing.fill(0);
    expect(parsed).toEqual({
      ok: true,
      value: {
        type: 0xfedcba98,
        flags: 0x89abcdef,
        offset: values[0],
        virtualAddress: values[1],
        physicalAddress: values[2],
        fileSize: values[3],
        memorySize: values[4],
        alignment: values[5],
      },
    });
  },
);

it.each(formats)(
  "refuses each incomplete ELF$bits program record (littleEndian=$littleEndian)",
  ({ bits, littleEndian }) => {
    const length = bits === 64 ? 56 : 32;
    const backing = Buffer.alloc(length + 7);
    for (let observed = 0; observed < length; observed++)
      expect(
        readElfProgramHeader(
          backing.subarray(7, 7 + observed),
          bits,
          littleEndian,
        ),
      ).toEqual({
        ok: false,
        error: {
          kind: "malformed",
          message: "ELF program header is truncated",
        },
      });
  },
);
