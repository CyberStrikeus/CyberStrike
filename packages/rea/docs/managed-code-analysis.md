# Managed-code analysis

REA inspects .NET PE/CLI artifacts without loading or executing their code.
It can identify an assembly, inspect metadata and CIL, compare members across
builds, and connect declared native calls to supplied native-analysis evidence.
CIL is Common Intermediate Language, the instruction format used by managed
assemblies.

The seven shipped tools are:

| Task                                                                        | MCP tool                            |
| --------------------------------------------------------------------------- | ----------------------------------- |
| Identify an artifact and its managed deployment form                        | `inspect_managed_artifact`          |
| Inspect types, signatures, method bodies, calls, and field access           | `inspect_managed_members`           |
| List declared native calls and native implementation indicators             | `inspect_managed_native_boundaries` |
| Compare members across builds and map build-local tokens                    | `compare_managed_members`           |
| Check native call declarations against supplied export or function evidence | `verify_managed_native_boundaries`  |
| Import decompiled code against verified static member identities            | `import_managed_reconstruction`     |
| Add managed findings to an application graph                                | `project_managed_application_graph` |

Each has a matching CLI command: replace underscores with hyphens and prefix
the name with `rea`, for example `rea inspect-managed-artifact`.
Native-body bridge mapping and managed runtime execution are outside the
current tool set.

