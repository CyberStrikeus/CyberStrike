# Verification

Verified base: 18aa9af2b2c26fd114113dd39528a91224801840 (fetched main).

The worktree was moved onto that base with the slice's changes kept
uncommitted, then reinstalled with `npm ci` (exit 0; 540 packages added, 541
audited; 6.56 s elapsed, 3.85 s user, 8.07 s sys, 881459200 bytes maximum
resident set size). After the edits of this pass the tree was rebuilt with
`npm run build` (exit 0, three turbo tasks; 5.23 s elapsed, 13.94 s user,
2.93 s sys, 2964652032 bytes) and `npm run test:prepare` (exit 0, six tasks
with three cache hits; 1.37 s elapsed, 3.07 s user, 0.76 s sys, 422625280
bytes); `dist/mcp/` carries the rebuilt `serveStreamableHttp-*.js` chunk beside
`main.js`.

Static gates on the final tree: `npm run check:fast` passed (typecheck and
lint, two tasks; 4.69 s elapsed, 24.25 s user, 3.00 s sys, 4480139264 bytes).
`npx oxlint` over the files touched in this pass reported no findings. After
the last edit, including this record, `npm run format` ran over 4032 files
(0.68 s elapsed, 4.11 s user, 0.74 s sys, 227393536 bytes) and `npm run
format:check` passed (0.69 s elapsed, 4.09 s user, 0.62 s sys, 216989696
bytes). `npx knip` exited 0 (3.80 s elapsed, 5.10 s user, 0.72 s sys,
868679680 bytes). `npm run check:ci:tasks` passed all eight tasks, seven of
them turbo cache hits from the run on the same sources (0.88 s elapsed, 4.52 s
user, 1.04 s sys, 215171072 bytes): jscpd reported 2576 clones and 3.35%
duplicated lines across 3143 files under the 3.5% threshold, lint:built 0
errors over 3734 files, and format:check ran fresh. `npm run docs:check`
passed, including the README consistency test (5 cases; 3.27 s elapsed,
3.43 s user, 0.80 s sys, 288866304 bytes). `git diff --stat` lists 13 tracked
files, none under `src/domain/`.

Source-group tests: `/usr/bin/time -l npx vitest run --project adapters
src/server/http src/server/shutdownRegistration.test.ts` passed 3 files, 17
tests in 2.74 s elapsed, 3.12 s user, 0.93 s sys, 289767424 bytes.
`serveStreamableHttp.test.ts` gained the concurrent case: a slot with one open
session receives two `initialize` requests through `Promise.all`, exactly one
answers `200` with a session id and the other `400`, the instance's `onclose`
hook has fired zero times, and `slot.close()` fires it once. Run before the fix
against the same file, that case failed with the hook count `0` instead of `1`
(1 failed, 5 passed; 1.07 s elapsed, 0.84 s user, 0.21 s sys, 158187520
bytes), which is the pinned no-op hook the review described.
`shutdownRegistration.test.ts` asserts that `registerProcessShutdown` hands
the handler `SIGINT`/`SIGTERM` by name and `undefined` for stdin end, that
omitting stdin registers no input listener, and that `registerSignalShutdown`
reports `143`/`130`.

Built-group tests ran after `npm run test:prepare`. The targeted dispatcher
run, `/usr/bin/time -l npx vitest run --project cli-boundary
tests/boundary/cli/dispatcher.test.ts`, passed 3 tests in 1.08 s elapsed,
0.89 s user, 0.26 s sys, 153026560 bytes, now including `mcp add --http`
routed to the CLI beside `mcp --http --port 0`, `--mcp --http` and `mcp --host
127.0.0.1 --http` routed to the HTTP entry and `mcp doctor --http`, `mcp add`
and `--mcp extra` keeping their routes.

The four full projects ran in sequence while a sibling worktree ran its own
`cli-boundary`, `mcp-boundary` and `acceptance` chain on the same host.
`/usr/bin/time -l npx vitest run --project adapters` passed 247 files, 3945
tests with 8 skipped, in 93.77 s elapsed, 80.21 s user, 30.69 s sys, 344260608
bytes. `/usr/bin/time -l npx vitest run --project mcp-boundary` passed 155
files with 2 skipped, 910 tests with 7 skipped, in 167.51 s elapsed, 321.24 s
user, 51.30 s sys, 4923490304 bytes (the Vitest parent, its workers and the
spawned CLI children). `/usr/bin/time -l npx vitest run --project
process-boundary` exited 1: 56 files passed, 2 skipped and 2 failed, 460 tests
passed, 19 skipped and 7 failed, in 544.81 s elapsed, 160.89 s user, 133.49 s
sys, 1028931584 bytes. `/usr/bin/time -l npx vitest run --project
cli-boundary` exited 1: 108 files passed and 3 failed, 658 tests passed, 2
skipped and 7 failed, in 452.34 s elapsed, 734.29 s user, 234.02 s sys,
648495104 bytes. No failing file belongs to this slice.

