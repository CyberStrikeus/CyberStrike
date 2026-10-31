# Cross-layer JavaScript application workflows

REA derives a complete reachable feature trace from one authenticated JavaScript
Application Graph and compares two authenticated graph versions. The MCP tools
are `inspect_analysis_view`, `trace_application_feature`,
`trace_javascript_semantics`, `compare_application_versions`,
`compare_source_to_bundle`, and `compare_javascript_export_shapes`; their CLI
equivalents use the same names with hyphens. `inspect_analysis_view` projects a
summary, module page, typed module references, or one module from already completed application
Evidence; it does not walk relationships.

`inspect_analysis_view` also projects retained `inspect_binary_layout`
Evidence. The remaining workflows consume Evidence produced by
`analyze_javascript_application` or `reconcile_javascript_runtime`. They do not
read an artifact, execute application code, attach to a process, or open a
native-analysis provider. Static artifact observations, passive runtime
observations, relationship inferences, and unknown or unavailable facts retain
their original graph authority.

`analyze_javascript_application` Evidence retains the structural JavaScript
Application Graph and a separate semantic relation graph bound to the same root
artifact digest and structural graph ID. Semantic tracing requires the semantic
relation graph and reports when it is unavailable rather than treating missing
data as an empty graph.

Worker progress reports the source path and last observed parse, static,
semantic, projection or transfer stage. These notifications do not measure
stage CPU/time or establish the root cause of a slow or incomplete analysis.
Semantic projection limits bound retained output, not upstream analysis work.

Explicit TypeScript `import type` and `export type` declarations remain source
facts and do not create runtime import or export relationships. Type export names
are reported separately from value export names. Inline `type` specifiers can
leave an empty import or re-export with side effects under
[`verbatimModuleSyntax`](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html);
REA retains those dependency candidates and reports the unavailable compiler
options rather than assuming the dependency is erased.

The semantic graph wire format stores shared non-location provenance once in
its required `evidence_contexts` table. Each node, relation, fingerprint, and
unknown retains its exact `evidence.location` and names the owning context with
`evidence.context_id`. This is a breaking representation change: consumers
reading fields such as `evidence.authority` must look up the context by ID and
combine its fields with the fact's location. Semantic trace results include the
canonical context subset referenced by their returned facts, so those facts
remain self-contained in the response.

Content-deduplicated module references match every retained observation path.
A path-filtered reference reports the caller-selected path while keeping its
shared node identity. Item selection also accepts any retained path when it
identifies one module; if several module kinds share that path, select the
reported `node_id`. Node-ID selection uses the stable representative path.

## Retained module facts

For canonical identities and retained source-range counts, query the existing
`inspect_analysis_view` tool with a typed module-reference projection:

```json
{
  "source": {
    "kind": "retained-evidence",
    "evidence_id": "ev_ACTUAL_PARENT_ID"
  },
  "view": {
    "kind": "javascript",
    "collection": "modules",
    "projection": "references",
    "where": { "path": "main.js", "kind": "javascript-module" },
    "offset": 0,
    "limit": 16
  }
}
```

Replace the parent ID with the actual analysis summary's `parent_evidence_id`.
Filters match exact retained paths and kinds. Omission includes all values;
`path: null` selects an unavailable path and `path: ""` selects a recorded empty
path. Multiple identities can share a path. The default offset is 0 and limit
is 64; follow `coverage.next_offset` for later matching rows in retained order.

Each row contains its `node_id`, kind, path, canonical identity, retained
source-range observation count, and distinct supporting authority/state/confidence
combinations in `basis`. These counts do not prove unique reference sites or
runtime loading. Use the existing module item view with the row's `node_id` for
exact source ranges and complete observations. The result retains parent/query
Evidence identity, artifact identity, limitations and unknowns. `source_coverage`
keeps selected/unselected sources, graph coverage and unknown counts separate
from page exhaustion; an exhausted or empty page cannot prove absence from an
incompletely analyzed application. CLI `inspect-analysis-view` reads the same
request from a JSON file; portable input uses `source.kind: "inline"` with the
complete parent Evidence.

## Retained file and native facts

Read metadata, native inventory and unavailable processing scopes directly from
retained application observations:

