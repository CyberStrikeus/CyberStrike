# Verification

Executed on macOS with Node v24.22.1 at `feat/environment-prompt` 8dfd5a4d (stacked on the environment-build branch at
eeab0bda), and on Ubuntu 24.04 VMs for the end-to-end runs.

## Gates

- `npm run -s typecheck`, `lint`, `format:check`, `docs:check`, `mcp-catalog:check`, `verify:test-discovery` and
  `npx knip`: passed.
- `npx vitest run --project domain --project services --project adapters`: 16,347 passed and 1 failed,
  "stops Inspector target authorization after the current stat settles", which fails the same way on the base fce1aba8
  in this environment (16,326 passed, 2 failed there); none is new.
- Boundaries: the bundle tool, analysis view, tool schema validity, environment-build CLI, setup skill and client
  lifecycle suites (123 passed), and every browser and scenario MCP and CLI boundary suite (68 passed).
- Real Chrome: `verify:browser:request` (new: 22 request steps, the CSRF cookie and stored token authenticate seven
  writes and never reach the Evidence, two queued writes are refused, the build serves the three write tools, an unexpected status fails the step and
  cancels the rest, and a redirect to another origin is not followed, the other origin receiving nothing) and
  `verify:browser:network` passed. `verify:browser` stops at "Real Chrome stable capture identities did not
  reconcile", an `inspect_web_page` comparison this change does not touch, and fails the same way on the base.
- `verify:browser:request` runs each CLI call under the shared package verifier command owner, which stops the CLI and
  the browser it launched on timeout, output overflow or failure before the lane's private root is removed, and reports
  a failed stop with the root retained; `browserRequestVerifierOwnership.test.ts` proves a still-running CLI's
  separately grouped browser is stopped before the root goes.

Scenarios without request steps are unchanged: the action union gains a member, the secrets refactor compiles the same
patterns, the request-step limitation appears only with request steps, and the browser suites and the network lane pass.

## End to end: environments from a prompt

Five self-hosted applications were brought up fresh and seeded on four disposable VMs, loopback only. Claude Code 2.1.310
(`claude-sonnet-5-5` through a LiteLLM proxy) got this branch's packed CLI, registered with `rea setup --client
claude_code` (the MCP server and the skill), and one prompt per application: build an agent environment of the app at
this URL, cover these entities, the instance is disposable but leave the seeded data as found, sign in as this user, the
password is in `APP_PASSWORD`, Chromium is here, write the bundle there. The prompt did not mention the skill. The agent
could use the REA tools, the skill and file tools; Bash and web tools were disabled.

Each bundle was then rebuilt with `environment-build` from its own `evidence.json` and this branch's tarball (the
registry's `rea-agents@6.7.0` has no `environment-serve`); `manifest.json` and `evidence.json` were byte-identical to
the agent's in all five. It ran its smoke task, a retrieval eval generated from its manifest and capture, and the
application's recorded write eval with `fireworks_ai/gpt-oss-120b` and `fireworks_ai/glm-5p3-flash`, one run per task.

| App      | Agent run | Recordings | Records | Tools (state / replayed reads) | Served writes | Smoke  | Retrieval gpt-oss / GLM | Writes gpt-oss / GLM |
| -------- | --------- | ---------- | ------- | ------------------------------ | ------------- | ------ | ----------------------- | -------------------- |
| Linkding | 182 s     | 9          | 66      | 8 (7 / 1)                      | 0             | passed | 9/9 / 8/9               | 0/3 / 0/3            |
| Grocy    | 253 s     | 7          | 154     | 22 (16 / 0)                    | 6             | passed | 10/11 / 10/11           | 3/3 / 3/3            |
| Homebox  | 391 s     | 9          | 268     | 13 (11 / 2)                    | 0             | passed | 9/9 / 9/9               | 0/2 / 0/2            |
| Directus | 202 s     | 7          | 100     | 25 (16 / 4)                    | 5             | passed | 12/12 / 11/12           | 2/2 / 2/2 \*         |
| Grafana  | 143 s     | 4          | 100     | 15 (12 / 2)                    | 1             | passed | 5/5 / 5/5               | 2/2 / 2/2            |

\* The Directus write eval checks that the state holds exactly the provisions the scripted recording read (2); the
agent's recording read all 5, so its count checks fail although every field check passes (0/2 with both models). With
the counts relative to the state's own provisions it passes 2/2 with both.

- Write tasks passed exactly when the build served their tool, with both models.
- The skill loaded unprompted in every run. All five agents signed in through the form with the declared secret,
  recorded the API with request steps, checked coverage, stopped by the withheld reasons and exported with
  `export_environment_bundle`; each reported the credential-named warning pointers, and none published anything.
- The scripted recordings the published environments were built from, built with this branch, read more (11, 39, 21,
  31 and 35 state-backed reads) and serve 7, 3, 2, 2 and 0 writes; the prompted recordings serve 0, 6, 0, 5 and 1.
- Linkding's and Homebox's updates are withheld because a browser scenario carries no request times: the state learns
  no clock, so an update the application stamps with a modification time is `unexplained-change`. Linkding's scripted
  HAR serves the same PATCH with a clock rule. The coverage view now says so; recording request times on scenario
  network events would lift it. Linkding derives each bookmark's archive URL from its creation time, so its create is
  `contradicted` in both recordings.

Earlier rounds: in the first, two agents hung on steps without `timeout_ms` and most guessed the scenario schema, so the
reference now starts from a whole scenario with a timeout on every step; the second (same five apps, before the review
fixes) served 1, 6, 0, 5 and 0 writes with the same eval pattern.

## Review

Two independent reviews tried to refute the change.

- The first found a 302 that took a request step to another origin, page values left unredacted under a repeated or
  colliding header label, short page values that rewrote ids and hosts across the capture, `User-Agent` accepted but
  dropped by Chrome, a request that could still be sent after its step timed out, an origin check separated from the
  send, a literal query re-encoded, line breaks accepted in header values, and CLI wording in MCP refusals. All are
  fixed and tested; redirects are now checked in real Chrome.
- The second confirmed those fixes and found query entries mishandled after a path ending in `?` or `#`, 3xx expected
  statuses that can never match, and padded stored values escaping redaction (fixed), plus the body cost of reading a
  page value, short values kept in plain text and the MCP dry run checking its directory (documented). In the
  prompted captures, only static assets lost bodies to the size limits.
