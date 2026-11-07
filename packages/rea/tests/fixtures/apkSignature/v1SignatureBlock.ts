/**
 * v1 (JAR) signature block fixtures. The two CMS blocks were produced by
 * `openssl cms -sign -binary -noattr [-keyid] -md sha256` over a one-line .SF
 * with an EC P-256 signer certificate issued by a separate root, and carry
 * [leaf, root] in that order. The DER builders below assemble the shapes a
 * producer may emit but OpenSSL does not (reordered or missing certificates,
 * several SignerInfos, BER indefinite lengths, malformed fields).
 */
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { apkSchemeValue } from "./signingScheme.js";

const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(Buffer.from(text, "base64"));

/** CN=REA Test Signer,O=REA,C=PT; serial 0x1234; issued by the root below. */
export const LEAF_CERTIFICATE = fromBase64(
  "MIIBjzCCATWgAwIBAgICEjQwCgYIKoZIzj0EAwIwJjEWMBQGA1UEAwwNUkVBIFRlc3QgUm9vdDEMMAoGA1UECgwDUkVBMCAXDTI2MTAxNzEyMTMxOFoYDzIxMjYwOTIzMTIxMzE4WjA1MRgwFgYDVQQDDA9SRUEgVGVzdCBTaWduZXIxDDAKBgNVBAoMA1JFQTELMAkGA1UEBhMCUFQwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATGFItDQ8IkJ0NGd9sM72grl0tW7m+86cN02S7okjsg7Pk0YLJ3bD6QRDBRxfE97ykcOik6ytLtIcj+rkJE1Joro0IwQDAdBgNVHQ4EFgQU7u5MpCXpdQ16uVQpq8x8ZqEIafgwHwYDVR0jBBgwFoAUu6si+isK/nuIGf2i6Fggd7gEabkwCgYIKoZIzj0EAwIDSAAwRQIgSviQ7GDMVMTJ/5rns7i7mhLqqj/pTF+t41X0QYr/qacCIQDAuFe4to58G0aLLg/ajUWsnS0TtzbV1vCF82wIbcTnaQ==",
);
export const LEAF_SHA256 =
  "9224e30fd7981ebeb903d2593075845316d5c4f546c2f3e4675c03ef3302ef88";
export const LEAF_SUBJECT = "CN=REA Test Signer\nO=REA\nC=PT";

/** CN=REA Test Root,O=REA; self-signed, serial 1. */
export const ROOT_CERTIFICATE = fromBase64(
  "MIIBkDCCATagAwIBAgIBATAKBggqhkjOPQQDAjAmMRYwFAYDVQQDDA1SRUEgVGVzdCBSb290MQwwCgYDVQQKDANSRUEwIBcNMjYxMDE3MTIxMzE4WhgPMjEyNjA5MjMxMjEzMThaMCYxFjAUBgNVBAMMDVJFQSBUZXN0IFJvb3QxDDAKBgNVBAoMA1JFQTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABP1ZSF3TjoEuKOPudKO/iJl6/YDqTqW8rYc8JNsxwSDcWnvOmuEdX/usLAZ2vI9MxDGrg8mX/LpPRJwSxMkA1lijUzBRMB0GA1UdDgQWBBS7qyL6Kwr+e4gZ/aLoWCB3uARpuTAfBgNVHSMEGDAWgBS7qyL6Kwr+e4gZ/aLoWCB3uARpuTAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0gAMEUCIEzOCpuf6I5Tm9O/v+/KYBVW6t6F7/s0vMVBtpbd9XUvAiEAiAfaZ1xLTu+iS2G8RzZBm+4CwHBai9Vss4Yj/Ppb574=",
);
export const ROOT_SHA256 =
  "b8470a4468a232423983c0b4b0414c43af60ae66ea167fdd05a06a3511ebb04d";

