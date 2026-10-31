# Linux kernel modules

`inspect_kernel_module` / `inspect-kernel-module` reads metadata from one
selected local ELF32/ELF64 relocatable object (`.ko`) without executing it.
That metadata is the `.modinfo` key/value strings, the `__versions` symbol
CRCs, the presence of `.gnu.linkonce.this_module` and `__ksymtab*` sections,
the observed file sizes of `.init.text` and `.exit.text`, and an optional
appended signature trailer. It does not require a Linux host or the `modinfo`
program.

```bash
rea inspect-kernel-module /absolute/path/to/module.ko --json
```

The CLI resolves relative paths against the caller's working directory. MCP
requires an absolute filesystem path and preserves that exact selection:

```json
{
  "name": "inspect_kernel_module",
  "arguments": { "path": "/artifacts/demo.ko" }
}
```

## Observations

The inline Evidence result contains the artifact path, SHA-256, and byte
length. `applicability` is `applicable` only for `ET_REL`. Other ELF types are
`not_applicable`: header facts are filled and `.modinfo`, `__versions`, and
the signature trailer are not examined.

`.modinfo` entries stay in file order. Duplicate keys such as `alias` and
`parm` are preserved. Each entry keeps its key, value, file range, and
SHA-256. Values are the bytes after the first `=`. NUL padding between
strings is skipped. Keys and values use a byte-preserving Latin1 projection:
each source byte becomes the same-numbered Unicode code point. They are not
decoded as UTF-8. `raw_sha256` hashes the original entry bytes, including its
terminating NUL when present; `raw_hex` shows those bytes when they fit the
inline limit.

`__versions` entries are `struct modversion_info`: a 64-byte record whose CRC
is an `unsigned long` and whose name occupies the remaining bytes. ELF32
stores a 32-bit CRC and a 60-byte name. ELF64 stores a 64-bit unsigned long
and a 56-byte name. CRCs are zero-padded lowercase hex, 8 or 16 characters,
not a JavaScript number. The layout is reported from the ELF class even when
the section is absent. Names use the same byte-preserving Latin1 projection
as `.modinfo` keys and values. Only this classic `__versions` layout is
decoded. `versions.status: "absent"` means no `__versions` section was found
when section names were complete; it does not establish the absence of version
metadata in `__version_ext_names` and `__version_ext_crcs`, which Linux uses
with `CONFIG_EXTENDED_MODVERSIONS` and this workflow does not decode.

`.gnu.linkonce.this_module` is reported as present, absent, or unknown.
`layout` is always `unknown` because `struct module` changes with the kernel
version and is not decoded. File-backed `__ksymtab*` sections are listed in
section-header order by name and file range; their records are not decoded.
Sections that are `SHT_NOBITS` or leave the file are counted in one limitation
without their names. `.init.text` and `.exit.text` report the
observed file-backed size. A compressed payload reports the stored size and a
limitation that the decoded size is unknown.

The signature trailer is the 27-byte magic `~Module signature appended~\n`
preceded by a 12-byte `module_signature` (`algo`, `hash`, `id_type`,
`signer_len`, `key_id_len`, three pad bytes, and big-endian `sig_len`). When
those parameter fields are zero and `id_type` is PKCS#7 (`2`), the preceding
`sig_len` bytes are the PKCS#7 range and its SHA-256. The range is not parsed
and no certificate, signer, or digest-coverage claim is made. An absent
trailer is observed absence, not proof the module is unsigned.

When section names are incomplete, a missing named section is `unknown`
rather than `absent`. An empty file-backed section is present and empty.

## Limits and failures

The selected file is limited to 64 MiB by default (512 MiB maximum). At most
8192 `.modinfo` and `__versions` entries plus listed `__ksymtab*` sections are
examined by default (65536 maximum); `coverage.examined_entries` counts all
three. Exceeding that budget fails with no partial success. Keys longer
than 256 bytes and values longer than 4096 bytes stay malformed per entry;
the field that fits is still copied. A `__ksymtab*` section name longer than
256 bytes keeps its range with `name: null` and `ksymtab_name_exceeds_limit`. Inline raw hex stops at 4096 bytes and
the SHA-256 remains.

A `.modinfo` span with no trailing NUL is `unterminated_modinfo_entry` and
earlier entries are kept. A string with no `=` is `modinfo_missing_separator`.
An empty key is `modinfo_empty_key`. A `__versions` name with no NUL is
`version_name_unterminated`. A `__versions` section whose size is not a
multiple of 64 bytes is closed with `versions_size_not_multiple` and no
entries. `SHT_NOBITS` or a declared range that leaves the file is
`modinfo_section_not_file_backed` or `versions_section_not_file_backed`.
`SHF_COMPRESSED` payloads are not inflated
(`modinfo_section_compressed`, `versions_section_compressed`).

