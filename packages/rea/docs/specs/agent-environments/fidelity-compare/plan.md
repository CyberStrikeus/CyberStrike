# Plan

1. Export the capture parser from `environmentSource.ts` so a probe loads like a capture.
2. `environmentCompareMatch.ts`: a probe request to a tool and its arguments.
3. `environmentCompareIds.ts`: the id map, natural-key pairing, learning from two answers, translating arguments.
4. `environmentCompareDiff.ts`: normalisation and categorised differences.
5. `environmentCompare.ts`: per probe, reset the state, answer each request, compare and learn; the report.
6. `rea environment-compare` in `src/cli/environmentCommands.ts`, documented in `docs/agent-environments.md` and
   `docs/cli.md`.
7. Tests: matching, pairing, normalisation and categories as unit tests; the command over a fixture capture and probes.
8. Verification on VMs: six applications brought up and seeded as for their capture, reset from a snapshot per sequence,
   driven by a script that records each sequence as a HAR; baseline reports per environment.
