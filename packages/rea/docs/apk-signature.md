# APK signature schemes

REA reads the signing of a selected local Android APK (or ZIP/AAB) statically,
so an analyst can answer **who signed this, under which schemes, and whether the
declared content digests match these bytes** before trusting or triaging it. The reader
is in-process and needs no external engine: it parses the ZIP tail and the APK
Signing Block, reads certificates with the platform X.509 parser, and
recomputes the content digest. No Android code executes, and no device or
`adb` is involved.

CLI and MCP share one workflow and return artifact-bound Evidence inline.

```sh
rea inspect-apk-signature /path/app.apk
```

## Selected facts and retained Evidence

MCP defaults to a summary with scheme presence, signer certificate fingerprints,
row counts, posture and explicit coverage. `detail: "complete"` returns the full
report. A selected page can answer a narrower question in the acquisition call:

```json
{
  "path": "/path/app.apk",
  "view": {
    "collection": "signers",
    "schemes": ["v3"],
    "fields": ["certificate_sha256"],
    "limit": 32
  }
}
```

The returned `parent_evidence_id` identifies the retained complete report.
Subsequent reads use `inspect_analysis_view`, including after the APK is deleted:

```json
{
  "source": {
    "kind": "retained-evidence",
    "evidence_id": "<returned parent_evidence_id>"
  },
  "view": {
    "kind": "apk-signature",
    "collection": "digests",
    "signer_ids": ["<returned signer id>"],
    "fields": ["signature_algorithm_id", "algorithm", "matches_apk"],
    "offset": 0,
    "limit": 32
  }
}
```

Collections are `signers`, `digests` and declared `lineage` nodes. `ids`,
`signer_ids` and `schemes` filters intersect; omitted filters select all available
records and `[]` selects none. Omitted `fields` returns every collection column;
`fields: []` retains identity and relationship links. IDs include the complete
APK digest, scheme and source ordinal; child records retain `signer_id` and
`signer_index`, and declared certificates retain their raw-DER SHA-256 identity.
Lineage pages expose `previous_id` when selected. Certificate fingerprints can
be composed across versions without treating a declaration as verified identity.

Page coverage describes examined declared records. Exhausting a page does not
establish certificate authenticity, platform acceptance, v1 entry coverage or a
verified rotation. Partial decoding and its reason remain visible even when a
lineage page contains no rows. A weak cache reuses validated immutable report
facts; each read checks its parent subject, and new file inspections read again.

CLI defaults to complete delivery. A compact one-shot response requires a complete
Evidence export:

```sh
rea inspect-apk-signature /path/app.apk --detail summary \
  --view '{"collection":"signers","fields":["certificate_sha256"]}' \
  --evidence_output /path/app-signing-evidence.json --json
```

The export contains the same complete parent used by MCP. Historical CLI pages
use `inspect-analysis-view` with an `evidence-file` source record. The CLI and MCP
share the application workflow, projection, retention and publication owners.

## What it reports

- **Schemes present:** v1 (JAR signing, from the central directory), and the
  APK Signing Block's v2, v3 and v3.1. v1 follows apksig's selection: entries
  under `META-INF/` at any depth ending in `.SF`, or in `.RSA`/`.DSA`/`.EC`
  (case-sensitive). v1 is `present` only when a signature block has its
  matching `.SF` file (`META-INF/x/CERT.RSA` pairs with `META-INF/x/CERT.SF`);
  `signature_files` and `block_files` list every candidate either way.
