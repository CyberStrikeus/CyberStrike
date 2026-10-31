# Verification

Verified base: cf4cc6faab0fb2c444ca054db8b98cb981bae6c9 (fetched main).

The worktree carries the manifest-view and streamable-HTTP increments as
commits on that base; this increment's changes are uncommitted edits on top.
Every check below ran as written on this tree in the review-response pass;
nothing is reported that did not run. Timings are macOS `/usr/bin/time -l`
command accounting (elapsed, user, system seconds and maximum resident set
size of the command and the children it waited for).

## Review findings addressed

An adversarial review of the first pass found one should-fix and six nits;
each was repaired at its owning boundary before the gates below ran.

- `POST /agentenv` read its body with `request.json()` on the streamed
  `node:http` body, so a 60 MB payload was buffered before the `-32700`
  answer. The route now reads through the SDK's `readRequestBody` with
  `DEFAULT_MAX_REQUEST_BODY_SIZE`, answering `413` with JSON-RPC `-32000`
  (`id: null`) before parsing, and parses within the bound through the
  domain's `safeParseJson`. The JSON-RPC error helper of the shared listener
  is exported as `jsonRpcErrorResponse` and reused rather than restated.
- A set but blank `ENVIRONMENT_NAME` refuses with `configuration_invalid`,
  as a blank `MCP_HOST` does in the sibling parser; `docs/cli.md` and
  `docs/agent-environments.md` now say so, and the spec records the
  divergence from the design's `||` reading as deliberate.
- The record-coverage refusal in `loadEnvironmentSource` was unreachable for
  authenticated pairs (the Evidence id is computed over `normalized_result`,
  so a matching parent id implies identical records, each with a request
  line by construction of the projector). The branch is gone: cited records
  are indexed unconditionally, a record without a request line is left out
  and the tool refuses at call time through the existing no-record path. The
  claim was removed from `docs/agent-environments.md` and `spec.md`, and the
  services test now asserts an empty manifest indexes nothing and a tampered
  capture is refused by authentication.
- Every advertised input schema closes with `additionalProperties: false`,
  so an unknown argument is refused as invalid arguments instead of silently
  degrading to an omitted one. The agentenv framework's card consumers
  (`verify_env_card.py`, the gateway's `tool.inputSchema` pass-through and
  the spec-conformance normaliser) read `properties` and `required` only, so
  the extra key does not disturb them; the guide names it as a key the echo
  schema does not carry.
- The tool description now reads `METHOD template; replays retained records
  [ordinals]; evidence ev_…`, as the design text specifies.
- `serveEnvironment` passes an `onerror` to the shared listener that logs
  `{ error }` at `error` level and forwards to the caller; the command races
  the cancellation signal against that failure and, on a listener failure
  after binding, closes the listener and returns the same typed
  `resource_constraint` error the bind failure returns (exit `1`) instead of
  serving nothing. The two constructions share one `transportError` helper.
- `tests/boundary/cli/cliStartupImports.test.ts` lists
  `dist/server/environment/serveEnvironment.js` as `environment-server` in
  `DEFERRED_IMPORTS`, so the `--help` probe would fail if the serve command
  ever imported the listener eagerly.

## Setup

`npm ci` exited 0 (540 packages added, 541 audited; 4.79 s elapsed, 3.46 s
user, 7.34 s sys, 880803840 bytes). After the edits above, `npm run build`
exited 0 (three turbo tasks; 4.61 s elapsed, 14.76 s user, 3.23 s sys,
3053060096 bytes) and `npm run test:prepare` exited 0 (six tasks; 1.28 s
elapsed, 2.94 s user, 0.67 s sys, 424935424 bytes), so every built-group run
and built-CLI check below used a `dist/` carrying the revised serve command.

## Static gates

