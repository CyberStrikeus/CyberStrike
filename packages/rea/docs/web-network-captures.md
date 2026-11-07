# Historical web network captures

Use `inspect_web_network_capture` / `inspect-web-network-capture` to inspect
retained producer evidence. This is an offline operation: recorded URLs are
never fetched, and no browser or proxy listener is started.

```sh
rea inspect-web-network-capture /absolute/session.har har --json
rea inspect-web-network-capture /absolute/session.har har --record 2 --record 0 --json
```

```json
{
  "name": "inspect_web_network_capture",
  "arguments": {
    "capture_path": "/absolute/session.har",
    "format": "har",
    "record_ordinals": [2, 0]
  }
}
```

Omit ordinals to return every record. Explicit selection preserves caller order
and original zero-based producer ordinals; duplicate or out-of-range selections
are input errors. Every record is validated before selection, so selecting one
entry does not hide a malformed entry elsewhere.

For agent discovery over MCP, request `detail: "summary"`. REA retains the
complete selected Evidence in the session and returns identity and counts.
Use `normalized_result.parent_evidence_id` with `inspect_analysis_view`:

```json
{
  "source": {
    "kind": "retained-evidence",
    "evidence_id": "<parent_evidence_id>"
  },
  "view": { "kind": "capture", "detail": "preview", "offset": 0, "limit": 20 }
}
```

Preview pages select recorded HTTP headline fields, event names/times when
present, original locations and byte descriptors; they omit headers, XML and
payload content. Choose `detail: "complete"` in that view for exact record
pages, including all sidecars. Offsets follow the parent's selected record
order; producer ordinals remain unchanged. `total_records` counts the original
capture while `retained_records` and page coverage count records in the parent.
An exhausted page does not establish absence from unselected records.

Views do not reopen the file or rerun its decoder. They remain historical
Evidence if the source changes or disappears; inspect the capture again to
observe new bytes. The inspection tool's default `detail: "complete"` preserves
existing inline delivery. For CLI use, save complete inspection JSON and pass
it as inline Evidence to `inspect-analysis-view`; the same summary and capture
page contracts apply. Large complete records can still exceed MCP's response
budget; export the retained Evidence when a single record cannot fit.

If decoding completes before cancellation or private-root cleanup fails, the
failure retains the completed capture as Evidence with the requested record
selection and explicit sensitivity exclusions. Earlier decode failures remain
primary. Failed cleanup stays linked to its exact owner, including through
redaction, and its live status clears only after a confirmed retry.

## Formats and upstream profiles

