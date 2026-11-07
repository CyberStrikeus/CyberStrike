# Verification

The initial author record below describes the original macOS tree. The Linux
followup record at the end covers the integrated serve changes and subsequent
repairs in this PR. The two records have different toolchains and cache states.

Verified base: 24574576e4fa74ff56eda965ae287555b7552c03, the tip of the environment-serve increment on fetched main b83b9caf (this increment builds on it).

The worktree carries the manifest-view, streamable-HTTP and serve increments
as commits on upstream main b83b9caf; this increment's changes are uncommitted
edits on top. Every check below ran as written on this tree after the review
repairs; nothing is reported that did not run. Timings are macOS
`/usr/bin/time -l` command accounting (elapsed, user, system seconds and
maximum resident set size of the command and the children it waited for) on
macOS 26.5.1 with Node 22.23.1, npm 12.0.2, Docker 29.5.3 and a Python 3.12.12
virtual environment holding `agentenv-framework 0.9.1334`.

## Review findings addressed

An adversarial review of the first pass found two should-fix findings and
seven nits; each was repaired at its owning boundary before the gates below
ran.

- The bundle README told the reader to run `agent-env run <name>`, which only
  works from the bundle's parent when the folder happens to carry the env's
  name. The README now says `agent-env run .` from the bundle root and names
  the folder's path for any other working directory; the services test
  asserts the new block and the absence of the old command.
- The lane verifier resolved `agent-env` and `docker` from `PATH` when the
  `REA_*` variables were unset. It now requires absolute
  `REA_AGENT_ENV_COMMAND` and `REA_DOCKER_COMMAND`, throwing the standard
  actionable message naming the npm script and that nothing is installed, and
  checks both paths exist; the workflow exports `REA_DOCKER_COMMAND` from
  `command -v docker` beside the virtual environment's `agent-env`;
  `docs/testing.md` names both variables and drops the `PATH` default. No
  Linux preflight was added, so the lane stays runnable on a macOS host.
- The brittle `assert.doesNotMatch(stdout, /failed/)` is gone; exit code `0`
  and the `tasks/smoke.json v<n>: passed` summary already decide the case.
- The inner `agent-env run` timeout is 15 minutes inside the 30-minute job,
  so a hung run ends with the verifier's failed receipt rather than the
  runner's kill; `docs/testing.md` says so.
- The pair was read twice: parsed once for authentication and re-read from
  disk for the byte-exact copies, so a file replaced between the reads was
  copied unchecked. `readEnvironmentExportInputs` now reads each file once
  through the regular-file reader, parses the value from those bytes with the
  shared UTF-8 JSON parser, and the command passes the same buffers to the
  export, which copies them; the refusals of inline JSON, a directory and a
  file that is not JSON are typed by role, and the spec, plan and both guides
  state the single read.
- The tarball Dockerfile left the 6 MB `rea-agents.tgz` in `/tmp` of the
  image; the install layer now removes it (`&& rm /tmp/rea-agents.tgz`),
  confirmed by listing `/tmp` in the built image below.
- The verifier passes `--sandbox local` as the design specifies; the spec
  records that the task's `sandbox_type: local` already pins the provider and
  the flag restates it.
- The verifier's import of the HAR builder from `tests/fixtures/` through
  Node's type stripping is kept and recorded in the spec's limits with the
  reason (no second copy under `scripts/`; the scope lists the fixture).
- Writes are not transactional; `docs/cli.md` now states that a host failure
  after the first file leaves the partial folder for inspection and that the
  next attempt refuses the non-empty directory, and the spec's limits say so.

## Setup

`npm ci` completed (exit 0; 373 top-level entries). `/usr/bin/time -l npm run
build` passed with 3 tasks successful in 7.60 s elapsed (14.81 s user, 2.69 s
sys, 3013410816 bytes); `/usr/bin/time -l npm run test:prepare` passed with 6
tasks successful, 3 cached, in 1.63 s (3.47 s user, 0.81 s sys, 400752640
bytes).

