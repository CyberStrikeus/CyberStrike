# JavaScript Application Graph

JavaScript Application Graph is REA's provider-neutral domain model for
connecting shipped application bytes, JavaScript structure, Electron process
boundaries, passive browser observations, and native add-ons. It is a durable,
canonical data contract; it is not an extractor or a new CLI/MCP tool.

The implementation is pure and side-effect free. It validates caller-supplied
facts, derives semantic identifiers, enforces graph integrity, and serializes
verified graphs as RFC 8785 canonical JSON. It performs no filesystem or CDP
I/O, does not evaluate JavaScript, and has no application-specific node kinds.

## Layer boundary

The graph complements existing REA models instead of replacing them:

| Existing model               | Responsibility                                                                         | Application Graph use                                      |
| ---------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Artifact graph               | Content-addressed containers, byte occurrences, and extraction boundaries              | Supplies artifact identities and exact paths               |
| Web bundle analysis          | Bounded AST, chunk, route, endpoint, and source-map observations                       | Supplies static nodes and relationships                    |
| Browser/Electron observation | Authorized passive CDP metadata and runtime captures                                   | Supplies runtime instances and `observed_as` relationships |
| Native analysis              | Provider-qualified binary functions, symbols, and references                           | Supplies native add-on/export observations                 |
| JavaScript Application Graph | Cross-layer entity identity, evidence-bearing relationships, and canonical commitments | Preserves the combined application model                   |

The shipped [JavaScript artifact reconstruction](javascript-artifact-reconstruction.md)
service projects bounded directory/ASAR, package, bundle, source-map,
BrowserWindow, preload, contextBridge, IPC, utility-process, and JavaScript-side
native binding facts into this graph. The separate
[static/runtime reconciliation](javascript-runtime-reconciliation.md) service
adds capture-scoped targets, frames, scripts, workers, and inferred
`observed_as` edges from already-produced Evidence. Native binary export
verification remains a separate later layer. The domain graph itself never
reaches outward to obtain any of those facts.

## Stored record

A stored graph has this top-level shape:

```text
schema: "JavaScriptApplicationGraph"
graph_id: jag_<sha256 of normalized graph semantics>
root_node_ids: jag_node_<sha256>[]
nodes: application entities with one or more observations
edges: directed evidence-bearing relationships
coverage: complete, partial, unknown, or unavailable
limitations: explicit graph-wide constraints
```

Parsing rejects unknown fields, non-canonical ordering, duplicate IDs, stale
semantic commitments, missing roots, dangling endpoints, self-edges, and
`changed_from` edges between unlike node kinds. Constructors normalize set-like
arrays before deriving their IDs.

## Entities and relationships

The node vocabulary covers:

- package, installer, and artifact;
- ASAR entry;
- Electron main, preload, renderer, and utility process code;
- JavaScript asset, chunk, and module;
- source map and original source module;
- BrowserWindow, frame, and target;
- contextBridge API, IPC channel, and IPC handler;
- worker and service worker;
- endpoint and storage;
- native add-on and native export;
- runtime script instance;
- an explicit `unknown` kind when classification is not justified.

Static network endpoints can have `resolution: "partial"` when the analyzer
recognizes a request call but cannot resolve its target to one exact value.
The observation's `value` then preserves the source expression, and its
evidence points to the call site. Partial and exact endpoints have distinct
identities even when their displayed values match. Partial identities also retain
the source site: matching expression text at different sites does not establish
the same runtime target. This records observed source syntax; it does not
establish that the call ran or contacted that endpoint.
Version comparison can align equal unresolved source sites and syntax across
artifact changes, while target identity remains unknown. Equal unresolved text
at different sites and partial versus exact values cannot establish a pair.
Unresolved targets qualify endpoint absence only within the same endpoint kind;
known metadata differences on an established pair remain visible.
Graph coverage describes the analyzed artifact scope and resource limits, not
runtime execution. A partial target alone does not imply omitted source.

The directed relation vocabulary is `contains`, `loads`, `imports`, `maps_to`,
`exposes`, `sends`, `invokes`, `handles`, `calls`, `accesses`, `persists_to`,
`observed_as`, and `changed_from`. Provider names are deliberately absent from both
vocabularies.

For a `maps_to` edge targeting a source-map node, the edge carries
`resolved_path` and `declared_url_sha256`. The target node's reference
observation carries that same digest and the exact `declared_url`; match the
digest to select the URL belonging to that edge when several references share
one physical source map. The full URL is kept out of node identity, display
label, and edge properties, so large inline data URLs are stored once per
source-map reference.

Consumers previously reading `edge.properties.declared_url` should follow
`target_node_id` and select the observation by `declared_url_sha256` instead.
Node labels serve display; the observation preserves the original URL.

For example, a source-owned synthetic fixture proves this path without using a
third-party application:

```text
package contains app.asar
main asset contains BrowserWindow
BrowserWindow loads preload role
preload asset exposes contextBridge API
preload asset invokes uniquely matched main-process IPC handler
main-process IPC handler handles literal IPC channel
JavaScript asset imports requested native binding
resolved native add-on exposes requested binding (not a verified binary export)
```

