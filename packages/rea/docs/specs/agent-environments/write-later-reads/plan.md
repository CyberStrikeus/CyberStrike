# Implementation plan

1. **Soft deletes.** `markedDeleted` reads the deleted flags; item-read checks, adoption and replay's resync treat a
   marked object as absent.
2. **Page sizes.** Add the names to the paging and query `limit` sets.
3. **Later fields.** Extraction collects the members later plain item reads show; the gate adds those no merged entity
   holds to the item view without requiring them.
4. **Answers.** `laterItemFields` names the item view's fields no initial entity holds; write answers and the verdict's
   `incomplete-entities` check skip them for entities without them.
5. **Skill, tests and docs.**
