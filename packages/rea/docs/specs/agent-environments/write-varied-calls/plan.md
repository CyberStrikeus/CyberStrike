# Implementation plan

1. **Update members.** `refinedBody` keeps only the required members a later update also sent.
2. **Numbered unless sent.** `sent` on sequence rules and their schema; the create merge adopts it for an echoed member
   and a sequence from a call that left the member out; serving and replay take the sent value when there is one.
3. **Cleared by a PUT.** `explainUpdate` records a `PUT`'s left-out member cleared to an empty value as a default;
   update refinement keeps defaults from later calls; `updatedFields` applies them to members a call leaves out.
4. **Update clocks.** `restampedFields` respells clocks from the first later read as it does nested clocks.
5. **Skill, tests and docs.**
