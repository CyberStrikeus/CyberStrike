# Serve the writes that later reads explain

Issue: https://github.com/morluto/rea/issues/4933

## Outcome

Environments built from a prompt withheld some writes in every recording of an application, though the recordings read
each write back:

- EspoCRM keeps a deleted record. A read of it answers `200` with the record and `deleted: true`, which replay took
  as the record still being there, so contact and task deletes were contradicted or left unconfirmed.
- EspoCRM pages its lists with `maxSize`, which REA did not know as a page size, so a list read after a delete was not
  taken as listing the whole collection and confirmed nothing.
- Vikunja shows `subscription` only on tasks created after the recording started. The tasks' item view did not show
  it, so reads of created tasks disagreed with the state and contradicted the task update before them; and an update
  whose recorded answer shows it could not answer for a seeded task, which lacks it.

## Behaviour

- **Soft deletes.** An item read whose object is marked deleted (`deleted`, `isDeleted` or `is_deleted` set to `true`)
  agrees with an entity the state does not hold, as a `404` does. Replay drops the entity such a read names, and such
  an object never seeds or adopts an entity. The item view records the flag its reads set as `deleted_flag`, and
  serving keeps an entity a served delete removed from such a type until a reset or load, so a read of it by id answers
  its last fields with the flag `true`, as the application does.
- **Page sizes.** `maxSize`, `max_results` and `maxResults` are page sizes, for a list read's whole-collection
  membership and for a list query's `limit` role.
- **Fields only later reads show.** An item view also shows the members that reads after its type's first write show
  of the entities they name, when no initial entity holds them. They are never required. An update or delete that
  answers with the entity, a bulk update's answer included, leaves such a field out when the entity does not hold it,
  and the field no longer makes the write `incomplete-entities`. A field some initial entity holds keeps the existing rule: an answer showing it is
  refused for an entity without it.
- **Skill.** Updates change the fields a person would change (a name, an email address, a status, a due date) rather
  than only a description, since a served update accepts only the members a recorded update stored, and a deleted
  object may read back marked deleted instead of `404`.

Plans and views that need none of this are unchanged.

## Acceptance

- No write tool of the 130 recorded captures goes from served to withheld, and no plan's rules, body or `insert`
  changes.
- Rebuilt from the same recordings, the branch passes at least the write tasks #7260 passes.
