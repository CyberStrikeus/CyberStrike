# Verification

Verified base: 33b0643e on main 1629266e (the rule, the alias removal `knip`
asked for, and the fixed-length clause the end-to-end runs below led to). Executed on macOS with Node v22.23.1 (the repository pins
24.18.0 in `.nvmrc`, which was not installed).

## Gates

- `npm run build:cached`, `npm run check:fast` (typecheck and lint),
  `npm run format:check`, `npx knip`, `npm run scan:todos`,
  `npm run docs:check`, `npm run verify:test-discovery` and
  `npm run mcp-catalog:check`: passed.
- `npm run jscpd`: 3.49% duplicated lines over 3561 files with 3067 clones;
  main measures 3.49% with 3068, since the shared segment-limit split removes
  one clone.
- oxlint reports no new finding on the changed files. The manifest accumulator
  keeps main's three warnings (file length, and the complexity and parameter
  count of its record append), one line longer.
- `npx vitest run --project domain --project services`: 7119 passed, 5
  pre-existing skips.
- `npm run test:prepare`, then `npm run test:focused --` the analysis-view MCP
  and CLI boundaries, the compact input schema and tool schema validity
  boundaries, and the environment serve and export boundaries:
  7 files, 76 passed.

New tests in `environmentManifestView.test.ts` cover:

- a literal shared across methods and depths, and the same capture without the rule;
- the spelling condition: same classes and length, case, missing digit, a colon word, a version;
- a digit-free member of a fixed-length identifier family, against a shorter word, a hyphenated
  value and a family shorter than eight characters;
- merges that keep a tool's own rule, including a sibling-variance parameter under a shared one;
- both halves of a templated pair;
- format-rule positions and the segment limit.

## The showcase captures

The 50 showcase captures (45 HAR inspections and 5 `capture_browser_scenario`
captures) were projected with main's build and this branch's.

- Without the rule, both builds give identical results for every capture: the
  manifest with no rules, the manifest with `after-uid-literal`,
  `opaque-token`, `sibling-variance` and `sibling-pair-variance`, and the
  environment-state view. 150 of 150 outputs hash equal.
- With `prefix-variance` added to `after-uid-literal`, `opaque-token` and
  `sibling-variance`, 69 literal tools in 10 captures are templated, 25 of them
  writes:
  - Komga: collection and readlist `PATCH` and `DELETE`, book pages.
  - n8n: workflow `PATCH`, `DELETE` and archive, and the reads of a workflow
    whose id holds no digit.
  - Memos: memo `PATCH` and `DELETE`, user settings reads, and the reads of
    two memos whose ids hold no digit.
  - Navidrome: playlist `PUT` and `DELETE`.
  - Mealie: recipe `PATCH` and `DELETE`.
  - Grist: document `PATCH` and `DELETE`, and table record writes.
  - Redpanda Console: subject and topic writes.
  - Sentry: release `PUT` and `DELETE`.
  - Shlink: short URL `PATCH`.
  - Mattermost: `me` reads, which `sibling-variance` already folds into the
    user parameter.

  Tools go from 1591 to 1578, because Redpanda Console's per-subject reads and
  the per-memo and per-workflow reads merge.

- Literals the rule leaves alone, as intended, include Espo CRM `layout`,
  Federal Register `facets`, Ghost `slug`, Shlink `stats`, Lychee
  `Metrics::photo` and Vault's path names.
- The environment-state view succeeds on every capture with the rule. Its types
  move to the templated collections (531 become 526 as literal ones merge); the
  one fewer item view is the Redpanda Console merge.

With the write plans of #5600 (its branch with this commit and main merged in,
locally):

- Served write tools rise from 33 to 39: Komga collection create, update and
  delete; n8n workflow delete; Sentry release update and delete.
- Write tools with no state target fall from 102 to 87.
- The newly modelled tools that stay unserved are limited by the capture:
  - no read after the write: Komga readlists, Mealie, Navidrome, Redpanda Console;
  - n8n's item read shows an expanded `shared` relation its create response
    never returned;
  - Shlink returns `tags` sorted while the update echoes the request's order.

