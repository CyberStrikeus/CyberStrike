import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  inspectPeCertificatesInputSchema,
  peCertificatesSchema,
} from "../../domain/native/peCertificates.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import {
  peCertificateFixture,
  peWithoutCertificateTableFixture,
  pkcs7SignedDataFixture,
  pkcs7SignedDataIndefiniteEnvelopeFixture,
} from "./PeCertificates.fixture.js";
import {
  ASN1_NODE_BUDGET,
  MAX_DECODED_NAME_BYTES,
  MAX_OID_ARC_BYTES,
  MAX_OID_BYTES,
  decodeOid,
  parseCertificate,
  PeCertificateAsn1Failure,
  readAsn1,
} from "./PeCertificateAsn1.js";
import {
  parsePeCertificates,
  UNSIGNED_ATTRIBUTES_LIMITATION,
} from "./PeCertificateParser.js";

const defaults = inspectPeCertificatesInputSchema.parse({
  path: "/artifacts/app.exe",
});

const parse = (bytes: Buffer) =>
  parsePeCertificates(
    bytes,
    {
      path: defaults.path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    },
    defaults,
  );

it("reads PE32 and PE32+ PKCS#7 certificate tables", () => {
  for (const plus of [false, true]) {
    const bytes = peCertificateFixture(plus);
    const report = parse(bytes);
    expect(report.format).toBe(plus ? "pe32-plus" : "pe32");
    expect(report.table).not.toBeNull();
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]).toMatchObject({
      revision: 0x0200,
      certificate_type: 2,
      certificate_type_name: "pkcs7",
    });
    expect(report.entries[0]?.pkcs7).toMatchObject({
      content_type_oid: "1.2.840.113549.1.7.2",
      content_type_name: "signedData",
      digest_algorithm_oids: ["2.16.840.1.101.3.4.2.1"],
    });
    const certificate = report.entries[0]?.pkcs7?.certificates[0];
    expect(certificate?.serial_hex).toBe("11223344");
    expect(certificate?.subject.text).toContain("commonName=REA Fixture");
    expect(certificate?.not_before).toBe("250101000000Z");
    expect(report.entries[0]?.pkcs7?.signers[0]).toMatchObject({
      serial_hex: "11223344",
      subject_key_identifier_hex: null,
    });
    expect(peCertificatesSchema.safeParse(report).success).toBe(true);
    expect(report.coverage).toEqual({
      status: "complete",
      examined_entries: 1,
      certificates: 1,
    });
  }
});

it("reports unsigned attribute OIDs and incomplete nested coverage", () => {
  const types = [
    [1, 3, 6, 1, 4, 1, 311, 3, 3, 1],
    [1, 3, 6, 1, 4, 1, 311, 2, 4, 1],
  ];
  for (const plus of [false, true]) {
    const report = peCertificatesSchema.parse(
      parse(
        peCertificateFixture(
          plus,
          pkcs7SignedDataFixture(undefined, undefined, undefined, types),
        ),
      ),
    );
    expect(
      report.entries[0]?.pkcs7?.signers[0]?.unsigned_attribute_oids,
    ).toEqual(["1.3.6.1.4.1.311.3.3.1", "1.3.6.1.4.1.311.2.4.1"]);
    expect(report.coverage).toMatchObject({
      status: "partial",
      certificates: 1,
    });
    expect(report.limitations).toContain(UNSIGNED_ATTRIBUTES_LIMITATION);
    const control = parse(peCertificateFixture(plus));
    expect(
      control.entries[0]?.pkcs7?.signers[0]?.unsigned_attribute_oids,
    ).toBeNull();
    expect(control.coverage.status).toBe("complete");
  }
});

