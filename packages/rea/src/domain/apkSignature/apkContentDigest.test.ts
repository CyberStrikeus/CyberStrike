import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  computeApkContentDigest,
  type HashFactory,
} from "./apkContentDigest.js";
import { parseZipTail } from "./apkSigningBlock.js";

const nodeHash: HashFactory = (algorithm) => {
  const hash = createHash(algorithm);
  return {
    update: (data) => {
      hash.update(data);
    },
    digest: () => new Uint8Array(hash.digest()),
  };
};

const u16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number): number[] => [
  v & 0xff,
  (v >> 8) & 0xff,
  (v >> 16) & 0xff,
  (v >>> 24) & 0xff,
];
const u64 = (v: number): number[] => [...u32(v), ...u32(0)];

const eocd = (cdSize: number, cdOffset: number): number[] => [
  ...u32(0x06054b50),
  ...u16(0),
  ...u16(0),
  ...u16(1),
  ...u16(1),
  ...u32(cdSize),
  ...u32(cdOffset),
  ...u16(0),
];

/** 1.5 MiB of deterministic "entry" bytes, so the first section spans two chunks. */
const ENTRIES = Uint8Array.from(
  { length: 1024 * 1024 + 512 * 1024 },
  (_, i) => (i * 31 + 7) & 0xff,
);
const CD = [0x50, 0x4b, 0x01, 0x02, 1, 2, 3, 4, 5, 6];

/** A signing block holding one opaque pair (contents must not affect the digest). */
const signingBlock = (payload: readonly number[]): number[] => {
  const pair = [...u64(4 + payload.length), ...u32(0x7109871a), ...payload];
  const size = pair.length + 8 + 16;
  return [
    ...u64(size),
    ...pair,
    ...u64(size),
    ...[..."APK Sig Block 42"].map((c) => c.charCodeAt(0)),
  ];
};

const withBlock = (payload: readonly number[] = [9, 9, 9, 9]): Uint8Array => {
  const block = signingBlock(payload);
  const cdOffset = ENTRIES.length + block.length;
  const out = new Uint8Array(cdOffset + CD.length + 22);
  out.set(ENTRIES, 0);
  out.set(block, ENTRIES.length);
  out.set(CD, cdOffset);
  out.set(eocd(CD.length, cdOffset), cdOffset + CD.length);
  return out;
};

const withoutBlock = (): Uint8Array => {
  const cdOffset = ENTRIES.length;
  const out = new Uint8Array(cdOffset + CD.length + 22);
  out.set(ENTRIES, 0);
  out.set(CD, cdOffset);
  out.set(eocd(CD.length, cdOffset), cdOffset + CD.length);
  return out;
};

const digestOf = (
  bytes: Uint8Array,
  blockStart: number,
  algorithm: "sha256" | "sha512" = "sha256",
): Uint8Array | null => {
  const tail = parseZipTail(bytes);
  if (!tail.ok) throw new Error("bad fixture");
  return computeApkContentDigest(
    bytes,
    { tail: tail.value, blockStart, algorithm },
    nodeHash,
  );
};

describe("computeApkContentDigest", () => {
  it("equals the digest of the same APK with the signing block removed", () => {
    for (const algorithm of ["sha256", "sha512"] as const) {
      const signed = digestOf(withBlock(), ENTRIES.length, algorithm);
      const stripped = digestOf(withoutBlock(), ENTRIES.length, algorithm);
      expect(signed).not.toBeNull();
      expect(signed).toEqual(stripped);
    }
  });

  it("ignores the signing block's own contents", () => {
    expect(digestOf(withBlock([1, 2, 3, 4]), ENTRIES.length)).toEqual(
      digestOf(withBlock([5, 6, 7, 8]), ENTRIES.length),
    );
  });

  it("changes when a ZIP entry byte changes", () => {
    const tampered = withBlock();
    tampered[1234] = (tampered[1234] ?? 0) ^ 0xff;
    expect(digestOf(tampered, ENTRIES.length)).not.toEqual(
      digestOf(withBlock(), ENTRIES.length),
    );
  });

  it("matches for a Node Buffer at a non-zero byteOffset and never mutates its input", () => {
    // Regression: readStableArtifact yields a Buffer; Buffer#slice is a view, so
    // rewriting the EOCD through it corrupted byte 16 and skipped the rewrite.
    const plain = withBlock();
    const pooled = Buffer.alloc(plain.length + 64);
    const view = pooled.subarray(64); // non-zero byteOffset over a shared ArrayBuffer
    view.set(plain);
    const before = Buffer.from(view);
    expect(digestOf(view, ENTRIES.length)).toEqual(
      digestOf(withoutBlock(), ENTRIES.length),
    );
    expect(Buffer.from(view).equals(before)).toBe(true);
  });

  it("reports not-computed for a layout with a gap before the EOCD", () => {
    const bytes = withBlock();
    const tail = parseZipTail(bytes);
    if (!tail.ok) throw new Error("bad fixture");
    const gapped = { ...tail.value, centralDirectorySize: 3 }; // CD no longer abuts EOCD
    expect(
      computeApkContentDigest(
        bytes,
        { tail: gapped, blockStart: ENTRIES.length, algorithm: "sha256" },
        nodeHash,
      ),
    ).toBeNull();
  });
});
