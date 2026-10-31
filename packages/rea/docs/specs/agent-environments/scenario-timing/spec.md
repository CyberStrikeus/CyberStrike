# Time browser scenario records

## Outcome

Browser scenario network events record no times, so every record a scenario
projects is untimed. The environment-state view then orders records by
position, detects no overlapping requests and learns no write clock: an update
whose response carries a modification time the application sets is withheld as
`unexplained-change` however it is recorded, while a HAR of the same session
serves it with a clock rule.

Scenario network events now record when each request was observed and how long
the browser took, and scenario records carry them as HAR entries do, so a
scenario capture learns the clock a HAR does.

## Requirements

- Each `request` event carries `observed_at`, the ISO wall-clock time the
  provider observed the request start; Playwright reports the browser's start
  only once a request ends.
- Each `request-finished` and `request-failed` event carries `started_at`, the
  browser's wall-clock start (`timing().startTime > 0`), and `elapsed_ms`, its
  time from that start to the end of the response (`timing().responseEnd >= 0`),
  when the browser reports them.
- The fields are optional in the schema, so Evidence captured before them still
  parses and is read exactly as before. REA versions before them refuse
  Evidence that carries them.
- Scenario records take `startedDateTime` from the transaction's single
  finished or failed event's `started_at`, else from `observed_at`, and `time`
  from its `elapsed_ms`, omitted without a unique reported duration, and say so
  in a limitation. An explicit zero remains zero. Complete starts establish the
  recorded-start-time timeline; a write clock also requires known completions.
- Scenario comparisons ignore both fields, as a committed built-in rule
  (`ignore_network_request_timing`).
- The added metadata is charged to the event budgets as other metadata is.

## Non-goals

- No change to HAR captures, to how the state uses times, or to what a
  record's timing means for overlap or clock rules.
- No retroactive timing of captures made before this change.
- No browser start for a request that never ended: its record starts at
  `observed_at`, which can trail the browser's start by tens of milliseconds
  while the provider reads other responses, with no duration.
