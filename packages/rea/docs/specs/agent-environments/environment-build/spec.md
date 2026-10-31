# Build an environment in one step

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

Building an agent environment bundle takes three commands and a hand-written
view request that embeds the whole capture inline, so large captures hit inline
input accounting. The views apply no opt-in template rules by default, while the
published capture-built environments all use the same four, and a local capture
is named after its origin host (`127-0-0-1-3105`). Nothing reports which tools
an environment serves from its state, or why a write tool is withheld.

`rea environment-build <capture> [directory]` builds the bundle in one offline
step and reports what it serves. A new `environment-coverage` analysis view
reports the same summary for any capture, so an agent can check a recording
before building.

## Requirements

- The capture is a `.har` file, inspected as `inspect-web-network-capture`
  inspects it, or capture Evidence JSON from `inspect_web_network_capture` or
  `capture_browser_scenario`; any other extension is refused before it is
  read, and a HAR document saved as `.json` is refused with a hint.
- The manifest is projected from the in-memory capture as retained Evidence,
  with the default rules `after-uid-literal`, `opaque-token`,
  `sibling-variance` and `prefix-variance` unless `--template-rule` or
  `--format-rules-only` selects others; rules apply in the views' order and a
  repeated rule is refused, as the views refuse it.
- For the same capture path, every bundle file is byte-identical to what
  `inspect-web-network-capture --format json`, `inspect-analysis-view --format
  json` (the same rules in the views' order) and `environment-export` (the
  build's name) write, Evidence ids included. The Evidence is serialized once
  into one exactly sized buffer, whose bytes are both authenticated and shipped.
- The name is `--name`, else the manifest's, unless the origin is a loopback
  name or IP literal: then the capture file's name, with a warning; a file name
  that yields no portable bundle name is refused, asking for `--name`.
- The report carries the export's tool count, state, package source and files,
  plus the capture and manifest identities, `coverage`, warnings and the next
  command, shell-quoted. `coverage`
  counts read tools answered from the state and replayed (per view reason), and
  lists write tools as served or withheld with their reason, plan record, the
  contradicting read and a hint; it is null when the state is unavailable.
- Every write reason has a hint; a reason without one fails to compile.
- Credential-named header names, query parameter names and JSON or form body
  members that hold a value are reported as a count and the first 20 record or
  event pointers, never values, and never refuse a build; the scan cannot
  overflow the stack on deeply nested bodies. A body is read as a form
  (`application/x-www-form-urlencoded`, by `URLSearchParams`) or as JSON (the
  media types replay parses as JSON) by its recorded media type; a body with
  none, or one naming neither, is JSON when it starts with `{` or `[` and a form
  when it contains `=` and no whitespace, so plain text and empty bodies yield
  no pointers. A browser scenario is scanned by event rather than by record:
  every retained request and response network-content event's header values and
  body, including a response whose request began before the browser was attached
  and a transaction that cannot be attributed to one request and response, and
  each transaction URL's query parameters once; its pointers name the event's
  index in `events.items` (`event 4 response /token`). Each occurrence of a
  repeated form field counts, as each repeated header or query parameter does. A
  HAR request recorded with structured form parameters and no text, or the null
  text mitmproxy's SaveHar records, is scanned by those parameters. Text bodies
  over the 4 MiB scan limit, measured in UTF-8 bytes, including a response body
  decoded only as a prefix, are not scanned; they are reported as a
  `credential-scan-incomplete` warning with a count and the first 20 record or
  event and side pointers (`record 3 response`, `event 4 response`), never
  contents, and never refuse a build. Binary bodies hold no JSON or form text
  and are neither scanned nor reported.
- The inspected HAR's Evidence and the projected manifest are admitted against
  the live heap headroom for parsing and sealing before either is serialized, as
  a capture Evidence file is before it is read; one that does not fit is refused
  as `resource_constraint` before anything is written.
- An empty or NUL-containing capture, directory or package tarball argument is
  refused as invalid input; it is never resolved to the working directory.
- Nothing is written before the bundle stage; `--dry-run` writes nothing,
  reports the files a build would write and refuses the package tarballs a build
  refuses, admitting, reading and hashing, and releasing the tarball as a build
  does before copying it, so a tarball whose contents cannot be read is refused:
  a close it cannot confirm is reported as incomplete cleanup that keeps its
  owner. The directory must be absent or empty.
- SIGINT is checked between stages and after a dry run's last step: a build
  cancelled before the bundle stage writes nothing, and one cancelled during the
  write names the written bundle.
- The `environment-coverage` view summarizes the environment-state view with
  the same rules, refuses what it refuses and is inferred. It does not apply the
  serve-time catalog and state admission checks, and says so in a limitation.
- The `real-agentenv` lane builds its bundle with `environment-build`.

## Non-goals

- No change to the three existing commands' contracts, or to what any view
  derives or any environment serves.
- No browser launch or network access: scenarios are recorded with
  `capture-browser-scenario` first.
- No `--replace`, no refusal on credential names, and no rewriting of the
  capture's absolute path, which Evidence identity includes.
- No MCP export tool; that is a separate change.
