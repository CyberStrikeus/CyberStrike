const concat = (...parts: Buffer[]): Buffer => Buffer.concat(parts);

const encodeLength = (length: number): Buffer => {
  if (length < 0x80) return Buffer.from([length]);
  if (length <= 0xff) return Buffer.from([0x81, length]);
  const bytes = Buffer.alloc(3);
  bytes[0] = 0x82;
  bytes.writeUInt16BE(length, 1);
  return bytes;
};

const tlv = (tag: number, content: Buffer): Buffer =>
  concat(Buffer.from([tag]), encodeLength(content.length), content);

const seq = (...children: Buffer[]): Buffer => tlv(0x30, concat(...children));
const set = (...children: Buffer[]): Buffer => tlv(0x31, concat(...children));
const integer = (value: number | Buffer): Buffer =>
  tlv(0x02, Buffer.isBuffer(value) ? value : Buffer.from([value]));
const encodeBase128 = (value: number): number[] => {
  if (value < 0x80) return [value];
  const stack: number[] = [];
  let remaining = value;
  while (remaining > 0) {
    stack.push(remaining & 0x7f);
    remaining >>= 7;
  }
  stack.reverse();
  return stack.map((byte, index) =>
    index === stack.length - 1 ? byte : byte | 0x80,
  );
};

const oid = (parts: readonly number[]): Buffer => {
  const encoded: number[] = [40 * parts[0]! + parts[1]!];
  for (const part of parts.slice(2)) encoded.push(...encodeBase128(part));
  return tlv(0x06, Buffer.from(encoded));
};
const utf8 = (value: string): Buffer => tlv(0x0c, Buffer.from(value, "utf8"));
const utc = (value: string): Buffer => tlv(0x17, Buffer.from(value, "ascii"));
const nul = (): Buffer => tlv(0x05, Buffer.alloc(0));
const octet = (value: Buffer): Buffer => tlv(0x04, value);
const bitString = (value: Buffer): Buffer =>
  tlv(0x03, concat(Buffer.from([0]), value));
const context = (number: number, content: Buffer, constructed = true): Buffer =>
  tlv((constructed ? 0xa0 : 0x80) | number, content);

const SHA256_RSA = oid([1, 2, 840, 113549, 1, 1, 11]);
const SHA256 = oid([2, 16, 840, 1, 101, 3, 4, 2, 1]);
const RSA = oid([1, 2, 840, 113549, 1, 1, 1]);
const SIGNED_DATA = oid([1, 2, 840, 113549, 1, 7, 2]);
const DATA = oid([1, 2, 840, 113549, 1, 7, 1]);
const CN = oid([2, 5, 4, 3]);
const O = oid([2, 5, 4, 10]);

const attribute = (type: Buffer, value: Buffer): Buffer => seq(type, value);
const rdn = (...attributes: Buffer[]): Buffer => set(...attributes);
const name = (commonName: string, organization: string): Buffer =>
  seq(
    rdn(attribute(CN, utf8(commonName))),
    rdn(attribute(O, utf8(organization))),
  );

const algorithm = (identifier: Buffer): Buffer => seq(identifier, nul());

/** Hand-authored PKCS#7 signedData, independent of the production decoder. */
export const pkcs7SignedDataFixture = (
  commonName = "REA Fixture",
  organization = "REA Tests",
  signature = octet(Buffer.from("sig")),
  unsignedAttributes?: readonly (readonly number[])[],
): Buffer => {
  const serial = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const subject = name(commonName, organization);
  const tbs = seq(
    context(0, integer(2)),
    integer(serial),
    algorithm(SHA256_RSA),
    subject,
    seq(utc("250101000000Z"), utc("260101000000Z")),
    subject,
    seq(algorithm(RSA), bitString(Buffer.from("pubkey"))),
    context(
      3,
      seq(seq(oid([2, 5, 29, 14]), octet(Buffer.from([0x04, 0x01, 0xaa])))),
    ),
  );
  const certificate = seq(
    tbs,
    algorithm(SHA256_RSA),
    bitString(Buffer.from("signature")),
  );
  const signer = seq(
    integer(1),
    seq(subject, integer(serial)),
    algorithm(SHA256),
    algorithm(SHA256_RSA),
    signature,
    ...(unsignedAttributes === undefined
      ? []
      : [
          context(
            1,
            concat(
              ...unsignedAttributes.map((type) =>
                seq(oid(type), set(octet(Buffer.from([1])))),
              ),
            ),
          ),
        ]),
  );
  const signedData = seq(
    integer(1),
    set(algorithm(SHA256)),
    seq(DATA),
    context(0, certificate),
    set(signer),
  );
  return seq(SIGNED_DATA, context(0, signedData));
};

