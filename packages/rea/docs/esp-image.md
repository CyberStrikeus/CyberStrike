# ESP images

REA reads ESP32-family firmware images through `inspect-artifact` /
`inspect_artifact` and `extract-artifact` / `extract_artifact`. OTA downloads,
app partitions and second-stage bootloaders are all ESP images. Reading is
static: no esptool, device or flash access is needed, and no code is run or
disassembled.

```sh
rea inspect-artifact ./firmware.bin --json
rea inspect-artifact ./ota.bin --detail summary --evidence_output evidence.json --json
rea extract-artifact ./firmware.bin --json
```

For MCP, open the file with `open_binary`, then call `inspect_artifact`. The
summary's `root_format_metadata` holds the image facts. Use its
`parent_evidence_id` with `inspect_analysis_view` to select segment rows.
`extract_artifact` writes one file per segment and per signature block.

For agent sessions, advertise the `session,artifact,application` tool families
and consider setting both `REA_MCP_INPUT_SCHEMA_PROFILE` and
`REA_MCP_OUTPUT_SCHEMA_PROFILE` to `compact`. The output profile bounds each
advertised output schema to 4,096 bytes by relaxing nested client validation;
REA still validates complete results against the canonical contracts. Pair
this with retained summaries and selected inventory views to limit the context
needed for one question. See [MCP contracts](mcp-contracts.md) for the profiles
and their client compatibility tradeoffs.

The layout facts follow ESP-IDF v6.1 (`esp_app_format.h`, `esp_app_desc.h`,
`esp_bootloader_desc.h`, `esp_image_format.c`, the ROM `secure_boot.h`
headers and `docs/en/security/secure-boot-v2.rst`) and esptool v5.6.0
(`bin_image.py`, `cmds.py`, `loader.py`, espsecure).

## Recognition

The container format is `esp-image`. A file is an ESP image when its bytes
show all of these; the file name does not matter:

- magic `0xE9` at offset 0 and 1 to 16 segments. A count of 0 is valid but
  loads nothing, and accepting it would admit x86 programs that begin
  `E9 00`;
- a flash mode and flash speed code that ESP-IDF's enums define;
- a `hash_appended` byte of 0 or 1, as esptool requires;
- when the file holds the first segment header, a segment length that is a
  multiple of 4.

Later segments, the checksum and the digest are integrity facts. A truncated
download is still an ESP image, with its integrity reported as unavailable.

| Input                                               | Outcome                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| ESP8266 image (v1 or v3): same magic, 8-byte header | Refused: "ESP8266 firmware images are not supported…"            |
| Flash-encrypted image (ciphertext)                  | Not recognized: the bytes carry no magic. Unknown, not malformed |
| ESP8266 v2 image (magic `0xEA`)                     | Not recognized                                                   |

