# Verification

Executed on macOS with Node v24.22.1 on this branch and on #7539 at `30e2a582`; the census and the base reproduction
were repeated after merging #7539 at `2817665d`, `174a0ff2`, `5691f97f` (which merges main with #7332)
and `3b800a10`.

## Diagnosis

Over 148 recorded captures, #7539 withholds 302 of 694 write plans. The largest clusters: Homebox item writes (36),
unconfirmed deletes (23), Grafana's feature-flag evaluation calls (15, which change no state), Linkding renumbering
bundles after a delete (7) and Miniflux's bookmark toggle (5).

- **Grafana.** A fresh recording created "Scratch Pier 3", which the list after it showed after the one seeded folder,
  then "Scratch Meadow Notes 4", which the list after it showed before the first, by title. The create plan had settled
  on `last` when the first list confirmed it, so the second list contradicted it, and the folder update and delete
  after it went unconfirmed.
- **Homebox.** Item creates send `parentId` and `tagIds` and answer with `parent` and `tags` objects. The recording
  that created one item with neither (`null` and `[]`) and one with both was withheld: `tags` had no rule, and the
  first create fixed both members to their empty values.
- **Miniflux.** `PUT /v1/entries/{id}/bookmark` sends no body and answers `204`. Chromium exposes no body for it and
  the request names no `Content-Type`; REA read the body as unusable. Across the captures, every `POST`, `PUT` or
  `PATCH` whose body was captured names `content-type` among its request header names (835 of 835).

## Gates

- `npm run -s check:fast`, `format:check`, `knip`, `scan:todos`, `docs:check`, `verify:test-discovery`,
  `mcp-catalog:check` and `jscpd`: passed.
- `npx vitest run --project domain --project services`: 11,886 passed, 6 skipped, merged with `3b800a10`. An earlier run of the suite failed a
  `SetupRegistrationPrewarm` runner test whose child process outran its 5-second timeout; alone it passes on this
  branch and on #7539 (3.0 to 4.7 seconds).
- `npm run -s test:focused --` the environment build, export and serve CLI boundaries, the analysis-view CLI and MCP
  boundaries and the environment serve MCP boundary: 7 files, 81 passed. `outputSchemaProfile`, `toolSchemaValidity`,
  `mcpSchemaValidation`, `outputSchemaSemanticConstraints` and `analysisViewMcp`: 5 files, 54 passed; the compact
  catalog stays under its frame.

## Tests

- View: a create placed last, then a create a later whole listing shows before it by title, learns `title` ascending
  and its delete is served; an item create naming its parent and tags by id, after one naming none, learns
  `reference` rules for `parent` and for `tags` (`many`) and is served; a body-less action two calls show starring
  then unstarring an entry learns `toggle` and is served, and is not when its calls flip the flag one way only or a
  later call leaves it unchanged.
- Serving: a create stores the parent and the tags its ids name, in the order sent; a create leaving out both, or
  sending them as `null` and `[]`, stores `null` and `[]`; a tag the environment does not hold is refused, and so is a
  `null` shelf where every recorded create named one; an entry the recording never starred flips on each call.
- Records: a hidden request body is absent when the request names no `Content-Type`, and stays unusable when it names
  one.
- The nine behaviour tests fail on #7539 at `30e2a582`, `2817665d`, `174a0ff2`, `5691f97f` and `3b800a10`; the three that guard toggles and `null` ids
  pass there too.

## Write plans and views over recorded captures

The 148 captures, built by #7539 and by this branch: 694 plans, 392 served and 399, both at `30e2a582` and after
merging `2817665d`, `174a0ff2`, `5691f97f` and
`3b800a10`.

- No write goes from served to withheld, and no served plan changes. Newly served: Grafana's folder create, update and
  delete in a fresh recording; Homebox's item create in another; Miniflux's bookmark toggle in three recordings.
- Five withheld plans explain more. Two Miniflux recordings learn the toggle but stay withheld: a list of starred
  entries with no `order` parameter lists them by `published_at`, which REA answers in state order. Linkding's
  unarchive learns its body-less call and stays `unconfirmed`, seen once. Two Homebox item writes learn their tag
  references and stay withheld for other members.
- Views are unchanged: 3,188 views across the captures.

## Review round

Greptile's review of `4e777d28` raised five findings. Two were in this branch's code and are fixed:

- A sort an earlier whole listing ruled out could come back from a later listing once the entity that ruled it out was
  deleted, and a create's retry could adopt it. Each create now keeps the sorts its whole listings did not follow.
- A create sending a reference's member as `null` after a later create added the reference, the first having shown no
  such field, was withheld: the empty-reference agreement now applies there too.

Both tests fail on `4e777d28` and on #7539 at `174a0ff2`; the census is unchanged. The other three were in #7332's and
#7539's code: `308aebf0` (#7332), already here, covers the made-object count, and #7539's `174a0ff2`, merged here,
fixes the update default and the read clock spelling.

Greptile's review of `f7c1bfe9` raised one more, fixed: once a later create sent a reference's member as `null`, a
served create leaving the member out stored `null`, though the create the plan observes left it out and stored no such
field. Serving now leaves the field out there, and still stores `null` for a call that sends it; the serving test fails
on `f7c1bfe9`. The census is unchanged.

## Not verified

- No environment was rebuilt and run with agents for this branch, and no recording was made with skill 55.
- The order an application gives a list read with no sort parameter (Miniflux's `published_at`) when it is not state
  order.
- The rest of the Homebox cluster: `assetId` numbering and item updates; Linkding renumbering bundles after a delete.
