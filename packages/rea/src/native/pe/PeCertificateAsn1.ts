import { decodeAsn1Oid } from "../../domain/asn1Oid.js";
import {
  Asn1BerFailure,
  Asn1BerReader,
  type Asn1BerNode,
} from "../../domain/asn1Ber.js";

const OID_NAMES: Readonly<Record<string, string>> = {
  "1.2.840.113549.1.7.1": "data",
  "1.2.840.113549.1.7.2": "signedData",
  "1.2.840.113549.1.1.1": "rsaEncryption",
  "1.2.840.113549.1.1.5": "sha1WithRSAEncryption",
  "1.2.840.113549.1.1.11": "sha256WithRSAEncryption",
  "1.2.840.113549.1.1.12": "sha384WithRSAEncryption",
  "1.2.840.113549.1.1.13": "sha512WithRSAEncryption",
  "1.2.840.113549.1.9.3": "contentType",
  "1.2.840.113549.1.9.4": "messageDigest",
  "1.2.840.113549.1.9.5": "signingTime",
  "1.3.14.3.2.26": "sha1",
  "2.5.4.3": "commonName",
  "2.5.4.6": "countryName",
  "2.5.4.10": "organizationName",
  "2.5.4.11": "organizationalUnitName",
  "2.16.840.1.101.3.4.2.1": "sha256",
  "2.16.840.1.101.3.4.2.2": "sha384",
  "2.16.840.1.101.3.4.2.3": "sha512",
};

/** A fixed per-payload decoder allowance and its limit. */
export interface PeCertificateDecodeAllowance {
  readonly allowance: "asn1-nodes" | "decoded-text";
  readonly limit: number;
}

export class PeCertificateAsn1Failure extends Error {
  constructor(
    message: string,
    /** Set when a fixed decoder allowance, not malformed DER, refused the payload. */
    readonly exhausted: PeCertificateDecodeAllowance | null = null,
  ) {
    super(message);
    this.name = "PeCertificateAsn1Failure";
  }
}

const fail = (message: string): never => {
  throw new PeCertificateAsn1Failure(message);
};

const required = <T>(value: T | undefined, message: string): T =>
  value === undefined ? fail(message) : value;

// Authenticode signatures with full chains and countersignatures decode to a
// few thousand nodes; the budget bounds sibling fan-out, which depth does not.
export const ASN1_NODE_BUDGET = 16_384;

/** Decode one bounded ASN.1 TLV, including indefinite constructed BER values. */
export const readAsn1 = (bytes: Buffer): Asn1BerNode => {
  try {
    return new Asn1BerReader(bytes, ASN1_NODE_BUDGET).read();
  } catch (cause: unknown) {
    if (cause instanceof Asn1BerFailure)
      throw new PeCertificateAsn1Failure(
        cause.message,
        cause.kind === "budget-exceeded"
          ? { allowance: "asn1-nodes", limit: cause.limit ?? ASN1_NODE_BUDGET }
          : null,
      );
    throw cause;
  }
};

const requireDefiniteEncoding = (node: Asn1BerNode, label: string): void => {
  if (node.lengthForm === "indefinite")
    fail(`${label} must use definite DER length encoding.`);
  for (const child of node.children) requireDefiniteEncoding(child, label);
};

export const oidName = (oid: string): string | null => OID_NAMES[oid] ?? null;

// One arc grows a BigInt by a shift per byte. Certificate OIDs, including a
// 2.25 UUID arc, fit under both caps; the caps stop that growth.
export const MAX_OID_BYTES = 256;
export const MAX_OID_ARC_BYTES = 32;

// One PKCS#7 payload shares this ceiling. Real issuer and subject names are
// far smaller; the cap stops one wide string from occupying the file budget.
export const MAX_DECODED_NAME_BYTES = 65_536;

interface DecodedNameBudget {
  remaining: number;
  teletexStringCompatibilityUsed: boolean;
}

