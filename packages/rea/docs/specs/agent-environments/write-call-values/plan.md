# Implementation plan

1. **Query values.** Widen the query property schema and spell numbers and booleans as JSON text where a call enters
   serving.
2. **Sequence start.** `start` on sequence rules and their schema; the exemplar records integer fields above every held
   value; serving and replay floor the next value at `start`.
3. **Later rules.** Merging a later create adopts its `composed`, `template` or started `sequence` rule when it spells
   the exemplar's value.
4. **Made objects.** The `made-object` rule and schema; its explanation, merge, later-call check, counts taken, serving
   and own members.
5. **Bulk link.** `respondedIds` reads the object of a one-element array member; `anyLinkedSource` lets a linked
   create take any path values its plan stores in fields, in replay and serving.
6. **Skill, tests and docs.**
