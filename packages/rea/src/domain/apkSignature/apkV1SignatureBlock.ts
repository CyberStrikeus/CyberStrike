/**
 * Decode the PKCS#7 / CMS `SignedData` inside a v1 (JAR) signature block
 * (`META-INF/*.RSA|DSA|EC`) far enough to name its signers: the raw DER of
 * every certificate it carries and, per `SignerInfo`, which of those
 * certificates it identifies (by `issuerAndSerialNumber` or
 * `subjectKeyIdentifier`) and its digest and signature algorithm OIDs.
 *
 * This owns the CMS BER structure only. Certificate facts (fingerprint,
 * subject) stay with the adapter's X.509 owner, and no signature is verified:
 * a `SignerInfo` naming a certificate is what the block declares.
 *
 * Dependency-free and bounded. Every tag and length is checked against its
 * enclosing element; BER indefinite lengths (which some JAR signers emit) are
 * accepted for constructed elements, within a nesting depth and a total
 * element budget, so a hostile block cannot drive unbounded work. Counts past
 * format-justified caps are a distinct `budget-exceeded` error, never
 * conflated with malformed input.
 */
import { type Result, err, ok } from "../result.js";
import { decodeAsn1Oid } from "../asn1Oid.js";
import { Asn1BerFailure, Asn1BerReader, type Asn1BerNode } from "../asn1Ber.js";

export type ApkV1BlockError =
  | { readonly kind: "malformed-pkcs7"; readonly detail: string }
  | {
      readonly kind: "budget-exceeded";
      readonly resource:
        | "v1-block-certificates"
        | "v1-signer-infos"
        | "asn1-elements";
      readonly limit: number;
    };

/** Certificates in one block: a signer leaf plus a short chain is the norm. */
export const MAX_V1_BLOCK_CERTIFICATES = 32;
/** SignerInfos in one block; apksig verifies one, more is pathological. */
export const MAX_V1_SIGNER_INFOS = 32;
/** Nesting depth; SignedData → X.509 extensions is under 12 levels deep. */
const MAX_ASN1_DEPTH = 32;
/** Elements read while decoding one block; bounds work for any byte length. */
export const MAX_ASN1_ELEMENTS = 65_536;

export interface ApkV1SignerInfo {
  readonly identifiedBy: "issuer-and-serial" | "subject-key-identifier";
  /** Index into `certificates` of the certificate the SignerInfo names; null when none matches. */
  readonly certificateIndex: number | null;
  readonly digestAlgorithmOid: string;
  readonly signatureAlgorithmOid: string;
}

export interface ApkV1SignedData {
  /** Raw DER of each certificate in `SignedData.certificates`, in block order. */
  readonly certificates: readonly Uint8Array[];
  readonly signerInfos: readonly ApkV1SignerInfo[];
  /**
   * Bytes after the ContentInfo. apksig's BER parser reads one top-level value
   * and ignores what follows, so they do not make the block unreadable.
   */
  readonly trailingBytes: number;
}

const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_SUBJECT_KEY_IDENTIFIER = "2.5.29.14";

const TAG = {
  integer: 0x02,
  octetString: 0x04,
  oid: 0x06,
  sequence: 0x30,
  set: 0x31,
  context0: 0xa0,
  context1: 0xa1,
  context3: 0xa3,
  /** `[0] IMPLICIT SubjectKeyIdentifier` (primitive). */
  context0Primitive: 0x80,
} as const;

/** Expected failures inside one decode; converted to a Result at the boundary. */
class BlockFailure {
  constructor(readonly error: ApkV1BlockError) {}
}
const malformed = (detail: string): BlockFailure =>
  new BlockFailure({ kind: "malformed-pkcs7", detail });

class ApkBerReader {
  readonly #reader: Asn1BerReader;

  constructor(bytes: Uint8Array) {
    const buffer = Buffer.isBuffer(bytes)
      ? bytes
      : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.#reader = new Asn1BerReader(buffer, MAX_ASN1_ELEMENTS, MAX_ASN1_DEPTH);
  }