const chargeDecodedName = (budget: DecodedNameBudget, bytes: number): void => {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > budget.remaining)
    throw new PeCertificateAsn1Failure(
      `Certificate text exceeds the ${String(MAX_DECODED_NAME_BYTES)}-byte decoded budget.`,
      { allowance: "decoded-text", limit: MAX_DECODED_NAME_BYTES },
    );
  budget.remaining -= bytes;
};

/** Decode an OBJECT IDENTIFIER content buffer as dotted decimal. */
export const decodeOid = (content: Buffer): string => {
  const decoded = decodeAsn1Oid(content, {
    bytes: MAX_OID_BYTES,
    arcBytes: MAX_OID_ARC_BYTES,
  });
  if (decoded.ok) return decoded.value;
  switch (decoded.error.kind) {
    case "empty":
      return fail("Empty OBJECT IDENTIFIER.");
    case "byte-limit":
      return fail(
        `OBJECT IDENTIFIER exceeds ${String(decoded.error.limit)} bytes.`,
      );
    case "arc-limit":
      return fail(
        `OBJECT IDENTIFIER arc exceeds ${String(decoded.error.limit)} bytes.`,
      );
    case "non-minimal":
      return fail("Non-minimal OBJECT IDENTIFIER component.");
    case "truncated":
      return fail("Truncated OBJECT IDENTIFIER component.");
  }
};

const decodeBmpString = (bytes: Buffer, budget: DecodedNameBudget): string => {
  if (bytes.length % 2 !== 0) return fail("BMPString length is odd.");
  // Charge before the copy. Appending one character at a time retains a
  // cons-string chain of about sixteen heap bytes per source byte.
  chargeDecodedName(budget, bytes.length);
  if (bytes.length === 0) return "";
  const decoded = Buffer.allocUnsafe(bytes.length);
  for (let index = 0; index < bytes.length; index += 2) {
    const codeUnit = bytes.readUInt16BE(index);
    // BMPString is UCS-2: even a paired UTF-16 surrogate is not a BMP character.
    if (codeUnit >= 0xd800 && codeUnit <= 0xdfff)
      return fail("BMPString holds a surrogate code point.");
    decoded.writeUInt16LE(codeUnit, index);
  }
  return decoded.toString("utf16le");
};

const decodeUtf32Be = (bytes: Buffer, budget: DecodedNameBudget): string => {
  if (bytes.length % 4 !== 0)
    return fail("UniversalString length is not a multiple of 4.");
  // Four source bytes become at most four UTF-16 bytes, so the source length
  // bounds the decoded string before any code point is copied.
  chargeDecodedName(budget, bytes.length);
  const decoded = Buffer.allocUnsafe(bytes.length);
  let at = 0;
  for (let index = 0; index < bytes.length; index += 4) {
    const codePoint = bytes.readUInt32BE(index);
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff))
      return fail("UniversalString holds an invalid code point.");
    if (codePoint > 0xffff) {
      const shifted = codePoint - 0x10000;
      decoded.writeUInt16LE(0xd800 + (shifted >> 10), at);
      decoded.writeUInt16LE(0xdc00 + (shifted & 0x3ff), at + 2);
      at += 4;
    } else {
      decoded.writeUInt16LE(codePoint, at);
      at += 2;
    }
  }
  return decoded.subarray(0, at).toString("utf16le");
};

const decodeUtf8 = (bytes: Buffer, budget: DecodedNameBudget): string => {
  chargeDecodedName(budget, bytes.length);
  const decoded = bytes.toString("utf8");
  // U+FFFD would hide the original bytes and collapse distinct invalid names.
  if (!Buffer.from(decoded, "utf8").equals(bytes))
    return fail("DirectoryString is not valid UTF-8.");
  return decoded;
};