/** OpenSSL CMS, SignerInfo identified by issuerAndSerialNumber. */
export const OPENSSL_BLOCK_ISSUER_SERIAL = fromBase64(
  "MIID9QYJKoZIhvcNAQcCoIID5jCCA+ICAQExDTALBglghkgBZQMEAgEwCwYJKoZIhvcNAQcBoIIDJzCCAY8wggE1oAMCAQICAhI0MAoGCCqGSM49BAMCMCYxFjAUBgNVBAMMDVJFQSBUZXN0IFJvb3QxDDAKBgNVBAoMA1JFQTAgFw0yNjEwMTcxMjEzMThaGA8yMTI2MDkyMzEyMTMxOFowNTEYMBYGA1UEAwwPUkVBIFRlc3QgU2lnbmVyMQwwCgYDVQQKDANSRUExCzAJBgNVBAYTAlBUMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAExhSLQ0PCJCdDRnfbDO9oK5dLVu5vvOnDdNku6JI7IOz5NGCyd2w+kEQwUcXxPe8pHDopOsrS7SHI/q5CRNSaK6NCMEAwHQYDVR0OBBYEFO7uTKQl6XUNerlUKavMfGahCGn4MB8GA1UdIwQYMBaAFLurIvorCv57iBn9ouhYIHe4BGm5MAoGCCqGSM49BAMCA0gAMEUCIEr4kOxgzFTEyf+a57O4u5oS6qo/6UxfreNV9EGK/6mnAiEAwLhXuLaOfBtGiy4P2o1FrJ0tE7c21dbwhfNsCG3E52kwggGQMIIBNqADAgECAgEBMAoGCCqGSM49BAMCMCYxFjAUBgNVBAMMDVJFQSBUZXN0IFJvb3QxDDAKBgNVBAoMA1JFQTAgFw0yNjEwMTcxMjEzMThaGA8yMTI2MDkyMzEyMTMxOFowJjEWMBQGA1UEAwwNUkVBIFRlc3QgUm9vdDEMMAoGA1UECgwDUkVBMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/VlIXdOOgS4o4+50o7+ImXr9gOpOpbythzwk2zHBINxae86a4R1f+6wsBna8j0zEMauDyZf8uk9EnBLEyQDWWKNTMFEwHQYDVR0OBBYEFLurIvorCv57iBn9ouhYIHe4BGm5MB8GA1UdIwQYMBaAFLurIvorCv57iBn9ouhYIHe4BGm5MA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIgTM4Km5/ojlOb07+/78pgFVbq3oXv+zS8xUG2lt31dS8CIQCIB9pnXEtO76JLYbxHNkGb7gLAcFqL1WyzhiP8+lvnvjGBlTCBkgIBATAsMCYxFjAUBgNVBAMMDVJFQSBUZXN0IFJvb3QxDDAKBgNVBAoMA1JFQQICEjQwCwYJYIZIAWUDBAIBMAoGCCqGSM49BAMCBEYwRAIgdE1HcVYt2jYd5ZhkrHhcZ5V+qfuO9SwdT0gWz1MXpdICIEMkyi87x+4KIT0Vc5XX9k0IHhnwIANPw4Lcx+0owlAg",
);