An ESP8266 image has its first segment header at offset 8, and that segment
loads into ESP8266 DRAM, IRAM (Arduino's eboot links at `0x4010F000`) or the
IROM flash window, where v3 and Arduino app images begin. In an ESP32-family
header the same bytes hold `wp_pin` and the drive settings, which esptool and
ESP-IDF write as `0xEE` and zeros. Inside another container, an ESP8266 image
is classified as a plain file.

Recognition cannot exclude every file that starts with an x86 near jump
(`0xE9`), such as a DOS `.com` program. An explicit `--target-format dos-com`
or `raw-binary` selection skips ESP recognition.

## Image facts

Root `format_metadata` has `kind: "esp-image"`:

| Field                     | Label    | Meaning                                                                                                          |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `header`                  | observed | Every `esp_image_header_t` field, with ESP-IDF's names, for example `entry_addr`, `chip_id`, `min_chip_rev_full` |
| `chip`                    | derived  | `target`, `isa` and the table's `source` (`ESP-IDF v6.1`) from `chip_id`; `null` for an ID the table lacks       |
| `checksum`                | derived  | `offset`, `stored`, `computed` and `status`: `valid`, `invalid` or `unavailable`                                 |
| `appended_sha256`         | derived  | The digest `hash_appended` adds: `offset`, `stored`, `computed` and `status`, including `not-appended`           |
| `image_end`               | derived  | End of the checksum block and any appended digest; `null` when the file ends before it                           |
| `signature_sector_offset` | derived  | The Secure Boot v2 signature sector, when it holds at least one valid block                                      |
| `undescribed_trailing`    | derived  | Byte ranges after the image that nothing describes; empty when every byte is described                           |
| `descriptor`              | observed | `esp_app_desc_t` or `esp_bootloader_desc_t` fields, with ESP-IDF's names, and the descriptor's file `offset`     |

The descriptor's `kind`, derived from its magic, classifies the image as an
`app` or a `bootloader`. Without a descriptor the role is unknown.

The ISA comes from `chip_id`, never from the series letter: ESP32-S31 is
RISC-V. The chip table covers every `esp_chip_id_t` in ESP-IDF v6.1:

| `chip_id` | Target    | ISA    | `chip_id` | Target     | ISA   |
| --------- | --------- | ------ | --------- | ---------- | ----- |
| `0x0000`  | `esp32`   | xtensa | `0x0012`  | `esp32p4`  | riscv |
| `0x0002`  | `esp32s2` | xtensa | `0x0014`  | `esp32c61` | riscv |
| `0x0005`  | `esp32c3` | riscv  | `0x0017`  | `esp32c5`  | riscv |
| `0x0009`  | `esp32s3` | xtensa | `0x0019`  | `esp32h21` | riscv |
| `0x000C`  | `esp32c2` | riscv  | `0x001C`  | `esp32h4`  | riscv |
| `0x000D`  | `esp32c6` | riscv  | `0x0020`  | `esp32s31` | riscv |
| `0x0010`  | `esp32h2` | riscv  |           |            |       |

Other IDs, for example esptool v5.6.0's ESP32-E22 (`0x1F`), have `chip: null`
and unclassified segments.

**Integrity.** The checksum is the XOR of every segment data byte, seeded with
`0xEF`, in the last byte of the next 16-byte block. The appended SHA-256 covers
every byte through the checksum. Both are facts, not admission rules: a
mismatch is reported with a limitation and the segments stay readable.

**Descriptors.** Both descriptors begin segment 0: ESP-IDF's bootloader reads
the app descriptor there, and esptool places the bootloader descriptor there.
Strings stop at the first NUL and are omitted, with a limitation, when they
are not valid UTF-8. The bootloader descriptor's magic is a single byte
(`0x50`), so its reserved bytes, which ESP-IDF zero-fills, must also be zero.
A `--ram-only-header` image puts RAM segments first, so its app descriptor is
not in segment 0 and its role is unknown. `mmu_page_size` keeps ESP-IDF's
name and value: the MMU page size as a base-2 logarithm, as
`esp_app_desc_t` declares it, so `16` means 64 KiB. It is `0` in images built
before ESP-IDF v5.4. `spi_flash_mode` is the next byte, which ESP-IDF v6.1
names, kept as stored and not interpreted; releases that reserve it leave it
`0`. A file can end inside the app descriptor: every field it holds in full
is kept, a field it cuts off is `null`, and `observed_length` gives the
descriptor bytes the file holds. The segment's truncation is reported as usual.

## Segments

Each header-declared segment is one entry named `segment-<index>.bin`, for
example `segment-00.bin`, so two builds pair segments by position. Its
`source_location` is the segment data in the image file. `format_metadata`
(`esp-image-segment`) records `index`, `load_addr`, `data_len`,
`header_offset` and `classification`.

`classification` follows ESP-IDF's bootloader (`should_map` and
`should_load` in `esp_image_format.c`) on a cold boot:

| Value        | Meaning                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `mapped`     | Inside the chip's IROM, DROM or, where the MMU is per memory type, PSRAM range (`soc.h`)          |
| `loaded`     | `should_load` selects it: not mapped, at or above `0x10000000`. RAM ranges are not checked        |
| `not-loaded` | Below `0x10000000`: the padding segments esptool writes at address 0, including `--secure-pad-v2` |
| `unknown`    | The chip is unknown, or the mapping depends on the bootloader's MMU page size                     |

`loaded` does not mean the bootloader accepts the segment. Before loading,
ESP-IDF's `verify_load_addresses` rejects the image when a loaded segment is
not entirely in the chip's DRAM, IRAM, RTC memory or SPM, or overlaps the
bootloader's own stack, data or loader code. For example, an ESP32-C6
segment at `0x43000000` is `loaded` here and rejected there. REA models no
RAM ranges.

Padding segments are inventoried and extractable, but are never load regions.
When waking from deep sleep, ESP-IDF also skips RTC-memory segments; that
runtime case is not modelled. ESP32-C6 and ESP32-H2 map flash from
`0x42000000` through 256 pages of the bootloader's configured MMU page size,
which no image records. The app descriptor's page size describes the app's
build, not the bootloader's. With page sizes from 8 KiB (which the hardware
supports and esptool builds for) to 64 KiB, segments from `0x42200000` to
`0x43000000` are `unknown`. Ranges follow ESP-IDF's `should_map`, not esptool's
wider placement ranges.

A segment cut short by the end of the file is the bytes the file holds, with
an entry limitation that gives the declared length.