```json
{
  "source": {
    "kind": "retained-evidence",
    "evidence_id": "ev_ACTUAL_PARENT_ID"
  },
  "view": {
    "kind": "javascript-facts",
    "where": { "paths": ["package.json", "build/Release/addon.node"] },
    "property_keys": [
      "name",
      "version",
      "bytes",
      "availability",
      "operation",
      "analysis_status"
    ],
    "offset": 0,
    "limit": 32
  }
}
```

Each row preserves its node identity, observation ID, source-map reference and
original Evidence, including location, authority, confidence, coverage and
limitations. `property_keys` selects exact retained property names; absent keys
stay omitted and retained null values stay null. An empty list requests only
identity/provenance. Observations are not merged into a single asserted fact.
When property names are unknown, opt into
`include_available_property_keys: true`. Each returned row then lists its
original `available_property_keys`, without unselected values; combine this with
`property_keys: []` for discovery only. The default is false, so known-field
reads do not pay for field inventories. Keep node/observation IDs paired when
combining rows; location-related observations need not belong to the same node.

`where.paths` compares exact Evidence `artifact-path` values or `source-range`
sources. Empty query strings remain valid selectors, though current location
contracts require nonempty paths/sources. It does not inspect display labels or a
property named `path`, normalize URLs, or reopen files. Omission includes unknown
locations; an empty list matches none. Optional `where.kinds` filters original
node kinds, with an empty list likewise matching none. Multiple locations of
shared content remain separate rows with the same canonical node identity.

These rows select application-graph observations. Semantic relationships and
semantic unknown records remain in complete parent Evidence and trace tools.

Rows follow retained node/observation order. The default offset/limit is 0/64;
follow `coverage.next_offset`. Page totals count matching retained observations,
while `source_coverage` preserves caller selection and application/semantic
partial or unknown states. An empty or exhausted page does not establish absence
outside examined coverage. Complete source Evidence remains available through
export. CLI `inspect-analysis-view` and portable Evidence use the same contract
and application implementation as MCP.

## Feature tracing

Select one literal seed kind: node ID, route, string, API, IPC channel, module,
or native export. Matching is exact or literal substring matching; regular
expressions and executable predicates are not accepted. The trace includes all
matching seeds and the complete graph reachable in the selected direction.
`both` follows relationships in either direction, except that a container
reached through `contains` from one of its children only leads further up its
containment chain, so a shared asset or artifact root does not pull in its
other children.

When a string seed has no application match and the supplied Evidence has a
semantic graph, `semantic_discovery` lists matching retained semantic node
labels and direct string call arguments using the same matching mode and case
rules. These are candidate starting
points, not application trace matches. Its graph coverage and total describe the
retained graph; missing or partial source coverage cannot establish absence.
Results follow retained node order and default to offset 0 and limit 64. Supply
`semantic_page` and follow `next_offset` for further matches. Use a returned
`trace_seed` with the same application Evidence and `trace_javascript_semantics`
to examine relationships from that node. Other typed seeds do not search labels.

The result contains the matching basis, complete reachable subgraph, terminal
paths, authority summaries, and native handoffs. A handoff binds
the exact native artifact digest and requested exports from the application
graph. Trace direction selects the reachable addons; requested
exports for each selected addon come from the complete supplied graph, so an
outgoing trace does not discard an incoming export association. Existing Hopper
or Ghidra Evidence is linked only when its subject digest
matches exactly. Otherwise the result recommends provider-neutral follow-up
tools and reports `requires-provider-analysis`; it never starts or switches a
provider implicitly.

A handoff requires the add-on's exact content identity. Unavailable unpacked
companions remain visible in the trace graph with their canonical path,
availability and container-backed Evidence. They yield no actionable handoff
until their bytes are available and the application is reanalyzed; the archive
digest does not identify the missing add-on. An empty handoff list does not prove
that the trace contains no native components. Source partial coverage remains
visible independently of handoff eligibility.

## Semantic relation tracing