- **Per v1 signer** (each block paired with its `.SF`): REA inflates the block
  and reads its PKCS#7 `SignedData`. `certificate` is the certificate the
  block's one `SignerInfo` names by `issuerAndSerialNumber` or
  `subjectKeyIdentifier` (not by position), with the same facts and raw-DER
  SHA-256 as a v2/v3 signer, so a v1-only APK can be fingerprinted and
  clustered with v2/v3-signed ones. apksig resolves only
  `issuerAndSerialNumber`, so its v1 verification fails for a block whose
  `SignerInfo` uses `subjectKeyIdentifier`: REA still reports the declared
  certificate (`identified_by: subject-key-identifier`), adds a limitation,
  and treats that signer as unknown in `v1_signers_match_block_signers`. `certificates` lists every certificate the
  block carries (SHA-256 and subject) and `signer_infos` gives each
  `SignerInfo`'s certificate and digest/signature algorithm OIDs. The PKCS#7
  `SignedData` envelope is read as BER, including constructed signature OCTET
  STRINGs; each embedded certificate is still interpreted as DER by the X.509
  owner. Issuer matching preserves the encoded Name and also admits equivalent
  ASCII PrintableString/UTF8String values for CN, C, L, ST, O and OU: case and
  repeated/edge spaces are normalized, RDN sequence order is preserved, and
  attribute order inside one multivalued RDN is ignored. Other name forms
  require exact encoded identity; semantic equivalence remains unestablished.
  `certificate` is `null` when the block has more than one `SignerInfo` (with
  nothing verified there is no single signer) or names a certificate it does
  not carry. A block that cannot be read (malformed ASN.1, an unsupported
  compression method, Zip64 sizes, a local header that disagrees with the
  central directory on the name, data-descriptor flag, CRC-32 or a size, as
  apksig refuses it, or over a bound) keeps its names and carries
  `decode_error`; it is never reported as an absent signer. apksig ignores
  the ZIP encryption flag (bit 0), so a block that sets it is read as stored:
  the PKCS#7 decoding decides (bytes that really are encrypted fail to
  decode), and a limitation names the block.
  apksig rejects the v1 signature of an archive whose central directory
  holds any name more than once ("Duplicate entry"). REA checks every entry:
  a limitation names the first few duplicates (JSON-quoted; a name over 256
  bytes is cut there and its stored length given) and counts the rest, and a
  signer whose block, `.SF` or `META-INF/MANIFEST.MF` name is duplicated
  (one signer per block name) carries `decode_error`
  `duplicate entry: <name>`, so a duplicated manifest marks every signer.
  A duplicate outside those names leaves the signers as declared.
  Names are compared as apksig compares them, as Java strings decoded from
  UTF-8: malformed bytes become U+FFFD, so `dup\xff` and `dup\xfe` are one
  name (apksigner: `Duplicate entry: dup�`). REA reproduces Java's
  replacement rather than WHATWG `TextDecoder`'s; the two differ for encoded
  surrogates (`ED A0..BF`), which Java replaces as one unit. This was checked
  against OpenJDK 25's `new String(bytes, UTF_8)` on about 300,000 malformed
  and well-formed sequences, including a leading byte-order mark, which Java
  keeps; other Java runtimes are not checked. The same
  decoding names v1 entries and compares a local header's name with the
  central directory's; as in apksig, a local name longer in bytes than the
  directory's is refused before decoding. apksig takes the record count from the classic
  end-of-central-directory record's 16-bit field and ignores a Zip64 count,
  so it reads only the first 65,535 records of a larger directory: the
  limitation then says so, counts as duplicates for apksig only names whose
  second copy lies within those records, and names separately those
  duplicated only past them. REA still reads v1 signing entries, and flags
  duplicated signing names, from every record, so past record 65,535 it
  reports signers apksig would not see.
  Bytes after the block's `ContentInfo` are ignored, as apksig's BER parser
  ignores them, and a limitation names the block and their count.
- **Per signer:** the certificate's **SHA-256 fingerprint over the raw embedded
  DER** (the same value `apksigner --print-certs` prints), plus subject, issuer,
  serial, ISO 8601 validity and public-key algorithm when the X.509 parser can
  read the exact carried DER (each is `null` otherwise). The parser's returned
  DER must equal those bytes before readable facts are combined with their
  fingerprint; embedded PEM text and trailing data cannot select a different
  certificate. Raw signature algorithm IDs, declared
  digest hex and digest algorithms, signature lengths and public-key length; and for
  v3/v3.1 the signer's declared min/max SDK.
- **Key rotation (v3/v3.1):** the declared proof-of-rotation lineage, oldest
  first. Each node carries its certificate and the capability flags **retained
  by that node's own certificate** after rotation (installed data, shared UID,
  permission, rollback, auth). A lineage attribute that cannot be decoded is
  reported with `decode_error`, never silently emptied.
