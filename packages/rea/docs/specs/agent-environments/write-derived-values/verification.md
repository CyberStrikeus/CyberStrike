# Verification

Executed on macOS with Node v24.22.1 at `a1edeafd` (main `79845063` plus this branch). The prompt-built recordings and
evaluations used a local, unpushed build of this branch merged with the scenario-timing branch (#6967), whose request
times the clock rules need from browser scenarios, on Ubuntu 24.04 VMs with snap Chromium 155. The baseline is the same
merge without this branch.

## Gates

Follow-up on 2026-10-25, after merging main `a5bfd0440`, with Node 24.22.1 and npm 11.16.0 on macOS:

- Environment write/compare source tests: 26 files, 839 passed.
- Analysis-view CLI/MCP, environment served-write MCP, environment-compare CLI, managed bundle read guards, and setup
  registration prewarm boundaries: 6 distinct files, 77 passed. The managed low-headroom failure is fixed by main's
  Evidence ownership change (#7036); the setup tests share host preparation to satisfy lint without removing cases.
- `check:fast`, `format:check`, and `docs:check`: passed.
- New capture-to-plan regressions reproduce missing composition parts on earlier updates (null and structured sources)
  and fixed-width clock evidence from either the selected entity or another held entity. Rule tests exercise several
  separator/zone groups in both orders, choosing each group's widest trimmed peer while preserving fixed-width fields.
- Compare uses the domain clock matcher on parsed readings. Tests cover shorter fractions, absent fractions, maximum
  width, trailing zeros, separators, zones, and response-entity scope; the compiled CLI accepts a Go-style create whose
  live clocks have eight digits and served clocks have none, preserving all input Evidence files.
- The original application's recordings and model evaluations below were not rerun in this follow-up.

Original author validation:

- `npm run -s typecheck`, `lint`, `format:check`, `docs:check`, `mcp-catalog:check`, `verify:test-discovery`,
  `scan:todos` and `npx knip`: passed.
- `npx vitest run --project domain --project services --project adapters`: 17,246 passed, 25 skipped, 1 failed ("stops
  Inspector target authorization after the current stat settles"), which fails the same way on main in this environment.
- `npm run test:prepare`, then `npm run test:focused --` the environment build, export and serve CLI boundaries, the
  analysis-view CLI and MCP boundaries, the environment serve, served-writes and bundle MCP boundaries, MCP schema
  validation and output schema constraints: 10 files, 82 passed.

## Tests

- View: Go-spelled tag creates and renames are served with a trimmed clock; bookmark creates are served with a composed
  snapshot address and accept any URL; folder creates and renames are served with a composed address and a generated
  integer id.
- Serving: a served tag create spells its clocks without trailing zeros; a served bookmark create composes its snapshot
  address from the served clock and the sent URL; a served folder create gets a fresh sixteen-digit id and an address
  that follows its uid and title, and a rename moves the address.
- Unit: fitting clock formats (trimmed, fixed width, separator and zone), calendar digits, seeded integers, generated
  integer detection, composition and its refusals (one call alone, a held entity spelling otherwise, two sources with
  one text, a member stored otherwise than sent, a value the parts do not spell before the call), and a wide body
  composed within the existing time limit.

## Write plans over recorded captures

Every write plan of 69 captures, built by the baseline and by this branch: the 50 published captures, 18 captures
Claude Code recorded from a prompt for the prompt branch's checks, and one new timed Grafana recording.

| Captures                  | Write plans | Served on the baseline | Served on this branch |
| ------------------------- | ----------- | ---------------------- | --------------------- |
| 50 published              | 187         | 68                     | 68                    |
| 19 recorded from a prompt | 120         | 56                     | 61                    |

- No write goes from served to withheld. The five gains are Linkding's bookmark create, Homebox's tag create, and
  Grafana's folder create in two recordings and folder rename in the timed one.
- Published plans change only where a value is now composed: Linkding's bookmark create and BookStack's book create and
  update (`description_html` as `<p>` around the description) now accept the member they read.
- Unchanged by design: Grafana's published folder, whose uid and title slug are the same text, so its address names two
  sources; Ghost's post update, whose `lexical` keeps the `derived` rule that explained it before; BookStack's page HTML
  and Jellyfin's playlist path, which other pages and playlists of the capture spell otherwise.
- What still withholds a create the composed value now explains: a later Linkding create that sends a member the first
  did not (`shared`), Homebox item creates that differ from the first location create, and a Linkding create whose
  read-back lists `tag_names` sorted.

## Served write tasks

The same timed captures, rebuilt by the baseline and by this branch, with the models `fireworks_ai/gpt-oss-120b` and
`fireworks_ai/glm-5p3-flash`. Create tasks are new; recorded write tasks are the applications' existing ones with entity
counts taken relative to each bundle's state.

| Application | Tasks                              | Baseline (gpt-oss, GLM) | This branch (gpt-oss, GLM) |
| ----------- | ---------------------------------- | ----------------------- | -------------------------- |
| Linkding    | 2 bookmark creates                 | 0/2, 0/2                | 2/2, 2/2                   |
| Linkding    | 3 recorded (update, notes, delete) | 3/3, 3/3                | 3/3, 3/3                   |
| Homebox     | 2 tag creates                      | 0/2, 0/2                | 2/2, 2/2                   |
| Homebox     | 2 recorded deletes                 | 0/2, 0/2                | 0/2, 0/2                   |
| Grafana     | folder create and rename           | not served              | 1/2, 2/2                   |
| Grafana     | 2 recorded deletes                 |                         | 2/2, 2/2                   |

- Smoke and retrieval match on both builds (Linkding 9/9 and 8/9, Homebox 3/3 and 3/3); Grafana's new recording passes
  its smoke task and 9/9 retrieval with both models.
- gpt-oss missed the Grafana rename by sending the update without the title it was asked to change, ten times; the
  served environment refused each call with the members it accepts.
- Homebox's recorded deletes fail on both builds: this recording's served entity list holds its locations only, so the
  models never find the item to delete.
- The created bookmarks' snapshot addresses and the created and renamed folders' addresses are checked from the
  environment's state.
