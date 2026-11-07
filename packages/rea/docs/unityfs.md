# UnityFS AssetBundle archives

`inspect-artifact` and `extract-artifact` read standalone UnityFS AssetBundle
containers without running Unity or the producer application. Header format
versions 6 through 8 are supported. Version 9 adds a different block-table
layout and is unsupported until independently verified.

Inspection retains the header facts: format version, player and engine version
strings, declared size, dataflags, blocks-and-directory table bounds, the
producer's 16-byte data hash as declared, and the resolved data-area offset.
Members (`CAB-*` SerializedFiles, `.resS` resource streams, shared assets)
retain declared source paths, virtual stream offsets, sizes and raw node flags.
The directory flag identifies directories. Virtual offsets are not physical
carrier locations: member `source_location` is null. Member reads only examine
their covering blocks. Uncompressed ranges stream directly; compressed ranges
reuse at most one completed decoded block. Independent 64 KiB output chunks
preserve cache ownership. Carrier freshness is checked when a member is opened,
including when a cached block suffices, and after its stream completes. Reader close cancels and
joins outstanding streams before releasing its descriptor.

Data blocks compressed with none, LZ4 or LZ4HC are supported. LZMA-compressed
blocks and blocks-info tables are reported as unsupported coverage or an
`unavailable` member read; the directory and any readable members are still
retained. Bundles declaring asset-bundle encryption keep their header facts
but report unknown directory coverage; no decryption is attempted. The reused
0x200 encryption/padding flag is interpreted by producer revision. Ambiguous
revisions retain unknown layout coverage. Unread block counts and data offsets
are null, never invented zeroes. A declared
size that exceeds the input file, node paths outside the block stream, and
counts that cannot fit their table are malformed-input errors.

## Resource bounds

These are resource policies, not format maxima. Encoded and decoded directory
buffers are each limited to 16 MiB. Buffers, parsed rows, retained entries and
path projections share a conservative 64 MiB admission budget, reserved before
allocation. Each LZ4 decode allows at most 64 MiB of output and its bounded
encoded representation; plain blocks stream without this allocation. A reader
admits four active member streams. The shared archive plaintext-work ceiling
is the larger of 256 MiB and 500 times carrier size: declared stream bytes,
readable logical occurrences (including aliases), and cumulative block-decode
attempts are each charged against that ceiling. Empty-output blocks retain
their source count and offsets but are removed from member read plans. A separate
member-I/O budget allows four times the larger of 1,024 and the sum of nonempty
blocks, directory nodes, and readable 64 KiB plaintext chunks. It admits ordinary
passes while bounding repeated tiny-block reads independently of output bytes. Unavailable content is retained
as named occurrences with unknown coverage and no invented content hash.

Use existing summary delivery and retained inventory views for selected fields,
filters and paging; full Evidence remains available without repeating the graph.

## CLI

```sh
rea inspect-artifact assets/hotfix.bundle --detail summary \
  --evidence_output evidence/hotfix.json --json
rea extract-artifact assets/hotfix.bundle --json
```

Detection is byte-based on the `UnityFS\0` signature, so `.bundle`, `.ab`,
`assets_*` YooAsset bundles and extensionless files all classify as `unityfs`
containers. Compact delivery keeps complete Evidence in the requested bundle.

## Verification scope

Synthetic fixtures cover format 6–8 layouts, padding independent of header
alignment, directories, malformed tables, allocation admission, overlapping
members, unsupported LZMA, cancellation inside decoding, paused iteration,
close during I/O, cleanup retry, empty blocks with unsupported codecs, cache
freshness and independent output buffers.
Compiled CLI and full/compact MCP tests cover inventory and extraction.

A public UnityPy `atlas_test` bundle (Unity 2018.4.11f1, format 6) is verified
against independent UnityPy 1.24.2 raw member bytes. Source SHA-256:
`61ee5afb5f5c64f0a4f65f039d09b2509198363e713423289c895067ac215177`.
The source is pinned to UnityPy commit
`417d59522a998fdee9a9c2b29fe35f3063222457`. The same public corpus supplies
`banner_1` (2018.4.4f1) and `char_118_yuki.ab` (5.6.7f1), whose raw members
also match the independent oracle. `xinzexi_2_n_tex` (2017.4.37f1) uses LZMA
data: its member names and sizes are retained with unavailable hashes and
unknown coverage. UnityPy-produced repacks additionally verify format 7/8,
padded and unpadded front tables, end tables, and unsupported LZMA directories.
These repacks are library-produced tests, not Unity engine executions. The PR
records producer parameters, source digests and measured task costs; synthetic
fixtures alone do not establish real Unity version coverage. SerializedFile objects, textures and runtime
behavior are outside this container reader's verification scope.
