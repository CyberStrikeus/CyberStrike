import { describe, expect, it } from "vitest";

import {
  APK_BLOCK_ID,
  locateApkSigningBlock,
  parseZipTail,
} from "./apkSigningBlock.js";

/** Little-endian byte builder for a minimal APK-like tail. */
class Bytes {
  readonly b: number[] = [];
  u16(v: number): this {
    this.b.push(v & 0xff, (v >> 8) & 0xff);
    return this;
  }
  u32(v: number): this {
    this.b.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }
  u64(v: number): this {
    return this.u32(v).u32(0); // values in tests stay within 32 bits
  }
  raw(bytes: readonly number[]): this {
    this.b.push(...bytes);
    return this;
  }
  ascii(text: string): this {
    for (const c of text) this.b.push(c.charCodeAt(0));
    return this;
  }
}

/**
 * Assemble [entries][signing block][central directory][EOCD] with one V2 pair.
 * Layout is computed so the EOCD points the central directory at the block end.
 */
const apkWithBlock = (
  pairs: readonly { id: number; value: readonly number[] }[],
  withMagic = true,
): Uint8Array => {
  const entries = new Bytes().raw([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // filler
  const pairBytes = new Bytes();
  for (const p of pairs)
    pairBytes
      .u64(4 + p.value.length)
      .u32(p.id)
      .raw(p.value);
  const sizeOfBlock =
    pairBytes.b.length + 8 /* trailing size */ + 16; /* magic */
  const block = new Bytes().u64(sizeOfBlock).raw(pairBytes.b).u64(sizeOfBlock);
  if (withMagic) block.ascii("APK Sig Block 42");
  else block.ascii("NOT the block!!!"); // 16 bytes, wrong magic
  const cdOffset = entries.b.length + block.b.length;
  const cd = new Bytes().raw([0xca, 0xfe, 0xca, 0xfe]); // filler central directory
  const eocd = new Bytes()
    .u32(0x06054b50)
    .u16(0)
    .u16(0)
    .u16(1)
    .u16(1)
    .u32(cd.b.length)
    .u32(cdOffset)
    .u16(0);
  return Uint8Array.from([...entries.b, ...block.b, ...cd.b, ...eocd.b]);
};

describe("APK signing block locator", () => {
  it.each([1, 22, 23, 0xffffffff])(
    "refuses a directory extent overlapping or extending beyond the EOCD by %s bytes",
    (extra) => {
      const bytes = apkWithBlock([]);
      const eocd = bytes.length - 22;
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      dv.setUint32(
        eocd + 12,
        extra === 0xffffffff ? extra - 1 : 4 + extra,
        true,
      );
      expect(parseZipTail(bytes)).toMatchObject({
        ok: false,
        error: { kind: "malformed-zip" },
      });
    },
  );
  it("parses the ZIP tail to the central-directory offset", () => {
    const tail = parseZipTail(
      apkWithBlock([{ id: APK_BLOCK_ID.signatureV2, value: [1, 2, 3, 4] }]),
    );
    expect(tail.ok).toBe(true);
    if (!tail.ok) return;
    expect(tail.value.centralDirectoryOffset).toBe(10 + 48); // entries + block
    expect(tail.value.totalEntries).toBe(1);
  });

  it("locates the signing block and frames its id-value pairs", () => {
    const bytes = apkWithBlock([
      { id: APK_BLOCK_ID.signatureV2, value: [0xaa, 0xbb, 0xcc, 0xdd] },
      { id: APK_BLOCK_ID.signatureV3, value: [0x11, 0x22] },
    ]);
    const tail = parseZipTail(bytes);
    expect(tail.ok).toBe(true);
    if (!tail.ok) return;
    const block = locateApkSigningBlock(bytes, tail.value);
    expect(block.ok).toBe(true);
    if (!block.ok || block.value === null)
      throw new Error("Expected an APK signing block");
    expect(block.value.pairs.map((p) => p.id)).toEqual([
      APK_BLOCK_ID.signatureV2,
      APK_BLOCK_ID.signatureV3,
    ]);
    expect([...block.value.pairs[0]!.value]).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
  });

  it("returns null when no block magic precedes the central directory", () => {
    const bytes = apkWithBlock(
      [{ id: APK_BLOCK_ID.signatureV2, value: [1, 2, 3, 4] }],
      false,
    );
    const tail = parseZipTail(bytes);
    expect(tail.ok).toBe(true);
    if (!tail.ok) return;
    const block = locateApkSigningBlock(bytes, tail.value);
    expect(block.ok).toBe(true);
    if (!block.ok) return;
    expect(block.value).toBeNull();
  });

  it("refuses a buffer with no end-of-central-directory record", () => {
    const result = parseZipTail(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not-a-zip");
  });

  it("calls a ZIP with local headers but no EOCD damaged, not foreign", () => {
    const bytes = apkWithBlock([
      { id: APK_BLOCK_ID.signatureV2, value: [1, 2, 3, 4] },
    ]);
    bytes.set([0x50, 0x4b, 0x03, 0x04], 0);
    const result = parseZipTail(bytes.subarray(0, bytes.length - 22));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("malformed-zip");
  });

  it("refuses a block footer smaller than its own 24 bytes", () => {
    const bytes = apkWithBlock([
      { id: APK_BLOCK_ID.signatureV2, value: [1, 2, 3, 4] },
    ]);
    const tail = parseZipTail(bytes);
    expect(tail.ok).toBe(true);
    if (!tail.ok) return;
    // Trailing size sits 24 bytes before the central directory.
    const at = tail.value.centralDirectoryOffset - 24;
    bytes.set([16, 0, 0, 0, 0, 0, 0, 0], at);
    const block = locateApkSigningBlock(bytes, tail.value);
    expect(block.ok).toBe(false);
    if (block.ok) return;
    expect(block.error).toMatchObject({
      kind: "malformed-block",
      detail: "bad trailing size",
    });
  });

  it("flags a leading/trailing size mismatch as malformed", () => {
    const bytes = apkWithBlock([
      { id: APK_BLOCK_ID.signatureV2, value: [1, 2, 3, 4] },
    ]);
    // Corrupt the leading size (first byte of the block, after 10 filler bytes).
    bytes[10] = 0xff;
    const tail = parseZipTail(bytes);
    expect(tail.ok).toBe(true);
    if (!tail.ok) return;
    const block = locateApkSigningBlock(bytes, tail.value);
    expect(block.ok).toBe(false);
    if (block.ok) return;
    expect(block.error.kind).toBe("malformed-block");
  });
});

describe("Zip64 end-of-central-directory", () => {
  it("follows a Zip64 EOCD locator to the central-directory offset", () => {
    const body = new Bytes().raw(Array.from({ length: 40 }, () => 0));
    const cdOffset = body.b.length;
    const cd = new Bytes().raw([0xca, 0xfe, 0xca, 0xfe]);
    const recordOffset = cdOffset + cd.b.length;
    const record = new Bytes()
      .u32(0x06064b50)
      .u64(44) // size of remaining record
      .u16(45)
      .u16(45)
      .u32(0)
      .u32(0)
      .u64(1)
      .u64(1)
      .u64(cd.b.length) // offset 40: CD size
      .u64(cdOffset); // offset 48: CD offset
    const locator = new Bytes().u32(0x07064b50).u32(0).u64(recordOffset).u32(1);
    const eocd = new Bytes()
      .u32(0x06054b50)
      .u16(0)
      .u16(0)
      .u16(0xffff)
      .u16(0xffff)
      .u32(0xffffffff)
      .u32(0xffffffff)
      .u16(0);
    const tail = parseZipTail(
      Uint8Array.from([
        ...body.b,
        ...cd.b,
        ...record.b,
        ...locator.b,
        ...eocd.b,
      ]),
    );
    expect(tail.ok).toBe(true);
    if (!tail.ok) return;
    expect(tail.value.centralDirectoryOffset).toBe(cdOffset);
    expect(tail.value.centralDirectorySize).toBe(cd.b.length);
    // Entry count comes from the Zip64 record, not the saturated EOCD field.
    expect(tail.value.totalEntries).toBe(1);
  });

  it("takes the Zip64 entry count when only the 16-bit count saturates", () => {
    const body = new Bytes().raw(Array.from({ length: 40 }, () => 0));
    const cdOffset = body.b.length;
    const cd = new Bytes().raw([0xca, 0xfe, 0xca, 0xfe]);
    const recordOffset = cdOffset + cd.b.length;
    const record = new Bytes()
      .u32(0x06064b50)
      .u64(44)
      .u16(45)
      .u16(45)
      .u32(0)
      .u32(0)
      .u64(70000)
      .u64(70000)
      .u64(cd.b.length)
      .u64(cdOffset);
    const locator = new Bytes().u32(0x07064b50).u32(0).u64(recordOffset).u32(1);
    // Real 32-bit offset and size; only the entry count is saturated.
    const eocd = new Bytes()
      .u32(0x06054b50)
      .u16(0)
      .u16(0)
      .u16(0xffff)
      .u16(0xffff)
      .u32(cd.b.length)
      .u32(cdOffset)
      .u16(0);
    const tail = parseZipTail(
      Uint8Array.from([
        ...body.b,
        ...cd.b,
        ...record.b,
        ...locator.b,
        ...eocd.b,
      ]),
    );
    expect(tail.ok).toBe(true);
    if (!tail.ok) return;
    expect(tail.value.totalEntries).toBe(70000);
    // apksig reads only the classic count.
    expect(tail.value.classicEntryCount).toBe(0xffff);
  });

  it("keeps exactly 65,535 entries when no Zip64 record exists", () => {
    const cd = new Bytes().raw([0xca, 0xfe, 0xca, 0xfe]);
    const eocd = new Bytes()
      .u32(0x06054b50)
      .u16(0)
      .u16(0)
      .u16(0xffff)
      .u16(0xffff)
      .u32(cd.b.length)
      .u32(0)
      .u16(0);
    const tail = parseZipTail(Uint8Array.from([...cd.b, ...eocd.b]));
    expect(tail.ok).toBe(true);
    if (!tail.ok) return;
    expect(tail.value.totalEntries).toBe(0xffff);
  });
});

describe("EOCD that cannot describe the archive", () => {
  it("refuses a fake empty EOCD planted in the real EOCD's comment", () => {
    const real = apkWithBlock([
      { id: APK_BLOCK_ID.signatureV2, value: [1, 2, 3, 4] },
    ]);
    real.set([0x50, 0x4b, 0x03, 0x04], 0); // the archive holds a local entry
    // The real EOCD's comment (22 bytes) is itself an EOCD declaring nothing.
    real[real.length - 2] = 22;
    const fake = new Bytes()
      .u32(0x06054b50)
      .u16(0)
      .u16(0)
      .u16(0)
      .u16(0)
      .u32(0)
      .u32(0)
      .u16(0);
    const bytes = Uint8Array.from([...real, ...fake.b]);
    const tail = parseZipTail(bytes);
    expect(tail.ok).toBe(false);
    if (tail.ok) return;
    expect(tail.error.kind).toBe("malformed-zip");
  });

  it("refuses an archive whose comment holds a second, non-empty EOCD", () => {
    const real = apkWithBlock([
      { id: APK_BLOCK_ID.signatureV2, value: [1, 2, 3, 4] },
    ]);
    // A fake one-entry EOCD in the comment, pointing at a fake directory.
    const fake = new Bytes()
      .u32(0x06054b50)
      .u16(0)
      .u16(0)
      .u16(1)
      .u16(1)
      .u32(4)
      .u32(0)
      .u16(0);
    real[real.length - 2] = fake.b.length;
    const tail = parseZipTail(Uint8Array.from([...real, ...fake.b]));
    expect(tail.ok).toBe(false);
    if (tail.ok) return;
    expect(tail.error.kind).toBe("malformed-zip");
  });
});
