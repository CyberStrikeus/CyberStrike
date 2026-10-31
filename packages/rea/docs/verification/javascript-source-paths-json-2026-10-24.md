# JavaScript source-selection JSON verification — 2026-10-24

## Scope and integration

PR #5029 adds `--source-paths-json` to the two static application CLI routes.
One inline JSON array or selected local JSON file appends exact inventoried
paths after repeated `--source-path` values. The application `source_paths`
contract, ordering, duplicate requests, artifact identity and MCP contract are
preserved. This does not add folders, globs or implicit dependencies; #5048 is
separate.

The CLI adapter reuses the existing JSON file reader and domain array schema.
Entries remain artifact-relative. It preserves cancellation and shared file
ownership rather than introducing another reader/parser. The native lane
refuses source-selection options before starting an engine. Main integration
retains existing delivery validation, the caller's summary/view settings,
environment selection and process-owned JavaScript worker cleanup.

The initial main `7f70797b` integration passes **44** selected CLI, filesystem
JSON-input and actual SDK source-selection checks, plus full `npm run check`.
The JSON-file acceptance case now analyzes an ASAR and verifies the original
package's path and SHA-256; the inline case covers an extracted directory.
Both combine repeated and JSON entries and preserve their requested order.
Invalid shapes, empty entries, native-lane refusal and cancellation are covered.
This is static source analysis; the selected application is not executed.

## Completed-task comparison

Compare main `7f70797b98c226009163358f91a9cfcedf03b390` with feature integration
`e886393ae698d4ed411179430c8dbb10ce6c5647`. Three alternating pairs analyze the
same ASAR, selecting `package.json` followed by 210 named JavaScript files.
The baseline repeats 211 path options; the candidate uses one repeated option
plus an existing JSON file with the other 210 paths. All **six** tasks finish.

Every complete Evidence object is exactly equal across all runs, including its
ID, selected paths, provenance, coverage, uncertainty and limitations. Each
result reports 210 parsed JavaScript files, no unselected files, and retains all
210 expected named functions. The ASAR remains 75,620 bytes with SHA-256
`f1089a49e40f4477e0850787654411c0ec208934262837a19e65c2aa4dc5f035`.

| Completed CLI task cost                   | Repeated options | Existing JSON file |
| ----------------------------------------- | ---------------: | -----------------: |
| Displayed invocation characters           |           17,977 |                201 |
| Estimated complete Evidence stdout tokens |        1,861,409 |          1,861,409 |
| Estimated invocation tokens               |            5,078 |                 62 |
| Estimated stdout + invocation tokens      |        1,866,487 |          1,861,471 |
| Elapsed median s                          |           19.149 |             18.389 |
| Waited-child CPU median s                 |           18.250 |             17.340 |
| Sampled family RSS median MiB             |            601.4 |              594.1 |

This solves command-line capacity without reducing the complete analysis
result. Microsoft documents an
[8,191-character Cmd.exe command-line limit](https://learn.microsoft.com/en-us/troubleshoot/windows-client/shell-experience/command-line-string-limitation).
The ASCII fixture's displayed invocation crosses that limit before the change
and stays below it with a file. This is an inference from the documented limit;
the completed tasks ran on Linux, not through Windows Cmd.exe or `npx`.

The caller-provided selection file already exists in this timed task; its
reading/validation is included. If an agent must create it first, the file
contents add an estimated **4,411 tokens**, plus an extra write call's framing
and execution costs, which are unmeasured. Do not treat the shorter invocation
as a whole-workflow token saving in that scenario. File creation, discovery,
prompts, rendering and client JSON parsing are outside the measured scope.

No speedup is claimed: elapsed ranges are 19.142–19.841 s before and
18.277–21.384 s after; CPU ranges are 18.140–18.821 s and 17.278–21.026 s.
The ranges overlap and include a slower candidate run. Tokenx 1.3.0 estimates
stdout and invocation text; these are not billed/model token counts.

Each task starts a fresh Node 24.22.1 CLI and JavaScript worker with CPU affinity
0,1. OS caches were not flushed and the host is shared. These are fresh-process
runs with uncontrolled warm filesystem caches; cold-disk and warm persistent
worker costs are unmeasured. CPU is waited-child user plus system time. RSS is
a 50 ms recursive process-family sample, which can double-count shared pages
and miss short-lived or unobserved descendants. Token estimation and equality
checks run outside timing. Later main changes are outside these pinned costs.

## Final integration checks

Integration with main `cd10ee1f8a8e124be4864e77750a16e76c561809` passes **58**
checks, extending the initial selection with active JSON-read cancellation,
process-level error status and existing route/delivery coverage. This takes
167.935 s, 182.796 s waited-child CPU and 2,056.1 MiB sampled family RSS; these
are suite costs rather than analyst-task costs. Full `npm run check`,
`npm run docs:check` and test discovery pass. These selections overlap the
earlier checks. Later upstream integrations remain outside the cost comparison.