  /** One TLV starting at `at`, which must end at or before `limit`. */
  read(at: number, limit: number, depth: number): Asn1BerNode {
    try {
      return this.#reader.read(at, limit, depth);
    } catch (cause: unknown) {
      if (!(cause instanceof Asn1BerFailure)) throw cause;
      if (cause.kind === "budget-exceeded")
        throw new BlockFailure({
          kind: "budget-exceeded",
          resource: "asn1-elements",
          limit: MAX_ASN1_ELEMENTS,
        });
      throw malformed(cause.message);
    }
  }

  rawEncodedSpan(tlv: Asn1BerNode): Uint8Array {
    return this.#reader.bytes.subarray(tlv.start, tlv.end);
  }
}

const expectTag = (
  tlv: Asn1BerNode | undefined,
  tag: number,
  what: string,
): Asn1BerNode => {
  if (tlv === undefined) throw malformed(`${what} is missing`);
  if (tlv.tag !== tag)
    throw malformed(
      `${what} has tag 0x${tlv.tag.toString(16)}, expected 0x${tag.toString(16)}`,
    );
  return tlv;
};

/** BER permits an OCTET STRING to use constructed form with string fragments. */
const expectOctetString = (
  tlv: Asn1BerNode | undefined,
  what: string,
): Asn1BerNode => {
  if (tlv === undefined) throw malformed(`${what} is missing`);
  if (tlv.tag === TAG.octetString) return tlv;
  if (tlv.tag !== 0x24)
    throw malformed(
      `${what} has tag 0x${tlv.tag.toString(16)}, expected 0x4 or 0x24`,
    );
  const validateFragments = (node: Asn1BerNode): void => {
    for (const child of node.children) {
      if (child.tag === TAG.octetString) continue;
      if (child.tag === 0x24) validateFragments(child);
      else
        throw malformed(
          `${what} has non-OCTET STRING fragment tag 0x${child.tag.toString(16)}`,
        );
    }
  };
  validateFragments(tlv);
  return tlv;
};

/** Dotted OID text; arcs are accumulated as BigInt so no arc overflows. */
const oidText = (content: Uint8Array): string => {
  const decoded = decodeAsn1Oid(content, { bytes: 64, arcBytes: 64 });
  if (decoded.ok) return decoded.value;
  if (decoded.error.kind === "truncated")
    throw malformed("object identifier is truncated");
  throw malformed(`object identifier of ${String(content.length)} bytes`);
};

const algorithmOid = (tlv: Asn1BerNode | undefined, what: string) =>
  oidText(
    expectTag(
      expectTag(tlv, TAG.sequence, what).children[0],
      TAG.oid,
      `${what} algorithm`,
    ).content,
  );

const equalBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * apksig compares serials as signed INTEGER values, tolerating redundant sign
 * octets even though DER requires minimal encoding. Normalize each parsed
 * identity once; retain the original certificate encoding independently.
 */
const integerIdentityContents = (bytes: Uint8Array): Uint8Array => {
  let start = 0;
  while (start < bytes.length - 1) {
    const first = bytes[start];
    const nextHigh = ((bytes[start + 1] ?? 0) & 0x80) !== 0;
    if (!((first === 0x00 && !nextHigh) || (first === 0xff && nextHigh))) break;
    start += 1;
  }
  return start === 0 ? bytes : bytes.subarray(start);
};

/**
 * RFC 5280 §7.1: RDN order matters; attributes in one SET do not. This
 * comparison profile admits ASCII PrintableString/UTF8String for common
 * caseIgnore DirectoryString attributes. Other name rules remain unknown;
 * exact encoded identity is still available independently of normalization.
 */
