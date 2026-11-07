# Captured website module relationships

`trace_web_module_imports` / `rea trace-web-module-imports` traces one script's
outgoing native ES imports and re-exports from an
[exported capture](website-script-export.md). It verifies the selected source's
SHA-256 and byte count, preserves browser URL identities, and returns every
matching capture candidate inline. It does not refetch website assets.

## Select the source and context

Provide a caller-supplied Chromium executable supporting `import.meta.resolve`.
REA does not install or upgrade a browser. Real verification covers Linux x64;
other hosts have not received this feature's real workflow verification.

```bash
REA_BROWSER_EXECUTABLE=/absolute/path/to/chrome \
  rea trace-web-module-imports /analysis/export/manifest.json 0 \
  --importer-url 'https://example.test/app/main.js?build=2#entry' \
  --import-map-path /analysis/import-map.json \
  --import-map-base-url https://example.test/maps/ \
  --json
```

The MCP input expresses the same choices:

```json
{
  "manifest_path": "/analysis/export/manifest.json",
  "script_index": 0,
  "importer_url": "https://example.test/app/main.js?build=2#entry",
  "import_map": {
    "path": "/analysis/import-map.json",
    "base_url": "https://example.test/maps/"
  }
}
```

`script_index` is zero-based in `manifest.scripts`. If `importer_url` is omitted,
the trace selects the reported source URL. An inline script's document base
cannot be established from that URL alone; choose the context explicitly when
known. `import_map` is optional and reads local JSON only. Its exact bytes and
base URL are retained; selecting it does not prove the map was installed in the
captured page. HTTP(S) importer contexts without URL userinfo are supported initially.
An unusable reported URL leaves the importer context unavailable; supply
`importer_url` explicitly when its value is known. An explicitly supplied malformed
URL is reported against that input field. URLs using unsupported schemes remain
capability limitations.

## Interpret the evidence

- Static imports, re-exports and literal dynamic imports receive the native
  engine's resolved URL or exact rejection message. Empty strings are retained.
- Computed dynamic imports retain their expression and source positions with
  `computed-specifier` unknown resolution. Erased type-only imports/exports and
  inferred bundler IDs are excluded from native import claims.
- Locations use UTF-16 offsets and columns, with one-based lines. Parse recovery
  diagnostics and unparseable input are explicit.
- Query variants and fragments remain distinct. An exact reported URL is an
  `exact-reported-url` candidate. A response URL stripped of its fragment is a
  weaker `response-url-without-fragment` content candidate. Multiple captured
  versions are all returned; the trace selects none as canonical.
- Candidate metadata remains reported capture evidence; only the selected
  source's bytes are reverified. Missing/lazy targets can resolve successfully
  with no captured candidate. Every relationship reports execution as unknown.
- Source-map declarations remain declarations; this operation does not read or
  invent map bytes, original-source mappings, worker ownership or UI causality.

The selected source is loaded from `files/` under the manifest's current
directory. Relocation retains the manifest's originally reported paths and the
actual current source path separately. Unsafe paths, symlink source directories,
nonregular files, wrong digests/sizes and malformed UTF-8 fail explicitly.
Malformed source bytes or unsafe source paths declared by the manifest are
artifact failures. Malformed caller-selected manifest or import-map files identify
the supplied input field.

## Engine and lifecycle

An owned temporary browser context runs REA's trusted resolver stub. The selected
application is parsed as data and is never executed by this trace. Page requests
are fulfilled with REA's synthetic document/stub or blocked; no website asset is
downloaded. This does not establish an OS sandbox or browser-wide network
containment. The engine version and native report are retained in Evidence.

Sources without literal imports do not acquire a browser. The manifest, source
and import map have 32 MiB, 16 MiB and 4 MiB input limits. Native resolution has
one 20-second deadline; cleanup may extend that deadline. One renderer is
requested, and there is no aggregate host memory-limit claim. Cancellation
closes only the owned browser; cleanup failure cannot return a successful trace.
`REA_BROWSER_NO_SANDBOX=true` passes Chromium's corresponding launch option when
the host requires it; it does not enable an REA security boundary.

See [testing](testing.md) for the native loading oracle and CLI/MCP real lane.

The selected local source filename supplies the parser grammar. JavaScript files
retain native dynamic imports even in relational expressions; TypeScript files
use the shared TypeScript grammar and omit erased import-type expressions from
runtime module tracing. Historical-source import retains those type dependencies
separately. Parser observations and native URL resolution do not prove execution.
