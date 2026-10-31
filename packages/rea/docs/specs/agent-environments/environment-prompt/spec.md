# Build an environment from a prompt

## Outcome

`rea environment-build` builds a bundle from one capture, but an agent asked to
"make an environment of this app" still cannot finish the job through REA's MCP
server. A browser scenario can only reach an application's API through the UI or
a `goto` GET, so recording the writes an environment serves means scripting every
form, and there is no MCP tool that writes a bundle. Nothing tells the agent how
to record a session the state can learn writes from, or when to stop recording.

A `request` scenario action sends one same-origin request through the page's own
`fetch`, so a scenario can sign in through the UI and then call the application's
API, writes included, with the session's cookies and the CSRF or bearer values
the application's own requests send. An `export_environment_bundle` MCP tool
builds the bundle from capture Evidence, as `environment-build` does. A skill
reference walks an agent from the prompt to a bundle: map, record, check
coverage, re-record by reason, export and hand off.

## Requirements

- A `request` step names a method (`GET`, `HEAD`, `POST`, `PUT`, `PATCH`,
  `DELETE`), a path on the start URL's origin, ordered query entries, headers,
  an optional JSON body and optional expected statuses. Validation refuses a
  path that resolves to another origin, a body on `GET` or `HEAD`, a 3xx
  expected status, header names a page's `fetch` cannot set or Chrome drops
  (`User-Agent`), a header name given twice, line breaks or control characters
  in literal values and prefixes, and a path the URL parser rejects, as a field
  issue at the step's path.
- Header values are literals, declared secrets, a cookie the browser holds for
  the request URL, or a local storage value on the start origin, optionally read
  at a JSON pointer, with an optional prefix; local storage values are read only
  while the page is on the start origin. Values read from the page are redacted
  like declared secrets from records made after they are read, as stored and as
  sent; a value read again keeps its first marker, a colliding label never
  unredacts an earlier value, and values shorter than 8 characters are not
  redacted.
- The request runs through the page's `fetch` with same-origin credentials, from
  a page on the start origin (checked again in the page as it is sent), follows
  no redirects, and completes when the response has been read to its end,
  without keeping its body. A redirect, a status outside `expected_status`, a
  network error or the step timeout fails the step; later steps are cancelled as
  for other actions. The page sends only before the step's deadline, which it
  receives as an absolute time, and within one second of being handed the
  request; a busy page that starts later sends nothing, and the step hands the
  request over again while it is neither cancelled nor out of time. A step
  cancelled or out of time before the page starts its request sends nothing,
  except a request the page starts within that second of being handed it. A
  browser whose clock runs ahead of the host's fails the step. Its network
  events are attributed to the step.
- Captures with request steps say so in a limitation. A scenario without one
  validates, runs and records exactly as before.
- `export_environment_bundle` takes retained capture Evidence or a capture
  Evidence file, an absolute output directory that does not exist and whose
  parent does, and the build's name, template rules, package tarball and dry
  run. It writes the bundle `environment-build` writes from the same Evidence
  bytes (retained Evidence serialized as `--format json` writes it) and returns
  the same report, validated by its output schema. It refuses an existing
  directory, empty or not, a parentless or relative one, unknown Evidence, an
  unnamed loopback capture and repeated rules, and writes nothing when it
  refuses. Retained Evidence is refused for heap headroom before it is
  serialized, as an Evidence file is before it is read. `environment-build` is
  its CLI command.
- The skill reference `references/environments.md` is installed with the skill
  and routed from SKILL.md. It covers disposable instances only, credentials
  from environment variables, the recording rules the state needs, coverage, the
  stop rule, the hand-off, and how to reach objects by id when the server
  assigns ids: ids the caller chooses, a second scenario, or the UI.
- Coverage of a capture whose records are not all timed, which includes every
  browser scenario capture, says the state learns no write clock.
- Stop rule: re-record a withheld write at most twice for a recording gap
  (`no-state-target`, `no-observation`, `unconfirmed`, `incomplete-entities`),
  once for `unexplained-change` and `no-call`, and stop at once for application
  behaviour (`side-effect`, `contradicted`, `body-unusable`).

## Non-goals

- No cross-origin requests, form or multipart bodies, or arbitrary script
  actions.
- No retroactive redaction of values a request step reads: a login response
  recorded before the step keeps the token it returned, as captures do today.
- No application start, seed or reset, and no publishing of bundles.
- No change to what any view derives or any environment serves.