Artifact comparison uses each segment's `load_addr` and `data_len` as its
declaration, so a segment that moves with unchanged bytes is `changed` in
`metadata`. Segments pair by index: inserting or removing one shifts the
paths of the segments after it. Header offsets and `classification` are not
compared; the image's own change covers the header and chip. The image's and
the signature blocks' `format_metadata` carry no declaration: their fields
come from their own bytes, which content comparison covers, and a block's
`image_digest_matches` follows the image's content.

## Secure Boot v2 signatures

A signature sector starts at the next 4 KiB boundary after the image and
holds up to three 1216-byte slots. A slot holds a block when it has the `0xE7`
magic and a matching CRC32 at offset 1196, the rule ESP-IDF and espsecure
apply. Each slot is examined independently, so an erased or damaged slot does
not hide a later block. Each block is an entry, `signature-block-<slot>.bin`,
with `esp-image-signature-block` metadata:

| Field                              | Meaning                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `index`, `version`, `scheme`       | Slot 0 to 2, version byte, and `rsa` (`0x02`) or `ecdsa` (`0x03`)         |
| `sha_version`, `curve_id`          | For ECDSA, the third byte (0 is SHA-256, 1 SHA-384) and the curve ID byte |
| `digest_algorithm`, `image_digest` | The digest the block records                                              |
| `image_digest_matches`             | Whether it equals the digest of every byte before the sector              |
| `public_key_sha256`                | SHA-256 of the block's public key, the value eFuse key digests hold       |
| `signature_status`                 | Always `unverified`                                                       |

Signatures are observed, not verified: REA checks no public key, signature or
eFuse. `public_key_sha256` is the digest espsecure `signature-info-v2`
prints, so it can be compared with `espefuse summary`. An unknown version or
`sha_version` leaves the layout-dependent fields `null`. A slot with the magic
but no matching CRC32 is not a block: it is reported in a limitation, whether
or not another slot holds a block, and its bytes are undescribed. Secure Boot
v1 signatures are not decoded.

## Coverage and limitations

Bytes after the image are described when they are erased flash (`0xFF`) or a
signature sector's blocks; erased slots and slack in that sector count as
erased flash. Every other byte is in `undescribed_trailing`.

| Situation                                                              | Outcome                                                                                                    |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Segment data or a segment header beyond the end of the file            | Truncation limitation; checksum and SHA-256 `unavailable`; coverage `unknown`                              |
| File ends before the checksum or the appended digest                   | That status is `unavailable`, with a limitation; coverage `unknown`, since a signature sector could follow |
| Checksum or SHA-256 mismatch                                           | `invalid`, with a limitation; coverage is unchanged                                                        |
| Erased flash after the image that runs past the three slots            | Described; no limitation                                                                                   |
| Erased flash that ends before the three slots are complete             | Limitation; coverage `unknown`, since a signed image cut there would have lost its sector                  |
| A signature sector the file cuts short                                 | Limitation; coverage `unknown`                                                                             |
| Any other bytes after the image                                        | Ranges in `undescribed_trailing`, a limitation, and coverage `unknown`                                     |
| Segment length that is not a multiple of 4                             | Limitation: ESP-IDF rejects such an image                                                                  |
| Segment of 16 MiB or more, except on chips with 32-bit cache addresses | Limitation: ESP-IDF rejects such an image                                                                  |

ESP32-S3, ESP32-P4, ESP32-C5, ESP32-C61, ESP32-H4 and ESP32-S31 map flash
through 32-bit cache addresses (`SOC_SPI_MEM_SUPPORT_CACHE_32BIT_ADDR_MAP`), so
ESP-IDF sets no 16 MiB segment limit for them. For an unknown chip the limit
is not applied.

Undescribed bytes include other flash contents such as an app partition's
stale data, a Secure Boot v1 signature, and the flash segments that esptool
`--ram-only-header` writes after the checksum without counting them. REA
reports their ranges and does not guess their structure. In the padding, in a
sector without a valid block, in the sector's slack and after the sector, the
first byte that is not erased starts a range to the end of that region. A
slot that is neither a block nor erased is reported whole. Adjacent ranges
are merged.

A whole-flash dump whose partition table REA finds is read as an
[ESP flash image](esp-flash-image.md). Without one, a dump of a chip whose
bootloader is at offset 0, such as ESP32-C3 or ESP32-S3, is recognized as that
bootloader image, and the partition table, apps and data follow as
undescribed bytes.

