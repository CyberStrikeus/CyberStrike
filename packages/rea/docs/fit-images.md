# U-Boot FIT images

REA inventories U-Boot Flattened Image Tree (FIT, `.itb`) files through
`inspect-artifact` / `inspect_artifact`, and materializes the stored bytes of
each image through `extract-artifact` / `extract_artifact`. Decoding is static
and needs no external tool.

```sh
rea inspect-artifact ./boot.itb --json
rea inspect-artifact ./boot.itb --detail summary --evidence_output evidence.json --json
rea extract-artifact ./boot.itb --json
```

For MCP, open the file with `open_binary`, then call `inspect_artifact`. Summary
delivery retains the complete Evidence; use `parent_evidence_id` with
`inspect_analysis_view` to read selected images and fields. `extract_artifact`
returns a fresh `output_root` containing one raw file per image. FIT summaries
use the current projection identity; there is no pre-coverage FIT summary variant.

## Recognition

A FIT is a flattened devicetree (FDT v16 or v17) with a top-level `/images`
node. Recognition walks the structure block within the first 4 KiB of the file
only; the file name does not matter. A devicetree whose `/images` node begins
after 4 KiB, a devicetree without `/images`, and any other FDT version stay on
the plain devicetree route: `open_binary` refuses them and
[`inspect_devicetree`](devicetree.md) still parses them. A U-Boot control DTB
that contains `/images` is treated as a FIT. The container format is `fit`.

Recognition is a probe. The complete devicetree parse decides, so a file whose
prefix declares `/images` but whose structure is malformed fails as a
malformed FIT rather than falling back to plain classification.

## Images and metadata

Each child of `/images` is one inventory entry named `images/<unit-name>.bin`,
listed in devicetree order. Its bytes come from exactly one data source:

| Source          | Stored bytes                                                                            |
| --------------- | --------------------------------------------------------------------------------------- |
| `data`          | The embedded property value                                                             |
| `data-offset`   | `data-size` bytes at `data-offset` past the devicetree end, aligned to 4 (`mkimage -E`) |
| `data-position` | `data-size` bytes at `data-position` from the start of the file (`mkimage -p`)          |

`data-position` is read as U-Boot reads it: an offset from the start of the
FIT, not a machine address.

Image `format_metadata` (`fit-image`) records `index`, `name`, `description`,
`type`, `arch`, `os`, `compression`, `load` and `entry`, the `data_source`,
the raw `declared_offset` for external data, `image_data` (the shared-data
link), `cipher_present`, `cipher_algo`, `hash_algorithms`, `hashes_verified`,
`hashes_unverified`, `signature_count`, `signatures_unreadable` and
`signature_algorithms`. Algorithm lists are arrays. Nullable declaration fields
are absent unless named in `unreadable_fields`, which records parsing failures
per field. Hash or signature warnings do not make unrelated declarations unknown.
`load` and `entry` fold one or two 32-bit cells into a lowercase
`0x…` value, as U-Boot does, independent of `#address-cells`.

Root `format_metadata` (`fit`) records `fdt_version`, `fdt_totalsize`,
`external_data_base` (the aligned devicetree end), the root `description`,
`timestamp` (seconds since 1970) and `address_cells`, plus
`default_configuration` and `configurations`. A missing description or
timestamp is `null`.

Image bytes are reported as stored. Compressed images are not decompressed and
ciphered images are not decrypted: entries report `encrypted: false` and the
cipher declaration in `cipher_present` and algorithm in `cipher_algo`. A missing
or malformed algorithm stays `null`; it does not establish unciphered bytes.
Embedded `image-data` links require byte-identical stored properties; external
links require matching physical ranges.

The extracted file holds the stored bytes. Direct-analysis suggestions require
`compression: "none"` and `cipher_present: false`.

## Hashes and signatures

Hash subnodes are children whose name starts with `hash`. Inventory verifies
`crc32` (4 bytes, big-endian), `md5`, `sha1`, `sha256`, `sha384` and `sha512`
over the stored bytes, the same bytes mkimage hashed after any ciphering. All
hashes of an image are computed in one streamed pass while the inventory is
prepared, so a mismatch fails the whole inventory, naming the image, hash
node, algorithm, and the declared and computed values. A supported algorithm
whose value has the wrong length also fails.

Other algorithms such as `crc16-ccitt`, `crc8` or `sm3_256`, a hash without a
readable `algo`, and a hash without a `value` are not verified; each is
counted in `hashes_unverified` and reported as an image limitation.