const decodeDirectoryString = (
  node: Asn1BerNode,
  budget: DecodedNameBudget,
): string => {
  switch (node.tag) {
    case 0x1c:
      return decodeUtf32Be(node.content, budget);
    case 0x1e:
      return decodeBmpString(node.content, budget);
    case 0x0c:
    case 0x13:
    case 0x16:
    case 0x17:
    case 0x18:
      return decodeUtf8(node.content, budget);
    case 0x14:
      chargeDecodedName(budget, node.content.length);
      budget.teletexStringCompatibilityUsed = true;
      // OpenSSL also assumes ISO-8859-1 when converting legacy T61String.
      return node.content.toString("latin1");
    default:
      return fail(
        `Unsupported certificate name encoding (DER tag 0x${node.tag.toString(16).padStart(2, "0")}).`,
      );
  }
};

const integerHex = (content: Buffer, budget: DecodedNameBudget): string => {
  let start = 0;
  while (start < content.length - 1 && content[start] === 0) start += 1;
  chargeDecodedName(budget, (content.length - start) * 2);
  return content.subarray(start).toString("hex");
};

// Key identifiers are octet strings, not integers: leading zero bytes stay.
// The hex form is evidence text, so it shares the decoded-text budget.
const octetHex = (content: Buffer, budget: DecodedNameBudget): string => {
  chargeDecodedName(budget, content.length * 2);
  return content.toString("hex");
};

const requireBitStringContent = (content: Buffer, label: string): void => {
  const unused = content[0];
  if (unused === undefined || unused > 7)
    return fail(`${label} BIT STRING is truncated or has invalid unused bits.`);
  if (
    (content.length === 1 && unused !== 0) ||
    ((content[content.length - 1] ?? 0) & ((1 << unused) - 1)) !== 0
  )
    return fail(`${label} BIT STRING has invalid padding bits.`);
};

const requireBitString = (
  node: Asn1BerNode | undefined,
  label: string,
): void => {
  if (node === undefined || node.tag !== 0x03)
    return fail(`${label} is not a BIT STRING.`);
  requireBitStringContent(node.content, label);
};

const sequence = (node: Asn1BerNode, label: string): readonly Asn1BerNode[] => {
  if (node.tag !== 0x30) return fail(`Expected SEQUENCE for ${label}.`);
  return node.children;
};

const algorithmOid = (node: Asn1BerNode): string => {
  const children = sequence(node, "AlgorithmIdentifier");
  const oid = children[0];
  if (oid === undefined || oid.tag !== 0x06)
    return fail("AlgorithmIdentifier is missing an OBJECT IDENTIFIER.");
  return decodeOid(oid.content);
};

interface Attribute {
  readonly oid: string;
  readonly oid_name: string | null;
  readonly value: string;
}

const decodeName = (
  node: Asn1BerNode,
  budget: DecodedNameBudget,
): {
  readonly text: string;
  readonly attributes: readonly Attribute[];
} => {
  const attributes: Attribute[] = [];
  for (const rdn of sequence(node, "Name")) {
    if (rdn.tag !== 0x31) return fail("Name RDN is not a SET.");
    for (const attribute of rdn.children) {
      const parts = sequence(attribute, "AttributeTypeAndValue");
      const oidNode = parts[0];
      const valueNode = parts[1];
      if (
        oidNode === undefined ||
        oidNode.tag !== 0x06 ||
        valueNode === undefined
      )
        return fail("AttributeTypeAndValue is truncated.");
      const oid = decodeOid(oidNode.content);
      attributes.push({
        oid,
        oid_name: oidName(oid),
        value: decodeDirectoryString(valueNode, budget),
      });
    }
  }
  const text = attributes
    .map((attribute) => {
      const key = attribute.oid_name ?? attribute.oid;
      return `${key}=${attribute.value}`;
    })
    .join(", ");
  return { text, attributes };
};

const validityTime = (node: Asn1BerNode, budget: DecodedNameBudget): string => {
  if (node.tag !== 0x17 && node.tag !== 0x18)
    return fail("Validity instant is not UTCTime or GeneralizedTime.");
  // A zero byte becomes "\u0000" (six characters) in the hashed evidence JSON.
  chargeDecodedName(budget, node.content.length * 6);
  return node.content.toString("utf8");
};