The failures split into two kinds. Load: six `jadxIntegration.test.ts` cases
hit the 30 s test or 10 s hook timeout, and six `javascriptApplication*.test.ts`
cases failed with the worker's result-capacity constraint; re-run alone in this
worktree after the other chains ended, `jadxIntegration.test.ts` passed all 48
tests and both JavaScript files passed all 20 tests (`cli-boundary` three files:
20 passed, 1 failed, 23.38 s elapsed, 32.99 s user, 10.97 s sys, 343244800
bytes; `process-boundary` two files: 48 passed, 1 failed, 62.48 s elapsed,
21.89 s user, 17.55 s sys, 686620672 bytes). Pre-existing on main in this
environment: `closedStdout.test.ts` "stops quietly when the reader closes
during streamed JSON" exits `1` instead of `141` with 1009 bytes received and
empty stderr, and `releaseArtifactCanary.test.ts` fails parsing `npm pack
--json`, which npm 12.0.2 emits as an object keyed by package name rather than
the tuple the test expects. Both reproduce identically on the clean sibling
clone at `52b73ee857029a3ab8f5c6eeef233b295951a46c` (no tracked or untracked
changes; `closedStdout` 1 failed, 3 passed, 8.86 s elapsed, 6.98 s user, 2.29 s
sys, 348012544 bytes; the canary 1 failed, 7.91 s elapsed, 7.76 s user, 1.84 s
sys, 668729344 bytes). That clone predates the verified base by 15 commits,
none touching either test or `scripts/rea.mjs`. Because the dispatcher is on
the `closedStdout` path, its scenario was also replayed against this
worktree's built `dist/` with the `18aa9af2` `scripts/rea.mjs` and with the
edited one, three runs each: all six exited `1` with 1009 bytes received and
empty stderr. Nothing in this pass was changed for these failures.

Cross-implementation check with the Python `mcp` 1.30.0 client (httpx 0.28.1,
Python 3.12.12) against the built `node scripts/rea.mjs mcp --http --port 0 <
/dev/null`: stderr announced
`{"transport":"streamable-http","url":"http://127.0.0.1:57093/mcp","msg":"MCP transport listening"}`.
Session A: `initialize` POST returned `200 text/event-stream` with
`mcp-session-id`; `notifications/initialized` returned `202` with no body; the
standalone GET and the `tools/list` and `tools/call` POSTs returned `200
text/event-stream`; `tools/list` reported 207 tools including
`binary_session`; `binary_session` with `{}` returned `isError=False`; `DELETE
/mcp` returned `200`. Session B, opened after that `DELETE`, initialized with a
new session id, listed the same 207 tools, and `binary_session` again returned
`isError=False` before its own `DELETE` returned `200`. The server logged two
`MCP HTTP session opened` and two `MCP HTTP session closed by the client`
lines, SIGTERM then exited it with status `143`, and stdout stayed empty. The
methods, statuses and session-id handling of session A match the recorded
reference exchange step for step; the reference's echo server labelled its
`202` and `DELETE` replies `application/json`, where this listener sends no
content type for those bodiless replies.

## Independent review

An adversarial review of the first implementation reproduced that, after a
`DELETE`, the next session could initialize and list tools but every tool call
failed with a `cancelled` error because the SDK's `DELETE` handling closed the
transport and the server's `onclose` hooks ran provider teardown. It also found
that a session ended without `DELETE` blocked the listener until restart, that
the bind-failure log line omitted the system cause, a duplicated foreign-`Host`
probe, a missing trailing newline on `rea mcp --http --help`, and a static
import of the HTTP listener on the stdio path. Each finding is addressed and
covered by the adapters, mcp-boundary and Python checks in this document.

The re-review of the rebased tree raised four points, all resolved here. Two
concurrent `initialize` POSTs could leave the no-op `onclose` hook installed,
because each session end captured the hook current at that moment and the
later `finally` restored the other call's no-op; `McpSessionSlot` now captures
the instance's hook once, after the factory returns the fully wrapped server,
and every session end restores exactly that, with the adapters case above
failing before and passing after the change. The optional stdin parameter of
`registerProcessShutdown` was dead in production; `registerSignalShutdown` is
now a projection of `registerProcessShutdown(handler, { signals })`, so one
primitive owns registration while the handler learns the signal and keeps
`130`/`143`. The dispatcher routed any `mcp` invocation containing `--http` to
the HTTP entry; it now does so only when the first token after `mcp` or
`--mcp` is a flag, so `rea mcp add --http` keeps the CLI's own diagnostic, and
the dispatcher test covers that case. The formatter hunk in
`src/domain/propertyListXml.test.ts` noted in the earlier record is gone after
the rebase, as `git diff --stat` confirms. The replacement rule stays as
documented, and `docs/mcp-contracts.md` now states it in one sentence with its
rationale so maintainers can decide on it.

