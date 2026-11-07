# Agent environments from a live application

Use this when the user asks for an agent environment (an AgentEnv bundle) of a
web application: a folder `agent-env` deploys, whose MCP tools answer from what
one recording of the application observed and serve the writes that recording
confirmed. The workflow records the application once with
`capture_browser_scenario`, checks what the environment would serve, records
again if a hint names a gap, then writes the bundle with
`export_environment_bundle`. For a HAR the user already has, skip to
[export](#export-and-hand-off) through `inspect_web_network_capture`, or use
`rea environment-build <capture.har> <dir>`.

## Before recording

- Record only against an instance the user says is disposable or seeded for
  this purpose: every write step creates, edits or deletes its data. If the
  user has not said so, ask before any scenario that writes. REA does not
  start, seed or reset applications.
- Credentials come from environment variables the user names. Declare each as a
  scenario secret, `{secret_id, environment_variable}`; the variable must be set
  in the environment REA's MCP server started with. Never ask for a password in
  chat. Declared secrets are redacted as the capture records.
- Map the application first with `inspect_web_page` (and `capture_web_screenshot`
  when layout matters): the login form's locators, and the API calls behind the
  pages that list and edit the entities the user asked about.
- `inspect_web_page` cannot sign in. To see pages behind sign-in, run a short
  `capture_browser_scenario` that signs in and opens them, with
  `"capture": {"after_each_step": ["accessibility"]}` (`"dom"` for markup).
  Read a step's tree with `inspect_analysis_view`, `view: {kind:
  "browser-scenario", collection: "text", step_index, artifact:
  "accessibility", offset: 0, limit: 2048}`, paging with `offset`. Capture
  options are only `after_each_step`, `at_end`, `events`, `network` and
  `limits`.

## Record a session an environment can learn writes from

One `capture_browser_scenario` records the whole session. Start from this
shape, with the application's own locators, paths and headers:

```json
{
  "browser": { "mode": "launch", "executable_path": "/usr/bin/chromium" },
  "start_url": { "url": "http://127.0.0.1:3000/login" },
  "secrets": [
    { "secret_id": "admin_password", "environment_variable": "APP_PASSWORD" }
  ],
  "capture": {
    "network": {
      "request_body": true,
      "response_body": true,
      "header_values": true
    }
  },
  "actions": [
    {
      "step_id": "user",
      "action": "fill",
      "timeout_ms": 15000,
      "locator": { "kind": "css", "selector": "input[name=username]" },
      "value": { "source": "literal", "value": "admin" }
    },
    {
      "step_id": "password",
      "action": "fill",
      "timeout_ms": 15000,
      "locator": { "kind": "css", "selector": "input[name=password]" },
      "value": { "source": "secret", "secret_id": "admin_password" }
    },
    {
      "step_id": "sign-in",
      "action": "press",
      "timeout_ms": 15000,
      "locator": { "kind": "css", "selector": "input[name=password]" },
      "key": "Enter"
    },
    {
      "step_id": "signed-in",
      "action": "wait_for",
      "timeout_ms": 15000,
      "locator": { "kind": "css", "selector": "nav a[href='/settings']" },
      "state": "visible"
    },
    {
      "step_id": "folders-1",
      "action": "request",
      "timeout_ms": 15000,
      "method": "GET",
      "path": "/api/folders",
      "expected_status": [200]
    },
    {
      "step_id": "new-folder-1",
      "action": "click",
      "timeout_ms": 15000,
      "locator": { "kind": "role", "role": "button", "name": "New folder" }
    },
    {
      "step_id": "folder-title-1",
      "action": "fill",
      "timeout_ms": 15000,
      "locator": { "kind": "css", "selector": "input[name=title]" },
      "value": { "source": "literal", "value": "Scratch folder 1" }
    },
    {
      "step_id": "create-folder-1",
      "action": "click",
      "timeout_ms": 15000,
      "locator": { "kind": "role", "role": "button", "name": "Create" },
      "save_response": {
        "method": "POST",
        "path": "/api/folders",
        "save": [{ "name": "folder_1", "json_pointer": "/id" }]
      }
    },
    {
      "step_id": "read-folder-1",
      "action": "request",
      "timeout_ms": 15000,
      "method": "GET",
      "path": "/api/folders/{saved:folder_1}",
      "expected_status": [200]
    }
  ]
}
```

Give each step that accepts `timeout_ms` a deadline. Without one, a step waits
until it completes or the scenario is cancelled, so a locator that never
matches hangs the capture and the client with it. The `wait_for_timeout` pause
instead uses `duration_ms` and does not accept `timeout_ms`. Match `wait_for`
locators to exactly one element.

1. Sign in through the UI: `fill` the user and password fields (the password
   as a secret reference), submit, then `wait_for` an element only a signed-in
   user sees.
2. Read with `request` steps: each collection the environment needs, twice
   before any write, so fields that change on their own show up; then each
   object a list shows by id, up to ten per collection. An object known only
   from a list that leaves out fields its own read shows cannot be read by id
   or updated in the environment.
3. Write the way the application's UI does: fill its forms and click its
   buttons, so each request carries the fields the UI sends, including ones
   the server would otherwise derive. Give the click or key press that submits
   a create `save_response` to keep the new object's ID, then `goto` its page
   (`/items/{saved:item_1}`) or read it with a `request` step. Never guess an
   ID, and never create a probe object to learn the next one. Write with
   `request` steps instead only when the UI cannot reach the operation (an
   API-only resource, or a UI that does not call the JSON API), or when coverage
   withholds the UI-shaped write as `unexplained-change` or `contradicted`;
   that counts as one of the two re-recordings. A `request` step write that
   coverage withholds that way usually lacks fields the UI sends: record it
   through the UI instead. If a journey cannot be scripted, leave the write
   unserved and report the limitation.
   Record two numbered scratch objects per write type,
   with varied free text. After each write, and before the next one, read the
   object back by id and then its list: create 1, read 1, list, create 2,
   read 2, list; never several writes before their reads.
4. Leave more than a second between two creates and between a create and its
   first edit (`wait_for_timeout` with `duration_ms: 1100`), so lists sorted
   by creation time show them in order.
5. Update both objects and read each back, changing the fields a person
   would change (a name, an email address, a status, a due date) rather than
   only a description: a served update accepts only the members a recorded
   update stored. Run an action that turns something on or off (star,
   bookmark, archive) twice in a row on one object, reading it back after
   each: the second call shows whether it sets or flips the field, and the
   environment serves the action only once a call has shown it. Delete both
   and read each back (expect 404, or the object marked deleted) and the list.
6. Vary what the two creates send, however you write them: the first every
   field the application takes, the second only what a person must give (its
   title or name), with the other fields left out or empty. A served create
   requires each member both creates filled in and lets a caller leave out one
   a create left out or sent empty, so an agent that names only a title is not
   refused for fields it had no reason to set.

About `request` steps:

- `path` is on the start URL's origin; the page must be on that origin.
- Header values are literals, declared secrets, a cookie the browser holds
  (`{source: "cookie", name}`), a local storage entry
  (`{source: "local_storage", key, json_pointer}`), a saved value
  (`{source: "saved", name}`), or Basic credentials
  (`{source: "basic_credentials", parts: [username, password]}`, sent as the
  base64 of `username:password` and redacted), with an optional `prefix` such as
  `"Bearer "` or `"Basic "`. Each credential part is a literal, secret, saved
  value, cookie or local storage entry, so a header the frontend builds from a
  login token (the username and the token) can be copied too; the password is
  a secret or saved value, never a literal. Copy the
  headers the application's own requests send (a CSRF header such as
  `X-CSRFToken` from the `csrftoken` cookie, a bearer token). Values read from the page are redacted from records made after they
  are read, not from the login response that returned them, and values
  shorter than 8 characters are not redacted at all.
- `save: [{name, json_pointer, secret}]` keeps a string or number from the
  step's JSON response, such as the created object's `/id`, for later steps;
  `secret: true` redacts it, as for a token the API returns, so mark every
  saved token, key or session value secret. This also protects the selected
  source response before its body or headers are retained. Compressed or
  unknown-size UI responses cannot supply saved values. On a `click` or `press`,
  `save_response: {method, path, save}` keeps values from the response to the
  new request observed while the step waits (`{*}` in `path` matches one segment).
  Matching does not prove UI causality: choose a path distinct from polling;
  multiple observed matches fail as ambiguous. The step
  fails unless a 2xx JSON response arrives before its `timeout_ms`. Later
  steps send a saved value as `{saved:name}` in a request `path` (and its
  query) or a `goto` URL; in the `json` body, where a string that is only
  `{saved:name}` keeps the saved JSON type; or as `{source: "saved", name}` in
  a header or credential part.
- Reading a page value makes later bodies costlier to keep: after a CSRF
  token, bodies over about 47 KiB are kept as `unavailable`. When the API
  returns larger responses, raise `capture.limits`
  (`max_network_body_allocation_bytes`, `max_total_event_allocation_bytes`).
- Request steps follow no redirects: a redirect fails the step, and
  `expected_status` cannot name a 3xx status. Use the path the redirect names,
  such as the one with the trailing slash.
- Set `expected_status` on every step, so a refused call fails its step and
  the later steps report not having run, instead of recording read-backs of
  nothing.

Keep it to about 60 to 160 requests. A scenario with no `request` step is
recorded exactly as before.

The capture returns its whole Evidence, every recorded body included, which is
often more than a client shows inline. Before checking coverage, confirm that
every entry of `normalized_result.steps` has `status: "completed"`; if the
client saved the result to a file, search it for `"status":"failed"` and read
that step's `error`. A failed sign-in or write cancels every step after it.
Use the result's `evidence_id` for coverage and export; do not paste the
Evidence back into another tool.

## Check coverage

`inspect_analysis_view` with `source: {kind: "retained-evidence",
evidence_id}` (the capture's id) and `view: {kind: "environment-coverage",
template_rules: ["after-uid-literal", "opaque-token", "sibling-variance",
"prefix-variance"]}`. It reports read tools
answered from the state or replayed (`reads.recorded_reasons`), the served write
tools, and each withheld write with its `reason` and `hint`. It does not apply
the serve-time catalog and state size checks; the export reports those.

Re-record a withheld write at most twice, and only for a recording gap. Stop at
once when the reason is application behaviour, and report the write as
withheld with its hint:

| Reason                | What to do                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `no-state-target`     | Check the path template and recorded views; record missing reads. The route form may not be supported as a mutation target. |
| `no-observation`      | Re-record: read the entity back by id after the write; read it first for an update or delete.                               |
| `unconfirmed`         | Re-record: read the entity and its list after the write.                                                                    |
| `incomplete-entities` | Re-record: read the entity through every view that lists it.                                                                |
| `unexplained-change`  | Re-record once with a second, different call of the same write.                                                             |
| `no-call`             | Re-record once with a write that succeeds.                                                                                  |
| `side-effect`         | Stop: the application changes other entities.                                                                               |
| `contradicted`        | Stop: a later read disagrees with the modelled effect.                                                                      |
| `body-unusable`       | Re-record a UI write once with `request` steps (its body was not exposed); else stop.                                       |

Use new scratch names on each attempt, and delete what an earlier attempt
created before recording again (through the UI, or a `request` step with the
id that capture shows): the environment starts from what the recording first
reads, so a leftover object becomes seeded data that write tasks then find.
New browser scenario captures include request times, so a fully timed capture
can learn a write clock and serve updates that stamp modification times. Older
captures or ones missing a request start keep record order and learn no clock.
When coverage reports that limitation, record again with the current version
before concluding that the timestamp change cannot be served.

## Export and hand off

`export_environment_bundle` with `source: {kind: "retained-evidence",
evidence_id}` (or `{kind: "evidence-file", path}`), an absolute
`output_directory` that does not exist yet and whose parent does, and a `name`
(required when the application runs on `localhost` or an IP address). It returns
the coverage again, `tool_count`, the written files and warnings; `dry_run:
true` reports without writing. The bundle installs `rea-agents` of this REA's
version from the registry; when the user runs an unreleased REA build, pass the
`package_tarball` they give you (a packed `rea-agents` tarball) instead.

Tell the user how many tools answer from the state, which writes are served and
which are withheld and why, and the run command (`agent-env run <folder>`). Say
that the bundle ships the recorded responses and the capture's local paths
(for a browser scenario, the browser executable's path), and
list any `credential-named-members` warning pointers for review. Never publish
or share the bundle yourself.

See
[agent environments](https://github.com/morluto/rea/blob/main/docs/agent-environments.md)
for what the state, replay and the bundle establish, and
[evidence workflows](evidence-workflows.md) for the manifest and state views.