An appended magic with fewer than 12 preceding bytes is
`signature_trailer_truncated`. A `sig_len` that does not leave at least one
module byte is `signature_length_inconsistent`. Nonzero `algo`, `hash`,
signer, key-id, or pad fields for PKCS#7 are `signature_parameters_nonzero`.
A parameter block whose `id_type` is not PKCS#7 is
`signature_id_type_not_pkcs7` and is unsupported rather than a validated
signature.

gzip (`1f 8b`), xz (`fd 37 7a 58 5a 00`), and zstd (`28 b5 2f fd`) whole-file
containers are `unsupported`. The result names `external_decompression` as the
next probe and does not claim the payload is a kernel module. This is an external
step, not a REA operation: neither this tool nor `extract_artifact` decodes these
containers. Use an external gzip, xz, or zstd utility to decompress into a separate
file, then call `inspect_kernel_module` on that file to inspect the `ET_REL` image.

Malformed ELF headers return no partial kernel-module metadata. This workflow
does not execute the module or validate an appended signature.

## Format references

The record layout follows Linux v6.12's
[`modversion_info`](https://github.com/torvalds/linux/blob/v6.12/include/linux/module.h)
and [`MAX_PARAM_PREFIX_LEN`](https://github.com/torvalds/linux/blob/v6.12/include/linux/moduleparam.h).
The [Linux kbuild module versioning guide](https://docs.kernel.org/kbuild/modules.html#module-versioning)
describes the separate extended version sections.
Trailer fields and acceptance rules follow
[`module_signature`](https://github.com/torvalds/linux/blob/v6.12/include/linux/module_signature.h)
and [`mod_check_sig`](https://github.com/torvalds/linux/blob/v6.12/kernel/module_signature.c).
These references establish the decoded layout, not runtime verification.

## Real-module verification lane

Run from a built checkout with Docker available. This downloads a Debian kernel
package into a disposable container, extracts a filesystem module, decompresses
it when necessary, and inspects it with REA. It never installs or loads that
kernel module. The temporary output is outside the repository; record the
printed package version and module digest with results.

```bash
module_lane=$(mktemp -d)
docker run --rm -i -v "$module_lane:/out" debian:stable bash -se <<'CONTAINER'
apt-get update -qq
apt-get install -y --no-install-recommends xz-utils zstd ca-certificates
cd /tmp
arch=$(dpkg --print-architecture)
package=$(apt-cache depends "linux-image-$arch" | awk '/Depends: linux-image-[0-9]/{print $2; exit}')
test -n "$package"
apt-get download "$package"
dpkg-deb -f ./*.deb Package Version > /out/package.txt
dpkg-deb -x ./*.deb /tmp/kernel
module=$(find /tmp/kernel -type f -path '*/kernel/fs/*' \( -name '*.ko' -o -name '*.ko.xz' -o -name '*.ko.zst' -o -name '*.ko.gz' \) | sort | head -1)
test -n "$module"
case "$module" in
  *.xz) xz -dc "$module" > /out/module.ko ;;
  *.zst) zstd -dc "$module" > /out/module.ko ;;
  *.gz) gzip -dc "$module" > /out/module.ko ;;
  *) cp "$module" /out/module.ko ;;
esac
cat /out/package.txt
sha256sum /out/module.ko
CONTAINER
node scripts/rea.mjs inspect-kernel-module "$module_lane/module.ko" --json > "$module_lane/rea.json"
python3 - "$module_lane" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
report = json.loads((root / 'rea.json').read_text())['normalized_result']
entries = report['modinfo']['entries']
assert entries and all(entry['status'] == 'observed' for entry in entries)
keys = [entry['key'] for entry in entries]
for key in ('license', 'vermagic', 'name'):
    assert key in keys, key
print('Observed .modinfo entries:', len(entries), 'distinct keys:', len(set(keys)))
print('Artifact:', report['artifact'])
PY
```

`parm` and `parmtype` are retained separately by REA. Synthetic tests cover
their generic key/value representation and all four ELF class/byte-order
combinations. A successful real lane verifies only the selected module and
printed fields; it does not validate certificates. This lane has not run in the
sandbox used for implementation because access to the Docker socket was denied.
