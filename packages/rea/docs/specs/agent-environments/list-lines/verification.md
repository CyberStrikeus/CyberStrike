# Verification

Verified commit: 40800631 (this branch with the write-plan branch's head `dc5e2aad` merged in). Executed on macOS with
Node v22.23.1 (the repository pins 24.18.0 in `.nvmrc`, which was not installed); the probes were recorded earlier
against the live applications on six disposable Linux VMs.

## Gates

- `npm run build:cached`, `npm run check:fast` (typecheck and lint), `npm run format:check`, `npx knip`,
  `npm run scan:todos`, `npm run docs:check`, `npm run verify:test-discovery` and `npm run mcp-catalog:check`: passed.
- `npm run jscpd`: 3.45% duplicated lines over 3646 files, under the 3.5% gate.
- `npx vitest run --project domain --project services`: 7616 passed, 5 pre-existing skips.
- `npm run test:prepare`, then `npm run test:focused --` the environment serve and export CLI boundaries, the serve
  and served-writes MCP boundaries, the analysis-view CLI and MCP boundaries, the compact input schema boundary and
  tool schema validity: 8 files, 78 passed.

New tests: three domain tests in `environmentStateWrites` (a tool with a whole line and a filtered line names the whole
one, with `numberOfElements` and `totalElements` as counters, and a create the whole line lists is confirmed; a whole
list taken after a read showed the created entity gone confirms no create, which fails without the absence rule; a
tool whose lines are all whole, or none, names none) and one serving test in `environmentStateWriteAnswer` (after a served
create, the whole line lists the created book with its counters, and the filtered line keeps its recorded member).

## Fifty published captures

The environment-state view ran over the 50 published captures with each manifest's template rules, on builds with and
without this change. Both merged the prefix-variance branch, which some manifests need.

- 47 list views in 20 environments gain a whole line, among them Komga's books, series, collections and read lists,
  BookStack's books, chapters and pages, Mealie's cookbooks, shopping lists, categories and tags, WordPress's posts and
  comments, Vikunja's labels and Paperless's groups. On that line a call now lists the state's entities, including
  those a task loads with `data/add` and those served writes create or delete, where it listed only the recorded
  members. Three of them belong to a type with a served write: Airbyte's tags, BookStack's books and Linkding's tags.
- Served write tools stay at 31, with two changes:
  - Airbyte's tag delete is now served. A whole list after the delete shows the tag gone.
  - Sentry's release create is now unconfirmed, in the pool's earlier manifest, where the release's update and delete
    are literal tools and not modelled. Its only confirmation had been a whole list taken after the delete and a 404
    showed the release gone. The write-plan branch already refuses such a list after a modelled delete; this change
    refuses it after an observed absence too.
- Komga's list views also count `numberOfElements`. No other view or write plan changed.
- Every write verdict is unchanged for the six environments republished with newer manifests (NetBox, Komga, Mealie,
  n8n, Shlink, Sentry). Komga gains 6 whole-line lists, Mealie 4 and Sentry 1.

## Six environments against their applications

The six environments of the fidelity comparison (NetBox, Komga, Mealie, n8n, Shlink, self-hosted Sentry) were compared
with their applications by `environment-compare` with and without this change. The probes were the comparison's capture
re-run, create/read/update/delete scenario and read of every seeded entity, and held-out sessions recorded later with
values no capture sent. Both builds merged the environment-compare and prefix-variance branches.

| Environment | Steps | Before | After | Ignoring order, before | After |
| ----------- | ----: | -----: | ----: | ---------------------: | ----: |
| NetBox      |   479 |  98.5% | 98.5% |                  98.5% | 98.5% |
| Komga       |   600 |  91.5% | 91.5% |                  91.5% | 91.5% |
| Mealie      |   449 |  94.0% | 94.0% |                  94.9% | 94.9% |
| n8n         |   278 |  71.6% | 71.6% |                  84.2% | 84.2% |
| Shlink      |   202 |  87.1% | 87.1% |                  90.1% | 90.1% |
| Sentry      |   372 |  24.5% | 24.5% |                  47.6% | 47.6% |

No step changed. This Komga environment's capture creates, updates and deletes a collection before any whole list, so
with the write-plan branch's head its create and update are unconfirmed and serve nothing a list could show. Before
that head (at `f2b95351`), when a list taken after the delete still confirmed them, the same comparison moved Komga
from 94.7% to 95.2%: three list reads after creates agreed and two more differed only in where the created collection
was placed. None of the other five environments has a list tool with both kinds of line and a served write on its type.

## Review round

The branch merged the write-plan branch at 73c0e9b5 and 6d28aa78 and main at 4dfa1c67. Six of Greptile's eight
findings were in the write-plan branch's code and were fixed there. This branch fixed the other two:

- a view with whole lines takes its counters from them, and each line updates only the counters its own recording
  counted, so a partial page no longer drops a whole line's total;
- a failed item check that takes an answer with no entity drops the writes that claimed it from its collection, as an
  absence does, so a whole list cannot confirm the create.

Both new tests fail on the previous head. Over the 50 published captures, the merges changed no view or write plan,
and these two fixes add one counter each to BookStack's pages (`total`) and Linkding's tags (`count`), both views with
a whole line beside partial ones. Served write tools stay at 31. The six environments compare exactly as in the table
above, step for step. The gates passed again.

A second round merged the write-plan branch at 43d98ea9, which carries main d8a9673f and that branch's fixes for the
four findings Greptile raised here against its code. Its page cap applies on every line that lists its whole
collection: a call naming such a page that the collection has outgrown answers from its recording, and the gate skips
such reads. Over the 50 captures no view or write plan changed and served write tools stay at 31; the six environments
compare exactly as before.

A third round merged the write-plan branch at 264ce410. Greptile's finding here, that a `_start`–`_end` range escaped
the page cap, was in that branch's code and was fixed there: the range's width bounds a page as `limit` does, so a
whole line naming a range the collection has outgrown answers from its recording, and the gate checks nothing by it.
The merge also brings that branch's other fixes: unseen writes stay pending, later creates follow their sequences, and
later document writes stay at their object. Over the 50 captures no view or write plan changed and served write tools
stay at 31; the six environments compare exactly as before.

It then merged that branch at 0ae64400 and 6257de93: an update's identity member never takes a rule, a page size of
zero bounds nothing, and the paging rules move to `environmentStatePaging.ts`. Over the 50 captures again no view or
write plan changed, and the six environments compare exactly as before.

A fourth round merged the write-plan branch at 466ed8b4, which fixes four findings Greptile raised here against its
code: an update whose observation drops a field is refused, entities are named as serving names them, a later
create's generated values must keep their forms, and a derived state too large to load back is not served. The page
cap here now uses that branch's `pageBound`. Over the 50 captures no view or write plan changed and served write tools
stay at 31; the six environments compare exactly as before. It then merged 7cef2fb2, whose fixes settle two more findings Greptile raised here against that branch's code: zero
page sizes erasing positive bounds, and interference timed by a tool's call on another collection. Over the 50
captures again no view or write plan changed, and the six environments compare exactly as before.
