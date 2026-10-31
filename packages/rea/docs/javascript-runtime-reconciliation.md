# JavaScript static/runtime reconciliation

REA can combine an existing static JavaScript Application Graph with one or
more browser, Electron, or Node/Electron V8 Inspector observations while
preserving their different authorities. The `reconcile_javascript_runtime` MCP tool and
`rea reconcile-javascript-runtime` CLI command accept Evidence records and
return derived Evidence containing a combined JavaScript Application Graph
and explicit match, ambiguity, mismatch, and unknown classifications.

The operation performs no filesystem, browser, or Electron I/O. It accepts only
semantically verified Evidence produced by `analyze_javascript_application`,
`inspect_web_page`, `inspect_electron_page`, `observe_javascript_runtime`, or
`capture_electron_scenario`; matching operation names alone
is insufficient. Provider identity, predicate type, subject digest, target
parameters, and normalized-result schemas are checked before reconciliation.

`capture_electron_scenario` supplies target-only partial observations. It does
not establish loaded-script coverage; see [Electron observation](electron-observation.md).

## Workflow

1. Run `analyze_javascript_application` against exactly one application layer.
   Optional cache or assets directories can be analyzed independently and
   supplied as additional layers.
2. Run `inspect_web_page`, `inspect_electron_page`, or the attach-only
   `observe_javascript_runtime`, or supply existing `capture_electron_scenario`
   Evidence with the partial scope above. Capturing script sources is optional,
   but a source capture provides the strongest byte identity.
3. Pass the resulting Evidence records to `reconcile_javascript_runtime`.
   Browser URLs normally need an explicit URL-prefix mapping. Extracted
   Electron and V8 Inspector file locations are mapped automatically when runtime files remain
   beneath the analyzed input root; relocated files, ASAR projections, caches,
   and asset roots need explicit mappings.

The MCP input has this shape; the `analysis` and `runtime_observations` values
are complete Evidence objects, not only evidence IDs:

```json
{
  "static_layers": [
    {
      "role": "application",
      "analysis": "ANALYZE_JAVASCRIPT_APPLICATION_EVIDENCE",
      "runtime_mappings": [
        {
          "kind": "url-prefix",
          "prefix": "https://example.test/assets/",
          "artifact_prefix": "dist"
        }
      ]
    }
  ],
  "runtime_observations": ["INSPECT_WEB_PAGE_EVIDENCE"]
}
```

`static_layers` requires exactly one `application` role and permits additional
`cache` and `assets` roles. A `file-root` mapping translates a canonical runtime
filesystem root to an artifact-relative prefix. A `url-prefix` mapping does the
same for one exact HTTP(S) origin and path prefix. Each URL path segment below
the prefix is percent-decoded separately: an encoded slash (`%2F`) stays inside
its segment and never names a nested artifact, so such a location, like one
with malformed or non-UTF-8 escapes, has no artifact path under that mapping.
An encoded backslash (`%5C`) remains a literal name byte. Mappings cannot add CDP
origins, broaden Electron roots, read files, or authorize source-map access;
they are caller-declared inference inputs applied only to already-authorized
locations.

The one-shot CLI accepts either a JSON file path or the same JSON inline. A
file avoids the operating system's command-line size limit for realistic
Evidence records:

```bash
rea reconcile-javascript-runtime reconciliation-input.json --json
```

For a repeatable local check from operator-provided paths, build first and run:

```bash
npm run verify:javascript-runtime -- \
  --application /absolute/path/to/app \
  --cache /absolute/path/to/cache \
  --runtime-evidence /absolute/path/to/electron-evidence.json \
  --mapping '{"layer":1,"kind":"file-root","root":"/runtime/cache","artifact_prefix":""}'
```

The verifier analyzes the supplied static paths, reads bounded Evidence JSON
files, and prints graph IDs, evidence IDs, paths, digests, counts, reasons, and
coverage. It does not print captured source text.

## Matching rules

Runtime targets, frames, scripts, and workers become capture-scoped graph
nodes. REA evaluates compatible static candidates conservatively:

1. A captured-source SHA-256 plus one matching mapped location yields
   a content-and-location match.
2. When no static candidate exists at a mapped location, one unique exact
   content digest can match. Whole-asset digests and reconstructed module-factory source
   digests remain distinguishable in the reported basis.
3. Without captured bytes, one unique mapped artifact path can produce a
   medium-confidence location match. A proven factory module contained within
   the located asset is not a competing whole-file location; separate assets
   and independently plausible modules remain candidates.
