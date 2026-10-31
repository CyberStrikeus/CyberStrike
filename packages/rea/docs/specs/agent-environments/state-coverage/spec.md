# Wider environment state coverage and tool descriptions

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

The `environment-state` view backs more read tools with state, and a served
environment tells agents more about each tool. Read-only paths whose responses
are not entities become documents, listed items may be identified by an
`…Id` or `…_id` field, an item wrapped in a one-element array is located
inside it, and reads that vary by path get their own recorded reason. Each tool description says what the tool returns and which statuses
were recorded, and every MCP tool carries method hints. This increment adds no
tool, view kind, provider, network activity or write effect.

## Requirements

- A `GET` list tool (its template does not end in a parameter) that yields no
  item or list plan holds its latest initial value as a `document` when its
  initial reads have one request line, whether or not the capture writes its
  path, unless its value changed between two of those reads across any
  recorded write (even under another root), which leaves it `fields-differ`. A
  value whose rendered JSON exceeds 256 KiB stays `rendered-oversize` and is
  replayed from the recorded body, which itself fit. More request lines give
  `path-varies` when they differ by path (a template with a parameter before
  its end) and `query-varies` when they share one path. With every such read
  now a document, `path-varies`, `query-varies`, `body-unusable` or
  `rendered-oversize`, the unreachable `not-entity` reason leaves the result
  schema, and `no-identity` names item tools only. A document holds the value
  of its one `path`.
- When no path parameter proves an identity and no identity name identifies
  the listed items, the `field-name` identity is the first key of the first
  listed item, in its order, whose name ends in `Id` or `_id`, that every item
  carries as a distinct string or number, and that at least one initial
  recording shows distinct across two or more items. The last condition goes
  beyond "every item carries it distinctly": one item satisfies that
  vacuously, and a lone item's suffix-named fields are often foreign keys (a
  reaction keyed by its user, a comment by its post), so a list that only ever
  held one item stays a document. Empty recordings constrain no field.
  Identity names keep precedence, also when choosing among an envelope's
  arrays, where a suffix-named field identifies only an array of two or more
  items.
- An item response that is a root array of exactly one object, or an object
  with one member holding such an array, locates its entity at `/0` or
  `/<member>/0` when one of the identity names in that object repeats the path
  value. Objects at the root or in one member keep precedence. `at` and
  `replaceAt` read and replace exactly these forms besides the root and one
  member, so the gate and renderers run unchanged.
- An entity's state order is its place on the first whole line its collection's
  application order lists, else its earliest sighting on the timeline (see
  the state view); it cites its records in timeline order, whichever plan
  observed it first.
- Each tool description reads `METHOD template; <returns>; recorded statuses
  …; replays retained records […]; evidence ev_…` after the untrusted-catalog
  warning. `<returns>` describes one level deep the first cited `2xx` record
  replay answers as JSON: an object's fields, an array of objects' fields, or
  an envelope whose member lists objects, where a list is an array of objects
  found by the state's list rule; an empty field set reads `with no fields`.
  Only when no `2xx` record replays as JSON does the first cited JSON record of
  another status give it, labelled `status <code> returns …`; with no JSON
  record it is omitted. The statuses are the manifest tool's `statuses`, the
  one owner of that set (`no recorded status` when it is empty). Field names
  and statuses are sampled within the description sample budget and charged
  with the whole description to the catalog reservation before it is retained.
  One owner in the environment source classifies each retained body as none,
  base64, cut, JSON or text; replay answers from that classification and
  descriptions read only its JSON case.
- MCP tools carry `readOnlyHint` (true for the safe methods `GET`, `HEAD`,
  `OPTIONS` and `TRACE`, and for query `POST`s),
  `destructiveHint: true` for `DELETE` (unset for other writes, so the MCP
  default applies, and for reads, where clients ignore it), `idempotentHint`
  (true for the safe methods, `PUT` and `DELETE`) and `openWorldHint: false`. The
  tool definitions own the hints and charge them to the catalog reservation;
  the environment card keeps its `name`, `description`, `inputSchema` tool
  shape.

## Acceptance and limits

Synthetic captures cover read-only documents, `path-varies` and
`query-varies`, suffix-named identities with their key order, their
two-item proof, empty first recordings and their precedence (including the
choice between an envelope's arrays), a Ghost-like `{"posts":[...]}` item under
a trailing-slash path merging with its list view, a root one-element array, a
one-element filtered list that stays unidentified, and the pointer forms. The
Grafana-shaped fixture covers documents for its read-only paths (its one-member
team list among them) and object, array and enveloped-list descriptions;
synthetic sources cover the `2xx` preference over an earlier error body, the
first of several JSON records, the labelled fallback, the manifest's statuses,
empty, scalar and fieldless bodies, a truncated member name, a name whose
JSON quoting exceeds the sample, a recorded body under 256 KiB whose rendered
JSON exceeds it, non-JSON bodies and the catalog budget; the in-process and
compiled MCP servers advertise the
hints. A filtered list may still answer with one element whose identity name
repeats the requested value; list filters, pagination, lossless big integers
and cross-endpoint entity linking remain out of scope. Documents inline whole
recorded values and enlarge the state result; agent tokens, CPU time and peak
memory of the state and description build were not measured.

## Deferred issue criteria

Serving from the state, the AgentEnv data plane and write effects remain later
increments of #4933. This PR must reference rather than close the issue.
