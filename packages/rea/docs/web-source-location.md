# Captured website source locations

`trace_web_source_location` maps one selected position in a script retained by
`export_web_scripts` through one explicitly paired local source map. The shared
CLI/MCP workflow verifies actual manifest, script and map byte identities and
returns the original position and embedded source inline. It acquires no browser,
fetches no URL and executes no application code.

```bash
rea trace-web-source-location \
  /analysis/scripts/manifest.json 0 \
  /analysis/app.js.map 'https://example.test/maps/app.js.map?v=7#context' \
  1 25 --json
```

The six positional arguments select the manifest, zero-based script index,
absolute map path, absolute map URL context, one-based generated line and
zero-based UTF-16 column. The MCP arguments are:

```json
{
  "manifest_path": "/analysis/scripts/manifest.json",
  "script_index": 0,
  "source_map": {
    "path": "/analysis/app.js.map",
    "url": "https://example.test/maps/app.js.map?v=7#context"
  },
  "generated_position": { "line": 1, "column": 25 }
}
```

The URL supplies the context for resolving `sources` and `sourceRoot` using the
ECMA-426 URL parsing rule; it is not an instruction to fetch. Repeated path
separators remain part of the resolved URL identity. A non-empty `sourceRoot`
prefixes each source, adding `/` only when the root does not already end with
one. An empty, null or omitted root adds no prefix. webpack 5 and tsc maps
(`"sourceRoot": ""`) therefore resolve against the map URL, as Chrome, Firefox
and the pinned codec do. Absolute virtual or file contexts can be selected as well. The map/script association is caller-selected: a declaration or local map
does not prove deployment authenticity or execution. Use
[import tracing](website-module-trace.md) to inspect outgoing native module edges.

## Meaning of the evidence