it("accepts only zero eight-byte alignment padding included in dwLength", () => {
  for (const plus of [false, true]) {
    const bytes = peCertificateFixture(plus, undefined, undefined, true);
    const originalDigest = createHash("sha256").update(bytes).digest("hex");
    const encodedPayload = pkcs7SignedDataFixture();
    const report = parse(bytes);
    expect(report.artifact.sha256).toBe(originalDigest);
    expect(report.artifact.bytes).toBe(bytes.length);
    expect(report.format).toBe(plus ? "pe32-plus" : "pe32");
    expect(report.entries[0]).toMatchObject({
      location: { offset: 0x200, bytes: bytes.readUInt32LE(0x200) },
      length: bytes.readUInt32LE(0x200),
      payload: {
        location: { offset: 0x208, bytes: encodedPayload.length },
        bytes: encodedPayload.length,
        sha256: createHash("sha256").update(encodedPayload).digest("hex"),
      },
    });
    expect(report.coverage).toEqual({
      status: "complete",
      examined_entries: 1,
      certificates: 1,
    });
    expect(report.entries[0]?.pkcs7?.certificates).toHaveLength(1);
    expect(report.entries[0]?.pkcs7?.signers).toHaveLength(1);
  }
});

it.each([false, true])(
  "reads all counted alignment gaps and consecutive entries (PE32+ = %s)",
  (plus) => {
    const gaps = new Set<number>();
    for (let size = 1; size <= 32; size += 1) {
      const payload = pkcs7SignedDataFixture("x".repeat(size));
      const gap = (8 - ((8 + payload.length) % 8)) % 8;
      if (gaps.has(gap)) continue;
      gaps.add(gap);
      const single = peCertificateFixture(plus, payload, 2, true);
      const table = single.subarray(0x200);
      const bytes = Buffer.concat([single, table]);
      const directoryAt = 0x98 + (plus ? 112 : 96) + 4 * 8;
      bytes.writeUInt32LE(table.length * 2, directoryAt + 4);
      const report = peCertificatesSchema.parse(parse(bytes));
      expect(report.coverage).toEqual({
        status: "complete",
        examined_entries: 2,
        certificates: 2,
      });
      for (const [index, entry] of report.entries.entries()) {
        expect(entry.location).toEqual({
          offset: 0x200 + index * table.length,
          bytes: table.length,
        });
        expect(entry.payload.bytes).toBe(payload.length);
        expect(entry.payload.sha256).toBe(
          createHash("sha256").update(payload).digest("hex"),
        );
        expect(entry.pkcs7?.signers).toHaveLength(1);
      }
    }
    expect([...gaps].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  },
);

it("rejects nonzero or excessive bytes after the encoded PKCS#7 value", () => {
  const payload = pkcs7SignedDataFixture();
  const nonzero = peCertificateFixture(false, payload, 2, true);
  nonzero[0x200 + 8 + payload.length] = 1;
  expect(() => parse(nonzero)).toThrow(/invalid PKCS#7 alignment padding/u);

  const extra = peCertificateFixture(
    false,
    Buffer.concat([payload, Buffer.alloc(8)]),
    2,
  );
  expect(() => parse(extra)).toThrow(/invalid PKCS#7 alignment padding/u);
});

it("reads BER indefinite constructed ContentInfo and preserves certificate bytes", () => {
  const payload = pkcs7SignedDataIndefiniteEnvelopeFixture();
  const root = readAsn1(payload);
  const certificate = root.children[1]?.children[0]?.children[3]?.children[0];
  if (certificate === undefined)
    throw new Error("Fixture certificate was not decoded");
  const report = parse(peCertificateFixture(false, payload));
  const decoded = report.entries[0]?.pkcs7?.certificates[0];
  expect(decoded).toMatchObject({
    location: {
      offset: 0x200 + 8 + certificate.start,
      bytes: certificate.end - certificate.start,
    },
    serial_hex: "11223344",
  });
  expect(decoded?.der_sha256).toBe(
    createHash("sha256")
      .update(payload.subarray(certificate.start, certificate.end))
      .digest("hex"),
  );
});

it("retains certificate and signer facts for ASCII TeletexString names", () => {
  const payload = pkcs7SignedDataFixture("Plain Name", "Plain Org");
  const root = readAsn1(payload);
  const markTeletexNames = (node: ReturnType<typeof readAsn1>): void => {
    if (node.tag === 0x0c) payload[node.start] = 0x14;
    for (const child of node.children) markTeletexNames(child);
  };
  markTeletexNames(root);

  const report = parse(peCertificateFixture(false, payload));
  expect(report.coverage).toMatchObject({
    status: "complete",
    certificates: 1,
  });
  expect(report.entries[0]?.pkcs7?.certificates[0]).toMatchObject({
    issuer: { text: "commonName=Plain Name, organizationName=Plain Org" },
    subject: { text: "commonName=Plain Name, organizationName=Plain Org" },
  });
  expect(report.entries[0]?.pkcs7?.signers[0]?.issuer?.text).toBe(
    "commonName=Plain Name, organizationName=Plain Org",
  );
  expect(report.limitations).toContain(
    "TeletexString values use OpenSSL's ISO-8859-1 compatibility mapping; this is not a full T.61 decoder.",
  );
});

it.each([
  ["primitive", 0x04],
  ["constructed", 0x24],
] as const)(
  "rejects a high-bit four-octet BER length on a %s SignerInfo signature",
  (_kind, tag) => {
    const payload = pkcs7SignedDataFixture(
      "REA Fixture",
      "REA Tests",
      Buffer.from([tag, 0x84, 0x80, 0, 0, 0]),
    );
    expect(() => parse(peCertificateFixture(false, payload))).toThrow(
      /PKCS#7 signedData is malformed: ASN\.1 value exceeds its parent\./u,
    );
  },
);

it("matches nested indefinite constructed values and rejects invalid EOC forms", () => {
  const nested = readAsn1(
    Buffer.from([0x30, 0x80, 0x30, 0x80, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00]),
  );
  expect(nested).toMatchObject({
    lengthForm: "indefinite",
    end: 10,
    contentEnd: 8,
    content: Buffer.from([0x30, 0x80, 0x05, 0x00, 0x00, 0x00]),
    children: [
      {
        lengthForm: "indefinite",
        end: 8,
        contentEnd: 6,
        content: Buffer.from([0x05, 0x00]),
        children: [{ tag: 0x05, lengthForm: "definite", end: 6 }],
      },
    ],
  });
  expect(() => readAsn1(Buffer.from([0x04, 0x80, 0x00, 0x00]))).toThrow(
    /Primitive ASN.1 values cannot use indefinite length/u,
  );
  expect(() => readAsn1(Buffer.from([0x30, 0x02, 0x00, 0x00]))).toThrow(
    /Unexpected end-of-contents/u,
  );
  expect(() => readAsn1(Buffer.from([0x30, 0x80, 0x05, 0x00]))).toThrow(
    /no end-of-contents marker/u,
  );
  expect(() =>
    parseCertificate(readAsn1(Buffer.from([0x30, 0x80, 0x00, 0x00]))),
  ).toThrow(/X.509 Certificate must use definite DER length encoding/u);
});

it("reports an absent security directory without claiming the image is unsigned", () => {
  const report = parse(peWithoutCertificateTableFixture());
  expect(report.table).toBeNull();
  expect(report.entries).toEqual([]);
  expect(report.limitations[0]).toMatch(
    /IMAGE_DIRECTORY_ENTRY_SECURITY is absent/u,
  );
});

const securityDirectoryAt = 0x98 + 96 + 4 * 8;

it("fails truncated WIN_CERTIFICATE payloads without partial success", () => {
  const bytes = peCertificateFixture();
  const tableOffset = bytes.readUInt32LE(0x80 + 24 + 96 + 32);
  bytes.writeUInt32LE(4, tableOffset);
  expect(() => parse(bytes)).toThrow(ArtifactReaderFailure);

  const overlong = peCertificateFixture();
  const overlongTableOffset = overlong.readUInt32LE(securityDirectoryAt);
  const tableSize = overlong.readUInt32LE(securityDirectoryAt + 4);
  overlong.writeUInt32LE(tableSize + 1, overlongTableOffset);
  expect(() => parse(overlong)).toThrow(
    /dwLength exceeds the certificate table/u,
  );
});

it("rejects a short security table instead of reporting it complete", () => {
  for (const size of [4, 7]) {
    const bytes = peCertificateFixture();
    const tableOffset = bytes.readUInt32LE(securityDirectoryAt);
    bytes.writeUInt32LE(size, securityDirectoryAt + 4);
    bytes.fill(0, tableOffset, tableOffset + size);
    expect(() => parse(bytes)).toThrow(/header is truncated/u);
  }
  const bytes = peCertificateFixture();
  const tableOffset = bytes.readUInt32LE(securityDirectoryAt);
  const tableSize = bytes.readUInt32LE(securityDirectoryAt + 4);
  const extended = Buffer.concat([bytes, Buffer.alloc(4)]);
  extended.writeUInt32LE(tableSize + 4, securityDirectoryAt + 4);
  expect(extended.readUInt32LE(tableOffset)).toBeGreaterThan(0);
  expect(() => parse(extended)).toThrow(/header is truncated/u);
});

it("fails PKCS#7 payloads that are not signedData", () => {
  const bytes = peCertificateFixture(false, Buffer.from("not-pkcs7"), 0x0002);
  expect(() => parse(bytes)).toThrow(ArtifactReaderFailure);
});

it("keeps unknown certificate types as payload hashes without PKCS#7 projection", () => {
  const payload = pkcs7SignedDataFixture();
  const report = parse(peCertificateFixture(false, payload, 0x0001));
  expect(report.entries[0]).toMatchObject({
    certificate_type_name: "x509",
    pkcs7: null,
  });
  expect(report.entries[0]?.payload.sha256).toBe(
    createHash("sha256").update(payload).digest("hex"),
  );
});

const der = (tag: number, content: Buffer): Buffer => {
  const length = content.length;
  const header =
    length < 0x80
      ? Buffer.from([tag, length])
      : length <= 0xff
        ? Buffer.from([tag, 0x81, length])
        : length <= 0xffff
          ? Buffer.from([tag, 0x82, length >> 8, length & 0xff])
          : Buffer.from([
              tag,
              0x83,
              length >> 16,
              (length >> 8) & 0xff,
              length & 0xff,
            ]);
  return Buffer.concat([header, content]);
};
const derSeq = (...children: Buffer[]) => der(0x30, Buffer.concat(children));
const derSet = (...children: Buffer[]) => der(0x31, Buffer.concat(children));
const derInt = (value: number) => der(0x02, Buffer.from([value]));
const SIGNED_DATA_OID = Buffer.from([
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02,
]);
const DATA_OID = Buffer.from([
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01,
]);
const SHA256_ALG = derSeq(
  Buffer.from([
    0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01,
  ]),
);
const contentInfo = (signedData: Buffer) =>
  derSeq(SIGNED_DATA_OID, der(0xa0, signedData));

it("rejects extra ContentInfo and signedData wrapper values", () => {
  const valid = pkcs7SignedDataFixture();
  const root = readAsn1(valid);
  const type = root.children[0];
  const content = root.children[1];
  const signedData = content?.children[0];
  if (type === undefined || content === undefined || signedData === undefined)
    throw new Error("fixture ContentInfo was not decoded");
  const typeBytes = valid.subarray(type.start, type.end);
  const contentBytes = valid.subarray(content.start, content.end);
  const signedBytes = valid.subarray(signedData.start, signedData.end);
  const nul = der(0x05, Buffer.alloc(0));
  expect(() =>
    parse(peCertificateFixture(false, derSeq(typeBytes, contentBytes, nul))),
  ).toThrow(/ContentInfo has unexpected trailing fields/u);
  expect(() =>
    parse(
      peCertificateFixture(
        false,
        derSeq(typeBytes, der(0xa0, Buffer.concat([signedBytes, nul]))),
      ),
    ),
  ).toThrow(/signedData content has unexpected trailing fields/u);
});

it("fails signedData that omits encapContentInfo and signerInfos", () => {
  const truncated = contentInfo(derSeq(derInt(1), derSet()));
  expect(() => parse(peCertificateFixture(false, truncated))).toThrow(
    /encapContentInfo/u,
  );
});

it("fails a SignerInfo without its signature", () => {
  const signer = derSeq(
    derInt(1),
    derSeq(derSeq(), derInt(1)),
    SHA256_ALG,
    SHA256_ALG,
  );
  const payload = contentInfo(
    derSeq(derInt(1), derSet(SHA256_ALG), derSeq(DATA_OID), derSet(signer)),
  );
  expect(() => parse(peCertificateFixture(false, payload))).toThrow(
    /signature OCTET STRING/u,
  );
});

it("fails a SignerInfo whose signature bytes were removed", () => {
  const signer = derSeq(
    derInt(1),
    derSeq(derSeq(), derInt(1)),
    SHA256_ALG,
    SHA256_ALG,
    der(0x04, Buffer.alloc(0)),
  );
  const payload = contentInfo(
    derSeq(derInt(1), derSet(SHA256_ALG), derSeq(DATA_OID), derSet(signer)),
  );
  expect(() => parse(peCertificateFixture(false, payload))).toThrow(
    /signature OCTET STRING is empty/u,
  );
});

it("fails signedData whose signerInfos set is empty", () => {
  const payload = contentInfo(
    derSeq(derInt(1), derSet(SHA256_ALG), derSeq(DATA_OID), derSet()),
  );
  expect(() => parse(peCertificateFixture(false, payload))).toThrow(
    /no SignerInfo/u,
  );
});

it("keeps subjectKeyIdentifier bytes on the signer", () => {
  const ski = Buffer.from([0x00, 0xab, 0xcd]);
  const signer = derSeq(
    derInt(3),
    der(0x80, ski),
    SHA256_ALG,
    SHA256_ALG,
    der(0x04, Buffer.from([1])),
  );
  const payload = contentInfo(
    derSeq(derInt(1), derSet(SHA256_ALG), derSeq(DATA_OID), derSet(signer)),
  );
  const report = parse(peCertificateFixture(false, payload));
  expect(report.entries[0]?.pkcs7?.signers[0]).toMatchObject({
    issuer: null,
    serial_hex: null,
    subject_key_identifier_hex: "00abcd",
  });
  expect(peCertificatesSchema.safeParse(report).success).toBe(true);
  const empty = derSeq(
    derInt(3),
    der(0x80, Buffer.alloc(0)),
    SHA256_ALG,
    SHA256_ALG,
    der(0x04, Buffer.from([1])),
  );
  expect(() =>
    parse(
      peCertificateFixture(
        false,
        contentInfo(
          derSeq(
            derInt(1),
            derSet(SHA256_ALG),
            derSeq(DATA_OID),
            derSet(empty),
          ),
        ),
      ),
    ),
  ).toThrow(/subjectKeyIdentifier is empty/u);
  const wide = der(0x80, Buffer.alloc(MAX_DECODED_NAME_BYTES / 2 + 1, 0x11));
  expect(() =>
    parse(
      peCertificateFixture(
        false,
        contentInfo(
          derSeq(
            derInt(1),
            derSet(SHA256_ALG),
            derSeq(DATA_OID),
            derSet(
              derSeq(
                derInt(3),
                wide,
                SHA256_ALG,
                SHA256_ALG,
                der(0x04, Buffer.from([1])),
              ),
            ),
          ),
        ),
      ),
    ),
  ).toThrow(/decoded budget/u);
});

it("fails a truncated issuerAndSerialNumber instead of dropping the signer", () => {
  const signer = derSeq(
    derInt(1),
    derSeq(derSeq()),
    SHA256_ALG,
    SHA256_ALG,
    der(0x04, Buffer.from([1])),
  );
  const payload = contentInfo(
    derSeq(derInt(1), derSet(SHA256_ALG), derSeq(DATA_OID), derSet(signer)),
  );
  expect(() => parse(peCertificateFixture(false, payload))).toThrow(
    /issuerAndSerialNumber is truncated/u,
  );
});

it("stops decoding a certificate payload at the ASN.1 node budget", () => {
  const values = Buffer.alloc(2 * (ASN1_NODE_BUDGET + 1));
  for (let at = 0; at < values.length; at += 2) values[at] = 0x05;
  const payload = contentInfo(derSeq(derInt(1), der(0x31, values)));
  expect(() => parse(peCertificateFixture(false, payload))).toThrow(
    /node budget/u,
  );
});

it("rejects headers whose section table does not fit SizeOfHeaders", () => {
  const bytes = peWithoutCertificateTableFixture();
  bytes.writeUInt16LE(0xffff, 0x86);
  bytes.writeUInt32LE(0, 0x98 + 60);
  expect(() => parse(bytes)).toThrow(ArtifactReaderFailure);
});

it("decodes OBJECT IDENTIFIER arcs without truncation", () => {
  expect(decodeOid(Buffer.from([0x88, 0x37, 0x03]))).toBe("2.999.3");
  expect(decodeOid(Buffer.from([0x69, 0x90, 0x80, 0x80, 0x80, 0x00]))).toBe(
    "2.25.4294967296",
  );
  expect(decodeOid(Buffer.from([0x2a, 0x86, 0x48]))).toBe("1.2.840");
});

it("rejects an oversized OBJECT IDENTIFIER before growing an arc", () => {
  const oid = Buffer.alloc(MAX_OID_BYTES + 1, 0xff);
  oid[oid.length - 1] = 0x7f;
  const payload = derSeq(der(0x06, oid), der(0xa0, derSeq(derInt(1))));
  expect(() => parse(peCertificateFixture(false, payload))).toThrow(
    /OBJECT IDENTIFIER exceeds/u,
  );
  const arc = Buffer.alloc(MAX_OID_ARC_BYTES + 1, 0x80);
  arc[0] = 0x81;
  arc[arc.length - 1] = 0x00;
  expect(() => decodeOid(Buffer.concat([Buffer.from([0x2a]), arc]))).toThrow(
    /arc exceeds/u,
  );
});

const cn = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]);
const directoryName = (value: Buffer) => derSeq(derSet(derSeq(cn, value)));
const spki = derSeq(SHA256_ALG, der(0x03, Buffer.from([0])));
const validity = derSeq(
  der(0x17, Buffer.from("250101000000Z")),
  der(0x17, Buffer.from("260101000000Z")),
);
const namedCertificate = (issuer: Buffer, subject: Buffer) =>
  derSeq(
    derSeq(derInt(1), SHA256_ALG, issuer, validity, subject, spki),
    SHA256_ALG,
    der(0x03, Buffer.from([0])),
  );

it.each(["signature", "public-key", "issuer-id", "subject-id"] as const)(
  "validates BIT STRING padding for %s at the shared certificate boundary",
  (field) => {
    const name = directoryName(der(0x0c, Buffer.from("Fixture")));
    const certificate = (content: number[]) =>
      readAsn1(
        derSeq(
          derSeq(
            derInt(1),
            SHA256_ALG,
            name,
            validity,
            name,
            field === "public-key"
              ? derSeq(SHA256_ALG, der(0x03, Buffer.from(content)))
              : spki,
            ...(field === "issuer-id" ? [der(0x81, Buffer.from(content))] : []),
            ...(field === "subject-id"
              ? [der(0x82, Buffer.from(content))]
              : []),
          ),
          SHA256_ALG,
          der(0x03, Buffer.from(field === "signature" ? content : [0])),
        ),
      );
    for (const invalid of [[1], [7], [1, 1], [7, 0x81]])
      expect(() => parseCertificate(certificate(invalid))).toThrow(
        PeCertificateAsn1Failure,
      );
    for (const valid of [[0], [0, 0xff], [1, 0xfe], [7, 0x80]])
      expect(parseCertificate(certificate(valid)).subject.text).toBe(
        "commonName=Fixture",
      );
  },
);

it("rejects a certificate missing subjectPublicKeyInfo or signatureValue", () => {
  const issuer = directoryName(der(0x0c, Buffer.from("A")));
  const subject = directoryName(der(0x0c, Buffer.from("B")));
  const tbs = (withSpki: boolean) =>
    derSeq(
      derInt(1),
      SHA256_ALG,
      issuer,
      validity,
      subject,
      ...(withSpki ? [spki] : []),
    );
  expect(() =>
    parseCertificate(
      readAsn1(derSeq(tbs(false), SHA256_ALG, der(0x03, Buffer.from([0, 1])))),
    ),
  ).toThrow(/subjectPublicKeyInfo/u);
  expect(() =>
    parseCertificate(readAsn1(derSeq(tbs(true), SHA256_ALG))),
  ).toThrow(/signatureValue/u);
  const signer = derSeq(
    derInt(1),
    derSeq(derSeq(), derInt(1)),
    SHA256_ALG,
    SHA256_ALG,
    der(0x04, Buffer.from([1])),
  );
  const payload = contentInfo(
    derSeq(
      derInt(1),
      derSet(SHA256_ALG),
      derSeq(DATA_OID),
      der(0xa0, derSeq(tbs(false), SHA256_ALG)),
      derSet(signer),
    ),
  );
  expect(() => parse(peCertificateFixture(false, payload))).toThrow(
    /signatureValue/u,
  );
  expect(() =>
    parseCertificate(
      readAsn1(
        derSeq(
          derSeq(
            derInt(1),
            SHA256_ALG,
            issuer,
            validity,
            subject,
            spki,
            der(0x04, Buffer.from([1])),
          ),
          SHA256_ALG,
          der(0x03, Buffer.from([0])),
        ),
      ),
    ),
  ).toThrow(/trailing fields/u);
});

it("rejects a UTF8String name that is not valid UTF-8", () => {
  const certificate = readAsn1(
    namedCertificate(
      directoryName(der(0x0c, Buffer.from([0x80]))),
      directoryName(der(0x0c, Buffer.from("A"))),
    ),
  );
  expect(() => parseCertificate(certificate)).toThrow(/not valid UTF-8/u);
  expect(
    parseCertificate(
      readAsn1(
        namedCertificate(
          directoryName(der(0x0c, Buffer.from([0xc3, 0xa9]))),
          directoryName(der(0x0c, Buffer.from("A"))),
        ),
      ),
    ).issuer.text,
  ).toBe("commonName=é");
});

it.each([
  ["GeneralString", 0x1b, Buffer.from("name")],
  ["OCTET STRING", 0x04, Buffer.from("name")],
] as const)(
  "rejects unsupported %s certificate names",
  (_encoding, tag, bytes) => {
    const certificate = readAsn1(
      namedCertificate(
        directoryName(der(0x0c, Buffer.from("Issuer"))),
        directoryName(der(tag, bytes)),
      ),
    );
    expect(() => parseCertificate(certificate)).toThrow(
      new PeCertificateAsn1Failure(
        `Unsupported certificate name encoding (DER tag 0x${tag.toString(16).padStart(2, "0")}).`,
      ),
    );
  },
);

it("decodes BMPString names once and shares the decoded-byte budget", () => {
  const bmp = (text: string) => {
    const content = Buffer.alloc(text.length * 2);
    [...text].forEach((character, index) =>
      content.writeUInt16BE(character.charCodeAt(0), index * 2),
    );
    return der(0x1e, content);
  };
  const certificate = readAsn1(
    namedCertificate(directoryName(bmp("REA")), directoryName(bmp("Fixture"))),
  );
  expect(parseCertificate(certificate).subject.text).toBe("commonName=Fixture");
  const half = Math.floor((MAX_DECODED_NAME_BYTES - (2 + 13 * 6 * 2)) / 4) * 2;
  const within = readAsn1(
    namedCertificate(
      directoryName(der(0x1e, Buffer.alloc(half))),
      directoryName(der(0x1e, Buffer.alloc(half))),
    ),
  );
  expect(parseCertificate(within).issuer.text.startsWith("commonName=")).toBe(
    true,
  );
  const over = readAsn1(
    namedCertificate(
      directoryName(der(0x1e, Buffer.alloc(half + 4))),
      directoryName(der(0x1e, Buffer.alloc(half))),
    ),
  );
  expect(() => parseCertificate(over)).toThrow(/decoded budget/u);
  const universal = Buffer.alloc(MAX_DECODED_NAME_BYTES + 4);
  expect(() =>
    parseCertificate(
      readAsn1(
        namedCertificate(
          directoryName(der(0x1c, universal)),
          directoryName(bmp("A")),
        ),
      ),
    ),
  ).toThrow(/decoded budget/u);
});

it("decodes UniversalString names as UTF-32BE", () => {
  const universal = (text: string) => {
    const content = Buffer.alloc(text.length * 4);
    [...text].forEach((character, index) =>
      content.writeUInt32BE(character.codePointAt(0) ?? 0, index * 4),
    );
    return der(0x1c, content);
  };
  const cn = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]);
  const name = derSeq(derSet(derSeq(cn, universal("REA"))));
  const tbs = derSeq(derInt(1), SHA256_ALG, name, validity, name, spki);
  const certificate = readAsn1(
    derSeq(tbs, SHA256_ALG, der(0x03, Buffer.from([0]))),
  );
  expect(parseCertificate(certificate).subject.text).toBe("commonName=REA");
  const emoji = readAsn1(
    namedCertificate(
      directoryName(der(0x1c, Buffer.from([0x00, 0x01, 0xf6, 0x00]))),
      directoryName(der(0x1c, Buffer.from([0x00, 0x01, 0xf6, 0x00]))),
    ),
  );
  expect(parseCertificate(emoji).subject.text).toBe("commonName=😀");
  const odd = derSeq(derSet(derSeq(cn, der(0x1c, Buffer.from([0, 0, 0])))));
  const broken = readAsn1(
    derSeq(
      derSeq(
        derInt(1),
        SHA256_ALG,
        odd,
        derSeq(der(0x17, Buffer.from("x")), der(0x17, Buffer.from("x"))),
        odd,
        spki,
      ),
      SHA256_ALG,
      der(0x03, Buffer.from([0])),
    ),
  );
  expect(() => parseCertificate(broken)).toThrow(
    /UniversalString length is not a multiple of 4/u,
  );
});

it.each([0xd800, 0xdfff])(
  "rejects BMPString surrogate code unit %i in certificate names",
  (codeUnit) => {
    const content = Buffer.alloc(2);
    content.writeUInt16BE(codeUnit);
    const certificate = readAsn1(
      namedCertificate(
        directoryName(der(0x1e, content)),
        directoryName(der(0x0c, Buffer.from("Subject"))),
      ),
    );
    expect(() => parseCertificate(certificate)).toThrow(
      PeCertificateAsn1Failure,
    );
  },
);

it("preserves valid BMPString code units on both sides of the surrogate range", () => {
  const name = directoryName(
    der(0x1e, Buffer.from([0xd7, 0xff, 0xe0, 0, 0xfe, 0xff])),
  );
  expect(
    parseCertificate(readAsn1(namedCertificate(name, name))).subject.text,
  ).toBe("commonName=\ud7ff\ue000\ufeff");
});
