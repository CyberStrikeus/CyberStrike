# Verification

Verified commit: 235b22f2 on the write-plan branch at 7056f5ff. Executed on macOS with Node v22.23.1 (the repository
pins 24.18.0 in `.nvmrc`, which was not installed); the live applications ran on six disposable Linux VMs.

## Gates

- `npm run build:cached`, `npm run check:fast` (typecheck and lint), `npm run format:check`, `npx knip`,
  `npm run scan:todos`, `npm run docs:check`, `npm run verify:test-discovery` and `npm run mcp-catalog:check`: passed.
- `npm run jscpd`: 3.46% duplicated lines over 3609 files, under the 3.5% gate.
- `npx vitest run --project domain --project services`: 7487 passed, 5 pre-existing skips.
- `npm run test:prepare`, then `npm run test:focused --` the environment-compare, export and serve CLI boundaries, the
  serve MCP boundary and the tool schema validity boundary: 5 files, 30 passed.

New tests: matching, id mapping and translation, pairing guards, normalisation and every category as unit tests
(`environmentCompareIds`, `environmentCompareDiff`, `environmentCompare`, 19 tests), and the command through the built
CLI (`environmentCompareCli`, 2 tests): a probe of the books application re-seeded under other ids agrees on every step
with 2 ids mapped, and a probe that is not capture Evidence is refused with its index.

## Six environments against their live applications

Six published environments were compared with the application each was captured from: NetBox 4.7.3, Komga 1.29.1,
Mealie 3.28.0, n8n 1.123.85, Shlink 5.1.7 and self-hosted Sentry 26.9.0, the same images, brought up and seeded by the
same scripts as for their captures, on loopback. Each was snapshotted after seeding and restored from that snapshot
before every sequence (7 to 80 s), so every sequence met the same application.

A driver outside REA ran three kinds of sequence per application, each starting with the capture's read-only prefix:
the capture re-run in order; per served write type, a list, create, read, update, read, delete, read and list, then a
second create with changed free text; and a read of every seeded entity through its item tool. It translated the
environment's ids to the application's as it learned them, signed in with the application's own credentials, and wrote
each sequence as a HAR without headers or cookies, which `inspect-web-network-capture` turned into probe Evidence. The
environments' manifests use `prefix-variance`, so the comparison ran on a local build of this branch with that rule's
branch merged.

| Environment | Steps | Agreement | Ignoring order | Against its own capture |
| ----------- | ----: | --------: | -------------: | ----------------------: |
| NetBox      |   370 |     99.2% |          99.2% |                    100% |
| Komga       |   356 |     93.8% |          93.8% |                   93.1% |
| Mealie      |   301 |     96.0% |          97.0% |                   97.1% |
| Shlink      |   133 |     89.5% |          92.5% |                   92.4% |
| n8n         |   202 |     74.8% |          87.6% |                   87.5% |
| Sentry      |   230 |     23.9% |          46.5% |                   84.7% |

The last column compares each environment with its own capture as the probe: what it cannot reproduce even of the
session it was built from. The disagreements fall into four groups.

- Environment gaps, the ones to fix:
  - write tools the environment withholds, and the reads after them: readlists and collections (Komga), recipes (Mealie), short URLs
    (Shlink), workflow and tag writes (n8n);
  - preconditions: n8n refuses to delete a workflow that is not archived and the environment deletes it;
  - lists: a create does not appear in a list that keeps its recorded members (Komga), a filtered list is answered
    without the filter (Shlink), a replayed search ignores its body (Komga);
  - a domain-scoped short URL answered without its `domain` parameter, where Shlink answers 404;
  - state rendering: a project field two recorded views disagree on is rendered with one value, and an organisation
    read whose shape depends on a query parameter is answered the same either way (Sentry);
  - a tag read refused for want of the fields its item view always carried (Mealie);
  - time: per-hour event counts move with the current time, while the environment's clock is frozen at the capture
    (Sentry);
  - a field the capture's scrubbing replaced, answered as `"<scrubbed>"` (Sentry).
- The application differing from itself between seedings: Sentry returns permission lists in no fixed order and
  reseeding changed release first-event times, feature lists and profile flags; n8n's executions and NetBox's running
  worker count differ from the captured instance.
- The probe observing itself: Komga and Sentry report the driver's own sign-in user agent.
- Driver gaps: ids the driver never mapped (Mealie units, Sentry events by hash) were sent as the environment's ids.

## What the runs fixed in the comparison

Each live run found a way the comparison itself was wrong, fixed with a test before the next run: requests are matched
to tools in the environment's terms, so a tool whose path holds a seeded id literally matches; ids are learned outside
identifier fields only from strings, after NetBox's worker count of 1 mapped a live 0 to entity 1; items paired only by
position teach ids only when no key is shared and the lengths agree, after a filtered Shlink list mapped one short URL to
another; objects keyed by ids pair their entries (n8n data tables); reordered scalar sets differ in order only and epoch
numbers in arrays are clocks (Sentry); and bodies over the replay limit compare by status.