/** OpenSSL CMS (`-keyid`), SignerInfo identified by subjectKeyIdentifier. */
export const OPENSSL_BLOCK_KEY_ID = fromBase64(
  "MIID3AYJKoZIhvcNAQcCoIIDzTCCA8kCAQMxDTALBglghkgBZQMEAgEwCwYJKoZIhvcNAQcBoIIDJzCCAY8wggE1oAMCAQICAhI0MAoGCCqGSM49BAMCMCYxFjAUBgNVBAMMDVJFQSBUZXN0IFJvb3QxDDAKBgNVBAoMA1JFQTAgFw0yNjEwMTcxMjEzMThaGA8yMTI2MDkyMzEyMTMxOFowNTEYMBYGA1UEAwwPUkVBIFRlc3QgU2lnbmVyMQwwCgYDVQQKDANSRUExCzAJBgNVBAYTAlBUMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAExhSLQ0PCJCdDRnfbDO9oK5dLVu5vvOnDdNku6JI7IOz5NGCyd2w+kEQwUcXxPe8pHDopOsrS7SHI/q5CRNSaK6NCMEAwHQYDVR0OBBYEFO7uTKQl6XUNerlUKavMfGahCGn4MB8GA1UdIwQYMBaAFLurIvorCv57iBn9ouhYIHe4BGm5MAoGCCqGSM49BAMCA0gAMEUCIEr4kOxgzFTEyf+a57O4u5oS6qo/6UxfreNV9EGK/6mnAiEAwLhXuLaOfBtGiy4P2o1FrJ0tE7c21dbwhfNsCG3E52kwggGQMIIBNqADAgECAgEBMAoGCCqGSM49BAMCMCYxFjAUBgNVBAMMDVJFQSBUZXN0IFJvb3QxDDAKBgNVBAoMA1JFQTAgFw0yNjEwMTcxMjEzMThaGA8yMTI2MDkyMzEyMTMxOFowJjEWMBQGA1UEAwwNUkVBIFRlc3QgUm9vdDEMMAoGA1UECgwDUkVBMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/VlIXdOOgS4o4+50o7+ImXr9gOpOpbythzwk2zHBINxae86a4R1f+6wsBna8j0zEMauDyZf8uk9EnBLEyQDWWKNTMFEwHQYDVR0OBBYEFLurIvorCv57iBn9ouhYIHe4BGm5MB8GA1UdIwQYMBaAFLurIvorCv57iBn9ouhYIHe4BGm5MA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIgTM4Km5/ojlOb07+/78pgFVbq3oXv+zS8xUG2lt31dS8CIQCIB9pnXEtO76JLYbxHNkGb7gLAcFqL1WyzhiP8+lvnvjF9MHsCAQOAFO7uTKQl6XUNerlUKavMfGahCGn4MAsGCWCGSAFlAwQCATAKBggqhkjOPQQDAgRHMEUCICTKaKt+DjSOz1TMGWDildMG7y6j/YxpuhVihbL2dqlLAiEA/lt/MfWWelivz5TMG0ylVpYcIdk7GF3PXoO7eq0dEus=",
);

export const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
export const OID_ECDSA_SHA256 = "1.2.840.10045.4.3.2";