`trace_javascript_semantics` queries the authenticated companion graph without
rereading mutable files. A seed may identify a semantic or application node,
literal, function fingerprint, property, endpoint, event, or boundary field.
For a recovered parse, coercion, or validation boundary, its field value is the
static operation's method name (for example, `Number`).
When a recovered boundary call directly supplies a scalar binding, the graph
connects the boundary to that binding; unresolved boundary calls remain
candidates. A boundary nested inside another expression or compound assignment
does not establish a direct result binding.
The query declares backward provenance, forward influence, callers, or
ownership and can restrict admitted relation kinds. REA returns every matching
seed and the complete reachable subgraph; callers do not choose node, relation,
depth, function, module, seed-match, or page budgets.

The extractor covers lexical definitions and reads, literal seeds, static
property slots, object reads/writes/spreads/destructuring, closure captures,
uniquely resolved local calls, argument/return flow, and explicit Promise
construction, chaining, aggregation, await, return, assignment, and
detachment. It also recovers static candidates for EventEmitter
registrations/removals and dispatch, Node timers and cancellation handles, asynchronous
`node:child_process` creation and ownership, configuration sources and direct
defaults, request construction and response consumers, parse/coercion/
validation boundaries, and built-in resource acquisition/release.
Reassignments connect retained right-hand reads to the binding or property
write. Compound assignments also retain the previous-value input; logical
assignments keep conditional inputs as candidates. These edges describe
influence without evaluating arithmetic or establishing execution order or the
resulting value. Deferred callback bodies do not become inputs to the enclosing
assignment. Computed method keys belong to the enclosing callable; parameter
defaults and method bodies belong to the method. Uncertain later property reads
remain opt-in through `include_ambiguous_dynamic_edges`.

Binary, logical, unary, template, conditional, and sequence expressions retain
`influences` edges from supported immediate inputs to the result, then to a
direct declaration, assignment, call argument, or return. These are static
dependencies, not aliases or proof that the expression executed; conditional
operands and logical-assignment writes carry `conditional: true`. Unsupported
operand dependencies, unmodeled receiving containers, dynamic call results,
and sequence side effects remain unknown. An applicable
unknown makes the trace status `partial` even when a seed was found. Literal
operator operands, direct call arguments and directly returned scalar literals
can also be seeds. Older graphs that only recorded a call-site literal remain
searchable. The offered per-file node capacity also bounds the producer's
expression and operand collections before graph projection.
Expression nodes and unknowns share the existing per-file graph admission
budgets; omitted facts make graph coverage truncated and the trace partial.
Consumers that previously treated `found` as compatible with a relevant
unknown should handle `partial` and inspect the returned unknowns. Retained
graphs without `influences` edges remain readable but do not gain edges until
the application is analyzed again.
Global timer, `fetch`, `WebSocket`, `JSON.parse`, and coercion calls receive
these built-in effects only when the file has no visible possible write to that
global, including a computed write through a global object. The check does not
evaluate order or reachability, so a later or guarded polyfill write also
removes the resolved effect.

Local callback candidates do not establish a complete target set when a
conditional write may leave a parameter, catch binding, or uninitialized
variable unchanged. These calls retain candidate edges and dynamic uncertainty;
default traces remain ambiguous with partial coverage. Opt into
`include_ambiguous_dynamic_edges` to traverse the candidates. Proven preceding
unconditional assignments, including writes dominating a read in the same
conditional block, can resolve a target; later writes do not replace an
earlier read or captured alias. Unproved ordering across branches or function
activations remains conservative. Returned-reference effects use the same
read-position facts as call resolution.

Returned-reference effects share one property-projection state per source read.
When several paths reach that read, differing keys at the same depth become
wildcards; differing depths become an unknown-depth selection. This retains a
conservative superset of the represented local targets rather than enumerating
every alias history or dropping paths at a query cap. It can add possible effects,
including for finite projection cycles. Static limitations disclose this loss of
precision; semantic graphs retain `dynamic-property` unknowns at the affected
callee coordinates, and captured web bundles identify the affected script keys.
These candidates do not prove runtime calls or mutations. Existing source-worker
and result-admission limits still apply.