Signature subnodes (names starting with `signature`) on images and
configurations retain the total declaration count, readable algorithms and
`signatures_unreadable`. Missing or malformed algorithms carry source limitations
so unknown declarations remain distinguishable from absence. Signatures are never
verified.

## Configurations

`/configurations` is optional. Each child records its `name`, `description`,
and the image references `kernel`, `firmware`, `fdt` (base plus overlays),
`ramdisk` and `loadables`, always as lists, plus its signature algorithms.
`compatible`, `fpga`, `script`, `cmdline` and `load-only` are not reported. A
reference to a name that is not an `/images` child, and a `default` that names
no configuration, are reported as limitations and kept as declared. Each
configuration carries `unresolved_reference_count`; dangling references share one
configuration-level diagnostic while every original reference remains available.

## Facts, limitations and failures

| Situation                                                                                      | Outcome                              |
| ---------------------------------------------------------------------------------------------- | ------------------------------------ |
| Malformed devicetree, truncated header, `totalsize` past the end of the file                   | Fails as malformed                   |
| No data source, more than one data source, external data without `data-size`                   | Fails as malformed                   |
| `data-offset`, `data-position` or `data-size` not one 32-bit cell, `image-data` not one string | Fails as malformed                   |
| External data outside the file, overlapping the devicetree or another image                    | Fails as malformed                   |
| Two images with an identical external range linked by `image-data`                             | Accepted as shared data              |
| A dangling, chained or mismatched `image-data` link                                            | Fails as malformed                   |
| Hash mismatch, or a supported hash value with the wrong length                                 | Fails integrity                      |
| Unsupported, algorithm-less or value-less hashes                                               | Unverified, reported as a limitation |
| Malformed `description`, `type`, `arch`, `os`, `compression`, `load`, `entry` or `timestamp`   | `null`, reported as a limitation     |
| Dangling configuration reference, missing default configuration                                | Reported as a limitation             |

Failures apply to the whole file and return no partial inventory.

## Limits

The devicetree, including any embedded image data, must be at most 16 MiB; a
larger `totalsize` fails as a memory limit. Store large images externally
(`mkimage -E`): external data of any size is streamed from the file and never
loaded into memory. A FIT may declare at most 1,024 images and 1,024
configurations, and an image at most 8 hash nodes; the devicetree parser's
node, property and depth bounds also apply. The sum of declared image sizes
is bounded by the shared archive expansion budget. These are fixed resource
bounds with no runtime override. Configurable ceilings are tracked in
[#6176](https://github.com/morluto/rea/issues/6176).

## Analyzing an image

Inventory does not execute anything, and `load` and `entry` are declarations.
After extraction:

- inspect `flat_dt` images with [`inspect_devicetree`](devicetree.md);
- open an uncompressed image with `open_binary` using format `raw-binary`, an
  architecture matching its declared `arch`, and `entry_point` set to its
  declared `load` address; raw-binary maps file offset 0 and seeds analysis at
  `entry_point`. Automatic suggestions require nonempty bytes, an admitted
  architecture/address/extent, and a declared entry that is absent or equal to
  load. Distinct or unreadable entry declarations remain in Evidence without
  a raw-loader suggestion, since this loader cannot represent separate mapping
  and analysis entry addresses.

## Comparison

Artifact comparison reports changes to an image's payload interpretation,
including load and entry declarations. Equivalent external offset forms and
inventory positions leave those declarations unchanged. Unavailable
interpretations remain unknown, while independently known changes survive.

## Verification

Synthetic fixtures with computed hashes cover embedded, `data-offset` and
`data-position` layouts, shared data, overlap and bounds failures, every
verified hash algorithm, configurations, resource limits, inventory,
extraction and reader lifecycle. CLI and stdio MCP tests exercise the same
artifact provider and advertised schemas. Real U-Boot `mkimage` 2023.01 output
has also been verified for embedded, `-E -B 0x200`, and
`-E -p 0x2000 -B 0x200` layouts, with byte-exact extraction checked against
`dumpimage`. The OpenWrt 24.10.3 ABT ASR3000 recovery FIT was checked against
`mkimage`, `fdtget` and `dumpimage`, including its kernel, initrd and devicetree.
No image was executed.

For small containers, complete delivery avoids an additional view request.
Choose summary and selected views when the omitted facts justify that extra
request; summary delivery does not reduce the underlying inventory work.
