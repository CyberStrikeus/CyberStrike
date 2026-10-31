# Verification

Verified base: 6676582675e08574146a812ae58cff67e2e53282 (this branch's head),
with the review fixes of this pass uncommitted.

Executed on the implementation worktree on macOS with Node v22.23.1 (the
repository pins 24.18.0 in `.nvmrc`, which was not installed). Every check
below ran as written after the last source change, in this order.

- `npm run format` then `npm run format:check`: passed (4330 files).
- `npm run check:fast`: typecheck and lint passed. The lint report holds 0
  errors and no diagnostic in any file this pass touches.
- `npx knip`: passed (exit 0, no findings).
- `npm run jscpd`: 3.37% duplicated lines over 3373 files (2800 clones), under
  the 3.5% gate; no clone involves a file this pass changed.
- `npm run scan:todos`: passed, no markers.
- `npm run docs:check`: the built documentation checks (6 tasks) and the README
  consistency conformance test (5 tests) passed.
- `npx vitest run --project domain --project services`: 347 files, 5948 tests
  passed, 5 pre-existing skips.
- `npm run build:cached` (the built output already included this pass's
  sources), then `npm run test:focused --` the serve CLI, MCP and process
  boundaries, the export CLI boundary, the CLI startup imports, the agentenv
  verifier identity boundary, the bundle package pin conformance test, the CI
  change scope boundary, the analysis-view CLI and MCP boundaries, and the
  `serveEnvironment`, `serveEnvironmentState`, `environmentCapacity` and
  `stateIntake` adapters tests: 14 files, 335 tests passed.
- After this file was written: `npm run format`, `npm run format:check`,
  `npm run scan:todos` and `npm run docs:check` passed again.

The review fixes are covered by these tests, all passing in the runs above:

- Response budget: a batch of four `data/get`s over a loaded state of about a
  third of the budget keeps two results, answers the other two with `-32000`
  and `max_response_bytes`, keeps the trailing reset's `{}`, and its body stays
  within the budget.
- Batch order: a batch `[data/add (gated download), data/get]` with a
  `data/reset` from another request sent while the download is held reports
  the loaded state from its `data/get`, and the reset applies last.
- Cancellation: aborting the data plane's stop signal ends a stalled download
  (its fetcher's signal is aborted) and answers the queued reset as
  `cancelled` without running it; a call made after the stop does not run; a
  caller whose request signal aborts gets `cancelled` and the state is
  unchanged. Over loopback HTTP, `close()` of a served state returned while a
  download that never answers was in progress, and that download's signal was
  aborted.
- File closes: with an injected close failure, `data/add` of a `file://` uri
  answered `-32000` without echoing the uri. The descriptor stayed open, and
  the next file load closed it before loading. While the close kept failing,
  over loopback HTTP the next file load answered `-32000` ("still open") and
  an inline `data` part still loaded. `close()` rejected with the unfinished
  close, then resolved and closed the descriptor once the close succeeded.
  Both tests fail on the previous head, which dropped the descriptor.
- File hosts: `file://remote.example.test/...` and
  `file:////remote.example.test/...` are refused with the network-share
  message and no failure category; a `file://localhost/...` uri loads.
- Loaded identity: `view_fields` setting `id` to `3`, `"3"` or `null` on user 2
  is refused at `/rea_state/entities/7/view_fields/0/fields`; `"2"` loads.
- List required fields: a folder without `title` makes `get_folders` a tool
  error naming the incomplete entity.

That each test fails without its fix is source-derived; the fixes were not
reverted to show it.

Not covered here: a Windows host (the UNC refusal ran on macOS, where
`file:////host/share` converts to `//host/share`; the host check runs before
any path conversion on every platform), a real `https://` download (tests
inject the fetcher), the memory and time of a budgeted batch (not measured),
agent token usage, a real AgentEnv framework run, a real-world capture, and
write effects, which are a later increment.

After refusing bodies too deep for the state's own nesting (a recorded body
must nest at most the JSON depth limit minus 16 levels to enter the state):
`npm run check:fast`, `npm run format:check`, `npx knip`, `npm run scan:todos`
passed; `npm run jscpd`: 3.37% over 3373 files; `npx vitest run --project
domain --project services`: 347 files, 5950 tests passed, 5 pre-existing
skips; `npm run build:cached`, then `npm run test:focused --` the serve CLI,
MCP and process boundaries, the export CLI boundary and the two serve adapter
tests: 6 files, 48 tests passed.