Lookup follows the greatest generated position less than or equal to the
selected point, across lines, and returns **every** segment at that position.
It includes generated-only mappings. This follows
[ECMA-426 GetOriginalPositions](https://tc39.es/ecma426/#sec-getoriginalpositions),
with one-based lines in REA's public contract. A point result does not establish
coverage of a source range, execution or UI causality.

Mapped entries preserve the raw source name/root, section path, section-local
source index and flattened index. Duplicate URLs remain distinct, including
entries with different embedded contents. Missing source names retain a null
resolved URL. Original coordinates outside embedded text retain the reported
coordinates and a null offset.

Embedded content hashes identify the UTF-8 encoding of the decoded
`sourcesContent` string, including its line endings. They do not identify an
independently captured original file. Raw map text is retained in Evidence's
`raw_result`, including unknown extensions; these extensions are not interpreted.
Capture context and source Evidence links accompany independently verified
selected file identities.

## Adapter and resource boundaries

The adapter uses the locked upstream
[`@jridgewell/trace-mapping` 0.3.31](https://github.com/jridgewell/trace-mapping)
without modifying its code. It validates map/VLQ structure before allocation,
normalizes nested indexed offsets before upstream flattening, checks section
boundaries and indexes, and retains raw declaration identity. It supports regular
maps and inline indexed sections. Numeric `version: 3` is required on the root
and every embedded map, including indexed ancestors. Invalid embedded headers
report their section path and cannot produce descendant mapping facts. This
uses the rejection option for version errors allowed by
[ECMA-426](https://tc39.es/ecma426/#sec-decodeindexsourcemap).
Equal section starts are allowed when earlier sections contribute no mappings;
actual decoded mappings must stay before the next section boundary.
External section URLs return an actionable
unsupported-profile error. This is a defined decoder profile, not a claim to
implement every current source-map extension.

One owned Node subprocess decodes the map. Its private request directory is
removed before success is returned. Only this child's inherited `NODE_OPTIONS`
is removed; explicit V8 flags set a 192 MiB old-generation and 8 MiB semi-space
budget, one V8 worker and `decode_timeout_ms` (default 20000). The codec heap, map budget, and reply budget have no runtime override. Reported actual V8 heap limits
are checked. These are heap limits, not an aggregate process RSS limit. When
REA runs on Bun, the subprocess is Bun, which ignores these V8 flags: `runtime`
records `id: "bun"`, the Bun version, its Node.js compatibility version and a
null `v8_heap_limit_bytes`. On Windows, the codec's owned Job Object then
limits its committed memory to 704 MiB, the 192 MiB budget plus a 512 MiB
reserve for Bun itself; `process_memory_limit_bytes` records that limit, the
limitations state it, and reaching it returns `resource_constraint` with
`codec_process_memory_limit_bytes`. Elsewhere Bun has no enforced codec limit:
`process_memory_limit_bytes` is null and the limitations state that no codec
heap limit is established. Cleanup may extend the deadline and an unconfirmed
cleanup overrides success with `cleanup_incomplete` and the owning
operation/resources.

The decoder releases its owned codec process before removing the private request
directory. A cleanup failure reports only the owners still pending: the process
run token while process release is unconfirmed, and the directory until removal
succeeds. A later successful retry settles every error bound to that command;
historical failure diagnostics remain available.

Complete evidence is bounded by a 4 MiB map, 32 MiB codec reply and a shared
262144-record decoder budget. Generated rows, mapping segments, leaf maps,
source and name declarations, `sourcesContent` entries and indexed sections all
consume this budget. Generated rows and mapping segments also each have a
262144 limit; indexed maps allow at most 64 nested section levels. Those budgets and the
192 MiB codec heap have no runtime override. Exceeding a budget returns an explicit
failure, without partial results. The existing 32 MiB manifest and 16 MiB selected
script boundaries also apply. No global toolchain or browser configuration changes
are made.

## Verification

Browser bundle collection uses absolute section offsets for nested inline maps.
If caller cancellation stops browser map fetching after some items complete,
the failed bundle request retains those items with the captured page in partial
Evidence and marks bundle analysis `not_performed`. This is distinct from the
local source-map decoder's failure semantics above.
An enclosing column offset contributes only when the nested section starts on
that enclosing section's first generated line. Parent boundaries still clip
preceding browser mappings when a nested section starts with a gap or has no
child leaves. Raw map text, original source identities and the dedicated decoder
profile are preserved.

Browser `original_module_edges` carry a `declaration_index` joining each edge to
its `original_sources` declaration, including repeated source URLs across indexed
sections. Imports are deduplicated within each declaration. Older observations
may omit the index; their edge declaration identity remains unknown.

Browser collection accepts up to 64 MiB of map responses per inspection and
preflights indexed sections, sources, names, generated rows and mapping segments
against a 262144-record decode budget before upstream flattening. Indexed maps
are limited to 64 nested levels. These structural limits bound decoded object
growth while preserving large embedded `sourcesContent` strings within the
response-byte budget. It also bounds the expanded inline evidence to 32 MiB
across the inspection, checking resolved source identities and mapping rows
before publishing them, and bounds raw resolved-source identities to 64 MiB
before upstream materializes their arrays. Exceeding either decoder budget
returns a `fetch_failed` item while retaining other maps. Decoded coordinates
and source/name indexes are validated per map; a malformed map is reported as
`invalid` without discarding earlier or later maps.
Collection reserves each requested map's failure context before fetching it.
When the aggregate inline-result budget cannot reserve another item, remaining
requests are left unprocessed and reported as unknown through the top-level
`limitation`; `requested` retains the full count and `processed` counts returned
items.
Malformed UTF-8 map responses are reported as invalid rather than repaired with
replacement characters.
For browser fetching, an `invalid` map or structural or decoder capacity
failure has `artifact: null`, empty decoded arrays, and an explicit limitation.
When its bounded response body was read in full, optional `response_identity`
records that body's SHA-256 digest and byte count after HTTP content decoding
and before UTF-8 decoding. It is not a digest of partial reads or a claim that
the map was valid; historical items may omit it. Malformed text is omitted so
it does not consume the 32 MiB inline budget needed by later valid maps. A
response whose text cannot fit that budget is refused before JSON parsing and
source-map decoding, and retains the same
completed-body identity. Successful and partial maps keep their full original
text, including BOM and XSSI framing; only their parsing view removes it.

Focused tests cover duplicate mappings, indexed offsets/overlap/local indexes,
32-bit VLQ overflow, nullable content, UTF-16/CRLF positions, immutable artifact
identity, cancellation, late output closure, cleanup failures, SDK schemas and
public CLI behavior. The actual codec process is exercised on the test host.

The optional `verify:browser:source-maps` lane compiles a source-owned TypeScript
fixture with isolated esbuild 0.25.10, serves it to real Chromium, captures and
exports the actual response, then checks the original compiler point and exact
retained content through CLI and stdio MCP. It can target an installed package.
Only this lane requires Chromium and the fixture compiler. Linux x64 is the real
workflow covered by the dedicated CI job; other host workflows remain unverified.