Mutation tracking covers explicit member assignments, updates, deletion, and
loop assignment targets, including the supported local aliases and shared
nested references. Calls conservatively invalidate exposed mutable references;
callee bodies and built-ins such as `Object.assign`, `Reflect.set`, and
`Reflect.deleteProperty` are not interpreted to establish exact post-call
values. This uncertainty does not prove that a call actually mutated a value.
Interprocedural aliasing beyond the supported call-site references remains
outside this mutation pass.
For process configuration, only known environment value slots and canonical
argument indexes are treated as primitive when passed to calls. Unknown or
inherited selections can expose a mutable prototype, so later reads of that
configuration container retain uncertainty; earlier top-level reads and unrelated
configuration containers remain independent.

Function fingerprints commit normalized syntax, control-flow shape, relation
shape, literal sets, arity, and detected effects without using local names or
source offsets. Function-local directive literals contribute their values while
preserving escape spelling: `"use\x20strict"` differs from `"use strict"`.
Quote style, formatting, and local names remain normalized. Equal duplicate
fingerprints remain ambiguous.
Fingerprints are static candidates, not behavioral-equivalence proofs or a
version-independent identity. Re-analyze affected sources and obtain new seeds
after analyzer corrections; previously retained Evidence remains queryable using
its original component commitments. Dynamic
calls/properties/names, parser recovery, unresolved handles, and unsupported API
shapes stay explicit unknowns; a missing relation is never reported as proven
behavioral absence.

Semantic relations use static-inference authority. `resolved` means the static
target identity was unique within admitted analysis; it does not mean the path
executed. Candidate edges are excluded by default, require explicit opt-in, and
keep the result ambiguous. Runtime Evidence can later corroborate an exact
mapped candidate, but structural reachability, semantic influence, runtime
observation, and causal proof remain separate claims.

Semantic literal nodes keep their complete value in `properties.value`; literal
queries match that field. Call-site nodes also retain direct scalar arguments in
`properties.arguments`, with source argument indexes; literal queries can start
at those call sites. These are syntactic facts, not runtime values, and an index
after a spread is not necessarily the runtime argument position. Nonliteral
arguments and values not representable in JSON are omitted. The primitive byte
bound and the worker transfer record ceiling can also omit direct values; the
call-site unknown reports the applicable limit. String labels use
`string literal` when that is
shorter than the complete JSON value. A literal's `identity.role_key` commits
its canonical JSON value as `value-sha256:<digest>` when the digest key is
shorter; smaller values keep their existing JSON key. This keeps large values
out of identity and display metadata without expanding short values or
truncating their Evidence.

New analyses therefore produce different IDs for hashed literals from the
earlier payload-bearing role keys. Use IDs returned by the selected parent
graph and read literal values from `properties.value`, rather than decoding
role keys or labels. Previously stored graphs and their original IDs remain
valid inputs.

Endpoint observations keep their value in `properties.value`. When
`properties.resolution` is `partial`, that value is the unresolved source
expression, with an identity distinct from an exact endpoint of the same text.
Semantic request and response nodes keep their endpoint in `properties.endpoint`. Endpoint
lookup identities are preserved independently of the primitive-value lattice's
byte budget. An oversized normalized literal can become unknown while the same
string remains an exact endpoint for tracing and comparison. Endpoint
identity keys use `value-sha256:<digest>` over the canonical JSON string when
that is shorter, or when the original value starts with the reserved digest
prefix. Other short endpoint keys remain unchanged. Endpoint labels use the
shorter of the exact value and `<kind> endpoint`; semantic request/response
labels use the shorter of the endpoint and operation method. These labels are
display metadata, not endpoint lookup values.

New analyses therefore change hashed endpoint IDs and longer endpoint labels.
Use IDs from the selected graph and read the complete endpoint properties;
previously stored graphs still support their original IDs. Literal endpoint
search, semantic tracing, and version comparison use the preserved values.

Event and listener nodes likewise preserve the complete event name in
`properties.event_name`. Event role keys use the same reserved-prefix string
digest rule, scoped to the emitter; repeated registrations, removals, and
dispatches keep one event per exact emitter/name pair. Long event labels use
`event`, and listener labels use the shorter of `<method>:<name>` and
`<method>:listener`. Dynamic names remain `null` with explicit uncertainty. New analyses
change hashed event IDs and longer event/listener labels; query the preserved
name or select IDs from the parent graph. Previously stored graphs keep their
original IDs and remain valid trace inputs.

