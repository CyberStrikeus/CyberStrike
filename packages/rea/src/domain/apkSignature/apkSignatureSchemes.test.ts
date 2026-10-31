import { describe, expect, it } from "vitest";
import { apkSchemeValue } from "../../../tests/fixtures/apkSignature/signingScheme.js";

import {
  contentDigestAlgorithm,
  decodeRotationLineage,
  decodeSigners,
  MAX_LINEAGE_NODES,
  MAX_SIGNERS,
} from "./apkSignatureSchemes.js";

const ATTR_ID = 0xbeeff00d;

const u32 = (n: number): number[] => [
  n & 0xff,
  (n >> 8) & 0xff,
  (n >> 16) & 0xff,
  (n >>> 24) & 0xff,
];
/** length-prefixed chunk: uint32 LE length, then the bytes. */
const lp = (bytes: readonly number[]): number[] => [
  ...u32(bytes.length),
  ...bytes,
];
/** length-prefixed sequence of length-prefixed elements. */
const seq = (elements: readonly (readonly number[])[]): number[] =>
  lp(elements.flatMap((e) => lp(e)));

const CERT_DER = [0x30, 0x03, 0x01, 0x02, 0x03]; // opaque placeholder; schemes don't parse it
const DIGEST = [0xde, 0xad, 0xbe, 0xef];
const digestElement = [...u32(0x0103), ...lp(DIGEST)]; // RSA-PKCS1 SHA-256
const attrElement = [...u32(ATTR_ID), 0x01];

const schemeValue = (
  signedData: readonly number[],
  sdkRange?: { min: number; max: number },
): Uint8Array => apkSchemeValue(Uint8Array.from(signedData), sdkRange);

it.each(["missing signature records", "truncated public key"])(
  "rejects a signer with %s",
  (kind) => {
    const signed = [...seq([digestElement]), ...seq([CERT_DER]), ...seq([])];
    const signatures = seq([[...u32(0x0103), ...lp([1, 2])]]);
    const signer =
      kind === "missing signature records"
        ? lp(signed)
        : [...lp(signed), ...signatures, ...u32(5), 1];
    expect(decodeSigners(Uint8Array.from(seq([signer])), "v2")).toMatchObject({
      ok: false,
      error: { kind: "malformed-signer" },
    });
  },
);

it("preserves unparsed suffixes instead of refusing reader-compatible extensions", () => {
  const signed = [
    ...seq([[...digestElement, 0xaa]]),
    ...seq([CERT_DER]),
    ...seq([]),
    ...lp([]),
  ];
  const signer = [
    ...lp(signed),
    ...seq([[...u32(0x0103), ...lp([1]), 0xbb]]),
    ...lp([1]),
    0xcc,
  ];
  const result = decodeSigners(Uint8Array.from([...seq([signer]), 0xdd]), "v2");
  if (!result.ok) throw result.error;
  expect(result.value.uninterpretedBytes).toBe(1);
  expect(result.value.signers[0]).toMatchObject({
    uninterpretedSignedDataBytes: 4,
    uninterpretedSignerBytes: 1,
  });
  expect(result.value.signers[0]!.digests[0]!.uninterpretedBytes).toBe(1);
  expect(result.value.signers[0]!.signatures[0]!.uninterpretedBytes).toBe(1);
});

it("rejects inconsistent v3 SDK ranges", () => {
  const signed = [
    ...seq([digestElement]),
    ...seq([CERT_DER]),
    ...u32(28),
    ...u32(34),
    ...seq([]),
  ];
  expect(
    decodeSigners(schemeValue(signed, { min: 29, max: 34 }), "v3"),
  ).toMatchObject({
    ok: false,
    error: {
      kind: "malformed-signer",
      detail: expect.stringContaining("SDK range"),
    },
  });
});

it("preserves an unknown unsigned algorithm ID", () => {
  const signed = [
    ...seq([[...u32(0xfedcba98), ...lp(DIGEST)]]),
    ...seq([CERT_DER]),
    ...seq([]),
  ];
  const result = decodeSigners(schemeValue(signed), "v2");
  if (!result.ok) throw result.error;
  expect(result.value.signers[0]!.digests[0]!.algorithmId).toBe(0xfedcba98);
  expect(contentDigestAlgorithm(0xfedcba98)).toBeNull();
});