## Scope and measurement limits

The concurrent-`initialize` case is exercised at the slot with in-memory
`Request` objects, where both calls advance in lockstep; over TCP two
connections are served in separate event-loop turns, so the race is reachable
only in-process and the listener-level behaviour remains "the newest client
owns the server, the other sees `400` or `404`". Those recorded runs predate the mandatory non-loopback allowlist and did not
exercise a wide bind. The current requirement and later listener regression
coverage are described in the [specification](spec.md). Sessions are served one at a time;
concurrent clients are not supported. The two failures that reproduce on the
clean clone are environmental (macOS with Node 22.23.1 and npm 12.0.2) and are
left for their owners; the load-induced timeouts were classified by isolated
re-runs, not by repeating the full projects on an idle host. The error-level
log line that names the bind cause was observed in earlier runs, not asserted
by `mainErrors.test.ts`. Response budgets keep the stdio-derived floor and were
not re-measured over HTTP. Windows was not run.

## Automated review findings on the PR (2026-10-18)

Codex and Greptile left eight inline findings on morluto/rea#4955 at
46dd8f0e; each was checked against the code and addressed in one follow-up
commit, with a regression test where the behaviour is observable:

- A late `initialize` could arm a fresh transport after shutdown (Codex, P1):
  the slot now records that it is closed, `close()` joins an arming session
  before ending it, and every request after that is refused with `503`. Test:
  an initialize racing `close()` gets `503`, the shutdown hook fires once, and
  the next request gets `503`.
- A failed `close()` was memoized forever (both reviewers, P1): the close runs
  three stages once each and a failed stage is retried by the next call. Test:
  the instance's first `close()` rejects, the second call resolves and the port
  is released.
- Loopback aliases skipped Host validation (both reviewers, P2 and P1): a bind
  is now loopback by address class (`127.0.0.0/8`, `::1`, IPv4-mapped loopback,
  `localhost` names) after the same normalization the SDK applies to the Host
  header, and the allowlist adds the bind's own hostname so requests to
  `127.0.0.2` or `localhost.` are still served. Test: twelve spellings.
- A sessionless POST could close the live session before any header check
  (Greptile, P1): on loopback binds the route validates `Origin` with the same
  allowlist as `Host`, and only a POST carrying `Content-Type:
  application/json` and an `Accept` naming both `application/json` and
  `text/event-stream` may replace a session; others reach the live transport,
  which refuses them. Test: a `text/plain` initialize and one with a foreign
  `Origin` are refused (4xx and 403) while the connected client keeps echoing.
- The bound URL disappeared at quiet log levels (Greptile, P2): the listening
  line is written through a child logger pinned to `info`. Test: a `warn`
  logger still receives the line with the URL.
- `rea mcp -h --http` reached the ordinary CLI (Greptile, P2): the dispatcher
  predicate accepts any flag after the entry. Test: the dispatcher case.

Checks after the change: `oxfmt --check .` clean; `tsc --noEmit` clean;
`oxlint` on the touched sources clean after extracting the staged close into
its own function; `npx knip` no findings; `npm run jscpd` 3.35 % duplicated
lines; `scan:todos` none; `verify:test-discovery` 1,583 files once; `vitest
run` over the listener and bridge adapters tests 14 passed in 2 files; after
`npm run build:cached`, `vitest run` over the dispatcher, option, streamable
HTTP, shutdown and main-error boundary tests 22 passed in 5 files.

A second automated round on the fix (Codex, two P2 findings) was addressed in
the next commit: the replacement guard compares the media type proper, so
`application/json-patch+json` no longer counts as JSON (test: such an
initialize is refused while the connected client keeps echoing), and the
server instance is created only after the listener has bound, so a bind
failure has nothing to clean up and a factory failure releases the listener
and rethrows (test: a throwing factory rejects without announcing a URL).