Empty string event names remain exact identities and can be selected with an
event seed whose `name` is `""`. A property seed selects the named slots and
retained accesses whose producer established that no slot was resolved. Those
accesses keep their source locations and unknowns; a missing retained relation
does not prove that an access is slotless. New access nodes record
`property_slot_resolution` independently of whether capacity permitted retaining
the resolved slot node or its relations.

## Version comparison

REA pairs entities only when a tier produces one unique candidate on each side.
The tiers are exact content digest, exact module-source digest, exact node
identity, source-map identity, structural fingerprint, and a semantic key for
non-module entities. Lower tiers never override a higher unique match.

Module ordinals, stable minified names, and fuzzy text similarity are not
persistent identities. Duplicate candidates remain ambiguous. Source-map and
structural matches are high/medium-confidence inferences rather than exact
facts. Each item is `unchanged`, `added`, `removed`, `changed`, or `unknown`,
and the result includes its basis, candidates, changed dimensions, Evidence
links, limitations, and a `changed_from` graph containing all compared nodes,
their observations, and relationships.

A matched pair whose only differing dimension is `location` counts as
`unchanged` when both input graphs have complete coverage and its neighboring
relationship identities are resolved. This includes an
identical module shifted by an earlier bundle edit and a named IPC channel
observed at a new offset. The item still reports `dimensions: ["location"]`
and both node IDs; the graph retains both original observations and coordinates.
Content, property, and complete relationship differences still count as
`changed`. With incomplete coverage, relocation alone remains `unknown` and
retains the location and coverage dimensions. Matching confidence is unchanged:
an inferred pair is not promoted to exact identity by this classification.

Complete inventory does not resolve ambiguous or unmatched relationship targets.
A matched module with identical bytes can therefore remain `unknown` when a
neighbor, including its containing chunk, has no cross-version match. The item
retains its exact content match, coordinates, candidate inventory, and an explicit
relationship-identity limitation. `coverage` is added to its dimensions only for
incomplete inventory. Definite content, property, or complete topology differences
remain `changed` while retaining any separate relationship uncertainty.
An unknown item with no observed content, property, or relationship difference
does not emit a `changed_from` edge; its pairing and uncertainty remain in the item.

Within a valid `file_occurrence`, `container_sha256` records provenance and does
not by itself count as a semantic property change. The graph retains the original
occurrence; its path and source digest still participate in comparison.
Unrecognized occurrence metadata remains part of property comparison.

One-sided absence is `added` or `removed` only when the opposite input graph has
complete coverage. With partial, unavailable, or truncated input, the same
condition is `unknown`. The comparison retains every classified item and
ambiguity candidate. Coverage carries omitted counts and limits from each input
graph; comparison adds no caller-selected item, candidate, graph node, or edge
budget. Unresolved comparison items are recorded as a residual unknown linked
to the comparison Evidence in a live session.

## Historical source-to-bundle comparison

`compare_source_to_bundle` compares one cryptographically committed
`HistoricalSourceGraph` with authenticated application-graph Evidence. The
stable scoring model reports every admitted signal and weight: exact source
digest, source-map original path, exact current path, path suffix, Unicode-
equivalent path, basename, and language extension. Exact digest wins over
location inference; weak basename, extension, and Unicode-equivalence evidence
never forces a mapping. Unicode-equivalent spellings are candidate evidence
only because distinct filesystem paths can preserve those spellings as separate
files; multiple canonical-equivalent candidates remain unknown.

Each historical source file is classified as `unchanged`, `modified`,
`removed`, `split`, `merged`, `duplicated`, or `unknown`. Multiple equally
scored path mappings form a static split inference. Multiple current file
occurrences with the exact historical digest are duplicated; multiple historical
paths with exact identity to one current occurrence are merged. Fresh file
observations carry their container digest, inventory path, and content digest.
Their asset, source-module, and export-binding representations form one candidate,
which retains `current_file_occurrence` and `representation_node_ids`. Equal bytes
at two inventory paths remain two occurrences even when they share an asset node.
Logical bundle modules and older observations without occurrence facts retain
their graph identities; matching does not infer common ownership from a label.
`removed` requires
complete historical and application inventories. The comparison analyzes and
returns all source files, candidate nodes, and matching signals represented in
the supplied graphs. Partial inventories remain unknown where absence cannot
be established. These static mappings do not claim runtime loading or semantic
equivalence.

