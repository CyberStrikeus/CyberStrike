# Serve writes by what their recordings show

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

After state targets, 30 write tools across the 50 published capture-built environments had a state target but were
refused (contradicted, an unexplained change, or a side effect), and 59 still had none. A diagnosis traced each
refused tool to the fields that differed between the gate's state and the recorded read, and named seven shared
causes. Seven of the 30 are refusals REA should keep (asynchronous jobs, rendered markup, reverse embeds, appended
relation rows), and six need only a better recording. This change addresses the causes REA can fix:

- **Blame too broad.** A failed read contradicted every write it exercised, whatever fields differed.
- **Unsent update changes.** An update changing a field it did not send had no rule unless the change was a top-level
  clock, unique value, slug, renewal or increment.
- **View order.** Collections took their initial order from the earliest sighting, and arrays a view lists sorted were
  compared in written order.
- **Targets at a collection or an action path.** Bulk writes naming entities in the body, and actions at
  `/{type}/{id}/{verb}`, had no target.
- **Per-response members.** A UUID or clock minted on every response made a view's envelope vary.
- **Nested counters.** A list total inside a paging object (`pageInfo.totalRows`) stayed at its recorded value.

## Behaviour

- **Blame.** A failed item read with no interfering unmodelled write contradicts the creates and deletes it exercised.
  It contradicts an update only on a field that update wrote or its response showed, and a field the state lacks that
  the read and the update's response both show is the update's change. A read that embeds a created entity elsewhere
  and the state does not contradicts the create.
- **Constant guard.** A create member is accepted only with its recorded value when a constant derives from it: its
  echoed text inside the constant, a referenced entity's string, or an instant beside a sent date, matched by related
  field names. Only successful calls sent with the exemplar's query show that a member may vary.
- **Update rules.** An update's unsent change can be a modified-by stamp beside a created-by counterpart (with its id
  sibling), a value derived from the one sent member stored nowhere (accepted only while the target holds the recorded
  before-value), or a sent clock other than a creation clock left in the call's own second, which every call must then
  send with the value the entity holds. An unsent clock left in the call's own second keeps the update unconfirmed until
  another call shows it stamped. Objects whose clocks moved with the request are nested clocks, stored from the
  read-back on creates and updates and refused once any call left the object as it was; opaque tokens of a type's own
  length are generated; an enveloped body is learned as its one object. A write takes only its recorded query, and a
  call sent with another neither confirms nor teaches its plan: a create or update only brings the state to what it
  recorded, and a delete, document or bulk call leaves its target unknown. An echoed reference to a nested object or a
  state word paired with other fields stays at its recorded value. The served catalog names these values.
- **View order.** A collection's initial order comes from the first list line that shows every entity its type's
  sightings do and applies no order. A view renders a string array sorted only after a counted read-back shows an
  order that neither the written order nor existing-values-first explains, among the entities that read covers in its
  own collection. A later read contradicting a learned sort makes that view recorded and removes its earlier
  write confirmations and saved overrides; types and entities with no surviving state view leave the snapshot.
  The read's formerly sorted fields are compared as string multisets, so inconsistent ordering supplies no new
  proof and does not hide real value mismatches or contradict an independent view's valid write confirmation.
  Retired views keep a comparison-only representation to check later reads for value contradictions; they never
  regain serving authority or confirm writes through those checks.
  Sort and direction parameters share one vocabulary and are never learned as inert. A create placed by disagreeing
  sorts or a random id falls back to `last`.
- **Bulk writes.** A write at a type's collection whose body names entities by id, as an id array or objects carrying
  the id field, deletes or updates each one, all or none; serving refuses it unless every id is held. Body ids are taken
  as written, and a call naming one entity twice is refused. Each entity's generated values come from that entity,
  sharing the call's clock and counters. A delete requires the members its exemplar sent besides the ids, with their
  recorded values. A recorded response is served when it names none of the ids and counts nothing, or is an array with
  one element per entity the body names, in the body's order, each that entity with the first element's members or its
  id spelled as the first spells its own; serving renders each element from the entity the call wrote, and any other
  response naming the ids refuses the tool. Comparison translates a bulk body's ids with the mapping of the collection
  the write targets.
- **Item actions.** A write to an item path plus a literal segment that names no collection, whose calls answer
  nothing or the entity (never a 201, and with every field its item read always shows), updates that entity; a scalar
  it changes without sending is set on every call. It is served only once a call found every field it sets already at
  that value, so a toggle is never served. An action never takes a read another write to the entity still needs.
- **Per-response members.** A top-level member whose value is a UUID or a clock is minted per response on a path when
  it differs on every repeat of that path's successful GET lines with no write between, and across the capture it
  differed on at least two repeats and never stayed the same. A shared view leaves it out only when every concrete
  path it answers independently proves it minted; a collection's proof never transfers to its item paths. Item
  envelopes and the write gate's item, list and document reads compare without these common proved members.
  The view names it in `per_response_members`, and serving keeps the recorded value.
- **Nested counters.** An item total in a top-level object beside the list is a counter on the same evidence as a
  top-level one, rendered from the state through its pointer. A top-level member whose name starts with `/` is named by
  its pointer (`/~1total`).

## Acceptance

- Over the 50 published captures, served write tools rise and none is lost except where the evidence cannot show the
  write's own effect; write tools with no state target fall.
- Read calls that state serving answers keep matching their recordings, before the first write and across sessions.
- Every newly served write answers a call other than the recorded one correctly, or refuses it.

## Not included

- Soft deletes, appended relation rows, rendered markup and reverse embeds; creates completed from later reads.
- Templating literal ids by value (an opt-in rule served two deletes whose targets came from unserved writes wrongly).
- Identity aliases and resource names; per-response values that differ as instants.
- A replayed write leaves the state as it was, so a served write on an entity only a replayed write made refuses.
