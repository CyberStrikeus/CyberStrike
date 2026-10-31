# ESP flash images

REA reads a dump of an ESP32-family SPI flash, such as the output of
`esptool read-flash 0 ALL dump.bin` or `esptool merge-bin`, through
`inspect_artifact` and `extract_artifact`. The reader is static: no device,
esptool or ESP-IDF is needed, and no code is run.

The container format is `esp-flash-image`. Entries are the bootloader region,
the partition table sector and one file per partition. The bootloader and
each app partition are also decoded as [ESP images](esp-image.md), so their
headers, segments, integrity and descriptors appear in the root
`format_metadata`. Layout facts are cited to ESP-IDF v6.1
(`esp_flash_partitions.h`, `flash_partitions.c`, `gen_esp32part.py`,
`bootloader_common_loader.c`, `bootloader_utility.c` and each chip's
`esp_rom_caps.h`).

## Recognition

A file is a flash image when REA finds a partition table in the entry
structure ESP-IDF's bootloader verifies (`esp_partition_table_verify`):
32-byte `0x50AA` entries, at most one `0xEBEB` MD5 entry over the entries
before it, and a terminating entry within `0xC00` bytes. ESP-IDF accepts a
table with no partition entries, but REA requires one, so that neither
erased flash nor a lone MD5 entry is read as a table. A table whose MD5 does not match, or that has a second MD5 entry, is
still read, with `md5.status` `invalid` and a limitation, because the
bootloader would refuse it. The table is located in this order:

1. at the caller's `partition_table_offset`, when given; no scan follows;
2. at the default `0x8000`;
3. by scanning every `0x1000`-aligned flash sector for a table whose MD5
   verifies. This location is derived, and the inventory says so.

A table never lies inside the located bootloader image, so the default
offset and the scan are tried only after the image's last segment. Without
a caller selection, the scan runs only when an ESP image sits at a ROM
bootloader offset, and a single app or bootloader image ends at its last
segment, so neither ordinary files nor single images are scanned. A C3 or
S3 dump begins with its bootloader, so flash layouts are detected before a
file is read as one ESP image.

Unless the caller names the table with `partition_table_offset`, REA
refuses two kinds of dump before looking for a table:

- an image of a known chip at another chip's ROM offset, such as an ESP32
  bootloader at the start of a dump read from `0x1000`. The dump's origin
  is not the flash address REA assumed, given or default, and a table found
  there would place every partition at the wrong file offset; pass the
  `flash_offset` where the dump starts. When a partition table sits where
  the image's own ROM offset puts `0x8000`, after the image's segments, the
  refusal names that offset.
  Without a selected format such a dump opens as its bootloader image, whose
  [ESP image](esp-image.md) facts say how to reopen it.
- an ESP8266 image at a ROM offset. ESP8266 dumps can hold the same table
  format, and they keep the [ESP image](esp-image.md) reader's ESP8266
  refusal.

When no table is found the layout is not recognized. This is an unknown
outcome, not a malformed file: flash encryption, which encrypts the
bootloader and the table, is one cause. When a table is found without a
located bootloader and `flash_offset` is omitted, a limitation says that
each partition's file offset assumes the dump starts at flash `0x0`.

## Caller inputs

| Input                     | Meaning                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `format: esp-flash-image` | Read the file as a flash dump; with no table found, refuse it                 |
| `flash_offset`            | Flash address (`0x…`) of the dump's first byte; default 0                     |
| `partition_table_offset`  | Flash address (`0x…`, a multiple of `0x1000`) of the table; disables the scan |

MCP takes these on `open_binary`; the CLI takes `--target-format
esp-flash-image`, `--flash-offset` and `--partition-table-offset` on
`inspect-artifact` and `extract-artifact`. The offsets require the format, and
the format takes no `architecture` or `entry_point`. The inputs are part of
the target's identity, so reopening the same bytes with other inputs reads
them again instead of reusing the earlier reading. The `open_binary` summary
reports them as `flash_offset` and `partition_table_offset`, null when
omitted.

## Layout facts

The root `format_metadata` (`esp-flash-image`) records:

- `flash_offset`: its `value` and whether the `caller` gave it or it is the
  `default`;
- `chip`: from the bootloader's `chip_id`, or null without a located
  bootloader;
- `bootloader`: the region from the chip's ROM bootloader offset to the
  table, with its ESP image facts;
