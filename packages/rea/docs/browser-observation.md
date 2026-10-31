# Website observation with CDP

Captured Debugger sources can be exported for REA's existing static JavaScript
analysis with `export_web_scripts`. See [captured website scripts](website-script-export.md)
for the capture options, source mappings, and browser/local resolution limits.
Use [captured module relationships](website-module-trace.md) to resolve one
exported script's native imports under an explicit URL/import-map context.

REA can attach to a user-owned Chrome-family browser through the Chrome DevTools Protocol (CDP) and produce bounded Evidence about an existing page. This is a passive reverse-engineering capability, not a general browser automation or remote-control surface.

For request/response bodies and traffic debugging, see
[Fiddler Everywhere captures and MCP](web-network-captures.md#reading-fiddler-captures-saz).
Inspect native SAZ or HAR 1.2 offline with REA, or connect Everywhere's separate MCP server.

HTTP discovery and browser WebSocket inputs require an explicit port. An
explicit default `:80` remains valid and is retained in the canonical endpoint;
omitting the port remains invalid. HTTP `/json/list` discovery preserves usable
siblings when optional metadata is malformed: attachment becomes unknown and
row/field diagnostics appear in `limitations`. Target identity and socket
authority are validated independently before selection and connection.

## Shipped surfaces

- `list_browser_targets` / `rea list-browser-targets` discovers all eligible page targets at the endpoint by default, with an optional exact-origin filter.
- `inspect_web_page` / `rea inspect-web-page` captures DOM structure, accessibility nodes, scripts, resources, safe response/DOM metadata, attach-window network and console metadata, WebSocket frame sizes, workers, quota, and optionally selected storage key names, redacted storage-content fingerprints, or script sources.
- `analyze_web_bundle` / `rea analyze-web-bundle` parses selected script artifacts without execution and derives chunk edges, route and endpoint candidates, vendor fingerprints, static WebMCP declarations, and optionally source-map/original-source evidence.
- `observe_web_session` / `rea observe-web-session` arms an observation window of the requested duration for an external user action and records ordered reload, SPA navigation, redirect, failure, lifecycle, and target-termination metadata.
- `discover_webmcp_tools` / `rea discover-webmcp-tools` uses the experimental CDP WebMCP domain to return observed in-scope registrations and their complete observed `input_schema` declaration and canonical `input_schema_sha256` digest inline. Declarations are untrusted JSON data, including declared types, required fields, enums, examples and reference URLs. REA does not resolve schema references. An omitted optional `inputSchema` is a valid parameterless registration, represented by null schema and digest. These fields replace `input_schema_shape`. Registrations with the same name and URL in distinct observed frames retain separate identities. `tool_key` includes the observed frame ID; it is not a stable identity across navigation or browser sessions. Same-frame registration updates replace that owner only, and removal leaves other owners intact. Declared `readOnly`, `untrustedContent`, `consequential`, and `autosubmit` annotation hints are reported per registration: `true`/`false` are declared values, `null` means the declaration did not provide the hint in that capture, and a missing `consequential` key means the hint was not recorded, either in a historical capture or because the observed annotation was invalid. Consult discovery completeness and exclusions to distinguish these cases. Malformed annotation values or registration stacks retain the registration with incomplete coverage and an `invalid_protocol_value` exclusion. Other malformed protocol payloads can fail discovery explicitly. REA never exposes `WebMCP.invokeTool`.

- `compare_web_captures` / `rea compare-web-captures` compares passive captures or exact-step-aligned browser scenarios. Scenario results commit reproducible literal normalization and expose alignment failures plus artifact-level action, screenshot, DOM, accessibility, URL, history, storage, and event differences. Missing or truncated evidence is never treated as equivalence.

For a compact route query, select `detail: "summary"` and a
`view: {kind: "javascript-routes", collection: "routes", limit: 20}`. The
shared [route inventory](javascript-route-inventory.md) preserves source IDs,
precise locations, partial coverage, and the complete parent Evidence for
subsequent filtered pages. Static candidates never establish complete application
coverage or reachability.

For `analyze_web_bundle`, each `webmcp_declarations` entry's
`schema_property_names` is a source-derived projection of statically known own
property keys, not schema validation. `schema_property_names_coverage` reports
how complete that projection is: `complete` means a literal properties object
was fully enumerated (including an empty literal); `partial` means a literal
object was available but some computed or spread membership was unresolved,
and the name array retains keys that were known; `unknown` means the schema or
properties owner could not be enumerated as an object literal, including
explicit non-object values; `not_present` means no effective schema or own
`properties` member was present after the `inputSchema ?? input_schema` alias
selection. `not_present` describes this projection only: it does not validate a
schema or rule out properties expressed through other schema constructs. Older
observations may omit the coverage field; treat omission as `unknown` rather
than inferring completeness from the array.

Passive DOM comparison checks complete node inventories and complete frame
parent/child structure independently. Node value lengths are comparable only
when both nonempty snapshots declare the same `node_value_length_unit`.
Missing or different units leave length comparison unknown; independent node
or frame structural differences can still prove change. Empty inventories have
no value lengths to compare. Frame IDs and sibling enumeration order
are capture-local and do not establish a change; duplicate IDs, missing parents,
and cyclic ancestry remain unknown. A complete frame difference can still prove
change when DOM nodes are incomplete, and vice versa. Partial DOM or metadata
collection digests do not prove modification: a missing node or link can result
from a protocol omission. Rejected DOM facts also mark derived URL and agent-hint
metadata incomplete, while valid facts from other nodes and documents remain
available in the capture.

Page network and console coverage starts independently at the first observed
event from that domain or its successful enable acknowledgment. The capture's
lifecycle start is earlier and does not establish domain readiness. Events
received before the enable reply remain part of the observation.

Worker output is a final target-inventory snapshot. `attached` describes any
debugging client, not an REA-owned observing session. The selected page-session
collector does not collect worker-session requests, console events, or scripts,
and workers that disappeared before the snapshot may be missing; worker
coverage is therefore attach-limited. Missing ownership metadata is reported as
`unattributed_target` with unavailable worker attribution, separately
from a proven foreign owner excluded as `out_of_target_scope`. A shared origin
alone establishes neither relationship.

Passive comparison keeps lookup identity, cross-capture correspondence, content
evidence, and inventory coverage separate:

| Observation                                                                                      | Comparison outcome                                                                      |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Renamed WebMCP tool keys/frame IDs with one matching name, owner origin, and frame URL           | Compare the registration content; local IDs do not prove change                         |
| Duplicate WebMCP owners with the same name, origin, and frame URL                                | Unknown correspondence; complete group count differences still prove change             |
| Matching script inventory keys with retained source digests                                      | Compare the retained SHA-256 values even without a producer hash                        |
| One corresponding script source is unavailable, or neither source nor producer hash is available | Source equality remains unknown; inventory changes and other proven differences survive |
| A partial HTTP response group is a subset of the complete peer                                   | Unknown; omitted repeated responses can explain the difference                          |
| An observed HTTP response fingerprint is absent from the complete peer group                     | Changed; omissions cannot explain that retained response                                |
| A WebSocket connection or frame inventory is incomplete                                          | Do not align retained payloads by position                                              |

Storage fingerprints decode supported CDP primitive/JSON values before hashing.
Debugger descriptions, previews, and remote references do not represent storage
content. Actual JSON properties with those names remain content. Reference-only
objects, unsupported values, and opaque cookie partition identities remain
incomplete. Previously exported fingerprints are not recomputed; recapture both
sides when comparing captures produced across this decoder change.
IndexedDB schema fingerprints with `projection_version: 2` include the observed
database version and object-store definitions. A missing, malformed, or imprecise
version leaves the schema fingerprint incomplete while retaining observed store
facts. Historical fingerprints without this marker covered object stores only:
matching historical hashes cannot establish unchanged database versions, and a
historical hash is not compared with a version-bearing hash. Recapture both
sides for a complete IndexedDB version comparison; other proven storage changes
remain reportable.

Script comparison groups observations by reported URL and compares unordered
content samples. Producer inventory keys include optional metadata, so a changed
key cannot by itself prove script removal or addition. Missing module, length,
language or source-hash facts remain unknown; shared known values and complete
retained source digests can still prove a group change. Partial inventories use
the same omission rule as repeated HTTP samples. WebMCP dropped-tool counts also
prevent equality, and two incomplete owner inventories cannot prove tool
correspondence merely from their different retained registrations.

- `capture_web_screenshot` / `rea capture-web-screenshot` returns a content-addressed visible-viewport PNG.
- `compare_web_screenshots` / `rea compare-web-screenshots` performs bounded local PNG pixel comparison without OCR or external services.
- The CLI comparison commands accept each capture, screenshot artifact or normalization policy as inline JSON or a JSON file path. Use files for screenshot artifacts and scenario captures, whose embedded PNG bytes can exceed the host's command-line length limit.
- Every surface has equivalent CLI and MCP contracts and returns Evidence provenance.
- MCP tools return complete results inline and include the Evidence ID. Session evidence can be exported with `export_evidence_bundle`.

Target discovery returns the complete in-scope target array in one result.

## Screenshot comparison memory budget

`compare_web_screenshots` admits both PNGs against a 256 MiB estimated
working-memory budget before inflating either image. This is a processing
buffer budget for this operation, not a PNG dimension limit, CDP transport
limit, or process RSS guarantee. Header-valid dimensions that exceed the
budget return `resource_constraint` with `details.resource: "memory"` and the
estimated and maximum working-set bytes. Invalid PNG structure remains
malformed input; encodings outside supported pixel-comparison coverage remain
unsupported-target errors.

The conservative estimate includes the two decoder-owned decoded input
buffers, the current image's concatenated IDAT buffer, Node zlib's default
16 KiB output chunk backing rounded up for retained chunks, the concatenated
inflate result while its output chunks are retained, one possible extra output
chunk before zlib checks `maxOutputLength`, unfiltered scanline storage,
RGB-to-RGBA expansion, and the first retained RGBA image while the second is
decoded. RGBA output aliases its unfiltered buffer and is counted once.
Admission uses checked integer arithmetic before image-sized allocation.
Caller-owned JSON/base64 strings, input parsing and validation, transport
buffers, garbage-collector behavior, and other runtime memory are outside this
estimate; the budget does not promise a bound on total process memory.

Electron `file://` pages use a separate provider and target boundary; see [electron-observation.md](electron-observation.md).

## Provider authorities

CDP page capture and V8 Inspector observation attach to an already-running
target without launching it, driving actions, or evaluating target code.
Playwright scenarios drive actions and capture step snapshots in either a
provider-owned browser or a caller-selected external browser. Separate providers
preserve these authority and lifecycle differences. They share one exclusion
vocabulary (`BrowserExclusionReason`): every denial reason maps onto it, even
where a wire schema keeps a narrower historical bucket.

Passive page and Inspector capture enable the `Debugger` domain. A target's
`debugger` statement can then pause execution; these observation paths do not
suppress pauses with `Debugger.setSkipAllPauses` or resume the target. Their
lack of explicit pause commands does not guarantee uninterrupted execution.

CDP attachment is not a guarantee that the browser preserves all state.
Chromium can clear another client's `navigator.platform` emulation when REA's
page session disconnects, even if that session sent no emulation commands.
This affects page inspection, bundle capture, session observation, screenshots,
WebMCP discovery, and Electron page inspection; target listing alone does not
attach a page session. REA cannot read the other client's complete
user-agent/client-hint configuration and does not replay guessed settings.
Use a disposable browser when preserving externally configured emulation is
required, or have the owning client reapply its complete configuration afterward.
See [the reproduction and Chromium ownership limitation](https://github.com/morluto/rea/issues/4089).

Existing static application Evidence and passive web/Electron captures can be
combined later through
[JavaScript static/runtime reconciliation](javascript-runtime-reconciliation.md).

## Start a browser

Start a separate browser profile with an explicit debugging port. The exact executable name varies by platform and installation:

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/rea-browser-profile \
  http://127.0.0.1:3000
```

REA does not launch, own, or terminate this browser. Use a dedicated profile and stop it yourself when the investigation is complete. Do not expose the debugging port on a non-loopback interface.

Other Chromium-family browsers, such as Chromium or Brave, work the same way
with the same two flags. On macOS, run the executable inside the application
bundle, for example
`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` or
`"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"`. Fedora installs
Chromium as `chromium-browser`.

REA attaches through the browser's HTTP discovery endpoint on a loopback port,
or, for some passive tools, through a
[browser socket](#browsers-without-http-discovery). Connection failures report
`endpoint_unreachable`; a reachable HTTP service that returns a non-200 or
non-JSON discovery response reports `invalid_endpoint_response`.

In a minimal Linux container, headed Chromium under Xvfb can keep running while
its DevTools port never opens. Install the GLES, EGL, and Mesa DRI libraries
(on Fedora: `libglvnd-gles`, `mesa-libEGL`, and `mesa-dri-drivers`), then
restart the browser.

On Linux, a reachable but locked desktop keyring can stall Chrome before its
first navigation. For a dedicated investigation profile, add
`--password-store=basic` to bypass that keyring. Empty or placeholder frame URLs
then describe an unloaded page; REA continues to require an allowed, committed
URL. See [the startup investigation](https://github.com/morluto/rea/issues/1384#issuecomment-6093781686).

### Browsers without HTTP discovery

Some browsers expose a loopback browser WebSocket but no `/json/version` or
`/json/list`. Chrome 144 and later can enable remote debugging on a running
browser from `chrome://inspect/#remote-debugging`; this mode is reported to
serve only the browser socket. Since Chrome 136, `--remote-debugging-port` is
ignored for the default profile, so this is the remaining way to inspect a page
in an existing profile.

For such a browser, pass the browser socket instead of the HTTP endpoint:

```bash
rea list-browser-targets ws://127.0.0.1:9222/devtools/browser/<id>
```

Chrome writes the port and the `/devtools/browser/<id>` path to the
`DevToolsActivePort` file in its user data directory. REA does not read that
file for you.

- Only `list_browser_targets`, `inspect_web_page`, `analyze_web_bundle`,
  `observe_web_session`, `discover_webmcp_tools`, and `capture_web_screenshot`
  accept a browser socket. Website runtime attribution, Electron inspection,
  and scenario attach mode still require HTTP discovery.
- Each call opens one WebSocket and uses it for discovery
  (`Browser.getVersion`, `Target.getTargets`) and for the selected page.
  Discovery must finish within the same 10-second deadline as HTTP discovery.
  Chrome may ask you to approve each connection.
- The browser identifier controls access to the socket. Evidence records the
  endpoint as `ws://127.0.0.1:9222/devtools/browser/[REDACTED]`.
- `browser.revision` is the socket's `Browser.getVersion` value, such as
  `@e533e98…`. HTTP discovery reports `WebKit-Version`, such as
  `537.36 (@e533e98…)`.
- `Target.getTargets` reports whether each target is attached. Chrome's
  `/json/list` can omit it, so HTTP discovery may report `attached` as `null`.
- An existing profile can hold many unrelated pages. Target listing returns
  each eligible page's URL and title, so pass `--allowed-origins` to list only
  the origins you are investigating.

A browser driven only through `--remote-debugging-pipe` or a vendor's private
automation channel has neither endpoint, and REA cannot attach to it. To
inspect such a page, reproduce it in a Chromium-family browser started with
`--remote-debugging-port`.

## Request boundary

CDP connections enforce the shared 64 MiB limit per WebSocket message. A larger
reply, including a valid reply from Chrome, fails with `payload_limit`. The limit
counts message bytes before JSON parsing; it does not bound the memory used by
decoded strings or JSON objects.

Discovery supplies a literal loopback CDP endpoint and returns all eligible
page targets unless an exact HTTP(S) origin filter narrows the result. Follow-up
inspection requests select one target; their default scope is its current origin.
The endpoint is either `http://127.0.0.1:PORT` or a
[browser socket](#browsers-without-http-discovery),
`ws://127.0.0.1:PORT/devtools/browser/ID`; `[::1]` may replace `127.0.0.1`.
`localhost`, private-LAN addresses, HTTPS and `wss:` endpoints, credentials,
queries, fragments, implicit ports, and any other path are not valid CDP
endpoints. Origin filters contain only scheme,
host, and port; paths, credentials, queries, fragments, and wildcards are not
valid origins.

## CLI workflow

Pass the endpoint and selected target for each call. An origin filter is
optional and narrows the target set.

```bash
rea list-browser-targets http://127.0.0.1:9222 --json
rea inspect-web-page http://127.0.0.1:9222 TARGET_ID \
  --observation-ms 1000 \
  --json
```

Passive observation honors the requested duration using cancellable waits within
the runtime's timer range. Long windows stay pending across successive waits;
caller cancellation, target termination or leaving the allowed origins ends
collection early. `window_elapsed` identifies completion of the requested wait.

Static bundle analysis and a user-driven observation window are separate operations:

```bash
rea analyze-web-bundle http://127.0.0.1:9222 TARGET_ID \
  --json
rea observe-web-session http://127.0.0.1:9222 TARGET_ID \
  --observation-ms 10000 --json
rea discover-webmcp-tools http://127.0.0.1:9222 TARGET_ID \
  --json
```

### WebMCP discovery prerequisites

`discover_webmcp_tools` reports only what the attached browser's experimental
`WebMCP` CDP domain exposes. When a browser rejects the unknown domain, the
result reports `status: "unavailable"`. Whether a page can register tools at
all depends on several conditions that are not interchangeable:

- A site's own origin-trial token can enable the API for that origin
  **provided the trial is still active, the browser version and platform
  support it, and user settings permit it** — token presence alone is not a
  guarantee. The trial is announced for Chrome 149 and later.
- The `WebMCPTesting` feature — `--enable-features=WebMCPTesting` at launch, or
  `chrome://flags/#enable-webmcp-testing` in a normal profile — enables the
  API page-side for that browser instance, independent of per-site tokens.
  In one pilot run, a site whose registration code was present but whose
  served token was scoped for third-party use registered 0 tools under a
  default launch and 4 under the flag; that the token did not enroll the
  first-party document is consistent with this but is an inference, not a
  measured Chrome behavior.

In Chrome 154 specifically (one tested version), `WebMCP.enable` answered
under a default launch — the debug domain was not flag-gated in that run.
Other versions may differ, so an unattributed zero-tool result should be
read as registration state only after domain availability is confirmed.

Discovery is attach-only: the command needs a reachable loopback CDP endpoint
and a target ID from `list_browser_targets`, and it never navigates, reloads,
or evaluates the page. Observe the page in the state you want to measure;
registered tools reflect what the protocol delivered. If an in-scope subframe
already exists when discovery attaches, `webmcp_tools` remains attach-limited:
Chromium replay may omit its older registrations. Later live registrations
retain their frame ownership but do not establish recovery of those missing
descriptors. REA does not reload, evaluate, or invoke tools to fill that gap.

Accessibility names/descriptions, console primitive text, JSON body shapes, WebSocket shapes, script content, and storage key names are selected independently:

```bash
rea inspect-web-page http://127.0.0.1:9222 TARGET_ID \
  --include-accessibility-text \
  --include-console-text \
  --include-json-body-shapes \
  --include-websocket-shapes \
  --include-script-sources \
  --include-storage-keys --include-storage-fingerprints \
  --json
```

Accessibility text, script content, query values, and explicitly requested primitive console text may contain application secrets and become part of the returned Evidence. URL username/password credentials are removed; ordinary query values, fragments, and parameter order remain intact. JSON and WebSocket captures retain complete paths, types, and counts, never values or examples. Storage values remain redacted even when key-name capture is requested. `--include-storage-fingerprints` requests SHA-256 identity/value fingerprints, which support comparison only when cookies, DOM storage, IndexedDB, and Cache Storage were all captured completely.

Screenshot capture returns the complete visible viewport as an inline image artifact:

```bash
rea capture-web-screenshot http://127.0.0.1:9222 TARGET_ID \
  --json
```

## MCP input

```json
{
  "cdp_endpoint": "http://127.0.0.1:9222",
  "target_id": "TARGET_ID_FROM_LIST_BROWSER_TARGETS"
}
```

The omitted observation window and capture options use conservative defaults.
Set an option only when the investigation needs that additional content.
Collection counts are not capped. Per-value validation, the selected observation
window, and CDP protocol limits still apply; any incomplete or truncated values
are reported in the result.

Call `list_browser_targets` first because target IDs are browser-instance-specific. REA rechecks the selected target's current type and origin immediately before attaching. Without an origin filter, discovery lists all eligible pages; an individual capture defaults to the selected page's current origin.

REA establishes a main-frame origin boundary before enabling Runtime, Debugger, or Network observation, rechecks it before document capture, and validates it again afterward. If the main frame navigates during final capture, REA discards the mixed result and returns `target_changed`.
An observed navigation also takes precedence over failures from stale
document reads, such as a script ID invalidated by reload; cancellation remains
cancellation. Retry after navigation settles, or refresh target discovery if
the selected page was replaced. Origin-scope refusals from page inspection,
runtime observation, screenshots, and WebMCP discovery explain the permitted
HTTP(S) origin scope and direct the caller to select a permitted document or
explicitly revise `allowed_origins`. Page capture also preserves an observed
main-frame scope violation when a later document read fails. An unresolved
initial main frame does not establish an origin violation; its bounded startup
retries retain a distinct refusal.

Screenshot capture requires a valid main-frame identity. Malformed identity
produces a protocol failure; a readable child frame cannot substitute for the
main frame.

The web-session timeline uses CDP monotonic seconds where the event producer
provides a comparable timestamp; absent or invalid timestamps are `null` rather
than a synthetic zero. Events buffered while REA samples the window boundary are
retained only when their timestamp places them after that boundary; older events
are excluded. A buffered event without a comparable timestamp may remain as
contextual evidence with `timestamp: null`, accompanied by a limitation stating
that it does not establish activity in the selected window. Main-frame scope
enforcement still applies to contextual navigation events. Network redirect
events retain their paired prior-hop response context when the timestamped
next-request event falls inside the window. A redirect row's optional
`redirect_response` contains the prior response `url`, CDP-reported `status`,
and `scope`. The URL has transport credentials removed; URL and status are
withheld unless its origin is approved. Missing or malformed response URLs have
null scope and add `invalid_protocol_value` timeline coverage; a valid URL with an
unsupported protocol has `unsupported` scope. Outside-policy and unsupported
responses mark the timeline as policy-filtered with `disallowed_origin` or
`unsupported_url`. Missing status remains null rather than zero. A supplied
non-numeric status is also null and records `invalid_protocol_value` coverage;
the other valid response facts remain available. Historical rows may omit this
field; omission does not establish that no prior response existed. Response
headers and bodies are discarded. The row timestamp belongs to the next request,
not an exact prior response time. The pre-arm timeline buffer is bounded
by original CDP message bytes. If clock sampling completes after that budget is
exhausted, the operation returns `payload_limit` instead of a partial window.
Cancellation and clock-request failures retain their own outcomes. Session
`load_failed` rows require a previously observed main-frame `Document` request;
subresources, child-frame requests and failures without admitted request ownership
are excluded. Redirects reuse their request identity, and completed/failed requests
release it. Active request identity metadata uses the existing 8 MiB retained-event
allowance; exhaustion fails the observation explicitly instead of guessing scope.

## Data minimization

Response metadata parses repeated CDP header field lines independently. The
Link projection retains their declarations in order. `csp.directives` lists the
directives of every CSP policy in order, across field lines and comma-separated
policies, without recording policy boundaries, so a directive name can repeat
across policies. As in CSP3, a repeated name within one policy is ignored.
Single-valued policy fields combine their lines as one comma-separated value,
as RFC 9110 specifies. Each link keeps its target in `href` and
its relationship context in `context_url` with a separate `context_scope`;
absent `anchor` uses the response URL, while a relative `anchor` resolves
against that URL. Anchored links remain in the projection, but a `link_rel`
agent hint is emitted only when the resolved context matches the response URL
before userinfo credentials are removed. Following [RFC 8288](https://www.rfc-editor.org/rfc/rfc8288.html),
the `rel`, `anchor`, and `type` parameters use their first occurrence, and
quoted-pair escapes are decoded as specified by [RFC 9110 §5.6.4](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.4).
The context fields are optional when reading older saved captures. Commas
inside URI targets or quoted parameters remain part of those values.
Well-known-resource hints require an exact supported pathname; path case is
preserved because a case variant may identify a different HTTP resource.
COOP and COEP projections retain the exact declared token after validating the
complete Structured Field Item, including parameters such as `report-to`.
These are declarations, not an assessment of the document's effective policy;
absent, malformed or non-token items project as `null`.

Console entries, WebSocket frame summaries, and selected request/response JSON
shape outputs share one 8 MiB retained-observation allowance per capture. Shape
inference admits expanded path bytes before allocating those paths, including
escaped and Unicode property names. Replacing or removing a request's shapes
refunds their retained charges. A refused body shape preserves network metadata
and any captured peer shape with `resource_budget_exhausted` coverage; a refused
WebSocket frame is counted as dropped rather than reclassified as non-JSON text.
The allowance has no runtime override. Protocol messages and JSON input parsing
remain subject to their separate transport admission; this output allowance does
not bound the whole process heap.

REA retains local observation data and removes only URL userinfo credentials, explicitly declared scenario secrets, and values from structured credential/storage fields:

- URL observations preserve the complete local URL, including query values, fragments, duplicate parameters, and their order. Only username/password userinfo is removed; malformed original URL strings remain available with `origin: null`.
- DOM snapshots retain node types, node names, value lengths, and attribute names, but not text or attribute values. `dom.node_value_length_unit` is `utf16-code-units` for web observations and applies to every node's `node_value_length`; it counts JavaScript string code units, not Unicode code points or UTF-8 bytes. Electron observations declare `utf8-bytes` instead. Historical captures without the unit leave it unknown; reading them does not infer a unit or convert their stored lengths.
- Supported DOM URL attributes are projected separately as resolved destinations. Empty `action` on HTML or XHTML forms and empty `formaction` on HTML or XHTML submit controls resolve to the document URL; other relative URL attributes resolve against the captured document base.
- Accessibility structure and reported roles are retained by default, while names and descriptions require `include_accessibility_text: true`. The browser protocol may omit an individual role; that role remains unknown for comparison. Other observed accessibility differences can still establish a change.
- Network observations retain method, status, MIME type, size, type, initiator stack location, and complete URLs with userinfo credentials removed. Redirects reported by CDP are attached as ordered `redirects` on the one request ID, with the prior request URL, CDP response URL, method/type, response status/MIME/encoded length, request timestamp, and the next `requestWillBeSent` event timestamp. CDP delivers `redirectResponse` with that next request event, so the latter is an event boundary rather than an exact response timestamp. Redirect response headers and bodies are discarded; hops outside the selected origins are discarded with the request chain. Headers are discarded after an allowlisted projection of length/encoding, structured CSP/Link/policy fields, and untrusted agent hints. Cookies and authorization headers are never retained.
- Request/response bodies are not requested or parsed by default. When selected, only allowed-origin JSON media types are read, converted immediately to complete value-free typed paths, types and observation counts, and discarded. Each path segment is either `{ "kind": "property", "name": "raw property name" }` or `{ "kind": "array-element" }`; array-element types include primitives and nested arrays. Literal `*` properties remain distinct from array elements. `Network.getResponseBody` is never sent unless JSON body shape capture is selected. A JSON-typed request body that CDP reports through `hasPostData` but omits from `postData`, or that cannot be parsed as JSON, makes `json_body_shapes` unavailable. That request's `body_shapes.status` is `partial`, not `included`, when only its response shape was captured. Base64 response bytes must be valid UTF-8 before JSON interpretation; invalid bytes leave the response shape unavailable and preserve any observed request shape and network metadata. Producer-decoded strings and genuine U+FFFD characters retain their reported meaning. Comparison uses body shapes only when both captures selected them, and compares request/response shapes only where both observations provide those facts. Unavailable or truncated selected coverage makes equivalence unknown; observed differences still report changed.
  For normalized passive inputs with complete request inventories on both sides,
  request additions and removals remain observable even when selected body shapes,
  response metadata, or WebSocket coverage are unavailable. HTTP request and
  WebSocket inventory coverage are evaluated separately; complete HTTP coverage
  cannot prove a missing WebSocket connection. A missing request in a limited inventory cannot prove absence; a retained
  request absent from a complete peer can prove a change. This comparison rule does not make live CDP's
  attach-limited inventory complete or establish body-shape equality.
  An unavailable HTTP resource type also leaves request identity incomplete:
  observations with the same method and URL remain possible matches across types,
  and identical unknown types cannot establish complete equality. Ambiguous type
  groups cannot prove membership or content changes either: a missing type may
  redistribute repeated requests between buckets without changing the requests.
  Their comparison remains unknown, while independently identified groups retain
  proven changes. Different methods/URLs and complete empty peer inventories still
  support absence claims.
  Relevant dropped-event counts also limit inventory completeness even when no
  section is listed as truncated: HTTP uses `network_requests`, while WebSocket
  uses `websocket_connections` and `websocket_frames`. Drops in other event kinds
  and the aggregate total do not by themselves limit HTTP inventory. Proven
  modifications remain reportable despite incomplete inventory.
  Repeated HTTP samples retain multiplicity. A partial group that is contained
  in a complete peer cannot prove modification, even when the omitted response
  had different content. A retained sample absent from the complete peer can
  prove modification. Two partial groups cannot establish response
  correspondence from their different retained samples alone.
  WebSocket stream inventories and connection counts likewise require complete
  WebSocket coverage. Retained frame positions are compared only with complete
  connection/frame inventories; matching direction/opcode sequences alone do
  not prove alignment after drops. Redirect resource types use only shared known metadata:
  an omitted type leaves equality unknown rather than proving a modification.
- Console observations with a stack source retain call type, argument types, the CDP `Runtime.Timestamp` in milliseconds since Unix epoch, and source location. An absent or invalid timestamp is `null` and makes `console_events` incomplete; an observed zero remains zero. Argument types are listed by CDP argument position. An absent or non-array argument inventory is `null`, and a malformed argument keeps its position as `unknown`; either makes `console_events` incomplete, while an observed empty inventory remains `[]`. A malformed stack or top stack frame is not replaced by its caller: the console event is excluded, and a request initiator location or WebMCP `registration_source` is `null`; each is reported as `invalid_protocol_value`. This epoch-millisecond clock is separate from the monotonic-second timestamps in `observe-web-session`. When console text capture is selected, already-delivered primitive values are retained verbatim with their original `argument_index`; objects, getters, and remote properties are never expanded. Text capture is `unavailable` when the argument inventory is unknown.
- WebSocket observations retain direction, opcode, and payload byte length. A missing or malformed CDP opcode is returned as `null`, with opcode-dependent payload byte length and shape also `null`, and marks `websocket_frames` incomplete. Missing or wrong-typed payload data is not treated as empty; its byte length is `null`, and a text payload shape is unknown. Numeric opcode `0` and an observed empty payload remain distinct from missing data. Opcode is nullable in the public inspection schema, so clients must handle unknown protocol values. When shape capture is selected, text messages are classified as text or complete value-free JSON shape; binary bytes, hashes, prefixes, and raw payloads are never retained.
- Storage observations always redact values. Key names, IndexedDB names, and cache names require `include_storage_keys`; stable content fingerprints require the additional `include_storage_fingerprints` selection. Cookie fingerprints cover cookies applicable to the current main-frame URL, including its path, rather than every cookie path on that origin. Other storage remains scoped to the origin. Cache fingerprints hash all decoded response bytes, including bodies above 64 KiB, subject to the [64 MiB per-message CDP limit](#request-boundary). Missing or undecodable cache bodies and partial IndexedDB remote objects make fingerprint coverage incomplete, so identical observations remain `unknown`.
- Unavailable or malformed storage inventories mark `storage_keys` unavailable, even without fingerprints. Comparisons suppress inferred key additions and removals while preserving modifications proven by complete fingerprints on both sides. Previously exported captures are not retroactively corrected; recapture them to obtain these coverage markers.
- Script metadata is included only when CDP supplies a URL on an allowed origin. Stable keys exclude transient CDP script IDs, and exact transient raw URLs are used only during script/resource reconciliation. URL-less scripts are excluded because their origin cannot be established. When CDP supplies an execution-context association, the accepted script retains its authorized frame ID for later attribution. Script metadata admission bounds retained identity and source-map strings to 8 MiB and 50,000 records. When a source-map URL cannot fit, the script identity remains and source-map coverage reports `resource_budget_exhausted`; rejected script observations are counted without retaining their IDs. Source content is omitted unless explicitly requested and is returned inline as a self-verifying artifact with its SHA-256 digest.

Frames, resources, scripts, events, and workers outside the selected origin scope are excluded. An explicit `allowed_origins` list can include additional origins; excluded target details are counted without being exposed.
Retained workers include validated opener-target and parent-frame IDs when CDP
provides them; these relationships do not expand the exact-origin boundary or
prove static module ownership.
Workers without either relationship are withheld with an `unattributed_target`
exclusion and `workers` in `unavailable_sections`: a same-origin URL does not
establish which page owns a worker. A supplied relationship to another target or
frame remains `out_of_target_scope`. Missing ownership also remains unknown when
the worker URL is empty; withheld target details are not returned.

## Completeness and limits

The default inspection window is 500 ms; callers choose its duration. The
capture returns in-scope frames, DOM and accessibility nodes, admitted scripts,
resources, workers, storage names, and observed network, console, and WebSocket
events. Full selected text, script sources, and JSON shapes are returned inline.
The result distinguishes
`complete_within_window`, `policy_filtered`, `attach_limited`, and `truncated`
coverage. It reports excluded items and any values omitted or truncated by
validation and resource bounds. Omitted script metadata makes its affected
section explicitly truncated.
Disallowed-origin entries are filtered before retention.

Script metadata and selected source reads use one fixed admitted-script snapshot.
New in-scope script IDs still retained when the final CDP read completes are
counted in `scripts.total` and `completeness.dropped_events.scripts`, with
`scripts` marked truncated; they do not extend the source-read pass. Repeated
late events for the same ID count once. The original snapshot is not replaced
or reduced by later updates to an existing ID. These omissions do not imply
that a source byte or time budget was exhausted.

Selected script-source collection shares a 32 MiB aggregate UTF-8 retention
budget and the `command_timeout_ms` deadline (default 20000 ms) across the
capture. The byte budget has no runtime override. An oversized source is
omitted while later smaller sources may still fit. When the deadline expires,
remaining source reads are skipped. Script metadata, per-item omission reasons,
and `script_sources` completeness remain available. A single CDP response can
still be materialized up to the separate 64 MiB transport limit before source
admission; the retention budget does not bound that transient allocation.

Bundle parsing and semantic inspection run sequentially in an owned child,
without executing captured code. These are separate phases. `max_heap_mb`
defaults to 1024 MiB V8 old-space (range 128..16384). `analysis_timeout_ms`
defaults to 30000 per script, including startup and transfer.
`total_analysis_timeout_ms` defaults to 300000 across script analysis. A
per-script deadline above the effective total is rejected. A failed or
timed-out script becomes an explicit unknown while completed findings and later
scripts remain available. Total-deadline expiry returns a typed timeout with
partial Evidence and identifies unstarted scripts. `source_map_fetch_timeout_ms`
defaults to 30000 and is an item limitation, not that analysis timeout. These
controls are also available as CLI flags with hyphenated names. Worker protocol
and result byte budgets have no runtime override.

One web-bundle capture/analysis is admitted per REA process at a time. Completed
script results share an 8 MiB serialized transfer budget, with host heap
reservation checked before decoding and validating another result.
When the host reservation is what reaches zero, the failure names that heap
headroom and the remaining fixed budget. When the 8 MiB allowance itself is
exhausted, the failure names that fixed budget and says it has no runtime
override. Either stop ends further script launches and returns a typed
resource failure with completed facts and explicit unstarted-script unknowns.
Worker control frames are limited to 64 KiB. Cleanup must confirm child termination
before releasing its private files; failed cleanup retains its exact owner and
blocks replacement until retry succeeds. Cancellation retains completed bundle
facts, including cancellation during final cleanup.

The worker heap setting is not a process-family RSS limit. Node enforces V8
old-space flags; Bun ignores them. Windows Bun instead uses an owned process
commit limit with a 512 MiB runtime reserve; other Bun hosts have no enforced
memory limit. An allocation failure before that Windows limit is reported as
reached still names the configured limit and says it was not reached. These
bounds do not establish an aggregate host-memory limit across other REA
operations or external processes.

Resource-tree inventories distinguish a valid empty `resources` array from a
missing or malformed collection. Invalid resource entries are omitted with
incomplete coverage, while valid resources from that frame and other frames
remain available. Comparing an incomplete resource inventory cannot prove
addition, removal, or equality; a complete empty inventory can prove removal.
Resource records require a nonempty type and a string MIME type; absent or
malformed required fields are recorded as omissions instead of invented defaults.
An explicitly empty MIME type is valid. The optional content size may be absent;
an invalid supplied size remains unknown with incomplete resource coverage while
the resource's other facts are retained. Zero and nonnegative fractional sizes
are preserved.
`resource_key` remains the exact observation identity used by script
reconciliation. Capture comparison groups resources by URL, origin, type and
MIME type, then compares known sizes within a group. If a matched group contains
an unknown size, comparison reports unknown rather than treating the observation
as a resource addition or removal; complete inventory coverage still establishes
when an entire group is absent.

CDP discovery has a 10-second response deadline. HTTP discovery documents
use an 8 MiB budget. Browser-socket discovery (`Browser.getVersion`,
`Target.getTargets`) uses the 64 MiB protocol message budget. Neither budget
nor the discovery deadline has a runtime override. `list_browser_targets` accepts no
`command_timeout_ms`: HTTP discovery and browser-socket discovery
(`Browser.getVersion`, `Target.getTargets`) stay on that fixed deadline, and
the socket closes without a later command. Other CDP tools use
`command_timeout_ms` (default 20000) for each WebSocket handshake and command
response, separate from the caller-selected observation window, discovery, and
the 5000 ms cleanup grace. A browser-level socket's handshake and the following
`Target.attachToTarget` each receive that full deadline; they do not share one
budget. A stalled handshake or command reports
`provider_timeout` and names `command_timeout_ms` only when that operation
accepts it; caller cancellation still reports cancellation. WebSocket messages
remain subject to the [64 MiB limit](#request-boundary), which has no runtime
override. REA does
not impose a message-count or pending-command quota. On cancellation, it closes
only its own WebSocket,
waiting up to one second before terminating it. Malformed unsolicited events
and malformed replies to pending commands poison the connection so later
commands fail closed. A correlated reply's session ID must match the command's
selected session. An optional method is unavailable only when the browser
rejects it as unknown; other command rejections retain their reported failure.

Network and console coverage starts only after REA attaches and enables the relevant CDP domains. `prior_activity_available` is always `false`; absence from these arrays is not evidence that an event never occurred. Scripts are different: scripts the page parsed before REA attached are still reported under `scripts`. A page that loaded before attach can therefore list its scripts while `network.requests` lacks the requests that fetched them. If CDP reuses a request ID without supplying redirect metadata, REA retains the predecessor observation and marks network coverage incomplete.

Source maps are not fetched by inspection. Bundle analysis fetches them only when `fetch_source_maps` is selected, with exact-origin redirect checks and no credentials, cookies, or referrer. Each fetch operation uses `source_map_fetch_timeout_ms` (default 30000) and a 64 MiB aggregate streamed-response budget across redirects. The byte budget has no runtime override. A fetch overrun is an item limitation, not a thrown analysis timeout. A deadline or byte-limit failure remains explicitly unavailable and makes bundle completeness partial. Source-map decoding also bounds raw resolved identities to 64 MiB and aggregate inline evidence to 32 MiB. Failed maps preserve their failure context when it fits; if another context cannot fit, collection stops with the full requested count, the returned processed count, and an explicit unknown-results limitation. Retained mappings and original sources are returned inline. See [source-location limits](web-source-location.md) for the structural decoder bounds. Original source artifacts with `.ts`, `.tsx`, `.mts`, or `.cts` suffixes carry `text/typescript`; other source names retain `text/javascript`.

A fully read response that fails UTF-8, JSON, mapping, or structural validation
retains `artifact: null`, empty original-source, module-edge, and mapping
arrays, and an explicit failure limitation. Invalid content is `invalid`;
decoder or structural capacity refusal is `fetch_failed`. Its optional
`response_identity` records the complete body's SHA-256 digest, byte count,
and `fetch-response-body-bytes` representation without retaining malformed
text or charging that text to the 32 MiB output budget. These are bytes
delivered by Fetch after HTTP content decoding and before UTF-8 decoding, not
HTTP wire bytes. The identity is absent when the body was not fully read, and
older observations may omit it. A response whose text cannot fit the existing
output budget is likewise `fetch_failed` with text omitted and completed-body
identity; JSON parsing and source-map decoding are not attempted. Successful and partial maps keep their
full text artifacts. Their original text, including an initial BOM or XSSI
line, remains distinct from the parsing view that removes that framing.
Collection reads the body once and does not raise its response or output limits.

When fetching is selected, source-map `excluded` facts preserve the capture
ledger's reasons and counts for declarations rejected before download. No
disallowed URL details are retained or fetched. `requested` and `processed`
count the admitted fetch requests; exclusions are counted separately. Excluded
declarations make the collection unavailable, or partial when maps were retained.
An empty collection with no declarations remains `not_requested`.

If the caller cancels while later source maps are being fetched, the failure's
partial Evidence retains the captured page and every completed map item. Its
`normalized_result.kind` is `web-bundle-acquisition` and
`analysis_status` is `not_performed`: no script-analysis result is claimed.
`source_maps.requested` remains the admitted request count,
`source_maps.processed` counts completed items, and any unprocessed requests
have an explicit unknown-results limitation. Capture exclusions remain in the
same collection. The cancellation error keeps the caller's exact reason;
an already observed response resource or cleanup failure keeps its own error
category and cleanup owner.

Source-map items retain the script's `declared_url` separately from the observed
`effective_url`. Successful maps use the latter as their source-resolution base.
Failed fetches retain the last response URL observed within the approved origins;
`effective_url` is `null` when no response was observed. Query parameters are
preserved, and both URLs count toward the inline evidence budget.
Current fetches emit a string or null; historical observations may omit
`effective_url` without changing their stored content or Evidence identity.
An observed URL must fit before its response body is read. If it cannot fit,
remaining map results are explicitly unknown; failed cancellation retains its
cleanup context and resource constraint.
Indexed maps whose decoded mappings cross the next section's starting position
are invalid under [ECMA-426](https://tc39.es/ecma426/2024/), rather than complete
maps with clipped mapping rows. Fetch collection and source tracing share this
validation.

## Non-goals and threat model

The browser provider deliberately does not expose generic CDP commands, `Runtime.evaluate`, WebMCP invocation, navigation, input, downloads, page closure, or browser closure. Screenshot capture is the sole pixel surface and returns an image only when requested. REA disables the domains it enabled, detaches the target session, and closes only its own WebSocket.
Discovery and attachment errors remain primary if closing REA's socket also
fails. The cleanup failure is reported alongside the original command failure;
it cannot replace the operation diagnostic.

This feature is not a browser sandbox or network containment mechanism. The attached page and browser continue running with their existing privileges and may make external requests independently of REA. CDP gives deep access to the selected browser profile, so use a dedicated profile, include only origins you intend to inspect, and treat other same-user processes as outside this boundary.

Response metadata normalizes a `Referrer-Policy` fallback list to its last recognized nonempty policy, including mixed-case tokens. Unknown policy names are skipped; malformed token syntax and lists without a recognized policy remain `null`. This reports the response's declared policy, not the effective policy of a document or an inferred browser default.