Each exit 0 on the final tree: `npm run check:fast` (typecheck and lint,
2 tasks; 4.76 s elapsed, 23.36 s user, 2.56 s sys, 4458840064 bytes). `npm run
format` (4064 files; 0.93 s elapsed, 4.12 s user, 0.76 s sys, 226344960
bytes) then `npm run format:check` (all 4064 files formatted; 0.64 s elapsed,
4.19 s user, 0.66 s sys, 219906048 bytes). `npx knip` (no findings; 3.49 s
elapsed, 4.92 s user, 0.63 s sys, 871645184 bytes). `npm run check:ci:tasks`
(8 tasks successful, 2 served from the turbo cache; `lint:built` 3756 files,
0 errors; jscpd 3164 files, 2583 clones, 3.34% duplicated lines under the
3.5% threshold; the stray-marker scan; 7.16 s elapsed, 26.46 s user, 5.88 s
sys, 2939142144 bytes). `npm run verify:architecture-guards` passed across
1523 source files and `npm run verify:test-discovery` discovered all 1592
test files exactly once. `npm run docs:check` (six tasks plus the README
consistency test, 5 cases; 3.37 s elapsed, 3.49 s user, 0.84 s sys,
291618816 bytes). After the last edit of this record, `npm run format`,
`npm run format:check` and `npm run docs:check` were rerun (each exit 0) and
the same static set was rerun uncached as `npx turbo run typecheck lint:built
format:check knip metadata:check jscpd scan:todos --force` (8 tasks
successful, 0 cached, 3.34% duplication; 8.40 s elapsed, 48.82 s user, 7.77 s
sys, 4638474240 bytes). A case-insensitive grep for the forbidden words and
marker comments over all 28 new or modified files found nothing.

## Test projects

