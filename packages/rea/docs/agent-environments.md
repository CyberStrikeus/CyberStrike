# Agent environments from recorded captures

For a first environment, start with the
[quickstart](agent-environments-quickstart.md): record an app or use a saved
session, build and run the environment, and add tasks and reward checks.
The [implementation index](specs/agent-environments/README.md) links
the contributing PRs and their verification records. This page is the detailed
command and behavior reference.

Use `rea environment-build` to turn one recorded capture into an agent
environment bundle in one offline step: a folder `agent-env run` builds and
runs, whose MCP server answers from what the capture observed. See
[Build a bundle in one step](#build-a-bundle-in-one-step).

The steps it composes are separate commands too. `rea environment-serve` serves
an environment manifest as an agent environment: an MCP server whose tools
answer from what one retained web network capture observed, plus the
environment card the agentenv framework reads to discover it. By default the
server derives the [state the capture observed](#the-state-a-capture-observed)
at startup and answers read tools from it, and the write tools whose effect the
capture confirmed by changing it; `--replay-only` replays the capture's records
instead. Nothing is fetched from the recorded application; every answer comes
from retained Evidence. `rea environment-export` writes the same pair as a
bundle folder; see [Export a bundle](#export-a-bundle).

```sh
rea inspect-web-network-capture /absolute/session.har har --format json > capture.json
rea inspect-analysis-view view.json --format json > manifest.json
rea environment-serve manifest.json --evidence capture.json --port 8765
```

The first command inspects the capture; the second projects the
[environment manifest](web-network-captures.md#environment-manifest) view from
it, where `view.json` wraps the capture Evidence as the inline source:

```json
{
  "source": { "kind": "inline", "evidence": { "evidence_id": "ev_…" } },
  "view": {
    "kind": "environment-manifest",
    "template_rules": ["after-uid-literal", "opaque-token", "sibling-variance"]
  }
}
```

The third command serves that manifest from the state it derives from the
capture; see [Serve from the state](#serve-from-the-state). Both served files
are complete REA Evidence JSON as the commands write it with `--format json`;
the `evidence` member of `view.json` is the whole of `capture.json`.
A `view.json` can also name the capture file as
`{"kind": "evidence-file", "path": "capture.json"}`, which projects it as
retained Evidence instead of charging the whole capture as inline input.

## Build a bundle in one step

```sh
rea environment-build grafana.har ./grafana --json
agent-env run ./grafana
```

`rea environment-build <capture> [directory]` takes a `.har` file, or capture
Evidence JSON from `inspect-web-network-capture` (HAR) or
`capture-browser-scenario`, and writes the bundle
[Export a bundle](#export-a-bundle) describes. It inspects a HAR as
`inspect-web-network-capture` does (Evidence input skips this), projects the
environment manifest from that Evidence as retained Evidence, authenticates
the pair, prepares the state the bundle's server derives at startup, and
writes the bundle with the export. For the same capture path, every file it
writes is byte-identical to what `inspect-web-network-capture`,
`inspect-analysis-view` and `environment-export` write, Evidence ids included,
when `view.json` lists the same rules in the views' order and the export is
given the build's name. It reads one file and writes one folder: it fetches
nothing and launches no browser (HAR inspection runs REA's own decoder
process), so record a browser scenario with `capture-browser-scenario` first
and pass its Evidence. Other capture formats are refused, as the manifest view
refuses them, and a HAR document saved as `.json` is refused with a hint to
name it `.har`.

- `--template-rule <rule>`, repeated, replaces the default opt-in rules
  `after-uid-literal`, `opaque-token`, `sibling-variance` and
  `prefix-variance`, the rules the published capture-built environments use;
  `--format-rules-only` applies none, the views' own default. Rules apply in
  the views' fixed order, the report lists them, and a repeated rule is
  refused as the views refuse it.
- `--name` names the env folder and env id. Without it the name is the
  manifest's, unless the capture's origin is a loopback name or an IP literal:
  the capture file then names it (`grafana.har` and `grafana.capture.json`
  become `grafana`) and a `name-from-file` warning says so. A file name that
  yields no portable label (kebab-case, at most 63 characters for a DNS service
  label, not a Windows device name or a label interpreted as an IP address) is
  refused; pass `--name`.
- `--package-tarball` works as for the export, and `--capture-timeout-ms`
  as for `inspect-web-network-capture`.
- `--dry-run` runs every stage and prints the report with `status: "planned"`
  and the files a build would write, but writes nothing and does not check the
  directory, which may then be omitted. It reads and hashes a
  `--package-tarball` as a build does before copying it, so it refuses the
  tarballs a build refuses, including one whose contents cannot be read.

The directory must be absent or empty, as for the export; the build never
replaces a folder. A refusal before the write leaves nothing behind. A capture
Evidence file, an inspected HAR's Evidence and the projected manifest must each
fit the live heap headroom for parsing and sealing, checked before the file is
read or the Evidence serialized; one that does not is refused as
`resource_constraint`. Each
refusal names its stage: `environment-build` for the build's own checks,
`inspect_web_network_capture` and `inspect_analysis_view` for inspection and
projection, `environment-export` for the bundle. SIGINT cancels the build
(`cancelled`); before the bundle stage nothing is written, and a cancellation
during the write names the bundle it wrote. Stage progress is logged to stderr
at info level; the report is the only output on stdout:

```json
{
  "status": "built",
  "directory": "/work/grafana",
  "name": "grafana",
  "capture": {
    "evidence_id": "ev_…",
    "operation": "inspect_web_network_capture",
    "records": 105,
    "input": "har"
  },
  "manifest": {
    "evidence_id": "ev_…",
    "tools": 48,
    "excluded_groups": 0,
    "template_rules": [
      "after-uid-literal",
      "opaque-token",
      "sibling-variance",
      "prefix-variance"
    ]
  },
  "state": { "served": true, "evidence_id": "ev_…" },
  "coverage": {
    "reads": {
      "state": 36,
      "recorded": 6,
      "recorded_reasons": { "query-varies": 3, "…": 1 }
    },
    "writes": {
      "served": [{ "tool": "delete_folders_by_uid", "effect": "delete" }],
      "withheld": [
        {
          "tool": "post_folders",
          "effect": "create",
          "reason": "unconfirmed",
          "hint": "No later read showed the effect. Read the entity and its list after the write.",
          "exemplar_ordinal": 94,
          "contradicted_by": null
        }
      ]
    }
  },
  "tool_count": 37,
  "package_source": { "kind": "registry", "specifier": "rea-agents@…" },
  "files": [{ "path": "README.md", "bytes": 4210 }],
  "warnings": [{ "code": "name-from-file", "message": "…" }],
  "next": ["agent-env run /work/grafana"]
}
```

`coverage` is the state's read views and write plans summarized, and `null`
when the state is unavailable and the bundle serves replay. The
[environment coverage](web-network-captures.md#environment-coverage) view
reports the same summary for any capture without building, so an agent can
check it after each recording. The view summarizes the state as derived; it
does not apply the serve-time admission checks, so for an environment whose
served catalog exceeds the discovery budget, or whose state exceeds what
`data/add` loads, it still reports the state while the build reports `coverage:
null` and the bundle serves replay. Each withheld write carries a hint about
what to record next; hints never change what is served:

| Reason                | Hint                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `no-state-target`     | The write could not be linked to a modelled target. Check the path template and recorded views; record missing reads. Some route forms may not be supported.                                                                                     |
| `no-call`             | No recorded call of this tool was modelled, for example because every call failed. Record a successful call.                                                                                                                                     |
| `body-unusable`       | The retained request or response cannot be modelled. Record a successful call with a complete supported request and reproducible response.                                                                                                       |
| `no-observation`      | Nothing showed the entity or document this write changed. Read a created entity back by id right after the write; for an update or delete the state must already hold the entity, so read it before the write or record the create that made it. |
| `unexplained-change`  | The write changed fields it did not send, in a way no rule explains. A second, different call of the same tool can show the pattern.                                                                                                             |
| `contradicted`        | A later read disagreed with the modelled effect. Check the read at contradicted_by.                                                                                                                                                              |
| `side-effect`         | The write changed something besides its own entity, which the environment does not model.                                                                                                                                                        |
| `unconfirmed`         | No later read showed the effect. Read the entity and its list after the write.                                                                                                                                                                   |
| `incomplete-entities` | The write is confirmed, but the views that show its entity cannot render it in full. Read the written entity through every view that lists it.                                                                                                   |
| `unknown-clock`       | The learned rules generate timestamps, but the capture establishes no global served clock start. Record usable start times and completed durations for every request.                                                                            |

The bundle ships `evidence.json`, the whole capture Evidence, response bodies
included. Inspection excludes the values of the standard authentication headers
(`Authorization`, `Cookie` and `Set-Cookie` among them) and URL userinfo; a
custom key header such as `X-Api-Key`, a token in the query string and tokens
an application returns in bodies remain. The environment views refuse captures
inspected with `--sensitive-value`, so scrub a capture before building it. The
report's `credential-named-members` warning counts recorded header names, query
parameter names and JSON or form body members whose names look like
credentials (whole name segments such as `token`, `secret`, `password`,
`api_key`, `authorization` or `session`) and hold a value, and lists the first
20 by record and pointer, never by value. A body is read as a form or as JSON by
its recorded media type, or by its shape when it has none or one naming
neither. A browser scenario is
scanned by event (`event 4 response /token` names
`normalized_result.events.items[4]`): every retained request and response
content event, including a response whose request began before the browser was
attached and a transaction no record represents, and each transaction URL's
query once. Bodies larger than 4 MiB of UTF-8 text are not
scanned; `credential-scan-incomplete` counts them and lists up to 20 record or
event pointers, including base64 bodies whose decoded scan was cut. An empty name
warning does not establish that these bodies were checked. A browser scenario's
saved values (`save` and `save_response`) named like credentials but not marked
`secret: true` are recorded unredacted; `credential-named-saved-values` lists up
to 20 of them by parameter pointer. Names do not establish sensitivity,
so the build never refuses on them. Capture

Evidence also records the capture file's absolute path (`subject.local_path`,
`parameters.capture_path`, `locations`, `artifact.path`), and the bundle
carries it: build from a neutral folder when that path should not ship.

Over MCP, `export_environment_bundle` builds the same bundle and returns the
same report. Its `source` is capture Evidence the session retained
(`{"kind": "retained-evidence", "evidence_id"}`), such as a
`capture_browser_scenario` or `inspect_web_network_capture` result, or a
capture Evidence file (`{"kind": "evidence-file", "path"}`); inspect a HAR with
`inspect_web_network_capture` first. Retained Evidence is written into the
bundle as `--format json` writes it, so the bundle is the one
`environment-build` writes from that file. `output_directory` must be an
absolute path that does not exist yet, whose parent does; the tool creates it
and refuses an existing directory, empty or not. `name`, `template_rules`,
`package_tarball` and `dry_run` work as `--name`, `--template-rule`,
`--package-tarball` and `--dry-run` do, and retained Evidence has no file to
name the environment after, so a loopback or IP origin needs `name`. Unlike
`--dry-run`, `dry_run` still checks `output_directory`. Destination refusals
name `export_environment_bundle`; the others name their stage as
`environment-build`'s do.

## From a browser scenario

The capture can also come from REA itself: a
[browser scenario](browser-scenario-contract.md) records a scripted session
in a browser REA launches, and its Evidence is a manifest parent like a HAR
inspection. Select the `network` event family and response bodies. A replayed
reply carries up to 256 KiB of a recorded body, but the scenario keeps at most
`max_network_body_bytes` of each body (64 KiB by default), and only within its
allocation budgets: base64 is charged about 11 bytes per body byte, and
redaction more the shorter a declared secret is (about 35 bytes per body byte
for a 12-character `admin_password`). A body over
`max_network_body_allocation_bytes` (1 MiB by default) is kept as `unavailable`
with that reason; one over `max_event_allocation_bytes` (4 MiB) or
`max_total_event_allocation_bytes` (16 MiB) loses its whole content event,
headers included, which the capture lists among its omissions. Either way its
tool replays no body. The example raises all four so that 256 KiB bodies are
kept when the declared secret has at least 12 characters:

```json
{
  "browser": { "mode": "launch", "executable_path": "/usr/bin/chromium" },
  "start_url": { "url": "http://127.0.0.1:5230/auth", "query": [] },
  "secrets": [
    { "secret_id": "admin_password", "environment_variable": "APP_PASSWORD" }
  ],
  "actions": [
    {
      "step_id": "user",
      "action": "fill",
      "locator": { "kind": "css", "selector": "input[name=username]" },
      "value": { "source": "literal", "value": "admin" }
    },
    {
      "step_id": "password",
      "action": "fill",
      "locator": { "kind": "css", "selector": "input[type=password]" },
      "value": { "source": "secret", "secret_id": "admin_password" }
    },
    {
      "step_id": "sign-in",
      "action": "press",
      "locator": { "kind": "css", "selector": "input[type=password]" },
      "key": "Enter"
    },
    {
      "step_id": "first-memo",
      "action": "goto",
      "destination": { "url": "http://127.0.0.1:5230/m/1", "query": [] },
      "wait_until": "load"
    }
  ],
  "capture": {
    "events": ["network"],
    "network": {
      "request_body": true,
      "response_body": true,
      "header_values": false
    },
    "limits": {
      "max_network_body_bytes": 262144,
      "max_network_body_allocation_bytes": 12582912,
      "max_event_allocation_bytes": 12582912,
      "max_total_event_allocation_bytes": 67108864
    }
  }
}
```

```sh
APP_PASSWORD=… rea capture-browser-scenario scenario.json --format json > capture.json
rea inspect-analysis-view view.json --format json > manifest.json   # view.json wraps capture.json as before
rea environment-serve manifest.json --evidence capture.json --port 8765
```

Each network transaction becomes one record, in request order, and the
record's ordinal is its zero-based position; a transaction whose URL carried a
redacted secret is left unrepresented rather than templated, and one the
capture cannot attribute to a single request and response is left
unrepresented too. Tools are chosen by response media type, so a scenario that
selected neither response bodies nor header values is refused; one that
selected header values but no response bodies yields a manifest but no state,
so it is served by replay. The browser
scenario redacts credential headers and the secrets it declares; values the
application returns in response bodies, such as session tokens, are kept, and
the replayed body is the bytes the browser exposes for each response, with any
declared secret replaced by its redaction marker (a body that redaction had to
empty replays no body).

To record writes, sign in through the UI and then send the application's API
calls with [request steps](browser-scenario-contract.md#request-steps): each
sends one request to the start origin through the page's own `fetch`, with the
session's cookies, and a header can carry the CSRF cookie or stored token the
application's own requests send. A write is served only when the capture shows
its effect, so read each collection before writing, read every written entity
back by id and in its list right after the write, and leave more than a second
between a create and its first edit. A request step's path is fixed when the
scenario is written and cannot use a value an earlier response returned, so an
id must be known before the run: one the caller chooses, such as a `uid` in the
create body, or one an earlier scenario created. When the server assigns ids,
read the list after each create (the create's response or the list shows the
new entity), and record updates and deletes in a second scenario that reads
the first one's objects by id before editing them, or make them through the
UI. The environment coverage view names each
write it withholds and what to record next. A scenario with write requests
changes the application's data: record against an instance whose data may
change.

```json
{
  "step_id": "create-folder-1",
  "action": "request",
  "method": "POST",
  "path": "/api/folders",
  "headers": [
    {
      "name": "X-CSRFToken",
      "value": { "source": "cookie", "name": "csrftoken" }
    }
  ],
  "json": { "title": "Scratch folder 1" },
  "expected_status": [200, 201]
}
```

Each record takes its start and duration from the browser's timing (the time
the scenario observed the request where the browser reported no start), so the
state orders and overlaps
records as it does a HAR's and learns a write clock: an update the application
stamps with a modification time can be served. A scenario captured before
these times were recorded has none; its records keep request order and the
state learns no clock, so such updates stay `unexplained-change` until it is
recorded again.

## What a manifest is

An environment manifest is a projection of one application's recorded request
lines into a tool surface: one tool per method and path template on the
primary origin, with inferred path parameters, observed query parameter
names, value-free body shapes and pointers to the parent records each tool
cites. It carries no bodies and no headers. The manifest's
`parent_evidence_id` names the capture Evidence it was projected from; the
serve command refuses a manifest whose parent is not the supplied `--evidence`
file with an `invalid_request` error naming both identifiers, so a manifest can
never be served from records it did not cite.

The MCP catalog and environment card use a 1 KiB UTF-8 budget for each
captured display sample. Observation, body-key and cited-record lists show
whole values with omission counts; long method, path and query-name displays
show a marked prefix. Complete values remain in manifest Evidence. Argument
names longer than 64 characters use collision-safe `path_<n>` or `query_<n>` aliases; replay maps
those aliases to the complete captured names.

Discovery is admitted as a complete catalog under a 1 MiB serialization
reservation before the listener binds. Reservation charges up to six bytes per
UTF-16 code unit for JSON escaping/UTF-8 expansion, plus schema overhead;
a catalog may therefore be refused even when its compact JSON is smaller.
This was calibrated with 1500 query fields and eight concurrent SDK discovery
requests (183,798-byte card, 507.27 MiB sampled process-family RSS). Over-capacity
catalogs return `resource_constraint`, retain complete input Evidence, and require
a smaller capture or manifest. Fields and tools are never silently omitted.
Served from the state, each description is longer and the card declares the
data plane, so a catalog replay admits can exceed the reservation; the state
is then unavailable and the server serves replay instead (see
[Serve from the state](#serve-from-the-state)).

## What replay means and does not mean

Replay answers every tool with `--replay-only` or when the state is unavailable,
and, served from the state, each read tool whose view the state does not back.
Each such MCP tool call selects one of the records its manifest tool cites and
returns that record's recorded response. Selection compares the supplied path
parameters against the record's path segments at the parameter indexes, then
the supplied query values against the record's query string, and keeps the
record with the most matches; ties keep manifest order. A query argument accepts
one string, a number or boolean sent as its JSON text, or an array of strings for
repeated values; the array is matched
against every occurrence in captured order. The raw recorded query remains the
replay evidence. The result reports
where the answer came from:

```json
{
  "status": 200,
  "content_type": "application/json",
  "body": { "id": 2, "login": "probe" },
  "replay": {
    "record_ordinal": 5,
    "evidence_id": "ev_…",
    "exact_match": true,
    "recorded_path": "/api/users/2",
    "recorded_query": null,
    "recorded_line_truncated": false,
    "body_recorded": true,
    "body_encoding": "utf-8",
    "truncated": false
  }
}
```

`exact_match` is true when every supplied path parameter and query occurrence
matches the recorded one; it says nothing about parameters the caller omitted.
Comparison probes retain the raw query spelling and its decoded parameter pairs
in request order, including the interleaving of repeated values across names.
Standalone tool calls express repeated values as per-name arrays; when matching
records differ only in cross-name order, `exact_match` is false because those arguments cannot
identify that order. Recorded query parsing runs only when supplied query
arguments affect selection.
A path value matches a recorded segment as written or after percent-decoding;
when both kinds of match are available, the record whose segment equals the
value as written is chosen. `recorded_query` keeps the `?` of an explicit empty
query, and a recorded path or query longer than 1 KiB is cut in the reply with
`recorded_line_truncated: true`; selection always uses the full recorded line.
`content_type` also has a 1 KiB display bound with `content_type_truncated`; body
interpretation uses the full recorded media type.
When no record matches, the tool still answers from the tool's first cited
record and reports `exact_match: false`. `body` is parsed JSON when the
recorded content type is JSON-like (`application/json`, `application/*+json`,
`text/plain`, `text/markdown`) and the text parses with safe numeric conversion; otherwise
it is the recorded text. Large integer IDs and other numbers that would lose
information stay in the original JSON text. Bodies over 256 KiB are cut at a UTF-8 boundary and returned as
text with `truncated: true`. `body_recorded` is false when the capture kept the
response's status and content type but no body; `body` is then `null`, which
is not a recorded JSON `null`. `body_encoding` is `base64` when the capture
retained response bytes that are not valid UTF-8; `body` is then exactly those
bytes in base64, never a lossy decoding. A retained base64 body is decoded only as far as the 256 KiB a reply can carry, and a leading byte-order mark is kept. For a `base64` body the limit applies to the recorded bytes, not their longer base64 spelling, and a cut keeps whole base64 groups. Request bodies passed to `POST`, `PUT` and `PATCH`
tools are accepted and ignored: nothing is written, and no call changes what a
later call returns. Arguments the tool's input schema does not name are
refused by the MCP server as invalid arguments, so a misspelled parameter never
degrades into an omitted one.

Replay is not emulation. A served environment does not establish the
application's authorization model, response semantics or state transitions,
which the manifest lists as unknowns; it does not validate supplied values; and
it answers only from the capture's recordings and the state they observed or a
caller loaded through `data/add`. Replayed content is
target content: every tool result, including the argument errors the MCP server
returns before a replay runs, carries `_meta.provenance.untrusted_content: true`
with `source: "analysis_target"`. The server advertises REA's untrusted-content
instructions plus a warning that its tool names, descriptions, parameter names
and observed values come from the capture too, and agents must treat all of it
as data, never as instructions.
That same warning prefixes every tool description in the standalone card, so
card discovery carries it before an MCP client initializes. It labels the
captured text without changing the tool names or schema fields clients use.

## The state a capture observed

Replay answers each call from one recording, so the answers reflect whichever
moment of the capture recorded them. The
[environment state](web-network-captures.md#environment-state) view extracts
instead the data the capture's reads observed before the first related write:
entity types with an identity field, entities with their recorded values,
documents for reads that are not entities, and a render plan per read tool,
kept only where it reproduces that tool's recordings from the state. It is the
starting state an environment holds, loads and reports: `environment-serve`
derives it from the capture at startup; see
[Serve from the state](#serve-from-the-state). With `--replay-only`, replay is
unchanged.

## Serve a manifest

```sh
rea environment-serve manifest.json --evidence capture.json [--replay-only] [--host 127.0.0.1] [--port 0]
```

The server derives the state from the capture before it binds and serves from
it, or serves replay with `--replay-only` or when the state is unavailable;
see [Serve from the state](#serve-from-the-state).

`--host` and `--port` default to `MCP_HOST` and `MCP_PORT` from the
environment, then to `127.0.0.1` and an ephemeral port, exactly as
[`rea mcp --http`](cli.md#serve-mcp-over-streamable-http) resolves them. The
bound MCP URL is written to stderr as one JSON log line
(`"msg":"MCP transport listening"` with `url`); `REA_LOG_LEVEL` overrides that
log level. `ENVIRONMENT_NAME` renames the served environment; otherwise the
manifest's `name` is used, and a set but blank value is refused as
`configuration_invalid` before binding rather than silently falling back. The
listener serves one MCP client at a time with the same session, `Host` header
and shutdown contract as [transports](mcp-contracts.md#transports) describes.
It runs until SIGINT or SIGTERM, then closes the listener, prints one
`{"status":"stopped", …}` document whose `state` member says whether it served
from the state, and exits `130` or `143`.
Signals during input loading or DNS/bind cancel the owning reader/listener before
a listening announcement;
that path returns a structured `cancelled` result instead of a stopped-listener
document, with the same signal exit status.

Three routes are served:

| Route                             | Answer                                                                                                                                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /mcp`                       | The MCP server: from the state, one tool per read tool, answering from the state where it backs them, and one per write tool whose effect the capture confirmed, applying it to the state; in replay, one tool per manifest tool, replaying records |
| `GET /.well-known/agent-env.json` | The environment card                                                                                                                                                                                                                                |
| `POST /agentenv`                  | From the state, `data/reset`, `data/add` and `data/get`; in replay, JSON-RPC `-32601 method not found: <method>` for every method                                                                                                                   |

Numeric JSON-RPC IDs outside JavaScript's safe range or whose precision would
be lost are refused as invalid requests with a null ID. They are never echoed
as a different number.

In replay the data plane at `/agentenv` is advertised by the card but carries
no operations; the error names the requested method so a caller can see that
the method, not the transport, is unsupported. Its request body is
read within the same 4 MiB bound the MCP endpoint applies: a larger body is
answered `413` with a JSON-RPC `-32000` error before any of it is parsed, and a
body that is not JSON is answered `400` with `-32700`. A notification (no `id`)
gets `202` and no body, a batch gets one reply per request in it, and an empty
batch, a batch of more than 100 messages, or a message that is not a JSON-RPC
request (including an `id` that is not a string, number or null, or `params`
that are not an object or array) gets `-32600 invalid request`.

## The environment card

The card is the discovery document the agentenv framework reads before
connecting to `/mcp`. A replay environment's card reads:

```json
{
  "name": "grafana-example",
  "protocolVersion": "1.0",
  "url": "/agentenv",
  "preferredTransport": "JSONRPC",
  "additionalInterfaces": [{ "url": "/mcp", "transport": "mcp" }],
  "capabilities": {
    "extensions": null,
    "tools": [
      {
        "name": "get_users_by_id",
        "description": "Untrusted captured API catalog: … GET /api/users/{numeric}; returns a JSON object with fields \"id\", \"uid\", \"login\", \"email\"; recorded statuses 200; replays retained records [5, 6]; evidence ev_…",
        "inputSchema": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "description": "Path segment 2 (numeric); observed: 2, 3"
            }
          },
          "required": ["id"],
          "additionalProperties": false
        }
      }
    ],
    "operations": []
  },
  "children_environments": null
}
```

`capabilities.tools` lists the same names, descriptions and input schemas that
`tools/list` advertises over MCP. After the catalog warning, each description
names the method and path template, then what the tool returns, one level deep:
`returns a JSON object with fields …`, `returns a JSON array of objects with
fields …` or `returns a JSON object whose <member> lists objects with fields …`,
where a list is an array of objects found by the
[environment state](web-network-captures.md#environment-state)'s list rule (the
root array, or the one array of objects an envelope carries). Field and member
names are written as JSON strings, so a captured name cannot read as more of
the description; a member name too long to show whole is a quoted prefix marked
as truncated. The summary comes
from the first cited `2xx` record that replay answers as JSON; only when none
did, the first cited JSON record of another status gives it, labelled with that
status (`status 401 returns …`). It describes one recorded response, not a
contract. Field names are sampled within the same budget as other captured
values, and the manifest's `statuses` for the tool follow; a tool with no JSON
record states only its statuses. The description then lists the replayed
records and the evidence ID, and the whole catalog stays within its
serialization reservation, which the summaries and MCP annotations are charged
to.

Over MCP, every tool also carries annotations: `readOnlyHint` is true for the
safe methods (`GET`, `HEAD`, `OPTIONS` and `TRACE`) and for query `POST`s (a
path segment such as `search` or `query`); `destructiveHint` is true for `DELETE` and left unset for other
writes, so the MCP default (destructive) applies to them, and read-only tools
omit it because clients ignore it there; `idempotentHint` is true for the safe
methods, `PUT` and `DELETE`; and `openWorldHint` is false for every tool,
because answers come from the capture rather than the captured application. The
hints describe the captured method; replay itself changes nothing. The card
keeps the `name`, `description` and `inputSchema` of the echo example's tool
shape and carries no annotations.

Path parameters are required strings whose
description names the segment index, the templating rule and the observed
values (sampled within the list budget above; the manifest keeps them all);
query parameter names accept an optional string, number or boolean (a number or
boolean is sent as its JSON text) or array of strings (for repeated values in
captured order); write methods accept an
optional `body` object described by the recorded top-level key types. Each
input keeps its own argument: a query name equal to a path parameter's name is
advertised as `query_<name>`, a query name longer than 64 characters as
`query_<n>` (its position) with the captured name sampled in its description,
and the write body as `request_body` when a query parameter is named `body`. Every
schema closes with `additionalProperties: false`, a key the echo example's
schema does not carry.
In replay, `extensions`, `operations` and `children_environments` are fixed to
`null`, `[]` and `null`: a replay environment declares no extensions, no
data-plane operations and no children. Served
[from the state](#serve-from-the-state), the card declares the three data-plane
operations and one intake extension instead, and the catalog holds the read
tools and only the write tools whose effect the capture confirmed: a read tool
is described as answering from the state where the state backs it, and a
served write tool by the effect it applies to the state and the quoted body members it
accepts.

## Serve from the state

```sh
rea environment-serve manifest.json --evidence capture.json
```

Before it binds, the server derives the
[environment state](web-network-captures.md#environment-state) the capture
observed: it runs the `environment-state` view on the capture in-process with
the manifest's `template_rules` in the same order, exactly as
`inspect-analysis-view` projects it from the same capture, so the state
Evidence id it reports is the one that projection produces. The view's own
budget and refusals apply, and the result is checked like the view's Evidence
for this manifest: extracted from the served capture, with the manifest's
rules, naming only manifest tools. The server keeps one live state, shared by
every MCP session and the data plane, starting from the derived state.

A state that is unavailable does not stop the server: it logs a warning naming
the error `code` and message before it binds, then serves replay. The state is
unavailable when it cannot be derived, such as from a
`capture_browser_scenario` capture that selected header values but no response
bodies or over the view's budget, when `data/get` would write it past the 32 MiB
`data/add` intake limit, and when its catalog under the served name
exceeds the [discovery reservation](#what-a-manifest-is). That check runs
first, so no state is derived for it, and replay is then admitted exactly as
with `--replay-only`. `--replay-only`
serves replay without deriving anything; the card, tools and `/agentenv`
answers are then exactly those of replay. The stopped document's `state`
member reports which applied:

- `{"served": true, "evidence_id": "ev_…"}`: served from the derived state.
- `{"served": false, "reason": "replay-only"}`: `--replay-only` was given.
- `{"served": false, "reason": "unavailable", "code": "unsupported_target", "message": "…"}`:
  the state is unavailable; `code` and `message` are those of the refusal
  (`resource_constraint` for a catalog over the reservation), as the warning
  logged them.

Each read tool answers according to its view in the state:

| View       | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `item`     | The entity the path arguments name, rendered into the recorded envelope of `envelope_ordinal`, whose `per_response_members` (such as a request id), like a list's or a document's, keep their recorded values. Arguments match as replay matches them: each collection segment equals the held collection's segment as written or after percent-decoding, and the identity is the last argument percent-decoded, then as written; values are never re-split on `/`. Any entity the state holds answers, including one `data/add` loaded; query arguments only decide `replay.exact_match`, except that a call matching one of the view's `projected_query_keys`, or on a view with `projected_record_ordinals` asking for some fields only with a value other than `*` no checked line gave or one a replayed read gave, replays its recording. An entity the state does not hold answers the tool's latest recorded 400, 404 or 410 response with `state.view` `missing`, or is a tool error when none was recorded; one lacking a field every recording carried is a tool error, unless a read showed the application leaves that field out; a body is never invented.                                                                                                                                                                                                             |
| `list`     | When the arguments name one of the lines the view checked exactly (its latest recordings before the first related write; every path and query value equal to the recording's, and every recorded query parameter supplied), that recorded envelope with its array rendered from the state: every entity of the collection in state order for `membership: "all"` or a line `all_record_ordinals` names, or the recorded members still held. A call with no query argument answers from such a line of the collection its path arguments name that only pages its list, with `replay.exact_match` false. On a line the view's `query` answers, and for a call whose every query argument has a role there (an argument-less call aside), the answer is the query evaluated over the state: filtered, searched, sorted and paged, with counters at the number listed and `query.totals` at the number matched, and `state.membership: "query"`; such a call answers on a query or whole line of its collection with `replay.exact_match` false. A value an `inert` parameter never recorded, a parameter without a role, a call matching one of the view's `projected_query_keys`, or a field selection the checked lines do not show (as for `item`), replays its recording. A member lacking a field every recording carried makes the call a tool error rather than a partial list. |
| `document` | When the arguments name the document's checked line exactly, the state's value for it; a tool error when the state holds none.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `recorded` | The recording, as replay answers it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

A read with repeated query values uses replay, because the state query model
does not infer repeated-parameter semantics. A repeated-query write is refused
before it can change state for the same reason.

List counters retain their recorded number or digit-string representation.
Changing a digit-string counter preserves its observed zero-padding width;
query-total inference remains limited to canonical decimal counts. Path matching
uses the same segment parser as extraction, preserving empty internal segments.

An item or list view that always spells a clock field otherwise than the
entity's stored value names that spelling in `clock_formats`, and a value it
never recorded, such as a created entity's clock, is rendered in it: a list that
writes `+00:00` where item reads write `Z` lists a new entity the same way.
A view that names a field in `sorted_arrays` lists that string array sorted, as
a read-back showed the application does, while the state keeps it in the order
it was written, so a write's own answer echoes it. If a later counted read
contradicts that ordering, the view stays recorded and its earlier reads no
longer confirm served writes. A view that names a field in `nested_fields`
always showed that field's objects with the same keys, in any order, and fewer
than an entity stores, such
as a list showing a parent without the parent's own nested type; a stored
object it never recorded, such as a created entity's parent, is rendered with
those keys. Members a view names in
`per_response_members`, such as a request id each response mints, keep the
value its recording carried. A list's `counters` and `query.totals` are
top-level members or members one level down in a paging object
(`/pageInfo/totalRows`); either is set to the number listed or matched, and
members beside it such as `isLastPage` stay as recorded.

A list or document call that names no checked line, including a line recorded
after a write or with other query values, answers from the recording. Every
answer has the replay shape plus `state`: `{"source": "state", "view": …}`
naming the entity, collection or document path, or `{"source": "recording",
"reason": …}` with the view's reason, `no-view`, `unrecorded-request`, `page-exceeded` (a call naming a page of a whole list that the collection has outgrown), `projection` (a call to an item or list tool with replayed reads asking for a selection of fields the checked lines do not show, or leaving out a projection parameter every checked line names) or `variant` (a call matching another `projected_query_keys` key: a parameter, or a value of one, only lines showing the entities in another representation named, or leaving out a parameter every other line named). A `projection` or `variant` answer is a recording, so it does not show served writes. A
state answer carries the base record's status, content type and `replay`
provenance with `truncated: false`; one whose JSON would exceed 256 KiB is
refused as a `resource_constraint` tool error rather than cut. Extraction does
not state-back a document whose rendered JSON exceeds 256 KiB; that read stays
recorded (`rendered-oversize`) and replays the captured body. Query `POST`s,
and `POST` tools the capture shows only reading (a lookup answering as a `GET`
did, an RPC tunnel naming read operations, a session renewal), stay served and
answer from their recordings with the reason `query-body`; they are not write
tools.
`HEAD`, `OPTIONS` and `TRACE` tools also replay their captured responses; their
state views report `method-replay` and coverage counts them as recorded reads.

A line establishes whole-collection membership only from the beginning:
`offset`, `start`, `_start` and `page` must be zero when present. Positive or
malformed positions do not by themselves establish whole membership. A separate
query model may describe supported paging; an empty later page cannot start
returning earlier entities merely because it was empty in the capture.

`POST`, `PUT`, `PATCH` and `DELETE` tools are served only when the state's
[write plan](web-network-captures.md#environment-state) for them is served:
the capture's later reads confirmed the effect the plan models. Other write
tools are not served, so no call claims a change it does not make; each one's
plan states why in its `reason`. A served write changes the live state, which
every MCP session and `data/get` then see:

| Effect                    | Call                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`                  | Adds an entity to the collection the path names, built from the observed entity with each ruled field taken from the call or generated, at the plan's `insert` position. A plan tied to its exemplar's collection writes only there.                                                                                                                                                                |
| `update`                  | Sets the sent members on the entity the path names, constants for members accepted only with their recorded value, and the clock, nested clock, increment, slug, stamp, derived, composed, reference, unique and renewed changes the plan models.                                                                                                                                                   |
| `update` (action)         | A `POST`, `PUT` or `PATCH` to an item path plus an action segment (`/{type}/{id}/archive`) sets, on the entity before the segment, each scalar the recorded calls showed the action set (`set`), or flips each boolean they showed it flipping both ways (`toggle`), with any sent members; it is served only when a recorded call found what it sets already set, or flipped back what it toggles. |
| `delete`                  | Removes the entity the path names.                                                                                                                                                                                                                                                                                                                                                                  |
| bulk `update` or `delete` | A `DELETE`, `PUT` or `PATCH` at a collection, or a `POST` to it plus `delete`, `remove` or `destroy`, applies its effect to every entity the body names, as recorded: an array of ids or of objects carrying the id field, at the root or as the body's one array member (`{"IDs": […], "Read": true}`).                                                                                            |
| `document`                | Merges the body into the plan's document object, or replaces it for `PUT`.                                                                                                                                                                                                                                                                                                                          |

An update's unsent changes follow the plan's rules. A `held-clock` is a clock
the client sends back as it read it and the application stamps anew (Ghost's
`updated_at`): the call must send the entity's value and the field takes the
write's clock. A `nested-clock` sets the clocks inside an object the entity
holds, in that object's recorded format. A `stamp` writes the acting user
the entity already names under its `created…by` counterpart into a
`modified…by` or `updated…by` field. A `derived` field takes a value showing
the one sent member's text that the entity stores nowhere (a field Ghost
derives from `html`), only with that member's recorded value. An action's
`set` rule sets a scalar to the value the recorded calls left it at, and its
`toggle` rule flips a boolean, refusing a call on an entity that holds none
there (Miniflux's `PUT /v1/entries/{id}/bookmark` stars and unstars).

Its answer has the status and content type of the plan's recorded response,
with the written entity or its identity rendered in, no body, or the recorded
body. A call whose body is not an object, sends a member the capture did not
show stored, sends a fixed member with another value or a member of another
JSON type, or lacks a required member is a tool error naming the accepted
members; so is a call sending query parameters other than the exemplar's (they
may change what the body does), a body not wrapped in the exemplar's envelope
(Ghost's `{"posts": [{…}]}`), a bulk call naming an id the state does not hold,
a `held-clock` member sent with another value than the entity holds, a call
sending a `derived` rule's member to an entity that does not hold the value the
recorded call found, a nested clock on an entity holding no such object, and a
rendered answer missing a field the recorded response carried, and an update or delete of an entity the state does not hold answers
the recorded 400, 404 or 410 of the tool or of an item view of the type, if
any. A served delete of a type whose item view has a `deleted_flag` (the
member, `deleted`, `isDeleted` or `is_deleted`, its reads set `true` on a
record the application soft-deleted, as EspoCRM does) keeps the entity until
`data/reset` or `data/add`, within the size `data/add` loads, so a read of it by
id answers its last fields with that flag `true`. A refused call leaves the
state unchanged. Values a write generates are
deterministic: the clock starts at `write_clock` and advances one second per
served write, sequences take one past both the largest held value and the
largest they generated, and UUIDs and tokens derive from the state Evidence
id, tool, field and write count, skipping held values. If `write_clock` is null,
plans needing `clock`, `held-clock`, or `nested-clock` retain their learned rules
but are withheld with `unknown-clock`; other confirmed plans can still be served.
`data/reset` and
`data/add` restart the clock, counter and sequences, so the same calls after a
reset give the same state. Answers carry `state: {"source": "state", "view":
"create" | "update" | "delete", …}` or `"document-write"`; a bulk answer adds
`ids`, every entity it wrote in body order, with `id` naming the first.

The data plane serves three JSON-RPC methods:

| Method       | Result                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `data/reset` | `{}` after restoring the state the Evidence holds                                                         |
| `data/add`   | `{}` after replacing the whole state with one valid `rea-state/v1` document                               |
| `data/get`   | `{"parts": [{"kind": "data", "data": <rea-state/v1 document>}]}` with `state_evidence_id` and the `types` |

Calls run one at a time in arrival order across requests. Every message of a
batch is queued when the batch arrives, so another request's call never lands
between them and each message sees the changes of those before it; a reset
sent while a download is loading applies after that load. `data/add`
takes exactly one part: a `data` part whose `data` is the document, or a
`file` part whose `file` carries `bytes` (base64 of UTF-8 JSON) or a `uri`,
either a `file://` URL of a local regular file, whose host is empty or
`localhost`, or an `https://` URL fetched without following redirects and
within 30 seconds, including reading the body; `mimeType`, when given, is
`application/json`. A `file://` URL naming another host, or a UNC path such as
`file:////server/share/state.json`, is refused before anything is opened, so a
load never reaches a network share. A loaded document is at most 32
MiB, and so is the state as `data/get` writes it back with the members a
document may omit (`types`, `state_evidence_id`, record citations), so a
reported state always loads again; an inline part also stays within the 4 MiB
request body bound, so larger states arrive by `uri`. Anything else, including `{"parts": []}`, is `-32602
invalid params`; a download that fails or answers a non-2xx status is
`-32000`. Errors never echo the uri or the content; a file or download failure
names its category in `error.data.reason`: `not-found`, `permission`,
`not-regular-file`, `changed` or `read-failed` for files, `timeout`,
`http-status` or `network` (connection, TLS or a refused redirect) for
downloads, and `cancelled` for a download the server's stop or its caller's
departure ended.

Served creates also bound additional collection history since the last reset
or `data/add` to 1 MiB of deterministic accounting: UTF-8 bytes for each new
collection spelling and its possible sequence keys, plus a 64-byte allowance
per collection and potential sequence-key record. The score bounds identifier
payload and a fixed record allowance; it is not a measurement or guarantee of
process memory. Collections
already present in the Evidence or loaded state are part of the state itself;
the store indexes their unique spellings so they remain known after deletion,
but they do not consume this additional-history budget. A create that would
exceed the budget is refused before the state changes. `data/reset` or `data/add`
clears generated history; if the same calls would hit the limit again, use
fewer distinct collection paths. The 1 MiB score ceiling is 1/32 of the
separate 32 MiB state-intake ceiling, reserving a small, explicit allowance
for identifiers retained beyond the loaded state. A loaded-state path that is
later deleted and then introduced again may consume the additional-history
budget when the store must retain it beyond the source entity.

Stopping the server cancels every pending call, and a caller that leaves before
its reply cancels its own: a download in progress ends, and calls not yet run
are answered `-32000` with `error.data.reason` `cancelled` without running. A
cancelled call leaves the state unchanged, and shutdown never waits for a
download.

One `/agentenv` response carries at most 64 MiB of replies, twice the 32 MiB
a loaded document may hold: room for a `data/get` of a loaded state, while a
batch of reads cannot multiply a large state into one body. Replies are
measured in order as they are produced, in bounded parts and before they are
assembled, and room is kept for every later reply's budget error and the
batch's brackets and commas, so one that would take the response past the
budget is never built whole and is answered instead with `-32000` whose `error.data` gives
`max_response_bytes` and the `reply_bytes` it would have taken. That call still
ran, so repeat such a read in another request. A reply no larger than that
error, such as a write's `{}`, is always kept.

```json
{
  "rea_state": {
    "version": 1,
    "entities": [
      {
        "type": "/api/users",
        "collection": "/api/users",
        "id": "2",
        "fields": { "id": 2, "login": "probe" }
      }
    ],
    "documents": []
  }
}
```

Each entity's `type` is a state type's `collection_template`, its `collection`
matches that template segment by segment (a template parameter matches any one
segment), its identity field's value is its `id`, and its type, collection and
id are unique; `view_fields` is optional and names item or list views of its
type. Views render their values over the entity's fields, so a view's values
must not set the type's identity field to a value whose text differs from the
entity's `id`. Spell a collection as requests spell it, as `data/get` reports it: list
calls find entities under the checked line's recorded path. State collection
identity preserves repeated separators inside captured paths: `/api/books`
and `/api//books` are distinct. A single trailing slash continues to name the
same collection. Each document
names a `document` view once, at its initial document's `path`. The `version`,
and the `state_evidence_id` and `types` that `data/get` reports, must match
the served state, so a `data/get` result loads back unchanged. A number without
an exact native value, or whose serialized spelling would not be read as exact
(an integer from 2^53 below 1e21, such as `1e20`, in any spelling), is refused
rather than altered. Caller data preserves all own JSON members, including
`__proto__`; unknown members of the state document's structure are refused.
An invalid document is `-32602` naming the first problem by JSON pointer, as in
`/rea_state/entities/3/collection` (also in `error.data.path`); a problem
inside caller data (`fields`, `value`, `types`) is located at that member, so
the pointer never names the caller's keys. A refused document changes nothing;
a valid one replaces the whole state at once. The order of `entities` is the
state order lists use.

Record citations stay Evidence provenance. An entity's `record_ordinals` may
be omitted or empty and a document's `record_ordinal` omitted; otherwise they
must be the served Evidence's citations for that entity or document, or the
document is refused. After loading, an entity or document whose values equal the Evidence's cites
the Evidence's records, and one whose values were edited or added cites none
(`record_ordinals: []`, no `record_ordinal`), so `data/get` never presents a
loaded value as recorded.

The card declares the operations and what `data/add` accepts:

```json
{
  "extensions": [
    {
      "uri": "urn:agentenv:intake/v1",
      "description": "data/add replaces the whole environment state with one rea-state/v1 document; data/get returns the current state in the same format.",
      "params": {
        "add": [
          { "part": "data", "format": "rea-state/v1", "load": "replace" },
          {
            "part": "file",
            "format": "rea-state/v1",
            "mimeTypes": ["application/json"],
            "load": "replace"
          }
        ],
        "get": [{ "part": "data", "format": "rea-state/v1" }]
      }
    }
  ],
  "operations": ["data/reset", "data/add", "data/get"]
}
```

The state starts as a projection of recorded reads and changes only through
served write tools and the data plane. List and document calls answer from the
state only for the lines their views checked, and every recorded view answers
from recordings; item calls answer for any held entity but render only the
envelope one recording carried. Values copied outside entity objects, derived
values and counters other than those that count a list stay as recorded, and a
served write changes only the one entity or document it writes: side effects
on counters, relations and copies of entities in other collections, reordering
after an update and referential rules on delete are not modelled. An exported
bundle carries no state file: its server derives the state at startup, as the
export does to predict what it serves.

Known limits of served writes:

- A recorded view answers from its recordings after a served write: Mailpit's
  `get_messages`, recorded as `list-differs`, still lists a message a served
  delete removed.
- Served n8n workflow updates accept any `versionId`, while served Ghost post
  updates require `updated_at` to match the entity (a `held-clock`).
- A slug derived from a title can repeat across served creates with the same
  title, where the application would make it unique.
- A `composed` string copies sent text as sent: an application that escapes or
  renders it (HTML entities, Markdown) differs for text that needs it, as
  BookStack's `description_html` would for a description holding `&`.
- A served create's sequence id is the state's next value, not the gaps an
  application's own sequence would leave.
- Nested clocks are served in the spelling of the write's own response, which
  can differ from what a later read of the application shows.
- A served write to an entity that a replayed (unserved) create made answers
  as for a missing entity, since the state never held it.

## Export a bundle

`rea environment-export` writes the same pair as a bundle folder the agentenv
framework runs directly, shaped like its own echo example:

```sh
rea environment-export manifest.json --evidence capture.json ./grafana-example --json
agent-env run ./grafana-example
```

```text
grafana-example/
  README.md                                 provenance, what it serves, run command, rights note
  envs/grafana-example/Dockerfile           pinned image: node:24.22.1-bookworm-slim + rea-agents@<this version>
  envs/grafana-example/env.toml             environment_name = "grafana-example"
  envs/grafana-example/manifest.json        byte-exact copy of manifest.json
  envs/grafana-example/evidence.json        byte-exact copy of capture.json
  artifacts/check_grafana-example/verify.py the verifier
  tasks/smoke.json                          deploy_env (local sandbox), then env_outcome_verifier
```

The command reads each file once, after checking that reading and parsing the
whole file, including sealing traversal, fits the process's live heap headroom (a file that does not is
refused as a `resource_constraint` before it is read), then authenticates and cross-checks the
pair as `environment-serve` does, so a manifest projected from another capture
is refused with the same `invalid_request` before anything is written, and the
bytes it copies are the bytes it authenticated. The bundle directory must be
absent or empty; an occupied directory is refused and nothing in it changes.
After checking the bundle name, the export prepares the state from the capture
exactly as the bundle's server will at startup under that name, to predict what
the bundle serves; an unavailable state, including one whose catalog exceeds
the discovery reservation, does not stop the export, and the bundle then
serves replay. The complete tool catalog the bundle serves must also fit the
server's advertised catalog budget before any files are written. Privately parsed JSON is sealed once so authentication
and replay share immutable response trees rather than copying the capture repeatedly.
`--name` replaces the manifest's portable kebab-case name as the env folder and env id
(at most 63 characters for its DNS service label; Windows device names and
labels interpreted as IP addresses are refused);
`--package-tarball <path>` copies a packed `rea-agents` tarball into the env
folder and makes the Dockerfile install it instead of the registry package and
remove it in the same layer, which is how a checkout rather than a release is
run. The command prints the
written files with their sizes, the pinned package source, the number of tools
the bundle serves as `tool_count`, and in `state` whether it serves from the
state, in the shape of the serve command's stopped document.

Export uses the shared output-tree owner to check directory identities around
exclusive creates, verify written bytes, and reject unowned entries before
reporting success. It does not delete an inspectable partial folder on failure.
Node's portable pathname APIs leave a syscall-boundary race, so the output's
parent directories must be trusted. On POSIX output files use mode `0600`;
Windows inherits ACLs and REA does not establish owner-only access there. Choose
an already private Windows destination when captured content needs it.

The Dockerfile sets `MCP_HOST=0.0.0.0` and `MCP_PORT=18765`, the port the
framework maps for an MCP server env, and `MCP_ALLOWED_HOSTS` naming the loopback
addresses and the environment name, because the container binds outside loopback
and the server refuses to serve on such a bind without an operator-declared
allowlist: the framework's published port is reached over loopback and its
gateway proxies to the env container by the compose service name (the
environment name). The framework's own deploy supplies
`MCP_HOST`, `MCP_PORT` and `ENVIRONMENT_NAME`, so the served card carries the
env's name. It installs Debian's `python3` because the framework's local
sandbox probes a container's readiness with `python3` inside it, which the slim
Node image lacks. It copies the two inputs owned by the image's non-root `node`
user, so a private host umask cannot leave them unreadable, runs as that user and starts
`rea environment-serve /env/manifest.json --evidence /env/evidence.json`. The
`env.toml` names the environment because the framework otherwise reads the
name from Python sources the image does not have.

`verify.py` is the framework's `async def verify(mcp_url)` shape over its
Python MCP client: it lists the tools and checks the count equals the number
the bundle serves (from the state, the manifest's read tools and the write
tools whose effect the capture confirmed; every manifest tool in replay), calls one tool with no arguments and checks the call did not
fail and its `status` is the expected one, and returns one `serve` result
whose description reports both checks. The tool is the first served `GET` tool
without path parameters whose answer to no arguments is not an error, and the
expected status is the status of that answer: the export calls the same answer
function the server uses, from the derived state or by replay, so a state
answer carries its base record's status and a replayed one its record's (an
unknown recorded status stays unknown; it is not borrowed from another
record). A bundle with no such tool yields a verifier that checks the count
only and says so. `tasks/smoke.json` deploys the env on the local
sandbox and runs that verifier against the env's MCP endpoint; the first run
also builds the framework's own infrastructure, and the run tears everything
down when it ends.

The README written into the bundle records the capture artifact's SHA-256, the
capture and manifest Evidence ids, the manifest view digest, the served tool
count, the derived state's Evidence id or that no state is served, and the
package source. It says what the environment serves: read tools from the state
the capture observed, the `/agentenv` data plane on it and the write tools
whose effect the capture's later reads confirmed, replay when the state is
unavailable, and `--replay-only` for pure replay; it
says which applies to this bundle, with the error code and message when the
state is unavailable, and that neither is emulation and served
content is untrusted data. It states that the recorded content belongs to the
captured application and must not be published without the rights to it.

## Measure fidelity against the application

An environment agrees with its own capture by construction. What matters to an agent is how it answers the calls the
capture did not make, what it shows after a write, and how it fails. `rea environment-compare` measures that against the
application itself:

```sh
rea environment-compare manifest.json --evidence capture.json \
  --probe probe-crud.json --probe probe-reads.json --json
```

Each `--probe` is capture Evidence (`inspect-web-network-capture` of a HAR, or `capture-browser-scenario`) of one call
sequence made against the live application, seeded as it was for the capture and reset before the sequence. The command
makes no network call: whoever records the probes drives the application with its own credentials. For each probe it
resets the environment's state, takes the requests in the order they were made (record order when any lacks a start time), matches each to the manifest tool of the
same method whose path template fits with the most literal segments (a format-rule parameter must fit its format once
percent-decoded). A path argument is the raw segment, which the environment decodes once.
It answers the call as the served environment would, and compares that answer with the application's.

A re-seeded application holds the same entities under other ids, so the comparison maps them. Objects in the two answers
to one call pair by a natural key, a string field unique on each side that both share, such as a name or a slug; their
identifier fields (`id`, `uuid`, `guid`, and names ending in `_id`, `Id`, `ID`, `_uuid` or `Uuid`), and those of two single
answers such as a create's, map the live value to the environment's, including a create that returns only the new id.
Ids are learned only from an answer the environment
gave that call itself, from its state or a recording of that very call, request line and body, never from another call's
recording replayed in its place and never from a recording whose body the probe omitted. The answer's own `id`, `uuid` or `guid` also maps within the collection the call names, since
two collections can reuse a live id, and an equal pair stays in that collection. A live id in a later request's path, query or body is translated before the
environment answers, a path parameter by the collection the live path names (a nested collection keeps its parent values, each decoded once, and a literal route segment stays), except a query value that pages a list, such as `limit`
or `page`. Each call is checked against the served tool's input schema first, as the MCP server checks it. After mapping, two clock values compare by format only (ISO-8601 strings, and epoch numbers under
`at`, `time`, `date`, `timestamp`, `created`, `updated` or `modified` field names, including snake-case and camel-case forms).
Numeric arrays retain that containing field's clock context through nested
arrays; an object's own fields establish their own context. Numeric values at
the body root, in root arrays, or under measurement fields remain literal.

Generated values normalize only where this confirmed, served write's entity
response rules identify generation. A UUID identity rule must still compare two
UUIDs, and a `unique` rule two UUIDs or two generated integers (10 to 20
digits) of one JSON kind and length; a `renewed` rule applies only at its
recorded pointers,
with `*` matching actual array items. Token/sequence strings retain the existing
format check: equal length of at least eight, the same character classes, and
a digit. Numeric sequences continue to compare literally unless an ID mapping
applies. String shape and names such as `token` or `sku` alone do not establish
generation. Read and replay responses without these facts stay literal except
for supported clocks and learned IDs. A missing write target replays an absence
response and does not inherit the successful entity response's generation rules.
Admitted generated values must also preserve aliases and distinct identities
within that response. UUID identity uses the generator's case-insensitive
matching; token and sequence strings retain their literal identity. This
correspondence ends with the answer and is not inferred across calls.
A `composed` response field must spell the value its parts build from that
response's own fields. Its parts then compare by their rendered text or their
source fields' clock and ID rules. A coherent archive URL can therefore differ
only in normalized clock digits without reporting a value difference; an
incoherent URL still differs even when both sides repeat the same stale text.
Normalized compositions count under `generated`; source fields are counted once.
The report counts each kind of normalised
value; the generation rules remain model-derived facts, rather than new
observations of the application.
ISO clock offsets are accepted only within RFC 3339's `00`–`23` hour and `00`–`59` minute ranges.
Probe ordering retains every recorded fractional-second digit in ISO timestamps
with a four-digit year, `T`, and a `Z` or `±HH:MM` suffix. Equal instants use ordinal order. Other native-Date
spellings keep their existing millisecond interpretation; an absent or unreadable
start time makes the whole probe use record order. Original capture timestamps
remain unchanged. Clock-format comparison and respelling recognize four-digit
ISO years `0000`–`0099` as well as later years, with normal calendar validation.
Respelling preserves the original value when the target zone would require a year
outside `0000`–`9999`; generated writes refuse a clock outside that format.
Capture-state start ordering uses the same exact recorded timestamp facts,
including minute-only times and fractions longer than nine digits. Recorded
spellings may use `T` or a space, `Z` or an extended/compact offset, or no zone
(interpreted as UTC). Equal starts use ordinal order; a missing or unreadable
start makes the capture use record order. Request interval and overlap checks
still use millisecond coordinates, and generated-clock progression compares
milliseconds. Derived ISO clock formats still require seconds and at most nine
fractional digits.

Comparison keeps response representations distinct: JSON values compare structurally, text compares as text, and a
retained base64 body compares by bytes (including with UTF-8 text carrying those same bytes), never by its base64
spelling. ID mappings apply at identifier fields, `ids`/`uuids`/`guids` lists, an entity's own identity within its
collection, and a string field learning confirmed as a state-held ID. ID mappings leave other numeric and string values unchanged. A
global conflict involving an equal pair is not used to normalize either pair; the report counts it as an ID conflict.

A step agrees when the statuses and the normalised bodies are equal. The report gives agreement overall, per probe and
per tool, `agreement_ignoring_order` for steps that differ only in item order, and each step's differences, at most 20,
with a JSON pointer and both values cut short:

| Category        | Meaning                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `status`        | The statuses differ                                                                                          |
| `missing-field` | The application's object has a member the environment's lacks                                                |
| `extra-field`   | The environment's object has a member the application's lacks                                                |
| `value`         | Values differ, or one is an object or array and the other is not                                             |
| `length`        | Arrays differ in length, or not every item pairs                                                             |
| `order`         | Paired items come in a different order                                                                       |
| `clock-format`  | Both are clocks, in different formats                                                                        |
| `refused`       | The environment refused the call                                                                             |
| `not-served`    | The request's tool is one the environment does not offer, such as a withheld write                           |
| `no-tool`       | No manifest tool matches the request                                                                         |
| `unmapped-id`   | The application answered with success and the environment did not, for a path id the comparison never mapped |

What a probe did not observe is not counted as the application's behaviour. A record without a usable request line,
such as a redacted URL or a transaction the capture cannot attribute, is not replayed, nor is a request to an origin different
from the application's (`other-origin`: the probe's origin with the most JSON-like records, as the manifest
chooses its own), and a request with no recorded
answer is made, since it may have changed the application, but not compared: each probe lists them under `unobserved` with the reason, and the summary counts them. A live
body the probe did not record compares by status only and is counted as `unobserved_bodies`, unless the answer never
carries one (204, 205, 304, `HEAD`). A browser probe captured without `capture.network.response_body` is refused, as
is one that makes POST, PUT or PATCH calls without `capture.network.request_body`.

Agreement covers only the calls the probes make, after the mapping the answers allow. Clocks compared by format
and fields normalized under explicit generation rules can still differ in content, and an equal answer after a write shows the state matched for that
read, not that the write had no other effect.

## Compatibility verification

`npm run verify:agentenv:environment` is the hosted `real-agentenv` lane
described in [testing](testing.md#exported-environment-bundles). It projects
the Grafana-shaped source-owned capture through the built CLI, packs the
checkout, exports a bundle with `--package-tarball`, runs it with the pinned
`agentenv-framework` release on the runner's Docker and requires the smoke task
to pass with no container left behind other than the framework's own
image-registry helper, which the receipt reports. It proves that one exported bundle runs
on one framework release; it does not claim any hosted platform or other
framework versions.

## Resource and lifecycle boundaries

The Evidence files are read once at startup through the bounded JSON input
reader and authenticated as Evidence before the listener binds; a file that is
not Evidence, a manifest of another view kind, a capture of another format, or
a manifest projected from a different capture is refused before any port is
opened. The state is derived once, in-process and before binding, from the
already authenticated capture: it is projected as retained Evidence, so the
capture's strings are not charged again as inline view input, and the view's
96 MiB budget bounds the derivation. Because authentication covers the capture's records, a manifest whose
parent check passes cites only records the capture retains. The server keeps
only the cited records' request lines and response text in memory, plus the
live state when it serves from one: the derived initial state, or one
validated document whose JSON was at most 32 MiB. Data-plane calls run one at a time, so
at most one loaded document is being read and parsed at once; `data/get`
serializes the held state whole. No process is launched and nothing is
written to disk. No outbound network request is made unless a `data/add` call names an
`https://` uri, which is fetched once within the limits above; a `file://` uri
is read once. A listener that fails after binding is logged and ends the command with
a `resource_constraint` error and exit `1` instead of serving nothing.
