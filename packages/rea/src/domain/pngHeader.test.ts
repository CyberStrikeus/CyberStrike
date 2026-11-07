import { crc32 } from "node:zlib";
import { expect, it } from "vitest";
import { readPngHeaderDimensions } from "./pngHeader.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv4sAAAAASUVORK5CYII=",
  "base64",
);

it("reads encoded dimensions without changing screenshot bytes", () => {
  const bytes = Buffer.from(png);
  bytes.writeUInt32BE(257, 16);
  bytes.writeUInt32BE(129, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  const original = Buffer.from(bytes);
  expect(readPngHeaderDimensions(bytes)).toEqual({ width: 257, height: 129 });
  expect(bytes.equals(original)).toBe(true);
});

it.each([12, 13, 14, 15])("rejects ASCII-folded IHDR byte at %s", (offset) => {
  const bytes = Buffer.from(png);
  bytes[offset] = (bytes[offset] ?? 0) | 0x80;
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  expect(readPngHeaderDimensions(bytes)).toBeUndefined();
});

it("rejects incomplete headers, invalid signatures and zero dimensions", () => {
  expect(readPngHeaderDimensions(png.subarray(0, 23))).toBeUndefined();
  const badSignature = Buffer.from(png);
  badSignature[0] = 0;
  expect(readPngHeaderDimensions(badSignature)).toBeUndefined();
  for (const offset of [16, 20]) {
    const zero = Buffer.from(png);
    zero.writeUInt32BE(0, offset);
    zero.writeUInt32BE(crc32(zero.subarray(12, 29)), 29);
    expect(readPngHeaderDimensions(zero)).toBeUndefined();
  }
});

it.each([0, 12, 14, 0xffff_ffff])("rejects IHDR data length %s", (length) => {
  const bytes = Buffer.from(png);
  bytes.writeUInt32BE(length, 8);
  expect(readPngHeaderDimensions(bytes)).toBeUndefined();
});

it.each([16, 20])("rejects out-of-range PNG dimension at %s", (offset) => {
  const bytes = Buffer.from(png);
  bytes.writeUInt32BE(0x8000_0000, offset);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  expect(readPngHeaderDimensions(bytes)).toBeUndefined();
});

it("accepts the largest dimension representable by the PNG specification", () => {
  const bytes = Buffer.from(png);
  bytes.writeUInt32BE(0x7fff_ffff, 16);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  expect(readPngHeaderDimensions(bytes)).toEqual({
    width: 0x7fff_ffff,
    height: 1,
  });
});

it.each([24, 32, "crc"])("rejects incomplete or corrupt IHDR %s", (kind) => {
  const bytes = Buffer.from(png);
  if (kind === "crc") bytes[29] = (bytes[29] ?? 0) ^ 1;
  expect(
    readPngHeaderDimensions(
      typeof kind === "number" ? bytes.subarray(0, kind) : bytes,
    ),
  ).toBeUndefined();
});
