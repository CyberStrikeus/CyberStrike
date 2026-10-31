# Flutter build identification

REA identifies a Flutter app's build facts by **pure parsing** of its APK:
the Dart VM snapshot hash, per-ABI library digests, the engine's GNU
build-id, and any labeled version strings. No engine, no tool installation,
no execution, and no external lookups — this family answers "which Dart SDK
build is this, and what exactly is in the payload?" before any deeper
native analysis.

This is the triage step for Flutter reversing: the snapshot hash is the
artifact that maps to a Dart SDK release through an external dataset (such
as the one reFlutter maintains), and knowing the SDK version is what makes
SDK-layout-specific snapshot parsers applicable.

## Answer an analyst question

```sh
rea identify-flutter-build /targets/Example.apk
rea inspect-dart-aot /targets/Example.apk
rea inspect-dart-aot /targets/Example.apk --abi armeabi-v7a
```

The equivalent MCP methods are `identify_flutter_build` (with `path`) and
`inspect_dart_aot` (with `path` and an optional `abi`; the default prefers
arm64-v8a, then x86_64, then x86, then armeabi-v7a, then the remaining
ABIs alphabetically). An explicit `abi` is the directory label exactly as
`identify_flutter_build` reports it, so a payload under a nonstandard label
stays selectable and keeps that label in the result.

## Optional retained AOT delivery

MCP `inspect_dart_aot` keeps complete output when `detail` is omitted or
`"complete"`. Explicit `detail: "summary"` returns the selected target/ABI/library
identity, all snapshot headers, structural coverage, string-pool coverage and
original lower-bound counts without the string lists. It retains complete source
Evidence and returns a distinct linked `inspect_analysis_view` summary. Analysis
and the caller's ABI choice are unchanged; one-shot CLI output stays complete.

Use `normalized_result.parent_evidence_id` as the retained source for
`inspect_analysis_view`, with `view: {kind: "dart-aot", collection: "package_uris",
offset: 0, limit: 64}`. Collections are `package_uris`, `dart_uris` and
`class_like_tokens`. Pages preserve the original strings and order, selected ABI,
library identity and source coverage. `returned_counts` describe producer-returned
rows; counts ending in `_at_least` remain lower bounds. Exhausting a page sequence
does not make a partial pool complete or turn byte-pattern tokens into typed
classes/functions. Views do not reopen the APK. Original Evidence remains
exportable under its existing session lifetime. Summary requires a retaining
server; older servers keep the complete request after schema discovery.

## What the AOT inspection returns

`inspect_dart_aot` reads one ABI's `libapp.so` in full and reports:

