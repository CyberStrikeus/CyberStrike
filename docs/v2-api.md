# CyberStrike v2 API

A second HTTP surface that speaks OpenCode's v2 wire contract (`@opencode/protocol@2.1.4`), so the `einyx/opencodex`
iOS client can talk to CyberStrike. The v1 surface is unchanged. Supersedes nothing; it is the document the plan's
Task 17 asks for, and it is linked from `docs/superpowers/plans/2026-10-26-opencode-v2-protocol-adoption.md`.

## Starting it

```sh
export CYBERSTRIKE_SERVER_PASSWORD=yourpassword
cyberstrike serve --api v2              # v1 on 4096, v2 on 4198
cyberstrike serve --api v2 --api-port 4300
```

The v2 listener mounts **only** v2 routes. `GET /global/health`, `GET /session/status`, `GET /project/current`
and `GET /session/:id/todo` are not served there.

Auth is CyberStrike's existing Basic auth: username `CYBERSTRIKE_SERVER_USERNAME` (default `cyberstrike`), password
`CYBERSTRIKE_SERVER_PASSWORD`. Loopback requests without proxy headers are trusted, as on v1.

Location scoping accepts `?location[directory]=`, `?directory=`, `x-opencode-directory` and
`x-cyberstrike-directory`. A directory that does not exist is a typed `404 LocationNotFoundError`.

## Layout

