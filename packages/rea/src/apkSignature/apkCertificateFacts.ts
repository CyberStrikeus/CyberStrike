/**
 * The one owner of certificate facts for every APK signing scheme (v1, v2,
 * v3/v3.1, lineage nodes and source stamps): identity is SHA-256 over the raw
 * embedded DER, and the readable X.509 facts come from the platform parser.
 */
import { createHash, X509Certificate } from "node:crypto";

import type { ApkSignatureResult } from "../domain/apkSignature/apkSignatureReport.js";

export type Certificate =
  ApkSignatureResult["schemes"]["v2"]["signers"][number]["certificate"];

/** SHA-256 over the raw embedded DER — exactly what apksig/apksigner hash. */
const derFingerprint = (der: Uint8Array): string =>
  createHash("sha256").update(der).digest("hex");

/** Each fact is read independently so one unsupported field does not hide the rest. */
const attempt = <T>(read: () => T): T | null => {
  try {
    return read();
  } catch {
    return null;
  }
};

/** Identity is the raw-DER fingerprint; parsed X.509 facts are null when unreadable. */
export const certificateFacts = (der: Uint8Array): NonNullable<Certificate> => {
  const cert = attempt(() => {
    // OpenSSL auto-detects PEM before DER, including PEM embedded in an extension.
    // An explicit envelope makes it decode the selected bytes; raw equality also
    // refuses trailing bytes or any other accepted but different representation.
    const pem = `-----BEGIN CERTIFICATE-----\n${Buffer.from(der).toString("base64")}\n-----END CERTIFICATE-----\n`;
    const parsed = new X509Certificate(pem);
    return parsed.raw.equals(Buffer.from(der)) ? parsed : null;
  });
  return {
    sha256_fingerprint: derFingerprint(der),
    subject: cert?.subject ?? null,
    issuer: cert?.issuer ?? null,
    serial_number: cert?.serialNumber ?? null,
    not_before: cert ? attempt(() => cert.validFromDate.toISOString()) : null,
    not_after: cert ? attempt(() => cert.validToDate.toISOString()) : null,
    public_key_algorithm: cert
      ? attempt(() => cert.publicKey.asymmetricKeyType ?? null)
      : null,
  };
};

/**
 * Serialized bytes per DER byte of a distinguished name. RFC 2253 escapes a
 * byte as `\XX` or `\"`, which JSON-escapes to 4 bytes (measured with the
 * platform parser); the serial's hex is 2 bytes per DER byte, and the
 * subject, issuer and serial are disjoint parts of the DER.
 */
const DN_EXPANSION = 4;

/**
 * Upper bound on one certificate's serialized facts, for admission before
 * materialising; the provider's exact serialized re-check stays authoritative.
 */
export const certificateBytes = (der: Uint8Array | undefined): number =>
  256 + DN_EXPANSION * (der?.length ?? 0);

/** Upper bound on a certificate summary (fingerprint and subject). */
export const certificateSummaryBytes = (der: Uint8Array): number =>
  128 + DN_EXPANSION * der.length;

/**
 * Upper bound on a serialized string: a UTF-16 unit is at most 3 UTF-8 bytes,
 * and a control character JSON-escapes to `\u00XX` (6 bytes).
 */
export const jsonStringBytes = (text: string): number => 2 + 6 * text.length;