## Export return-shape comparison

`compare_javascript_export_shapes` selects exactly one module path and export
name on each authenticated graph. Missing or duplicate exact selectors return
candidate inventory and an unknown result; the tool never chooses a fuzzy
match. An export is linked to a callable only through exact lexical/module
relationships recovered by the AST analysis. A later named CommonJS deletion
invalidates the earlier publication per exported field at the receiver owner;
surviving fields from the same assignment stay available. Descriptor-defined
fields retain unknown deletion success unless configurability is established.
Conditional or
dynamic deletions retain uncertainty. Unresolved invocation spreads remain
unknown source sequences and cannot publish a phantom array index.

Direct return expressions, including expression-bodied arrows, are evaluated
through an execution-free value lattice. Literal object fields and direct
return sites are represented in the result. Calls, dynamic spreads, computed
keys, and parser recovery remain partial or unknown. Known conditional and
logical tests select only the established branch; uncertain tests retain
alternatives. Object copies preserve known own primitive data fields at copy time while
unknown sources retain incomplete coverage. Array holes do not overwrite own
fields during a copy. Copied reference fields keep explicit uncertainty; shared
reference projection remains responsible for their later member reads.
Declaration initializers and later assignments share the binding-at-read owner;
a declaration-only `var` read before its initializer does not inherit the future
value. Earlier `break`/`continue` paths can leave a var initializer unexecuted.
Legacy non-strict block-function copies are indexed on their outer variable
owner, while strict/module and lexical-shadowing boundaries keep their values.
A catch-shadowed var declaration keeps declaration ownership separate from its
initializer's lexical assignment, including object and array destructuring slots.
Projected initializer facts retain their source and alias identity on the lexical
recipient, so a later mutation through that alias prevents reporting the original
object field as an unchanged constant. Ordinary functions own an implicit
arguments object; arrows retain lexical arguments lookup. Promise source identity uses
the same read-position selection and requires an unmodified intrinsic factory.

Rebound values are evaluated at their read position: saving an incoming parameter
before a later assignment preserves caller-dependent uncertainty, while a proven
preceding assignment can supply a constant. Unresolved ordering remains unknown.
Supported reads within object and array literals follow left-to-right evaluation;
an unproved relative order remains unknown. A later write in a separate conditional
block can still leave an earlier capture unknown because ordering across those
blocks is not proven.
Objects and arrays passed to calls, constructors, or tagged templates, used
as method receivers, or stored through property targets are not assumed
unchanged afterward. Property stores conservatively retain reference escape
uncertainty rather than pretending to execute later writes. References
handed back by local functions, methods, constructors, async functions, and
generators also retain escape uncertainty, including when the call is read-only;
this does not establish that a mutation occurred. Aliases
and shared children in spread and rest copies retain that uncertainty. Exposing
the copy alone does not invalidate copied primitive slots or unrelated containing
properties. Dynamic child writes such as `copy[key].value = 2` remain conservative
about which original slot was selected. Object rest
excludes consumed keys, array rest excludes the consumed prefix for known
arrays, and later explicit data properties and methods replace earlier object
spread references. A known array prefix does not expose values from a following
spread. Accessors, custom or uncertain iteration, unknown computed keys, and
unknown spread lengths retain conservative uncertainty.
Getter-local aliases of `this`, including direct destructuring and assignments,
retain their receiver when a returned shared reference is written. These writes
invalidate the earlier literal instead of claiming the getter executed or the
new value is known. Straight-line alias reads retain their capture order;
uncertain control flow remains conservative. A binding outside the getter or
`this` in a nested ordinary function is not attributed to the getter's receiver.
Private reads keep receiver projections separate from the private value's path.
Receiver projections follow known data fields initialized from `this` or earlier
self-referencing fields; static fields retain their declaring class identity.
An alias cycle that repeatedly selects deeper children retains escape uncertainty
at its recovered roots rather than claiming a fixed number of loop iterations.
Equivalent member reads in a repeating loop share unknown ordering instead of
creating a distinct capture for every branch history. Straight-line captures and
once-only loop inputs retain their own selection sites. When unobserved suffixes
are widened, their exact observed prefixes stay separate so unrelated siblings
remain known.

