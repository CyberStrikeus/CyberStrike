# Serve the writes callers make without recorded form fields

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

Agents now record writes through an application's UI, and environments built that way refused most of the creates
natural-language tasks ask for, or withheld them:

- A form sends every field it shows, the ones left alone as `""`, `null`, `false`, `[]` or `{}`. Every member a
  recorded create sent was required, so a call naming only a title was refused (Homebox tags required `color` and
  `icon`, Linkding bookmarks `notes`, `unread` and `shared`, EspoCRM contacts about twenty members).
- Paperless-ngx answers lists with `all`, the ids of the listed entities in list order. The state did not render it,
  so the first list read after every Paperless create contradicted the create.
- Grafana lists folders by title and Paperless lists tags by name. An update kept its entity where it was, so a rename
  that sorted elsewhere contradicted the update, and a served rename listed in the wrong order.
- A Vikunja create answers before it loads what it stored: the owner with empty fields and Go's zero time, and empty
  lists as `[]` where reads show `null`. The later item read was not taken as the observation, so it contradicted the
  create; an update whose answer spelled an empty list `[]` was unexplained.

## Behaviour

- **Blank members.** A create member a recorded call sent empty is not required. A call that leaves it out is applied
  as sending that value (`body.blank`), so the entity, the answer and every rule reading the member come out as for
  the recorded call. A member a later call left out takes the default it showed instead. A call may send a member as
  any recorded call sent it empty, such as `null` where another stored a string, even once a default is learned, and
  one leaving it out without a default is applied as the earliest did. Updates are unchanged.
- **Listed ids.** A list view names top-level envelope members that list two or more listed entities' identity values
  in list order (`listed_ids`). A rendered list sets them to its own entities' values, unless it is a page of more
  matches, which keeps the recorded value as a partial page's total does.
- **Sorted collections.** An update that writes the field its type's creates are sorted by moves its entity to where
  the new value sorts, in replay and serving (a bulk update moving each entity in turn), and its plan carries that
  `insert`. When a read listing the whole collection in collection order (not sorted by its query) fails after an
  update and the type's creates are not sorted by a
  field the update writes, replay tries the collection sorted by such a field when the entities no exercised write
  changed already follow it, as serving moves only written entities, and unless a create was placed by a sort
  that excludes it or a whole-collection read in collection order (not sorted by its query) that placed a create did
  not follow it; on a match, the type's creates and updates take that order.
- **Unloaded answers.** A create's later item read is taken as its observation when it differs from the answer only in
  values the answer had not loaded: empty, zero, `false` or Go's zero time, or objects whose members are each the same
  or loaded so; the plan points to those values (`observation.read.unloaded`), which a served create's answer keeps as
  the recorded answer showed them, unless the call sent one the plan stores as sent, while the state holds the read's. An unsent update field that changes only between
  `null`, `[]` and `{}` is unchanged. Write answers, bulk answers and replay's checks of them included, spell empty
  lists and maps the call did not send as their recorded answers did, and a sent one as sent.
- **Unruled fields.** A later create that stored a field no rule writes otherwise than the plan keeps it is
  `unexplained-change` at the create, so its recorded entity is held and later reads check other writes as before.
- **Skill.** The two scratch creates differ in what they send, the second only what a person must give, however they
  are made; the skill shows how to read signed-in pages' accessibility trees from a scenario, and re-records once with
  request steps a UI write whose body the browser did not expose.

Plans and views that need none of this are unchanged.

## Acceptance

- No write tool of the 109 recorded captures goes from served to withheld.
- Rebuilt from the same recordings, the branch passes at least the write tasks main passes.