/** DER length octets (definite form). */
const lengthOctets = (length: number): number[] => {
  if (length < 0x80) return [length];
  const out: number[] = [];
  for (let v = length; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return [0x80 | out.length, ...out];
};

export const tlv = (
  tag: number,
  ...content: readonly Uint8Array[]
): Uint8Array => {
  const body = Buffer.concat(content);
  return Uint8Array.from([tag, ...lengthOctets(body.length), ...body]);
};
/** A constructed element in BER indefinite-length form. */
export const indefinite = (
  tag: number,
  ...content: readonly Uint8Array[]
): Uint8Array =>
  Uint8Array.from(
    Buffer.concat([Buffer.from([tag, 0x80]), ...content, Buffer.from([0, 0])]),
  );

const encodeOid = (dotted: string): Uint8Array => {
  const [a = 0, b = 0, ...rest] = dotted.split(".").map(Number);
  const out = [a * 40 + b];
  for (const arc of rest) {
    const bytes = [arc & 0x7f];
    for (let v = Math.floor(arc / 128); v > 0; v = Math.floor(v / 128))
      bytes.unshift(0x80 | (v & 0x7f));
    out.push(...bytes);
  }
  return tlv(0x06, Uint8Array.from(out));
};
export const oid = encodeOid;
const integer = (value: number): Uint8Array =>
  tlv(0x02, Uint8Array.from([value]));
const algorithm = (dotted: string): Uint8Array => tlv(0x30, oid(dotted));

interface DerSpan {
  readonly start: number;
  readonly content: number;
  readonly end: number;
}

/** Definite-length children of `bytes[start, end)`; fixture certificates only. */
const derChildren = (
  bytes: Uint8Array,
  start: number,
  end: number,
): DerSpan[] => {
  const out: DerSpan[] = [];
  for (let at = start; at < end;) {
    const first = bytes[at + 1] ?? 0;
    const count = first > 0x80 ? first & 0x7f : 0;
    let length = first > 0x80 ? 0 : first;
    for (let i = 0; i < count; i += 1)
      length = length * 256 + (bytes[at + 2 + i] ?? 0);
    const content = at + 2 + count;
    out.push({ start: at, content, end: content + length });
    at = content + length;
  }
  return out;
};

/** The v3 tbsCertificate fields of a fixture certificate, and its outer parts. */
const certificateParts = (certificate: Uint8Array) => {
  const [cert] = derChildren(certificate, 0, certificate.length);
  const [tbs, ...outer] = derChildren(certificate, cert!.content, cert!.end);
  return {
    fields: derChildren(certificate, tbs!.content, tbs!.end),
    outer,
  };
};

/** tbsCertificate fields a SignerInfo names: issuer Name TLV and serial content. */
const issuerAndSerial = (
  certificate: Uint8Array,
  serial?: Uint8Array,
): Uint8Array => {
  // Fixture certificates are v3 with short-form serials: walk the known layout.
  const { fields } = certificateParts(certificate);
  const serialField = fields[1]!;
  const issuer = fields[3]!;
  return tlv(
    0x30,
    certificate.subarray(issuer.start, issuer.end),
    serial ?? certificate.subarray(serialField.start, serialField.end),
  );
};

/** A Name of `count` OU attributes, each a UTF8String of `value`. */
export const organizationalUnits = (count: number, value: string): Uint8Array =>
  tlv(
    0x30,
    ...Array.from({ length: count }, () =>
      tlv(
        0x31,
        tlv(0x30, oid("2.5.4.11"), tlv(0x0c, new TextEncoder().encode(value))),
      ),
    ),
  );

/**
 * `certificate` with its subject replaced. The signature no longer matches,
 * which nothing here verifies; issuer and serial are kept so a SignerInfo
 * still names it.
 */
export const withSubject = (
  certificate: Uint8Array,
  subject: Uint8Array,
): Uint8Array => {
  const { fields, outer } = certificateParts(certificate);
  const part = ({ start, end }: DerSpan) => certificate.subarray(start, end);
  return tlv(
    0x30,
    tlv(
      0x30,
      ...fields.map((field, index) => (index === 5 ? subject : part(field))),
    ),
    ...outer.map(part),
  );
};

/** Replace a fixture serial INTEGER (the full TLV) without asserting a valid signature. */
export const withSerial = (
  certificate: Uint8Array,
  serial: Uint8Array,
): Uint8Array => {
  const { fields, outer } = certificateParts(certificate);
  const part = ({ start, end }: DerSpan) => certificate.subarray(start, end);
  return tlv(
    0x30,
    tlv(
      0x30,
      ...fields.map((field, index) => (index === 1 ? serial : part(field))),
    ),
    ...outer.map(part),
  );
};

/** Replace a fixture's issuer or extensions without asserting a valid signature. */
export const withIssuer = (
  certificate: Uint8Array,
  issuer: Uint8Array,
): Uint8Array => {
  const { fields, outer } = certificateParts(certificate);
  const part = ({ start, end }: DerSpan) => certificate.subarray(start, end);
  return tlv(
    0x30,
    tlv(
      0x30,
      ...fields.map((field, index) => (index === 3 ? issuer : part(field))),
    ),
    ...outer.map(part),
  );
};
export const withExtension = (
  certificate: Uint8Array,
  bytes: Uint8Array,
): Uint8Array => {
  const { fields, outer } = certificateParts(certificate);
  const part = ({ start, end }: DerSpan) => certificate.subarray(start, end);
  const extension = tlv(
    0xa3,
    tlv(0x30, tlv(0x30, oid("1.2.3.4"), tlv(0x04, bytes))),
  );
  return tlv(
    0x30,
    tlv(
      0x30,
      ...fields.map((field) =>
        certificate[field.start] === 0xa3 ? extension : part(field),
      ),
    ),
    ...outer.map(part),
  );
};

export interface SignerInfoSpec {
  /** Certificate whose issuer and serial the SignerInfo names. */
  readonly names: Uint8Array;
  /** Replace the required signature TLV, including omission for malformed fixtures. */
  readonly signature?: Uint8Array;
  /**
   * INTEGER content of issuerAndSerialNumber.serialNumber when it must differ
   * from the certificate named by `names`.
   */
  readonly serial?: Uint8Array;
}

export const signerInfo = ({
  names,
  signature,
  serial,
}: SignerInfoSpec): Uint8Array =>
  tlv(
    0x30,
    integer(1),
    issuerAndSerial(
      names,
      serial === undefined ? undefined : tlv(0x02, serial),
    ),
    algorithm(OID_SHA256),
    algorithm(OID_ECDSA_SHA256),
    signature ?? tlv(0x04, Uint8Array.from([1, 2, 3])),
  );

/** ContentInfo { signedData, [0] SignedData { … certificates, signerInfos } }. */
export const signedDataBlock = (options: {
  readonly certificates: readonly Uint8Array[];
  readonly signerInfos: readonly Uint8Array[];
  readonly contentType?: string;
}): Uint8Array =>
  tlv(
    0x30,
    oid(options.contentType ?? "1.2.840.113549.1.7.2"),
    tlv(
      0xa0,
      tlv(
        0x30,
        integer(1),
        tlv(0x31, algorithm(OID_SHA256)),
        tlv(0x30, oid("1.2.840.113549.1.7.1")),
        tlv(0xa0, ...options.certificates),
        tlv(0x31, ...options.signerInfos),
      ),
    ),
  );

/**
 * A v1-signed archive: each entry stored or deflated as requested. Local
 * headers defer their sizes to a data descriptor unless `dataDescriptor` is
 * false, as apksigner writes them.
 */
export const zipWith = async (
  entries: readonly {
    readonly name: string;
    readonly data: Uint8Array | string;
    readonly stored?: boolean;
  }[],
  options: { readonly dataDescriptor?: boolean } = {},
): Promise<Uint8Array> => {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    dataDescriptor: options.dataDescriptor ?? true,
  });
  for (const entry of entries)
    await writer.add(
      entry.name,
      new Uint8ArrayReader(
        typeof entry.data === "string"
          ? new TextEncoder().encode(entry.data)
          : entry.data,
      ),
      { level: entry.stored === true ? 0 : 6 },
    );
  return writer.close();
};

