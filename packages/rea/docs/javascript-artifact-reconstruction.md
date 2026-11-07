# JavaScript artifact reconstruction

Inspect a local Electron/JavaScript directory or ASAR without executing its code.
`analyze_javascript_application` and the CLI routes below return an Evidence
record with the [application graph](javascript-application-graph.md), static
Electron observations, statistics, limitations, and coverage.

Start with the [public workflow](#public-workflow), select sources when useful,
then [read the analysis](#read-the-analysis). Use [application workflows](javascript-application-workflows.md)
for tracing and comparisons, or [partial recovery](#recover-partial-analysis)
when an operation is interrupted.

## Public workflow

The tool reads the caller-selected local directory or ASAR path directly:

```bash
rea analyze /absolute/path/to/apps/app.asar --json
rea analyze-javascript-application /absolute/path/to/apps/app.asar \
  --integrity-policy record-and-continue --json
```

Generic `rea analyze` selects this static provider for directories and `.asar`
paths when neither `--provider` nor `--snapshot` is supplied. The dedicated
command and the generic route return their complete results inline. Native
targets, single JavaScript files, `.app` bundles, and explicit deep-provider or
snapshot requests retain the native deep-analysis route.

Both CLI routes emit `rea_progress` JSON lines on stderr as inventory, source
parsing, graph construction, validation, and Evidence hashing begin. Stdout
remains the selected result document. Completion is reported after Evidence
creation; a failed analysis retains its typed diagnostic result.

Configure an MCP client with the ordinary REA setup command:

```bash
rea setup
```

The equivalent MCP input is:

```json
{
  "input_path": "/absolute/path/to/apps/app.asar",
  "format": "auto",
  "integrity_policy": "fail"
}
```

`input_path` must be absolute. `format` accepts `auto`, `asar`, or `directory`.
`integrity_policy` accepts `fail` or `record-and-continue`; both CLI routes and
the MCP tool default to `fail`.
Evidence parameters retain the caller-selected `input_path`, including a
symlink alias. Both CLI routes anchor relative inputs to their working
directory without resolving symlinks. The subject and normalized result use
the resolved path for artifact identity; the selected path remains a separate
request fact. Older Evidence can omit this parameter; retained records are
validated without resolving their paths against the live filesystem.
The result retains the canonical local path, root artifact digest, artifact
manifest and graph commitments, JavaScript Application Graph, static
Electron summary, reconstruction statistics, and explicit limitations. It does
not require a live Hopper, Ghidra, browser, or Electron process.
Selected directories require read and search access. A denied root remains a
typed host access failure; omission handling for denied descendants does not
make an inaccessible selected root analyzable. Other host filesystem failures
retain the selected input, reported errno and syscall/path when supplied, and
the original diagnostic separately from artifact-format failures.

The application graph selects the shallowest `package.json` outside
`node_modules` as its package root, breaking equal-depth ties by Unicode
code-point order. Dependency manifests remain package observations but do not
declare Electron main or renderer entries. If only dependency manifests are
present, the inventory artifact remains the graph root.

Package observations use `renderer_declarations` to record the actual present
fields: strings, including empty strings, remain exact; non-string values use `{ "status": "non-string" }`
without copying nested browser mappings. An empty record means no such fields
were present; `null` means package metadata was invalid or unavailable. Renderer
role mechanisms and package load edges name the field that supplied the candidate,
selected as the first nonempty string from `renderer`, `browser`, then `module`.
The package load edge retains `declared_path`, `source_field`, and resolution
facts for that selection. New analyses no longer emit the derived package
`renderer` alias; consumers must read declarations for source metadata and load
edges for the selected candidate. Previously retained Evidence keeps its original
properties and remains readable without migration.

## Select sources before analysis

For a question about known entry sources, supply exact artifact-relative file
paths in `source_paths`, or repeat `--source-path` on either CLI route:

```bash
rea analyze /absolute/path/to/app.asar \
  --source-path package.json --source-path main.js --json
```

```json
{
  "input_path": "/absolute/path/to/app.asar",
  "source_paths": ["package.json", "main.js"],
  "detail": "summary"
}
```

REA inventories and verifies the complete artifact, including unselected bytes,
but allocates source text and performs static analysis only for selected files.
Include supporting manifests, HTML or source maps explicitly when needed;
imports do not expand the selection. Paths must match relevant inventoried
files exactly, including nested ASAR prefixes. Unknown paths, aliases and globs
return an `invalid_request` correction. Selected files are analyzed in request
order before unselected scopes are projected. Repeated paths preserve the
caller's request and first-occurrence priority, analyzing the file once.
Omit the selection for the existing complete
application workflow.

For a long selection, pass the paths as a JSON array with
`--source-paths-json`, either inline or as a JSON file path. A file keeps the
command below host command-line limits, such as the 8,191-character limit of
the `cmd.exe` shim that `npx` uses on Windows. Its entries follow any
`--source-path` values and stay artifact-relative; they are not resolved
against the working directory:

```bash
rea analyze-javascript-application /absolute/path/to/app.asar \
  --source-paths-json /absolute/path/to/paths.json --json
```

The result and summary retain `source_selection.requested_paths` and
`source_selection.unselected_files`. Selecting every relevant file leaves this
count at zero and adds no unselected-source caveat. Every relevant file keeps its
original inventory identity; unselected files report `text_status:
"outside-analysis-scope"`. Their relationships remain unknown, and application
coverage is partial while any file remains outside scope. Selection does not
claim whole-application completeness or change integrity policy. Summary detail
only reduces delivery; source selection reduces text acquisition and analysis.
Explicit native provider or snapshot routing rejects `--source-path` and
`--source-paths-json` rather than ignoring them.

For directory input, a permission-denied child file remains an unavailable
inventory occurrence, and an unreadable child directory records an unknown
descendant omission. Readable sources remain available; application coverage is
partial and retains those inventory limitations. An unreadable selected root
remains an error. Explicit readers that require selected child bytes keep their
access errors rather than treating denied paths as absent.
Unavailable source files also retain their applicable per-file processing gap
in the application graph. Their container inventory identity anchors that gap;
REA does not invent a content digest for bytes it could not read.
Incomplete traversal also qualifies negative path and package-metadata lookups:
an unobserved earlier loader candidate cannot be skipped in favor of a later
observed candidate. An explicit source selection whose discovery is unknown
returns an unavailable error with the retained inventory, rather than claiming
the selected source does not exist. Observed exact file candidates keep their
identity; unknown traversal cannot establish a unique application root.

ASAR header/index admission defaults to 16 MiB / 16777216 bytes. In MCP, use
`update_analysis_settings` to set `asar.max_header_bytes` to an integer byte
count from 1 to 268435456 (256 MiB), then retry the same full-archive request.
The update applies to new operations without restarting REA; cached headers
must also satisfy the new admission. For CLI or future MCP processes, set
`REA_ASAR_MAX_HEADER_BYTES` in the launch environment. Changing that environment
requires a new REA process. Invalid launch values are configuration errors,
never a silent fallback. See the
[settings design](design/limits-and-recovery.md#failure-and-retry) for recovery
metadata, precedence, and reset behavior.

The archive index is read before any member can be selected, so
`source_paths`, `--source-path`, `detail: "summary"`, `max_heap_mb`, and
available host memory do not bypass or raise it. When the header exceeds the
effective allowance, the failure reports the value, its known source, and the
setting's limits. Alternatively, analyze an extracted
application directory, which does not admit an ASAR header. Repeating the unchanged
request without changing admission fails the same way.

## Read the analysis

`analyze_javascript_application` returns the complete analysis Evidence by
default. Select `"detail": "summary"` to retain that complete Evidence in the
current session and receive only its `inspect_analysis_view` summary: artifact
identity, statistics, Electron surface counts, application and semantic
coverage, limitations, and `normalized_result.parent_evidence_id`. Pass that ID
to `inspect_analysis_view` for module pages or items, or to the application
workflows as a retained reference. The summary does not repeat or truncate the
analysis; a server without session retention refuses summary detail with
`capability_unavailable`. CLI output is unchanged and always complete.

With a connected MCP `client` and the caller-selected absolute `inputPath`, this
recipe analyzes once and pages module identities using the returned ID:

```js
const analysis = await client.callTool({
  name: "analyze_javascript_application",
  arguments: { input_path: inputPath, detail: "summary" },
});
if (analysis.isError) throw new Error(JSON.stringify(analysis.content));
const parentId =
  analysis.structuredContent.normalized_result.parent_evidence_id;
const modules = await client.callTool({
  name: "inspect_analysis_view",
  arguments: {
    source: { kind: "retained-evidence", evidence_id: parentId },
    view: { kind: "page", collection: "modules", offset: 0, limit: 16 },
  },
});
if (modules.isError) throw new Error(JSON.stringify(modules.content));
```

Select a returned module's exact `node_id` for an item view. A path can identify
several graph roles; module items preserve their recorded properties and source
locations. Follow `coverage.next_offset` when another page matters. For feature
tracing, version comparison, and retained-input examples, use the
[application workflows](javascript-application-workflows.md).

For supplied passive browser or Electron observations, use
[runtime reconciliation](javascript-runtime-reconciliation.md). It compares
existing Evidence without rerunning static analysis or contacting CDP.

Each newly analyzed JavaScript file retains `analysis_coverage` in its graph
observation. `syntax` distinguishes complete parsing, recovered syntax errors,
failed parsing and unexamined source. `semantics` records the number of observed
unknown findings and typed uncertainty, including returned-reference widening
and unavailable type-only compiler options. `examination` reports static semantic
resource limits and Electron wrapper expansion limits independently. A completed
pass does not establish complete runtime semantics. Route examination and result
capacity remain in the separate route inventory.

Electron applicability is `observed` when a static Electron module reference is
retained, and otherwise `unknown`: a source without such a reference does not
prove that the application is inapplicable. Sources excluded by `source_paths`
retain `not-examined` with a reason and null semantic counts. Historical Evidence
without this facet remains unmeasured. The existing `parse_status` remains its
conservative overall summary; finer facts do not relabel earlier partial results.

Summary delivery counts these facts under `summary.coverage.static_sources`.
Read exact per-file measurements with `inspect_analysis_view`, selecting
`kind: "javascript-facts"` and `property_keys: ["analysis_coverage"]`, or inspect
the module item. Both views use retained Evidence and preserve source provenance.

## ASAR integrity

ASAR inventory checks Electron integrity metadata for embedded archive entries
and supplied `.asar.unpacked` companion files. An integrity failure identifies
the logical path, declared and calculated SHA-256 values, and whether the entry
was unpacked. By default, a mismatch is returned as a failure with its artifact
context. Application analysis can explicitly select `record-and-continue` to
analyze observed bytes while retaining each contradiction's declared and
observed hashes and `observed-untrusted` trust. Such results mark application
graph coverage partial and include every contradicted path in the limitations.
Mismatched nested ASARs stay opaque rather than being expanded.

An unpacked entry whose companion bytes were not supplied remains
`unavailable`. REA continues analyzing embedded JavaScript and records the
missing native/resource bytes as unknown. The occurrence keeps
`hash_status: unavailable`; no content-addressed child artifact is created for
those missing bytes. New ASAR file occurrences record `unpacked: true` for
companion files and `unpacked: false` for packed entries, including when the
file bytes are unavailable. An omitted flag in an older inventory remains
unknown; it does not establish either storage mode. See
[MCP integrity handling](mcp-contracts.md#integrity-record-and-continue) for the
tool-result contract.

JavaScript whose syntax cannot be parsed retains unavailable semantic coverage
with `incomplete-module` unknowns for each semantic family and unknown omitted
node and relation extents. The source module is retained when node capacity
permits. A parser failure alone does not imply resource truncation or a named
resource limit. Decoding failures and deliberately
unselected sources retain the same explicit semantic coverage gap.

HTML whose bytes are not valid UTF-8 retains its file observation and an unknown
`parse-html-script-references` scope with artifact-byte authority. Reference
discovery was unavailable; zero retained script links does not establish that
the unreadable HTML declared none. Readable HTML with no references has no such
gap, and readable external references retain their load edges.

## Large results

Use MCP `detail: "summary"` for a large application, then read selected views of
the retained analysis. Summary changes delivery only. To reduce source parsing,
select exact [source paths](#select-sources-before-analysis). Source selection
does not bypass ASAR header/index admission.

If a complete response exceeds the transport budget, use its retained Evidence
ID for a summary, module page, or item, or export the bundle. See
[MCP tool results](mcp-contracts.md#tool-results) for delivery limits, export, and
matching server/client buffer settings. Follow-up results also need to fit that
budget. [Analyzer limits](#analyzer-and-result-admission) control analysis memory,
source deadlines, and semantic capacity separately.

## Recover partial analysis

A source timeout stops the remaining analysis and returns completed facts as
partial Evidence. Cancellation after source analysis begins can also retain
completed facts, including when interrupted during cleanup, graph construction,
or Evidence sealing. Unexamined relationships remain unknown.

Per-file gaps identify the applicable processing phase: JavaScript source analysis
uses AST authority, while package/JSON, HTML-reference and source-map processing
use artifact-byte authority. File-analysis interruption gaps carry `analysis_status`:
`interrupted` means the phase was entered (including source-worker startup),
and `not-started` means interruption prevented that phase from beginning.
Neither state establishes that parsing completed. Remaining parsers are not run
after interruption just to populate a result.

Native add-ons remain metadata-only and acquire no JavaScript parse or analysis
gap. This also applies when their paths are outside `source_paths`; their inventory
and caller selection remain available without implying applicable AST work.

MCP returns a `partial_observation` retained reference after recording succeeds;
open it with `inspect_analysis_view` on the same connection. If the SDK stopped
waiting before receiving the reply, follow [MCP cancellation recovery](mcp-contracts.md#progress-and-cancellation)
to find the record. CLI failure output contains the complete partial Evidence.
Owned analyzer cleanup is verified before private files are released; uncertain
cleanup retains ownership for retry and is reported separately.
Typed cancellation or another primary interruption remains attached while
cleanup is incomplete. Confirmed release restores that primary classification,
including the caller's exact cancellation reason, while retaining partial
application Evidence and historical cleanup diagnostics.

Private worker storage failures retain the source identity, worker phase and
reported I/O message as execution failures; they are distinct from malformed
worker output. A per-source temporary-file cleanup failure preserves static and
module facts together with any parent application-projection limit. Cleanup
failure does not authorize expanding relationships that parent admission declined.

## What is reconstructed

The projector reuses the content-addressed artifact inventory and safe artifact
readers. It retains canonical artifact-relative paths, exact byte counts,
SHA-256 digests, inventory IDs, ASAR container identity, and `.asar.unpacked`
status. Direct ASAR inputs and filesystem-backed ASAR files nested beneath a
directory are supported.

JavaScript sources (`.js`, `.jsx`, `.mjs`, and `.cjs`) and TypeScript sources
(`.ts`, `.tsx`, `.mts`, and `.cts`) are parsed as inert text; analysis does not
execute them.

JavaScript and HTML source ranges retain an initial UTF-8 BOM as one UTF-16
code unit, matching the original bytes identified by the artifact digest.

Plain `.ts` artifact sources use TypeScript syntax without JSX, including
angle-bracket type assertions. `.tsx` and `.jsx` retain JSX parsing.
JavaScript sources use JavaScript grammar with JSX, never TypeScript syntax,
so valid JavaScript that TypeScript reads differently keeps its JavaScript
meaning.

Relative TypeScript imports can name their emitted `.js`, `.mjs`, or `.cjs`
counterparts while resolving to inventoried source files. This substitution
requires import or require semantics. Literal Electron preload, renderer, and
utility-process runtime paths retain the runtime filename selected by the caller.

Selected bounded text is then parsed as inert data to recover:

- `package.json` metadata and declared main or renderer entrypoints;
- Electron preload paths owned by proven BrowserWindow options and renderer
  files loaded through proven BrowserWindow instances;
- local HTML script entrypoints;
- Webpack and Rspack chunk registrations and module factories represented as
  AST literals, plus esbuild `__commonJS` module tables; recovered esbuild
  CommonJS exports use its factory's `exports`-then-`module` parameter order.
  Export receivers and loader helpers retain those calling-convention roles only
  while the binding at the read still holds its original parameter value;
  replacing a parameter does not give the replacement object that role;
- static imports, dynamic imports, CommonJS `require` calls, workers, and
  service workers (only `new Worker(new URL(path, import.meta.url))` resolves
  relative to the calling module; string worker and service-worker paths use
  the document base URL or Node's working directory, which static analysis
  does not establish, so they keep their expression and stay unresolved);
- Vite preload dependency tables (`__vite__mapDeps`): `./` entries resolve
  relative to the importing chunk; base-relative entries such as
  `assets/chunk.js` carry a `vite-output:` specifier and resolve under the one
  ancestor directory of the importer that holds them, the build output
  directory. A file found there but not analyzed, such as a stylesheet, stays
  `unavailable` with its path. Selecting only the assets directory leaves them
  `not-found`;
- route, network endpoint, storage, and vendor-marker observations;
- local source-map declarations and original
  source names and content digests;
- explicit BrowserWindow options and `webPreferences`, including statically
  resolvable preload entrypoints;
- `contextBridge.exposeInMainWorld` and `exposeInIsolatedWorld` API keys and
  bounded literal member paths;
- renderer and main-process IPC operations, literal or dynamic channels, exact
  handler locations, and conservative pairing status;
- sender, frame, URL, and origin validation candidates without claiming that a
  visible check enforces a complete policy;
- utility-process entrypoints and native `.node` binding requests without
  parsing or executing the add-on.

Overloaded `.open` calls use lexical receiver facts: ambient browser window and
document receivers are treated as browsing-context or document operations,
while locally shadowed receivers can still contribute network endpoint
candidates. A template recovered with a parser error and no cooked value stays
dynamic; its raw spelling is not treated as a valid JavaScript string.

RPC client syntax also contributes network endpoint candidates, in both
`analyze_javascript_application` and `analyze_web_bundle`, distinguished by
`mechanism`:

- `trpc:procedure:<method>` records the static member path between the root
  expression and the method, such as `invoice.list` in
  `root.invoice.list.useQuery(...)`. tRPC proxies keep these property names
  through identifier minification. React hooks and TanStack option factories
  (`useQuery`, `useMutation`, `useInfiniteQuery`, `useSubscription`, suspense
  and prefetch variants, `queryOptions`, `infiniteQueryOptions`,
  `mutationOptions`, `subscriptionOptions`) are recognized directly. The
  vanilla `query` and `mutate` methods are recognized on a root bound to
  `createTRPCClient` or `createTRPCProxyClient` in the same lexical binding, or on a
  path of at least two segments in a source containing `TRPCClientError`,
  `trpc-accept`, or `/trpc`. Factory bindings must have one unconditional
  initializer and no binding assignments; shadowed locals do not inherit client
  identity. `subscribe` additionally requires a tRPC observer
  argument (`onData`, `onError`, `onStarted`, `onStopped`, `onComplete`, or
  `onConnectionStateChange`). `this` roots and unshadowed browser globals are
  excluded. A lexical client can be named `history`, and its router segments can
  use browser-global spellings. RTK Query `endpoints` chains are excluded only
  when the root has no recognized tRPC client binding. Cache-key helpers such as
  `queryKey` issue no request and are excluded.
- `trpc:link:<link>` records the literal `url` option of `httpLink`,
  `httpBatchLink`, `httpBatchStreamLink`, and `httpSubscriptionLink` when the
  link's callee name survives bundling, including `(0, module.httpBatchLink)`
  import-call wrappers.
- `graphql:query`, `graphql:mutation`, and `graphql:subscription` record a
  named operation found at the start of a string or cooked template literal —
  the name must be followed by variable definitions (`($`), a directive, or a
  selection set starting with a field name — or in a precompiled
  `OperationDefinition` document object. A standalone Source object's `body`
  remains an operation candidate even when it has `locationOffset` metadata.
  A graphql-tag `loc.source.body` copy is suppressed only when that source
  belongs to a recovered document with the same operation and its containing
  document, location and source have proven private metadata ownership. Writes,
  escapes and classic-script global bindings retain the source observation.
  Anonymous operations are not reported.

Literal link options and precompiled document fields follow object property
order: the final definition owns the key. A later spread, dynamic computed key,
method, or accessor can make a field unknown, so an overwritten literal is not
reported as the endpoint or operation. A final explicit property after a spread
or dynamic key remains usable.

A procedure path is the server-side procedure name, not a resolved URL; the
transport URL depends on the link configuration and batching. When the proxy is
reached through a member expression, such as a webpack module binding
(`l.S.invoice.list`) or a property holding the proxy (`o.api.post.byId`), the
recorded path keeps those leading carrier segments; the procedure path is its
suffix. Utility calls such as `useUtils().invoice.list.fetch()`, `useQueries`,
and links whose callee was renamed by a minifier are not recognized.

Bundler adapters own callback roles: Webpack supplies module, exports, then
loader; esbuild CommonJS supplies exports, then module. Export extraction uses
those binding identities for assignments and declarations, so renaming either
parameter does not change the recovered names. The convention always supplies
every role argument, so a role parameter's default never runs: a defaulted
module or exports parameter keeps its role, and the default expression yields
no exports, references or chunk keys. `{exports: alias}` in the module position
binds `alias` to `module.exports`.
Other role patterns, such as rest, array, nested or computed-key patterns or a
non-identifier loader, receive no role and count as unknown findings, so the
file's analysis is partial rather than an exact empty export list. An
export-shaped write through a role binding whose value at that read cannot be
ordered against a replacement is also an unknown finding. Global
property-definition intrinsics require lexical and visible-write proof. Factory export declarations
also require the loader's `d` member to have no prior or unordered visible
replacement, including writes through lexical aliases. Unrelated loader members
do not invalidate declarations. Ordering describes declarations within one factory
activation; helper integrity on entry, effects of earlier invocations, and
arbitrary call side effects remain unproven.
Computed writes through a standalone loader's exposed module/cache table use
the shared value owner; an unknown key invalidates the original-slot proof
rather than implying a fresh chunk installation. A function stored on a
standalone loader member does not write the table merely by being defined:
the bootstrap owner excludes its deferred writes only when that member is
unread and the loader namespace stays confined. Calls, member aliases, dynamic
member reads, namespace escapes, or
receiver-based access retain uncertainty about those writes. Export names
describe recognized declarations, not a proof
of final runtime property lifetime or arbitrary helper behavior.

Each recovered bundle module retains the exact factory-source digest. A complete
bounded AST also receives a `babel-ast-v3` structural fingerprint. It ignores
ordinary identifier spellings while retaining literal and directive values,
operators, fixed property names, and selected syntax flags such as computed
keys, declaration kind, function async/generator state, update-expression
prefix, method kind, and class static state. Local names used in computed keys
remain rename-resistant; private member names are also ignored while their
method kind and static state remain represented.

This fingerprint is structural evidence for candidate matching, not proof that
two modules behave equivalently. Its scope follows the AST facts listed above;
unrepresented syntax can still collide. The exact source digest remains
available to show byte-level change, and comparison reports content changes even
when structural matching succeeds.

Version comparison includes the algorithm in its structural matching key.
Retained `babel-ast-v1` results can still match other v1 results, and v2 results
can still match v2 results, but v1/v2 results cannot structurally match v3
results. Other matching tiers remain available across algorithm versions.
Re-analyze both snapshots to compare using the v3 rules.
If fingerprint construction reaches its structural
bound, the fingerprint is unavailable and its status is `truncated`; a bounded
prefix is never presented as a complete stable fingerprint.

## Authority and unknowns

API identity is a derivation: a familiar method or property name does not
establish a browser or Electron API. The shared lexical, ambient-write, and
member-mutation owners must establish the receiver before static API facts become
roles or storage observations. Path `join`, `resolve`, and `fileURLToPath` use
proven Node imports; source-relative URL conversion additionally requires an
unmodified global or proven Node `url.URL` constructor and `import.meta.url`.
Native constructor aliases retain that identity; their local spelling does not
determine URL semantics, and replaced exports or local constructors remain unknown.
Relative results of native path operations retain filesystem-expression context;
their spelling does not turn them into module specifiers. Other calls preserve
their expressions. A property named `preload` outside a proven BrowserWindow
configuration does not establish a script entrypoint. Renderer recovery currently
covers direct BrowserWindow instances, stable local aliases, and their
`webContents`; other receiver-producing APIs remain unmodeled. Complete AST
traversal does not imply complete API-model coverage.

Artifact bytes and AST syntax are observations. Entrypoint resolution, imports,
loads, calls, and persistence relationships are static inferences and explicitly
say that syntax does not prove runtime execution. A malformed or unavailable
JavaScript file, package record, or source map produces an `unknown` graph scope
with `state: unavailable`; it is not treated as evidence that modules or source
are absent.

Source-map contents are parsed as local input. The graph stores original source names and optional content digests, not raw `sourcesContent` text.

Only explicitly present BrowserWindow values are observations. REA does not
substitute version-dependent Electron defaults for omitted `webPreferences`.
Unresolved option objects, bridge keys, API objects, and IPC channel expressions
remain unknown and make coverage partial.

BrowserWindow options and `webPreferences` can follow local `const` aliases
whose initialization precedes the use. The shared lexical and mutation index
checks the selected `webPreferences` path, so an unrelated `options.icon` write
does not discard these facts. Reassignment, relevant writes, prior escapes,
ambiguous initialization, and unresolved spreads remain unknown. The binding
association is an inference: the window observation retains the constructor
location and `resolution_sources` identifies the original object literals in
the same artifact. Inline option syntax keeps its observed Evidence. This
does not execute code or establish runtime configuration; popup overrides from
`setWindowOpenHandler` are not covered by this constant-options resolution.

Recognized literal module-table bootstraps also support bounded lexical
substitution through module exports, import helper bodies, local wrapper calls,
returned closures, object spreads, and callback parameters. Recovered Electron
paths retain source ranges, module identities, literal channels and branch
conditions as static candidates. A channel the IPC call site itself
determines, such as a local constant, resolves that call's observation rather
than adding a second one. A channel or registration handler supplied through
a wrapper argument is a candidate beside the call's own unresolved
observation, because callers outside the traced paths may pass other values.
A wrapper call that is both its own entry and reached through another entry
is recorded once when both paths find the same facts; calls that supply
different handlers or channels stay distinct.
A contextBridge exposure reached through wrapper calls records one API per key
those invocations supply, each with its own bounded member paths. Invocations
that supply the same key to one exposure call describe one API covering each
alternative object. A traced invocation whose key, API object or world stays
unresolved or guarded keeps the call's own unresolved observation.
Unknown spreads, reassigned bindings, accessors,
dynamic channels and unsupported syntax do not become exact implementations.
Literal switch cases retain their selection conditions. Possible fallthrough
remains partial; dynamic case expressions remain unknown.
This pass neither executes the bundle nor proves that runtime guards pass.
An ambiguous or unresolved handler retains its channel registration but does
not acquire a path to one arbitrarily selected callback. Unknown factory
conditions retain both return branches, including fallthrough. Short-circuit
selection distinguishes truthiness from nullishness; uncertain `??` paths
retain a nullish guard rather than a falsy guard.

Recognized module factories retain a separate initialization boundary for each
reachable return and for fallthrough. A conditional early return does not hide
later exports on the continuing path; exports and captured initializers after a
definite exit remain unavailable. Fallthrough candidates retain their branch
predicates. Exports shared by the complete set of proven exits also retain
unconditional facts. Their shared view excludes later overwrites and bounds
captured initializers by the earliest completion; branch-dependent facts keep
their predicates. Incomplete or additionally guarded exit sets cannot use that
proof. Completed factory control flow is reused within that analysis only.
Guarded main-process registrations remain candidate paths even with empty
callbacks; they do not become unconditional IPC summary facts.
Factory guards read export writes at their source position. Destructured and
spread snapshots retain their capture position rather than reading later writes.
An unproven namespace read boundary remains unknown.
Completed factory environments preserve their `exports` and `module.exports`
alias identity when a namespace escapes through an export or returned closure.
Synchronous helper calls retain the caller's factory activation and read point;
lexical captures and executing callers remain separate facts.
Async calls retain their truthy Promise identity until an explicit `await`;
generator calls produce iterators without evaluating their bodies. Iterator
advancement and Promise/iterator members remain explicitly unresolved. Awaited
function values retain their source origins and captured initialization bounds.

These paths appear as contextual `javascript-expression` nodes. An exact `api`
seed such as `desktop.copy` can trace an exposed member through a unique IPC
pairing to an external API call. `addListener` is normalized to `on`. Semantic
projection retains these boundary paths before bulk function definitions, within
the existing per-file node budget; omitted general semantics remain explicitly
partial. Wrapper expansion is bounded by one million visits/substitutions and
128 nested substitutions, with exhaustion reported as unknown coverage.

Electron API identity follows proven lexical module aliases. Namespace interop
also preserves identity when the complete Rolldown helper operations, lexical
roles, live getters, and captured intrinsic origins match, or when a stable
helper simply returns its module parameter. Harmless single-statement control
blocks preserve recognition; added operations still require proof. Literal
member and destructuring projections are retained from proven results.
Omitted or literal node-mode arguments preserve named exports; a module-valued
default projection requires a truthy literal node mode. Computed or extra
arguments remain unresolved.
Recognition uses structure rather than emitted names; other helper bodies and ambiguous
runtime fallbacks remain unresolved. Captured function identities survive later global-property
replacement, including copies through initialized aliases. Reads before an
alias initializer remain unresolved. Visible intrinsic writes before capture or
conversion are checked in their owning callable scope, including identifier leaves in nested/default/rest
destructuring and loop targets. Property keys and shadowed local bindings do not
overwrite the global intrinsic identity. Cross-call side effects, including
writes inside directly invoked local functions, are not evaluated. Other
reassignments, dynamic selections, and visibly overwritten namespace members
are unresolved.
Known Object/Reflect mutators remain recognizable through literal destructuring
of intrinsic objects and stable bound-function aliases. Calls retain bound
argument prefixes and the original bound receiver through `call`, `apply`, and
`Reflect.apply`, including generic `Function.prototype` invocation and binding
creation. Arguments follow each actual callable invocation rather than property
chain depth; rebinding retains the original bound receiver.
Visibly replaced invocation intrinsics produce unknown effects instead
of using their former call semantics; captured function aliases retain their
earlier identity. Unexamined targets remain unresolved. `Reflect.set` examines
its explicit receiver as well as its target, retaining unknown receiver effects.
Creating an unused binding does not itself mutate an intrinsic. Variable
redeclarations retain a single unconditional initializer
when they introduce no assignment or second initializer.
Stable identifier chains to fresh object, array, function,
undecorated class or RegExp syntax keep those targets separate from intrinsic
objects when initialized before use; opaque, decorated, reassigned or
not-yet-initialized targets remain unresolved. Writes during class initialization
are still retained. Function declarations are available before their textual
position; variable and class initializers must precede use.
Direct and destructuring assignment, loop, update, and delete targets are checked
through namespace aliases; unrelated member writes do not discard observed API
identity. This static check does
not evaluate arbitrary call side effects or runtime registration. Missing findings
do not establish that an application has no Electron boundary usage.

IPC pairing is an inference, not an observation. A main handler registered on an
unresolved channel may receive any literal channel, so a compatible renderer send
or `invoke` beside it is ambiguous, not unpaired. A wrapper's registration is
exempt only when every invocation is a traced direct call supplying a literal
channel, each recorded as its own finding. A guarded invocation keeps its
predicate on a call path instead, so its channel still competes without pairing.
A renderer `invoke` pairs only
with one unique `ipcMain.handle`/`handleOnce` candidate on the same exact literal
channel; a renderer send pairs only with one unique `ipcMain.on`/`once`/`addListener`
candidate. Dynamic channels are never paired, and multiple compatible handlers
are reported as ambiguous without adding a caller-to-handler edge. A matching
channel still does not prove registration order, reachability, or runtime use.

Native-addon call bindings consume the same loader identity and normalized
arguments as dependency analysis, including optional calls. Local methods or
parameters named `require` establish no native binding; `require.resolve` records
lookup rather than a native namespace. CommonJS re-export bindings require a
selected export value and an applicable shared export receiver. Arithmetic and
logical compound stores keep their dependency observations without asserting that
the addon is the selected exported value.

For `.node` bindings, member names mean “requested by JavaScript syntax.” A
resolved add-on path does not convert them into verified native exports. Native
symbol verification remains a separate deep-analysis claim.

Exact endpoint values preserve useful local diagnostics, including query values
and fragments, while removing URL username/password credentials when the value
parses as a URL. When a recognized request target cannot be resolved exactly,
the endpoint's partial resolution retains the original source expression with
its call-site provenance. This does not establish that the request executed.
Artifact paths, digests, parse locations, and analysis metadata remain
actionable because REA is local-only.

## Safety boundary

The reconstruction path never uses `eval`, `Function`, `vm.runInContext`, a DOM,
bundle `push` handlers, or application bootstrap code. The Webpack/Rspack fixture
used by the test suite mutates a global and throws if executed; reconstruction
recovers its four module factories without triggering either side effect.

Directory readers do not follow symlinks. Artifact paths pass through the shared
normalizer and collision registry, ASAR entry bytes are rechecked against the
inventory digest before parsing, and malformed ASAR operations return typed
format diagnostics that retain the local container path. Native add-ons are
represented by metadata only.

POSIX directory names are read as raw bytes and admitted as logical paths only
when they round-trip through UTF-8. Invalid names are left untouched, retained
siblings remain inventoried, and traversal coverage is marked unknown with the
first rejected basename bytes identified in hexadecimal.

## Bounds and coverage

The reconstruction keeps internal resource safeguards for artifact entries,
cumulative artifact bytes, bytes per entry, compression ratio, path depth and
length, selected text files, text bytes, AST nodes, and cooperative parse time.
These safeguards are not caller-selectable output budgets. Source-map parsing
reports truncation when its format or parser safety boundary is reached. The
application graph has no aggregate node, edge, root, or observation prefix cap.

Semantic evaluation retains at most 256 distinct primitive candidates per
expression and at most 1 MiB of worst-case JSON string bytes across a normalized
primitive value's string candidates. The byte budget estimates six JSON bytes
per UTF-16 code unit, the expansion bound for escaped strings, and bounds both
retained candidate strings and temporary canonical-key serialization. This is
an in-memory semantic allocation bound independent of CLI or MCP transport
budgets. Source literal bytes remain in the parsed source and artifact evidence;
when a normalized semantic value exceeds the bound, its value is unknown and
coverage is partial. Direct string literals, cooked templates without
substitutions, and derived strings all use this normalization boundary. A
single exact primitive is validated without allocating deduplication or sort
state or serializing a canonical key. Configuration defaults use the same
normalizer; limited defaults retain `value_resource_limit` and an anchored
resource-limit unknown. Known null, false, zero, and empty-string defaults stay
exact. This primitive-value bound does not truncate lookup identities such as
source paths, field names or request endpoints. Full endpoint properties remain
available for endpoint queries, tracing and comparison. Each analysis records encountered limit classifications independently of
later projections: a selected healthy sibling can remain exact while whole-file
coverage reports the encountered bound. Projection preserves limiting values
from the shared property-slot owner. Expression
evaluation and provenance walks stop after 256 nested levels. Union products
and string lengths are checked before allocating combinations or concatenated
strings. When a boundary is reached, the value stays unknown, semantic coverage
becomes partial, and graph evidence retains the expression location and typed
limiting reason. The number of unresolved alternatives is unknown; it is not
reported as an exact omission count.

Byte, entry, path, and graph-shape bounds are hard limits. The parse deadline is
checked before and between bounded parsing and traversal phases; the synchronous
Babel and JSON parser calls cannot be preempted mid-call, so their input byte
bounds remain the hard protection for an individual call.

Byte-identical assets share a content-digest node. Every distinct observation
and inventoried containment edge is retained. If parsing or artifact safety
boundaries omit input, coverage reports that omission; when an exact omission
count is not knowable, `omitted_count` is `null` rather than a guessed value.

### Analyzer and result admission

Application analysis projects semantic relationships one source file at a time.
After projection, it retains only the lexical module facts and exported return
shapes needed to build application relationships. Full source IR does not stay
resident for every file together. Callable ownership and contained-reference
queries use per-file range indexes, while call sites use exact-range lookups.
Existing node budgets and coverage reporting remain in effect.

Progress identifies the source file being parsed and projected. Cancellation is
checked between files and throughout result transfer. The owned analyzer can
be stopped while its synchronous parser or semantic extractor is active;
the CLI/MCP process remains available for control requests.

Graph and Evidence identifiers hash canonical JSON incrementally, without
assembling a single string for the whole graph. The canonical bytes and existing
identifiers remain unchanged. The opt-in regression check is
`npm run verify:javascript:digests`;
it hashes a value larger than the running Node engine's single-string limit.

Both application CLI routes stream complete JSON and JSONL output in bounded
chunks, including field filters and `--full-output`. They wait for each stdout
write instead of constructing or reparsing a document-sized string. The opt-in
`npm run verify:javascript:output` checks the actual CLI formatting boundary with
a temporary output file larger than the running engine's string limit, verifies
its bytes and digest, and removes it. Use `-- jsonl` for the compact JSONL check.
Each check needs space for one output file plus a 1 GiB free-space reserve.

Other CLI formats and `--token-count` still assemble whole strings.
Field selection remains useful when the caller needs a
smaller view, for example `--format json --filter-output
evidence_id,normalized_result.statistics`. Streaming output does not bound the
memory needed to construct the analysis graph itself.

JavaScript source parsing, static analysis and semantic projection run in one
owned analysis process, reused sequentially across files. Target code is never
executed. The analyzer defaults to 1024 MiB of V8 old-space and a 300000 ms
deadline per source, including startup and fact transfer. Select
`max_heap_mb` and `analysis_timeout_ms` through MCP, or `--max-heap-mb` and
`--analysis-timeout-ms` on the dedicated CLI command. These choices control the
analyzer; the caller's `NODE_OPTIONS` still controls the CLI/MCP process heap.
For defaults across new MCP operations, use `update_analysis_settings` with
`javascript.max_heap_mb` or `javascript.analysis_timeout_ms`. Explicit per-call
arguments take precedence, and accepted work keeps its original settings. See
the [settings design](design/limits-and-recovery.md#precedence-and-lifetime).
V8 old-space limits do not impose a process RSS limit. When REA runs on Bun,
the analyzer ignores the V8 heap flags; resource failures then report
`worker_heap_limit_bytes` as null instead of a requested or V8-reported limit.
On Windows, the analyzer's owned Job Object instead limits its committed
memory to `max_heap_mb` plus a 512 MiB reserve for Bun itself (1536 MiB by
default). Reaching it fails the current source with the same memory resource
failure and reports `worker_process_memory_limit_bytes`, also a coverage limit;
the next source starts a new analyzer. Bun elsewhere enforces no analyzer limit.

The default semantic capacities are 100000 nodes across the application and
20000 per source. Large bundles may explicitly select `max_semantic_nodes` and
`max_semantic_nodes_per_file` (CLI: `--max-semantic-nodes` and
`--max-semantic-nodes-per-file`), each from 1 to 1000000. The per-file offer is
also bounded by the remaining application capacity. Raising these controls does
not bypass worker heap, execution deadline or parent result admission. Truncated
coverage lists both effective ceilings, `max_semantic_nodes` and
`max_semantic_nodes_per_file`. The limitation names only the ceiling that
stopped retention. Omitted relationships remain unknown.

Unknown records have independent defaults of 100000 across the application and
20000 per source. Select `max_semantic_unknowns` and
`max_semantic_unknowns_per_file` (CLI: `--max-semantic-unknowns` and
`--max-semantic-unknowns-per-file`), each from 1 to 1000000. The parent offers the
remaining capacity to the worker, and rejects excess records before adoption.
Unknown admission happens before canonical identity and provenance construction.
When capacity is exhausted, coverage is partial and truncated. Coverage lists
both effective unknown ceilings, `max_semantic_unknowns` and
`max_semantic_unknowns_per_file`. The limitation names only the ceiling that
stopped retention. `coverage.omitted_unknown_occurrences` counts examined
emission occurrences by family and reason, including repeated emissions. It does
not claim distinct discarded identities or count frontiers in unexamined source.
Omitted unknown provenance and IDs are not retained. Existing source, node,
execution and memory limits continue to determine examined coverage. Raising only
a node capacity does not raise the unknown capacity. Graphs without unknown
omissions omit this optional coverage field, preserving their existing identities.

These node and unknown capacities bound retained graph projection. Parsing,
static analysis and semantic fact construction precede that projection for an
admitted source. Lowering the capacities can reduce projection and retention
work, but does not bound upstream semantic-analysis time or memory. Select fewer
`source_paths` to reduce the sources analyzed; heap and deadline controls set
separate resource failure boundaries with the runtime-specific limits above.

While sources remain, the sequential worker reserves one next compact static
checkpoint at its 8 MiB bound with the same 6x retention expansion used at
admission. Earlier checkpoints are already charged to retained bytes; the
remaining inventory does not multiply the reserve. Streamed file transfers keep the default 512 MiB
allowance, and can grow with the parent's offered retention budget (8x byte
expansion), up to 2 GiB. Individual records remain bounded to 8 MiB. The 8 MiB
record ceiling and the 2 GiB file maximum have no runtime override, and raising
`max_heap_mb` does not raise them. The effective file ceiling follows the
parent's offered result budget. On Node, a larger CLI/MCP process heap
(`NODE_OPTIONS`, for example `--max-old-space-size=<MiB>`, after restarting that
process) can raise it up to 2 GiB. Selecting fewer `source_paths` can also
raise that effective allowance, because the reserve for remaining sources and
earlier retained results reduce the offered budget. Neither change raises the
record ceiling or the 2 GiB maximum. The parent
still independently checks actual bytes, record overhead, digests and source
identities before adopting results.

A source that exhausts the analyzer heap does not terminate the CLI/MCP
process. On Node, the failure names `max_heap_mb` (CLI `--max-heap-mb`), the
effective mebibytes, the inclusive range 128 to 16384, and the 1024 MiB
default. A changed value applies on the next analysis, which starts a new
worker. It does not change a worker that is already running and does not
require restarting the REA server. On Bun, the same heap-exhaustion diagnostic
is not attributed to that V8 old-space limit, because Bun ignores the flag.
Raising `max_heap_mb` does not raise the parent result budget,
the transfer record ceiling, the 2 GiB transfer file maximum, the CLI/MCP
process heap, or fixed parser limits. The parent result budget follows that
process heap. On Node, set `NODE_OPTIONS` (for example `--max-old-space-size=<MiB>`)
in the environment that starts the CLI or MCP server, then restart that
process, to raise the parent heap and the result budget. A completed static
checkpoint that does not fit the parent's remaining heap names that parent
process heap. Increasing `max_heap_mb` does not raise it. On Node, the same
`NODE_OPTIONS` restart can raise the parent heap and admit the checkpoint.
Completed static facts are retained, other files can still be analyzed,
and unexamined semantic relationships remain explicit unknowns. The parent
also checks transfer expansion and accumulated results against its remaining
heap before accepting semantic facts. A resource-limited result has partial
coverage, the observed limits and an `analyze-javascript-source` unknown scope
with the specific failure, including captured diagnostics when available.
Resource failures do not increment syntax parse failures. There is no fixed
source-length cutoff.

Static observations also need memory when expanded into nodes, relationships
and Evidence. If that expansion does not fit, the file node retains
`static_analysis` and any admitted `semantic_module_analysis` observations,
including their exact values and source locations. Use the public modules item
view to read them. The graph marks those unexpanded relationships as unknown.
If cumulative result capacity is exhausted, analysis stops; inventoried but
unexamined files remain present with explicit unknown scopes.

### Large local JSON inputs

CLI workflows parse larger JSON input files incrementally from one verified
regular-file handle, without constructing a document-sized string. Smaller
files retain native JSON parsing. Both paths require strict JSON and valid
UTF-8, and return one complete value; the assembled object still needs memory.
An individual JSON string exceeding the native length limit or the available
heap headroom for assembly returns
`resource_constraint` with `input_reason: "too-large"`. Supply a smaller valid
value; for Evidence workflows, re-analyze a smaller selection of the original
target and use its complete Evidence. Splitting JSON text or trimming Evidence
fields does not produce a valid workflow input.

Evidence bundle and analysis snapshot file readers still decode whole
documents. Their runtime string-limit failures report a resource constraint
with the selected path, observed bytes and UTF-16 limit, rather than malformed
JSON.

## Verification boundary

The source-owned fixture covers an extracted directory, a direct ASAR with an
unpacked native add-on, a direct ASAR whose unpacked native companion is
missing, and an ASAR nested beneath a directory. Tests also cover deterministic
reruns, parse-not-execute behavior, source-map parsing, global source-map
limits, malformed structured data, invalid containers, traversal, symlink
escape, oversized text, cancellation, AST truncation, and repeated content
identities. A separate synthetic Electron fixture covers explicit safe and
unsafe preference values, preload and contextBridge surfaces, literal, dynamic,
paired, ambiguous, and unpaired IPC, validation candidates, utility processes,
and native binding requests. These fixtures establish parser and artifact-reader
claims; they do not replace the later operator-supplied real-application
benchmark.

URI schemes are classified independently of local file names: a reference such
as `web3:app.js` remains external even when an artifact has that literal name.
Scheme characters may include digits after the initial letter; a relative path
such as `./web3:app.js` still names a local artifact.

Package `exports` fallback arrays are supported both at the top level and under
the root `"."` entry. The resolver selects targets in declared order using the
same conditional and invalid-entry handling as nested exports arrays.
Nonempty arrays containing only inactive conditions remain unmatched, allowing
the enclosing condition object to continue to a later active condition.
Empty arrays and explicit null targets keep their blocking outcome.
Refusal evidence distinguishes those source values and retains condition names
from unmatched nested targets rather than reporting array indices.
For imports and requires, the active Node conditions include `module-sync`;
earlier active conditions retain precedence over later ones.

Package self-references use the importer's enclosing package scope before
installed dependencies. ESM requires the parsed package name to equal the
metadata name; a scope-only name such as `@scope` cannot capture `@scope/pkg`.
CommonJS retains Node's raw-request name/prefix matching. Both paths preserve
the original specifier and select exports under their own loader conditions.

Exact package-private `#alias` specifiers resolve against the importer's
enclosing `package.json` `imports` map — the nearest same-container package
scope, stopping at a `node_modules` directory so a nested package cannot inherit
an ancestor's aliases. Selected targets are package-local `./` files with no
extension or index fallback, using the same condition, array, and null selection
as exports subpaths. A missing key, explicit null, or out-of-scope alias keeps
an unresolved edge with that reason. Wildcard keys (`#internal/*`), recursive
`#` targets, and external-package import targets remain unresolved.

Exact keys such as `#/x` are literal lookup identities. `#` and names ending
in `/` are invalid. Imports arrays skip invalid parent-relative, absolute, and
URL targets before selecting a later package-local file; an unsupported bare
package or recursive alias keeps its unresolved outcome rather than selecting
a later fallback.

For a proven `createRequire(new URL(relativeFile, import.meta.url))` call,
relative `require()` edges use the selected filename's directory and retain the
source-relative `resolution_base_path` on the graph edge. This follows Node's
`createRequire(filename)` contract; the path is a loader-resolution fact and
does not change the source file or call-site Evidence identity. If the filename
cannot be proven, REA keeps the require target unresolved rather than silently
resolving it from the caller's directory.

Module-reference graph edges, including native-addon `loads` edges, retain
`properties.operation`: `load` identifies
an import or loader invocation that may execute the target; `resolve` identifies
a proven `require.resolve()` lookup that discovers a target without executing it.
Both retain the exact specifier, resolution mode, selected resolution base, and
call-site Evidence. Resolve-only edges do not propagate application ownership or
create executable-import gaps when their targets are missing. A modified
`.resolve` member remains an uncertain `load`, because its replacement may execute
code. These static facts do not establish that a call runs at runtime.

ESM relative module paths, legacy package subpaths without exports, and selected
package exports targets use URL suffix handling and one percent-decoding pass.
Bare specifiers retain their complete query/fragment text for exports key matching.
For dependency lookup, ESM constructs a package metadata URL instead of treating
the parsed package name as a literal directory. A root request such as `legacy?x`
does not load either `node_modules/legacy?x` or `node_modules/legacy`; an exact
self-reference with that metadata name can still select its exports first.
Without an exports map, ESM subpaths select exact files; directory imports and
extension fallback are refused. CommonJS relative paths and legacy package main
fields retain literal filename punctuation. Exports targets must start with
`./` and exclude `.`, `..`, and `node_modules` path segments, including their
encoded forms, before URL normalization. Arrays skip invalid exports targets
in declared order, including URLs that escape the package root after normalization.
Selected package targets use the normalized URL path for lookup; tabs and
newlines in the URL text are removed by the URL parser. CommonJS package targets
reject encoded separators anywhere in the selected URL; ESM checks its pathname.
URL decoding and file lookup failures for a selected target do not select a
later entry. Rejected references retain the package metadata
path, original target, failed constraint, and importing source location.

HTML script references resolve to exact inventoried files after applying the
document base and query/fragment rules. As in a browser, the script URL and base
href are read without surrounding whitespace or embedded tabs and newlines, and
their percent-encoded path bytes are decoded; encoded dot and separator bytes
are still rejected. CommonJS module lookups retain extension and directory
resolution.
ESM, HTML, and URL references apply URL dot segments to empty path segments:
`./assets//../app.js` selects `assets/app.js`, while a remaining empty segment
such as `./assets//app.js` stays unavailable. CommonJS keeps filesystem path
semantics and selects `app.js` for the same text.
Unresolved HTML references retain their declaration, source range, and resolution
reason in the renderer observations.
HTML script source ranges follow the HTML parser across LF, CRLF, and bare CR
line endings, preserving UTF-16 columns.
Inline JavaScript in local HTML, meaning classic or module `<script>` bodies
without a `src` attribute, is not analyzed. Each HTML file that has one gets an
unknown `parse-html-inline-scripts` scope with the exact body count and the
script type and source range of the first 100 bodies; beyond that, coverage is
truncated under the `html_inline_script_locations_per_file` limit, and the
scope's evidence counts the omitted locations. The graph names the
file and up to 10 starting lines in its limitations, and coverage is partial. Import maps, speculation rules, data blocks, and blank
bodies are not JavaScript and are not reported.

For static source relationships, an explicitly requested declaration filename
(`.d.ts`, `.d.mts`, or `.d.cts`) retains its inventoried identity through both
`import` and `require`. A declaration found only as an emitted-extension fallback
remains unavailable as a runtime implementation. Package URL targets decode
filename escapes once, including dots within filenames; forbidden whole segments
and encoded separators remain rejected. ESM local-path classification uses the
authored request before URL whitespace preprocessing, so leading whitespace
cannot turn a bare request into a relative file dependency.
For example, a leading tab or newline before `./dep.mjs` remains a bare
package request; Node's later package-URL normalization can resolve it under
`node_modules`, independently of a same-named file beside the importer. Resolver
qualification checks the exact path and file existence: [`import.meta.resolve()`](https://github.com/nodejs/node/blob/v24.22.1/doc/api/esm.md#importmetaresolvespecifier)
alone can return a URL for a missing file.
