# Serve the environment from its state by default

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

`rea environment-serve <manifest> --evidence <capture>` serves the environment
from the initial state the capture observed, with nothing else to supply: at
startup it derives the `environment-state` view of the capture in-process with
the manifest's `template_rules`. Read tools whose views are state-backed answer
from one live state, the `/agentenv` data plane implements `data/reset`,
`data/add` and `data/get` against it, and the card advertises those operations
and an intake declaration. `--replay-only` serves exactly the stateless replay
main serves: every manifest tool replays its recordings, `/agentenv` answers every method as not found and the card is
byte-identical. A state that cannot be derived, or whose catalog exceeds the
discovery budget, starts the server in replay mode, logs why and reports it. Exported bundles serve the state by default,
and their verifier and README match what they serve. Serving is read-only in
this increment: write tools are not served from the state.

## Requirements

- Derive the state in the application layer, shared by serve and export:
  `deriveEnvironmentState(source, capture, operation)` authenticates the
  capture value the command already read (an owned snapshot authenticated by
  the source load is reused, not parsed again), projects the
  `environment-state` view with the manifest's `template_rules` through
  `inspectAnalysisViewValidated` with the capture as retained Evidence (the
  Evidence id equals that of a projection by hand, and the capture's strings
  are not charged again as inline input, which refuses captures of a few MiB),
  then applies `loadEnvironmentState`: `inspect_analysis_view` Evidence of kind
  `environment-state`, its `parent_evidence_id` equal to the capture's, its
  `template_rules` equal to the manifest's in the same order, and every view
  naming a manifest tool, refusing otherwise with `invalid_request` whose issue
  path starts with `state`. The source validates a HAR capture with the owned
  borrowing parse, so the view reuses that validation.
- `prepareServedState(source, capture, {name, operation})` first builds the
  state catalog under the served name, then derives the state, and reports
  `{served: true, evidence_id}` or
  `{served: false, reason: "unavailable", code, message}` with the refusal's
  projected code and message: a state catalog over the discovery budget is
  unavailable with `resource_constraint`, and no state is derived for it. A
  derived state whose catalog fits always serves from the state. The CLI
  reports `{served: false, reason: "replay-only"}` itself for `--replay-only`
  and derives nothing.
- Keep one state store per server process, shared by every MCP session and the
  data plane: entities keyed by type, collection and id with per-collection
  order taken from the entities array, documents keyed by tool. `reset`
  restores the Evidence state, `replace` installs a validated document whole,
  and mutations are synchronous.
- Answer item views by rendering the entity the path arguments name into the
  recorded envelope of `envelope_ordinal`. Match arguments as replay does: a
  held collection segment equal to the argument as written or after
  percent-decoding, preferring verbatim spellings, and the identity as the last
  argument percent-decoded, then as written, never re-split on `/`. Any held
  entity answers, and query arguments only set `replay.exact_match`. Refuse an
  entity the state does not hold, or one lacking a required field, as a tool
  error and never invent a body.
- Answer list views from the state only when the arguments name one of the
  view's `checked_record_ordinals` exactly (every path and query value equal and
  no recorded query parameter unsupplied), choosing among them as replay
  chooses: every collection entity in state order for `membership: "all"`,
  otherwise the recorded members the state still holds. A member lacking one
  of the view's `required_fields` makes the call a tool error stating that the
  state holds no complete member, never a partial body, as for items. Lines
  recorded after a write or with other filters were never checked and answer
  from recordings.
- Answer document views with the state's value when the arguments name the
  document's checked line exactly.
- Answer recorded views, tools without a view and unrecorded requests from the
  recording, labelled `state: {source: "recording", reason}`; label state
  answers `state: {source: "state", view, …}` with the base record's replay
  provenance and `truncated: false`; refuse a state answer over 256 KiB as a
  tool error rather than cut it.
- Serve `data/reset` (`{}`), `data/add` with exactly one `data` or `file` part
  (`bytes`, a `file://` regular file or an `https://` download with a 30 s
  timeout covering the body, no redirects and a streamed 32 MiB cap;
  `mimeType` when given is `application/json`) and `data/get` (`{parts:
  [{kind: "data", data: rea_state}]}`). A `file://` uri whose host is neither
  empty nor `localhost`, or whose path is a UNC path, is `-32602` before
  anything is opened. A document that `data/get` would write back past 32 MiB,
  once it adds the members a document may omit, is `-32602`, so a reported
  state always loads again. Anything else is `-32602`, including empty `parts`; a
  failed download is `-32000`; errors never echo a uri or content and name a
  coarse failure category in `error.data.reason`. Calls run one at a time in
  arrival order across requests; every message of a batch is queued when the
  batch arrives, so no other request's call lands between them, and
  notifications run without a reply.
- Stopping the server (`close` or `prepareShutdown`) aborts the data plane's
  stop signal, and a request's own signal aborts when its client leaves: the
  download in progress ends with reason `cancelled`, queued calls are answered
  `-32000` with reason `cancelled` without running, and a `data/add` whose
  file read finished after the cancellation does not replace the state.
- A `file://` read whose descriptor close fails answers `-32000` and keeps the
  descriptor in a server-lifetime owner. The next file read retries the close
  first and, while it still fails, answers `-32000` without opening the file.
  `close` retries it again and rejects while it is still open.