- **Snapshot sections** — the four `_kDart*Snapshot*` symbols located
  through the ELF **dynamic symbol table** (ELF32 and ELF64, little-endian,
  every read bounds-checked), each with file offset, size, and — for data
  sections, which carry the `f5f5dcdc` magic — the parsed header kind and
  length (the stored length excludes the four magic bytes). Data headers
  whose declared snapshot length does not fit their symbol retain their
  observed fields and report partial coverage. Complete structural coverage
  currently requires kind 3, the FullAOT value in the supported
  [Dart 2.14 layout](https://github.com/dart-lang/sdk/blob/2.14.0/runtime/vm/snapshot.h).
  Kind numbers vary across Dart releases; other values are preserved with
  partial coverage, without guessing their interpretation.
  Unified `_kDartSnapshotData` / `_kDartSnapshotText` exports are a different
  unsupported profile. The [upstream VM-isolate removal](https://github.com/dart-lang/sdk/commit/d36adbacafee01d9852cf8e960cf2d8654d91e7e)
  changes both the source layout and the FullAOT kind value. REA reports the
  observed export names and library identity with a typed unsupported-profile
  refusal when only unified exports are available; it does not alias one header
  into two independent sources.
  Address resolution examines every overlapping `PT_LOAD` interpretation,
  including partial overlaps. Equivalent mappings are coalesced; conflicting
  mappings leave affected symbols unresolved and qualify coverage. Dynamic
  hash, symbol and string tables use the same mapping checks.
  A payload without exported snapshot symbols is refused rather
  than guessed at.
- **The snapshot hash** from the header at the start of each exported data
  symbol. Complete hash coverage requires a valid header from both the VM
  and isolate; duplicate records inside one symbol cannot stand in for the
  other's header. Aliased or overlapping data symbols report partial coverage.
- **A string-pool projection from the isolate data section**: distinct
  `package:` source URIs (the app's own and its dependencies' Dart files —
  a dependency inventory), `dart:` SDK URIs (which SDK libraries the app
  uses), and identifier-shaped tokens, each bounded with counts and
  `coverage: "partial"` when truncated. On the reference target this counts
  756 package URIs and 201 dart URIs on arm64-v8a and x86_64, and 212 / 48
  on armeabi-v7a, retaining up to 500 of each in the response.
  `libapp.coverage` describes structural snapshot checks;
  `string_pool.coverage` describes the bounded projection. Overall coverage
  is partial when either facet is partial.

## Interpret the result

- **`flutter_detected`** is true when any `lib/<abi>/libapp.so` exists. A
  negative answer reports complete coverage: absence is an answer.
- **`snapshot_hash`** is the Dart build hash observed 20 bytes after the
  snapshot magic (`f5 f5 dc dc`) inside `libapp.so`. Identification scans
  byte patterns; AOT inspection reads the exported VM and isolate headers.
  `snapshot_hash_sources` counts the valid records observed by the chosen
  operation, and when they **disagree** the distinct values are
  kept in `snapshot_hash_candidates` with `snapshot_hash: null` and
  `coverage: "partial"` rather than silently picking one.
  Identification can retain a single byte-scanned hash from a unified payload;
  its partial status does not establish truncation or support for that profile.
- **`elf_header_valid`** checks the supported little-endian ELF32/ELF64
  header, table entry widths, and full table extents against the library's
  actual byte length. Truncated, malformed, or unsupported headers report
  false and partial coverage while retaining byte-scanned hashes. This
  header check does not establish valid table contents or exported symbols.
- **`libflutter` facts** are per-ABI observations: byte size, SHA-256
  digest, GNU build IDs from ELF-declared `PT_NOTE` / `SHT_NOTE` ranges,
  and any _labeled_ strings the build
  carries. Release engine builds often strip the `Dart VM version` string —
  absence is reported as `null`, not guessed. Android clang/LLVM toolchain
  lines are reported verbatim as build provenance.
  `build_id_candidates` preserves distinct IDs. `build_id` is populated only
  when all declared note ranges were examined and one ID was found;
  conflicting IDs or malformed/bounded note metadata make coverage partial.
  Nonempty GNU build-ID descriptors up to 64 bytes are retained as lowercase
  hexadecimal, including IDs shorter than four bytes.
  Matching bytes outside declared note ranges cannot supply a build ID.
  Compressed `SHT_NOTE` sections are skipped with an unsupported-compression
  limitation and partial coverage; IDs from other note ranges remain candidates.
  Encoded note storage is never interpreted as note headers or inflated.
- Labeled strings must fit their complete grammar. `dart_version_capped`
  and `toolchain_capped` independently report labels omitted by grammar or
  projection bounds; either makes identification coverage partial. Values
  split across read chunks are retained without publishing truncated prefixes.
- **`coverage: "partial"`** also appears when an ABI carries `libapp.so`
  without `libflutter.so` (or vice versa).
- The APK itself is digested before parsing, so `target.sha256` binds the
  observation to the exact input.

## Limits

- **Owned snapshots.** Both operations copy the admitted APK into a
  provider-owned, read-only snapshot before digesting and parsing, so a
  concurrently modified original cannot mix into one observation; failed
  reader closure and snapshot cleanup are retained and retried on `close()`.
  The snapshot is removed only after all owned readers and file descriptors
  close successfully. Copying pins one admitted descriptor and compares its
  identity, size, mode and timestamps after the copy. Source permission
  failures remain `access_denied`, and source identity changes remain
  `artifact_changed`. Provider-owned storage failures report a
  `resource_constraint` with their native I/O cause. Cancellation is checked
  during copying, metadata/symbol walks, string scanning, and after cleanup.
- **Bounded reads.** APK snapshots are bounded at 2 GiB, including while
  copying. Identification permits 768 MiB of cumulative library extraction;
  declared sizes are checked before extraction. Library reads are bounded at 256 MiB each and ZIP
  metadata at 8 MiB. Before reading, the AOT image buffer reserves the
  admitted declared size plus one byte; the reported byte count is the number
  actually read. Exceeded budgets report
  `resource_constraint`.
- **Engine notes.** Engine libraries are spooled into the owned root. ELF
  headers, note tables and note payloads share an 8 MiB metadata budget;
  up to 64 distinct build IDs and 1024 distinct nonempty note ranges are retained.
  The range cap bounds bookkeeping and separate positional reads even for tiny
  overlapping declarations. Exact duplicates share one read and empty ranges
  consume no inventory slots. Exceeding a bound preserves the candidates examined
  from retained ranges and reports partial coverage with `build_id: null`.
- **Metadata and candidate capacity.** Both operations refuse duplicate
  relevant library paths. Inventory is limited to 32 ABIs and 1024 bytes per
  relevant library path, independently of compressed size. Identification
  refuses more than 64 distinct snapshot hashes with `resource_constraint`
  rather than silently dropping conflicting evidence.
- **Selected ABI.** AOT inspection applies the library budget to the selected
  ABI after selection; an oversized unselected library does not block it.
  Undefined dynamic-symbol imports are not treated as snapshot exports.
  A retained section directory without `SHT_DYNSYM` uses the same bounded
  `PT_DYNAMIC` symbol description as a section-stripped image. Malformed
  present symbol-table sections remain failures.
  Section-stripped images require a bounded symbol count from `DT_HASH` or
  `DT_GNU_HASH`; layouts without either are refused. Symbol names and their
  terminators must fit their linked string table. Only dynamic entries used for
  symbol discovery are interpreted as numeric bounds. ABI-ignored payloads,
  including [`DT_BIND_NOW`](https://gabi.xinuos.com/elf/08-dynamic.html#dynamic-section),
  do not change discovery; their stored bytes still contribute to the selected
  artifact's digest.
- REA performs **no hash-to-SDK lookup**: mapping the snapshot hash to a
  Dart SDK release requires an external dataset and is deliberately out of
  scope for this family.
- The AOT string pool is a **byte-pattern projection, not deserialized
  cluster semantics**: typed class and function recovery requires an
  SDK-specific parser (the snapshot layout changes per release — exactly
  why the hash is the key), and `class_like_tokens` include incidental
  matches. JEB's GUI Dart unit and native analysis of `libapp.so` cover
  some ground today.

## Real verification

`npm run verify:flutter -- --apk PATH [--plain-apk PATH]` runs both tools
through compiled CLI and stdio MCP, compares Evidence, and checks every ABI.
Use `--expectations scripts/fixtures/flutter-gallery-expectations.json` with
the Gallery 2.9.2 release APK to check exact per-ABI engine labels,
URI counts and the snapshot hash against its pinned SHA-256. The verifier
requires complete structural snapshot coverage on every ABI and explicitly
reports the bounded pool projection as partial/unverified when truncated.
Other APKs need their own expectations file to verify exact engine labels
and URI counts; otherwise those facets are reported unverified.
The optional plain APK checks negative detection. Record: Flutter Gallery 2.9.2 (112 MB, three
ABIs) — every ABI reports the same agreeing hash
`65817c30a78bb44c3dc3771876b6010a` from two snapshot sections, per-ABI
engine build-ids, no labeled Dart version (as expected for a release
engine), and the Android clang toolchain line; a plain aapt2-built APK
reports not-detected with complete coverage. The suite uses self-contained
synthetic ELF images and scanner payloads; it does not read private local files.

The Gallery workflow and all 147 focused Flutter tests also pass on macOS Sonoma
14.8.9 x86-64 and Windows 11 x64 build 26300.9457 guests with Node 24.18.0,
including the conflicting-load and note-range-limit CLI/MCP regressions. Windows
verification runs under a non-administrator account. Verifiers use a shared
temporary parent so each CLI/MCP process can own and release its own snapshots.
