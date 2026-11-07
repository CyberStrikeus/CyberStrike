# Implementation plan

1. **Read-backs.** A create's observation looks for the first read of its entity before the next write; an item read's
   fields and clock spellings are taken when it agrees otherwise, and the read observes; a list read adds fields only. The plan's observation records the
   read and its shape, and serving merges the same objects.
2. **Sent members.** An update's sent member stored as a fresh clock after it sent back the held one is a `clock`; one
   stored as the slug of another member stored as sent is a `slug`.
3. **Schema, tests and docs.**
