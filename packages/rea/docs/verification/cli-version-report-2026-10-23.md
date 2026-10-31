# CLI version report verification — 2026-10-23

`rea --version --json` reports package/runtime/platform facts without loading
analysis command implementations. The shared CLI preflight retains configuration
and output-option error precedence. No cache was added: the unnecessary work was
loading the full command graph, and runtime facts must remain current.

## Scope and identities

- Real application: REA 6.7.0's built public CLI, on Linux x64; Node 24.22.1 and
  npm 11.16.0 (repository pins). No target or analysis provider is required.
- Host CPU: AMD EPYC 7B12; affinity is restricted to two logical CPUs.
  Node executable SHA-256: `e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb`.
- Baseline: `5655fbf17`, combining main `60accad2d` with original PR #6530 head
  `044bd861b2df082eca5d4ad91d7cb79876c13430`. It already has the formatted report;
  the comparison measures delivery of equivalent facts, not plain versus JSON.
- Original author commits are preserved. The optimized source is this PR's
  launcher/preflight change; source hashes below bind the measured code.
- Both lanes use the same locked dependencies, executable and environment
  controls. Package manifest SHA-256: `2218e615dc1e68ca31c02ee5f6f2dee1e2cf7aa6a78c1c22ac090e27fe49d2eb`.
- Built tree digests: baseline `a4bc8722b69046c5ace1d3e764bba81812427766f088418c27c6876812796722`
  (2147 files); optimized `9919d1b6177536f75fd1acb9240525e82cb5af5a55f4db07cbcc4b243a5f8eb4`
  (2153 files). Each digest hashes sorted relative
  paths, a NUL separator, and each file's binary SHA-256.

```text
47eae72df85b722dcabab6860980a7285886a854daaec74b47490b41f9652154  scripts/rea.mjs
73e5f50400b11012ccf6c6c312e1f91e027e92c4a5616f112bf97ea135e3253d  src/cliOutput.ts
64d82457c9f9f276379f9734caff181117afc3fd17fa50d90140a92853395f43  src/cliConfiguration.ts
fa221460cf337bb2463bd47cd919066a612f369ab866cc1dfbf27ae49259e182  src/domain/versionReport.ts
```

## Completed public tasks and resource measurements

Commands, each in a fresh process from each checkout:

```sh
node scripts/rea.mjs --version --json
node scripts/rea.mjs --version
node scripts/rea.mjs providers --json --filter-output 'capabilities[0,1].provider.id,open'
```

Three alternating pairs per task, reversing order in pair two. All 18 completed
with exit 0 and byte-identical stdout within each task. These are warm build/file
cache measurements; no OS-cold run or in-process warm session was measured.
`NODE_DISABLE_COMPILE_CACHE=1` disables Node's compile cache in both lanes.
CPU affinity is 0–1; Node heap limit is 2048 MiB; `GOMAXPROCS=2`,
`GOMEMLIMIT=2GiB`, and `UV_THREADPOOL_SIZE=2`. A sampled 6 GiB early-stop guard
was never reached; it is not a kernel memory limit.

Elapsed includes process startup through exit. CPU is wait-accounted child CPU.
Peak RSS is the maximum sampled sum across the payload process family, every
50 ms; shared pages can be counted more than once and brief peaks can be missed.
The external sampler is excluded. All measured commands here have no analysis
engine child. Other host work is uncontrolled, so small control differences do
not establish an improvement.

Medians; paired values are **before / after**:

| Task                       |   Elapsed (s) |       CPU (s) | Peak family RSS (MiB) | Stdout bytes |
| -------------------------- | ------------: | ------------: | --------------------: | -----------: |
| Formatted version          | 1.716 / 0.203 | 1.968 / 0.198 |          335.6 / 72.1 |          207 |
| Plain version control      | 1.876 / 1.783 | 2.221 / 1.990 |         346.8 / 338.9 |            6 |
| Filtered providers control | 2.467 / 2.182 | 2.624 / 2.461 |         384.7 / 378.2 |           67 |

First measured formatted-version process, separated from the repeat medians:

| Lane   | Elapsed (s) | CPU (s) | Peak family RSS (MiB) |
| ------ | ----------: | ------: | --------------------: |
| before |       1.716 |   1.968 |                 335.6 |
| after  |       0.203 |   0.198 |                  72.1 |

The JSON payload remains 207 bytes with all documented fields. No token
reduction is claimed. Token counts, host prompt handling, and actual model usage
were not measured; these CLI tasks have no MCP discovery or follow-up calls.
Earlier development probes, including probes overlapping focused tests, are
excluded from this final comparison. No general analysis/provider speedup is
claimed.

## Correctness and compatibility

- 231 tests passed across the 12 exact selected files below, serially.
  This covers runtime/domain contracts, actual CLI output and error handling,
  dispatcher cleanup, runtime bundling, real MCP doctor catalogs, doctor
  composition, and both compiled CLI test drivers.
- The new dispatcher regression uses the real built preflight and CLI modules
  that throw on import. JSON succeeds without those imports; invalid output and
  configuration retain their errors. Restoring the original launcher makes this
  regression fail specifically on the blocked analysis import (negative control).
- A real PTY invocation returned indented JSON matching piped facts. Plain
  version, YAML and help precedence remain covered through the public CLI.
- A real Node 20.20.2 invocation returned its version with
  `supported_runtime.satisfied: false`; this does not establish analysis support
  for Node 20. Bun, Windows and macOS end-to-end behavior remain unverified.
- An earlier parallel 210-test selection had 209 passes and one existing
  `cliOutput` case exceeding its 3000 ms process deadline. That failed attempt is
  retained; the subsequent serial 231-test selection passed without relaxing any
  deadline. Its cause is not conclusively attributed. The filtered-providers
  benchmark above exercises that same public command as a compatibility control.
- `npm run check` passed after declaring the existing `cliOutput` runtime
  entrypoint to Knip. This keeps the actual dynamically consumed entry visible
  rather than ignoring the new preflight export.
- `npm run docs:check` passed, including 9 README consistency tests.

The serial selection used already built prerequisites:

```sh
node scripts/run-exact-tests.mjs run --maxWorkers=1 --no-file-parallelism \
  src/domain/runtimeVersion.test.ts src/domain/versionReport.test.ts \
  tests/boundary/cli/cliOutput.test.ts tests/boundary/cli/versionReportCli.test.ts \
  tests/boundary/cli/dispatcher.test.ts tests/boundary/process/runtimeBundle.test.ts \
  tests/boundary/mcp/mcpDoctor.test.ts tests/boundary/cli/mcpDoctorHelpCli.test.ts \
  src/doctorRuntime.test.ts src/application/Doctor.test.ts \
  tests/boundary/cli/compiledCliSession.test.ts \
  tests/boundary/cli/sharedJavaScriptCliSession.test.ts
```

This workflow reports runtime metadata, not target-analysis Evidence. Existing
MCP server identity remains the MCP version surface; no duplicate tool or schema
was introduced.
