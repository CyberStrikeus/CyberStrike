# Serve writes whose values the application renames or regenerates

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

Recordings made to show each write's effect, with every write read back at once and two scratch objects per tool,
still left writes unserved where the application stored a value in a way the write rules did not explain:

- a create's member stored under another name: Shlink stores `customSlug` as `shortCode`, and its `shortUrl` ends in
  it, so every slug but the recorded one was refused;
- an update that gives a field a fresh UUID each time: n8n's `versionId`, which the client sends back with the
  version it read;
- an update that rewrites child rows with new UUIDs: Mealie gives a recipe's instructions new ids on every update.

These writes are now explained, and served where every recorded call agrees with the explanation.

## Rules

- **Creates.** A member copied whole into a field of another name, and stored under none of its own, is accepted with
  any value of that field's JSON type. A string that contains a copied value as a delimited token is a template of
  the copying field and is rebuilt around the new value; the copied value has the copy rule's 8 characters at least.
  Echoed values, and copies of them, make no templates, since an echoed name may recur in unrelated text.
  Each text containing a copied value must rebuild that copy; rebuilding it in one text does not make occurrences
  in other templates safe. Otherwise the member remains fixed to its recorded value.
- **Updates.**
  - `unique`: a field that held a UUID and now holds another, which the call did not send (in any letter case) and
    no other entity of the type holds. A sent member replaced this way is accepted with any value.
    A value shared with another output field is not independent generation: scalar and nested generators cannot
    reproduce that relation, so the update remains unexplained rather than serving disconnected UUIDs.
  - `renewed`: an array or object whose only changes are UUIDs replaced by ones neither it nor another entity of the
    type held, at the pointers the rule names (`*` for any array index): every UUID there is new, each old UUID by a
    single new one, and UUIDs elsewhere are kept. A lone UUID is never renewed: it is either `unique` or unexplained.
    Renewal identity is canonical and case-insensitive, including repeated mixed-case occurrences within one field;
    source spelling remains in the retained entity and is preserved by serving. Fresh values must not be sent in the
    request, owned by an earlier or another entity, or shared with non-renewed output fields. Such relations remain
    unexplained until a generation rule can reproduce them. Nested renewed fields may still share one fresh replacement.
- **Serving.** A `unique` field gets a UUID derived as for creates. A `renewed` field keeps the entity's current
  value with each UUID at the rule's pointers replaced by one seeded by the call, the same replacement wherever the
  call renews that UUID; an entity without the field stays without it.

The gate takes the recorded values for both, as for other generated fields. A later call must rule a field the same
way, and no recorded call may keep a `unique` or `renewed` field, since serving changes it on every call.

## Acceptance

- The pilot recordings' Shlink create and n8n update are served. Mealie's update stays unserved: one recorded call keeps
  the ingredient ids the gate's copy of the recipe shows renewed, and no other verdict changes.
- The 50 published captures keep every verdict; only Shlink's unserved create plan changes, accepting
  `customSlug` and templating `shortUrl`.
- Every served write tool of the 50 captures still applies.
- A unit test shows a UUID another entity holds is not `unique`, and a child row whose text changed is not `renewed`.