Writes through an object getter's returned receiver retain that uncertainty
when the object is an array element, nested inside mixed object/array
containers, or assigned to a previously declared identifier. Saving the getter
result in an alias does not make its old field values immutable. Known array
indices include holes; an element after a spread has only a minimum possible
index. For these returned-reference writes, unrelated properties and known
array prefixes remain precise. Accessor applicability uses the shared object
reference owner for literal definition order, own-property shadowing, known
array elements and explicit literal prototypes. Getter invocation effects
project write and call operands through the same local alias and `this` owner
used by returned references. Reads of another selected getter continue that
effect walk. A receiver reached by these effects becomes uncertain on an
ordinary or optional read, compound assignment or update. A simple assignment
or deletion does not invoke the getter. Selected setters invalidate
the receiver and its shared children on assignment, including through known
array and prototype paths. Supported class descriptors use the same inherited
field and own-property shadowing rules as class reference selection. Inert
getters and ordinary data slots retain their supported precision. Exposing a
constructed receiver also exposes its retained shared field references, using
the same reference owner as selected getter effects.

Object spreads, rest copies and destructuring obtain their property reads from
the shared pattern-source owner. Copies read own enumerable properties;
ordinary destructuring can invoke an inherited getter. Operations requiring
primitive conversion conservatively expose their conversion operands, including
computed keys, arithmetic and untagged template interpolation. `using` and
`await using` expose the retained resource at its lexical scope exit; earlier
scalar reads retain their capture timing, including reads before a later scope's
disposal. Repeated loop iterations can expose
a previous disposal and therefore retain uncertainty. Private getter fields
retain their parsed initializer references; `super` reads use the selected
receiver conservatively, including superclass reads whose lookup and receiver
authority differ. Custom `instanceof` hooks expose their receiver and argument.
Known unmodified intrinsic Symbol keys cannot overwrite string properties or
invoke primitive conversion; their omitted symbol-slot inventory stays partial.
Shadowed or visibly replaced Symbol references retain unknown key effects.
These are source-derived effects,
not execution results or proofs of accessor purity. Reflectively installed
descriptors remain opaque; their setup calls retain ordinary argument/receiver
escape uncertainty. External prototype changes and unsupported runtime protocols
remain unknown rather than supplying exact post-invocation values.
Identifier references and closure captures share Babel syntax-role facts plus
explicit binding/write roles; noncomputed declaration keys and import/meta names
are not lexical reads. TypeScript type positions, including `typeof` type queries
and computed keys in erased signatures, do not evaluate JavaScript bindings or
create runtime calls or captures. Decorators on declared class fields can still
run when the class is defined, and a decorated declared or abstract field can
evaluate its computed key. Provenance-only expression-depth omissions enter
the same typed source coverage as value-evaluation bounds and remain visible in
retained application Evidence.
Immediate synchronous function results also share the loader reference owner.
An expression arrow returning the retained CommonJS `require` can preserve that
loader identity. Possible loader results with opaque alternatives or block
bodies retain candidate uncertainty; async and generator results are their
wrapper values.
This does not interpret `typeof` or Proxy behavior in bundler shims. Historical
source imports consume the same proven loader fact and keep their existing
requirement for a known loader association.

Direct generator and async calls produce iterators and
Promises; body returns do not become direct call-result flows. Their unresolved
consumption remains an explicit frontier. Replaced emitter bindings select their
initializer lifetime at each operation. A lexical `this` owner remains partial
because it does not prove one runtime instance.
Nested callable returns are not assigned to their parent callable. Projected
graph observations carry source ranges but never source text.

Return variants pair only when a literal discriminant such as `/type` has one
unique occurrence on each side and pairing is reciprocal. Source order never
implies correspondence. Each retained variant contributes a property inventory
of observed JSON Pointer names, including fields whose static values stay
unknown, plus that variant's parent-property coverage.