const directoryNameKey = (name: Asn1BerNode): string | null => {
  try {
    const attributes = new Set([
      "2.5.4.3",
      "2.5.4.6",
      "2.5.4.7",
      "2.5.4.8",
      "2.5.4.10",
      "2.5.4.11",
    ]);
    const rdns: string[][] = [];
    for (const rdn of name.children) {
      if (rdn.tag !== TAG.set || rdn.children.length === 0) return null;
      const values: string[] = [];
      for (const attribute of rdn.children) {
        if (attribute.tag !== TAG.sequence || attribute.children.length !== 2)
          return null;
        const [id, value] = attribute.children;
        if (
          id?.tag !== TAG.oid ||
          value === undefined ||
          ![0x0c, 0x13].includes(value.tag)
        )
          return null;
        const oid = oidText(id.content);
        if (
          !attributes.has(oid) ||
          value.content.some((byte) => byte < 0x20 || byte > 0x7e)
        )
          return null;
        const text = Buffer.from(value.content)
          .toString("ascii")
          .trim()
          .replace(/ +/gu, " ")
          .toLowerCase();
        if (value.tag === 0x13 && !/^[a-z0-9 '()+,./:=?-]*$/iu.test(text))
          return null;
        values.push(JSON.stringify([oid, text]));
      }
      rdns.push(values.sort());
    }
    return JSON.stringify(rdns);
  } catch (cause) {
    if (cause instanceof BlockFailure && cause.error.kind === "malformed-pkcs7")
      return null;
    throw cause;
  }
};

/** The X.509 facts a SignerInfo can name: issuer Name DER, serial and SKI. */
interface CertificateIdentity {
  readonly issuer: Uint8Array;
  readonly issuerKey: string | null;
  readonly serialIdentity: Uint8Array;
  readonly subjectKeyIdentifier: Uint8Array | null;
}

/**
 * Read issuer, serial and subjectKeyIdentifier from a certificate's
 * tbsCertificate. A certificate that does not have this shape cannot be named
 * by a SignerInfo (null) but is still reported by the adapter's X.509 owner.
 */
const certificateIdentity = (
  reader: ApkBerReader,
  certificate: Asn1BerNode,
): CertificateIdentity | null => {
  try {
    const tbs = expectTag(
      certificate.children[0],
      TAG.sequence,
      "tbsCertificate",
    );
    const fields = tbs.children;
    const offset = fields[0]?.tag === TAG.context0 ? 1 : 0;
    const serial = expectTag(fields[offset], TAG.integer, "serialNumber");
    const issuer = expectTag(fields[offset + 2], TAG.sequence, "issuer");
    let subjectKeyIdentifier: Uint8Array | null = null;
    const extensions = fields.find((field) => field.tag === TAG.context3);
    if (extensions !== undefined) {
      const list = expectTag(
        extensions.children[0],
        TAG.sequence,
        "extensions",
      );
      for (const extension of list.children) {
        const parts = extension.children;
        const id = expectTag(parts[0], TAG.oid, "extension id");
        if (oidText(id.content) !== OID_SUBJECT_KEY_IDENTIFIER) continue;
        const value = expectTag(parts.at(-1), TAG.octetString, "extnValue");
        const inner = reader.read(value.contentStart, value.contentEnd, 0);
        subjectKeyIdentifier = expectTag(
          inner,
          TAG.octetString,
          "keyIdentifier",
        ).content;
      }
    }
    return {
      issuer: reader.rawEncodedSpan(issuer),
      issuerKey: directoryNameKey(issuer),
      serialIdentity: integerIdentityContents(serial.content),
      subjectKeyIdentifier,
    };
  } catch (cause: unknown) {
    if (cause instanceof BlockFailure && cause.error.kind === "malformed-pkcs7")
      return null;
    throw cause;
  }
};

const signerInfo = (
  reader: ApkBerReader,
  tlv: Asn1BerNode,
  identities: readonly (CertificateIdentity | null)[],
  index: number,
): ApkV1SignerInfo => {
  const what = `signerInfo ${String(index)}`;
  const fields = expectTag(tlv, TAG.sequence, what).children;
  expectTag(fields[0], TAG.integer, `${what} version`);
  const sid = fields[1];
  let identifiedBy: ApkV1SignerInfo["identifiedBy"];
  let certificateIndex: number;
  if (sid?.tag === TAG.sequence) {
    const parts = sid.children;
    const issuerNode = expectTag(parts[0], TAG.sequence, `${what} issuer`);
    const issuer = reader.rawEncodedSpan(issuerNode);
    const issuerKey = directoryNameKey(issuerNode);
    const serialIdentity = integerIdentityContents(
      expectTag(parts[1], TAG.integer, `${what} serialNumber`).content,
    );
    identifiedBy = "issuer-and-serial";
    certificateIndex = identities.findIndex(
      (identity) =>
        identity !== null &&
        (equalBytes(identity.issuer, issuer) ||
          (issuerKey !== null && identity.issuerKey === issuerKey)) &&
        equalBytes(identity.serialIdentity, serialIdentity),
    );
  } else if (sid?.tag === TAG.context0Primitive) {
    const keyId = sid.content;
    identifiedBy = "subject-key-identifier";
    certificateIndex = identities.findIndex(
      (identity) =>
        identity?.subjectKeyIdentifier != null &&
        equalBytes(identity.subjectKeyIdentifier, keyId),
    );
  } else throw malformed(`${what} has no supported signer identifier`);
  const digestAlgorithmOid = algorithmOid(fields[2], `${what} digestAlgorithm`);
  // signedAttrs ([0] IMPLICIT) is optional before signatureAlgorithm.
  const next = fields[3]?.tag === TAG.context0 ? 4 : 3;
  const signatureAlgorithmOid = algorithmOid(
    fields[next],
    `${what} signatureAlgorithm`,
  );
  expectOctetString(fields[next + 1], `${what} signature`);
  return {
    identifiedBy,
    certificateIndex: certificateIndex < 0 ? null : certificateIndex,
    digestAlgorithmOid,
    signatureAlgorithmOid,
  };
};

const decode = (bytes: Uint8Array): ApkV1SignedData => {
  const reader = new ApkBerReader(bytes);
  const contentInfo = expectTag(
    reader.read(0, bytes.length, 0),
    TAG.sequence,
    "ContentInfo",
  );
  const [contentType, explicit] = contentInfo.children;
  const type = oidText(expectTag(contentType, TAG.oid, "contentType").content);
  if (type !== OID_SIGNED_DATA)
    throw malformed(`contentType ${type} is not SignedData`);
  const signedData = expectTag(
    expectTag(explicit, TAG.context0, "content").children[0],
    TAG.sequence,
    "SignedData",
  );
  const fields = signedData.children;
  expectTag(fields[0], TAG.integer, "SignedData version");
  expectTag(fields[1], TAG.set, "digestAlgorithms");
  expectTag(fields[2], TAG.sequence, "encapContentInfo");
  let at = 3;
  const certificates: Asn1BerNode[] = [];
  if (fields[at]?.tag === TAG.context0) {
    for (const choice of fields[at]!.children) {
      // Other CertificateChoices (extended, attribute, other) carry no X.509 signer.
      if (choice.tag !== TAG.sequence)
        throw malformed(
          `certificate choice with tag 0x${choice.tag.toString(16)} is not an X.509 certificate`,
        );
      if (certificates.length >= MAX_V1_BLOCK_CERTIFICATES)
        throw new BlockFailure({
          kind: "budget-exceeded",
          resource: "v1-block-certificates",
          limit: MAX_V1_BLOCK_CERTIFICATES,
        });
      certificates.push(choice);
    }
    at += 1;
  }
  if (fields[at]?.tag === TAG.context1) at += 1;
  const infos = expectTag(fields[at], TAG.set, "signerInfos").children;
  if (infos.length > MAX_V1_SIGNER_INFOS)
    throw new BlockFailure({
      kind: "budget-exceeded",
      resource: "v1-signer-infos",
      limit: MAX_V1_SIGNER_INFOS,
    });
  const identities = certificates.map((certificate) =>
    certificateIdentity(reader, certificate),
  );
  return {
    certificates: certificates.map((certificate) =>
      reader.rawEncodedSpan(certificate),
    ),
    signerInfos: infos.map((info, index) =>
      signerInfo(reader, info, identities, index),
    ),
    trailingBytes: bytes.length - contentInfo.end,
  };
};

/** Decode one v1 signature block's PKCS#7 SignedData. Nothing is verified. */
export const decodeV1SignatureBlock = (
  bytes: Uint8Array,
): Result<ApkV1SignedData, ApkV1BlockError> => {
  try {
    return ok(decode(bytes));
  } catch (cause: unknown) {
    if (cause instanceof BlockFailure) return err(cause.error);
    throw cause;
  }
};
