import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  APK_SIGNATURE_V2_ID,
  APK_SIGNATURE_V3_ID,
  LEAF_CERTIFICATE,
  LEAF_SHA256,
  OPENSSL_BLOCK_ISSUER_SERIAL,
  ROOT_CERTIFICATE,
  ROOT_SHA256,
  signedDataBlock,
  signerInfo,
  v2SchemeValue,
  withSigningBlock,
  zipWith,
} from "../../tests/fixtures/apkSignature/v1SignatureBlock.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { apkSignatureResultSchema } from "../domain/apkSignature/apkSignatureReport.js";
import { ApkSignatureProvider } from "./ApkSignatureProvider.js";
import { apkSignatureFailure } from "./apkSignatureFailures.js";
import { apkSchemeValue } from "../../tests/fixtures/apkSignature/signingScheme.js";

const zipOf = async (names: readonly string[]): Promise<Uint8Array> => {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const name of names) await writer.add(name, new TextReader("x"));
  return writer.close();
};

const u16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number): number[] => [
  v & 0xff,
  (v >> 8) & 0xff,
  (v >> 16) & 0xff,
  (v >>> 24) & 0xff,
];
const u64 = (v: number): number[] => [...u32(v), ...u32(0)];
const lp = (b: readonly number[]): number[] => [...u32(b.length), ...b];
const seq = (els: readonly (readonly number[])[]): number[] =>
  lp(els.flatMap((e) => lp(e)));

/** [entries][signing block with the given pairs][central directory][EOCD]. */
const syntheticSigned = (
  pairs: readonly { readonly id: number; readonly value: Uint8Array }[],
  options: {
    corruptLeadingSize?: boolean;
    cdEntries?: number;
    gapBeforeEocd?: number;
  } = {},
): Uint8Array => {
  const entries = Buffer.from(Array.from({ length: 64 }, (_, i) => i & 0xff));
  const framed = Buffer.concat(
    pairs.flatMap((p) => [
      Buffer.from([...u64(4 + p.value.length), ...u32(p.id)]),
      p.value,
    ]),
  );
  const size = framed.length + 8 + 16;
  const block = Buffer.concat([
    Buffer.from(u64(size)),
    framed,
    Buffer.from(u64(size)),
    Buffer.from("APK Sig Block 42", "latin1"),
  ]);
  if (options.corruptLeadingSize) block[0] = 0xff;
  // An empty central directory unless a test declares (bogus) records in it.
  const cd =
    options.cdEntries === undefined
      ? Buffer.alloc(0)
      : Buffer.from([0x50, 0x4b, 0x01, 0x02, 0, 0, 0, 0]);
  const gap = Buffer.alloc(options.gapBeforeEocd ?? 0);
  const cdOffset = entries.length + block.length;
  const records = options.cdEntries ?? 0;
  const eocd = Buffer.from([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(records),
    ...u16(records),
    ...u32(cd.length),
    ...u32(cdOffset),
    ...u16(0),
  ]);
  return Uint8Array.from(Buffer.concat([entries, block, cd, gap, eocd]));
};

const V2 = 0x7109871a;
const STAMP_V2 = 0x6dff800d;
const V31 = 0x1b93ad61;

const BOGUS_DIGEST = [
  ...u32(0x0103),
  ...lp(Array.from({ length: 32 }, () => 0xab)),
];
const BOGUS_CERT = [0x30, 0x03, 1, 2, 3];

/** A v2 value with one signer: bogus certificate bytes and a bogus SHA-256 digest. */
const bogusV2Value = (): Uint8Array =>
  apkSchemeValue(
    Uint8Array.from([...seq([BOGUS_DIGEST]), ...seq([BOGUS_CERT]), ...seq([])]),
  );

/** A v3-layout value whose one signer carries the given attributes. */
const v3Value = (attributes: readonly (readonly number[])[]): Uint8Array =>
  apkSchemeValue(
    Uint8Array.from([
      ...seq([BOGUS_DIGEST]),
      ...seq([BOGUS_CERT]),
      ...u32(28),
      ...u32(0x7fffffff),
      ...seq(attributes),
    ]),
    { min: 28, max: 0x7fffffff },
  );

/** Length-prefix a large buffer without spreading it into a number array. */
const lpBuf = (bytes: Uint8Array): Buffer =>
  Buffer.concat([Buffer.from(u32(bytes.length)), bytes]);

