# CLI JSON Lines verification — 2026-10-23

The analyst task was to export retained JavaScript observations as independent
records while keeping their Evidence provenance, coverage and unknowns. JSONL
framing stays in the CLI adapter; analysis and view projection continue to use
the same application workflow as MCP.

## Real artifact and completed workflow

The installed, locked `semver@7.8.5` npm package was analyzed through the public
`analyze-javascript-application` command, without executing its target code.
It parsed 50 selected files and produced a 12,185,829-byte Evidence document.
Preparation took 12.295 s elapsed, 12.648 s child CPU and 678.5 MiB sampled peak
process-family RSS; preparation is separate from the export measurements.
The artifact digest was
`65c9cce0fbebc34824c1b9657a514e7c5525ab079b232ce9da095697271b7953`.
The saved Evidence file SHA-256 was
`b34627bc12894d4c749e5b24c60731dd5a7eaaf90c98954f0e585eb442d484c3`.

Preparation ran on main `169512a35`; the exact retained parent was reused by
both refreshed export variants:

```json
{
  "source": { "kind": "evidence-file", "path": "/absolute/path/parent.json" },
  "view": {
    "kind": "javascript-facts",
    "property_keys": [],
    "include_available_property_keys": true,
    "offset": 0,
    "limit": 256
  }
}
```

Each completed measurement executed one public CLI call:

```bash
node scripts/rea.mjs inspect-analysis-view request.json --format jsonl
```

The view contained 202 observation rows. Every before/after pair reconstructed
exactly equal complete Evidence JSON, including identities, subject/provider,
authority/confidence, locations, parent/view digests, links, original coverage,
17 view limitations and 20 unknowns. These source limitations remain limitations;
exhausting this selected view does not establish complete application analysis.
Before emitted one document; after emitted 202 rows and one metadata record.

## Performance

Baseline: refreshed main `2443b949a48c3b2eba687e7381682e49e909d5b9`.
Both variants used Node 24.22.1 and the same locked dependency installation.
Three alternating pairs ran sequentially, with fresh processes and warm
filesystem/build artifacts. Node compile caching was not configured. Cold host
filesystem caches and repeated analysis were not measured.

| Completed export, median of three |    Before |     After |
| --------------------------------- | --------: | --------: |
| Elapsed time                      |   4.510 s |   4.576 s |
| Wait-accounted child CPU          |   5.876 s |   5.987 s |
| Sampled peak process-family RSS   | 496.3 MiB | 495.1 MiB |
| Emitted UTF-8 bytes               |   365,494 |   365,608 |
| `tokenx` token estimate           |    99,004 |    99,041 |
| CLI calls                         |         1 |         1 |

The small observed overhead does not establish an analysis speedup.
The 114-byte / 37-estimated-token increase is framing overhead, with the same
facts and no additional tool/schema round trips. The identical request file
contributes another 74 estimated tokens to each case. These are heuristic `tokenx` estimates, not model-specific BPE counts;
orchestration prompts, agent reasoning and tool-definition tokens were not
measured. Actual agent context consumption also depends on which rows the
consumer reads. No token reduction is claimed.

Rows and metadata share the existing bounded JSON encoder and awaited writes.
Token counting reuses that exact record plan, including context, and estimates
one complete line at a time rather than materializing the complete export.
A single line still must fit the estimator's runtime string limit. Token-count
performance, much larger applications and time to first consumed row were not
benchmarked.

The harness pinned the process family to two CPUs, used a 2 GiB V8 heap limit,
`GOMAXPROCS=2`, `GOMEMLIMIT=2GiB` and two libuv threads. It sampled descendant
RSS every 50 ms and would terminate the task at 6 GiB or 30 minutes. No resource
stop occurred. RSS sums can double-count shared pages and miss short peaks;
the V8 limit is per process and the sampler is not a kernel memory limit.

## Validation

`npm run check` passed on the refreshed integration, including type checking,
lint, formatting, dependency/metadata checks and architecture guards. The parsed
output-control contract from current main is retained; handlers, launcher and
reusable test drivers consume those same facts.

- 241 tests passed across 14 CLI/MCP/acceptance files: actual production MCP
  catalogs, authenticated Evidence reconstruction, invalid SDK values, ordinary
  and sentinel failures, generator streaming, formatter recovery, empty/partial
  views, large output, pipe closure and asynchronous final writes after cleanup
  success/failure. The run took 171.097 s elapsed, 203.968 s child CPU and
  1589.3 MiB sampled peak family RSS.
- Another 60 tests passed across four consumer files, including ordinary graph
  reports and scalar selections refusing JSONL, malformed JSON input retaining
  diagnostics, managed CLI output and the direct SDK update-alias contract.
  These took 223.152 s elapsed, 262.538 s child CPU and 1079.2 MiB peak family RSS.
- A new negative control showed that calling a collection encoder for a single
  array-valued row undercounted tokens (15 instead of 21, 57 instead of 63).
  Emission and counting now share `jsonLineParts`; both cases and all 29 JSONL
  tests pass after the fix. The 241-test run includes these regressions.
- A real `rea mcp doctor --format jsonl` run reported healthy in one JSON line.
  Startup/validation failures, full-output framing and advertised help are
  exercised separately.

The opt-in verifier used shared 64 KiB leaves and independently checked complete
output bytes and SHA-256, without retaining the complete encoded document:

| Synthetic serialization fixture                 |             JSON |             JSONL |
| ----------------------------------------------- | ---------------: | ----------------: |
| Output bytes (engine string limit: 536,870,888) |      536,961,655 |       536,961,779 |
| Elapsed / child CPU                             | 9.811 / 10.197 s | 13.940 / 14.451 s |
| Sampled peak family RSS                         |        171.6 MiB |         186.0 MiB |

The JSONL run also checked its token count against the actual file line by line:
89,492,357 heuristic tokens matched. JSONL timing includes this extra counting
verification, so the two fixture timings are not equivalent-workflow performance
comparisons. Shared leaves keep input memory small; this verifies serialization
expansion and counting capacity, not a 512 MiB application's analysis footprint.
Both temporary output files were removed by the verifier's cleanup.

No resource stop occurred. Native provider behavior is outside this CLI change.
`npm run docs:check` passed, including nine README consistency tests.

The refreshed measurements are in the `refreshed/` subdirectory; earlier
measurements against `169512a35` remain separate. Raw stdout/stderr, commands,
per-run resource samples, equivalence assertions and summaries are retained under
`/tmp/rea-maintenance-20261023/5629/`; they are not committed artifacts.
