# Verification

Executed on macOS with Node v24.22.1 at `feat/scenario-request-timing` b92a11b6 (on main d87e73f2), and on Ubuntu 24.04
VMs with snap Chromium 155 for the recordings.

## Gates

- `npm run -s typecheck`, `lint`, `format:check`, `docs:check`, `mcp-catalog:check`, `verify:test-discovery`,
  `scan:todos` and `npx knip`: passed.
- `npx vitest run --project domain --project services --project adapters`: 16,380 passed and 1 failed, "stops Inspector
  target authorization after the current stat settles", which fails the same way on main in this environment.
- Browser and scenario MCP and CLI boundaries, tool schema validity and the analysis-view MCP boundary: passed.
- `npm run -s verify:browser:network` in real Chrome: every one of the 10 requests carries `observed_at`, and every
  finished request carries the browser's `started_at` and `elapsed_ms` (9 of 10; the tenth is the fixture's deliberately
  unfinished stream).
- Captures made before this change parse and project exactly as before: the published Pinry (568 requests), PhotoPrism
  (277) and Lychee (134) captures give byte-identical manifest and state views, Evidence ids and digests included, on
  main and on this branch.

## The same capture with and without request times

Each capture below was recorded with this branch, then built twice: as recorded, and with its request times removed and
the Evidence sealed again as the provider seals it. The difference is this change alone.

| Capture                                        | Records | Timeline without / with times | Writes served without / with times |
| ---------------------------------------------- | ------- | ----------------------------- | ---------------------------------- |
| Linkding, agent-recorded from a prompt         | 60      | record order / start time     | 1 / 4                              |
| Linkding, agent-recorded from a prompt (again) | 65      | record order / start time     | 3 / 3                              |
| Homebox, agent-recorded from a prompt          | 263     | record order / start time     | 2 / 3                              |
| Homebox, agent-recorded from a prompt (again)  | 275     | record order / start time     | 2 / 2                              |
| Pinry, its published scenario re-recorded      | 568     | record order / start time     | 0 / 0 (1 clock rule learned)       |
| PhotoPrism, its published scenario re-recorded | 273     | record order / start time     | 2 / 2 (2 clock rules learned)      |

- With times, Linkding's bookmark and bundle edits and Homebox's tag edit are served: their responses carry a
  modification time the application sets, which only a clock explains. PhotoPrism's served album create now stamps
  `CreatedAt` and `UpdatedAt` from the clock instead of replaying the recorded values. No capture served fewer writes.
- The second Linkding and Homebox recordings gain nothing because their gaps are elsewhere (`unconfirmed` and `contradicted`
  writes): an agent's recording choices move coverage more than timing does.
- The prompt-built recordings used a local, unpushed build of this branch merged with the prompt PR (#6946), which adds
  the `request` scenario action they need. Claude Code (`claude-sonnet-5-5`) recorded each app from a one-paragraph
  prompt, as in that PR's end-to-end check.
- The Linkding bundle with four served writes passes all three of the application's write tasks with
  `fireworks_ai/gpt-oss-120b` and `fireworks_ai/glm-5p3-flash` (with the tasks' entity counts taken relative to the
  bundle's own state, which holds active and archived bookmarks as two types); the earlier prompt-built Linkding bundles,
  recorded without times, passed none. The Homebox bundle passes both of its write tasks with gpt-oss and one with GLM
  (GLM deleted the wrong item). The final build's prompt-recorded bundles start and answer retrieval: Linkding
  passed its smoke task and 8/8 and 7/8 retrieval tasks, Homebox its smoke task and 3/3 and 3/3.

## Stale published environments

Pinry and PhotoPrism are the oldest published environments recorded as browser scenarios (version 0.1.0, replay only).
Both were re-recorded with this branch from their published scenarios on fresh seeded instances and rebuilt with the
publishing pipeline:

| App        | Published 0.1.0                             | Rebuilt with this branch                                                           |
| ---------- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Pinry      | 12 tools, replay, retrieval 6/6 and 6/6     | 12 tools, state and clock, no writes served; retrieval 6/6 and 4/6                 |
| PhotoPrism | 13 tools, replay, retrieval 10/10 and 10/10 | 14 tools, state and clock, album create and rename served; retrieval 8/10 and 5/10 |

Neither improves, so neither was republished. The retrieval drops do not come from timing: the timed and untimed states
are identical in every view these tasks read. PhotoPrism's album list is answered from the state in name order while
the recorded response that generated the task listed another album first; Pinry's two GLM misses are tool calls
rejected for passing `limit` and `offset` as numbers, under the same tool schemas the published version had.

## Review

An independent review rebuilt the branch and tried to refute it. It confirmed byte-identical views for earlier captures,
that comparisons with and without times compare alike, that each record's duration comes only from its own
transaction, and that both fields are charged to the event budgets. Its findings are addressed: records now start at the
browser's own start time rather than the provider's observation, which trailed it by up to 36 ms while other responses
were read; the docs give the fallback's lag, that earlier REA versions refuse captures carrying the fields, and that the
comparison's normalization digest changes; and tests cover the fallbacks, partly untimed captures and comparisons with
untimed captures.
