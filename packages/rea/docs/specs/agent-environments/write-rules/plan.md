# Implementation plan

1. **Blame and the constant guard.** A module attributes a failed item read to the writes whose fields it disagrees on,
   and create explanation pins members a constant derives from.
2. **Update rules.** A module holds the stamp, derived, held-clock, nested-clock, token and envelope rules; write
   plans record the recorded query and pinned members, and serving and the gate apply them alike.
3. **View order.** A module orders collections by whole order-free lines, another learns sorted string arrays from
   read-backs, and the list query and the initial order share one order vocabulary.
4. **Bulk writes and item actions.** A module addresses writes at a collection or an action path; the gate applies
   them per entity and serving answers them atomically.
5. **Per-response members.** A module finds members a path mints anew and leaves them out of that path's comparisons.
6. **Nested counters.** List facts and rendering read and write totals through JSON pointers.
7. **Tests and docs.** Each step's tests fail on the step before; the state-view, state-writes, list-queries and
   state-coverage specs and the environment docs describe the new behaviour.