- `partition_table`: its flash address, the `method` that found it
  (`default`, `caller` or `scan`), the partition count and the MD5 `status`
  (`valid`, `invalid` or `absent`) with the stored and computed digests;
- `apps`: ESP image facts for each app partition the dump holds; app
  partitions declared over the same bytes share one decode;
- `otadata`: the otadata partition's records, or null without one;
- `boot_selection`: the app the bootloader would select, for every table;
- `partitions_outside_dump`: declared partitions that begin before the
  dump's first byte, which have no entry;
- `undescribed`: ranges outside every region, each from a byte that is not
  erased flash to the end of its gap.

The ROM loads the bootloader from `ESP_ROM_BOOTLOADER_OFFSET_FLASH`:
`0x1000` for ESP32 and ESP32-S2; `0x0` for ESP32-S3, C2, C3, C6, C61, H2 and
H21; and `0x2000` for ESP32-C5, H4, P4 and S31. A bootloader is located only
where its own `chip_id` says the ROM loads it.

### Partitions

Each partition entry is `partitions/<label>.bin` when the label is a safe
name of up to 16 letters, digits, `.`, `_` and `-` that starts with a
letter, digit or underscore and has at least one letter or underscore, is
not a Windows device name such as `NUL` or `COM1`, alone or before a dot,
and no other label repeats it, ignoring case as some file systems do; it is
`partitions/<index>.bin` otherwise. `source_path` keeps the label, the
table's own name for the partition. Its `format_metadata`
(`esp-flash-partition`) records the table `index`, `label` (null when not
UTF-8), `label_hex` (the label's bytes when it is not UTF-8, else null),
`type`, `subtype`, ESP-IDF's `type_name` and `subtype_name`,
`flash_address`, `size`, the `encrypted` and `readonly` flags and any
`unknown_flags`. The `encrypted` flag says how a device with flash
encryption stores the partition; it does not establish that the dump's
bytes are ciphertext.

Each partition entry also records where the bytes the dump holds are
written, relative to the partition's start: `written_offset`, the first
byte that is not erased flash (`0xFF`), `written_end`, just past the last
such byte, and `written_bytes`, how many bytes are not `0xFF`. A partition
erased throughout has null offsets and `written_bytes` `0`; a partition the
file holds none of has all three null. The range bounds the written
bytes and does not say whether erased flash lies between them; extract the
partition to read them. REA reads the bytes the partitions cover once, so
overlapping partitions share that read however many the table declares.

ESP-IDF 5.3 and later may declare primary `bootloader` and `partition_table`
entries over the bootloader region and the table sector. They are
partitions like any other, whose bytes are also `bootloader.bin` and
`partition-table.bin`, and they are exempt from the rule that partitions
follow the table, as in `gen_esp32part.py`.

Every partition from the dump's first byte on is an entry holding the bytes
the file has. One that the file holds only in part, as when an `esptool
merge-bin` dump ends inside its last partition, has an entry limitation that
gives the size the table declares; one that lies past the end of the file is
an entry with no bytes and a limitation, and has no image facts. A partition
that begins before the dump's first byte has no entry and is listed in
`partitions_outside_dump`. One unreadable partition does not hide the
others: partitions outside the dump or overlapping another are each reported
while the rest stay readable.

### App partitions and the bootloader

Each app partition and the bootloader region carry their entry's `path`
and ESP image `facts`:
`status` is `esp-image`, `erased` (the image header bytes are erased flash,
as in an empty OTA slot) or `unrecognized` (ciphertext or other data). For an
image they hold the [ESP image](esp-image.md) root facts, `segments`,
`signature_blocks`, `coverage` and `limitations`, with offsets relative to
the region. Extract a partition and inspect it as an ESP image for its
segments as entries.

The summary view (`inspect_artifact` with `detail: "summary"`, or the
inventory summary of `inspect_analysis_view`) reports the root facts under
their own kind, `esp-flash-image-summary`, and gives each of these images a
`summary` instead of its `facts`: `status`, `chip`, `entry_addr`,
`segment_count`, `load_ranges` (the load address, declared length and
classification of each segment that is mapped, loaded or unclassified),
`signature_block_count`, the `descriptor` kind with the fields that tell
builds apart (an app's `project_name`, `version`, `idf_ver`,
`secure_version` and `app_elf_sha256`; a bootloader's `version`, `idf_ver`
and `secure_version`), the `checksum` and `appended_sha256` statuses,
`coverage` and `limitations`. The default complete detail keeps the full
facts, every segment included, and the summary's `inventory_evidence_ids`
name the Evidence that holds them.

`erased` is the bootloader's view: with no image header at the start of the
slot, it finds no app there. An erased slot can still hold data further in,
even a complete app image. When it does, its entry's `written_offset` and
`written_end` say where, and a limitation says that the slot holds bytes the
bootloader does not read; REA does not look for images in them.

### OTA data

The otadata partition holds two `esp_ota_select_entry_t` records, one at the
start of each 4 KiB sector. Like the bootloader, REA reads the last otadata
partition the table declares, and the last factory app and OTA app of each
subtype; a limitation names any repeated declaration. REA reports each
record the partition and the dump hold: its `ota_seq`, `seq_label`,
`ota_state` and its name, `crc`, whether the CRC matches (CRC-32 of
`ota_seq` seeded with `0xFFFFFFFF`) and whether the bootloader would treat
it as valid.

### Boot selection

`boot_selection` is present for every table. It is derived as
`bootloader_utility_get_selected_boot_partition` does without app rollback
or anti-rollback, and `basis` names its branch:

- `otadata`: the valid record with the higher `ota_seq` (record 0 on a tie)
  selects slot `(ota_seq - 1) % ota_app_count`, indexed by OTA subtype;
- `factory-fallback`: no record is usable, or the table has no OTA app, and
  a factory app is declared; or records are set but none is valid, as after
  a CRC mismatch, which selects the factory index whether or not a factory
  app is declared;
- `ota_0-fallback`: no record is usable, or the table has no OTA app, and no
  factory app is declared, so the bootloader selects boot index 0;
- `no-otadata`: the table declares no otadata partition, or one at offset 0,
  which the bootloader takes for none, so it selects the factory index, as in
  the common factory-only layout;
- `none`: the bootloader rejects the table, for an MD5 mismatch or a second
  MD5 entry, or cannot read an otadata partition smaller than two 4 KiB
  sectors, and resets without selecting an app;
- `unknown`: the dump lacks an otadata record the bootloader reads.

Without an OTA app the records do not matter, so a dump that lacks them
still selects a fallback. REA does not compare the partitions with the
flash size in the bootloader header, which the bootloader also checks.

`active_record` and `slot` are set for `otadata` and `slot` for
`ota_0-fallback`. `partition_index` is null when the table declares no
partition for the selected slot or fallback; the bootloader then tries the
other apps. `assumptions` list what the derivation leaves out: records used
as written (for the branches that read them), anti-rollback, load fallback,
and factory-reset and test-app GPIO holds and a wake from deep sleep; they
are empty for `none` and `unknown`. `running_partition` is always
`unknown`: at boot the bootloader may first mark a pending-verify record
aborted, check the app's secure version against eFuse, and fall back to
another partition when an app fails to load.

## Coverage and extraction

Erased flash (`0xFF`) between regions is described. In a gap between
regions, the first byte that is not erased starts an `undescribed` range to
the end of the gap, and makes coverage `unknown`; the rest of that range is
not examined. Coverage is also `unknown` when no bootloader is located, or
when a declared partition begins before the dump's first byte, since it has
no entry. A partition cut short or left out by the end of the file does not
make it `unknown`: its entry holds the bytes the file has, none for one past
the end, and its limitation says what the file lacks. Coverage describes the
inventory of the file, not the observation of every declared flash byte.

So artifact comparison classifies every partition entry of two dumps. Where
both lack the same bytes, as two `merge-bin` dumps of the same layout do,
the entries are equal; a dump against a longer one reports each partition
it cuts short or lacks as `changed`, and that entry's limitation says the
file did not hold the bytes.

`extract_artifact` writes every entry as an ordinary file, `nvs_keys`
partitions included. On a device without flash encryption an `nvs_keys`
partition holds the NVS encryption keys in plain text, and a dump of it
contains them. REA decrypts nothing, recovers no keys and does not interpret
NVS.

## Comparison

Artifact comparison uses each partition's `label`, `label_hex`, `type`,
`subtype`, `flash_address`, `size` and flags as its declaration, so a
partition that moves, changes type or flags, or is renamed with unchanged
bytes is `changed` in `metadata`. Partitions pair by path. The root facts
are not compared as a declaration: they derive from the dump's bytes, which
content comparison covers, and from the caller's `flash_offset` and
`partition_table_offset`, which are part of the target's identity and
decide each partition's byte range.

## Limits

- A flash dump inside another container, such as a ZIP, is classified from
  its first bytes and so reads as an ESP image, not as a flash layout; extract
  it first.
- ESP8266 dumps are refused; Secure Boot v1 bootloader digests and
  flash-encrypted layouts are not read.
- Partitions are not checked against the flash chip size, which the
  bootloader also verifies.
- NVS, FAT, SPIFFS and other data partitions are extracted, not decoded.
- An image nested in a partition is decoded for its facts; its segments are
  not inventory entries.

## Verification

Synthetic fixtures with computed MD5s and CRCs, and one CRC otatool wrote,
cover the table rules, every way the table is located, the scan's chunk and
sector edges, the misplaced-origin guard with the origin omitted or given,
the ESP8266 refusal, the `0x0`, `0x1000` and `0x2000` ROM bootloader
offsets, single images that are not scanned, overlaps, primary entries,
truncation and partitions outside the dump, index names for unsafe labels,
repeated declarations, the otadata states and records, and each branch of
the bootloader's selection. CLI and stdio MCP tests exercise the inputs and
their identity and extraction. MCP `compare_artifacts` tests compare
partition declarations, labels that are not UTF-8 included, two dumps that
end inside their last partition, and such a dump against a full one.

The optional real lane builds its dumps with esptool and ESP-IDF's own tools:

```sh
REA_RISCV_CLANG=/path/to/clang REA_RISCV_LLD=/path/to/ld.lld \
REA_ESPTOOL_PYTHON=/path/to/python-with-esptool \
REA_ESP_IDF_PATH=/path/to/esp-idf \
  npm run verify:esp-flash
```

It converts the conformance ELFs with esptool, builds a default, a
relocated and a primary-entry partition table with `gen_esp32part.py`,
assembles dumps with `esptool merge-bin`, one of them written from flash
`0x1000` with `--target-offset`, and writes OTA records with `otatool`
through `tests/conformance/esp/flash_file_tool.py`. That script replaces
parttool's esptool calls with reads and writes of the dump file, so
otatool's own OTA logic runs unchanged. The lane then checks:

- the bootloader and app facts against `esptool image-info`;
- every partition against `gen_esp32part.py`'s decoding of the table REA
  extracted;
- both OTA records against `otatool read_otadata` after switching to slot 0,
  then to slot 1, then erasing the otadata, and the derived selection after
  each: slot 0, slot 1, then the factory fallback;
- that each extracted file is the dump's bytes at its range and that the
  source is unchanged;
- a table with the primary `bootloader` and `partition_table` entries that
  `--primary-bootloader-offset` fills, read with complete coverage and no
  overlap or misplacement limitation; it has no otadata, so its boot
  selection is `no-otadata` with the factory app;
- the relocated table, found by scanning and named with
  `partition_table_offset`, and the dump written from `0x1000`, read with
  `flash_offset` and, without it, left an ESP image whose `flash_dump`
  names `flash_offset` `0x1000`;
- an app with a flipped byte beside valid partitions, and a truncated dump,
  read with complete coverage and its missing partitions as entries with no
  bytes.

The lane ran on macOS arm64 with Node 24.22.1, Homebrew Clang and LLD 21.1.8
and ESP-IDF v5.5.2's `gen_esp32part.py`, `otatool.py` and `parttool.py`,
once with esptool v5.6.0 and once with 4.12.0. Its `gen_esp32part.py` is
identical to v6.1's, and its otatool and parttool differ only in import style
and esptool command spelling. All checks passed in both runs. With v5.6.0 and
the build already cached, the run took 24.1 s elapsed, 16.9 s user CPU and
6.3 s system CPU under `/usr/bin/time -l`; the largest single process peaked
at a 278 MiB resident set, and the combined peak of all processes was not
measured.

The lane does not establish:

- dumps read from a device: its dumps come from `merge-bin`;
- chips other than ESP32-C3 and ESP32;
- `ota_state` and record validity, which `read_otadata` does not print, or
  OTA states the bootloader writes itself, app rollback or anti-rollback;
- selection with gaps or repeated OTA subtypes, which otatool does not
  write;
- flash-encrypted dumps, which are not recognized by design.

It does not run in CI.