describe("APK scheme signer decoder", () => {
  it.each(
    [
      [...lp(lp([1])), ...u32(0), ...u32(0x0103), ...lp([1])],
      [...lp([...lp([1]), ...u32(0x0103)]), ...u32(0)],
      [...lp([...lp([1]), ...u32(0x0103)]), ...u32(0), ...u32(0x0103)],
      [
        ...lp([...lp([1]), ...u32(0x0103)]),
        ...u32(0),
        ...u32(0x0103),
        ...u32(2),
        1,
      ],
    ].map((node) => ({ node })),
  )(
    "refuses lineage nodes missing required algorithm/signature framing",
    ({ node }) => {
      expect(
        decodeRotationLineage(Uint8Array.from([...u32(1), ...lp(node)])),
      ).toMatchObject({ ok: false, error: { kind: "malformed-signer" } });
    },
  );
  it("decodes a v2 signer's digests, certificate and attributes", () => {
    const signedData = [
      ...seq([digestElement]),
      ...seq([CERT_DER]),
      ...seq([attrElement]),
    ];
    const result = decodeSigners(schemeValue(signedData), "v2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.signers).toHaveLength(1);
    const signer = result.value.signers[0]!;
    expect(
      signer.digests.map(({ algorithmId, digest }) => ({
        algorithmId,
        digest: [...digest],
      })),
    ).toEqual([{ algorithmId: 0x0103, digest: DIGEST }]);
    expect(
      signer.signatures.map(({ algorithmId, signature }) => ({
        algorithmId,
        bytes: [...signature],
      })),
    ).toEqual([{ algorithmId: 0x0103, bytes: [1] }]);
    expect([...signer.certificates[0]!]).toEqual(CERT_DER);
    expect(signer.minSdk).toBeNull();
    expect(signer.attributes[0]!.id).toBe(ATTR_ID);
  });

  it("decodes a v3 signer's min/max SDK between certificates and attributes", () => {
    const signedData = [
      ...seq([digestElement]),
      ...seq([CERT_DER]),
      ...u32(21), // min_sdk
      ...u32(34), // max_sdk
      ...seq([attrElement]),
    ];
    const result = decodeSigners(
      schemeValue(signedData, { min: 21, max: 34 }),
      "v3",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.signers[0]!.minSdk).toBe(21);
    expect(result.value.signers[0]!.maxSdk).toBe(34);
  });

  it("refuses a truncated signer sequence", () => {
    const result = decodeSigners(Uint8Array.from(u32(9999)), "v2");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("malformed-signer");
  });

  it("names the failing signer and keeps a cap overrun distinct from malformed input", () => {
    const truncated = decodeSigners(
      Uint8Array.from(seq([lp([...seq([digestElement]), ...u32(99)])])),
      "v3",
    );
    expect(truncated.ok).toBe(false);
    if (!truncated.ok)
      expect(truncated.error).toMatchObject({
        kind: "malformed-signer",
        detail: expect.stringContaining("signer 0") as string,
      });
    const signedData = [
      ...seq([digestElement]),
      ...seq([CERT_DER]),
      ...seq([]),
    ];
    const tooMany = decodeSigners(
      Uint8Array.from(
        seq(Array.from({ length: MAX_SIGNERS + 1 }, () => lp(signedData))),
      ),
      "v2",
    );
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok)
      expect(tooMany.error).toEqual({
        kind: "budget-exceeded",
        resource: "signers",
        limit: MAX_SIGNERS,
      });
  });

  it("decodes lineage nodes with each node's own retained flags", () => {
    const node = (cert: number[], flags: number): number[] =>
      lp([
        ...lp([...lp(cert), ...u32(0x0103)]),
        ...u32(flags),
        ...u32(0x0103),
        ...lp([1]),
      ]);
    const lineage = decodeRotationLineage(
      Uint8Array.from([...u32(1), ...node([1, 2], 22), ...node([3, 4], 21)]),
    );
    expect(lineage.ok).toBe(true);
    if (!lineage.ok) return;
    expect(lineage.value.map((n) => [[...n.certificate], n.flags])).toEqual([
      [[1, 2], 22],
      [[3, 4], 21],
    ]);
  });

  it("refuses an unknown lineage version and an over-cap lineage", () => {
    const badVersion = decodeRotationLineage(Uint8Array.from(u32(2)));
    expect(badVersion.ok).toBe(false);
    if (!badVersion.ok) expect(badVersion.error.kind).toBe("malformed-signer");
    const node = lp([
      ...lp([...lp([1]), ...u32(0x0103)]),
      ...u32(0),
      ...u32(0x0103),
      ...lp([]),
    ]);
    const tooLong = decodeRotationLineage(
      Uint8Array.from([
        ...u32(1),
        ...Array.from({ length: MAX_LINEAGE_NODES + 1 }, () => node).flat(),
      ]),
    );
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error.kind).toBe("budget-exceeded");
  });

  it("maps signature-algorithm ids to content-digest algorithms", () => {
    expect(contentDigestAlgorithm(0x0103)).toBe("sha256");
    expect(contentDigestAlgorithm(0x0104)).toBe("sha512");
    expect(contentDigestAlgorithm(0x0421)).toBe("verity-sha256");
    expect(contentDigestAlgorithm(0x0425)).toBe("verity-sha256");
    expect(contentDigestAlgorithm(0x9999)).toBeNull();
  });
});
