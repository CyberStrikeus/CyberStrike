# Browser scenario contract

`capture_browser_scenario` accepts the provider-neutral
`browserScenarioSchema` through both MCP and the
`capture-browser-scenario INPUT_JSON` CLI command. The request is declarative:
it admits a fixed action vocabulary, explicit HTTP(S) targets, deterministic
browser settings, explicit storage seeds, and provider-owned
liveness deadlines. `INPUT_JSON` may be inline JSON or a JSON file path.

The minimal request contains only browser launch/connect selection, `start_url`,
and at least one `actions` entry. Launch `headless` defaults to `true` and can
be set to `false` where the host supports a visible browser. Navigations follow
the destinations named by the scenario and the page's ordinary browser requests,
and [request steps](#request-steps) send only to the start URL's origin;
there is no separate origin allowlist. Request steps use a temporary dispatch
gate for cancellation; ordinary page requests retain their browser behavior. Environment
settings (including service workers blocked by default), empty storage, and a
final sanitized URL capture are supplied by default. Set
`environment.service_workers` to `allow` when the application requires them.
The connected service-worker policy owner retains its exact CDP transport
through discovery, attachment and restoration. Failed admission preserves its
primary diagnostic when socket cleanup also fails; later policy cleanup retries
that retained transport and clears cleanup uncertainty only after close succeeds.
For attached browsers, `block` rejects captures when the selected page or its
frames are controlled by a service worker or already have a registration,
including after navigation. Policy checks bracket each artifact capture, including
the final step. If an external worker takes control while artifacts are being
captured, REA rejects the capture and retains the completed artifacts in
`details.diagnostics.collected_artifacts`; they do not establish policy-compliant
completion. Existing caller registrations are never removed.
Navigation can run destination code before a newly discovered worker is rejected;
that rejection does not roll back browser effects. REA removes its owned
future-document scripts, restores live frame methods, then disconnects.
Add secret declarations, storage seeds, and additional artifact or event
capture only when needed. Missing environment-backed secrets fail as input errors before browser acquisition, naming the declaration and required variable. An explicitly set empty string is a resolved value. Action, secret, and storage counts are not capped.
Duration, action, and navigation timeouts remain separate from CDP command
deadlines. `command_timeout_ms` (default 20000; omit it to keep that default
and leave it out of Evidence) bounds launch startup, the connect-over-CDP
handshake, target lookup, environment commands, and storage CDP commands,
including replies from attached child targets. It also bounds the initial
`start_url` navigation through the load event; a redirect or replacement
navigation cannot leave startup waiting indefinitely. Set it in the scenario JSON.
`capture-browser-scenario` has no `--command-timeout-ms` option.
It does not change action `timeout_ms`, `wait_for_timeout.duration_ms`, or
action navigation. Service-worker restoration keeps a fixed 5000 ms grace and does
not inherit a raised `command_timeout_ms`. CDP discovery stays on its own
fixed deadline. When service workers are blocked, the registration check
before discovery has its own fixed 10000 ms deadline; `command_timeout_ms`
does not apply because discovery has not started. The discovery deadline
covers endpoint discovery only. The following WebSocket handshake and
`Target.attachToTarget` each use `command_timeout_ms`. `capture.limits` controls retained event and network-content
budgets; it does not change those liveness deadlines.

## Validate a scenario before running it

`validate-browser-scenario INPUT_JSON` checks one scenario against the same
`browserScenarioSchema` refinement that `capture_browser_scenario` admits, and
stops there. `INPUT_JSON` may be inline JSON, a JSON file path, or `-` for
standard input.

```bash
rea validate-browser-scenario ./browser-scenario.json --json
```

A valid scenario reports `{"valid":true,"actions":<count>,"secrets":<count>}`
and exits 0. An invalid one exits 1 and reports the same field paths capture
would report, so a correction made here is the correction capture needs:
duplicate or reserved step IDs, duplicate secret identities and
environment-variable names, undeclared secret references, request-step
violations, and unknown fields.

Validation performs no browser discovery, launch, attachment, or navigation and
constructs no provider. It does not read secret environment variables, so a
scenario whose declared variables are unset still validates; the missing-value
failure belongs to capture. A schema-valid scenario does not prove that the
executable or target is available on the host.

## Minimal launch example

Save this as `browser-scenario.json`, replacing the executable path with an
already-installed Chrome-family browser and the URL with your running fixture:

```json
{
  "browser": {
    "mode": "launch",
    "executable_path": "/absolute/path/to/chromium"
  },
  "start_url": { "url": "http://127.0.0.1:3000" },
  "actions": [
    { "step_id": "settle", "action": "wait_for_timeout", "duration_ms": 100 }
  ]
}
```

```bash
rea capture-browser-scenario ./browser-scenario.json --json > browser-capture.json
```

The default capture includes the final URL. Select DOM, screenshots, or events
only when they help answer the question. REA launches and cleans up the browser
profile for this request; it does not start your fixture server or install a
browser. A schema-valid scenario does not prove that the executable or target
is available on the host.

## Interaction example: capture the visible result

The default final URL answers "where did the page end up?", not "what did the
page show?". Many interactions, such as a search button that renders results in
place, change the page without changing the URL. A capture with only the
default `url` artifact then reports that the click succeeded and the URL is
unchanged, which cannot tell you whether results appeared.

Request the artifacts that answer your question and wait for the state you want
to inspect. This scenario clicks a Search button, waits for the current search
results, and captures the final DOM, accessibility tree, and URL. It assumes the
local page clears `#results`'s `data-state` while loading and sets it to `ready`
after rendering the current response. Adapt the selectors and readiness marker
to your page; an already-visible container or previous results are insufficient.

```json
{
  "browser": {
    "mode": "launch",
    "executable_path": "/absolute/path/to/chromium"
  },
  "start_url": { "url": "http://127.0.0.1:3000" },
  "actions": [
    {
      "step_id": "search",
      "action": "click",
      "locator": { "kind": "css", "selector": "#search" },
      "timeout_ms": 10000
    },
    {
      "step_id": "results-ready",
      "action": "wait_for",
      "locator": { "kind": "css", "selector": "#results[data-state='ready']" },
      "state": "visible",
      "timeout_ms": 10000
    }
  ],
  "capture": { "at_end": ["dom", "accessibility", "url"] }
}
```

Save it as `browser-search.json` and run it the same way as the minimal
example:

```bash
rea capture-browser-scenario ./browser-search.json --json > browser-search-capture.json
```

Through MCP, pass the same object as the `capture_browser_scenario` arguments.
The final step's DOM and accessibility artifacts retain the page state at that
capture time inline. REA still launches and cleans up the browser profile.

Action `timeout_ms` and `wait_for_timeout.duration_ms` accept integers from 1
through 2,147,483,647 milliseconds, matching the underlying timer representation.
Larger values receive an input error before browser launch. Omit `timeout_ms`
to keep an action pending until completion or request cancellation.

The click's `timeout_ms` covers the click action. A non-navigating `fetch` or
delayed render can finish later, so use `wait_for` to observe a page-specific
ready condition before final capture. A page that updates synchronously can
omit that wait. REA does not infer application readiness from capture selection.

Choose captures by the question being asked:

- `dom` and `accessibility`: text or structure the page rendered, such as
  search results, validation messages, or updated lists. The accessibility tree
  is usually the more compact way to read visible text.
- `screenshot`: visual layout or styling, or content not exposed as text, such
  as a canvas.
- `history` or `storage`: navigation history, or cookies and web storage the
  interaction wrote. Request them only when that state is the question; they
  are never captured implicitly.
- `after_each_step` instead of `at_end`: intermediate state between actions in
  a multi-step scenario.
- `events` (`console`, `page-errors`, `network`, and so on): how the page
  reached its result, such as the request a search issued or an error it
  logged. Select only the event families you need.

Capture states are reported per artifact. An artifact you did not request is
`not_requested`, which means REA did not look, not that the page had nothing
to show. A step's `completeness` of `complete` covers only the sections that
were requested. A URL-only capture can be `complete` and still be unable to
answer a question about rendered content, so add the relevant artifact and run
the scenario again rather than inferring from its absence. Capture completeness
also does not assert that the page's background work has finished.

The browser boundary is part of the contract. Launch mode requires a
caller-selected executable and always uses a provider-owned temporary profile
that is closed and deleted during cleanup. Connect mode accepts only an
explicit-port loopback CDP endpoint. The Playwright driver preserves this
distinction: it closes and deletes provider-owned profiles, but only disconnects
from an external CDP browser. Real-browser verification checks both outcomes and
confirms that an attached external browser remains alive.

CDP connections leave Playwright's default-context overrides disabled. The
selected page receives the declared scenario environment and temporary focus
emulation, so actions can complete while that page is in the background.
Its environment owner clears these overrides before disconnecting; other pages
keep their media settings. Connecting does not create a bootstrap page.

That cleanup requires REA to remain running. Abrupt termination, including
Windows process-tree termination or POSIX `SIGKILL`, can leave the launch
profile and Playwright artifacts behind. A profile can retain cookies, history,
cache and origin storage. Later REA runs currently do not reclaim these paths.
Playwright 1.58.2 can also leave an artifacts directory when launch preparation
fails before a browser process exists, such as for a missing executable.
POSIX wrappers can request awaited cancellation with `SIGINT` or `SIGTERM`;
Windows process termination is not an equivalent graceful-cancellation channel.
Do not identify owned artifacts by directory prefix or creation time alone.
See [#4659](https://github.com/morluto/rea/issues/4659) for the remaining recovery
and wrapper-cancellation work.

Keeping that browser alive does not guarantee its emulation state survives.
Chromium can clear caller-owned `navigator.platform` emulation when a page CDP
session disconnects, including sessions that sent no emulation commands. REA
cannot snapshot the other client's complete user-agent/client-hint settings and
does not replay a partial reconstruction. Use launch mode to keep this effect
inside a provider-owned browser, or have the external owning client reapply its
complete configuration after capture. Connected captures report this limitation;
see [issue #4089](https://github.com/morluto/rea/issues/4089).

`environment.locale` sets Intl formatting in both modes. Launch also sets
`navigator.language`, `navigator.languages`, and the request `Accept-Language`.
Connect preserves the caller's page and request languages; every attached
capture identifies this locale limitation, including retained partial
observations. Use launch mode when the application must select the requested
language through navigator values or request headers. Artifact completeness
covers the selected observations, not equivalence of launch and connect
language environments.

HTTP(S) URLs may include ordinary query values and fragments directly. Use
ordered structured query entries when a value needs to reference a declared
environment-backed secret. Form, storage, and cookie values are either literal
strings or declared secret references; request step headers can also read a
cookie or local storage value from the page, and request steps and `goto`
destinations can send [saved values](#saved-values). Raw URL userinfo credentials are rejected.
Captured credential-header
values are not retained, and declared secret values are redacted automatically.
A secret may be declared solely to
redact matching observed content; every secret reference in an action, URL,
storage value still needs a declaration. Ordinary query values
and fragments remain intact. Durable results replace resolved secret values
with their secret references.

The exact `start_url`, navigation destinations, and storage-seed origins define
the inputs to a scenario; ordinary page requests are handled by the browser.
Storage cookies are scoped to the page URL at each capture. Unsupported action
tags, unknown fields, duplicate step IDs, and undeclared secret references fail
validation.

Cookies are installed before the initial navigation. Local storage entries are
seeded once per browser storage partition; session storage entries are seeded
once per origin in each instrumented top-level browsing context. Seeding occurs
before the first document scripts for the selected page and its instrumented
frames. An origin first reached by a later action
receives its seed on that first visit. Application updates, deletions, and
empty values then persist across later navigations in the same area; a new
scenario starts with its own seeds. Partitioned frames can receive separate
local storage seeds even when they share an origin. The pre-script mechanism
uses CDP debugger instrumentation. The observer resumes only pauses whose top
frame belongs to its private seed script; page breakpoints and `debugger`
statements remain under the attached debugger client's control.
If Chromium leaves the private isolated world's origin empty, REA looks up
that exact frame's reported security origin before selecting a seed. It does
not infer the origin from a frame URL or serialized storage key. Unresolved
frame identity or security origin fails initialization rather than silently
running with an unknown initial state.
Popup discovery does not establish that its first script was paused by the
selected page's storage instrumentation. When non-cookie seeds are declared
and a popup is discovered, the capture retains completed observations and
marks `storage` coverage missing, with equality ineligible. This applies even
if popup lifecycle events were not selected. Popup first-script storage
initialization is not currently guaranteed.

The result is Evidence with an initial state followed by one record per
declared action. Each step reports action status, elapsed time, sanitized URLs,
event bounds, and independently typed capture states for screenshot, DOM,
accessibility, URL, history, and storage. Actions after a failed or cancelled
action are not run and are recorded as `cancelled` with a not-executed error.
Console, page-error, network,
WebSocket, frame, worker, popup, and cancelled-download events are attributed to
steps. Retained events and requested artifacts are returned inline; omitted
events are counted by kind and identify affected network transactions.
Event and selected network-content retention have caller-selected limits under
`capture.limits`. Omitted values use the defaults below; every supplied value
must be a positive safe integer, and callers can raise or lower a default.
Byte limits are conservative allocation-cost estimates for retained event
values, including UTF-16 storage and JSON expansion, rather than serialized
bytes or a promise about exact process memory. `events.omissions.by_kind`
reports counts and reasons for omitted event kinds. Its
`network_transactions` rows identify affected transaction IDs and omitted
event kinds; `network_transaction_range` identifies the contiguous IDs beyond
the transaction limit. Omission metadata is bounded by the selected
transaction limit. Other missing sections remain explicit and make the capture
ineligible for equality claims.

The default limits are 10,000 events, 4 MiB estimated allocation for one
event, 16 MiB estimated allocation across retained events, 1,024 network
transactions, 64 KiB of body bytes per transaction phase, 1 MiB estimated
allocation for body redaction/base64, 1 MiB for retained header values, and
1 MiB for network metadata. The same limits are included in the capture
Evidence. Playwright materializes response bodies before REA can inspect their
byte length; `max_network_body_bytes` bounds subsequent retained copies and
does not bound the browser API read itself. A body that exceeds its selected
limit has an explicit `body-size-limit` or `body-allocation-limit` unavailable
state with the observed and allowed values.

Additional implementation bounds are 16 simultaneous network-content reads,
a 5-second deadline for each provider API read, and 2,048 live event-listener
owners. These are not caller-selectable. The concurrency bound queues admitted
content jobs and does not itself omit observations; a provider read timeout
produces a typed unavailable state, while exceeding listener capacity produces
event-kind omission counts. A preflight avoids body redaction and base64 copies
when the currently available event budget already rejects the body.
Concurrent reads may each pass that check before their events are retained;
their retained-copy work is bounded by 16 times the selected per-body
allocation limit. The Playwright response Buffer itself is materialized before
REA can apply that limit. Requested artifacts and retained events are returned
inline within the declared limits.
Attach-mode captures also declare the unavoidable pre-attach event gap.

Selected event families are observed on the root page and discovered descendant
popups, including nested popups. Popup lifecycle records are emitted only when
`popups` is selected. Launch-mode network observation starts at the owned
context before navigation, so popup document requests, redirects, and responses
are included once. Connected contexts can contain unrelated tabs: only network
events with a frame belonging to the root or a discovered popup are retained.
Initial popup requests without a frame cannot be attributed in shared contexts
and are omitted; attach coverage remains incomplete.

Playwright reports new popup Pages after their first navigation has committed.
It buffers early console messages and page errors, but the pinned API cannot
recover every earlier frame, worker, WebSocket, or download event. If one of
those families is selected and a popup is discovered, REA reports the family gap
in `limitations`, marks `events` missing, and disables equality eligibility.
Later events remain available; no initial navigation is synthesized from the
popup's current URL.

Each request names the exact launch executable or loopback CDP endpoint, target,
actions, and capture behavior. Origin filters and environment-variable names
are included when the scenario needs them.
Launch owns a temporary profile; connect mode disconnects from the selected
external browser without closing it. The request itself defines the operation;
there is no additional REA grant step. The browser and host still enforce their
own access and process rules.

## Request steps

A `request` step sends one HTTP request from the page with the page's own
`fetch`, so the browser attaches the session's cookies and the request is
recorded in the step's network events like any request the application makes.
Use it to record an application's API, including writes, when driving the UI
for each call would be slower or less exact than calling the endpoint the UI
calls. It is the only action that changes application state without a user
gesture, so run scenarios with write requests only against an instance whose
data you may change. This scenario creates one item:

```json
{
  "browser": {
    "mode": "launch",
    "executable_path": "/absolute/path/to/chromium"
  },
  "start_url": { "url": "http://127.0.0.1:3000" },
  "actions": [
    {
      "step_id": "create-item",
      "action": "request",
      "method": "POST",
      "path": "/api/items",
      "query": [
        { "name": "notify", "value": { "source": "literal", "value": "false" } }
      ],
      "headers": [
        {
          "name": "X-CSRFToken",
          "value": { "source": "cookie", "name": "csrftoken" }
        },
        {
          "name": "Authorization",
          "value": {
            "source": "local_storage",
            "key": "auth",
            "json_pointer": "/token"
          },
          "prefix": "Bearer "
        }
      ],
      "json": { "title": "Scratch item 1" },
      "expected_status": [201],
      "timeout_ms": 10000
    }
  ]
}
```

- `method` is `GET`, `HEAD`, `POST`, `PUT`, `PATCH` or `DELETE`. `json` is the
  body, sent with `Content-Type: application/json` unless a header sets one; a
  `GET` or `HEAD` step cannot carry it.
- `path` starts with one `/` and must resolve to the start URL's origin, which
  validation checks before the browser starts. When the step runs, the page must
  be on that origin, checked again in the page as the request is sent; add a
  `goto` step first if an earlier action left it. A query in `path` is sent as
  written (a fragment is not sent), and `query` entries are appended after it
  in order and may reference declared secrets.
- Request steps follow no redirects: a redirect answer fails the step, and
  nothing is sent to the location it names, though a write the redirect
  answered may already have been applied. `expected_status` cannot name a 3xx
  status. Manual redirects can be opaque to the page and may not produce a
  response event; their status and `Location` can therefore be unavailable even
  when network events and header values were selected. Such captures report
  incomplete event coverage.
- Header values are literals, declared secrets, a cookie the browser holds for
  the request URL (`{"source": "cookie", "name"}`, HttpOnly cookies included,
  whose value the page's scripts can then see while the request runs), or a
  local storage entry on the start origin (`{"source": "local_storage",
  "key"}`, with an optional `json_pointer` to a string or number in a stored
  JSON value). `prefix` is sent before the value. A value read from the page is
  redacted like a declared secret, as `[REDACTED:page:<step_id>.<header>]`,
  from records made after the step reads it; a response recorded earlier, such
  as the login response that returned a token, keeps the value. A value read
  again keeps its first marker, and a value shorter than 8 characters is not
  redacted, since redacting it would rewrite ids, ports and hosts throughout
  the capture. A value is redacted as stored and as `fetch` sends it, without
  surrounding spaces and tabs. A missing cookie, key or pointer fails the step.
  Reading a page value raises the estimated cost of redacting every later
  body, so the bodies kept within `max_network_body_allocation_bytes` (1 MiB
  by default) get smaller: after a 32-character `X-CSRFToken` value, a body over
  about 47 KiB is kept as `unavailable`. Raise `capture.limits` when the
  application's responses are larger.
- A header can send Basic credentials, `{"source": "basic_credentials", "parts":
  [username, password]}`: the base64 of `username:password`, after a `prefix`
  such as `"Basic "` or with none, as some APIs take encoded credentials in
  their own header. Each part is a literal, a declared secret, a saved value, a
  cookie or a local storage entry, so a header a frontend builds from a login
  token can be sent too; the password is never a literal other than empty, since
  Evidence records literals as written, and a username with a colon fails the
  step, since Basic authentication ends the username at its first colon. The
  encoded value is redacted however short, as
  `[REDACTED:page:<step_id>.<header>]`, and parts read from the page are
  redacted as page values are.
- Validation refuses a header name given twice in a step, header names a
  page's `fetch` cannot set, such as `Cookie`, `Origin`, `Host` or `Sec-*`, and
  `User-Agent`, which Chrome drops; it refuses line breaks and other ASCII
  control characters in literal values and prefixes, and the step fails before sending
  when a secret or page value holds them.
- The step completes when the whole response has been read. With
  `expected_status`, any other status fails the step and the later actions are
  recorded as `cancelled`; without it, any response completes the step. A
  network error fails the step. `timeout_ms` covers reading the header values
  and the request: a step whose time runs out, or that is cancelled, before
  its request is sent sends nothing, but a request already sent can still reach
  the application after the step fails.
  An absolute deadline also covers browser evaluation queued behind page work.
  A temporary route checks cancellation again at network dispatch and is removed
  when the request evaluation settles. A page controlled by a service worker
  is refused because its fetch can bypass that dispatch gate; use the default
  blocked service-worker policy for request steps.

The request runs in the page's main world, so an application that wraps
`fetch` sees it, and it goes through the same network observation as other
page requests: select network content (bodies or header values) to record it.
Captures with request steps state in `limitations` that the steps sent their
declared requests through the page's fetch. A scenario without request steps
is unchanged.

## Saved values

A step can keep a string or number from a JSON response, by name, and a later
step can send it, so a scenario can read back, edit and delete an object whose
id the application assigns:

```json
{
  "browser": {
    "mode": "launch",
    "executable_path": "/absolute/path/to/chromium"
  },
  "start_url": { "url": "http://127.0.0.1:3000/items" },
  "actions": [
    {
      "step_id": "save-item-1",
      "action": "click",
      "timeout_ms": 10000,
      "locator": { "kind": "role", "role": "button", "name": "Save" },
      "save_response": {
        "method": "POST",
        "path": "/api/items",
        "save": [{ "name": "item_1", "json_pointer": "/id" }]
      }
    },
    {
      "step_id": "open-item-1",
      "action": "goto",
      "timeout_ms": 10000,
      "destination": { "url": "http://127.0.0.1:3000/items/{saved:item_1}" },
      "wait_until": "load"
    },
    {
      "step_id": "copy-item-1",
      "action": "request",
      "timeout_ms": 10000,
      "method": "POST",
      "path": "/api/items/{saved:item_1}/copies",
      "json": {
        "source_id": "{saved:item_1}",
        "title": "Copy of {saved:item_1}"
      },
      "expected_status": [201]
    }
  ]
}
```

- A `request` step saves with `save: [{name, json_pointer, secret}]`, from its
  own response. A `click` or `press` step saves with `save_response: {method,
  path, save}`, from a newly observed matching response while the step waits.
  The recorder watches before the action and excludes requests already running,
  such as an earlier autosave. Method/path matching does not prove that the UI
  caused the request: use a path that distinguishes the intended operation from
  background polling. Multiple observed matches before binding fail as ambiguous;
  requests starting after this observation window cannot be ruled out. It matches the method and a path on the
  start origin as the browser spells it, so a path may name `My List` or
  `My%20List` (`{*}` matches one segment, and the query is ignored), and fails
  the step unless a 2xx JSON response arrives before its `timeout_ms`; one still
  being read when the step times out or is cancelled saves nothing. A pointer
  that names no string or number fails the step, so later steps never send a
  missing value, as does a response over 4,000,000 characters: a request step
  stops reading and aborts its fetch there. A UI step reads a body only when
  its decoded size is bounded at 12,000,000 bytes or less: its received size,
  or the declared Content-Length of one served from cache, times 1032 for each
  gzip or deflate coding, the most DEFLATE expands. Other codings and unknown
  or zero sizes are refused before materializing the body; decoded text over
  the character limit also fails. The UI action may already have applied.
- `{saved:name}` sends a saved value in a request step's `path`, including its
  query, and in a `goto` destination's `url`, percent-encoded; a destination's
  structured `query` values are sent as declared. A saved value that makes a
  path segment `.` or `..`, alone or with the text beside it (including `%2e`),
  fails the step, since the URL would drop it. In a request step's `json` body,
  a string that is only `{saved:name}` becomes the saved value with the JSON
  type it was saved with, so a saved number id is sent as a number, and
  `{saved:name}` inside a longer string is filled as text. A header value or
  Basic credentials part sends one as `{"source": "saved", "name"}`. Other
  braces, such as `{id}`, are sent as written, and so is a percent-encoded
  `%7Bsaved:name%7D` anywhere but a `goto` URL, whose parsed form spells the
  braces that way.
- Validation refuses a saved value that no earlier step saves. A later save of
  the same name replaces the value. An integer past 2^53, which JSON parsing
  would round to another number, and a number that is not finite, such as
  `1e400`, negative zero, or a value that underflows to zero, such as `1e-400`, fail the step
  that saves it.
- A scenario keeps at most 4,000,000 characters of saved values at once,
  counting distinct retained redaction spellings, including trimmed variants,
  of values saved as secret. Replacing a binding releases its live value
  charge, while secret spellings remain protected for the scenario lifetime.
  A save past the budget fails before changing the binding.
- A value saved with `secret: true` is redacted however short, as a declared
  secret is, as `[REDACTED:page:<step_id>.<name>]`. The selected source
  response is protected before retaining its body or header values, including
  when only headers were requested. If that body cannot be read safely, its
  body and header values remain unavailable. Before publishing the capture,
  the selected source transaction's earlier URL, request headers and request
  body are also protected using the admitted values. Unresolved source values
  withhold that transaction's affected metadata/content with an explicit
  limitation. Before publication, retained events are rechecked
  with the final marked-response values, including immediate follow-up requests
  and their response bodies, console/page errors, WebSocket text and event URL/name fields. Learned redaction facts are independent of source-identity readiness. Unknown source values withhold only the selected
  source transaction. Other saved values, such as ids, stay visible, since
  environments model them. The environment build warns about saved values
  named like credentials that are not marked secret
  (`credential-named-saved-values`).
- Page-derived cookie/local-storage values and constructed Basic credentials
  remain redacted only from observations made after they were read/built.
  They do not retroactively rewrite earlier facts. The final event projection
  borrows only declared and response-marked patterns; promotion of an already
  held page value to an explicit response secret preserves its first marker.
  Projection state is session-local, references admitted pattern/byte owners,
  and is invalidated on admission or response classification changes.
- Screenshots are withheld as `missing` from the start when the scenario plans
  any response save marked `secret: true`, page-derived or Basic authentication
  header values, or whenever nonempty sensitive values
  are already known. Raw pixels cannot be safely text-redacted, so the provider
  does not request pixels in those cases. This also protects earlier steps and
  partial failures without retaining an image to scrub later. Other requested
  artifacts remain available; affected screenshot/aggregate completeness is
  partial and is not eligible for equality.
- Saved URLs and expanded request JSON are admitted before building their expanded strings or
  serializing. Its allowance is the smaller of Node's string limit and
  one sixteenth of current V8 available heap bytes, allowing for the expanded
  tree, serialization, Playwright transport and browser-side copies. Size
  accounting includes JSON escaping and repeated references; each distinct
  saved value's size is measured once per request. An oversized request fails
  before browser dispatch; the complete request envelope, including repeated
  header values, is checked as well. URL encoding uses a conservative
  nine-characters-per-UTF-16-unit allowance before encoding a saved value.
  Reduce the payload/repetitions, or raise the parent
  Node heap and restart; this is a conservative allocation estimate, not a
  measurement or guarantee of browser/process-family memory.
- Evidence records a request step's empty `save` list as absent, so a scenario
  that saves nothing records the same parameters and `scenario_sha256` as
  before saved values existed, and REA versions without saved values read its
  captures.

## Network evidence

`capture.events: ["network"]` retains request, response, completion, failure,
and unfinished-request metadata. Select content independently:

```json
{
  "browser": {
    "mode": "launch",
    "executable_path": "/absolute/path/to/chromium"
  },
  "start_url": { "url": "http://127.0.0.1:3000" },
  "actions": [
    {
      "step_id": "run",
      "action": "click",
      "locator": { "kind": "css", "selector": "#start" },
      "timeout_ms": 10000
    },
    {
      "step_id": "ready",
      "action": "wait_for",
      "locator": { "kind": "css", "selector": "#done" },
      "state": "visible",
      "timeout_ms": 10000
    }
  ],
  "capture": {
    "network": {
      "request_body": true,
      "response_body": true,
      "header_values": true
    }
  }
}
```

All three options default to `false`. Any selected network content also enables
network metadata observation; listing `network` in `events` is then optional.
Each observed request object receives a capture-scoped `transaction_id`.
Each `request` event carries `observed_at`, the wall-clock time REA observed the
request start. Playwright reports the browser's own start only once a request
ends, so each `request-finished` or `request-failed` event carries `started_at`,
the browser's wall-clock start, and `elapsed_ms`, its time from that start to
the end of the response, when the browser reports them. The environment views
time scenario records from these, as HAR entries are timed: the browser's start
where it reported one, else `observed_at`, which trails it by up to tens of
milliseconds while REA reads other responses. A duration is retained only from a
unique terminal event that reports it; missing or ambiguous durations stay
omitted, while an explicitly reported zero remains zero. Captures made before these fields existed lack them and
are read in record order. REA versions before them refuse captures that carry
them. Scenario comparisons ignore all three (`ignore_network_request_timing`).
Requests sharing a URL remain distinct. Redirects link to the preceding
transaction only when it was observed; a null predecessor does not establish
that no earlier hop existed. Request events require both transaction fields;
an absent ID is malformed capture data. `redirected_from_transaction_state`
records `root` when Playwright observed no predecessor and `unknown` when a
predecessor exists but was outside the capture. A linked predecessor is carried
by `redirected_from_transaction_id` with no state field. Older captures without
the state field retain the conservative meaning that a null predecessor is
unknown.

`scenario.network_content` records the resolved content selection. Comparing
captures with different selections reports network evidence as unknown with a
recovery instruction.
Capturing more data alone does not establish a website change.

`network-content` events reference the exact request or response event through
`source_event_sequence`. They include independently typed headers and body
states. Captured bodies retain base64 bytes, byte count, media type, and SHA-256
of the retained bytes. Request bytes are those exposed by Playwright; a
`not_exposed` request body does not prove absence or complete multipart file
coverage. Response bytes are the result of Playwright's `Response.body()` API.
Playwright may satisfy that API with a credentialed follow-up load of the
request URL when CDP has no response body. Event and transaction references
identify the associated Playwright response object, but do not verify that the
retained bytes came from the original network transaction. Successful selected
response bodies include this limitation in the capture. These bytes are not
the compressed wire representation.
Headers preserve producer order and duplicates. Authorization,
Proxy-Authorization, Cookie, and Set-Cookie values are null with
`redacted: true`; ordinary values remain intact. Declared UTF-8 secret values
and their standard URI/form or JSON-escaped representations are replaced without
decoding unrelated binary bytes. Other encodings are not interpreted. Digests describe the
retained representation after redaction.
The selected body-byte limit also bounds that retained representation after
secret expansion, before base64 serialization. Credential header values are
discarded before retained-header allocation accounting; their names and null
projections still count. The transport/API has already materialized incoming
bodies and headers, so these retained limits do not bound producer-side input
allocation.

Only completed responses are read. The producer-observed terminal state is
recorded independently of whether its event metadata fit the retention budget. An omitted completion event cannot turn a
finished transaction into an unfinished one. When the final step ends, observation
stops; requests still in flight emit `request-unfinished`, and their observed
responses have explicitly unavailable bodies. Already-admitted content reads
drain before browser cleanup. At most 16 reads run at once; queued work is
bounded by the selected network-transaction limit and by successful admission
of its request or response event. Each provider API read has its own five-second
timeout once it starts, so queue wait adds to total drain and cleanup time; this
is not a five-second total capture cutoff. Cancellation interrupts active reads
and queued jobs produce cancelled states without calling their provider APIs.
This drain does not wait for long-lived unfinished streaming connections and
does not refetch unfinished response bodies. Failed or unexposed reads retain
per-content states and make selected event coverage incomplete. Body events can
arrive during later steps or final drain; event bounds describe receipt during
the step, while the source event reference establishes the transaction phase.
Comparison attributes content, like every other event of its transaction, to
the step that sent the request (the receipt step when that request was not
observed) and excludes the sequence reference from normalization.
Playwright scenario capture does not supply initiator stacks; passive CDP
observation retains its own initiator evidence.

## Storage value fingerprints

New storage snapshots include `fingerprint_version: 2`. Non-secret, well-formed
JavaScript strings retain their SHA-256 over UTF-8. Strings with unpaired UTF-16
surrogates use SHA-256 over a raw `0xff` byte followed by their exact UTF-16LE
code units; this prefix cannot occur in UTF-8. Declared secrets remain
`redacted-secret` with a null digest, without a second or legacy digest.

A missing version identifies legacy UTF-8 fingerprints, which replaced unpaired
surrogates and cannot establish value identity. Storage containing any legacy
hashed value is conservatively compared as `unknown`, including old-to-old
comparisons; recapture both sides to compare reliably. This also conservatively
withholds some otherwise provable legacy differences. Empty or entirely
secret-redacted storage keeps its existing comparison semantics. The version is
checked before normalization and excluded from content comparison: changing
encoding metadata alone does not establish a website change. Existing captures
and their completeness records are not rewritten.

## Scenario comparison

`compare_web_captures` and `compare-web-captures` also accept two complete
browser scenario captures. Steps align only by exact, unique `step_id`.
Duplicate IDs, missing counterparts, changed action kinds, and incompatible
browser/origin capture context are returned as alignment failures. They prevent
an unchanged claim; observed differences may still prove a changed result.

The comparison records its full normalization commitment and SHA-256 digest.
Built-in rules exclude step elapsed time and event sequence/index fields,
compare screenshots by content digest, and compare DOM/accessibility captures
by normalized text. Network events are grouped by transaction without their
capture-local transaction IDs, attributed to the step that sent the request,
and compared as an unordered collection after caller rules apply, because
concurrent responses arrive in any order and can land in a later step; a
redirect retains the complete predecessor ancestry, including each hop's own
request, response outcome, and selected network content. Each transaction's
capture-local IDs, sequence/index fields, content source-sequence anchor and
request times (`observed_at`, `started_at`, `elapsed_ms`) are removed. Caller rules normalize retained strings before hashing. The
`preserve_redirect_transaction_ancestry` built-in rule fingerprints each hop
as canonical SHA-256 of `{ events, redirected_from }`: `events` is the sorted
list of its normalized event SHA-256 digests, and `redirected_from` is its
predecessor fingerprint or null for a root. Selected transaction fingerprints
are sorted for the step's network comparison. Temporary numeric graph indices
are lookup references only and do not enter the final digest. Missing or cyclic
predecessor evidence yields unknown comparability instead of an unchanged claim.
Other events keep receipt order. Optional caller rules are bounded exact-literal
replacements over named artifact kinds. Rules and artifact-kind lists are
sorted canonically before application, making the same policy reproducible
regardless of input order. Rules operate only on already-redacted durable
capture fields and are preserved in the result.

Cookies, local storage, and session storage are compared as unordered inventories
after caller literal rules apply. Enumeration order alone does not establish a
storage change. Canonical ordering uses the complete entry, preserving cookie
scope/flags, value fingerprints, and duplicate entries even when redaction or
literal rules make names collide. Captured storage arrays retain their original
order. The `compare_storage_entries_as_unordered_collection` built-in rule
participates in the normalization commitment; new storage comparison digests
therefore differ from earlier order-sensitive comparisons. The
`ignore_network_request_timing` built-in rule likewise joins the commitment, so
normalization digests differ from comparisons made before it, though captures
with and without request times compare alike.

Each aligned step reports changed, unchanged, or unknown. Changed and unknown
action, screenshot, DOM, accessibility, URL, history, storage, and event
artifacts carry their normalized before/after digests and capture states.
Every changed or unknown artifact record is returned inline for each aligned
step. Missing, truncated, or mismatched capture coverage remains unknown
instead of being treated as equality.

`scenario.event_families` records the sorted, de-duplicated `capture.events`
selection. Captures with different selections report event evidence as unknown
with a recovery instruction, even when no selected family emitted an event.
Captures written before this field existed omit it, so their event evidence is
also unknown.
Retained-capture readers admit that omission without deriving a selection from
observed events; other artifact families remain comparable. Current capture
producers still require and publish the selected event families. Manifest,
environment and script-export readers share the retained-capture admission
rules and preserve the same missing fact.

Network normalization also commits the removal of capture-local transaction IDs,
attribution to the requesting step, and unordered transaction comparison. These
built-in rule identities participate in the normalization digest.

## Summary delivery and retained views

`capture_browser_scenario` accepts `detail: "summary"` to retain the complete
capture in the MCP session and return its summary. The default remains
`complete`. Delivery detail does not change scenario parameters or identity.

The summary reports each step's status, error, URL and captured/missing/truncated
section names. It omits `not_requested` sections and repeated `before_url` values.
The accessibility tree comes from the first unsuccessful step, or the final
step on success; when that step captured no tree, its nearest earlier captured
tree is identified explicitly. Event and network counts cover retained records,
with capture omissions reported separately.

For the one-shot CLI, save the complete Evidence before selecting a summary:

```bash
rea capture-browser-scenario scenario.json --detail summary --evidence_output /absolute/path/scenario-evidence.json --json
```

Use the returned `normalized_result.parent_evidence_id` with
`inspect_analysis_view` source `{kind: "retained-evidence", evidence_id: "..."}`.
For a CLI bundle, use an `evidence-file` source with its absolute path and the
parent Evidence ID. Views read the recorded capture; they never replay actions.

- `{kind: "summary"}` returns the same overview.
- `{kind: "browser-scenario", collection: "steps", step_indices: [2], artifacts: ["accessibility"], offset: 0, limit: 1}` returns selected recorded steps and artifacts.
- `{kind: "browser-scenario", collection: "events", event_kinds: ["response"], transaction_ids: ["request-2"], offset: 0, limit: 20}` pages selected events with original item indices.

Omitted filters select all; empty arrays select none. Pagination counts matching
retained rows. Exhausting a page does not establish capture completeness or
current application state.

Transaction pages use `{kind: "browser-scenario", collection: "transactions", limit: 20}`.
Their stable identity is the parent Evidence ID plus `transaction_id`; each row
keeps original event indices. Metadata events are returned by default. Select
`event_kinds: ["network-content"]` for recorded bodies and header values, or
`event_kinds: []` for identity and indices alone. A `step_indices` filter selects
a whole transaction when any retained event belongs to a selected step; this
is receipt attribution, not proof that the action caused the request.

For a large retained tree, request `{kind: "browser-scenario", collection: "text",
step_index: 10, artifact: "accessibility", offset: 0, limit: 2048}`. `dom` is also
supported. Offsets and limits count UTF-16 code units. The full artifact digest
and byte size remain attached to each page. Missing, truncated and unrequested
text stay explicit; source truncation counts are preserved without treating an
exhausted page as a complete capture.

Network summary counts include every retained transaction identity, including
those whose request event was dropped. Missing request events, conflicting
metadata and observed request failures have separate counts. `transactions` is
`null` when network observation was unrequested or its legacy selection is
unknown and there are no retained transactions; an observed empty inventory is
`0`. Full capture omissions remain available and each page carries source
completeness, dropped-event counts and omitted-transaction accounting.