A dump read from a later flash address, such as an ESP32 dump read from
`0x1000` with `read-flash 0x1000 …` or `merge-bin --target-offset 0x1000`,
opens as its bootloader image. REA says so when the file shows it: the image
at file offset 0 is not an app, its chip's ROM loads the bootloader from a
later address (`0x1000` for ESP32 and S2, `0x2000` for C5, H4, P4 and S31),
and a partition table sits where that origin puts `0x8000` (file offset
`0x7000` for `0x1000`), after the image ends. Then `flash_dump` records
`flash_offset` and
`table_file_offset`, a limitation says to reopen the file with
`format: "esp-flash-image"` and that `flash_offset`, and `inspect_artifact`
lists the same `open_binary` call as a next probe. `flash_dump` is null for
every other image. Evidence that REA recorded before it reported the field
omits it; REA still reads and compares such Evidence, and the omission says
nothing about where the file was read from.

## Limits

An image has at most 16 segments and 3 signature blocks. Decoding reads each
byte once and retains only fixed-size fields. It reads through erased flash to
find the first byte that is not erased, and stops there. There is no
file-size limit.

## Analyzing a segment

Inventory does not disassemble code or build a memory map. `open_binary`
admits neither RISC-V nor Xtensa as a raw-binary architecture, so a segment
cannot yet be opened as a raw image. Each segment's `source_location` and
`load_addr` give the file offset and address to map it at by hand, for
example with the Rizin tool's `om` command.

## Verification

Synthetic fixtures with computed checksums, digests and CRCs cover
recognition, ESP8266 layouts, the ESP32, ESP32-C3, ESP32-C6 and ESP32-P4
memory maps, truncation at each structure, integrity mismatches, erased and
undescribed trailing bytes, signature slots including damaged and unknown
layouts, and the refusals. CLI and stdio MCP tests exercise the same artifact
provider and advertised schemas.

The optional real lane builds ELF files from source, converts them with
esptool and compares REA's facts with `esptool image-info`:

```sh
REA_RISCV_CLANG=/path/to/clang REA_RISCV_LLD=/path/to/ld.lld \
REA_ESPTOOL_PYTHON=/path/to/python-with-esptool \
  npm run verify:esp-images
```

It needs a Clang with the RISC-V target, `ld.lld` and a Python that can run
`esptool` and `espsecure`. It checks each tool before building anything and
names the variable to set when one is missing, and it warns when esptool is
not v5.6.0, the version whose sources the layout facts cite. It builds an
ESP32-C3 app, the same app with `--dont-append-digest`, `--secure-pad-v2`,
`--ram-only-header` and `--pad-to-size`, a bootloader, and ESP8266 v1 and v3
images. It then checks:

- entry point, chip ID, each segment's length, address and header offset,
  checksum, digest and descriptor fields against `image-info`;
- each segment's classification in the app, its variants and the
  bootloader, whose linker scripts fix every section's region, including the
  `not-loaded` padding that `--secure-pad-v2` adds;
- after signing with RSA-3072 and appending ECDSA P-256 and P-384 blocks,
  each block's `public_key_sha256` against espsecure `signature-info-v2`,
  and that its recorded digest matches;
- extraction of the app and the signed image: each segment file equals the
  bytes after esptool's segment header offset, each signature block equals
  its slot in the sector espsecure appended, and the source's SHA-256 is
  unchanged and equals the reported `root_sha256`;
- the `--pad-to-size` erased tail is described; the `--ram-only-header`
  flash segments are undescribed;
- a flipped checksum, a flipped digest byte, a truncated segment (where
  `image-info` stops with "End of file reading segment"), and both ESP8266
  refusals.

`REA_XTENSA_ESP32_GCC` adds an ESP32 (Xtensa) app built with Espressif's
`xtensa-esp32-elf-gcc`. Without it the report marks that image as skipped.

Each command runs as a process tree owned by the shared verifier command
owner, so a timeout also stops the linker or assembler a compiler driver
starts. The lane removes its workspace only after every tree has stopped and
keeps it when that cleanup cannot be confirmed.

The lane ran on macOS arm64 with Node 24.22.1, Homebrew Clang and LLD 21.1.8,
and `xtensa-esp32-elf-gcc` 14.2.0 (crosstool-NG esp-14.2.0_20251107), once
with esptool and espsecure v5.6.0 and once with 4.12.0. All checks passed for
all 13 images in both runs. With v5.6.0 the complete run, including the builds
and every esptool call, took 21.7 s elapsed, 16.9 s user CPU and 6.1 s system
CPU under `/usr/bin/time -l` with warm caches. The largest single process
peaked at a 253 MiB resident set; the combined peak of all processes was not
measured.

The lane does not establish:

- the other chips: only ESP32-C3 (RISC-V) and ESP32 (Xtensa) images come
  from a real producer; the other rows of the chip table are checked against
  the ESP-IDF v6.1 headers by reading them;
- images from a real ESP-IDF project build, an OTA download or a device's
  flash, none of which it inspects;
- that a signature is valid: it compares digests, and nothing verifies a
  signature.

It does not run in CI.
