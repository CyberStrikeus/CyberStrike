# Static JavaScript route inventory

`analyze_javascript_application` and `analyze_web_bundle` retain a shared
`route_inventory` alongside their existing graph and endpoint observations.
The inventory answers which route patterns the supplied code suggests, where
each pattern came from, and which parts remain unknown. It never requests a
route, executes scripts, expands a sitemap, or establishes reachability.

Select a compact view in either MCP analysis call:

```json
{
  "detail": "summary",
  "view": {
    "kind": "javascript-routes",
    "collection": "routes",
    "where": { "path_prefix": "/reports" },
    "fields": ["path", "classification", "confidence"],
    "limit": 20
  }
}
```

Keep the original analysis inputs in that call. For the CLI, pass the same
selection as `--view '<JSON>' --detail summary --evidence_output routes.json`.
The complete Evidence bundle is written without overwriting existing files.
Unselected delivery retains the existing complete result. A web-bundle summary
requires an explicit route or web-bundle view; application summaries also support the existing
general summary when `view` is omitted.

Use the returned `normalized_result.parent_evidence_id` with
`inspect_analysis_view` on the same connection. The CLI's exported bundle can be
reopened with `inspect-evidence-bundle`; its `records` contain the complete
Evidence. `inspect_analysis_view`'s `evidence-file` source accepts either one
Evidence record or an exported bundle with the selected `evidence_id`.
Views do not reopen source files or
reconnect to a browser. Historical Evidence without `route_inventory` is
unmeasured, rather than an empty route set.

## Page captured endpoint observations and inferences

For `analyze_web_bundle`, select `detail: "summary"` and
`view: {kind: "web-bundle", collection: "endpoints", limit: 32}`. The CLI
accepts the same JSON through `--view`, with `--detail summary` and
`--evidence_output bundle.json`. Query the returned parent with
`inspect_analysis_view` to read `endpoints`, `inferences`, or `summary` without
recapturing the page or repeating JavaScript analysis.

Both row collections accept exact `indices`, `values`, `script_keys`, `fields`,
`offset`, and `limit`; endpoints also accept `mechanisms`, and inferences accept
`kinds`. Filters combine with AND, and an explicit empty selector matches no
rows. Every row retains its `source_index` in the original collection, including
when other fields are omitted. This identity is scoped to the parent Evidence
and collection. Original ordering and separate occurrences of duplicate values
are preserved; request endpoint `location` or inference `basis` for source details.

Follow `coverage.next_offset` until `coverage.exhausted`; those fields describe
the selected rows, independently of producer `completeness`. Each response also
preserves structured `source_unknowns`, including `affected_script_keys`, so a
filtered or value-only page cannot hide a source gap. The summary's
`limitation_count` counts distinct parent and report limitations before display
bounding. An `endpoint_candidate` remains an inference, with its original
confidence and basis, and does not prove a backend endpoint or reachability.

Pages obey the shared 1 MiB projection budget; MCP transport applies its own
wire-size guard. A byte-limited page returns a continuation; an indivisible
oversized record or metadata returns a typed resource error. Select fewer
fields or retrieve the complete retained parent through `get_evidence_bundle`,
`export_evidence_bundle`, or the CLI's exported bundle. Full Evidence is never
silently truncated.

Collections are `summary`, `routes`, `occurrences`, `sources`, and `unknowns`.
All row collections support exact batch `where.ids`, field selection, `offset`,
and `limit`. An explicit empty filter array matches nothing. Routes also support
exact `paths`, literal `path_prefix`, `classifications`, `mechanisms`, and
`min_confidence`; occurrences support `route_ids`, `source_ids`, and `mechanisms`;
sources support `keys` and `statuses`; unknowns support `source_ids` and `kinds`.
Follow `coverage.next_offset` until `coverage.exhausted`; a page may stop early
at the 1 MiB serialized view budget. Oversized indivisible facts return a
resource error carrying the retained parent Evidence ID.

Pattern IDs bind the exact path. Source IDs bind the source key, path, original
URL, content digest, container digest, and any retained Next source applicability
context (including the owning package digest). Occurrences identify a detector mechanism at a source location; one location
may support multiple mechanisms. `source_count` counts distinct sources. Lookup IDs use 128 bits of SHA-256;
full content and inventory digests remain SHA-256. Field selection always keeps
row identity and necessary provenance. The page's deduplicated `sources` table
contains the source descriptors referenced by returned rows. Retrieve all
occurrences by route ID when independent supporting evidence matters. Source
ranges use one-based lines and zero-based UTF-16 columns with exclusive ends;
filename-only discoveries have no invented AST range.

