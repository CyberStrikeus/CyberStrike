import { describe, expect, it } from "vitest";

import {
  centralDeclaresEncryption,
  centralDirectoryV1SignatureEntries,
  detectV1Signature,
  localEntryData,
  MAX_DUPLICATE_NAME_SAMPLE,
  MAX_V1_SIGNATURE_ENTRIES,
  type ApkV1Entry,
} from "./apkV1Signature.js";

/** A central-directory entry with no stored data. */
const entry = (name: string): ApkV1Entry => ({
  name,
  rawName: new TextEncoder().encode(name),
  flags: 0,
  method: 0,
  crc32: 0,
  compressedSize: 0,
  uncompressedSize: 0,
  localHeaderOffset: 0,
});
const entries = (names: readonly string[]): ApkV1Entry[] => names.map(entry);

/** A central-directory file header (46 fixed bytes) for one entry name. */
const cdRecord = (name: string | readonly number[]): number[] => {
  const nameBytes =
    typeof name === "string" ? [...name].map((c) => c.charCodeAt(0)) : name;
  const buf = new Uint8Array(46);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x02014b50, true); // signature
  view.setUint16(28, nameBytes.length, true); // file name length
  return [...buf, ...nameBytes];
};

const centralDirectory = (
  names: readonly (string | readonly number[])[],
): Uint8Array => Uint8Array.from(names.flatMap((name) => cdRecord(name)));

/** Duplicate-name samples for ASCII names. */
const named = (names: readonly string[]) =>
  names.map((name) => ({ name, storedBytes: name.length }));

const NO_DUPLICATES = { count: 0, sample: [] };

it("rejects out-of-file extents instead of clamping the declared directory", () => {
  const bytes = centralDirectory(["classes.dex"]);
  expect(
    centralDirectoryV1SignatureEntries(bytes, 0, bytes.length + 1, 1),
  ).toMatchObject({
    ok: false,
    error: { kind: "malformed-central-directory" },
  });
});

describe("APK v1 (JAR) signature detection", () => {
  const names = [
    "AndroidManifest.xml",
    "classes.dex",
    "META-INF/MANIFEST.MF",
    "META-INF/CERT.SF",
    "META-INF/CERT.RSA",
  ];

  it("walks every record and keeps the META-INF signing names at any depth", () => {
    const all = [
      ...names,
      "META-INF/services/x.Y",
      "META-INF/sub/S.SF",
      "META-INF/sub/S.EC",
      "lib/META-INF/z.SF",
    ];
    const bytes = centralDirectory(all);
    const result = centralDirectoryV1SignatureEntries(
      bytes,
      0,
      bytes.length,
      all.length,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries.map((e) => e.name)).toEqual([
      "META-INF/MANIFEST.MF",
      "META-INF/CERT.SF",
      "META-INF/CERT.RSA",
      "META-INF/sub/S.SF",
      "META-INF/sub/S.EC",
    ]);
  });

  it("pairs signature files and blocks as apksig does", () => {
    expect(
      detectV1Signature(
        entries(["META-INF/sub/CERT.SF", "META-INF/sub/CERT.DSA"]),
      ),
    ).toEqual({
      present: true,
      hasManifest: false,
      signatureFiles: ["META-INF/sub/CERT.SF"],
      blockFiles: ["META-INF/sub/CERT.DSA"],
      signers: [
        {
          signatureFile: "META-INF/sub/CERT.SF",
          block: entry("META-INF/sub/CERT.DSA"),
          duplicate: null,
        },
      ],
    });
    // A block without its own .SF partner is not a v1 signer.
    expect(
      detectV1Signature(
        entries([
          "META-INF/MANIFEST.MF",
          "META-INF/RSA1.SF",
          "META-INF/OTHER.RSA",
        ]),
      ).present,
    ).toBe(false);
    // Suffixes are case-sensitive.
    expect(
      detectV1Signature(entries(["META-INF/CERT.sf", "META-INF/CERT.rsa"]))
        .present,
    ).toBe(false);
  });

  it("refuses more META-INF signing entries than a signed archive needs", () => {
    const many = Array.from(
      { length: MAX_V1_SIGNATURE_ENTRIES + 1 },
      (_, i) => `META-INF/F${String(i)}.SF`,
    );
    const bytes = centralDirectory(many);
    const result = centralDirectoryV1SignatureEntries(
      bytes,
      0,
      bytes.length,
      many.length,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: "budget-exceeded",
      resource: "v1-signature-entries",
      limit: MAX_V1_SIGNATURE_ENTRIES,
    });
  });

  it("detects a v1-signed APK from its META-INF files", () => {
    const bytes = centralDirectory(names);
    const result = centralDirectoryV1SignatureEntries(
      bytes,
      0,
      bytes.length,
      names.length,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const v1 = detectV1Signature(result.value.entries);
    expect(result.value.duplicates).toEqual({
      ...NO_DUPLICATES,
      records: names.length,
      apksigRecords: names.length,
      unread: NO_DUPLICATES,
    });
    expect(v1).toMatchObject({
      present: true,
      hasManifest: true,
      signatureFiles: ["META-INF/CERT.SF"],
      blockFiles: ["META-INF/CERT.RSA"],
      signers: [{ signatureFile: "META-INF/CERT.SF" }],
    });
  });

  it("refuses a directory that ends before its declared record count", () => {
    const bytes = centralDirectory(names);
    const result = centralDirectoryV1SignatureEntries(
      bytes,
      0,
      bytes.length - 3,
      names.length,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("malformed-central-directory");
  });

  it("refuses an under-declared record count instead of hiding entries", () => {
    const bytes = centralDirectory(names);
    const result = centralDirectoryV1SignatureEntries(
      bytes,
      0,
      bytes.length,
      1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      kind: "malformed-central-directory",
      detail: expect.stringContaining("remain after 1 records") as string,
    });
  });

  it("reports absent v1 signing when no META-INF signature files exist", () => {
    const v1 = detectV1Signature(
      entries(["classes.dex", "res/layout/main.xml"]),
    );
    expect(v1.present).toBe(false);
    expect(v1.signatureFiles).toEqual([]);
  });
});

