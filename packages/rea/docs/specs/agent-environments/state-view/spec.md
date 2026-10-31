# Environment state view from captures

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

`inspect_analysis_view` accepts `view: {"kind": "environment-state"}` for the
parents the environment manifest accepts and extracts the initial state the
capture's reads observed: entity types with an identity field, entities with
their recorded values, documents for written paths whose reads are not
entities, and a render plan per read tool that reproduces the tool's latest
initial recordings from the state, or a recorded view with the reason it
cannot. This increment adds the view kind only; serving from the state, loading
another state through the AgentEnv data plane and modelling write effects are
later increments.

Safe `HEAD`, `OPTIONS` and `TRACE` tools have recorded views with reason
`method-replay`; state rendering currently applies only to `GET` reads.

## Requirements

- Accept `inspect_web_network_capture` HAR parents and
  `capture_browser_scenario` parents that selected response bodies, with the
  manifest's admission: the same format, subject and sensitive-value refusals.
- Group records exactly as the manifest does for the same `template_rules`, so
  tool names match the manifest the state accompanies.
- Order primary-origin records by recorded start time, or by record order when
  any start time is missing, and say which. Bound each type's state by the first
  write under its root (API base, version segments, one segment); a query
  `POST` is not a write, a read overlapping the write is left out, and a write
  whose URL was redacted bounds every type, with a limitation counting it. A
  successful `POST` elsewhere bounds a type's state too when its response named
  an id (an identity member, or a bare or sole scalar of four characters or
  more) that the type's reads show only once it began: the `POST` made that
  entity, so it is not in the initial state. A read finished before the `POST`
  began shows what was there, and one still running may show its effect. A list
  read shows the ids its listed entities carry as their own identity members, an
  item read its path's id only when its body shows the item (a JSON `null` shows
  none), and
  across two or more of them, when no id-named field (`id`, `uuid`, …; not `key`,
  `slug` or `name`) identifies them, the first suffix-named field (`projectId`)
  distinct on each, so a foreign key beside an `id` is none of theirs, nor are the
  ids of entities they nest. An id shorter than four characters counts only
  when the type was read before the `POST` and an item read names it after.
- Prove an item type's identity field from the requested path value its
  responses repeat; otherwise infer it from a fixed list of identity names that
  every listed item carries distinctly, which needs at least one listed item.
  An item read that asked for some fields only (`fields`, `fields[...]`,
  `select`, `$select`) and does not return the item is left out of the proof
  and of the view's checks; the view lists it in `projected_record_ordinals`.
  Beside a line showing whole entities, a list line asking for some fields only
  (a projection value other than `*`, which asks for all) is listed there too,
  and proves no identity or membership. So is an item line first recorded after
  the type's initial reads, judged against the lines left once variants are
  dropped: one that names a shaping parameter none of them named while its
  object carries or lacks members theirs do not, such as a later
  `?expand=shelf` read, or one that selects some fields and leaves out members
  they always show, such as a later `?fields=id,name` read. On a view with
  such replayed reads, serving replays a call naming a projection parameter for
  an entity the state holds unless every value it gives is `*` or one a checked
  line gave, and no replayed read gave it. The write gate leaves out exactly
  the successful reads serving replays, and any read that names one and leaves
  out a field its view requires, which serving would answer whole.
- A request line of an item or list view is a representation variant when it
  shows an entity another line shows with other members, or names a parameter
  the base lines do not (paging aside) while its objects carry a member no base
  object carries or lack one every base object carries. Base lines are taken
  first: lines naming no such parameter, then lines asking for every field,
  then the line most others agree with. A variant leaves the view's checks, the
  entity observations and the membership changes that would end the type's
  initial reads when a query key tells it apart: a parameter only
  variants name, a value no base line gives a parameter, or a parameter every
  base line names that a variant leaves out. The view lists its latest
  recordings in `projected_record_ordinals` and the keys in
  `projected_query_keys`; serving replays a call matching a key with the reason
  `variant` (`projection` when it leaves out a projection parameter every base
  line names; a projection value is tested as above), so the
  answer is a recording and shows no served write. The write gate neither
  checks nor learns from a successful read serving replays; a 400, 404 or 410
  such a read answers is still the absence it checks.
- A field every recording of a view carried is required: serving refuses an
  entity lacking it. Once a successful read the write gate checks, naming no
  projection parameter, shows the application leaves the field out of an entity
  the state holds (APIs that omit empty or false members), no view of the type
  requires it.
  Never treat an envelope that is itself an entity as a list.
