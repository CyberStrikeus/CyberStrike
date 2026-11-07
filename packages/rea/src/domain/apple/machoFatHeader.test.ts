import { expect, it } from "vitest";
import {
  readFatHeaderPrefix,
  readFatContainerHeader,
} from "./machoContainer.js";

const formats = [
  { magic: 0xcafebabe, wide: false, littleEndian: false },
  { magic: 0xcafebabf, wide: true, littleEndian: false },
  { magic: 0xbebafeca, wide: false, littleEndian: true },
  { magic: 0xbfbafeca, wide: true, littleEndian: true },
] as const;

it.each(formats)(
  "preserves incomplete FAT format evidence ($magic)",
  (format) => {
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32BE(format.magic);
    for (let observed = 0; observed < 8; observed++)
      expect(readFatHeaderPrefix(bytes.subarray(0, observed))).toEqual(
        observed < 4
          ? { state: "unknown", requiredBytes: 4 }
          : { state: "incomplete", ...format, requiredBytes: 8 },
      );
  },
);

it.each(formats)(
  "retains raw zero and maximum counts without policy or table allocation ($magic)",
  (format) => {
    const backing = Buffer.alloc(27, 0xa5);
    const window = backing.subarray(7, 15);
    const view = new DataView(
      window.buffer,
      window.byteOffset,
      window.byteLength,
    );
    view.setUint32(0, format.magic, false);
    for (const count of [0, 0xffffffff]) {
      view.setUint32(4, count, format.littleEndian);
      const before = Buffer.from(backing);
      const parsed = readFatHeaderPrefix(backing.subarray(7));
      expect(backing.equals(before)).toBe(true);
      expect(parsed).toEqual({
        state: "parsed",
        ...format,
        count,
        tableEnd: 8 + count * (format.wide ? 32 : 20),
      });
    }
  },
);

it("distinguishes observed non-FAT bytes from unavailable magic", () => {
  const bytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
  expect(readFatHeaderPrefix(bytes)).toEqual({
    state: "not-fat",
    magic: 0x7f454c46,
  });
  expect(readFatHeaderPrefix(bytes.subarray(0, 3))).toEqual({
    state: "unknown",
    requiredBytes: 4,
  });
});

it("keeps full-header file extent admission ahead of zero-count admission", () => {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt32BE(0xcafebabe);
  expect(readFatContainerHeader(bytes, 7)).toEqual({
    state: "malformed",
    reason: "FAT file size is invalid or contradicts retained bytes",
  });
  expect(readFatContainerHeader(bytes, 8)).toEqual({
    state: "malformed",
    reason: "FAT header declares no architectures",
  });
});