A third round (Greptile and Codex, five findings) was addressed next: the
listener's `error` forwarding to `onerror` is registered after the bind, so
`EADDRINUSE` prints only the listen-failure message (test: an occupied port
rejects without calling `onerror`); scoped IPv6 literals are refused before
binding and a URL that cannot be formed from the bound address closes the
listener (test: `fe80::1%lo0` rejects before the factory runs); loopback is
classified from the bound address with the configured name added to the
allowlist (test: `ip6-localhost` bound to `::1`, `dev.local` bound to
`127.0.0.1`); and the MCP runtime passes `closeInstance: false` so the factory
owner in `startMcpTransport` remains the single owner of instance cleanup
(test: `close` leaves the instance open until its owner closes it).

A fourth round (Codex, two findings) was addressed next: the replacement
guard parses `Accept` into media ranges and requires exact `application/json`
and `text/event-stream` entries (test: `application/json-patch+json,
text/event-streaming` is refused while the connected client keeps echoing),
and a session whose transport shutdown rejected stays owned so the next close
retries it (test: a failing transport close rejects `close()` once, the second
call completes, the shutdown hook fires once and later requests get `503`).

A fifth round (Codex, three findings) was addressed next: the instance's
shutdown hook now runs exactly once even when the listener closes without a
live session (test: two closes of an idle slot fire it once; an idle listener
close fires it once); the initialize probe no longer awaits cancelling its
cloned body, which is one branch of a tee and would wait for the original
request to drain (test: a 4.5 MB sessionless initialize is refused promptly
while the connected client keeps echoing); and the node:http bridge passes
repeated `Set-Cookie` values as an array instead of collapsing them (test: two
cookies from a composed route both arrive).

A sixth round (Codex, one P1) was addressed next: signal handlers were only
installed after the asynchronous startup returned, so a SIGINT or SIGTERM
during target opening, provider loading or the HTTP bind ended the process
without cleanup. The HTTP entry now latches signals before startup, the
lifecycle owner picks the recorded signal up as soon as it registers, and a
second signal during startup exits at once (test: the latch records `143`,
exits on the second signal, hands the status over on release and leaves no
listeners behind).

Both reviewers then noted that the latched signal's status was overwritten by
the entry's normal `0` return: the HTTP entry now owns its exit status through
`createExitStatus`, where a `0` after a recorded signal keeps the signal's
status and a real failure still wins (unit test), and a process test sends the
signal the moment the listening line appears and asserts the signal status.

An eighth finding (Codex): a reply sent before the MCP handler read the body
left that body unread on a paused bridged stream, so a slow uploader could
hold the socket. The bridge now closes the connection after any reply whose
request body was never read (test: an unknown-route POST and a foreign-Host
POST are answered with `Connection: close`, while a keep-alive GET without a
body keeps its connection).

A ninth round (Greptile and Codex): request conversion ran outside the guard,
so a method Fetch refuses (`TRACE`) could crash the process; the conversion is
now guarded and answered with `405` and a closed connection (test: `TRACE`
gets `405` and the next client still echoes). The unread-body decision now
comes from the incoming message's own body declaration, so a `GET` or `HEAD`
that carries a body also closes, and the regression uses a keep-alive agent
and checks that the socket actually closes after the early reply while a
bodiless `GET` keeps its socket.

A tenth round (Codex, three findings): the takeover guard now requires a lone
`initialize`, mirroring the transport (test: a batch of `initialize` plus
`notifications/initialized` is refused while the connected client keeps
echoing); the shutdown hook records completion only after it returns, so a
hook that threw stays eligible for the next close (test: a hook that throws
once runs twice across two closes and then no more); and the bridge joins the
request target onto the listener's origin verbatim, refusing absolute-form
targets (test: `//attacker.example/card` is a 404 for that path, a plain route
sees the bound host only, and `http://attacker.example/card` gets `400`).

An eleventh finding (Codex): URL construction canonicalized dot segments, so
`/public/../mcp` reached `/mcp`. The bridge now refuses any target whose path
differs after URL parsing, so routing always sees the path the client sent
(test: `/public/../mcp`, `/public/%2e%2e/mcp` and `/./mcp` get `400`; `/card?x=1`
still routes).

A twelfth finding (Codex): `bodyUsed` means disturbed, not consumed, so a
composed route that read one chunk of an upload left the rest paused on a
keep-alive socket. The close decision now uses the incoming message's end of
stream (test: a route that reads one chunk of a 256 KiB upload is answered
with `Connection: close` and a closed socket; a route that reads it all keeps
the connection).

A thirteenth round (Codex): an `Accept` range with `q=0` no longer counts toward
the takeover guard (test: `application/json;q=0, text/event-stream` is refused
while the connected client keeps echoing). The same round noted that a failed
startup leaves cleanup of the already opened session and providers to a single
attempt; that path is the pre-existing stdio startup-failure cleanup, which the
HTTP mode now reaches on `EADDRINUSE`, and is left for the maintainers to decide.
