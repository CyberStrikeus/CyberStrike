import { pkcs7SignedDataFixture } from "../../src/native/pe/PeCertificates.fixture.js";
import { readAsn1 } from "../../src/native/pe/PeCertificateAsn1.js";

/** One DER TLV with a minimal definite length. */
const derValue = (tag: number, ...parts: Buffer[]): Buffer => {
  const content = Buffer.concat(parts);
  const octets: number[] = [];
  for (let rest = content.length; rest > 0; rest = Math.floor(rest / 256))
    octets.unshift(rest % 256);
  const length =
    content.length < 0x80
      ? [content.length]
      : [0x80 | octets.length, ...octets];
  return Buffer.concat([Buffer.from([tag, ...length]), content]);
};

/** The fixture's SignedData with its one certificate repeated `count` times. */
export const repeatedCertificateSignedData = (count: number): Buffer => {
  const fixture = pkcs7SignedDataFixture();
  const raw = (node: { start: number; end: number } | undefined): Buffer => {
    if (node === undefined) throw new Error("Unexpected fixture layout");
    return fixture.subarray(node.start, node.end);
  };
  const [type, explicit] = readAsn1(fixture).children;
  const [version, digests, encapsulated, certificates, signers] =
    explicit?.children[0]?.children ?? [];
  const certificate = raw(certificates?.children[0]);
  return derValue(
    0x30,
    raw(type),
    derValue(
      0xa0,
      derValue(
        0x30,
        raw(version),
        raw(digests),
        raw(encapsulated),
        derValue(0xa0, ...Array.from({ length: count }, () => certificate)),
        raw(signers),
      ),
    ),
  );
};