| Path                               | What it is                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/api-v2/`                 | The contract: upstream's `HttpApi` (`Api`), the middleware keys, the pure v1→v2 projections, the event mapping. Never imports `packages/cyberstrike`. |
| `packages/api-v2/openapi.json`     | Generated from `Api` (`bun run generate`). `bun run check:generated` fails on drift.                                                                  |
| `packages/cyberstrike/src/api-v2/` | The glue: one handler file per upstream group, the listener, the auth and directory middleware.                                                       |

## Status by group

Implemented (answers real data from CyberStrike's domain):

- `server`: `server.info`
- `location`: `location.get`
- `project`: `project.list`
- `session`: list, create, get, patch (title), delete, active, fork, prompt (admission), interrupt, switch agent,
  switch model, diff (empty), revert clear (no-op), form list / reply / cancel
- `message`: `session.messages` (each message decoded on its own; a bad one is logged and skipped)
- `permission`: request list, session list / get / reply
- `form`: list
- `fs`: read (bytes, path confined to the directory), list (a file is a typed 404), find
- `vcs`: status (branch only)
- `agent`: list
- `model`: list, default
- `provider`: list
- `config`: get
- `event`: the SSE feed (`server.connected` first, then mapped v1 events)
- `pty`: list, create, get, update, remove, connect-token, and the terminal WebSocket at `/api/pty/:id/connect`

Every other group now answers real data from CyberStrike's domain, including `worktree`, `shell`, `debug`, `mcp`,
`credential`, `plugin`, `websearch`, `reference`, `skill`, `command`, `rpc`, `generate`, `migration`, `persistent-pty`,
and the session endpoints. Some are partial: `session.import` refuses transcripts that contain messages, and
`session.log` records lifecycle events but not transcript events.

Ten endpoints deliberately answer `503 not implemented`. Each needs a decision or a subsystem CyberStrike does not
have, so they stay stubbed rather than returning fake data:

- `integration.wellknown.add`: would run a command named by a remote discovery document, over HTTP. Left out until
  there is a threat model; an allowlist of locally configured commands is the only variant worth revisiting.
- `integration.connect.external`: CyberStrike has no external credential-source type to store.
- `server.pair`, `server.connect`: need a pairing-code store with expiry, rate limiting, and revocation. v1 uses only
  the Basic-auth password.
- `mcp.client`, `mcp.clientToken`: a client-hosted MCP server needs a WebSocket upgrade and a bridge into the v1 MCP
  client. That is a remote route into local tools with no review.
- `session.background`: v1 bash runs inline and has no detach path.
- `voice.models`, `voice.session`, `voice.instructions`: CyberStrike has no realtime or audio subsystem.

Clients can detect a deliberate stub from the `503 not implemented` body. Revisit each item when a named client needs it.

## Terminal tickets

Authenticated clients can send `POST /api/pty/:id/connect-token` with `x-opencode-ticket: 1` and the terminal's
directory scope. The response contains `{location, data: {ticket, expires_in: 30}}`. Pass the ticket as the
`ticket` query parameter on the WebSocket URL, with the same directory scope. Tickets are single-use, expire
after 30 seconds, and cannot authorize another terminal, directory, or listener. An invalid ticket returns 403;
it does not fall back to Basic auth. Direct authenticated WebSocket connections still work without a ticket.

## Boundary validation and tests

Catalog, permission, and form responses now decode through the upstream schemas. Forms use `frm_` IDs, string
or multiselect fields, and option labels as values so replies round-trip to v1 questions. The config route
returns an array of effective configuration documents with supported public settings, not raw provider credentials.

Prompt admission persists the user message before returning the upstream inbox shape. Reused client IDs return
409 rather than overwriting messages, including concurrent admissions. Client IDs and inline
base64 data-URI files are retained; `resume: false` admits without starting the model loop. The local HTTP model
fixture in `packages/cyberstrike/test/api-v2/prompt.test.ts` exercises the vendored gate's prompt-admission,
message-list, file, ignored-format, and client-ID cases without external model calls. It also verifies reply
streaming and interruption during concurrent HTTP requests and token streaming.

The event feed follows the global bus, including newly opened directories. Text ordinals are resolved from
persisted assistant-content positions, including when subscribing mid-message. Endpoint tests verify that
corrupt messages and parts do not break the rest of the message page.

## Known gaps

- **Contract gate.** The vendored `einyx/opencodex` gate is in `script/v2-contract-check.py` and runs with
  `bun run v2:contract` (also in `.github/workflows/v2-contract.yml`). Its default run reports 45 of 45, with prompt
  cases marked skipped. Prompt cases are separately asserted against the local model fixture. The full prompt-enabled
  gate is not green: `revert.stage` answers `files: false` with 400 because v1 always restores files, and an unscoped session list only includes the current project
  (so the gate's cross-project temporary session is not listed).
- **Real-provider and phone smoke tests are not automated here.** Prompt regressions use a local model fixture.
- **File input is limited to base64 data URIs.** Other attachment URIs return typed 400s rather than fetching arbitrary
  network or filesystem locations. Skill attachments are not implemented.
- **Configuration is an effective public projection.** Source-document discovery and CyberStrike-only fields are not exposed.
- **Event coverage is partial.** Only the events in `packages/api-v2/src/events.ts` are forwarded.
- **Agent and model switches are in-memory.** They are kept per process and apply to the next prompt. A restart drops
  them.
- **Startup warm-up.** `listen` boots the working directory and loads the agent, provider and config catalogs before it
  serves, because a cold load takes several seconds. Other directories still pay that cost on their first request.
- **CyberStrike-only parts.** `json_schema`, `symbol` and `resource` parts have no v2 equivalent and are dropped from
  projected messages.
- **Phase 2 groups** (`vulnerability`, `request`, `observation`, `coverage-note`, `web-credential`, `methodology`,
  `hackbrowser`, `ingest`) are not in the v2 surface.

## Phone smoke checklist

Run by hand before relying on the v2 surface:

1. Start `cyberstrike serve --api v2`.
2. Point opencodex at the v2 listener on port 4198 with the Basic-auth credentials.
3. Confirm the app detects v2 (`GET /api/info` returns a version).
4. Open a project and check that the session list loads.
5. Send a prompt and confirm the reply streams in live.
6. Trigger a permission prompt and answer it.
7. Trigger a question and answer it.
8. Open the file tree and read a file.
9. Open a diff for a changed file.
10. Open a terminal session and run a command.
