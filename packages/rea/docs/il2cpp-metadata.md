# IL2CPP metadata

`inspect_il2cpp_metadata` / `inspect-il2cpp-metadata` decodes one selected local
Unity IL2CPP `global-metadata.dat` file and returns its assembly images, type
definitions, methods and named members with their owners, plus managed string
literals, by stable index, namespace, range and count,
with the header sections and serialized index widths. It reads the file without
running it and requires no Unity installation, IL2CPP binary, active target,
Hopper, Ghidra or IDA.

Metadata versions 24, 27, 29, 31 and 39 are supported. For example, Unity 2019.4.41f2
wrote version 24, 2020.3.49f1 version 27, 2022.3.30f1
wrote version 29, 2022.3.62f3 wrote 31 and 6000.4.2f1 wrote 39; other Unity
releases that write these numbers have not been checked. Other versions are
rejected as unsupported. Version 24 decoding covers the 264-byte header layout
used by the cited Unity 2019.4 build; earlier 24.x layouts are not inferred from
the version number and are refused when their header or records differ. The path
must name a regular file; directories and symbolic links are rejected.

With `binary_path`, the tool also reads the matching native binary and links
each method to its code address. See [Native method addresses](#native-method-addresses).

## MCP

MCP defaults to a compact summary and retains the complete decoded Evidence in
the session. MCP requires an absolute filesystem path:

```json
{
  "name": "inspect_il2cpp_metadata",
  "arguments": {
    "path": "/artifacts/Data/Managed/Metadata/global-metadata.dat"
  }
}
```

The summary retains the complete decoded Evidence in the session and returns a
linked `inspect_analysis_view` overview: artifact identity, metadata version,
index widths and `counts` (`sections`, `images`, `types`, `methods`,
`nested_types`, `fields`, `properties`, `events`, `parameters` and
`string_literals`) without rows. Use `normalized_result.parent_evidence_id` to page
the original rows without reopening or decoding the file:

```json
{
  "source": {
    "kind": "retained-evidence",
    "evidence_id": "<parent_evidence_id>"
  },
  "view": {
    "kind": "il2cpp-metadata",
    "collection": "types",
    "offset": 0,
    "limit": 64
  }
}
```

Collections are `sections`, `images`, `types`, `methods`, `fields`,
`properties`, `events`, `parameters`, `string_literals`, `method_addresses`,
`return_types`, `field_types`, `parameter_types`, `code_gen_modules`,
`generic_method_instances` and `generic_method_issues`. Every returned row includes
its source `index`, scoped by artifact SHA-256 and collection. All collections
accept batch `indices` and `fields`. Exact `names` filtering is supported for
`sections`, `images`, `types`, `methods`, `fields`, `properties`, `events`,
`parameters`, `return_types`, `field_types`, `parameter_types` and
`generic_method_instances`. Native type names match the retained rendered display value exactly; every same-name row
keeps its source index, and an unavailable (`null`) name never matches a string.
Types also accept `image_indices`, `namespaces` and
`declaring_types`; methods, fields, properties and events accept
`declaring_types`. Parameters accept exact `method_indices`, so a batch of
method indices retrieves their parameters without reading the entire parameter
table. `parameter_types` accepts the same `method_indices`, resolved through the
retained `parameters` owners; Evidence without `parameters` refuses that filter. Generic method instances
accept `method_indices` (definition indices) and `states`; generic method
issues accept `rows` (the instance rows they leave unknown). Filters intersect, duplicate indices are returned once, and
rows retain metadata order. An empty filter selects no rows; `fields: []`
returns indices only. Omitted fields return the complete selected rows.

For example, after resolving a type index, retrieve selected method facts:

```json
{
  "source": {
    "kind": "retained-evidence",
    "evidence_id": "<parent_evidence_id>"
  },
  "view": {
    "kind": "il2cpp-metadata",
    "collection": "methods",
    "declaring_types": [1555],
    "names": ["SendMessage"],
    "fields": ["name", "declaring_type"]
  }
}
```

After finding method indices, parameters can be requested directly:

```json
{
  "source": {
    "kind": "retained-evidence",
    "evidence_id": "<parent_evidence_id>"
  },
  "view": {
    "kind": "il2cpp-metadata",
    "collection": "parameters",
    "method_indices": [9785],
    "fields": ["name", "method"],
    "limit": 64
  }
}
```

Historical Evidence that predates these member collections remains queryable.
A missing collection has an unknown (`null`) summary count, and requesting it
reports that it was not collected; it is never presented as an empty inventory. The same holds for Evidence that predates binary linking: its summary
omits `binary`, and `method_addresses`, `method_address_states`,
`return_types`, `field_types` and `parameter_types` counts are `null`. A link retained before
generic instances existed omits `binary.generic_methods`, and the
`generic_method_instances` and `generic_method_issues` counts are `null`.
Existing empty collections retain a zero count. Full Evidence is preserved.

`offset` counts matching rows, not source indices. `limit` defaults to 64;
`coverage.next_offset` continues that filtered page. Coverage describes retained
metadata facts only; runtime behavior and correspondence to native code remain
unknown. Each view preserves the parent Evidence link, artifact identity and
limitations. Queries work after the source file is removed. Select
`detail: "complete"` to return every row inline within the separate MCP response
budget.

## CLI

```bash
rea inspect-il2cpp-metadata /absolute/path/global-metadata.dat --json
```

The CLI defaults to complete Evidence. For compact delivery, explicitly preserve
the full Evidence in a new file:

```bash
rea inspect-il2cpp-metadata /absolute/path/global-metadata.dat \
  --detail summary --evidence_output /tmp/metadata-evidence.json --json
jq -c '{source: {kind: "inline", evidence: .records[0]}, view: {kind: "il2cpp-metadata", collection: "methods", indices: [9785], fields: ["name", "declaring_type"]}}' \
  /tmp/metadata-evidence.json > /tmp/metadata-query.json
rea inspect-analysis-view /tmp/metadata-query.json --json
```

Use the exported Evidence with the CLI's inline Evidence source format described
in [CLI and Evidence](cli.md#run-a-command). Compact delivery requires
`--evidence_output`; existing files are never overwritten. The full export
preserves every decoded row for subsequent queries without the original file.

`--binary PATH` links method addresses, `--architecture arm64|amd64` selects
exactly one slice of a universal Mach-O and `--generic-instances` adds generic
method instances. The report retains the native reader's
`amd64` spelling for x86-64; loader CPU checks use the corresponding `x86_64`
identity. Multiple slices with the same architecture label are refused as
`ambiguous-slice-selection`, including
distinct ARM subtypes that both map to `arm64`. On macOS, use `lipo -info`
to enumerate exact subtypes, then extract the intended subtype into a separate
file, for example `lipo universal -thin arm64e -output thin-arm64e`. Inspect
that thin file without `--architecture`. An exact `arm64e` slice is not
selected by `lipo -thin arm64`. Thinning resolves only selection ambiguity;
the metadata must still match and unsupported pointer encodings remain unsupported.

## Observations

The result contains:

- `artifact`: path, SHA-256 and byte length;
- `magic`: unsigned little-endian header signature (`0xFAB11BAF`, delivered as a JSON number);
- `metadata_version`: `24`, `27`, `29`, `31` or `39`;
- `index_widths`: the serialized widths (1, 2 or 4 bytes) of
  `type_definition`, `generic_container`, `parameter` and `type` indices, and
  `type_width_source`. Version 39 derives the type index width from the
  `interface-offsets-record` or the `type-definition-record`; versions 24, 27, 29
  and 31 always use 4-byte indices (`fixed-width-version`);
- `sections`: all version-specific header sections in header order, each with `offset`, `size`
  and `count`. Versions 24 to 31 record no counts, so `count` is `null` and
  record counts come from the section sizes;
- `images`: `name`, `type_start` and `type_count`;
- `types`: `name`, `namespace`, `method_start`, `method_count`,
  `nested_type_start`, `nested_type_count` and `declaring_type`;
- `methods`: `name` and `declaring_type`;
- `fields`, `properties` and `events`: `name` and `declaring_type`, the type
  whose member range holds the row (`-1` when none does);
- `parameters`: `name` and `method`, the method whose parameter range holds it;
- `string_literals`: managed string literals as `value`, or `value_base64` with
  the exact bytes when they are not valid UTF-8;
- `limitations`.

A row's position in its collection is its metadata index, so `type_start`,
`method_start` and `declaring_type` refer to positions in `types` or `methods`.
`nested_type_start` instead indexes the metadata's `nestedTypes` table, which is
not returned; each nested type's `declaring_type` carries that relationship.
A type's `declaring_type` is derived from the `nestedTypes` section and is `-1`
for top-level types. The start of an empty range can retain the original value
`-1`.

The complete inventory of a large game is several megabytes and can exceed
the MCP response budget. Summary delivery and filtered, projected pages keep
unneeded rows out of agent context without discarding the source Evidence.

## Native method addresses

`binary_path` names the native binary built with the metadata: macOS
`GameAssembly.dylib` (Mach-O), Windows `GameAssembly.dll` (64-bit PE) or
Android `libil2cpp.so` (64-bit ELF, AArch64 or x86-64). A
universal Mach-O needs `binary_architecture` (`arm64` or `amd64`); a thin binary
rejects it. The file is read, never loaded or executed.

A position-independent `libil2cpp.so` stores zero in most pointer slots and
keeps the value in `R_AARCH64_RELATIVE` or `R_X86_64_RELATIVE` relocations
(`DT_RELA`). The reader writes those values into a private copy before
searching it, so addresses are the link-time addresses and RVAs are relative to
the first loaded segment. Android packed
relocations (`DT_ANDROID_RELA`) are refused. No target code is executed.

The binary's `Il2CppCodeRegistration` points to one `Il2CppCodeGenModule` per
assembly image. Each module record starts with its module name, its method
pointer count and its method pointer array. The reader finds, for every metadata
image, the single record whose name pointer reaches that image's name string and
whose count equals the image's method count. It then requires exactly one
`codeGenModulesCount`/`codeGenModules` pair that lists exactly those records.
`codeGenModulesCount` and module method counts own four bytes, followed by
alignment padding before their eight-byte pointers. Unresolved loader writes
overlapping those four bytes prevent the registration from being established;
padding outside the field is neither required nor interpreted as part of its
count. No symbols are needed, so stripped builds work. A method's token row id
selects its slot in the module's method pointer array. Within one image, each method must
claim a distinct MethodDef token row; duplicate rows are refused before any
linked method table or seed output is published. Row ids may repeat across
different images, and distinct rows may still resolve to the same address when
the binary uses identical-code folding.

For ELF, a repeated load mapping that resolves a complete module record to the
same virtual address and file bytes contributes one record. Distinct virtual
record addresses remain distinct candidates, and conflicting file mappings
remain malformed.

Module records establish names through their declared NUL-terminated string pointers. NUL/0xFF padding, spaces, Unicode and suffix-shared storage are supported. A pointer to a longer string does not match just its suffix; a pointer directly into a shared suffix may name it. Exact reversed UTF-8 matching avoids rescanning the file for every name and retains duplicate-name owners until module records resolve them. A contributor investigated a Linux
`GameAssembly.so` from Unity 2023.2.13f1 whose static registration was not located. When no static pair is resolved on x86-64 or arm64, the reader searches executable ranges for bytes consistent with a reference to a module-array candidate: RIP-relative LEA/MOV on x86-64, an adjacent `adrp`/`add` pair on arm64. Exactly one referenced array candidate must remain. `code_gen_modules_field` is then `null`, and Evidence is **inferred**: instruction boundaries, the absence of a static registration elsewhere, and runtime use were not verified. The module records and slots themselves remain file observations. Static-table associations are **derived**. Otherwise the result is `code-registration-not-found`. Cpp2IL's StrippedCodeRegSupport plugin also recovers the module list of an inlined CodeRegistration from the module names; this fallback additionally requires the exact located module set and a single code reference. A Unity 2022.3.62f3 macOS Master build checked by a contributor keeps neither registration symbol; its type table is then inferred as described below.

The binary/metadata pair is caller-selected. Name/count/token agreement is structural evidence, not a cryptographic same-build proof. File-offset locations refer to the primary metadata artifact; linked virtual addresses refer to `binary.artifact`. Both SHA-256 identities remain available in compact native pages as `artifact` and `binary_source`.

Contributor-reported verification (not all rerun by the follow-up): macOS arm64 and x86_64 slices from Unity 2021.3.45f2, 2022.3.30f1, 2022.3.62f3 and
6000.0.84f1 against dSYM symbols; Android arm64 and x86-64 from 2022.3.62f3
against `libil2cpp.sym.so`; Windows x64 from 2023.2.13f1 (metadata version 29,
the MIT-licensed game Between Two Worlds 1.0.5, `GameAssembly.dll` SHA-256
`a3ae7f6ecd1f671297b7d98d12713ef024062d93cd7a4205298102656c93b67a`) against
Il2CppDumper, where all 43,198 linked methods share an address with a
same-named Il2CppDumper method and identical code folding groups 10,448 methods
into 1,735 addresses. A macOS x86_64 build from Unity 2020.3.49f1 (metadata version 27, which Il2CppDumper reads as 27.1) links 10,555 methods, all at addresses where Il2CppDumper names the same method; its other addresses are generic instances. A build from Unity 2021.1.28f1 (also read as 27.1) gives the same result: 10,345 methods linked, every address named the same by Il2CppDumper, and its other 3,486 addresses generic instances.

These checks compare addresses with symbols or with another static tool. They
do not establish that a linked address is the code the game runs (a runtime may
patch, hook or replace it), that builds from other Unity versions, compilers or
obfuscators link the same way, or that a method without an address has no code:
generic instances, adjustor thunks and invokers are not linked, and an
`unknown` row was not looked up at all.

The result adds:

- `binary`: artifact identity, `format`, `architecture`, `image_base`,
  `code_gen_modules_field` (the address of `codeGenModulesCount`, or `null` as
  described above), `code_gen_modules_array` (the module pointer array) and
  `code_gen_modules` (`image`, record `address`, `method_pointer_count`);
- `method_addresses`: one row per method index with `state`, `address` and
  `rva` (address minus `image_base`), both hexadecimal strings. `state` is
  `code` when the module slot holds an unambiguously mapped executable address, `no-body` when an observed slot is zero,
  as for abstract, extern and most generic methods, and `unknown` when no type
  range in any image holds the method, a symbol relocation leaves its slot
  unresolved, or dyld will bind a Mach-O slot. The raw word in a dyld-bound
  slot is not treated as the resolved address.
  `address` and `rva` are `null` unless `state` is `code`. The summary counts
  each state in `counts.method_address_states`. Ghidra seeds are written only
  for `code` rows.

- `return_types`, `field_types` and `parameter_types`: one row per method,
  field and parameter index with `type`, the index into the binary's
  `Il2CppType` table, and `name`, rendered from that table: C# keywords for
  primitives (`int`, `string`, `object`), `Namespace.Outer+Inner` for type
  definitions, `T[]` for vectors, `T[*]` for rank-one multidimensional arrays,
  `T[,]` for rank-two arrays and `T*`, generic instances as
  `System.Collections.Generic.List<string>` and generic parameters by their
  metadata name (`TKey`). Nested generic arguments stay with the component
  that declares them, for example `Game.Outer<int>+Inner<string>` or
  `Game.Outer<int>+Leaf` when the nested type adds no parameters. A trailing
  `&` marks a by-reference type. `name` is `null` for type index `-1`, metadata
  version 27 as described below, or an unresolved type-table slot. A dyld bind
  or unresolved ELF relocation retains the type index without interpreting its
  stored word as a resolved pointer. If an unresolved loader value occurs
  inside a type graph, linking is refused with `unsupported-pointer-encoding`;
  a concrete name is not synthesized from that placeholder.

`binary` also records `types_field` and `types_count`: the address of
`Il2CppMetadataRegistration.typesCount` and its value. That record is found as
the single place whose `fieldOffsetsCount` and `typeDefinitionsSizesCount` both
equal the metadata type-definition count and whose type table is file mapped.
Linking reads only that table. When no record on x86-64 or arm64 has both of
those counts, the reader collects maximal runs of pointers to Il2CppType-shaped
records (an assigned Il2CppTypeEnum kind from 0x01 to 0x1e; class and
value-type data below the type-definition count) that are long enough for every
type index the metadata references. Exactly one such run may exist in the
image, it must start and end inside its mapping (a run touching either end may
continue in a neighbouring mapping), and its start must be loaded by the same
instruction forms as the module-array fallback. `types_field` is then `null`,
`types_count` is that run's length rather than an observed `typesCount`, and
Evidence is **inferred**. The run length is at least every referenced type
index but can differ from `typesCount`: a type-shaped pointer after the table
would lengthen it, and an unreadable slot (such as an unresolved relocation)
would end it early. Only the type indices the metadata references are read. A
second long-enough run anywhere, a run that a type-shaped neighbour extends
before the loaded address, a run touching a mapping end or a slot the loader
binds or leaves unresolved (its stored word is only a placeholder), and a covered
128-byte record whose two counts match but whose other fields are unusable all
leave `metadata-registration-not-found` rather than a guess; the search stops
at the second run. The length requirement only separates the type table from
other pointer runs when the metadata references most of it: on the one Master
build checked, the highest referenced index is 6,031 of 6,576 entries. A
metadata referencing few type indices usually
leaves several short runs and fails closed.

Counts use their declared 32-bit width independently of alignment padding.
The complete 128-byte registration must have unambiguous loader coverage. Its
used fields through byte 112 must be file-backed; a trailing declared zero-fill
range can cover the final unused fields. An unmapped or conflicting tail is
refused. These layouts follow the versioned [Unity 2022.3.8f1 producer header](https://github.com/MlgmXyysd/libil2cpp/blob/master/libil2cpp/Unity_2022.3/2022.3.8f1/il2cpp-class-internals.h#L596-L637)
(redistributed source) and the [AArch64 aggregate alignment rules](https://github.com/ARM-software/abi-aa/blob/2025Q1/aapcs64/aapcs64.rst#aggregates).
Dyld pointer ownership comes from the parsed bind stream, as in Apple's
[dyld analyzer](https://github.com/apple-oss-distributions/dyld/blob/dyld-1165.3/common/MachOAnalyzer.cpp#L1508-L1511), rather than the slot's placeholder word.
The padding, zero-fill-tail and unresolved-type cases have authored regression
fixtures; they do not add real Unity-build verification to the checks above.

Without `binary_path`, `binary` is `null` and the four binary collections are
empty in the complete producer report to indicate unrequested observations. Their summary counts, including state counts, are `null`, and native page requests report unavailable observations. This does not establish an empty native inventory. Missing native fields in historical Evidence remain unknown too.

### Generic method instances

`generic_instances: true` (CLI `--generic-instances`, needs `binary_path`) also
links the instances in `Il2CppMetadataRegistration.genericMethodTable`, as
Il2CppDumper does: each row's `genericMethodIndex` selects an `Il2CppMethodSpec`
(generic method definition plus class and method `Il2CppGenericInst`), and its
`methodIndex` selects a `genericMethodPointers` slot. Without the option both
fields below are `null` (not linked, so unknown), as are the summary counts
`generic_method_instances` and `generic_method_instance_states` and the seed
counts. The result adds:

- `binary.generic_methods`: `generic_method_pointers_field` (the address of
  `genericMethodPointersCount`), the pointer, table, method spec and generic
  instance counts, `generic_method_table_stride` and `issues` (each with the
  `row` it leaves unknown, the `address` of the contradicting row, method spec
  or pointer slot record, and a `message`);
- `generic_method_instances`: one row per table entry (row position is the
  table index) with `method_spec`, `method` (the recorded definition index,
  including invalid values, or `null` when the index cannot be read),
  `name`, and `state`, `address` and `rva` as in `method_addresses`: `code`,
  `no-body` for a zero pointer slot, or `unknown` exactly when an issue names
  the row.

Names follow Il2CppDumper's `GetMethodSpecName`, for example
`System.Collections.Generic.Dictionary<int, string>$$TryGetValue` or
`System.HashCode$$Add<int>`: namespaces only on the declaring type, nested types
joined with `.`, the backtick arity cut, `IntPtr`/`UIntPtr`/`TypedReference`
and no byref mark. These names do not depend on the byref bit, so version 27 is
covered.

Header versions do not separate the CodeRegistration layouts (27.0, 27.1 to
29 and 29.1/31 differ in the fields before `codeGenModulesCount`). Every layout for the header version is tried, and
exactly one must have a `genericMethodPointers` count and an invoker count that
bound every table row; the layout also fixes the row size (12 bytes, or 16 with
an adjustor thunk index). No layout agreeing fails as
`generic-method-registration-not-found`, more than one as
`ambiguous-generic-method-registration`. An empty table selects no layout:
the result has no rows, and `generic_method_pointers_field`,
`generic_method_pointers_count` and `generic_method_table_stride` are `null`.
A table of a few rows can still leave two layouts agreeing, which fails as
ambiguous rather than picking one. Metadata versions 24 and 39 and builds
without a static CodeRegistration (`code_gen_modules_field` `null`) or
MetadataRegistration (`types_field` `null`) fail as
`generic-methods-unsupported`: for version 24 the type-definition generic
container offset and the generic class layout have not been checked against a
real build, so it is refused rather than guessed.

After the layout is fixed, rows that contradict another table do not fail the
whole link: a method spec naming a method or generic instance out of range,
class or method arguments whose count differs from the generic container the
owner declares (none for a non-generic type or method), an owner whose generic
container index is out of range, a name that cannot be rendered, or a pointer slot that is unmapped, has an
unresolved relocation or points outside unambiguous executable file data adds
an `issues` entry, and that row is `unknown` with no address. A method spec
issue also leaves `name` `null`, even when the pointer slot is valid: the slot
would otherwise be reported under a definition nothing confirms. Capacity
refusals are never turned into issues. Rows that share one method spec
(Il2CppDumper refuses such a table) each get an issue at their row address that
names one other sharing row, and all of them lose `name` and become `unknown`.
A zero pointer slot is a `no-body` row and has no issue. Before any row is
resolved, the smallest row for every table entry is checked against the
remaining report budget; each row and issue is then admitted as it is retained.
Compact summaries omit `binary.generic_methods.issues` and keep its count in
`counts.generic_method_issues`; query `collection: "generic_method_issues"`
with `rows`, `indices`, `fields` and pagination. Select only the instance and
issue facts needed for the question. For a small report where both collections
are needed, `detail: "complete"` can cost less than a summary followed by two
pages. Paging saves irrelevant row text but adds calls and schema overhead; it
does not imply lower total latency or memory. See the
[completed-query measurements](verification/il2cpp-generic-instances-2026-10-24.md).
Like method addresses, these rows are derived from static tables; layout agreement
is structural evidence, not proof of runtime use.

Contributor-reported verification against Il2CppDumper's `script.json` (same
`Address` and `Name`):
macOS arm64 and x86_64 slices from Unity 2020.3.49f1, 2021.1.28f1 (version 27),
2021.3.45f2, 2022.3.30f1 (29), 2022.3.62f3 and 6000.0.84f1 (31); Android arm64
from 2022.3.62f3; and the Windows x64 build from 2023.2.13f1 named above
(`GameAssembly.dll` SHA-256
`a3ae7f6ecd1f671297b7d98d12713ef024062d93cd7a4205298102656c93b67a`). On every
build each linked instance matches an Il2CppDumper entry by address and name,
and Il2CppDumper lists no address-name pair that REA leaves out (Windows: 63,750
linked rows, 142 without code; Android: 5,152 and 44). This does not establish
names for versions 24 or 39, for type arguments that are open generic type
definitions, or anything about instances created at runtime. The Linux build
from 2023.2.13f1 keeps no static CodeRegistration and is refused.

For metadata version 27, type names are `null` and only type indices are
reported: versions 27.0 to 27.2 share that header number but place the
Il2CppType byref flag in different bits, so a rendered name could gain or lose
`&` without warning.

The builds checked are listed after the module search rules above.

| Reason                                  | Category    | Meaning                                                                                                      |
| --------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| `unsupported-container`                 | unsupported | Not a 64-bit little-endian Mach-O, PE or ELF image (ELF: AArch64 or x86-64 with dynamic section).            |
| `slice-selection-required`              | unsupported | A universal Mach-O was given without `binary_architecture`.                                                  |
| `ambiguous-slice-selection`             | unsupported | More than one universal slice matches the selected architecture label; select an exact subtype externally.   |
| `slice-not-found`                       | unsupported | The requested slice is absent, or a thin binary was given an architecture.                                   |
| `unsupported-pointer-encoding`          | unsupported | Mach-O chained fixups or Android packed (APS2) ELF relocations; pointers not decoded.                        |
| `malformed-container`                   | input error | The container headers are damaged.                                                                           |
| `code-gen-modules-not-found`            | input error | An image has no module record; often a binary from a different build.                                        |
| `ambiguous-code-gen-module`             | input error | More than one module record matches an image.                                                                |
| `code-registration-not-found`           | input error | No unique module table or executable-byte array candidate was resolved.                                      |
| `invalid-method-token`                  | input error | A token is outside its module's method-pointer rows, or a MethodDef row is reused within one image.          |
| `invalid-method-pointer`                | input error | A slot is unavailable or its nonzero address lacks unambiguous executable file coverage.                     |
| `metadata-registration-not-found`       | input error | No single MetadataRegistration or code-loaded type-table candidate was resolved.                             |
| `invalid-type`                          | input error | A type index or `Il2CppType` record is out of range, unmapped or malformed.                                  |
| `unsupported-type-kind`                 | unsupported | A valid type kind has no implemented rendering.                                                              |
| `generic-methods-unsupported`           | unsupported | Generic instances were requested for metadata version 24 or 39, or a build lacks either static registration. |
| `generic-method-registration-not-found` | input error | No CodeRegistration layout bounds every genericMethodTable row, or the generic tables are unreadable.        |
| `ambiguous-generic-method-registration` | input error | More than one CodeRegistration layout bounds every genericMethodTable row.                                   |

Format and selection failures name `binary_path`; capacity refusals remain typed resource errors. Failed linking preserves the metadata source identity, validated counts, selected binary path/architecture and its SHA-256 when observed, plus prior producer observations. It never publishes an incomplete native table as complete. The binary input is bounded to 1 GiB.

Scans yield cooperatively in bounded batches. Name-address retention and reverse-trie construction are each limited to 65,536 entries/nodes and fallback module-array candidates to 64 (`native-index-capacity`); exceeding capacity does not prove absence. Rendered type text has a 64 MiB UTF-8 cache-workspace guard, separate from the 64 MiB encoded-report admission, and 64 nested rendering frames (`native-type-text-capacity` / `type-nesting-capacity`). Genuine cycles are malformed; unsupported type kinds are explicit coverage failures. Native row/text admission runs before allocation or retention. Unused generic parameter names are read on demand from the same stable metadata snapshot. There is no cross-inspection file cache; validated immutable Evidence is reused for session views.

ELF RELATIVE writes into zero-fill are kept as a private virtual-pointer overlay. Unresolved supported-width symbol relocations, including RELA PLT entries, remain unknown only for the bytes their ELF ABI relocation type covers; an adjacent 32-bit relocation does not make a separate 64-bit method slot unknown. Stored zeros never establish no-body. COPY, TLS descriptor, REL, packed APS2 and other unsupported relocation encodings fail closed. Input bytes are unchanged.

ELF relocation tables and file-backed destinations may span adjacent load ranges when every range agrees on the file translation. Any overlapping zero-fill declaration makes those bytes ambiguous; REA refuses the table or relocation destination instead of choosing the stored file bytes. Missing file bytes remain distinct from conflicting owners: supported unresolved relocations outside file-backed memory retain their unknown overlay, while ambiguous destinations refuse linking. Registration coverage uses the same file/zero-fill ownership checks as pointer reads.

Native address queries batch exact 64-bit hexadecimal `addresses` and `states` (`code`, `no-body`, `unknown`), intersecting indices and pagination; `generic_method_instances` accepts the same filters plus `method_indices` (generic definition indices). Numerically equal address spellings match; original row indices and every shared-body alternative survive:

```json
{
  "source": {
    "kind": "retained-evidence",
    "evidence_id": "<parent_evidence_id>"
  },
  "view": {
    "kind": "il2cpp-metadata",
    "collection": "method_addresses",
    "addresses": ["0x180c56ed0"],
    "states": ["code"],
    "fields": ["address", "rva"],
    "offset": 0,
    "limit": 64
  }
}
```

## Ghidra function names

The CLI can turn a linked report into a
[`REA_GHIDRA_SEED_FILE`](installation.md) so Ghidra names every IL2CPP method
before auto-analysis:

```bash
rea inspect-il2cpp-metadata global-metadata.dat --binary libil2cpp.so \
  --ghidra-seeds il2cpp-seeds.tsv --json > /dev/null
export REA_GHIDRA_SEED_FILE="$PWD/il2cpp-seeds.tsv"
```

Each linked method becomes one `function` seed named `Namespace.Type$$Method`
(nested types joined with `.`, whitespace replaced by `_`), the Il2CppDumper
convention. Seeds are at `seed-base + rva`. The default base is where Ghidra's
loaders place the binary: `0x100000` for an ELF linked at 0, and the link base
for Mach-O and PE; `--seed-base 0x...` overrides it for a different import. When
identical code folding gives several methods one address, the first method names
the function and a `# folded <address> <kept> also <names>` comment line after
the seeds lists the others, so the kept name is visibly one of several. With
`--generic-instances`, linked generic instances are seeded after the method
definitions under their Il2CppDumper-style names; an instance sharing an
address with a definition or another instance is folded the same way. Ghidra still names a seeded function that is a thunk after its
target. The file is atomically published with exclusive creation; an existing destination is never replaced. Failed staging retains its cleanup owner for retry. Source digest and link/seed-base comments make the mapping inspectable. Unknown slots are skipped separately from observed no-body slots. `--seed-base` requires `--ghidra-seeds`; overflowing rebased addresses and names/outputs beyond the existing Ghidra protocol limits (2,000 name characters, 32 MiB file, 1,000,000 entries) are refused before publication. The CLI and reusable service use one formatter and owned output workflow; ordinary MCP inspection remains read-only.

## Failures

A file whose magic is not `0xFAB11BAF` fails as an unsupported target with
`unrecognized-magic`. The file may be encrypted or may not be IL2CPP metadata.
A version other than 24, 27, 29, 31 or 39 fails as an unsupported target with
`unsupported-version`.

Damaged metadata returns an input error (`invalid_format`) whose
message names one reason:

| Reason                    | Meaning                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `truncated-header`        | The file is shorter than the header.                                                                             |
| `unexpected-header-size`  | `stringLiterals.offset` is not the header size: 264 bytes for version 24, 256 for 27, 29 and 31, 380 for 39.     |
| `section-out-of-bounds`   | A section extends beyond the file, or a non-empty section starts inside the header.                              |
| `section-overlap`         | Two sections overlap. Zero-size sections are exempt and gaps are allowed.                                        |
| `record-size-mismatch`    | A section size does not divide into its records, or the record size differs from the one the index widths imply. |
| `type-index-width`        | The record used to derive the type index width implies no 1, 2 or 4 byte width.                                  |
| `index-out-of-range`      | A serialized index or range points outside its target collection.                                                |
| `nested-type-conflict`    | A type is listed as nested in two types, in itself, or in a cycle of declaring types.                            |
| `declaring-type-mismatch` | A method inside a type's method range names a different type, or a method lies outside its type's range.         |
| `image-range-overlap`     | Two images claim the same type definitions.                                                                      |
| `invalid-string`          | A name index is outside the strings section, its string is unterminated, or it is not valid UTF-8.               |

Record extents are checked for the decoded images, types, methods, fields,
properties, events, parameters, string literals, nested types, generic
containers, generic parameters and interface offsets. Other header sections
are checked for file bounds and overlap; their internal record layouts are not
decoded or validated by this inventory.

A version field that disagrees with the file's layout, for example a version
39 file relabeled as 29, usually surfaces as `unexpected-header-size` or
`record-size-mismatch`.

An empty range's start must lie between -1 and the collection size, which is
stricter than some runtime paths. String indices are byte offsets; a valid
offset may select a suffix of another NUL-terminated name.

An incomplete inventory is never reported as complete. Failures after a verified
snapshot retain partial source Evidence with its SHA-256, byte length and any
validated section row counts; these counts do not establish that names and
relationships were decoded. A file that changes during reading and a cancelled
request keep distinct errors. Decode checkpoints yield for cancellation, and
close waits for active work. Each reader admits one inspection at a time.
Resource guards bound the selected file to 256 MiB and the encoded complete
report to 64 MiB, checking row counts before allocation and JSON/UTF-8/base64 expansion during
decoding, before serialization. Names and identical literal spans are decoded
once within one stable file snapshot; no filesystem results are cached across
inspections. Ownership assignment also yields to cancellation. MCP also applies its
[response transport budget](mcp-contracts.md); a complete report within the
report limit can still require the summary and paging path.

## Outside this tool

- Decrypting or deobfuscating protected metadata.
- Linking Mach-O binaries that use chained fixups, ELF images with Android
  packed (APS2) relocations, and 32-bit images; adjustor thunks and invokers;
  generic method instances for metadata versions 24 and 39 or builds without a static
  CodeRegistration.
- Full method signatures beyond the rendered field, parameter and return type
  names, and type names for metadata version 27.
- Running Ghidra or another disassembler. `--ghidra-seeds` only writes a seed
  file for [`REA_GHIDRA_SEED_FILE`](installation.md); use the
  [native workflow](native-investigation.md) for native code.
- Metadata versions other than 24, 27, 29, 31 and 39.

Names come from the metadata file only. They do not establish which methods
were compiled into the native binary or how they behave at runtime.

## Real producer verification

`npm run verify:il2cpp:metadata -- --metadata PATH` exercises a caller-supplied
`global-metadata.dat` through the public CLI and MCP. It is opt-in, like
`verify:pcap`, because no real game metadata ships with the repository. Normal
inspection does not need it.

The follow-up was checked against the public Cpp2IL
[`Simple_2022_3_35` sample](https://github.com/SamboyCoding/Cpp2IL/tree/b5ad444b82267cb1e4b88b8b373c008105bdea52/TestFiles/Simple_2022_3_35):
version 31, 1,892,268 bytes, SHA-256
`2441635a7c234a1a34deccc6a9906d6f5abcbdab078a38b2bf488a52a4962c48`.
An independent byte-layout oracle matched all 36 images, 2,468 types and 12,409
methods. Corresponding managed DLLs independently matched names and ownership
for 35 images, 2,463 types and 12,406 methods; the generated image has no matching
DLL. This does not establish real-producer coverage for versions 29 or 39.

Compact native summaries omit the `binary.code_gen_modules` table and keep its
count in `counts.code_gen_modules`. Query `collection: "code_gen_modules"`
with batch `image_indices` or source `indices`, selected `fields` and pagination.
Module row `index` is its retained collection position; `image` joins the
metadata image collection. Scalar registration facts and both source identities
remain inline. Complete Evidence retains the original full table.