- Bound one `/agentenv` response to 64 MiB of replies (twice the intake
  limit). Each reply is measured in bounded JSON parts as it is produced, in
  message order, and assembled only when it fits, so a reply past the budget is
  counted but never serialized whole. Room is kept for every later reply's
  budget error and for a batch's brackets and commas, so the body never
  passes the budget; a reply that does not fit is replaced by `-32000` with
  `data: {max_response_bytes, reply_bytes}`, unless that error is no smaller
  than the reply, so the body is never built past the budget and small write
  replies are kept.
- Validate `rea-state/v1` documents against the served types and views: known
  types, collections that instantiate their template, ids equal to the identity
  field, unique keys, `view_fields` naming item or list views of the type
  without setting the type's identity field to a value whose scalar text
  differs from the entity's id (refused at that view's `fields`),
  documents naming document views once at the initial path, and the optional
  `state_evidence_id` and `types` that `data/get` reports equal to the served
  ones. Refuse numbers without an exact native value. Preserve all own JSON
  members in caller data, including `__proto__`, and reject unknown structural
  members before projecting the document's declared fields.
  Name the first problem by JSON pointer, never deeper than a caller-data
  member (`fields`, `value`, `types`), and leave the state unchanged.
- Keep record citations Evidence provenance: refuse `record_ordinals` or a
  `record_ordinal` other than the Evidence's for that entity or document, and
  hold the Evidence's citations only for loaded values equal to the Evidence's;
  edited or added values cite none.
- In state mode, declare `operations: ["data/reset", "data/add", "data/get"]`
  and the `urn:agentenv:intake/v1` extension, describe tools as answering from
  the state where it backs them, and leave out `POST`, `PUT`, `PATCH` and
  `DELETE` tools other than query `POST`s. The discovery budget reserves the
  card and descriptions actually served (`servedCatalog` returns the tools and
  the data plane the card declares). A state catalog can exceed the budget a
  replay catalog fits, so such a state is unavailable and the environment and
  its export serve replay: everything main served and exported is still
  served and exported.
- The CLI has no `--state`; `--replay-only` (default false) serves replay
  without deriving. Otherwise it prepares the state under the name it serves
  (`ENVIRONMENT_NAME` or the manifest's). When the state is unavailable the
  command logs a warning with the code and message through its listener logger
  before binding, and serves replay. The stopped document's `state` member is
  the report. `serveEnvironment` keeps taking an optional prepared state and
  serves replay without one; the served catalog (`servedCatalog`) and the
  answer function (`environmentToolAnswer`) are shared with export.
- `environment-export` keeps the bundle command
  `rea environment-serve /env/manifest.json --evidence /env/evidence.json` and,
  after its name checks, prepares the state under the bundle name as that
  server will, to predict what it serves, so a refused `--name` derives
  nothing; its report is served or unavailable, never replay-only. The
  verifier's `TOOL_COUNT` and the command's `tool_count` are the served tool
  count, and its check tool and expected status come from calling the server's
  answer function with `{}` on the first served `GET` tool without path
  parameters whose answer is not an error. The verifier and smoke task use the
  id `serve`. The README's "What the environment serves" section describes
  serving from the state, the replay fallback and `--replay-only`, says which
  applies to the bundle (with the code and message when the state is
  unavailable), and keeps the not-emulation and untrusted-content caveats. The
  export output adds `state`. The hosted-lane verifier script expects the
  served count.

## Acceptance and limits

Services tests cover derivation (the by-hand Evidence id and state, a capture
the manifest was not projected from, a capture inline admission refuses),
the prepared reports (served, unavailable for a `capture_browser_scenario`
capture with header values but no response bodies, unavailable with
`resource_constraint` for a 350-tool read-only manifest whose replay catalog
fits), bundle plans served from the state and in replay (tool count, check tool
and status, a check whose state answer differs from replay's in record and
status, a check that skips a tool the server cannot answer, the replay fallback
of that 350-tool manifest, name refusals before any preparation, a manifest
neither mode admits, verifier, smoke task and README wording), the loader
refusals, store reset, order, round trip and
atomic replace, the first-problem pointers, citation provenance after a load and
every answer path: item (including percent-encoded collection segments and
ids), list `all`, list `recorded`, lines recorded after a write or with other
filters, a line replay's tie-break would not pick, document, recorded view, tool
without a view, unrecorded request, missing entity, missing required field and
the body limit, a view value that changes an entity's identity, and a list
member missing a required field. Adapters tests cover the data-plane shapes,
`-32602` for empty and malformed parts and invalid documents, inexact numbers,
bytes, `file://` and its failure categories, `file://` uris naming another
host or a UNC path, injected https downloads (status, declared and streamed
size, the timeout whether or not the fetcher honours its signal), the default
fetch's refused redirects, arrival-order application across requests, a batch
another request's reset cannot split, cancellation by the server's stop and by
a departed caller, a server that closes while a download is stalled, a
retained state-file close that the next file read and `close` retry, the
response budget, batches and notifications, the card declaration, absent write
tools, a served query `POST`, the per-mode discovery reservation and a
`data/add` that changes the next tool answer over MCP. The mcp-boundary tests serve the state the
built CLI derives from only a manifest and a capture, and `--replay-only` with
every manifest tool, `-32601` data-plane answers and a card whose SHA-256
equals that of the card main serves for the fixture; the process-boundary test checks the stopped document's
`state` for a derived state, `--replay-only` and an unavailable state, and the
warning logged before binding; the cli-boundary export test checks the served
tool count, the verifier and the README of an exported bundle. No test reaches
an external network. Write effects, list filters beyond recorded lines and
`tables` in the intake declaration are out of scope.

## Deferred issue criteria

Write effects are a later increment of #4933. This PR must reference rather
than close the issue.