The canonical tool inventory is the
[build-generated catalog](mcp-contracts.md#generated-catalog).

## Inspect an assembly

```bash
rea inspect-managed-artifact /absolute/path/Assembly.dll --json
rea inspect-managed-members /absolute/path/Assembly.dll --json
```

Use the artifact result to identify the assembly and its metadata coverage.
Member results retain build-local tokens, signatures, CIL bodies, and decoded
relationships. Use an exact reported `full_name` with `--type` when a focused
inspection is needed; see [selected member inspection](#selected-member-inspection).
Compare separate builds with [member comparison](#member-comparison), preserving
their paths, digests, and selection scope.

### Field constant defaults

`inspect_managed_members` reads field-owned values from the ECMA-335 `Constant`
table without loading the assembly. Each selected field's `constant` contains
the declaration's row offset, element-type code, blob index and exact `raw_hex`,
plus its decoded `element_type` and `value`. For example, an `i4` declaration
with bytes `865d0000` returns `23942`.

Boolean, character, signed/unsigned integers, floating-point, UTF-16 strings
and class-null declarations are supported. `i8` and `u8` values are decimal
strings to avoid JSON integer precision loss. Floating-point negative zero,
NaN and infinities are the strings `-0`, `NaN`, `Infinity` or `-Infinity`;
`raw_hex` preserves their original bits. UTF-16 code units, including embedded
NULs and unpaired surrogates, are preserved.

`constant: null` means neither a Constant declaration nor `HasDefault` was
observed. Historical Evidence can omit the field entirely; omission does not
prove that the artifact has no default. Missing or duplicate declarations,
inconsistent flags, malformed values and unsupported element types return
`state: "unavailable"`, a limitation and partial coverage while retaining other
member facts. This decoding shares the existing metadata representation budget
and only decodes blobs for the selected fields.

Retained `managed-members` field pages can select `fields: ["constant"]` while
keeping original field identity and source offsets. These values are metadata
declarations, including enum members' encoded underlying constants, not observed
runtime state or inferred enum-name mappings. Parameter/property defaults are
not exposed by this field-focused reader. Member comparison still covers field
names, flags and signatures; it does not compare constant defaults.

The encoding follows [ECMA-335, Partition II, sections 22.9 and 23.1.16](https://ecma-international.org/publications-and-standards/standards/ecma-335/).

### Metadata overview and retained rows

The existing CLI and omitted/complete MCP detail return complete metadata
inventories. For identity and classification questions, select
`inspect_managed_artifact` with
`{"path":"/absolute/path/Assembly.dll","detail":"summary"}` on the first call.
This keeps the complete source in the session and returns a distinct linked
`inspect_analysis_view` overview with complete PE/CLI, classification and its
evidence, metadata status, module/MVID, assembly, frameworks, returned-row counts,
coverage/issues and limitations. No assembly is loaded or executed.

ECMA-335 permits empty metadata streams to be omitted. An absent `#Blob`
stream therefore does not prevent module or assembly identity from being read
when all blob indexes are zero; a nonzero reference to that missing heap is
reported as a missing-stream issue.

Use `normalized_result.parent_evidence_id` to page original rows:

```json
{
  "source": {
    "kind": "retained-evidence",
    "evidence_id": "<parent_evidence_id>"
  },
  "view": {
    "kind": "managed",
    "collection": "attributes",
    "offset": 0,
    "limit": 16
  }
}
```

Collections are `references`, `resources` and `attributes`; rows retain their
original values, nulls, order, metadata tokens and offsets. Pages retain source
metadata status and coverage. Exhaustion covers the returned parent collection,
not all possible metadata, and empty rows under partial/unavailable metadata do
not establish absence. Tokens are build-local and require the recorded artifact
SHA-256 and known module MVID for cross-observation matching.

Retained views do not repeat the parser or require the source file to remain
available. Portable views use the authenticated original Evidence inline,
including the existing `inspect-analysis-view` CLI. Session record lifetime and
export/import semantics remain unchanged. A server without Evidence retention
rejects selected summary before analysis; complete delivery remains available.

### Member summary and retained member rows

Complete `inspect_managed_members` delivery always includes the assembly-wide
`member_refs` and `exported_types`, which `type_names` does not narrow, so even
one selected or unmatched type can return megabytes. In MCP, select
`{"path":"/absolute/path/Assembly.dll","type_names":["Namespace.Type"],"detail":"summary"}`
to keep the complete source in the session and receive identity, metadata
status, the selection with its unmatched names, coverage/issues, the separate
user-string coverage, limitations and per-collection counts. Then page original
rows with view kind `managed-members`:

```json
{
  "source": {
    "kind": "retained-evidence",
    "evidence_id": "<parent_evidence_id>"
  },
  "view": {
    "kind": "managed-members",
    "collection": "call_edges",
    "offset": 0,
    "limit": 64
  }
}
```

Collections are `types`, `exported_types`, `fields`, `methods`, `member_refs`,
`call_edges`, `field_accesses` and `user_strings` (the literals). Each page names
its collection, retains original rows, order, tokens, signatures and body facts,
and carries the source selection and coverage; `user_strings` pages carry the
literal pool's own coverage. Older Evidence that never examined exported types
or user strings reports a null count and refuses those pages rather than
returning an empty one.

To find specific retained members without returning their IL anchors, select
exact names and defining types, then project columns:

```json
{
  "source": {
    "kind": "retained-evidence",
    "evidence_id": "<parent_evidence_id>"
  },
  "view": {
    "kind": "managed-members",
    "collection": "methods",
    "names": ["ParseNumber", "ParseReadNumber"],
    "declaring_types": ["Newtonsoft.Json.JsonTextReader"],
    "fields": ["name", "declaring_type", "signature"],
    "offset": 0,
    "limit": 64
  }
}
```

Filters are exact and case-sensitive; lists are alternatives and filters
intersect. An empty list matches nothing. Names select `name` in types,
exported types, fields, methods and member references; in call edges they select
`target_name`, and in field accesses `field_name`. Declaring-type filters select
`declaring_type` in fields/methods, `parent_name` in member references,
`target_declaring_type` in call edges and `field_declaring_type` in field accesses.
Types, exported types and user strings do not accept a declaring-type filter;
user strings do not accept a name filter. No display strings are reparsed.

`fields` accepts only columns of that collection. Omitting it preserves full
rows, including method bodies. Selecting `body` explicitly returns the full
recorded body and anchors; selecting no columns (`[]`) returns identity fields.
Projected or filtered rows add their original `source_index`; tokens and source
byte offsets remain, with defining/parent tokens or IL-site endpoints where
applicable. The page retains module/MVID, artifact digest, parent Evidence,
producer selection and source coverage. Full facts remain in the parent.

Paging offsets and totals count known matches in original order. `source_count`
counts the producer-returned collection; `unresolved_filter_rows` counts rows
that could match but lack a requested name/type. Those candidates remain unknown
and are excluded from the matched total. Exhausting the known matches does not
prove absence among unresolved or unexamined source rows.

#### CLI summary and saved member rows

The CLI accepts the same `complete` and `summary` detail choices. Omitted or
`--detail complete` returns complete Evidence. To receive a summary, choose a
new Evidence bundle destination so its original complete parent remains
available after the command exits:

```bash
rea inspect-managed-members /absolute/path/Assembly.dll --type Namespace.Type \
  --detail summary --evidence-bundle /absolute/path/evidence/members.json --json
```

`--evidence-bundle` writes the complete original Evidence in REA's canonical
bundle format. Its parent directory must exist, and it never replaces an
existing path. Relative paths resolve against the command's working directory.
The option also works with complete delivery when a saved bundle is useful.
Summary without a destination is rejected before analysis. A publication failure
returns a typed error with the completed Evidence under
`details.partial_observation`; it does not report successful summary delivery.
Cancellation before publication prevents the new output. Once atomic
publication has started, it can complete despite cancellation; a cancelled
delivery then retains the committed path and byte count under
`details.diagnostics.evidence_bundle`.

Copy `normalized_result.parent_evidence_id` from the summary into the
`source.evidence_id` field of the `managed-members` request above, then save that
small request as `members-page.json` and run:

```bash
rea inspect-analysis-view /absolute/path/evidence/members-page.json \
  --evidence-bundle /absolute/path/evidence/members.json --json
```

The view command authenticates the selected bundle and resolves that exact
parent ID. It does not reopen the assembly, so the original target may have
been moved or removed. Subsequent calls can select another collection or use
the returned `coverage.next_offset` to continue the same collection. An inline
source already includes its parent and cannot also select `--evidence-bundle`.

Summary changes delivery, while type selection still controls decoding and the
same inspection resource limits apply. Each separate CLI page reads and
authenticates the saved bundle; the full source is retained on disk.

## Shipped scope

The canonical parser admits PE/CLI bytes and their metadata/CIL without loading
an assembly. It reports observed implementation markers and unavailable facts;
it does not itself unpack .NET single-file hosts or infer a NativeAOT identity
from an ordinary native PE. It does not decode IL2CPP; use
[IL2CPP metadata](il2cpp-metadata.md) for the image, type and method names in a
Unity `global-metadata.dat`. Inputs without admitted CLI metadata do not
become managed assemblies through naming or routing guesses.
Inspect separately obtained components explicitly and preserve their identities.

For ordinary .NET single-file hosts, use the existing artifact tools to
[inventory and extract bundle members](dotnet-bundles.md), then inspect the
extracted assembly explicitly with the managed tools.

A valid implementation marker establishes a candidate native boundary, not
recovered native semantics or runtime behavior.

An assembly targeting [.NET Standard](https://learn.microsoft.com/en-us/dotnet/standard/net-standard)
declares API compatibility across multiple .NET implementations. REA preserves
that target in `target_frameworks` and leaves `runtime_family` as `unknown`
unless independent markers identify a runtime family, such as a ReadyToRun
signature.
When ReadyToRun is observed, `runtime_family` remains `modern-dotnet` even if
Unity or target-framework hints are also present; the separate hint evidence
is retained in the classification evidence list.

### Resource admission

The static provider admits regular input files up to 128 MiB before retaining
their bytes. Reads remain bounded if a file grows after admission. Metadata,
CIL decoding, and projected inspection records have a separate conservative
64 MiB representation budget; shared heap strings are cached, but repeated
output occurrences still consume that budget. These are inspection resource
policies, not PE format limits or a hard bound on total V8 heap use.

Path-based member comparison uses the same per-input snapshot policy and
inspects its two selected paths sequentially, retaining each inspection rather
than both full byte snapshots. The limit therefore remains a per-file resource
admission rule, not an aggregate comparison limit. Comparison Evidence keeps
the caller-selected paths as its parameters and artifact locations.

Input overflow returns a resource constraint. Decode or projection overflow
reports `resource-limit` with unavailable or partial coverage; omitted facts do
not become empty observations. Ambiguous PE section mappings are rejected
rather than interpreted according to section order.

Minimal Edit-and-Continue metadata marked by `#JTD` is not a standalone
assembly inventory. The pinned [.NET 9 reader](https://github.com/dotnet/runtime/blob/v9.0.0/src/libraries/System.Reflection.Metadata/src/System/Reflection/Metadata/MetadataReader.cs)
uses different reference widths for this mode, and delta handles require the
baseline and prior generations. The released
[metadata serializer](https://github.com/dotnet/runtime/blob/v9.0.0/src/libraries/System.Reflection.Metadata/src/System/Reflection/Metadata/Ecma335/MetadataBuilder.cs)
emits this marker with `#-`; the
[PE writer](https://github.com/dotnet/runtime/blob/v9.0.0/src/libraries/System.Reflection.Metadata/src/System/Reflection/PortableExecutable/ManagedPEBuilder.cs)
can embed that metadata root. REA reports `unsupported-metadata` at the marker
header before interpreting table rows, preserving the selected path, artifact
digest, parsed metadata version and stream names, and admitted PE/CLI facts.
Metadata status is partial; member and native
declaration inventories are unavailable. Empty collections do not establish
absence, and a requested type name is not declared unmatched. Ordinary
standalone `#~` and `#-` metadata keep their existing interpretation. This does
not add raw `.dmeta` input, baseline attachment or delta reconstruction.
Regression coverage uses authored metadata in a generated PE shell; it does
not establish naturally emitted application PEs, CLR loadability or a real
Edit-and-Continue execution.

### Selected member inspection

Member inspection admits type names, tokens, list ranges/counts, nesting facts,
module identity and their output representation before decoding members. If
later decoding or projection reaches the 64 MiB representation budget, the
result retains this type inventory with `coverage.state: "partial"` and the
original `resource-limit` coordinate. It does not return partially admitted
member collections: empty fields, methods, references and edges are unexamined,
not proof of absence; exported types, user strings and signature-resolution
attestation remain null. Summary and retained pages keep this partial coverage.
The capacity limit is unchanged. If metadata or the type inventory itself cannot
be admitted, the result remains unavailable.

Use the returned `types[].full_name` values to select declaring types before
their signatures and CIL bodies are decoded:

```bash
rea inspect-managed-members /absolute/path/Assembly.dll --type Example.Parser
```

MCP uses `inspect_managed_members` with
`{"path":"/absolute/path/Assembly.dll","type_names":["Example.Parser"]}`.
Repeat `--type` or supply multiple unique `type_names` for several types.
Names match the reported `full_name` exactly. Top-level names require that
namespace-qualified spelling. Nested declarations also accept their bare
`name`, including when their own namespace is nonempty; this can select several
types with that name. Selection uses the parsed TypeDef facts and comparison
uses the returned declaring types, rather than reconstructing scope from the
caller's spelling. Each type's `enclosing_type_token` records its enclosing
TypeDef. `nesting_read` distinguishes complete source rows (true), incomplete
current rows (false), and historical Evidence (null). A null enclosing token
alone does not establish that a type is top-level.
Each selected type also retains `name_sha256`, a framed digest of its namespace,
name and enclosing names. It uses the same bounded, cached owner as signature
type operands and remains available when selection omits the enclosing types.
It adds one fixed-size digest per returned type rather than repeated name paths.

The result preserves the requested names in `selection.type_names` and reports
unmatched names separately. If metadata names are unreadable, limitations retain
that uncertainty. With no selection, `selection` is null and whole-assembly
inspection keeps its existing resource policy. Selection restricts types,
fields, methods, call edges, field accesses and user strings; member references
remain an assembly-wide inventory, so output size is not guaranteed to be small.

Coverage describes the selected members. Comparisons leave members outside the
opposite observation's selection unknown, and application graphs report their
selected scope as partial. Neither makes an absence claim about the whole
assembly. Older member Evidence without `selection` remains readable. The
comparison resolves a member's declaring TypeDef token in its own source, then
checks that nominal `name_sha256` against the opposite selected type set.
Pairing, absence and aggregate selected-scope agreement share these retained
facts, including enclosing names, rather than requested spellings or display
labels. Equivalent requests can cover the same types, while the same display
name can select different nested owners. Such disjoint selected owners cannot
establish a member pair or added/removed status even when both inventories are
complete. Missing nominal identities cannot establish selected membership,
including historical selected Evidence that retains only display names;
the explicitly limited historical whole-inventory comparison remains available.
Incomplete selected inventories or missing identities leave aggregate agreement
unknown and coverage partial; known observed member pairs remain available.
Complete empty selected inventories agree even if their unmatched request names
differ. Whole-assembly and selected
inventories remain distinct scopes, and each source retains its exact request.
The `method_rows` interval records the examined zero-based MethodDef offset, row
count and full table total before type selection. A complete observation can
cover only that interval. Comparison keeps omissions from a method page unknown:
build-local row positions cannot prove member absence across builds. Historical
Evidence without this interval also cannot establish method absence; observed
pairs and field inventory comparisons remain available.

For MCP callers, request `detail: "summary"` and page the `types` collection
using the returned parent Evidence ID. Select one or more returned full names
in a subsequent `inspect_managed_members` request. Selection is a recovery path,
not a guarantee: a single type or the assembly-wide member references can still
exhaust the representation budget. A successful command exit means the Evidence
was returned; inspect `coverage.state` and `coverage.issues` before treating any
collection as complete.

### User strings

`ldstr` anchors keep their build-local `0x70` tokens. `user_strings.literals`
lists each distinct token loaded by an inspected method body once, in token
order, with its `#US` file offset and decoded value. Values keep their stored
UTF-16 code units, including unpaired surrogates. Token `0x70000000` names the
heap's empty entry at offset 0 and reads as `""`; any other item there is
malformed. The terminal flag is checked against ECMA-335 II.24.2.4, and the
length prefix against the width II.23.2 assigns. A difference is reported with
its byte offset as a user-string issue while preserving the readable literal.
Toolchain conventions can differ; this conformance observation does not
establish runtime rejection. A missing `#US` stream is one stream-level issue;
a malformed item is reported against its token. User strings carry their own
coverage: any of these makes `user_strings.state` partial and lists the issue
in `user_strings.issues`, while the member `coverage` and `metadata.status` are
unaffected, and readable literals remain. The state is also partial when an
inspected method's CIL was not fully decoded (a malformed exception section
alone does not count) or a method that may belong to the inspected types was
not inspected (its row could not be read, or its type's name could not be read
under a `type_names` selection), because `ldstr` instructions there were not
observed. Normalized CIL digests do not include decoded values.
`compare_managed_members` does not decode or compare literals: an unchanged
method does not establish unchanged strings, and the comparison says so in its
limitations. Older member Evidence without `user_strings` reads as `null`: not
examined.

### Edge target declaring types

`member_refs[].parent_name`, `call_edges[].target_declaring_type`, and
`field_accesses[].field_declaring_type` name the type that declares each
target. Referenced spec signatures validate encoded type coordinates against
the metadata tables, including nested type arguments and custom modifiers.
TypeRef resolution scopes are checked transitively with cycle detection;
readable names survive malformed scopes as partial evidence.
TypeDef and TypeRef names use the namespace-qualified `full_name`
form, and nested types keep bare names. A generic-instantiation TypeSpec
parent names its generic type, such as ``System.Collections.Generic.List`1``.
Other well-formed TypeSpec forms and ModuleRef or MethodDef parents stay
`null`. A `method-spec` call edge reports the name and declaring type of the
generic method it instantiates. A field access is named only by a field or a
field-signature MemberRef. TypeSpec and MethodSpec blobs are decoded with the
member-signature grammar, and a MethodSpec must instantiate a generic method
with as many type arguments as it declares. Malformed or unsupported rows and
blobs, and arity mismatches, make coverage partial. A readable MethodSpec
method column that names a method, or a TypeRef whose resolution scope is
invalid, keeps its name.
Older member Evidence without these fields reads them as `null`: unknown.

## Analysis objective

Start by identifying the artifact with `inspect_managed_artifact`, then inspect
its types and CIL with `inspect_managed_members`. Use [member comparison](#member-comparison)
for another build, and [managed/native boundary rules](#managed-native-boundaries)
when matching declared native calls to supplied native Evidence. Static inspection
does not load or execute the assembly. Reconstructed structure and unresolved
native/runtime questions retain their own authority and coverage.

When the selected source changes during acquisition or no longer matches its
admitted digest, inspection and comparison report retryable `artifact_changed`;
any completed hash retains the observed digest and byte count. Retry against a
stable source. This differs from corrupted retained Evidence, which remains an
Evidence-integrity failure. Malformed selected PE input has the same input-format
classification in inspection and comparison. Its issue identifies the selected
filename and argument: `path` for inspection, or `leftPath` / `rightPath` for CLI
comparison. A failed right-side comparison retains the completed left observation.

## Member comparison

Call edges and field accesses retain `il_offset` as their instruction site within
the caller's build-local method token and artifact identity. Their
`target_identity_sha256` combines the existing enclosing-type nominal digest,
member name and resolved decoded signature. Comparison joins edges to their
instruction sites rather than array positions and compares these identities;
display labels alone cannot establish equal targets. Same-named nested types
under different enclosing types and different overload signatures stay distinct.
This is nominal metadata identity, not assembly resolution or runtime binding.
Historical edges without a site or identity, unresolved/cyclic type scopes,
TypeSpec owners and unresolved MethodSpec instantiations retain unknown target
equivalence. Valid MethodSpecs combine the base member identity with the
resolved instantiation signature, preserving generic argument distinctions.

Names and semantic labels do not establish durable member identity. Comparison
preserves observed differences, structural inferences, and unknowns separately.

Cross-version matching first pairs members of the same declared type and name.
A current declared type uses its observed `name_sha256`, so same-named nested
types in different enclosing types stay distinct even in selected inventories.
Malformed, missing, contradictory, cyclic or over-deep enclosing identity remains unknown;
the comparison preserves display names without using them to repair that gap.
Historical observations retain an explicitly limited bare-name mode when either
side predates the identity facts. A known current identity gap still remains
unknown beside a historical observation. Matching then pairs
methods by exact CIL/signature identity, then by signature, then by
structural body shape; fields by signature. Exact CIL/signature identity
requires equal raw CIL digests and decoded fingerprints. Equal decoded
fingerprints alone cannot establish an exact match: they omit switch targets
and collapse distinct NaN encodings. Only then may a remap pair a
renamed or moved member across declared types or names: a method by exact
CIL/signature identity or structural body shape, a field by exact decoded
signature. A remap never takes a member whose own declared type and name remain
unpaired on the other side, so a member is never taken from its own changed
counterpart. A member whose declared identity is unresolved could belong to any type. It
never makes a declared-identity pair, and any remap group it joins stays
ambiguous. Unresolved same-named counterparts prevent definitive added/removed
claims, while observed names and tokens remain available in the result.
The exact-signature key uses names only as part of that
full tuple; names alone never select a pair. Duplicate tuples remain ambiguous
rather than being paired by token order. Every round compares signatures by
`resolved_sha256`: the raw signature with each TypeDef or TypeRef operand
replaced by a digest of that type's namespace and name, hashed as separate
values so `A` + `B.C` differs from `A.B` + `C`, after its enclosing types for a
nested type (`Outer/Inner`). The defining assembly is not part of the name:
a TypeDef and a TypeRef with the same namespace and name compare as the
same nominal name, and a TypeRef's ResolutionScope assembly is ignored, so a type
forwarded from one assembly to another still pairs. Two different types with
the same full name in different assemblies therefore have equal name digests.
Comparison reports this scope limitation inline; it does not establish CLR
type identity or runtime binding equivalence.
Nesting deeper than 64 levels is not named, and such a signature compares by
its raw digest. Comparison keys keep resolved and raw digests apart, so a raw
digest never pairs with an equal resolved one.
Raw signature bytes name types by metadata row, and rows are build-local, so
the same signature usually has different raw bytes in two builds. A signature
that names no types resolves to its raw digest. When an operand cannot be
resolved, such as a TypeSpec, or when REA could not parse the signature, the
raw digest stands in. Missing or unreadable TypeDef and TypeRef operands are
reported as coverage issues. Invalid NestedClass rows retain their failure
reasons and withhold TypeDef signature identities; type names and nesting are
parsed once by their shared owner. Each current inspection records
`signature_resolution: "type-names-v2"`, even when none of its operands can be
resolved. Version 2 also appends readable names to signature operands, for
example `class:7772 (AnalysisJob)`. Coded indexes remain build-local references;
names are display text and do not change raw or resolved signature digests.
Nested names use `Outer/Inner`. Generic instantiations keep their decoded
arguments, for example ``class:9 (System.Collections.Generic.List`1)<string>``;
custom modifiers are named too. Valid but unresolved TypeSpecs, invalid scopes,
unreadable type names, cycles and nesting beyond the cap keep their raw operand
spelling. Invalid or missing metadata coordinates retain the existing malformed
signature result and source issue; rendering does not bypass validation.
Version 1 Evidence remains readable and compares using the same digest policy.
Historical Evidence defaults this attestation to `null`. When either
observation predates resolution, both sides compare raw digests, which pair only where type rows agree,
and the comparison reports that limitation. The signature is exact whether or
not REA decoded it, so undecoded signatures pair by that tuple too, but they
never enter structural rounds. An unmatched member is therefore reported as
`unknown`, not added or removed, when its own signature was not decoded or when
the other side has an unpaired member, one-sided or ambiguous, with the same
declared type and name whose signature was not decoded. When both observations
attest type-name resolution, a decoded signature that still compares by its raw
digest is treated the same way: an unmatched member with one, or beside an
unpaired same-named member with one, is `unknown`, because its raw bytes name
types by build-local row. A matched unresolved signature also remains unknown
unless another observed dimension establishes a change; identical row bytes
can reference different TypeSpec contents. Its resolution limitation is retained
even when another dimension changes.

For a matched method, an unavailable or partial body makes body-shape facets
unknown while preserving observed signature differences. For complete bodies,
a difference in either the raw CIL digest or the decoded fingerprint is reported
in the `cil` dimension, including reordered switch targets with equal decoded
fingerprints. Structural identity compares resolved signatures, the limited
decoded-CIL tuple fingerprint,
constants, and bounded shape context. It reports all candidates at the winning
score and remains ambiguous when the evidence does not distinguish them. The
digest does not itself remap metadata tokens.

Matched methods also compare aligned references. `call-shape` and
`field-shape` report opcode and operand-kind differences; `call-target` and
`field-target` report differences in the observed target declaring type or
name from `call_edges` and `field_accesses`. Target tokens remain build-local
and are not compared across artifacts. Missing or unaligned edges and missing
target names leave that facet unknown; equal names do not establish overload
identity or runtime dispatch. `exception-shape` compares clause flags and
ranges. `exception-target` compares the nested nominal catch-type name digest;
for resolved TypeDefs it also compares the enclosing assembly identity. A
different known name or assembly scope establishes a change. Equal TypeRef
names remain unknown because their resolution scope is not resolved here.
Exception tokens remain in the source facts but are not cross-build identity;
an unresolved catch type leaves that facet unknown. The method body retains the
display `class_type`, nested `class_type_name_sha256`, and whether its local
token identifies a TypeDef. A TypeDef digest alone does not prove identity
without matching assembly identity. Missing assembly identity and equal TypeRef
names leave the comparison unknown.

Tokens are always remapped through observed structure. A caller cannot carry
`0x06001234` into a new MVID and assume it names the same method.

## NativeAOT metadata recovery

NativeAOT removes the ordinary CIL method bodies, so a CIL decompiler cannot
reconstruct those bodies as C# source. The executable remains a native target
for Hopper or Ghidra, where decompilation produces pseudocode and analyst
inference. This is a different route from ordinary managed member inspection.

NativeAOT is not limited to Windows `.exe` files. The native image can be PE,
ELF, or Mach-O, and NativeAOT can also publish shared libraries (PE DLL, ELF
`.so`, or Mach-O `.dylib`) with explicitly exported entry points. Identify the
image from its bytes and loader metadata, not its filename extension. When the
image is inside an application bundle, inventory or extract the bundle first
and carry the component identity into native analysis. Matching PDB, ELF debug,
or dSYM sidecars can add symbol evidence when the selected provider supports
them; verify their identity and keep them separate from observations made from
the executable itself. [Microsoft's NativeAOT overview](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)
lists supported OS/architecture targets and deployment limitations, while its
[native library guide](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/libraries)
describes exported shared-library entry points.

REA offers a built-in read-only snapshot parser for x64 PE/RTR 9.1 metadata and
an optional Linux headless Ghidra adapter for annotations and broader recovery.
The adapter requires a locally built `REA_GHIDRA_NATIVEAOT_JAR`; REA does not
install it or its toolchain. The [NativeAOT guide](ghidra-nativeaot.md) defines
these routes, their layout/host restrictions, derived-memory provenance, and
verification coverage.

REA's experimental Windows Ghidra boundary admits native x86, x86-64, ARMNT (Thumb-2) and ARM64 PE
applications and DLLs for static analysis. For x64 PE NativeAOT, the read-only
parser also runs there; the [NativeAOT guide](ghidra-nativeaot.md) lists what a
Windows host covers.

For NativeAOT analysis, preserve the selected native artifact's path and digest
and report recovered type data with its returned provenance. Linking those types
to native function addresses requires verified
provider evidence; names or vtable similarity alone do not prove that a native
function implements a specific managed method.

<div id="managed-native-boundaries"></div>

## Managed/native boundary rules

`verify_managed_native_boundaries` compares declared P/Invoke module and entry
point identities with supplied native export or function evidence. Name/module
matches establish declaration links; they do not establish that a call executed.
When either side lacks a usable module identity, a matching name remains
unresolved and retains the candidate evidence; REA reports a module mismatch
only when both identities are available and their format-specific comparison
establishes a difference. ELF module names retain case, PE module names compare
case-insensitively, and a case-only match for Mach-O or an unknown format stays
unresolved because the available Evidence does not establish case behavior.
For PE imports, `.dll`, `.exe`, a trailing period, and absolute paths suppress
appending `.dll`; other names may also be tried with `.dll`. Unix loaders use
the platform suffix (`.so` or `.dylib`) and `lib` prefix variations. A suffix
already present at the end of the name or before a period still gets an
appended-suffix variation, so Linux can match `nativedep.so.6` with
`libnativedep.so.6`. The `lib` prefix is omitted when the name contains `/`, and
absolute paths are used as supplied. POSIX paths keep backslashes as literal
characters. These candidates follow [Microsoft's native library loading rules](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/native-library-loading).
These filename rules compare declared and observed identities; they do not
establish which library the runtime loaded.

Signatures retain their decoded fields, but a Field or MethodDef row whose
signature has the other member kind is malformed and cannot establish an
unchanged signature. Comparison retains exact byte-based pairs for malformed
signatures, including empty, truncated, or invalid headers, but reports them as
unknown with a `signature-malformed` limitation when no change is observed.
This applies to historical Evidence without signature-resolution attestation as
well. Runtime-provided methods are counted separately in
`native_implementations.runtime_provided`; they have no file-backed native body
for this workflow to map and do not increase `native_body_unresolved`. Historical
verification Evidence without this separate count leaves it unknown (`null`).

An empty declared import name remains unchanged in verification Evidence and
produces no native-name candidates. With a supplied PE native context and
`no_mangle: false`, an unspecified charset includes the ANSI `A` candidate;
`auto` includes the Windows Unicode `W` candidate. Other native formats do not
inherit these Windows defaults. Known ELF and Mach-O contexts use the declared
entry point without A/W suffixes or Windows stdcall decoration, including when
the metadata declares an explicit ANSI or Unicode marshalling charset. The
original charset and calling convention remain unchanged. This follows the
[.NET runtime's platform-specific entry-point lookup](https://github.com/dotnet/runtime/blob/v10.0.0/src/coreclr/vm/method.cpp#L3134-L3177).
Windows name decorations are static inferred candidates;
exact spelling still suppresses decoration and no runtime binding is proven.
The mapping follows [Microsoft's charset guidance](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/charset).
Partial input coverage records a residual question even when no unresolved
individual boundary was produced. Selected literal inventories likewise remain
partial when unknown MethodDef ownership can hide a selected body.

Metadata tokens are not native addresses. Native body mapping for C++/CLI,
ReadyToRun, NativeAOT, and IL2CPP requires separately verified format and provider
support. The managed static tools do not recover those mappings. The optional
[Ghidra NativeAOT extension](ghidra-nativeaot.md) has its own supported boundary.

Declared import inventory supports a bounded positive claim. Its absence does
not exclude dynamic resolution, generated code, protected code, native helpers,
or server-side behavior.

## Application graph relations

`project_managed_application_graph` turns member Evidence into `contains`
edges for declarations, `imports` edges for P/Invoke declarations, and two
relation kinds read from method bodies:

- `calls` links two `managed-method` nodes when a `call`, `callvirt`, `newobj`
  or `jmp` site in the caller targets a MethodDef in the inspected module.
- `accesses` links a `managed-method` node to a `managed-field` node for each
  field it loads, stores or takes the address of.

Each edge stands for every site between one source and one target. Its
properties carry `site_count` and per-opcode `opcodes` counts; `accesses`
edges also list `access` as `read`, `write` and/or `address`. Edge evidence
links the member Evidence.

Some sites are counted rather than projected: calls to MemberRefs (members of
other assemblies or of generic type instantiations), generic method
instantiations (`MethodSpec`), unknown targets, `ldftn`/`ldvirtftn` function
pointer loads, recursive self-calls (the graph has no self-loops), MemberRef
fields, and sites whose method or field node is absent, for example under a
type selection. Limitations name each counted class, and graph coverage is
`partial` with `omitted_count` equal to the omitted sites when nothing else is
incomplete. A missing `calls` edge is therefore not evidence that a method is
never called.

## Evidence record shape

Member comparison, application graph projection, and managed/native verification
authenticate supplied inspection Evidence and check that any subject SHA-256
matches the normalized artifact SHA-256. A valid Evidence ID alone does not
establish that those two identities agree. Evidence without a subject remains
usable, with no subject digest available to cross-check.

Artifact inspection returns the selected path, byte length and SHA-256, observed
PE/CLI classification, assembly and module identities, and metadata coverage.
Member inspection binds build-local tokens, signatures, row offsets, method
bodies, and decoded relationships to that artifact and MVID. Missing or malformed
facts remain explicit in coverage and per-member status.

Metadata table streams may carry the CLR-compatible `ExtraData` extension
(`HeapSizes` flag `0x40`), which Microsoft readers honor although it is not
specified by ECMA-335. REA skips its fixed four-byte word after the row counts
before decoding table rows; the word's value is not a length. An incomplete
word is reported as a metadata coverage failure at its file offset, without
reading beyond the declared table stream.

For unoptimized `#-` metadata, nonempty `FieldPtr` and `MethodPtr` tables
translate TypeDef list positions to physical member definitions. REA resolves
these indirections for member ownership and local attribute-constructor types;
field and method tokens still identify the original definition rows.
`field_list` and `method_list` retain the metadata's list coordinates, which
refer to the pointer table when present rather than necessarily contiguous
definition rows. Invalid or nonmonotonic list coordinates and malformed or
ambiguous pointers leave affected owners unknown with partial coverage while
preserving readable member and attribute facts.
The retained inverse indexes are admitted against the existing representation
budget before allocation.

Custom-attribute `type_name` uses `Outer+Nested` when its local TypeDef or
TypeRef enclosing chain is readable. It remains `null` when the constructor's
type or required enclosing facts cannot be resolved.

`exported_types` reports ExportedType rows as declared. Facade assemblies such
as .NET `System.Runtime.dll` provide their types this way: `forwarder: true`
marks a type forwarder, and `implementation_token` names the AssemblyRef, File,
or enclosing ExportedType row that implements it. REA does not load the
implementing assembly to resolve the forwarded definition, and
`compare_managed_members` does not compare exported types. Member Evidence
recorded before this field existed reads back with `exported_types: null`,
which means the table was not examined.

CLI `#GUID` heap values retain their exact 16-byte GUID text. REA does not impose
RFC 4122 UUID version or variant bits on MVID, EncId, or EncBaseId because
ECMA-335 metadata does not require those bit patterns. Tokens and RVAs are
build-local coordinates, not durable cross-build identities or native addresses.
Field and method signatures validate embedded TypeDefOrRefOrSpec operands
against the artifact's metadata tables. An invalid operand leaves the member
name and raw signature digest available while marking that signature malformed
and coverage partial.
A fat method header's nonzero LocalVarSigTok must name an existing StandAloneSig
row whose blob is a structurally valid LocalVarSig. REA validates its local
types and exact blob coverage, retaining `local_var_signature` with the raw blob
digest and whether named types, modifiers, or generic variables require metadata
or declaring context. Historical Evidence defaults this field to null. An invalid
token or malformed signature leaves decoded CIL anchors intact but marks the
body malformed and coverage partial. Unsupported local type encodings retain
the readable body with partial coverage. Zero continues to mean no locals
signature. Raw table tokens are not cross-build identities. Comparison uses
validated context-free signature digests; signatures requiring metadata or
declaring context remain unknown across artifacts.

## Decoded-CIL fingerprint

`inspect_managed_members` exposes two method CIL hashes with different byte
boundaries:

| Field                  | Input                                                                                                     | Excluded from the digest                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `il_sha256`            | The exact `il_size` raw CIL bytes after the tiny or fat method header                                     | Method header, locals signature blob, alignment, and extra sections including exception clauses                                                               |
| `normalized_il_sha256` | UTF-8 `JSON.stringify` output for the instruction-order array of `[opcode, operand_kind, operand]` tuples | Instruction offsets except projected scalar branch targets, switch targets, resolved metadata/string identities, method header, locals, and exception regions |

The normalized field is available only when the entire CIL stream decodes with
status `present`. A malformed or absent body reports `null`. The tuple format
is defined here.

Tuple operands use these exact projections:

- operand-free instructions: `none` and `null`;
- metadata and user-string operands: the build-local token as lowercase
  `0x`-prefixed eight-digit hexadecimal;
- scalar branches: the target CIL byte offset as a decimal string;
- `switch`: the case count as a decimal string, without target offsets;
- signed integer and variable operands: decimal strings; floating-point
  operands: JavaScript's `String` representation of the decoded IEEE value.

For `ldtoken` MemberRef operands, `operand_kind` follows the parsed member
signature (`field` or `method`); if that signature does not establish the kind,
the anchor keeps the generic `token` classification.

Opcode names retain short/long forms and prefix opcodes. This makes the value a
reproducible decoded-tuple fingerprint, not a canonical semantic CIL identity:
it does not resolve tokens across MVIDs, does not commit full control flow or
exception semantics, and does not replace the raw CIL digest. Cross-build
comparison requires equal raw CIL digests as well for exact CIL/signature
matches and reports ambiguity when structural evidence is insufficient.

For example, a present body (including any valid declared locals signature)
whose IL is `nop; ret` serializes exactly as
`[["nop","none",null],["ret","none",null]]` and has digest
`5e5fad7741cb44bca3a4f045546b7449990da343f612f5f34c0ca30e9eee0636`.
This vector specifies the tuple order, `null` handling, absence of whitespace,
UTF-8 encoding, and lowercase hexadecimal output.

## Tool and packaging boundary

The production parser is REA-owned TypeScript and ships with the existing Node
application. Deterministic conformance uses source-owned byte-built PE/CLI
fixtures and expected semantic facts. An optional real ILSpy lane runs only when
its executable is explicitly supplied; the default lane does not establish
independent pinned-oracle parity. Production inspection needs none of those tools.

- `ICSharpCode.Decompiler`/`ilspycmd` can supply reconstruction inference.
  A BYO reconstruction import records the supplied version
  and remains non-canonical. When `REA_ILSPY_CMD_PATH` points to an absolute
  runnable `ilspycmd`, `verify:managed` runs a source-owned real ILSpy oracle
  and imports its C# output as reconstruction inference against exact static
  member Evidence.
- The package contains no .NET runtime, SDK, ILSpy installation, proprietary
  assembly, or compiled conformance fixture.
- Setup never installs or upgrades those tools. Doctor may inspect an explicit
  optional path without changing it.

Real-tool downloads used in development or CI require exact package coordinates
and SHA-256 lock entries. They are cached outside the source tree and restored
into isolated directories. Updating any coordinate requires review of license,
runtime, supported host, output contract, and conformance results.

Target platform is not host support. The canonical parser must inspect
Windows-produced PE/CLI bytes on REA's supported Linux and macOS hosts with the
same result. Pinned Windows oracle jobs may provide additional conformance, but
do not establish that the REA managed analysis workflow has been verified on a
Windows host. The [experimental Windows Ghidra boundary](windows-ghidra-p0.md)
has its own host and provider verification scope. Native
ReadyToRun, C++/CLI, NativeAOT, or IL2CPP coverage is additionally constrained
by the selected Hopper/Ghidra host and format matrix.

## Conformance verification

The current lane uses source-owned byte-built fixtures and malformed-input
regressions, with optional operator-supplied applications and ILSpy verification.

Run the deterministic lane with `npm run verify:managed`. See
[testing](testing.md#real-toolchain-verification-lanes) for prerequisites and
coverage. Generated outputs belong outside tracked fixture directories and must
not remain after verification or packaging.

Verification compares semantic facts, not decompiler text. It checks resource
ceilings, deterministic ordering, complete cleanup, CLI/MCP parity, Evidence
commitments, packed-package behavior, and target-free MCP startup. A parser and
an oracle disagreeing on malformed input is investigated explicitly; one tool's
acceptance does not automatically make the bytes valid.

## Operator-local osu! benchmark

The optional osu! benchmark accepts only paths and expectations supplied by the
operator. Run it with:

```sh
REA_MANAGED_APP_MANIFEST_PATH=/absolute/managed-app-manifest.json npm run verify:managed
```

`verify:managed` always runs a source-owned manifest-verifier self-test first.
If `REA_ILSPY_CMD_PATH` is set to an absolute `ilspycmd` path, it also runs a
source-owned ILSpy oracle: version discovery, class listing, bounded C# output
for a pinned fixture type, and import through `import_managed_reconstruction`.
The verifier prints only command/version, executable and output digests,
Evidence IDs, method locks, and compact fixture identity; it does not print
decompiled C# text. A failing ILSpy oracle fails the verifier because it is an
explicit real-tool claim, but leaving `REA_ILSPY_CMD_PATH` unset keeps the
oracle disabled.

When `REA_MANAGED_APP_MANIFEST_PATH` is set, the manifest's target path may be
absolute or relative to the manifest file. A compact manifest contains:

```json
{
  "label": "operator-local osu!stable semantic slice",
  "target": {
    "path": "./osu!.exe",
    "sha256": "<exact target digest>",
    "mvid": "<exact module MVID>",
    "assembly_name": "<expected simple name>",
    "runtime_family": "dotnet-framework",
    "managed_architecture": "x86"
  },
  "methods": [
    {
      "label": "operator-local semantic label",
      "token": "0x06000000",
      "signature_sha256": "<raw signature blob digest>",
      "il_size": 0,
      "il_sha256": "<raw CIL byte digest>",
      "normalized_il_sha256": "<digest>"
    }
  ],
  "application_graph": {
    "expected_node_kinds": [
      "artifact",
      "managed-assembly",
      "managed-module",
      "managed-type",
      "managed-method"
    ],
    "feature_traces": [
      {
        "label": "operator-local feature label",
        "method_token": "0x06000000",
        "seed": "<method name, API name, string, or digest to trace>",
        "match": "exact",
        "case_sensitive": true,
        "min_matched_seeds": 1
      }
    ]
  }
}
```

Before evaluating methods, the verifier fails closed on target SHA-256, MVID,
assembly name, runtime-family, and managed-architecture mismatches whenever the
manifest supplies those fields. It then pages each declared MethodDef token
directly by row, so selected methods do not need to appear in the first member
page of a large application. Optional `il_sha256` locks the exact raw CIL bytes
in addition to REA's decoded-instruction-tuple digest. That normalized field
has the byte boundaries documented above and is not a complete semantic CIL
identity.

The optional `application_graph` block reuses those exact-build method
commitments. For each referenced MethodDef token, the verifier builds a bounded
managed application-graph projection from the authenticated artifact and the
single selected member page, then checks requested node kinds and feature-trace
seed matches. This proves only that the selected static facts enter REA's graph
and tracing vocabulary for that exact local build; it does not execute the
application, inspect arbitrary unlisted methods, or infer runtime behavior.

Output contains assertion status and compact identities only: file name,
target SHA-256, MVID, assembly name, runtime-family, managed architecture,
method tokens, method names, signature digests, IL sizes, normalized IL
digests, graph Evidence IDs, node-kind summaries, and trace seed hit counts. It
does not print method bodies, reconstructed C#, application data, runtime
telemetry, account/service details, full filesystem inventories, or the
target's absolute path. The manifest and target remain outside git.

The benchmark may prove that REA reproduces selected facts for that exact local
build. It cannot establish general support on its own; source-built conformance
remains the admission requirement.

## Runtime behavior boundary

Managed inspection does not execute assemblies or observe CLR internals.
Questions about actual behavior remain unknown until supported runtime
evidence is collected. A direct process capture can retain declared inputs,
outputs, filesystem and protocol activity for a target run; it does not prove
which managed methods executed or how the CLR resolved them.

## Method metadata during build comparison

Managed member comparisons report a `metadata` dimension when an observed
MethodDef flags or implementation flags value differs, including accessibility
or synchronization changes. Observed method-body `init_locals` and `max_stack`
differences also contribute to `metadata`, even when CIL decoding is incomplete.
For complete bodies, presence or absence of a locals signature also contributes;
the locals table token is build-local and is not compared. Different validated
context-free LocalVarSig digests report a metadata encoding difference without
asserting a semantic type change. Equal digests establish unchanged bytes only
when neither signature requires metadata or declaring context. Historical
unrecorded signatures and context-dependent signatures keep local identity
unknown, preserving any independently observed changes. The same method token
in an artifact with the same authenticated SHA-256 identifies the same local
signature bytes, including for retained historical Evidence.
An unavailable header value keeps body coverage unknown rather than establishing
equality or a difference. These comparisons are separate from the CIL/signature
matching tiers: identical instructions do not establish unchanged method metadata.
The reported difference is static metadata evidence, not proof of runtime behavior.
