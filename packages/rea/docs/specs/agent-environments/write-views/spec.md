# Writes whose answers show the entity otherwise than reads, and whole-object updates

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

Agents built environments from a prompt for five applications the prompt flow had never seen (Vikunja, Ghost, EspoCRM,
Paperless-ngx and Miniflux). Two write-model gaps withheld most of their creates and edits:

- **A create's answer is another view of the entity than its reads.** Paperless answers a tag create without the
  `document_count` its item read shows. EspoCRM answers a contact create without nine fields its item read shows.
  Vikunja answers a label create with a partial `created_by` and clocks to the nanosecond, where reads show the full
  user and whole seconds. Ghost answers a tag create without the `count` its list shows. The state built the entity from
  the answer alone, so the read-back contradicted the create.
- **A whole-object update sends back what the application derives.** Paperless's UI sends the tag's old `slug` with a
  new name, and the application slugs the name anew. Ghost's UI sends the `updated_at` it read, and the application
  stamps a new one. The update was withheld as `unexplained-change`, or its first call's value was pinned so that later
  calls conflicted.

## Behaviour

- **Read-backs.** When the first read of a created entity before the next write shows fields the create's answer lacks,
  or spells its clocks to another precision, the observed entity takes them, and the plan records the read
  (`observation.read`, with its shape).
  - An item read that agrees with the answer otherwise lends its fields and its clock spellings (whole seconds of a
    nanosecond clock, or microseconds of one), and no longer confirms the create. One that disagrees on another value,
    or omits an answer field its item view renders, still checks the create, which it contradicts.
  - A list read, which may show fewer keys of an object, only adds fields the answer lacks and still checks the create.
  - A read that shows nothing new leaves the observation as it was and still confirms the create.
  - Serving merges the same two recorded objects, so a served create answers in its answer's shape and stores the
    fields of both. Generated clocks in the create answer retain that answer's recorded precision independently of
    the stored read-back precision.
- **Restamped clocks.** An update member sent back as the clock the entity held, and stored as a fresh clock near the
  call, is a `clock` rule, accepted with any value.
- **Re-derived slugs.** An update member stored as the slug of another member the call stored as sent is a `slug` rule
  from that member, accepted with any value.
- **Compatible saves.** A call that echoes an already-derived slug or holds a clock in its own recorded second does
  not conflict with a demonstrated derivation, in either call order. A slug derivation must reproduce earlier saves
  as well; an explicit custom slug that disagrees still withholds the update.

Plans and views that need none of this are unchanged.

## Acceptance

- The held-out recordings serve EspoCRM's contact create and Paperless's tag edit.
- A create whose item read-back disagrees with its answer on another value is still contradicted.
- No write tool of the 69 recorded captures goes from served to withheld.