export interface ParsedCertificate {
  readonly start: number;
  readonly end: number;
  readonly serial_hex: string;
  readonly issuer: ReturnType<typeof decodeName>;
  readonly subject: ReturnType<typeof decodeName>;
  readonly not_before: string;
  readonly not_after: string;
  readonly signature_algorithm_oid: string;
}

const requireSubjectPublicKeyInfo = (node: Asn1BerNode): void => {
  const children = sequence(node, "SubjectPublicKeyInfo");
  const algorithm = children[0];
  const key = children[1];
  if (algorithm === undefined || key === undefined || children.length !== 2)
    return fail(
      "SubjectPublicKeyInfo is missing algorithm or subjectPublicKey.",
    );
  algorithmOid(algorithm);
  requireBitString(key, "SubjectPublicKeyInfo subjectPublicKey");
};

// issuerUniqueID [1], subjectUniqueID [2], and extensions [3] are optional
// and ordered. Anything else is not a TBSCertificate field.
const finishTbsCertificate = (
  children: readonly Asn1BerNode[],
  start: number,
): void => {
  let cursor = start;
  const issuerUniqueId = children[cursor];
  if (issuerUniqueId?.tag === 0x81) {
    requireBitStringContent(
      issuerUniqueId.content,
      "TBSCertificate issuerUniqueID",
    );
    cursor += 1;
  }
  const subjectUniqueId = children[cursor];
  if (subjectUniqueId?.tag === 0x82) {
    requireBitStringContent(
      subjectUniqueId.content,
      "TBSCertificate subjectUniqueID",
    );
    cursor += 1;
  }
  const extensions = children[cursor];
  if (extensions?.tag === 0xa3) {
    const body = extensions.children[0];
    if (
      extensions.children.length !== 1 ||
      body === undefined ||
      body.tag !== 0x30
    )
      return fail("TBSCertificate extensions are not a SEQUENCE.");
    cursor += 1;
  }
  if (cursor !== children.length)
    return fail("TBSCertificate has unexpected trailing fields.");
};

/** Decode one X.509 Certificate SEQUENCE at a known file-relative DER node. */
export const parseCertificate = (
  node: Asn1BerNode,
  names: DecodedNameBudget = {
    remaining: MAX_DECODED_NAME_BYTES,
    teletexStringCompatibilityUsed: false,
  },
): ParsedCertificate => {
  requireDefiniteEncoding(node, "X.509 Certificate");
  const children = sequence(node, "Certificate");
  const tbs = children[0];
  const signatureAlgorithm = children[1];
  const signatureValue = children[2];
  // Not verifying the signature does not make the required BIT STRING optional.
  if (
    tbs === undefined ||
    signatureAlgorithm === undefined ||
    signatureValue === undefined
  )
    return fail(
      "Certificate is missing TBSCertificate, signatureAlgorithm, or signatureValue.",
    );
  if (children.length !== 3)
    return fail("Certificate has unexpected trailing fields.");
  requireBitString(signatureValue, "Certificate signatureValue");
  const tbsChildren = sequence(tbs, "TBSCertificate");
  let index = 0;
  const version = tbsChildren[0];
  if (version?.tag === 0xa0) {
    const versionNumber = version.children[0];
    if (
      version.children.length !== 1 ||
      versionNumber === undefined ||
      versionNumber.tag !== 0x02
    )
      return fail("TBSCertificate version is not an INTEGER.");
    index = 1;
  }
  const serial = tbsChildren[index];
  const tbsSignature = tbsChildren[index + 1];
  const issuer = tbsChildren[index + 2];
  const validity = tbsChildren[index + 3];
  const subject = tbsChildren[index + 4];
  const subjectPublicKeyInfo = tbsChildren[index + 5];
  if (
    serial === undefined ||
    serial.tag !== 0x02 ||
    tbsSignature === undefined ||
    issuer === undefined ||
    validity === undefined ||
    subject === undefined ||
    subjectPublicKeyInfo === undefined
  )
    return fail(
      "TBSCertificate is missing serial, signature, issuer, validity, subject, or subjectPublicKeyInfo.",
    );
  algorithmOid(tbsSignature);
  requireSubjectPublicKeyInfo(subjectPublicKeyInfo);
  finishTbsCertificate(tbsChildren, index + 6);
  const validityChildren = sequence(validity, "Validity");
  const notBefore = validityChildren[0];
  const notAfter = validityChildren[1];
  if (
    validityChildren.length !== 2 ||
    notBefore === undefined ||
    notAfter === undefined
  )
    return fail("Validity is missing notBefore or notAfter.");
  return {
    start: node.start,
    end: node.end,
    serial_hex: integerHex(serial.content, names),
    issuer: decodeName(issuer, names),
    subject: decodeName(subject, names),
    not_before: validityTime(notBefore, names),
    not_after: validityTime(notAfter, names),
    signature_algorithm_oid: algorithmOid(signatureAlgorithm),
  };
};