HAR uses `har-schema@2.0.0` draft-06 schemas, `ajv@8.20.0`,
`ajv-formats@3.0.1`, `jsonc-parser@3.3.1` JSON visitor, and
`lossless-json@4.3.1` numeric representations, pinned in the npm lockfile.
Only the HAR 1.2 profile is supported. Unknown extensions remain reported
evidence. Duplicate object keys, including equal values and escaped spellings,
are rejected before materialization. Prototype-named members such as
`__proto__` are preserved as ordinary own JSON members without prototype
mutation. Original capture files remain unchanged.
REA owns specific schema corrections because pinned upstream schemas omit
object types and use the unrecognized `min` keyword. The pinned schema also
checks `request.url` as an RFC 3986 `uri`, while HAR 1.2 defines it only as the
absolute request URL. REA additionally admits a URL that WHATWG URL
serialization reproduces unchanged, which is how browsers record and send it,
for example with an unescaped `|` or `{` in the query. Every URL the RFC 3986
check accepts stays admitted, even when WHATWG would rewrite it, such as an
uppercase host. Spellings that fail the RFC 3986 check and that WHATWG would
rewrite, such as a backslash authority, a tab or a space, still fail.
Following
[HAR 1.2](https://github.com/ahmadnassri/har-spec/blob/81adb2fcf845e81ff3de728cf6829a0e6ad63e95/versions/1.2.md#timings),
`timings` must be an object with nonnegative `send`, `wait` and `receive`;
optional `blocked`, `dns`, `connect` and `ssl` may be absent, `-1`, or
nonnegative. Entry `time` must be nonnegative; page `onContentLoad` and `onLoad`
may be absent, `-1`, or nonnegative. `cache` must be an object, while its optional
`beforeRequest` and `afterRequest` retain their specified nullable forms.
Invalid values fail with their source JSON pointer before record selection or
sensitivity projection. Measurements are not invented or repaired. Decoder
provenance names these corrections as `har-schema-corrections@1`.
The observed mitmproxy 12.2.3 `SaveHar` profile can emit `postData.text: null`
for a missing request body. REA preserves that reported null, omitting the
optional field only from its validation copy for this exact producer profile;
it does not invent an empty string or body bytes.
The observed Playwright 1.58.2 profile can report a bracketed IPv6
`serverIPAddress`, forwarded from Chromium's `remoteIPAddress` through
[Playwright's HAR tracer](https://github.com/microsoft/playwright/blob/v1.58.2/packages/playwright-core/src/server/har/harTracer.ts).
REA preserves the original spelling in reported Evidence and removes brackets
only from its validation copy, only for this declared producer and a valid IPv6
literal. Invalid addresses, bracketed IPv4, ports and zone identifiers remain
validation failures. Producer declarations do not authenticate origin.

Native mitmproxy decoding requires a caller-supplied **mitmdump 12.2.3 on
Linux**. Set its absolute executable path:

```sh
REA_MITMDUMP_COMMAND=/absolute/mitmdump rea inspect-web-network-capture /absolute/session.mitm mitmproxy --json
```

REA does not install mitmproxy. Its owned process uses a private configuration
directory, `--no-server`, and the unchanged upstream `mitmproxy.io.tnetstring`
decoder. It does not run `FlowReader` migrations or convert native states to
HAR. Raw IDs, state versions, flow types, backup states and unknown extensions
are preserved without synthesizing connections, timestamps or content. The
tested upstream source is tag `v12.2.3`, commit
`6c09d56e4c29a92f5ad01b03199977584b8ea14f`; other native tool versions return
an explicit unsupported-profile diagnostic. Non-Linux native decoding is not
supported by this adapter.

## Reading Fiddler captures (`.saz`)

Fiddler Everywhere saves traffic in **Session Archive Zip (`.saz`)** files.
Inspect native SAZ directly, without installing Fiddler or converting to HAR:

```sh
rea inspect-web-network-capture /absolute/session.saz saz --json
rea inspect-web-network-capture /absolute/session.saz saz --record 0 --json
```

MCP uses the same `capture_path`, `format: "saz"`, and optional
`record_ordinals` fields as the examples above. REA pairs `raw/<id>_c.txt`
requests, `_s.txt` responses, and `_m.xml` metadata by filename stem. Archive
member names identify the source; zero-based ordinals follow each session's
first member in ZIP directory order, not its numeric ID or capture time.

HTTP fields and ordered duplicate headers are retained, with stored body bytes
in binary sidecars. Bodies are not dechunked or decompressed. Metadata is an
XML node tree; optional `_w.txt` and `_g.txt` files retain opaque WebSocket and
gRPC message bytes. Missing members remain null, distinct from empty bodies.
A zero-byte `_c.txt` or `_s.txt` member, which Fiddler writes for a session
without that message, is also null and adds a record limitation.
See Telerik's [SAZ format reference](https://www.telerik.com/fiddler/fiddler-everywhere/documentation/knowledge-base/fiddler-archives).

## Protobuf and gRPC bodies

Selecting `record_ordinals` (CLI `--record`) also decodes retained bodies with
recognized protobuf or gRPC content types. Whole-capture inspection does not
perform this extra work. The original binary sidecar, SHA-256 and producer
ordinal remain the source; decoding adds flat body, frame and field facts.
Automatic binary Protobuf admission validates reserved MIME parameters:
`encoding` may be `binary`, while `charset` and the reserved `version` must be
absent. Illegal profiles retain the source body, add a limitation, and leave
protobuf coverage partial. Ordinary non-encoding parameters remain accepted;
an explicit framing choice interprets bytes independently of the MIME profile.
Admission follows HTTP token and quoted-string syntax: unterminated quotes and
conflicting repeated reserved parameters remain invalid. Repeated headers with
implicit binary encoding and `encoding=binary` agree without rewriting either
header. Invalid declarations remain visible even with explicit framing, and
declared gRPC bodies still receive credential checks before a MIME refusal.
An excluded HAR `mimeType` remains unknown for automatic interpretation even
when a visible Content-Type header exists. That header can still identify the
transport for credential checks; explicit wire framing remains independent.

Native gRPC admits only data-frame flags 0/1; gRPC-web additionally admits its
terminal trailer frame. `grpc-web-text` supports independently padded base64
chunks. Its offsets refer to **base64-decoded body bytes**; other offsets refer
to retained body bytes. Every field has a body-scoped `field_id` derived from
its byte offset, a `frame_index`, and a `parent_field_id` for schema-driven
nested messages or groups. Repeated field numbers remain separate occurrences.
Trailer blocks are parsed as HTTP field bytes. Valid UTF-8 values are retained;
when a field contains opaque non-UTF-8 bytes, that field is omitted and the
trailer frame is partial, while other valid trailer fields remain available.
The retained body and frame byte range preserve the original opaque value.

Without a schema, varints and fixed-width values retain exact unsigned decimal
representations. Length-delimited UTF-8, nested-message and packed readings
are candidates; REA does not choose one or invent field names or signedness.
Nested candidate ranges remain accessible without recursively expanding them.
Malformed messages retain the parsed prefix and an exact error offset.
Compressed frames and encoded HTTP bodies remain unknown; they are not
silently treated as empty messages.

For schema interpretation, supply a local compiled `FileDescriptorSet` and its
fully qualified message type. All imports must be included. REA never fetches
schemas or executes the selected application. Descriptor identity and parser
version remain in the body facts. Scalars, repeated numeric packing and nested
messages are interpreted alongside the unchanged wire facts; disagreements
remain explicit. Descriptor admission rejects duplicate field numbers within
each message, including nested messages and oneof fields, before schema
annotation. This does not reject repeated occurrences in captured wire bytes
or reuse of a number in a different message. Fully qualified message, enum,
service and extension names must also identify one declaration across the
descriptor set, including nested and synthetic map-entry messages. Different
packages or enclosing messages may reuse a local type name. Schema-admission
failures retain the partial capture Evidence and its original artifact identity.
REA also requires an unambiguous descriptor file identity. Repeated exact file
names are coalesced only when protobuf-es equality confirms matching field
presence, declared values and retained opaque unknown/custom-option fields.
Opaque fields must match in their retained order and bytes; REA does not
interpret them. Conflicting definitions are refused rather than selecting a
file by its position. This is REA's supplied-schema admission policy, separate
from protobuf wire validity and the [first-occurrence precedence in protoc v32.1](https://github.com/protocolbuffers/protobuf/blob/v32.1/src/google/protobuf/compiler/command_line_interface.cc#L1402).
The descriptor-set byte count and SHA-256 continue to identify the complete
original input, including repeated file facts.
Map semantics, extensions and required-field validation are
unsupported. A supplied schema does not establish the sender's actual schema.
An invalid nested interpretation records `schema_status: "invalid-message"`
and `schema_error` locally; later outer fields remain available. Valid string
contents, including a leading U+FEFF, are preserved. Descriptor wire failures
name `protobuf.schema.descriptor_set_path` with the wire reason and byte offset;
a missing selected type names `protobuf.schema.message_type`. Duplicate field
numbers in a message are refused before registry construction, independently of
declaration order. Resource exhaustion and cancellation keep their own outcomes
and previously admitted capture Evidence remains available.

```bash
# Compile your own schema with your existing protoc, including local imports:
protoc --include_imports --descriptor_set_out=/evidence/api.pb api.proto
rea inspect-web-network-capture /evidence/session.har har --record 3 \
  --protobuf-schema /evidence/api.pb --protobuf-message example.Response \
  --detail summary --evidence_output /evidence/session-evidence.json --json
```

MCP accepts the same choices as `protobuf: {schema: {descriptor_set_path:
"/evidence/api.pb", message_type: "example.Response"}}`, with explicit
`record_ordinals`. Optional `body_pointers` batch-select exact binary pointers;
`framing` can explicitly select `raw`, `grpc`, `grpc-web` or `grpc-web-text`
when MIME metadata is unavailable. CLI exposes `--protobuf-body-pointer` and
`--protobuf-framing`. Filters never invent bytes excluded by source redaction. Decoding an extra
base64 layer also checks explicit exclusions; newly recognized trailer
credentials exclude the entire affected binary sidecar and its reported
encoding, preserving a redaction coordinate instead of a credential digest.
Credential inspection covers every selected body before descriptor reads or
field expansion. Later capacity or schema failures can therefore retain the
sanitized source even with explicit sensitivity options. If that source pass
is interrupted, unchecked bodies are not published as partial Evidence.
Framing overrides apply only to format-owned body coordinates and preserve
exclusions for the transport declared in MIME metadata.
Explicitly excluded or conflicting MIME metadata is not treated as absent:
automatic framing leaves such a non-empty body uninterpreted, adds a record
limitation and keeps `protobuf_coverage` partial unless `framing` is selected.
Unknown or explicitly excluded HTTP coding metadata is not treated as absent:
SAZ/native bodies remain opaque until identity coding is established. Raw
header values and retained body bytes remain available in source Evidence.
Skipping wire analysis still runs the independent credential check. If HTTP
coding metadata is unavailable and that check cannot complete, the operation
returns unavailable without publishing unchecked capture bodies as Evidence.

Use `detail: "summary"`, then `inspect_analysis_view` with its retained parent:

```json
{"kind":"protobuf","collection":"bodies","offset":0,"limit":16}
{"kind":"protobuf","collection":"frames","record_ordinals":[3],"offset":0,"limit":16}
{"kind":"protobuf","collection":"fields","record_ordinals":[3],"field_numbers":[1,4],"fields":["number","schema_name","schema_value"],"offset":0,"limit":32}
```

Filters intersect; an empty filter selects nothing. Field pages also accept
`field_ids`, `frame_indices` and `schema_names`. Default field pages omit `text`,
`schema_value` and enum alias inventories; select these columns when needed. Identity, source offset
basis and body status survive column selection. Complete Evidence retains
all decoded values, and ordinary capture previews expose counts. Page exhaustion
covers retained facts only; a partial source does not establish absence.

Authenticated immutable parents reuse validation and the most recent field
filter per capture. These caches live only with retained Evidence, hold references
to existing facts and never reopen either file. Cached selector text is bounded
by retained field cardinality; larger selections use an uncached scan. Mutable
input is revalidated.
The existing 96 MiB report budget includes the original decoder reply plus
conservative charges for new facts, strings and descriptor expansion. The explicit
`protobuf_coverage` reports selected and inspected record counts, preserving
partial decoding through composed views. Capacity failure retains the source
observation as partial Evidence; cancellation yields
between bounded work batches. Real elapsed time and process-family memory
still depend on the selected capture and schema.

## Fiddler Everywhere MCP and public skills

For agent-driven traffic debugging, connect Everywhere's MCP server separately
from REA. Run a current Everywhere release with MCP access (Trial, Pro, or
higher), internet access, and a compatible MCP client. Use
**Settings > MCP Server > Coding agent**, or **Manual setup** with the generated
API key. The default endpoint is `http://localhost:8868/mcp`. See Telerik's
[MCP setup guide](https://www.telerik.com/fiddler/fiddler-everywhere/documentation/agent-tools/fiddler-mcp-server)
and [agent-skills prerequisites](https://www.telerik.com/fiddler/fiddler-everywhere/documentation/agent-tools/agent-skills).

Telerik's [public skills](https://github.com/telerik/fiddler-agent-tools) cover
installation (`fiddler-download-setup`), connection setup, and traffic analysis:

```sh
npx skills add telerik/fiddler-agent-tools --skill fiddler-mcp-setup
npx skills add telerik/fiddler-agent-tools --skill fiddler-traffic-debugging
```

After setup, reload the agent client and use the connected server's advertised
tool names and schemas. Check status, list sessions, then inspect relevant
session IDs. Set `sessionsSource` to `LiveTraffic` for HTTP(S) traffic or
`AgentCalls` for enriched LLM calls; active filters affect the session list.
For an existing run, skip the skill's pre-capture steps that replace process
filters and clear sessions. The documented MCP session sources do not provide
a saved-snapshot selector; use the SAZ workflow above for saved files. REA does
not register or wrap the Fiddler MCP server.

## Reading the evidence

- `artifact` identifies the caller-selected file and stable snapshot digest.
- `records` preserve producer order/ordinals and original JSON pointers, byte
  ranges, or SAZ member names. No live browser transaction or scenario IDs are invented.
- `reported` retains the producer's fields. HAR container metadata is returned
  separately, with `log.entries` replaced by `null` and `records_pointer`
  identifying the record collection. This is an inspection representation,
  not a reconstructed HAR file.
- `numeric_literals` preserve HAR number lexemes and native integer/float
  representations, including unsafe integers and non-finite native floats.
  Values that cannot be safely represented as JSON numbers are `null` in the
  reported view. Schema-valid HAR numbers are admitted even when they cannot
  be published safely as JSON numbers; their exact lexemes remain in
  `numeric_literals`. Standard numeric fields must still satisfy the pinned
  schema, including integer requirements judged from the numeric lexeme.
- `binary_fields` retain exposed bytes, base64 and SHA-256 independently of
  declared sizes. Valid HAR `content.encoding: "base64"` is decoded exactly;
  producer-decoded Unicode text, missing text and unknown encodings do not
  establish original body bytes. Response readers expose decoded text only when
  `encoding` is absent or supported base64 bytes decode as UTF-8. Other declared
  encodings remain opaque: original text and encoding stay in Evidence, while
  replay and state extraction treat the decoded body as unavailable. A redacted
  encoding declaration does not establish plain text. See the
  [HAR content representation](https://github.com/ahmadnassri/har-spec/blob/81adb2fcf845e81ff3de728cf6829a0e6ad63e95/versions/1.2.md#content).
  Post-data parameters do not reconstruct a
  multipart body. Native byte fields also have an exact UTF-8 display view
  when valid; binary sidecars establish their actual representation. Native
  missing content and empty content remain distinct.
- `redactions` identify known transport authentication exclusions and explicit
  sensitive-value exclusions. Redacted byte fields retain neither original
  bytes nor their digest. Unknown extension names and token-looking query
  parameters do not establish sensitivity.
  HAR authentication fields, transport URLs and base64 content are interpreted
  only inside `log.entries`. Similarly named unknown fields in the document
  container remain opaque evidence; explicit sensitive-value declarations still
  apply to both scopes.

Mark sensitive literal string/UTF-8 byte values with MCP `sensitive_values`, or
repeat CLI `--sensitive-value`. These declarations are never persisted in
Evidence parameters; the count is retained. Explicit text/UTF-8 byte matches
exclude the entire field with a reported `null` rather than substitute a text
marker or rewrite payload bytes. This prevents replacement markers from
reintroducing declared literals. The file digest identifies the original artifact
unless it matches an explicit declaration; in that case `artifact.sha256` and
Evidence `subject` are null with an explanation. A sensitive property name excludes that
entire property and its sidecars; a `scope: "property-name"` redaction points
to its actual parent. No substitute property name or child pointer is invented.
Omitted subtrees are still validated, including canonical HAR base64. Explicitly sensitive artifact
paths are empty in Evidence and omitted from locations, while the original
SHA-256 and size remain available unless the digest itself is explicitly excluded. Failure messages, diagnostics and cleanup
resources follow the same explicit declarations without changing error types;
sensitive issue pointers identify a real ancestor instead of a fabricated
coordinate. Header/cookie authentication values and known
transport URL userinfo are excluded structurally, including native backups.
HAR redaction and API-surface projection share the same recorded-URL parser.
Canonical userinfo spans are removed without rewriting the remaining source
text. Credential-bearing spellings without a safe raw span, such as slashless
or extra-slash HTTP URLs, are excluded as a whole transport field. Ordinary
extension text and noncredential path/query values remain unchanged.

Generated free-text limitations follow the same literal declarations, including
global, per-record and Evidence explanations added during projection. Contract
field names, typed discriminators and exact decoder identities keep their
canonical meanings; declarations do not rename formats or providers.

Historical evidence does not prove runtime attribution, execution or deployment
authenticity. Mitmproxy messages are upstream-assembled messages, not recovered
wire fragments. Native dictionary duplicate keys have the unchanged upstream
decoder's last-value semantics; this adapter does not claim to recover discarded
duplicates or the original numeric spelling of parsed native floats.

## Derived API surface

Pass retained HAR Evidence to `inspect_analysis_view` with
`view: {"kind":"api-surface","offset":0,"limit":50}`. Omitted offset and limit
are 0 and 50. The view groups request lines by method, WHATWG URL origin and
path template, sorted by origin, template and method. Query strings, fragments,
credentials, headers and bodies are not copied into groups.

Select `include_query_parameter_names: true` in the view to include distinct
observed query names per group. The default and explicit `false` omit the
`query_parameter_names` field. Selected groups include an array of
`{name, record_ordinals}` entries, sorted by Unicode code point; each name's
ordinals follow the parent's selected record order and occur once per record.
For `/products?category=books&page=1` and
`/products?category=games&sort=price`, names are `category`, `page` and `sort`.
Query values and fragments are not copied into this inventory.

Names use WHATWG `URLSearchParams` form-query decoding: literal `+` becomes
space, `%2B` becomes `+`, percent escapes decode as UTF-8, and empty names are
retained. Empty query pairs are ignored. Original URLs stay in parent Evidence;
name decoding does not normalize the recorded paths used for grouping.
The inventory describes observed names, without inferring required parameters,
value types or a complete API schema. Sensitive-parent refusals still apply.

| Rule       | Exact segment format                                 | Placeholder  |
| ---------- | ---------------------------------------------------- | ------------ |
| `numeric`  | ASCII digits only                                    | `{numeric}`  |
| `uuid`     | RFC 9562 textual UUID, any version, case-insensitive | `{uuid}`     |
| `hex`      | At least 32 hexadecimal digits                       | `{hex}`      |
| `iso-date` | Valid calendar date `YYYY-MM-DD`                     | `{iso-date}` |

Rules apply in table order to the recorded, still-encoded request path, read
before WHATWG dot-segment removal, so `/a/%2e%2e/admin` and `/admin` stay distinct. Segment indexes start
at zero after the leading slash. Each matched segment lists its observed literals
and `basis: "inferred"`. `templated_groups` counts templated groups across every
page. Because paging follows the full grouping, every page is inferred Evidence
when that count is nonzero, and derived Evidence only when no group was templated. Version prefixes, short opaque IDs
and digit-bearing route names stay literal. Samples merge only when method,
origin, and exact segment rules match. The view does not infer further
cross-sample patterns.

Groups cite parent record ordinals and distinct statuses and MIME types (lowercase
type/subtype without parameters). An invalid type/subtype essence is unknown;
parameters do not affect this projection. Flags report single samples, mixed
statuses or mixed content types.
`coverage` pages groups; `records` separately reports examined, total and excluded
parent records. Ordinal subsets carry a limitation. Null URLs are excluded as
`url-redacted`; unparseable URLs, URLs without an origin, spellings without
`scheme://authority` (such as `https:host/path`), and authorities containing a
tab or newline as `url-unparseable`.
Unavailable request objects or methods are explicitly excluded. Unavailable
response fields, including HAR's `status: 0` and an empty `mimeType`, remain
unknown, not invented statuses or MIME types.

The view makes no handler-identity, schema or causality claim. It performs no
network activity. Native mitmproxy, SAZ and qlog captures return a typed unsupported error.
Parents inspected with `sensitive_values`, or whose Evidence does not record
`sensitive_value_count`, return a typed unsupported error whose reason is the
canonical token `sensitive_values_unretained`. The view would write path
templates and limitation text that it cannot check against declarations the
parent does not retain, so the refusal does not repeat declaration text.

One accumulator owns group identity, observed-value/status/MIME sets, ordinals,
exclusions and deduplicated limitations. It scans path spans without splitting
literal paths into arrays. Before schema parsing, it reserves the capture clone
and validation scratch by walking the parent without cloning it. Inline requests
borrow the Evidence value through CLI/MCP envelope validation; the application
admits the entire portable envelope before authenticated parsing or hashing. An
`evidence-file` source is read and authenticated first and then admitted like
retained Evidence, so its strings are not charged as inline envelope text: a
capture too large to project inline can be projected from its file. Before
authentication REA checks that live heap headroom holds its copies of the parsed
Evidence, and over MCP the read follows the request's cancellation.
An invalid Evidence file returns `EvidenceFileError` with the selected `path`
and `content_issues` relative to the file's JSON root; those locations do not
refer to the request's `source.path` string.
The envelope clone, hash scratch and capture clone stay charged during grouping.
Temporary URL/path/MIME/query work and retained state must
fit together within a 96 MiB projection representation budget. A whole group or
merge is admitted before allocating its retained sets, map entries or array
values. Fixed group storage, distinct text, exclusions and limitations count as
well as matched segments. Per-record reservations are released after each
record; repeated values do not accumulate another retained charge. Only the
requested page is materialized as output groups.
Opt-in query projection reserves parser tuples and the per-record name set
before decoding, then admits distinct retained names and source ordinals before
changing a group. Repeated names within a request retain that ordinal once.

The representation budget uses conservative storage and worst-case JSON-escaping
allowances; it is not an enforced V8 heap or process-memory limit. It is separate
from the decoder's actual reply-byte limit and MCP transport admission. Exceeding
it returns `resource_constraint` without a partial view. Limitations on the
parent envelope, capture and examined records are deduplicated onto the view.
Portable captures must retain unique ordinals within their declared total;
caller-selected subsets can preserve any requested ordinal order.

## Environment manifest

Pass retained HAR Evidence to `inspect_analysis_view` with
`view: {"kind":"environment-manifest"}` to project one application's recorded
request lines into a replayable tool surface: the environment manifest that an
agent environment later serves from retained Evidence. The view reuses the
api-surface grouping, then keeps the groups on the primary origin, the origin
with the most JSON-like records (`application/json`, `application/*+json`,
`text/plain`, `text/markdown`), whose path starts with `/api/` or `/apis/` or
whose content types are JSON-like, and the write groups answered with no body
(a bodiless `204 DELETE`). Empty retained response text establishes a bodiless
write only when its encoding is understood and unredacted; an opaque or hidden
encoding leaves the body unknown. Every other group is listed under
`excluded` with reason `other-origin`, `ui-page-or-asset` or `non-json`, and
retained records without a usable request line are counted in a limitation.

The parent may instead be `capture_browser_scenario` Evidence whose scenario
selected response bodies or header values: each network transaction is then
one record, in request order, and the result names
`parent_operation: "capture_browser_scenario"` with an empty `artifact`, since
a scenario records no file. See
[agent environments](agent-environments.md#from-a-browser-scenario).

```json
{
  "name": "inspect_analysis_view",
  "arguments": {
    "source": { "kind": "retained-evidence", "evidence_id": "ev_..." },
    "view": {
      "kind": "environment-manifest",
      "template_rules": [
        "after-uid-literal",
        "opaque-token",
        "sibling-variance"
      ],
      "include_query_parameter_names": true
    }
  }
}
```

`origin` and `name` identify the environment; the name is the kebab-case
primary host with dots and ports replaced by hyphens, `grafana-example` for
`http://grafana.example`. Each tool carries a deterministic `name`, `method`,
`path_template`, `api_surface_template` (the four-rule template of its
earliest record), `params`, `query_parameter_names`, `body_shape`,
`statuses`, `content_types` and `record_ordinals`. `records` lists one pointer
`{ordinal, method, path, status, content_type}` per record a tool cites and
never a header, cookie or body. Tools sort by template then method.

Without `template_rules`, every `path_template` equals the api-surface
template and `params` carry the four format rules with names `id`, `uuid`,
`hash` and `date`; a repeated name gets a numeric suffix. Opt-in rules apply
only when listed, each at most once (a repeated rule is an `invalid_request`),
in this order:

| Rule                    | Applies to                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Parameter                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `after-uid-literal`     | The literal segment right after a literal `uid`, unless it is a stop word                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `uid`                                                   |
| `opaque-token`          | A lowercase alphanumeric segment of twelve or more characters mixing letters and digits that is not a `v1`-style version                                                                                                                                                                                                                                                                                                                                                                                                                | `uid`                                                   |
| `sibling-pair-variance` | Groups equal in method, origin and segment count that differ in two adjacent literals right after a plural literal at index 2 or later and followed by a literal, with at least three distinct pairs and both positions varying (`/repos/{owner}/{repo}/issues`); stop words and `v1`-style versions never qualify                                                                                                                                                                                                                      | singular plural literal plus `_namespace`, then `_name` |
| `sibling-variance`      | Groups equal in method, origin and segment count that differ in one literal at index 2 or later; the siblings whose literal is identifier-like (a digit or `:`, or three or more hyphenated names under a plural literal) merge, never a stop word, and the other literals stay their own tools                                                                                                                                                                                                                                         | singular previous literal plus `_id`, else `id`         |
| `prefix-variance`       | A literal at a position that another tool, of any method or segment count, templates by one of the rules above after the same preceding segments, when the literal is one of that parameter's observed values, carries a digit and has the length and character classes (digits, lower case, upper case, each other character) of one, or has the single length of eight or more characters every observed value has and only their character classes; stop words and `v1`-style versions never qualify, and tools that now match merge | the name of the parameter it shares                     |

With `sibling-variance` selected, literal siblings within its comparison scope
fold into existing opt-in parameters as observed values unless they are stop words.
For example, select both `opaque-token` and `sibling-variance` so
`/api/folders/{uid}` lists `general` beside the recorded token. With only
`opaque-token`, `/api/folders/general` stays a separate literal tool.
A position templated by one of the four format rules
absorbs no literal, so `/api/teams/{numeric}` keeps its exact-format meaning
and `/api/teams/search` stays its own tool. Opt-in placeholders use the
parameter name; format-rule placeholders keep their api-surface spelling. Tool names are
`<method>_<literals>` with `api`, `apis`, `namespaces`, `default`, `v`-prefixed
version tokens and a `uid` literal before a parameter dropped, dotted literals
cut to their first label, `_by_<params>` appended when parameters exist,
sanitized to `[a-z0-9_]`, at most 60 characters and made unique with numeric
suffixes: `get_dashboards_by_uid`, `get_plugins_settings_by_plugin_id`.

`prefix-variance` runs last so it can share the parameters the other rules
produce: with `sibling-variance`, a `PATCH` or `DELETE` of the one entity a
session edited, `/api/v1/collections/0RZ576QZQA5KG`, becomes
`/api/v1/collections/{collection_id}` beside the reads that varied there, and
so do deeper routes such as `/api/v1/collections/{collection_id}/books`. Its
parameter is labelled `prefix-variance`, unless a merged tool templated the
position by its own rule. When parameters of different rules share a position,
a literal shares the one that observed it, else the earliest one it is spelled
like.

`sibling-variance`, `sibling-pair-variance` and `prefix-variance` compare routes of at most 32 segments; longer routes keep
their grouped templates and the manifest says so in a limitation. `body_shape`
is derived for `POST`, `PUT` and `PATCH` from the tool's earliest record when it
carries an `application/json` or `application/*+json` request body: top-level
keys and their JSON type names, never values and never nested structure; a body
on a later record adds nothing. `unknowns` always states three facts: the authorization model, response
semantics and state transitions are not established by a capture.
`templated_groups` counts tools and excluded groups with a templated segment;
whenever it is nonzero the Evidence is inferred, otherwise derived. The view
performs no network activity and replays nothing. Native mitmproxy, SAZ and
qlog captures, and parents inspected with `sensitive_values`, return the same
typed unsupported errors as the api-surface view, including the canonical
token `sensitive_values_unretained`. A `capture_browser_scenario` parent is not
refused for declaring secrets: the capture redacted them as it recorded, a
transaction whose URL was redacted is left unrepresented, and a response body
keeps the capture's redaction markers, which a manifest limitation counts.

The manifest accumulator shares the api-surface admission model: the capture
clone, the inline envelope (for an inline source), record pointers, groups, every route part, observed
values, query names and body-shape keys are admitted before allocation, and each
recorded body is charged as temporary bytes before it is parsed. Retained state and
temporary work must fit together within the 96 MiB projection representation
budget; exceeding it returns `resource_constraint` without a partial manifest.
Name a large capture with `{"kind": "evidence-file", "path": "/abs/capture.json"}`
rather than inline: response bodies the manifest never reads are then charged
once per value in the capture clone, not per character. A
`capture_browser_scenario` parent is also charged, before validation, for
checking its largest body and for the decoded text of its request bodies.

## Environment state

Pass the same parent to `inspect_analysis_view` with
`view: {"kind":"environment-state"}` to extract the initial state the
capture's reads observed, and a render plan per read tool that reproduces those
reads from it. Where the environment manifest names an application's tools, the
state holds its data: entities by type and identity, plus documents for reads
that are not entities. Use the `template_rules` of the manifest the state
accompanies so tool names match; the view groups records the same way.

```json
{
  "name": "inspect_analysis_view",
  "arguments": {
    "source": { "kind": "retained-evidence", "evidence_id": "ev_..." },
    "view": {
      "kind": "environment-state",
      "template_rules": [
        "after-uid-literal",
        "opaque-token",
        "sibling-variance"
      ]
    }
  }
}
```

Records on the primary origin are ordered by recorded start time, or by record
order when any start time is missing (`timeline`), as for a
`capture_browser_scenario` parent. A `POST`, `PUT`, `PATCH` or `DELETE` with a
2xx or 3xx status, or no status, may change state, unless it is a `POST` whose
path has a segment such as `search`, `query`, `list`, `find`, `fuzzy`,
`count` or `stats`, which queries state instead. A type's state comes from its
successful reads that finished before the first such write under the same root:
the path's API base (the literal segments every tool sharing its first segment
has), any `v1`-style version segments, then one more segment. A read that
overlaps that write in time is left out. A write whose URL a scenario redacted
has an unknown target, so it ends the state of every type, and a limitation
counts such writes. Values from a `capture_browser_scenario` parent keep the
capture's redaction markers in place of declared secrets; the state is not
refused for them, as the manifest is not.

Each `GET` tool whose template ends in a parameter is an item tool, and its
type's `collection_template` is the template without that parameter; any other
`GET` tool is a list tool of its own template. Interior empty segments remain
meaningful: `/api/books` and `/api//books` name distinct collections. A single
trailing slash names the same collection. An item tool proves its type's
`id_field` when every initial response carries the requested path value in the
same field of one entity object (`id_basis: "path-parameter"`). The object is
the response itself or one wrapper member; failing both, it is the only element
of a one-element array at the root (pointer `/0`) or in one member
(`/<member>/0`), as in `{"posts":[{...}]}` or `{"data":[{...}]}`, provided one
of the identity names below repeats the value, since a filtered list may also
answer with one element that repeats its parent's value. Otherwise the field is
the first of `id`, `uid`, `uuid`, `_id`, `ID`, `UID`, `Id`, `guid`, `key`,
`slug` and `name` that every listed item carries as a distinct string or
number; when none does, it is the first key of the first listed item, in its
order, whose name ends in `Id` or `_id` (such as `orgId` or `user_id`), that
every item carries as a distinct string or number, and that at least one
initial response shows distinct across two or more items
(`id_basis: "field-name"`). A single listed item is distinct from nothing, and
its suffix-named fields are often foreign keys, so a list that only ever held
one item is left to a document. Empty initial lists constrain no field. A list
is the response array, or the one array of objects in an envelope that is not
itself an entity, preferring an array whose items an identity name identifies,
then an array of two or more items a suffix-named field identifies.

`entities` merge every initial observation of one identity within one
collection path: an item view's latest values win over a list view's, a view
whose latest values differ keeps them in `view_fields`, and a field whose value
changed between one tool's observations with no recorded write between is named
in the type's `volatile_fields`, keeping the latest value. A value that changed
across a write under another root may be that write's effect, so the type's
initial reads end at the earliest write within the change, reads that overlap
it are left out, and the state is extracted again once; the same holds for a
value one tool read before a write and another tool read after it, and for
repeated reads of one full request line whose list membership changes across a
write, including transitions to or from an empty list, or whose entity fields
are added or removed. A type whose reads still disagree keeps every tool a
recorded view with reason `fields-differ`. Different query strings remain distinct request lines. Sparse responses do not erase the last observation of a field supplied by another request line. Entities are ordered
by type and collection, and within a collection as the first line that lists
every entity any initial read shows in it and names no sort, direction or
random parameter (`random`, `rand`, `shuffle`, `seed`) lists them; a collection
without such a line keeps its entities' earliest sightings. That order is a
list's state order.
Every entity cites its `record_ordinals`.

`views` lists one plan per read tool in tool order:

| Shape      | Plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `item`     | The entity object at `pointer` (the root, one member, or `/0` or `/<member>/0`), the ordered `fields` the view shows and the `required_fields` every recording had (the fields include those only reads after the type's first write show, of entities that hold its identity, when no initial entity holds them, as Vikunja adds `subscription` to the tasks it creates; they are never required), and `envelope_ordinal`: the recording whose response, with the entity replaced, every item response shares, leaving out the `per_response_members` each response there mints: a top-level UUID or clock that differed on every repeat of every concrete path the view answers, with no write between, and never stayed the same on a repeat elsewhere; list views name theirs too                                                                                                                                                                                                                                                                                                                                                                         |
| `list`     | The array at `pointer`, its `fields`, `membership` (`all`: every entity of the collection in state order, when each recording listed exactly that, had no query or only paging parameters (`limit`, `offset`, `page`, `per_page`, `perpage`, `page_size`, `pagesize`, `maxsize`, `max_results`, `maxresults`, `size`, `start`, `_start`, `_end`, ignoring case), no item-total member (`total`, `count`, `totalCount`, `item_count`, `totalcount`, `itemcount`, `numberOfElements`, but not `total_pages` or `per_page`; a number or a string of digits; top-level, or in a top-level object beside the list such as `pageInfo.totalRows`) differing from the number listed, and no `has_more`, `next` or next-page token member set; `recorded`: the entities each recording listed, except on the lines `all_record_ordinals` names, which each meet those conditions on their own and list every entity), `counters` that equal the number listed, and `listed_ids`: top-level members that list two or more listed entities' identity values in list order (Paperless's `all`), which a rendered list sets to its own unless it is a page of more matches |
| `document` | The latest initial value of a list tool whose responses hold no identified list, when its initial reads share one request line; held in `documents` with that `path`, whether or not the capture writes it, unless its value changed across any recorded write between those reads (`fields-differ`); its `per_response_members` are the members of the value each response on that path mints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `recorded` | A `reason` the tool replays its recordings instead                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

An item or list plan is kept only when it reproduces the latest initial
recording of each request line from the state, comparing JSON values without
regard to member order; a volatile field compares its recorded value. Each
plan lists the `checked_record_ordinals`. A request line that shows the
entities in another representation (an expanding or reducing query, or one
asking for some fields only) is left out of those checks when a query key tells
it from the others: the plan lists its latest recordings in
`projected_record_ordinals` and the keys in `projected_query_keys` (`name`,
with a `value` or `absent: true`), and serving replays calls matching them and
calls asking for fields the checked lines do not show.
Otherwise the tool is a recorded view
with reason `envelope-varies`, `fields-differ` or `list-differs`; the other
reasons are `query-body` (a query `POST`, or one the capture shows only reading),
`method-replay` (a safe `HEAD`, `OPTIONS` or `TRACE` call), `no-init-recording`,
`body-unusable`, `no-identity` (an item read without a proved identity),
`path-varies` (another read under more than one path, as a template with a
parameter before its end), `query-varies` (another read of one path under
more than one query) and `rendered-oversize` (a document value whose JSON
renders to more than 256 KiB). A document holds the value of its one `path`, so for such
a template it says nothing about the template's other paths. A body is usable
when its content type is
JSON-like, it is UTF-8 text of at most 256 KiB, and every number survives native
conversion exactly. JSON member names, including `__proto__`, remain ordinary
own data members through extraction and serving.

A list view also learns, from its checked lines that do not list the whole
collection, what each query parameter does, and names the result in `query`.
Each such line is explained by the first combination of roles that lists
exactly what it recorded from the collection's initial entities:

| Role        | Parameter                                                                                                                                                                                                                                                                | Effect                                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filter`    | any other, on a `field` every listed item holds the value in; one not named like the field (`shelf`, or `shelf_id`, for `shelf`) stands only when lines giving it two different values agree on it                                                                       | entities whose field equals the value as text, or whose array field holds it directly or as an object's `id`, `slug` or `name`                                                                                                                       |
| `search`    | `q`, `query`, `search`, `searchTerm`, `term`, `keyword`(s)                                                                                                                                                                                                               | entities with one of `fields` containing the value, ignoring case; the fields are those it matched in the listed items, URLs only where nothing else matched; a term that matched no field leaves the parameter inert until another line's term does |
| `sort`      | a name asking for an order in any common spelling: `sort`, `_sort`, `sort[]`, `sort[0][field]`, `sorters[...]`, `sortBy`, `sort-column`, `sortKey`, `order`, `orderBy`, `ordering`                                                                                       | ordered by the field the value names (`name`, `-name`, `name:desc`, `name-ASC`): numbers by value, text ignoring case, null last ascending, ties in state order                                                                                      |
| `direction` | a direction name (`dir`, `direction`, `sortDir`, `sortOrder`, `sortDirection`, `order_direction`, json-server's `_order`, and `order`) given `asc`, `desc`, `ascending` or `descending`; given anything else, `order` is a `sort` and the others are ordinary parameters | the sort's direction                                                                                                                                                                                                                                 |
| `limit`     | `limit`, `per_page`, `perPage`, `page_size`, `size`, `count`, `take`, `itemsPerPage`, `maxSize`, `max_results`, `maxResults`                                                                                                                                             | page size; zero or a negative value lists every match                                                                                                                                                                                                |
| `offset`    | `offset`, `start`, `_start`, `skip`                                                                                                                                                                                                                                      | matches skipped before the page                                                                                                                                                                                                                      |
| `page`      | `page`                                                                                                                                                                                                                                                                   | page number, counted from `first` (1 or 0, whichever explains the line)                                                                                                                                                                              |
| `inert`     | any that names no order or direction; never a true `reverse`, or a paging value that is not a safe integer                                                                                                                                                               | changes nothing for its recorded `values`; other values are not computed                                                                                                                                                                             |

No two parameters of one call take the same `sort`, `direction` or paging role,
and a line with more than 12 query parameters is left unexplained. Lines that
disagree on a parameter's role drop it, inert values gather and search fields
unite. `query.record_ordinals` are the lines the merged roles
reproduce, envelope and fields included, and `query.totals` the envelope
members that count every match before paging on each of them, top-level or one
level down in a paging object (`/pageInfo/totalRows`); a `number`-of-items
member counts the page. The roles are inferences from the
recorded lines; a line they do not reproduce keeps its recorded members.

`writes` lists one plan per tool whose request may change state, in tool
order. Its `effect` is `create` for a `POST` to a type's
`collection_template`, `update` for a `PUT`, `PATCH` or `POST` to that template
plus one trailing parameter, or to that item path plus one action segment,
`delete` for a `DELETE` to it, `document` for a `PUT`, `PATCH` or `POST` to a
document's path, an `update` or `delete` of each entity a write at the
collection names by id in its body, a `create` for a `POST` whose answer names
an id (at its top level, in an object member or in the one object of a
one-element array member) that a later item read of a type first shows (served
only with the path values its recorded call sent, unless it creates into the
type's own collection, whose path has no parameters, and a `path` rule stores
each of its path values), and otherwise `none` with reason `no-state-target`. A plan is built from the tool's first successful call: its
request body must be a usable JSON object (as response bodies are usable), or
absent for an item action (a scenario request is absent when Playwright exposed
no body and it names no `Content-Type`, which the bodies browsers send carry), and
the written entity must show in that call's response or in a later read before
the next write. Each field of a created entity gets the first rule that
explains it: generated `identity` (a sequence, UUID or token, by the recorded
value's shape), `echo` of a body member (`sorted` when the application stored
its strings in code-point order rather than as sent), `copy` of a body string of
8 or more characters, a `path` value, a `slug` of a body member, a `clock` value within 10
minutes of the request in its recorded format, a `sequence` one past the
largest value of its collection or type, and never below its `start`, a `unique` UUID, opaque token or
integer of 10 or more digits that no entity of the type holds (where every one
holds a distinct integer of the same length, as time-based ids do), a
`nested-clock` object whose clocks the request stamped, a `made-object` no
other entity of the type holds otherwise, whose `clocks` the request stamped and
whose other members hold the entity's own identity (`own`), one past the largest
value held objects show (`counts`, each from a `start`), or what every held
object shows, a `template` around
a generated value, a `reference` to an entity, or a `composed` string; other
fields keep the observed value. When the first read of a created entity before
the next write shows fields the create's answer lacks, its clocks to another
precision, or values the answer had not loaded (an empty, zero or `false` value,
Go's zero time, or an object whose members are each loaded so), the observed
entity takes them (`observation.read`, whose `unloaded` points to the values the
answer had not loaded). An item read
that agrees with the answer otherwise lends its fields and clock spellings and
no longer confirms the create; one that disagrees or omits an answer field its
item view renders still checks it. Clock agreement uses the coarser recorded
precision, including microseconds. A list read
only adds fields the answer lacks and still checks it. Serving answers a create
in its answer's shape and clock precision, with empty lists and maps the call
did not send spelled (`null`, `[]` or `{}`) as its answer spelled them and the
values it had not loaded as it answered them (unless the call sent one the plan
stores as sent), leaving out members the read added inside an object the answer
showed, and stores the fields of both,
as the item read-back shows them, with its clock precision. Updates
answer empty lists and maps they did not send as their answers spelled them
too; a member a call sent is answered as sent. An update or delete that answers
with the entity leaves out a field only later reads showed, which no initial
entity holds, when the entity does not hold it, as Vikunja's reads of tasks it
did not create show no `subscription`. A `reference` is an object
holding fields of the
entity a sent member names, as the state holds it (a parent beside `parentId`),
or a list of them, one per id a sent list names, in its order (`many`, tags
beside `tagIds`):
the member is accepted with any value, serving looks the entity up and refuses a
call naming one the environment does not hold or holds in more than one
collection, and the field is absent, from the entity and the create's answer,
when the call does not send the member. An id naming entities of one type in
several collections teaches no reference. Each later create widens its plan
when, explained on its own, it agrees with it: both calls show the same fields
but for a reference whose member a call without it did not send, or sent as
`null` or `[]` and stored so (one an earlier create added stays, and a call may
send the member empty as that create did; one leaving it out stores no such field
when the create the plan observes showed none), every field both rule they rule alike (an echo one showed
sorted stays sorted, unless a call stored its strings out of order as sent),
and a field neither rules holds one value, unless the later call's rule for it
spells the earlier calls' value too: a `composed` or `template` string, or a
`sequence` started at that value (`start`), as Vikunja numbers a project's tasks
past those deleted before the capture. Two `made-object` rules agree in their
clocks and own members, and a count only the later call shows starts at the
first object's value; a later create's made object must hold clocks its own
request stamped, in the rule's format. Members either call sent are accepted, only those every call sent are
required, and an echoed member a call left out takes the value that call stored
(`body.defaults`). A member one call sent and stored as sent, and another left
out and the application numbered one past the others, takes the value a call
sends, else that number (a `sequence` with `sent`), whichever call came first,
unless a call that left it out stored a fixed value (its `body.defaults`) or
the number a later call was given is not above every value an earlier create
sent in the sequence's scope (the type, or the later call's collection); an empty value a call sent is not applied to a call that leaves it out;
a later call that sends it must have stored what it sent, and the next number
follows the largest value any call took, a deleted entity's included. A member a create sent empty (`""`, `null`, `false`, `[]` or
`{}`), as a form sends a field left as it was, is not required: a call that
leaves it out is applied as sending that value (`body.blank`), unless a call
that left it out showed a default, which it then keeps. A call may send it as any
recorded call sent it empty, even after a default is learned, and one leaving it
out is applied as the earliest did, as when one create sent `false` and another
`null`. A clock rule widens to `trimmed` only when no held entity or
earlier call showed that clock at a fixed width, and a slug to spelling `&` as
the word (`ampersand: "and"`) only when no call the plan accepted nor entity the
type held dropped one. A later
create that disagrees leaves the plan as it was. A field the first create left
unexplained, such as an address whose two parts were the same text, takes the
`composed` rule a later create learns for it when that rule spells the first
create's value too, and the first create's body contract is learned again with
it. A `composed` string or `template` a later create's answer shows otherwise
or leaves out is `unexplained-change`. A create whose observed reference
differs from the
entity the plan rebuilds, whether or not it sent the reference member, is
`unexplained-change`. So is a create that left out an echoed member yet shows a
value different from the learned default, or that stored a field no rule writes
otherwise than the plan keeps it.
A `composed` string is literal text and parts read from the fields other rules
write: a field's value, its slug, or a clock's calendar digits
(`YYYYMMDDhhmmss`, `YYYYMMDD`, `YYYY-MM-DD` or `YYYY/MM/DD`, in the clock's
zone). A slug drops `&` unless the application spells it as the word, as Go's
gosimple/slug and JavaScript's slugify do (`ampersand: "and"`, on a `slug` rule
or part). When a create slugs no `&`, the entities the type holds show which,
and no `slug` rule is learned when they spell it both ways; a create whose slug
spells `&` otherwise than they do, or alongside one whose
slug neither spelling gives, has no `slug` rule; such a held slug also keeps a
later create from widening the spelling. An update learns the spelling the same way: a later update whose slug spells
`&` as the word refines a rule an earlier update learned from a name without
`&`, unless an accepted call or a held entity dropped it, and every earlier
update must still replay. An update whose slug spells no `&` takes the spelling the
entity's earlier value and the type's other entities show, as a create does,
and learns no slug rule when they spell it both ways. A create composes a string only when at least one other entity of the
type spells it with the same parts and none spells it otherwise. Where one text
could come from two sources serving could tell apart, such as an id that equals
the title's slug, the entities the type holds must leave exactly one reading. A
`composed` string that reads a field besides the generated value a `template`
would rebuild it around replaces the template. A clock format
is `trimmed` when the field's values differ only in how many fraction digits
they show and none ends a fraction in a zero, as Go spells nanoseconds: its
`fraction` is the most it shows, and serving drops trailing zeros and the point
with them. Other clocks the plan stamps take that spelling too unless their own
value shows a fixed width. A body that wraps one
object in a one-element array is that object, wrapped so on every call
(`body.envelope`). An update's members
echo when stored as sent. A clock sent back as the entity held it and stored as
a fresh clock near the call is a `clock`, and a member stored as the slug of
another member stored as sent is a `slug`, both accepted with any value, as a
whole-object write that sends what it read shows. A save that echoes an
already-derived slug or holds a clock in its own second remains compatible
with that derivation in either call order; earlier saves must also reproduce
a newly learned slug. Any other member stored
differently is accepted only with its
recorded value (`body.fixed`) and stores the value the call that showed it
recorded (the `value` of its `constant` rule), and a field it changed without
sending (an empty list or map one answer spells `null` and another `[]` or `{}`
is unchanged) must be a clock, a nested clock, an increment, a slug, a fresh `unique`
value, a `stamp` of the acting user, a value `derived` from the one member it
stores nowhere, a `reference` to the entity a sent member names (kept by a call that names the entity the field already repeats), a `composed` string whose parts read members it stored as sent
or fields it left as they were and spell the value before the call too, or for
an item action a `set` of a scalar to the value it showed (a `toggle` once a
later call flips back the boolean an earlier one set, when no call found it set
already), or, for a `PUT`, a
member it left out that the application cleared to an empty value, which calls
that leave it out then store (`body.defaults`) as long as every call that left
it out stored that value (a call naming a `reference` field's entity by its
member does not leave the field out), or the plan is
`unexplained-change`; an increment, slug, stamp, derived
value, set or toggle must hold for every call of the tool, and an action is
served only once a call found what it sets already set, or flipped back what it
toggles. A write is served only
with the query its first call sent, which serving applies to a call that
leaves a parameter out and the catalog advertises as required. Every member every call sent is required, except by `PATCH` and
`POST` updates and members a create sent empty. The state holds an update's
clock as the first read of the entity after it spells the same instant at a
coarser precision in the same zone and separator: replay and serving store every
update's clocks in the spelling of the read the plan keeps as
`observation.read`, so a later update whose read spells them otherwise
contradicts the plan, while answers keep the update's own; a create's clocks
stay as answered. A `PUT` default must agree with what every call that left the
member out stored, as its answer shows it or, where the answer leaves it out,
the read after the call.

A read on a line `query` answers is checked against the query evaluated over
the replayed state. It covers the collection only when every parameter sorts or
pages and the answer holds every match; otherwise it covers the entities it
lists, and those the line or the read listed that the state no longer holds.

The view then replays the timeline on a copy of the initial state. Modelled
writes apply their effect; only a `2xx` write is modelled or an example, and
any other write (a redirect, an unanswered or unmodelled one) leaves the entity
below whose item path it wrote unknown until a read shows it again (a whole
collection when the path names no held entity), and taints what it wrote at or
above. A read the served environment would answer from the state is compared
with its recording as the read plans are, as the whole response it would serve:
the entity or list rendered into the envelope of the item view's or the line's
base recording, with the members the state still holds. A 400, 404 or 410, a
`null` body, or an object marked deleted (`deleted`, `isDeleted` or `is_deleted`
`true`, as EspoCRM answers a read of a deleted record) agrees with an entity the
copy does not hold; such a read drops a held entity it names and adopts none,
while an initial read keeps the record it shows held, as its item read answers it.
The item view records the flag its reads set as `deleted_flag`, a field it shows
even when only a query read showed it, which serving answers by: later reads of
a served-deleted entity show it marked deleted, and a served delete answers with
the flag as its recorded answer showed it. A match confirms
the writes that changed its entity or collection since it was last read, less
those whose entity a read since showed absent, which no longer count for the
collection; a mismatch contradicts them, or, when an unmodelled write came after them, is
checked only on the members they sent; a mismatch no write explains marks the related writes since as
`side-effect`. A plan is `served` when a read confirmed it and none
contradicted it; otherwise its `reason` is the first of its build reason
(`no-call`, `body-unusable`, `no-observation`, `unexplained-change`),
`contradicted` (with `contradicted_by`), `side-effect`, `unconfirmed` and `incomplete-entities` (an update or delete that answers with the entity, when no initial entity holds every field its recorded answer shows but those only later reads showed, counting for an update the fields its rules write, so it could answer only for entities the environment created). An otherwise served plan whose learned rules generate clock values is withheld with `unknown-clock` when no global clock start is established; its learned rules and confirming reads remain retained.
`checked_record_ordinals` lists the confirming reads, `insert` places created
entities (sorted by a field the collection's recorded order shows, else last;
a create a whole listing in collection order placed last is placed again by a
field a later such listing shows it sorted by and no earlier one ruled out, the
type's id field last),
and `write_clock` is the end of the last timed record, to the next second, when
all request completions are known; otherwise it is null. An
update that writes the field its type's creates are sorted by moves its entity
to where the new value sorts (its own `insert`); a bulk update moves each entity
it writes in turn, as replay applies them. When a read listing the whole
collection in its own order, not one its query sorts, fails after an update and the type's creates are not sorted by a field
that update writes, the view tries the order serving gives when each write since
a list in the collection's own order showed its entity moves it in turn by such a
field, against the others' values before their own writes, when
the entities no write has changed since a list in the collection's own order last
showed them already follow it, as serving moves only the entities a write
changes, and unless an earlier read listing the whole collection in its own
order showed a write that changed such a field where moving it by that order
would not have put it, a create was placed by a sort that excludes it, or a read listing the whole
collection in its own order, not one its query sorts, that placed a create did
not follow it; on a match, the type's creates
and updates take that order, as Grafana keeps folders by title though no earlier
read could tell that from creation order, or from id order where both ascend.
An update moves its entity by its creates' sort only when a list read showed a
create placed, in replay as in serving, so no read confirms an update by a sort
a create only guessed from the initial order.

Values in the state are recorded data, so the view refuses the same parents as
the manifest, including those inspected with `sensitive_values`, and a
`capture_browser_scenario` parent must have selected response bodies. Types and
identity are inferences, so the Evidence is always inferred. `unknowns` states
that the state establishes no authorization model, no way the application
computes responses or derived values, and write effects only as modelled from
recorded calls. The state
accumulator charges the manifest's admission and grouping, every record line,
each body as temporary bytes before it is decoded and parsed, and every value
it keeps, within the same 96 MiB budget. Documents hold whole recorded response
values whose recorded text and rendered JSON are each at most 256 KiB, so a
capture with many read-only paths yields a correspondingly larger state result.
The view performs no network activity and serves nothing; `rea environment-serve`
derives it from the capture at startup, serves read tools and the served write
plans from it and loads replacement states through the AgentEnv data plane, as
[serve from the state](agent-environments.md#serve-from-the-state) describes.

## Environment coverage

`view: {"kind":"environment-coverage"}` with the same `template_rules` reports
what the state an environment derives from the parent would serve, without the
state's entities: `reads.state` counts read tools answered from the state,
`reads.recorded` those that replay their recordings with
`reads.recorded_reasons` per view reason, `writes.served` lists the write tools
whose effect later reads confirmed, and `writes.withheld` lists every other
write tool with its reason, the record its plan was built from
(`exemplar_ordinal`), the read that disagreed (`contradicted_by`) and a `hint`
about what to record next. Hints are advice; they never change what is served.
The view projects the environment-state view and summarizes it, so it refuses
every parent that view refuses, with the same errors, and it is always
inferred. Call it after each recording to see which writes an environment
built from it would serve. It does not apply the serve-time admission checks:
an environment whose served catalog exceeds the discovery budget, or whose
state exceeds what `data/add` loads, serves replay, and `rea environment-build`
then reports `coverage: null`; otherwise the build prints this summary as its
`coverage`. See
[Build a bundle in one step](agent-environments.md#build-a-bundle-in-one-step)
for the hint per reason.

## Resource and lifecycle boundaries

Complete evidence has a 32 MiB input, 96 MiB decoder reply and 64-level nesting
budget. Those budgets have no runtime override. `capture_timeout_ms` does not
raise them. Exceeding a budget returns no partial success.
Oversized selected captures return an input error identifying `capture_path`
and the byte budget; owned reply/output failures remain output or provider errors.
An explicit complete-reply refusal names the 100663296-byte allowance and its
lack of a runtime override. Record selection, paging, delivery mode and worker
memory do not increase that allowance; a smaller producer export is a narrower
observation, and the refusal leaves no completed capture Evidence to retrieve.
Cancellation during reply-file finalization retains validated completed capture
facts as partial observations. Malformed or unvalidated replies are not promoted.
HAR, SAZ and qlog run in an owned Node old-generation heap with one V8 worker.
`REA_CAPTURE_DECODER_OLD_GENERATION_MIB` is a decimal integer of mebibytes from
8 to 16384. Unset uses 192, the previous constant. Invalid values fail
configuration and name the setting; they do not fall back to 192. The setting
seeds the launch value. In MCP, set `capture.decoder_old_generation_mib`
through `update_analysis_settings` for decoders belonging to newly accepted
operations, without restarting REA. Changing the launch environment still
requires a new process. A memory failure names the effective mebibytes, known
source, default, floor, and maximum. The decoder
passes that value as `--max-old-space-size` and removes inherited
`NODE_OPTIONS`, so additional host memory and `NODE_OPTIONS` do not raise the
heap. The 8 MiB semi-space stays fixed; a smaller old generation aborts Node
during startup instead of enforcing a limit. Mitmproxy decoding applies
Linux limits of 768 MiB address space, 30 seconds CPU and 96 MiB file output;
both commands use `capture_timeout_ms` (default 30000) and independently supervised
process cleanup. Owned decoder diagnostics retain at most 1 MiB across stdout
and stderr; the collector drops overflow as it arrives, reports the limit
failure and verifies cleanup. Heap limits alone do not establish aggregate RSS limits.
SAZ and qlog refuse decoding when neither a Node heap limit nor a Windows Job Object bound can be enforced. Existing HAR availability is preserved.
When REA runs on Bun, the HAR/SAZ/qlog decoder runs on Bun, which ignores these V8 heap
flags; its limitations and resource failures then omit the V8 heap sizes. On
Windows, the decoder's owned Job Object instead limits its committed memory to
the effective `REA_CAPTURE_DECODER_OLD_GENERATION_MIB` value plus a 512 MiB
reserve for Bun itself. The default 192 MiB setting therefore yields 704 MiB.
The limitations state that limit, and reaching it returns `resource_constraint`
with `process_memory_limit_bytes`, whatever exit status Bun reports. Other Bun
hosts enforce no decoder heap limit, so raising the setting does not bound them.

Observed decoder memory exhaustion returns `resource_constraint`, with the
selected capture, applicable limits and retained process diagnostics. Raising
host memory or `NODE_OPTIONS` does not raise the old-generation heap. Update
`capture.decoder_old_generation_mib` through MCP, or set
`REA_CAPTURE_DECODER_OLD_GENERATION_MIB` before starting a new REA process.
Retry after owned cleanup completes; the update does not release resources.
See the [settings design](design/limits-and-recovery.md#failure-and-retry).
Record selection happens after complete decoding and does not reduce that
workload. Use a smaller capture exported by its producer or another decoder
with sufficient capacity, retaining the original for provenance. Subsets do
not establish complete-capture coverage. Repeating the same workload or
running provider health diagnostics does not resolve the heap constraint.

Stable regular-file reads reject symlinks, replacement and concurrent changes.
Private snapshots, declarations and tool configuration are removed before the
result returns. Cleanup uncertainty retains the selected capture, resource and
original failure information. The original capture is never changed.

## Excluded coordinates and read failures

Explicitly marked values also exclude matching source coordinates and their sidecars. A hidden record coordinate is reported as `location.kind: "unknown"`; REA does not invent a replacement pointer. Original record ordinals and artifact digests remain available.

Host filesystem read denials return `code: "access_denied"`, `category: "unavailable"`, the actual `EACCES`/`EPERM` code and read-access guidance. Missing files remain input failures. Cleanup failures retain the prior structured error, including its input constraints or provider diagnostics, with explicitly marked text excluded.

An observed replacement or in-place change during stable artifact acquisition
returns `code: "artifact_changed"`, `category: "integrity_mismatch"` and
`retryable: true`, retaining the selected path and reader's reason. Wait until
the capture file is stable before retrying. No unstable snapshot is decoded.
Command cleanup failures retain the original status and both diagnostic streams;
the decoder's ownership preparation receives the same cancellation signal.

MCP advertises the same strict named input contract used by the application. Historical inspection delegates argument validation to that shared application boundary so accepted explicit-sensitive declarations also cover invalid argument names and other correction details. The SDK receives raw arguments through its Standard Schema interface; malformed inputs still fail before decoder or filesystem effects and return the normal structured REA error. Protocol-envelope validation remains owned by MCP.

## Retained aioquic qlog

Select `format: "qlog"` through `inspect_web_network_capture`, or:

```bash
rea inspect-web-network-capture /absolute/origin.qlog qlog --json
rea inspect-web-network-capture /absolute/origin.qlog qlog --record 95 --record 0 --json
```

The initial profile is **aioquic 1.5.0, JSON qlog 0.3**: one JSON object with
`qlog_format: "JSON"`, `qlog_version: "0.3"`, `traces` containing object events
with `name`, finite numeric `time` and object `data`. JSON-SEQ, JSONL, columnar
array events and other versions are unsupported. Duplicate JSON members,
malformed UTF-8, invalid interpreted QUIC integers and excessive nesting fail
without partial success, including in events outside the selected ordinals.
Well-formed event subsets and missing frame metadata remain inspectable.
Unknown extensions are retained; this is not validation of every qlog schema.

Choosing the format selects the interpretation profile; the file does not
necessarily report or authenticate an aioquic version. The profile's clock
uses Unix-epoch milliseconds, verified in aioquic 1.5.0's `QuicLoggerTrace`
`log_event`/`encode_time`. The `qlog.clock.basis` and Evidence analysis profile
state that assumption explicitly. Numeric lexemes survive independently of
safe JSON-number projections; decimal spelling does not establish physical
clock precision or monotonicity.

Every event has a global ordinal from trace/event source traversal and its
original `/traces/T/events/E` pointer. This order is not a global time sort.
Trace index and the selected artifact identify a connection observation;
reported ODCID is preserved without claiming global uniqueness. Streams are
scoped by trace, stream ID and sent/received direction. Control/QPACK streams
are retained, so counting streams does not count HTTP requests.

`qlog` is a typed facet required exactly for this format. Its scope is
`all-recorded-events-before-selection`: selection changes returned event
records while facts cite the original ordinals across the entire recorded
file. The container retains trace metadata with each events array replaced
by null; there is no single events pointer shared by all traces.

| Fact                                | Basis and limits                                                                                                                                                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original event and loss declaration | Observed endpoint report; `recovery:packet_lost` does not prove actual network loss. Missing packet number/type remains unknown.                                                                                                                                              |
| STREAM ranges and byte totals       | Derived per trace and direction from reported offsets and lengths using exact integer arithmetic. `unique_bytes` unions intervals; `frame_length_sum` includes overlaps; `repeated_bytes` is their difference. Overlap alone does not prove retransmission or equal contents. |
| FIN final sizes                     | Reported offset plus length where FIN is true; multiple conflicting sizes remain visible. A final size does not establish complete coverage or a received body.                                                                                                               |
| Incomplete fact records             | Ordinals with omitted/redacted interpretable frame metadata, including an unknown STREAM FIN; usable fields such as known ranges in that record survive. An empty list does not establish complete logging or capture.                                                        |
| HTTP bodies and causality           | `body_bytes: "not-reported"`; lengths and headers are metadata, with no reconstructed body, hash, timing causality or live process attribution.                                                                                                                               |

QUIC integer fields interpreted here accept exact nonnegative JSON integer
values through `2^62 - 1`, including equivalent exponent notation. Offsets plus
lengths must fit that range. Derived sums are decimal strings and are not
rounded to JavaScript numbers. A missing offset is unknown, never defaulted to
zero. Ranges can start above zero or contain gaps. Packet headers, HTTP events,
raw lengths and unknown extensions remain producer evidence rather than being
normalized into invented HAR requests.

The adapter excludes authorization/proxy authorization/cookie/set-cookie
values in known HTTP frame events, reset tokens in transport parameters and
NEW_CONNECTION_ID frames, and NEW_TOKEN frame tokens. Known URL header userinfo
and explicit sensitive values follow the shared exclusions. Ordinary extension
fields and token-looking query text remain retained. Explicit declarations also
cover normalized numeric projections, derived totals and trace pointers; facts
that cannot be safely shown are omitted with incomplete-record coordinates.
No keylog, PCAP, live URL or recorded target is opened by the qlog decoder.

To repeat the real-provider lane with **local caller-supplied evidence** from
the educational aioquic 1.5.0 experiment (one origin trace, known 32,803-byte
stream coverage and one 1,169-byte repeated range in the loss case):

```bash
npm run verify:web:qlog -- /absolute/control/origin.qlog /absolute/loss/origin.qlog /absolute/new-report.json
```

This lane checks built CLI/stdio MCP parity, SDK-converted JSON Schemas,
artifact digests, original event count, selection scope, retained parent lookup,
credential exclusions and the known control/loss facts. The report is created
exclusively and contains no keys or captured credential values. It is a
fixture-specific verification, not a general loss detector. CI uses synthetic
format inputs for malformed cases and limits; those tests do not establish
producer provenance. PCAP parsing and correlation remain outside this stage.

### Focused qlog views

Use MCP `inspect_web_network_capture` with `format: "qlog", detail: "summary"`
for identity, profile, scope and retained-fact counts. Then pass its
`normalized_result.parent_evidence_id` to `inspect_analysis_view` as a
`retained-evidence` source.

```json
{"kind":"qlog","facet":"traces","offset":0,"limit":10}
{"kind":"qlog","facet":"streams","trace_index":0,"offset":0,"limit":10}
{"kind":"qlog","facet":"contributions","trace_index":0,"stream_id":"0","direction":"sent","offset":0,"limit":20}
```

Trace pages omit nested lists and give their counts. Stream pages preserve
exact byte totals but omit contributions, ranges and final-size lists. For
those lists select `contributions`, `ranges` or `final-sizes` with all three
stream selectors. `loss-declarations` and `incomplete-records` need only
`trace_index`. Offsets count rows in that retained facet; defaults are 0 and 64. Missing or ambiguous selectors fail rather than choosing a connection.

These views page already interpreted facts without decoding again or opening
the source, and work after its deletion. Facts still cover all recorded events
before parent record selection. Their exhaustion does not prove logging or
network completeness. Event preview/complete pages remain available through
kind `capture`, with original numeric lexemes and producer ordinals preserved.