describe("APK v1 duplicate signing names", () => {
  const scan = (
    all: readonly (string | readonly number[])[],
    apksigRecords = all.length,
  ) => {
    const bytes = centralDirectory(all);
    const result = centralDirectoryV1SignatureEntries(
      bytes,
      0,
      bytes.length,
      all.length,
      apksigRecords,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
  };

  it("finds duplicate names among all records, as apksig rejects any of them", () => {
    expect(
      scan([
        "classes.dex",
        "res/a.xml",
        "META-INF/CERT.SF",
        "res/a.xml",
        "classes.dex",
        "classes.dex",
        "Classes.dex",
        "res/a.xm",
      ]).duplicates,
    ).toMatchObject({
      count: 2,
      sample: named(["classes.dex", "res/a.xml"]),
      unread: NO_DUPLICATES,
    });
  });

  it("decodes only the first few duplicate names, in first-occurrence order", () => {
    const names = Array.from(
      { length: MAX_DUPLICATE_NAME_SAMPLE + 3 },
      (_, i) => `assets/f${String(i)}`,
    );
    const { duplicates } = scan([...names, ...[...names].reverse()]);
    expect(duplicates).toMatchObject({
      count: names.length,
      sample: named(names.slice(0, MAX_DUPLICATE_NAME_SAMPLE)),
    });
  });

  it("compares the names whose hashes collide instead of trusting the hash", () => {
    // These two distinct names share their 29-bit FNV-1a sort hash.
    const [a, b] = ["res/c52831", "res/c112929"];
    expect(scan([a, b]).duplicates).toMatchObject(NO_DUPLICATES);
    expect(scan([b, a, "x", b, a]).duplicates).toMatchObject({
      count: 2,
      sample: named([b, a]),
    });
  });

  it("compares malformed names as apksig's Java decoding does", () => {
    const dup = [0x64, 0x75, 0x70];
    // dup\xff, dup\xfe and dup + U+FFFD all decode to "dup\uFFFD"; an encoded
    // surrogate is one replacement for Java (three for WHATWG's TextDecoder).
    const { duplicates } = scan([
      [...dup, 0xff],
      "x",
      [...dup, 0xfe],
      [...dup, 0xef, 0xbf, 0xbd],
      [0x78, 0xed, 0xa0, 0x80],
      [0x78, 0xff],
      [0x78, 0xff, 0xff],
    ]);
    expect(duplicates).toMatchObject({
      count: 2,
      sample: [
        { name: "dup\uFFFD", storedBytes: 4 },
        { name: "x\uFFFD", storedBytes: 4 },
      ],
    });
  });

  it("counts for apksig only duplicates within the records apksig reads", () => {
    // apksig reads the classic 16-bit count (3 here) of a Zip64 directory.
    expect(scan(["a", "b", "a", "c", "b", "c", "a"], 3).duplicates).toEqual({
      count: 1,
      sample: named(["a"]),
      records: 7,
      apksigRecords: 3,
      unread: { count: 2, sample: named(["b", "c"]) },
    });
  });

  it("marks every signer when the manifest is duplicated", () => {
    const v1 = detectV1Signature(
      entries([
        "META-INF/MANIFEST.MF",
        "META-INF/A.SF",
        "META-INF/A.RSA",
        "META-INF/B.SF",
        "META-INF/B.EC",
        "META-INF/MANIFEST.MF",
      ]),
    );
    expect(v1.signers.map(({ duplicate }) => duplicate)).toEqual([
      "META-INF/MANIFEST.MF",
      "META-INF/MANIFEST.MF",
    ]);
  });

  it("flags duplicate signing names and keeps one signer per block name", () => {
    const v1 = detectV1Signature(
      entries([
        "META-INF/CERT.SF",
        "META-INF/CERT.RSA",
        "META-INF/CERT.RSA",
        "META-INF/OK.SF",
        "META-INF/OK.EC",
        "META-INF/TWO.SF",
        "META-INF/TWO.SF",
        "META-INF/TWO.DSA",
        "META-INF/MANIFEST.MF",
        "META-INF/MANIFEST.MF",
      ]),
    );
    expect(
      v1.signers.map(({ block, duplicate }) => [block.name, duplicate]),
    ).toEqual([
      ["META-INF/CERT.RSA", "META-INF/CERT.RSA"],
      // The duplicated manifest affects every signer.
      ["META-INF/OK.EC", "META-INF/MANIFEST.MF"],
      ["META-INF/TWO.DSA", "META-INF/TWO.SF"],
    ]);
    // The observed names stay as the central directory lists them.
    expect(v1.blockFiles).toEqual([
      "META-INF/CERT.RSA",
      "META-INF/CERT.RSA",
      "META-INF/OK.EC",
      "META-INF/TWO.DSA",
    ]);
  });
});

/** A local file header for `block`, then `extra` and the stored data. */
const localRecord = (
  block: ApkV1Entry,
  data: readonly number[],
  override: {
    readonly flags?: number;
    readonly crc32?: number;
    readonly compressedSize?: number;
    readonly uncompressedSize?: number;
    readonly name?: string | Uint8Array;
  } = {},
): Uint8Array => {
  const name =
    override.name === undefined
      ? block.rawName
      : typeof override.name === "string"
        ? new TextEncoder().encode(override.name)
        : override.name;
  const local = new Uint8Array(30 + name.length + 3 + data.length);
  const view = new DataView(local.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(6, override.flags ?? block.flags, true);
  view.setUint32(14, override.crc32 ?? block.crc32, true);
  view.setUint32(18, override.compressedSize ?? block.compressedSize, true);
  view.setUint32(22, override.uncompressedSize ?? block.uncompressedSize, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, 3, true);
  local.set(name, 30);
  local.set(data, 30 + name.length + 3);
  return local;
};
const block: ApkV1Entry = {
  ...entry("META-INF/A.RSA"),
  crc32: 0x01020304,
  compressedSize: 4,
  uncompressedSize: 4,
};
const data = [9, 8, 7, 6];
const dataStart = 30 + block.rawName.length + 3;

describe("APK v1 signature block locations", () => {
  it("keeps each record's data location for its signature block", () => {
    const record = cdRecord("META-INF/CERT.RSA");
    const view = new DataView(Uint8Array.from(record).buffer);
    view.setUint16(8, 0x0808, true);
    view.setUint16(10, 8, true);
    view.setUint32(16, 0xdeadbeef, true);
    view.setUint32(20, 70, true);
    view.setUint32(24, 90, true);
    view.setUint32(42, 1234, true);
    const bytes = new Uint8Array(view.buffer);
    const result = centralDirectoryV1SignatureEntries(
      bytes,
      0,
      bytes.length,
      1,
    );
    expect(result.ok && result.value.entries).toEqual([
      {
        name: "META-INF/CERT.RSA",
        rawName: new TextEncoder().encode("META-INF/CERT.RSA"),
        flags: 0x0808,
        method: 8,
        crc32: 0xdeadbeef,
        compressedSize: 70,
        uncompressedSize: 90,
        localHeaderOffset: 1234,
      },
    ]);
  });

  it("locates stored data through the local header, within the entry region", () => {
    const local = localRecord(block, data);
    const found = localEntryData(local, block, local.length);
    expect(found.ok && [...found.value.data]).toEqual(data);
    expect(found.ok && found.value.declaresEncryption).toBe(false);
    expect(localEntryData(local, block, local.length - 1)).toEqual({
      ok: false,
      error: {
        detail: `entry data at byte ${String(dataStart)} runs past the entries`,
      },
    });
    expect(
      localEntryData(local, { ...block, localHeaderOffset: 1 }, local.length),
    ).toMatchObject({ ok: false });
  });

  it("names Zip64 sizes as unread before any other check", () => {
    const local = localRecord(block, data);
    for (const field of ["compressedSize", "uncompressedSize"] as const)
      expect(
        localEntryData(local, { ...block, [field]: 0xffffffff }, local.length),
      ).toEqual({
        ok: false,
        error: { detail: "Zip64 entry sizes are not read" },
      });
  });

  it("leaves the data unknown when the local header disagrees with the central directory", () => {
    const refusal = (local: Uint8Array, entry: ApkV1Entry = block) => {
      const found = localEntryData(local, entry, local.length);
      return found.ok ? null : found.error.detail;
    };
    expect(refusal(localRecord(block, data, { compressedSize: 5 }))).toBe(
      "local header compressed size 5 differs from the central directory's 4",
    );
    expect(refusal(localRecord(block, data, { uncompressedSize: 3 }))).toBe(
      "local header uncompressed size 3 differs from the central directory's 4",
    );
    expect(refusal(localRecord(block, data, { crc32: 7 }))).toBe(
      "local header CRC-32 7 differs from the central directory's 16909060",
    );
    expect(refusal(localRecord(block, data, { name: "META-INF/A.XYZ" }))).toBe(
      "local header name differs from the central directory's",
    );
    expect(refusal(localRecord(block, data, { name: "META-INF/A.RS" }))).toBe(
      "local header name differs from the central directory's",
    );
    // Names that decode alike: apksig accepts a local name no longer in bytes
    // than the directory's and refuses a longer one before decoding.
    const malformed = (tail: number[]) =>
      Uint8Array.from([...new TextEncoder().encode("META-INF/K"), ...tail]);
    const short = { ...block, rawName: malformed([0xed, 0xa0, 0x80]) };
    expect(
      refusal(localRecord(short, data, { name: malformed([0xff]) }), short),
    ).toBeNull();
    const long = { ...block, rawName: malformed([0xff]) };
    expect(
      refusal(
        localRecord(long, data, { name: malformed([0xed, 0xa0, 0x80]) }),
        long,
      ),
    ).toBe("local header name differs from the central directory's");
    expect(refusal(localRecord(block, data, { flags: 0x8 }))).toBe(
      "local header and central directory disagree on the data-descriptor flag",
    );
    // With a data descriptor on both sides the local sizes are not declared.
    const described = { ...block, flags: 0x8 };
    expect(
      refusal(
        localRecord(described, data, {
          crc32: 0,
          compressedSize: 0,
          uncompressedSize: 0,
        }),
        described,
      ),
    ).toBeNull();
  });

  it("reads an entry flagged as encrypted, as apksig ignores the flag", () => {
    const flagged = { ...block, flags: 0x1 };
    const both = localRecord(flagged, data);
    const read = localEntryData(both, flagged, both.length);
    expect(read.ok && [...read.value.data]).toEqual(data);
    expect(read.ok && read.value.declaresEncryption).toBe(true);
    expect(centralDeclaresEncryption(flagged)).toBe(true);
    // Either header's flag is reported.
    const local = localRecord(block, data, { flags: 0x1 });
    const localOnly = localEntryData(local, block, local.length);
    expect(localOnly.ok && localOnly.value.declaresEncryption).toBe(true);
    expect(centralDeclaresEncryption(block)).toBe(false);
  });
});
