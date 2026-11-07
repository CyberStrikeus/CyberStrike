# Verification

Verified base: 7a668b73f4783b42eb0e8ce1eeff079f86d53e22 (the environment-state
view branch).

Executed on the implementation worktree with its existing locked installation
under Node.js v22.23.1 (the repository pins 24.18.0, which was not available);
every check below ran as written in this pass, after the last source change.

- `npm run format` then `npm run format:check`: passed.
- `npm run check:fast`: typecheck and lint passed (3959 files, no errors). The
  touched files carry two lint warnings, both present on the base: `max-params`
  in `environmentReplay.ts` and an unused `_` in `environmentCapacity.test.ts`.
- `npx knip`: passed (exit 0).
- `npm run jscpd`: 3.40% duplicated lines over 3348 files, under the 3.5%
  gate. The three clones that touch changed test files pair the same blocks as
  on the base; none involves code this change adds.
- `npm run scan:todos`: no markers.
- `npm run docs:check`: the built documentation checks and the README
  consistency conformance test (5 tests) passed.
- `npx vitest run --project domain --project services`: 341 files, 5859 tests
  passed, 5 pre-existing skips.
- `npm run build:cached`: passed.
- `npm run test:focused --` the environment serve adapters and capacity tests,
  the environment serve MCP boundary, the environment serve and export CLI
  boundaries, the environment serve shutdown process boundary, the
  analysis-view MCP and CLI boundaries, the compact input-schema contract and
  MCP boundary, the tool-schema validity boundary, the analysis-detail and
  advertised-input-example contracts and the qlog acceptance test: 14 files,
  113 tests passed, 1 pre-existing skip.

Real captures (outside the test suite): the built view ran through the
application service on the same 44 recorded captures (39 HAR, 5 browser
scenario) with all three template rules, in 7 to 50 ms each. 42 produced a
state, and the same two browser-scenario captures are refused with
`resource_constraint` as on the base. The base column is the brief's baseline,
which the same script reproduced on the base build in an earlier pass; this
pass did not rebuild the base.

| Measure                            | Base  | This change |
| ---------------------------------- | ----- | ----------- |
| Types                              | 568   | 576         |
| Entities                           | 2,213 | 2,246       |
| Documents                          | 2     | 299         |
| Item views                         | 211   | 213         |
| List views                         | 497   | 504         |
| Document views                     | 2     | 299         |
| State-backed read tools (of 1,258) | 710   | 1,016       |
| Recorded: `not-entity`             | 306   | (retired)   |
| Recorded: `no-identity`            | 129   | 32          |
| Recorded: `path-varies`            | (new) | 32          |
| Recorded: `query-varies`           | 5     | 69          |
| Recorded: `body-unusable`          | 32    | 32          |
| Recorded: `list-differs`           | 31    | 31          |
| Recorded: `no-init-recording`      | 26    | 26          |
| Recorded: `query-body`             | 12    | 12          |
| Recorded: `fields-differ`          | 3     | 4           |
| Recorded: `envelope-varies`        | 4     | 4           |

Seven list types gained a suffix-named identity (`permissionId`, `product_id`,
`ItemId`, `user_id`, `channel_id`, `spl_id` and `eventId`). Seven more had one
before the two-item proof and lost it, because every initial response listed a
single item: an Airbyte organization, a Mattermost reaction and team
membership, and a Redpanda broker and schema reference became documents; a
NOAA station read is `query-varies` and a Redpanda consumer read
`path-varies`. Two Ghost item tools render from `/members/0` and `/tags/0`. A
third Ghost item tool is located at `/posts/0` but stays `fields-differ`: its
recordings differ by an `include` query.

State result size, as the JSON length of each Evidence summed over the 42
states: 2,677 KiB on the base and 3,196 KiB now (+19%), measured by the same
script. The largest growth per capture is Metabase (133 to 236 KiB), Directus
(21 to 93), Redpanda Console (26 to 68) and Vault (9 to 43). Documents take
492,516 of the 3,274,243 UTF-8 bytes of the results now; the base held two.
Agent tokens, CPU time and peak memory of the state view were not measured.

Tool descriptions on the 44 captures' manifests: all 44 catalogs were admitted
within their reservation. 1,336 of 1,400 tools state what they return: 1,333
from a `2xx` record and three labelled with another status (Miniflux and
NocoDB 404, Shlink 501), because none of their records succeeded as JSON. The
summaries add 261,502 bytes to a 1,185,893-byte catalog of names, descriptions
and input schemas (median 136, 95th percentile 554, maximum 1,133 bytes per
tool); five reached the field sample bound (one Keycloak, one Lychee and three
Sentry tools with 46 to 105 fields). The MCP annotations add 113,182 bytes to
`tools/list` and none to the card. Building a catalog took a median 1.6 ms and
at most 7.6 ms (Metabase), after the source was loaded. Agent tokens, CPU time
and peak memory of the description build were not measured.

After merging the environment state view's review fixes (its branch at
6ad63bcc, which also brings main's evidence-file sources), every gate ran
again on the merged tree: `npm run check:fast`, `npm run format:check`,
`npx knip`, `npm run scan:todos` and `npm run docs:check` passed; `npm run
jscpd`: 3.39% duplicated lines over 3362 files; `npx vitest run --project
domain --project services`: 344 files, 5914 tests passed, 5 pre-existing
skips; `npm run build:cached`, then `npm run test:focused --` the serve and
tool-definition adapters, the serve MCP and CLI boundaries, the export CLI
boundary, the analysis-view MCP and CLI boundaries, the compact input-schema
budget and the analysis-detail and advertised-input-example contracts: 10
files, 98 tests passed.

The real-capture comparison was repeated on the merged code, with the base
measured on the merged state view without this change: all 44 captures now
produce a state, and 1,011 of 1,277 read tools are state-backed against 625
on the base (216 item, 416 list and 379 document views against 214, 409 and
2). Recorded reasons: `no-identity` 216 to 32 and `not-entity` 310 to none;
`query-varies` 5 to 76 and `path-varies` 36 are document reads under more
than one query or path; `list-differs` 35, `body-unusable` 33,
`no-init-recording` 28, `query-body` 12, `envelope-varies` 4 are unchanged,
and `fields-differ` is 9 to 10.

Not covered here: serving from the state, the AgentEnv data plane and write
effects, which are later increments.

## After the squash onto main

The branch was squashed onto main once the state-serve branch merged (166fb082). Against a merge of the previous head
into that main, the squash keeps both sides of every conflict and drops nothing of this branch. Two tests then failed
on it and were refitted with the oversized-document fix in 2a926a0a: the bundle test of a state catalog over the
discovery budget uses 300 read tools, inside the window where the state's catalog is refused and replay's, with its
response summaries, still fits (280–320 by a probe), and the rea-state validation test names the pushed document by
the count of documents the state holds. The replay-only card test pinned main's 11,131-byte card; it now pins this
branch's 12,818-byte card, whose descriptions name each tool's recorded responses. The branch then merged main at
d7ca93cc without conflicts.
