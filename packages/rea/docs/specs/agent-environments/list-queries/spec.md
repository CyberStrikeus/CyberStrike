# Answer list filters, search, sorting and paging from the state

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

Agents list, filter, search and sort constantly. A list view answered a recorded request line from the state only when
that line listed the whole collection; any other line, such as `?shelf=a`, `?q=tide` or `?orderBy=name`, kept the
members it recorded, and a call with a value no line recorded replayed whichever recording was closest. A filtered
list therefore never showed what a write created or changed, and a search for anything new answered with an
unrelated recording.

A list view now learns what each of its query parameters does, from the lines it recorded, and answers those lines,
and calls with new values, by evaluating the query over the live state.

## Learning

For each checked line that does not list the whole collection, the first combination of roles that lists exactly what
the line recorded, from the collection's initial entities, explains it:

- `filter` on a field every listed item holds the value in: equal as text, or in an array directly or as an object's
  `id`, `slug` or `name`;
- `search` for plain substring terms over the string fields the term matched in the listed items, ignoring case (URL fields only for an item
  nothing else matched); an empty term matches everything, and a term that matched no field leaves the parameter inert
  until another line's term does;
- `sort` by the field the value names, with `-` or an `asc`/`desc` suffix, and `direction` for a separate `asc`/`desc`
  (or `ascending`/`descending`) parameter: numbers by value, text ignoring case, null last ascending, ties (case-only differences included) in state
  order; an empty selection needs no sort;
- `limit`, `offset` and `page` (counted from 1 or 0 only when the line distinguishes them) for paging; zero or a negative limit
  lists every match;
- `inert` for a parameter that changes nothing, valid only for the values it recorded.

Search values resembling operators, field syntax, tags, quotes or wildcards replay rather than asserting a literal-substring result.
Paging values must be safe integers; malformed positions are not learned as inert flags. Identical decoded repeats
of a query value impose one constraint; conflicting repeated values remain unknown. Counter presence belongs to
each response envelope: page counters update where observed, and serving never adds a query-only total to another envelope.
Query totals retain their numeric or canonical decimal-string type. Unknown or differently formatted strings
(such as padded `"03"`) are not assigned an unverified formatting rule and stay as recorded.
`state.source` distinguishes a computed response from recording replay; `replay.exact_match` describes only the
retained source envelope and can be false for a correctly computed new query.

Parameter names decide which roles are tried (`sort` for `orderBy`, `search` for `q`), and any other parameter may be a
filter or inert. A name asking for an order in any common spelling (`_sort`, `sort[]`, `sort[0][field]`, `sorters[...]`,
`sort-column`, `sortKey`, `orderBy`) is only a `sort`; a direction name (`_order`, `sortDirection`, `dir`) given a direction
is only a `direction`, and given anything else is an ordinary parameter; `reverse` is never inert unless false. The same
vocabulary decides which lines set a collection's initial order (see the state view). No two parameters of one call take the same `sort`, `direction` or paging role: the answer would
depend on which applied last, and serving supplies a call's values in name order rather than as recorded, so such a
combination explains no line and such a call replays its recording. A line with more than 12 query parameters is left
unexplained, which bounds the search; names such as `__proto__` are kept as the query's own members. The lines' roles
merge: lines that disagree drop the parameter, inert values gather, search fields unite. A filter on a field not
named like its parameter (`shelf`, or `shelf_id`, for `shelf`) can match by coincidence, so it stands only when lines
giving the parameter two different values agree on it; otherwise the parameter takes no role. The merged query keeps the
lines it reproduces, envelope and fields included; any other line keeps its recorded members. The view's `query` names
the roles, those lines, and the envelope members that count every match before paging (`totals`), top-level or one
level down in a paging object (`/pageInfo/totalRows`); a `number`-of-items member such as `numberOfElements` counts the
page.

## Serving and the write gate

- A call that names a query line exactly, or whose every query argument has a role (an argument-less call keeps
  answering on a whole line), is answered by evaluating the query over the state, in the envelope of a query or whole
  line of its collection, with counters at the number listed and totals at the number matched. The answer's state
  provenance says `membership: "query"`.
- A value an inert parameter never recorded, or a parameter without a role, replays its recording as before.
- The write gate checks a read on a query line, or one whose every query parameter has a role on a line it did not
  name, against the query over its copy of the state, as serving answers it: on the line replay ranks first, by the
  most verbatim path values, then the most query values the read shares, then recorded order. Only a line whose
  parameters all sort or page, and whose answer holds every match, covers the collection; any other covers the
  entities it lists and those the line or the read listed that the state no longer holds, so a filtered list shows
  whether a delete or create took effect without speaking for the rest of the collection. A failed read also covers
  the held entities it listed that the answer leaves out, as a write may have moved them out of it. A read on a line
  it did not name counts as gone only what it listed itself, since the line lists another call's members. A read with
  no query answered on a query line, as serving does when no whole line fits, is checked against that line's recorded
  members, as serving lists them. A read on a line that keeps its recorded members is compared with the totals it
  recorded, as serving answers it. A read on a line it did not name is compared in its own envelope: that line's
  envelope, such as a `next` link naming the line's own values, comes from another call, so it says nothing of a
  write. A read whose query applies a sort shows where a create put its entity only when the sort leaves that entity
  tied with another, and an unsorted one only when more than its entity matches, so only then does it fix the create's
  insert position.

The roles are inferences from recorded behaviour and are stated as such. Nothing changes for a list whose lines all
list the whole collection, or that no role explains.

## Acceptance

- Unit tests: each role found from a line, including filters on arrays and object ids, search ignoring URLs, sort
  spellings and nulls, paging by offset and by page, inert values; merging lines; values a role cannot apply.
- Domain: a tool recorded whole, filtered, searched, sorted and with a flag learns all four, and a create the filter
  later lists is confirmed.
- Serving: after a served create, new filter, search and sort values list it; an unrecorded inert value replays.
- Measured: the fifty published captures' learned queries and write verdicts, and the six environments compared with
  their applications, before and after.