- **Source stamp:** whether a source-stamp block is present and the stamp
  certificate it declares (the V2 stamp block is preferred over V1, as apksig
  does). `certificate` is `null` when no stamp is present, or when the block
  could not be decoded and `decode_error` says why. Stamp signatures are not
  verified.
- **Declared digest consistency:** for SHA-256/SHA-512 digests, REA recomputes
  the v2/v3 content digest and reports `matches_apk` per digest and
  `posture.self_consistent`. This only shows that the **declared** digest
  equals the digest of the current bytes. It is **not a signature
  verification**: anyone who changes the bytes can recompute the digest and
  write it into the signed data, and REA still reports `true` while
  `apksigner verify` rejects the APK. A changed byte with an unchanged
  declared digest reads `false`.
- **Posture** (derived from the facts above):
  - `v1_only`: v1 is present and no v2/v3/v3.1 block is. The v1
    `X-Android-APK-Signed` marker is not read, so this cannot distinguish an
    APK signed only with v1 from one whose v2/v3 block was removed.
  - `schemes_agree_on_signer` (observed): every present block scheme presents
    the same _set_ of signer certificates. An extra signer in one scheme is
    disagreement; a signer without a certificate makes it `null` (unknown).
    A single present block scheme with known signers agrees with itself;
    v1 is compared separately below.
  - `signer_change_declared_by_rotation` (declared): the signers differ, but
    each appears in a lineage the APK declares. Read the two together: block
    schemes with different signers covered by a declared lineage show `false`
    / `true`; differing signers without such a lineage show `false` / `false`.
    A lineage alone does not establish a change between block schemes. It is
    `null` when a signer's identity is unknown, or when the signers differ and
    a declared lineage could not be decoded.
  - `v1_signers_match_block_signers` (observed): the v1 signer certificates
    equal what the lowest block scheme that has signers (v2, else v3, else
    v3.1) expects v1 to carry. That is its signer set, except that a v3/v3.1
    signer declaring a rotation lineage expects the lineage's first
    (original) certificate, as apksig requires. `false` is notable: the JAR
    signature names a different key than the block signature. When v1 uses
    the lineage's original key and v3 its newer key, this comparison reads
    `true`. If v3 is the only present block scheme, agreement is `true` and
    declared inter-block signer change is `false` even though rotation is
    present. If v2 also uses the original key, agreement is `false` and the
    declared inter-block change is `true`. `null` when
    v1 or a populated block scheme is absent, any signer's identity is unknown (a
    `decode_error`, a `null` certificate or a `subjectKeyIdentifier`
    `SignerInfo`), or the lineage's original certificate cannot be
    identified. When identities or a lineage origin are unknown, limitations
    explain why; absence is shown in the scheme records.
  - `strongest_scheme`, `rotation_present`, `source_stamp_present`,
    `self_consistent`.

## What it does not claim

This is **declared identity and digest consistency, not trust**. No signature
is cryptographically verified (including the v1 PKCS#7 signature and the
`.SF`/`MANIFEST.MF` digests, so a v1 signer is reported even where `keytool`
or `apksigner` reject the archive), certificate chains and revocation are not
evaluated, and nothing here says an app is authentic. `self_consistent: true`
means the declared digest equals the digest of the current bytes; it is not a
signature verification, and it does not prove who made the bytes. Rotation-lineage node signatures are not verified either, so a lineage is
what the APK _declares_: an attacker who re-signs an APK can declare any
lineage, which is why `signer_change_declared_by_rotation` is kept apart from
the observed agreement. SHA-256 identifies exact bytes, not authenticity.

Not yet read: v4 `.apk.idsig` (a sibling file), verity (`0x0421`/`0x0423`/`0x0425`) digests (reported with
`matches_apk: null`), and the v1 `X-Android-APK-Signed` marker.

## Bounds and errors

