# Captured website scripts and static JavaScript analysis

`export_web_scripts` bridges retained browser sources into the existing local
JavaScript analyzer. Both CLI and MCP use the same workflow. It reads a saved
`inspect_web_page` or `capture_browser_scenario` capture and writes scripts plus a
verified manifest into one caller-selected, absent directory.

## Capture and export

For passive inspection, select `include_script_sources: true` (CLI:
`--include-script-sources`). For scenarios, select
`capture.network.response_body: true`. Save either the complete Evidence record
or its normalized result as UTF-8 JSON. MCP `structuredContent` contains the complete Evidence record.

The capture must be a regular file. A symlink to a regular file is accepted;
directories, named pipes and device files are rejected before reading capture
bytes or creating output.

```sh
rea export-web-scripts /analysis/capture.json /analysis/exported-scripts --json
rea analyze-javascript-application /analysis/exported-scripts/files --json
```

MCP uses `export_web_scripts` with `capture_path` and `output_directory` absolute
filesystem paths. Its inline result includes `analysis_input`, which can be
passed directly to `analyze_javascript_application`. When no script bytes are
exportable, `analysis_input` is null and the manifest retains the unavailable
sources and their reasons. Capture again with the corresponding content option.

The destination must not exist. Use a new directory for each capture; an
existing directory or symlink is rejected without overwriting its contents.
REA creates private output, verifies every written file by digest and durable
readback, and removes its own partial output on failure or cancellation.
A failed rollback reports residual paths.

## Sources and mappings

Every source is returned inline with its URL and its script/frame identity or
request transaction and event sequence references. The result also contains
the input capture's byte digest, original coverage, source Evidence link when
provided, and the persisted manifest's digest and byte count. A saved Evidence
envelope must have a valid semantic identifier and matching operation.

Exported `relative_path` values are relative to `analysis_input.input_path`.
The persisted `manifest.json` contains the same inline manifest fields, excluding
its own descriptor. It does not duplicate script bytes.

- Passive sources are the Debugger-exposed text encoded as UTF-8, with the
  verified source digest and source-map declaration retained. Unavailable or
  explicitly non-JavaScript sources remain unavailable.
- Scenario sources use observed requests classified as `script`, associated
  with one response event and the bytes returned by Playwright's
  `Response.body()` API for its response object. URLs never select the response.
  Playwright may load the request URL again with credentials when CDP has no
  response body, so transaction and event references do not verify that
  exported bytes came from the original network transaction. The capture and
  export manifest retain this limitation. Binary and empty retained bytes are
  written exactly.
- Ordinary query-free `.js`, `.mjs`, and `.cjs` URL paths are arranged under a
  directory for each origin, preserving their relative module layout when it
  is unambiguous.
- Competing versions, query/fragment variants, and file/directory prefix
  collisions, inline sources, and unrepresentable paths use unique isolated
  names with a stated reason. Missing competing sources also prevent selection
  of an apparently canonical version.
- Case-distinct URL spellings keep their relative paths when the destination
  filesystem can store both. If a later spelling collides at publication, that
  record is isolated while an earlier canonical spelling can remain. Read each
  record's `layout`, `relative_path`, and `layout_reason`; case isolation depends
  on the destination, unlike preplanned exact-path/version isolation.

## Interpretation and limits

Export does not fetch URLs or execute JavaScript. Retained Debugger sources and
response bytes do not establish execution or a complete website. Scenario
response bytes preserve Playwright's body API result; see the source-body
identity limitation above. Declared
redaction is preserved and can change JavaScript syntax; passive captures do
not report a byte-redaction flag, so that value remains unknown.

The existing analyzer inventories and parses the actual exported files. It can
resolve ordinary captured relative modules, but does not implement browser
import maps, root-relative URL loading, remote imports, or runtime behavior.
Its local resolver may strip import queries/fragments; isolated variants are
kept away from canonical paths to prevent those from selecting a different
observed version. Missing dependencies remain unknown. Source maps are not
fetched or reconstructed during export.

The export Evidence describes a derivation from the saved capture. Subsequent
application-analysis Evidence describes the local exported artifact. Their
identities and authorities remain separate.

## Verification

`npm run verify:browser:scripts` exercises active capture, exact source export,
manifest readback, query variants, and relative-module analysis through a real
browser, CLI, and stdio MCP. Set `REA_BROWSER_EXECUTABLE` to an installed
Chrome-family browser. The verifier accepts an optional installed REA entrypoint
argument for package verification. `npm run verify:browser` additionally covers
passive `inspect_web_page` export through both public adapters.
