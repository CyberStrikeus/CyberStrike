# U-Boot legacy uImage containers

`inspect-artifact` and `extract-artifact` recognize the big-endian
`0x27051956` legacy uImage signature regardless of filename. They read local
stored bytes without booting, executing, decompressing or modifying the image.
FIT is a different format; its analysis is outside this reader.

The same domain header/table facts and artifact reader serve CLI and MCP.
The root is an archive with unknown executable architecture. The header's CPU,
OS, type, compression, load address and entry address are declarations, not proof of
compatible or executable payloads. Raw numeric identifiers remain available
alongside names. Type names cover every image type in the pinned
`include/image.h`, using U-Boot's `mkimage -T` names; `IH_TYPE_LOADABLE` (22)
has none and is named `loadable`. Unrecognized identifiers have the name
`unknown`.

The header's CRC32 and the declared payload's CRC32 must verify before a
successful inventory. `payload.bin` contains the complete stored payload.
Multi-file images also expose `image-0.bin`, `image-1.bin`, and so on. These
component names are generated from table order. Components follow the zero-terminated big-endian size table, with four-byte
padding after every nonfinal component. Script images (`boot.scr`) carry the
same table, so their script text is `image-0.bin`. Component physical source
ranges and content hashes retain precise provenance. Extraction writes the complete
payload and every component, so multi-file output can approach twice the input
size. Compressed payloads remain compressed.

The fixed 32-byte name field is retained as `name_bytes_hex`. `name` contains
the UTF-8 bytes before the first NUL, or null when those bytes cannot be decoded
exactly. For example, a producer can truncate a multibyte character at the
32-byte boundary; replacement characters do not establish a source name.

## Bounded work and retained facts

The reader admits at most 4,096 components, a resource policy rather than a
format maximum. It reads at most 16,388 bytes for the size table and refuses an
excess count as a capacity limit before its remaining payload CRC scan.
Shared artifact identity hashing has separate cost. The
same prefix participates in the native incremental CRC32 calculation; no
custom bytewise CRC table or full-payload buffer is retained. Remaining CRC
reads and member streams use 64 KiB chunks. Parsed facts are cached for one reader. Carrier state is checked during
directory preparation, at member open and after stream completion; metadata
getters return the retained facts. Close joins active member
pipelines and final validation before releasing the descriptor; failed cleanup
remains owned for retry.

Prefer a retained summary when only a few facts are needed:

```sh
rea inspect-artifact firmware.bin --detail summary \
  --evidence_output firmware.evidence.json --json
rea extract-artifact firmware.bin --json
```

With MCP, `inspect_artifact` with `detail: "summary"` retains the complete
Evidence. Use `inspect_analysis_view` and its `parent_evidence_id` for exact
logical paths, batches of occurrence/content IDs, selected fields and pages.
Coverage and limitations remain attached. Retained views are historical
observations tied to the saved Evidence. Complete Evidence remains available;
these views do not narrow the examined inventory.

## Verification scope

The public OpenWrt 24.10.0 GL-AR150 initramfs kernel is checked against its
[published digest](https://downloads.openwrt.org/releases/24.10.0/targets/ath79/generic/sha256sums):
`027c60a7061462d8145b11efa23ab02b334acb9a23a215f9095860b632ace4ff`.
Independent `mkimage`/`dumpimage` 2023.01 provide producer and extraction
oracles. Generated containers use real host ELF files, system metadata and
stored gzip bytes; their declared ARM64, VxWorks or RISC-V labels do not prove
boot/runtime compatibility. U-Boot's identifier and alignment definitions are
pinned to commit `ece349ade2973e220f524ce59e59711cc919263f`.

Source and compiled CLI/full/compact MCP tests cover aligned component ranges,
unknown identifiers/text, malformed/truncated inputs, CRC failures, capacity,
source changes, cancellation, pending reads, final validation and cleanup
retry. Real producer results, complete-task cost measurements and limitations
are reported in the PR. No target runtime or decompressor behavior is verified.
