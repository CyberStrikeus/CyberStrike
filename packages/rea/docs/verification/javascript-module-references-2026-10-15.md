# Retained JavaScript module-reference verification

Tracks #4092 under #4027 and the decision in #4091. This verifies an existing
tool's data projection, without a code-mode host or SDK. [Machine-readable
results](javascript-module-references-2026-10-15.json) pin the base revision,
executed source hashes, samples, tokenizer and resource observations.

## Real application and question

Official Obsidian 1.14.4 ASAR, 27,477,966 bytes, SHA-256
`146ef8470d8cbb4a6db209bdc19bf2bad13350444186c0fd93c31087b142b92f`.
The [official gzip](https://github.com/obsidianmd/obsidian-releases/releases/download/v1.14.4/obsidian-1.14.4.asar.gz)
has SHA-256 `d1ed428c363968774f0f3906e67d8a53a058ece0b6cdd924b07865977b2ada21`.
Select `package.json` and `main.js`; the other 36 inventoried files remain
explicitly unselected. No target code is executed.

Question: retrieve every retained `javascript-module` identity at exact path
`main.js`, its retained source-range observation count, and distinct support
states. Compare the existing module page plus full item reads with one filtered
typed reference view. All six completed query samples use one identical retained
parent. All 23 selected rows, identities, counts and support states match. Public
CLI inline input and MCP retained input produce the exact same view and Evidence
ID. This establishes producer-fact consistency, not independent extractor
correctness or proof of runtime loading.

## Completed read costs

| Measurement                                                   | Existing page + items | Typed reference view |
| ------------------------------------------------------------- | --------------------: | -------------------: |
| Calls per query task                                          |                    24 |                    1 |
| Structured reply bytes                                        |               325,201 |               22,158 |
| First query in its arm, after preparation                     |             363.03 ms |             14.90 ms |
| Subsequent same-session query times                           |    232.75 / 235.17 ms |     12.95 / 10.57 ms |
| Request + structured-reply BPE tokens                         |                74,597 |                5,843 |
| With selected tool catalog + shared bootstrap request/summary |                85,302 |               16,548 |
| With complete tool catalog + shared bootstrap request/summary |               272,771 |              204,017 |

Order alternates: existing/reference, reference/existing, existing/reference.
Times include verifier-side fact normalization and equality checks; byte/token
accounting follows the timed reads. The initial artifact analysis and summary
took 20.978 seconds and is shared preparation, not a query-speed improvement.
The retained source remains partial; unknown counts and source selection are
preserved independently of exhausted pages. No query cache was introduced.

Tokens are `cl100k_base` counts with tiktoken 0.12.0 over serialized values, not
hosted-model usage. Catalog projections contain name/description/inputSchema;
both workflows use the same post-change catalog. Each request/reply is counted
once. Output schemas, host-specific rendering/replay, reasoning, final answers,
agent success rates and model latency are unmeasured. This is a completed
data-retrieval comparison; it does not establish a whole-agent speedup or a
before/after catalog-size improvement. Legacy item reads are serial; a concurrent
legacy baseline was not measured. Selected discovery includes both the
analysis and view tool schemas. Builds/filesystem are warm or uncontrolled,
so the first query is not an OS-cold analysis measurement. Shared-host scheduling
was uncontrolled: an earlier successful probe had substantially higher wall/CPU
times. Its samples are retained separately; neither run establishes a portable
latency guarantee.

The complete final verifier scope used 35.797 seconds elapsed, 35.197 seconds
CPU and 1,938,313,216 bytes peak cgroup memory. This includes shared analysis,
both query arms, temporary export, CLI parity and tokenization; CPU/memory were
not isolated by arm. Cgroup memory includes charged file cache and is not summed
process RSS. The whole scope had one CPU, an 8 GiB hard memory cap, 6 GiB early
stop and no swap. Payload cleanup was verified; no OOM/capacity event occurred.
An earlier full-response transport failure and interim probes are recorded
separately in the JSON and earn no performance credit.

A review follow-up exercised a stalled tokenizer after real Obsidian reference
reads and CLI parity. The committed POSIX fault fixture forks a helper into a
separate process group, ignores SIGTERM and stalls. With a caller-selected
2,000 ms deadline, the shared owned-command supervisor reported
`OwnedCommandFailure` with reason `timeout` and no cleanup failure. The verifier
failed as expected, its complete owned scope was cleaned, and its selected
temporary root was empty. The separate robustness run used 55.080 s wall /
45.246 s CPU / 1,563,475,968 B peak cgroup memory, with cleanup verified and no
OOM. It earns no efficiency credit. An earlier 20 ms immediate-child timeout
probe did not establish descendant cleanup; it remains a separate prior attempt.
The detached-helper scenario was executed on Linux, not Windows or macOS.

A deterministic CI regression also asserts two retained
observations at the same source range, excludes an unavailable location, and
checks agreement with the full item view; the count deliberately measures
observations rather than unique source sites.

## Reproduce

Use the pinned Node/npm toolchain and `npm ci`, then `npm run build:cached`.
Download/decompress the versioned application outside the checkout and check its
digest. Run with an operator-selected absolute artifact path:

```bash
node scripts/verify/javascript/module-references.mjs \
  --artifact /absolute/path/obsidian-1.14.4.asar \
  --source-path package.json --source-path main.js \
  --path main.js --kind javascript-module --rounds 3 --cli-parity \
  --tokenizer-python /absolute/path/to/tiktoken-venv/bin/python
```

The optional Python interpreter needs tiktoken 0.12.0; omit that flag to skip
token accounting. It has a 60-second wall-time deadline, configurable with the
positive integer `--tokenizer-timeout-ms`. The tokenizer uses the existing
owned-command supervisor, with native identity checks and inherited run-token
sweeping for descendants. Inputs and temporary Evidence use the existing private
runtime root. Cleanup attempts preserve the primary error; incomplete command
cleanup retains its owner and private files for recovery. `--mode legacy` or
`--mode references` runs one arm. Fresh runs
reanalyze the artifact and can produce different parent identities/resource
coverage; the verifier requires equal facts within its paired run. The measured
run additionally used the preserved [8 GiB cgroup observer](https://github.com/morluto/rea/blob/b3bdabab694af1f9801eff7caf75001b92314a58/experiments/analysis-efficiency/resource-run.py)
and its adjacent `resource_payload.py`; observer hashes are in the JSON.
No application, complete bundle, raw observations or ambient environment is
archived. Temporary exported/inline Evidence files are removed after successful
owned-command cleanup.

For the Linux descendant-timeout check, create an operator-selected private
directory and set `REA_TOKENIZER_PROBE_RECORD` to a file within it. Run the same
real-artifact command with `--mode references --rounds 1`, replace the tokenizer
with the absolute path to `scripts/fixtures/tokenizer-family-wrapper.py`, and add
`--tokenizer-timeout-ms 2000`. Expect a timeout failure. The explicit marker
confirms the detached helper started; the resource observer must separately
verify the complete owned scope is empty, and the selected temporary root must
contain no verifier files. The recorded PID is an observation, not authority to
signal that process.
