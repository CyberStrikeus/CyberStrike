# Static Android APK analysis

REA wraps an existing headless JADX engine through `src/android/`. Its source is
kept as an unmodified, commit-pinned Git submodule; see
[upstream provenance](https://github.com/morluto/rea/blob/main/third_party/README.md). CLI and MCP use the same
application workflow and return artifact-bound Evidence inline.

This family is present on repository main and in npm 4.1.0. Check the
[released package boundary](installation.md#released-package-and-main) and the
connected server's tool list before selecting it.

On Linux, JADX launches an REA-owned process and requires a procps-compatible
`ps` on REA's `PATH`; see the shared
[Linux process prerequisite](installation.md#linux-owned-process-prerequisite).

## Optional package delivery

The MCP `inspect_android_package` request keeps complete output when `detail` is
omitted or `"complete"`. Select `detail: "summary"` explicitly to receive all
package, SDK and permission declarations, engine identity and class/resource
counts without decoded manifest text or duplicate raw provider replies. A
retaining session keeps the complete original Evidence and returns a distinct
linked `inspect_analysis_view` summary. This changes delivery, not JADX analysis.

Use the returned `normalized_result.parent_evidence_id` with
`inspect_analysis_view`, source kind `retained-evidence`, and
`view: {kind: "android", facet: "manifest", offset: 0, limit: 4096}` to read the
exact decoded manifest without reopening the APK. Offsets and limits count UTF-16
code units; follow `coverage.next_offset`. The page preserves `source_status` and
`reported_total_bytes`: exhausting retained text does not make a partial decoded
manifest complete. Complete source Evidence remains exportable under the existing
session lifetime. Servers without retention reject summary before starting JADX.
One-shot CLI output remains complete by default. Select `--detail summary` with
`--evidence_output /local/capture.json` to retain complete Evidence before returning
a linked view. Older servers require the existing complete request after schema discovery. APK authenticity and runtime behavior remain
unverified.

## Manifest component projection

`inspect_android_package` also returns a static inventory of declared
activities, aliases, services, receivers and providers from the decoded
manifest. The binary XML decoder preserves component class spelling, including
`$` in nested classes, without applying JADX class aliases. `declared_name`
preserves the decoded source attribute; `name` resolves a
relative name only when the manifest package is known and the resolved copy
fits the UTF-8 byte budget. An unresolved package or exhausted name budget
retains the declared name and marks the inventory partial. Empty component
names and names with forbidden DEX characters retain their raw spelling and
are not treated as identities. Valid DEX spaces, including boundary spaces,
are preserved when resolving component names and matching alias targets.
Whitespace in the manifest package is rejected by its separate package grammar.
Component permissions inherit the application
permission when no component permission is declared, except an activity alias
with no permission: Android documents that case as requiring no permission
through the alias. `permission_source` distinguishes a local declaration,
inherited value, no requirement (including an explicit empty override), and a
value omitted because its resource/manifest-placeholder token is unresolved
or the total permission-byte budget was reached. Resource and placeholder
references are not expanded at this parser boundary. Repeated inherited
values share one inventory-wide byte budget.
Provider `android:readPermission` and `android:writePermission` overrides are
not projected as separate fields; their presence marks the inventory partial
and is called out in `limitations`. Relative component names are not resolved
against a manifest package with surrounding whitespace.
Class-name segments follow DEX `SimpleName` characters, including a leading
digit or hyphen, rather than Java source identifier rules. Relative-name
expansion does not prove class existence, DEX-version compatibility or runtime
loadability. SDK defaults accept JADX's decimal and hexadecimal integer
spellings; the original SDK declaration strings remain unchanged.

`exported` is the declared literal `true` or `false`, otherwise null.
`exported_default` is the documented default only where it can be established;
it remains null for unknown provider target SDKs, nonliteral declarations, or
components with filters targeting API 31 or later that omit the now-required
explicit declaration. A limitation records the latter validation error.
Provider authorities and all inventory dimensions are bounded. `status:
"partial"` and `limitations` identify omitted declarations or values; a
capacity limitation appears only when an actual collection limit was reached.
The projection does not merge manifests, expand resource references, or
observe runtime enabled/export state.

`enabled` and `grant_uri_permissions` report only literal component-level
`android:enabled` and provider-level `android:grantUriPermissions` declarations.
They are `null` when absent or not a literal boolean; missing attributes are not
filled from application defaults. A nonliteral declaration gets a limitation.
`process` preserves the exact component-level `android:process` spelling (including
empty or symbolic values), or `null` when absent or omitted under the inventory-wide
1 MiB copy budget. Neither field resolves resources, merges manifest values or
establishes the effective runtime process or enabled state. The exact boolean
attributes are retained in `enabled_declaration` and
`grant_uri_permissions_declaration`, including resource references.

`intent_filters` preserves each filter's source ordinal, exact priority spelling,
actions, categories and individual data declarations (scheme, host, port, path,
path prefix/pattern/advanced pattern/suffix and MIME type). These are declarations,
not computed Android matching rules. `meta_data` lists names; values remain in the
complete decoded manifest. Component, filter, data and metadata `location` values
use one-based lines/columns and UTF-16 offsets into that manifest. A component's
`declaration_index` preserves its original declaration ordinal, including gaps.

`declaration_coverage` distinguishes complete, partial and unknown observations.
Historical Evidence omits newly introduced fields and defaults coverage to
`unknown`; omission never establishes absence. Current records contain the fields,
with null for absent or unresolved scalar declarations. The inventory retains at
most 32 filters and 64 nested action/category/data/metadata records per component,
and shares a 1 MiB structured-value copy budget across components. Omitted values
or unsupported filter constructs mark coverage partial and include a limitation;
complete retained manifest text remains accessible.

For a small answer, select `detail: "summary"` with an explicit view:

```json
{
  "kind": "android",
  "facet": "components",
  "actions": ["android.provider.Telephony.SMS_RECEIVED"],
  "fields": ["name", "permission", "enabled", "process", "intent_filters"],
  "offset": 0,
  "limit": 16
}
```

The same JSON works with CLI `--view` or retained `inspect_analysis_view`.
`kinds`, `names` and `actions` use exact matching; names accept either the recorded
declared or resolved name, actions match any requested action, and different
filters combine with AND. `exported` matches only explicit declarations, keeping
`exported_default` separate. Empty selectors match nothing. Every selected row
retains its parent-array `source_index` and `declaration_coverage`; source coverage,
parent identity and limitations remain alongside the page. Follow
`coverage.next_offset`. The 1 MiB projection budget can shorten a page; a single
oversized row requires fewer selected fields. Exhausting a partial source does
not establish complete manifest coverage. `facet: "component-summary"` applies
the same filters and counts kinds, declaration coverage and explicit/default
exported values separately. Both adapters use the same retained projection;
repeated pages do not reload JADX.

The service `foreground_service_type` field preserves the declared attribute,
including an empty value or surrounding spaces; `null` means the attribute is
absent or the component is not a service. This field does not validate service
type tokens or establish runtime eligibility.

## Supply tools

Use a **full JDK 17 or newer** (including its compiler module) and
[**jadx-headless-mcp 0.7.1**](https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar).
Verify the downloaded JAR's SHA-256 against
[REA's pinned release metadata](https://github.com/morluto/rea/blob/main/src/android/JadxRelease.ts)
before using it. The following download and verification commands work for npm
package consumers as well as repository checkouts; the repository-only
`npm run fixtures:android` helper is not included in the npm package.

On macOS or Linux, choose a destination and verify the pinned digest:

```sh
mkdir -p "$HOME/.local/share/rea/android" &&
cd "$HOME/.local/share/rea/android" &&
curl -fL -o jadx-headless-mcp-0.7.1-all.jar https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar &&
if command -v sha256sum >/dev/null; then
  echo '6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75  jadx-headless-mcp-0.7.1-all.jar' | sha256sum -c -
else
  echo '6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75  jadx-headless-mcp-0.7.1-all.jar' | shasum -a 256 -c -
fi &&
export REA_JADX_MCP_JAR="$PWD/jadx-headless-mcp-0.7.1-all.jar"
```

On Windows, run the equivalent in PowerShell:

```powershell
$jar = Join-Path $HOME '.local\share\rea\android\jadx-headless-mcp-0.7.1-all.jar'
New-Item -ItemType Directory -Force (Split-Path $jar) | Out-Null
Invoke-WebRequest -Uri 'https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar' -OutFile $jar
if ((Get-FileHash -Algorithm SHA256 $jar).Hash.ToLowerInvariant() -ne '6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75') { throw 'JADX JAR SHA-256 does not match REA pinned metadata' }
$env:REA_JADX_MCP_JAR = $jar
```

REA runs its packaged Java metadata bridge in source-file mode against the
unmodified engine JAR. REA does not install Java, an Android SDK, JADX, a device
service or an emulator. Set the path in the shell or MCP server environment:

```sh
export REA_JADX_MCP_JAR=/absolute/path/jadx-headless-mcp-0.7.1-all.jar
# Optional: select an existing JDK rather than java on PATH.
export JAVA_HOME=/absolute/path/existing-jdk
```

On Windows x64, use a REA package with its matching bundled Windows native
controls **including owned protocol stdin support**. This Windows boundary is
new on repository main; an older released package can still reject this host.
PowerShell accepts paths containing spaces without additional escaping
inside these environment values:

```powershell
$env:REA_JADX_MCP_JAR = 'D:\tools\jadx-headless-mcp-0.7.1-all.jar'
$env:JAVA_HOME = 'D:\tools\jdk-21'
rea inspect-android-package 'D:\targets\Example.apk'
```

REA selects `JAVA_HOME\bin\java.exe`, or resolves `java.exe` on the selected
Windows `PATH`. A missing or mismatched native artifact reports the package
prerequisite rather than attempting an unowned Java launch. Windows arm64 is
outside this provider's current native boundary.

Readiness checks the selected JAR's ZIP directory for the classes consumed by
REA's metadata bridge, as well as Java's compiler and version modules. It does
not load an APK or execute engine code. Invalid archives and missing bridge
classes report JAR-specific recovery; classpath inventory alone does not prove
that every class or engine operation will load successfully. Discovery limits
each ZIP metadata read to 8 MiB before allocation; a larger directory reports
the exhausted read budget and the selected JAR path.

The filtered class-page bridge (protocol 2) is verified on Linux x86-64 with
Temurin 21, public Appium ApiDemos 6.0.18 and NewPipe 0.29.1 APKs. Earlier
metadata-bridge records covered macOS arm64/OpenJDK 21 and Windows x64/JDK 21;
this protocol revision has not been rerun on those hosts or Linux/JDK 25.
Windows x64 uses an owned Job Object with bidirectional stdio, atomic job
assignment and kill-on-owner-close. Real Windows verification uses JDK 21 and
the pinned JADX 0.7.1 JAR; see the real verification lane below.

## Answer an analyst question

```sh
rea inspect-android-package /path/Example.apk
rea search-android-classes /path/Example.apk MainActivity
rea inspect-android-class /path/Example.apk example.MainActivity
rea inspect-android-method /path/Example.apk example.MainActivity onCreate
rea inspect-android-method /path/Example.apk example.MainActivity select --overload-index 1
rea trace-android-references /path/Example.apk example.MainActivity
rea trace-android-references /path/Example.apk example.MainActivity --method-name onCreate
rea trace-android-references /path/Example.apk example.MainActivity --method-name select --overload-index 1
```

Equivalent MCP methods are `inspect_android_package`, `search_android_classes`,
`inspect_android_class`, `inspect_android_method` and `trace_android_references`.
Every request includes `path`. Class/method operations use `class_name`,
`method_name` and optional `overload_index` as applicable. For example:

```json
{
  "name": "inspect_android_method",
  "arguments": {
    "path": "/path/Example.apk",
    "class_name": "example.MainActivity",
    "method_name": "select",
    "overload_index": 1
  }
}
```

Use `inspect_android_class` to choose an overload. REA rejects an ambiguous
method request rather than silently selecting the first match. Method reference
queries accept the same `overload_index`; the bridge resolves the selected
method node and the result reports its index and displayed signature. These
indices are tied to the current artifact and engine, not stable across builds.

Method reference queries also accept an external class, such as
`android.app.NotificationManager --method-name notify`, when the APK directly
invokes that exact DEX class and method name. If multiple prototypes are observed,
the input error lists their exact DEX descriptors and local overload indices;
repeat with an explicit `--overload-index`. These are the prototypes observed in
the APK, not the complete method inventory of an Android framework or library.

Such results report `target_definition: "external"` and
`reference_scope: "direct_dex_invokes"`. Each using method has `source_selector`
with `class_name`, `method_name` and `overload_index`; pass those fields with the
same APK path to `inspect_android_method` to inspect the caller. Repeated direct
invokes in one method remain one using node with multiple instruction offsets.
This scans raw invoke instructions in JADX's admitted APK methods without
generating their source. It does not resolve reflection, JNI, method handles,
inherited method lookup or possible runtime dispatch. Class-only queries and
class/method inspection still require an APK definition; an external target has
no invented body. Unknown class/method names remain input errors.

External prototype and caller metadata use a bridge-frame-derived representation
allowance that reserves space for retained raw calls and CLI/MCP copies. Exhausting
it returns a typed `resource_constraint`, rather than a truncated caller list
reported as complete. Direct instruction offsets have their separate explicit
`direct_invokes_exhaustive` coverage. Older retained Evidence may omit the new
definition, scope and caller-selector fields; omission does not establish them.
The bridge checks prototype expansion before copying descriptors or joining
displayed signatures. It reuses one bounded prototype inventory for the exact
class/method selection in the current APK session; replacing the session or
selection invalidates that retained result.

`inspect_android_class` also reports `dex_static_value` for each `static final`
field whose class definition encodes a value in its DEX static values, so
compile-time constants are readable even when the class has no `<clinit>`.
Each value is typed: `boolean`, `byte`, `short`, `char` (UTF-16 code unit) and
`int` values are JSON booleans or numbers, while `long`, `float` and `double`
values are strings holding Java's text for the value, so 64-bit values stay
exact. The field reports `null` when no value is encoded, the encoded value is
null or of another kind, or the field is not `static final`. The value is read from parsed
metadata without generating source, and a static initializer can still assign
the field; use `inspect_android_method` on `<clinit>` for that evidence.
Only `inspect_android_class` asks the bridge for these values.
`inspect_android_method` and `trace_android_references` read the member-only
class summary, so large encoded strings cannot push their member lookup past
the 8 MiB protocol frame limit.

Smali fallbacks select one complete block using the original method name and DEX
descriptor, before applying the source byte limit. This preserves the selected
overload even when Java code generation renames a method. If the selected Java
body was omitted, including a method merged into a synthetic bridge, REA returns
its original smali with the `java_body_unavailable` marker. The marker describes
missing Java; it does not infer why the method was omitted or name a replacement.
Unresolved or duplicate disassembly identities fail instead of attributing another
method's instructions to the selection.

Native and abstract methods are identified from access flags
captured before code generation. They report `body_status: "not_available"`, an
empty source, and the `native_method` or `abstract_method` marker; their declarations
are not passed through the engine's source slicer. Other missing decompiled bodies
do not establish either access flag.

Static initializers (`<clinit>`) return smali with the
`static_initializer_disassembly` marker. Java decompilation can move their
instructions into field declarations, leaving an empty or incomplete method
body. The selected method's disassembly preserves those instructions and retains
the same source byte limit and explicit truncation reporting.

## Apply an R8/ProGuard mapping

Release builds shrunk by R8 or ProGuard rename classes and members. Select the
build's `mapping.txt` with `mapping_path` on `inspect_android_class` or
`inspect_android_method`, or `--mapping-path` on the matching CLI command:

```sh
rea inspect-android-class /path/Example.apk a.b --mapping-path /path/mapping.txt \
  --detail summary --evidence_output /tmp/class-evidence.json
```

For agent workflows, select `detail: "summary"` on class and method inspection.
It preserves the complete normalized member inventory or selected method body,
including mapping annotations, while retaining duplicate raw provider calls in
the complete parent Evidence. The reply links that parent's identity and digest;
export it with `export_evidence_bundle` or read its summary again through
`inspect_analysis_view`. CLI summaries require `--evidence_output` and return
the portable bundle path. Omitted or `complete` detail preserves complete inline
Evidence. Search and reference operations retain their existing contracts.
Symbol summary views admit at most **1 MiB**, including view context. An admitted
method's source can already consume that amount; a larger combined summary
fails explicitly instead of silently truncating facts. MCP refusal includes
the retained parent ID. Select complete detail, or inspect one method rather
than a whole class, when the requested summary does not fit.

The mapping path must be absolute. Selectors still take the observed names, such as
`a.b`, and observed rows are unchanged. The result adds one `mapping` block with
the file's path, SHA-256 and size, the header values the file reports
(`compiler`, `compiler_version`, `min_api`, `map_version`, `pg_map_id`,
`pg_map_hash`), valid record counts and up to 16 malformed line samples. Its
`symbols` list has one entry per observed class, inner class, method and field;
`inspect_android_method` lists the class and the selected method. `coverage`
counts each resolution status. With summary delivery, these unchanged facts are
under the view's `summary` field; the view separately reports source coverage.

Lookups use the bridge's raw DEX names, not JADX display aliases such as a
renamed reserved word. Each symbol resolves as:

- `mapped`: exactly one record matches. A class needs one record for its raw
  name (`verified_by: "class"`). A method must also match its DEX prototype
  (`"descriptor"`) and a field its DEX type (`"type"`). R8 residual signature
  metadata is used when present; otherwise original types are translated
  through the file's class records.
- `ambiguous`: `multiple-records`, `descriptor-mismatch`, `type-mismatch`,
  `ambiguous-class` or `residual-signature-conflict`, with `candidate_count` and
  up to 8 candidates. Conflicting residual metadata never selects a winner. A name match
  whose prototype or type does not verify is never reported as mapped.
- `unmapped`: no valid record matched the raw identity.
- `unknown` with reason `projection-budget`: this claim did not fit the combined
  reply budget. The observed raw symbol remains present; `coverage.unknown`
  counts these omissions. Inspect that specific class or method separately,
  or consult the selected local mapping file for complete source records.

A line continues an inline frame stack when it repeats the previous line's
minified range and obfuscated name and gives a single call-site line, such as
`:7`. Only the outermost original of a stack becomes a candidate. Original
line numbers and source files are not projected. Malformed records are counted
and skipped, so an `unmapped` symbol might be described by one of them. A file
that is missing, not a regular file, not UTF-8, larger than the byte limit or
without any class record, such as `usage.txt` or `seeds.txt`, is refused before
JADX is used. Requests read their mappings one at a time, in the same queue as
the JADX work and under the same operation deadline. A mapping failure therefore never starts or retires the JADX
session, and a different mapping reuses the loaded APK.

## Link native declarations to JNI candidates

When advertised, `inspect_android_jni_bindings` links original `ACC_NATIVE`
declarations from standard root `classes*.dex` members to bundled ELF libraries.
The supplied JAR's DEX reader preserves duplicate declarations before decompiler
deduplication. This operation does not load the APK into the decompiler.
MCP defaults to retained summary delivery when `detail` is omitted; select
`complete` explicitly to receive the full report inline.

```json
{
  "path": "/absolute/Example.apk",
  "class_name": "org.conscrypt.NativeCrypto",
  "method_names": ["EVP_PKEY_new_RSA"],
  "abis": ["arm64-v8a"],
  "detail": "summary"
}
```

Class/method names and optional `descriptors` select raw DEX identities.
`library_paths` selects exact logical APK paths such as
`lib/arm64-v8a/libconscrypt_jni.so`; each library's `source_path` preserves its
original ZIP spelling. Omitted filters include all scoped facts; `[]` matches
none. Class selection never narrows the global inventory used for table-class
attribution.

Independent `declarations`, `libraries`, `candidates` and `bindings` collections
have stable IDs and source ordinals. Candidates retain APK/library digests,
ABI, function addresses and file offsets. Table candidates also retain section,
table and entry identity plus all three name/signature/function pointer slots
and their relocation sources. JNI exports follow the
[UTF-16 escaping and short-before-long rules](https://docs.oracle.com/en/java/javase/21/docs/specs/jni/design.html#resolving-native-method-names);
failed escaping does not acquire an invented export match. Tables require
NUL-terminated [Modified UTF-8 strings](https://docs.oracle.com/en/java/javase/21/docs/specs/jni/types.html#modified-utf-8-strings),
valid descriptors and executable load mappings. REL, RELA and RELR retain
separate provenance; unsupported packed relocations and unresolved pointer
spans stay explicit unknowns.

A static `JNINativeMethod` entry names no class. Attribute it uniquely only
when exactly one declaration in the complete recorded native inventory has
that `(name, descriptor)` pair. Multiple classes remain ambiguous after a
class filter; a partial inventory cannot establish unique attribution.

Each selected declaration has a row per selected/observed ABI. `matched` means
candidate presence was observed; `ambiguous` means multiple observed targets
or class associations remain. Binding `coverage` is separate: a matched
partial row does not establish complete uniqueness, and an empty partial scan
is `unknown`, never `unmatched`. ELF/ABI label mismatches preserve facts without
asserting a binding. No result establishes library loading, runtime registration
or method invocation.

Summary returns the first 64 selected binding rows, their declaration/candidate
closure and every selected library's identity, coverage and failure reason;
counts and page coverage describe the full selected binding set. Selected
declaration IDs have separate preview coverage, so native declarations remain
visible even when the APK has no bundled ABI libraries. Complete
Evidence stays retained. Read exact fields or further pages without reopening
files or rerunning analysis:

```json
{
  "source": { "kind": "retained-evidence", "evidence_id": "ev_<digest>" },
  "view": {
    "kind": "android-jni",
    "collection": "bindings",
    "offset": 64,
    "limit": 64,
    "fields": ["declaration_id", "abi", "status", "coverage", "candidate_ids"]
  }
}
```

Collections also include `declarations`, `candidates` and `libraries`, with
exact filters and batch lookup by declaration/candidate/library IDs. `row_index`
is the original parent collection index; DEX and
ZIP source ordinals stay separate. Complete detail returns the full report.
CLI uses the same selection and delivery contracts. Its common one-shot
default remains complete; summary delivery requires an explicit Evidence path:

```sh
rea inspect-android-jni-bindings /absolute/Example.apk \
  --query '{"class_name":"org.conscrypt.NativeCrypto","method_names":["EVP_PKEY_new_RSA"],"abis":["arm64-v8a"]}' \
  --detail summary --evidence_output /absolute/fresh-jni-evidence.json
```

Optional `--view` accepts the same JSON page and requires summary delivery.
Evidence bundles never overwrite files. Complete declarations and one library
selection are cached within the immutable APK session. Changing ABI/library
selection replaces the scan; class/method selection reuses it. Fresh analysis
still validates current caller APK bytes. Idle/close releases the caches;
retained Evidence remains historical and independently readable.

## Interpret the result

- Package inspection retains decoded manifest XML, summary declarations,
  permissions and class/resource counts. REA's bridge selects the exact root
  `AndroidManifest.xml` resource by original archive name and manifest type,
  independently of asset order. One namespace-aware JDK XML parse supplies
  summary attributes and direct permission/SDK declarations; namespace prefixes
  and XML entity spelling do not change their values. Raw decoded XML is retained
  exactly and only its displayed text is subject to the existing source byte cap.
  Summaries use the complete selected XML before that cap. Document types are
  unsupported; parsing does not load external DTDs, schemas, or XInclude files.
  Signature verification is explicitly `not_performed`.
- Class search filters the engine's cached top-level names before transferring
  pages, then follows contiguous inventory positions without rescanning earlier
  rows. It checks selection, scope, examined ranges and counts before reporting
  complete coverage. Complete producer replies stay in Evidence; an empty `query`
  inventories all class-name rows; class names are decompiler representations.
  Repeated names remain repeated in `matches` so the inventory row count and
  producer evidence stay visible. `duplicate_names` identifies matching names
  with multiple rows and their occurrence counts; a name alone does not
  distinguish which provider class node a later lookup selects.
- Class inventories read parsed metadata without generating source and return
  full reported display types, fields and inner class names. Synthetic members
  that code generation hides can appear in the inventory; it stays consistent
  after method decompilation within the retained session.
  Class and method inspection and reference tracing accept either the exact
  reported class name or its original binary name, including `$` in nested and
  anonymous classes. The bridge keeps both identities from JADX; it does not
  replace separators or guess suffix matches. Ambiguous selectors are refused.
  Follow-up calls preserve the selected name, while results report the frozen
  JADX display name. Quote `$` names in the shell, for example
  `'com.example.Manager$WorkerThread'`.
  Exact DEX prototypes are reported from frozen JADX method metadata as
  `dex_descriptor`, for example `(I)V`. Display names can be JADX aliases;
  the descriptor alone is not a complete raw DEX method ID. Overload indices
  are tied to this artifact and engine, not stable identities across builds.
- A `mapping` block appears only when the caller selected `mapping_path`. Its
  names are claims from that file, not observations of the APK. REA does not
  check that the mapping belongs to this build; `pg_map_id` is reported, not
  compared. Evidence keeps the selected path in its parameters and the file's
  SHA-256 in the result.
- Method inspection reports Java or smali, fallback markers and complete/partial
  returned text. Decompiled source is a derived representation. A complete text
  result does not establish complete semantics or a byte-identical reconstruction.
- Reference results are incoming static relationships between provider nodes.
  `reference_unit=using_node` means `total` counts containing JADX nodes, not
  individual invoke instructions; two calls from one method can appear as one
  entry. `coverage=complete` covers this node inventory only. For a method
  reference whose using node has raw code, `direct_invokes` lists matching DEX
  invoke instructions with their DEX entry, raw source method ID, code-unit
  offset, method index and opcode. An empty array means no direct invoke was
  matched in that node; `null` means raw code was unavailable or the using node
  was not a method. This list does not establish complete call-site coverage
  outside JADX's using-node inventory or through reflection and dynamic loading.
  A virtual or interface invoke also does not establish its runtime implementation.
  Source lines and the containing node's own `dex_offset` remain unknown.
  Method-reference results also carry the selected `dex_descriptor`;
  class-reference results report `null`.
  These relationships are not observed runtime calls.
- Original requests, APK SHA-256, actual engine JAR SHA-256 and raw producer
  responses remain in Evidence. Source revision is populated only for bytes
  matching the audited release JAR.

If a later step fails, the error's `details.partial_observation` retains the
selected and resolved APK paths, digest, observed provider identity and versions,
and each upstream request and reply collected before the failure. Failed replies
remain available even when their payload cannot be interpreted. Cancellation
also stops target hashing before provider admission.

These operations do not execute the APK or provide split APK/AAB handling,
signature validation, full resource-table semantics, native-library analysis or
Android runtime capture. An `.aab` suffix is a ZIP archive, not an APK, so
Android tools and the application graph do not treat it as a standalone APK.
Existing artifact inventory/extraction tools can supply archive evidence.
Inventory records an APK root only for ZIP bytes whose name ends in `.apk`.
The projection adds a limitation when no root `AndroidManifest.xml` was
observed, because such a ZIP may not be an APK. Nested members take a ZIP or
ASAR family from their bytes; an unread member keeps an unknown format.
Inventory keeps ZIP names that differ only in case and records that a
case-insensitive destination cannot store both spellings. Extraction fails
only when that destination directory cannot keep both names. Project that
Evidence with the execution-free inventory tool:

```sh
rea project-android-application-graph '{"inventory_evidence":[<inventory_artifact Evidence>]}'
```

```json
{
  "name": "project_android_application_graph",
  "arguments": {
    "inventory_evidence": ["<inventory_artifact Evidence>"]
  }
}
```

The projection reports exact component paths and hashes, runtime-family hints,
and path-based bridge hypotheses. File and slice occurrences supply component
endpoints; directory trees and symlinks retain their identities in the source
inventory without being classified as code files. It does not decode DEX or
claim observed runtime calls. DEX/JVM runtime hints summarize the classified
bytecode component lists. Framework hints match complete native library names,
such as
`libreactnativejni.so`, `libreactnative.so`, `libhermes.so`,
`libhermes_executor.so`, `libflutter.so`, and `libunity.so`; unrelated names
such as `libcommunity.so` and `libreactivity.so` do not identify those families.
The signing list retains the `META-INF/MANIFEST.MF`, `.SF`, `.RSA`, `.DSA`, and
`.EC` paths selected by Android's v1 verifier, including nested paths. These are
inventory metadata candidates, not proof that a v1 signature verifies or that
the APK is signed; use `inspect-apk-signature` for signature analysis.
The bridge basis is inferred from the native path and repeated for each managed
component, so it does not identify a specific JNI binding. Bridge hypotheses form a DEX/JVM-class by native-library
Cartesian product. The projection computes the product and exact serialized
candidate-array size before creating candidate objects, then retains a
deterministic prefix within a 2 MiB UTF-8 JSON budget. If candidates are omitted,
`bridge_candidate_coverage` reports total, emitted, and omitted counts; overall
coverage is `partial` while component arrays still include every component
from the supplied inventory pages. A path pair does not establish that a
managed declaration names, loads, or calls the native library.

## Resource and lifecycle limits

REA retains one serialized session with private, immutable APK, engine JAR and
metadata-bridge copies. Matching requests reuse the loaded engine. APK/engine
digests and JVM configuration are checked before reuse; changed inputs retire
the previous session. Sessions are cleaned after 60 seconds of inactivity, on
target/configuration changes, failure, timeout, cancellation, MCP disconnect or
server shutdown. One-shot CLI commands always join cleanup before returning.
REA never writes to the original APK or launches target code.

JNI scans reuse the analyzer process without loading the APK into the
decompiler. They admit at most 64 MiB per DEX member and 256 MiB of DEX bytes,
with a 4 MiB native-declaration JSON allowance before MCP string escaping.
Native libraries are processed sequentially: one 64 MiB buffer, 256 MiB total
selected read work, and a 16 MiB parsed-library-facts allowance. ZIP inventory
and library counts also have explicit resource bounds. Unexamined occurrences
remain unknown. A complete relationship report has a separate 16 MiB serialized
allowance; summaries/pages allow 1 MiB including their provenance envelope.
These are resource admissions, not claims about maximum valid Android formats.
Select fewer ABI/library occurrences or smaller retained pages when needed.
Completed parsed library facts survive failed reader finalization in typed
partial observations; the exact reader owner remains available for cleanup retry.

On Windows, stdin writes preserve stream backpressure and run outside the Node
event loop. Cancellation terminates the retained job, including descendants,
before workspace cleanup. On Windows, a detached REA helper owns the private
workspace's native directory handle. An abrupt CLI/server owner termination
closes the Java job and the helper's input pipe; the helper then removes the
workspace by handle. The real Windows lane checks both effects. If the helper
also dies or the host loses power before it finishes, private files can remain.

If Java cannot start the bridge, REA reports the selected executable and retained
startup diagnostics. Select a full JDK through `JAVA_HOME` or `PATH`, and use
`java --list-modules` to confirm `jdk.compiler` is present. A runnable JRE alone
cannot compile the bridge. Missing or ambiguous class and method selections are
input failures; discover names with `search_android_classes` and
`inspect_android_class` before correcting the selected argument.

If process cleanup cannot be confirmed, REA retains the workspace and reports its
location. That provider instance blocks subsequent engine launches until the
caller resolves the reported resources and starts a fresh instance.

The provider uses one JADX analysis worker independently of JVM processor and
garbage-collector settings. REA supplies no default heap or visible-CPU override;
Java uses its normal ergonomics and inherits caller JVM settings. Optional
provider settings add explicit JVM arguments:

```sh
export REA_JADX_HEAP_MIB=8192
# Optional, independent of the single JADX worker:
export REA_JADX_ACTIVE_PROCESSOR_COUNT=4
# Or select settings through Java's standard environment options:
export JAVA_TOOL_OPTIONS=-Xmx8g
```

Both REA settings must be positive safe integers; processor counts must also fit
the JVM's signed 32-bit range. REA preserves
`JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS` and `_JAVA_OPTIONS` rather than replacing
them. Java's standard precedence applies: explicit command-line heap settings
override `JAVA_TOOL_OPTIONS`, while `_JAVA_OPTIONS` can override command-line
settings. Evidence reports the worker's observed `Runtime.maxMemory()` rounded
down to MiB and retains exact bytes, Java version and visible processors in its
raw runtime response. The observed allocatable heap can differ from configured
`-Xmx`, especially with Serial GC. Heap is not a total RSS cap: the JVM also
uses native memory. A typed JVM memory allocation failure during APK loading
reports `resource_constraint` with the observed maximum heap in bytes. Known
heap failures name `REA_JADX_HEAP_MIB` in remediation; other memory regions
remain unknown. A healthy doctor configuration check does not establish that
any particular APK fits. Failures before the bridge can report a typed result
and upstream errors from other operations retain their existing diagnostics;
error text alone does not establish memory exhaustion.

Independent REA instances have independent queues. Whole
operations have a **120-second** execution deadline by default, starting after
they reach the queue's front. For a known slow cold load, such as a large
multidex APK, select another finite deadline:

```sh
export REA_JADX_OPERATION_TIMEOUT_MS=600000
```

The value must be a decimal millisecond count from 1 to 2147483647; anything
else is refused before Java starts. REA reads it from the environment captured
at process start. Changing that environment requires a new REA process. On a
running MCP server, set `jadx.operation_timeout_ms` through
`update_analysis_settings` to change the default for newly accepted operations;
queued or running operations retain their accepted budget. The same deadline
bounds each upstream call. Timeout recovery reports the effective milliseconds
and range, with `details.limit` identifying the runtime setting. An invalid
provider-local launch value can also be repaired by a runtime override; reset
exposes that invalid launch value again. See the
[settings design](design/limits-and-recovery.md#invalid-launch-configuration).
A passing JADX configuration check in `rea doctor` reports its launch-derived
`operation_timeout_ms`; it does not inspect another running server's overrides. Explicit
cancellation still ends the operation immediately, and partial observations
and owned-process cleanup are unchanged. Raising the deadline does not extend
the bridge's 30-second startup handshake or the upstream **90-second**
decompilation limit. MCP clients enforce their own tool-call timeouts, and
setup's derived [client tool timeout](client-configuration.md) does not include
this setting, so also raise the client timeout when selecting a longer
deadline.

Decoded manifest and method text have a **1 MiB** upstream byte budget and report
truncation. Class-name pages use indexed slices of up to 4,096 names without changing the
complete, case-sensitive search contract. A protocol frame above **8 MiB**, or combined stdout/stderr above
**32 MiB per operation**, fails with a diagnostic instead of returning an incomplete inventory
as complete. These are memory-safety boundaries, not undocumented result caps.

A selected R8/ProGuard mapping is re-read and SHA-256 checked on every call, up
to **64 MiB**. The serialized provider keeps one successful parsed index, keyed
by byte length and digest with fixed parser options. Identical bytes reuse that
index; changed bytes are reparsed, missing files still fail, and each response
preserves the currently selected path. The index is released on provider idle
retirement or close. Omitting `mapping_path` never applies the cached mapping.
During replacement, the old index can coexist with the new parse until it
succeeds; these transient allocations count toward process memory.

Before retaining records, the parser admits an estimated **128 MiB** index
representation and **8 MiB** of expanded mapped claims per residual class,
including shared header facts. The index allowance accounts for strings and
containers; it is not a measured V8 heap cap. Parameter and metadata expansion
is admitted before splitting or JSON decoding. These fixed resource bounds
have no runtime override; refusal reports `resource_constraint`, the source
line and mapping SHA-256. Ambiguous lookups count all candidates while keeping
only the first eight in stable file order. A separate **8 MiB** combined claim
budget applies to the actual query set, including outer and inner classes,
before cloning the report. Claims that do not fit become explicit `unknown`
entries; other admitted claims and all observed identities remain available.

## Real verification

Download the explicit public fixtures once; this installs no tools:

```sh
npm run fixtures:android
export REA_JADX_MCP_JAR="$PWD/_reference/apk-integration/jadx-headless-mcp-0.7.1-all.jar"
export REA_ANDROID_TEST_APK="$PWD/_reference/apk-integration/ApiDemos-debug.apk"
npm run verify:android
```

The main lane and Windows Java-selection checks validate the selected JDK and
engine archive through `validateVerifierJadxConfiguration`. This shared verifier
boundary supplies the production validator's resource owner and waits for
retained cleanup before proceeding. Failed closes retain their exact owners for
retry; prerequisite failures must not be mistaken for completed bridge tests.
Recovery checks match the typed Java or archive failure and its applicable
remediation.

The lane also uses the selected full JDK's `jlink` to create a disposable JRE
without the compiler module. It checks real Java startup failures, missing
selectors, recovery after failures, and CLI cancellation with owned cleanup.
The original APK and host Java configuration remain unchanged.

The same lane runs on Windows x64 with the bundled native controls and a full
JDK. It checks CLI/MCP results, real MCP cancellation and disconnect, and Java
exit and workspace removal after abrupt CLI owner termination. Windows forced
termination is checked separately from the POSIX CLI SIGTERM handler. A
synthetic two-owner test confirms that one owner's exit does not remove the
other owner's workspace. The lane does not claim a structured cancellation
result or power-loss recovery.

The download script verifies fixed SHA-256 values, reuses matching files and
refuses to overwrite a different existing file. APK/JAR files live under ignored
`_reference/` and are excluded from package contents. The lane exercises actual
REA CLI and MCP results with the real engine, separately from synthetic protocol
regressions. It needs no Gradle build, emulator, Android SDK or Ghidra.

Direct invoke sites retain exact DEX code-unit offsets separately from each
containing node's unknown `dex_offset`. `direct_invokes_exhaustive: false`
means instruction rows were bounded by the local bridge frame budget; `null`
means the producer did not establish instruction coverage. Using-node totals
and coverage do not imply complete instruction evidence.
`direct_invokes_coverage` reports counts of using nodes with complete, partial,
or unknown positions, plus the number of retained instruction sites. This
aggregate makes position truncation visible without scanning every caller;
older retained Evidence may omit it, which means the aggregate was unexamined.
