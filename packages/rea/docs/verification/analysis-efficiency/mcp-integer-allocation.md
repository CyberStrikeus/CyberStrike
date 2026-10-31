# Integer validator allocation after MCP materialization

Issue #6236; PR #4360. Linux x64, 2026-10-22.

<!-- BEGIN:allocation-report:provenance -->

Baseline `main@4a4bbab3c337701febeb6b532ace49041c4876e0`; candidate `461f342c71a72ef2be60912391df2393aa4e2ea3`. This is a pinned comparison.

In separate inspector/forced-GC diagnostics, retained REA V8 heap decreases by about 9.6 MiB. The three-pair ranges do not overlap in either profile. Inspector perturbation is included. Normal task timing, CPU and peak memory are reported separately; these observations do not establish a general latency or peak-memory reduction.

<!-- END:allocation-report:provenance -->

Directory discovery uses recorded advertisements after #4424; this study separates it from completed tasks that materialize canonical handlers. Context is unchanged.

## Change and compatibility

Replace 1,247 argument-free `z.number().int()` constructions with `z.int()` across 175 existing source files. Keep current shared schema owners, refinements, bounds, defaults and metadata. AST-token comparison against the baseline, after normalizing this construction and formatting, is equal for every touched source file. No new tools, provider effects, caches or response contracts.

The locked Zod 4.4.3 chained form retains a `ZodNumber` with a separate `ZodNumberFormat` check; direct construction uses the format itself. Incur 0.6.1 coerces argv strings only for `ZodNumber`. Existing CLI declarations and shared-input exceptions therefore retain the chained form. The actual compiled CLI registers 160 leaf commands; 104 numeric argument/option fields have identical results/errors in 974 installed-Incur parser cases across both runtimes, each field with an accepted probe. Fields are isolated from unrelated required options and no handlers are invoked. This is consumer-boundary coverage, not a real-engine claim.

Seven dependency-boundary variants match parsed values and complete error issues for 126 cases, including fractions, nonfinite values, strings/null/undefined and unsafe integers; 14 JSON Schema projections match in draft-07/draft-2020-12. Actual SDK advertisements match byte-for-byte in both profiles before/after materialization and across roles.

## Tasks, artifacts and bounds