export interface ParsedSigner {
  readonly digest_algorithm_oid: string;
  readonly signature_algorithm_oid: string;
  readonly issuer: ReturnType<typeof decodeName> | null;
  readonly serial_hex: string | null;
  readonly subject_key_identifier_hex: string | null;
  readonly authenticated_attributes: boolean;
  readonly unsigned_attribute_oids: readonly string[] | null;
}

const signerIdentifier = (
  sid: Asn1BerNode,
  names: DecodedNameBudget,
): {
  readonly issuer: ReturnType<typeof decodeName> | null;
  readonly serial_hex: string | null;
  readonly subject_key_identifier_hex: string | null;
} => {
  if (sid.tag === 0x30) {
    const name = sid.children[0];
    const serial = sid.children[1];
    if (
      sid.children.length !== 2 ||
      name === undefined ||
      name.tag !== 0x30 ||
      serial === undefined ||
      serial.tag !== 0x02
    )
      return fail("SignerInfo issuerAndSerialNumber is truncated.");
    return {
      issuer: decodeName(name, names),
      serial_hex: integerHex(serial.content, names),
      subject_key_identifier_hex: null,
    };
  }
  if (sid.tag === 0x80) {
    if (sid.content.length === 0)
      return fail("SignerInfo subjectKeyIdentifier is empty.");
    return {
      issuer: null,
      serial_hex: null,
      subject_key_identifier_hex: octetHex(sid.content, names),
    };
  }
  return fail(
    "SignerInfo sid is not issuerAndSerialNumber or subjectKeyIdentifier.",
  );
};

const parseSigner = (
  node: Asn1BerNode,
  names: DecodedNameBudget,
): ParsedSigner => {
  const children = sequence(node, "SignerInfo");
  const version = children[0];
  const sid = children[1];
  const digestAlg = children[2];
  if (version === undefined || version.tag !== 0x02)
    return fail("SignerInfo is missing version.");
  if (sid === undefined || digestAlg === undefined)
    return fail("SignerInfo is missing sid or digestAlgorithm.");
  const { issuer, serial_hex, subject_key_identifier_hex } = signerIdentifier(
    sid,
    names,
  );
  let cursor = 3;
  const authenticated = children[cursor]?.tag === 0xa0;
  if (authenticated) {
    requireDefiniteEncoding(children[cursor]!, "SignerInfo signedAttrs");
    cursor += 1;
  }
  const signatureAlg = children[cursor];
  if (signatureAlg === undefined)
    return fail("SignerInfo is missing signatureAlgorithm.");
  const signature = children[cursor + 1];
  if (signature === undefined || signature.tag !== 0x04)
    return fail("SignerInfo is missing its signature OCTET STRING.");
  if (signature.content.length === 0)
    return fail("SignerInfo signature OCTET STRING is empty.");
  cursor += 2;
  let unsignedAttributeOids: string[] | null = null;
  const unsigned = children[cursor];
  if (unsigned?.tag === 0xa1) {
    unsignedAttributeOids = unsigned.children.map((attribute) => {
      const fields = sequence(attribute, "SignerInfo unsigned attribute");
      const oid = fields[0];
      if (fields.length !== 2 || oid?.tag !== 0x06 || fields[1]?.tag !== 0x31)
        return fail(
          "SignerInfo unsigned attribute is missing its type or values.",
        );
      // OID text expands into decimal arcs and is retained in the result.
      chargeDecodedName(names, oid.content.length * 4);
      return decodeOid(oid.content);
    });
    cursor += 1;
  }
  if (cursor !== children.length)
    return fail("SignerInfo has unexpected trailing fields.");
  return {
    digest_algorithm_oid: algorithmOid(digestAlg),
    signature_algorithm_oid: algorithmOid(signatureAlg),
    issuer,
    serial_hex,
    subject_key_identifier_hex,
    authenticated_attributes: authenticated,
    unsigned_attribute_oids: unsignedAttributeOids,
  };
};

