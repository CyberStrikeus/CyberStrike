# Saved values in browser scenarios

## Outcome

A browser scenario could not carry a value from one step to a later one. An
agent recording an application from a prompt therefore guessed the id of the
object it had just created, created probe objects to learn the next id, or
read the object back by list only. An API that takes Basic auth, or a header a
frontend builds from a login token, could not be sent at all, so the agent
stopped and asked for an API key.

Steps now save strings and numbers from JSON responses, and later steps send
them. A click or key press saves from a newly observed matching response,
so a scenario can create an object the way the application's UI does and then
open, read, edit or delete it by the id the application assigned. A request
header can send Basic credentials built from literal, secret, saved or page
values.

## Requirements

- A `request` step saves `[{name, json_pointer, secret}]` from its own JSON
  response. A `click` or `press` step's `save_response: {method, path, save}`
  saves from the first response that matches its method and a path on the start
  origin (`{*}` matches one segment; the query is ignored), which must be 2xx
  JSON. The wait starts before the step acts, and the step fails, saving
  nothing, unless such a response arrives and is read before its timeout or
  cancellation.
- A pointer that names no string or number, a number that is not finite (such as
  `1e400`), a response that is not JSON or is larger than 4,000,000 characters
  (a UI step reads none received as more than 12,000,000 bytes, three per
  character), and a non-2xx `save_response` fail the step.
- `{saved:name}` sends a saved value, percent-encoded, in a request path and its
  query and in a goto URL, and in a request's JSON body: a string that is only
  the placeholder becomes the saved value with its JSON type, and a placeholder
  inside a longer string is filled as text. Header values and Basic credential
  parts send `{source: "saved", name}`. Other braces are sent as written. A
  saved value that makes a path segment `.` or `..`, alone or with the text
  beside it, fails the step.
- `basic_credentials` sends the base64 of `username:password` from `parts:
  [username, password]`, each a literal, declared secret, saved value, cookie or
  local storage entry. The encoded value and parts read from the page are
  redacted as page values are. A username with a colon fails the step.
- Validation refuses a saved value no earlier step saves.
- A scenario keeps at most 4,000,000 characters of saved values at once, counting
  the redaction spellings of values saved as secret; a save past that fails its
  step before the value is kept.
- A value saved with `secret: true` is redacted from the selected source response
  before retention and from subsequent records. The environment build warns about saved values named like credentials
  that are not marked secret (`credential-named-saved-values`).
- A scenario that saves nothing records the same Evidence parameters and
  `scenario_sha256` as before: an empty `save` is left out of the recorded
  step.
- Earlier REA versions read captures that use saved values.
- The compact MCP catalog stays under its measured one-megabyte frame.
- The skill records writes the way the application's UI does and falls back to
  request steps when the UI cannot reach an operation or coverage withholds the
  UI-shaped write.
- A UI-made create must be served as faithfully as one made through the API:
  - a string composed from a generated id and another field, such as Grafana's
    folder address, is learned as composed, not as a template around the id;
  - a slug learns how the application spells `&` from the call that shows it,
    and held entities that spell it both ways leave no slug rule;
  - an id that equals the title's slug is told apart by the entities the type
    holds, or by a later create;
  - a template a later create answers otherwise is withheld, as a composed
    string is.

## Non-goals

- No general value transforms, string templates or script steps: the value
  kinds are fixed.
- No saved values in `fill` or `select_option` values.
- No retroactive redaction of earlier unrelated records.
- No multi-factor sign-in.
