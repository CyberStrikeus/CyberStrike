# Give more write tools a state target

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

Across the 50 published capture-built environments, 91 of 195 write tools got no state target: the gate refused them
before looking at their evidence, because their path named no state type, item or document. A diagnosis traced each to
its cause in the recordings and the code. The five largest shared causes:

- **Read-only POSTs counted as writes.** A lookup, an RPC tunnel naming read operations, or a session refresh was
  planned as an unserved write and cut initial windows.
- **Entities a write the gate does not model made.** A later read of such an entity failed its check instead of
  holding it, so writes to it stayed unobserved.
- **Creates read under another path.** A create whose path is no state type (`POST /Playlists` read as `/Items/{Id}`)
  had no target, and its entity leaked into the initial state of the type it is read under.
- **Types whose reads disagree across an unrelated write.** Every view of the type stayed replayed.
- **Request lines that show entities in another form.** An extra query parameter that adds or drops members
  (`?counts=true`, `?expand=`, `?fields=`) failed the whole view.

## Behaviour

- **Read-only calls.** A POST is not a state write when its response repeats the read of its path that finished last
  before it began, with no write between, it tunnels only read operations, its last literal segment names a lookup and
  no write, or it renews a session; it is replayed. It stays a write when one of its calls was redirected or unanswered,
  or when a related read line changes across one of its calls, or finds its entity there on one side only, with no write
  but other read-only calls between; a read overlapping the call counts on neither side. Each response body compared is
  parsed once and kept only as its canonical digest, charged to the view's budget until the decision ends.
- **Adopted entities.** A successful item read of an entity the gate's copy never held, after a write no built plan
  models or one redirected or unanswered, puts the entity into the copy within the view's budget; an entity a modelled
  write touched is never taken back.
- **Linked creates.** A POST whose path names no state type becomes a create into the type whose item read first names
  an id its response returned, before any other tool's write, when the id is new: no read finished before it began
  showed it, whether an item read of the id under that type or collection whose body shows the item, a list of the type
  or a read of that collection. Its observation is a read of an id its response returned, in an envelope too. Serving
  creates in that read's collection, for the exemplar's path arguments only (segment by segment, in either spelling),
  and fills path fields with its exemplar's path values decoded once. A successful POST that returned an id a type's
  reads only show once it began ends that type's initial window: a read still running then may show it, and a list read
  shows its listed entities' own ids (identity-named, or a suffix-named field such as `projectId` distinct across two or
  more when no id-named field identifies them), not those they nest. A read at or after the write that ends the initial
  reads is not parsed for that cut, since it cannot show a new id.
- **Rewrite cuts.** When a type's reads disagree across a write under another root, the type's initial window ends at
  the earliest write within the change and the state is extracted again. The earlier of this and the creation cut wins.
- **Variant lines.** A read line that shows the same entities in another form is a variant: it leaves the view's checks,
  the entity observations (an entity's first sighting comes from the lines left) and the membership changes that cut a
  type's initial window, and the view names it with the query keys that pick it out (`projected_query_keys`, on item and
  list views). Beside a line showing whole entities, a list line asking for some fields only (a projection value other
  than `*`) is set aside before the identity proof the same way. A call matching those keys replays its recording, so it
  does not show served writes; a 400, 404 or 410 on such a line is still evidence. A call asking for some fields only
  replays unless every value it gives is `*` or one a checked line gave, and no replayed read gave it. The write gate
  skips exactly the successful reads serving replays, by the same decision. A filter role whose name matches no field
  needs two agreeing values. A tool whose lines would take more than 2^24 line pairs and entity lookups to compare
  pairwise keeps every line checked; otherwise lines are compared only with those showing one of the same entities,
  through an index charged to the budget while it is held. The base lines' queries are parsed once for every variant
  they key. An item line first recorded after the initial window is a variant too, judged against the lines left once
  variants are dropped: when it names a new shaping parameter and its object carries or lacks members theirs do not, or
  selects some fields and leaves out members they always show, and an item only a replayed line showed, which the state
  never started with and in whose type no served create has added an entity since, answers with its own recording.

## Acceptance

- Over the 50 published captures, write tools with no state target fall from 91 to 61 and served write tools rise from
  46 to 61, with none lost; every served write tool applies.
- Read calls recorded before the first write that state serving answers keep matching their recordings; each newly
  state-backed view answers them as recorded, except where replay itself does not.
- The Grafana and Mailpit environments no longer hold, in their initial state, entities their captures created.