export interface ParsedSignedData {
  readonly content_type_oid: string;
  readonly digest_algorithm_oids: readonly string[];
  readonly certificates: readonly ParsedCertificate[];
  readonly signers: readonly ParsedSigner[];
  readonly teletexStringCompatibilityUsed: boolean;
}

const parseSignedData = (
  node: Asn1BerNode,
  names: DecodedNameBudget,
): ParsedSignedData => {
  const children = sequence(node, "SignedData");
  const [version, digestSet, encapContentInfo] = children;
  if (version === undefined || version.tag !== 0x02)
    return fail("SignedData is missing version.");
  if (digestSet === undefined || digestSet.tag !== 0x31)
    return fail("SignedData is missing digestAlgorithms.");
  if (
    encapContentInfo === undefined ||
    encapContentInfo.tag !== 0x30 ||
    encapContentInfo.children[0]?.tag !== 0x06
  )
    return fail("SignedData is missing encapContentInfo.");
  const digest_algorithm_oids = digestSet.children.map(algorithmOid);
  // RFC 5652 order: [0] certificates, [1] crls, both optional, then the
  // required signerInfos SET as the final field.
  let cursor = 3;
  const certificateSet =
    children[cursor]?.tag === 0xa0 ? children[cursor] : undefined;
  if (certificateSet !== undefined) cursor += 1;
  if (children[cursor]?.tag === 0xa1) cursor += 1;
  const signerSet = children[cursor];
  if (signerSet === undefined || signerSet.tag !== 0x31)
    return fail("SignedData is missing signerInfos.");
  if (signerSet.children.length === 0)
    return fail("SignedData signerInfos contains no SignerInfo.");
  if (cursor !== children.length - 1)
    return fail("SignedData has unexpected trailing fields.");
  const certificates = (certificateSet?.children ?? []).map((certificate) =>
    parseCertificate(certificate, names),
  );
  const signers = signerSet.children.map((signer) =>
    parseSigner(signer, names),
  );
  return {
    content_type_oid: "1.2.840.113549.1.7.2",
    digest_algorithm_oids,
    certificates,
    signers,
    teletexStringCompatibilityUsed: names.teletexStringCompatibilityUsed,
  };
};

/** Decode ContentInfo wrapping SignedData; other content types remain unsupported. */
export const parsePkcs7SignedData = (root: Asn1BerNode): ParsedSignedData => {
  const children = sequence(root, "ContentInfo");
  const type = children[0];
  const content = children[1];
  if (type === undefined || type.tag !== 0x06)
    return fail("ContentInfo is missing contentType.");
  if (content === undefined || content.tag !== 0xa0)
    return fail("signedData content is missing.");
  if (children.length !== 2)
    return fail("ContentInfo has unexpected trailing fields.");
  const oid = decodeOid(type.content);
  if (oid !== "1.2.840.113549.1.7.2")
    return fail(`PKCS#7 contentType ${oid} is not signedData.`);
  const signedData = content.children[0];
  if (signedData === undefined) return fail("signedData content is missing.");
  if (content.children.length !== 1)
    return fail("signedData content has unexpected trailing fields.");
  return parseSignedData(signedData, {
    remaining: MAX_DECODED_NAME_BYTES,
    teletexStringCompatibilityUsed: false,
  });
};