/** Same CMS fields with a BER indefinite-length outer ContentInfo SEQUENCE. */
export const pkcs7SignedDataIndefiniteEnvelopeFixture = (): Buffer => {
  const definite = pkcs7SignedDataFixture();
  const firstLength = definite[1];
  if (firstLength === undefined) throw new Error("Missing ContentInfo length");
  let contentOffset = 2;
  if ((firstLength & 0x80) !== 0) contentOffset += firstLength & 0x7f;
  if (contentOffset > definite.length)
    throw new Error("Invalid fixture ContentInfo length");
  return Buffer.concat([
    Buffer.from([0x30, 0x80]),
    definite.subarray(contentOffset),
    Buffer.from([0, 0]),
  ]);
};

/** Minimal PE32/PE32+ image with an overlay IMAGE_DIRECTORY_ENTRY_SECURITY table. */
export const peCertificateFixture = (
  plus = false,
  payload: Buffer = pkcs7SignedDataFixture(),
  type = 0x0002,
  countAlignmentInLength = false,
): Buffer => {
  const headerBytes = 0x200;
  const alignedPayload = payload;
  const entryLength = 8 + alignedPayload.length;
  const padded = align8(entryLength);
  const table = Buffer.alloc(padded);
  table.writeUInt32LE(countAlignmentInLength ? padded : entryLength, 0);
  table.writeUInt16LE(0x0200, 4);
  table.writeUInt16LE(type, 6);
  alignedPayload.copy(table, 8);
  const bytes = Buffer.alloc(headerBytes + table.length);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(0x80, 60);
  bytes.writeUInt32LE(0x4550, 0x80);
  bytes.writeUInt16LE(plus ? 0x8664 : 0x14c, 0x84);
  bytes.writeUInt16LE(1, 0x86);
  const optionalSize = plus ? 240 : 224;
  bytes.writeUInt16LE(optionalSize, 0x94);
  bytes.writeUInt16LE(plus ? 0x20b : 0x10b, 0x98);
  bytes.writeUInt32LE(headerBytes, 0x98 + 60);
  bytes.writeUInt32LE(16, 0x98 + (plus ? 108 : 92));
  const directoryAt = 0x98 + (plus ? 112 : 96) + 4 * 8;
  bytes.writeUInt32LE(headerBytes, directoryAt);
  bytes.writeUInt32LE(table.length, directoryAt + 4);
  table.copy(bytes, headerBytes);
  return bytes;
};

const align8 = (value: number): number => Math.ceil(value / 8) * 8;

/** PE image whose optional header admits no security data directory. */
export const peWithoutCertificateTableFixture = (plus = false): Buffer => {
  const bytes = Buffer.alloc(0x200);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(0x80, 60);
  bytes.writeUInt32LE(0x4550, 0x80);
  bytes.writeUInt16LE(plus ? 0x8664 : 0x14c, 0x84);
  bytes.writeUInt16LE(1, 0x86);
  const optionalSize = plus ? 240 : 224;
  bytes.writeUInt16LE(optionalSize, 0x94);
  bytes.writeUInt16LE(plus ? 0x20b : 0x10b, 0x98);
  bytes.writeUInt32LE(0x200, 0x98 + 60);
  bytes.writeUInt32LE(4, 0x98 + (plus ? 108 : 92));
  return bytes;
};