let dir: string;
const provider = new ApkSignatureProvider();
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rea-apk-sig-"));
});
afterAll(async () => {
  await provider.close();
  await rm(dir, { recursive: true, force: true });
});
const write = async (
  name: string,
  bytes: Uint8Array | string,
): Promise<string> => {
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
};
const reportOf = async (path: string) => {
  const result = await provider.inspect({ path });
  if (!result.ok) throw new Error(`expected ok: ${result.error.message}`);
  return apkSignatureResultSchema.parse(result.value.result);
};

describe("ApkSignatureProvider without the Android SDK", () => {
  it("reports an unsigned ZIP as having no scheme", async () => {
    const r = await reportOf(
      await write(
        "unsigned.apk",
        await zipOf(["classes.dex", "AndroidManifest.xml"]),
      ),
    );
    expect(Object.values(r.schemes).some((s) => s.present)).toBe(false);
    expect(r.posture.strongest_scheme).toBe("none");
    expect(r.posture.self_consistent).toBeNull();
    expect(r.posture.v1_only).toBe(false);
  });

  it("decodes a v2 signer, keeps an unparseable certificate null, and flags a digest mismatch", async () => {
    const r = await reportOf(
      await write(
        "v2.apk",
        syntheticSigned([{ id: V2, value: bogusV2Value() }]),
      ),
    );
    expect(r.schemes.v2!.present).toBe(true);
    const signer = r.schemes.v2!.signers![0]!;
    // Identity is the raw-DER fingerprint even when X.509 parsing fails.
    expect(signer.certificate).toEqual({
      sha256_fingerprint: createHash("sha256")
        .update(Uint8Array.from(BOGUS_CERT))
        .digest("hex"),
      subject: null,
      issuer: null,
      serial_number: null,
      not_before: null,
      not_after: null,
      public_key_algorithm: null,
    });
    expect(signer.digests).toEqual([
      {
        signature_algorithm_id: 0x0103,
        uninterpreted_bytes: 0,
        algorithm: "sha256",
        declared_digest_hex: "ab".repeat(32),
        matches_apk: false,
      },
    ]);
    expect(r.posture.self_consistent).toBe(false);
  });
});

describe("ApkSignatureProvider declared facts", () => {
  it("reads the declared source-stamp certificate, or says why it could not", async () => {
    const stamp = Uint8Array.from(lp([...lp(BOGUS_CERT), ...seq([])]));
    const read = await reportOf(
      await write(
        "stamped.apk",
        syntheticSigned([
          { id: V2, value: bogusV2Value() },
          { id: STAMP_V2, value: stamp },
        ]),
      ),
    );
    expect(read.source_stamp).toMatchObject({
      present: true,
      certificate: {
        sha256_fingerprint: createHash("sha256")
          .update(Uint8Array.from(BOGUS_CERT))
          .digest("hex"),
      },
      decode_error: null,
    });

    const damaged = await reportOf(
      await write(
        "stamp-damaged.apk",
        syntheticSigned([
          { id: V2, value: bogusV2Value() },
          { id: STAMP_V2, value: Uint8Array.from(u32(64)) },
        ]),
      ),
    );
    expect(damaged.source_stamp).toEqual({
      present: true,
      certificate: null,
      decode_error: "source stamp data truncated",
    });
  });

  it("reads v1 signing in META-INF subdirectories only for paired blocks", async () => {
    const nested = await reportOf(
      await write(
        "v1-nested.apk",
        await zipOf(["META-INF/a/CERT.SF", "META-INF/a/CERT.RSA"]),
      ),
    );
    expect(nested.schemes.v1.present).toBe(true);
    expect(nested.schemes.v1.signers).toMatchObject([
      {
        signature_file: "META-INF/a/CERT.SF",
        block_file: "META-INF/a/CERT.RSA",
      },
    ]);
    const unpaired = await reportOf(
      await write(
        "v1-unpaired.apk",
        await zipOf(["META-INF/RSA1.SF", "META-INF/OTHER.RSA"]),
      ),
    );
    expect(unpaired.schemes.v1.present).toBe(false);
    expect(unpaired.schemes.v1.signers).toEqual([]);
    expect(unpaired.posture.v1_only).toBe(false);
  });
});