## Static gates

Every gate ran on the final tree after the last source edit, sequentially:
`npm run check:fast` (typecheck and lint with module boundaries; 2 tasks
successful; 5.28 s elapsed, 23.22 s user, 2.93 s sys, 4564680704 bytes);
`npm run format` rewrote nothing outside this increment's files ("Finished in
635ms on 4077 files"), and `npm run format:check` passed ("All matched files
use the correct format"; 0.87 s, 4.30 s user, 0.64 s sys, 224051200 bytes);
`npx knip` reported no findings (3.49 s, 5.04 s user, 0.72 s sys, 805191680
bytes); `npm run verify:test-discovery` reported "Discovered all 1597 test
files exactly once" (0.55 s, 0.38 s user, 0.14 s sys, 141492224 bytes);
`npm run check:ci:tasks` (typecheck, lint:built, format:check, knip,
metadata:check, jscpd, scan:todos) passed with 8 tasks successful, lint "3764
files, 0 errors, 1690 warnings" and jscpd "3171 files, 2587 clones, 3.34%
duplicated lines" under the 3.5% threshold (4.89 s elapsed, 15.19 s user,
3.86 s sys, 874627072 bytes); `npm run docs:check` passed including the README
consistency test (6 tasks, 5 tests; 4.00 s elapsed, 3.86 s user, 0.94 s sys,
290111488 bytes). `actionlint 1.7.7` (`-shellcheck= -pyflakes=`, from the
review's scratch virtual environment) reported no findings on
`.github/workflows/real-agentenv.yml` and `.github/workflows/ci.yml`. A
case-insensitive grep for the forbidden words and marker comments over the 23
new or modified files matched only the `scan:todos` script name in
`package.json` and this file.

## Test projects

Source group: `/usr/bin/time -l npx vitest run --project services --project
conformance` passed 122 files, 1524 tests in 11.08 s elapsed, 23.10 s user,
2.24 s sys, 1631240192 bytes. The increment's files are
`environmentBundle.test.ts` (7 tests: the planned file set and copy targets,
the registry Dockerfile pinned to `PACKAGE_METADATA.version` with the
readiness-probe layer, the tarball Dockerfile installing and removing
`/tmp/rea-agents.tgz`, the verifier text naming `get_annotations` as the
first parameterless `GET` tool with recorded status 200 of record 25, the
smoke task, the README's provenance, `agent-env run .` block and rights note,
the name override and six refused names), `environmentExport.test.ts` (6
tests: the reader returning each file's bytes and parsed value, its refusals
of inline JSON, a directory and malformed JSON by role, writing into an absent
directory with the read bytes copied unchanged and reported sizes, the
tarball copy, the refusals of a non-empty directory, a file path and a missing
tarball with nothing written, and an existing empty directory accepted),
`environmentSource.test.ts` (4 tests; the loader takes the reporting
operation) and the conformance test `environmentBundlePackagePin.test.ts` (1
test: the registry install line ends with `rea-agents@<package.json version>`
and never uses `latest` or a range).

Built group after `npm run test:prepare`: `/usr/bin/time -l npx vitest run
--project cli-boundary --project boundary` over `environmentExportCli` (3),
`ciChangeScope` (228), `ciRequiredLanes` (17), `workflowActionPinning` (5),
`ciCachePolicy` (6), `cliToolCoverage` (1), `cliStartupImports` (5) and
`ciTestProjects` (11) passed 8 files, 276 tests in 432.80 s elapsed, 303.47 s
user, 92.63 s sys, 422412288 bytes; `tests/boundary/filesystem/productCatalog`
passed separately (10 tests, 5.32 s). The cli-boundary file writes the folder
from the fixture pair through the built CLI and checks the seven written
paths, the byte-exact copies and the Dockerfile's first line and `CMD`;
refuses a non-empty directory leaving its one file in place; and refuses a
mismatched pair without creating the directory.

## Local end-to-end run

With the built CLI in this worktree, from a fresh scratch directory:
`inspect-web-network-capture grafana-like.har har --format json --json` wrote
capture Evidence `ev_4ee4759b…` (28 records); `inspect-analysis-view` with the
inline source and all three template rules wrote manifest Evidence
`ev_6553a8e5…` naming that parent, `grafana-example`, 19 tools, view digest
`8d1eb3ee…`. `npm pack --ignore-scripts` of the checkout produced
`rea-agents-6.6.0.tgz` (6039238 bytes). `environment-export manifest.json
--evidence capture.json <tmp>/grafana-example --package-tarball <tgz> --json`
exited 0 and printed `status: exported`, `tool_count: 19`, `package_source:
{kind: tarball}` and eight files: `README.md` (2076 bytes),
`envs/grafana-example/env.toml` (37), `envs/grafana-example/Dockerfile` (441),
`artifacts/check_grafana-example/verify.py` (1534), `tasks/smoke.json` (291),
`envs/grafana-example/manifest.json` (15701),
`envs/grafana-example/evidence.json` (58296) and
`envs/grafana-example/rea-agents.tgz` (6039238); `cmp` confirmed the two
Evidence copies and the tarball byte-identical to the inputs. The Dockerfile's
install line reads `RUN npm install -g --ignore-scripts --no-fund --no-audit
/tmp/rea-agents.tgz && rm /tmp/rea-agents.tgz`, and the README's run section
is the `agent-env run .` block.

`/usr/bin/time -l agent-env run <tmp>/grafana-example` exited 0 in 43.66 s
elapsed (5.19 s user, 3.26 s sys, 129318912 bytes), output

```text
[tasks/smoke.json] step 1/2 env done in 25.1s
[tasks/smoke.json] step 2/2 replay (env_outcome_verifier)
replay: listed 19 tools, expected 19; get_annotations replayed status 200, recorded 200
[tasks/smoke.json] passed in 25.1s

Tasks:
  tasks/smoke.json v1: passed (replay: 1), 25.1s, instance @local/…/grafana-example/smoke-nwvvojs7

Tore down 1 sandbox.
```

`docker ps -aq` before and after the run listed the same three pre-existing
containers (a Grafana container, an exited container and the framework's
registry from earlier sessions, unrelated to this run); no container was
added, and the image count rose from 19 to 20 for the built env image
`5a5b3bf62aae`. `docker run --rm --entrypoint sh 5a5b3bf62aae -c 'ls -la
/tmp; rea --version; id -un'` listed only `node-compile-cache` in `/tmp` (no
`rea-agents.tgz`), printed `6.6.0` and ran as `node`.

`REA_AGENT_ENV_COMMAND=<venv>/bin/agent-env REA_DOCKER_COMMAND=$(command -v
docker) /usr/bin/time -l node scripts/verify-agentenv-environment.mjs` exited
0 in 37.24 s elapsed (10.42 s user, 4.45 s sys, 268533760 bytes) and printed
the receipt `status: passed`, `public_cases: 5`, `upstream: agentenv-framework
0.9.1334`, `runner: darwin arm64; host Docker`, `docker_before: {containers:
3, images: 20}`, `agent_env_run: {exit_code: 0, seconds: 32}` with the same
passed summary in its stdout tail, `docker_after: {containers: 3, images: 21,
new_containers: []}` and `process_lineage.status: verified` with no
descendants. The first hosted run of the lane, on a runner with no prior
framework state, created the framework's image-store helper `agentenv-registry`
(`registry:2`, container `b2e047f4c6cd`) during `agent-env run`; the run itself
passed (`exit_code: 0`, 354 s, `tasks/smoke.json v1: passed`, "Tore down 1
sandbox.") but the first form of the leak check counted the helper and failed.
The check now lists containers with their names, excludes
`agentenv-registry[-<port>]` and reports it under `image_store_helpers`; the
local receipt gained `image_store_helpers: []` because the helper already
existed before the run here. Public ECR's anonymous pull quota refused the
framework's `postgres:16-alpine` pull with `429 Too Many Requests, Data limit
exceeded` on two hosted runs out of six (the second and, after the stack was
rebuilt, the sixth); the verifier now retries the run once, after 90 seconds,
when the failure carries that registry's signature, and records
`attempts: 2` with `retried_for` in the receipt. The local receipt reports
`attempts: 1`. Removing that helper (`docker rm -f
agentenv-registry`) and running the verifier again reproduced the fresh-host
path locally: the run recreated it and the receipt passed with
`image_store_helpers: ["agentenv-registry"]`, `new_containers: []`
(`agent_env_run: {exit_code: 0, seconds: 33}`). Without `REA_DOCKER_COMMAND` the verifier exited 1 before
touching anything with "verify:agentenv:environment requires absolute
REA_DOCKER_COMMAND; see docs/testing.md. No dependencies are installed by this
verifier."; with a relative `REA_AGENT_ENV_COMMAND=agent-env` it exited 1 with
the same sentence naming that variable.

Refusals through the built CLI: exporting into the already written bundle
directory exited 1 with `invalid_request`, issue path `["directory"]` and the
message "is not empty (4 entries); choose an absent or empty directory";
exporting the manifest against the capture of one selected record
(`--record 0`, `ev_3249d233…`) exited 1 with `invalid_request`, issue path
`["evidence", "evidence_id"]` and "The manifest was projected from a
different capture than the supplied evidence file.", creating no directory;
a truncated `broken.json` as the evidence exited 1 with `invalid_request`,
issue path `["evidence"]`, reason `invalid_format` and "broken.json is not
valid JSON: Unexpected end of JSON input", creating no directory. An export
without `--package-tarball` wrote a Dockerfile whose install line is
`RUN npm install -g --ignore-scripts --no-fund --no-audit rea-agents@6.6.0`,
the `package.json` version, with no tarball beside it; the tarball variant
copies `rea-agents.tgz` and installs and removes `/tmp/rea-agents.tgz`.

## Independent review

The adversarial review of the first pass is the independent review of this
increment; its findings and their repairs are listed above. One further
observation surfaced while repairing them: the single-read helper routes the
export's input refusals through the export module rather than the CLI's
shared JSON-input parser, so the inline-JSON refusal is now a typed
`invalid_request` on the `manifest` or `evidence` issue path instead of the
parser's `input_path`/`input_reason` envelope; the cli-boundary tests did not
depend on that envelope.

## Scope and measurement limits

The framework readiness probe, the port variable default and the `env.toml`
name were found by running the bundle in the first pass, not by reading a
published contract; they are recorded in the spec as the three additions to
the designed file set. The local run and the verifier used the host's Docker
with the framework's gateway and service-database images already built from
earlier sessions, so the "first run also builds the infrastructure" path was
not timed here. The verifier's container check compares `docker ps -aq`
before and after; images built by the run remain by design and are only
counted. `npm pack --json` has the npm 12 object shape on this host and the
npm 11 array shape on the hosted runner; the verifier accepts both but only
the former was exercised locally. The hosted `real-agentenv` workflow was not
dispatched from this tree. The built projects ran on this host's Node 22.23.1
rather than the pinned 24.18.0. The `/usr/bin/time -l` figures account for
each command and the children it waited for; Docker's own work runs in the
daemon and is outside them. Windows was not run.

## Linux followup verification (2026-10-19)

The original PR was updated from main after #4955 and #4975 merged. The
followups retain the author's commits and portable-name checks, seal private
JSON parser output once for shared immutable authentication/replay, reserve
sealing work before reading, preflight the served catalog before exporting,
translate changed-file failures by input role, defer export imports during CLI
registration, and verify the supplied framework executable before attributing
its results. The default `rea mcp` transport remains stdio.

Executed on Linux x64 with Node 24.18.0, npm 11.16.0, Docker 20.10.24,
Python 3.12.13 and an isolated `agentenv-framework==0.9.1334` environment:

- `turbo run typecheck lint:built format:check docs:check:built knip metadata:check artifacts:skills --concurrency=1`: ten tasks passed, one cached, 289.315 s elapsed, 284.552 s CPU, 4450.18 MiB peak process-family RSS.
- The focused source/compiled CLI/SDK/lifecycle/configuration run passed 399 tests in 24 files. A later run passed the updated 231 CI-selection cases, three executable-identity cases and ten product-catalog cases. The latter needed its generated catalog first; its initial missing-file failure was preparation, not a passing check.
- Four previously recorded, unauthenticated real GitHub API responses were exported with the checkout tarball. The generated Dockerfile built unchanged. A fresh non-root container replayed every response twice through the official MCP SDK, matching body, status, Evidence ordinal/id and untrusted-content provenance. Discovery/card parity and tarball removal passed. The standalone test supplies `ENVIRONMENT_NAME` as the framework does. Runtime verification with the built image took 12.393 s / 6.002 s CPU / 313.11 MiB process-family RSS; image-build cost is excluded. A Docker stats sample was 250.5 MiB, not a measured container peak.
- The production `verify-agentenv-environment.mjs` observed `agent-env 0.9.1334`, exported its 28-record source-owned Grafana-shaped fixture, deployed it with the real framework and passed `tasks/smoke.json`. The receipt reported five public cases, one sandbox torn down, no new task containers and no supervised descendants. This successful run used already prepared infrastructure: 141.697 s / 101.971 s CPU / 501.61 MiB process-family RSS. Earlier attempts failed because this host's proxy environment required optional SOCKS support and its default home sandbox directory was unwritable. Only the test process's proxy variables were cleared; supported `XDG_STATE_HOME` and `AGENT_ENV_LOCAL_SANDBOX_DIR` pointed into temporary storage. The shared Docker daemon was not reconfigured or restarted. The framework's persistent registry helper and images remain as its documented behavior.

A matched public `environment-serve`/SDK task compared the pre-followup serve
build with the final implementation. Both used the same GitHub capture with
1,000 synthetic HAR-extension items (each containing additional containers),
one first call and twenty warm identical replays. Fixture generation was
excluded. This is controlled stress data, not newly observed application data.
Larger 25,000/75,000-item projection attempts returned the existing typed
representation-budget refusal; that budget was not relaxed.

| Measurement             |      Before |       After |
| ----------------------- | ----------: | ----------: |
| Cold listener startup   | 2189.064 ms | 2862.860 ms |
| First call              |   76.950 ms |   45.265 ms |
| Twenty warm calls       |  324.119 ms |  267.132 ms |
| Completed task elapsed  |     3.229 s |     3.885 s |
| Completed task CPU      |     3.196 s |     3.827 s |
| Peak process-family RSS |  466.43 MiB |  470.21 MiB |

These single completed samples do not establish an overall speed or memory
improvement. Separate identity regressions establish that large reported JSON
trees are shared rather than copied and that caller-owned mutable trees are
not frozen. Token usage was not measured. CPU is child user+system time;
process-family memory sums sampled descendant RSS every 50 ms and may count
shared pages twice. Docker daemon/container CPU and peaks are outside that
process-family measurement and remain unmeasured. Builds used one task at a
time, one CPU and a soft 3 GiB Go limit; Docker builds were serialized and
limited to one CPU/4 GiB, and the standalone replay container to one CPU/2 GiB.
Windows execution and the published registry package were not tested in this
followup; the checkout tarball proves the code before its release.

### Output ownership and final review followups

The output boundary now uses the existing `SafeOutputTree` owner instead of
separate directory admission and pathname writes. It checks the admitted root,
parents, file identities and complete entry inventory around publication, keeps
failed-close authority, and preserves an existing empty caller root on rollback.
The optional package is held as one regular-file descriptor before output
writes, streamed with hash/readback verification, and checked for changes before
release. POSIX file modes are set and verified as `0600` independently of umask;
newly owned directories are `0700`. Existing root permissions remain caller owned.
Windows privacy depends on the selected destination ACL; no owner-only Windows
ACL guarantee or Windows runtime validation is claimed. Portable pathname
operations still require a trusted destination and parents against concurrent
replacement.

A compiled CLI counterexample under umask `0400` failed before the mode fix and
succeeded afterward with every generated file readable at `0600` and exact
Evidence bytes. Public CLI coverage also verifies that `symlink/..` retains its
filesystem meaning for the destination and package path. Real-filesystem tests
exercise destination replacement, foreign entries, parent symlinks, read-only
permissions and admitted-tarball replacement. Controlled close failures exercise
post-publication recovery and persistent retained ownership.

The inventory owner accepts canonically equivalent Unicode directory listings
without collapsing distinct filenames: an NFC multiset comparison is followed
by the original path identity checks. Tests simulate decomposed `readdir`
spelling over a real owned file and create an extra distinct Linux decomposed
foreign file. These establish the boundary behavior, not actual HFS+ execution.
Manifest, Evidence and tarball descriptors use the shared resource scope's close
retry. Persistent failures retain the canonical cleanup lease and produce a
tagged `environment-export` error. The compiled JSON CLI regression injects a
persistent manifest close failure before any destination write.

The framework verifier reuses `execNpm` and honors selected `npm_execpath`.
Four process-boundary attribution cases pass, including a conflicting PATH npm.
Those controlled executables verify attribution only.

After merging main `b4938aed5`, the generated Dockerfile built unchanged with the
checkout package and replayed all four captured public GitHub API responses
twice through the official MCP SDK in a fresh non-root container. Input bytes,
status/body/Evidence/provenance, discovery/card parity and package removal passed.
Warm base-image build plus pack/export/runtime verification: **40.699 s elapsed,
8.274 s process CPU, 421.04 MiB peak process-family RSS**. The real pinned
`agent-env 0.9.1334` verifier then passed all five public cases and the smoke task,
tore down its sandbox, and reported no new task containers or supervised
descendants: **156.895 s / 102.871 s CPU / 500.34 MiB**. Framework infrastructure
was already prepared. The later Unicode, close-failure and npm-selection repairs
have separate boundary regressions; they do not establish new real-platform
coverage.

A matched export comparison before the main merge used the same manifest
(6,416 bytes), capture (98,519 bytes) and checkout tarball (6,221,957 bytes), with
all copied inputs byte-exact. Before/after the output-owner repair: **1.827/2.604
s elapsed, 1.807/2.545 s CPU, 316.43/334.11 MiB** peak process-family RSS. These are
single process samples with uncontrolled host filesystem cache; the additional
ownership checks increased measured cost. They do not establish a speed or
memory improvement.

All followup heavy work uses one CPU and one test/build task at a time. Docker
builds are limited to one CPU/4 GiB, standalone runtime containers one CPU/2 GiB.
Process-family RSS is sampled every 50 ms and may double-count shared pages.
Docker daemon/container CPU and peak memory, agent tokens and fresh-framework
infrastructure cost are unmeasured. The previously documented early catalog
heap refusal is not represented as a passing run.

Final focused verification on the reviewed source passed **452 tests in 33 files** (including 232 CI-selection cases and the compiled CLI regressions): **161.276 s elapsed / 159.900 s CPU / 1242.43 MiB** peak process-family RSS. The final typecheck/build/lint gate passed: **218.427 s / 218.130 s CPU / 4449.45 MiB**.