The shared parser handles literal router calls, nested route objects, typed
`_$` trees with explicitly inferred property-name fallbacks, Next App Router
page paths, and navigation targets. It follows stable lexical bindings and
keeps unresolved parents, mutations, spreads, and dynamic fields explicit.
Index-route flags use the same value-at-read boundary as path fields: erased
type wrappers and initialized stable boolean aliases preserve `true`/`false`;
uninitialized or unresolved flags retain an interpretation unknown instead of
silently disappearing.
A selected route-builder root owns its configuration even when mutation prevents
trusting its value. Ordinary wrapper keys do not become route ancestors. Missing
outer ancestors of unbound typed subtrees remain unknown rather than invented.
Generic Next runtime path constants require a top-level application segment
supported by structural or navigation candidates across the supplied sources.
This limits framework filesystem noise, while leaving unsupported candidates
unknown. The parser shares the existing AST traversal and lexical index.

Literal fragments of computed expressions, module references, and page-shaped
paths owned by Next interpretation do not also become generic route constants.
Selected getter results retain the shared semantic owner's allocation identity;
finite selections can claim their query data, while widened or cyclic selections
keep an unknown in the interpretation that requested them.

Next page conversion receives an explicit source context. For local source files,
the shared JSON owner first establishes a declared `next` dependency in the
nearest owning package. Inventoried directories then select that package's `app`
before `src/app`, following Next's [root selection](https://github.com/vercel/next.js/blob/v16.4.2/packages/next/src/lib/find-pages-dir.ts).
Only files beneath the selected directory supply source-page support. Default
`.next/static/chunks/app` output receives a separate compiled-directory context
from the same package owner; custom build directories remain unmodeled. Pages Router
files, unrelated components, and nested packages do not inherit that root merely
because their paths contain `app`. Missing package/framework evidence remains an
interpretation unknown for page-shaped source paths. Each page-shaped source retains its
`next_app_context` and package identity so this derivation remains inspectable.

Captured script URLs use the `/_next/static/chunks/app/` asset boundary, independently
of local package evidence. Source literals use recognized Next runtime context;
imports, exports, and direct call arguments do not themselves declare pages.
The parser completes its runtime-marker scan before interpreting retained module
literals, so marker placement does not change the result. A matching filename
suffix alone cannot establish App Router ownership.

[Next dynamic segments](https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes)
map to `:id`, `:slug+`, or `:slug*`; groups and parallel slots do not contribute
URL segments. Intercepted routes remain unresolved. A prefix before `/_next/`
is an **inferred** routing base: [assetPrefix](https://nextjs.org/docs/app/api-reference/config/next-config-js/assetPrefix)
can differ from the routing base. Every affected occurrence keeps
`unprefixed_path`, `inferred_base_path`, and low confidence. `system` classification
is explicitly a path-name heuristic; `page` uses page-file or structured/typed configuration support. Name-only
`route`/`addRoute` calls remain `unknown` because they can also register server APIs.

Next page-source segments keep their filename spelling when converted to route
patterns. Next's [page-path conversion](https://github.com/vercel/next.js/blob/v16.4.2/packages/next/src/shared/lib/page-path/absolute-path-to-page.ts#L21-L39)
removes page extensions and the `index` tail without URI-decoding segments, so
ordinary percent sequences are not decoded: `%61` and `a` remain separate
candidates and a literal `%` is retained. Its [App pathname normalizer](https://github.com/vercel/next.js/blob/v16.4.2/packages/next/src/server/normalizers/built/app/app-pathname-normalizer.ts#L5-L18)
specifically applies the [underscore normalizer](https://github.com/vercel/next.js/blob/v16.4.2/packages/next/src/server/normalizers/underscore-normalizer.ts#L2-L9),
which maps `%5F` to `_`; private-folder checks apply to the source spelling
before that escape is mapped. When classifying a chunk URL, REA reads its
pathname, then applies these same Next-specific rules. This is static source-path
interpretation, not browser request-path decoding or reachability.

Known capture omissions remain inline in `summary.reported_capture_omissions`
and queryable as `unknowns` of kind `capture-omission`. Each keeps a stable gap ID,
its script-record/script-source unit, and the reported count (including `null`
for unknown). They do not invent missing script identities or source ranges.

Counts describe deduplicated patterns in the provided code sources. They are
not a denominator for complete application or capture coverage. In particular,
server-only, lazy, inaccessible, or unselected sources may be missing.
`coverage.application_routes` always remains `unknown`; parsing and candidate
enumeration have their own completeness. Static work and fact admission share
the existing 8 MiB per-source transfer ceiling, and the root inventory has an
8 MiB admission budget. Exhaustion preserves a prefix with explicit capacity;
the serialization owner also admits route facts within the actual space left by
legacy facts. `result-bytes` capacity preserves an earlier work-capacity reason;
if even that envelope cannot fit, the optional route facet remains unmeasured.
These are accounting bounds, not a claim that total process memory is 8 MiB.

Projection only reduces delivery, not analysis work. Retained immutable Evidence
can reuse validated tables through a weak cache with the snapshot's lifetime;
subject identity is checked on every query. No live state or source content is
cached as current. Use existing source selection and resource controls when
they match the investigation, keeping their partial coverage visible.