Changes use JSON Pointer paths with `added`, `removed`, `changed`, or `unknown`
status and a separate `presence` object (`present`, `absent`, or
`unknown-coverage`) on each side. A name is `added` or `removed` when one paired
shape proves presence and the other proves absence. Complete parent-property
coverage can establish absence even when field values stay unresolved. Proven
absence of an ancestor also establishes absence of its descendants. An observed
ancestor with unresolved contents keeps its descendants unknown. Identical literals are
omitted. Unresolved values that remain on both sides stay `unknown` when the
projections differ, and are omitted when presence is unchanged and the unknown
projections match. Incomplete spreads and other partial parent coverage keep
one-sided names `unknown` with `unknown-coverage` on the incomplete side.
Unpaired variants remain visible as unknown changes and still list their
property inventories, each with its own `source_range`. Inventories exclude
array holes and slots whose presence was invalidated by mutation; an unresolved
value alone does not make an observed property uncertain. `summary.added` and
`summary.removed` count
presence-level add/remove as well as literal value add/remove;
`summary.unknown` does not absorb complete-coverage presence-only gaps.
A partial comparison still records an unknown in the MCP session when matching
uncertain projections produce no changes and `summary.unknown` is zero.

The output includes exact selector candidates, omissions, Evidence links,
coverage, and limitations; it does not execute JavaScript. When runtime
semantics matter, run behavioral probes directly against the relevant
application versions and capture them through the available browser, Electron,
or process workflows.

## CLI and verification

All six CLI commands accept inline JSON or a path to a JSON file. The CLI
returns an Evidence record directly. Later workflow inputs can contain full
records, or exact retained references when `--evidence-bundle PATH` selects an
authenticated exported bundle. A separate CLI process has no retained MCP
connection state. See [CLI Evidence reuse](cli.md#import-export-and-compare-evidence).

File inputs must be regular files; symlinks to regular files are accepted.
Directories, named pipes and device files produce an input error before JSON
parsing.

For a literal string trace, analyze your supplied tree once, then build the
input from the saved Evidence (replace the target and seed):

```bash
rea analyze-javascript-application /absolute/path/to/app --json > application-evidence.json
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const application = JSON.parse(readFileSync("application-evidence.json", "utf8"));
writeFileSync("trace-input.json", JSON.stringify({
  application, seed: { kind: "string", value: "search-result" }, direction: "both"
}));'
rea trace-application-feature ./trace-input.json --json
```

MCP analysis returns the complete Evidence record, with the operation result
in `normalized_result` and its identity in `evidence_id`. If the connected server advertises retained references, reuse its
exact returned ID as `{"kind":"retained-evidence","evidence_id":"RETURNED_ID"}`
in `application`, or `left`/`right` for comparisons. For summary or inspection
replies, use `normalized_result.parent_evidence_id` to select the complete source.
`RETURNED_ID` is a template, not a literal valid ID. Native-observation arrays
and `reconcile_javascript_runtime`'s nested static layers and runtime-observation
array also accept references where advertised, independently mixed with inline
records. Exact identity, coverage and partial or unknown facts are preserved.
References are scoped to one connection; `close_binary` clears them. Export a
bundle before closing and import it on another connection, or supply the full
inline Evidence there. Versions before 4.1.0 accept full inline Evidence only; installing
newer skill instructions does not change that schema. See
[MCP Evidence inputs](mcp-contracts.md#retained-application-evidence-inputs).

For two operator-provided directories or ASARs, run:

```bash
npm run verify:application-workflows -- \
  --left /absolute/path/to/version-a \
  --right /absolute/path/to/version-b
```

The verifier reconstructs both versions independently, compares them, runs one
literal trace when a seed is available, and compares the first common exact
export return shape when present. It prints only graph, artifact, and Evidence
identifiers plus matching, changes, summary, handoff, and coverage statistics;
it does not print source text. Use `--seed-kind` and `--seed-value` to select a
specific route, string, API, channel, module, native export, or node ID. Supply
all four `--left-module-path`, `--left-export-name`, `--right-module-path`, and
`--right-export-name` options to verify an explicit export pair.

Because source Evidence and derived Evidence are retained by the normal session
ledger, evidence bundles and analysis snapshots can carry these records without
another persistence format.

## Runtime evidence

Static graph workflows do not execute recovered code. When runtime semantics
matter, run behavioral probes directly against the relevant application
versions and capture them through the available browser, Electron, or process
workflows. Those observations do not prove behavior in an unobserved app
version or environment.
