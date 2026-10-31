# Implementation plan

1. **Blank members.** `WriteBody.blank` and its schema; creates explain empty members as blank; merges join them;
   created fields apply a left-out blank member as sent.
2. **Listed ids.** `listed_ids` on list views and its schema; the gate learns them; list rendering sets them.
3. **Sorted collections.** The replayed state moves an entity whose sorted field changed; update plans carry the
   type's sort; serving moves updated entities; a failed whole-collection read after an update can teach the sort.
4. **Observations.** A create's item read-back accepts unloaded answer values; updates treat empty-container
   respellings as unchanged; later creates check unruled fields.
5. **Skill, schema, tests and docs.**