4. Multiple candidates remain `ambiguous`; no `observed_as` edge is emitted.
   With captured source and mapped candidates, only mapped content matches
   qualify; unrelated content matches elsewhere are excluded.
   `candidate_static_count` reports the full qualified layer/node count, and
   `candidate_static_nodes` includes every unique candidate reference.
5. If captured bytes disagree with the static candidate at the mapped path,
   the result is an explicit mismatch. An equal digest elsewhere cannot hide
   that disagreement. If a mapped candidate's digest is unavailable and no
   mapped content match is known, the comparison remains `unknown`.
6. Missing authorization mappings and incomplete or truncated input coverage
   remain unknown or truncated rather than becoming absence claims. A runtime
   location with no automatic artifact-root or caller-declared mapping into
   any layer, and no content match, is `unknown` with
   `no-authorized-location-mapping`, with or without captured bytes; several
   content matches remain `ambiguous` under rule 4. Only a mapped location can
   be `unmatched` with `no-static-content-match`.

Every successful cross-layer `observed_as` edge has
`authority: cross-layer-reconciliation` and `state: inferred`. The underlying
artifact/AST observations and runtime observations remain unchanged and
retain their own Evidence links.

## Loaded, resident, and not observed

Static JavaScript assets, chunks, and modules receive a separate load-state
classification:

- `loaded` means an accepted runtime script correspondence was found, using
  exact bytes or one unique mapped location;
- `resident-in-loaded-asset` means a containing asset was observed, but the
  embedded module was not independently observed or shown to execute;
- `not-observed-in-capture` means the entity did not appear in the complete
  authorized captures supplied to this call and its artifact path falls beneath
  an exercised automatic or operator-declared mapping prefix;
- `unknown` covers incomplete captures, layers outside runtime scope, and
  unresolved correspondence. Nodes outside a mapped artifact prefix stay
  unknown even when another prefix in the same static layer was observed.
  Nodes beneath a mapped artifact prefix also stay unknown when a runtime
  script or worker under that mapping has no artifact path.

Script inventory completeness remains a separate reported fact. Unavailable,
truncated, or attach-limited worker inventory prevents negative code-presence
claims even when the selected page's script inventory is complete. Accepted
positive script correspondences remain loaded.
An Electron script's explicit unknown `frame_scope` preserves its reported
frame ID and sourceURL provenance as node properties, but does not link that
script to the current frame inventory. Attach-limited script coverage cannot
establish negative code-presence claims.

None of these states proves feature execution, initialization order,
reachability, or causality. In particular, `not-observed-in-capture` never means
globally unloaded.

## Frames, workers, and source maps

Passive inspection retains the execution-context frame ID supplied by CDP
for each accepted script. Electron captures also inventory authorized worker,
service-worker, and shared-worker targets, including bounded opener-target and
parent-frame relationships. These fields improve attribution while preserving
the original exact-origin or canonical-root filter.

V8 Inspector observations expose execution-context IDs but no authenticated
frame relationship, so their scripts attach to the exact runtime target in the
combined graph. They never supply source bytes, require/import caller edges,
EventEmitter activity, Electron IPC, or script-unload evidence. A unique
authorized file or URL location can still correlate script presence with a
static asset, but it does not prove module initialization or feature execution.

Source-map declarations and original-source reads remain static evidence. They
are reported in `source_map_authority` but never used
as primary runtime byte matches. A source name or `sourcesContent` digest is not
silently equated with the generated bytes observed by CDP.

## Bounds and determinism

The workflow does not impose aggregate count caps on static layers, passive
captures, runtime entities, reconciliation items, static load states, runtime
mapping declarations, or candidate references. These collections remain
subject to the structural validation applied to each Evidence record and
application graph; passive observation returns all in-window collection items
that pass per-value validation. Reconciliation reports zero
omitted items when it projects the complete supplied inputs. Static JavaScript
analysis can still report its own bounded AST coverage as partial or truncated.

Layers, captures, nodes, edges, matches, and evidence links are canonically
ordered. Repeating the same verified Evidence and mappings produces the same
reconciliation, graph, and Evidence identifiers.

## Non-goals

Reconciliation does not attach to CDP, fetch scripts or source maps, execute
JavaScript, invoke Electron IPC, inspect native add-ons, infer arbitrary URL
rewrites, or search the filesystem. It does not replace the older
`correlate_static_and_runtime` investigation tool: that tool records explicit
cross-version static/runtime comparison hypotheses, while this operation maps
JavaScript runtime instances to static application-graph entities.