const u32 = (v: number): number[] => [
  v & 0xff,
  (v >> 8) & 0xff,
  (v >> 16) & 0xff,
  (v >>> 24) & 0xff,
];
const u64 = (v: number): number[] => [...u32(v), ...u32(0)];
const lp = (b: Uint8Array): Buffer =>
  Buffer.concat([Buffer.from(u32(b.length)), b]);

/** An APK Signature Scheme v2 value with one signer carrying `certificate`. */
export const v2SchemeValue = (certificate: Uint8Array): Uint8Array => {
  const digest = lp(
    Buffer.concat([Buffer.from(u32(0x0103)), lp(new Uint8Array(32))]),
  );
  const signedData = Buffer.concat([
    lp(digest),
    lp(lp(certificate)),
    lp(new Uint8Array(0)),
  ]);
  return apkSchemeValue(signedData);
};

/** Insert an APK Signing Block before the central directory of a comment-free ZIP. */
export const withSigningBlock = (
  zip: Uint8Array,
  pairs: readonly { readonly id: number; readonly value: Uint8Array }[],
): Uint8Array => {
  const bytes = Buffer.from(zip);
  const eocd = bytes.length - 22;
  if (bytes.readUInt32LE(eocd) !== 0x06054b50)
    throw new Error("fixture ZIP must end with a comment-free EOCD");
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  const framed = Buffer.concat(
    pairs.flatMap((p) => [
      Buffer.from([...u64(4 + p.value.length), ...u32(p.id)]),
      Buffer.from(p.value),
    ]),
  );
  const size = framed.length + 8 + 16;
  const block = Buffer.concat([
    Buffer.from(u64(size)),
    framed,
    Buffer.from(u64(size)),
    Buffer.from("APK Sig Block 42", "latin1"),
  ]);
  const tail = Buffer.from(bytes.subarray(cdOffset));
  tail.writeUInt32LE(cdOffset + block.length, tail.length - 22 + 16);
  return Uint8Array.from(
    Buffer.concat([bytes.subarray(0, cdOffset), block, tail]),
  );
};