## Five environments end to end

Five of the ten environments the rule changes were drawn at random, redrawing
until the draw held one whose new writes are served: Komga, Mealie, n8n,
Sentry and Shlink. Each was rebuilt on its own Linux VM with `npm pack` of
#5600, main and this branch merged locally, from the same scoped HAR as its
published version: manifest with `prefix-variance`, exported bundle, smoke
task, the generated retrieval tasks for `gpt-oss-120b` and `GLM-5.3-Flash`, and
a dry-run dataset. Where writes are served, hand-written write tasks ask for a
change in plain language and are graded from the environment's state through
`data/get`. The first n8n run found that a digit-free workflow id stayed
literal; the fixed-length clause fixed it, and n8n was rebuilt.

| Environment | Tools (published → rebuilt) | Served from state (reads / writes) | Retrieval gpt-oss | Retrieval GLM | Writes gpt-oss | Writes GLM |
| ----------- | --------------------------- | ---------------------------------- | ----------------- | ------------- | -------------- | ---------- |
| Komga       | 42 → 46                     | 26 / 3                             | 12/12 (was 11/12) | 12/12 (11/12) | 3/4            | 4/4        |
| Mealie      | 39 → 39                     | 36 / 0                             | 12/12 (12/12)     | 12/12 (12/12) | –              | –          |
| n8n         | 30 → 33                     | 17 / 1                             | 9/9 (9/9)         | 9/9 (9/9)     | 2/2            | 2/2        |
| Sentry      | 34 → 34                     | 26 / 3                             | 12/12 (12/12)     | 11/12 (12/12) | 2/4, rerun 0/4 | 4/4        |
| Shlink      | 17 → 17                     | 5 / 0                              | 5/7, rerun 7/7    | 7/7 (7/7)     | –              | –          |

Every smoke task passed. The misses:

- Sentry writes with gpt-oss: every failed episode passed `id: "sentry"` for
  the `/api/0/` segment the tool schema describes as `observed: 0`, so its calls
  addressed `/api/sentry/…`; every passing episode, and every GLM episode, passed
  `0`. The served tools work; the format-rule parameter for a segment that only
  ever held `0` invites the guess.
- Komga update with gpt-oss and Shlink's first gpt-oss run: the model provider
  rejected tool calls the model generated (`null` and `undefined` for optional
  query arguments) before the environment saw them.
- Sentry `qa-03` with GLM: the model never called the alert-rules tool.

The same calls were also replayed against the live applications, seeded by
the same scripts (ids differ, so each side maps its ids to names):

- Komga 1.29.1, 9 of 12 steps equal: create, update and delete of a
  collection and the reads after them agree except for the generated id. The
  collection list after a create omits the new collection, because that list
  keeps its recorded membership, and the 404 for a deleted collection replays
  the recorded body with its path and timestamp.
- n8n 1.123.85, 3 of 8 steps equal: n8n refuses to delete a workflow that is
  not archived (400) and the environment deletes it; the workflow list replays
  its recorded response, so a delete does not show in it; archiving is not
  served. The read of the digit-free workflow failed in the first build (the
  state held only its list fields) and agrees in the second, apart from ids the
  seed generates.

## After the review round

The branch merged main at 52c84f6f, then kept each shared position's values
with the parameter that observed them (one donor per naming rule, the literal
taking the donor that observed it, else the earliest it is spelled like),
summarised each donor's spelling once, and let one observation form a
fixed-length family, as the requirement states. Two new tests, a mixed-rule
position and a single observed workflow id, fail on the previous head and pass
here. The gates above passed again (domain and services 7255 passed with 5
pre-existing skips; the focused boundaries 76; `jscpd` 3.49%). Over the 50
showcase captures the tools with and without `prefix-variance` are unchanged,
name for name: 69 literal tools templated, 25 of them writes.

A second review round bounded the spelling summary: characters are classified
in one pass, and a value longer than 128 characters is compared only exactly.
Its test fails on the previous head, the gates passed again (domain and
services 7257, focused boundaries 76, `jscpd` 3.49%), and the census over the 50
captures is again unchanged.
