# Serve an environment manifest as a replay environment

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

`rea environment-serve <manifest.json> --evidence <capture.json> [--host H]
[--port N]` serves an environment manifest, projected by `inspect-analysis-view`
from retained HAR capture Evidence, as an agent environment: an MCP server at
`/mcp` with one tool per manifest tool that replays the retained records the
tool cites, the environment card at `/.well-known/agent-env.json` in the shape
the agentenv framework's echo example publishes, and a `/agentenv` data plane
that answers every JSON-RPC method as not found. Nothing is fetched from the
recorded application; every answer is retained Evidence marked as target
content. This increment adds the serve command only; exporting a bundle is a
later increment.

## Requirements

- Read both files as bounded JSON input, authenticate each as REA Evidence and
  require `inspect_analysis_view` Evidence of kind `environment-manifest` and
  complete `inspect_web_network_capture` Evidence; refuse any other pair with an
  `invalid_request` whose issue path names the offending file.
- Forward caller cancellation to file reads and check startup boundaries before
  authentication/listener work; an already observed abort must not bind or
  announce a listener.
- Refuse a manifest whose `parent_evidence_id` differs from the evidence file's
  `evidence_id` before binding any port; Evidence authentication covers the
  capture's records, so no further record-coverage refusal is defined.
- Build an `McpServer` from the manifest alone: each tool's input schema lists
  every path parameter as a required string described by its segment index,
  rule and observed values, every observed query name as an optional string,
  and an optional `body` object for `POST`, `PUT` and `PATCH` (a query name
  that collides with a path parameter becomes `query_<name>`, a query name
  longer than 64 characters becomes `query_<n>`, and the body
  becomes `request_body` when a query parameter is named `body`), closed with
  `additionalProperties: false` so unknown arguments are refused; the
  description reads `METHOD template; replays retained records [ordinals];
  evidence ev_…`. The served catalog stays separate from REA's own tool
  contracts and digests.
- Prefix tool descriptions with the shared captured-catalog warning so
  standalone card readers receive the trust notice before MCP initialization.
- Bound each path-observation, body-key and cited-ordinal description sample to 1 KiB
  of UTF-8 whole values before joining them, with a separate omitted-count and
  manifest-Evidence notice. Keep complete arrays and replay semantics unchanged.
- Bound captured method, path and query-name prose to UTF-8-safe display prefixes
  under the same budget, with an explicit full-value Evidence notice. Preserve
  complete lookup values; long path and query names use collision-safe aliases.
- Parse a recorded query only when supplied query arguments can affect selection.
- Replay by selecting, among the tool's cited records, the one whose path
  segments at the parameter indexes match the most supplied values, then the
  most of those segments equal to the value as written rather than only after
  percent-decoding, then the most supplied query values, keeping manifest order
  on ties; return `status`,
  `content_type`, `body` (parsed JSON for JSON-like content types with safe numeric conversion,
  else text; bodies over 256 KiB cut at a UTF-8 boundary with
  `truncated: true`) and `replay` with `record_ordinal`, `evidence_id`,
  `exact_match`, `recorded_path` and `recorded_query` (each cut to 1 KiB, with
  `recorded_line_truncated`; an explicit empty query is `?`), `body_recorded` (false
  when the capture kept no response body, so a `null` body is not mistaken for
  a recorded one), `body_encoding` (`base64` when the retained bytes are not
  UTF-8, so they are returned exactly rather than decoded lossily) and
  `truncated` (a large retained base64 body is decoded only up to that limit),
  as both
  structured content and text, with REA's existing target-content provenance
  marker in `_meta`.
- Serve the card with exactly the echo example's keys and nesting: `name`
  (`ENVIRONMENT_NAME` from the environment snapshot, else the manifest name; a
  set but blank value is refused as `configuration_invalid`),
  `protocolVersion` `1.0`, `url` `/agentenv`, `preferredTransport` `JSONRPC`,
  `additionalInterfaces` `[{url: /mcp, transport: mcp}]`, `capabilities` with
  `extensions: null`, the tools and `operations: []`, and
  `children_environments: null`. Read the `/agentenv` body within the SDK's
  4 MiB bound and answer `413` with JSON-RPC `-32000` beyond it.
- Resolve host and port as `rea mcp --http` does (flags, `MCP_HOST`/`MCP_PORT`,
  then `127.0.0.1` and port `0`), announce the bound URL as one pino JSON line
  on stderr, serve through the shared streamable HTTP listener, and run until
  SIGINT or SIGTERM only, then close, print one `stopped` document and exit
  `130` or `143` through the shared command cancellation handler; a signal
  during loading returns `cancelled` before binding; a listener
  failure after binding is logged and ends the command with a
  `resource_constraint` error and exit `1`.
- Register the flat `environment-serve` command in the CLI inventory with
  described arguments and no MCP tool contract; keep the CLI wiring thin, the
  mapping and replay in the application layer and the server assembly in the
  server layer; load the listener lazily so the command catalog registers
  without it.

## Acceptance and limits

Services tests cover source loading and each refusal, tool mapping and schema
derivation, the card shape, exact and best-effort selection, query matching,
tie order, text and non-parsing bodies, truncation at a UTF-8 boundary and
base64 content. Adapters tests byte-compare the served card with the echo card
shape carrying the fixture tools, drive `/agentenv` including a body over the
bound, and call tools over the SDK streamable HTTP client with provenance and
the unknown-argument refusal asserted. The mcp-boundary test
spawns the built CLI on a manifest and capture produced from the slice-1
Grafana-shaped fixture and asserts tool count, an exact `get_users_by_id`
replay with `body.login === "probe"`, an inexact replay, the card under
`ENVIRONMENT_NAME` and the data-plane refusal; the cli-boundary test covers
the mismatched-parent refusal, the missing `--evidence` usage error and an
unreadable path; the process-boundary test asserts a `143` exit with a
released port. Replay validates no supplied values, performs no network
activity and establishes no authorization, response semantics or state
transitions. One MCP client is served at a time, as the shared listener
defines. Non-loopback binds require `MCP_ALLOWED_HOSTS` and retain both Host
and Origin checks. Shared listener regressions exercise a wildcard bind,
configuration refusal, port release and admitted/foreign request headers;
the original environment-serving fixture runs below used loopback.

## Resource and cancellation boundaries

- Whole discovery admission reserves at most 1 MiB using six bytes per UTF-16
  unit plus schema overhead before retaining each schema property. Aggregate
  tools, arguments and selected environment identity participate; oversized
  catalogs fail with a non-retryable capacity error before bind. The calibration
  used 1500 query fields with eight concurrent discovery requests; compact wire
  size can be smaller than the conservative reservation.
- Query matching scans selected names one field at a time; path scoring scans
  once and retains only supplied parameter coordinates. Native form-decoding
  semantics, malformed escape handling and complete captured facts are preserved.
- Content-type display is bounded to 1 KiB and reports `content_type_truncated`;
  complete media-type semantics remain available to body interpretation.
- Cancellation also owns DNS/listen startup; an observed abort closes the
  listener before its URL is announced.

## Deferred issue criteria

Exporting a manifest and its evidence as an agent-environment bundle with a
verifier, and the hosted verification lane, are later independent increments
of #4933. This PR must reference rather than close the whole issue.

Numeric data-plane IDs that lose value through JSON number conversion are invalid
requests with null response IDs, rather than silently changed correlation values.
