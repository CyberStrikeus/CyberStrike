# Testing REA

Use this guide when choosing coverage, pruning tests, or running a verification
lane. Start with the commands below; use [real-toolchain lanes](#real-toolchain-verification-lanes)
for engine prerequisites and [client verification](client-verification.md) for
installed-client and agent runs.

Historical verification records may refer to `experiments/analysis-efficiency`.
Those experiment scripts are available in the [archived source tree](https://github.com/morluto/rea/tree/a2e2c29b59e8775b0e6aedb09a9eb16adf32646b/experiments/analysis-efficiency);
they are not included in current checkouts. The retained [test support](https://github.com/morluto/rea/blob/main/tests/support/analysis-efficiency/README.md)
contains deterministic checkers and fixtures. The [allocation report](verification/analysis-efficiency/mcp-integer-allocation.md)
and its original receipt JSON remain documentation, checked by the report producer.

## Developer commands

Use source feedback while editing, explicit boundary checks for the changed
behavior, and complete CI evidence before merging.

| Command                           | Scope                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npm run test:local`              | Dirty source tests via the import graph, without build; explicit source paths run regardless of Git status              |
| `npm run test:focused -- PATH...` | Exact existing test files; compiled boundaries build first, and unmatched paths fail                                    |
| `npm run test:changed`            | Source tests affected since the merge base with `origin/main`, including committed and dirty changes                    |
| `npm run test:fast`               | All domain, service, adapter, composition, conformance, and evaluation tests without build                              |
| `npm run test:boundary`           | Boundary, CLI boundary, MCP boundary, process boundary, and process-global projects                                     |
| `npm run test:mcp`                | MCP boundary project                                                                                                    |
| `npm run test:acceptance`         | Complete compiled CLI and MCP acceptance workflows                                                                      |
| `npm run test:python`             | LLDB and mitmproxy producer contracts plus analysis-efficiency checks; no real debugger or proxy required               |
| `npm run test:watch`              | Dirty source tests in watch mode, without build                                                                         |
| `npm run test:watch:all`          | Changed tests from every project; builds at startup, so rebuild after production edits before relying on compiled tests |
| `npm run check:changed`           | Cached typecheck/lint and branch-related source feedback                                                                |
| `npm run check:pr`                | Opt-in complete local deterministic gate and generated-file checks                                                      |
| `npm run docs:check`              | Generated-document validation and fresh onboarding example consistency checks                                           |
| `npm run docs:build`              | Render VitePress documentation and apply its page-link checks; no live external-link or GitHub fragment verification    |

The general source suite above runs on Linux in CI, and Windows CI runs a
curated lane ([Native platform baseline in CI](#native-platform-baseline-in-ci)).
A Windows source checkout can fail source tests for reasons unrelated to the
change, such as POSIX fixture paths, `#!/bin/sh` tool stubs, or POSIX rename
semantics. Compare failures against the base revision, or run the suite on
Linux or WSL, before attributing them to a change. See `CONTRIBUTING.md` →
Windows source checkouts.

The CI documentation lane runs both `docs:check` and `docs:build` when the
existing change classifier selects documentation or its producing inputs.
Generated facts and rendered page links have separate checks. VitePress does not
establish that every external URL or GitHub-rendered localized heading exists;
verify those destinations when editing them.

For example:

```bash
npm run test:local -- src/config.test.ts
npm run test:focused -- tests/acceptance/applications/runtime.test.ts
npm run test:changed -- --base origin/main
npm run test:changed -- --dry-run
```

`test:focused` accepts exact repository-relative test file paths. Source-only
paths do not build; boundary, acceptance, process-global, or unfamiliar `tests/`
paths build conservatively. Tests use Vitest concurrency and isolated
workspaces; commands do not hold a broad test lock. Build and documentation
writers retain checkout-local locks for their shared output files. Explicit
selections do not use `--changed` or permit zero-test success.
The dry-run option reports the chosen merge base, scope and build prerequisite
without executing tests or building. A missing Git base reports how to fetch
it or select another revision.

Source typechecking needs no compiled runtime or generated test metadata.
Typecheck, runtime compilation, and Frida binding verification share
`scripts/run-typescript.mjs`. The pinned tsrs package supplies Linux x64/arm64
(GNU and musl) and macOS arm64 compilers. Windows and other unsupported hosts
retain the existing stable official TypeScript compiler. Its upstream version
can differ from tsrs, so both compiler tasks hash the selected package and version
through `scripts/run-turbo.mjs` before cache lookup. Outputs from different
compilers occupy different cache entries. Repository npm scripts and focused-test
preparation use that entrypoint; a raw Turbo compiler task without matching
identity fails instead of publishing an ambiguous successful cache entry.
A missing binary on a supported host also fails without silently falling back.

Development verifiers load their shared command, terminal and file owners from
source using Node's in-process TypeScript transformation. A single process-lifetime
loader handles this checkout's `src/` and `scripts/lib/` graphs, resolving missing
relative `.js`/`.mjs` imports to their `.ts`/`.mts` source. Existing JavaScript and
modules outside those roots keep native resolution and failures. Node's module
cache shares source identities within the verifier process; transformed output
is not cached across Node versions. Restart the verifier after source edits.
This avoids a cold-cache compiler subprocess surviving command cleanup; the
live process-lineage checks remain required.

The Rust compiler defaults to at most two checker threads. For `--noEmit` checks,
`--maxMemory 3G` also sets a soft memory target; emit builds do not use that target.
Explicit compiler arguments can override the defaults. These controls do not
impose a process-family memory limit. Termux's explicit build, Stryker's compiler
API dependency, and independent fixture compiler oracles keep their existing
TypeScript versions.

`npm run build:cached` compiles the CLI/MCP runtime and its packaged skill.
The build also records `dist/mcp-catalog.json` (compact inputs) and
`dist/mcp-catalog-full.json` from the canonical SDK registrations and binds
each to the runtime with its own SHA-256 digest. These are
runtime artifacts, separate from the test catalog below. Default target-free
MCP startup serves its schemas without constructing analysis validators;
the first tool or guided-workflow request materializes the canonical runtime
on that same SDK server. Explicit compact/full input selections preserve
their advertised schemas throughout materialization. Initial-target,
HTTP and output-schema-off startup keep the eager path; source runs without
recorded artifacts also use eager composition. Compare memory both after discovery and after a completed
request; report diagnostic GC separately from normal resident memory.

Turbo's strict task environment preserves caller-selected `GOMAXPROCS`,
`GOMEMLIMIT`, and `UV_THREADPOOL_SIZE` for resource-constrained builds and
checks. These execution controls do not change artifact content, so changing
their values retains cache reuse. They control individual runtimes; monitor
the complete process family separately when enforcing a total memory budget.
`npm run test:prepare` also generates the MCP contract test catalog, product
catalog, and portable managed evidence used by the complete suite. Focused
tests prepare those extra outputs only when their selected files consume them.
The MCP test catalog is JSON in `.cache/mcp-tool-catalog.json`; the tracked
test loader supplies its types without making generation a source-check
prerequisite. Run `npm run mcp-catalog:generate` to refresh it independently.
Documentation generation and managed conformance run through their separate
`docs:generate` and `evidence:generate` task graphs.

Changed selection can miss runtime registration, generated data, shell
entrypoints, bridges, or other relationships absent from the import graph.
An empty changed selection means no tests were selected, not verified
correctness. Select relevant boundary files and real-provider lanes explicitly.
Source projects also contain large capacity regressions; `test:fast` promises
no compiled-runtime prerequisite, not a fixed time budget.

`npm run lint` prints errors and a warning summary; `npm run jscpd` prints
duplication statistics. Complete reports remain in `.cache/static-checks/`.
The fast gate uploads them as `static-check-reports`. Full qualification
uploads duplication diagnostics from the deep job as
`static-deep-check-reports`, including after that gate fails.
Task-graph recording runs `check:ci:fast:tasks` and `check:ci:deep:tasks`
without the artifacts lock, so it can record hashes while `check:pr` or
`check:test` already holds that lock. The CI jobs still run the locked
`check:ci:fast` and `check:ci:deep` commands.
Use `npm run lint:details` or `npm run jscpd:details` for all console diagnostics.
Both duplicate commands scan production and test code using the limit in
[`.jscpd.json`](https://github.com/morluto/rea/blob/main/.jscpd.json).
The summary commands preserve checker failures and restore reports from cached
static tasks. Both lint caches include the website, documentation configuration,
and experiment code scanned by the checker; a regression compares the actual
lint inventory with Turbo's resolved inputs.

Static checks locate candidates; they do not establish semantic ownership.
`jscpd` finds token clones, and Knip counts test references as uses. Module
boundaries and architecture guards enforce their declared import and source
rules. Passing them does not prove that two parsers agree, a wrapper is still
needed at runtime, or cleanup has one owner.

The lint gate treats `no-async-promise-executor`, `no-unreachable`, and
`no-unsafe-optional-chaining` as errors. These catch lost async executor failures,
dead code, and unsafe uses of optional-chain results. `no-unsafe-finally` remains
a warning because cleanup paths can deliberately throw aggregated failures;
review whether they preserve the primary failure. Two local rules
cover narrower observed failures: `rea/no-buffer-deep-equality` flags Vitest
deep comparisons of Buffers from recognized constructors and file reads,
including simple `const` aliases; `rea/cancellation-cause` requires an explicit
cause when a directly checked caller `AbortSignal` is converted to an
`AnalysisCancelledError`. The rules do not infer arbitrary Buffer types,
follow indirect cancellation helpers, or prove that an explicit cause equals
the caller's reason. Keep focused boundary and lifecycle tests for those facts.

`rea/no-evidence-json-preadmission` rejects direct generic JSON parses in
`createEvidence` payload expressions; it does not analyze intermediate values.
`rea/no-positional-tool-contract` rejects catalog indices used to select
operation names, schemas or types; display-only selection remains allowed.
`rea/no-fixture-root-cleanup` follows `const` fixture-root aliases into teardown
deletion; mutable bindings and mixed root arrays remain outside its scope.

`rea/no-shared-module-mock` resolves Vitest import bindings before rejecting
module mocks in projects without per-file isolation. The test-project definitions
own isolation for Vitest and lint; the executable gate checks the resolved policy
and runs the same collector. Aliases and namespace imports count; comments,
shadowed locals, ordinary methods and `spyOn` do not. Negative CLI probes use an
external temporary project so concurrent repository checks cannot discover them.

Focused `.only` declarations, broken assertion promise chains, and unused disable
directives are errors. `vitest/valid-expect` warns (`maxArgs: 2`) because valid stored and
collected assertions can be awaited later. `import/no-duplicates` warns with
`preferInline: false`.

`no-useless-escape` keeps intentional `\-` regex escapes because advertised
patterns must also compile in `v` mode; the catalog regression checks every
advertised pattern.

Fast lint stays syntax-based. `npm run lint:typed` runs serially with pinned
`oxlint-tsgolint` 7.0.2005 and records native plus typed diagnostics in
`.cache/static-checks/typed-oxlint.json`. Production `src` treats
`no-misused-promises` as an error; tests/fixtures warn. `no-floating-promises` is
an error throughout the lint inventory. `return-await` is an error in
error-handling scopes so asynchronous completion stays inside its catch or
cleanup boundary. Exhaustiveness is an error when a union member has neither a
case nor a default. Intentional defaults count as handling the remaining union;
new members covered by those defaults therefore require behavioral review.

Two HTTP/3 source-test files allow the runner-owned `node:test` registration API;
ordinary unowned promises in those files still fail. The authored code-split
recovery input is exempt from floating-promise policy because it is analysis
input, rather than application orchestration. Preserve framework-owned callbacks
such as an awaited `Promise.finally`; inspect the actual completion owner before
changing a callback solely to satisfy its declared `void` return type.

`npm run knip:production` writes advisory candidates to
`.cache/static-checks/production-reachability.json`; execution/report errors fail.
Ordinary Knip remains. `check`, `check:pr`, and `check:ci:deep` run reachability
then typed lint sequentially after cached work. Typed lint builds the project
type graph and stays separate from fast feedback. Its default Go settings are
`GOMAXPROCS=1` and `GOMEMLIMIT=1024MiB`; caller-selected settings take precedence.
One Go worker reuses checker caches across the file queue without changing the
file inventory or TypeScript project scope. The Go memory target is soft and
does not cap the complete process family's memory; measure the full invocation
when enforcing a host budget.

Routine iterations and rebases need focused regressions and relevant checks.
Before handing off a PR, run `npm run check` and generated-document checks when
applicable; CI owns the full suite and coverage. Use the full local gate for
broad changes or diagnosing CI, rather than after every edit. Package/install
changes additionally need package verification; provider changes need actual
provider evidence.

Vitest projects use up to two workers, bounded by host parallelism.
`process-boundary` runs later with serial files because process-tree sampling
shares host resources. Acceptance and process-global cases use isolated forks
without serial scheduling. Pure domain/service, composition, conformance,
evaluation, CLI boundary, and MCP boundary projects share module graphs. Their
tests avoid process-global state and keep resource cleanup test-scoped. Each
MCP session still owns its resources, and CLI cases retain fresh command
instances or subprocesses. Fixtures using `vi.mock` or `vi.doMock` need an
isolated project. CLI/MCP fixtures normally live in `tests/process-global/`.
When a path must stay, assign it explicitly in `scripts/lib/test-projects.mjs`,
exclude it from its shared owner, and preserve its source/built group.
Product catalog verification stays with the
isolated filesystem boundary tests because it loads both source and compiled
module graphs. Adapter, other boundary, acceptance, and process-global projects
retain per-file isolation. See `vitest.config.ts` for current settings.

Inject producer faults through scoped dependencies in shared workers: a module
mock cannot replace a consumer that was imported earlier. Check these tests
with the consumer preloaded as well as alone. For simulated protocol traces,
use an acknowledged event barrier before asserting complete observations;
a zero-duration capture does not guarantee queued events have arrived.

Place faults at the semantic boundary under test: the selected read, EOF, hash
completion, or cleanup attempt. Global call ordinals can shift during setup or
refactoring without reaching that phase. For controlled asynchronous gates, use
`awaitAcknowledgement` from `tests/fixtures/lifecycleAcknowledgement.ts` to race
the acknowledgement against triggering-operation settlement and a bounded
deadline. Register release gates before launch, then release and join launched
work in `finally` before restoring mocks, even when the barrier fails.

Focused contract tests should import the named contract family they exercise;
reserve the full tool catalog for catalog-wide assertions. Resolve contracts by
operation name rather than array position.

Check advertised schemas after SDK conversion for every supported schema
profile. Meta-schema validity does not establish client acceptance or useful
rendered declarations. Keep canonical rejection checks separate from the
intentionally reduced compact advertisement, and probe actual client renderers
when changing schema representations.

The reused CLI boundary workers cap V8 old space at 512 MiB, with or without
coverage. Ordinary CI also exhausted the former 384 MiB budget after earlier
files loaded the shared source/contract graph, while later command registration
and schema/help rendering still needed transient allocation space. This is a
measured capacity control, not a suite-wide speedup claim. The worker count
remains bounded at two, and spawned REA processes retain their own heap settings.
Coverage enablement still controls instrumentation, test deadlines and coverage
thresholds; explicitly disabling it or selecting only a provider does not enable
instrumentation.

Vitest worker limits do not bound subprocesses launched within a test. Bound
those batches separately so repeated CLI validation cannot oversubscribe the
runner. Preserve simultaneous launches where concurrency is itself under test.

Coordinate expensive checks across agents sharing a host. If a test unexpectedly
consumes heavy CPU, stop its owned process family, retain its log and revision,
and profile a bounded representative case before retrying. Separate production
work from fixture generation, schema compilation, subprocess startup and cleanup.
Choose elapsed, CPU and process-family memory limits before the run; a worker
count or test timeout alone does not enforce those limits.

Keep capacity fixtures intact when diagnosing a test failure. For byte equality
of large buffers, use `Buffer.equals` or `Buffer.compare`; a generic structural
diff can allocate far more than the production operation.

Remove demonstrated repeated work while preserving distinct assertions and
resource ownership. Share immutable fixture preparation where safe; keep fresh
sessions when lifecycle or concurrency is the behavior under test. Compare the
same completed workload before and after, report cache state and measurement
limits, and record interrupted runs separately from passes. Increasing a timeout
does not explain a CPU regression.

Build/documentation writers hold checkout-local output locks. Tests do not
hold a broad command lock; `check:pr` finishes tests before document validation.
Turbo caches deterministic preparation and static checks, but `test:run` always
executes. Repository files do not fully describe installed tool contents or host
state. A previous test pass therefore cannot replace current validation, even
when the source tree is unchanged. `check:pr` also runs the fast Python producer
suite. Fast CI runs it from the selected Python job after installing dependencies
and preparing the compiled runtime; full qualification runs it from the deep
static job. These producer tests do not establish real LLDB engine coverage.

Vitest's persistent compile cache remains disabled. The `cliTest` fixture shares
a temporary Node compile cache among its fresh CLI subprocesses. The worker
removes it after test-scoped processes finish. Explicit child environment
settings take precedence; children requesting `NODE_V8_COVERAGE` do not receive
the fixture cache. These subprocesses are outside aggregate Vitest coverage;
subprocess coverage attachment remains disabled. Cold-start import checks launch
independently without this fixture cache.

`analyzeJavaScriptDirectory` stdio MCP cases in one `cliTest` file share one
server and that compile cache. The first case pays startup; later cases reuse
the process. File teardown waits for startup still in flight, closes a server
registered during that wait, and does not open a server after close. A failed
handshake stays the caller error when its cleanup also fails, including a
rejection without a reason. That cleanup stays owned until a later close or
call releases it. Another server does not open while the cleanup remains, and
a cleanup that already succeeded is not run again. Pass
`mcpCall` when a case needs its own server, environment, or lifecycle. CLI
cases for that helper share one compiled CLI process per child environment.
The first case pays process startup; later cases reuse the loaded runtime.
The process restarts when the environment changes, after 32 commands, or when
the worker reports a resident set of at least 1 GiB. A fatal worker failure
or a broken session frame retires that process and waits for it to exit before
the next command starts.
`cli.run` still starts a fresh process, including stdin and explicit deadlines.
`runFileCli` uses the file session for commands that have neither. Go binary,
IL2CPP metadata, and dylib-resolution commands use that session. File teardown
stops the shared CLI process, including startup still in flight, and does not
open another after close.
`exportedFunctionBindingsCli.test.ts` uses the shared compiled CLI session for
its file and compares its JSON command results with the MCP session. It selects
20-second startup and command deadlines; other callers retain their existing
deadline behavior. Retired processes stay owned until exit, block replacement,
and remain available for a later close to retry after failed termination.
Shared session cleanup closes stdin so the worker can release JavaScript
resources, waits the bounded grace, then escalates to SIGTERM and SIGKILL only
if needed. Confirmed exit succeeds; an unconfirmed exit reports cleanup failure.
When startup or a command fails and cleanup also fails, the reported aggregate
retains both failures and the original failure as its cause.
`applicationWorkflowCli.test.ts` keeps one compiled CLI process for its JSON
commands, including a non-zero status whose stdout is still a JSON document,
and closes that process after the file.

The Apple artifact verifier step shares a job-temporary bytecode cache among
its fresh CLI/MCP children via `REA_ARTIFACT_NODE_COMPILE_CACHE`. The artifact
helper maps this setting to child `NODE_COMPILE_CACHE`; npm, Turbo, and nested
Vitest runs do not inherit that setting. Explicit `NODE_COMPILE_CACHE` takes
precedence, and coverage collection or `NODE_DISABLE_COMPILE_CACHE=1` disables
the helper's cache. The cache is discarded with the CI job.

To evaluate persistent compile caching for repeated local runs, opt in for both
cold and warm measurements with an isolated cache:

```bash
NODE_COMPILE_CACHE=.cache/node-compile npm test
```

Do not report the warm result as a cold-suite improvement, and do not enable
the cache in coverage or benchmark CI without first showing that its
instrumentation remains equivalent.

## Choose verification for the change

`test:local` is fast source-level feedback. For the strongest practical
regression, prefer a real public CLI/MCP workflow, then production-boundary
integration, then a producer golden; use the table to select quick feedback and
claim-specific additional evidence. Provider-behavior claims require the
matching real-provider lane.

| Change or claim                           | Fast feedback                                                 | Claim-specific coverage                                     |
| ----------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| Source semantics                          | `npm run test:local -- PATH...`                               | Relevant boundary cases when the behavior crosses a port    |
| CLI/MCP workflow                          | `npm run test:focused -- PATH...`                             | Actual public calls; an injected provider has limited scope |
| Documentation or generated metadata       | `npm run docs:check`                                          | `npm run docs:build` for rendered pages and links           |
| Engine adapter                            | Its real-provider lane below                                  | Host, version, target identity, and owned cleanup           |
| Client configuration or schema conversion | [Native client lane](client-verification.md)                  | Distinguish loopback models from live services              |
| Agent investigation quality               | [Agent evaluation](#agent-evaluation-and-conformance-records) | Review transcript and scenario-specific evidence            |

### Provider-backed workflow verification

For a new or changed provider-backed tool, select tests from the analyst's
question and the facts the contract claims, not from an upstream command list.
Use the existing workflow as a baseline and identify what the proposed tool
adds. Choose the relevant cases below; do not require every provider or a
Cartesian matrix when it would not change the claim.

When auditing existing tools, compare selected analyst workflows with the cases
their existing tests and real-provider lanes actually exercise. Run relevant
public workflows and focused checks; report untested scenarios rather than
inferring that a green test proves them or that no prior testing occurred. A fix
should add a regression for the demonstrated failure at its owning boundary and
affected consumer.

- Use a controlled target with independently known facts and a meaningful
  counterexample. Compare native provider output with the target or a
  format-aware oracle; a provider label, a mock, or another REA projection is
  not independent proof of the underlying fact.
- Exercise the affected public CLI/MCP workflow, including handoffs between
  calls. Assert the requested result, caller-selected inputs, source identity,
  evidence and coverage. Check that unavailable, partial and empty outcomes
  retain their different meanings across the producing and consuming boundaries.
- Where relevant, continue after a mixed success, failed request, cancellation
  or close/reopen. Verify the next supported recovery and preservation of prior
  results and resource ownership. Use the applicable lifecycle regressions below.
- Record the provider version, host, fixture, actual entrypoint, controlled
  faults and skipped or unavailable coverage. A simulated provider tests the
  integration boundary; a scripted sequence tests that sequence, not an agent's
  ability to discover it. Run the matching real-provider and agent lanes when
  their respective claims require them.

## Test design and pruning

Prefer real public CLI/MCP workflows, then production-boundary integration,
then goldens captured from real producers. Keep module tests for distinct
failures or semantics that stronger workflows cannot reliably reproduce.
Paths, compiled imports, and suite names do not establish test depth.

Prune tests that mirror implementation details or duplicate a stronger claim.
Before deleting a distinct regression, identify the replacement scenario and
assertions. Preserve malformed formats, cancellation, cleanup, permissions,
capacity, target identity, and combinations with distinct interactions.
Trivial helper assertions need no replacement. Remove abandoned production
scaffolding only after checking runtime and verifier consumers, including
compiled imports.

Assert error codes, structured limit facts, source provenance, and observed
recovery behavior instead of freezing explanatory sentences or banning obsolete
phrases. Keep exact checks for protocol values, setting and parameter names,
caller data, and diagnostic provenance. To verify guidance delivery, compare the
consumer with the owning formatter or constant, alongside independent assertions
for the behavior and facts; shared text alone is not a correctness oracle.
Documentation wording belongs in review, not substring tests of source files.
When replacing prose assertions, verify that a harmless wording change passes
and an incorrect budget or lost fact still fails.

After an owner changes, move fault injection and event spies to the path the
production consumer actually uses, and assert that the intended boundary was
reached. Keep independent expectations from authored input, producer output, or
an external oracle; comparing two paths through the same replacement algorithm
does not preserve the old oracle. A negative probe inside a conditional or loop
must assert that it ran.

Use representative scenarios rather than Cartesian matrices of equivalent
cases. Share setup without hiding inputs or expected evidence. For successful
`Result` values, throw the typed error before asserting the value; a preceding
`.ok` assertion adds no coverage. Protocol fixtures must reject unmodeled
commands and preserve actual producer reply shapes.

For comparison normalization, include a legitimate equivalent pair and a
distinct pair that would collapse if representation tags or scope were lost.
For learned identifiers, cover conflicting pairs and reused values in different
collections; mappings must remain one-to-one within their declared scope.

For coverage propagation, compare the same returned rows under complete and
incomplete examination. If a row exists on the left but is missing from a fully
examined compatible right inventory, removal can be established. If the right
side examined only eight of ten applicable records, or returns only one page,
the same missing row remains unknown unless separate evidence proves absence.
Assert the structured coverage and comparison status as well as the explanation.

For format compatibility, identify the producer revision that establishes each
rule. Include an accepted boundary case beside the rejected case so a stricter
parser cannot pass by refusing both. Keep source-derived behavior, synthetic
fixtures, and executed producer or runtime oracles distinct in validation
reports. A fixture accepted by REA proves its reader behavior; it does not prove
that a real loader accepts the artifact. If multiple producer revisions share a
format identifier but differ in behavior, record that ambiguity rather than
using one installed version as an oracle for all of them.

### Boundary regressions

For parser, inventory, snapshot, or projection fixes, select the applicable
cases below. Assert the producing boundary's facts and their meaning in affected
consumers. Add [lifecycle regressions](#lifecycle-regressions) when resource
ownership or finalization changes; a single malformed fixture cannot establish
the whole contract.

| Failure class                         | Regression that catches it                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format assumptions                    | Pair valid padding, offsets, or names containing delimiters with malformed input. Identify the producer revision when behavior varies by version; an unrelated runtime API's range is not an on-disk format limit.                                                                                                                                 |
| Raw identity and normalization        | Exercise allowed empty or unusual source names/metadata keys and values that normalize to one lookup or display value. Preserve admitted raw spelling under the existing redactions for transport credentials and explicitly marked sensitive values. Distinguish local paths, file URLs and HTTP paths; assert source identity through consumers. |
| Missing, empty, and unknown values    | Distinguish omitted, null, empty, zero, and false where the format admits them. Pair a malformed optional field with usable sibling facts; assert uncertainty without inventing absence or discarding the row.                                                                                                                                     |
| Completed work followed by failure    | Complete one input, then fail or cancel a later input. Assert earlier digests, metadata, and parsed facts survive with the later failure reason and accurate processed/unprocessed coverage. For cancellation, assert the exact caller abort reason; where a primary failure was already produced, assert it survives.                             |
| Independent limits and failures       | Trigger a sample/output limit alongside a read or parse failure. Assert both dimensions survive; reaching a limit does not erase sampling failures or prove complete coverage.                                                                                                                                                                     |
| Representation expansion and capacity | Keep a valid set near the limit and a large malformed input followed by a valid input. Cover JSON escaping, expanded paths or decoded rows as applicable. Assert serialized bounds, retained identities, later valid results, and unknown omissions without charging discarded interpretations as retained output.                                 |
| Snapshots, caches, and comparison     | Vary metadata that affects the result while keeping payload bytes equal. Exercise historical records with newly introduced fields omitted, current caller inputs on replay, and reuse across differing selections. Assert correct invalidation or unknown coverage, current request provenance, and unchanged saved Evidence and IDs.              |
| Public success and error delivery     | Exercise affected public CLI/MCP paths, including partial Evidence on failure. Assert retained facts and named contracts; retrieve partial Evidence when MCP returns a reference. If SDK cancellation suppresses the reply, check server settlement and any retained Evidence. An error-code assertion alone misses lost observations.             |

For partial Evidence delivery, verify that same-session readback preserves
identity and provenance without rerunning the provider. Include a no-writer
control that keeps completed Evidence inline and preserves the original failure.

When producer order is unspecified, synchronize fixtures on the observed request
or completion event. A filename, generated key, or fixed delay does not prove
which item completed before cancellation. Preserve real producer ordering and
use a controlled seam for the phase that needs deterministic failure.

Packed bridge validation uses Python's standard-library AST and tar readers
with `-I -S`: caller-local modules, `PYTHONPATH`, and site startup hooks must
not replace those readers or execute during validation. Controlled `ast.py`
and `sitecustomize.py` fixtures must leave their markers absent and still
reject malformed packed Python with `SyntaxError`. This checks static package
verification, not real Hopper or Ghidra behavior.

Stateless source-analysis matrices may share a file-owned stdio MCP connection
and retain representative compiled CLI parity checks. Every distinct source
scenario still runs through the public workflow; session-lifecycle scenarios
need their own sessions and cleanup assertions.

Complete-inline-Evidence conformance uses
`scripts/lib/mcp-verification-environment.mjs`: a finite 65,536-element
allowance selected by the application harness, file-owned CLI/MCP session and
artifact verifiers.
Explicit harness environment selections take precedence. This keeps canonical
workflow assertions reachable for large retained observations. Admission-policy
tests launch the public server with the resource setting unset or explicitly
selected, including the default structured-input boundary and continued-service
checks. Downstream capacity fixtures select enough finite transport allowance
to reach their original memory, depth, cycle or representation boundary; retain
those stronger assertions.

When a matrix already holds a named tool definition from live `tools/list`,
pass that definition through the SDK's `toolDefinition` call option. This keeps
the selected output-schema validation without eagerly compiling unrelated
catalog schemas. Re-read definitions if the server advertises a changed list.

For exact nested input constraints, select the full profile explicitly or use
the full-SDK conformance suite that owns the field. Compact workflow tests
should assert canonical failure categories and provider-call controls where
rejection before provider work matters. Do not make today's omission of a
constraint a compact-profile invariant.

When a file repeatedly validates the same MCP schemas, use
`createMcpSchemaValidation` for file-owned preparation and clear it in
`afterAll`. Its content keys include the complete schema, and the SDK provider
keeps dialect and format validation. Keep sessions and connections scoped to
each test; share immutable schema preparation through the fixture's validator
dependency.

Artifact verification uses `artifactMcpCall` for both lifecycle and analysis
calls. A fresh SDK client has no held tool listing, so a bare `callTool` can
skip output-schema validation. The helper discovers actual advertised
definitions, rejects missing or ambiguous schemas, and validates the requested
tool without compiling unrelated catalog schemas. REA registers process-static
tool contracts; bindings share one discovery per negotiated connection and are
discarded on reconnect or failed discovery. Keep raw artifact calls on this
shared path and retain explicit request options such as timeouts.
Caller-supplied tool definitions are rejected: the helper owns selection from
the advertised catalog so a stale or permissive schema cannot bypass it.

The regression fixture changes only `canonical_path` in a real stdio response
to a number. The old helper accepts that response; the named schema must reject
it. This client-boundary fault injection does not establish native Apple
behavior, which remains covered by the macOS verification lane.

Report unavailable authority as a named skip. Await owned cleanup before a
verifier reports success. Native process inspectors are released at Vitest
worker teardown; fork termination does not run Node exit hooks, and per-file
teardown would retire inspectors still needed by other files.

Measure slow cases before pruning capacity coverage. Retain inputs beyond the
formerly failing size/depth and distinguish cold runs, warm builds, coverage,
and toolchain conditions when comparing timings.

## Lifecycle regressions

For changes to resource acquisition, readiness, cancellation, or cleanup, select
the affected owners and applicable scenarios below. Include temporary snapshots
and one-shot commands. Use public CLI/MCP workflows where practical and a
controlled production seam for interleavings that cannot be reproduced reliably.

| Scenario                                                                                | Assertion and control                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target admitted; startup still pending                                                  | Status preserves the readiness distinction and observed startup activity; readiness requires the provider's documented proof.                                                                                                                        |
| First handshake is late, absent, invalid, or recovered during close                     | Initial and recovery paths retain the same authenticated identity facts. Foreign run/token controls cannot authorize cleanup; authenticated idle/native work survives the unauthenticated listener deadline.                                         |
| Launch returns an error with a valid process handle                                     | Cover already-exited and still-live owned processes. Verify observed exit separately from creation; failed termination or unavailable identity remains unresolved.                                                                                   |
| Cancellation arrives after workload exit, during result reads or temporary-root removal | Return typed cancellation with available partial observations and actual cleanup status. The non-aborted control succeeds; existing primary/cleanup failures keep their precedence.                                                                  |
| Children have mixed health or cleanup outcomes                                          | Missing peer health does not erase an observed failure or activity. Idle plus unknown stays unknown. Retry a failed child without closing a successful peer again, including after a close-option change.                                            |
| Cleanup fails after success or primary failure                                          | Public output retains the completed observation or primary diagnostic, remaining resources, and owner recovery action. Restore the denied resource and verify the owning cleanup retry.                                                              |
| Cleanup owners recover after an error was returned                                      | Retain the original child and aggregate errors and project them after each owner releases. A successful peer stays released; the aggregate remains incomplete until all owners release. Preserve the first cause even when rejection is `undefined`. |
| Target exits without an acknowledgement, or transport disappears while it stays alive   | Positive owned exit proof resolves target lifetime; other resources still need cleanup. Lost transport alone does not prove exit. Verify unrelated/attached targets survive and same-connection recovery works when supported.                       |

Shared process-supervision controls separate leader exit from output closure.
Cover output during held or failed cleanup, bounded retention and drain timeout,
retry, and borrowed stream authority. The POSIX inherited-stderr control uses a
separate pipe as a release barrier after leader exit; it does not establish
native Windows Job Object behavior.

Synchronize cancellation with the finalization boundary being tested; a fixed
delay after dispatch does not establish that phase. Use markers, barriers, or
owned cleanup seams while preserving real cleanup where feasible. Check server
settlement and retained resources even if the MCP SDK rejects the client promise
before the handler finishes. A cancellation during active execution does not
cover cancellation during final cleanup.
For ZIP extraction, replace the pathname after inventory reader close while the
admitted root descriptor remains owned. Verify that identical member bytes in a
different carrier, a directory, or a missing pathname cannot switch the
materialized source. Exercise descriptor close failure and retry before output
publication.
Use explicit abort reasons and assert their identity at admission and after
provider completion, alongside retained observations and cleanup state.

Electron fuse regressions cover actual descriptor close denial and retry through
the built CLI, same-connection MCP recovery, mixed descriptor outcomes, and
server shutdown. Controlled seams cover cancellation during final close and
after reader finalization, plus active-provider shutdown during preflight.
They preserve real filesystem cleanup where possible; mocked launch boundaries
do not establish real Electron teardown or naturally occurring OS failures.

Active Electron cleanup controls retain independent transport and process-family
owners, block replacement captures until recovery, and retry only unresolved
owners. Cover late close acknowledgement and rejection after a wait deadline,
opaque rejection reasons, cancellation during failed finalization, and missing
lineage followed by a confirmed passive family census. Windows controls require
a fresh lineage observation and do not signal cached descendant PIDs after root
termination. Simulated Windows controls do not establish native Windows behavior.

Native process-ownership controls distinguish start identity, zombie lifecycle,
current parent/group relation, and token-read evidence. Retain generation-bound
candidates through smaller lineage observations, table omissions, reparenting,
group changes, and failed cleanup retries. Identityless exit-refresh controls
cover a replacement row that is not linked to the prior descendant set: a
matching token on its own group is signaled, a foreign or absent token is not,
an unreadable live token stays unresolved, a replacement that appears only in
the confirmation table is still token-checked, a group discovered during
revalidation is signaled before cleanup succeeds, a member that changes groups
during confirmation is signaled in its new group, a PID first seen with a
foreign token is read again on the confirmation table, a PID whose token was
already read is read again even when its parent and group return to the
pre-exit values, a pre-existing PID is read again when its parent or group
changes, an unchanged pre-existing row that was never token-read stays unread,
an unbounded confirmation
chain stays unresolved, lineage reads a row again when its launcher-tree
membership changes, a cached lineage token is read again on the next refresh, an initial descendant whose token already matched is read again on a later refresh, the launcher is read again on that refresh and a missing, unowned, or relation-changed launcher PID stays unavailable, a descendant absent from the latest refresh is omitted,
a group that reappears after it was processed is revalidated once, a further
reappearance stays unresolved, lineage publishes one row per PID, and lineage does not publish a
verified empty descendant list while that row remains unexamined. A readable token with unavailable
identity stays unresolved. Native UID facts, rather than an earlier process-table
row, determine whether a token denial concerns another user. Darwin tests compile
the helper and exercise snapshot growth, absence, lifecycle, and UID observations;
controlled Linux procfs tests do not establish real Linux exit or PID-reuse behavior.

For atomic writes, exercise cancellation on both sides of the documented commit
point and preserve any publication receipt. A late interruption does not prove
that no output was published.

For successful provider reports, test cancellation immediately before the report
reaches the application workflow as well as during provider cleanup. Validate
the report before classifying completion: a valid report must retain its Evidence
on cancellation, and an invalid report must keep its output error. Exercise both
the provider boundary and the shared CLI/MCP workflow; a downstream guard does
not repair the provider's own completion contract. When callers share startup,
cancel each waiter independently and verify that the last departure awaits owned
cleanup while interested peers can still reach readiness. Repeat the same
shutdown event after a cleanup failure to verify that its listener can retry.
Exercise non-default lifecycle deadlines through queued requests and their
consumers; default-only controls cannot detect dropped request options.

For descriptor-backed reads, inject a close failure after a successful read and
after a primary read or cancellation failure. Verify that the exact descriptor
remains owned, both failures survive, and a later close retries it. Repeat
admission attempts while close still fails: no additional descriptor or
native command should start. Restore close and verify that the exact owner
resolves the originating cleanup marker and allows later work, while the earlier
failure remains available as a diagnostic. Retain errors returned by multiple
failed retries, including admission and shutdown aggregates, and assert that
each becomes complete after recovery. For an aggregate with multiple owners,
release one owner while another still fails and assert that it remains incomplete.
Cover recovery before the
caller-specific error is bound to its retained owner, as
another request can retry cleanup concurrently. Confirm that an already released
owner resolves a later binding too. Include
admission failure after opening the descriptor. If caller cancellation returns
before an inspection settles, gate its final read or close and verify that
session shutdown waits for the owned work and reports any retained resources.
Gate a later read in a multi-read inspection, not only its first read. Overlap
operations so one retains a failed descriptor while another reaches its next
read; both the operation and shutdown must settle without nested-admission
deadlock. Deny child close and verify its containing root survives until retry.

Exercise publication on filesystems without hard links using an unsupported-link
seam. Check exclusive destination creation, stat/write/close failures, completed
output receipts, and cancellation at the documented cutoff. A streamed fallback
has different visibility from an atomic hard-link commit and must report it
accurately. For Windows command supervision, keep a descendant writing after its
leader exits, deny cleanup observation, and verify a competing writer remains
excluded until the exact Job Object closes. Portable doubles cover retry logic;
the native Windows lane must establish actual process-tree behavior.

Supervisor tests must observe process exit, output-pipe closure, and IPC
disconnection separately. In the pinned Node runtime, a parent-initiated IPC
disconnect can omit the aggregate `ChildProcess` close event. Join the actual
resource observations before reporting completion; process exit alone does not
establish pipe or process-tree release.

When changing an internal helper contract, check its JavaScript verifier and
subprocess-script consumers alongside TypeScript references. Source typecheck
does not check those calls; run their orchestration tests against the built
modules, including the verifier's failure and cleanup paths.

Representative regressions include
[process cleanup-time SIGINT](https://github.com/morluto/rea/blob/e78455338fe2d06c4cd03d59cbf33473d754998b/tests/boundary/process/processCaptureCancellationAdapters.test.ts),
[late authenticated cleanup](https://github.com/morluto/rea/blob/e78455338fe2d06c4cd03d59cbf33473d754998b/tests/boundary/providers/hopper/hopperClient.handshakeRecovery.test.ts),
[LLDB launch and finalization](https://github.com/morluto/rea/blob/e78455338fe2d06c4cd03d59cbf33473d754998b/tests/boundary/providers/native/lldbCallTracerFailures.test.ts),
[composed child ownership](https://github.com/morluto/rea/blob/e78455338fe2d06c4cd03d59cbf33473d754998b/src/application/binary/CompositeProvider.test.ts),
and [public CLI cleanup denial](https://github.com/morluto/rea/blob/e78455338fe2d06c4cd03d59cbf33473d754998b/tests/boundary/cli/wasmCleanupCli.test.ts).
These controlled probes do not replace the matching real-provider lane. Record
the base failure, passing control, exact host/provider, verified cleanup, and
unavailable coverage; a missing engine is not a pass.

## Behavioral depths

| Depth        | Location                | What it proves                                                                                        |
| ------------ | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Module       | `src/**/*.test.ts`      | One domain, service, or adapter through its narrow public surface                                     |
| Composition  | `tests/composition/**`  | Provider-neutral session and registry wiring; filesystem access is limited to fixture materialization |
| Boundary     | `tests/boundary/**`     | Exactly one production filesystem, process, network, browser, CLI, or provider boundary               |
| MCP boundary | `tests/boundary/mcp/**` | MCP transport and tool-contract boundaries with isolated sessions and explicit cleanup                |
| Acceptance   | `tests/acceptance/**`   | A compiled CLI or MCP journey; injected providers still make it integration                           |
| Conformance  | `tests/conformance/**`  | Shared provider contracts, parameterized by declared capabilities and explicit opt-outs               |
| Evaluation   | `tests/evaluation/**`   | Deterministic evaluator parsing, scoring, and report generation                                       |

Colocated domain tests may import only their owning domain and inward
dependencies. They do not construct sessions or servers and do not start
subprocesses or network listeners. Colocated application tests exercise one
service through explicit ports and recording adapters, never a CLI or MCP
entrypoint. Composition tests may assemble provider-neutral sessions and
registries but do not cross production filesystem, process, socket, or browser boundaries.
Boundary tests cross one production boundary. Only acceptance tests assemble
the complete runtime or invoke the compiled product surface.

Focused immutable builders and recording ports shared by one test family live
beside their production owner as `src/**/*.fixture.ts`. They are typechecked
with the suite and excluded from package builds; broader runtime and provider
fixtures remain under `tests/fixtures/**`.

`tests/process-global/**` is reserved for cases with a demonstrated dependency
on process-global state. Those tests use isolated forks so environment and
exit-status changes cannot leak between files. Serialize a case only when it
demonstrably shares an external resource that cannot be isolated. Reusable,
test-scoped fixtures live under `tests/support/**`; immutable source artifacts
remain under `tests/fixtures/**`.
The process-global Vitest configuration contract rejects new direct temporary-root
creation outside the workspace seam and its narrowly documented boundary/package
exceptions.

The shared temporary-directory and workspace helpers preserve caller labels
under an owned `rea-` prefix when needed. Their
[cleanup ownership differs](https://github.com/morluto/rea/blob/main/CONTRIBUTING.md#temporary-files-and-diagnostics):
`createTestTempDirectory` registers `onTestFinished` deletion, while
`createTestWorkspace` requires caller cleanup. Close resources before removing
their directory. `npm run verify:test-temp-hygiene`
uses the same ownership rule to find retained fixtures under a private temporary
root. Third-party caches remain outside that ownership rule.

Real Hopper, Ghidra, IDA, browser, package, and managed-code claims belong to their
explicit `npm run verify:*` lanes. The reconstruction-readiness lane separates
observed native CLI inspection and JavaScript/Electron static CLI/MCP analysis
from synthetic report-evaluator conformance. Its determinism, tamper, and
stale-source checks concern the synthetic evaluator; they do not execute fixture
applications or verify runtime authority, cleanup, comparison, or reconstruction
closure. The evaluator and its semantic tests belong to
`tests/conformance/readiness/report/`, outside the shipped runtime. When
application runtime behavior is needed, exercise the actual target through
browser, Electron, or process capture. Real model trials are manual; Vitest
covers deterministic evaluator logic.

`verify:managed` runs the portable PE byte-fixture conformance entrypoint under
`scripts/verify/managed/`, with its byte builder under
`scripts/fixtures/managed/`. It checks static classification, members,
reconstruction, native-boundary relationships and application graphs without
executing fixture PE files. Operator-local manifests and actual ILSpy oracles
remain optional, separately reported checks; the real Ghidra NativeAOT lane has
its own toolchain prerequisites. See [the managed guide](managed-code-analysis.md)
for those configurations. Generated completion-ledger checks use the same owning
entrypoint and include its verifier/fixture files in their cache inputs.

## End-to-end, integration and golden evidence

Prefer the public CLI or MCP workflow when it can observe the required behavior.
Use production-boundary integration for contracts the complete workflow cannot
reliably exercise, and producer goldens for format-specific facts. An acceptance
case with an injected provider verifies that integration boundary; it does not
establish real-provider behavior.

For installed-client versions, executable selectors, disposable profiles, model
fixtures, and detailed receipts, see [client verification](client-verification.md#end-to-end-integration-and-golden-evidence).
Use [real-toolchain lanes](#real-toolchain-verification-lanes) for engines and
[agent evaluation](#agent-evaluation-and-conformance-records) for investigation
quality. Report unavailable tools or authority explicitly and verify owned
cleanup before claiming success.

## Coverage and timing

CI owns coverage; aggregate and domain/contract thresholds are maintained in
`vitest.config.ts`. They are glob-specific and never updated automatically.
Coverage does not replace named boundary or real-provider scenarios.

The `reverse-tools` commands run the focused tests and report coverage and
mutation results without an additional percentage requirement. Test failures,
invalid mutation configuration, and runner failures still fail the check.
Mutation targets cover reviewed production behavior, including signal-terminated
commands, Cutter descriptor identity, debugger cleanup ownership, GDB command
exit and cancellation, and Rizin startup, timeout Evidence, and process exit.
A second exhaustive pass runs the focused Cutter and Rizin timeout semantics tests against every compilable
selected mutant to avoid relying on per-test mutation coverage associations;
Stryker reports compile-error mutants separately because those cannot execute
tests. Both passes resolve named syntax owners, scoped declarations, guards,
callbacks, and reviewed expressions from the current TypeScript source; no
hand-maintained line ranges select mutations. Missing, ambiguous, or malformed
source targets stop configuration before mutation generation. The selections
retain their review scope rather than expanding to whole source files. The
focused suite also exercises affected MCP routes and the Python Cutter bridge.
Contract, integration, and real-provider lanes complement these focused tests;
simulated providers do not establish real-provider behavior.

Required CI retains fresh reverse-tools coverage and preflights both canonical
Stryker configurations with `--dryRunOnly`. These preflights resolve the owned
targets, instrument the source, and execute the real initial tests. Invalid
configuration, target resolution, and initial test failures still fail the job.
Preflights execute no mutants and produce no mutation-outcome report. Both fast
feedback and full qualification, including exact-revision release qualification,
require coverage and both preflights. A failed, canceled, skipped or missing
selected quality job still fails the required gate.

The separate **Mutation sweep** workflow runs both complete configurations daily
and on manual dispatch, in two isolated jobs. It is a maintenance check outside
the PR and release publication gates. `ci:full` requests full regression,
coverage and provider qualification; it does not request a complete mutation
sweep. Use the Mutation sweep workflow to request that result. Targets,
checkers, concurrency, deadlines and the existing non-blocking mutation-score
threshold are unchanged. `npm run test:mutation:reverse-tools` also retains both
complete passes for local callers.

The two passes write separate JSON and HTML reports under `reports/mutation/`:
`reverse-tools` and `reverse-tools-semantics`. Required CI retains focused
coverage; the sweep retains each configuration's JSON/HTML reports separately.
Both retain available diagnostics for seven days after failure and skip uploads
on cancellation. Artifact names identify the tier or configuration and run
attempt. A successful sweep requires both jobs and their nonempty reports;
partial diagnostics and preflights do not establish complete mutation outcomes
or qualify the release revision for mutation coverage.

Fast CI starts the source-only projects after classification, independently of
build and static checks, and runs eight built-dependent shards after the build.
Those nine test jobs still select every portable test. Full qualification keeps six
complete Vitest shards with coverage. Neither tier retries tests. Canonical
project ownership lives in `scripts/lib/test-projects.mjs`, shared by Vitest,
CI group execution, and development-test preparation. A test importing compiled
verifier code belongs to the built group even if its directory is conformance.
Source and built blobs have separate labels to prevent merge collisions.
Each test job emits a blob report; the merge job produces JUnit and JSON diagnostics, a module timing
report, plus aggregate coverage during full qualification. It retains available
reports even when a shard fails, uploads available diagnostics, and writes the
slowest files to the workflow summary. Partial reports are marked diagnostic
only. Failed, cancelled, or missing selected shards still fail the required gate,
and aggregate coverage thresholds remain enforced in full qualification.
Only a successful complete merge on the default branch publishes shard history,
and only from a push, schedule, or manual run. Fast runs publish
`test-timings-fast`. Full runs publish `test-timings-full`. Pull requests do not
publish it: the lookup reads one unpaginated artifact page, and pull-request
artifacts would crowd out the default branch. The build job downloads the
artifact that matches its tier, so fast shards use durations measured without
coverage and full shards keep coverage-weighted durations. A tier with no
qualifying artifact leaves history unset. The download is that small
checkout-relative timing file, not the coverage/JUnit bundle. Timing weights come from Vitest module
diagnostics and include tests and hooks, worker preparation, environment,
imports, and setup. Import timings already include transform waits, which are
not added again. The weights describe file costs under the measured worker and
coverage settings; their sum is not workflow elapsed time. The diagnostic
artifact retains the phase breakdown, while shard history keeps only each
file's total. Legacy test-body-only history and missing history fall back to native
sharding. Static checks, documentation, build, package verification, and
real-system lanes remain separate jobs so one kind of evidence cannot stand in
for another. Workflow syntax and expression validation runs inside the required
static-check job when workflow changes select it, avoiding a separate runner.
Native, provider, fixture, SQLite compatibility, and website lanes wait for
the fast static checks (typecheck, built lint, and format) to succeed before
allocating their runners. Knip, duplication, architecture guards, test
discovery, and the Python producer run in the separate full-tier deep static
job and do not gate provider admission. On the fast tier, changes to Python
bridges, analysis-efficiency inputs, or the Python test runner select a separate
required Python job. That job installs locked dependencies and prepares the
compiled runtime before the suite, because analysis-efficiency checks import
built process modules. Bridge tests are discovered from the source tree. The
mitmproxy, native, and pwndbg families must each contain a test module and
execute at least one non-skipped case or subtest. A parent case with only skipped
subtests does not satisfy this requirement. A newly added failing test fails the job.
Portable test shards and documentation checks remain independent of static results, so they can still provide
diagnostic feedback. The required gate rejects skipped selected lanes when
static checks fail; on the full tier it also requires the deep static job.
Passing revisions retain all selected coverage. This ordering reduces peak
demand on invalid revisions but can add static-check waiting to otherwise
passing runs; it is not a measured reduction in end-to-end latency.

Core jobs have execution limits of five minutes for classification, ten minutes
for static checks, builds, docs, and report merging, and thirty minutes per
portable test shard. These limits leave headroom for cold setup and full coverage
while preventing a hung job from holding the active main run for hours. They do
not bound runner queue waiting. Timeouts still fail the required gate.

The separate `CI timings` workflow also diagnoses missing, startup-failed,
queued/running, approval-required, canceled, and failed PR CI through bounded,
read-only API scans. Incomplete pagination or changing identity stays unknown.
It never closes/reopens PRs, reruns workflows, posts comments, or changes gates.
The timing manifest retains each run's event and head branch, including explicit
unknowns, so PR runs cannot consume the eligible-main comparison budget.
Its static failure report compares supported lint/duplication diagnostics with
failed main runs using exact source, ancestry, task hashes, and toolchain proof.
A match describes those diagnostics only; it does not establish that every
failure in a job came from main. Duplication reports retain the actual checker
exit result, so passing duplication checks preserve lint failures and caller
thresholds remain owned by the producer. Missing checker outcomes leave
those duplication diagnostics unclassified. Missing historical receipts remain unknown.
The reporter executes only trusted default-branch code and parses whitelisted
JSON artifact members without executing artifact content. Reports and limits
are retained in `ci-health-diagnostics`; its ten-minute job limit covers the
existing four-minute timing collection plus the bounded diagnostic stages.

Fast built shards target under ten minutes of uncontended shard-job execution.
That figure is the `test-shard` job. The job waits for classification and the
build, and the portable-test merge runs after the slowest shard. On 2026-10-20,
run `39451548945` measured those surrounding jobs with runner queue excluded:
classification 15 seconds, build 49 seconds, and the portable-test merge 29
seconds. Shard 1/5 of that run spent 22 seconds before built Vitest and 3
seconds after it, including `npm ci` at 9 seconds. `node_modules` is about 674
MiB, so publishing it as a shared artifact would transfer more data than that
install saves. The npm download cache stays the setup cache.

File timings from that run put the built suite at 7944 seconds of module time.
The sequencer keeps each file's full duration on one worker. Extra workers
overlap other files in the same sequence group, and `process-boundary` runs
after that group. Scheduling the unsplit inventory onto five shards peaks at
820 seconds of tests. That run's slowest built shard job lasted 925 seconds
(shard 4/5), and shard 1/5 spent 874 seconds in built Vitest, so hosted job
time sits above the file schedule. Six shards of the same inventory peak at
684 seconds of tests. Eight shards, after the 578-second loader file is split
by case count (54 cases stay in that file and 46 move into each of three
files), peak at 513 seconds of tests. With the measured 25-second shard setup,
that shard job is about 538 seconds. Adding the measured classification, build,
and merge makes an uncontended portable critical path of about 631 seconds,
still before the gap between this file schedule and hosted Vitest. Runner queue
is separate and grows when more shard jobs compete for runners.
`process-boundary` stays serial because process-tree sampling shares the host.
Raising the worker cap from two to four on this four-core host cut a six-file
acceptance sample from 96–101 seconds to 71 seconds and did not remove the
single-file floor, so the cap stays two. Full qualification keeps six covered
shards; its longer instrumentation is outside this fast budget.

The separate `CI timings` workflow batches recent completed CI and Release runs
hourly or on manual dispatch. It uploads `ci-job-timings-batch` with raw API pages and
a normalized point-in-time report for each collected workflow attempt, plus a
batch manifest describing examined coverage, failures, and limits. Overlapping
lookback windows may collect an attempt again; identify records by run ID and
attempt. Each batch examines at most 100 completed runs per workflow created in
the preceding 24 hours, with a four-minute API collection budget. It collects the
latest attempt of each selected run and does not claim an exhaustive archive.
It runs the reporter from the trusted default branch with read-only permissions,
treating workflow runs as API data. It does not allocate a new reporter job for
every completed, cancelled, or skipped workflow. Reports separate queue
waiting (`created_at` to `started_at`) from completed execution and report
percentiles plus matched `npm ci` and artifact-step durations.
Queue excludes dependency waiting before job creation and does not establish
whether account concurrency or runner availability caused the wait. Queued jobs with
placeholder start times, skipped jobs, and missing or invalid timestamps remain
unknown. The reporter targets each selected run and attempt explicitly.
Summed job elapsed time is parallel work, not workflow wall time, CPU time,
memory usage, or billing. Step names identify samples, not complete transfer
costs. Its queue, execution, and failures are independent of the required gate
and publication. CPU time and peak process-family memory are not measured by this API.

The build job saves portable Turbo outputs across runs. Eight Linux real-system
lanes reuse its current-run artifact; standalone dispatches restore the cross-run cache. The shared action
derives its key from `test:prepare --dry=json` task hashes, runner OS and
architecture, `.npmrc`, `.nvmrc`, and the lockfile; test-only changes can reuse compiled outputs. Every
build and verification command still runs, so Turbo checks task inputs and
rebuilds misses. A restore prefix with the same platform and toolchain permits
partial task reuse when one generator's inputs change; Turbo still invalidates
that generator's entry. Native outputs are not stored in this cache.

Native package jobs, the Windows curated lane, and the Apple artifact lane reuse
the same workflow's Turbo cache for portable compiled JavaScript, skills, and
catalogs. The key parser retains the validated `test:prepare` task identities in
`.cache/ci-build-plan.json`; staging reads this plan without starting another
Turbo run that could evict cache entries. The producer stages matching archives,
metadata, and available manifests into `.cache/ci-build-cache/`.
`portable-build-cache.json` records availability per task. Evicted or partially
missing entries are omitted as whole entries, and consumers rebuild cache misses,
including when every entry is unavailable. Malformed plans, non-file entries,
and I/O errors other than disappearance still fail publication. After a trusted
static run, superseded cross-run Turbo snapshots for that OS and architecture
are deleted down to the two newest generations. The Windows lane also runs the
official compiler's complete source typecheck with two checker threads,
independently of the accelerated Linux checker. Both lanes retain the normal
build and prepack commands, which restore matching outputs or rebuild on a cache
miss. Native
artifacts, dependency installs, package archives, and runtime verification remain
host-local. Keep platform-dependent outputs out of this shared cache.

The Windows native verifier's private-runtime ACL observer reads the owner and
access rules only in SID form, checks that every identity it compares is a
`SecurityIdentifier`, and never uses `Get-Acl` or the convenience `Access`
property, which resolves account names. Its Windows PowerShell observers call
.NET members directly and build their JSON without cmdlets, pipelines, module
autoloading, or type-table updates. The `private-runtime-acl` stderr markers
report the powershell.exe process uptime and each completed phase; inspect them
on a timeout before attributing it to startup, ACL reads, or identity lookup.
The 60-second observer deadline bounds a hung observer while covering a cold
powershell.exe start on a starved hosted runner. All ownership, DACL, and
readonly assertions remain in force. A passing retry alone does not explain a
previous timeout.

Record cold and warm preparation separately from fresh test execution when
benchmarking the optional `npm run check:pr` gate. Compare multiple runs on the
same host, including subprocess and queue costs; a cached pass is not a test
runtime measurement. A PR that touches packaging or real-system
behavior requires the applicable `verify:*` lanes; packaging and installation
changes also require `npm run verify:package`. The full-gate benchmark measures
that explicit lane, not the routine iteration requirement.

The package-update registry fixture retains its first proxy/body failure and
aborts the owned updater command. It joins the helper and installer descendants
before workspace removal. Incomplete process cleanup retains the exact owner
and workspace rather than reporting successful removal. The controlled
`packageUpdateRegistryFailure` regression needs built process modules, uses no
public registry, and checks both the primary failure and live descendant absence.

## Real-toolchain verification lanes

Linux Rizin debugger ownership changes require a separate real-provider gate on
Rizin 0.7.4. Run
`npm run test:focused -- tests/boundary/providers/RizinInferiorTty.test.ts`.
This test verifies the caller-selected TTY against the actual inferior's file
descriptors, confirms `dbg.exitkills=false`, detaches through the `olj`/`o-`
protocol, and checks that the target survives debugger close and writes to the
selected TTY. The suite is included in the reverse-tools Vitest and mutation
typecheck selections; its real-provider assertions skip when Rizin 0.7.4 is
unavailable. Run the focused command above on a host with that provider for the
explicit real-provider verification gate.

Each real-toolchain command must require only the host tools needed to prove
its stated claim. Use a host-native fixture for host/provider acceptance, and
place optional cross-target formats or platform-specific runners in separate
commands. Check prerequisites before starting expensive work and name the
missing command, target, and lane in any failure message. A lane must not imply
that a host or target is covered when it was skipped.

Provider admission accepts Ghidra 12.x (>=12.1) and the JDK range declared by that
installation (`application.java.min` through `application.java.max`). Current
12.1 releases require JDK 21 or newer and set no maximum. The lanes below still
prove behavior on the verified Ghidra 12.1.4 and JDK 21 build.

| Ghidra lane                                | Supported runner/target                                                                                          | Additional local tools                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `npm run verify:ghidra`                    | Linux x64/arm64 ELF or macOS x64/arm64 Mach-O                                                                    | Host C compiler, Ghidra 12.1.4, and full JDK 21                             |
| `npm run verify:ghidra:seeds`              | POSIX; raw x86 fixture; seed ordering, BSS labels, analyzer readback, not-applicable and unknown analyzer names  | Ghidra 12.1.4 and full JDK 21                                               |
| `npm run verify:ghidra:swift`              | macOS x64/arm64 Mach-O                                                                                           | Host Swift compiler, Ghidra 12.1.4, and full JDK 21                         |
| `npm run verify:ghidra:riscv`              | Linux/macOS x64/arm64 host; source-owned RV32/RV64 double-float and RV32 ilp32 ELF through CLI and MCP           | RISC-V Clang, LLD, LLVM readelf and objdump, Ghidra 12.1.4, and full JDK 21 |
| `npm run verify:ghidra:switch`             | Linux x64 ELF; GCC/Clang optimized and stripped switch fixtures                                                  | GCC, Clang, GNU nm/objdump/strip, Ghidra 12.1.4, and full JDK 21            |
| `npm run verify:ghidra:aarch64-jump-table` | Any supported Ghidra host; AArch64 ELF; signed/unsigned byte/halfword tables; host ARM64 Mach-O                  | Clang with AArch64 target support, Ghidra 12.1.4, and full JDK 21           |
| `npm run verify:ghidra:cross-format`       | Any supported Ghidra host; also analyzes AArch64 ELF, x86-64 PE, and x86-64 Mach-O                               | `clang`, LLD, and `lld-link` in addition to host-lane prerequisites         |
| `npm run verify:ghidra:windows`            | Controlled Windows x64 with native x86-64 PE; `-- --x86` selects native x86 PE                                   | Ghidra 12.1.4, full JDK 21, and the matching native artifact                |
| `npm run verify:ghidra:dol`                | Any supported Ghidra host; source-owned PowerPC GameCube DOL fixture built from a linker script (never executed) | Clang with PowerPC target, LLD, GNU readelf, Ghidra 12.1.4, and full JDK 21 |

The optional Swift lane compiles a source-owned fixture and checks modern and
provider-demangled procedure names through real stdio MCP, with and without the
dSYM companion. It checks unfiltered, structs, and literal-name filters,
same-address alias evidence, deduplication, and explicit unresolved categories.
It does not add a Swift prerequisite to the host C fixture lane.

The host lane also verifies namespaced C++ ABI symbols and annotation identity.
That facet requires Ghidra's matching `demangler_gnu_v2_41` native component in
`GPL/DemanglerGnu/os/<platform>/` or `build/os/<platform>/`, in addition to the
native decompiler. The namespace verifier reports missing or non-executable
components before testing the fixture. REA does not build or install them.

Windows native conformance runs with `npm run verify:windows-native` and does
not require Ghidra or Java. It includes Job Object commit-limit controls (a
limited child that reaches the limit, a control that does not, and invalid
limit rejection). An optional independently compiled Windows fixture
adds in-place reparse, breakaway, environment, and token observations.
The separate `scripts/verify-windows-native-inspection.mjs` lane uses the
`.cache/windows-native-inspection-fixture` artifact built on Linux with
`node scripts/build-windows-native.mjs --inspection-fixture`. Its controlled
first deletion failure checks retained NTFS ownership across a same-volume
rename, later-query handle-based recovery, successful-admission caching, and
environment-teardown cleanup. It neither
establishes the cause of the intermittent #1701 host failure nor replaces
verification with the shipped production artifact.
`npm run verify:ghidra:windows:package` additionally packs and installs REA into
an isolated prefix and runs ordinary-user CLI/MCP operations against their
canonical schemas. Run the controlled fixture generator before that lane, or
supply an installed package root and an explicit fixture as arguments.
The host-native Ghidra lane also verifies native value tracing through the
production CLI and a separate stdio MCP process. It compares complete dependency
graphs, validates Evidence and upstream/workflow profiles, checks capability
discovery, and closes the MCP session. No provider or transport is mocked.
It also validates every advertised input/output JSON Schema and the exercised
MCP outputs, probes address spelling and name/address ambiguity, and checks
direct versus targetless calls, byte-read completeness, invalid input diagnostics,
CLI/MCP parity, atomic annotation rollback, refreshed inventories, unchanged
executable bytes, and discarded edits after reopen. A deliberately long temporary
path exercises private Unix socket allocation and cleanup, including cancellation
after a real headless process launches. Native annotation probes reject NUL and
unpaired Unicode surrogates without partial edits or a broken bridge, preserve
supported Unicode and control text, and check lossless malformed-text diagnostics.
Memory-to-file mapping is checked against original artifact bytes.
The fixture also stores a pointer one byte past a function entry; exact
xrefs, raw procedure references, and CLI/MCP dossiers must retain that data edge.
A valid legacy snapshot reconstructs the former omitted edge under its older
profile; CLI and MCP must reject that binding with a mismatch reason and
recovery advice. The rejected open must preserve the active live session.
Exact external entries must resolve while retaining an empty body; unknown
external addresses remain unresolved and external annotations are rejected.
An adversarial regex over a full 12 KB literal must report stack exhaustion as
a resource constraint, preserve live annotations, and allow complete literal
searches afterward; CLI and MCP must agree on both results and recovery advice.
Real snapshot lifecycle checks retain edited API results as Evidence while
rejecting immutable snapshot saves and imports before and after a repeated
open of the same target. They verify unchanged live annotations and run identity,
absent rejected output files, an unchanged source snapshot, and successful
snapshot import/save after closing and recreating the database. The pristine
snapshot is written by an independent real CLI session.
They also start a real annotation and snapshot close concurrently: the edit
must succeed, the snapshot must be rejected without creating a file, and the
edited session must remain usable until explicitly closed.
Source-admission probes change a caller-owned fixture after `open_binary` but
before the first Ghidra query. They require an actionable `artifact_changed`
error preserving both digests and the selected path, unchanged provider
availability, failed-copy cleanup, and successful recovery after reopening.
After import, deleting that source must preserve the captured database identity.
Instruction inspection and containing-function lookup also agree across
hexadecimal case, leading zeros, and encoded default address-space spellings.
The same source-acquisition workflow exercises missing and directory-replaced
inputs, plus real read-permission denial on a host that enforces it. Permission
fixtures must probe the relevant read, write or search operation before relying
on POSIX mode bits: a non-root Linux process may bypass DAC through capabilities.
`requirePermissionDenial` reports an explicit skip when the host permits the
probe; it restores the probe's permissions before skipping. Such a skip leaves
real permission coverage unverified. Filesystem integration separately checks
selected-platform routing and exclusive creation.
Namespace annotation probes compile a separate host C fixture with C++ ABI
symbols, avoiding a C++ runtime prerequisite. Real Ghidra demangling supplies
duplicate leaf names in two top-level namespaces and a nested namespace. The
workflow verifies leaf and qualified renames, repeated reuse of fully qualified
readback, lookup by the returned name, literal namespace-like leaf names,
rejection of empty qualified leaf names without changing comments, CLI
behavior, and independent CLI/MCP database ownership.
Large-result probes compile initialized host-native data sized from the pinned
MCP SDK receive budget. Real byte reads, annotation edits and function dossiers
exceed that budget while preserving the connection and active analysis run.
Successful-result and oversized-error delivery constraints must identify their
successfully retained Evidence records;
export must recover every source byte, complete annotation and original error
diagnostic, with CLI parity
and an unchanged executable. Formatter integration separately checks unacknowledged Evidence recording.
Long ordinary procedure names and encoded address-space selectors must produce
normal validation errors without exhausting Java's regex stack or losing the
private bridge connection. Each rejection is followed by a real provider lookup;
address-like literal names still resolve exactly after annotation.
Malformed annotation readback, memory completeness, and inventory data remain separate
SDK/provider integration cases; success from a real
provider cannot establish rejection of a contradictory provider response.

The Linux switch lane checks dense, sparse-with-holes, shared-body, nonzero,
negative, and nonexact JSON integer labels plus a comparison-only control.
Independent source labels, ELF file bytes, table slots, and bounds branches
define expected case/default destinations. Production CLI and MCP must agree;
debug labels must retain their signed values. For stripped negative fixtures,
the independently checked 32-bit dispatch permits equivalent unsigned labels
only alongside the reported low-confidence `undefined4` parameter; original
source signedness remains unknown and the ABI residual must remain visible.
unsafe labels remain unresolved and every recovered destination is retained.
The compiler oracle also injects malformed records to check that its assertions
reject missing/default-confused labels, wrong destinations, and numeric guesses.
It also invokes the actual bridge methods on detached Ghidra model objects to
check ambiguous dispatches, signed literals, precision bounds, shared targets,
and conflicting labels. This reflection fixture depends on the pinned Ghidra
model and does not claim a compiler produced those synthetic graph shapes.
Pass `--entrypoint /path/to/installed/rea-agents/scripts/rea.mjs` directly to
`scripts/verify-real-ghidra-switch.mjs` to verify an installed package through
the same compiler oracles and CLI/MCP checks.

The cross-format Ghidra lane also analyzes an optimized AArch64 ELF switch
fixture. It checks the recovered case values against the source cases and
requires unresolved table bounds or case mappings to remain visible as
residual unknowns.

`npm run verify:inspector` requires the supported Node.js runtime and installed
REA dependencies. CI runs it on Linux and macOS x64/arm64 and Windows x64. It starts owned loopback
Node Inspector fixtures and verifies discovery and passive observation through
the CLI and stdio MCP, including special filenames, unresolved discovery
locations, and independently resolved loaded scripts. Double-quote filenames
are tested on POSIX only because Windows does not support them.

Node Inspector verification does not establish Electron GUI or other engine
behavior. Browser and Inspector share CDP transport/value and file-location
helpers; their producer workflows remain distinct.

## Android APK analysis

The real Android lane also runs on Windows x64 with its matching bundled native
controls. It verifies bidirectional protocol input, CLI/MCP result parity,
real MCP cancellation/disconnect and Java exit after abrupt CLI owner
termination. The forced Windows exit does not exercise the POSIX SIGTERM
handler and can leave temporary workspace files. `verify:windows-native`
separately checks binary input, backpressure, EOF and pending-write job closure.

`npm run verify:android` requires an existing Java 17+ and an explicit
`REA_JADX_MCP_JAR` for jadx-headless-mcp 0.7.1. Set `REA_ANDROID_TEST_APK` to the
fixed public ApiDemos v6.0.18 fixture. Obtain both with the explicit
`npm run fixtures:android` command; files are SHA-256 verified and
kept under ignored `_reference/`. No Gradle build, Android SDK, emulator or
application execution is required. The lane compares real CLI/MCP package,
class search, class inventory, method decompilation and incoming references.
See [Android analysis](android-analysis.md) for boundaries and resource budgets.

The **Real Android metadata bridge** workflow compiles the Java bridge and runs
its metadata regressions against the same checksum-pinned engine and public APK.
It runs on branch pushes affecting its bridge, fixture or engine inputs, and can
also be dispatched manually or called by another workflow. It uses the runner's
JDK with two active processors and a 512 MiB heap; it needs no npm dependency
installation. This lane checks exact raw/display class selectors, raw member names and field
DEX types used by mapping lookups, and the existing cold-metadata regressions. It does not establish CLI/MCP parity or application
execution behavior. The broader `verify:android` lane checks CLI/MCP parity;
neither lane runs the APK.

`verify:jeb` requires a caller-started JEB client serving MCP at
`REA_JEB_MCP_URL` (default `http://127.0.0.1:8425/mcp`) with a project
already open, and exercises shared application/provider client inspection, unit listing coverage,
and method decompilation. The script records the engine's exact response to
`open_jeb_project`; the earlier licensed 5.48.0 headless verification did not
advertise that tool.
REA does not install or launch JEB; see [JEB analysis](jeb-analysis.md) for
the bring-your-own boundary. The earlier licensed build was verified against JEB 5.48.0 serving
`jeb-mcp-server` 1.3.0 at four scales: a compiled Java class fixture, a
locally built signed probe APK with a launcher activity (manifest, v1/v2/v3
certificates, dex bytecode, filtered and paginated listing), the published
Signal 8.30.3 universal release APK (109 MB, R8-processed Kotlin/Compose,
four signature schemes, native arm64 ELF units) with MainActivity method
decompilation through both CLI and MCP, and the official Flutter Gallery
2.9.2 release APK (112 MB): per-ABI `libapp.so` Dart AOT snapshot images
analyzed as native code (75k methods on arm64) and decompiled through both
CLI and MCP with explicit unit selection, plus the thin Java wrapper and
decoded manifest. The dedicated Dart snapshot processor and `run_script`
remained GUI-only surfaces in that headless build.
The separate [Linux CE native audit](https://github.com/morluto/rea/blob/42e1a17d6e6c0487f17be0bae248553c4caba7f7/experiments/analysis-efficiency/jeb-linux-native.md)
uses the official CE `5.48.0.202610071539` direct CLI launcher and real
CLI/stdio MCP ELF workflows. That audit does not qualify CE Java/Android
decompilation or GUI project opening, and it does not replace the licensed
verification above.
Authenticated IPA and macOS application inventory projection is documented in
[Apple application analysis](apple-application-analysis.md).

`npm run verify:harmony` requires no SDK or engine. It projects the pinned
harmony-next-pipeline 1.0.1 release HAP from an MIT-licensed source repository,
fetched by `npm run fixtures:harmony` into ignored
`_reference/harmony-integration/`, set as `REA_HARMONY_TEST_HAP`.
The lane exercises `inspect_artifact`, projection determinism, Stage-model
path hints, exact component sets, signing-entry limitations, and CLI/MCP parity.
The release artifact has no independently established compiler/SDK or
reproducible source build; the default lane does not verify an installed package.
See [HarmonyOS package inventory](harmony-analysis.md) for those proof boundaries.
HarmonyOS `.har` libraries are deliberately not suffix-classified because
`.har` also names HTTP Archive JSON.

Synthetic producer regressions run independently:

```sh
npm run test:focused -- tests/boundary/process/jadxIntegration.test.ts tests/boundary/process/androidAnalysisMcp.test.ts tests/boundary/process/androidMappingMcp.test.ts
```

## Apktool resource decoding

`npm run verify:apktool -- --apk PATH` exercises both Apktool operations
against a real launcher (`REA_APKTOOL_COMMAND` or PATH) and one APK. No
download or build step is involved. Record: apktool 2.7.0-dirty (Debian
packaging) on Linux with OpenJDK 25, against a signed aapt2-built probe APK
carrying two resource locales — launcher version, on-disk digest agreement
with the reported target identity, apktool.yml metadata projection
(1.2.3, SDK 24–34), manifest package agreement, and both the default and
`de` string tables projected through the locale option. Parser goldens in
`src/apktool/ApktoolDecodeOutput.test.ts` come from the same decode. See
[Apktool resource analysis](apktool-resource-analysis.md) for boundaries and
budgets.

## Flutter build identification

`npm run verify:flutter -- --apk PATH [--plain-apk PATH]` runs both pure
static operations against a real Flutter APK, plus an optional non-Flutter
APK for the negative check. No engine or external tool is involved. Record:
Flutter Gallery 2.9.2 (112 MB, arm64-v8a / armeabi-v7a / x86_64) — every
ABI reports the same agreeing snapshot hash
(`65817c30a78bb44c3dc3771876b6010a`, two sections each) read 20 bytes after
the Dart snapshot magic, per-ABI engine GNU build-ids, no labeled Dart
version string (expected for a release engine build), and the Android
clang/LLVM toolchain line; the AOT inspection locates all four snapshot
symbols through the dynamic symbol table on both ELF64 and ELF32 images,
validates the data-section headers, agrees with the identification hash,
and counts 756 `package:` and 201 `dart:` URIs on arm64-v8a and x86_64,
and 212 / 48 on armeabi-v7a, from each isolate data section. Responses
retain at most 500 URIs per family and 2000 class-like tokens. Gallery's
pool projection and overall AOT coverage are partial while its structural
`libapp.coverage` is complete. A plain aapt2-built APK reports not-detected with
complete coverage. The suite uses self-contained synthetic ELF images and recorded scanner
prefixes, with no private local-file dependency. The verifier now compares
compiled CLI and stdio MCP Evidence on every ABI, including data-header kind
and declared lengths. Add
`--expectations scripts/fixtures/flutter-gallery-expectations.json` for the
documented Gallery APK to assert its pinned digest, hash, exact engine labels
and per-ABI URI counts. The verifier requires complete structural snapshot
coverage, reports bounded pool coverage as partial/unverified, and reports
exact labels/counts on other APKs unverified without an expectations file.
See [Flutter build identification](flutter-analysis.md) for boundaries and
budgets.

## ADB device acquisition

`npm run verify:adb` exercises every ADB operation against a live device or
emulator through the caller's adb binary (`REA_ADB_PATH` or PATH). No SDK
installation or emulator management is involved; the device-mutating tools
run only in the explicit lifecycle section (`--install-apk` drives a
lane-owned install → resolve → start → observe → force-stop → uninstall
probe). `--pull` acquires a real package and re-digests the pulled files on
disk against the returned SHA-256 values; `--serial` selects a device when
several are attached.

Record: adb 34.0.5-debian on Linux against an Android 14 (API 34) x86_64
emulator. The lane covered the complete observation surface — 337-process
listing, 287 binder services including AIDL `/`-suffixed names, 92 features
including hex GL versions, display size/density, window focus (legitimately
null on headless devices), `settings get global adb_enabled`, bounded
logcat, directory listings — plus a real two-APK split set
(`base.apk` plus `split_probe.apk`, built and installed through
`install-multiple`) pulled with byte-exact digests, a push/pull roundtrip
verified by the device's own sha256sum, a 1.3 MB screen capture with PNG
dimensions, `dumpsys package` projection, and the full lifecycle: unique
resolution before launch, launcher-activity start through
`cmd package resolve-activity` with `am start -W`, the started app visible
in the process listing, force-stop, uninstall, and zero matches after
removal. System-package pulls whose APKs keep non-`base.apk` names report
the `unknown` role with the file-name basis, verified with
`com.android.settings` (single 73.9 MB APK). Parser goldens for
`adb devices -l`, `getprop`, `pm list packages -f`, and `pm path` come from
the same device. See [ADB device analysis](adb-device-analysis.md) for
boundaries and budgets.

## Optional NativeAOT Ghidra analysis

The source parser lane is independent of the optional annotation JAR. Its
synthetic RTR 9.1 PE golden checks captured-byte digest admission, rehydration
into an immutable parser overlay, MethodTable/slot relationships, and frozen
literal extraction; provider tests exercise `inspect_native_load_image` and
address-based `inspect_native_data_type` with the database result still
unavailable. These tests do not establish Windows Ghidra host behavior.

This lane is separate from the default native lane. `build:fixtures:nativeaot`
requires an existing .NET SDK 8.0.416, the platform NativeAOT compiler/linker and
runtime pack 8.0.22. It builds benign sources into ignored `_reference/` and
records independent symbol/directory/SHA oracles; it never executes the target.
Linux also builds stripped, ordinary-native and small malformed/ambiguous/layout
negative inputs. The optional Windows fixture workflow builds a PE on a Windows
runner; analyzing that PE on Linux does not verify a Windows Ghidra host.
On a local Windows host, the .NET 8 ILCompiler finds the linker only through
Visual Studio 2019 or 2022 (`vswhere -version [16,18)`). With only Visual
Studio Build Tools 2026 installed, open its x64 Developer Command Prompt.
In that same `cmd.exe` session, run `set IlcUseEnvironmentalTools=true` and
then `npm run build:fixtures:nativeaot`. Running `vcvars64.bat` as a child of
PowerShell does not preserve its environment in the parent PowerShell session.

Build the clean pinned upstream adapter with `build:ghidra:nativeaot`, then set
`REA_GHIDRA_NATIVEAOT_JAR`. Run `verify:ghidra:nativeaot -- symbols`, `-- stripped`,
`-- ordinary`, `-- unsupported`, `-- malformed`, `-- ambiguous`, and
`-- loader-failure`, and `-- default-native` separately. The loader-failure mode source-builds
a deliberately failing JDK 21 initializer and checks the actual loader cause and
cleanup. The default-native mode verifies ordinary analysis with the optional
extension disabled.
The real MCP lane checks source identity, inline format discovery, metadata
relationships/slots against independent compiler symbols, frozen strings,
pseudocode and owned cleanup. Set `REA_NATIVEAOT_PROOF_CLI=1` for one equivalent
CLI type inspection; this costs an additional full import. Select an unpacked
installed package with `REA_NATIVEAOT_PROOF_PACKAGE_ROOT`, a fixture directory
with `REA_NATIVEAOT_PROOF_FIXTURE_ROOT`, and optional evidence capture directory
with `REA_NATIVEAOT_PROOF_CAPTURE_DIR` (absolute paths).

Keep builds/imports sequential on small hosts; scope `GHIDRA_HEADLESS_MAXMEM`
(e.g. `768M`) to this command and use CPU affinity if needed. REA does not install
or upgrade Java, Ghidra, .NET or native toolchains. See
[the supported layout and provenance](ghidra-nativeaot.md).

## IDA MCP adapter

`npm run verify:ida -- --target /absolute/path/to/program --procedure main`
uses the existing `REA_IDA_MCP_CONFIG` registration. It installs no engine,
Python package, or compiler. The target must already be open in the GUI for
the legacy or native attached profile; the database-supervisor headless profile opens
a digest-verified private copy. A caller-supplied fixture keeps prerequisites
limited to the selected engine and host. `tests/conformance/ida/inventory.c`
provides an optional small native fixture source with exported
`rea_fixture_add` and `rea_fixture_subtract` functions. For their switching check,
use `--second-procedure rea_fixture_subtract --second-marker='- 13'`.

The lane invokes the production CLI dispatcher and connects the pinned MCP
client SDK to the production REA server. It verifies function Evidence and
CLI/MCP parity, inventory/search, pseudocode, instructions, xrefs, malformed
input, original-input preservation, and lifecycle cleanup. The headless
profile also checks containing procedures, the admitted program as the
document, address context, and feature tracing. For headless
analysis it confirms that the owned database IDs disappear from upstream
discovery and private workspaces are removed. For attached analysis it confirms
the existing GUI target remains reachable with the same input identity.
`--package-root` selects an installed/extracted REA artifact. `--report` writes
private local observations with mode `0600`; the console summary contains no
target paths or upstream output.

Adapter and composition tests cover producer parsing, pagination, canonical
entries, external callees, target switches, cancellation draining, snapshot
replay exclusion, ownership failures, and incomplete cleanup. They do not
establish real IDA operation. The initial real workflows cover legacy upstream
1.4.0 on a Windows GUI and the modern supervisor at upstream commit
`c133c3853faa111a9b00ee615c013b720d0c4acd` with Windows x64 IDA 9.3, and the
headless profile on macOS arm64 with IDA Professional 9.1 (build 9.1.250226)
at the same upstream commit, using `tests/conformance/ida/inventory.c` built
with `clang -O0 -arch arm64` and the procedure `_rea_fixture_add` (Mach-O C
symbols carry a leading underscore). Before the headless session waited out
the transient `busy` health a worker can report right after opening, that lane
failed intermittently on that host. Linux headless, modern attached GUI tools,
other engine versions and architectures remain unverified; see the
[provider guide](ida-provider.md).

Native IDA MCP verification uses `"protocol": "native"` with an already-running native plugin and requires `--second-procedure other_function --second-marker unique_second_body_text` to exercise GUI function switching and a return to the first function. These options remain optional for other profiles. The literal marker must appear in the second function's pseudocode and be absent from the first. Native cloud/widget failures are reported without hidden retries.

The initial Linux x64 IDA Free 9.4 run used native MCP 1.1.2 with a local navigation correction. Windows x64 verification uses **IDA Pro 9.3**, the two-function public fixture, and the shipped Windows `whoami.exe` application. The native plugin was built from upstream `c9d15d98e8a143fc74f6e14037c48f63889b6d6c`, including the merged navigation fix, with a local loopback-listener change. Production CLI/MCP parity, switching, identity and cleanup passed. Correctness and performance measurements are recorded in the [Windows native verification notes](https://github.com/morluto/rea/blob/a2e2c29b59e8775b0e6aedb09a9eb16adf32646b/experiments/analysis-efficiency/ida-native-windows.md). Stock 1.1.2 switching, native macOS, and Windows IDA Free remain unverified. See the [native bridge prerequisites](ida-provider.md#optional-native-ida-mcp-bridge).

## Kuna lane

`npm run verify:kuna` requires a caller-supplied `kuna` in `REA_KUNA_COMMAND`
and a host C compiler (`REA_CC`, default `cc`) with `strip` and `nm`. It builds a
source-owned fixture with non-inlined calls, with symbols and stripped, then verifies through MCP that
callers, callees and exact incoming xrefs agree with those calls, graph/path
composition reaches the callee, reference-only queries leave project/staging
entries unchanged, repeated relationships reuse the graph, and
the first cold pseudocode answer comes from a single-function run or an export
that already finished, assembly waits for and serves from that export, and
pseudocode and both dossier facets match their recorded file spans and digests,
a fresh server reuses the export without rebuilding it, staging is empty after
a completed export, and no owned process survives. Pass
`--targets DIR --functions a,b` to add caller-built binaries laid out as
`DIR/<flavor>/<name>` beside `<name>.stripped`; addresses come from the
symbol-bearing build. `--compare-ghidra` with `GHIDRA_INSTALL_DIR` runs those
caller-built functions through Ghidra (it refuses to run without `--targets` and
`--functions`, an empty matrix, or names missing from every supplied target) and
reports latency, sampled process-tree CPU and peak memory, UTF-8 response size,
and goto and warning-marker counts. Those counts are not a correctness judgement,
and model tokens are not measured. Reference timings and response sizes are
reported separately; reference caches expire when the server closes. `--report PATH` writes the JSON report.

The first matrix run used Kuna 1.833 and Ghidra 12.1.4 with JDK 21 on macOS
arm64. It covered zlib 1.3.2 `minigzip`, coreutils 9.9 `sort` and the sqlite
3.54.0 shell, built at `-O2` for ELF x86-64, ELF AArch64, Mach-O arm64 and
Mach-O x86-64, each with symbols and stripped. A separate Linux x86-64 run verified
the fixture and system zlib 1.2.13 / SQLite 3.40.1 libraries through MCP, including
cached byte spans and a Ghidra comparison. See the [Linux report](https://github.com/morluto/rea/pull/3854#issuecomment-6185870391)
for measured scope and limitations. Windows, PE and universal Mach-O remain
unverified by this lane.

Kuna 1.986 passed the fixture and a separate small, source-owned Mach-O with
symbols and stripped on macOS arm64, including the Ghidra comparison and owned
cleanup. Linux and other hosts have not been verified with 1.986; this check is
not a repeat of the larger 1.833 matrix.

## DOS Ghidra analysis

`npm run verify:ghidra:dos` requires the supported Ghidra and JDK installation
on Linux x64 or macOS x64/arm64. It generates a source-owned MZ fixture without
a DOS emulator or compiler, then checks real 16-bit decoding, segment
relocation, near/far calls, decompilation, disjoint function body ranges,
stable CLI/MCP observations, unchanged source bytes, and owned process/project
cleanup. Raw p-code address-space selector tokens are reported separately from
the stable observation comparison. Linux x64 and macOS arm64 are verified;
macOS x64 remains unverified. This lane is separate from host-native and optional cross-format
verification. See [DOS analysis](ghidra-dos.md).

`npm run verify:ghidra:com` uses a generated headerless fixture with no compiler,
DOS emulator or game data. It exercises explicit admission, BinaryLoader entry
preparation, measured register context, whole-file byte readback, source offsets,
unmapped PSP/partial reads, actual decompilation, CLI/MCP parity and owned cleanup.
Both segmented-address lanes reject oversized default, explicit-space and encoded-space
coordinates through real reads, function queries and annotation attempts. Rejected
annotations must preserve the live function dossier; CLI and MCP must report the
truncation constraint, while leading-zero coordinates still resolve correctly.
It has the same Ghidra/JDK prerequisites as the MZ lane. Neither lane claims DOS
runtime or PC-98 device execution.

`npm run verify:ghidra:6502` uses `ca65` and `ld65` to build the source-owned
NMOS 6502 fixture from `tests/conformance/ghidra/6502.s` and `6502.cfg`. Set
`REA_CA65` and `REA_LD65` for non-PATH installations (tested with cc65 `V2.19`).
With an installed Ghidra 12.1.4 and full JDK, it verifies real CLI/stdio MCP
mapping parity, exact source bytes, functions, a direct call reference,
decompilation, 16-bit overflow rejection without replacing the active session,
and runtime cleanup. Windows additionally requires the matching native addon;
its verifier lineage remains explicitly unavailable outside the provider's
retained Job Object, as in the other Windows lanes.

`npm run verify:ghidra:m68k` needs no assembler: its 22-byte big-endian 68000
fixture is source-owned annotated hex in the verifier, loaded at `0x1000`. With
an installed Ghidra 12.1.4 and full JDK on Linux or macOS, it verifies the
`68000:BE:32:default` BinaryLoader import, real CLI/stdio MCP load-image parity,
exact source bytes, both functions, the `bsr.b` call reference, decompilation
through address and file offset, rejection of a misaligned entry and of a mapping
past `0xffffffff` without replacing the active session, and runtime cleanup.
Windows Ghidra P0 does not admit m68k, so this is not a Windows lane. The lane
has been run on macOS; Linux has not been exercised.

`npm run verify:ghidra:raw` uses a generated ARM little-endian headerless image
through the compiled CLI and stdio MCP server. With the same Ghidra/JDK
prerequisites, it checks preparation and bridge startup, verified load mappings,
instruction and byte readback, canonical-entry session reuse, replacement when
the entry changes without `provider_id`, unchanged source bytes, and owned
cleanup. Six-byte x86 and x86_64 controls also verify supported compiler
specifications, independent mappings, unchanged bytes, and decompilation of a
known return value. AArch64 remains covered by deterministic tests rather than
this real-provider lane. See [raw binary analysis](raw-binary.md).

`npm run verify:ghidra:address-context` runs on Linux with a caller-installed
Ghidra, full JDK, and an x86-64 ELF GCC toolchain (`CC` selects another compatible
compiler). It builds
`tests/conformance/c/pie-address-context.c` as a PIE ELF without executing it.
The compiled CLI and real stdio MCP workflow must expose the measured image
base, retain segment address spaces, agree on the overview, resolve explicit and
numeric file offsets, and reject unmapped analysis addresses with actionable
guidance. It checks the reverse `address-to-file-offset` mapping, file-coordinate
Evidence locations, and the suggested CLI search and load-image commands.
The verifier compares mapped bytes with the source file and checks source
identity, session preservation after failed lookup, owned runtime cleanup, and
verified empty process lineage. This lane does not establish Windows or macOS
real-provider coverage.

For source-identity boundaries that a normal single-file import cannot create,
`tests/conformance/ghidra/ReaFileOffsetSourceProbe.java` exercises the production
bridge against real Ghidra `FileBytes`. It rejects auxiliary and partial sources,
keeps distinct outcome codes for uninitialized and unmapped addresses, checks
the original target's round trip, and retains ambiguity when duplicate target
bytes have distinct loaded mappings. Injected decompiler failures and
cancellation verify that completed source/function resolution facts and backend
failure codes survive; these injections do not establish natural engine failures.
On Windows, after creating the
source-owned PE fixture, run from the repository root:

```powershell
node scripts/create-ghidra-windows-fixture.mjs
$proofRoot = Join-Path $env:TEMP 'rea-file-offset-source-proof'
New-Item -ItemType Directory -Path $proofRoot -Force | Out-Null
Copy-Item bridge/ghidra/ReaGhidraBridge.java, bridge/ghidra/ReaGhidraExtensions.java, tests/conformance/ghidra/ReaFileOffsetSourceProbe.java -Destination $proofRoot
& "$env:GHIDRA_INSTALL_DIR/support/analyzeHeadless.bat" $proofRoot source-proof -import "$PWD/build/fixtures/rea-ghidra-windows.exe" -scriptPath $proofRoot -postScript ReaFileOffsetSourceProbe.java -deleteProject
```

Require the `REA_FILE_OFFSET_SOURCE_OK` marker and no script errors; Ghidra may
exit successfully even when a post-script fails. The probe edits only its
temporary analysis database and does not execute the fixture. This producer
regression supplements public CLI/MCP coverage and does not establish Linux
host behavior or native process-supervision controls.

## Apple Interface Builder archives

`npm run verify:interface-builder` compiles the source-owned AppKit XIB into a
real `.nib` with Xcode `ibtool`, wraps it in a temporary app bundle, and runs
the compiled CLI and stdio MCP server with production providers. It compares
their decoded results and checks the view hierarchy, outlet, action, evidence coverage, and truncation
status. It also recompiles the XIB with toggled control booleans and requires
both decodes to match `ibtool --export` for each source. Storyboard compilation
additionally requires an installed iOS platform.

Keep the provider-specific acceptance path independent from optional
cross-compilers. Cross-format failures belong to the cross-format lane and must
not make native host acceptance unavailable.

## Native platform baseline in CI

Pull requests that change only root `README*.md` files, `docs/`, `AGENTS.md`,
`CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`, `native/windows/README.md`,
or the GitHub issue and pull-request templates run formatting and
generated-document validation, including the small onboarding example consistency
suite, without the source-test shards or native package
lanes. Classification compares the PR head with its merge base, so later
base-branch changes do not expand that scope. Static and portable-test aggregate jobs
remain present and fail if classification fails. Every code change retains the
complete portable Linux suite; individual test files are not selected by
imports or filenames.

Ordinary PRs also produce an **observational** test-selection plan. The candidate
leaf-adapter ownership table lives in `scripts/ci/test-selection.mjs`, separately
from provider-job scopes. It proposes keeping affected owners plus every unowned
test, including all CLI/MCP, acceptance, composition, conformance, and process
tests. Shared inputs, unknown paths, missing owner tests, and removed tests fall
back to the complete inventory. Renames account for both paths. Main, scheduled,
manual, and `ci:full` runs always propose the full suite.

The source group and every built shard together still execute the complete suite. The existing report merge
compares the proposal with actual module outcomes and retains
`.cache/ci-test-selection/report.json` in `test-results`, including selected and
omitted paths, changed input paths, missed failures, unobserved files, scheduling weights, PR head and
executed merge SHA. This adds no test reruns or runner jobs. Missing, duplicate,
skipped, interrupted, or unhandled results cannot establish a complete comparison;
even a complete passing comparison is not proof of ownership completeness.
Before enabling omissions, review representative full-run comparisons and
cross-owner consumers, including failures, and measure completed CI feedback and
runner demand. There is no automatic promotion or switch to skip tests. The
initial proposal measures only leaf producer-test omissions; it does not promise
the savings of a broader affected-test planner.

`scripts/ci/plan.mjs` selects lanes using the ownership table in
`scripts/ci/scopes.mjs`. Each lane record owns its path and test selection
rules and required fast/full jobs; workflow contract tests verify the mapped jobs.
Provider implementation changes run their real-provider verifiers and the Linux
x64 installed-package/Inspector baseline. The `apple` scope owns the Apple artifact lane; the `package` scope owns the multi-host
package matrix and the Windows curated lane, including Windows native controls,
Inspector, setup, configuration and packaging entrypoints. Runtime sources under
`src/` or `bridge/` without an owner, and the authored skill, run the Linux suite
and the Linux x64 installed-package/Inspector baseline only. Test-only changes
run the Linux suite without native package verification, except test files that
the Apple or Windows curated lanes invoke explicitly, which also select that
lane. Packet-capture and signal-recording tests and their producers select the
corresponding real-tool lane; both also run in full qualification. The shared
Linux resource-limit source and its tests select both. Each lane requires
its Linux kernel resource-limit cases and all seven descriptor-cleanup cases to
pass in the focused Vitest report. A missing report, missing case, skipped case,
or duplicate identity fails the lane; unrelated host-specific skips remain
allowed. These tests use synthetic producers. The separate real TShark or
sigrok verifier establishes the actual-tool observation. Edits to verifier entrypoints run only by manual, licensed or self-hosted
workflows run static checks and the Linux suite. Website changes run website
checks. Provider workflow changes validate the workflow and run that provider's
verifier. Changes under `bridge/ghidra/` also select the `ghidra_bridge` lane,
which compiles the packaged bridge sources against the pinned Ghidra 12.1.4
jars with `npm run verify:ghidra:bridge-sources`. That compile step never
launches Ghidra or imports a target, so a missing import fails the PR instead
of every Ghidra session. The launcher, compiler and package checks share named required source
roles. The manifest must match the complete Java cohort, so deleting a helper
or adding an unregistered dependency cannot silently change the shipped set.
The preflight reuses the provider's Java Properties parser with the pinned Node
toolchain's native type stripping, without an npm install or runtime build.
The shared release policy owns the verified version and JDK major. CI checks
the archive pin before downloading and verifies the extracted SDK version;
changes to these source owners also select the compile lane. After compiling,
the lane launches headless Ghidra on source-owned instruction bytes with
`-noanalysis`. The ARM/Thumb probe sets each instruction's mode explicitly and
checks the bridge's decoder-context readback. The decode probes check that
`ARM:LE:32:Cortex`, `ARM:LE:32:v8-m` and `Xtensa:LE:32:default` decode their
bytes from each language's default context. The bytes are never executed, and
edits to those probe scripts also select the lane.
Manual-provider/Android workflow changes run workflow validation only.
The four-version SQLite compatibility matrix has its own `sqlite` scope for
SQLite implementation, contracts, CLI/MCP registration, fixtures, and shared
runtime boundaries. SQLite and server-lifecycle test edits and the SQLite npm
scripts also select it. Unrelated code edits retain the complete portable suite
on the pinned Node version without starting four additional compatibility jobs.
Full qualification retains every SQLite version.
Shared process/contract/CLI boundaries, dependencies, other packaging inputs,
unknown paths, and changes to the planner select the fast Linux x64 baseline:
portable code checks and the installed-package runtime lane, without provider
lanes or the multi-host package matrix. A shared file with exactly one owner
still selects that owner. Full qualification still selects every lane.
CI timing collection, timing history, and test-report helper edits retain static
checks and the complete portable suite without selecting unrelated host/provider
lanes. Classification, qualification, gate, release receipt, and unknown CI
scripts keep that fast baseline.
Package script-only edits select their owning verifier when its entrypoint is
identifiable; unknown or shared script changes select the fast baseline. Android
build-script edits retain the Linux suite and workflow validation; real Android
verification stays manual. Renames account for both paths.

The `agentenv` scope owns the environment application and server modules, the
`environment-serve` and `environment-export` command registration, the shared
streamable HTTP listener, `scripts/verify-agentenv-environment.mjs` and its
workflow `real-agentenv.yml`. The lane exports a bundle from the source-owned
Grafana-shaped capture through the built CLI, packs the checkout into the
bundle's image and runs `agent-env run` on the hosted runner's Docker with the
pinned `agentenv-framework` release; it passes when the smoke task passes and
no container remains. It claims nothing about any hosted platform or another
framework version.

This narrower selection trades PR-time coverage for runner capacity. A change to
unowned shared runtime code that fails only on arm64, macOS, Windows, the Apple
artifact lane, or a provider lane that does not own the file is not caught on
the PR; scheduled full qualification reports it after merge. Ownership globs do
not follow imports. Use the `ci:full` label when a change may have native-host
or provider effects outside its owners.

Ordinary main pushes use the same owner scopes as PRs. Their diff starts at a
successful ancestor push run of this CI workflow, rather than the preceding
push: changes from failed or cancelled intermediate runs remain in scope.
Missing, untrusted, or non-ancestor history selects the fast Linux x64
baseline: portable checks and the Linux runtime lane. The lookup is
bounded to the last 100 successful push runs; lookup failures broaden selection.
Every code change still selects the source group and all eight fast built shards, without coverage
instrumentation in this fast tier. Ordinary PR matrices cancel remaining
shards after the first failure; passing PRs execute the complete suite. Main,
`ci:full`, scheduled, manual, and release qualification retain every shard's
results after a failure. Available failed-shard reports remain diagnostic only:
failed, cancelled, skipped, or missing selected shards cannot pass the gate or
publish successful timing history. This deliberately avoids relying on an
import graph for generated files, filesystem inputs, subprocesses, or bridges.
The portable report rejects an entirely skipped module inventory and lists
fully skipped modules in its summary. A mixed passed/skipped inventory is
allowed: Vitest's skip state does not establish whether a skipped module was
required on that runner. Review the listed skips against platform and provider
prerequisites; the inventory alone does not prove every required case ran.

Scheduled qualification is admitted hourly at minute 23. A forced full run at
03:23 UTC refreshes runner and dependency drift every day. Other hourly runs
can reuse a successful full-qualification receipt for the exact source SHA
from the same repository's trusted CI workflow on its default branch. Both the
receipt and original workflow run must be less than 24 hours old, so retrying an
old gate cannot renew stale proof. Missing, expired, failed, foreign, or uncertain proof runs full
validation; API lookup failure also runs full. Lookups examine at most 100 named
receipts and three candidate runs within a 20-second budget. Reused runs select
no validation lanes, identify the original run, and produce no new receipt, so
reuse cannot indefinitely extend proof freshness. They make no fresh provider
observation. Manual dispatch, `ci:full`, and exact release qualification always
run full validation.

Full qualification includes aggregate coverage,
every portable provider lane, and all native hosts below. Adding `ci:full`
immediately starts the separate `Full PR qualification` workflow against the
label event's merge revision; subsequent PR revisions also select the full tier
in normal CI while that label remains. Unrelated labels do not start validation
jobs or replace the main CI checks. Manual dispatch also requests full validation.
Fast-tier broad fallbacks keep the portable suite and the Linux x64 runtime
baseline. They do not start every owner lane or the three-host package
matrix. Intel macOS and coverage remain full-tier obligations. Real provider
lanes stay path-gated, and a shared registration file listed by many lanes
does not start those lanes on a fast PR. Each
classification job records its selection and broad-fallback reasons in the run
summary. Representative Git-diff cases live in
`tests/boundary/filesystem/ciChangeScope.test.ts`.

`CI required` checks classification and every selected lane,
rejecting failed, cancelled, or unexpectedly skipped work. It rejects missing or
unknown tiers and requires every canonical scope to be explicitly `true` or
`false`; incomplete classification cannot silently omit verification lanes.
The aggregate remains cancellable so superseded runs release their slots.
Branch protection
should require this aggregate, `Static checks`, `Portable tests`, and
`Conventional PR title`. Title validation runs separately on PR opening,
reopening, commits, and edits; correcting a title refreshes only this lightweight
check. It reads title text through an environment variable, executes no PR code,
and has no token permissions. Its separate concurrency group cannot cancel
test runs. Fast PR runs cancel superseded feedback for the same PR. Main push
runs keep one active run and the latest pending run for that branch.
Scheduled/manual qualification has a separate concurrency group: active work
finishes and only the latest pending run is retained. Release qualification uses
its exact source SHA and cannot be cancelled by newer main pushes. Provider and
website lanes inherit their caller's scheduling; reusable
workflows have no independent cancellation group. Direct manual lane dispatches
run independently on disposable hosted runners. Publication
requires that qualification to succeed and consumes its exact verified tarball,
checking source SHA, workflow run, run attempt, package/Node version and SHA-256
before npm publication. Earlier attempts from the same workflow run are accepted
when rerunning failed publisher jobs; future attempts and other runs are rejected.
The public-registry canary still verifies the published package. Licensed/self-hosted
provider workflows and the Android smoke test retain their explicit triggers.

CI exercises the pinned Node.js runtime on native hosted runners:

| Host                  | Runner             | Baseline checks                                                                             |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| Linux x64             | `ubuntu-latest`    | Installed package and real Node Inspector CLI/MCP                                           |
| Linux arm64 (aarch64) | `ubuntu-24.04-arm` | Installed package and real Node Inspector CLI/MCP                                           |
| macOS 15 arm64        | `macos-15`         | Installed package and real Node Inspector CLI/MCP                                           |
| macOS 15 x64          | `macos-15-intel`   | Installed package and real Node Inspector CLI/MCP (hourly, dispatch, release and `ci:full`) |
| Windows x64           | `windows-latest`   | Curated capabilities, native controls, installed package and real Node Inspector CLI/MCP    |

macOS x64 is the slowest package host. Ordinary PRs and main pushes omit it,
so darwin x64 installed-package and Inspector regressions surface in full
qualification. Schedule admission can be delayed by GitHub; the hourly trigger
does not guarantee an hourly completed result. Release publication waits for
its own complete result at the exact released revision.

Package lanes assert the actual Node platform/architecture before verification
and record those values with the Node version. The package matrix runs up to
four jobs concurrently on independent hosted runners with explicit
timeouts and per-runner Node heap/thread limits; Windows retains its curated
capability lane. Package checks cover installation, CLI/MCP discovery,
target-free analysis, configuration backups/recovery, Evidence and owned
lifecycle; Inspector checks execute source-owned loopback targets and special
filename cases.

POSIX package verification resolves the runner's configured npm cache before
creating disposable client homes and passes that location to its child installs.
This reuses the download cache restored by the shared npm-cache action while keeping client
configuration isolated. Installs retain their existing registry and integrity
checks.

The Apple artifact CLI/MCP lane uses one `macos-15` job to avoid adding demand
for scarce macOS runner capacity. It runs the artifact-format and metadata
verifiers, followed by one consolidated focused invocation containing all
existing native and process-boundary regression paths.
The real native provenance verifier checks CLI/MCP agreement on complete
per-slice encryption absence. The encryption CLI regression builds a universal
image, marks its owned arm64 command with `cryptid=1`, and compares the reported
range with `otool`; this verifies declared metadata, not actual FairPlay data.

The Linux source-test shards download a shared runtime and generated test
metadata snapshot produced by the build job with `npm run test:prepare`. The
snapshot includes `dist/`, generated skills, the MCP tool catalog, product
catalog, and managed-conformance metadata. Each shard still installs the locked
dependencies and runs its assigned tests; full qualification enables coverage. It no longer
regenerates the same metadata independently.

The build job finds the newest trusted timing artifact for its tier
(`test-timings-fast` or `test-timings-full`) from a successful default-branch
push, schedule, or manual CI run, and includes that same report in each shard's
snapshot. The bounded lookup verifies the producer. Pull-request runs and other
branches are not producers. A tier with no qualifying artifact leaves history
unset, and Vitest uses its own assignment. A later schedule that reuses
qualification without uploading timings leaves the previous artifact in place.

On 2026-10-21 the newest full history was run
`39545047294`, recorded before compiled-CLI session reuse. Fast run
`39552964873` packed its eight built shards from that history, and those shard
jobs executed for 319–591 seconds. Replaying that run's file durations through
the sequencer's two-worker schedule balances every shard at about 404 seconds
of file time. The same replay with the stale history weights leaves the slowest
shard near 547 seconds and the fastest near 293. That spread is file-schedule
time, not runner queue, which is why each tier keeps its own history.
CI assigns discovered files by historical duration, with a deterministic
fallback weight for new files, rather than dividing only by file count.
Each file keeps its full duration on one worker. Extra workers overlap other
files in the same sequence group, and `process-boundary` runs after that
group. History published before the competing-loader split still names only
`javascriptLiteralPercentPaths.test.ts`. Until an artifact records
`javascriptLiteralLoaderOwnership.test.ts`, the sequencer assigns that
recorded duration by the pre-split case counts: 54/192 stays with the
percent-path file and 138/192 goes to the consolidated loader file. History
that names the retired Early, Middle, and Late shards sums those durations
onto the consolidated file instead, and scales a partial set as three equal
shares. That weight is the old dual-surface cost. The demoted file runs every
loader once through the shared stdio MCP session, so the first schedule
overestimates it. Every discovered file still belongs to exactly one shard;
worker limits and project ordering remain unchanged. Fast qualification keeps
eight built shards without coverage. The merge job rejects successful reports
with missing, unexpected, or duplicate portable files. Coverage instrumentation
and aggregate thresholds remain enforced in full qualification.
Missing or unusable history falls back to Vitest's default assignment. Only
timing data is reused; live provider results are never cached. Turbo outputs are
restored by task hash, with trusted default-branch runs as cache writers and PRs
as restore-only consumers. The static job also restores its Turbo snapshot;
each task revalidates its own input hash before reusing outputs or diagnostics.
The Node pin and npm install settings are global hash inputs. Knip runs only
in full qualification, with `--cache` and a GitHub cache of
`node_modules/.cache/knip`. The saved key includes the commit SHA. Restore uses
the configuration prefix, so the next trusted full run can publish a refreshed
snapshot. That cache is an AST cache keyed by file mtime and size, so a
fresh checkout often misses it; Turbo still hashes the Knip task inputs. Knip
includes its ignore rules and VitePress
entry, so changes to those inputs cannot reuse an older successful check.
Jobs that run Turbo export `TURBO_TEAM`. A called workflow sees the caller
event, so `workflow_call` is not an event name inside CI. `TURBO_TOKEN` is set
when release qualification passes `remote_cache_write`, or when the ref is the
default branch and the event is push, schedule, or workflow_dispatch, and only
when that secret is available to the run. Release qualification passes
`TURBO_TOKEN` and `remote_cache_write` into the called workflow. Labeled
pull-request qualification does not. Pull requests receive an empty token and
`TURBO_CACHE=local:rw`. Remote reads require `TURBO_TOKEN`, and this repository
does not pass a separate read-only credential into pull requests. An empty
token leaves the local Turbo cache in place.

The shared npm-cache action caches downloads, not `node_modules`, and every
consumer still runs `npm ci`. Keys cover the runner OS, actual Node architecture,
root lockfiles, and `.npmrc`. An exact-key miss restores the newest cache for
that OS and architecture, so a lockfile change reuses unchanged tarballs while
`npm ci` still verifies the lockfile. Only push, schedule, and manual events on
the repository's default branch may save shared npm caches, and only from the
opted-in writer for that host: Static checks for Linux x64, the package matrix
for every other included host, and the Windows curated lane. Every other job
restores without saving, so parallel jobs do not publish duplicate copies.
Pull requests restore only. Static snapshots are saved only after the static
job's validation succeeds. Cache deletion is a
separate workflow, because reusable qualification calls this workflow and
cannot raise its read-only token. After a push, schedule, or manual CI run on
the default branch finishes, including when a later lane fails, times out, or
is cancelled, that workflow runs on `ubuntu-latest` and deletes older
`rea-static-v1`, `rea-static-deep-v1`, and `rea-portable-build-v2` entries for
that runner's OS and architecture, plus older `knip-meta-v1` entries for that
OS. It keeps two generations plus the key that run saved. A fast run that did
not publish a deep or Knip snapshot still leaves the two newest entries in
those families. It
deletes an npm download record only when another record has the same key, cache
version, and git ref, and it keeps the most recently accessed copy. A different
version or ref is a different restore target and stays. One cache id is one
record: a repeated id keeps the later access time when its key, version, ref,
size, and creation time agree, and an inconsistent repeat deletes nothing. An
incomplete or unexpected cache list deletes nothing.
Distinct lockfile generations of the download cache stay, so the restore
prefix still has a seed.
Main warms the new cache namespace after merge; a cold cache falls back to the
normal install. This prevents each PR from saving another branch-scoped copy of
the same download cache. It does not remove runner assignment waits.

Portable owner-based test selection remains observational. Its reports compare
proposed omissions with the full run; incomplete or skipped observations do not
establish that fewer tests would preserve regression detection.

The automatic browser, binary-layout, EVM, JavaScript-recovery, packet-capture,
signal-recording, recorded-crash, web and environment-bundle provider lanes download
`rea-build-cache` from their own run after the build and static jobs succeed. Their existing build commands still
validate task hashes and rebuild mismatched inputs; provider observations always
run. Provider-workflow-only edits also admit the build without enabling source
test shards. Direct provider dispatches retain the cross-run restore-only cache.
This removes repeated compilation on fresh source revisions, but adds the build
as a prerequisite: a delayed build can delay provider admission. Compare queue
and execution times before claiming an end-to-end speedup.

These native baseline checks complement the Linux source-test shards and the
separate Apple-artifact and real-provider lanes. Actual Hopper, Ghidra, IDA,
browser and managed-tool claims require their corresponding verification lanes.
Runner labels follow the [GitHub hosted-runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

### Termux Android browser smoke test

The **Real Termux browser verification** workflow is manual-only while its
emulator setup is being validated. After the workflow reaches the default
branch, select a revision under **Actions → Real Termux browser verification →
Run workflow**. It boots an Android 11 (API 30) x86_64 emulator, installs the
checksum-verified Termux 0.118.3 APK, and lets the app initialize its bootstrap.
The host stages the selected revision using `git archive HEAD`; no workstation
build outputs or dependencies are copied into Android.

`scripts/verify/termux/emulator.sh` sends a `RUN_COMMAND` intent to Termux's app
service. Root access is limited to staging files, sending the intent, and reading
diagnostics; installation, compilation, Node, and Chromium run as Termux's app
UID. The in-app script installs Termux's Android-linked Node distribution,
checks its version against `.nvmrc`, pins npm from `packageManager`, runs
`npm ci`, and builds with `build:termux`. Termux repository packages, including
Chromium, are resolved at run time; their installed versions are logged.

The verifier leaves Playwright's cache environment overrides unset, requires
a healthy public MCP doctor result, and captures URL plus DOM from a loopback
HTTP fixture through `capture-browser-scenario`. It checks completed steps,
the exact URL, a DOM marker, and reported browser cleanup. This lane covers one
Android emulator and Termux combination, not physical ARM devices, Electron,
or the complete desktop browser suite. A workflow definition alone does not
establish passing Android coverage; inspect its execution receipt.

The `termux-browser-diagnostics` artifact retains the Termux command log, exit
status, and Android logcat on success or failure. The emulator is disposable.

## Packet capture analysis

`npm run verify:pcap -- --pcap PATH` exercises caller-supplied tshark and
capinfos against a saved capture. Linux verification uses Wireshark 4.6.6
and captures containing DNS, TLS and HTTP traffic. Native Windows and macOS
engine behavior remains unverified; process fixtures do not establish it.
See [Packet capture analysis](pcap-analysis.md) for contracts and budgets.

## Apple native metadata and UI

`tests/boundary/mcp/nativeDispatchBoundTarget.test.ts` uses the production
stdio MCP server on macOS to bind an inert, self-authored Mach-O, then replace
its path with missing, directory and symlink-loop states. Each refusal must
report `artifact_changed`; restoring the same bytes must succeed in the same
session. A separate non-root case checks real read permission denial as
`access_denied`. These tests read the target without executing it. Controlled
provider tests retain the physical acquisition failure through descriptor close
denial and confirm cleanup retry releases the original owner.

`npm run verify:apple-dispatch` compiles the Objective-C fixture (classes,
protocols, a property and an `NSString` category) and the Swift
conformance/vtable fixture.

- Each fixture is linked with legacy `LC_DYLD_INFO` binds and with chained
  fixups; on Apple silicon the ObjC fixture is also built as arm64e, which uses
  authenticated pointers.
- The lane inspects the bytes and repeats after stripping local symbols.
- It requires the bound `NSObject` superclass, the external category, and the
  matching `pointer_fixups` coverage. It requires macOS and the host Xcode toolchain; targets are not
  executed. `npm run verify:native-ui` launches exactly one source-owned fixture
  window and requires successful selected-window capture and selected actions.
  An OS permission denial fails the positive lane. `npm run verify:native-ui:permissions`
  allows a host-permission-boundary-only result and explicitly reports
  `positive_e2e: false`; it must not be reported as capture/action proof.
  Both commands reject a changed executable digest and clean up the fixture
  process and helper. These lanes require an interactive macOS desktop. See [native investigation](native-investigation.md).

`npm run verify:native-calls` needs macOS with Command Line Tools (`clang`,
`lldb`, `codesign`, `nm`) and actual debugger access to the owned fixtures.
The lane reports Developer Mode status without treating it as proof of access
or denial, and does not change host settings. LLDB and target entitlements
establish the tested permission boundary.
It compiles `tests/conformance/native/calls.m` and
runs `observe-native-calls` through the CLI and stdio MCP. It checks:

- the receiver class, selector and argument registers of every entry, and that
  breakpoint addresses equal `nm`'s symbol addresses;
- overlapping breakpoint selections retain each selection's hits and share
  the aggregate event limit; callback capture reads the stopped frame before
  LLDB resumes, avoiding stale frame metadata from asynchronous stop events;
- captured stdout and an environment override, plus a 2 MiB flood on each
  output stream with bounded retained prefixes and exact drained-byte counts;
- the event-limit and duration outcomes, with the process confirmed gone;
- that a hardened-runtime copy is refused with `debugger-attach-denied`, and
  that the same copy signed with `get-task-allow` is traced.

### Firmware adapters

Linux-owned provider launches require a procps-compatible `ps` on REA's `PATH`
so ownership can be inspected before launching a child. A missing or incompatible
command fails with an actionable capability error before the launch.

`npm run fixtures:firmware` uses existing Python 3 and a host C compiler to make
an ignored gzip/USTAR firmware fixture and independent offset/hash oracle.
`npm run verify:firmware` requires caller-supplied Binwalk 3.1.0, Unblob 26.6.4
and util-linux prlimit on Linux, with `7z` on `PATH` for the gzip/USTAR
fixture's Unblob extractor. The provider also accepts other 3.1.x and
26.6.x builds and reports them as unverified; this lane proves the audited
releases. It verifies CLI/MCP parity, selected ranges,
unknown chunks, depth limits and extracted child digests. The optional
`REA_FIRMWARE_VERIFY_EXT4=1` lane requires existing mke2fs/debugfs; the separate
`REA_FIRMWARE_VERIFY_GHIDRA=1` lane checks a selected host ELF through real Ghidra.
Neither optional toolchain is a base-lane prerequisite. See
[firmware analysis](firmware-analysis.md) for limits and unverified formats.

`npm run verify:esp-images` requires a Clang with the RISC-V target and
`ld.lld` (`REA_RISCV_CLANG`, `REA_RISCV_LLD`) and a Python that runs esptool
and espsecure (`REA_ESPTOOL_PYTHON`). It builds ESP32-C3 app and bootloader
ELF files from `tests/conformance/esp/`, converts them with `esptool
elf2image`, including `--secure-pad-v2`, `--ram-only-header` and
`--pad-to-size`, signs one with RSA, ECDSA P-256 and P-384 keys, and compares
REA's facts with `esptool image-info` and `espsecure signature-info-v2`. It
compares extracted segments and signature blocks with the producer's bytes,
and derives malformed images and ESP8266 v1 and v3 images. It checks each
tool before building and warns when esptool is not the pinned v5.6.0.
`REA_XTENSA_ESP32_GCC` adds an ESP32 Xtensa build. See
[ESP images](esp-image.md).

`npm run verify:uf2` needs only a Python that runs esptool, named by
`REA_ESPTOOL_PYTHON` (default `python3`). It writes inputs at known addresses,
builds UF2 files with esptool's `merge-bin --format uf2` (v4 `merge_bin`) with
and without MD5 and with 256-byte payloads, and concatenates two chips'
outputs. Inspection and extraction through the built CLI must return each input
at its address under the familyID esptool itself reports. It is not part of CI.
See [UF2 and DfuSe images](uf2-dfuse.md).
`npm run verify:esp-flash` needs the same tools and an ESP-IDF checkout
(`REA_ESP_IDF_PATH`) for `gen_esp32part.py` and `otatool.py`. It builds
partition tables, assembles dumps with `esptool merge-bin`, writes OTA records
with otatool through `tests/conformance/esp/flash_file_tool.py`, and compares
REA's flash facts with `image-info`, the decoded table and
`otatool read_otadata`. See [ESP flash images](esp-flash-image.md).

### JavaScript source recovery

Build once with `npm run build:cached`, then run `npm run verify:javascript:recovery`.
This focused lane requires Linux x64, util-linux `prlimit`,
`REA_WAKARU_COMMAND` pointing to the official Wakaru 1.14.0 Linux x64 binary,
and `REA_JAVASCRIPT_FIXTURE_TOOLS` pointing to an isolated npm prefix containing
esbuild 0.25.10 and webpack 5.101.3. No global installation is required.
The lane compiles source-owned fixtures, exercises CLI and stdio MCP, verifies
published bytes and provenance, feeds recovered modules into existing analysis,
and compares a finite set of known fixture results. A webpack fixture with separate
runtime, shared, entry and lazy chunks verifies multi-input recovery through both
surfaces, per-file provenance and resolved cross-chunk imports in the downstream
application graph. The provider also accepts
other ^1.13.0 releases and reports them as unverified; this lane proves the
audited release. It does not establish
arbitrary recovered-application equivalence. CI installs these prerequisites only
in `.github/workflows/real-javascript-recovery.yml`; the existing `real-browser`
lane uses real Chrome for browser capture and website workflows.

### Captured website source-map lane

`npm run verify:browser:source-maps` checks actual Chromium capture/export and
source-map point tracing through CLI and stdio MCP. It requires absolute
`REA_BROWSER_EXECUTABLE` and `REA_WEB_SOURCE_MAP_COMPILER` pointing to esbuild
0.25.10's `lib/main.js` in a caller-owned isolated installation. Preflight reports
missing prerequisites for this lane. The compiler is used only to generate the
source-owned fixture. No Hopper, Ghidra or application dependency installation
is required.

```bash
REA_BROWSER_EXECUTABLE=/absolute/path/to/chromium \
REA_WEB_SOURCE_MAP_COMPILER=/absolute/path/to/fixture-tools/node_modules/esbuild/lib/main.js \
npm run verify:browser:source-maps
```

`scripts/verify-browser-source-maps.mjs /absolute/path/to/installed/rea.mjs`
checks an installed package after building the verifier dependencies. The separate
conditional `real-web-source-map` CI job supplies Chrome and an isolated pinned
fixture compiler; static/unit checks do not acquire a browser. See
[the source location guide](web-source-location.md) for the verified decoder profile.

### JavaScript large-output lane

`npm run verify:javascript:output` exercises the CLI JSON result surface beyond
the running Node engine's single-string limit. Shared input leaves keep the
fixture's graph small; the verifier writes one temporary output file, checks its
complete byte count and an independent digest, then removes it. It requires only
Node and the built REA runtime, with space for the output plus a 1 GiB reserve.
Run `npm run verify:javascript:output -- jsonl` for compact JSONL coverage. Its
row collection must match independent row and final-metadata byte/digest goldens;
its token count is checked against the actual file one line at a time, even when
the complete export exceeds the engine string limit. This opt-in lane is separate from routine tests and the canonical hash check
`npm run verify:javascript:digests`. It verifies serialization rather than an
arbitrary third-party application's parsing cost or MCP client capacity.

### Website runtime attribution lane

`npm run verify:browser:runtime` uses caller-supplied
`REA_BROWSER_EXECUTABLE` and an owned synthetic site/profile. It exercises public
CLI and stdio MCP for precise execution and native listener source locations,
including actual armed progress, Unicode/CRLF digests, repeated source URLs with
distinct script IDs, zero branches and function-only unknowns on repeated
coverage, request initiators and an externally owned page that remains open.

An optional entrypoint argument to `scripts/verify-browser-runtime.mjs` runs the
same checks through an isolated installed package. The conditional
`real-web-runtime` CI job runs only for relevant changes and needs no fixture
compiler. Ordinary unit/static gates acquire no browser. See
[website runtime attribution](web-runtime.md) for effects, resource bounds and
coverage limits.

### Offline binary layout

`npm run verify:binary:layout` requires Linux x64, GCC/binutils, the
`i686-linux-gnu`, `arm-linux-gnueabi`, `mips-linux-gnu` and `mipsel-linux-gnu`
cross `gcc`/`readelf` toolchains, absolute
`REA_PWNTOOLS_PYTHON` with pwntools 4.15.0/pyelftools 0.33/Unicorn 2.1.2 and
absolute `REA_VERIFY_STRACE_COMMAND`. It compiles ephemeral source-owned ELF
fixtures and checks public CLI/MCP, lossless addresses/names, file ranges,
mitigation inferences, malformed/unsupported input, original file hashes and
released process ownership. Cross-compiled ELF32 executables and relocatable
objects check the reported class, machine and byte order, and every section
name, address, offset and size against GNU `readelf`. Exec syscall tracing must identify only the declared
Node/Python launchers; no target binary is executed. Core/debugger claims need
separate verification lanes. Pass an installed package entrypoint as the script's
first argument to verify packaging independently of the checkout.
The valid SHN_XINDEX fixture has 65,281 full section rows; CLI is checked in
the ordinary lane. Its large MCP transfer is opt-in with
`REA_VERIFY_LARGE_ELF_MCP=1` (or the workflow dispatch `large_mcp` input), an
explicit 256 MiB SDK receive buffer, matching server `REA_MCP_MAX_RESPONSE_BYTES`,
and five-minute request timeout. Ordinary
MCP fixtures retain the pinned SDK defaults.

### Offline EVM interface

`npm run verify:evm:interface` requires Linux x64, an absolute
`REA_VERIFY_STRACE_COMMAND`, caller-supplied util-linux `prlimit` and `REA_VERIFY_SOLC_MODULE` selecting the absolute module path for
solc 0.8.30. It compiles source-owned plain/optimized/via-IR Cancun fixtures in
private storage and checks actual CLI/MCP selector evidence, raw/hex identity,
unknowns, malformed carriers and independent cleanup. An optional positional
entrypoint verifies a fresh installed package. It acquires no engine, compiler
or chain dependency and does not execute a contract on a chain.

### Recorded crash evidence

`npm run verify:recorded:crash` is a separate Linux x64 lane. It requires GCC,
GDB, absolute `REA_PWNTOOLS_PYTHON` with the offline ELF profile above,
`REA_PWNDBG_GDBINIT` and `REA_PWNDBG_VENV_PATH` with unchanged pwndbg 2026.09.15,
and `REA_VERIFY_STRACE_COMMAND`. Its disposable CI runner installs GDB, checks out the exact upstream
commit and installs its frozen lockfile in isolated runner storage. No developer
host configuration or core-pattern setting changes.

Fixture generation explicitly runs an owned source-built two-thread program
under GDB to create a recording. Subsequent public CLI/MCP inspection verifies
lossless high registers, signed signals, note source bytes, malformed/missing
notes, unfamiliar owners, optional core-only mapping context and actionable
missing/unsupported plugin errors. A historical-PID collision fixture references
an owned live sentinel; inspection syscall traces reject process attach/memory
access, provider lookups of that PID's `/proc` files and attempted Internet sockets. Traces admit
the observed upstream startup helpers (`iconv -l`, the selected checkout's Git
version lookup) and REA ownership inspection separately from target execution.
This is fixture evidence, not a sandbox claim. Inputs remain unchanged and the
sentinel must stay alive; owned cleanup and empty verifier descendants are required. Pass an
installed package entrypoint as the script's first argument for package coverage.

### Exported environment bundles

`npm run verify:agentenv:environment` is the `real-agentenv` lane. It requires
the host's Docker CLI named by absolute `REA_DOCKER_COMMAND`, Python 3.12 with
`agentenv-framework==0.9.1334` installed in a virtual environment whose
`agent-env` binary is named by absolute `REA_AGENT_ENV_COMMAND`, and outbound
network for `pip` on the runner and for `npm` inside the image build. Both
variables are required; neither upstream executable is resolved from `PATH`,
and the verifier installs nothing. Packing uses the shared npm helper, honoring
`npm_execpath` from the caller's selected npm. Direct Node invocations without
that value use the helper's platform fallback, so configure the pinned toolchain
on `PATH` for those runs. It checks the supplied runner's `--version` against the pin before
using Docker and retains the observed version in both passing and failing receipts.
Its disposable CI runner creates the virtual environment in runner
storage, exports both paths and uses the runner's own Docker; no developer host
configuration changes. `agent-env run` attempts share one 22-minute budget
inside the 30-minute job (the first attempt at most 15 minutes), so a hung or
retried run ends with the verifier's failed receipt rather than the runner's
kill. The framework builds its gateway and service-db
images from `public.ecr.aws` on every fresh runner, and hosted runners share
that registry's anonymous pull quota, so the lane first pulls the base images
the pinned framework's Dockerfiles name from `mirror.gcr.io`, which serves the
same Docker official images under the same digests, and names them as those
Dockerfiles do (on Docker's containerd image store, so digest-pinned names
resolve), as the framework's own CI does. The quota handling below covers
anything still pulled from that registry. The receipt's `agent_env_run` records the
last run whether it passed or failed, with `public_ecr_quota` set to
`data_limit` or `rate` when that registry's `429 Too Many Requests` ended it.
The data-transfer cap (`toomanyrequests: Data limit exceeded`) is counted per
source IP, so it fails the lane at once: a pause on the same runner cannot lift
it. When a rate refusal ends the run and at least five minutes of the budget
would remain after the pause, the verifier waits 90 seconds and runs once more,
recording `attempts: 2` and `retried_for` in the receipt. Any other failure
ends the lane at once.

The verifier writes the Grafana-shaped HAR the view tests own, packs the
checkout with `npm pack`, builds the bundle from the HAR with
`rea environment-build --package-tarball` through the built CLI, the command
users run, so the image installs this checkout rather than the registry
package, and runs `agent-env run` on the bundle. It checks that the build
reports the 28-record capture, the default template rules, the planned file set
with the shipped manifest naming the reported capture, a coverage summary whose
read and served write tools add up to the served tool count, and a bundle
served from the derived state, which serves fewer tools than the
manifest because write tools the capture did not confirm are not served, that the runner exits `0` with
`tasks/smoke.json` reported as passed and the verifier's description naming
that served tool count, and that no container exists
after the run that did not exist before; the container inventory runs even when
the run fails or times out, so a failed receipt still lists what it left. The one exception is the framework's
own image-store helper, `agentenv-registry` (or `agentenv-registry-<port>`),
a `registry:2` container the local provider starts on first use and keeps
running across runs; a first run on a fresh host creates it, so the receipt
lists it under `image_store_helpers` instead of counting it as a leak. Images
built by the run remain and are counted in the receipt. Pass an installed
package entrypoint as the script's first argument for package coverage.

## Agent evaluation and conformance records

`npm run verify:agent` evaluates investigation scenarios through a real local
Codex CLI. The lane runs sequentially; select scenarios with
`REA_AGENT_EVAL_SCENARIOS` and choose the installed client/model with
`REA_CODEX_CLI` and `REA_AGENT_EVAL_MODEL`. The detailed
[agent evaluation reference](client-verification.md#agent-evaluation-and-conformance-records)
contains isolation, authentication cleanup, grading, and conformance boundaries.

The Notes evaluation packages `website/public/examples/notes-electron/`. When
changing those example bytes, run `tests/boundary/mcp/agentKnownAnswerMcp.test.ts`
and check its rubric in `tests/evaluation/model-evals/AgentEvaluationFixtures.ts`.
Preserve exact source facts and the coverage reported by the analysis. If a
source change crosses an unresolved static-analysis boundary, keep that
uncertainty and a negative control rejecting claims of complete coverage.

## Frida instrumentation

`npm run verify:frida` builds REA, spawns a short-lived local Node.js fixture,
loads a harmless marker script before resuming it, captures the message, and
detaches. This lane requires Linux on the REA host and the optional Frida
binding; it does not need a Frida server or a caller-selected process. To run
the separate remote attach lane, pass `-- --address HOST:PORT --pid PID` for an
explicitly selected process. Optional remote flags are `--token`,
`--certificate`, `--origin`, and `--keepalive-interval` (seconds); authentication values
are not written to files or included in the report. Mock tests do not establish
real device/server compatibility.

### Offline WASM artifacts

`npm run verify:wasm:artifact -- --require-tools` uses an absolute
`REA_WABT_BIN_DIRECTORY` containing WABT 1.0.42, including `wat2wasm` for fixture
generation. It installs nothing. Without configuration, the default invocation
reports a named skip; `--require-tools` makes missing configuration fail.

The verifier creates and validates real modules with custom sections, multiple
import/export kinds, escaped names, an empty module, and a bulk-memory
DataCount section. Debug-name fixtures cover compiler-generated module names
and preserved name-section payloads with empty, multiline, Unicode, long and
NUL-containing names. It compares exact WAT,
section output and selected/tool digests through the compiled CLI and real MCP
SDK, validates advertised schemas, checks identical CLI/MCP Evidence IDs and
session bundle readback, retains invalid/truncated module diagnostics, preserves
all inputs and checks workspace cleanup.
The lane also injects one cleanup denial for exact private runtime roots and
input descriptors, checks recovered CLI errors, and verifies retry on the same
MCP connection after repeated runtime-removal denial. These are controlled
faults, not naturally occurring permission failures; no WASM target is executed.
Pass an installed package's
`scripts/rea.mjs` as the first argument to run the same lane against the package.
`npm run verify:wasm:package` packs and installs REA into an isolated temporary
prefix with lifecycle scripts disabled and runs the same required real-tool lane.
It requires WABT configuration and makes no host tool installation.

Source-owned provider tests separately exercise cancellation, deadline propagation,
malformed producer output and cleanup uncertainty; shared owned-command tests
exercise actual subprocess timeout and cancellation.