- A top-level UUID or clock member that differs on every repeat of a path's
  successful GET lines with no write between, and across the capture differed
  on at least two repeats and never stayed the same, is minted per response
  there (a request id). A view names it in `per_response_members` only when
  every concrete path the view answers independently proves it minted. A
  collection's proof does not establish that its item paths mint the same
  member. The shared envelope compares without these common members, and
  serving keeps their recorded values; an unproved envelope difference stays
  recorded rather than borrowing another path's value.
- Merge observations into one entity per collection and identity: item views'
  latest values win over list views', differing views keep their own values,
  and a value that changed between repeats of one request line with no recorded
  write is volatile and keeps the latest; a change across a write under another
  root, including between two tools of the type, ends the type's initial reads
  at the earliest write within the change, and the state is extracted again
  once; a type whose reads still disagree keeps every tool recorded. Compare list membership, including empty lists, and field presence before selecting each request line's latest recording; a change across a write ends the type's initial reads the same way. Different query strings remain distinct; omitted fields do not erase their earlier observations on other request lines.
- An item or list view whose recordings always spell a clock field's instant
  otherwise than the entity's stored value (`Z` against `+00:00`, another
  separator or fraction width) names that spelling in `clock_formats`; a field
  it also shows as stored, or spells two ways (counting values at another
  instant), gets none. A stored value the view never recorded, such as one a
  write made, is rendered in that spelling: its wall clock in the view's zone,
  under the view's separator, with its own fraction digits padded with zeros to
  the view's width and none dropped; an epoch spelling is computed from the
  instant.
- An item or list view names in `sorted_arrays` the fields it lists as string
  arrays in code-point order whatever order they were written in (tags kept as
  a set). Only the write gate learns it. A field is a candidate when every
  initial entity shows it as a sorted string array or null, one with two
  distinct strings, and no read the gate counts has listed it unsorted with two
  distinct strings. It is learned from a counted read that fails with the
  stored order and passes with the field sorted, and only when that read lists
  a written array in an order that is neither the written one nor values the
  initial state held first, then the new ones as written (an application
  ordering by tag id or creation shows that order too). The stored value keeps
  the written order, so a write's own answer echoes it; every view of the type
  for which the field is still a candidate sorts it as well.
- A collection's initial order is the order of the first line that lists every
  entity any initial read shows in it and names no sort, direction (`sort[]`,
  `_sort`, `sort-column`, `sortKey`, `orderBy` and like spellings) or random
  parameter (`random`, `rand`, `shuffle`, `seed`); a collection without such a
  line keeps its entities' earliest sightings.
- A list has `all` membership only when no item-total envelope member (`total`,
  `count` and their compounds, not page counts), at the top level or in a
  top-level object beside the list such as `pageInfo.totalRows`, differs from
  the number of entities it lists and no `has_more`, `next` or next-page token
  is set. Such a member that equals the number listed is a counter; a nested
  one is named by its pointer (`/pageInfo/totalRows`), and members beside it
  such as `isLastPage` stay as recorded.
- Keep an item or list plan only when it reproduces each request line's latest
  initial recording from the state, comparing JSON values without regard to
  member order; otherwise record the tool with a reason. Parse bodies only when
  JSON-like, UTF-8, at most 256 KiB and exactly representable. Preserve all own
  JSON members, including `__proto__`, through extraction and normalization.
- Mark the Evidence inferred; state unknowns for authorization, response
  semantics and write effects.
- Charge the manifest's admission and grouping, every record line, every body
  as temporary bytes before decoding and parsing, and every kept value, within
  the existing 96 MiB budget. A planning pass that a rewrite cut discards
  releases its charges before the state is extracted again.
- Read response bodies through one domain owner shared with replay, and parse
  exact JSON through the owner of the exact-number policy.

## Acceptance and limits

The Grafana-shaped HAR fixture with distinct start times drives domain,
service, MCP, CLI and acceptance coverage: folders merge their detail and list
views under a proved `uid`, the dashboard entity is read from its `/dashboard`
wrapper, and the annotation list after the annotation write has no initial
recording. Synthetic captures cover write bounds, volatile fields, complete
lists with counters, each recorded reason and documents; the scenario fixture
covers record order and the response-body requirement. The view performs no
network activity and serves nothing. Values copied outside entity objects,
derived values and cross-type effects are not tied to the state.

## Deferred issue criteria

Serving tool calls from the state, `data/reset`, `data/add` and `data/get` on
the environment data plane, exporting the state with a bundle, and write
effects are later increments of #4933. So are documents for item-shaped
written paths (one per identity rather than per template) and for paths that
are only deleted; until then their reads stay recorded. This PR must reference rather than
close the issue.
