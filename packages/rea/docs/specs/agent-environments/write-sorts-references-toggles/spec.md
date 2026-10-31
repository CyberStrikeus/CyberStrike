# Serve sorted creates, listed references and toggles

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

Over 148 recorded captures (the 130 measured before and 18 from a fresh recording round), #7539 withholds 302 of 694
write plans. A short diagnosis of the largest clusters found three gaps REA could close:

- **A create's sort learned too late.** Grafana lists folders by title. A recording's first scratch folder sorted
  after the one seeded folder, so the plan placed creates last; the second sorted before the first, the list after it
  contradicted the plan, and the update and delete after that went unconfirmed.
- **Lists of references.** Homebox creates an item from `parentId` and `tagIds` and answers with the parent and tag
  objects. REA modelled a parent but not a list of tags, and a create that sent `null` and `[]` disagreed with one that
  named both.
- **Toggles.** Miniflux stars and unstars an entry with a body-less `PUT /v1/entries/{id}/bookmark`. Chromium exposes
  no body for it, which REA read as unusable, and an action flipping a flag back was taken to contradict the call that
  set it.

## Behaviour

- **Sorted creates.** A create a whole listing in collection order placed last is placed again by a field a later such
  listing shows it sorted by, the type's id field last. A sort an earlier such listing did not follow stays ruled out,
  though the entity that showed it is gone. A create another read placed keeps its place.
- **Listed references.** A field holding one object per id a sent list names, in that order, is a `reference` with
  `many`. A create that sent the member as `null` or `[]` and stored the field so agrees with one that named entities,
  whichever create first showed the reference;
  serving stores the entities a call names, or the empty value as that create did. A `null` id stays refused where
  no recorded create sent one, and a call leaving the member out stores no field where the observed create showed
  none.
- **Hidden bodies.** A scenario request whose body Playwright did not expose and that names no `Content-Type` sent no
  body.
- **Toggles.** An item action a later call shows flipping back a boolean an earlier call set, when no call found it
  already set, has a `toggle` rule: serving flips the field, refusing an entity that holds no boolean there.
- **Skill.** Recordings run an action twice in a row on one object, reading it back after each (skill 55).

Plans and views that need none of this are unchanged.

## Acceptance

- No write of the 148 captures goes from served to withheld, and no view changes.