export const APK_SIGNATURE_V2_ID = 0x7109871a;

export const APK_SIGNATURE_V3_ID = 0xf05368c0;
const PROOF_OF_ROTATION_ATTR_ID = 0x3ba06f8c;

/**
 * An APK Signature Scheme v3 value with one signer carrying `certificate` and,
 * when given, a proof-of-rotation lineage over `lineage` (oldest first, every
 * capability retained). Null declares an empty certificate sequence rather
 * than a certificate containing zero bytes. Node signatures are empty:
 * nothing here is verified.
 */
export const v3SchemeValue = (
  certificate: Uint8Array | null,
  lineage?: readonly Uint8Array[],
): Uint8Array => {
  const digest = lp(
    Buffer.concat([Buffer.from(u32(0x0103)), lp(new Uint8Array(32))]),
  );
  const node = (cert: Uint8Array): Buffer =>
    lp(
      Buffer.concat([
        lp(Buffer.concat([lp(cert), Buffer.from(u32(0))])),
        Buffer.from(u32(0x17)),
        Buffer.from(u32(0)),
        lp(new Uint8Array(0)),
      ]),
    );
  const attributes =
    lineage === undefined
      ? []
      : [
          lp(
            Buffer.concat([
              Buffer.from(u32(PROOF_OF_ROTATION_ATTR_ID)),
              Buffer.from(u32(1)),
              ...lineage.map(node),
            ]),
          ),
        ];
  const signedData = Buffer.concat([
    lp(digest),
    lp(certificate === null ? new Uint8Array() : lp(certificate)),
    Buffer.from(u32(28)),
    Buffer.from(u32(0x7fffffff)),
    lp(Buffer.concat(attributes)),
  ]);
  return apkSchemeValue(signedData, { min: 28, max: 0x7fffffff });
};

/** The central-directory record and local header offsets of the entry `name`. */
export const zipEntryOffsets = (
  zip: Uint8Array,
  name: string,
): { readonly central: number; readonly local: number } => {
  const bytes = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  const encoded = Buffer.from(name);
  for (
    let at = bytes.readUInt32LE(bytes.length - 22 + 16);
    bytes.readUInt32LE(at) === 0x02014b50;
    at +=
      46 +
      bytes.readUInt16LE(at + 28) +
      bytes.readUInt16LE(at + 30) +
      bytes.readUInt16LE(at + 32)
  )
    if (
      bytes.readUInt16LE(at + 28) === encoded.length &&
      bytes.subarray(at + 46, at + 46 + encoded.length).equals(encoded)
    )
      return { central: at, local: bytes.readUInt32LE(at + 42) };
  throw new Error(`fixture ZIP has no entry ${name}`);
};
