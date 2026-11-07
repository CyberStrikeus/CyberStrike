import { X509Certificate } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  LEAF_CERTIFICATE,
  OPENSSL_BLOCK_KEY_ID,
  organizationalUnits,
  signedDataBlock,
  signerInfo,
  withSubject,
} from "../../tests/fixtures/apkSignature/v1SignatureBlock.js";
import { decodeV1SignatureBlock } from "../domain/apkSignature/apkV1SignatureBlock.js";
import {
  projectedV1SignerBytes,
  v1PostureFingerprint,
  v1SignerFacts,
  v1SignerNotes,
  type DecodedV1Signer,
} from "./apkV1Signers.js";

const signerOf = (
  certificate: Uint8Array,
  block: Uint8Array = signedDataBlock({
    certificates: [certificate],
    signerInfos: [signerInfo({ names: certificate })],
  }),
): DecodedV1Signer => {
  const decoded = decodeV1SignatureBlock(block);
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.error));
  const name = "META-INF/CERT.RSA";
  return {
    entry: {
      signatureFile: "META-INF/CERT.SF",
      duplicate: null,
      block: {
        name,
        rawName: new TextEncoder().encode(name),
        flags: 0,
        method: 0,
        crc32: 0,
        compressedSize: 0,
        uncompressedSize: 0,
        localHeaderOffset: 0,
      },
    },
    declaresEncryption: false,
    decoded,
  };
};

describe("v1 signer output projection", () => {
  it("is an upper bound when the named certificate's subject is all escapes", () => {
    // RFC 2253 escapes `"` as `\"`, 4 bytes once JSON-escaped, and the named
    // certificate's subject is serialized twice.
    const certificate = withSubject(
      LEAF_CERTIFICATE,
      organizationalUnits(64, '"'.repeat(64)),
    );
    expect(new X509Certificate(certificate).subject).toContain('\\"');
    const signer = signerOf(certificate);
    const facts = v1SignerFacts(signer);
    expect(facts.certificate?.subject).toEqual(expect.any(String));
    expect(projectedV1SignerBytes(signer)).toBeGreaterThanOrEqual(
      Buffer.byteLength(JSON.stringify(facts)),
    );
  });
});

describe("v1 signers identified by subjectKeyIdentifier", () => {
  it("keeps the declared certificate but leaves the posture comparison unknown", () => {
    const keyIdentified = signerOf(LEAF_CERTIFICATE, OPENSSL_BLOCK_KEY_ID);
    const facts = v1SignerFacts(keyIdentified);
    expect(facts.signer_infos[0]?.identified_by).toBe("subject-key-identifier");
    expect(facts.certificate?.sha256_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(v1PostureFingerprint(facts)).toBeNull();
    expect(v1SignerNotes([keyIdentified])).toEqual([
      expect.stringContaining(
        "META-INF/CERT.RSA: a SignerInfo names its certificate by subjectKeyIdentifier",
      ) as string,
    ]);
    const bySerial = v1SignerFacts(signerOf(LEAF_CERTIFICATE));
    expect(v1PostureFingerprint(bySerial)).toBe(
      bySerial.certificate?.sha256_fingerprint,
    );
    expect(v1SignerNotes([signerOf(LEAF_CERTIFICATE)])).toEqual([]);
  });
});