The `loads`, `exposes`, `invokes`, `handles`, and `imports` relationships remain
static inferences. Dynamic or ambiguous IPC is retained without a pairing edge.
Runtime entities retain passive-CDP authority, while a successful static/runtime
correspondence is a separately identified cross-layer inference.

Source module links retain their resolution mode. Static imports in `.ts` and
`.tsx` are `compiler-dependent` when compiler options have not been retained.
REA compares Node import and require resolution: a shared outcome remains
available with a limitation; divergent outcomes remain unavailable with both
conditional branches and their limitations. This models source relationships,
not verified emitted code or execution. A declaration file found only through
an emitted-extension fallback is retained as a candidate, not a runtime target;
an explicitly selected path keeps its original identity.

## Evidence and authority

Every observation and edge carries all of the following:

- an authority, such as artifact bytes, AST analysis, static relationship
  inference, passive CDP runtime, and cross-layer reconciliation,
  native analysis, historical reference, or user assertion;
- an epistemic state: `observed`, `inferred`, `unknown`, or `unavailable`;
- confidence independently bounded as exact, high, medium, low, or unknown;
- an explicit content-addressed artifact reference or an unavailable reason;
- an explicit artifact, source, URL, runtime, native, or package-export
  location, or an unavailable reason;
- extractor name, version, operation, and optional executable digest;
- coverage status, truncation, omitted count, and named limits;
- limitations and links to existing Evidence records;
- a content-derived identifier and its declared stability strategy.

Authority and epistemic state are separate fields. An AST observation does not
become a runtime fact, and a passive runtime fact does not prove which static
module produced it. In particular:

- `static-relationship-inference` can only produce `inferred` facts;
- `cross-layer-reconciliation` can only produce `inferred` facts and must link
  both static and runtime Evidence;
- unknown or unavailable facts require unknown confidence and a limitation;
- inferred facts require an explicit limitation;
- exact confidence is reserved for observations;
- all observations require an actionable location, and artifact-backed facts
  require a digest;
- static/native authorities cannot claim runtime locations;
- truncated coverage must be partial, name the limiting bound, and not claim
  zero omissions;
- complete coverage cannot be truncated or omit items.

Semantic graph validation enforces the same truncation coupling. Unknown
omission extents remain `null`; positive omitted unknown occurrences can explain
truncation even when omitted node and relation counts are both zero. Ordinary
source unavailability, including invalid UTF-8, can make coverage partial without
resource truncation. JavaScript summary `limitation_count` counts the full,
deduplicated union of parent, application and semantic caveats, including messages
whose delivery is omitted by the view's byte budget.

Unavailable values are represented explicitly rather than as missing fields,
so absence of evidence cannot silently become evidence of absence.

## Entity identity

Nodes separate stable entity identity from individual observations. Changing a
label, extractor, or evidence record changes the observation ID without
necessarily changing the node ID.

| Strategy                  | Stability scope                  | Intended use                                                      |
| ------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| `content-digest`          | Globally exact bytes             | Artifacts and byte-identical assets                               |
| `source-map-original`     | One source-map commitment        | Recovered original source modules                                 |
| `canonical-path`          | One artifact version             | ASAR entries and assets at exact normalized paths                 |
| `artifact-local-key`      | One artifact version             | IPC channels, handlers, exports, and other named entities         |
| `structural-fingerprint`  | Explicit cross-version inference | Modules whose relationship is hypothesized from bounded structure |
| `runtime-instance`        | One capture only                 | Targets, frames, runtime scripts, and workers                     |
| `observation-fingerprint` | One observation scope            | Facts with no stronger justified identity                         |

Every strategy states its stability scope. Runtime identities commit the
capture digest and runtime key; canonical-path and artifact-local identities
commit the containing artifact digest. Structural fingerprints require an
inferred supporting observation and never claim exact cross-version identity.
Content-digest and source-map identities require an observation of the same
artifact digest.

Observation IDs use `semantic-content-sha256` with `observation-exact`
stability. Edge IDs use the same derivation with `relationship-exact`
stability. Node, observation, edge, and graph IDs are recomputed during parsing,
so callers cannot preserve a stale ID after changing semantic content.

## Structure

The graph does not impose aggregate caps on roots, nodes, edges, observations,
or JSON properties. Properties must be valid JSON; field-specific validation
still applies to paths, identifiers, and evidence values. Extractors report
actual omissions in coverage instead of silently dropping a prefix.

## Domain API

The public domain functions are:

- `createJavaScriptApplicationNode` to normalize an entity and derive node and
  observation IDs;
- `createJavaScriptApplicationEdge` to normalize a relationship and derive its
  ID;
- `createJavaScriptApplicationGraph` to sort complete graph content and derive
  its graph ID;
- `parseJavaScriptApplicationGraph` to verify a stored graph and every
  commitment;
- `serializeJavaScriptApplicationGraph` for canonical JSON;
- `computeJavaScriptApplicationGraphSha256` for a byte-stable verified graph
  digest.