## After the review round

The branch merged the write-plan branch at b6c3b168 (four serving and gate fixes its review found), then changed the
comparison in nine places: ids are learned only from answers to the call itself and also per collection, paging values
are never translated, calls go through the served tools' input schemas, browser probes keep their request bodies, empty
bodies and large binary bodies compare as the server answers them, scalar sets compare after mapping, and id-keyed
objects pair when some keys overlap. Each new test fails on the previous head. The gates above passed again (domain and
services 7504 passed with 5 pre-existing skips; the focused boundaries 80; conformance; `jscpd` 3.46%). Re-run on the
same probes with this branch and the template rule's merged, the six environments compare exactly as in the table above,
step for step, with the same ids mapped and the same values normalised.

A second round, on Greptile's review of those changes, learned ids from a replay only when the whole recorded line and
request body match the call, compared an entity's own identity within the call's collection and other ids by the probe's
mapping, read overlapping keys as ids only when they evidently are ids, and kept a JSON empty string apart from empty
text. Its four tests fail on the previous head; the six environments again compare exactly as in the table.

A third round located the answer's own entities where the served environment does, at the read view's entity or list
pointer or the write's response pointer, so an entity inside an envelope keeps its collection's mapping. Its test fails
on the previous head; the gates passed again (domain and services 7509, boundaries 80, conformance, `jscpd` 3.46%) and
the six environments again compare exactly as in the table.

A fourth round, on Greptile's next review, kept what a probe did not observe out of the agreement figures. Records
without a usable request line, and requests without a recorded answer, are listed per probe with the reason and left
uncompared. A live body the probe did not record compares by status only and is counted. A browser probe captured
without response bodies is refused. A format-rule path parameter fits by its decoded value, as replay reads it. The
branch also merged the write-plan branch at 1d1c4787, whose gate no longer confirms a write by a read of a state that a
later write replaced. Each new test fails on the previous head. The gates passed again (domain and services
7647, 5 pre-existing skips; the compare, export, serve and analysis-view boundaries 69; conformance 279; `jscpd` 3.44%).

On the same probes, the six environments have no unobserved records or bodies, and five compare exactly as before.
Komga now withholds its collection create and patch. The only read the gate could check them by is the 404 after the
collection is deleted, because the read after the patch is the patch's own observation. Its agreement falls from
96.9% to 93.8%: the three creates and two patches the probes make are not served, and the six reads and deletes of
those collections that follow fail. Against its own capture it falls from 96.6% to 93.1%. The table shows the new
figures.

A fifth round merged the write-plan branch at dc5e2aad, which weighs an update's derived changes when a later write
replaces it and resets collection spellings on reset or load. It also makes a request whose answer the probe lost,
still uncompared, so that a later read sees its effect: a lost delete followed by a 404 now agrees. Its test fails on
the previous head. The six environments compare as in the table.

A sixth round merged the write-plan branch at fe8ab584, whose gate erases the fields later writes and recorded
outcomes overwrite from earlier write effects. The six environments again compare exactly as in the table.

A seventh round merged the write-plan branch at 3580d85c and main d8a9673f. That brought the gate's fix for overwritten
document writes, which Greptile raised here against the write-plan code, among others. It also fixed two findings of
its own:

- a probe with any undated record keeps its recorded order, as state extraction does;
- a browser probe that makes POST, PUT or PATCH calls without recorded request bodies is refused.

Both tests fail on the previous head. The six environments compare exactly as in the table, on the probes and against
their own captures.

An eighth round merged the write-plan branch at 43d98ea9 and 264ce410. They bring the gate's fixes for three findings
Greptile raised here against the write-plan code: a passing read that shows nothing of a write leaves it pending, an
update or delete finds its entity as an item read does, and a built document plan writes later calls at its own
object. It also fixed one finding of its own: a request to another origin than the probe's application is neither
made nor compared, so another server's `DELETE /api/books/2` no longer deletes the environment's book. Its test fails
on the previous head. The six environments compare exactly as in the table, on the probes and against their own
captures, with no unobserved records.

It then merged the write-plan branch at 0ae64400 and 6257de93: an update's identity member never takes a rule, a page
size of zero bounds nothing, and the paging rules, with this branch's `isPagingParameter`, move to
`environmentStatePaging.ts`. The six environments again compare exactly as in the table.

A ninth round merged the write-plan branch at 466ed8b4, which fixes two findings Greptile raised here against its
code (entity fields that look like pointers match by name; a zero page size bounds nothing only where a recording
listed items under it) among others. The six environments compare exactly as in the table, on the probes and against
their own captures. It then merged 7cef2fb2, whose fixes settle three more findings Greptile raised here against that branch's code:
zero page sizes erasing another bound, partial write responses taken for removals, and interference timed by a tool's
call elsewhere. The six environments again compare exactly as in the table.
