# Learn creates from every call, sorted arrays and referenced entities

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

After the derived-values change, the creates prompt-built environments still withheld failed for four reasons the
write model did not cover:

- A create plan was learned from the tool's first call alone, so a later call that sent a member the first did not
  (Linkding's `shared`), or left one out, was refused even when it agreed with the plan everywhere else.
- Linkding stores `tag_names` sorted, so a call that sent its tags in another order did not echo them, and its create
  was withheld or contradicted.
- Homebox's item create answers its parent and type as whole objects (`parent`, `location`, `entityType`) beside the
  `parentId` and `entityTypeId` it sent. Kept as constants, they pinned those members to their recorded values.
- Lists show some objects with fewer keys than an entity holds: Homebox lists an item's parent without the parent's
  own type, and Keycloak lists a user's `access` with one key. A created entity's object rendered whole, so the list
  check failed.

## Behaviour

- **Every call.** A later create is explained on its own and merged into the plan when both calls show the same fields,
  but for a reference whose member a call without it did not send (one an earlier create added stays), every field
  both rule they rule alike, and a field neither rules holds one value. Members either call sent are accepted, only
  those every call sent are required, and an echoed member a call left out takes the value that call stored
  (`body.defaults`). A clock widens to `trimmed` only when no held entity or earlier call showed it at a fixed width. A
  later create that disagrees leaves the plan as it was and is judged as before; one that left out a member the plan
  fills while showing that field otherwise is `unexplained-change`. Merged rules keep the plan's order.
- **Sorted arrays.** An echo is `sorted` when the application stored the sent strings in code-point order rather than
  as sent; serving stores them sorted. A plain echo and a sorted one agree, and the plan keeps the sorted one, since a
  call whose array was already in order cannot show it; once a call stored strings out of order as sent, they disagree.
- **References.** A created or updated object field that holds fields of the entity a sent member names, as the state
  holds it, is a `reference` (member, type, fields). Several members naming such entities resolve to the one named like
  the field. The member is accepted with any value. Replay and serving look the entity up in the state they hold;
  serving refuses a call naming one the environment does not hold or holds in more than one collection, and the field
  is absent, from the entity and the create's answer, when the call does not send the member. An update that sends the
  member naming the entity the field already repeats keeps a reference an earlier call showed.
- **Nested view keys.** A view that always shows a field's objects with the same keys, in any order, and fewer than
  an entity stores, names them in `nested_fields` in the first recording's order, and a stored object it never
  recorded renders with those keys.

Plans and views that need none of this are unchanged.

## Acceptance

- Linkding's prompt-recorded bookmark create whose read-back lists tags sorted is served, and Homebox's item create is
  explained without pinning its parent or type.
- No write tool of the 69 recorded captures goes from served to withheld.