describe("ApkSignatureProvider v1 signers", () => {
  it("compares the v1 signer with the v2 signer and reports a mismatch", async () => {
    const v1Zip = await zipWith([
      { name: "META-INF/CERT.SF", data: "Signature-Version: 1.0" },
      { name: "META-INF/CERT.EC", data: OPENSSL_BLOCK_ISSUER_SERIAL },
    ]);
    const same = await reportOf(
      await write(
        "v1-v2-same.apk",
        withSigningBlock(v1Zip, [
          { id: APK_SIGNATURE_V2_ID, value: v2SchemeValue(LEAF_CERTIFICATE) },
        ]),
      ),
    );
    expect(same.schemes.v1.signers[0]?.certificate?.sha256_fingerprint).toBe(
      LEAF_SHA256,
    );
    expect(same.posture.v1_signers_match_block_signers).toBe(true);
    const other = await reportOf(
      await write(
        "v1-v2-other.apk",
        withSigningBlock(v1Zip, [
          { id: APK_SIGNATURE_V2_ID, value: v2SchemeValue(ROOT_CERTIFICATE) },
        ]),
      ),
    );
    expect(other.posture.v1_signers_match_block_signers).toBe(false);
  });

  it("says why the v1 comparison is unknown when the v3 lineage cannot be decoded", async () => {
    const v1Zip = await zipWith([
      { name: "META-INF/CERT.SF", data: "Signature-Version: 1.0" },
      { name: "META-INF/CERT.EC", data: OPENSSL_BLOCK_ISSUER_SERIAL },
    ]);
    const lineage = [...u32(0x3ba06f8c), ...u32(1), ...u32(999)];
    const result = await provider.inspect({
      path: await write(
        "v1-v3-undecoded-lineage.apk",
        withSigningBlock(v1Zip, [
          { id: APK_SIGNATURE_V3_ID, value: v3Value([lineage]) },
        ]),
      ),
    });
    if (!result.ok) throw new Error(result.error.message);
    const report = apkSignatureResultSchema.parse(result.value.result);
    expect(report.posture.v1_signers_match_block_signers).toBeNull();
    expect(result.value.limitations).toContain(
      "v1_signers_match_block_signers is null: the v3 signer's declared rotation lineage could not be decoded, so the original certificate v1 is expected to carry is unknown.",
    );
  });

  it("keeps a damaged or ambiguous v1 block as an explicit unknown", async () => {
    const twoSigners = signedDataBlock({
      certificates: [LEAF_CERTIFICATE, ROOT_CERTIFICATE],
      signerInfos: [
        signerInfo({ names: LEAF_CERTIFICATE }),
        signerInfo({ names: ROOT_CERTIFICATE }),
      ],
    });
    const r = await reportOf(
      await write(
        "v1-damaged.apk",
        withSigningBlock(
          await zipWith([
            { name: "META-INF/A.SF", data: "Signature-Version: 1.0" },
            { name: "META-INF/A.RSA", data: "not pkcs7" },
            { name: "META-INF/B.SF", data: "Signature-Version: 1.0" },
            { name: "META-INF/B.EC", data: twoSigners },
            { name: "META-INF/C.SF", data: "Signature-Version: 1.0" },
            {
              name: "META-INF/C.DSA",
              data: new Uint8Array(2 * 1024 * 1024),
            },
          ]),
          [{ id: APK_SIGNATURE_V2_ID, value: v2SchemeValue(LEAF_CERTIFICATE) }],
        ),
      ),
    );
    const [damaged, ambiguous, oversized] = r.schemes.v1.signers;
    expect(damaged).toMatchObject({
      block_file: "META-INF/A.RSA",
      certificate: null,
      certificates: [],
      decode_error: expect.stringContaining("malformed PKCS#7") as string,
    });
    // Two SignerInfos and nothing verified: no single signer certificate.
    expect(ambiguous?.certificate).toBeNull();
    expect(ambiguous?.signer_infos.map((i) => i.certificate_sha256)).toEqual([
      LEAF_SHA256,
      ROOT_SHA256,
    ]);
    expect(oversized?.decode_error).toContain("over the 1048576-byte bound");
    expect(r.posture.v1_signers_match_block_signers).toBeNull();
  });

  it("bounds inflation by the per-block limit, not by the declared size", async () => {
    const zip = Buffer.from(
      await zipWith([
        { name: "META-INF/D.SF", data: "x" },
        { name: "META-INF/D.RSA", data: new Uint8Array(2 * 1024 * 1024) },
        { name: "META-INF/E.SF", data: "x" },
        { name: "META-INF/E.RSA", data: OPENSSL_BLOCK_ISSUER_SERIAL },
      ]),
    );
    // Under-declare both uncompressed sizes in the central directory.
    const cdOffset = zip.readUInt32LE(zip.length - 22 + 16);
    for (const name of ["META-INF/D.RSA", "META-INF/E.RSA"]) {
      const at = zip.indexOf(Buffer.from(name), cdOffset) - 46;
      zip.writeUInt32LE(100, at + 24);
    }
    const r = await reportOf(await write("v1-bomb.apk", zip));
    expect(r.schemes.v1.signers.map((signer) => signer.decode_error)).toEqual([
      "signature block inflates past the 1048576-byte bound",
      `signature block holds ${String(OPENSSL_BLOCK_ISSUER_SERIAL.length)} bytes, the central directory declares 100`,
    ]);
  });

  it("refuses more v1 signers than a signed archive carries", async () => {
    const names = Array.from({ length: 33 }, (_, i) => [
      { name: `META-INF/S${String(i)}.SF`, data: "x" },
      { name: `META-INF/S${String(i)}.RSA`, data: "x" },
    ]).flat();
    const result = await provider.inspect({
      path: await write("v1-many.apk", await zipWith(names)),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe("AnalysisResourceConstraintError");
    expect(result.error.message).toContain("more than 32 v1 signature blocks");
  });
});

const registerSignatureInputAdmissionCases = () => {
  it("keeps only a non-regular path as input; reader I/O and defects are adapter errors", () => {
    const tagOf = (cause: unknown): string =>
      apkSignatureFailure(cause, "/x.apk")._tag;
    expect(
      tagOf(new ArtifactReaderFailure("path", "Expected a regular file")),
    ).toBe("AnalysisInputError");
    for (const reason of ["io", "unavailable", "format"] as const)
      expect(tagOf(new ArtifactReaderFailure(reason, "reader failed"))).toBe(
        "ProviderAdapterError",
      );
    expect(tagOf(new RangeError("boom"))).toBe("ProviderAdapterError");
  });

  it("reports a missing file without leaking the raw errno text", async () => {
    const result = await provider.inspect({ path: join(dir, "absent.apk") });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe("AnalysisInputError");
    const text = JSON.stringify(result.error);
    expect(text).toContain("No regular file can be read");
    expect(text).not.toContain("no such file or directory, lstat");
  });

  it("refuses a non-ZIP file as an unsupported target", async () => {
    const result = await provider.inspect({
      path: await write("plain.bin", "not an archive at all"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe("AnalysisUnsupportedTargetError");
  });

  it("reports a damaged supported Zip64 end record as input failure while accepting the intact and restored controls", async () => {
    const classic = Buffer.from(await zipOf(["entry.txt"]));
    const endOffset = classic.length - 22;
    expect(classic.readUInt32LE(endOffset)).toBe(0x06054b50);
    const count = classic.readUInt16LE(endOffset + 10);
    const size = classic.readUInt32LE(endOffset + 12);
    const offset = classic.readUInt32LE(endOffset + 16);
    const record = Buffer.from([
      ...u32(0x06064b50),
      ...u64(44),
      ...u16(45),
      ...u16(45),
      ...u32(0),
      ...u32(0),
      ...u64(count),
      ...u64(count),
      ...u64(size),
      ...u64(offset),
    ]);
    const locator = Buffer.from([
      ...u32(0x07064b50),
      ...u32(0),
      ...u64(endOffset),
      ...u32(1),
    ]);
    const end = Buffer.from(classic.subarray(endOffset));
    end.writeUInt16LE(0xffff, 8);
    end.writeUInt16LE(0xffff, 10);
    end.writeUInt32LE(0xffffffff, 12);
    end.writeUInt32LE(0xffffffff, 16);
    const valid = Buffer.concat([
      classic.subarray(0, endOffset),
      record,
      locator,
      end,
    ]);
    const corrupt = Buffer.from(valid);
    corrupt.writeUInt32LE(0x06064b51, endOffset);
    const restored = Buffer.from(corrupt);
    restored.writeUInt32LE(0x06064b50, endOffset);
    expect(Buffer.compare(restored, valid)).toBe(0);
    for (const [name, bytes] of [
      ["valid", valid],
      ["restored", restored],
    ] as const) {
      const result = await provider.inspect({
        path: await write(`${name}.zip`, bytes),
      });
      expect(result.ok).toBe(true);
    }
    const damaged = await provider.inspect({
      path: await write("damaged.zip", corrupt),
    });
    expect(damaged.ok).toBe(false);
    if (!damaged.ok) {
      expect(damaged.error._tag).toBe("AnalysisInputError");
      expect(JSON.stringify(damaged.error)).toContain(
        "invalid Zip64 EOCD signature",
      );
    }
  });
};

const registerSigningStructureFailureCases = () => {
  it("reports a malformed signing block as an input error", async () => {
    const result = await provider.inspect({
      path: await write(
        "bad.apk",
        syntheticSigned([{ id: V2, value: bogusV2Value() }], {
          corruptLeadingSize: true,
        }),
      ),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe("AnalysisInputError");
  });

  it("reports a malformed declared lineage instead of dropping it", async () => {
    const lineage = [...u32(0x3ba06f8c), ...u32(1), ...u32(999)];
    const r = (await reportOf(
      await write(
        "lineage.apk",
        syntheticSigned([{ id: V31, value: v3Value([lineage]) }]),
      ),
    )) as unknown as {
      schemes: { "v3.1": { signers: { rotation: unknown }[] } };
      posture: { strongest_scheme: string };
    };
    expect(r.posture.strongest_scheme).toBe("v3.1");
    expect(r.schemes["v3.1"].signers[0]!.rotation).toEqual({
      present: true,
      lineage: [],
      decode_error: "lineage node truncated",
    });
  });

  it("names v3.1 when its block is malformed", async () => {
    const result = await provider.inspect({
      path: await write(
        "bad31.apk",
        syntheticSigned([{ id: V31, value: Uint8Array.from(u32(77)) }]),
      ),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain("Scheme v3.1 block");
  });

  it("refuses a central directory that cannot be walked", async () => {
    const result = await provider.inspect({
      path: await write(
        "badcd.apk",
        syntheticSigned([{ id: V2, value: bogusV2Value() }], { cdEntries: 3 }),
      ),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe("AnalysisInputError");
    expect(JSON.stringify(result.error)).toContain(
      "Malformed ZIP central directory",
    );
  });

  it("refuses an under-declared entry count rather than hiding v1 signing", async () => {
    const zip = await zipOf([
      "classes.dex",
      "META-INF/MANIFEST.MF",
      "META-INF/CERT.SF",
      "META-INF/CERT.RSA",
    ]);
    const eocd = zip.length - 22;
    zip.set(u16(1), eocd + 8);
    zip.set(u16(1), eocd + 10);
    const result = await provider.inspect({
      path: await write("undercount.apk", zip),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe("AnalysisInputError");
  });

  it("says why the digest was not recomputed when the EOCD does not follow the directory", async () => {
    const result = await provider.inspect({
      path: await write(
        "gap.apk",
        syntheticSigned([{ id: V2, value: bogusV2Value() }], {
          gapBeforeEocd: 4,
        }),
      ),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      apkSignatureResultSchema.parse(result.value.result).posture
        .self_consistent,
    ).toBeNull();
    expect(result.value.limitations.at(-1)).toContain(
      "not immediately followed by the end-of-central-directory",
    );
  });

  it("refuses a report that would exceed the output budget before building it", async () => {
    const hugeCert = new Uint8Array(4.5 * 1024 * 1024);
    const signedData = Buffer.concat([
      Buffer.from(seq([BOGUS_DIGEST])),
      lpBuf(lpBuf(hugeCert)),
      Buffer.from(seq([])),
    ]);
    const value = apkSchemeValue(signedData);
    const result = await provider.inspect({
      path: await write("huge.apk", syntheticSigned([{ id: V2, value }])),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe("AnalysisResourceConstraintError");
    expect(result.error.message).toContain("output budget");
  });
};

describe("ApkSignatureProvider failure surfaces", () => {
  registerSignatureInputAdmissionCases();
  registerSigningStructureFailureCases();
});

describe("ApkSignatureProvider output budget", () => {
  it("counts the limitations, which repeat archive names, in the output budget", async () => {
    // Five signers whose names escape to 6 JSON bytes per byte: the report
    // alone fits, and the trailing-bytes note per signer, which repeats the
    // block name, takes the emitted output past the budget.
    const archive = (trailing: number): Promise<Uint8Array> =>
      zipWith(
        Array.from({ length: 5 }, (_, i) => {
          const stem = `META-INF/${"\u0001".repeat(65_000)}${String(i)}`;
          return [
            { name: `${stem}.SF`, data: "Signature-Version: 1.0" },
            {
              name: `${stem}.RSA`,
              data: Uint8Array.from([
                ...OPENSSL_BLOCK_ISSUER_SERIAL,
                ...new Array<number>(trailing).fill(0),
              ]),
            },
          ];
        }).flat(),
        { dataDescriptor: false },
      );
    const fits = await provider.inspect({
      path: await write("names.apk", await archive(0)),
    });
    expect(fits.ok, fits.ok ? "" : fits.error.message).toBe(true);
    const over = await provider.inspect({
      path: await write("names-noted.apk", await archive(2)),
    });
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.error._tag).toBe("AnalysisResourceConstraintError");
    expect(over.error.message).toContain("output budget");
  });
});