Source group on the final tree: `/usr/bin/time -l npx vitest run --project
services --project adapters` passed 343 files, 5196 tests with 8 skipped, in
99.55 s elapsed, 93.60 s user, 28.88 s sys, 1781055488 bytes. The increment's
files are `environmentSource.test.ts` (4 tests: pair authentication and
exchange indexing, parent mismatch as `invalid_request` with path
`["evidence","evidence_id"]`, other view kind, non-capture evidence and
non-Evidence JSON, an empty manifest indexing nothing with a tampered capture
refused by authentication), `environmentTools.test.ts` (5 tests: ordered
mapping and the `; evidence` description, required path parameters with rule,
observed values and `additionalProperties: false`, optional query strings
without a body for reads, a body object for writes, the card's key order),
`environmentReplay.test.ts` (7 tests, unchanged in this pass) and
`serveEnvironment.test.ts` (5 adapters tests: the card text byte-equal to the
echo card shape with the fixture tools, `/agentenv` answering `-32601` with
`-32700` for a malformed body, a route-level body of
`DEFAULT_MAX_REQUEST_BODY_SIZE` plus envelope answered `413` `-32000` with
`id: null`, a full listener driven by the SDK streamable HTTP client with
`_meta` equal to `TARGET_CONTENT_RESULT_META`, exact and inexact replays, an
argument-less call and an unknown argument both refused with `isError`, and
the `renamed` override with an oversized body answered `413` through
`node:http` and a released port).

Focused built group after `test:prepare`: `npx vitest run --project
cli-boundary --project mcp-boundary --project process-boundary --project
boundary` over `environmentServeCli`, `environmentServeMcp`,
`environmentServeShutdown`, `mcpHttpShutdown`, `streamableHttpMcp`,
`cliToolCoverage`, `cliStartupImports` (now carrying the `environment-server`
deferred import), `dispatcher`, `productCatalog`, `documentationFacts` and
`ciTestProjects` passed 11 files, 33 tests (16.38 s elapsed, 25.77 s user,
5.94 s sys, 941948928 bytes).

Full built-group projects ran one after another on the final `dist/` from a
background shell while the built-CLI exchange below ran in the foreground.
`/usr/bin/time -l npx vitest run --project mcp-boundary` passed 156 files
with 2 skipped, 914 tests with 7 skipped, in 166.23 s elapsed, 319.51 s user,
46.18 s sys, 4452171776 bytes. `/usr/bin/time -l npx vitest run --project
cli-boundary` exited 1: 109 files passed and 3 failed, 663 tests passed,
2 skipped and 7 failed, in 432.45 s elapsed, 725.28 s user, 213.32 s sys,
641597440 bytes. No failing file belongs to this increment.
`javascriptApplicationJsonOutput.test.ts` (4 cases) and
`javascriptApplicationProgress.test.ts` (2 cases) failed with the worker's
result-capacity constraint ("The parent's result capacity was exhausted
after retaining static facts for main.js"); rerun together on the idle host
after the chain they passed 2 files, 17 tests (17.05 s elapsed, 26.40 s user,
8.47 s sys, 282394624 bytes), the load classification the previous pass
recorded. `closedStdout.test.ts` "stops quietly when the reader closes during
streamed JSON" exits `1` instead of `141` with 1009 bytes received, alone as
well as in the project, the environmental failure the previous pass
reproduced on a clean clone (macOS, Node 22.23.1, npm 12.0.2).
`commandFinalizationCancellation.test.ts`, which the previous pass saw fail
on worker order, passed in this run.

`/usr/bin/time -l npx vitest run --project process-boundary` exited 1: 56
files passed, 2 skipped and 3 failed, 463 tests passed, 19 skipped and 5
failed, in 431.71 s elapsed, 148.34 s user, 114.81 s sys, 710000640 bytes.
`environmentServeShutdown.test.ts` and `mcpHttpShutdown.test.ts` passed inside
it. `jadxIntegration.test.ts` failed three cases at the 30 s test and 10 s
hook timeouts ("retires an idle engine", "completes large class inventories",
"close cancels active and queued work"), the lane the previous pass recorded
as moving between runs on this host. `releaseArtifactCanary.test.ts` fails
parsing `npm pack --json` ("expected tuple, received object"), the npm 12.0.2
shape the previous pass reproduced on a clean clone.
`processCaptureLifecycle.test.ts` "keeps the process deadline bounded when the
wall clock moves backward" failed with `expected false to be true` on
`result.ok`; rerun alone on the idle host it failed the same way with 23
passed (38.12 s elapsed, 9.84 s user, 18.07 s sys, 323076096 bytes). The file
and `src/process/` are untouched by this increment and the case mocks
`Date.now` around a real process capture with a 1.5 s fallback abort; it is
recorded as a host-dependent failure of that lane, not classified further
here.

## Built-CLI exchange on the prototype capture

`node scripts/rea.mjs inspect-web-network-capture grafana-like.har har
--format json` wrote capture Evidence `ev_4ee4759b…` with 28 records;
`inspect-analysis-view` with the inline source and all three template rules
wrote manifest Evidence `ev_6553a8e5…` naming that parent, `grafana-example`,
19 tools. `environment-serve manifest.json --evidence capture.json --port 0
--json < /dev/null` announced one stderr line
`{"transport":"streamable-http","url":"http://127.0.0.1:62305/mcp","msg":"MCP transport listening"}`
and nothing on stdout until shutdown.

`GET /.well-known/agent-env.json` returned a card whose top-level keys,
`capabilities` keys and tool keys equal the echo card's in order; its
`inputSchema` keys are `type`, `properties`, `required` and
`additionalProperties`, the echo card's three plus the closing key. Fixed
fields: `protocolVersion` `1.0`, `url` `/agentenv`, `preferredTransport`
`JSONRPC`, `additionalInterfaces` `[{url:/mcp,transport:mcp}]`, `extensions`
null, `operations` `[]`, `children_environments` null, 19 tools, with
`get_users_by_id` described as `GET /api/users/{numeric}; replays retained
records [5, 6]; evidence ev_4ee4759b…`.

The Python `mcp` 1.30.0 client (httpx 0.28.1) initialised against
`grafana-example 6.6.0` (protocol 2025-11-25), listed 19 tools, called
`get_users_by_id {"id":"2"}` and read `body.login == "probe"`,
`replay.exact_match == True`, `_meta.provenance.untrusted_content == True`
with `source == "analysis_target"`; `{"id":"999"}` gave `exact_match ==
False`; `get_folders_by_uid {"uid":"general"}` gave `recorded_path ==
"/api/folders/general"`; `get_search {"query":"probe","type":"dash-db"}`
returned a list body whose first title is `probe dashboard` with
`recorded_query == "?query=probe&type=dash-db"`; `get_users_by_id
{"id":"2","unknown":"x"}` returned `isError == True` with no structured
content.

`POST /agentenv {"jsonrpc":"2.0","id":1,"method":"data/reset"}` returned
`{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"method not found: data/reset"}}`.
A 60 MB non-JSON POST with a `Content-Length` header was answered `413`
`{"jsonrpc":"2.0","error":{"code":-32000,"message":"Request body must not exceed 4194304 bytes"},"id":null}`
after curl had sent 768332 bytes, in 1.4 ms, with the server's resident set
269024 KiB before and 269040 KiB after; the same file sent chunked without a
length was answered `413` after 5237311 bytes in 9.9 ms, resident set 267952
KiB before and 274208 KiB after, so the read stops at the bound on both
paths. A malformed body within the bound (`{`) was answered `400`
`{"jsonrpc":"2.0","error":{"code":-32700,"message":"parse error"},"id":null}`.

SIGTERM ended the process with status 143 after one stdout document
`{"status":"stopped","url":"http://127.0.0.1:62305/mcp","environment":"grafana-example","tools":19,"evidence_id":"ev_4ee4759b…","manifest_evidence_id":"ev_6553a8e5…"}`.
A restart with `ENVIRONMENT_NAME=renamed` served a card named `renamed`,
reported `"environment":"renamed"` in its stopped document and also exited 143. `ENVIRONMENT_NAME=` (set, blank) exited 1 before binding with
`{"code":"configuration_invalid","details":{"settings":[{"setting":"ENVIRONMENT_NAME",…}]}}`.
The manifest served against the capture of one selected record (`--record
0`, `ev_3249d233…`) was refused with exit 1 and
`{"code":"invalid_request","details":{"operation":"environment-serve","issues":[{"path":["evidence","evidence_id"],"reason":"invalid_value","expected":"ev_4ee4759b…",…}]}}`
whose message names both identifiers; omitting `--evidence` exited 1 with
Incur's `VALIDATION_ERROR` naming `evidence`. No `rea.mjs` process or
listener remained after these runs.

## Independent review

The adversarial review of the first pass is the independent review of this
increment; its findings and their repairs are listed above. One further
observation surfaced while repairing them: the byte-identical card assertion
in `serveEnvironment.test.ts` compares the `inputSchema` object exactly, so
closing the schema required extending that expectation as well as the
services tests, which is the intended coupling between the card and the
advertised MCP schema.

## Scope and measurement limits

The echo-card comparison is exact on keys, nesting and tool entries; the
property names inside `inputSchema.properties` necessarily differ from the
echo tool's single `text` property, and `inputSchema` carries one key the echo
schema does not. `exact_match` is defined over supplied values only; omitted
parameters cannot mismatch, and a call without arguments is exact on the
tool's first record. Request bodies on write tools are accepted and ignored.
The post-bind listener `error` path is wired and type-checked but not
provoked by a test, since the shared listener does not expose its
`node:http` server. These recorded runs predate the required non-loopback Host/Origin allowlist;
the Python exchange, curl checks and tests recorded here used `127.0.0.1`.
The current contract and later non-loopback coverage are described in the
[transport specification](../http-transport/spec.md).
Replay selection and body parsing were measured on the 28-record fixture
only; no large-capture timing was taken. Resident-set figures are `ps` samples
of the serving process before and after one request each. Token usage and
full process-family peak are unmeasured; the `/usr/bin/time -l` figures
account for each command and the children it waited for. Windows was not
run.
