import { createHash, X509Certificate } from "node:crypto";
import { expect, it } from "vitest";
import {
  LEAF_CERTIFICATE,
  LEAF_SUBJECT,
  ROOT_CERTIFICATE,
  withExtension,
} from "../../tests/fixtures/apkSignature/v1SignatureBlock.js";
import { certificateFacts } from "./apkCertificateFacts.js";

it("binds readable certificate fields to the exact carried DER despite embedded PEM", () => {
  const pem = `-----BEGIN CERTIFICATE-----\n${Buffer.from(ROOT_CERTIFICATE).toString("base64")}\n-----END CERTIFICATE-----\n`;
  for (const payload of [Buffer.from("ordinary extension"), Buffer.from(pem)]) {
    const outer = withExtension(LEAF_CERTIFICATE, payload);
    const facts = certificateFacts(outer);
    expect(facts.subject).toBe(LEAF_SUBJECT);
    expect(facts.sha256_fingerprint).toBe(
      createHash("sha256").update(outer).digest("hex"),
    );
    expect(
      Buffer.compare(
        new X509Certificate(
          `-----BEGIN CERTIFICATE-----\n${Buffer.from(outer).toString("base64")}\n-----END CERTIFICATE-----\n`,
        ).raw,
        Buffer.from(outer),
      ),
    ).toBe(0);
  }
});
it.each([
  Buffer.from("malformed certificate"),
  Buffer.concat([LEAF_CERTIFICATE, Buffer.from([0])]),
])("retains the original fingerprint when exact DER is unreadable", (bytes) => {
  expect(certificateFacts(bytes)).toEqual({
    sha256_fingerprint: createHash("sha256").update(bytes).digest("hex"),
    subject: null,
    issuer: null,
    serial_number: null,
    not_before: null,
    not_after: null,
    public_key_algorithm: null,
  });
});
