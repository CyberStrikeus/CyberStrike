import { expect, it } from "vitest";
import { parseInesLayout } from "./inesContainer.js";

const header = (): Buffer => {
  const bytes = Buffer.alloc(16);
  bytes.write("NES\x1a", "latin1");
  bytes[4] = 1;
  return bytes;
};

it("bounds the complete classic header count without inventing RAM regions", () => {
  const bytes = header();
  bytes[4] = 255;
  bytes[5] = 255;
  bytes[6] = 0xfe;
  bytes[7] = 0xf3;
  const parsed = parseInesLayout(bytes, 16 + 512 + 255 * (16_384 + 8_192));
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.value.header).toMatchObject({
    mapper: 255,
    trainer_present: true,
    battery_flag: true,
    mirroring: "four-screen",
  });
  expect(parsed.value.regions).toHaveLength(512);
  expect(parsed.value.regions.at(-1)).toMatchObject({
    path: "chr/254.bin",
    length: 8_192,
  });
});

it.each([
  {
    label: "short header",
    modify: (bytes: Buffer) => bytes.subarray(0, 8),
    size: 8,
    reason: "truncated iNES header",
  },
  {
    label: "short payload",
    modify: (bytes: Buffer) => bytes,
    size: 16,
    reason: "truncated iNES payload",
  },
  {
    label: "NES 2.0",
    modify: (bytes: Buffer) => {
      bytes[7] = 8;
      return bytes;
    },
    size: 16_400,
    reason: "nes-2.0",
  },
  {
    label: "dirty legacy header",
    modify: (bytes: Buffer) => {
      bytes[12] = 1;
      return bytes;
    },
    size: 16_400,
    reason: "ambiguous iNES mapper",
  },
  {
    label: "empty PRG",
    modify: (bytes: Buffer) => {
      bytes[4] = 0;
      return bytes;
    },
    size: 16,
    reason: "at least one PRG",
  },
  {
    label: "unsupported variant",
    modify: (bytes: Buffer) => {
      bytes[7] = 4;
      return bytes;
    },
    size: 16_400,
    reason: "unsupported iNES header variant",
  },
  {
    label: "unsafe extent",
    modify: (bytes: Buffer) => bytes,
    size: Number.MAX_SAFE_INTEGER + 1,
    reason: "invalid iNES file extent",
  },
])("refuses $label before producing regions", ({ modify, size, reason }) => {
  expect(parseInesLayout(modify(header()), size)).toMatchObject({
    ok: false,
    error: expect.stringContaining(reason),
  });
});
