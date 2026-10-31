# Implementation plan

1. **Defaults.** `WriteBody.defaults` and its schema; a create's echo of a member a call leaves out takes its default.
2. **Merging.** Explain a later create on its own and merge it: agreeing rules, references one call shows alone, joined
   bodies and defaults, the plan's rule order.
3. **Sorted echoes.** Learn `sorted` for creates and updates, store sorted strings when serving, and agree plain and
   sorted echoes in update and create plans.
4. **References.** A references module that learns and resolves them; created and updated fields resolve them against
   the replayed or live state; the members they read are accepted.
5. **Nested view keys.** The gate's view spelling learner, moved to its own module, notes object keys; rendering
   applies them.
6. **Schema, tests and docs.**
