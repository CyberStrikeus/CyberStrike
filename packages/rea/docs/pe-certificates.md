# PE Authenticode certificate tables

`inspect_pe_certificates` / `inspect-pe-certificates` answers whether one
selected local PE32/PE32+ image declares an `IMAGE_DIRECTORY_ENTRY_SECURITY`
table, which `WIN_CERTIFICATE` entries that table stores, and which PKCS#7
signer and X.509 fields those entries carry. It reads the file without
executing it and does not require a Windows SDK, catalog file, or disassembler.

```bash
rea inspect-pe-certificates /absolute/path/to/application.exe --json
```

The CLI resolves relative paths against the caller's working directory. MCP
and the advertised input schema require an absolute filesystem path and
preserve that exact selection:

```json
{
  "name": "inspect_pe_certificates",
  "arguments": { "path": "/artifacts/application.exe" }
}
```

## Observations

The inline Evidence result contains the artifact path, SHA-256, and byte length.
`table` is the file-offset security directory, or `null` when the directory is
absent or zero. Each `entries[]` item reports `WIN_CERTIFICATE` length,
revision, type, and the payload SHA-256.

Type-2 entries may count their zero alignment padding in `dwLength`. The PE
entry owner accepts only the exact gap to the next eight-byte boundary after
the parsed ContentInfo; extra data or nonzero counted padding fails. Entry
ranges retain all declared bytes, including counted padding. CMS payload
ranges and hashes exclude counted padding.

For `WIN_CERTIFICATE` type 2 (PKCS#7 signedData) `pkcs7` contains digest
algorithm OIDs, embedded X.509 serial/issuer/subject/validity fields, and
signer identifier facts. A signer identified by subject key identifier reports
that value as `subject_key_identifier_hex`. Other certificate types keep
`pkcs7` null.

Each signer reports `unsigned_attribute_oids`: null means the field was absent,
and an array lists the types when present. Older retained Evidence may omit the
field. Unsigned attribute contents, including nested signatures and timestamp
tokens, are not decoded; their presence makes coverage partial and adds a
limitation. Certificate and signer counts refer to the outer SignedData.

A missing table is observed absence of that directory. It is not proof the
image is unsigned in every catalog or overlay sense.

## Limits and failures

The selected file is limited to 64 MiB by default (512 MiB maximum). At most
eight `WIN_CERTIFICATE` entries are examined by default. Malformed PE headers,
truncated certificate entries, and PKCS#7 that is not structurally signedData
fail without partial success. A security directory that ends in fewer than
eight header bytes, including zeros, is a truncated `WIN_CERTIFICATE` and
fails the same way. SignedData must contain at least one `SignerInfo`, and
each `SignerInfo` must carry a non-empty signature value. Each embedded X.509
certificate must include `subjectPublicKeyInfo` and `signatureValue`. Decoded
certificate name text, serials, validity spellings, and subject key identifiers
share a 64 KiB budget per PKCS#7 payload, and each payload decodes at most
16,384 ASN.1 values. Exhausting either fixed allowance returns a nonretryable
`resource_constraint` error naming it, not an invalid-input error; this release
has no runtime override, and `max_file_bytes` and `max_entries` do not raise
it. Unsupported certificate name
encodings, including GeneralString, fail explicitly. TeletexString (T.61)
values are rendered with the ISO-8859-1 compatibility mapping used by OpenSSL;
this is not a full T.61 decoder, so the result includes a limitation whenever
that mapping is used. RFC 5280 retains TeletexString for backward compatibility
and describes its repertoire as ASCII-like Latin with additional characters.

The structural CMS reader accepts definite lengths and BER indefinite lengths
for constructed values, including the outer `ContentInfo` sequence. Primitive
values must have definite lengths. Embedded X.509 certificates and signed
attributes must also use definite length encoding, as required by their DER
profiles. This is a bounded structural subset: it does not implement every BER
string form or validate DER canonical encoding, and it does not verify
signatures.

This workflow does not verify signatures, certificate chains, timestamps, or
Authenticode digest coverage of image bytes.