Reuse the shared SDK task driver and independent ELF/section/zlib/JSON oracles from [the archived catalog study](https://github.com/morluto/rea/blob/a2e2c29b59e8775b0e6aedb09a9eb16adf32646b/experiments/analysis-efficiency/mcp-input-catalog.md): official Alpine v3.21 x86_64 ripgrep 14.1.1-r0 and Zellij 0.40.0-r0. All 42/422 packages and 88/1,063 edges match the independent oracles. Select serde name/version/kind, repeat exact retained-parent reads twice, verify a canonical negative-offset refusal, export/check complete Evidence and confirm the unchanged directory. `kind: null` stays unknown. Targets are not executed; dependency presence does not establish runtime use. Acquisition URLs, archive/executable/oracle hashes and complete answers are in [the receipts](https://github.com/morluto/rea/blob/main/docs/verification/analysis-efficiency/mcp-integer-allocation.json). Previously acquired public bytes are rehashed, not redownloaded.

Normal cohort: three alternating baseline/candidate pairs for each task × cold/warm server compile cache × default compact/full inputs: 72 trials, plus four excluded full-task warm priming runs. Separate diagnostic cohort: three alternating pairs per profile, cold Zellij tasks, 12 trials. All pass, with identical complete parent IDs/hashes and answers.

Node 24.18.0/npm 11.16.0; fresh client/server and HOME per trial, driver compile cache disabled. Each trial is serial, pinned to one CPU, 4 GiB hard/3 GiB early stop, no swap, at most 192 tasks. Before/after checks bind clean source, all compiled JS/JSON assets (1,990 baseline / 1,990 candidate files), scripts and manifests; producer and resource-observer hashes are also bound. No OOM, resource stop or leftover payload processes. Whole-family measurements include SDK validation, extra calls, source/compiled audits and oracle checking; kernel peak includes file cache. Build/acquisition/oracle generation and priming are excluded. Warm uses a populated role/profile-specific Node cache; hit rate and OS page cache are unmeasured, and audits warm compiled-file pages.

## Normal task costs

Medians, baseline → candidate; all ranges are in the JSON. No inspector or diagnostic GC runs in this cohort.

<!-- BEGIN:allocation-report:normal -->

| Task      | Cache | Input profile |          Wall s |    Family CPU s | Family peak MiB |
| --------- | ----- | ------------- | --------------: | --------------: | --------------: |
| directory | cold  | default       |   2.739 → 2.239 |   2.553 → 2.075 |   247.4 → 248.4 |
| directory | cold  | full          |   2.940 → 2.437 |   2.682 → 2.217 |   348.0 → 346.8 |
| directory | warm  | default       |   2.639 → 2.135 |   2.461 → 1.980 |   251.8 → 246.2 |
| directory | warm  | full          |   2.840 → 2.338 |   2.666 → 2.144 |   348.6 → 347.2 |
| ripgrep   | cold  | default       |   7.571 → 7.169 |   7.372 → 6.918 |   798.8 → 791.1 |
| zellij    | cold  | default       |   7.876 → 7.373 |   7.623 → 7.134 |   812.2 → 810.5 |
| ripgrep   | cold  | full          |   7.876 → 7.475 |   7.710 → 7.295 |   803.7 → 801.2 |
| zellij    | cold  | full          |   8.079 → 7.573 |   7.852 → 7.378 |   815.7 → 819.1 |
| ripgrep   | warm  | default       |   7.575 → 6.977 |   7.352 → 6.810 |   815.0 → 791.6 |
| zellij    | warm  | default       |   7.774 → 7.178 |   7.581 → 6.981 |   820.9 → 822.0 |
| ripgrep   | warm  | full          |   7.976 → 7.875 |   7.746 → 7.679 |   812.7 → 789.3 |
| zellij    | warm  | full          | 14.995 → 13.978 | 14.742 → 13.718 |   818.5 → 811.5 |

<!-- END:allocation-report:normal -->

### SDK span and audit separation

<!-- BEGIN:allocation-report:sdk -->

Cold/default directory audit wall medians are 1.273 s baseline / 0.782 s candidate; SDK spans are 0.944 → 0.948 s. Whole-family costs include those experimental audits. Their cause and per-span CPU are unmeasured.

SDK span from client connect through task checks and client/server close. Excludes pre/post runtime binding and preflight artifact/oracle loading. Diagnostic spans include inspector and forced GC. CPU is measured for the whole family only; per-span CPU is unmeasured.

| Task      | Cache | Inputs  | SDK span s, baseline → candidate |
| --------- | ----- | ------- | -------------------------------: |
| directory | cold  | default |                    0.944 → 0.948 |
| directory | cold  | full    |                    1.067 → 1.102 |
| directory | warm  | default |                    0.888 → 0.878 |
| directory | warm  | full    |                    1.038 → 1.042 |
| ripgrep   | cold  | default |                    5.778 → 5.752 |
| zellij    | cold  | default |                    5.998 → 5.991 |
| ripgrep   | cold  | full    |                    6.077 → 6.119 |
| zellij    | cold  | full    |                    6.228 → 6.209 |
| ripgrep   | warm  | default |                    5.743 → 5.656 |
| zellij    | warm  | default |                    5.965 → 5.788 |
| ripgrep   | warm  | full    |                    6.100 → 6.492 |
| zellij    | warm  | full    |                  11.776 → 11.529 |

<!-- END:allocation-report:sdk -->

Full-profile warm Zellij is slower than its cold condition in both roles in this cohort. Cache hit rate and the cause of this observation are unmeasured, and cold/warm groups run sequentially. These timings support neither a general cache speedup nor a causal regression attribution.

## Separate retained-heap diagnostics

The same completed SDK task launches only its owned REA process with `--inspect=127.0.0.1:0`. Four CDP calls verify the owned transport PID, read heap, force GC and read heap again. The endpoint comes from that child’s stderr; the PID is a cross-check of the owned endpoint, not sole ownership proof. The inspector socket closes before MCP shutdown. These V8 values include inspector perturbation and exclude the client; diagnostic wall/CPU/family peaks include inspector and forced-GC overhead and are not normal-task timing results.

<!-- BEGIN:allocation-report:heap -->

| Inputs  | REA V8 retained MiB |  Baseline range | Candidate range | Diagnostic wall s |           CPU s | Family peak MiB |
| ------- | ------------------: | --------------: | --------------: | ----------------: | --------------: | --------------: |
| default |   189.835 → 180.242 | 189.823–189.855 | 180.208–180.366 |   15.490 → 14.291 | 15.246 → 14.123 |   814.1 → 786.3 |
| full    |   191.260 → 181.693 | 191.165–191.304 | 181.588–181.848 |     8.979 → 8.377 |   8.769 → 8.142 |   810.3 → 824.9 |

<!-- END:allocation-report:heap -->

A mismatched PID is rejected; removing only that guard makes the negative oracle fail. Both connections in that check use the same owned REA endpoint, with no foreign-process attachment. Aggregation rejects diagnostic GC in a normal trial. Historical #4424 receipt reaggregation preserves previous metrics and adds the separately reported SDK-span fields; its aggregator source hash changes.

## Context accounting

<!-- BEGIN:allocation-report:context -->

tiktoken==0.14.0/cl100k_base; estimates, not model usage. Actual model usage is unmeasured.

| Profile | Input directory once | Directory task | ripgrep task | Zellij task |
| ------- | -------------------: | -------------: | -----------: | ----------: |
| default |               49,670 |         50,840 |       54,029 |      53,949 |
| full    |              205,744 |        206,914 |      210,103 |     210,023 |

Raw SDK directory costs per list: 756,165/912,436 tokens and 2,935,148/3,587,792 bytes for default/full.

Question, explicit recipe, server instructions, one complete name/description/input-schema directory, every tool argument and text reply, plus prompt directory for discovery. This projection assumes the client retains a single unchanged directory. Raw catalog result costs include every observed tools/list result separately, with output schemas and without JSON-RPC envelopes. SDK initialization/framing, reasoning and actual model usage are unmeasured. The analysis task includes retained-read, rejection, export/oracle and post-materialization directory checks.

<!-- END:allocation-report:context -->

## Validation and reproduction

- Both runtime builds and all six static checks plus architecture guards pass. Before the final main synchronization, 5,972 source/contract/public CLI/MCP tests pass across 323 files; four skip for unavailable/guarded coverage. After synchronization, both builds/static checks repeat successfully, 77 affected producer and CLI/MCP tests pass, and all 974 registered numeric-parameter parser cases match again. Includes real SQLite CLI/MCP record/column selection and JavaScript heap/deadline preservation. A first direct schema-validity invocation lacked generated catalog metadata; the supported focused entry generates it and all 15 cases pass. A later affected-test invocation selected two nonexistent paths; the corrected three-file producer/consumer run is the 77-case result above. Neither setup failure was counted as a passing test, and no production or timeout change was needed.
- All 84 measured tasks and four warm priming tasks pass independent oracles, canonical refusal, parent/directory identity and owned cleanup checks. This does not verify external Hopper/Ghidra/IDA, Android devices, all providers or foreign OS behavior. The earlier macOS numbers in #4360 describe a different revision/platform and are not combined with these results.

The historical cohort commands below use the retired experiment layout. Run them
from the matching recorded producer checkout; the [archived source tree](https://github.com/morluto/rea/tree/a2e2c29b59e8775b0e6aedb09a9eb16adf32646b/experiments/analysis-efficiency)
provides the former files for reference. Current checkouts retain the report and
its conformance producer, rather than the full measurement suite. Moving these
files does not requalify the historical measurements against current REA.

Build the pinned baseline/candidate in separate clean worktrees with the locked toolchain. Use the candidate’s producer scripts for both roles. `measurement_inputs` in the JSON records the complete matrix, questions/recipes, runtime bindings and producer hashes; extract it unchanged as the bindings file. Historical receipts require their matching producer revision. One normal task:

```bash
NODE_DISABLE_COMPILE_CACHE=1 node experiments/analysis-efficiency/mcp-input-catalog.mjs \
  --runtime "$CANDIDATE_RUNTIME" --bindings "$MEASUREMENT_INPUTS" --role candidate \
  --artifact "$RIPGREP_BINARY" --oracle "$RIPGREP_ORACLE" \
  --output "$NEW_CASE_DIRECTORY" --profile default --phase analysis --cache cold
```

Run each task through `resource-run.py --observe-payload-exit --` to obtain whole-family counters. For warm runs replace `--cache cold` with `--cache warm --cache-root <role/profile cache>` after one complete priming task. For the separate Zellij diagnostic tasks add `--diagnostic-heap` and use cold cache. Keep their case names/logs aligned with `measurement_inputs`; aggregate both cohorts with:

```bash
python experiments/analysis-efficiency/mcp-startup-costs.py "$RECEIPT_ROOT" \
  --output mcp-integer-allocation.json
```

The aggregator requires the recorded tiktoken version, exact catalog/parent/runtime/producer/guard identities, clean source, successful payload cleanup and matching matrix coverage. Default driver behavior continues without an inspector; the heap flag is confined to the experiment.

In a current checkout, regenerate or verify every numerical section directly
from the committed JSON:

```bash
node tests/support/analysis-efficiency/mcp-integer-report.mjs
node tests/support/analysis-efficiency/mcp-integer-report.mjs --check
```

The documentation conformance gate checks current receipts, rejects stale normal/heap tables, and refuses missing producer markers without writing.
