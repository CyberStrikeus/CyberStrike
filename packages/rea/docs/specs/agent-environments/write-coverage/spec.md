# Wider write coverage

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

Four recording shapes kept write tools out of the manifest or left their writes unserved, although the recordings showed
what the writes did:

- **Bodiless replies.** A write answered `204` with no body (Jellyfin's and Shlink's deletes, Miniflux's and Keycloak's
  updates) had no JSON-like content type, so its group was excluded as `non-json` and never became a tool.
- **Omitted fields.** A field every recording of a view carried was required, so an application that leaves empty or
  false members out of some entities (Go's `omitempty`) made the write gate refuse its own read-backs.
- **Projected reads.** An item read asking for some fields only (Directus's `/items/provisions/2?fields=title`) does not
  repeat the requested id, so it blocked the identity proof of the whole item view, and the view's writes had no state
  target.
- **Digit-group sequences.** A sequence spelled in digit groups (Homebox's asset number `000-005`) was not an integer, so
  a create that numbers it had no rule for it and was contradicted.

## Behaviour

- **Manifest.** A write group (`POST`, `PUT`, `PATCH`, `DELETE`) is kept as a tool when every response had no body (a
  `204` or `205`, an empty text, or a recorded size of zero) and one succeeded. A missing text alone does not count.
- **Omitted fields.** The write gate notes required fields missing from the entities the state holds that successful
  reads it checks return, when the read names no projection parameter: the item whose id the path names, or the listed
  items. No view of the type requires them any more. A read that checks nothing, such as one begun while a modelled
  write to its targets still ran or a page the collection has outgrown, notes none.
  Established omissions apply when classifying subsequent reads and choosing later write observations, not just
  when serializing final views. A complete `fields=*` read is not partial solely for lacking a known optional field.
- **Projected reads.** An item read naming `fields`, `fields[...]`, `select` or `$select` that does not return the item
  is left out of the identity proof and the view's checks. The view lists it in `projected_record_ordinals`, and serving
  replays a call to that tool naming such a parameter, for an entity the state holds, with the reason `projection`;
  the replay shows the recording, not served writes. The write gate neither checks nor learns a write's effect from a
  successful read serving replays, nor from one that names such a parameter and leaves out a field its view requires; a
  400, 404 or 410 such a read answers is still the absence it checks.
  Identity-free projection evidence after the initial-state cutoff is retained too, without seeding later values
  into initial entities. Failed responses are classified before the projection-replay shortcut, so a projected
  absence can confirm a delete or contradict an unexplained disappearance.
  A list line asking for some fields only beside one showing whole entities is replayed the same way and proves no
  identity or membership; an item or list line showing its entities in another representation (an expanding or
  reducing query) is replayed when a query key tells it from the view's other lines (`projected_query_keys`, reason
  `variant`). A call asking for some fields only replays unless every value it gives is `*` or one a checked line
  gave, and no replayed read gave it; such calls replay recordings and do not show served writes.
- **Sequences.** A sequence value may be `-`-separated digit groups of one width of at least two digits, not a date,
  version or address. The next value keeps the exemplar's groups and zero padding; digits that outgrow them lead. A
  later create must record its value spelled that way. A held value whose digits outgrew the mask (`100-00` after
  `99-99`) counts only when it is the exemplar's spelling of its number, so a reloaded state numbers on from it.

## Acceptance

- Over the 50 published captures, no write group is excluded as `non-json`, served write tools rise from 35 to 39, and
  no write tool is served on the base and unserved here.
- The re-recorded Homebox capture's create is served.
- Every served write tool of those captures applies.
