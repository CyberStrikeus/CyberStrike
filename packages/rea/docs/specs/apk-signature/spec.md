# Inspect APK signature schemes (v1–v3.1)

## Outcome and scope

Answer, statically, **who signed a selected local APK, under which schemes, and
whether the declared content digests match the current bytes**. This closes a gap REA's own
Android inventory documents: "ZIP inventory cannot see the APK Signing Block, so
an empty signing array does not mean the APK is unsigned"
(`src/domain/android/androidApplication.ts`).

Static format inspection within existing offline-artifact authority: no Android
code executes, no device or `adb`, no acquisition, no mutation.

## Inspection contract

- v1 (JAR) signing detected from the central directory as apksig selects it:
  `META-INF/` entries at any depth ending in `.SF` or `.RSA`/`.DSA`/`.EC`
  (case-sensitive), present only when a block has its matching `.SF`.
- Each paired v1 block's PKCS#7 `SignedData` read with bounded DER (BER
  indefinite lengths accepted): every carried certificate, and per
  `SignerInfo` the certificate it names by `issuerAndSerialNumber` or
  `subjectKeyIdentifier` plus its digest/signature algorithm OIDs (apksig
  resolves only `issuerAndSerialNumber`, so a `subjectKeyIdentifier` signer is
  reported as declared, with a limitation, and is unknown to the posture's v1
  comparison). The signer
  `certificate` goes through the same X.509 owner as v2/v3; it is `null` when
  there is not exactly one `SignerInfo` or it names no carried certificate. A
  block that cannot be read (including a local header that disagrees with
  the central directory, as apksig checks) carries
  `decode_error`, never an absent signer; so does a signer whose block,
  `.SF` or `META-INF/MANIFEST.MF` name is duplicated. Duplicate names are
  found among all central-directory entries, as apksig rejects the v1
  signature for any of them ("Duplicate entry"), and a limitation names the
  first few (JSON-quoted, cut at 256 bytes with the stored length) and counts
  the rest. Names are compared as apksig's Java UTF-8 decoding makes them, so
  malformed bytes that decode to the same string are duplicates; where Zip64
  declares more records than the classic end-of-central-directory count that
  apksig reads, duplicates only past those records are named separately. As
  apksig does, the ZIP encryption flag is
  ignored: the block is read and its decoding decides, with a limitation.
- The APK Signing Block located from the ZIP end-of-central-directory (Zip64
  followed) and framed into id-value pairs; v2, v3 and v3.1 signers decoded:
  digests by signature-algorithm id, X.509 certificate DER, v3 min/max SDK,
  additional attributes.
- Certificate identity as SHA-256 over the raw embedded DER (as apksig
  hashes it); subject, issuer, serial, ISO 8601 validity and key algorithm via
  the platform X.509 parser, each `null` when unreadable rather than guessed.
- The v3/v3.1 proof-of-rotation lineage (version 1) decoded into nodes:
  certificate and the capability flags retained by that node's certificate.
  Node signatures are not verified: the lineage is what the APK declares. A
  lineage that cannot be decoded is reported with `decode_error`.
- Source-stamp presence and the declared stamp certificate (V2 block
  preferred), or a `decode_error` when it cannot be read.
- Declared digest consistency: the v2/v3 content digest is recomputed for
  SHA-256/SHA-512 and compared with each declared digest (`matches_apk`),
  rolled up into `posture.self_consistent`. This is not a signature
  verification: an attacker who changes the bytes can recompute and replace
  the declared digest. Verity digests are not recomputed (`null`).
- A derived posture that keeps observation and declaration apart:
  `schemes_agree_on_signer` compares each block scheme's signer certificate
  _set_; `signer_change_declared_by_rotation` says whether every differing
  signer appears in a declared lineage (`null` when identity or a needed
  lineage is unknown); `v1_signers_match_block_signers` compares the v1
  signer set with what the lowest block scheme that has signers (v2, else
  v3, else v3.1) expects: its signers, or the first (original) certificate
  of a v3/v3.1 signer's declared lineage, as apksig requires; `null` when
  either side's identity is unknown, with a limitation when the lineage
  origin is the unknown side. Also `v1_only` (which cannot distinguish a v1-only APK
  from one whose v2/v3 block was removed, since `X-Android-APK-Signed` is not
  read), strongest scheme, rotation and source-stamp presence.
- Unknown is never reported as absent: a central directory that cannot be
  walked, or whose record count does not consume its declared extent, is an
  input error (v1 presence would otherwise be guessed); a signer without a
  certificate makes agreement `null`; scheme errors name the scheme and reason.

## Authority

Declared identity and digest consistency, never trust: no cryptographic signature
verification, no certificate-chain or revocation evaluation, no authenticity
claim. A full verifier would be a separate scope decision.

## Resource admission

One bounded read of the archive (512 MiB cap, no-follow, change-detected).
Every ZIP-tail and signing-block size/offset is checked against the buffer.
Signers per scheme, v1 signers and lineage nodes are capped at 32
(format-justified: one node per rotation, one v3 signer per SDK range; apksig
accepts at most 10 v1 signers); pairs and per-signer elements at 4096. Each v1
block inflates to at most 1 MiB (bounded by the inflater, not by the declared
size), and its DER is read within 32 nesting levels and 65,536 elements, with
at most 32 certificates and 32 `SignerInfo`s. The result size is projected from decoded counts before
materialisation (an upper bound), and the exact serialized size of the result and its limitations is checked against
the 8 MiB output budget (authoritative); over-budget is a capacity refusal, not
truncation. The content digest is
computed at most once per algorithm in 1 MiB chunks. Peak memory is about
2.5 times the file size (the shared stable read keeps its chunks and then
concatenates them; 1.25 GiB measured for a 500 MiB APK, about 1.3 GB at the
cap) plus bounded decoding overhead; the digest passes run synchronously (a streamed positioned-read design is
a follow-up).

## Verification

`npm run verify:apk-signature` (Android SDK `apksigner` + `aapt2`, JDK
`keytool`): builds a real minimal APK, signs default v2+v3, v1-only (RSA and
EC), v1+v2+v3 on a legacy target, a rotated lineage with and without v1, rotation carried by v3.1, a source stamp and a copy with one changed byte, and cross-checks REA against `apksigner verify`,
`apksigner lineage` and `keytool -printcert -jarfile` through CLI and MCP in Evidence parity, with the advertised
schema validated. SDK-free unit and adapter tests cover framing (including Zip64
and damaged archives), signer and lineage decoding with caps, the digest
algorithm (including a pooled-Buffer regression), set-based posture, the output
budget, and the provider's error surfaces. Independent review before handoff.

Format reference: APK Signature Scheme v2/v3 —
https://source.android.com/docs/security/features/apksigning
