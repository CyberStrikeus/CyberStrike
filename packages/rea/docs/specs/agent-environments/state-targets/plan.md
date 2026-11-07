# Implementation plan

1. **Read-only POSTs.** A module decides once per extraction which POST tools only read, used by the write filter,
   init cutoffs and the write simulation.
2. **Adoption.** The write simulation tracks held entities and writes no built plan models, and takes an unseen
   entity at its first successful item read.
3. **Linked creates.** A module links a POST's returned id to the state type it is first read under; the extraction
   cuts that type's initial window at the POST, and the create plan records the read's collection.
4. **Rewrite cuts.** The merge reports the spans behind a type's rewrite; the extraction cuts the type's initial window
   at the earliest write within them and plans once more.
5. **Variant lines.** A module classifies request lines by the members their objects show; plans drop variants, views
   name them with their query keys, and serving and the write gate replay calls that match.
6. **Tests and docs.** Each step's tests fail on the step before; the state-view, state-writes, list-queries and
   write-coverage specs and the environment docs describe the new behaviour.