The archive is read once, bounded at 512 MiB, without following symlinks and
with change detection. ZIP tail offsets, the central-directory size and signing
block spans used by the reader are checked against their containing sections,
including the complete central-directory extent before ZIP end records. A process-wide queue permits
one active whole-file inspection and eight pending scans across provider
instances; pending scans retain no APK bytes and can be cancelled with their
original reason. Further requests receive a capacity error. The active slot
is held through parsing and cleanup. Signers per scheme, v1 signers and
lineage nodes are capped at 32 each as resource admission limits, not format
maxima (apksig separately accepts at most 10 v1 signers). Each v1 block is
inflated to at most 1 MiB, and its BER is read within 32 levels of nesting and
65,536 elements, with at most 32 certificates and 32 `SignerInfo`s; BER
indefinite lengths and constructed OCTET STRING fields are accepted. Embedded
X.509 certificates retain their DER requirement. The report's size is
bounded from above by those counts before anything is materialised, and the exact
serialized size of the report together with its limitations (which repeat
archive names) is then checked against an 8 MiB output budget (the exact check
is authoritative); an over-budget report is refused, not truncated.

Signing blocks admit at most 4096 ID/value pairs; at most 4096 signing-relevant
META-INF entries are retained. These fixed counts, signer/lineage counts and the
report byte budget return nonretryable `resource_constraint` errors naming the
effective allowance. This release has no runtime override for them. Waiting for
an active scan cannot raise a fixed count, and complete CLI JSON cannot raise the
report budget. Occupied scan-queue capacity remains retryable after a scan finishes.

The whole-file reader allocates the selected snapshot and bounded read scratch;
total process memory exceeds the selected file's size. It also computes the complete
file SHA-256, so inspection is not header-only. Content digests are recomputed
at most once per SHA-256/SHA-512 algorithm during one inspection. Input,
inflation, decoded-record and serialized-output bounds keep work finite;
resource refusals are distinct from malformed format errors.

If the stable read completes but closing its descriptor fails or is cancelled,
the error retains `details.partial_observation` with the selected path, complete
file SHA-256 and byte count. These facts describe the acquired file; they do not
establish any decoded signing facts. Failed cleanup remains visible until the
provider releases the descriptor on a cleanup retry.

A file that is not a ZIP is refused as an unsupported target. A damaged ZIP
(local headers but no end-of-central-directory), a central directory that
cannot be walked or whose declared record count does not account for all of
its bytes, or a malformed signing block or signer is an input error naming the
offset or scheme and reason. Zip64 tail damage includes a missing required
locator, an impossible locator disk/count pair, a fixed end record that does
not fit before its locator, or an incorrect end-record signature. These are
input errors, not evidence of an unsupported format. Coherent multi-disk
locator metadata and 64-bit offsets/counts/sizes beyond the reader's safe
integer range remain unsupported. The locator offset is disk-relative, so
multi-disk metadata is checked before applying local file bounds. This follows
the record fields in [PKWARE APPNOTE 6.3.10, sections 4.3.14–4.3.15](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT);
it does not establish full validation of Zip64 versions or extensible data.
Signer framing includes signature records, the public-key field and matching
signed/outer v3 SDK ranges. Suffix bytes beyond known
fields are counted as uninterpreted, as Android readers may ignore extensions;
their presence does not establish malformed signing.
When the central directory is not immediately followed by
the end-of-central-directory record (a declared-size mismatch or a Zip64
record), the content digest is not recomputed and a limitation says so. A
rotation attribute that cannot be decoded still counts as `rotation_present`
(the attribute exists) and carries its `decode_error`.

Verified by the `verify:apk-signature` real lane. It builds a real minimal APK
with `aapt2`, signs it with the SDK's `apksigner` (default v2+v3, v1-only with
RSA and EC keys, v1+v2+v3 on a legacy target, a rotated key lineage with and
without v1, rotation carried by v3.1, a source stamp, and a copy
with one changed byte), and cross-checks REA against
`apksigner verify --print-certs`, `apksigner lineage --print-certs` and
`keytool -printcert -jarfile` through the CLI and MCP.

The real-toolchain CI lane uses pinned, checksum-verified Build Tools 36.1.0
and platform 36 oracle files in its job workspace. It requires the existing
host JDK and runs `npm run verify:apk-signature -- --require-tools`; absent
oracles fail rather than silently establishing provider coverage. REA itself
requires none of these external tools.
